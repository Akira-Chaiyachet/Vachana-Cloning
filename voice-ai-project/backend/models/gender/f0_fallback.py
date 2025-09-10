"""
Lightweight F0-based gender heuristic fallback.

Uses librosa.yin to estimate fundamental frequency, then decides gender by
thresholding the median F0. Confidence incorporates voiced ratio and the
distance from the threshold.
"""
from __future__ import annotations

from typing import Dict, Optional, Tuple

import numpy as np
import librosa
from numpy.typing import NDArray


def detect_gender_f0(
    y: NDArray[np.float32],
    sr: int,
    f0_threshold_hz: float = 180.0,
    fmin: float = 80.0,
    fmax: float = 350.0,
) -> Tuple[str, float, Optional[float], float]:
    """
    Returns: (gender, confidence, f0_median_hz, duration_sec)
    gender: "male" | "female" | "unknown"
    """
    y = np.asarray(y, dtype=np.float32)
    if y.size == 0 or sr <= 0:
        return "unknown", 0.0, None, 0.0

    # Frame length tuned for speech; short hop for resolution
    frame_length = int(0.050 * sr)  # 50 ms
    hop_length = int(0.010 * sr)    # 10 ms
    if frame_length <= 0:
        frame_length = 1024
    if hop_length <= 0:
        hop_length = 256

    try:
        f0 = librosa.yin(y, fmin=fmin, fmax=fmax, sr=sr, frame_length=frame_length, hop_length=hop_length)
    except Exception:
        return "unknown", 0.0, None, float(y.size / sr)

    duration = float(y.size / sr)
    valid = np.isfinite(f0)
    if not np.any(valid):
        return "unknown", 0.0, None, duration

    f0_valid = f0[valid]
    # voiced ratio as fraction of valid F0 frames within range
    voiced_ratio = float(np.clip(f0_valid.size / max(1, f0.size), 0.0, 1.0))

    if f0_valid.size == 0:
        return "unknown", 0.0, None, duration

    f0_median = float(np.median(f0_valid))
    # Decision
    gender = "male" if f0_median < f0_threshold_hz else "female"

    # Confidence: combine voiced ratio and normalized distance to threshold
    diff = abs(f0_median - f0_threshold_hz)
    # Normalize by threshold (so ~100% when 2x away)
    dist_score = float(np.clip(diff / max(1e-6, f0_threshold_hz), 0.0, 1.0))
    confidence = float(np.clip(0.6 * voiced_ratio + 0.4 * dist_score, 0.0, 1.0))

    # If extremely low voiced ratio, mark unknown
    if voiced_ratio < 0.15:
        return "unknown", min(confidence, 0.3), f0_median, duration

    return gender, confidence, f0_median, duration

