# modules/recorder.py
import sounddevice as sd
import numpy as np
import scipy.io.wavfile as wav
import tempfile
import os

def record_audio(duration=5, fs=16000):
    print("🎤 เริ่มบันทึกเสียง...")
    audio = sd.rec(int(duration * fs), samplerate=fs, channels=1, dtype='int16')
    sd.wait()

    # ใช้ tempfile เพื่อบันทึกเสียงในหน่วยความจำ
    temp_wav = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
    wav.write(temp_wav.name, fs, audio)

    print(f"✅ บันทึกเสร็จ (ชั่วคราว): {temp_wav.name}")
    print(f"ขนาดไฟล์เสียง: {os.path.getsize(temp_wav.name)} bytes")
    return temp_wav.name
