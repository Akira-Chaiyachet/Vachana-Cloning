"""
ECAPA-TDNN backend for gender detection using SpeechBrain embeddings.

Loads a pretrained ECAPA model once, computes prototype mean embeddings
from provided male/female sample wavs, and exposes cosine-sim inference.

Designed for CPU: uses torch.no_grad and minimal preprocessing.
"""
from __future__ import annotations

import io
import logging
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import numpy as np
import torch
import soundfile as sf
import librosa
from numpy.typing import NDArray


logger = logging.getLogger("gender-ecapa")


TARGET_SR = 16000


def _to_mono(wav: NDArray[np.float32]) -> NDArray[np.float32]:
    if wav.ndim == 1:
        return wav.astype(np.float32, copy=False)
    return np.mean(wav, axis=0, dtype=np.float32)


def _resample(y: NDArray[np.float32], sr: int, target_sr: int = TARGET_SR) -> NDArray[np.float32]:
    if sr == target_sr:
        return y
    return librosa.resample(y=y, orig_sr=sr, target_sr=target_sr, res_type="kaiser_fast").astype(np.float32, copy=False)


def _trim_silence(y: NDArray[np.float32], top_db: float = 30.0) -> NDArray[np.float32]:
    if y.size == 0:
        return y
    yt, _ = librosa.effects.trim(y, top_db=top_db)
    return yt.astype(np.float32, copy=False)


def _rms(y: NDArray[np.float32]) -> float:
    if y.size == 0:
        return 0.0
    return float(np.sqrt(np.mean(np.square(y), dtype=np.float64)))


@dataclass
class Prototypes:
    male: Optional[NDArray[np.float32]]
    female: Optional[NDArray[np.float32]]
    count_male: int
    count_female: int

    @property
    def available(self) -> bool:
        return self.male is not None and self.female is not None


