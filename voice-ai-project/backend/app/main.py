from fastapi import FastAPI, WebSocket, WebSocketDisconnect
import json
import base64

app = FastAPI()

connected_users = {}

@app.websocket("/ws/voice")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    user_id = str(id(websocket))
    connected_users[user_id] = websocket

    try:
        while True:
            message = await websocket.receive_bytes()
            encoded_audio = base64.b64encode(message).decode("utf-8")

            for uid, ws in connected_users.items():
                if uid != user_id:  # ไม่ต้องส่งเสียงตัวเองกลับมา
                    await ws.send_text(json.dumps({"type": "audio", "user": user_id, "audio": encoded_audio}))
    except WebSocketDisconnect:
        del connected_users[user_id]
