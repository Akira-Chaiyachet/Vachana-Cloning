// ====== GLOBALS ======
window.rtcSocket = null; // signaling WebSocket
window.rtcPeerConnections = {}; // { userId: RTCPeerConnection }
window.localStream = null;
window.joinedVoiceRoom = false;
let rtcAutoReconnectTimer = null;

// ====== 1. MEMBER LIST (ห้องแชทหลัก) ======
// function fetchAndDisplayRoomMembers(roomId) {
//   fetch(`/voice_chat/get-room-members/${roomId}/?timestamp=${Date.now()}`)
//     .then((res) => res.json())
//     .then((data) => updateRoomMembersUI(data.members || []))
//     .catch((err) => console.error("Fetch room members failed:", err));
// }
function updateRoomMembersUI(members) {
  const el = document.getElementById("roomMembersEl");
  if (!el) return;
  el.innerHTML = "";
  members.forEach((member) => {
    const node = document.createElement("div");
    node.className =
      "room-member" + (member.id == window.myRTCUserId ? " me" : "");
    node.innerHTML = `
      <img src="${
        member.profile_image || "/media/default/profile.jpg"
      }" class="member-avatar">
      <span>${member.name_to_display || member.username}${
      member.id == window.myRTCUserId ? " (You)" : ""
    }</span>
      <span class="role-label">${member.role}</span>
      <span class="status-label status-${member.status}">${member.status}</span>
    `;
    el.appendChild(node);
  });
}
window.addEventListener("DOMContentLoaded", function () {
  setRTCStatus("server-ok");
});
// ====== 2. VOICE JOIN/LEAVE ======
function setVoiceJoined(roomId, status) {
  localStorage.setItem("voice_joined_" + roomId, status ? "1" : "0");
}
function isVoiceJoined(roomId) {
  return localStorage.getItem("voice_joined_" + roomId) === "1";
}

function joinVoice() {
  setRTCStatus("rtc-connecting");
  const roomId = localStorage.getItem("currentRoomId");
  if (!roomId) return alert("Room ID not found!");
  if (window.joinedVoiceRoom) return alert("คุณเข้าร่วม voice แล้ว");
  if (!window.myRTCUserId) {
    window.myRTCUserId = document.body.getAttribute("data-current-user-id");
    if (!window.myRTCUserId) return alert("ยังไม่ได้กำหนด myRTCUserId");
  }

  // connectRTCSignalingSocket เฉพาะกรณียังไม่ connect
  if (!window.rtcSocket || window.rtcSocket.readyState !== WebSocket.OPEN) {
    connectRTCSignalingSocket(roomId);
  }

  navigator.mediaDevices
    .getUserMedia({ audio: true, video: false })
    .then((stream) => {
      window.localStream = stream;
      setVoiceJoined(roomId, true);
      window.joinedVoiceRoom = true;
      sendSignalingMessage({
        action: "voice_join",
        user_id: window.myRTCUserId,
      });
      // **สถานะสำเร็จหลังส่ง signaling เสร็จ (หรือคุณอาจเอาไว้หลัง receive voice_update ก็ได้)**
      setRTCStatus("rtc-ok");
    })
    .catch((err) => {
      alert("ไม่สามารถเปิดไมโครโฟนได้: " + err.message);
      setVoiceJoined(roomId, false);
      window.joinedVoiceRoom = false;
      setRTCStatus("server-ok"); // fallback กลับสถานะปกติ
    });
}

function leaveVoice() {
  setRTCStatus("rtc-disconnecting");
  const roomId = localStorage.getItem("currentRoomId");
  setVoiceJoined(roomId, false);
  window.joinedVoiceRoom = false;
  sendSignalingMessage({ action: "voice_leave", user_id: window.myRTCUserId });

  // ==== เคลียร์ peer/stream/audio/UI ====
  for (let uid in window.rtcPeerConnections) closePeerConnection(uid);
  window.rtcPeerConnections = {};
  if (window.localStream) {
    window.localStream.getTracks().forEach((track) => track.stop());
    window.localStream = null;
  }
  document.getElementById("voice-status-text").textContent =
    "ออกจากห้องเสียงแล้ว";
  document.querySelectorAll('audio[id^="remote-audio-"]').forEach((el) => {
    el.srcObject = null;
    el.remove();
  });
  let joinBtn = document.getElementById("joinVoiceBtn");
  if (joinBtn) joinBtn.disabled = false;
  // ❌ ห้ามเรียก updateVoiceMembersUI([]) เด็ดขาด!
  // รอให้ server broadcast "voice_update" เอง
}

