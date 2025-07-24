// Real-Time Voice Chat (WebRTC + Dedicated WS Signaling)
// Core: connectRTCSignalingSocket, joinVoice, RTCVoice logic only, bug-fixed.

window.rtcSocket = null; // WS สำหรับ signaling เฉพาะ voice
window.rtcPeerConnections = {}; // { userId: RTCPeerConnection }
window.localStream = null;
window.joinedVoiceRoom = false;
let rtcAutoReconnectTimer = null;

// Helper: รอ localStream ถ้ายังไม่ได้ไมค์
function waitForLocalStream(callback) {
  if (window.localStream) {
    callback();
  } else {
    setTimeout(() => waitForLocalStream(callback), 300);
  }
}

// Helper: เล่นเสียง pop เมื่อ join ห้อง
function playPopSound() {
  var audio = new Audio("/media/audio_files/pop-39222.mp3");
  audio.volume = 0.7;
  audio.play().catch(() => {});
}

// -- SIGNALING SOCKET MANAGEMENT --
function connectRTCSignalingSocket(roomId) {
  if (
    window.rtcSocket &&
    (window.rtcSocket.readyState === WebSocket.OPEN ||
      window.rtcSocket.readyState === WebSocket.CONNECTING)
  ) {
    window.rtcSocket.close();
  }
  const wsProtocol = window.location.protocol === "https:" ? "wss://" : "ws://";
  const wsUrl = `${wsProtocol}${window.location.host}/ws/rtc/${roomId}/`;
  window.rtcSocket = new WebSocket(wsUrl);
  window.rtcSocket.onopen = function () {
    console.log("🟢 rtcSocket signaling connected");
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
    console.warn("🔴 rtcSocket signaling disconnected");
    // Auto reconnect ถ้ายัง join voice
    if (isVoiceJoined(roomId)) {
      if (rtcAutoReconnectTimer) clearTimeout(rtcAutoReconnectTimer);
      rtcAutoReconnectTimer = setTimeout(() => {
        if (
          !window.rtcSocket ||
          window.rtcSocket.readyState !== WebSocket.OPEN
        ) {
          joinVoice();
        }
      }, 4000);
    }
  };
  window.rtcSocket.onerror = function (err) {
    console.error("rtcSocket error", err);
  };
}

function sendSignalingMessage(data) {
  if (window.rtcSocket && window.rtcSocket.readyState === WebSocket.OPEN) {
    window.rtcSocket.send(JSON.stringify(data));
  }
}
function setVoiceJoined(roomId, status) {
  localStorage.setItem("voice_joined_" + roomId, status ? "1" : "0");
}
function isVoiceJoined(roomId) {
  return localStorage.getItem("voice_joined_" + roomId) === "1";
}
// -- JOIN/LEAVE VOICE ROOM --
function joinVoice(autoJoin = false) {
  const roomId = localStorage.getItem("currentRoomId");
  if (!roomId) {
    alert("Room ID not found!");
    return;
  }
  if (window.joinedVoiceRoom) {
    alert("คุณเข้าร่วม voice แล้ว");
    return;
  }
  if (!window.myRTCUserId) {
    // ดึงจาก dom attribute (แนะนำให้ใส่ไว้ใน <body data-current-user-id="xxx"> )
    window.myRTCUserId = document.body.getAttribute("data-current-user-id");
    if (!window.myRTCUserId) {
      alert("ยังไม่ได้กำหนด myRTCUserId");
      return;
    }
  }
  if (window.joinedVoiceRoom && !autoJoin) {
    alert("คุณเข้าร่วม voice แล้ว");
    return;
  }
  window.joinedVoiceRoom = true; // lock ทันที
  connectRTCSignalingSocket(roomId);
  navigator.mediaDevices
    .getUserMedia({ audio: true, video: false })
    .then(function (stream) {
      window.localStream = stream;
      window.joinedVoiceRoom = true;
      setVoiceJoined(roomId, true); // <== save state
      document.getElementById("voice-status-text").textContent =
        "เชื่อมต่อแล้ว";
      sendSignalingMessage({
        action: "voice_join",
        user_id: window.myRTCUserId,
      });
    })
    .catch(function (err) {
      alert("ไม่สามารถเปิดไมโครโฟนได้: " + err.message);
      setVoiceJoined(roomId, false); // reset state
    });
}

function leaveVoice() {
  const roomId = localStorage.getItem("currentRoomId");
  setVoiceJoined(roomId, false); // reset state
  sendSignalingMessage({ action: "voice_leave", user_id: window.myRTCUserId });
  for (let uid in window.rtcPeerConnections) closePeerConnection(uid);
  window.rtcPeerConnections = {};
  if (window.localStream) {
    window.localStream.getTracks().forEach((track) => track.stop());
    window.localStream = null;
  }
  window.joinedVoiceRoom = false;
  document.getElementById("voice-status-text").textContent =
    "ออกจากห้องเสียงแล้ว";
  if (window.rtcSocket && window.rtcSocket.readyState === WebSocket.OPEN) {
    window.rtcSocket.close();
    window.rtcSocket = null;
  }
  document.querySelectorAll('audio[id^="remote-audio-"]').forEach((el) => {
    el.srcObject = null;
    el.remove();
  });
  let joinBtn = document.getElementById("joinVoiceBtn");
  if (joinBtn) joinBtn.disabled = false;
  // <== เคลียร์รายชื่อ voice room ด้วย
  updateVoiceMembersUI([]);
}
window.addEventListener("beforeunload", function () {
  if (window.joinedVoiceRoom) {
    leaveVoice();
  }
});
// ให้ backend broadcast มาเป็น { action: "voice_update", voice_members: [ {id, display_name, avatar}, ... ] }
function updateVoiceMembersUI(members) {
  const voiceMembersEl = document.getElementById("voiceMembersEl");
  if (!voiceMembersEl) {
    console.warn("ไม่พบ element #voiceMembersEl ใน DOM");
    return;
  }
  voiceMembersEl.innerHTML = ""; // clear ก่อน
  members.forEach((member) => {
    const el = document.createElement("div");
    el.className =
      "voice-member" + (member.id == window.myRTCUserId ? " me" : "");
    el.innerHTML = `<img src="${
      member.avatar || "/media/default/profile.jpg"
    }" class="voice-avatar">
    <span>${member.display_name || member.id}${
      member.id == window.myRTCUserId ? " (You)" : ""
    }</span>`;
    voiceMembersEl.appendChild(el);
  });
}

