# main.py

from modules.recorder import record_audio
from modules.stt import transcribe_audio, load_whisper_model
from modules.translator_m2m100 import load_translation_model
from modules.tts_xtts import speak_with_xtts, load_xtts_model
import torch, os
from torch.serialization import add_safe_globals#โหลดแบบปลอดภัย
from TTS.tts.configs.xtts_config import XttsConfig
# โหลดโมเดลทั้งหมดเพียงครั้งเดียว
whisper_model = load_whisper_model()
translator = load_translation_model()
add_safe_globals([XttsConfig])
tts_model = load_xtts_model()

# บันทึกเสียง
audio_path = record_audio(duration=5)

# แปลงเสียงเป็นข้อความ
text_thai = transcribe_audio(audio_path, whisper_model)

# แปลเป็นหลายภาษา
text_en = translator(text_thai, "thai", "english")
text_ja = translator(text_thai, "thai", "japanese")
text_zh = translator(text_thai, "thai", "chinese")

# สร้างเสียงที่แปลแล้ว
os.makedirs("outputs", exist_ok=True)
speak_with_xtts(tts_model, text_en, audio_path, lang="en", output_path="outputs/voice_en.wav")
speak_with_xtts(tts_model, text_ja, audio_path, lang="ja", output_path="outputs/voice_ja.wav")
speak_with_xtts(tts_model, text_zh, audio_path, lang="zh", output_path="outputs/voice_zh.wav")

# แสดงผล
print("\n📝 ข้อความต้นฉบับ (ไทย):", text_thai)
print("🌍 แปลเป็นอังกฤษ:", text_en)
print("🌸 แปลเป็นญี่ปุ่น:", text_ja)
print("🐉 แปลเป็นจีน:", text_zh)
