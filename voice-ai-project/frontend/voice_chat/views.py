from django.shortcuts import render, get_object_or_404  # type: ignore
from django.http import JsonResponse  # type: ignore
from django.views.decorators.http import require_POST # type: ignore
from .models import Room, RoomParticipant, RoomRole, Message
from django.contrib.auth.decorators import login_required  # type: ignore
from django.utils.timezone import localtime  # type: ignore
from django.core.files.base import ContentFile  # type: ignore
from channels.layers import get_channel_layer # type: ignore
from asgiref.sync import async_to_sync # type: ignore
from django.shortcuts import redirect  # type: ignore
import os # For file operations


@login_required
def home_view(request):
    return render(request, "voice_chat/index.html")  # ✅ หน้า Home


@login_required
def create_room(request):
    if request.method == "POST":
        name = request.POST.get("name", "").strip()
        image = request.FILES.get("image")  # ดึงไฟล์ที่อัปโหลดมา

        if not name:
            return JsonResponse({"error": "กรุณาใส่ชื่อห้อง"}, status=400)
        if Room.objects.filter(name=name).exists():
            return JsonResponse({"error": "ชื่อห้องนี้ถูกใช้แล้ว"}, status=400)

        # สร้างห้อง (ยังไม่บันทึกลง DB ทันที)
        room = Room.objects.create(
            name=name,
            owner=request.user,
        )

        # หากมีการอัปโหลดรูปภาพ ให้บันทึกลง storage
        # room.image.save() จะทำการบันทึก instance ของ Room ด้วย
        if image:
            room.image.save(
                f"room_images/{room.id}_{image.name}", ContentFile(image.read()))
        # หากไม่มี image, default image จะถูกใช้โดยอัตโนมัติเมื่อ room ถูกสร้าง
        # ไม่จำเป็นต้องเรียก room.save() อีกครั้งที่นี่ เพราะ Room.objects.create() ได้บันทึกไปแล้ว

        # กำหนดให้ owner มีบทบาทเป็น "เจ้าของห้อง"
        owner_role = RoomRole.objects.create(
            room=room, role_name="Owner", permissions="all")
        RoomParticipant.objects.create(
            room=room, user=request.user, role=owner_role)

        return JsonResponse({"room_id": room.id, "room_name": room.name, "image_url": room.image.url})


@login_required
def send_message(request, room_id):
    room = get_object_or_404(Room, id=room_id)
    content = request.POST.get("content", "").strip()

    if not content:
        return JsonResponse({"error": "ไม่สามารถส่งข้อความว่างเปล่าได้"}, status=400)

    if not RoomParticipant.objects.filter(room=room, user=request.user).exists():
        return JsonResponse({"error": "คุณไม่ได้เป็นสมาชิกของห้องนี้"}, status=403)

    message = Message.objects.create(
        room=room, user=request.user, content=content)

    return JsonResponse({
        "message": message.content,
        "sent_at": localtime(message.created_at).strftime("%Y-%m-%d %H:%M:%S"),
        "username": message.user.username
    })


@login_required
def get_rooms(request):
    # ดึงเฉพาะห้องที่ user เป็นสมาชิกอยู่
    user_rooms = Room.objects.filter(members__user=request.user).distinct()

    rooms_data = [
        {
            "id": room.id,
            "name": room.name,
            "image_url": room.image.url if room.image else "/media/default/room.jpg",
            "invite_code": room.invite_code,  # ✅ เพิ่มให้แน่ใจว่าโค้ดถูกส่งมา
        }
        for room in user_rooms
    ]

    return JsonResponse({"rooms": rooms_data})


@login_required
def leave_room(request, room_id):
    room = get_object_or_404(Room, id=room_id)

    # ตรวจสอบว่าผู้ใช้เป็นสมาชิกของห้องนี้หรือไม่
    participant = RoomParticipant.objects.filter(
        room=room, user=request.user).first()
    if not participant:
        return JsonResponse({"success": False, "message": "คุณไม่ได้อยู่ในห้องนี้"})

    # ลบการเป็นสมาชิกของห้องออก
    participant.delete()

    return JsonResponse({"success": True, "message": "ออกจากห้องเรียบร้อยแล้ว!"})