// -- SIGNALING HANDLER --
function handleRTCSignalingMessage(data) {
  if (data.user_id == window.myRTCUserId) return;
  console.log(
    "signaling",
    data.action,
    data.user_id,
    data.target_user_id,
    "myId",
    window.myRTCUserId
  );
  if (data.action === "voice_update") {
    console.log(
      "signaling voice_update",
      data.voice_members,
      "myId",
      window.myRTCUserId
    );
  } else {
    console.log(
      "signaling",
      data.action,
      data.user_id,
      data.target_user_id,
      "myId",
      window.myRTCUserId
    );
  }
  switch (data.action) {
    case "voice_join":
      // เฉพาะถ้า user ใหม่ (data.user_id != myRTCUserId)
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

// -- PEER CONNECTION LOGIC --
function createAndSendOffer(targetUserId) {
  if (!window.localStream) return;

  // 1. สร้าง RTCPeerConnection ถ้ายังไม่มี (จะสร้างแค่ฝั่ง offer)
  let pc = window.rtcPeerConnections[targetUserId];
  if (!pc) {
    pc = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });
    window.rtcPeerConnections[targetUserId] = pc;

    window.localStream.getTracks().forEach((track) => {
      pc.addTrack(track, window.localStream);
    });

    pc.ontrack = function (event) {
      playRemoteAudio(targetUserId, event.streams[0]);
    };
    pc.onicecandidate = function (event) {
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

  // 2. ตรวจสอบ state ว่าไม่ใช่ 'have-local-offer' หรือ 'have-remote-offer'
  if (pc.signalingState !== "stable") {
    console.warn("PeerConnection is not stable, skip createOffer");
    return;
  }

  // 3. สร้าง offer และส่ง
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
    .catch((err) => {
      console.error("Offer failed:", err);
    });
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
    window.localStream.getTracks().forEach((track) => {
      pc.addTrack(track, window.localStream);
    });
    pc.ontrack = function (event) {
      playRemoteAudio(fromUserId, event.streams[0]);
    };
    pc.onicecandidate = function (event) {
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
      .catch((err) => {
        console.error("Error handling offer:", err);
      });
  });
}

function receiveAnswer(data) {
  console.log(
    "receiveAnswer",
    data.action,
    data.user_id,
    data.target_user_id,
    "myId",
    window.myRTCUserId
  );
  let fromUserId = data.user_id;
  let pc = window.rtcPeerConnections[fromUserId];
  if (!pc) {
    console.warn("ยังไม่มี peer connection สำหรับ answer:", fromUserId);
    // **อย่าสร้าง peer ใหม่ตรงนี้**!
    return;
  }
  if (pc.signalingState !== "have-local-offer") {
    console.warn("PeerConnection state invalid for answer:", pc.signalingState);
    return;
  }
  pc.setRemoteDescription(new RTCSessionDescription(data.sdp)).catch((err) => {
    console.error("Error setting remote answer:", err);
  });
}

function receiveRemoteIceCandidate(data) {
  let fromUserId = data.user_id;
  let pc =
    window.rtcPeerConnections[fromUserId] ||
    window.rtcPeerConnections[data.target_user_id];
  if (!pc) {
    console.warn("ยังไม่มี peer สำหรับ ICE", fromUserId, data.target_user_id);
    return;
  }
  if (data.candidate) {
    pc.addIceCandidate(new RTCIceCandidate(data.candidate)).catch((err) => {
      console.error("Error adding ICE candidate:", err);
    });
  }
}

function playRemoteAudio(userId, stream) {
  if (userId == window.myRTCUserId) return; // *** KEY LINE ***
  let remoteId = "remote-audio-" + userId;
  let audioElem = document.getElementById(remoteId);
  if (!audioElem) {
    audioElem = document.createElement("audio");
    audioElem.id = remoteId;
    audioElem.autoplay = true;
    audioElem.controls = true;
    audioElem.muted = false;
    document.body.appendChild(audioElem);
  }
  audioElem.srcObject = stream;
  audioElem.play().catch((e) => {
    console.warn("Audio play() error:", e);
  });
}
function fetchVoiceMembers(roomId) {
  fetch(`/voice_chat/api/rooms/${roomId}/voice_members/`)
    .then((res) => res.json())
    .then((data) => {
      updateVoiceMembersUI(data.voice_members || []);
    })
    .catch((err) => {
      // option: แสดงข้อความหรือ log error
      console.error("Fetch voice_members failed:", err);
    });
}
