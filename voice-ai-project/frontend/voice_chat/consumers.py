# consumers_refactor_v1.py
import json
from channels.generic.websocket import AsyncWebsocketConsumer  # type: ignore
from channels.db import database_sync_to_async
from django.utils import timezone
from django.core.cache import cache
from users.models import CustomUser
from .models import Room, RoomParticipant

class RoomConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        self.room_id = self.scope['url_route']['kwargs']['room_id']
        self.room_group_name = f"room_{self.room_id}"
        self.user = self.scope["user"]

        # 1. Check authentication & membership
        if not self.user.is_authenticated or not await self.is_user_member():
            await self.close()
            return

        # 2. Add to channel group & accept connection
        await self.channel_layer.group_add(self.room_group_name, self.channel_name)
        await self.accept()
        await self.add_user_channel()

        # 3. Set user status & online
        await self._set_online_status_on_connect()

        # 4. Broadcast join event
        await self.channel_layer.group_send(
            self.room_group_name,
            {
                "type": "user_join",
                "user": {
                    "id": self.user.id,
                    "display_name": self.user.get_name_to_display(),
                }
            }
        )

    async def disconnect(self, close_code):
        if not self.user.is_authenticated:
            return
        await self.remove_user_channel()
        # Delay for concurrent connections check
        import asyncio
        await asyncio.sleep(3)
        still_connected = await self.is_user_member() and await self.is_user_still_connected()
        if not still_connected:
            await self.set_user_status("invisible")
            await self.update_user_online_status(is_online=False)
            # Broadcast invisible & leave
            await self.channel_layer.group_send(
                self.room_group_name,
                {
                    "type": "user_status",
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

    # --- Status/Presence Logic ---
    async def _set_online_status_on_connect(self):
        if self.user.status == "dnd":
            await self.set_user_status("dnd")
            await self.update_user_online_status(is_online=True)
        elif self.user.status == "invisible":
            await self.update_user_online_status(is_online=True)
        else:
            await self.set_user_status("online")
            await self.update_user_online_status(is_online=True)

    # --- Redis/Cache-based user channel tracking ---
    @database_sync_to_async
    def add_user_channel(self):
        key = f"user:{self.user.id}:room:{self.room_id}:channels"
        channels = cache.get(key, set())
        channels = set(channels)  # Always ensure set type
        channels.add(self.channel_name)
        cache.set(key, channels, timeout=60*10)

    @database_sync_to_async
    def remove_user_channel(self):
        key = f"user:{self.user.id}:room:{self.room_id}:channels"
        channels = cache.get(key, set())
        channels = set(channels)
        channels.discard(self.channel_name)
        cache.set(key, channels, timeout=60*10)
        return len(channels)

    @database_sync_to_async
    def is_user_still_connected(self):
        key = f"user:{self.user.id}:room:{self.room_id}:channels"
        channels = cache.get(key, set())
        channels = set(channels)
        return len(channels) > 0

    # --- Core Data Actions ---
    async def receive(self, text_data):
        try:
            data = json.loads(text_data)
        except Exception as e:
            await self.send(json.dumps({"error": "Invalid JSON"}))
            return
        action = data.get("action")

        if not self.user.is_authenticated:
            await self.close()
            return

        # Heartbeat (keepalive)
        if action == "heartbeat":
            await self.update_user_online_status(is_online=True)
            return
        # Set status
        if action == "set_status":
            new_status = data.get("status")
            if new_status in dict(CustomUser.STATUS_CHOICES):
                await self.set_user_status(new_status)
                await self.channel_layer.group_send(
                    self.room_group_name,
                    {
                        'type': 'user_status',
                        'user_id': self.user.id,
                        'status': new_status,
                    }
                )
            return
        # Add more action handlers as needed
        # Example: "send_message", etc.

    @database_sync_to_async
    def set_user_status(self, status):
        self.user.status = status
        self.user.save(update_fields=['status'])

    @database_sync_to_async
    def is_user_member(self):
        return RoomParticipant.objects.filter(room_id=self.room_id, user=self.user).exists()

    @database_sync_to_async
    def update_user_online_status(self, is_online: bool):
        if is_online:
            self.user.last_online = timezone.now()
            self.user.save(update_fields=['last_online'])

    # --- Broadcast Event Handlers ---
    async def user_join(self, event):
        await self.send(text_data=json.dumps(event))
    async def user_leave(self, event):
        await self.send(text_data=json.dumps(event))
    async def update_members(self, event):
        await self.send(text_data=json.dumps({"type": "refresh_members"}))
    async def profile_updated(self, event):
        await self.send(text_data=json.dumps(event))
    async def user_status(self, event):
        await self.send(text_data=json.dumps({
            'type': 'user_status',
            'user_id': event['user_id'],
            'status': event['status'],
        }))
    async def role_changed(self, event):
        await self.send(text_data=json.dumps({
            'type': 'role_update',
            'user_id': event['user_id'],
            'new_role': event['new_role'],
        }))
    async def chat_message(self, event):
        await self.send(text_data=json.dumps({
            'type': 'chat_message',
            'message': event['message'],
        }))
    async def voice_member_update(self, event):
        await self.send(text_data=json.dumps({
            "type": "voice_member_update",
            "room_id": event["room_id"],
            "members": event["members"],
        }))
