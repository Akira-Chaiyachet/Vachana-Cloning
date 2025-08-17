# backend/models/gateway/main.py
import os
import io
import wave
import uuid
import json
import asyncio
import time
from typing import Dict, Any, List, Optional, Set

import httpx
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from starlette.websockets import WebSocketState
import webrtcvad  # NEW
import array

"""
ENV
STT_URL = http://stt:8000/stt
MT_URL  = http://mt:8000/mt
TTS_URL = http://tts:8000/tts
TTS_CONCURRENCY = 1            # จำกัดงาน TTS พร้อมกันทั้งระบบ (ต่อตัว gateway)
MT_CONCURRENCY  = 4            # Optional: จำกัดงาน MT พร้อมกัน
"""

# --- VAD / endpointing parameters (ปรับได้ตามจริง) ---
VAD_MODE = 2                 # 0=หลวม 3=เข้ม (2 เป็นกลาง ๆ)
VAD_FRAME_MS = 20            # ต้องเป็น 10/20/30 ms (เราใช้ 20ms ตรงกับ BYTES_PER_FRAME)
START_VOICED_FRAMES = 3      # ต้องเจอเสียงจริงติดกัน >= 3 เฟรม (~60ms) ถึงเริ่ม “พูด”
STOP_SILENCE_FRAMES = 6      # เจอเงียบติดกัน >= 6 เฟรม (~120ms) ถึง “ตัด”
MAX_SEGMENT_MS = 3000        # กันยาวไป: ตัดสูงสุด 3s
COOLDOWN_MS = 250            # พูดเสร็จ รอ 250ms ก่อนเริ่ม segment ใหม่ (กันสั่น)

# เสริม gate พลังงานหยาบ ๆ กัน noise เบา ๆ
ENERGY_ABS_GATE = 150        # ถ้าค่าเฉลี่ย abs(sample) < gate จะถือว่าเงียบ แม้ VAD บอกเป็นเสียง

STT_URL = os.getenv("STT_URL", "http://stt:8000/stt")
MT_URL  = os.getenv("MT_URL",  "http://mt:8000/mt")
TTS_URL = os.getenv("TTS_URL", "http://tts:8000/tts")

TTS_CONCURRENCY = int(os.getenv("TTS_CONCURRENCY", "1"))
MT_CONCURRENCY  = int(os.getenv("MT_CONCURRENCY", "4"))

# audio framing
SAMPLE_RATE = 16000
FRAME_MS = 20
SAMPLES_PER_FRAME = int(SAMPLE_RATE * FRAME_MS / 1000)  # 320
BYTES_PER_FRAME = SAMPLES_PER_FRAME * 2  # s16le

# segmentation heuristic
SEGMENT_MIN_MS = 600
SEGMENT_TARGET_MS = 1200
SILENCE_TAIL_MS = 200
SILENCE_LEVEL = 60

app = FastAPI()
APP_VERSION = "gw-2025-08-11T-https-ready-q-per-user"

@app.get("/version")
def version():
    import pathlib
    return {"ok": True, "version": APP_VERSION, "pwd": str(pathlib.Path('.').resolve()), "file": __file__}

@app.get("/health")
def health():
    return {"ok": True}

