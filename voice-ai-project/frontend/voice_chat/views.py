from django.shortcuts import render, get_object_or_404  # type: ignore
from django.http import JsonResponse
from django.views.decorators.http import require_POST
from django.views.decorators.csrf import csrf_exempt
from .models import Room, RoomParticipant, RoomRole, Message 
from django.contrib.auth.decorators import login_required  # type: ignore
from django.utils.timezone import localtime
from django.utils import timezone
from django.core.files.base import ContentFile  # type: ignore
from channels.layers import get_channel_layer
from asgiref.sync import async_to_sync
from django.shortcuts import redirect  # type: ignore
import os # For file operations
from users.models import CustomUser # For getting user objects
import json


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
        # อนุญาตให้ชื่อห้องซ้ำกันได้ ไม่ต้องเช็คซ้ำ

        # 1. สร้าง instance ของ Room แต่ยังไม่บันทึกลง DB
        room = Room(
            name=name,
            owner=request.user,
        )

        # 2. กำหนดค่า image ถ้ามี
        if image:
            room.image = image

        # 3. บันทึก instance ลง DB เพียงครั้งเดียว
        # การเรียก .save() ที่นี่จะไป trigger custom save() ใน model
        # ซึ่งจะสร้าง invite_code และบันทึกไฟล์รูปภาพให้โดยอัตโนมัติ
        room.save()
        
        # กำหนดให้ owner มีบทบาทเป็น "เจ้าของห้อง"
        owner_role = RoomRole.objects.create(
            room=room, 
            role_name="owner", # ใช้ตัวพิมพ์เล็กให้ตรงกับ choices ใน model
            permissions={ # ตัวอย่าง permissions
                "can_delete_room": True,
                "can_edit_room": True,
                "can_assign_roles": True,
                "can_kick_members": True
            }
        )
        RoomParticipant.objects.create(
            room=room, user=request.user, role=owner_role)

        return JsonResponse({
            "room_id": room.id, 
            "room_name": room.name, 
            "image_url": room.image.url,
            "invite_code": room.invite_code # เพิ่ม invite_code ในการตอบกลับ
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
            "invite_code": room.invite_code or "",  # ✅ แปลงค่า None เป็นสตริงว่าง
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

    # ✅ ลบการเป็นสมาชิกของห้องออก (ถูกต้องแล้ว)
    # การแจ้งเตือนจะเกิดขึ้นโดยอัตโนมัติเมื่อ WebSocket ของผู้ใช้คนนี้ disconnect
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
            "username": participant.user.username,
            "name_to_display": participant.user.get_name_to_display(),
            "profile_image": participant.user.get_profile_image_url(),
            "status": getattr(participant.user, "status", "online"),
            "role": participant.role.role_name if participant.role else "member",
        }
        for participant in room_participants
    ]

    # เรียงลำดับ: online > dnd > invisible
    status_order = {"online": 0, "dnd": 1, "invisible": 2}
    members_data.sort(key=lambda member: status_order.get(member["status"], 3))

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
        room=room, 
        role_name="member", # ใช้ตัวพิมพ์เล็กให้ตรงกับ choices ใน model
        defaults={"permissions": {
            "can_edit_room": False,
            "can_assign_roles": False
        }}
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

