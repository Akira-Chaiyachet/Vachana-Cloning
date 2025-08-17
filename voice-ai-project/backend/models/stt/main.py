from fastapi import FastAPI, File, UploadFile, Form
from faster_whisper import WhisperModel
import tempfile
import os

app = FastAPI()

# โหลดโมเดลครั้งเดียว (แนะนำขนาด medium/small ขึ้นกับ GPU)
WHISPER_MODEL_NAME = os.getenv("WHISPER_MODEL_NAME", "medium")
model = WhisperModel(WHISPER_MODEL_NAME, device="cuda", compute_type="float16")

@app.get("/health")
async def health():
    return {"ok": True, "model": WHISPER_MODEL_NAME}

@app.post("/stt")
async def stt_transcribe(
    file: UploadFile = File(...),
    language: str = Form("auto")
):
    with tempfile.NamedTemporaryFile(delete=True, suffix=".wav") as tmp:
        contents = await file.read()
        tmp.write(contents)
        tmp.flush()
        lang_arg = None if (language == "auto" or not language) else language
        segments, info = model.transcribe(tmp.name, language=lang_arg)
        text = " ".join([seg.text for seg in segments]).strip()
    # info.language คือรหัสภาษา 2 ตัว เช่น "en", "ja", "zh", "th"
    return {"text": text, "detected_lang": getattr(info, "language", None)}

