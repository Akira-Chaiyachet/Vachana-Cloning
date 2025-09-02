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
  class TTSPlayer {
    constructor(opts) {
      this.opts = Object.assign(
        { crossfadeMs: 20, targetGain: 1.0 },
        opts || {}
      );
      this.ac = new (window.AudioContext || window.webkitAudioContext)({
        sampleRate: 48000,
      });
      this.master = this.ac.createGain();
      this.master.gain.value = this.opts.targetGain;
      this.master.connect(this.ac.destination);

      this.queue = [];
      this._playing = false;
      this._lastEnd = null;
      this.onSpeak = null;
      this.onSilence = null;

      // NEW: track current play nodes for fade-out
      this._activeSources = new Set();
    }
    async ensureRunning() {
      if (this.ac.state !== "running") {
        try {
          await this.ac.resume();
        } catch {}
      }
    }
    async enqueueWavChunk(arrayBuffer) {
      await this.ensureRunning();
      const buf = await this.ac.decodeAudioData(arrayBuffer.slice(0));
      this.queue.push({ buffer: buf });
      if (!this._playing) this._flush();
    }

    _flush() {
      if (this._playing) return;
      this._playing = true;
      try {
        this.onSpeak && this.onSpeak();
      } catch {}

      let t = Math.max(
        this.ac.currentTime + 0.02,
        this._lastEnd || this.ac.currentTime + 0.02
      );
      const fade = (this.opts.crossfadeMs || 20) / 1000;

      while (this.queue.length) {
        const { buffer } = this.queue.shift();
        const src = this.ac.createBufferSource();
        src.buffer = buffer;
        const g = this.ac.createGain();

        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(this.opts.targetGain, t + fade);

        const end = t + buffer.duration;
        g.gain.setValueAtTime(this.opts.targetGain, end - fade);
        g.gain.linearRampToValueAtTime(0, end);

        src.connect(g).connect(this.master);
        src.start(t);

        // track for later fade-out
        this._activeSources.add({ src, gain: g, start: t, end });

        src.onended = () => {
          this._activeSources.forEach((obj) => {
            if (obj.src === src) this._activeSources.delete(obj);
          });
        };

        this._lastEnd = end;
        t = end;
      }

      const check = () => {
        if (!this._lastEnd || this.ac.currentTime >= this._lastEnd - 0.01) {
          this._playing = false;
          try {
            this.onSilence && this.onSilence();
          } catch {}
        } else {
          setTimeout(check, 30);
        }
      };
      setTimeout(check, 30);
    }

    // NEW: fade-out ทุกสิ่งที่กำลังเล่น แล้วล้างคิว (กันซ้อน)
    hardFlush(fadeMs = 80) {
      const t = this.ac.currentTime;
      const fade = (fadeMs || 60) / 1000;
      this._activeSources.forEach((obj) => {
        try {
          obj.gain.gain.cancelScheduledValues(t);
          obj.gain.gain.setValueAtTime(obj.gain.gain.value, t);
          obj.gain.gain.linearRampToValueAtTime(0, t + fade);
          // stop หลัง fade
          obj.src.stop(t + fade + 0.01);
        } catch {}
      });
      this._activeSources.clear();
      this.clear();
      this._playing = false;
      this._lastEnd = null;
    }

    clear() {
      this.queue.length = 0;
      this._lastEnd = null;
    }
    stop() {
      // fade-out แล้วเคลียร์
      this.hardFlush(60);
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
      this.player = new TTSPlayer();
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
        currentTtsToken = m.token || null;
        this.player.hardFlush(80);
      });
      this.ws.on("tts_chunk", async (h) => {
        if (currentTtsToken && h.token && h.token !== currentTtsToken) {
          // late chunk ของรอบเก่า ทิ้ง
          return;
        }
        try {
          await this.player.enqueueWavChunk(h.bytes);
        } catch (err) {
          this.log("decode tts_chunk error", err);
        }
      });
      this.ws.on("tts_end", (m) => {
        if (currentTtsToken && m.token && m.token !== currentTtsToken) return;
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
