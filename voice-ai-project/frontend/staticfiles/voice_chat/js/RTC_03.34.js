// R:\s\PlatFormV2\voice-ai-project\frontend\static\voice_chat\js\RTC_03.22.js
// --- Discord-style Voice Chat RTC State + Auto-Reconnect (Self-contained) ---

// ========= Module-Scoped RTC/Voice State =========
let currentChatRoomId = null;
let rtcActiveRoomId = null;
let rtcIsJoined = false;
let rtcSignalingWSHandler = null; // ใช้ handler แทน ws ตรงๆ
let rtcPeerConnections = {};
let rtcLocalStream = null;
let initiatedOffers = {}; // module-scope
let pendingICECandidates = {}; // { peerId: [candidate, ...] }
let isMicMuted = false;
let isSpeakerMuted = false;
let translateEnabled = false; // เก็บสถานะว่ากำลังแปลอยู่หรือไม่
// --- First-time tip flag (แสดงครั้งเดียวต่อเบราว์เซอร์/ผู้ใช้) ---
const FIRST_TIP_KEY = (() => {
  const uid = (window.currentUserId || window.myRTCUserId || 'anon');
  return `voice_firsttime_tip_v1_${uid}`;
})();

// ========= Auto-Reconnect Utility (สำหรับ WS signaling) =========
function createAutoReconnectWS(
  url,
  { onopen, onmessage, onclose },
  maxRetry = 10
) {
  let ws = null,
    retry = 0,
    reconnectTimer = null,
    shouldReconnect = true;
  function connect() {
    ws = new WebSocket(url);
    ws.onopen = function (e) {
      retry = 0;
      if (onopen) onopen(e, ws);
    };
    ws.onmessage = function (e) {
      if (onmessage) onmessage(e, ws);
    };
    ws.onclose = function (e) {
      if (!shouldReconnect) return;
      if (retry < maxRetry) {
        let interval = Math.min(1000 * Math.pow(2, retry), 20000);
        reconnectTimer = setTimeout(connect, interval);
        retry += 1;
        if (onclose) onclose(e, ws, retry, interval);
      } else {
        if (onclose) onclose(e, ws, retry, -1);
      }
    };
    ws.onerror = function () {
      ws.close();
    };
  }
  connect();
  return {
    send: (...args) => (ws && ws.readyState === 1 ? ws.send(...args) : null),
    close: () => {
      shouldReconnect = false;
      ws.close();
      if (reconnectTimer) clearTimeout(reconnectTimer);
    },
    getWS: () => ws,
  };
}

// ========= Voice RTC State Management =========
function resetVoiceState() {
  rtcActiveRoomId = null;
  rtcIsJoined = false;
  if (rtcSignalingWSHandler) rtcSignalingWSHandler.close();
  rtcSignalingWSHandler = null;
  for (const peerId in rtcPeerConnections) {
    try {
      rtcPeerConnections[peerId].close();
    } catch { }
    delete initiatedOffers[peerId];
  }
  rtcPeerConnections = {};
  if (rtcLocalStream) {
    rtcLocalStream.getTracks().forEach((track) => track.stop());
    rtcLocalStream = null;
  }
  try {
    window.voicePipeline?.stop();
  } catch (e) {
    console.warn(e);
  } // ✅ พอแค่ตรงนี้
  resetVoiceUI();
  try {
    window.voicePipeline?.stop();
  } catch (e) {
    console.warn(e);
  }
  hideVoiceLoading();
}

function resetVoiceUI() {
  const el = document.getElementById("voiceMembersEl");
  if (el) el.innerHTML = "";
  const statusText = document.getElementById("voice-status-text");
  if (statusText) statusText.textContent = "ยังไม่ได้เชื่อมต่อห้องเสียง";
}
function isVoiceActive() {
  return rtcIsJoined && rtcActiveRoomId !== null;
}
function ensureRoomConsistency() {
  if (
    rtcIsJoined &&
    (!rtcActiveRoomId || rtcActiveRoomId !== currentChatRoomId)
  ) {
    console.error("RTC State Inconsistent:", {
      rtcIsJoined,
      rtcActiveRoomId,
      currentChatRoomId,
    });
    resetVoiceState();
  }
}

