import os
import django
from django.core.asgi import get_asgi_application
from channels.routing import ProtocolTypeRouter, URLRouter
from channels.auth import AuthMiddlewareStack

# ✅ ตั้งค่า Django settings ก่อน
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "RVC_DJ.settings")
django.setup()  # **เรียก setup() ก่อน import อื่น**

# ✅ โหลด WebSocket routes อย่างปลอดภัย
try:
    from voice_chat.routing import websocket_urlpatterns
    print("✅ Loaded WebSocket routes successfully!")
except (ImportError, AttributeError) as e:
    websocket_urlpatterns = []
    print(f"❌ WebSocket routing error: {e}")

# ✅ ตั้งค่า ASGI Application
application = ProtocolTypeRouter({
    "http": get_asgi_application(),
    "websocket": AuthMiddlewareStack(
        URLRouter(websocket_urlpatterns)
    ) if websocket_urlpatterns else get_asgi_application(),
})