from django.db import models # type: ignore
import uuid, os, random
from users.models import CustomUser 
from django.utils import timezone # type: ignore

def default_room_image():
    return "default/room.jpg"  # ✅ ใช้รูปห้องที่ตั้งค่าเริ่มต้น

def room_image_upload_path(instance, filename):
    ext = filename.split('.')[-1]
    filename = f"room_{uuid.uuid4().hex}.{ext}"  # ✅ ตั้งชื่อไฟล์แบบสุ่ม
    return os.path.join("room_images/", filename)

# Rooms Table
class Room(models.Model):
    name = models.CharField(max_length=255)  # เอา unique ออก ชื่อซ้ำได้
    owner = models.ForeignKey(CustomUser, on_delete=models.CASCADE, related_name="owned_rooms")
    image = models.ImageField(upload_to='room_images/', null=True, blank=True, default=default_room_image)
    invite_code = models.CharField(max_length=8, unique=True, blank=True, null=True)

    def save(self, *args, **kwargs):
        if not self.invite_code:
            while True:
                new_code = f"{random.randint(0, 999999):06d}"
                if not Room.objects.filter(invite_code=new_code).exists():
                    self.invite_code = new_code
                    break
        super().save(*args, **kwargs)

# RoomRoles Table
class RoomRole(models.Model):
    ROLE_CHOICES = [
        ('owner', 'Owner'),
        ('admin', 'Admin'),
        ('family', 'Family'),
        ('member', 'Member'),  # Default role
    ]

    room = models.ForeignKey(Room, on_delete=models.CASCADE, related_name="roles")
    role_name = models.CharField(max_length=50, choices=ROLE_CHOICES, default='member')
    # ปรับปรุง field permissions ให้เป็น JSONField เพื่อความยืดหยุ่น
    permissions = models.JSONField(default=dict)

    def __str__(self):
        return f"{self.get_role_name_display()} in {self.room.name}"


    class Meta:
        db_table = "voice_chat_roomrole"

# RoomMembers Table
class RoomParticipant(models.Model):  # เปลี่ยนจาก RoomMember เป็น RoomParticipant
    room = models.ForeignKey(Room, on_delete=models.CASCADE, related_name="members")
    user = models.ForeignKey(CustomUser, on_delete=models.CASCADE, related_name="room_memberships")
    role = models.ForeignKey(RoomRole, on_delete=models.SET_NULL, null=True, related_name="members")
    joined_at = models.DateTimeField(default=timezone.now)

    class Meta:
        db_table = "voice_chat_roomparticipant"  # ✅ แก้ชื่อให้ตรงกับตารางที่ถูกสร้าง

    def can(self, action):
        """Check if a participant has permission to perform an action."""
        if self.role:
            # เจ้าของห้องมีสิทธิ์ทุกอย่าง
            if self.role.role_name == 'owner':
                return True

            # ตรวจสอบ permission จาก role
            permissions = self.role.permissions
            if isinstance(permissions, dict) and permissions.get(action, False):
                return True

        return False # Default: no permission


        
# Messages Table
class Message(models.Model):
    room = models.ForeignKey(Room, on_delete=models.CASCADE, related_name="messages")
    user = models.ForeignKey(CustomUser, on_delete=models.CASCADE, related_name="messages")
    content = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

# Reactions Table
class Reaction(models.Model):
    message = models.ForeignKey(Message, on_delete=models.CASCADE, related_name="reactions")
    user = models.ForeignKey(CustomUser, on_delete=models.CASCADE, related_name="reactions")
    reaction_type = models.CharField(max_length=10)  # เช่น ❤️ 👍 😂
    created_at = models.DateTimeField(auto_now_add=True)

# Invitations Table
class Invitation(models.Model):
    room = models.ForeignKey(Room, on_delete=models.CASCADE, related_name="invitations")
    sender = models.ForeignKey(CustomUser, on_delete=models.CASCADE, related_name="sent_invitations")
    receiver = models.ForeignKey(CustomUser, on_delete=models.CASCADE, related_name="received_invitations")
    status = models.CharField(max_length=10, choices=[('pending', 'Pending'), ('accepted', 'Accepted'), ('rejected', 'Rejected')], default='pending')
    created_at = models.DateTimeField(auto_now_add=True)

# InviteLinks Table
class InviteLink(models.Model):
    room = models.ForeignKey(Room, on_delete=models.CASCADE, related_name="invite_links")
    created_by = models.ForeignKey(CustomUser, on_delete=models.CASCADE, related_name="created_invite_links")
    expiration_date = models.DateTimeField()
    max_uses = models.IntegerField()
    current_uses = models.IntegerField(default=0)

# VoiceTranscriptions Table
class VoiceTranscription(models.Model):
    room = models.ForeignKey(Room, on_delete=models.CASCADE, related_name="voice_transcriptions")
    user = models.ForeignKey(CustomUser, on_delete=models.CASCADE, related_name="voice_transcriptions")
    audio_data = models.FileField(upload_to='voice_transcriptions/')
    transcribed_text = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)
