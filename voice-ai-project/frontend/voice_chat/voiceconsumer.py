# R:\s\PlatFormV2\voice-ai-project\frontend\voice_chat\voiceconsumer.py
import json
from channels.generic.websocket import AsyncWebsocketConsumer
from channels.db import database_sync_to_async
from django.core.cache import cache
from users.models import CustomUser
from .models import Room, RoomParticipant

class VoiceRTCConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        self.room_id = self.scope['url_route']['kwargs']['room_id']
        self.user = self.scope["user"]
        self.voice_group_name = f"rtc_voice_{self.room_id}"

        # Authentication: Only allow room member join
        if not self.user.is_authenticated or not await self.is_user_member():
            await self.close()
            return

        # Join voice room group
        await self.channel_layer.group_add(self.voice_group_name, self.channel_name)
        await self.accept()
        await self.set_voice_presence(True)
        await self.broadcast_member_list()

    async def disconnect(self, close_code):
        if self.user.is_authenticated:
            await self.set_voice_presence(False)
            await self.channel_layer.group_discard(self.voice_group_name, self.channel_name)
            await self.broadcast_member_list()

    async def receive(self, text_data):
        try:
            data = json.loads(text_data)
        except Exception:
            await self.send(json.dumps({"error": "Invalid JSON"}))
            return

        action = data.get("type") or data.get("action")  # "voice_join", "offer", "answer", "ice", "leave"

        # ========== RTC Signaling Logic ==========
        if action == "voice_join":
            await self.set_voice_presence(True)
            await self.broadcast_member_list()
        elif action == "voice_leave":
            await self.set_voice_presence(False)
            await self.broadcast_member_list()
            await self.close()
        elif action in {"offer", "answer", "ice"}:
            # Forward signaling to target peer
            target_id = data.get("target")
            payload = {
                "type": action,
                "from": self.user.id,
                "data": data.get("data"),
            }
            await self.send_to_peer(target_id, payload)
        elif action == "heartbeat":
            await self.set_voice_presence(True)
        else:
            await self.send(json.dumps({"error": "Unknown action"}))

    # ========= Helper methods =========

    @database_sync_to_async
    def is_user_member(self):
        return RoomParticipant.objects.filter(room_id=self.room_id, user=self.user).exists()

    @database_sync_to_async
    def set_voice_presence(self, active):
        key = f"voice:room:{self.room_id}:members"
        member_set = set(cache.get(key, set()))
        if active:
            member_set.add(self.user.id)
        else:
            member_set.discard(self.user.id)
        cache.set(key, member_set, timeout=60*30)

    @database_sync_to_async
    def get_voice_members(self):
        key = f"voice:room:{self.room_id}:members"
        member_ids = list(cache.get(key, set()))
        # Get user display info (avatar/display_name) for all in voice room
        users = CustomUser.objects.filter(id__in=member_ids)
        result = []
        for user in users:
            result.append({
                "userId": user.id,
                "displayName": user.get_name_to_display(),
                "avatarUrl": user.get_profile_image_url(),
                "status": user.status,
            })
        return result

    async def broadcast_member_list(self):
        members = await self.get_voice_members()
        # Broadcast ให้ทั้ง voice group และ room group (text chat WS group)
        await self.channel_layer.group_send(
            f"room_{self.room_id}",    # <-- เพิ่ม broadcast ไปยัง group text room
            {
                "type": "voice_member_update",
                "room_id": self.room_id,
                "members": members,
            }
        )
        await self.channel_layer.group_send(
            self.voice_group_name,
            {
                "type": "voice_member_update",
                "room_id": self.room_id,
                "members": members,
            }
        )



    async def send_to_peer(self, target_user_id, payload):
        # ส่ง message ไปหา peer คนเดียว (ถ้า target online)
        # (ใช้ channel_layer group หรือสร้าง mapping userId-to-channel_name แบบ custom ก็ได้)
        # ตรงนี้ขอใช้ broadcast ให้ peer เช็คฝั่ง client ว่า message มาถึง target หรือไม่
        payload["target"] = target_user_id
        await self.channel_layer.group_send(
            self.voice_group_name,
            {
                "type": "voice_signal",
                "payload": payload,
            }
        )

    # ========== Channel Layer Event Handlers ==========
    async def voice_member_update(self, event):
        # Broadcast member list ให้ทุก client
        await self.send(text_data=json.dumps({
            "type": "voice_member_update",
            "members": event["members"],
        }))

    async def voice_signal(self, event):
        # ทุก client จะได้รับ event นี้ แล้ว filter ฝั่ง client ต่ออีกที
        await self.send(text_data=json.dumps(event["payload"]))
