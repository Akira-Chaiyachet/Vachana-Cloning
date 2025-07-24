// ==== DEBUG RTCVoice: Enhanced Log & UI Notification ====
window.liveAudioStreams = {}; // userId: MediaStream

const RTCVoice = {
  localStream: null,
  peerConnections: {}, // userId: RTCPeerConnection
  remoteStreams: {}, // userId: MediaStream
  signalingSendFunc: null,
  myUserId: null,

  // STEP 1: Start/Stop Mic
  async startLocalMic() {
    if (this.localStream) return this.localStream;
    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      window.liveAudioStreams[this.myUserId] = this.localStream;
      this.showRTCStatus('ไมโครโฟนพร้อมใช้งาน', 'success');

      // สร้าง audio (mute) สำหรับ test ใน dev
      let meAudio = document.getElementById("audio-self");
      if (!meAudio) {
        meAudio = document.createElement("audio");
        meAudio.id = "audio-self";
        meAudio.autoplay = true;
        meAudio.muted = true;
        meAudio.style.display = "none";
        document.body.appendChild(meAudio);
      }
      meAudio.srcObject = this.localStream;
      return this.localStream;
    } catch (e) {
      this.showRTCStatus("ไม่ได้รับอนุญาตใช้ไมโครโฟน หรือไมค์เสียบไม่ถูกต้อง", "error");
      alert("ไม่ได้รับอนุญาตใช้ไมโครโฟน หรือไมค์เสียบไม่ถูกต้อง");
      throw e;
    }
  },

  stopLocalMic() {
    if (this.localStream) {
      this.localStream.getTracks().forEach((track) => track.stop());
      delete window.liveAudioStreams[this.myUserId];
      this.localStream = null;
      let meAudio = document.getElementById("audio-self");
      if (meAudio) meAudio.remove();
      this.showRTCStatus('ปิดไมโครโฟน', 'info');
    }
  },

  // STEP 2: Join Voice Room
  async joinVoiceRoom(myUserId, allUserIds, signalingSendFunc) {
    this.myUserId = myUserId;
    this.signalingSendFunc = signalingSendFunc;
    await this.startLocalMic();
    for (let userId of allUserIds) {
      if (userId == myUserId) continue;
      this.createPeerConnection(userId, true); // initiator
    }
    this.showRTCStatus(`เชื่อมต่อ Peer (${allUserIds.length - 1}) คน`, 'info');
  },

  // STEP 3: Create PeerConnection
  createPeerConnection(userId, isInitiator) {
    if (this.peerConnections[userId]) return this.peerConnections[userId];
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.signalingSendFunc({
          action: "ice_candidate",
          target: userId,
          candidate: event.candidate,
        });
      }
    };

    pc.ontrack = (event) => {
      let remoteStream = this.remoteStreams[userId];
      if (!remoteStream) {
        remoteStream = new MediaStream();
        this.remoteStreams[userId] = remoteStream;
        window.liveAudioStreams[userId] = remoteStream;
        if (typeof this.onNewRemoteStream === "function") {
          this.onNewRemoteStream(userId, remoteStream);
        }
      }
      if (!remoteStream.getTracks().some((t) => t.id === event.track.id)) {
        remoteStream.addTrack(event.track);
      }
      this.showRTCStatus(`รับเสียงจาก User #${userId} สำเร็จ (ontrack)`, "success");
      console.log(`[RTC] ontrack user #${userId}`, event.streams);
    };

    pc.onconnectionstatechange = () => {
      console.log(`[RTC] PeerConnection กับ ${userId} สถานะ: ${pc.connectionState}`);
      if (pc.connectionState === "connected") {
        this.showRTCStatus(`RTC เชื่อมต่อกับ ${userId} สำเร็จ`, "success");
      } else if (["disconnected", "failed", "closed"].includes(pc.connectionState)) {
        this.showRTCStatus(`RTC กับ ${userId} หลุดหรือมีปัญหา (${pc.connectionState})`, "error");
        this.closePeer(userId);
      }
    };

    this.localStream
      .getTracks()
      .forEach((track) => pc.addTrack(track, this.localStream));
    this.peerConnections[userId] = pc;

    if (isInitiator) {
      pc.createOffer().then((offer) => {
        pc.setLocalDescription(offer);
        this.signalingSendFunc({
          action: "offer",
          target: userId,
          offer: offer,
        });
      });
    }
    return pc;
  },

  // STEP 4: Handle signaling
  async handleSignalingMessage(msg) {
    const { action, from, offer, answer, candidate } = msg;
    if (from == this.myUserId) return;
    if (action === "offer") {
      let pc = this.peerConnections[from];
      if (!pc) pc = this.createPeerConnection(from, false);
      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      const answerObj = await pc.createAnswer();
      await pc.setLocalDescription(answerObj);
      this.signalingSendFunc({
        action: "answer",
        target: from,
        answer: answerObj,
      });
      this.showRTCStatus(`รับข้อเสนอ (offer) จาก ${from} และตอบกลับ`, "info");
    } else if (action === "answer") {
      const pc = this.peerConnections[from];
      if (pc) {
        await pc.setRemoteDescription(new RTCSessionDescription(answer));
        this.showRTCStatus(`ได้รับ answer จาก ${from}`, "info");
      }
    } else if (action === "ice_candidate") {
      const pc = this.peerConnections[from];
      if (pc && candidate) {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
        this.showRTCStatus(`ICE Candidate จาก ${from} ถูกเพิ่ม`, "info");
      }
    }
  },

  // STEP 5: Disconnect
  leaveVoiceRoom() {
    for (const userId in this.peerConnections) {
      this.closePeer(userId);
    }
    this.stopLocalMic();
    Object.keys(this.remoteStreams).forEach((userId) => {
      let audioEl = document.getElementById("audio-" + userId);
      if (audioEl) audioEl.remove();
    });
    this.remoteStreams = {};
    this.showRTCStatus('ออกจากห้องพูดคุย/ปิดการเชื่อมต่อเสียง', 'info');
  },
  closePeer(userId) {
    const pc = this.peerConnections[userId];
    if (pc) pc.close();
    delete this.peerConnections[userId];
    delete this.remoteStreams[userId];
    delete window.liveAudioStreams[userId];
    let audioEl = document.getElementById("audio-" + userId);
    if (audioEl) audioEl.remove();
    if (typeof this.onRemoveRemoteStream === "function") {
      this.onRemoveRemoteStream(userId);
    }
    this.showRTCStatus(`ปิด PeerConnection กับ ${userId}`, 'info');
  },

  getStreamByUserId(userId) {
    return window.liveAudioStreams[userId] || null;
  },

  // ==== Audio UI ====
  onNewRemoteStream(userId, stream) {
    let audioEl = document.getElementById("audio-" + userId);
    if (!audioEl) {
      audioEl = document.createElement("audio");
      audioEl.id = "audio-" + userId;
      audioEl.autoplay = true;
      audioEl.controls = false;
      audioEl.style.display = "none";
      document.body.appendChild(audioEl);
    }
    audioEl.srcObject = stream;
    this.showRTCStatus(`เตรียม audio element สำหรับ ${userId}`, 'info');
  },

  onRemoveRemoteStream: null,

  showRTCStatus(message, type = "info") {
    // type: "success", "error", "info"
    console.log(`[RTC-UI][${type}] ${message}`);
    let el = document.getElementById("rtc-status-log");
    if (!el) {
      el = document.createElement("div");
      el.id = "rtc-status-log";
      el.style.position = "fixed";
      el.style.bottom = "30px";
      el.style.right = "30px";
      el.style.background = type === "success" ? "#53c36b" : (type === "error" ? "#e55" : "#333");
      el.style.color = "#fff";
      el.style.padding = "10px 18px";
      el.style.borderRadius = "16px";
      el.style.zIndex = "99999";
      el.style.fontSize = "18px";
      el.style.boxShadow = "0 4px 32px rgba(0,0,0,0.1)";
      document.body.appendChild(el);
    }
    el.innerText = message;
    el.style.display = "block";
    setTimeout(() => { el.style.display = "none"; }, 5000);
  }
};