// ========= RTC Signaling WS Connect/Auto-Reconnect =========
function connectRTCSignalingWS(roomId) {
  // หยุดตัวเดิมถ้ามี
  if (rtcSignalingWSHandler) rtcSignalingWSHandler.close();
  // --- สร้าง WS ใหม่ + auto reconnect
  const wsProto = window.location.protocol === "https:" ? "wss" : "ws";
  const url = `${wsProto}://${window.location.host}/ws/rtc/${roomId}/`;
  rtcSignalingWSHandler = createAutoReconnectWS(url, {
    onopen: async () => {
      const statusText = document.getElementById("voice-status-text");
      if (statusText) statusText.textContent = "เชื่อมต่อห้องเสียงสำเร็จ";
      // พยายามปลดล็อกอัตโนมัติแบบเงียบ ๆ (จะสำเร็จเฉพาะบาง policy)
      try { await unlockAudioPlayback(); } catch { }
    },
    onmessage: (event) => {
      // --- handle RTC signaling message (offer/answer/ICE ฯลฯ)
      let data;
      try {
        data = JSON.parse(event.data);
      } catch {
        return;
      }

      if (data.type === "voice_member_update" && data.members) {
        // ใช้ rtcActiveRoomId ถ้าไม่มี room_id จาก server
        updateVoiceMembersUI(data.members, data.room_id || rtcActiveRoomId);
      }
      if (["offer", "answer", "ice"].includes(data.type)) {
        handleRTCSignalingMessage(data);
      }
      // TODO: RTC peer logic...
    },
    onclose: (e, ws, retry, interval) => {
      const statusText = document.getElementById("voice-status-text");
      if (retry === -1) {
        if (statusText)
          statusText.textContent = "เชื่อมต่อเสียงล้มเหลว กรุณา leave/เข้าใหม่";
      } else if (statusText) {
        statusText.textContent = `เชื่อมต่อเสียงใหม่... (ครั้งที่ ${retry})`;
      }
    },
  });
}

// ========= Public API =========
function joinVoiceRoom(roomId) {
  if (rtcIsJoined && rtcActiveRoomId !== roomId)
    leaveVoiceRoom(rtcActiveRoomId);

  connectRTCSignalingWS(roomId);

  // ❌ อย่าเพิ่งตั้งค่าเป็น true ตรงนี้
  // rtcIsJoined = true;
  // หลัง start แล้ว ย้ำค่าที่ UI เลือกอยู่
  const srcSel = document.getElementById("voice-source-select");
  const tgtSel = document.getElementById("voice-translate-select");
  if (srcSel) window.voicePipeline?.setSourceLang(srcSel.value || "auto");
  if (tgtSel)
    window.voicePipeline?.setTargetLang(
      tgtSel.value === "off" ? "off" : tgtSel.value
    );

  currentChatRoomId = roomId;
  window.currentChatRoomId = roomId;
  renderVoiceJoinLeaveButton();

  Object.keys(rtcPeerConnections).forEach((peerId) => {
    rtcPeerConnections[peerId].close();
    delete rtcPeerConnections[peerId];
  });
  showVoiceLoading('กำลังขอไมโครโฟนและเชื่อมต่อเสียง…');
  navigator.mediaDevices
    .getUserMedia({ audio: true, video: false })
    .then((stream) => {
      rtcLocalStream = stream;
      if (isMicMuted) {
        rtcLocalStream
          .getAudioTracks()
          .forEach((track) => (track.enabled = false));
      }
      rtcActiveRoomId = roomId;
      rtcIsJoined = true; // ✅ ย้ายมาที่นี่ (หลังได้ไมค์สำเร็จ)

      if (rtcSignalingWSHandler)
        rtcSignalingWSHandler.send(JSON.stringify({ type: "voice_join" }));

      Object.keys(rtcPeerConnections).forEach((peerId) => {
        rtcPeerConnections[peerId].close();
        delete rtcPeerConnections[peerId];
        delete initiatedOffers[peerId];
        removeAudioElement(peerId);
        createPeerConnectionForPeer(peerId);
        if (String(window.myRTCUserId) < peerId) initiateOffer(peerId);
      });

      ensureTrackForAllPeers();
      const statusText = document.getElementById("voice-status-text");
      if (statusText) statusText.textContent = "เชื่อมต่อห้องเสียงสำเร็จ";

      try {
        window.voicePipeline?.start(rtcLocalStream);
        window.voicePipeline.setSpeakerUrl('http://web:8000/static/song/xtts/01.wav');
      } catch (e) {
        console.warn(e);
      }
      maybeShowFirstTimeTip();
    })
    .catch((err) => {
      console.error("getUserMedia error:", err);
      hideVoiceLoading();
      // ✅ rollback state
      rtcActiveRoomId = null;
      rtcIsJoined = false;
      renderVoiceJoinLeaveButton();
      const statusText = document.getElementById("voice-status-text");
      if (statusText) statusText.textContent = "ขอไมค์ไม่สำเร็จ";
      // ปิด WS signaling ที่เปิดไปแล้ว
      if (rtcSignalingWSHandler) rtcSignalingWSHandler.close();
      rtcSignalingWSHandler = null;
    });
  try {
    window.voicePipeline?.start(rtcLocalStream);
  } catch (e) {
    console.warn(e);
  }
}