// ====== 3. RTC SIGNALING SOCKET (ตลอดเวลาที่อยู่ในห้อง) ======
function connectRTCSignalingSocket(roomId) {
  if (
    window.rtcSocket &&
    (window.rtcSocket.readyState === WebSocket.OPEN ||
      window.rtcSocket.readyState === WebSocket.CONNECTING)
  ) {
    // อย่า close socket รัวๆ ให้ reuse เดิม!
    return;
  }
  const wsProtocol = window.location.protocol === "https:" ? "wss://" : "ws://";
  const wsUrl = `${wsProtocol}${window.location.host}/ws/rtc/${roomId}/`;
  window.rtcSocket = new WebSocket(wsUrl);

  window.rtcSocket.onopen = function () {
    console.log("🟢 rtcSocket signaling connected");
    sendSignalingMessage({ action: "get_voice_members" }); // sync voice UI ทันที
  };
  window.rtcSocket.onmessage = function (event) {
    let data;
    try {
      data = JSON.parse(event.data);
    } catch (e) {
      return;
    }
    handleRTCSignalingMessage(data);
  };
  window.rtcSocket.onclose = function () {
    setRTCStatus("server-fail");
    console.warn("🔴 rtcSocket signaling disconnected");
    // ควร auto reconnect socket เฉพาะถ้า user ยังอยู่ในห้อง (แต่ปกติ frontend เปลี่ยนห้องควร reload socket เอง)
    // ถ้าอยาก auto reconnect: (เช็คว่าไม่ได้ออกจากห้องแชท)
    const roomId = localStorage.getItem("currentRoomId");
    if (roomId) {
      if (rtcAutoReconnectTimer) clearTimeout(rtcAutoReconnectTimer);
      rtcAutoReconnectTimer = setTimeout(() => {
        if (
          !window.rtcSocket ||
          window.rtcSocket.readyState !== WebSocket.OPEN
        ) {
          connectRTCSignalingSocket(roomId);
        }
      }, 4000);
    }
  };
  window.rtcSocket.onerror = function (err) {
    setRTCStatus("server-fail");
    console.error("rtcSocket error", err);
  };
}

function sendSignalingMessage(data) {
  if (window.rtcSocket && window.rtcSocket.readyState === WebSocket.OPEN) {
    window.rtcSocket.send(JSON.stringify(data));
  }
}

// ====== 4. VOICE MEMBERS (จาก server "voice_update") ======
function updateVoiceMembersUI(members) {
  const el = document.getElementById("voiceMembersEl");
  if (!el) return;
  el.innerHTML = "";
  members.forEach((member) => {
    const node = document.createElement("div");
    node.className =
      "voice-member" + (member.id == window.myRTCUserId ? " me" : "");
    node.innerHTML = `<img src="${
      member.avatar || "/media/default/profile.jpg"
    }" class="voice-avatar">
      <span>${member.display_name || member.id}${
      member.id == window.myRTCUserId ? " (You)" : ""
    }</span>`;
    el.appendChild(node);
  });
}

// ====== 5. SIGNALING HANDLER ======
function handleRTCSignalingMessage(data) {
  if (data.action === "voice_update") {
    updateVoiceMembersUI(data.voice_members || []);
    return;
  }
  // ไม่ต้อง filter event ตัวเอง ถ้าเป็น signaling peer (เช่น offer/answer)
  switch (data.action) {
    case "voice_join":
      createAndSendOffer(data.user_id);
      break;
    case "offer":
      receiveOffer(data);
      break;
    case "answer":
      receiveAnswer(data);
      break;
    case "ice_candidate":
      receiveRemoteIceCandidate(data);
      break;
    case "voice_leave":
      closePeerConnection(data.user_id);
      break;
  }
}

