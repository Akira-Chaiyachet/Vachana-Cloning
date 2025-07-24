# ใน main.py







from modules.tts_xtts import load_xtts_model, speak_with_xtts
from modules.recorder import record_audio
from modules.stt import transcribe_audio
from modules.translator_m2m100 import translator_m2m100_init
import torch
import whisper

def load_whisper_model(model_name="large", device="cuda"):
    print(f"🚀 กำลังโหลดโมเดล Whisper ({model_name})...")
    model = whisper.load_model(model_name)
    if device:
        import torch
        if torch.cuda.is_available() and device == "cuda":
            model = model.to("cuda")
    print("✅ โหลดโมเดล Whisper เสร็จแล้ว!")
    return model


if __name__ == "__main__":
    whisper_model = load_whisper_model("large", "cuda")
    xtts_model = load_xtts_model()
    translator = translator_m2m100_init()

    while True:
        audio_path = record_audio(duration=5)

        try:
            text_thai = transcribe_audio(audio_path, whisper_model)
            if not text_thai.strip():
                continue

            text_en = translator(text_thai, "thai", "english")
            text_ja = translator(text_thai, "thai", "japanese")
            text_zh = translator(text_thai, "thai", "chinese")

            print("📝:", text_thai)
            print("🌍:", text_en)

            speak_with_xtts(xtts_model, text_en, audio_path, "en")
            speak_with_xtts(xtts_model, text_ja, audio_path, "ja")
            speak_with_xtts(xtts_model, text_zh, audio_path, "zh")

        except Exception as e:
            print("❌ ERROR:", e)

