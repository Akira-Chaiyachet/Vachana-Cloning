// ===== RTC_03.12.js (Clean Rewrite, Discord-Style Voice Room) =====

// ==== GLOBAL STATE ====
window.rtcSignalingSocket = null; // WebSocket for signaling
window.rtcPeerConnections = {}; // Map: peerId => RTCPeerConnection
window.rtcLocalStream = null; // Local audio stream
window.rtcIsJoining = false; // Prevent double join
window.rtcIsJoined = false; // Joined flag
window.rtcRoomId = null; // Current room id
window.rtcTranslatePref = "off"; // Translate preference

// ==== UI UTILITY ====
function setRTCStatus(msg, isError = false) {
  const el = document.getElementById("voice-status-text");
  if (el) {
    el.textContent = msg;
    el.style.color = isError ? "#ff4444" : "#fff";
  }
}

// ==== JOIN/LEAVE LOGIC ====
async function joinVoiceRoom() {
  const roomId = localStorage.getItem("currentRoomId");
  if (!roomId) {
    alert("Room ID not found!");
    return;
  }
  if (window.rtcIsJoining || window.rtcIsJoined) return;
  window.rtcIsJoining = true;

  window.rtcRoomId = localStorage.getItem("currentRoomId");
  if (!window.rtcRoomId) {
    setRTCStatus("ไม่พบห้อง", true);
    window.rtcIsJoining = false;
    return;
  }

  setRTCStatus("กำลังขอสิทธิ์ไมโครโฟน...");
  try {
    window.rtcLocalStream = await navigator.mediaDevices.getUserMedia({
      audio: true,
    });
  } catch (e) {
    setRTCStatus("ไม่สามารถใช้ไมโครโฟนได้", true);
    window.rtcIsJoining = false;
    return;
  }

  // Connect signaling (if needed)
  await rtcConnectSignalingSocket();

  // Send join event (พร้อม translatePref)
  rtcSendSignal({
    action: "voice_join",
    user_id: window.myRTCUserId,
    translate_to: window.rtcTranslatePref || "off",
  });

  setRTCStatus("กำลังเชื่อมต่อผู้ใช้ในห้อง...");
  window.rtcIsJoined = true;
  window.rtcIsJoining = false;
  // (Peer connection logic ทำใน signaling handler)
}

function leaveVoiceRoom() {
  if (!window.rtcIsJoined) return;
  // แจ้ง leave
  rtcSendSignal({ action: "voice_leave", user_id: window.myRTCUserId });
  
  // ปิด peer connection ทั้งหมด
  Object.values(window.rtcPeerConnections).forEach((pc) => pc.close());
  window.rtcPeerConnections = {};
  // หยุด local stream
  if (window.rtcLocalStream) {
    window.rtcLocalStream.getTracks().forEach((track) => track.stop());
    window.rtcLocalStream = null;
  }
  // ลบ audio element ของ peer อื่น
  document
  .querySelectorAll('audio[id^="remote-audio-"]')
  .forEach((el) => el.remove());
  
  const roomId = localStorage.getItem("currentRoomId");
  setVoiceJoined(roomId, false);
  window.rtcIsJoined = false;
  setRTCStatus("ออกจากห้องเสียงแล้ว", false);
  // (UI: ปุ่ม join เปิดใช้งานใหม่)
}

// ==== SIGNALING SOCKET LOGIC ====
function rtcConnectSignalingSocket() {
  return new Promise((resolve, reject) => {
    if (
      window.rtcSignalingSocket &&
      window.rtcSignalingSocket.readyState === WebSocket.OPEN
    ) {
      return resolve();
    }
    const wsProto = window.location.protocol === "https:" ? "wss://" : "ws://";
    const wsUrl = `${wsProto}${window.location.host}/ws/rtc/${window.rtcRoomId}/`;
    window.rtcSignalingSocket = new WebSocket(wsUrl);

    window.rtcSignalingSocket.onopen = () => {
      console.log("[RTC] signaling connected");
      setRTCStatus("เชื่อมต่อสัญญาณเรียบร้อย");
      resolve();
    };
    window.rtcSignalingSocket.onmessage = (event) => {
      let data;
      try {
        data = JSON.parse(event.data);
      } catch (e) {
        return;
      }
      rtcHandleSignal(data);
    };
    window.rtcSignalingSocket.onclose = () => {
      setRTCStatus("หลุดการเชื่อมต่อสัญญาณ", true);
    };
    window.rtcSignalingSocket.onerror = (e) => {
      setRTCStatus("เกิดข้อผิดพลาด WebSocket", true);
      reject(e);
    };
  });
}