@login_required
def get_room_members(request, room_id):
    room = get_object_or_404(Room, id=room_id)
    # participants = RoomParticipant.objects.filter(room=room).select_related("user", "role") # ใช้ participants แทน members เพื่อความชัดเจน
    # หรือจะใช้ชื่อ members เหมือนเดิมก็ได้ครับ
    
    room_participants = RoomParticipant.objects.filter(room=room).select_related("user", "role") # เปลี่ยนชื่อตัวแปร

    members_data = [
        {
            "id": participant.user.id,
            "username": participant.user.username, # คุณอาจจะยังต้องการ username ไว้สำหรับอ้างอิงภายใน
            "name_to_display": participant.user.get_name_to_display(), # <<< เพิ่มบรรทัดนี้
            "profile_image": participant.user.get_profile_image_url(),
            "role": participant.role.role_name if participant.role else "Member",
        }
        for participant in room_participants # เปลี่ยน member เป็น participant
    ]

    return JsonResponse({"members": members_data})

@login_required
def search_room(request, invite_code):
    room = Room.objects.filter(invite_code=invite_code).first()
    if not room:
        return JsonResponse({"error": "ไม่พบห้องนี้"}, status=404)

    return JsonResponse({
        "room_name": room.name,
        "room_image": room.image.url if room.image else "/media/default/room.jpg",
    })


@login_required
def redirect_home_with_invite(request, invite_code):

    room = Room.objects.filter(invite_code=invite_code).first()
    if not room:
        return JsonResponse({"error": "ไม่พบห้องนี้"}, status=404)

    return JsonResponse({
        "room_name": room.name,
        "room_image": room.image.url if room.image else "/media/default/room.jpg",
    })


@login_required
def update_room_members(room_id):
    members = get_room_members(room_id)  # ดึงข้อมูลสมาชิก

    channel_layer = get_channel_layer()
    async_to_sync(channel_layer.group_send)(
        f"chatroom_{room_id}",
        {
            "type": "send_update",
            "members": members,
        }
    )

def check_auth(request):
    return JsonResponse({"isAuthenticated": request.user.is_authenticated})

@login_required
def get_room_link(request, invite_code):
    try:
        room = Room.objects.get(invite_code=invite_code)
        return JsonResponse({"success": True, "room_name": room.name, "room_image": room.image.url})
    except Room.DoesNotExist:
        return JsonResponse({"error": "Room not found"}, status=404)

@login_required
def join_room_by_invite(request, invite_code):
    if request.method != "POST":
        return JsonResponse({"error": "ต้องใช้คำขอแบบ POST"}, status=400)

    room = get_object_or_404(Room, invite_code=invite_code)

    # ตรวจสอบว่าสมาชิกอยู่ในห้องแล้วหรือไม่
    if RoomParticipant.objects.filter(room=room, user=request.user).exists():
        return JsonResponse({"message": "คุณอยู่ในห้องนี้แล้ว"})

    # ค้นหา Role เริ่มต้น
    default_role, created = RoomRole.objects.get_or_create(
        room=room, role_name="Member", defaults={"permissions": "read,write"}
    )

    # เพิ่มสมาชิกเข้าไปในห้อง
    RoomParticipant.objects.create(
        room=room, user=request.user, role=default_role)

    return JsonResponse({
        "success": True,
        "message": f"เข้าร่วมห้อง {room.name} สำเร็จ",
        "roomId": room.id  # ✅ เพิ่ม roomId ใน response
    })

@login_required
def join_room_redirect(request, invite_code):
    if not invite_code:
        return redirect("/")

    # ตรวจสอบว่ามีห้องที่ใช้ invite_code นี้จริงหรือไม่ ถ้าไม่จะ 404
    # ไม่จำเป็นต้องดึง object room เต็มๆ ถ้าไม่ได้ใช้ข้อมูลอื่นจาก room ในขั้นตอนนี้
    # แค่เช็คว่า exist ก็พอ หรือจะ get_object_or_404 เพื่อให้แน่ใจว่าห้องมีจริงก็ได้
    get_object_or_404(Room, invite_code=invite_code)

    # Redirect ไปหน้าแรกพร้อม invite_code เพื่อให้ JavaScript ฝั่ง client จัดการต่อ
    # JavaScript จะเป็นคนแสดง popup และถ้าผู้ใช้กดยืนยัน ค่อยยิง API (POST /api/join-room/) มาอีกที
    return redirect(f"/?invite={invite_code}")


