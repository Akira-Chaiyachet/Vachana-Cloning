# modules/stt.py\


import os
import whisper

# กำหนด path ของ ffmpeg ที่อยู่ในโปรเจกต์
ffmpeg_path = os.path.abspath(r"C:\project\voice-translator\ffmpeg-7.1.1-essentials_build\bin")
os.environ["PATH"] = ffmpeg_path + os.pathsep + os.environ["PATH"]




# โหลดโมเดล (ใช้โมเดลขนาด base เพื่อความเร็ว)
model = whisper.load_model("large")

def transcribe_audio(audio_path):
    print("🧠 กำลังแปลงเสียงเป็นข้อความ...")
    result = model.transcribe(audio_path, task="transcribe", language="th")
    print("📄 ข้อความที่ได้:", result["text"])
    return result["text"]