// ต้องแน่ใจว่าประกาศก่อนใช้งาน
window.RTCVoiceChannels = window.RTCVoiceChannels || {};

function joinVoice(channelId = "main", retryCount = 0) {
  if (!window.socket || socket.readyState !== WebSocket.OPEN) {
    if (retryCount < 5) {
      setTimeout(() => joinVoice(channelId, retryCount + 1), 500);
    } else {
      alert(
        "WebSocket ยังไม่เชื่อมต่อกับเซิร์ฟเวอร์ กรุณารีเฟรชหรือเข้าห้องใหม่อีกครั้ง"
      );
    }
    return;
  }

  if (window.RTCVoice) RTCVoice.leaveVoiceRoom();
  if (!window.RTCVoiceChannels) window.RTCVoiceChannels = {};
  if (window.RTCVoiceChannels[channelId]) {
    window.RTCVoiceChannels[channelId].leaveVoiceRoom();
    delete window.RTCVoiceChannels[channelId];
  }
  window.RTCVoiceChannels[channelId] = Object.create(RTCVoice);

  const myUserId = currentLoggedInUserId;
  const allUserIds = allMembersData.map((m) => m.id);

  function sendSignaling(msg) {
    if (window.socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(msg));
    }
  }

  RTCVoice.joinVoiceRoom(myUserId, allUserIds, sendSignaling);
  window.activeVoiceChannelId = channelId;
  socket.send(JSON.stringify({ action: "voice_join", channel: channelId }));

  // UI: ซ่อนปุ่ม join
  const joinBtn = document.getElementById("joinVoiceBtn");
  if (joinBtn) joinBtn.style.display = "none";
  // UI: แสดงปุ่มออก
  const disconnectBtn = document.querySelector(".voice-controls .disconnect");
  if (disconnectBtn) disconnectBtn.style.display = "inline-block";
}