function confirmLeaveVoiceRoom() {
  const roomName =
    document.getElementById("roomTitle").textContent || "ห้องเสียง";
  if (confirm(`คุณต้องการออกจากห้องเสียง "${roomName}" หรือไม่?`)) {
    leaveVoiceRoom(window.currentChatRoomId);
  }
}

function leaveVoiceRoom(roomId) {
  if (rtcSignalingWSHandler)
    rtcSignalingWSHandler.send(JSON.stringify({ type: "voice_leave" }));
  resetVoiceState();
  rtcIsJoined = false;
  renderVoiceJoinLeaveButton();
  const statusText = document.getElementById("voice-status-text");
  if (statusText) statusText.textContent = "ออกจากห้องเสียงแล้ว";
}
function updateVoiceMembersUI(members, roomId = null) {
  console.log(
    "[updateVoiceMembersUI] members=",
    members,
    "roomId=",
    roomId,
    "window.currentChatRoomId=",
    window.currentChatRoomId
  );

  // ถ้า roomId ไม่ตรงกับห้องปัจจุบัน ให้ข้าม
  // ใช้ window.currentChatRoomId ซึ่งเป็น ID ของห้องที่กำลังดูอยู่เป็นตัวเปรียบเทียบ
  if (roomId && String(roomId) !== String(window.currentChatRoomId)) {
    console.log(
      `Skip updateVoiceMembersUI: different room. Event for ${roomId}, currently in ${window.currentChatRoomId}`
    );
    return;
  }

  const el = document.getElementById("voiceMembersEl");
  if (!el) return;

  el.innerHTML = "";

  const count = members ? members.length : 0;
  const countLabel = `<div class="voice-member-count">
        ${count === 0 ? "ยังไม่มีใครอยู่ในห้องเสียง" : `${count} คนในห้องเสียง`}
    </div>`;
  el.innerHTML += countLabel;

  if (count === 0) return;

  // แสดงรายชื่อสมาชิกทุกคน (ถ้ามี id ตัวเอง ให้แยก highlight)
  const myId = String(window.myRTCUserId || window.currentUserId || "");
  members.forEach((member) => {
    const isMe = myId && String(member.userId) === myId;
    const peerId = member.userId;
    el.innerHTML += `
        <div class="voice-member${isMe ? " me" : ""}" data-peer-id="${peerId}">
            <img src="${member.avatarUrl || "/media/default/user.png"}"
                class="voice-avatar">
            <span class="voice-member-name">${member.displayName}</span>
            ${!isMe
        ? `
                    <div class="voice-volume-wrapper">
                        <span class="voice-volume-label" id="volume-label-${peerId}">100</span>
                        <input 
                            type="range" 
                            class="voice-volume-slider"
                            min="0" max="100" value="100" 
                            data-peer-id="${peerId}"
                            oninput="onVoiceVolumeChange('${peerId}', this.value)">
                    </div>
                  `
        : ""
      }
        </div>
    `;
  });
}
function onVoiceVolumeChange(peerId, value) {
  const audio = document.getElementById(`voice-audio-${peerId}`);
  if (audio) {
    // ป้องกันค่าหลุด
    let v = Math.max(0, Math.min(Number(value), 100));
    audio.volume = v / 100;
  }
  // อัปเดต label
  const label = document.getElementById(`volume-label-${peerId}`);
  if (label) label.textContent = value + "%";
}
window.onVoiceVolumeChange = onVoiceVolumeChange; // สำคัญ!

