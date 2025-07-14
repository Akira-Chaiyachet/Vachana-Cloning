import whisper, torch, os

ffmpeg_path = os.path.abspath(r"C:\project\voice-translator\ffmpeg-7.1.1-essentials_build\bin")
os.environ["PATH"] = ffmpeg_path + os.pathsep + os.environ["PATH"]

device = "cuda" if torch.cuda.is_available() else "cpu"
print(f"🖥️ กำลังใช้ device: {device}")

model = whisper.load_model("large").to("cuda")

def transcribe_audio(audio_path):
    print("🧠 กำลังแปลงเสียงเป็นข้อความ...")
    result = model.transcribe(audio_path, task="transcribe", language="th")
    print("📄 ข้อความที่ได้:", result["text"])
    return result["text"]