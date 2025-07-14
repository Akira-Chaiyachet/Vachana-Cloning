import os
import torch



# กำหนด path ของ ffmpeg ที่อยู่ในโปรเจกต์
ffmpeg_path = os.path.abspath(r"C:\project\voice-translator\ffmpeg-7.1.1-essentials_build\bin")
os.environ["PATH"] = ffmpeg_path + os.pathsep + os.environ["PATH"]


# main.py

from modules.tts_xtts import speak_with_xtts
from modules.recorder import record_audio
from modules.stt import transcribe_audio
from modules.translator_m2m100 import translator_m2m100
from modules.tts_xtts import speak_with_xtts, load_xtts_model


if __name__ == "__main__":
    try:
        audio_path = record_audio(duration=5)
        text_thai = transcribe_audio(audio_path)
        

        text_en = translator_m2m100(text_thai, source_lang="thai", target_lang="english")
        torch.cuda.empty_cache()
        text_ja = translator_m2m100(text_thai, source_lang="thai", target_lang="japanese")
        torch.cuda.empty_cache()
        text_zh = translator_m2m100(text_thai, source_lang="thai", target_lang="chinese")
        torch.cuda.empty_cache()
        print("\n📝 ข้อความต้นฉบับ (ไทย):", text_thai)
        print("🌍 แปลเป็นอังกฤษ:", text_en)
        print("🌸 แปลเป็นญี่ปุ่น:", text_ja)
        print("🐉 แปลเป็นจีน:", text_zh)

        speak_with_xtts(load_xtts_model(), text_en, audio_path, lang="en", output_path="outputs/voice_en.wav")
        speak_with_xtts(load_xtts_model(), text_ja, audio_path, lang="ja", output_path="outputs/voice_ja.wav")
        speak_with_xtts(load_xtts_model(), text_zh, audio_path, lang="zh", output_path="outputs/voice_zh.wav")

       


    except Exception as e:
        print("เกิดข้อผิดพลาด:", e)
