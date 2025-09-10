"""
FastAPI app: gender detector using ECAPA-TDNN prototypes with F0 fallback.

Endpoints:
- POST /detect: multipart/form-data with `file` or `speaker_wav`
- GET /health
- GET /version

Environment:
- GENDER_MODEL_CACHE=/app/models
- GENDER_MIN_SEC=0.5
- GENDER_F0_THRESHOLD=180.0
"""
from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Any, Dict, Optional

import numpy as np
from fastapi import FastAPI, File, UploadFile, Form, HTTPException
from fastapi.responses import JSONResponse

from ecapa_backend import EcapaGenderBackend, TARGET_SR
from f0_fallback import detect_gender_f0


APP_VERSION = "gender-ecapa-2025-09"

logger = logging.getLogger("gender-service")
logging.basicConfig(level=logging.INFO)

app = FastAPI(title="gender-detector", version=APP_VERSION)


# Global backend instance
backend: Optional[EcapaGenderBackend] = None
BASE_DIR = Path(__file__).resolve().parent


def _env_float(key: str, default: float) -> float:
    try:
        return float(os.getenv(key, str(default)))
    except Exception:
        return default


def _rms(y: np.ndarray) -> float:
    if y.size == 0:
        return 0.0
    return float(np.sqrt(np.mean(np.square(y), dtype=np.float64)))


@app.on_event("startup")
def _startup() -> None:
    global backend
    cache_dir = os.getenv("GENDER_MODEL_CACHE")
    min_sec = _env_float("GENDER_MIN_SEC", 0.5)

    logger.info("Starting gender-detector. version=%s", APP_VERSION)
    backend = EcapaGenderBackend(model_cache=cache_dir, min_sec=min_sec)
    backend.load_model()

    # Load prototypes (may be empty; service still works with F0 fallback)
    backend.load_prototypes(BASE_DIR)

    logger.info(
        "Startup complete. model=%s, prototypes=%s",
        "ok" if backend.has_model else "none",
        "ok" if (backend.prototypes and backend.prototypes.available) else "none",
    )


@app.get("/health")
def health() -> Dict[str, Any]:
    return {"ok": True}


@app.get("/version")
def version() -> Dict[str, Any]:
    return {"version": APP_VERSION}


def _read_upload_bytes(upload: UploadFile) -> bytes:
    try:
        return upload.file.read()
    finally:
        try:
            upload.file.close()
        except Exception:
            pass


@app.post("/detect")
async def detect(
    file: Optional[UploadFile] = File(default=None),
    speaker_wav: Optional[UploadFile] = File(default=None),
) -> JSONResponse:
    if backend is None:
        raise HTTPException(status_code=503, detail="Service not ready")

    upload = file or speaker_wav
    if upload is None:
        raise HTTPException(status_code=400, detail="Missing file or speaker_wav")

    try:
        data = _read_upload_bytes(upload)
    except Exception:
        raise HTTPException(status_code=400, detail="Failed to read upload")

    # Decode audio
    try:
        y, sr = backend.decode_audio_from_bytes(data)
        y = np.asarray(y, dtype=np.float32)
    except Exception:
        raise HTTPException(status_code=400, detail="Unsupported audio format")

    # Attempt ECAPA if possible; fallback to F0 when needed
    method_used = "ecapa"
    cos_m = None
    cos_f = None
    duration = float(len(y) / max(1, sr))

    # Try ECAPA + prototypes if available
    pred = None
    conf = 0.0
    f0_median = None

    try:
        pred, conf, cos_m, cos_f, duration, method_used = backend.infer_with_prototypes(y, sr)
    except Exception as e:
        logger.error("ECAPA inference error: %s", e)
        pred = None

    # Fallback conditions: no prediction from ECAPA
    if pred is None:
        method_used = "f0"
        f0_thr = _env_float("GENDER_F0_THRESHOLD", 180.0)
        try:
            gender_f0, conf_f0, f0_med, dur_f0 = detect_gender_f0(y, sr, f0_threshold_hz=f0_thr)
            pred = gender_f0
            conf = conf_f0
            f0_median = f0_med
            duration = dur_f0
        except Exception as e:
            logger.error("F0 fallback failed: %s", e)
            pred = "unknown"
            conf = 0.0

    response = {
        "ok": True,
        "gender": pred if pred in ("male", "female", "unknown") else "unknown",
        "confidence": float(conf),
        "method": method_used,
        "cosine_to_male": None if cos_m is None else float(cos_m),
        "cosine_to_female": None if cos_f is None else float(cos_f),
        "f0_hz_median": None if f0_median is None else float(f0_median),
        "duration_sec": float(duration),
        "version": APP_VERSION,
    }
    return JSONResponse(response)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=False)
