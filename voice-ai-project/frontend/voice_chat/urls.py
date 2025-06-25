from django.urls import path # type: ignore
from django.shortcuts import redirect # type: ignore
from . import views
app_name = "voice_chat"


urlpatterns = [
    path("", views.home_view, name="home"),  # ✅ หน้า Home
    path('create-room/', views.create_room, name='create_room'),
    path('join-room/<str:invite_code>/', views.join_room_redirect, name='join_room_redirect'),
    path('api/join-room/<str:invite_code>/', views.join_room_by_invite, name='join_room_api'),
    path("api/check-auth/", views.check_auth, name="check_auth"),
    path("get-rooms/", views.get_rooms, name="get_rooms"),
    path("get-room-members/<int:room_id>/", views.get_room_members, name="get_room_members"),
    path('send-message/<int:room_id>/', views.send_message, name='send_message'),
    path("leave-room/<int:room_id>/", views.leave_room, name="leave_room"),
    path("api/search-room/<str:invite_code>/", views.search_room, name="search-room"),
    path("api/get-room-link/<str:invite_code>/", views.get_room_link, name="get_room_link"),
    path('rooms/api/update-room-profile/<int:room_id>/', views.update_room_profile, name='update_room_profile'),
    path('rooms/api/room-details/<int:room_id>/', views.get_room_details, name='get_room_details'),
]
