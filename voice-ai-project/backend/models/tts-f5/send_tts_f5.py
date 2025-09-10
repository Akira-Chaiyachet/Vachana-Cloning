# send_tts_f5.py
# STEP A: F5 TTS (ต้องมี ref_text) -> out_f5.wav
# STEP B: XTTS clone (ใช้ text เดิม + ref_wav) -> out_xtts_clone.wav

import argparse
import os
import time
import httpx


def post_expect_wav(url: str, data: dict, files: dict | None, timeout: float) -> bytes:
    with httpx.Client(timeout=timeout) as client:
        r = client.post(url, data=data, files=files)
        ctype = r.headers.get("content-type", "")
        if r.status_code != 200:
            try:
                raise RuntimeError(f"HTTP {r.status_code}: {r.json()}")
            except Exception:
                raise RuntimeError(f"HTTP {r.status_code}: {r.text[:500]}")
        if "audio/wav" not in ctype:
            try:
                raise RuntimeError(f"Unexpected content-type={ctype}: {r.json()}")
            except Exception:
                raise RuntimeError(f"Unexpected content-type={ctype}: {r.text[:500]}")
        return r.content


def main():
    ap = argparse.ArgumentParser(
        description="F5 TTS (needs ref_text) + XTTS cloning (with ref_wav)"
    )
    # endpoints
    ap.add_argument(
        "--f5_url", default="http://127.0.0.1:8005/tts", help="F5 /tts endpoint"
    )
    ap.add_argument(
        "--xtts_url", default="http://127.0.0.1:8004/tts", help="XTTS /tts endpoint"
    )
    # I/O
    ap.add_argument(
        "--text", required=True, help="ข้อความที่จะสังเคราะห์ (ใช้ทั้ง F5 และ XTTS)"
    )
    ap.add_argument(
        "--language", default="th", help="รหัสภาษา (th/en/ja/zh-cn...) สำหรับ XTTS"
    )
    ap.add_argument(
        "--ref_wav", required=True, help="ไฟล์อ้างอิงเสียง (.wav) ใช้เฉพาะตอนเรียก XTTS"
    )
    ap.add_argument(
        "--ref_text",
        required=True,
        help="ข้อความอ้างอิงสำหรับ F5 (สั้น ๆ พอ เช่น 'ครับ'/'รับทราบค่ะ')",
    )
    ap.add_argument("--out_f5", default="out_f5.wav", help="ไฟล์ผลลัพธ์จาก F5")
    ap.add_argument(
        "--out_xtts", default="out_xtts_clone.wav", help="ไฟล์ผลลัพธ์จาก XTTS (clone)"
    )
    # Gen params (ให้ตรงกับฝั่งเซิร์ฟเวอร์ของคุณ)
    ap.add_argument("--cross_fade", type=float, default=0.15)
    ap.add_argument("--nfe_step", type=int, default=32)
    ap.add_argument("--speed", type=float, default=1.0)
    ap.add_argument("--cfg_strength", type=float, default=2.0)
    ap.add_argument("--max_chars", type=int, default=300)
    # misc
    ap.add_argument("--timeout", type=float, default=180.0, help="HTTP timeout (sec)")

    args = ap.parse_args()

    if not os.path.isfile(args.ref_wav):
        raise FileNotFoundError(f"--ref_wav not found: {args.ref_wav}")

    # ---------- STEP A: F5 TTS (ต้องส่ง ref_text) ----------
    # ---------- STEP A: F5 TTS (ต้องส่ง ref_text + speaker_wav) ----------
    f5_data = {
        "text": args.text,
        "language": "th",
        "ref_text": args.ref_text,
        "cross_fade": str(args.cross_fade),
        "nfe_step": str(args.nfe_step),
        "speed": str(args.speed),
        "cfg_strength": str(args.cfg_strength),
        "max_chars": str(args.max_chars),
    }
    f5_files = {
        "speaker_wav": (
            os.path.basename(args.ref_wav),
            open(args.ref_wav, "rb"),
            "audio/wav",
        )
    }

    t0 = time.time()
    try:
        f5_wav = post_expect_wav(
            args.f5_url, f5_data, files=f5_files, timeout=args.timeout
        )
    finally:
        try:
            f5_files["speaker_wav"][1].close()
        except Exception:
            pass
    t1 = time.time()
    with open(args.out_f5, "wb") as f:
        f.write(f5_wav)
    print(
        f"✅ F5 saved: {args.out_f5}  size={len(f5_wav)} bytes  latency≈{(t1 - t0)*1000:.0f} ms"
    )

    # ---------- STEP B: XTTS CLONE (ไม่ใช้ ref_text) ----------
    xtts_data = {
        "text": args.text,  # ข้อความเดียวกับ F5
        "language": args.language,  # ปกติ 'th'
    }
    xtts_files = {
        "speaker_wav": (
            os.path.basename(args.ref_wav),
            open(args.ref_wav, "rb"),
            "audio/wav",
        )
    }

    try:
        t2 = time.time()
        xtts_wav = post_expect_wav(
            args.xtts_url, xtts_data, files=xtts_files, timeout=args.timeout
        )
        t3 = time.time()
    finally:
        try:
            xtts_files["speaker_wav"][1].close()
        except Exception:
            pass

    with open(args.out_xtts, "wb") as f:
        f.write(xtts_wav)
    print(
        f"✅ XTTS(clone) saved: {args.out_xtts}  size={len(xtts_wav)} bytes  latency≈{(t3 - t2)*1000:.0f} ms"
    )


if __name__ == "__main__":
    main()
