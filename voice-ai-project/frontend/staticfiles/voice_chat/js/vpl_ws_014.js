(function () {
  // ========================= Utilities =========================
  function clamp(n, min, max) {
    return Math.max(min, Math.min(n, max));
  }

  // ------------------------- Recorder16k -------------------------
  class Recorder16k {
    constructor(opts) {
      this.opts = Object.assign({ frameMs: 20 }, opts || {});
      this.ac = null;
      this.src = null;
      this.proc = null;
      this.inputStream = null;
      this.sampleRate = 48000;
      this.seq = 0;
      this.onFrame = null;
      this._running = false;
      this._muted = false;
      this._acc = [];
    }
    async start(stream) {
      if (this._running) return;
      this.inputStream = stream;
      this.ac = new (window.AudioContext || window.webkitAudioContext)({
        sampleRate: 48000,
      });
      this.sampleRate = this.ac.sampleRate;
      this.src = this.ac.createMediaStreamSource(stream);
      this.proc = this.ac.createScriptProcessor(2048, 1, 1);
      this.proc.onaudioprocess = (e) => {
        if (!this._running) return;
        const ch0 = e.inputBuffer.getChannelData(0);
        const data = this._muted ? new Float32Array(ch0.length) : ch0;
        this._enqueue(data);
      };
      this.src.connect(this.proc);
      this.proc.connect(this.ac.destination);
      this.seq = 0;
      this._running = true;
    }
    stop() {
      this._running = false;
      try {
        this.proc?.disconnect();
      } catch {}
      if (this.proc) this.proc.onaudioprocess = null;
      this.proc = null;
      try {
        this.src?.disconnect();
      } catch {}
      this.src = null;
      try {
        if (this.ac && this.ac.state !== "closed") this.ac.close();
      } catch {}
      this.ac = null;
      this.inputStream = null;
      this._acc = [];
    }
    setMuted(m) {
      this._muted = !!m;
    }
    _enqueue(floatChunk) {
      if (!this._acc) this._acc = [];
      this._acc.push(floatChunk);
      const frameSamplesIn = Math.round(
        this.sampleRate * (this.opts.frameMs / 1000)
      );
      let total = this._acc.reduce((s, a) => s + a.length, 0);
      while (total >= frameSamplesIn) {
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
        // downsample→16k & convert to s16
        const s16 = (() => {
          const targetRate = 16000;
          if (this.sampleRate === targetRate) {
            const out = new Int16Array(tmp.length);
            for (let i = 0; i < tmp.length; i++) {
              const s = Math.max(-1, Math.min(1, tmp[i]));
              out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
            }
            return out;
          }
          const ratio = this.sampleRate / targetRate;
          const newLen = Math.round(tmp.length / ratio);
          const out = new Int16Array(newLen);
          for (let i = 0; i < newLen; i++) {
            const idx = Math.floor(i * ratio);
            const s = Math.max(-1, Math.min(1, tmp[idx] || 0));
            out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
          }
          return out;
        })();
        if (this.onFrame) this.onFrame(this.seq++, s16);
      }
    }
  }

  // ------------------------- VoiceGatewayClient -------------------------
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
        // สร้าง sessionId แบบปลอดภัยทุกเบราว์เซอร์
        let sid = String(Date.now());
        try {
          if (
            self &&
            self.crypto &&
            typeof self.crypto.randomUUID === "function"
          ) {
            sid = self.crypto.randomUUID();
          }
        } catch {}

        // ส่ง hello ก็ต่อเมื่อ uid/rid ไม่ว่าง (กัน 1008)
        const tryHello = (deadline = Date.now() + 5000) => {
          const rid = this.getRoomId ? String(this.getRoomId() || "") : "";
          const uid = String(this.userId || "");
          if (uid && rid) {
            this._send({
              type: "hello",
              sessionId: sid,
              userId: uid,
              roomId: rid,
            });
            this.log("WS hello sent", { uid, rid });
            return;
          }
          if (Date.now() < deadline) {
            setTimeout(() => tryHello(deadline), 120); // รอให้ RTC/หน้าเพจตั้งค่าทัน
          } else {
            this.log("WS hello not sent: userId/roomId empty", { uid, rid });
            // ยังส่งก็ได้ แต่ gateway จะปิด 1008 — อย่างน้อย log จะชัด
            this._send({
              type: "hello",
              sessionId: sid,
              userId: uid,
              roomId: rid || null,
            });
          }
        };
        this.log("WS open → preparing hello …");
        tryHello();
      };

      this.ws.onmessage = (ev) => {
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
      this.ws.onclose = (e) => this.log("WS close", { code: e.code, reason: e.reason || "", wasClean: e.wasClean, readyState: this.ws?.readyState });
      this.ws.onerror = (e) => this.log("WS error", e);
    }
    close() {
      try {
        this.ws?.close();
      } catch {}
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
  }

  // ------------------------- TTSPlayer (โหมดรับก้อนเดียวก็เวิร์ก) -------------------------
  class TTSPlayer {
    constructor(opts) {
      this.opts = Object.assign(
        {
          targetGain: 1.0,
          baseCrossfadeMs: 20,
          minPlayUnitMs: 260, // เผื่ออนาคตถ้าเป็นหลายชิ้น (ตอนนี้ทั้งก้อนอยู่แล้ว)
          jitterStartMs: 80,
          boundaryXfadeMs: 8,
          startLookaheadMs: 40,
          onDucking: null,
          log: () => {},
        },
        opts || {}
      );
      this.ac = new (window.AudioContext || window.webkitAudioContext)({
        sampleRate: 48000,
      });
      this.master = this.ac.createGain();
      this.master.gain.value = this.opts.targetGain;
      this.master.connect(this.ac.destination);

      this.currentToken = null;
      this.pending = [];
      this.pendingDur = 0;
      this.playHead = 0;
      this.playing = false;
      this._active = new Set();
      this._jitterTimer = null;
    }
    async beginStream(token) {
      await this._ensureRunning();
      if (!token) token = "no-token";
      if (this.currentToken && token !== this.currentToken) this._hardFlush(80);
      this.currentToken = token;
      this._armJitterStart();
    }
    async pushChunk(arrayBuffer, meta = {}) {
      const token = meta.token || this.currentToken || "no-token";
      if (!this.currentToken) this.currentToken = token;
      if (token !== this.currentToken) return; // late
      const buf = await this._decode(arrayBuffer);
      if (!buf) return;
      // (ทั้งก้อน) → ใส่ทีเดียว
      this.pending.push(buf);
      this.pendingDur += buf.duration;
      // ปล่อยทันที (เพราะมาทั้งก้อนแล้ว)
      this._flushPlayUnit(true);
    }
    async endStream(/*token*/) {
      // ไม่มีอะไรต้องทำเป็นพิเศษเมื่อส่งทั้งก้อน
    }
    stop() {
      this._hardFlush(60);
    }

    // ---- internals ----
    _debug(...a) {
      try {
        this.opts.log("[TTSPlayer]", ...a);
      } catch {}
    }
    async _ensureRunning() {
      if (this.ac.state !== "running") {
        try {
          await this.ac.resume();
        } catch {}
      }
    }
    async _decode(ab) {
      try {
        const copy = ab.slice ? ab.slice(0) : ab;
        const p = new Promise((res, rej) => {
          const done = (b) => res(b);
          const fail = (e) => rej(e);
          const ret = this.ac.decodeAudioData(copy, done, fail);
          if (ret && typeof ret.then === "function") ret.then(res).catch(rej);
        });
        return await p;
      } catch (e) {
        this._debug("decode error", e);
        return null;
      }
    }
    _armJitterStart() {
      if (this._jitterTimer) return;
      this._jitterTimer = setTimeout(() => {
        this._jitterTimer = null;
        if (!this.playing && this.pendingDur > 0) this._flushPlayUnit(true);
      }, this.opts.jitterStartMs);
    }
    _flushPlayUnit(isFinal) {
      if (this.pending.length === 0) return;
      const t0 = Math.max(
        this.ac.currentTime + this.opts.startLookaheadMs / 1000,
        this.playHead || this.ac.currentTime + 0.02
      );
      const gGroup = this.ac.createGain();
      gGroup.gain.setValueAtTime(0, t0);
      const durSum = this.pendingDur;
      const inFade = Math.max(
        0.005,
        Math.min(this.opts.baseCrossfadeMs / 1000, durSum * 0.35)
      );
      gGroup.gain.linearRampToValueAtTime(this.opts.targetGain, t0 + inFade);

      let cursor = t0;
      for (let i = 0; i < this.pending.length; i++) {
        const buf = this.pending[i];
        const src = this.ac.createBufferSource();
        src.buffer = buf;
        const g = this.ac.createGain();
        const start = cursor,
          end = cursor + buf.duration;
        const smallIn = Math.max(0.005, Math.min(0.02, buf.duration * 0.2));
        g.gain.setValueAtTime(0, start);
        g.gain.linearRampToValueAtTime(1, start + smallIn);
        g.gain.setValueAtTime(1, end);
        src.connect(g).connect(gGroup).connect(this.master);
        src.start(start);
        const ref = { src, g, start, end };
        this._active.add(ref);
        src.onended = () => this._active.delete(ref);
        cursor = end;
      }

      const tEnd = cursor;
      const outFade = Math.max(
        0.02,
        Math.min(this.opts.baseCrossfadeMs / 1000, durSum * 0.35)
      );
      gGroup.gain.setValueAtTime(this.opts.targetGain, tEnd - outFade);
      gGroup.gain.linearRampToValueAtTime(0, tEnd);

      this.playHead = tEnd;
      this.playing = true;
      this._duck(true);
      setTimeout(() => {
        this.playing = false;
        this._duck(false);
      }, Math.max(1, (tEnd - this.ac.currentTime) * 1000 + 10));

      this.pending = [];
      this.pendingDur = 0;
    }
    _duck(active) {
      try {
        this.opts.onDucking && this.opts.onDucking(!!active);
      } catch {}
    }
    _hardFlush(fadeMs) {
      const t = this.ac.currentTime,
        fade = Math.max(0.03, (fadeMs || 60) / 1000);
      this._active.forEach((o) => {
        try {
          o.g.gain.cancelScheduledValues(t);
          o.g.gain.setValueAtTime(o.g.gain.value, t);
          o.g.gain.linearRampToValueAtTime(0, t + fade);
          o.src.stop(t + fade + 0.01);
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

  // ------------------------- VoicePipeline -------------------------
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
      this.ws = new VoiceGatewayClient({
        url,
        userId,
        getRoomId,
        log: this.log,
      });
      this.player = new TTSPlayer({
        onDucking: (active) => {
          onDucking && onDucking(active);
          // ปิดไมค์ตอนกำลังพูด TTS
          this.rec.setMuted(!!active);
        },
        log: this.log,
      });
      this.targetLang = "off";
      this.sourceLang = "auto";

      // mic → ws
      this.rec.onFrame = (seq, s16) => this.ws.sendAudioFrame(seq, s16);

      // events
      this.ws.on("stt_partial", (m) => onSTTPartial && onSTTPartial(m));
      this.ws.on("stt_final", (m) => onSTTFinal && onSTTFinal(m));
      this.ws.on("mt_partial", (m) => onMTPartial && onMTPartial(m));
      this.ws.on("mt_final", (m) => onMTFinal && onMTFinal(m));
      this.ws.on("metrics", (m) => onMetrics && onMetrics(m));

      // โหมดใหม่: ก้อนเดียว/หรือหลายชิ้นก็เล่นได้
      this.ws.on("tts_start", (m) => this.player.beginStream(m.token || null));
      this.ws.on("tts_chunk", async (h) => {
        await this.player.pushChunk(h.bytes, {
          token: h.token,
          segmentId: h.segmentId,
          index: h.chunkIndex,
        });
      });
      this.ws.on("tts_end", (m) => this.player.endStream(m.token || null));
    }
    async start(localStream) {
      this.ws.connect();
      await this.rec.start(localStream);
      if (this.targetLang) this.ws.setTargetLang(this.targetLang);
      if (this.sourceLang) this.ws.setSourceLang(this.sourceLang);
    }
    stop() {
      try {
        this.rec.stop();
      } catch {}
      try {
        this.player.stop();
      } catch {}
      try {
        this.ws.close();
      } catch {}
    }
    setTargetLang(lang) {
      this.targetLang = lang;
      this.ws.setTargetLang(lang);
    }
    setSourceLang(lang) {
      this.sourceLang = lang || "auto";
      this.ws.setSourceLang(this.sourceLang);
    }
    setSpeakerUrl(url) {
      this.ws.setSpeakerUrl(url || null);
    }
    setMicMuted(m) {
      this.rec.setMuted(!!m);
    }
  }
  function resolveGatewayUrl() {
    if (window.__VOICE_GATEWAY_URL) return window.__VOICE_GATEWAY_URL;
    return (
      (location.protocol === "https:" ? "wss://" : "ws://") +
      location.host +
      "/ws/voice"
    );
  }

  // ------------------------- Bootstrap -------------------------
  window.voicePipeline = new VoicePipeline({
    url: resolveGatewayUrl(),
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
    log: (...a) => console.log("[VPL]", ...a),
  });

  // resume audio context on first user gesture
  document.addEventListener(
    "click",
    async () => {
      try {
        await window.voicePipeline?.player?.ac?.resume();
      } catch {}
    },
    { once: true }
  );

  // set speaker/langs & mic after hello_ok (เหมือนเดิม)
  window.voicePipeline.ws.on("hello_ok", async () => {
    try {
      window.voicePipeline.ws.setSpeakerUrl("/static/song/xtts/01.wav");
    } catch {}
    try {
      const srcSel = document.getElementById("voice-source-select");
      const tgtSel = document.getElementById("voice-translate-select");
      if (srcSel) window.voicePipeline.setSourceLang(srcSel.value || "auto");
      if (tgtSel) window.voicePipeline.setTargetLang(tgtSel.value || "off");
    } catch {}
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      await window.voicePipeline.rec.start(stream);
    } catch (e) {
      console.error("[VPL] mic error", e);
    }
  });

  window.voicePipeline.ws.connect();
})();
