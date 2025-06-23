import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent

SECRET_KEY = os.getenv("DJANGO_SECRET_KEY", "your-default-secret-key")

INSTALLED_APPS = [
    'RVC_DJ',
    'daphne',
    'channels',
    'users',
    'voice_chat',
    'django_extensions',
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
]

ASGI_APPLICATION = 'RVC_DJ.asgi.application'
ROOT_URLCONF = "RVC_DJ.urls"

CHANNEL_LAYERS = {
    "default": {
        "BACKEND": "channels_redis.core.RedisChannelLayer",
        "CONFIG": {
            "hosts": [("redis", 6379)],
        },
    },
}

# ✅ Static & Media Files
STATIC_URL = "/static/"
STATICFILES_DIRS = [BASE_DIR / "static"]
STATIC_ROOT = BASE_DIR / "staticfiles"

MEDIA_URL = "/media/"
MEDIA_ROOT = BASE_DIR / "media"

# ✅ Middleware
MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

# ✅ Templates
TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [BASE_DIR / "frontend/voice_chat/templates"],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.debug",
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    }
]

# ✅ Database (MySQL)
DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.mysql",
        "NAME": "voice_ai",
        "USER": "django_user",
        "PASSWORD": "VC@V-ai2025",
        "HOST": "db",
        "PORT": "3306",
        "OPTIONS": {
            "charset": "utf8mb4",
        },
    }
}

# ✅ Redirects
LOGIN_URL = "/users/login/"
LOGIN_REDIRECT_URL = "/"
LOGOUT_REDIRECT_URL = "/users/login/"

# ✅ Security
DEBUG = True
ALLOWED_HOSTS = ["*"]
CSRF_TRUSTED_ORIGINS = ["http://localhost:8000"]

# ✅ Email Backend
EMAIL_BACKEND = "django.core.mail.backends.console.EmailBackend"

# ✅ Custom User Model
AUTH_USER_MODEL = "users.CustomUser"

# ✅ Session Settings
SESSION_COOKIE_AGE = 86400  # 24 ชั่วโมง
SESSION_EXPIRE_AT_BROWSER_CLOSE = False  # ✅ ให้ session คงอยู่แม้ปิด browser
SESSION_SAVE_EVERY_REQUEST = True  # ✅ ต่ออายุ session ทุก request

# อนุญาต WebSocket CORS
CORS_ALLOWED_ORIGINS = [
    "http://localhost:8000",
    "http://127.0.0.1:8000",
]

# ถ้าต้องการให้อนุญาตทุกโดเมน ใช้:
CORS_ALLOW_ALL_ORIGINS = True

# Channels Allowed Hosts
ALLOWED_HOSTS = ["localhost", "127.0.0.1"]
