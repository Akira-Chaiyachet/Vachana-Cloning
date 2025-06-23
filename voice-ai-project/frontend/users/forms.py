from django import forms
from django.contrib.auth.forms import UserCreationForm
from .models import CustomUser

class CustomUserCreationForm(UserCreationForm):
    profile_image = forms.ImageField(required=False, widget=forms.ClearableFileInput(attrs={"accept": "image/*"}))

    class Meta:
        model = CustomUser
        fields = ["username", "password1", "password2", "profile_image"]

    def save(self, commit=True):
        user = super().save(commit=False)
        if self.cleaned_data.get("profile_image"):
            user.profile_image = self.cleaned_data["profile_image"]
        if commit:
            user.save()
        return user