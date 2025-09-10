# main.py
# F5-TTS-THAI mini API (FastAPI)
# POST /tts (multipart/form-data)
# fields:
#   text: str (required)
#   language: str = "th"
#   ref_text: str = ""          # optional (ถ้าไม่ส่งและใช้ preset จะเติมให้เอง)
#   preset: str = ""            # optional: "female" | "male"
#   speaker_wav: file           # optional (ถ้าส่ง จะ override preset)
#   cross_fade, nfe_step, speed, cfg_strength, max_chars = … (เหมือนเดิม)
# return: audio/wav

from fastapi import FastAPI, UploadFile, Form, File
from fastapi.responses import Response, PlainTextResponse, JSONResponse
from cached_path import cached_path
import io, os, tempfile
import soundfile as sf

# ===== imports จาก src/f5_tts (ตั้ง PYTHONPATH=/app/src ใน Dockerfile) =====
from f5_tts.infer.utils_infer import (
    infer_process,
    load_model,
    load_vocoder,
    preprocess_ref_audio_text,
)
from f5_tts.model import DiT
from f5_tts.model.utils import seed_everything
from f5_tts.cleantext.number_tha import replace_numbers_with_thai
from f5_tts.cleantext.th_repeat import process_thai_repeat

app = FastAPI(title="F5-TTS-THAI API")

# ===== คอนฟิกโมเดล/ไฟล์ vocab =====
DEFAULT_MODEL_BASE = os.getenv("F5_CKPT", "hf://VIZINTZOR/F5-TTS-THAI/model_1000000.pt")
VOCAB_DEFAULT = os.getenv("F5_VOCAB", "/app/vocab/vocab.txt")
VOCAB_IPA     = os.getenv("F5_VOCAB_IPA", "/app/vocab/vocab_ipa.txt")
USE_IPA = os.getenv("F5_USE_IPA", "false").lower() == "true"  # ถ้าใช้ V2 ให้ export F5_USE_IPA=true

PRESETS = {
    "female": {
        "ref_wav": "/app/src/f5_tts/infer/examples/thai_examples/ref_gen_2.wav",
        "ref_text": "ฉันเดินทางไปเที่ยวที่จังหวัดเชียงใหม่ในช่วงฤดูหนาวเพื่อสัมผัสอากาศเย็นสบาย",
    },
    "male": {
        "ref_wav": "/app/src/f5_tts/infer/examples/thai_examples/ref_gen_1.wav",
        "ref_text": "ได้รับข่าวคราวของเราที่จะหาที่มันเป็นไปที่จะจัดขึ้น.",
    },
}

# ===== PRESETS (ตั้งค่าได้ผ่าน ENV; ถ้าไม่ตั้งใช้ค่า fallback จากตัวอย่างของคุณ) =====
PRESET_FEMALE_WAV = os.getenv("F5_PRESET_FEMALE_WAV", "/app/src/f5_tts/infer/examples/thai_examples/ref_gen_2.wav")
PRESET_FEMALE_TEXT = os.getenv("F5_PRESET_FEMALE_TEXT", "ฉันเดินทางไปเที่ยวที่จังหวัดเชียงใหม่ในช่วงฤดูหนาวเพื่อสัมผัสอากาศเย็นสบาย")
PRESET_MALE_WAV   = os.getenv("F5_PRESET_MALE_WAV",   "/app/src/f5_tts/infer/examples/thai_examples/ref_gen_1.wav")
PRESET_MALE_TEXT  = os.getenv("F5_PRESET_MALE_TEXT",  "ได้รับข่าวคราวของเราที่จะหาที่มันเป็นไปที่จะจัดขึ้น.")

_model = None
_vocoder = None

def load_f5tts(ckpt_path: str, use_ipa: bool):
    if use_ipa:
        cfg = dict(dim=1024, depth=22, heads=16, ff_mult=2, text_dim=512,
                   text_mask_padding=True, conv_layers=4, pe_attn_head=None)
        vocab = VOCAB_IPA
    else:
        cfg = dict(dim=1024, depth=22, heads=16, ff_mult=2, text_dim=512,
                   text_mask_padding=False, conv_layers=4, pe_attn_head=1)
        vocab = VOCAB_DEFAULT
    model = load_model(DiT, cfg, ckpt_path, vocab_file=vocab, use_ema=True)
    return model

