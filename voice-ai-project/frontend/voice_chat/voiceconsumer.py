# voice_chat/voiceconsumer.py

import json
from channels.generic.websocket import AsyncWebsocketConsumer
from channels.db import database_sync_to_async
from django.core.cache import cache
from users.models import CustomUser
from .models import Room, RoomParticipant

try:
    from autobahn.exception import Disconnected  # optional
except Exception:  # เผื่อไม่ได้ใช้ autobahn จริง
    class Disconnected(Exception):
        pass


class VoiceRTCConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        self.alive = True

        # --- ดึงพารามิเตอร์/บริบทก่อน ---
        self.room_id = self.scope["url_route"]["kwargs"]["room_id"]
        self.user = self.scope.get("user")
        self.voice_group_name = f"rtc_voice_{self.room_id}"

        # --- ตรวจสิทธิ์ก่อน accept (ปฏิเสธให้ปิดได้เลย) ---
        if not self.user or not getattr(self.user, "is_authenticated", False):
            await self.close(code=4401)  # Unauthorized
            return

        if not await self.is_user_member():
            await self.close(code=4403)  # Forbidden: not a room member
            return

        # --- join group ก่อน แล้วค่อย accept หนึ่งครั้งเท่านั้น ---
        await self.channel_layer.group_add(self.voice_group_name, self.channel_name)

        # ✅ accept ครั้งเดียวต่อการเชื่อมต่อ
        await self.accept()

        # --- presence & แจ้งสมาชิก ---
        await self.set_voice_presence(True)
        await self.broadcast_member_list()

    async def disconnect(self, close_code):
        self.alive = False
        # เผื่อกรณี user ไม่อยู่แล้ว ไม่ให้พัง
        user_ok = bool(getattr(self, "user", None)) and getattr(self.user, "is_authenticated", False)
        if user_ok:
            try:
                await self.set_voice_presence(False)
            except Exception:
                pass
        try:
            await self.channel_layer.group_discard(self.voice_group_name, self.channel_name)
        except Exception:
            pass
        try:
            await self.broadcast_member_list()
        except Exception:
            pass

    async def receive(self, text_data):
        try:
            data = json.loads(text_data)
        except Exception:
            await self.send(json.dumps({"error": "Invalid JSON"}))
            return

        action = data.get("type") or data.get("action")  # "voice_join", "offer", "answer", "ice", "leave", "heartbeat"

        if action == "voice_join":
            await self.set_voice_presence(True)
            await self.broadcast_member_list()

        elif action == "voice_leave":
            await self.set_voice_presence(False)
            await self.broadcast_member_list()
            await self.close()

        elif action in {"offer", "answer", "ice"}:
            target_id = data.get("target")
            payload = {
                "type": action,
                "from": getattr(self.user, "id", None),
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
    def set_voice_presence(self, active: bool):
        key = f"voice:room:{self.room_id}:members"
        # เก็บเป็น set ใน cache; ถ้า backend เป็น redis + pickle ได้ จะไม่เป็นปัญหา
        member_set = set(cache.get(key, set()))
        uid = getattr(self.user, "id", None)
        if uid is None:
            return
        if active:
            member_set.add(uid)
        else:
            member_set.discard(uid)
        cache.set(key, member_set, timeout=60 * 30)

    @database_sync_to_async
    def get_voice_members(self):
        key = f"voice:room:{self.room_id}:members"
        member_ids = list(cache.get(key, set()))
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
        # กระจายไปทั้งกลุ่ม text room และ voice room
        evt = {
            "type": "voice_member_update",
            "room_id": self.room_id,
            "members": members,
        }
        await self.channel_layer.group_send(f"room_{self.room_id}", evt)
        await self.channel_layer.group_send(self.voice_group_name, evt)

    async def send_to_peer(self, target_user_id, payload):
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
        if not getattr(self, "alive", False):
            return
        try:
            # รองรับทั้งสองรูปแบบของ event
            payload = event.get("payload")
            if not payload:
                payload = {
                    "room_id": event.get("room_id"),
                    "members": event.get("members", []),
                }
            await self.send(text_data=json.dumps({
                "type": "member_update",
                "payload": payload
            }))
        except Disconnected:
            self.alive = False
        except Exception:
            self.alive = False

    async def voice_signal(self, event):
        await self.send(text_data=json.dumps(event["payload"]))
