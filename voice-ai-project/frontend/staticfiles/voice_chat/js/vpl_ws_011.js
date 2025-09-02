/*
 * VPL_ws_01.js — Voice Pipeline over WebSocket (Client Side)
 * -----------------------------------------------------------
 * Purpose:
 *   Minimal, production-lean skeleton for streaming mic → STT → MT → TTS → play
 *   via ONE WebSocket connection to the Voice Gateway.
 *
 * What it provides:
 *   - Recorder16k: capture mic, downsample to 16k PCM S16LE, frame=20ms, send via WS
 *   - VoiceGatewayClient: WS wrapper (hello, set_target_lang, audio_chunk, event mux)
 *   - TTSPlayer: WAN-friendly chunked WAV playback with small crossfade + ducking hooks
 *   - VoicePipeline: tiny facade used by the page (start/stop/setTargetLang)
 *
 * Integration contracts (simple):
 *   window.voicePipeline = new VoicePipeline({
 *     url: `wss://${location.host}/ws/voice`,
 *     userId: String(window.myRTCUserId),
 *     getRoomId: () => String(window.currentChatRoomId),
 *     onDucking: (active) => duckOriginalAudio(active),
 *     onSTTPartial: (e) => updatePartial(e),
 *     onSTTFinal: (e) => updateFinal(e),
 *     onMTPartial: (e) => updateMTPartial(e),
 *     onMTFinal: (e) => updateMTFinal(e),
 *     onMetrics: (m) => updateMetrics(m),
 *     log: (...args)=>console.log('[VPL]',...args),
 *   });
 *
 * Then in RTC_03.25.js:
 *   - after getUserMedia success: window.voicePipeline?.start(stream)
 *   - on leave: window.voicePipeline?.stop()
 */