window.joinVoiceRoom = joinVoiceRoom;
window.leaveVoiceRoom = leaveVoiceRoom;
window.updateVoiceMembersUI = updateVoiceMembersUI;
window.currentChatRoomId = currentChatRoomId; // (ถ้าจะใช้อ้างอิง)

function renderVoiceJoinLeaveButton() {
  const joinBtn = document.querySelector(".voie-room-title button");
  if (!joinBtn) return;
  if (rtcIsJoined && rtcActiveRoomId === currentChatRoomId) {
    joinBtn.textContent = "ออกจากห้องเสียง";
    joinBtn.onclick = confirmLeaveVoiceRoom;
    joinBtn.className = "disconnect";
  } else {
    joinBtn.textContent = "เข้าร่วม";
    joinBtn.onclick = handleJoinVoiceClick;
    joinBtn.className = "connect";
  }
}

function handleJoinVoiceClick() {
  if (rtcIsJoined && rtcActiveRoomId !== currentChatRoomId) {
    // popup: คุณต้องการออกจากห้องเสียงเดิม และเข้าห้องนี้หรือไม่
    const oldRoomName =
      localStorage.getItem("currentRoomName") || rtcActiveRoomId;
    const newRoomName =
      document.getElementById("roomTitle").textContent || currentChatRoomId;
    if (
      confirm(
        `คุณต้องการออกจากห้องเสียง "${oldRoomName}" และเข้าร่วมห้อง "${newRoomName}" หรือไม่?`
      )
    ) {
      leaveVoiceRoom(rtcActiveRoomId);
      joinVoiceRoom(currentChatRoomId);
    }
  } else if (!rtcIsJoined) {
    joinVoiceRoom(currentChatRoomId);
  }
}

window.handleJoinVoiceClick = handleJoinVoiceClick;
function clearVoiceRoomUIOnRoomSwitch() {
  updateVoiceMembersUI([]);
  renderVoiceJoinLeaveButton();
  const statusText = document.getElementById("voice-status-text");
  if (statusText) statusText.textContent = "ยังไม่ได้เชื่อมต่อห้องเสียง";
}
window.myRTCUserId = window.currentUserId;

function onVoiceMemberUpdate(members) {
  const myId = String(window.myRTCUserId);
  // -- Cleanup รอบเดียว! (ไว้บนสุดหรือล่างสุดรอบเดียว)
  Object.keys(rtcPeerConnections).forEach((peerId) => {
    if (!members.some((m) => String(m.userId) === peerId)) {
      rtcPeerConnections[peerId].close();
      delete rtcPeerConnections[peerId];
      delete initiatedOffers[peerId];
      removeAudioElement(peerId);
    }
  });
  // -- Add/Initiate peers
  members.forEach((member) => {
    const peerId = String(member.userId);
    if (peerId === myId) return;
    if (!rtcPeerConnections[peerId]) {
      console.log(
        `[RTC] createPeerConnectionForPeer. myId=${myId}, peerId=${peerId}`
      );
      createPeerConnectionForPeer(peerId);
      if (myId < peerId) {
        console.log(
          `[RTC] myId < peerId (${myId} < ${peerId}) => initiateOffer(${peerId})`
        );
        initiateOffer(peerId);
      } else {
        console.log(`[RTC] myId >= peerId (${myId} >= ${peerId}) => รอ offer`);
      }
    }
  });
  ensureTrackForAllPeers();
}

