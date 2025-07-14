# modules/tts_xtts.py

import os
from TTS.api import TTS

# ✅ สำหรับ PyTorch ≥ 2.6: allowlist class ที่ใช้ใน XTTS
import torch
from torch.serialization import add_safe_globals
from TTS.tts.configs.xtts_config import XttsConfig,XttsArgs  
from TTS.tts.models.xtts import XttsAudioConfig
from TTS.config.shared_configs import BaseDatasetConfig 

def load_xtts_model():
    print("🚀 กำลังโหลดโมเดล XTTS...")
    add_safe_globals([XttsConfig, XttsAudioConfig, BaseDatasetConfig,XttsArgs  ])
    tts = TTS(model_name="tts_models/multilingual/multi-dataset/xtts_v2")
    tts.to("cuda" if torch.cuda.is_available() else "cpu")
    return tts

def speak_with_xtts(tts, text, ref_audio_path, lang="en", output_path="output.wav"):
    print(f"🎤 กำลังพูดด้วยเสียงโคลนนิ่ง ({lang})...")

    tts.tts_to_file(
        text=text,
        file_path=output_path,
        speaker_wav=ref_audio_path,
        language=lang
    )

    print(f"✅ บันทึกเสียงที่: {output_path}")
    return output_path
