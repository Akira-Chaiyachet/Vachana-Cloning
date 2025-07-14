# modules/recorder.py
import sounddevice as sd
import numpy as np
import scipy.io.wavfile as wav
import os
import datetime

def record_audio(duration=5, fs=16000):
    print("🎤 เริ่มบันทึกเสียง...")

    audio = sd.rec(int(duration * fs), samplerate=fs, channels=1, dtype='int16')
    sd.wait()

    # ตั้งชื่อไฟล์ตามเวลา
    timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"voices/recording_{timestamp}.wav"
    
    # ตรวจสอบว่าโฟลเดอร์ voices มีหรือยัง
    os.makedirs("voices", exist_ok=True)

    # บันทึกไฟล์เสียง
    wav.write(filename, fs, audio)
    print(f"✅ บันทึกเสร็จ: {filename}")
    return filename
