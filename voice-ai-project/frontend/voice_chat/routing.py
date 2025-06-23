from django.urls import path # type: ignore
from voice_chat.consumers import RoomConsumer

websocket_urlpatterns = [
    path("ws/room/<int:room_id>/", RoomConsumer.as_asgi()),
]


# ✅ Debugging: ตรวจสอบว่า URL ถูกต้อง
print(f"✅ WebSocket URLs Loaded: {websocket_urlpatterns}")
