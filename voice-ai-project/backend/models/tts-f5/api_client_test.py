import time, httpx

URL = "http://127.0.0.1:8001/tts"

def save_wav(path, content: bytes):
    with open(path, "wb") as f:
        f.write(content)

def call_plain():
    t0 = time.time()
    with httpx.Client(timeout=90.0) as client:
        data = {"text": "ทดสอบระบบสร้างเสียงภาษาไทยจากข้อความ", "language": "th"}
        r = client.post(URL, data=data)
        r.raise_for_status()
    dt = (time.time() - t0) * 1000
    save_wav("out_py_plain.wav", r.content)
    print(f"plain ok, {len(r.content)} bytes, latency ~{dt:.0f} ms")

def call_clone():
    t0 = time.time()
    with httpx.Client(timeout=120.0) as client:
        data = {
            "text": "พรุ่งนี้มีประชุมสำคัญอย่าลืมเตรียมเอกสารให้เรียบร้อย",
            "language": "th",
            "ref_text": "รับทราบค่ะ",
            "nfe_step": "32",
            "speed": "1.0",
        }
        files = {"speaker_wav": ("ref.wav", open(r".\src\f5_tts\infer\examples\thai_examples\ref_gen_1.wav","rb"), "audio/wav")}
        r = client.post(URL, data=data, files=files)
        r.raise_for_status()
    dt = (time.time() - t0) * 1000
    save_wav("out_py_clone.wav", r.content)
    print(f"clone ok, {len(r.content)} bytes, latency ~{dt:.0f} ms")

if __name__ == "__main__":
    call_plain()
    call_clone()
