import json
from channels.generic.websocket import AsyncWebsocketConsumer # type: ignore
from channels.db import database_sync_to_async # Import เพื่อใช้ ORM ใน async function
from django.utils import timezone # Import timezone
from django.core.cache import cache  # <--- เพิ่มบรรทัดนี้เพื่อ import cache
from users.models import CustomUser
from .models import Room, RoomParticipant # ✅ เพิ่มการ import ที่จำเป็น

class RoomConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        """ เรียกใช้เมื่อผู้ใช้เชื่อมต่อ WebSocket """
        self.room_id = self.scope['url_route']['kwargs']['room_id']
        self.room_group_name = f"room_{self.room_id}"
        self.user = self.scope["user"]  # เก็บ user object

        # 1. ตรวจสอบว่าผู้ใช้ล็อกอินหรือยัง
        if not self.user.is_authenticated:
            await self.close()
            return

        # 2. ตรวจสอบว่าผู้ใช้เป็นสมาชิกของห้องนี้หรือไม่ (เพื่อความปลอดภัย)
        if not await self.is_user_member():
            await self.close()
            return

        # 3. เข้าร่วมกลุ่ม WebSocket
        await self.channel_layer.group_add(self.room_group_name, self.channel_name)
        await self.accept()

        # --- Track การเชื่อมต่อของ user ใน Redis/Cache ---
        await self.add_user_channel()


        # 4. อัปเดตสถานะออนไลน์ของผู้ใช้ (online/dnd/invisible)
        # ถ้า user เคยเลือก dnd ให้คง dnd, ถ้า invisible ให้คง invisible, ถ้าไม่ให้เป็น online
        if self.user.status == "dnd":
            await self.set_user_status("dnd")
            await self.update_user_online_status(is_online=True)
        elif self.user.status == "invisible":
            # ไม่ต้อง set_user_status ใหม่, แค่ update last_online เพื่อกัน timeout
            await self.update_user_online_status(is_online=True)
        else:
            await self.set_user_status("online")
            await self.update_user_online_status(is_online=True)

        # 5. แจ้งทุกคนในห้องว่ามีผู้ใช้ใหม่ "เข้าร่วม" (Join)
        #    นี่คือส่วนสำคัญที่แก้ไขปัญหาหลัก
        await self.channel_layer.group_send(
            self.room_group_name,
            {
                "type": "user_join", # <-- เปลี่ยนเป็น user_join ให้ตรงกับ JS
                "user": { # ส่งข้อมูลผู้ใช้ไปด้วยเผื่อใช้ในอนาคต
                    "id": self.user.id,
                    "display_name": self.user.get_name_to_display(),
                }
            }
        )

    async def disconnect(self, close_code):
        """ เรียกใช้เมื่อผู้ใช้ตัดการเชื่อมต่อ """
        if self.user.is_authenticated:
            print(f"❌ {self.user.username} ออกจากห้อง {self.room_group_name}")

            # --- ลบ channel_name ออกจาก Redis/Cache ---
            await self.remove_user_channel()

            # --- Delay ก่อน set สถานะ invisible เพื่อป้องกัน refresh/reconnect กลายเป็นล่องหน ---
            import asyncio
            await asyncio.sleep(5)  # รอ 5 วินาที
            # เช็คว่าผู้ใช้ยัง connect อยู่หรือไม่ (เช่น มี session อื่นในห้องนี้)
            # ถ้าไม่มีการ connect ใหม่ใน 5 วินาที ค่อย set เป็น invisible
            still_connected = await self.is_user_member() and await self.is_user_still_connected()

            if not still_connected:
                await self.set_user_status("invisible")
                await self.update_user_online_status(is_online=False)

                # แจ้งทุกคนในห้องว่ามีผู้ใช้ "ออกจากห้อง" (Leave)
                await self.channel_layer.group_send(
                    self.room_group_name,
                    {
                        "type": "user_status",  # broadcast สถานะใหม่ทันที (userlist frontend จะ sync)
                        "user_id": self.user.id,
                        "status": "invisible",
                    }
                )
                await self.channel_layer.group_send(
                    self.room_group_name,
                    {
                        "type": "user_leave",
                        "user": {
                            "id": self.user.id,
                            "display_name": self.user.get_name_to_display(),
                        }
                    }
                )

            # ออกจากกลุ่ม WebSocket (สำคัญมาก)
            await self.channel_layer.group_discard(
                self.room_group_name,
                self.channel_name
            )

    # --- Redis/Cache-based user channel tracking ---
    from django.core.cache import cache

    @database_sync_to_async
    def add_user_channel(self):
        key = f"user:{self.user.id}:room:{self.room_id}:channels"
        channels = cache.get(key, set())
        channels.add(self.channel_name)
        cache.set(key, channels, timeout=60*10)  # 10 นาที

    @database_sync_to_async
    def remove_user_channel(self):
        key = f"user:{self.user.id}:room:{self.room_id}:channels"
        channels = cache.get(key, set())
        channels.discard(self.channel_name)
        cache.set(key, channels, timeout=60*10)
        return len(channels)

    @database_sync_to_async
    def is_user_still_connected(self):
        key = f"user:{self.user.id}:room:{self.room_id}:channels"
        channels = cache.get(key, set())
        return len(channels) > 0

    async def receive(self, text_data):
        """ เมื่อได้รับข้อความจาก Client """
        data = json.loads(text_data)
        action = data.get("action")

        # อัปเดต last_online เมื่อผู้ใช้ยัง active (ส่ง heartbeat)
        if self.user.is_authenticated and action == "heartbeat":
            await self.update_user_online_status(is_online=True)

        # --- เพิ่มรองรับการเปลี่ยนสถานะ realtime ผ่าน WebSocket ---
        if self.user.is_authenticated and action == "set_status":
            new_status = data.get("status")
            if new_status in dict(CustomUser.STATUS_CHOICES):
                await self.set_user_status(new_status)
                # Broadcast ไปยังสมาชิกในห้องนี้ทันที
                await self.channel_layer.group_send(
                    self.room_group_name,
                    {
                        'type': 'user_status',
                        'user_id': self.user.id,
                        'status': new_status,
                    }
                )

    @database_sync_to_async
    def set_user_status(self, status):
        self.user.status = status
        self.user.save(update_fields=['status'])

    # --- Database Helper Functions ---

    @database_sync_to_async
    def is_user_member(self):
        return RoomParticipant.objects.filter(room_id=self.room_id, user=self.user).exists()

    @database_sync_to_async
    def update_user_online_status(self, is_online: bool):
        if is_online:
            # อัปเดตเวลาล่าสุดที่ออนไลน์ เพื่อให้ is_online() คืนค่า True
            self.user.last_online = timezone.now()
            self.user.save(update_fields=['last_online'])
        # ถ้า is_online=False เราไม่ต้องทำอะไร ปล่อยให้ last_online เก่าไปเอง

    # --- Event Handlers (จาก Group ส่งไปยัง Client) ---

    async def user_join(self, event):
        """ ส่ง event 'user_join' ที่ได้รับจาก group ไปยัง client แต่ละคน """
        await self.send(text_data=json.dumps(event))

    async def user_leave(self, event):
        """ ส่ง event 'user_leave' ที่ได้รับจาก group ไปยัง client แต่ละคน """
        await self.send(text_data=json.dumps(event))

    async def update_members(self, event):
        """ จัดการ event ที่ถูกส่งมาจาก view (เช่น ตอน join/leave ผ่าน API) """
        await self.send(text_data=json.dumps({"type": "refresh_members"}))


    async def profile_updated(self, event):
        """ ส่ง event 'profile_updated' ที่ได้รับจาก group ไปยัง client """
        await self.send(text_data=json.dumps(event))

    async def user_status(self, event):
        """ ส่ง event 'user_status' ที่ได้รับจาก group ไปยัง client (JS) """
        await self.send(text_data=json.dumps({
            'type': 'user_status',
            'user_id': event['user_id'],
            'status': event['status'],
        }))

    async def role_changed(self, event):
        """ จัดการ event 'role_changed' จาก view และส่ง 'role_update' ไปยัง JS """
        await self.send(text_data=json.dumps({
            'type': 'role_update',
            'user_id': event['user_id'],
            'new_role': event['new_role'],
        }))

    async def chat_message(self, event):
        """ ส่ง event 'chat_message' ที่ได้รับจาก group ไปยัง client แต่ละคน """
        await self.send(text_data=json.dumps({
            'type': 'chat_message',
            'message': event['message'],
        }))