function createPeerConnectionForPeer(peerId) {
  if (rtcPeerConnections[peerId]) {
    console.log(
      "[RTC] PeerConnection for peerId",
      peerId,
      "already exists, skip create."
    );
    return;
  }
  console.log(
    "[RTC] createPeerConnectionForPeer. myId=",
    window.myRTCUserId,
    "peerId=",
    peerId
  );
  const pc = new RTCPeerConnection({
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
  });
  if (rtcLocalStream) {
    rtcLocalStream.getTracks().forEach((track) => {
      const alreadyAdded = pc
        .getSenders()
        .find((s) => s.track && s.track.id === track.id);
      if (!alreadyAdded) {
        console.log("[RTC] Add track to peer:", peerId, track);
        pc.addTrack(track, rtcLocalStream);
      }
    });
  }
  pc.ontrack = (event) => {
    console.log(
      "[RTC] ontrack: peerId=",
      peerId,
      "streams=",
      event.streams,
      "track=",
      event.track
    );
    attachRemoteAudio(event.streams[0], peerId);
  };

  // ส่ง candidate
  pc.onicecandidate = (event) => {
    if (event.candidate) {
      console.log("Send ICE candidate:", peerId, event.candidate);
      sendSignalingMessage("ice", peerId, event.candidate);
    }
  };

  rtcPeerConnections[peerId] = pc;
}
function sendSignalingMessage(type, targetPeerId, data) {
  if (!rtcSignalingWSHandler) return;
  const message = {
    type: type, // "offer" | "answer" | "ice"
    from: window.myRTCUserId,
    target: targetPeerId,
    data: data,
  };
  rtcSignalingWSHandler.send(JSON.stringify(message));
}
function handleRTCSignalingMessage(data) {
  const myId = String(window.myRTCUserId);
  // ให้ message เฉพาะที่ “target” ถึงเราเท่านั้น
  if (!data.target || String(data.target) !== myId) return;

  const peerId = String(data.from);

  switch (data.type) {
    case "offer":
      onReceivedOffer(peerId, data.data);
      break;
    case "answer":
      onReceivedAnswer(peerId, data.data);
      break;
    case "ice":
      onReceivedICE(peerId, data.data);
      break;
  }
}
// ผู้เริ่ม initiate
async function initiateOffer(peerId) {
  if (initiatedOffers[peerId]) {
    console.log("[RTC] Already initiated offer to peerId", peerId, "skip.");
    return;
  }
  initiatedOffers[peerId] = true; // set flag
  console.log(
    `[RTC] initiateOffer: myId=${window.myRTCUserId} → peerId=${peerId}`
  );
  console.log("initiateOffer:", peerId);
  const pc = rtcPeerConnections[peerId];
  if (!pc) return;
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  sendSignalingMessage("offer", peerId, offer);
}

// ฝั่ง receiver
async function onReceivedOffer(peerId, offer) {
  console.log(
    `[RTC] onReceivedOffer: myId=${window.myRTCUserId} ← peerId=${peerId}`
  );
  console.log("onReceivedOffer from", peerId, offer);
  let pc = rtcPeerConnections[peerId];
  if (!pc) {
    createPeerConnectionForPeer(peerId);
    pc = rtcPeerConnections[peerId];
  }
  await pc.setRemoteDescription(new RTCSessionDescription(offer));
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  sendSignalingMessage("answer", peerId, answer);
  if (pendingICECandidates[peerId]) {
    for (const c of pendingICECandidates[peerId]) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(c));
      } catch (err) {
        console.warn("[RTC] flushICE addIceCandidate error", err, c);
      }
    }
    delete pendingICECandidates[peerId];
  }
}

async function onReceivedAnswer(peerId, answer) {
  console.log(
    `[RTC] onReceivedAnswer: myId=${window.myRTCUserId} ← peerId=${peerId}`
  );
  console.log("onReceivedAnswer from", peerId, answer);
  const pc = rtcPeerConnections[peerId];
  if (!pc) return;
  await pc.setRemoteDescription(new RTCSessionDescription(answer));
  if (pendingICECandidates[peerId]) {
    for (const c of pendingICECandidates[peerId]) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(c));
      } catch (err) {
        console.warn("[RTC] flushICE addIceCandidate error", err, c);
      }
    }
    delete pendingICECandidates[peerId];
  }
}

async function onReceivedICE(peerId, candidate) {
  const pc = rtcPeerConnections[peerId];
  if (!pc) return;

  if (!pc.remoteDescription || !pc.remoteDescription.type) {
    // ถ้ายังไม่ได้ setRemoteDescription
    if (!pendingICECandidates[peerId]) pendingICECandidates[peerId] = [];
    pendingICECandidates[peerId].push(candidate);
    console.log(
      "[RTC] Buffer ICE candidate until remoteDescription set",
      peerId,
      candidate
    );
    return;
  }
  // ถ้า setRemoteDescription แล้ว ค่อย add
  try {
    await pc.addIceCandidate(new RTCIceCandidate(candidate));
    console.log("[RTC] addIceCandidate (immediate)", peerId, candidate);
  } catch (err) {
    console.warn("[RTC] addIceCandidate error", err, candidate);
  }
}

