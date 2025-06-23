import asyncio
import websockets
import json

async def send_message():
    uri = "ws://localhost:8000/ws/room/testroom/"
    async with websockets.connect(uri) as ws:
        print("✅ Connected to WebSocket!")

        # ✅ รอรับข้อความจาก Server ก่อนส่ง
        try:
            response = await ws.recv()
            print("📩 Server response:", response)
        except websockets.exceptions.ConnectionClosed:
            print("❌ Connection closed before receiving response.")
            return  # ออกจากฟังก์ชันทันที

        message = {"username": "testuser", "message": "Hello, WebSocket!"}
        await ws.send(json.dumps(message))
        print("📨 Sent message:", message)

        # ✅ รอรับ response จาก Server
        response = await ws.recv()
        print("📩 Received response:", response)

asyncio.run(send_message())
