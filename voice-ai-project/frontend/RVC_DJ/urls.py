from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.urls import path, include

urlpatterns = [
    path("admin/", admin.site.urls),
    path("", include("voice_chat.urls")),
    path("users/", include("users.urls")),  # เพิ่ม users app
]

# ✅ เพิ่ม static และ media files เฉพาะตอน DEBUG เท่านั้น
if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)