function attachRemoteAudio(remoteStream, peerId) {
  let audio = document.getElementById(`voice-audio-${peerId}`);
  if (!audio) {
    audio = document.createElement("audio");
    audio.id = `voice-audio-${peerId}`;
    audio.autoplay = true;
    audio.controls = true; // เปิด controls ชั่วคราว เพื่อ debug
    document.body.appendChild(audio);
  }
  audio.srcObject = remoteStream;
  console.log("Attach remote stream:", peerId, remoteStream, audio);
    // ซ่อน overlay เมื่อเสียงเริ่มเล่นจริง
  const markPlayed = () => {
    if (_voiceLoad.firstPlayed) return;
    _voiceLoad.firstPlayed = true;
    hideVoiceLoading();
  };
  audio.addEventListener('playing', markPlayed, { once: true });
  audio.addEventListener('canplay', () => setTimeout(markPlayed, 100), { once: true });

  // กันเคส track ถูก mute อยู่ช่วงแรก (SFU/เพิ่งต่อ) → รอ unmute แล้วค่อย hide
  try {
    const [track] = remoteStream.getAudioTracks();
    if (track) {
      track.onunmute = () => setTimeout(markPlayed, 50);
    }
  } catch {}

}

function removeAudioElement(peerId) {
  const audio = document.getElementById(`voice-audio-${peerId}`);
  if (audio) audio.remove();
}
// เมื่อเราได้ rtcLocalStream ใหม่ หลัง join
function ensureTrackForAllPeers() {
  if (!rtcLocalStream) return;
  Object.entries(rtcPeerConnections).forEach(([peerId, pc]) => {
    // เช็คก่อนว่า track นี้ถูก add ไปหรือยัง
    const senders = pc.getSenders();
    rtcLocalStream.getTracks().forEach((track) => {
      if (!senders.find((s) => s.track && s.track.id === track.id)) {
        console.log("Add track to peer:", peerId, track);
        pc.addTrack(track, rtcLocalStream);
      }
    });
  });
}
function toggleMicMute() {
  isMicMuted = !isMicMuted;
  // ถ้ามี localStream อยู่ ให้ apply ทันที
  if (rtcLocalStream) {
    rtcLocalStream.getAudioTracks().forEach((track) => {
      track.enabled = !isMicMuted; // enabled = false = mute
    });
  }
  updateMicButtonUI(); // อัปเดตสีปุ่ม
}
function toggleSpeakerMute() {
  isSpeakerMuted = !isSpeakerMuted;
  // ปิด/เปิดเสียงทุก peer
  document.querySelectorAll('audio[id^="voice-audio-"]').forEach((audio) => {
    audio.muted = isSpeakerMuted;
  });
  updateSpeakerButtonUI();
}
function updateMicButtonUI() {
  const btn = document.getElementById("micBtn");
  if (isMicMuted) {
    btn.style.background = "#ff5252"; // แดงอ่อน
  } else {
    btn.style.background = "";
  }
}
function updateSpeakerButtonUI() {
  const btn = document.getElementById("speakerBtn");
  if (isSpeakerMuted) {
    btn.style.background = "#ff5252"; // แดงอ่อน
  } else {
    btn.style.background = "";
  }
}
function getRoomAudios() {
  return document.querySelectorAll(
    'audio[id^="voice-audio-"], audio.rtc-remote, audio[id^="rtc-remote-"]'
  );
}

function applySpeakerMuteState() {
  const shouldMute = isSpeakerMuted || translateEnabled;
  getRoomAudios().forEach((audio) => {
    audio.muted = shouldMute;
    // บาง browser ถ้า muted ยังเล็ดรอดเล็กน้อย ก็ซ้ำด้วย volume
    audio.volume = shouldMute ? 0.0 : (audio.dataset._origVol ? parseFloat(audio.dataset._origVol) : 1.0);
  });
}
const mo = new MutationObserver(() => applySpeakerMuteState());
mo.observe(document.body, { childList: true, subtree: true });
window.addEventListener('beforeunload', () => mo.disconnect());
async function toggleTranslate() {
  translateEnabled = !translateEnabled;

  // แจ้งไปที่ gateway ด้วย (ถ้าคุณมี dropdown เลือกภาษา ก็เปลี่ยนจาก 'en' เป็นที่ใช้จริง)
  try {
    if (window.voicePipeline) {
      window.voicePipeline.setTargetLang(translateEnabled ? 'en' : 'off');
    }
  } catch { }

  applySpeakerMuteState();
  updateTranslateButtonUI?.(translateEnabled);
}