// ====== 6. RTC PEER CONNECTION LOGIC ======
function createAndSendOffer(targetUserId) {
  if (!window.localStream) return;
  let pc = window.rtcPeerConnections[targetUserId];
  if (!pc) {
    pc = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });
    window.rtcPeerConnections[targetUserId] = pc;
    window.localStream
      .getTracks()
      .forEach((track) => pc.addTrack(track, window.localStream));
    pc.ontrack = (event) => playRemoteAudio(targetUserId, event.streams[0]);
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        sendSignalingMessage({
          action: "ice_candidate",
          user_id: window.myRTCUserId,
          target_user_id: targetUserId,
          candidate: event.candidate,
        });
      }
    };
  }
  if (pc.signalingState !== "stable") return;
  pc.createOffer()
    .then((offer) => pc.setLocalDescription(offer))
    .then(() => {
      sendSignalingMessage({
        action: "offer",
        user_id: window.myRTCUserId,
        target_user_id: targetUserId,
        sdp: pc.localDescription,
      });
    })
    .catch((err) => console.error("Offer failed:", err));
}
function receiveOffer(data) {
  let fromUserId = data.user_id;
  waitForLocalStream(() => {
    let pc = window.rtcPeerConnections[fromUserId];
    if (pc) {
      pc.close();
      delete window.rtcPeerConnections[fromUserId];
    }
    pc = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });
    window.rtcPeerConnections[fromUserId] = pc;
    window.localStream
      .getTracks()
      .forEach((track) => pc.addTrack(track, window.localStream));
    pc.ontrack = (event) => playRemoteAudio(fromUserId, event.streams[0]);
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        sendSignalingMessage({
          action: "ice_candidate",
          user_id: window.myRTCUserId,
          target_user_id: fromUserId,
          candidate: event.candidate,
        });
      }
    };
    pc.setRemoteDescription(new RTCSessionDescription(data.sdp))
      .then(() => pc.createAnswer())
      .then((answer) => pc.setLocalDescription(answer))
      .then(() => {
        sendSignalingMessage({
          action: "answer",
          user_id: window.myRTCUserId,
          target_user_id: fromUserId,
          sdp: pc.localDescription,
        });
      })
      .catch((err) => console.error("Error handling offer:", err));
  });
}
function receiveAnswer(data) {
  let fromUserId = data.user_id;
  let pc = window.rtcPeerConnections[fromUserId];
  if (!pc) return;
  if (pc.signalingState !== "have-local-offer") return;
  pc.setRemoteDescription(new RTCSessionDescription(data.sdp)).catch((err) => {
    console.error("Error setting remote answer:", err);
  });
}
function receiveRemoteIceCandidate(data) {
  let fromUserId = data.user_id;
  let pc =
    window.rtcPeerConnections[fromUserId] ||
    window.rtcPeerConnections[data.target_user_id];
  if (!pc) return;
  if (data.candidate) {
    pc.addIceCandidate(new RTCIceCandidate(data.candidate)).catch((err) => {
      console.error("Error adding ICE candidate:", err);
    });
  }
}
function playRemoteAudio(userId, stream) {
  if (userId == window.myRTCUserId) return;
  let remoteId = "remote-audio-" + userId;
  let audioElem = document.getElementById(remoteId);
  if (!audioElem) {
    audioElem = document.createElement("audio");
    audioElem.id = remoteId;
    audioElem.autoplay = true;
    audioElem.controls = true;
    audioElem.muted = false;
    audioElem.play().catch((e) => {
  // ถ้า fail ให้ popup หรือขอ user interaction อีกที
    console.warn("ต้องให้ผู้ใช้กด unmute เสียง");
    });
    document.body.appendChild(audioElem);
  }
  audioElem.srcObject = stream;
  audioElem.play().catch((e) => {
    console.warn("Audio play() error:", e);
  });
}
function closePeerConnection(userId) {
  let pc = window.rtcPeerConnections[userId];
  if (pc) {
    pc.close();
    delete window.rtcPeerConnections[userId];
    let remoteId = "remote-audio-" + userId;
    let audioElem = document.getElementById(remoteId);
    if (audioElem) {
      audioElem.srcObject = null;
      audioElem.remove();
    }
  }
}
function waitForLocalStream(callback) {
  if (window.localStream) {
    callback();
  } else {
    setTimeout(() => waitForLocalStream(callback), 300);
  }
}

function setRTCStatus(status, extraText) {
  const statusBox = document.getElementById("rtc-status-box");
  const statusText = document.getElementById("voice-status-text");
  if (!statusBox || !statusText) return;
  statusBox.className = "connection-status"; // reset ทุก status
  switch (status) {
    case "server-ok":
      statusBox.classList.add("rtc-status-server-ok");
      statusText.textContent = extraText || "เชื่อมต่อเซิร์ฟเวอร์สำเร็จ";
      break;
    case "server-fail":
      statusBox.classList.add("rtc-status-server-fail");
      statusText.textContent = extraText || "เชื่อมต่อไม่สำเร็จ";
      break;
    case "rtc-connecting":
      statusBox.classList.add("rtc-status-rtc-connecting");
      statusText.textContent = extraText || "กำลังเชื่อมต่อกับ RTC...";
      break;
    case "rtc-ok":
      statusBox.classList.add("rtc-status-rtc-ok");
      statusText.textContent = extraText || "เชื่อมต่อสำเร็จ";
      // อีก 2 วิ เปลี่ยนเป็นพร้อมพูดคุย
      setTimeout(() => {
        setRTCStatus("rtc-ready", "พร้อมพูดคุย");
      }, 2000);
      break;
    case "rtc-ready":
      statusBox.classList.add("rtc-status-rtc-ready");
      statusText.textContent = extraText || "พร้อมพูดคุย";
      break;
    case "rtc-disconnecting":
      statusBox.classList.add("rtc-status-rtc-disconnecting");
      statusText.textContent = extraText || "กำลังตัดการเชื่อมต่อ RTC...";
      setTimeout(() => {
        setRTCStatus("server-ok");
      }, 1000);
      break;
  }
}

// ====== KEY ======
// - websocket signaling เชื่อมต่อ/ปิดเมื่อลูกค้าเข้าออก "ห้องแชท" เท่านั้น
// - joinVoice/leaveVoice ไม่ปิด ws! อัพเดต UI ตาม voice_update event เท่านั้น