function rtcSendSignal(obj) {
  if (
    window.rtcSignalingSocket &&
    window.rtcSignalingSocket.readyState === WebSocket.OPEN
  ) {
    window.rtcSignalingSocket.send(JSON.stringify(obj));
  }
}

// ==== SIGNALING HANDLER ====
function rtcHandleSignal(data) {
  switch (data.action) {
    case "voice_update":
      updateVoiceMembersUI(data.voice_members || []);
      break;
    case "voice_join":
      if (data.user_id !== window.myRTCUserId && window.rtcIsJoined) {
        rtcCreateOffer(data.user_id);
      }
      break;
    case "offer":
      rtcReceiveOffer(data);
      break;
    case "answer":
      rtcReceiveAnswer(data);
      break;
    case "ice_candidate":
      rtcReceiveIceCandidate(data);
      break;
    case "voice_leave":
      rtcClosePeerConnection(data.user_id);
      break;
    default:
      break;
  }
}

// ==== PEER CONNECTION LOGIC ====
function rtcCreateOffer(targetUserId) {
  // เหมือน logic เดิม เพิ่มเติม: ตรวจสอบ localStream และ peer
  if (!window.rtcLocalStream) return;
  let pc = window.rtcPeerConnections[targetUserId];
  if (!pc) {
    pc = rtcBuildPeerConnection(targetUserId);
    window.rtcPeerConnections[targetUserId] = pc;
  }
  pc.createOffer()
    .then((offer) => {
      return pc.setLocalDescription(offer);
    })
    .then(() => {
      rtcSendSignal({
        action: "offer",
        user_id: window.myRTCUserId,
        target_user_id: targetUserId,
        sdp: pc.localDescription,
      });
    })
    .catch((err) => {
      setRTCStatus("Offer error: " + err.message, true);
    });
}

function rtcReceiveOffer(data) {
  let fromUserId = data.user_id;
  let pc = window.rtcPeerConnections[fromUserId];
  if (!pc) {
    pc = rtcBuildPeerConnection(fromUserId);
    window.rtcPeerConnections[fromUserId] = pc;
  }
  pc.setRemoteDescription(new RTCSessionDescription(data.sdp))
    .then(() => {
      return pc.createAnswer();
    })
    .then((answer) => {
      return pc.setLocalDescription(answer);
    })
    .then(() => {
      rtcSendSignal({
        action: "answer",
        user_id: window.myRTCUserId,
        target_user_id: fromUserId,
        sdp: pc.localDescription,
      });
    })
    .catch((err) => {
      setRTCStatus("Answer error: " + err.message, true);
    });
}

function rtcReceiveAnswer(data) {
  let fromUserId = data.user_id;
  let pc = window.rtcPeerConnections[fromUserId];
  if (pc) {
    pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
  }
}

function rtcReceiveIceCandidate(data) {
  let fromUserId = data.user_id;
  let pc = window.rtcPeerConnections[fromUserId];
  if (pc && data.candidate) {
    pc.addIceCandidate(new RTCIceCandidate(data.candidate));
  }
}

function rtcBuildPeerConnection(peerId) {
  let pc = new RTCPeerConnection({
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun1.l.google.com:19302" },
    ],
  });
  // Attach local stream
  if (window.rtcLocalStream) {
    window.rtcLocalStream
      .getTracks()
      .forEach((track) => pc.addTrack(track, window.rtcLocalStream));
  }
  // On track: create audio element
  pc.ontrack = (event) => {
    rtcPlayRemoteAudio(peerId, event.streams[0]);
  };
  // On ICE candidate
  pc.onicecandidate = (event) => {
    if (event.candidate) {
      rtcSendSignal({
        action: "ice_candidate",
        user_id: window.myRTCUserId,
        target_user_id: peerId,
        candidate: event.candidate,
      });
    }
  };
  return pc;
}

function rtcPlayRemoteAudio(peerId, stream) {
  if (peerId == window.myRTCUserId) return;
  let remoteId = "remote-audio-" + peerId;
  let audioElem = document.getElementById(remoteId);
  if (!audioElem) {
    audioElem = document.createElement("audio");
    audioElem.id = remoteId;
    audioElem.autoplay = true;
    audioElem.controls = true;
    audioElem.muted = false;
    // เตรียมจุด mount ให้ UI: จะย้ายตำแหน่งไปอยู่ใน sidebar/voice member ได้ง่าย
    document.body.appendChild(audioElem);
  }
  audioElem.srcObject = stream;
}

