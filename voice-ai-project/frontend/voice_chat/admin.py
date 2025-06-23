from django.contrib import admin # type: ignore
from .models import Room, RoomRole, RoomParticipant, Message, Reaction, Invitation, InviteLink, VoiceTranscription

admin.site.register(Room)
admin.site.register(RoomRole)
admin.site.register(RoomParticipant)
admin.site.register(Message)
admin.site.register(Reaction)
admin.site.register(Invitation)
admin.site.register(InviteLink)
admin.site.register(VoiceTranscription)