@app.on_event("startup")
def _startup():
    global _model, _vocoder
    ckpt = str(cached_path(DEFAULT_MODEL_BASE))
    _model = load_f5tts(ckpt, use_ipa=USE_IPA)
    _vocoder = load_vocoder()

@app.get("/health")
def health():
    return {
        "ok": True,
        "model": DEFAULT_MODEL_BASE,
        "ipa": USE_IPA,
        "vocab": VOCAB_IPA if USE_IPA else VOCAB_DEFAULT,
        "presets": {
            "female": {"wav": PRESET_FEMALE_WAV, "has_wav": os.path.isfile(PRESET_FEMALE_WAV)},
            "male":   {"wav": PRESET_MALE_WAV,   "has_wav": os.path.isfile(PRESET_MALE_WAV)},
        }
    }

def _save_bytes_to_temp_wav(raw: bytes) -> str:
    fd, tmp_path = tempfile.mkstemp(suffix=".wav")
    os.close(fd)
    with open(tmp_path, "wb") as f:
        f.write(raw)
    return tmp_path

@app.post("/tts")
async def tts_endpoint(
    text: str = Form(...),
    language: str = Form("th"),
    ref_text: str = Form(""),                 # จะถูกละเลยเมื่อใช้ preset
    preset: str | None = Form(None),          # << เพิ่ม
    speaker_wav: UploadFile | None = File(None),  # อนุญาตให้ว่างได้เมื่อใช้ preset
    cross_fade: float = Form(0.15),
    nfe_step: int = Form(32),
    speed: float = Form(1.0),
    cfg_strength: float = Form(2.0),
    max_chars: int = Form(300),
):
    if not text or not text.strip():
        return PlainTextResponse("text is empty", status_code=400)

    # Reject overly long input upfront (hard limit = 100 chars)
    raw_text = text.strip()
    if len(raw_text) > 100:
        return PlainTextResponse("text too long (max 100 characters)", status_code=400)

    # ทำความสะอาดข้อความไทย
    gen_text_cleaned = process_thai_repeat(replace_numbers_with_thai(raw_text))

    tmp_path = None
    try:
        # ----- โหมด PRESET: ใช้ไฟล์/ข้อความอ้างอิงคงที่ -----
        if preset and preset in PRESETS:
            ref_audio_path = PRESETS[preset]["ref_wav"]
            ref_text_out  = PRESETS[preset]["ref_text"]

        else:
            # ----- โหมดเดิม: ต้องมี speaker_wav -----
            if speaker_wav is None:
                return PlainTextResponse("speaker_wav is required for F5-TTS-THAI", status_code=400)
            content = await speaker_wav.read()
            if not content:
                return PlainTextResponse("speaker_wav is empty", status_code=400)

            fd, tmp_path = tempfile.mkstemp(suffix=".wav"); os.close(fd)
            with open(tmp_path, "wb") as f:
                f.write(content)

            # ใช้ไฟล์อ้างอิงจากผู้ใช้ และ ref_text (ถ้ามี)
            ref_audio_path, ref_text_out = preprocess_ref_audio_text(tmp_path, ref_text or "")
            if ref_audio_path is None:
                ref_audio_path = tmp_path
                ref_text_out   = ref_text or ""

        seed_everything(1234)
        final_wave, final_sr, _ = infer_process(
            ref_audio_path,
            ref_text_out,
            gen_text_cleaned,
            _model,
            _vocoder,
            cross_fade_duration=float(cross_fade),
            nfe_step=int(nfe_step),
            speed=float(speed),
            cfg_strength=float(cfg_strength),
            set_max_chars=int(max_chars),
            use_ipa=USE_IPA,
            progress=None,
        )

        buf = io.BytesIO()
        sf.write(buf, final_wave, final_sr, format="WAV")
        buf.seek(0)
        return Response(content=buf.read(), media_type="audio/wav")

    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e)}, status_code=500)

    finally:
        try:
            if tmp_path and os.path.isfile(tmp_path):
                os.remove(tmp_path)
        except Exception:
            pass
