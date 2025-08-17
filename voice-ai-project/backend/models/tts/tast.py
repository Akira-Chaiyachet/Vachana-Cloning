# tast.py  — Deep TTS API Debugger
# Usage examples:
#   python tast.py
#   python tast.py --url http://localhost:8003/tts --text "笑你媽" --lang zh-cn --speaker-wav myvoice.wav
#   python tast.py --speaker-url http://localhost:8000/media/voices/u123.wav
#
# Env overrides:
#   set TTS_URL=http://localhost:8003/tts
#
# Output:
#   - out.wav           : ไฟล์ที่ได้จาก API (ทั้งก้อน)
#   - chunks/out_###.wav: ไฟล์ที่ถูกหั่นเป็นชิ้นละ ~200ms (จำลองสตรีม)
#   - รายงานละเอียด LAT/RMS/CLIP/เงียบต้น-ท้าย/ฟอร์แมต WAV ฯลฯ

import os, io, time, argparse, hashlib, textwrap, json
import requests
import wave
import struct
import math
from pathlib import Path

DEFAULT_URL = os.getenv("TTS_URL", "http://localhost:8004/tts")

def sha256(b: bytes) -> str:
    import hashlib
    return hashlib.sha256(b).hexdigest()

def analyze_wav_bytes(b: bytes):
    """
    คืน dict: sample_rate, channels, sampwidth, nframes, duration, rms, peak, clipped_pct, leading_silence_ms, trailing_silence_ms
    """
    bio = io.BytesIO(b)
    with wave.open(bio, "rb") as wf:
        ch   = wf.getnchannels()
        sw   = wf.getsampwidth()
        sr   = wf.getframerate()
        nf   = wf.getnframes()
        dur  = nf / float(sr) if sr else 0.0

        # อ่านทั้งหมดระวังเมมโมรี่ใหญ่; โดยปกติ TTS สั้น ๆ OK
        pcm  = wf.readframes(nf)

    # รองรับเฉพาะ s16le เพื่อคำนวณ (ถ้าไม่ใช่ ให้ข้ามคำนวณละเอียด)
    result = {
        "channels": ch, "sampwidth": sw, "sample_rate": sr,
        "nframes": nf, "duration_sec": dur,
        "rms": None, "peak": None, "clipped_pct": None,
        "leading_silence_ms": None, "trailing_silence_ms": None,
    }

    if sw != 2:
        return result  # non-s16: ข้าม metrics ละเอียด

    # แปลงเป็นลิสต์ตัวอย่าง 16-bit interleaved
    total_samples = len(pcm) // 2
    fmt = "<%dh" % total_samples
    samples = struct.unpack(fmt, pcm)

    # ถ้าเป็นสเตอริโอ ให้ downmix แบบง่าย (L+R)/2
    if ch == 2:
        left  = samples[0::2]
        right = samples[1::2]
        mono  = [(l + r) // 2 for l, r in zip(left, right)]
    else:
        mono  = samples

    # RMS & Peak
    abs_samples = [abs(x) for x in mono]
    peak = max(abs_samples) if abs_samples else 0
    rms  = math.sqrt(sum((x*x) for x in mono) / len(mono)) if mono else 0.0

    # Clipping: สัดส่วนตัวอย่างที่เป็น ±32767
    clip_count = sum(1 for x in mono if x >= 32767 or x <= -32768 or abs(x) >= 32767)
    clipped_pct = 100.0 * clip_count / len(mono) if mono else 0.0

    # ประเมินความเงียบต้น/ท้าย (threshold แบบง่ายจาก RMS ส่วนหนึ่งของ peak)
    # ใช้เกณฑ์คงที่จะง่ายกว่า: |sample| < 500 ถือว่าเงียบ (ปรับได้)
    SIL_TH = 500
    def count_silence_edges(arr):
        n = len(arr)
        i = 0
        while i < n and abs(arr[i]) < SIL_TH:
            i += 1
        j = n - 1
        while j >= 0 and abs(arr[j]) < SIL_TH:
            j -= 1
        lead = i
        trail = (n - 1 - j)
        return lead, trail

    lead_samp, trail_samp = count_silence_edges(mono)
    lead_ms  = int(1000.0 * lead_samp  / float(sr)) if sr else None
    trail_ms = int(1000.0 * trail_samp / float(sr)) if sr else None

    result.update({
        "rms": rms,
        "peak": peak,
        "clipped_pct": clipped_pct,
        "leading_silence_ms": lead_ms,
        "trailing_silence_ms": trail_ms,
    })
    return result

def save_bytes(p: Path, b: bytes):
    p.parent.mkdir(parents=True, exist_ok=True)
    with open(p, "wb") as f:
        f.write(b)

def split_wav_in_chunks(wav_bytes: bytes, chunk_ms=200):
    """
    หั่น wav เป็นชิ้นเท่า ๆ กัน (~chunk_ms) เพื่อจำลองการสตรีม
    คืน (header_list, data_list, sr) โดย header_list เป็น bytes ของ WAV แต่ละชิ้น
    """
    outs = []
    with wave.open(io.BytesIO(wav_bytes), "rb") as wf:
        ch = wf.getnchannels()
        sw = wf.getsampwidth()
        sr = wf.getframerate()
        nf = wf.getnframes()
        frames_per_chunk = int(sr * (chunk_ms / 1000.0))
        if frames_per_chunk <= 0:
            frames_per_chunk = sr // 5  # fallback 200ms

        read = 0
        while read < nf:
            take = min(frames_per_chunk, nf - read)
            frames = wf.readframes(take)
            read += take
            # เขียนเป็น wav ย่อย
            bio = io.BytesIO()
            with wave.open(bio, "wb") as o:
                o.setnchannels(ch); o.setsampwidth(sw); o.setframerate(sr)
                o.writeframes(frames)
            outs.append(bio.getvalue())
    return outs, sr

def request_tts(url, text, language, speaker_wav=None, speaker_url=None, speaker=None, timeout=60):
    files = None
    data = {"text": text, "language": language}
    if speaker is not None:
        data["speaker"] = speaker
    if speaker_url:
        data["speaker_url"] = speaker_url

    if speaker_wav:
        files = {"speaker_wav": open(speaker_wav, "rb")}

    t0 = time.time()
    try:
        r = requests.post(url, data=data, files=files, timeout=timeout)
    finally:
        if files:
            try: files["speaker_wav"].close()
            except: pass
    t1 = time.time()

    info = {
        "status": r.status_code,
        "elapsed_ms": int((t1 - t0) * 1000),
        "headers": dict(r.headers),
        "ok": (r.status_code == 200 and r.content),
        "sha256": sha256(r.content) if r.status_code == 200 else None,
        "content_length": len(r.content) if r.status_code == 200 else 0,
        "text_snippet": text[:120],
    }
    return r, info

def main():
    ap = argparse.ArgumentParser(description="Deep TTS API Debugger")
    ap.add_argument("--url", default=DEFAULT_URL)
    ap.add_argument("--text", default="リムル、君はただの小さなサラームだよ。")
    ap.add_argument("--lang", default="ja")
    ap.add_argument("--speaker-wav", default=None)
    ap.add_argument("--speaker-url", default=None)
    ap.add_argument("--speaker", default=None)
    ap.add_argument("--chunk-ms", type=int, default=200)
    ap.add_argument("--out", default="out.wav")
    ap.add_argument("--also-try-default", action="store_true",
                    help="ถ้าส่ง speaker_wav หรือ speaker_url แล้วพังให้ลอง fallback ด้วย")
    args = ap.parse_args()

    print("=== TTS Request ===")
    print(f"URL          : {args.url}")
    print(f"Text         : {args.text}")
    print(f"Language     : {args.lang}")
    print(f"Speaker WAV  : {args.speaker_wav}")
    print(f"Speaker URL  : {args.speaker_url}")
    print(f"Speaker ID   : {args.speaker}")
    print("---------------")

    r, meta = request_tts(
        url=args.url,
        text=args.text,
        language=args.lang,
        speaker_wav=args.speaker_wav,
        speaker_url=args.speaker_url,
        speaker=args.speaker,
    )

    print("HTTP Status  :", meta["status"])
    print("Elapsed      :", meta["elapsed_ms"], "ms")
    print("Resp Headers :", json.dumps(meta["headers"], ensure_ascii=False, indent=2))
    if r.status_code != 200:
        print("Body:", r.text[:400])
        if args.also_try_default and (args.speaker_wav or args.speaker_url or args.speaker):
            print("\n>>> Try fallback WITHOUT speaker reference...")
            r2, meta2 = request_tts(args.url, args.text, args.lang)
            print("HTTP Status  :", meta2["status"])
            print("Elapsed      :", meta2["elapsed_ms"], "ms")
            if r2.status_code == 200:
                data = r2.content
                print("OK fallback, bytes:", len(data), "sha256:", sha256(data))
                save_bytes(Path(args.out), data)
                print(f"Saved -> {args.out}")
            else:
                print("Fallback also failed. Body:", r2.text[:400])
        return

    data = r.content
    print("Bytes        :", len(data))
    print("SHA256       :", meta["sha256"])

    # วิเคราะห์ WAV
    try:
        info = analyze_wav_bytes(data)
        print("\n=== WAV Analysis ===")
        print(json.dumps(info, ensure_ascii=False, indent=2))
        # คำเตือนพื้นฐาน
        warns = []
        if info["channels"] and info["channels"] != 1:
            warns.append(f"- WAV is not mono (channels={info['channels']}). Gateway คาดว่า mono.")
        if info["sampwidth"] and info["sampwidth"] != 2:
            warns.append(f"- Sample width != 2 bytes (sampwidth={info['sampwidth']}). ควรเป็น s16le.")
        if info["sample_rate"] and info["sample_rate"] not in (16000, 22050, 24000, 44100, 48000):
            warns.append(f"- Unusual sample rate {info['sample_rate']}.")
        if (info["leading_silence_ms"] or 0) > 150:
            warns.append(f"- Long leading silence ~{info['leading_silence_ms']}ms → ฟังดูดีเลย์")
        if (info["trailing_silence_ms"] or 0) > 150:
            warns.append(f"- Long trailing silence ~{info['trailing_silence_ms']}ms")
        if (info["clipped_pct"] or 0) > 0.1:
            warns.append(f"- Clipping {info['clipped_pct']:.2f}% → เสียงแตก/เพี้ยน")
        if warns:
            print("\n[WARN]")
            for w in warns:
                print(" ", w)
    except Exception as e:
        print("WAV parse failed:", e)

    # เซฟทั้งก้อน
    out_path = Path(args.out)
    save_bytes(out_path, data)
    print(f"\nSaved full WAV -> {out_path.resolve()}")

    # จำลองสตรีมเป็นชิ้น ๆ 200ms (เหมือน gateway)
    try:
        chunks, sr = split_wav_in_chunks(data, chunk_ms=args.chunk_ms)
        print(f"\n=== Streaming Simulation ({args.chunk_ms}ms/chunk) ===")
        print(f"Chunks: {len(chunks)}  | SR: {sr}")
        ch_dir = Path("chunks")
        for i, c in enumerate(chunks):
            save_bytes(ch_dir / f"out_{i:03d}.wav", c)
        print(f"Saved {len(chunks)} chunks to {ch_dir}/")
        # (ถ้าต้องการ) ตรวจความต่อเนื่องเบื้องต้น: ขนาดใกล้เคียงกันไหม
        sizes = [len(c) for c in chunks[:10]]
        if sizes:
            print("First 10 chunk sizes:", sizes)
    except Exception as e:
        print("Chunking failed:", e)

    print("\n=== Hints if audio stutters / sounds wrong ===")
    print(textwrap.dedent("""
      - ถ้า channels != 1 หรือ sampwidth != 2: ให้ปรับฝั่ง TTS ให้ส่ง mono s16le (หรือให้ gateway แปลงก่อนสตรีม)
      - ถ้า leading_silence_ms ยาว: ตัด silence ต้นท้ายนิดหน่อย (หรือให้ XTTS ไม่สร้าง pause ยาว)
      - ถ้า clipped_pct > 0: ลดระดับเสียง (normalize) ก่อนส่ง หรือปรับ gain ลง
      - ถ้าคืน sample_rate ไม่ใช่ 16000: ฝั่ง player/streamer ควร decode เป็น float แล้วค่อยไปที่ AudioContext (OK)
      - ลองยิงหลายรอบด้วยข้อความเดียวกัน ดู latency/ความสม่ำเสมอ เปรียบเทียบ log ของ tts container ระหว่างรอบ
    """).strip())

if __name__ == "__main__":
    main()
