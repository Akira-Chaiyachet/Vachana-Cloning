from django.shortcuts import render, redirect
from django.contrib.auth import login, authenticate, logout
from django.contrib.auth.forms import AuthenticationForm
from .forms import CustomUserCreationForm
from django.http import JsonResponse
from django.contrib.auth.decorators import login_required
from django.views.decorators.http import require_POST

def register(request):
    if request.method == "POST":
        form = CustomUserCreationForm(request.POST, request.FILES)
        if form.is_valid():
            user = form.save()
            login(request, user)

            # 🔥 ตรวจสอบว่ามีคำเชิญค้างอยู่ไหม
            invite_code = request.session.pop("pending_invite", None)
            if invite_code:
                return redirect(f"/join-room/{invite_code}/")  # ✅ กลับไปที่ห้องโดยอัตโนมัติ

            return redirect("voice_chat:home")  # ✅ ถ้าไม่มีคำเชิญ ไปหน้าหลักปกติ
    else:
        form = CustomUserCreationForm()
    return render(request, "users/register.html", {"form": form})

def user_login(request):
    if request.method == "POST":
        form = AuthenticationForm(data=request.POST)
        if form.is_valid():
            user = form.get_user()
            login(request, user)

            # 🔥 ตรวจสอบว่ามีคำเชิญค้างอยู่ไหม
            invite_code = request.session.pop("pending_invite", None)
            if invite_code:
                return redirect(f"/join-room/{invite_code}/")  # ✅ กลับไปที่ห้องโดยอัตโนมัติ

            return redirect("voice_chat:home")  # ✅ ถ้าไม่มีคำเชิญ ไปหน้าหลักปกติ
    else:
        form = AuthenticationForm()
    return render(request, "users/login.html", {"form": form})

def user_logout(request):
    logout(request)
    return redirect("login")  # ✅ ออกจากระบบแล้วกลับไปหน้า Login

# ใน users/views.py
@login_required
@require_POST
def update_profile_api(request):
    user = request.user
    
    # ใช้ Django Form จะดีที่สุดสำหรับการ validation
    # แต่ถ้าดึงข้อมูลโดยตรง:
    new_display_name = request.POST.get('display_name', '').strip()
    # new_username = request.POST.get('username', user.username).strip() # เอาออกถ้าไม่ให้แก้ไข username

    form_errors = {} # เตรียม dict สำหรับเก็บ error

    if not new_display_name:
        form_errors['display_name'] = ['ชื่อที่แสดงห้ามว่าง'] # Django form errors มักจะเป็น list
    
    # (ตัวอย่าง) ถ้าอนุญาตให้เปลี่ยน username และต้องการ validate
    # if new_username:
    #     if new_username != user.username:
    #         if CustomUser.objects.filter(username=new_username).exclude(pk=user.pk).exists():
    #             form_errors['username'] = ['Username นี้ถูกใช้ไปแล้ว']
    #         else:
    #             user.username = new_username
    # else:
    #     form_errors['username'] = ['Username ห้ามว่าง']


    if form_errors: # ถ้ามี error จากการ validate ของเราเอง
        return JsonResponse({'error': form_errors}, status=400)

    user.display_name = new_display_name
    
    if 'profile_image' in request.FILES:
        # อาจจะมีการลบรูปเก่าก่อน ถ้าต้องการ
        # if user.profile_image and user.profile_image.name != default_profile_image():
        #     user.profile_image.delete(save=False)
        user.profile_image = request.FILES['profile_image']
    
    try:
        user.save() # method save ของ CustomUser ที่เรา override จะตั้ง display_name = username ถ้า display_name ว่าง (แต่ในเคสนี้เราตั้งค่าแล้ว)
        updated_user_data = {
            'username': user.username,
            'display_name': user.get_name_to_display(), # ใช้ get_name_to_display เพื่อความสอดคล้อง
            'profile_image_url': user.get_profile_image_url()
        }
        return JsonResponse({'message': 'อัปเดตโปรไฟล์สำเร็จ!', 'user': updated_user_data})
    except Exception as e: # เช่น Database error หรือ Model validation error อื่นๆ
        return JsonResponse({'error': {'__all__': [str(e)]}}, status=500)
    
@login_required # ทำให้ API นี้เรียกได้เฉพาะผู้ที่ login แล้วเท่านั้น
def get_current_user_profile_api(request):
    user = request.user # request.user คือ CustomUser instance ของผู้ใช้ที่ login อยู่

    user_data = {
        'id': user.id,
        'username': user.username,
        'email': user.email,
        'first_name': user.first_name,
        'last_name': user.last_name,
        'display_name': user.get_name_to_display(), # ใช้ method จาก model ของคุณ
        'profile_image_url': user.get_profile_image_url() # ใช้ method จาก model ของคุณ
    }
    return JsonResponse({'isAuthenticated': True, 'user': user_data})

from django.contrib.auth import update_session_auth_hash, get_user_model
from django.contrib.auth.forms import PasswordChangeForm # เราอาจจะไม่ได้ใช้โดยตรง แต่เป็นแนวทางที่ดี
from django.core.exceptions import ValidationError
from django.contrib.auth.password_validation import validate_password # สำหรับตรวจสอบความแข็งแรงของรหัสผ่านใหม่

CustomUser = get_user_model() # ดึง CustomUser model ที่คุณใช้อยู่

