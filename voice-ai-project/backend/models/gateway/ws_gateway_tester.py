#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Single-shot Gateway Tester
- เปิด 2 websocket เป็นผู้ฟัง (listener) และผู้พูด (speaker)
- listener: ตั้ง target_lang + (option) speaker_url
- speaker : อ่านไฟล์ .wav → แปลงเป็น mono/16k/s16le → ส่งทีละเฟรม 20ms
- รับ TTS chunks จาก listener → รวมเป็น out.wav
- พิมพ์ดีบัคทั้งหมด (stt/mt/metrics/tts/debug) + timing

Usage (PowerShell):
python .\ws_gateway_tester.py `
  --gw ws://localhost:8010/ws/voice `
  --room 1 `
  --in-wav 290.wav `
  --tgt ja `
  --speaker-url http://web:8000/static/song/xtts/01.wav `
  --out gw_out `
  --recv-timeout-s 60
"""
import argparse, asyncio, json, os, sys, wave, io, time, struct
from pathlib import Path

# ต้องใช้ websockets (pip install websockets)
import websockets

# audioop ใช้แปลง SR/mono/width (standard library)
import audioop

# ---------------------------- Utils (audio) ----------------------------
def read_wav(path: str):
    with wave.open(path, "rb") as wf:
        n_channels = wf.getnchannels()
        sampwidth  = wf.getsampwidth()  # bytes per sample
        fr         = wf.getframerate()
        nframes    = wf.getnframes()
        pcm        = wf.readframes(nframes)
    return pcm, fr, n_channels, sampwidth

def to_mono_16bit_16k(pcm: bytes, sr: int, ch: int, sw: int):
    # 1) to 16-bit
    if sw != 2:
        pcm = audioop.lin2lin(pcm, sw, 2)
        sw  = 2
    # 2) to mono
    if ch == 2:
        pcm = audioop.tomono(pcm, 2, 0.5, 0.5)  # average L/R
        ch  = 1
    elif ch != 1:
        # ไม่รองรับ ch อื่น ๆ
        raise ValueError(f"Unsupported channels={ch}")
    # 3) resample to 16k
    if sr != 16000:
        pcm, _ = audioop.ratecv(pcm, 2, 1, sr, 16000, None)
        sr = 16000
    return pcm, sr, 1, 2

def chunk_pcm_20ms(pcm16: bytes, sample_rate=16000, frame_ms=20):
    # 16-bit mono: 2 bytes/sample
    samples_per_frame = int(sample_rate * frame_ms / 1000)  # 320 @ 16k/20ms
    bytes_per_frame   = samples_per_frame * 2                # 640 bytes
    chunks = []
    i = 0
    n = len(pcm16)
    while i + bytes_per_frame <= n:
        chunks.append(pcm16[i:i+bytes_per_frame])
        i += bytes_per_frame
    tail = pcm16[i:]
    return chunks, tail  # tail ทิ้งไป (จำลองเหมือน client จริง ๆ)

def wav_bytes_to_pcm(wav_bytes: bytes):
    """รับ micro-WAV → คืน (pcm_s16le, sample_rate)."""
    with wave.open(io.BytesIO(wav_bytes), "rb") as wf:
        ch = wf.getnchannels()
        sw = wf.getsampwidth()
        sr = wf.getframerate()
        n  = wf.getnframes()
        pcm = wf.readframes(n)
    # ป้องกันเคสโมดูลส่ง 24-bit/32-bit (ไม่น่าเกิดกับ XTTS v2 ที่ตั้งไว้)
    if sw != 2:
        pcm = audioop.lin2lin(pcm, sw, 2)
    if ch == 2:
        pcm = audioop.tomono(pcm, 2, 0.5, 0.5)
    return pcm, sr

def write_wav(out_path: str, pcm16: bytes, sample_rate=24000):
    out_dir = Path(out_path).parent
    out_dir.mkdir(parents=True, exist_ok=True)
    with wave.open(out_path, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        wf.writeframes(pcm16)

def wav_info_from_pcm(pcm16: bytes, sr: int):
    # Basic RMS/peak info
    if not pcm16:
        return {"frames": 0, "duration_sec": 0.0}
    # unpack to ints
    count = len(pcm16) // 2
    ints = struct.unpack("<" + "h"*count, pcm16)
    peak = max(abs(x) for x in ints) if ints else 0
    # RMS
    s2 = sum(x*x for x in ints)
    rms = (s2 / max(len(ints),1))**0.5 if ints else 0.0
    return {
        "frames": count,
        "duration_sec": round(count / sr, 3),
        "rms": round(rms, 2),
        "peak": peak,
    }

# ---------------------------- WS helpers ----------------------------
async def recv_json_or_bin(ws, timeout=None):
    msg = await asyncio.wait_for(ws.recv(), timeout=timeout)
    if isinstance(msg, (bytes, bytearray)):
        return None, bytes(msg)
    try:
        return json.loads(msg), None
    except Exception:
        return None, None

# ---------------------------- Main runner ----------------------------
async def run_once(gw_url: str, room: str, in_wav: str, tgt: str,
                   speaker_url: str|None, out_dir: str, recv_timeout_s: int,
                   save_chunks_dir: str|None, quiet: bool):
    # เตรียมเสียงอินพุต
    raw, sr, ch, sw = read_wav(in_wav)
    pcm16, sr2, ch2, sw2 = to_mono_16bit_16k(raw, sr, ch, sw)
    frames = len(pcm16)//2
    chunks, tail = chunk_pcm_20ms(pcm16, 16000, 20)

    if not quiet:
        print("=== Single-shot ===")
        print(f"GW            : {gw_url}")
        print(f"Room          : {room}")
        print(f"In WAV        : {in_wav}  ({len(chunks)} x 20ms)")
        print(f"Target Lang   : {tgt}")
        print(f"Speaker URL   : {speaker_url or '-'}")
        print(f"Output        : {Path(out_dir)/'out.wav'}")
        print("Prep          : OK\n")

    # เปิดสอง WS เชื่อมกับ /ws/voice
    async with websockets.connect(gw_url, max_size=32*1024*1024) as ws_listener, \
               websockets.connect(gw_url, max_size=32*1024*1024) as ws_speaker:

        # 1) HELLO ฝั่ง listener
        hello_l = {"type":"hello", "userId":"user_listener", "roomId":str(room)}
        await ws_listener.send(json.dumps(hello_l))
        if not quiet: print("[L] ->", hello_l)
        js, _ = await recv_json_or_bin(ws_listener, timeout=10)
        if not js or js.get("type")!="hello_ok":
            raise RuntimeError("listener hello_ok timeout/invalid")
        if not quiet: print("[L]", js)

        # ตั้ง target & speaker_url (optional)
        await ws_listener.send(json.dumps({"type":"set_target_lang","value":tgt}))
        if speaker_url:
            await ws_listener.send(json.dumps({"type":"set_speaker_url","value":speaker_url}))
        # 2) HELLO ฝั่ง speaker
        hello_s = {"type":"hello", "userId":"user_speaker", "roomId":str(room)}
        await ws_speaker.send(json.dumps(hello_s))
        if not quiet: print("[S] ->", hello_s)
        js2, _ = await recv_json_or_bin(ws_speaker, timeout=10)
        if not js2 or js2.get("type")!="hello_ok":
            raise RuntimeError("speaker hello_ok timeout/invalid")
        if not quiet: print("[S]", js2)

        # 3) กำหนด task รับ message จาก listener (TT S chunks, debug, metrics ฯลฯ)
        tts_pcm_acc   = bytearray()
        tts_sr        = None
        tts_started   = False
        tts_done      = False
        first_tts_ts  = None

        # option บันทึก chunks ทีละไฟล์
        if save_chunks_dir:
            Path(save_chunks_dir).mkdir(parents=True, exist_ok=True)
            for p in Path(save_chunks_dir).glob("*.wav"):
                try: p.unlink()
                except: pass
        chunk_counter = 0

        async def listener_recv():
            nonlocal tts_pcm_acc, tts_sr, tts_started, tts_done, first_tts_ts, chunk_counter
            while True:
                js, b = await recv_json_or_bin(ws_listener, timeout=recv_timeout_s)
                if b is not None:
                    # binary ของ tts_chunk
                    try:
                        pcm, sr = wav_bytes_to_pcm(b)
                        if tts_sr is None:
                            tts_sr = sr
                        # resample รวมเป็น sr เดียว (ไม่น่าจำเป็น แต่กันไว้)
                        if sr != tts_sr:
                            pcm, _ = audioop.ratecv(pcm, 2, 1, sr, tts_sr, None)
                        tts_pcm_acc += pcm
                        # save chunk file ถ้าต้องการ
                        if save_chunks_dir:
                            outp = Path(save_chunks_dir)/f"chunk_{chunk_counter:03d}.wav"
                            write_wav(str(outp), pcm, sr)
                        chunk_counter += 1
                    except Exception as e:
                        if not quiet: print("[L] ! binary decode error:", e)
                    continue

                if not js:
                    if not quiet: print("[L] ! invalid message")
                    continue

                t = js.get("type")
                if t == "stt_final":
                    if not quiet: print("[L]", js)
                elif t == "mt_final":
                    if not quiet: print("[L]", js)
                elif t == "metrics":
                    if not quiet: print("[L]", js)
                elif t == "tts_start":
                    tts_started = True
                    if not quiet: print("[L]", js)
                elif t == "tts_chunk":
                    # header ของ chunk ต่อไป → บอกว่าจะมี binary ตามมา
                    if first_tts_ts is None:
                        first_tts_ts = time.time()
                    if not quiet: print("[L]", js)
                elif t == "tts_end":
                    if not quiet: print("[L]", js)
                    tts_done = True
                    return
                elif t == "debug":
                    if not quiet: print("[L][debug]", js)
                elif t == "error":
                    print("[L][error]", js)
                else:
                    if not quiet: print("[L]", js)

        recv_task = asyncio.create_task(listener_recv())

        # 4) ส่งเสียงจาก speaker
        # ส่งติดต่อกันรวดเดียว (single shot)
        t_send0 = time.time()
        for i, frame in enumerate(chunks):
            hdr = {
                "type": "audio_chunk",
                "seq": i,
                "format": "pcm_s16le",
                "sampleRate": 16000,
                "durationMs": 20
            }
            await ws_speaker.send(json.dumps(hdr))
            await ws_speaker.send(frame)
            if not quiet and (i < 3 or i >= len(chunks)-3):
                print(f"[S] -> {hdr}  + {len(frame)} bytes")
        t_send1 = time.time()

        # 5) รอจน tts_end หรือ timeout
        try:
            await asyncio.wait_for(recv_task, timeout=recv_timeout_s)
        except asyncio.TimeoutError:
            print("[L] TIMEOUT waiting for gateway messages")

        # 6) เซฟผลลัพธ์
        out_dir = Path(out_dir)
        out_dir.mkdir(parents=True, exist_ok=True)
        out_path = out_dir / "out.wav"

        if tts_pcm_acc and tts_sr:
            write_wav(str(out_path), bytes(tts_pcm_acc), tts_sr)
            info = wav_info_from_pcm(bytes(tts_pcm_acc), tts_sr)
            print(f"\nSaved: {out_path}")
            print("WAV Info:", {"sample_rate": tts_sr, **info})
        else:
            print("\n[ERR] No TTS audio received")

        # 7) timing
        print("\n=== Timing ===")
        print(f"Send duration    : {int((t_send1 - t_send0)*1000)} ms")
        if first_tts_ts is not None:
            print(f"First TTS latency: {int((first_tts_ts - t_send1)*1000)} ms after send")
        else:
            print("First TTS latency: (none)")
        print(f"Recv total       : {int((time.time() - t_send1)*1000)} ms")

        # ปิด WS
        try: await ws_listener.close()
        except: pass
        try: await ws_speaker.close()
        except: pass


def parse_args():
    p = argparse.ArgumentParser(description="Single-shot Voice Gateway Tester")
    p.add_argument("--gw", required=True, help="ws://host:port/ws/voice")
    p.add_argument("--room", required=True, help="room id")
    p.add_argument("--in-wav", required=True, help="input wav (user speech)")
    p.add_argument("--tgt", required=True, help="target language code (e.g., ja)")
    p.add_argument("--speaker-url", default=None, help="fallback speaker_url (when cloning fails)")
    p.add_argument("--out", default="gw_out", help="output dir (default: gw_out)")
    p.add_argument("--recv-timeout-s", type=int, default=30, help="listen timeout (default 30s)")
    p.add_argument("--save-chunks-dir", default=None, help="save each micro-wav chunk to this dir")
    p.add_argument("--quiet", action="store_true", help="less verbose")
    return p.parse_args()

if __name__ == "__main__":
    args = parse_args()
    try:
        asyncio.run(
            run_once(
                args.gw, args.room, args.in_wav, args.tgt,
                args.speaker_url, args.out, args.recv_timeout_s,
                args.save_chunks_dir, args.quiet
            )
        )
    except KeyboardInterrupt:
        print("\nInterrupted.")