class EcapaGenderBackend:
    """Encapsulates SpeechBrain ECAPA-TDNN and prototype-based gender decision."""

    def __init__(self, model_cache: Optional[str] = None, min_sec: float = 0.5) -> None:
        self.model_cache = model_cache
        self.min_sec = float(min_sec)
        self._classifier = None  # lazy-loaded EncoderClassifier
        self._protos: Optional[Prototypes] = None

    @property
    def has_model(self) -> bool:
        return self._classifier is not None

    @property
    def prototypes(self) -> Optional[Prototypes]:
        return self._protos

    def load_model(self) -> None:
        if self._classifier is not None:
            return
        try:
            from speechbrain.pretrained import EncoderClassifier

            savedir = None
            if self.model_cache:
                os.makedirs(self.model_cache, exist_ok=True)
                savedir = os.path.join(self.model_cache, "spkrec-ecapa-voxceleb")
            logger.info("Loading SpeechBrain ECAPA model… savedir=%s", savedir)
            self._classifier = EncoderClassifier.from_hparams(
                source="speechbrain/spkrec-ecapa-voxceleb",
                savedir=savedir,
                run_opts={"device": "cpu"},
            )
            logger.info("ECAPA model loaded.")
        except Exception as e:
            logger.exception("Failed to load ECAPA model: %s", e)
            self._classifier = None

    def _embed_tensor(self, wav: torch.Tensor, sr: int) -> Optional[NDArray[np.float32]]:
        if self._classifier is None:
            return None
        if sr != TARGET_SR:
            # Expect 16k
            return None
        try:
            with torch.no_grad():
                # wav: (1, T)
                emb = self._classifier.encode_batch(wav)
                # emb: (1, 1, D) or (1, D)
                if emb.ndim == 3:
                    emb = emb.squeeze(1)
                emb = emb.squeeze(0).cpu().numpy().astype(np.float32, copy=False)
                # L2 normalize for cosine
                norm = np.linalg.norm(emb)
                if norm > 0:
                    emb = emb / norm
                return emb
        except Exception as e:
            logger.error("Embedding failed: %s", e)
            return None

    def embed(self, y: NDArray[np.float32], sr: int) -> Optional[NDArray[np.float32]]:
        if y.size == 0:
            return None
        yt = _trim_silence(_resample(_to_mono(y), sr, TARGET_SR))
        if yt.size == 0:
            return None
        wav = torch.from_numpy(yt).unsqueeze(0)  # (1, T)
        return self._embed_tensor(wav, TARGET_SR)

    def _collect_wavs(self, folder: Path) -> List[Tuple[NDArray[np.float32], int]]:
        items: List[Tuple[NDArray[np.float32], int]] = []
        for p in sorted(folder.glob("*.wav")):
            try:
                y, sr = sf.read(str(p), always_2d=False, dtype="float32")
                y = _to_mono(np.asarray(y, dtype=np.float32))
                y = _resample(y, sr, TARGET_SR)
                y = _trim_silence(y)
                if y.size > 0:
                    items.append((y, TARGET_SR))
            except Exception as e:
                logger.warning("Failed reading prototype %s: %s", p, e)
        return items

    def _mean_embed(self, wavs: List[Tuple[NDArray[np.float32], int]]) -> Optional[NDArray[np.float32]]:
        embs: List[NDArray[np.float32]] = []
        for y, sr in wavs:
            emb = self.embed(y, sr)
            if emb is not None:
                embs.append(emb)
        if not embs:
            return None
        m = np.mean(np.stack(embs, axis=0), axis=0)
        # L2 normalize
        norm = np.linalg.norm(m)
        if norm > 0:
            m = m / norm
        return m.astype(np.float32, copy=False)

    def load_prototypes(self, root: Path) -> Prototypes:
        male_dir = root / "prototypes" / "male"
        female_dir = root / "prototypes" / "female"
        male_dir.mkdir(parents=True, exist_ok=True)
        female_dir.mkdir(parents=True, exist_ok=True)

        male_wavs = self._collect_wavs(male_dir)
        female_wavs = self._collect_wavs(female_dir)

        male_mean = self._mean_embed(male_wavs) if male_wavs else None
        female_mean = self._mean_embed(female_wavs) if female_wavs else None

        self._protos = Prototypes(
            male=male_mean,
            female=female_mean,
            count_male=len(male_wavs),
            count_female=len(female_wavs),
        )
        logger.info(
            "Prototypes loaded: male=%s (%d files), female=%s (%d files)",
            "ok" if male_mean is not None else "none",
            len(male_wavs),
            "ok" if female_mean is not None else "none",
            len(female_wavs),
        )
        return self._protos

    @staticmethod
    def cosine(a: NDArray[np.float32], b: NDArray[np.float32]) -> float:
        if a is None or b is None:
            return float("nan")
        denom = float(np.linalg.norm(a) * np.linalg.norm(b))
        if denom == 0.0:
            return float("nan")
        return float(np.dot(a, b) / denom)

    def infer_with_prototypes(
        self, y: NDArray[np.float32], sr: int
    ) -> Tuple[Optional[str], float, Optional[float], Optional[float], float, str]:
        """
        Returns: (gender, confidence, cos_m, cos_f, duration_sec, method)
        gender may be None if cannot embed or prototypes missing.
        method is "ecapa" when successful.
        """
        if self._classifier is None or self._protos is None or not self._protos.available:
            return None, 0.0, None, None, 0.0, "ecapa"

        y_mono = _to_mono(y)
        y_rs = _resample(y_mono, sr, TARGET_SR)
        y_trim = _trim_silence(y_rs)
        dur = float(len(y_trim) / TARGET_SR) if y_trim.size > 0 else 0.0
        if dur <= 0.0:
            return None, 0.0, None, None, 0.0, "ecapa"

        emb = self.embed(y_trim, TARGET_SR)
        if emb is None:
            return None, 0.0, None, None, dur, "ecapa"

        cos_m = self.cosine(emb, self._protos.male) if self._protos.male is not None else None
        cos_f = self.cosine(emb, self._protos.female) if self._protos.female is not None else None
        if cos_m is None or cos_f is None:
            return None, 0.0, cos_m, cos_f, dur, "ecapa"

        pred = "male" if cos_m >= cos_f else "female"
        base = max(cos_m, cos_f)
        # Map cosine [-1,1] -> [0,1]
        conf = (base + 1.0) / 2.0
        if dur >= max(0.8, self.min_sec):
            conf = min(1.0, conf + 0.1)
        return pred, float(conf), float(cos_m), float(cos_f), dur, "ecapa"

    @staticmethod
    def decode_audio_from_bytes(data: bytes) -> Tuple[NDArray[np.float32], int]:
        """Decode arbitrary audio bytes to mono float32 and sample rate using soundfile.
        If the container is unsupported by libsndfile, users should send wav.
        """
        with io.BytesIO(data) as bio:
            y, sr = sf.read(bio, always_2d=False, dtype="float32")
        y = _to_mono(np.asarray(y, dtype=np.float32))
        return y, int(sr)