@login_required
def get_room_details(request, room_id):
    """
    API Endpoint สำหรับดึงข้อมูลรายละเอียดของห้องเดียว
    """
    room = get_object_or_404(Room, id=room_id)

    # คุณอาจเพิ่มการตรวจสอบสิทธิ์ที่นี่ เช่น เฉพาะสมาชิกหรือเจ้าของห้องเท่านั้นที่ดูได้
    # if not RoomParticipant.objects.filter(room=room, user=request.user).exists() and room.owner != request.user:
    #     return JsonResponse({"error": "คุณไม่มีสิทธิ์เข้าถึงข้อมูลห้องนี้"}, status=403)

    return JsonResponse({
        "id": room.id,
        "name": room.name,
        "image_url": room.image.url if room.image else "/media/default/room.jpg",
        "invite_code": room.invite_code, # อาจไม่จำเป็นต้องส่ง invite_code ถ้าไม่ได้ใช้
    })


@login_required
@require_POST # ตรวจสอบให้แน่ใจว่าเป็น POST request เท่านั้น
def update_room_profile(request, room_id):
    """
    API Endpoint สำหรับอัปเดตชื่อและรูปภาพโปรไฟล์ของห้อง
    """
    room = get_object_or_404(Room, id=room_id)

    # ตรวจสอบสิทธิ์: เฉพาะเจ้าของห้องเท่านั้นที่สามารถแก้ไขโปรไฟล์ห้องได้
    if room.owner != request.user:
        return JsonResponse({"error": "คุณไม่มีสิทธิ์แก้ไขโปรไฟล์ห้องนี้"}, status=403) # Forbidden

    new_name = request.POST.get("name", "").strip()
    new_image = request.FILES.get("image")

    errors = {}

    # ตรวจสอบความถูกต้องของชื่อห้อง
    if not new_name:
        errors["name"] = ["ชื่อห้องไม่สามารถเว้นว่างได้"]
    # ตรวจสอบว่าชื่อห้องใหม่ไม่ซ้ำกับห้องอื่น (ยกเว้นห้องตัวเอง)
    elif new_name != room.name and Room.objects.filter(name=new_name).exclude(id=room.id).exists():
        errors["name"] = ["ชื่อห้องนี้ถูกใช้แล้ว"]

    if errors:
        # ส่งคืนข้อผิดพลาดในรูปแบบที่ frontend คาดหวัง
        return JsonResponse({"error": errors}, status=400) # Bad Request

    # อัปเดตชื่อห้องหากมีการเปลี่ยนแปลง
    if new_name and new_name != room.name:
        room.name = new_name

    # อัปเดตรูปภาพห้องหากมีการอัปโหลดรูปภาพใหม่
    if new_image:
        # ลบรูปภาพเก่าออกจาก storage หากไม่ใช่รูปภาพ default
        # และไฟล์นั้นมีอยู่จริงบนระบบไฟล์
        if room.image and room.image.name != 'default/room.jpg':
            old_image_path = room.image.path
            if os.path.exists(old_image_path):
                try:
                    os.remove(old_image_path)
                except OSError as e:
                    print(f"Error deleting old room image {old_image_path}: {e}")
        
        # บันทึกรูปภาพใหม่
        room.image.save(f"room_images/{room.id}_{new_image.name}", ContentFile(new_image.read()))
    
    # บันทึกการเปลี่ยนแปลงทั้งหมดลงในฐานข้อมูล
    room.save()

    return JsonResponse({
        "message": "อัปเดตโปรไฟล์ห้องสำเร็จ!",
        "room_id": room.id,
        "room_name": room.name,
        "image_url": room.image.url # ส่ง URL ของรูปภาพใหม่กลับไปด้วย
    })