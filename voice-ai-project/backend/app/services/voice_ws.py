from fastapi import WebSocket, WebSocketDisconnect
from typing import List
import base64
import json

class ConnectionManager:
    """ จัดการ WebSocket Connection """
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    async def disconnect(self, websocket: WebSocket):
        self.active_connections.remove(websocket)

    async def broadcast(self, message: bytes, mime_type: str = "audio/webm;codecs=opus"):
        """ ส่งข้อมูลเสียงและ MIME Type ไปยังทุก Client """
        message_base64 = base64.b64encode(message).decode("utf-8")  
        data = json.dumps({"data": message_base64, "type": mime_type})

        for connection in self.active_connections:
            await connection.send_text(data)


manager = ConnectionManager()
