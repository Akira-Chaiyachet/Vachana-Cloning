# tts_test_server.py
# Mini TTS API (FastAPI) สำหรับ F5-TTS-THAI
# POST /tts : multipart/form-data
#   fields: text (str), language (str, default th), ref_text (str, optional)
#   file:   speaker_wav (required) -> ใช้สำหรับ cloning
# ส่งกลับ: audio/wav (binary)

from fastapi import FastAPI, UploadFile, Form
from fastapi.responses import Response, PlainTextResponse, JSONResponse
from cached_path import cached_path
import io, os, tempfile
import soundfile as sf

# ===== imports จากโปรเจกต์ F5-TTS-THAI (ต้องตั้ง PYTHONPATH=./src) =====
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

app = FastAPI(title="F5-TTS-THAI Mini API")

# ===== คอนฟิกโมเดล =====
DEFAULT_MODEL_BASE = "hf://VIZINTZOR/F5-TTS-THAI/model_1000000.pt"
VOCAB_DEFAULT = "./vocab/vocab.txt"
VOCAB_IPA     = "./vocab/vocab_ipa.txt"
USE_IPA = False  # ถ้าใช้ V2/IPA ให้เปลี่ยนเป็น True

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
    }

@app.post("/tts")
async def tts_endpoint(
    text: str = Form(...),
    language: str = Form("th"),
    ref_text: str = Form(""),
    speaker_wav: UploadFile | None = None,
    cross_fade: float = Form(0.15),
    nfe_step: int = Form(32),
    speed: float = Form(1.0),
    cfg_strength: float = Form(2.0),
    max_chars: int = Form(300),
):
    # 1) validate input
    if not text or not text.strip():
        return PlainTextResponse("text is empty", status_code=400)
    if speaker_wav is None:
        return PlainTextResponse("speaker_wav is required for F5-TTS-THAI cloning", status_code=400)

    # 2) clean text (ตามสคริปต์ CLI ที่ใช้ได้)
    gen_text_cleaned = process_thai_repeat(replace_numbers_with_thai(text.strip()))

    # 3) บันทึกไฟล์อ้างอิงลง temp-path (เพื่อให้ utils/process ใช้ path ได้ชัวร์)
    tmp_path = None
    try:
        content = await speaker_wav.read()
        if not content:
            return PlainTextResponse("speaker_wav is empty", status_code=400)
        fd, tmp_path = tempfile.mkstemp(suffix=".wav")
        os.close(fd)
        with open(tmp_path, "wb") as f:
            f.write(content)

        # 4) preprocess ref (อาจคืน None ได้ในบางเคส → fallback)
        ref_audio_path, ref_text_out = preprocess_ref_audio_text(tmp_path, ref_text or "")
        if ref_audio_path is None:
            # fallback: ใช้ไฟล์ที่เราเขียนเอง (บางเคสไฟล์เป็น wav อยู่แล้ว)
            ref_audio_path = tmp_path
            ref_text_out = ref_text or ""

        # 5) สังเคราะห์
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
            progress=None,   # ห้ามส่ง print (จะโดน .tqdm)
        )

        # 6) เขียน wav กลับ
        buf = io.BytesIO()
        sf.write(buf, final_wave, final_sr, format="WAV")
        buf.seek(0)
        return Response(content=buf.read(), media_type="audio/wav")

    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e)}, status_code=500)
    finally:
        # 7) ล้างไฟล์ชั่วคราว
        try:
            if tmp_path and os.path.isfile(tmp_path):
                os.remove(tmp_path)
        except Exception:
            pass
