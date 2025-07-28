// --- Discord-style Voice Chat RTC State + Auto-Reconnect (Self-contained) ---

// ========= Module-Scoped RTC/Voice State =========
let currentChatRoomId = null;
let rtcActiveRoomId = null;
let rtcIsJoined = false;
let rtcSignalingWSHandler = null; // ใช้ handler แทน ws ตรงๆ
let rtcPeerConnections = {};
let rtcLocalStream = null;

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
  }
  rtcPeerConnections = {};
  if (rtcLocalStream) {
    rtcLocalStream.getTracks().forEach((track) => track.stop());
    rtcLocalStream = null;
  }
  resetVoiceUI();
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
  rtcIsJoined = true;
  currentChatRoomId = roomId; // อัพเดท currentChatRoomId
  window.currentChatRoomId = roomId; // อัพเดท window.currentChatRoomId ด้วย
  renderVoiceJoinLeaveButton();

  navigator.mediaDevices
    .getUserMedia({ audio: true, video: false })
    .then((stream) => {
      rtcLocalStream = stream;
      rtcActiveRoomId = roomId;
      rtcIsJoined = true;
      if (rtcSignalingWSHandler)
        rtcSignalingWSHandler.send(JSON.stringify({ type: "voice_join" }));
      const statusText = document.getElementById("voice-status-text");
      if (statusText) statusText.textContent = "เชื่อมต่อห้องเสียงสำเร็จ";
    })
    .catch((err) => {
      rtcLocalStream = null;
      const statusText = document.getElementById("voice-status-text");
      if (statusText) statusText.textContent = "ไมค์ใช้งานไม่ได้";
      resetVoiceState();
    });
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
    el.innerHTML += `
            <div class="voice-member${isMe ? " me" : ""}">
                <span class="mic-icon">🎤</span>
                <img src="${member.avatarUrl || "/media/default/user.png"}"
                     class="voice-avatar"
                     style="width:32px;height:32px;border-radius:50%;margin-right:8px;">
                <span>${member.displayName}${isMe ? " (คุณ)" : ""}</span>
            </div>`;
  });
}

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

  members.forEach((member) => {
    const peerId = String(member.userId);
    if (peerId === myId) return; // ข้ามตัวเอง

    // ถ้ายังไม่มี peerConnection กับคนนี้
    if (!rtcPeerConnections[peerId]) {
      createPeerConnectionForPeer(peerId);

      // “initiator” คือ user id น้อยกว่า
      if (myId < peerId) {
        initiateOffer(peerId);
      }
    }
  });

  // cleanup: ถ้า peer ออกจากห้อง
  Object.keys(rtcPeerConnections).forEach((peerId) => {
    if (!members.some((m) => String(m.userId) === peerId)) {
      rtcPeerConnections[peerId].close();
      delete rtcPeerConnections[peerId];
      removeAudioElement(peerId);
    }
  });
}
function createPeerConnectionForPeer(peerId) {
  const pc = new RTCPeerConnection({
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }], // ฟรี STUN server
  });

  // ผูกเสียงตัวเอง (localStream อาจจะ null ตอนแรก)
  if (rtcLocalStream) {
    rtcLocalStream
      .getTracks()
      .forEach((track) => pc.addTrack(track, rtcLocalStream));
  }

  // เมื่อได้ remote track
  pc.ontrack = (event) => {
    attachRemoteAudio(event.streams[0], peerId);
  };

  // ส่ง candidate
  pc.onicecandidate = (event) => {
    if (event.candidate) {
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
  const pc = rtcPeerConnections[peerId];
  if (!pc) return;
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  sendSignalingMessage("offer", peerId, offer);
}

// ฝั่ง receiver
async function onReceivedOffer(peerId, offer) {
  let pc = rtcPeerConnections[peerId];
  if (!pc) {
    createPeerConnectionForPeer(peerId);
    pc = rtcPeerConnections[peerId];
  }
  await pc.setRemoteDescription(new RTCSessionDescription(offer));
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  sendSignalingMessage("answer", peerId, answer);
}

async function onReceivedAnswer(peerId, answer) {
  const pc = rtcPeerConnections[peerId];
  if (!pc) return;
  await pc.setRemoteDescription(new RTCSessionDescription(answer));
}

async function onReceivedICE(peerId, candidate) {
  const pc = rtcPeerConnections[peerId];
  if (!pc) return;
  if (candidate) {
    await pc.addIceCandidate(new RTCIceCandidate(candidate));
  }
}
function attachRemoteAudio(remoteStream, peerId) {
  let audio = document.getElementById(`voice-audio-${peerId}`);
  if (!audio) {
    audio = document.createElement('audio');
    audio.id = `voice-audio-${peerId}`;
    audio.autoplay = true;
    audio.controls = false;
    audio.style.display = "none"; // หรือเปิด controls สำหรับ debug
    document.body.appendChild(audio); // หรือใน DOM เฉพาะส่วน voice room
  }
  audio.srcObject = remoteStream;
}

function removeAudioElement(peerId) {
  const audio = document.getElementById(`voice-audio-${peerId}`);
  if (audio) audio.remove();
}
// เมื่อเราได้ rtcLocalStream ใหม่ หลัง join
function ensureTrackForAllPeers() {
  if (!rtcLocalStream) return;
  Object.values(rtcPeerConnections).forEach(pc => {
    // เช็คก่อนว่า track นี้ถูก add ไปหรือยัง (ป้องกันซ้ำ)
    const senders = pc.getSenders();
    rtcLocalStream.getTracks().forEach(track => {
      if (!senders.find(s => s.track && s.track.id === track.id)) {
        pc.addTrack(track, rtcLocalStream);
      }
    });
  });
}