@login_required
@require_POST
def assign_role_api(request, room_id):
    """
    API to assign a new role to a user in a room.
    Roles: owner, admin, family, member
    """
    try:
        # 1. Get data from request
        target_user_id = int(request.POST.get('user_id'))
        new_role_name = request.POST.get('role_name')

        if new_role_name not in ['admin', 'family', 'member']:
            return JsonResponse({"error": "สถานะที่เลือกไม่ถูกต้อง"}, status=400)

        # 2. Get objects from DB
        room = get_object_or_404(Room, id=room_id)
        actor = get_object_or_404(RoomParticipant, room=room, user=request.user)
        target_user = get_object_or_404(CustomUser, id=target_user_id)
        target = get_object_or_404(RoomParticipant, room=room, user=target_user)

        # 3. Permission Checks
        # Only Owner or Admin can assign roles
        if actor.role.role_name not in ['owner', 'admin']:
            return JsonResponse({"error": "คุณไม่มีสิทธิ์มอบสถานะให้ผู้อื่น"}, status=403)

        # Cannot change your own role
        if actor.user.id == target.user.id:
            return JsonResponse({"error": "คุณไม่สามารถเปลี่ยนสถานะของตัวเองได้"}, status=400)

        # Cannot change Owner's role
        if target.role.role_name == 'owner':
            return JsonResponse({"error": "ไม่สามารถเปลี่ยนสถานะของเจ้าของห้องได้"}, status=403)
        
        # Admin cannot assign 'admin' or 'owner' roles
        if actor.role.role_name == 'admin' and new_role_name in ['admin', 'owner']:
             return JsonResponse({"error": "แอดมินไม่สามารถมอบสถานะที่สูงกว่าหรือเท่ากับตัวเองได้"}, status=403)

        # 4. Find or create the new role for this specific room
        new_role, created = RoomRole.objects.get_or_create(room=room, role_name=new_role_name)

        # 5. Assign the new role
        target.role = new_role
        target.save(update_fields=['role'])

        # 6. Broadcast the change via WebSocket
        channel_layer = get_channel_layer()
        async_to_sync(channel_layer.group_send)(
            f'room_{room.id}',
            {
                'type': 'role_changed',
                'user_id': target.user.id,
                'new_role': new_role.role_name,
            }
        )

        return JsonResponse({"success": True, "message": f"เปลี่ยนสถานะของ {target.user.get_name_to_display()} เป็น {new_role.get_role_name_display()} สำเร็จ"})

    except (RoomParticipant.DoesNotExist, CustomUser.DoesNotExist, Room.DoesNotExist):
        return JsonResponse({"error": "ไม่พบผู้ใช้หรือห้อง"}, status=404)
    except (ValueError, TypeError):
        return JsonResponse({"error": "ข้อมูลที่ส่งมาไม่ถูกต้อง"}, status=400)

@login_required
def get_chat_messages(request, room_id):
    """
    API Endpoint to fetch the chat history for a specific room.
    """
    messages = Message.objects.filter(room_id=room_id).order_by('created_at').select_related('user')
    data = []
    for msg in messages:
        data.append({
            'id': msg.id,
            'user': {
                'id': msg.user.id,
                'display_name': msg.user.get_name_to_display(),
                'profile_image_url': msg.user.get_profile_image_url(),
            },
            'content': msg.content,
            'created_at': msg.created_at.strftime('%Y-%m-%d %H:%M:%S'),
        })
    return JsonResponse({'messages': data}, safe=False)

@csrf_exempt
@login_required
def send_message(request, room_id):
    """
    API Endpoint to send a message to a room.
    The message is saved and then broadcasted via WebSocket.
    """
    if request.method == 'POST':
        data = json.loads(request.body)
        content = data.get('content', '').strip()
        if not content:
            return JsonResponse({'error': 'Empty message'}, status=400)
        room = Room.objects.get(id=room_id)
        msg = Message.objects.create(
            room=room,
            user=request.user,
            content=content,
            created_at=timezone.now()
        )
        # Broadcast ไปยัง group ของห้องนี้
        channel_layer = get_channel_layer() # type: ignore
        async_to_sync(channel_layer.group_send)(
            f'room_{room_id}',
            {
                'type': 'chat_message',
                'message': {
                    'id': msg.id,
                    'user': {
                        'id': request.user.id,
                        'display_name': request.user.get_name_to_display(),
                        'profile_image_url': request.user.get_profile_image_url(),
                    },
                    'content': msg.content,
                    'created_at': msg.created_at.strftime('%Y-%m-%d %H:%M:%S'),
                }
            }
        )
        # ไม่ต้องส่งข้อมูลข้อความกลับไปใน HTTP response
        # เพราะ client จะได้รับข้อความผ่าน WebSocket อยู่แล้ว
        # การส่งกลับไปจะทำให้ข้อความแสดงผลซ้ำ
        return JsonResponse({'status': 'success', 'message': 'Message sent'}, status=201)
    return JsonResponse({'error': 'Invalid method'}, status=405)