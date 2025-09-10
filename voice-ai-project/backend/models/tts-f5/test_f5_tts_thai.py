# test_f5_tts_thai.py
# ใช้ F5-TTS-THAI สร้างเสียงจากข้อความ + (ออปชัน) clone จาก reference.wav
# ผลลัพธ์บันทึก .wav ออกมาให้ฟังทันที (ยังไม่ยุ่ง Docker)

import argparse
import io
import sys
import random
import soundfile as sf
from cached_path import cached_path

# === อิมพอร์ตจากโปรเจกต์ F5-TTS-THAI ภายใน src/f5_tts ===
from f5_tts.infer.utils_infer import (
    infer_process,
    load_model,
    load_vocoder,
    preprocess_ref_audio_text,
)
from f5_tts.model import DiT
from f5_tts.model.utils import seed_everything
from f5_tts.cleantext.number_tha import replace_numbers_with_thai
from f5_tts.cleantext.th_repeat import process_thai_repeat

DEFAULT_MODEL_BASE = "hf://VIZINTZOR/F5-TTS-THAI/model_1000000.pt"
VOCAB_DEFAULT = "./vocab/vocab.txt"
VOCAB_IPA     = "./vocab/vocab_ipa.txt"

def load_f5tts(ckpt_path: str, use_ipa: bool):
    # v1 = Default, v2/IPA = True (ตามโค้ด webui)
    if use_ipa:
        cfg = dict(dim=1024, depth=22, heads=16, ff_mult=2, text_dim=512,
                   text_mask_padding=True, conv_layers=4, pe_attn_head=None)
        vocab = VOCAB_IPA
    else:
        cfg = dict(dim=1024, depth=22, heads=16, ff_mult=2, text_dim=512,
                   text_mask_padding=False, conv_layers=4, pe_attn_head=1)
        vocab = VOCAB_DEFAULT
    model = load_model(DiT, cfg, ckpt_path, vocab_file=vocab, use_ema=True)
    return model

def synthesize(args):
    # seed
    seed = args.seed if args.seed is not None else random.randint(0, sys.maxsize)
    seed_everything(seed)

    # โหลดโมเดล + vocoder
    ckpt = str(cached_path(args.model if args.model else DEFAULT_MODEL_BASE))
    model = load_f5tts(ckpt, use_ipa=args.ipa)
    vocoder = load_vocoder()

    # เตรียมข้อความ
    if not args.text or not args.text.strip():
        raise ValueError("กรุณาใส่ --text ข้อความที่จะสังเคราะห์")

    # preprocessing ข้อความไทย
    gen_text_cleaned = process_thai_repeat(replace_numbers_with_thai(args.text.strip()))

    # เตรียม reference (ออปชัน)
    ref_audio = None
    ref_text = args.ref_text or ""
    if args.ref_wav:
        ref_audio, ref_text = preprocess_ref_audio_text(args.ref_wav, ref_text)

    # infer
    final_wave, final_sr, _ = infer_process(
        ref_audio,
        ref_text,
        gen_text_cleaned,
        model,
        vocoder,
        cross_fade_duration=float(args.cross_fade),   # << มีพารามิเตอร์นี้แล้ว
        nfe_step=int(args.nfe_step),
        speed=float(args.speed),
        cfg_strength=float(args.cfg_strength),
        set_max_chars=int(args.max_chars),
        use_ipa=bool(args.ipa),
        progress=None,   # << แก้จาก print เป็น None     
    )

    # บันทึกไฟล์
    out = args.out or "output_thai.wav"
    sf.write(out, final_wave, final_sr)
    print(f"✅ Done. Saved: {out}  (seed={seed}, sr={final_sr})")

def main():
    ap = argparse.ArgumentParser(description="F5-TTS-THAI quick test (CLI)")
    ap.add_argument("--text", required=True, help="ข้อความที่จะสังเคราะห์ (ไทย)")
    ap.add_argument("--ref_wav", default=None, help="ไฟล์อ้างอิงเสียง (.wav) สำหรับ cloning (ออปชัน)")
    ap.add_argument("--ref_text", default="", help="คำพูดในไฟล์อ้างอิง (ช่วย alignment เล็กน้อย)")

    ap.add_argument("--out", default="output_thai.wav", help="ไฟล์ผลลัพธ์ .wav")
    ap.add_argument("--model", default=None, help="พาธ ckpt เช่น hf://VIZINTZOR/F5-TTS-THAI/model_1000000.pt")

    # ===== พารามิเตอร์สังเคราะห์ =====
    ap.add_argument("--cross_fade", type=float, default=0.15, help="Cross-fade duration (sec)")
    ap.add_argument("--nfe_step", type=int, default=32, help="คุณภาพ/ความเร็ว (มาก=คุณภาพดีขึ้นแต่ช้าลง)")
    ap.add_argument("--speed", type=float, default=1.0, help="ความเร็วพูด")
    ap.add_argument("--cfg_strength", type=float, default=2.0, help="CFG strength")
    ap.add_argument("--max_chars", type=int, default=300, help="แบ่งข้อความยาวเป็นช่วงละกี่ตัวอักษร")
    ap.add_argument("--ipa", action="store_true", help="เปิดโหมด IPA (ใช้กับโมเดล V2)")
    ap.add_argument("--seed", type=int, default=None, help="กำหนด seed (ค่าเดิมสุ่ม)")

    args = ap.parse_args()
    synthesize(args)

if __name__ == "__main__":
    main()