// ========= Voice Loading Overlay =========
const _voiceLoad = { el: null, timer: null, resolved: false };

function showVoiceLoading(tip = 'กำลังเชื่อมต่อเสียง…') {
  if (_voiceLoad.el) { updateVoiceLoadingText(tip); return; }

  const el = document.createElement('div');
  el.id = 'voice-loading-overlay';
  el.style.cssText = `
    position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;
    background:rgba(0,0,0,.55);backdrop-filter:saturate(1.2) blur(2px);color:#fff;flex-direction:column;
    font-family:system-ui,Segoe UI,Roboto,Arial,sans-serif;text-align:center;gap:14px
  `;
  el.innerHTML = `
    <div style="width:44px;height:44px;border-radius:50%;border:4px solid rgba(255,255,255,.35);
                border-top-color:#fff;animation:spin 1s linear infinite"></div>
    <div id="voice-loading-text" style="font-size:16px">${tip}</div>
    <div style="display:flex;gap:10px">
      <button id="voice-loading-unlock" style="
        padding:10px 16px;border-radius:10px;border:0;background:#00a3ff;color:#001018;font-weight:600;display:none">
        คลิกเพื่อเริ่มเสียง
      </button>
      <button id="voice-loading-leave" style="
        padding:10px 16px;border-radius:10px;border:0;background:#ff6b6b;color:#001018;font-weight:600;">
        ออกจากห้องเสียง
      </button>
    </div>
    <div style="font-size:12px;opacity:.85;max-width:520px;line-height:1.45">
      ถ้ายังไม่ได้ยิน ลองกด “เริ่มเสียง” เพื่ออนุญาตการเล่นเสียงอัตโนมัติ/ไมโครโฟน<br>
      หรือเครือข่ายอาจหน่วงชั่วคราว—ถ้าไม่ได้ ลองออกจากห้องแล้วเข้าใหม่
    </div>
    <style>@keyframes spin{to{transform:rotate(360deg)}}</style>
  `;
  document.body.appendChild(el);
  _voiceLoad.el = el;

  // ปุ่มปลดล็อก autoplay
  el.querySelector('#voice-loading-unlock')?.addEventListener('click', unlockAudioPlayback);
  // ปุ่มออกจากห้อง
  el.querySelector('#voice-loading-leave')?.addEventListener('click', () => {
    try { window.confirmLeaveVoiceRoom?.(); } catch {}
    hideVoiceLoading();
  });

  // ถ้ายังไม่เล่นภายใน 7s ให้โชว์ปุ่มปลดล็อก
  if (_voiceLoad.timer) clearTimeout(_voiceLoad.timer);
  _voiceLoad.timer = setTimeout(() => {
    const btn = el.querySelector('#voice-loading-unlock');
    if (btn) btn.style.display = 'inline-block';
    updateVoiceLoadingText('ยังไม่ได้ยินเสียง? คลิก “เริ่มเสียง” ด้านล่าง');
  }, 7000);
}

function updateVoiceLoadingText(tip) {
  if (_voiceLoad.el) {
    const t = _voiceLoad.el.querySelector('#voice-loading-text');
    if (t) t.textContent = tip;
  }
}

function hideVoiceLoading(doneText = null) {
  if (_voiceLoad.timer) { clearTimeout(_voiceLoad.timer); _voiceLoad.timer = null; }
  if (doneText) updateVoiceLoadingText(doneText);
  if (_voiceLoad.el) {
    _voiceLoad.el.remove();
    _voiceLoad.el = null;
  }
  _voiceLoad.resolved = true;
}

