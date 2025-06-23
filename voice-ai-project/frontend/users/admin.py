from django.contrib import admin
from django.contrib.auth.admin import UserAdmin
from .models import CustomUser

class CustomUserAdmin(UserAdmin):
    model = CustomUser
    list_display = ["username", "email", "profile_image", "is_staff", "is_active", 'display_name']
    fieldsets = UserAdmin.fieldsets + (
        ("Profile Information", {"fields": ("profile_image", "display_name")}), # เพิ่ม display_name ด้วยก็ได้
    )
    add_fieldsets = UserAdmin.add_fieldsets + (
        ("Profile Information", {"fields": ("profile_image", "display_name")}), # เพิ่ม display_name ด้วยก็ได้
    )
    
admin.site.register(CustomUser, CustomUserAdmin)  # ✅ เพิ่ม CustomUser ใน Django Admin