@login_required
@require_POST # รับเฉพาะ POST request
def change_credentials_api(request):
    user = request.user
    errors = {} # สำหรับเก็บข้อผิดพลาดของแต่ละ field
    changed_fields = [] # เก็บชื่อ field ที่มีการเปลี่ยนแปลง

    # ดึงข้อมูลจาก FormData ที่ JavaScript ส่งมา
    new_username = request.POST.get('new_username', '').strip()
    current_password = request.POST.get('current_password', '')
    new_password1 = request.POST.get('new_password1', '')
    new_password2 = request.POST.get('new_password2', '')

    # 1. ตรวจสอบ Password ปัจจุบัน (จำเป็นเสมอถ้าจะมีการเปลี่ยนแปลงข้อมูลสำคัญ)
    if not current_password:
        errors['current_password'] = ['กรุณากรอก Password ปัจจุบันของคุณเพื่อยืนยัน']
    elif not user.check_password(current_password):
        errors['current_password'] = ['Password ปัจจุบันไม่ถูกต้อง']
    
    # ถ้า Password ปัจจุบันที่ใช้ยืนยันตัวตนผิด ก็ไม่ต้องดำเนินการใดๆ ต่อ
    if 'current_password' in errors:
        return JsonResponse({'error': errors}, status=400)

    # 2. จัดการการเปลี่ยนแปลง Username (ถ้ามีการกรอก new_username)
    if new_username: # ถ้ามีการส่ง new_username มา
        if new_username == user.username:
            # ไม่มีการเปลี่ยนแปลง username จริง
            pass 
        elif len(new_username) < 3: # ตัวอย่าง validation: ความยาวขั้นต่ำ
            errors.setdefault('new_username', []).append('Username ใหม่ต้องมีอย่างน้อย 3 ตัวอักษร')
        elif CustomUser.objects.filter(username=new_username).exclude(pk=user.pk).exists():
            errors.setdefault('new_username', []).append('Username นี้ถูกใช้งานแล้ว กรุณาใช้ชื่ออื่น')
        else:
            # ถ้าผ่าน validation ทั้งหมด
            user.username = new_username
            changed_fields.append('username')
            # เมื่อเปลี่ยน username, display_name ที่เคยเป็น username เดิม อาจจะต้องพิจารณาว่าจะอัปเดตด้วยหรือไม่
            # หรือปล่อยให้ผู้ใช้ไปแก้ไข display_name เองอีกที (ปัจจุบัน model ของคุณจะตั้ง display_name = username เมื่อสร้าง user ใหม่เท่านั้น)

    # 3. จัดการการเปลี่ยนแปลง Password (ถ้ามีการกรอก new_password1)
    if new_password1: # ถ้าผู้ใช้พยายามจะเปลี่ยน password
        if not new_password2:
            errors.setdefault('new_password2', []).append('กรุณายืนยัน Password ใหม่')
        elif new_password1 != new_password2:
            errors.setdefault('new_password2', []).append('Password ใหม่ และการยืนยัน Password ไม่ตรงกัน')
        else:
            try:
                # ใช้ Django built-in password validation เพื่อตรวจสอบความแข็งแรงของ password
                validate_password(new_password1, user=user)
                user.set_password(new_password1) # ทำการ hash password ใหม่อย่างปลอดภัย
                changed_fields.append('password')
            except ValidationError as e:
                errors.setdefault('new_password1', list(e.messages)) # เก็บ error messages จาก validator
    elif new_password2 and not new_password1: # กรอกแค่ยืนยัน แต่ไม่กรอก password ใหม่
         errors.setdefault('new_password1', []).append('กรุณากรอก Password ใหม่ด้วย')


    # ถ้ามี error จากการ validate username ใหม่ หรือ password ใหม่
    if errors:
        return JsonResponse({'error': errors}, status=400)

    # ถ้าไม่มีการเปลี่ยนแปลงใดๆ เลย (ไม่ได้กรอก username ใหม่ และไม่ได้กรอก password ใหม่)
    if not changed_fields:
        # ถึงแม้จะกรอก current_password ถูกต้อง แต่ถ้าไม่ได้จะเปลี่ยนอะไร ก็แจ้งกลับไป
        return JsonResponse({'message': 'ไม่มีข้อมูล Username หรือ Password ที่ถูกเปลี่ยนแปลง', 'no_changes': True})

    # บันทึกการเปลี่ยนแปลงทั้งหมดลงฐานข้อมูล
    try:
        user.save() # บันทึก field ที่เปลี่ยน (เช่น username)
        
        # ถ้ามีการเปลี่ยน password ให้อัปเดต session เพื่อไม่ให้ผู้ใช้หลุดออกจากระบบ
        if 'password' in changed_fields:
            update_session_auth_hash(request, user)
        
        # ส่งข้อมูลผู้ใช้ที่อัปเดตแล้วบางส่วนกลับไป (ถ้าต้องการ)
        updated_user_data = {
            'username': user.username,
            'display_name': user.get_name_to_display(), 
        }
        return JsonResponse({'message': 'ข้อมูล Username และ/หรือ Password อัปเดตสำเร็จ!', 'user': updated_user_data})
        
    except Exception as e:
        # จัดการ error ที่อาจจะเกิดขึ้นตอน save (เช่น database error)
        return JsonResponse({'error': {'__all__': [str(e)]}}, status=500) # '__all__' สำหรับ general form error