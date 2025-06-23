import json
from channels.generic.websocket import AsyncWebsocketConsumer # type: ignore
from django.contrib.auth.models import AnonymousUser # type: ignore
from .models import Room, RoomParticipant

class RoomConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        # รับชื่อห้องจาก URL
        self.accept()
        self.room_name = self.scope['url_route']['kwargs']['room_name']
        self.room_group_name = f"room_{self.room_name}"
        self.user = self.scope["user"]

        # ตรวจสอบว่าเป็นผู้ใช้ที่ไม่ได้ล็อกอินหรือไม่
        if isinstance(self.user, AnonymousUser):
            await self.close()
            return

        # ตรวจสอบว่าผู้ใช้เป็นสมาชิกของห้องนั้นหรือไม่
        if not await self.is_user_in_room():
            await self.close()
            return

        # เข้าร่วมห้อง
        await self.channel_layer.group_add(self.room_group_name, self.channel_name)
        await self.accept()

        # แจ้งให้ห้องทราบว่ามีผู้ใช้เข้าร่วม
        await self.channel_layer.group_send(
            self.room_group_name,
            {
                "type": "user_join",
                "username": self.user.username
            }
        )

    async def disconnect(self, close_code):
        print(f"Disconnected: {close_code}")
        # ออกจากห้อง
        await self.channel_layer.group_discard(self.room_group_name, self.channel_name)

        # แจ้งให้ห้องทราบว่าผู้ใช้ท่านนี้ออกจากห้อง
        if not isinstance(self.user, AnonymousUser):
            await self.channel_layer.group_send(
                self.room_group_name,
                {
                    "type": "user_leave",
                    "username": self.user.username
                }
            )

    async def receive(self, text_data):
        # รับข้อมูลจาก WebSocket
        data = json.loads(text_data)
        message = data.get('message')
        username = data.get('username')

        if message:
            # ส่งข้อความไปยังทุกคนในห้อง
            await self.channel_layer.group_send(
                self.room_group_name,
                {
                    "type": "room_message",
                    "message": message,
                    "username": username
                }
            )

    async def room_message(self, event):
        # ส่งข้อความไปยัง client
        await self.send(text_data=json.dumps({
            "type": "chat",
            "message": event["message"],
            "username": event["username"]
        }))

    async def user_join(self, event):
        # แจ้งเมื่อมีผู้ใช้เข้าร่วม
        await self.send(text_data=json.dumps({
            "type": "join",
            "username": event["username"]
        }))

    async def user_leave(self, event):
        # แจ้งเมื่อผู้ใช้ออกจากห้อง
        await self.send(text_data=json.dumps({
            "type": "leave",
            "username": event["username"]
        }))

    async def is_user_in_room(self):
        # ตรวจสอบว่าผู้ใช้เป็นสมาชิกของห้องหรือไม่
        try:
            room = await Room.objects.get(invite_code=self.room_name)
            return await RoomParticipant.objects.filter(room=room, user=self.user).aexists()
        except Room.DoesNotExist:
            return False
