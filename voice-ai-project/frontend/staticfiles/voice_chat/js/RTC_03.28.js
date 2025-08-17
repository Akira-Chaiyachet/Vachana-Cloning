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
    } catch {}
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
    onopen: () => {
      const statusText = document.getElementById("voice-status-text");
      if (statusText) statusText.textContent = "เชื่อมต่อห้องเสียงสำเร็จ";
      // ส่ง join event ได้ตรงนี้ ถ้าต้องการ
      // rtcSignalingWSHandler.send(JSON.stringify({type:"voice_join"}));
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
      } catch (e) {
        console.warn(e);
      }
    })
    .catch((err) => {
      console.error("getUserMedia error:", err);
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
            ${
              !isMe
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