function leaveVoice(channelId = "main") {
  if (window.RTCVoice) RTCVoice.leaveVoiceRoom();
  if (window.RTCVoiceChannels && window.RTCVoiceChannels[channelId]) {
    window.RTCVoiceChannels[channelId].leaveVoiceRoom();
    delete window.RTCVoiceChannels[channelId];
  }
  if (window.socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ action: "voice_leave", channel: channelId }));
  }
  // UI: แสดงปุ่ม join อีกครั้ง
  const joinBtn = document.getElementById("joinVoiceBtn");
  if (joinBtn) joinBtn.style.display = "inline-block";
  // UI: ล้างรายชื่อในช่องเสียง
  updateVoiceMembersUI([]);
}
window.leaveVoice = leaveVoice;

function updateVoiceMembersUI(members) {
  const el = document.getElementById("voiceMembersEl");
  el.innerHTML = "";
  if (Array.isArray(members) && members.length) {
    members.forEach(uid => {
      const user = allMembersData.find(m => m.id == uid);
      if (user) {
        const div = document.createElement("div");
        div.className = "voice-member";
        div.innerHTML = `\n          <img src="${user.profile_image || '/media/default/profile.jpg'}" class="profile-img-voice">\n          <span>${user.name_to_display || user.username || user.id}</span>\n        `;
        el.appendChild(div);
      }
    });
  } else {
    el.innerHTML = `<span style="color: #aaa;">ยังไม่มีใครอยู่ในห้องพูดคุย</span>`;
  }
}

window.RTCVoice = RTCVoice;