async function unlockAudioPlayback() {
  try {
    // 1) ปลดล็อก WebAudio ใน pipeline (ถ้ามี)
    await window.voicePipeline?.player?.ac?.resume?.().catch(()=>{});

    // 2) one‑shot AudioContext เพื่อ gesture unlock (กันบางบราวเซอร์แปลก ๆ)
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) {
      const ac = new AC();
      const buf = ac.createBuffer(1, 1, ac.sampleRate);
      const src = ac.createBufferSource();
      src.buffer = buf;
      src.connect(ac.destination);
      src.start();
      await ac.resume().catch(()=>{});
      setTimeout(() => { try { ac.close(); } catch {} }, 120);
    }

    // 3) สั่งเล่น/ปลด mute remote audios ที่มีอยู่
    const audios = document.querySelectorAll('audio[id^="voice-audio-"], audio.rtc-remote, audio[id^="rtc-remote-"]');
    audios.forEach(a => {
      if (!a.dataset._origVol) a.dataset._origVol = a.volume;
      a.muted = false;
      a.volume = parseFloat(a.dataset._origVol) || 1;
      a.play?.().catch(()=>{});
    });

    hideVoiceLoading('เริ่มเล่นเสียงแล้ว');
  } catch (e) {
    console.warn('unlockAudioPlayback error', e);
    updateVoiceLoadingText('ยังปลดล็อกเสียงไม่ได้ ลองคลิกอีกครั้ง');
  }
}
function _bindFirstPlaybackAutoHide() {
  const audios = document.querySelectorAll('audio[id^="voice-audio-"], audio.rtc-remote, audio[id^="rtc-remote-"]');
  audios.forEach(a => {
    if (a._vpl_listened) return;
    a._vpl_listened = true;
    a.addEventListener('playing', () => {
      if (!_voiceLoad.resolved) hideVoiceLoading();
    }, { once: true });
  });
}
const _voiceLoadMO = new MutationObserver(_bindFirstPlaybackAutoHide);
_voiceLoadMO.observe(document.body, { childList: true, subtree: true });
window.addEventListener('beforeunload', () => _voiceLoadMO.disconnect());


// ========= First-Time Speak Tip Overlay (one-time) =========
const _firstTip = { el: null, timer: null };

function maybeShowFirstTimeTip() {
  try {
    if (localStorage.getItem(FIRST_TIP_KEY) === '1') return; // เคยแสดงแล้ว → ข้าม
  } catch {}
  showFirstTimeSpeakTip();
}

function showFirstTimeSpeakTip() {
  if (_firstTip.el) return;

  const el = document.createElement('div');
  el.id = 'voice-firsttime-tip';
  el.style.cssText = `
    position:fixed;inset:0;z-index:10000;display:flex;align-items:center;justify-content:center;
    background:rgba(0,0,0,.55);backdrop-filter:saturate(1.2) blur(2px);color:#fff;flex-direction:column;
    font-family:system-ui,Segoe UI,Roboto,Arial,sans-serif;text-align:center;gap:16px;padding:20px
  `;
  el.innerHTML = `
    <div style="width:48px;height:48px;border-radius:50%;border:4px solid rgba(255,255,255,.35);
                border-top-color:#fff;animation:spin 1s linear infinite"></div>
    <div style="font-size:18px;font-weight:700">กรุณาพูดมากกว่า 5 วินาที</div>
    <div style="font-size:14px;opacity:.95;max-width:560px;line-height:1.55">
      เพื่อเก็บตัวอย่างเสียงครั้งแรกสำหรับการปรับคุณภาพการสื่อสารอัตโนมัติ ระบบจะทำงานเบื้องหลังและหน้าต่างนี้จะปิดเอง
    </div>
    <button id="firsttime-tip-close" style="
      padding:10px 16px;border-radius:10px;border:0;background:#00a3ff;color:#001018;font-weight:600;">
      เข้าใจแล้ว
    </button>
    <style>@keyframes spin{to{transform:rotate(360deg)}}</style>
  `;
  document.body.appendChild(el);
  _firstTip.el = el;

  // ปิดเองอัตโนมัติใน 10 วินาที
  _firstTip.timer = setTimeout(hideFirstTimeSpeakTip, 10000);

  // ปุ่มปิดทันที
  el.querySelector('#firsttime-tip-close')?.addEventListener('click', hideFirstTimeSpeakTip);
}

function hideFirstTimeSpeakTip() {
  try { localStorage.setItem(FIRST_TIP_KEY, '1'); } catch {}
  if (_firstTip.timer) { clearTimeout(_firstTip.timer); _firstTip.timer = null; }
  if (_firstTip.el) { _firstTip.el.remove(); _firstTip.el = null; }
}
