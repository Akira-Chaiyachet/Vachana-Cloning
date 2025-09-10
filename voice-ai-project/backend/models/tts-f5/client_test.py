import httpx

url = "http://127.0.0.1:8001/tts"
files = {"speaker_wav": ("290.wav", open("280.wav","rb"), "audio/wav")}
data = {
    "text": "พรุ่ง นี้มีประชุมสำคัญ อย่าลืมเตรียมเอกสารให้เรียบร้อย",
    "language": "th",
    "ref_text": "ทำไปทำเหี้ยอะไร",
}
r = httpx.post(url, data=data, files=files, timeout=180)
r.raise_for_status()
with open("out_api_clone.wav","wb") as f:
    f.write(r.content)

print("✅ saved out_api_clone.wav, size:", len(r.content))