(function () {
  // ========================= Utilities =========================
  function clamp(n, min, max) {
    return Math.max(min, Math.min(n, max));
  }
  function nowSec(ac) {
    return ac.currentTime;
  }
  let currentTtsToken = null;
  // Downsample Float32Array @sampleRate to 16k and convert to Int16 PCM
  function floatTo16kPCM(float32, inputSampleRate) {
    const targetRate = 16000;
    if (inputSampleRate === targetRate) {
      // Convert to s16
      const out = new Int16Array(float32.length);
      for (let i = 0; i < float32.length; i++) {
        let s = Math.max(-1, Math.min(1, float32[i]));
        out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }
      return out;
    }
    const ratio = inputSampleRate / targetRate;
    const newLen = Math.round(float32.length / ratio);
    const out = new Int16Array(newLen);
    let pos = 0;
    for (let i = 0; i < newLen; i++) {
      const idx = Math.floor(i * ratio);
      let s = Math.max(-1, Math.min(1, float32[idx] || 0));
      out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
      pos += ratio;
    }
    return out;
  }

  // ========================= Recorder16k =========================
  class Recorder16k {
    constructor(opts) {
      this.opts = Object.assign({ frameMs: 20 }, opts || {});
      this.ac = null;
      this.src = null;
      this.proc = null; // ScriptProcessorNode fallback
      this.inputStream = null;
      this.sampleRate = 48000; // default, will be set by AC
      this.seq = 0;
      this.onFrame = null; // (seq, Int16Array) => void
      this._running = false;
      this._muted = false;
    }
    async start(stream) {
      if (this._running) return;
      this.inputStream = stream;
      this.ac = new (window.AudioContext || window.webkitAudioContext)({
        sampleRate: 48000,
      });
      this.sampleRate = this.ac.sampleRate;
      this.src = this.ac.createMediaStreamSource(stream);

      // Use ScriptProcessor (widest support)
      const bufferSize = 2048; // ~42ms at 48k, we'll cut into 20ms chunks by accumulation
      this.proc = this.ac.createScriptProcessor(bufferSize, 1, 1);
      this._buf = [];

      this.proc.onaudioprocess = (e) => {
        if (!this._running) return;
        const ch0 = e.inputBuffer.getChannelData(0);
        if (this._muted) {
          // send silence equivalent length
          const silence = new Float32Array(ch0.length);
          this._enqueue(silence);
        } else {
          this._enqueue(ch0);
        }
      };

      this.src.connect(this.proc);
      this.proc.connect(this.ac.destination); // required in some browsers
      this.seq = 0;
      this._running = true;
    }
    stop() {
      this._running = false;
      if (this.proc) {
        try {
          this.proc.disconnect();
        } catch {}
        this.proc.onaudioprocess = null;
        this.proc = null;
      }
      if (this.src) {
        try {
          this.src.disconnect();
        } catch {}
        this.src = null;
      }
      if (this.ac) {
        try {
          if (this.ac.state !== "closed") this.ac.close();
        } catch (e) {}
        this.ac = null;
      }
      this.inputStream = null;
      this._buf = [];
    }
    setMuted(m) {
      this._muted = !!m;
    }
    _enqueue(floatChunk) {
      // accumulate and emit 20ms @16k = 320 samples floats (but we downsample + s16 later)
      // We'll keep at input SR then segment by time
      if (!this._acc) this._acc = [];
      this._acc.push(floatChunk);
      const frameSamplesIn = Math.round(
        this.sampleRate * (this.opts.frameMs / 1000)
      );
      let total = 0;
      for (const a of this._acc) total += a.length;
      while (total >= frameSamplesIn) {
        // concat the needed portion
        const needed = frameSamplesIn;
        const tmp = new Float32Array(needed);
        let offset = 0;
        while (offset < needed) {
          const head = this._acc[0];
          const remain = needed - offset;
          if (head.length <= remain) {
            tmp.set(head, offset);
            offset += head.length;
            this._acc.shift();
          } else {
            tmp.set(head.subarray(0, remain), offset);
            this._acc[0] = head.subarray(remain);
            offset += remain;
          }
        }
        total -= needed;
        const s16 = floatTo16kPCM(tmp, this.sampleRate); // also downsamples if needed
        if (this.onFrame) this.onFrame(this.seq++, s16);
      }
    }
  }

  // ========================= VoiceGatewayClient (WS) =========================
  class VoiceGatewayClient {
    constructor({ url, userId, getRoomId, log }) {
      this.url = url;
      this.userId = userId;
      this.getRoomId = getRoomId;
      this.log = log || (() => {});
      this.ws = null;
      this.handlers = {};
      this.expectingBinaryFor = null;
    }
    on(type, fn) {
      this.handlers[type] = fn;
    }
    _emit(msg) {
      const fn = this.handlers[msg.type];
      if (fn) fn(msg);
    }

    connect() {
      if (
        this.ws &&
        (this.ws.readyState === WebSocket.OPEN ||
          this.ws.readyState === WebSocket.CONNECTING)
      )
        return;
      this.ws = new WebSocket(this.url);
      this.ws.binaryType = "arraybuffer";

      this.ws.onopen = () => {
        this.log("WS open → hello");
        this._send({
          type: "hello",
          sessionId: self.crypto?.randomUUID?.() || String(Date.now()),
          userId: this.userId,
          roomId: this.getRoomId() ? String(this.getRoomId()) : null,
        });
      };

      this.ws.onmessage = (ev) => {
        // binary ชิ้นถัดจาก tts_chunk header
        if (typeof ev.data !== "string") {
          if (this.expectingBinaryFor) {
            const h = this.expectingBinaryFor;
            this.expectingBinaryFor = null;
            h.bytes = ev.data;
            this._emit(h);
          }
          return;
        }
        let msg;
        try {
          msg = JSON.parse(ev.data);
        } catch {
          return;
        }
        if (msg.type === "tts_chunk" && msg.expectBinary) {
          this.expectingBinaryFor = msg;
          return;
        }
        this._emit(msg);
      };

      this.ws.onclose = (e) => this.log("WS close", e.code, e.reason || "");
      this.ws.onerror = (e) => this.log("WS error", e);
    }
    _send(o) {
      if (this.ws && this.ws.readyState === WebSocket.OPEN)
        this.ws.send(JSON.stringify(o));
    }
    sendAudioFrame(seq, pcm16) {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      this._send({
        type: "audio_chunk",
        seq,
        format: "pcm_s16le",
        sampleRate: 16000,
        durationMs: 20,
      });
      this.ws.send(pcm16.buffer);
    }
    setTargetLang(v) {
      this._send({ type: "set_target_lang", value: v });
    }
    setSourceLang(v) {
      this._send({ type: "set_src_lang", value: v });
    }
    setSpeakerUrl(url) {
      this._send({ type: "set_speaker_url", value: url });
    }
    close() {
      try {
        this.ws?.close();
      } catch {}
    }
  }

  // ========================= TTSPlayer (WebAudio) =========================
  // ======== TTSPlayer — robust streaming WAV queue with token/jitter/ducking ========
  class TTSPlayer {
    /**
     * opts:
     *  - targetGain: 1.0
     *  - baseCrossfadeMs: 20         // crossfade ที่ “มากสุด” จะปรับตามความยาวชิ้นอีกที
     *  - minPlayUnitMs: 260          // รวม chunk ให้ได้อย่างน้อยเท่านี้ก่อนเริ่มเล่น (ลดจึ้ก)
     *  - jitterStartMs: 100          // รอ buffer เล็กน้อยก่อนเริ่มรอบใหม่
     *  - boundaryXfadeMs: 8          // crossfade เล็กๆ ระหว่างชิ้นใน play-unit เดียวกัน
     *  - startLookaheadMs: 40        // กันคลาดเคลื่อน scheduler
     *  - onDucking(active:bool)      // callback ให้ไป mute/duck ไมค์/เสียงอื่น
     *  - log(...args)                // debug log
     */
    constructor(opts) {
      this.opts = Object.assign({
        targetGain: 1.0,
        baseCrossfadeMs: 20,
        minPlayUnitMs: 260,
        jitterStartMs: 100,
        boundaryXfadeMs: 8,
        startLookaheadMs: 40,
        onDucking: null,
        log: () => {},
      }, opts || {});

      this.ac = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 48000 });
      this.master = this.ac.createGain();
      this.master.gain.value = this.opts.targetGain;
      this.master.connect(this.ac.destination);

      // สถานะ
      this.currentToken = null;         // token ของ stream ปัจจุบัน
      this.pending = [];                // ชิ้นที่ decode แล้ว (อยู๋ในคิวรอรวมเป็น “play-unit”)
      this.pendingDur = 0;              // วินาทีรวมของ pending
      this.playing = false;
      this.playHead = 0;                // เวลาเริ่มของชิ้นถัดไป (ac.currentTime space)
      this._active = new Set();         // แหล่งที่กำลังเล่น (เพื่อ fade-out/ducking)
      this._jitterTimer = null;
      this._endedForToken = new Set();  // token ที่ได้รับ end แล้ว (กันซ้ำ)
    }

    // ---------- public API ----------
    async beginStream(token) {
      await this._ensureRunning();
      if (!token) token = 'no-token';
      // token ใหม่ → fade-out ทั้งหมด & ล้างคิว
      if (this.currentToken && token !== this.currentToken) {
        this._debug('beginStream: new token → hardFlush old');
        this._hardFlush(80);
      }
      this.currentToken = token;
      this._endedForToken.delete(token);
      // ตั้ง jitter start (กันเล่นชิ้นแรกสั้นๆ แล้วเงียบ)
      this._armJitterStart();
    }

    async pushChunk(arrayBuffer, meta = {}) {
      // meta: { token?, segmentId?, index?, total? }
      const token = meta.token || this.currentToken || 'no-token';
      if (!this.currentToken) this.currentToken = token;

      if (token !== this.currentToken) {
        // มาช้า/คิวเก่า → ทิ้ง
        this._debug('pushChunk: drop late token', token);
        return;
      }

      const buf = await this._decode(arrayBuffer);
      if (!buf) return;

      // ถ้าชิ้นสั้นมาก ให้ patch ด้วยการ padding เงียบจน ~100–150ms
      const minChunk = 0.12; // 120ms
      const chunk = (buf.duration < minChunk) ? this._padSilence(buf, minChunk) : buf;

      this.pending.push(chunk);
      this.pendingDur += chunk.duration;

      // ถ้ารวมเกิน minPlayUnit หรือถ้าได้รับ end แล้วค่อยปล่อยทั้งหมด
      const shouldFlushUnit = this.pendingDur * 1000 >= this.opts.minPlayUnitMs;
      if (shouldFlushUnit) {
        this._flushPlayUnit(false);
      }
    }

    async endStream(token) {
      token = token || this.currentToken || 'no-token';
      this._endedForToken.add(token);

      if (token !== this.currentToken) {
        // end ของคิวเก่า ไม่เกี่ยว
        return;
      }
      // ถ้ามี pending อยู่ → ปล่อยทั้งหมดเป็น play-unit สุดท้าย
      if (this.pendingDur > 0) {
        this._flushPlayUnit(true);
      }
      // เคลียร์ jitter timer เผื่อยังตั้งอยู่
      if (this._jitterTimer) {
        clearTimeout(this._jitterTimer);
        this._jitterTimer = null;
      }
    }

    stop() {
      // fade-out ทุกสิ่งและล้างสภาพ
      this._hardFlush(60);
    }

    // ---------- internal ----------
    _debug(...args) { try { this.opts.log('[TTSPlayer]', ...args); } catch {} }

    async _ensureRunning() {
      if (this.ac.state !== 'running') {
        try { await this.ac.resume(); } catch {}
      }
    }

    async _decode(ab) {
      try {
        // Safari บางตัวต้อง copy arrayBuffer
        const copy = ab.slice ? ab.slice(0) : ab;
        // บางเบราว์เซอร์ยังมี callback style → หุ้ม Promise
        const p = new Promise((resolve, reject) => {
          const done = (buf) => resolve(buf);
          const fail = (e) => reject(e);
          const ret = this.ac.decodeAudioData(copy, done, fail);
          // chrome modern จะคืน promise อยู่แล้ว
          if (ret && typeof ret.then === 'function') ret.then(resolve).catch(reject);
        });
        const buf = await p;
        return buf;
      } catch (e) {
        this._debug('decode error', e);
        return null;
      }
    }

    _armJitterStart() {
      if (this._jitterTimer) return;
      this._jitterTimer = setTimeout(() => {
        this._jitterTimer = null;
        // ถ้ายังไม่มีอะไรเล่นแต่มี pending บ้าง → ปล่อยชุดแรกให้ทันที (แม้ยังไม่ถึง minPlayUnit)
        if (!this.playing && this.pendingDur > 0) {
          this._flushPlayUnit(false);
        }
      }, this.opts.jitterStartMs);
    }

    _flushPlayUnit(isFinal) {
      if (this.pending.length === 0) return;
      // กำหนด play start (คำนึง lookahead)
      const t0 = Math.max(
        this.ac.currentTime + this.opts.startLookaheadMs / 1000,
        this.playHead || (this.ac.currentTime + 0.02)
      );

      // group gain: ทำ fade-in/out ระดับ “ชุด”
      const gGroup = this.ac.createGain();
      gGroup.gain.setValueAtTime(0, t0);

      // fade-in ชุด (ขึ้นกับความยาวรวม)
      const durSum = this.pendingDur;
      const baseFade = Math.min(this.opts.baseCrossfadeMs / 1000, durSum * 0.35);
      gGroup.gain.linearRampToValueAtTime(this.opts.targetGain, t0 + Math.max(0.005, baseFade));

      // วางทุก chunk ต่อท้ายกัน โดยมี boundary crossfade เล็กน้อย
      let cursor = t0;
      const boundaryFade = Math.max(0.003, Math.min(this.opts.boundaryXfadeMs / 1000, durSum * 0.1));

      for (let i = 0; i < this.pending.length; i++) {
        const buf = this.pending[i];
        const src = this.ac.createBufferSource();
        src.buffer = buf;

        // node ต่อ: src → gSrc → gGroup → master
        const gSrc = this.ac.createGain();
        // สำหรับชิ้นกลาง ใช้ crossfade เล็กน้อย
        const localStart = cursor;
        const localEnd = cursor + buf.duration;

        // เริ่มด้วย 0 → 1 ใน 5~20ms เพื่อกัน click
        const smallIn = Math.max(0.005, Math.min(0.02, buf.duration * 0.2));
        gSrc.gain.setValueAtTime(0, localStart);
        gSrc.gain.linearRampToValueAtTime(1, localStart + smallIn);

        // ถ้า “ไม่ใช่ชิ้นสุดท้ายในชุด” ให้ ramp ลงเล็กน้อยตรงท้ายเพื่อซ้อนกับชิ้นถัดไป
        if (i < this.pending.length - 1) {
          const endHold = Math.max(localStart + smallIn, localEnd - boundaryFade);
          gSrc.gain.setValueAtTime(1, endHold);
          gSrc.gain.linearRampToValueAtTime(0, localEnd);
        } else {
          // ชิ้นสุดท้าย ปล่อยแบนถึงท้าย แล้วค่อยให้ group ทำ fade-out
          gSrc.gain.setValueAtTime(1, localEnd);
        }

        src.connect(gSrc).connect(gGroup).connect(this.master);
        src.start(localStart);

        // track actives
        const ref = { src, g: gSrc, start: localStart, end: localEnd, token: this.currentToken };
        this._active.add(ref);
        src.onended = () => this._active.delete(ref);

        cursor = localEnd; // ต่อด้วยชิ้นถัดไป
      }

      // คำนวณเวลา end ของชุด
      const tEnd = cursor;
      // ทำ fade-out ของทั้งชุด
      const outFade = Math.max(0.02, Math.min(this.opts.baseCrossfadeMs / 1000, durSum * 0.35));
      gGroup.gain.setValueAtTime(this.opts.targetGain, tEnd - outFade);
      gGroup.gain.linearRampToValueAtTime(0, tEnd);

      // อัปเดต playhead
      this.playHead = tEnd;
      this.playing = true;

      // แจ้ง ducking เริ่ม
      this._duck(true);

      // นัดเช็คตอนจบชุด
      const margin = 0.05; // 50ms
      setTimeout(() => {
        if (this._active.size === 0 || this.ac.currentTime >= (tEnd - margin)) {
          // ถ้าชุดนี้จบแล้วและไม่มี buffer ใหม่เข้า → อาจหยุด ducking
          this.playing = false;
          // ถ้าท้ายจริงๆ (stream end) → บังคับปล่อย ducking
          if (isFinal || this._active.size === 0) {
            this._duck(false);
          }
        }
      }, Math.max(1, (tEnd - this.ac.currentTime) * 1000 + 10));

      // เคลียร์ pending ของชุดนี้
      this.pending = [];
      this.pendingDur = 0;
    }

    _padSilence(buf, targetSec) {
      const outFrames = Math.max(buf.length, Math.floor(targetSec * buf.sampleRate));
      const out = this.ac.createBuffer(buf.numberOfChannels, outFrames, buf.sampleRate);
      for (let ch = 0; ch < buf.numberOfChannels; ch++) {
        out.getChannelData(ch).set(buf.getChannelData(ch), 0);
      }
      return out;
    }

    _duck(active) {
      try { this.opts.onDucking && this.opts.onDucking(!!active); } catch {}
    }

    _hardFlush(fadeMs) {
      const t = this.ac.currentTime;
      const fade = Math.max(0.03, (fadeMs || 60) / 1000);
      this._active.forEach((obj) => {
        try {
          obj.g.gain.cancelScheduledValues(t);
          obj.g.gain.setValueAtTime(obj.g.gain.value, t);
          obj.g.gain.linearRampToValueAtTime(0, t + fade);
          obj.src.stop(t + fade + 0.01);
        } catch {}
      });
      this._active.clear();
      this.pending = [];
      this.pendingDur = 0;
      this.playing = false;
      this.playHead = 0;
      this._duck(false);
    }
  }


  // ========================= VoicePipeline Facade =========================
  class VoicePipeline {
    constructor({
      url,
      userId,
      getRoomId,
      onDucking,
      onSTTPartial,
      onSTTFinal,
      onMTPartial,
      onMTFinal,
      onMetrics,
      log,
    }) {
      this.getRoomId = getRoomId;
      this.log = log || (() => {});
      this.rec = new Recorder16k();
      this.ws = new VoiceGatewayClient({ url, userId, getRoomId, log });
      this.player = new TTSPlayer({
        onDucking: (active) => onDucking && onDucking(active),
        log: (...a) => this.log(...a),
      });
      this.targetLang = "off";
      this.sourceLang = "auto";

      // Wire events
      this.rec.onFrame = (seq, s16) => this.ws.sendAudioFrame(seq, s16);
      this.ws.on("stt_partial", (m) => onSTTPartial && onSTTPartial(m));
      this.ws.on("stt_final", (m) => onSTTFinal && onSTTFinal(m));
      this.ws.on("mt_partial", (m) => onMTPartial && onMTPartial(m));
      this.ws.on("mt_final", (m) => onMTFinal && onMTFinal(m));
      this.ws.on("metrics", (m) => onMetrics && onMetrics(m));
      this.ws.on("tts_start", (m) => {
        // ไม่ต้อง hardFlush เองแล้ว — ผู้เล่นจะจัดการ token ให้เอง
        this.player.beginStream(m.token || null);
      });
      this.ws.on("tts_chunk", async (h) => {
        // ผู้เล่นจะทิ้งเองถ้า token ไม่ตรง
        await this.player.pushChunk(h.bytes, { token: h.token, segmentId: h.segmentId, index: h.chunkIndex });
      });
      this.ws.on("tts_end", (m) => {
        this.player.endStream(m.token || null);
      });
      this.player.onSpeak = () => onDucking && onDucking(true);
      this.player.onSilence = () => onDucking && onDucking(false);
    }
    async start(localStream) {
      this.ws.connect();
      await this.rec.start(localStream);
      // apply current target lang
      if (this.targetLang) this.ws.setTargetLang(this.targetLang);
      if (this.sourceLang) this.ws.setSourceLang(this.sourceLang);
    }
    stop() {
      try {
        this.rec.stop();
      } catch {}
      try {
        this.player.clear();
        this.player.stop();
      } catch {}
      try {
        this.ws.close();
      } catch {}
    }
    setTargetLang(lang) {
      this.targetLang = lang;
      this.ws.setTargetLang(lang); // ส่งไป gateway ทันทีถ้า WS พร้อม
    }
    setSourceLang(lang) {
      this.sourceLang = lang || "auto";
      if (this.ws && this.ws._send) {
        this.ws._send({ type: "set_src_lang", value: this.sourceLang });
      }
    }
    setSpeakerUrl(url) {
      this._speakerUrl = url || null;
      this.ws.setSpeakerUrl(this._speakerUrl);
    }
    setMicMuted(m) {
      this.rec.setMuted(!!m);
    }
  }
  document.addEventListener(
    "click",
    async () => {
      try {
        await window.voicePipeline?.player?.ac?.resume();
      } catch {}
    },
    { once: true }
  );

  // ========================= Minimal DUCKING helper (example) =========================
  // function duckOriginalAudio(active) {
  //   // Reduce volume of all remote audios
  //   const audios = document.querySelectorAll('audio[id^="voice-audio-"]');
  //   audios.forEach((a) => {
  //     a.dataset._origVol = a.dataset._origVol || a.volume;
  //     a.volume = active
  //       ? clamp(a.dataset._origVol * 0.4, 0, 1)
  //       : parseFloat(a.dataset._origVol) || 1;
  //   });
  // }
  // window._duckOriginalAudio = duckOriginalAudio; // <-- ลบ
  // สร้าง pipeline
  window.voicePipeline = new VoicePipeline({
    url:
      (location.protocol === "https:" ? "wss://" : "ws://") +
      location.host +
      "/ws/voice",
    userId: String(window.myRTCUserId || ""),
    getRoomId: () => String(window.currentChatRoomId || ""),
    onDucking: (active) => window._duckOriginalAudio?.(active),
    onMetrics: (m) => {
      const el = document.getElementById("voice-status-text");
      if (!el || !m) return;
      const ms = m.latencyMs || {};
      const hint = ms.mt === 0 || ms.tts === 0 ? " ⏳" : "";
      el.textContent = `Latency — STT: ${ms.stt || 0}ms | MT: ${
        ms.mt || 0
      }ms | TTS: ${ms.tts || 0}ms | E2E: ${ms.e2e || 0}ms${hint}`;
    },
    log: (...args) => console.log("[VPL]", ...args),
  });

  // ✅ รอให้ WS ตอบ hello_ok ก่อน
  window.voicePipeline.ws.on("hello_ok", async () => {
    console.log("[VPL] got hello_ok → set speaker, langs, then start mic");

    // 1) ส่งลิงก์เสียงอ้างอิง
    const SPEAKER_URL = "/static/song/xtts/01.wav"; // << ไฟล์ของคุณ
    try {
      window.voicePipeline.ws.setSpeakerUrl(SPEAKER_URL);
    } catch {}

    // 2) set ภาษาตาม UI ถ้ามี
    try {
      const srcSel = document.getElementById("voice-source-select");
      const tgtSel = document.getElementById("voice-translate-select");
      if (srcSel) window.voicePipeline.setSourceLang(srcSel.value || "auto");
      if (tgtSel) window.voicePipeline.setTargetLang(tgtSel.value || "off");
    } catch {}

    // 3) เริ่มไมค์
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      await window.voicePipeline.rec.start(stream);
    } catch (err) {
      console.error("[VPL] mic error", err);
    }
  });

  // ✅ เชื่อมต่อ WS
  window.voicePipeline.ws.connect();

  // ========================= Global attach =========================
  window.VoicePipeline = VoicePipeline;
  window.voicePipeline.targetLang; // ต้องไม่ใช่ 'off'
  if (typeof hardDuckOriginalAudio === "function") {
    window._duckOriginalAudio = hardDuckOriginalAudio;
  }
})();
