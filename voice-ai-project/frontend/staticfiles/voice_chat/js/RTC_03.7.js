// Real-Time Voice Chat (WebRTC + Dedicated WS Signaling) - Discord Style
// Member list (all room members) + Voice members (only RTC joined)

window.rtcSocket = null; // WS สำหรับ signaling เฉพาะ voice
window.rtcPeerConnections = {}; // { userId: RTCPeerConnection }
window.localStream = null;
window.joinedVoiceRoom = false;
let rtcAutoReconnectTimer = null;

// ------ 1. ห้อง: รายชื่อสมาชิกห้อง (Member List) ------
function fetchAndDisplayRoomMembers(roomId) {
  fetch(`/voice_chat/get-room-members/${roomId}/?timestamp=${Date.now()}`)
    .then(res => res.json())
    .then(data => {
      updateRoomMembersUI(data.members || []);
    })
    .catch((err) => {
      console.error("Fetch room members failed:", err);
    });
}
function updateRoomMembersUI(members) {
  const memberListEl = document.getElementById("roomMembersEl");
  if (!memberListEl) return;
  memberListEl.innerHTML = "";
  members.forEach((member) => {
    const el = document.createElement("div");
    el.className = "room-member" + (member.id == window.myRTCUserId ? " me" : "");
    el.innerHTML = `<img src="${member.profile_image || "/media/default/profile.jpg"}" class="member-avatar">
      <span>${member.name_to_display || member.username}${member.id == window.myRTCUserId ? " (You)" : ""}</span>
      <span class="role-label">${member.role}</span>
      <span class="status-label status-${member.status}">${member.status}</span>`;
    memberListEl.appendChild(el);
  });
}

// ------ 2. Voice: Join/Leave RTC Voice ------
function setVoiceJoined(roomId, status) {
  localStorage.setItem("voice_joined_" + roomId, status ? "1" : "0");
}
function isVoiceJoined(roomId) {
  return localStorage.getItem("voice_joined_" + roomId) === "1";
}
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
    window.myRTCUserId = document.body.getAttribute("data-current-user-id");
    if (!window.myRTCUserId) {
      alert("ยังไม่ได้กำหนด myRTCUserId");
      return;
    }
  }
  window.joinedVoiceRoom = true;
  connectRTCSignalingSocket(roomId);
  navigator.mediaDevices
    .getUserMedia({ audio: true, video: false })
    .then(function (stream) {
      window.localStream = stream;
      setVoiceJoined(roomId, true);
      document.getElementById("voice-status-text").textContent = "เชื่อมต่อแล้ว";
      sendSignalingMessage({
        action: "voice_join",
        user_id: window.myRTCUserId,
      });
    })
    .catch(function (err) {
      alert("ไม่สามารถเปิดไมโครโฟนได้: " + err.message);
      setVoiceJoined(roomId, false);
      window.joinedVoiceRoom = false;
    });
}
let manualRTCDisconnect = false; // flag สำหรับป้องกัน auto reconnect

function leaveVoice() {
  const roomId = localStorage.getItem("currentRoomId");
  setVoiceJoined(roomId, false);
  manualRTCDisconnect = true;
  sendSignalingMessage({ action: "voice_leave", user_id: window.myRTCUserId });
  for (let uid in window.rtcPeerConnections) closePeerConnection(uid);
  window.rtcPeerConnections = {};
  if (window.localStream) {
    window.localStream.getTracks().forEach((track) => track.stop());
    window.localStream = null;
  }
  window.joinedVoiceRoom = false;
  document.getElementById("voice-status-text").textContent = "ออกจากห้องเสียงแล้ว";
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

  // ❌ ห้ามเรียก updateVoiceMembersUI([]); ที่นี่เด็ดขาด!
}



// ------ 3. RTC Signaling Socket (only on Join Voice) ------
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
    // === ขอรายชื่อ voice update ทันที เมื่อ websocket connect ===
    sendSignalingMessage({ action: "get_voice_members" });
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

// Helper: ส่งข้อความไปหา backend ผ่าน WebSocket
function sendSignalingMessage(data) {
  if (window.rtcSocket && window.rtcSocket.readyState === WebSocket.OPEN) {
    window.rtcSocket.send(JSON.stringify(data));
  }
}


// ------ 4. Voice Members (update by signaling event: voice_update) ------
function updateVoiceMembersUI(members) {
  const voiceMembersEl = document.getElementById("voiceMembersEl");
  if (!voiceMembersEl) return;
  voiceMembersEl.innerHTML = "";
  members.forEach((member) => {
    const el = document.createElement("div");
    el.className = "voice-member" + (member.id == window.myRTCUserId ? " me" : "");
    el.innerHTML = `<img src="${member.avatar || "/media/default/profile.jpg"}" class="voice-avatar">
      <span>${member.display_name || member.id}${member.id == window.myRTCUserId ? " (You)" : ""}</span>`;
    voiceMembersEl.appendChild(el);
  });
}

// ------ 5. Signaling Handler (voice + rtc logic) ------
function handleRTCSignalingMessage(data) {
  // *** เพิ่มเช็คนี้ ***
  if (data.action === "voice_update") {
    console.log("voice_update:", data.voice_members);
    updateVoiceMembersUI(data.voice_members || []);
    return; // ไม่ต้อง process อะไรต่อ
  }
  // 2. signaling RTC logic (เช่น offer/answer/ice)
  if (data.user_id == window.myRTCUserId) return; // filter เฉพาะ event ของตัวเอง
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

// ------ 6. Peer Connection Logic (unchanged, copy from original) ------
function createAndSendOffer(targetUserId) {
  if (!window.localStream) return;
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
  if (pc.signalingState !== "stable") {
    console.warn("PeerConnection is not stable, skip createOffer");
    return;
  }
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
  let fromUserId = data.user_id;
  let pc = window.rtcPeerConnections[fromUserId];
  if (!pc) {
    console.warn("ยังไม่มี peer connection สำหรับ answer:", fromUserId);
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
  if (userId == window.myRTCUserId) return;
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
function closePeerConnection(userId) {
    let pc = window.rtcPeerConnections[userId];
    if (pc) {
        pc.close();
        delete window.rtcPeerConnections[userId];
        // ลบ audio element ด้วย (optional)
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

// ไม่ต้อง fetch voice_members ด้วย HTTP API แล้ว ใช้ websocket event อย่างเดียว!