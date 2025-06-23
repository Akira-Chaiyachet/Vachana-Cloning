import json
from channels.generic.websocket import AsyncWebsocketConsumer # type: ignore

class RoomConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        """ เรียกใช้เมื่อผู้ใช้เชื่อมต่อ WebSocket """
        self.room_group_name = f"room_{self.scope['url_route']['kwargs']['room_id']}"
        self.username = self.scope["user"].username  # เก็บชื่อ user

        # ✅ ตรวจสอบและกำหนดค่า room_members
        if not hasattr(self, "room_members"):
            self.room_members = set()

        # ✅ เพิ่มผู้ใช้เข้า room_members
        self.room_members.add(self.username)

        # ✅ เข้าร่วมห้อง WebSocket
        await self.channel_layer.group_add(self.room_group_name, self.channel_name)
        await self.accept()

        # ✅ แจ้งทุกคนในห้อง (ยกเว้นตัวเอง) ให้รู้ว่ามี user ใหม่เข้า
        await self.channel_layer.group_send(
            self.room_group_name,
            {
                "type": "update_members",
                "members": list(self.room_members),  # ✅ ส่งสมาชิกทั้งหมด
            },
        )

    async def disconnect(self, close_code):
        user = self.scope.get("user", None)

        if user and user.is_authenticated:
            username = user.username
            if hasattr(self, "room_members") and username in self.room_members:
                self.room_members.remove(username)

            print(f"❌ {username} ออกจากห้อง {self.room_group_name}, สมาชิกเหลือ: {self.room_members}")  # ✅ Debug

            # แจ้งทุกคนให้อัปเดตรายชื่อ
            await self.channel_layer.group_send(
                self.room_group_name,
                {
                    "type": "update_members",
                    "members": list(self.room_members),
                    "left_user": username,  # แจ้งว่าใครออก
                }
            )

        await self.close()


    async def receive(self, text_data):
        """ เมื่อได้รับข้อความจาก Client """
        data = json.loads(text_data)
        action = data.get("action")

        if action == "send_message":
            # ✅ ส่งข้อความไปยังทุกคนในห้อง
            await self.channel_layer.group_send(
                self.room_group_name,
                {
                    "type": "room_message",
                    "message": data.get("message"),
                    "username": data.get("username"),
                },
            )

    async def room_message(self, event):
        """ ส่งข้อความไปยัง Client ที่อยู่ในห้อง """
        await self.send(text_data=json.dumps({
            "type": "chat",
            "message": event["message"],
            "username": event["username"]
        }))

    async def update_members(self, event):
        """ ส่งอัปเดตรายชื่อสมาชิกให้ทุกคนในห้อง """
        await self.send(text_data=json.dumps({
            "type": "update_members",
            "members": event.get("members", [])
        }))


    async def user_join(self, event):
        """ แจ้งเมื่อมีผู้ใช้เข้าร่วมห้อง """
        username = event.get("username", "Unknown")

        if not hasattr(self, "room_members"):
            self.room_members = set()

        # ✅ เพิ่มผู้ใช้เข้า set
        self.room_members.add(username)
        print(f"📢 {username} เข้าห้อง {self.room_group_name}, สมาชิกทั้งหมด: {self.room_members}")  # ✅ Debug

        # ✅ แจ้งทุกคนในห้องให้อัปเดต
        await self.channel_layer.group_send(self.room_group_name, {
            "type": "update_members",
            "members": list(self.room_members),
            "new_user": username,  
        })
                