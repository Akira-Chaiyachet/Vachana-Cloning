# backend/models/tts/main.py
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from TTS.api import TTS
import torch, os, hashlib, pathlib, tempfile, asyncio

# --- (Coqui XTTS pickling fix เหมือนเดิม) ---
from TTS.tts.configs.xtts_config import XttsConfig
from TTS.tts.models.xtts import XttsAudioConfig, XttsArgs
from TTS.config.shared_configs import BaseDatasetConfig
torch.serialization.add_safe_globals([XttsConfig, XttsAudioConfig, XttsArgs, BaseDatasetConfig])

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], allow_credentials=True,
    allow_methods=["*"], allow_headers=["*"],
)

MODEL_NAME = os.getenv("XTTS_MODEL", "tts_models/multilingual/multi-dataset/xtts_v2")
DEFAULT_SPEAKER_WAV = os.getenv("DEFAULT_SPEAKER_WAV", "/app/assets/default_speaker.wav")
CACHE_DIR = "/tmp/tts_spk_cache"  # cache ไฟล์ speaker_url
os.makedirs(CACHE_DIR, exist_ok=True)

# ---- โหลดโมเดลครั้งเดียว ----
tts = TTS(MODEL_NAME)
try:
    tts.to("cuda")
except Exception:
    # ไม่มี GPU ก็ใช้ CPU ได้
    pass

# ---- ภาษาที่ XTTS รองรับ + mapping ----
# XTTS_LANGS = {'en','es','fr','de','it','pt','pl','tr','ru','nl','cs','ar','zh-cn','hu','ko','ja','hi','th'}  # ถ้าโมเดลคุณรองรับ th ให้ใส่ด้วย
XTTS_LANGS = {'en','es','fr','de','it','pt','pl','tr','ru','nl','cs','ar','zh-cn','hu','ko','ja','hi'}
def map_lang(code: str) -> str:
    code = (code or "").lower()
    # normalize จีน/ญี่ปุ่น/เกาหลี
    if code in ("zh","zh-hans","zh_cn","cn"): return "zh-cn"
    if code.startswith("ja"): return "ja"
    if code.startswith("ko"): return "ko"
    if code in XTTS_LANGS: 
        return code
    return code or "en"


def _md5(s: str) -> str:
    return hashlib.md5(s.encode("utf-8", "ignore")).hexdigest()

async def _download_speaker_to_cache(url: str) -> str:
    """
    ดึงไฟล์ speaker จาก URL (เช่น https://<host>/media/voices/u123.wav หรือ http://web:8000/media/...)
    แล้วเก็บลง cache ตาม md5 เพื่อ reuse ครั้งต่อไป
    """
    import httpx
    key = _md5(url)
    dst = os.path.join(CACHE_DIR, f"{key}.wav")
    if os.path.exists(dst) and os.path.getsize(dst) > 44:  # มี header WAV อย่างน้อย
        return dst

    timeout = httpx.Timeout(connect=5.0, read=30.0, write=10.0, pool=5.0)
    async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
        r = await client.get(url)
        r.raise_for_status()
        tmp = dst + ".part"
        with open(tmp, "wb") as f:
            f.write(r.content)
        os.replace(tmp, dst)
    return dst

def _safe_warmup():
    try:
        out_path = "/tmp/_warmup.wav"
        txt = "hello"
        if os.path.exists(DEFAULT_SPEAKER_WAV):
            tts.tts_to_file(text=txt, file_path=out_path, language="en", speaker_wav=DEFAULT_SPEAKER_WAV)
        else:
            tts.tts_to_file(text=txt, file_path=out_path, language="en")
    except Exception:
        pass

_safe_warmup()

@app.get("/health")
def health():
    return {
        "ok": True,
        "model": MODEL_NAME,
        "has_default_speaker": os.path.exists(DEFAULT_SPEAKER_WAV)
    }

@app.post("/tts")
async def tts_api(
    text: str = Form(...),
    language: str = Form("en"),
    # 1) ผู้ใช้ส่งไฟล์อ้างอิงเสียงมาเป็น multipart
    speaker_wav: UploadFile | None = File(None),
    # 2) หรือส่งลิงก์ไฟล์เสียง (ในเครือข่าย docker แนะนำใช้ http://web:8000/media/xxx.wav)
    speaker_url: str | None = Form(None),
    # 3) หรือใช้ชื่อ speaker (ถ้าโมเดลรองรับในตัว)
    speaker: str | None = Form(None),
):
    """
    ลำดับความสำคัญของเสียงอ้างอิง:
    1) speaker_wav (upload) > 2) speaker_url (ดาวน์โหลดและ cache) > 3) speaker (id ภายในโมเดล) > 4) DEFAULT_SPEAKER_WAV
    """
    text = (text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="text is empty")

    language = map_lang(language)
    # ใช้ไฟล์ชั่วคราวสำหรับผลลัพธ์
    out_wav = os.path.join(tempfile.gettempdir(), f"tts_out_{_md5(text)[:8]}_{os.getpid()}.wav")

    # --- 1) มีอัปโหลดไฟล์ speaker_wav มากับคำขอ
    if speaker_wav is not None:
        try:
            tmp_in = os.path.join(tempfile.gettempdir(), f"in_{_md5(speaker_wav.filename or 'spk')}.wav")
            with open(tmp_in, "wb") as f:
                f.write(await speaker_wav.read())
            tts.tts_to_file(text=text, file_path=out_wav, language=language, speaker_wav=tmp_in)
            return FileResponse(out_wav, media_type="audio/wav")
        except Exception as e:
            # ตกไปลองทางถัดไป (อย่า fail ทั้งคำขอ)
            pass

    # --- 2) มี URL ของไฟล์เสียงอ้างอิง
    if speaker_url:
        try:
            cached = await _download_speaker_to_cache(speaker_url)
            tts.tts_to_file(text=text, file_path=out_wav, language=language, speaker_wav=cached)
            return FileResponse(out_wav, media_type="audio/wav")
        except Exception as e:
            # ตกไปลองทางถัดไป
            pass

    # --- 3) ระบุ speaker ที่โมเดลรู้จักในตัว
    if speaker:
        try:
            tts.tts_to_file(text=text, file_path=out_wav, language=language, speaker=speaker)
            return FileResponse(out_wav, media_type="audio/wav")
        except Exception:
            # ตกไปลอง default
            pass

    # --- 4) ใช้ DEFAULT_SPEAKER_WAV เป็น fallback สุดท้าย
    if os.path.exists(DEFAULT_SPEAKER_WAV):
        tts.tts_to_file(text=text, file_path=out_wav, language=language, speaker_wav=DEFAULT_SPEAKER_WAV)
        return FileResponse(out_wav, media_type="audio/wav")

    raise HTTPException(
        status_code=400,
        detail="No speaker reference. Provide 'speaker_wav' or 'speaker_url', or configure DEFAULT_SPEAKER_WAV."
    )