// ปิด peer connection ของ userId
function rtcClosePeerConnection(userId) {
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

// ==== TRANSLATE DROPDOWN HANDLER ====
function onVoiceTranslateChange(sel) {
  window.rtcTranslatePref = sel.value;
  // ถ้า join แล้ว ให้แจ้ง setting ใหม่ไป backend ทันที
  if (window.rtcIsJoined) {
    rtcSendSignal({
      action: "set_translate_pref",
      user_id: window.myRTCUserId,
      translate_to: window.rtcTranslatePref,
    });
    setRTCStatus("อัปเดตการแปลเสียง: " + sel.options[sel.selectedIndex].text);
  }
}

// ==== MEMBER LIST / UI UPDATE ====
function updateVoiceMembersUI(members) {
  // ตัวอย่าง: render รายชื่อผู้พูด/สมาชิก, สามารถเพิ่ม mute/volume ต่อ user ได้
  const el = document.getElementById("voiceMembersEl");
  if (!el) return;
  el.innerHTML = "";
  members.forEach((member) => {
    const node = document.createElement("div");
    node.className =
      "voice-member" + (member.id == window.myRTCUserId ? " me" : "");
    node.innerHTML = `
            <img src="${
              member.avatar || "/media/default/profile.jpg"
            }" class="voice-avatar">
            <span>${member.display_name || member.id}${
      member.id == window.myRTCUserId ? " (You)" : ""
    }</span>
            <button onclick="rtcMuteUser('${member.id}')">🔇</button>
            <input type="range" min="0" max="100" value="100" onchange="rtcSetVolume('${
              member.id
            }', this.value)">
        `;
    el.appendChild(node);
  });
}

// ==== MUTE/VOLUME UI (Placeholder) ====
function rtcMuteUser(userId) {
  // mute/unmute audio element ของ user นั้น
  let audioElem = document.getElementById("remote-audio-" + userId);
  if (audioElem) {
    audioElem.muted = !audioElem.muted;
  }
}
function rtcSetVolume(userId, val) {
  let audioElem = document.getElementById("remote-audio-" + userId);
  if (audioElem) {
    audioElem.volume = val / 100;
  }
}

// ==== BIND BUTTON TO NEW JOIN/LEAVE ====
window.addEventListener("DOMContentLoaded", () => {
  let joinBtn = document.getElementById("joinVoiceBtn");
  let leaveBtns = document.querySelectorAll(".disconnect");
  if (joinBtn) joinBtn.onclick = joinVoiceRoom;
  leaveBtns.forEach((btn) => (btn.onclick = leaveVoiceRoom));
  // Set initial state
  setRTCStatus("พร้อมเข้าร่วมห้องเสียง");
});

function isVoiceJoined(roomId) {
  return localStorage.getItem("voice_joined_" + roomId) === "1";
}
function setVoiceJoined(roomId, status) {
  localStorage.setItem("voice_joined_" + roomId, status ? "1" : "0");
}

function cleanupVoiceState() {
    // 1. ปิด peer connections
    Object.values(window.rtcPeerConnections || {}).forEach(pc => pc.close());
    window.rtcPeerConnections = {};
    // 2. ปิด signaling socket RTC
    if (window.rtcSignalingSocket) {
        window.rtcSignalingSocket.close();
        window.rtcSignalingSocket = null;
    }
    // 3. ลบ audio elements
    document.querySelectorAll('audio[id^="remote-audio-"]').forEach(el => el.remove());
    // 4. ปิด local stream (voice)
    if (window.rtcLocalStream) {
        window.rtcLocalStream.getTracks().forEach(track => track.stop());
        window.rtcLocalStream = null;
    }
    // 5. รีเซ็ต flag
    window.rtcIsJoined = false;
    window.rtcIsJoining = false;
    window.rtcRoomId = null;
    // 6. ลบ flag ใน localStorage ทุกห้อง
    Object.keys(localStorage).forEach(k => {
      if (k.startsWith("voice_joined_")) localStorage.removeItem(k);
    });
    // 7. รีเซ็ต UI voice member
    const el = document.getElementById("voiceMembersEl");
    if (el) el.innerHTML = "";
}
