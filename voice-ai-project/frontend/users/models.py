import os
import uuid
from django.contrib.auth.models import AbstractUser # type: ignore
from django.db import models # type: ignore
from django.utils import timezone # Import timezone
from datetime import timedelta # Import timedelta


def default_profile_image():
    return "default/profile.jpg"  # ✅ ใช้ไฟล์รูปที่อยู่ใน MEDIA_ROOT/default/


def user_profile_picture_path(instance, filename):
    ext = filename.split(".")[-1]
    filename = f"profile_{uuid.uuid4().hex}.{ext}"  # ✅ ตั้งชื่อไฟล์แบบสุ่ม
    return os.path.join("profile_pics/", filename)


class CustomUser(AbstractUser):
    
    # Field เดิมของคุณ (อาจจะเลือกใช้ profile_image เป็นหลัก)
    # profile_picture = models.ImageField(upload_to=user_profile_picture_path, null=True, blank=True,default=default_profile_image)
    profile_image = models.ImageField(
        upload_to="profile_images/", default=default_profile_image
    )  # เอา () ออก

    # --- เพิ่ม Field ใหม่สำหรับชื่อที่แสดง ---
    display_name = models.CharField(max_length=150, blank=True, verbose_name="ชื่อที่แสดง")
    # --- สิ้นสุดการเพิ่ม Field ใหม่ ---
    
    # --- เพิ่ม Field ใหม่สำหรับสถานะออนไลน์ ---
    last_online = models.DateTimeField(null=True, blank=True)
    # --- เพิ่ม Field ใหม่สำหรับสถานะ (online/dnd/invisible) ---
    STATUS_CHOICES = [
        ("online", "ออนไลน์"),
        ("dnd", "ไม่รบกวน"),
        ("invisible", "ซ่อนตัว")
    ]
    status = models.CharField(max_length=16, choices=STATUS_CHOICES, default="online")
    # --- สิ้นสุดการเพิ่ม Field ใหม่ ---

    # --- เพิ่ม Method สำหรับตรวจสอบสถานะออนไลน์ ---
    def is_online(self):
        if not self.last_online:
            return False
        # กำหนดว่าถ้า active ภายใน 60 วินาทีล่าสุด ถือว่าออนไลน์
        # (เผื่อเวลาจาก heartbeat ที่ส่งทุก 30 วินาที)
        return timezone.now() < self.last_online + timedelta(seconds=60)
    # --- สิ้นสุด Method ใหม่ ---

    def get_profile_image_url(self):
        if self.profile_image and hasattr(self.profile_image, "url"):
            return self.profile_image.url
        return "/media/default/profile.jpg"  # ตรวจสอบว่า MEDIA_URL ถูกตั้งค่าถูกต้อง

    # --- เพิ่ม Method สำหรับดึงชื่อที่จะแสดงผล ---
    def get_name_to_display(self):
        if self.display_name:
            return self.display_name
        return self.username  # ถ้า display_name ว่าง ให้ใช้ username แทน

    # --- สิ้นสุด Method ใหม่ ---
    role = models.CharField(max_length=50, default='member') 
    # Override save method เพื่อตั้ง display_name เริ่มต้น
    def save(self, *args, **kwargs):
        is_new = self._state.adding  # ตรวจสอบว่าเป็น object ใหม่หรือไม่ (ก่อน Django 5.0)
        # หรือ is_new = not self.pk # สำหรับ Django ทั่วไป

        if is_new and not self.display_name:
            self.display_name = self.username
        super().save(*args, **kwargs)

    def __str__(self):
        return self.username
