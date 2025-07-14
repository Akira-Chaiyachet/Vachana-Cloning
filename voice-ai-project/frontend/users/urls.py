from django.urls import path
from django.contrib.auth.views import LogoutView
from .views import register, user_login, user_logout ,update_profile_api ,get_current_user_profile_api , change_credentials_api, set_status_api
urlpatterns = [
    path("register/", register, name="register"),
    path("login/", user_login, name="login"),
    path("logout/", user_logout, name="logout"),
    path("api/update-profile/",update_profile_api ,name='api_update_profile'),
    path("api/profile/me/", get_current_user_profile_api, name='api_get_current_user_profile'),
    path('api/change-credentials/', change_credentials_api, name='api_change_credentials'),
    path('api/set-status/', set_status_api, name='api_set_status'),
]
