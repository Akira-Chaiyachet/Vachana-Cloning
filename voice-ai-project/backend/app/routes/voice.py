from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from app.services.voice_ws import manager  # ต้องมีไฟล์นี้

router = APIRouter()

@router.websocket("/ws/voice")
async def websocket_endpoint(websocket: WebSocket):
    """ WebSocket API สำหรับรับและส่งเสียงแบบ Real-time """
    await manager.connect(websocket)
    try:
        while True:
            message = await websocket.receive_bytes()
            mime_type = "audio/webm;codecs=opus"
            await manager.broadcast(message, mime_type)
    except WebSocketDisconnect:
        await manager.disconnect(websocket)


