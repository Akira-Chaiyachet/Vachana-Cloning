from django import forms # type: ignore
from .models import Room, RoomRole ,RoomMember,Message,Reaction,Invitation,InviteLink,VoiceTranscription

class RoomCreationForm(forms.ModelForm):
    class Meta:
        model = Room
        fields = ['name', 'image']