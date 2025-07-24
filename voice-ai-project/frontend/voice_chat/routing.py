from django.urls import path  # type: ignore
from voice_chat.consumers import RoomConsumer
from voice_chat.voiceconsumer import VoiceRTCConsumer
websocket_urlpatterns = [
    path("ws/room/<int:room_id>/", RoomConsumer.as_asgi()),  # WS#1 - Event/Chat
    path("ws/rtc/<int:room_id>/", VoiceRTCConsumer.as_asgi()),  # สำหรับ signaling
]
# ✅ Debugging: ตรวจสอบว่า URL ถูกต้อง
print(f"✅ WebSocket URLs Loaded: {websocket_urlpatterns}")