# ---------- utils ----------
async def pcm_to_wav_bytes(pcm: bytes, sample_rate=SAMPLE_RATE) -> bytes:
    bio = io.BytesIO()
    with wave.open(bio, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        wf.writeframes(pcm)
    return bio.getvalue()

def avg_abs_pcm(pcm: bytes) -> float:
    """ค่าเฉลี่ยของ |sample| สำหรับ PCM s16le (mono)"""
    a = array.array("h")
    a.frombytes(pcm)
    if not a:
        return 0.0
    return sum(abs(x) for x in a) / len(a)

def is_silence(pcm: bytes) -> bool:
    import array
    arr = array.array("h"); arr.frombytes(pcm)
    if not arr:
        return True
    avg = sum(abs(x) for x in arr) / len(arr)
    return avg < SILENCE_LEVEL

def _norm_lang(code: str) -> str:
    if not code:
        return "en"
    c = code.lower().replace("-", "_")
    mapping = {
        "zh": "zh-cn", "zh_cn": "zh-cn", "zh_tw": "zh-cn",  # map ไป zh-cn สำหรับ XTTS v2
        "jp": "ja"
    }
    return mapping.get(c, c)

# httpx timeouts
HTTP_TIMEOUT_STT = httpx.Timeout(connect=5.0, read=60.0, write=30.0, pool=5.0)
HTTP_TIMEOUT_MT  = httpx.Timeout(connect=5.0, read=30.0, write=15.0, pool=5.0)
HTTP_TIMEOUT_TTS = httpx.Timeout(connect=5.0, read=90.0, write=30.0, pool=5.0)

MT_SEM  = asyncio.Semaphore(MT_CONCURRENCY)
TTS_SEM = asyncio.Semaphore(TTS_CONCURRENCY)

# ---------- service calls ----------
async def call_stt(wav_bytes: bytes, lang_hint: Optional[str] = None):
    try:
        async with httpx.AsyncClient(timeout=HTTP_TIMEOUT_STT) as client:
            files = {"file": ("seg.wav", wav_bytes, "audio/wav")}
            data = {"language": (lang_hint if lang_hint else "auto")}
            r = await client.post(STT_URL, files=files, data=data)
            r.raise_for_status()
            js = r.json()
            return js.get("text", ""), js.get("detected_lang")
    except (httpx.TimeoutException, httpx.HTTPError):
        return "", None

async def call_mt(text: str, src_lang: str, tgt_lang: str) -> str:
    if not text.strip():
        return ""
    try:
        async with MT_SEM:
            async with httpx.AsyncClient(timeout=HTTP_TIMEOUT_MT) as client:
                payload = {"text": text, "src_lang": src_lang, "tgt_lang": tgt_lang}
                r = await client.post(MT_URL, json=payload)
                r.raise_for_status()
                js = r.json()
                return js.get("translation", "")
    except (httpx.TimeoutException, httpx.HTTPError):
        return ""
# เพิ่มฟังก์ชันใหม่ (อย่าแทนที่ของเดิม เผื่อใช้ url ได้ด้วย)
async def call_tts_wav_with_ref(text: str, language: str, speaker_wav_bytes: bytes) -> bytes:
    if not text.strip():
        return b""
    try:
        async with httpx.AsyncClient(timeout=HTTP_TIMEOUT_TTS) as client:
            data = {"text": text, "language": _norm_lang(language)}
            # multipart: ส่ง reference wav ไปใน field 'speaker_wav'
            files = {"speaker_wav": ("ref.wav", speaker_wav_bytes, "audio/wav")}
            r = await client.post(TTS_URL, data=data, files=files)
            r.raise_for_status()
            return r.content
    except (httpx.TimeoutException, httpx.HTTPError):
        return b""


async def call_tts_wav(text: str, language: str, speaker_url: Optional[str] = None) -> bytes:
    if not text.strip():
        return b""
    try:
        async with httpx.AsyncClient(timeout=HTTP_TIMEOUT_TTS) as client:
            data = {"text": text, "language": _norm_lang(language)}
            if speaker_url:
                data["speaker_url"] = speaker_url       # << สำคัญ
            r = await client.post(TTS_URL, data=data)   # (ถ้าอัปไฟล์ ให้ใช้ files=... แทน)
            r.raise_for_status()
            return r.content
    except (httpx.TimeoutException, httpx.HTTPError):
        return b""


# ---------- session / hub ----------
class Session:
    def __init__(self, ws: WebSocket, user_id: str, room_id: str):
        self.ws = ws
        self.user_id = user_id
        self.room_id = room_id
        self.target_lang: str = "off"     # per-listener
        self.source_lang: str = "auto"    # per-speaker
        self.seq_in = 0
        self.vad = webrtcvad.Vad(VAD_MODE)
        self.talking = False
        self.voiced_run = 0
        self.silence_run = 0
        self.seg_start_ms = 0
        self.cooldown_until = 0.0

        # raw audio buffer for endpointing
        self.buf = bytearray()
        self.ms_acc = 0
        self.last_voice_ts = time.time()

        self.ws_lock = asyncio.Lock()
        self.alive = True

        # per-listener job queue + worker
        self.job_queue: asyncio.Queue = asyncio.Queue()
        self.last_enqueued_seq: int = 0
        self.worker_task: Optional[asyncio.Task] = asyncio.create_task(listener_worker(self))
        self.speaker_url: Optional[str] = None

    async def safe_send_json(self, obj: Dict[str, Any]):
        if not self.alive: return
        try:
            if self.ws.application_state != WebSocketState.CONNECTED:
                self.alive = False
                return
        except Exception:
            self.alive = False
            return
        try:
            async with self.ws_lock:
                await self.ws.send_text(json.dumps(obj))
        except Exception:
            self.alive = False

    async def safe_send_tts_chunk(self, header: Dict[str, Any], chunk: bytes):
        if not self.alive: return
        header = dict(header); header["expectBinary"] = True
        try:
            async with self.ws_lock:
                await self.ws.send_text(json.dumps(header))
                await self.ws.send_bytes(chunk)
        except Exception:
            self.alive = False

    async def close(self):
        self.alive = False
        try:
            if self.worker_task:
                self.worker_task.cancel()
        except:
            pass

class RoomHub:
    def __init__(self):
        self.rooms: Dict[str, Set[Session]] = {}
        self._lock = asyncio.Lock()

    async def join(self, s: Session):
        async with self._lock:
            self.rooms.setdefault(s.room_id, set()).add(s)

    async def leave(self, s: Session):
        async with self._lock:
            if s.room_id in self.rooms:
                self.rooms[s.room_id].discard(s)
                if not self.rooms[s.room_id]:
                    self.rooms.pop(s.room_id, None)

    def listeners(self, room_id: str) -> List[Session]:
        return list(self.rooms.get(room_id, []))

hub = RoomHub()

# ---------- streaming to one listener ----------
async def stream_wav_in_chunks(session: Session, segment_id: str, wav_bytes: bytes, chunk_ms=200):
    if not session.alive or not wav_bytes:
        return
    with wave.open(io.BytesIO(wav_bytes), "rb") as wf:
        n_channels = wf.getnchannels(); assert n_channels == 1, "Expect mono wav"
        sampwidth = wf.getsampwidth(); assert sampwidth == 2, "Expect s16le"
        fr = wf.getframerate()
        n_frames = wf.getnframes()

        frames_per_chunk = int(fr * (chunk_ms / 1000.0))
        total_chunks = max(1, (n_frames + frames_per_chunk - 1) // frames_per_chunk)

        for i in range(total_chunks):
            if not session.alive:
                break
            frames = wf.readframes(frames_per_chunk)
            part_wav = await pcm_to_wav_bytes(frames, sample_rate=fr)
            header = {
                "type": "tts_chunk",
                "segmentId": segment_id,
                "chunkIndex": i,
                "format": "wav",
                "sampleRate": fr,
            }
            await session.safe_send_tts_chunk(header, part_wav)

        await session.safe_send_json({"type": "tts_end", "segmentId": segment_id, "totalChunks": total_chunks})

# ---------- per-listener worker ----------
async def listener_worker(session: Session):
    """
    Worker ประจำ "ผู้ฟังคนนั้น" ดึงงาน MT→TTS ของเขาเองเท่านั้น
    ใช้ supersede โดยดู job.seq < session.last_enqueued_seq เพื่อทิ้งงานเก่า
    """
    try:
        while True:
            job = await session.job_queue.get()
            try:
                # ถ้ามีงานใหม่กว่าทับแล้ว ให้ทิ้ง
                if job["seq"] < session.last_enqueued_seq or not session.alive:
                    continue

                # 1) MT
                t2a = time.time()
                mt_text = await call_mt(job["stt_text"], job["src_lang"], job["tgt_lang"])
                t2b = time.time()
                if not session.alive or job["seq"] < session.last_enqueued_seq:
                    continue
                if not mt_text or not mt_text.strip():
                        # ถ้าแปลได้ว่าง ๆ ก็ไม่ต้อง TTS
                    continue
    
                await session.safe_send_json({
                    "type": "mt_final",
                    "segmentId": job["segment_id"],
                    "srcLang": job["src_lang"],
                    "tgtLang": job["tgt_lang"],
                    "text": mt_text
                })
                await session.safe_send_json({
                    "type": "metrics",
                    "segmentId": job["segment_id"],
                    "latencyMs": {
                        "stt": job["stt_ms"],
                        "mt":  int((t2b - t2a) * 1000),
                        "tts": 0,
                        "e2e": job["stt_ms"] + int((t2b - t2a) * 1000)
                    }
                })

                # 2) TTS
                # ภายใน listener_worker ก่อน/หลังเรียก TTS
                t3a = time.time()
                wav_tgt = b""
                ref_wav = job.get("speaker_wav")
                path_used = "none"

                async with TTS_SEM:
                    use_ref = False
                    if ref_wav:
                        try:
                            with wave.open(io.BytesIO(ref_wav), "rb") as wf:
                                sr = wf.getframerate(); n = wf.getnframes()
                                dur_ms = (n / max(sr,1)) * 1000.0
                                use_ref = dur_ms >= 600.0
                        except Exception:
                            use_ref = False

                    if use_ref:
                        wav_tgt = await call_tts_wav_with_ref(mt_text, language=job["tgt_lang"], speaker_wav_bytes=ref_wav)
                        if wav_tgt: path_used = "speaker_wav_ref"

                    if not wav_tgt and session.speaker_url:
                        wav_tgt = await call_tts_wav(mt_text, language=job["tgt_lang"], speaker_url=session.speaker_url)
                        if wav_tgt: path_used = "speaker_url"

                    if not wav_tgt:
                        wav_tgt = await call_tts_wav(mt_text, language=job["tgt_lang"])
                        if wav_tgt: path_used = "default"

                t3b = time.time()

                # ส่ง log ช่วยดีบัคกลับ client (หรือ print server-side ก็ได้)
                await session.safe_send_json({
                    "type": "debug",
                    "segmentId": job["segment_id"],
                    "ttsPath": path_used,
                    "refMsGE600": bool(use_ref),
                })

                if not session.alive or job["seq"] < session.last_enqueued_seq:
                    continue

                await session.safe_send_json({"type": "tts_start", "segmentId": job["segment_id"]})
                await session.safe_send_json({
                    "type": "metrics",
                    "segmentId": job["segment_id"],
                    "latencyMs": {
                        "stt": job["stt_ms"],
                        "mt":  int((t2b - t2a) * 1000),
                        "tts": int((t3b - t3a) * 1000),
                        "e2e": job["stt_ms"] + int((t2b - t2a) * 1000) + int((t3b - t3a) * 1000)
                    }
                })

                if wav_tgt:                              
                    await stream_wav_in_chunks(session, job["segment_id"], wav_tgt, chunk_ms=340)



            finally:
                session.job_queue.task_done()
    except asyncio.CancelledError:
        return
def normalize_speaker_url(url: str) -> Optional[str]:
    if not url:
        return None
    url = url.strip()
    # ถ้าฝั่งเว็บส่งมาเป็น path เช่น /media/voices/u123.wav → ชี้ไปที่ web service ภายใน docker
    if url.startswith("/media/"):
        return f"http://web:8000{url}"
    # ถ้าเป็น https://<host>/media/... ให้บังคับวิ่งภายใน network เพื่อเลี่ยง cert/self-signed
    try:
        from urllib.parse import urlparse
        u = urlparse(url)
        if u.path.startswith("/media/"):
            return f"http://web:8000{u.path}"
    except Exception:
        pass
    return url

# ---------- pipeline for each spoken segment ----------
async def process_segment_and_broadcast(speaker: Session, pcm: bytes):
    if not speaker.alive:
        return

    segment_id = f"seg-{uuid.uuid4().hex[:8]}"
    wav_bytes = await pcm_to_wav_bytes(pcm, SAMPLE_RATE)

    # --- STT (ของ "ผู้พูด") ---
    t0 = time.time()
    lang_hint = None if speaker.source_lang == "auto" else speaker.source_lang
    stt_text, detected = await call_stt(wav_bytes, lang_hint=lang_hint)
    t1 = time.time()
    stt_ms = int((t1 - t0) * 1000)

    # src effective
    effective_src = speaker.source_lang
    if speaker.source_lang == "auto" and detected:
        effective_src = detected

    # แจ้ง STT ให้ทุกคน (แม้ว่าง เพื่อ UI จัดการ)
    listeners = hub.listeners(speaker.room_id)
    await asyncio.gather(*[
        s.safe_send_json({
            "type": "stt_final",
            "segmentId": segment_id,
            "speakerId": speaker.user_id,
            "t0": 0.0, "t1": 0.0,
            "text": stt_text,
            "lang": effective_src
        })
        for s in listeners
    ], return_exceptions=True)

    # ถ้า STT ว่าง → ส่ง metrics เฉพาะ STT แล้วจบ
    if not stt_text or len(stt_text.strip()) < 2:
        # แจ้ง metrics STT แล้วจบ
        for s in listeners:
            await s.safe_send_json({
                "type": "metrics",
                "segmentId": segment_id,
                "latencyMs": {"stt": int((t1 - t0)*1000), "mt": 0, "tts": 0, "e2e": int((t1 - t0)*1000)}
            })
        return
    
    # --- ต่อหูคนฟังทีละคน (คิวของเขาเอง) ---
    for s in listeners:
        if not s.alive:
            continue

        # ผู้พูดเอง: จบที่ STT metrics
        if s.user_id == speaker.user_id:
            await s.safe_send_json({
                "type": "metrics",
                "segmentId": segment_id,
                "latencyMs": {"stt": stt_ms, "mt": 0, "tts": 0, "e2e": stt_ms}
            })
            continue

        tgt = s.target_lang
        if not tgt or tgt == "off":
            # ไม่ต้องแปล
            await s.safe_send_json({
                "type": "metrics",
                "segmentId": segment_id,
                "latencyMs": {"stt": stt_ms, "mt": 0, "tts": 0, "e2e": stt_ms}
            })
            continue

        # supersede: เพิ่ม seq ใหม่ และ “ถือว่า” งานก่อนหน้าล้าสมัย
        s.last_enqueued_seq += 1
        job = {
            "seq": s.last_enqueued_seq,
            "segment_id": segment_id,
            "stt_text": stt_text,
            "src_lang": (effective_src or "en"),
            "tgt_lang": tgt,
            "stt_ms": stt_ms,
            "speaker_wav": wav_bytes,   # <<<< ใส่ไปด้วย (เสียงต้นฉบับของผู้พูด)
        }

        # ควบคุม backlog: ถ้า queue ยาวไป ให้ล้างคิวเก่าทิ้ง
        try:
            while s.job_queue.qsize() > 2:
                _ = s.job_queue.get_nowait()
                s.job_queue.task_done()
        except Exception:
            pass

        await s.job_queue.put(job)

# ---------- WebSocket endpoint ----------
@app.websocket("/ws/voice")
async def ws_voice(ws: WebSocket):
    await ws.accept()
    session: Optional[Session] = None
    try:
        # handshake: {type:'hello', userId, roomId}
        hello = await ws.receive_text()
        try:
            h = json.loads(hello)
        except Exception:
            await ws.close(code=1002)
            return

        if h.get("type") != "hello":
            await ws.close(code=1002)
            return

        user_id = str(h.get("userId") or "")
        room_id = str(h.get("roomId") or "")
        if not user_id or not room_id:
            await ws.close(code=1008)
            return

        session = Session(ws, user_id=user_id, room_id=room_id)
        await hub.join(session)
        await session.safe_send_json({"type": "hello_ok", "serverTs": int(time.time())})

        while True:
            msg = await ws.receive()
            if msg.get("type") == "websocket.disconnect":
                break

            if "text" in msg:
                try:
                    data = json.loads(msg["text"])
                except Exception:
                    continue

                t = data.get("type")
                if t == "set_target_lang":
                    session.target_lang = str(data.get("value") or "off")
                    print("[GW] set_target_lang:", session.user_id, "→", session.target_lang)
                elif t == "set_src_lang":
                    session.source_lang = str(data.get("value") or "auto")
                # ... ภายใน while True: ที่อ่านข้อความ text จาก WS
                elif t == "set_speaker_url":
                    raw = str(data.get("value") or "") or None
                    session.speaker_url = normalize_speaker_url(raw) if raw else None
                    print("[GW] set_speaker_url:", session.user_id, "→", session.speaker_url)

    
                elif t == "audio_chunk":
                    # header for next binary (client will send bytes next)
                    session.seq_in = int(data.get("seq") or 0)
                    continue

            elif "bytes" in msg:
                raw: bytes = msg["bytes"]
                if not raw:
                    continue

                # อาจได้แพ็กใหญ่มา → แตกเป็นเฟรม 20ms เท่ากับ BYTES_PER_FRAME
                i = 0
                while i + BYTES_PER_FRAME <= len(raw):
                    frame = raw[i:i+BYTES_PER_FRAME]
                    i += BYTES_PER_FRAME

                    # พลังงานหยาบ + VAD
                    energy = avg_abs_pcm(frame)
                    is_voiced = False
                    if energy >= ENERGY_ABS_GATE:
                        try:
                            # webrtcvad ต้องการ 16k, mono, s16le และ 10/20/30ms frame
                            is_voiced = session.vad.is_speech(frame, SAMPLE_RATE)
                        except Exception:
                            is_voiced = False

                    now = time.time()
                    # ถ้ายังอยู่ใน cooldown ให้ถือเป็นเงียบ
                    if now < session.cooldown_until:
                        is_voiced = False

                    if not session.talking:
                        # ยังไม่ได้เริ่มพูด → นับ voiced_run
                        if is_voiced:
                            session.voiced_run += 1
                        else:
                            session.voiced_run = 0

                        # ยังสะสม buffer ไว้ก่อน (เผื่อขอบ segment)
                        session.buf.extend(frame)
                        session.ms_acc += FRAME_MS

                        # เริ่มพูดเมื่อเจอเสียงจริงติดกันพอ
                        if session.voiced_run >= START_VOICED_FRAMES:
                            session.talking = True
                            session.silence_run = 0
                            session.seg_start_ms = 0  # เรานับจาก 0 ภายใน segment
                    else:
                        # อยู่ในสถานะกำลังพูด → สะสม และดูว่าจะตัดเมื่อไร
                        session.buf.extend(frame)
                        session.ms_acc += FRAME_MS
                        session.seg_start_ms += FRAME_MS

                        if is_voiced:
                            session.silence_run = 0
                        else:
                            session.silence_run += 1

                        # เงื่อนไขจบ: เจอเงียบพอ หรือยาวเกินกำหนด
                        cut = (session.silence_run >= STOP_SILENCE_FRAMES) or (session.seg_start_ms >= MAX_SEGMENT_MS)

                        # ต้องให้ยาวพอขั้นต่ำด้วย
                        long_enough = session.seg_start_ms >= max(SEGMENT_MIN_MS, START_VOICED_FRAMES*VAD_FRAME_MS)

                        if cut and long_enough:
                            pcm = bytes(session.buf)
                            session.buf.clear()
                            session.ms_acc = 0

                            # รีเซ็ตสถานะพูด + ตั้ง cooldown กันสั่น
                            session.talking = False
                            session.voiced_run = 0
                            session.silence_run = 0
                            session.seg_start_ms = 0
                            session.cooldown_until = time.time() + (COOLDOWN_MS/1000.0)

                            asyncio.create_task(process_segment_and_broadcast(session, pcm))

                        # ถ้าตัดแต่สั้นเกินไป → ทิ้ง segment นั้น
                        elif cut and not long_enough:
                            session.buf.clear()
                            session.ms_acc = 0
                            session.talking = False
                            session.voiced_run = 0
                            session.silence_run = 0
                            session.seg_start_ms = 0
                            session.cooldown_until = time.time() + (COOLDOWN_MS/1000.0)

                # ถ้ามีเศษเฟรมไม่ครบ 20ms → เก็บไว้รอเฟรมถัดไป
                tail = raw[i:]
                if tail:
                    session.buf.extend(tail)
                    session.ms_acc += int(len(tail) / 2 / SAMPLES_PER_FRAME) * FRAME_MS  # ค่าประมาณ ไม่ซีเรียสมาก


    except WebSocketDisconnect:
        pass
    except Exception as ex:
        try:
            if session:
                await session.safe_send_json({"type": "error", "code": "WS_ERR", "message": str(ex)})
        except:
            pass
    finally:
        if session:
            await hub.leave(session)
            await session.close()
        try:
            await ws.close()
        except:
            pass
