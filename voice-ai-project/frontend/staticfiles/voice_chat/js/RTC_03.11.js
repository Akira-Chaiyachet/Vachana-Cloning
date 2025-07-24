// ====== GLOBALS ======
window.rtcSocket = null; // signaling WebSocket
let rtcAutoReconnectTimer = null;
window.rtcEarlyCandidates = {}; // { userId: [candidate, candidate, ...] }
window.rtcConnectedPeers = new Set(); // เก็บรายการ peers ที่เชื่อมต่อสำเร็จ

// ====== STATUS MANAGEMENT ======
const RTC_STATUS = {
  INITIALIZING: "กำลังเริ่มต้นระบบเสียง...",
  CONNECTING: "กำลังเชื่อมต่อระบบเสียง...",
  WAITING_MIC: "กำลังขอสิทธิ์การใช้ไมโครโฟน...",
  MIC_ERROR: "ไม่สามารถใช้ไมโครโฟนได้",
  SOCKET_ERROR: "การเชื่อมต่อมีปัญหา กำลังลองใหม่...",
  CONNECTED: "เชื่อมต่อสำเร็จ",
  DISCONNECTED: "ออกจากห้องเสียงแล้ว",
  PEER_CONNECTING: (peerId) => `กำลังเชื่อมต่อกับผู้ใช้ ${peerId}...`,
  PEER_CONNECTED: (peerId) => `เชื่อมต่อกับผู้ใช้ ${peerId} สำเร็จ`,
  PEER_FAILED: (peerId) => `ไม่สามารถเชื่อมต่อกับผู้ใช้ ${peerId} ได้`,
};

function setRTCStatus(status, isError = false) {
  const el = document.getElementById("voice-status-text");
  if (!el) return;
  
  el.textContent = status;
  el.style.color = isError ? "#ff4444" : "#ffffff";
  
  // อัพเดตสถานะการเชื่อมต่อในส่วนอื่นๆ ถ้ามี
  const connectionBox = document.getElementById("rtc-status-box");
  if (connectionBox) {
    connectionBox.className = "connection-status" + (isError ? " error" : "");
  }
  
  // Log สถานะสำหรับ debug
  console.log(`🎤 Voice Status: ${status}`);
}

// ====== 1. MEMBER LIST (ห้องแชทหลัก) ======
function fetchAndDisplayRoomMembers(roomId) {
  fetch(`/voice_chat/get-room-members/${roomId}/?timestamp=${Date.now()}`)
    .then((res) => res.json())
    .then((data) => updateRoomMembersUI(data.members || []))
    .catch((err) => console.error("Fetch room members failed:", err));
}
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
// ====== 2. VOICE JOIN/LEAVE ======
function setVoiceJoined(roomId, status) {
  localStorage.setItem("voice_joined_" + roomId, status ? "1" : "0");
}
function isVoiceJoined(roomId) {
  return localStorage.getItem("voice_joined_" + roomId) === "1";
}

function joinVoice() {
  const roomId = localStorage.getItem("currentRoomId");
  if (!roomId) {
    setRTCStatus("ไม่พบห้อง", true);
    return alert("Room ID not found!");
  }
  if (window.joinedVoiceRoom) {
    setRTCStatus(RTC_STATUS.CONNECTED);
    return alert("คุณเข้าร่วม voice แล้ว");
  }
  if (!window.myRTCUserId) {
    window.myRTCUserId = document.body.getAttribute("data-current-user-id");
    if (!window.myRTCUserId) {
      setRTCStatus("ไม่สามารถระบุตัวตนได้", true);
      return alert("ยังไม่ได้กำหนด myRTCUserId");
    }
  }

  // --- Block ปุ่มซ้ำ ---
  const joinBtn = document.getElementById("joinVoiceBtn");
  if (joinBtn) joinBtn.disabled = true;
  setRTCStatus(RTC_STATUS.INITIALIZING);

  function afterSocketReady() {
    setRTCStatus(RTC_STATUS.WAITING_MIC);
    navigator.mediaDevices.getUserMedia({ audio: true, video: false })
      .then((stream) => {
        window.localStream = stream;
        setVoiceJoined(roomId, true);
        window.joinedVoiceRoom = true;
        
        // รอทุกอย่างพร้อม
        waitForRTCReady((err) => {
          if (err) {
            setRTCStatus(`การเชื่อมต่อไม่สำเร็จ: ${err.message}`, true);
            if (joinBtn) joinBtn.disabled = false;
            return;
          }
          
          setRTCStatus(RTC_STATUS.CONNECTED);
          if (joinBtn) joinBtn.disabled = false;

          // แจ้งการเข้าร่วมไปยังผู้ใช้อื่น
          sendSignalingMessage({ 
            action: "voice_join", 
            user_id: window.myRTCUserId 
          });

          // เริ่มมอนิเตอร์คุณภาพการเชื่อมต่อ
          startConnectionQualityMonitoring();
        });
      })
      .catch((err) => {
        console.error("Microphone access error:", err);
        setRTCStatus(RTC_STATUS.MIC_ERROR, true);
        setVoiceJoined(roomId, false);
        window.joinedVoiceRoom = false;
        if (joinBtn) joinBtn.disabled = false;
        alert(`ไม่สามารถเปิดไมโครโฟนได้: ${err.message}`);
      });
  }

  // ถ้า socket ยังไม่ open, รอให้ onopen แล้วค่อย joinVoice จริง
  if (!window.rtcSocket || window.rtcSocket.readyState !== WebSocket.OPEN) {
    connectRTCSignalingSocket(roomId);
    window.rtcSocket.addEventListener("open", function socketOpenOnce() {
      window.rtcSocket.removeEventListener("open", socketOpenOnce);
      afterSocketReady();
    });
  } else {
    afterSocketReady();
  }
}


function leaveVoice() {
  const roomId = localStorage.getItem("currentRoomId");
  
  // แจ้ง server ก่อนที่จะปิดการเชื่อมต่อ
  sendSignalingMessage({ action: "voice_leave", user_id: window.myRTCUserId });
  
  // ปิดการเชื่อมต่อ peer connections ทั้งหมด
  for (let uid in window.rtcPeerConnections) {
    closePeerConnection(uid);
  }
  window.rtcPeerConnections = {};
  
  // หยุดและล้าง local stream
  if (window.localStream) {
    window.localStream.getTracks().forEach((track) => {
      track.stop();
      track.enabled = false;
    });
    window.localStream = null;
  }
  
  // ล้าง audio elements
  document.querySelectorAll('audio[id^="remote-audio-"]').forEach((el) => {
    if (el.srcObject) {
      const tracks = el.srcObject.getTracks();
      tracks.forEach(track => track.stop());
      el.srcObject = null;
    }
    el.remove();
  });
  
  // อัพเดตสถานะและ UI
  setVoiceJoined(roomId, false);
  window.joinedVoiceRoom = false;
  document.getElementById("voice-status-text").textContent = "ออกจากห้องเสียงแล้ว";
  
  // เปิดปุ่มให้กดได้อีกครั้ง
  let joinBtn = document.getElementById("joinVoiceBtn");
  if (joinBtn) joinBtn.disabled = false;
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
// โค้ดที่แก้ไขแล้ว
// ในส่วนของ ====== 5. SIGNALING HANDLER ======

function handleRTCSignalingMessage(data) {
  if (data.action === "voice_update") {
    updateVoiceMembersUI(data.voice_members || []);
    return;
  }

  if (data.action === "voice_join" && data.user_id == window.myRTCUserId) {
    console.log("Ignoring my own voice_join event.");
    return;
  }

  switch (data.action) {
    case "voice_join":
      // ===== เพิ่มเงื่อนไขตรงนี้ =====
      // ตรวจสอบว่าตัวเราเองอยู่ในห้องเสียงแล้วหรือยัง
      if (!window.joinedVoiceRoom) {
        console.log("Not in voice room, ignoring join event from other user.");
        return; // ถ้ายังไม่อยู่ ก็ไม่ต้องทำอะไร
      }
      // ============================

      console.log(
        `Received voice_join from new user ${data.user_id}. Creating offer...`
      );
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
  console.log(`📡 Creating offer for user ${targetUserId}...`);
  if (!window.localStream) {
    console.error("❌ No localStream available when creating offer!");
    return;
  }
  let pc = window.rtcPeerConnections[targetUserId];
  if (!pc) {
    console.log(`🔄 Creating new RTCPeerConnection for ${targetUserId}`);
    pc = new RTCPeerConnection({
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" }
      ],
    });
    window.rtcPeerConnections[targetUserId] = pc;
    
    // Monitor connection state changes
    pc.onconnectionstatechange = () => {
      console.log(`🔌 Connection state changed for ${targetUserId}: ${pc.connectionState}`);
    };
    pc.oniceconnectionstatechange = () => {
      console.log(`❄️ ICE connection state for ${targetUserId}: ${pc.iceConnectionState}`);
    };
    pc.onsignalingstatechange = () => {
      console.log(`📞 Signaling state for ${targetUserId}: ${pc.signalingState}`);
    };
    
    // ... (โค้ดส่วน ontrack, onicecandidate, addTrack เหมือนเดิม) ...
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
    // =========================================================

    // ===== เพิ่มส่วนนี้เข้าไป: จัดการของในโกดัง =====
    if (window.rtcEarlyCandidates[targetUserId]) {
      console.log(`Processing ${window.rtcEarlyCandidates[targetUserId].length} early candidates for ${targetUserId}`);
      window.rtcEarlyCandidates[targetUserId].forEach((candidate) => {
        pc.addIceCandidate(candidate).catch(e => console.error("Error adding early ICE candidate:", e));
      });
      delete window.rtcEarlyCandidates[targetUserId]; // เคลียร์โกดัง
    }
    // ===========================================
  }

  // ... (โค้ด createOffer ส่วนที่เหลือเหมือนเดิม) ...
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
    
    if (!pc) {
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
    }
    
    // ตั้งค่า remote description ก่อน
    pc.setRemoteDescription(new RTCSessionDescription(data.sdp))
      .then(() => {
        // จัดการ buffered candidates หลังจากตั้งค่า remote description
        if (window.rtcEarlyCandidates[fromUserId]) {
          console.log(`Processing ${window.rtcEarlyCandidates[fromUserId].length} buffered candidates for ${fromUserId}`);
          window.rtcEarlyCandidates[fromUserId].forEach((candidate) => {
            pc.addIceCandidate(candidate).catch(e => 
              console.warn("Error adding buffered candidate:", e)
            );
          });
          delete window.rtcEarlyCandidates[fromUserId];
        }
        return pc.createAnswer();
      })
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

  pc.setRemoteDescription(new RTCSessionDescription(data.sdp))
    .then(() => {
      // จัดการ buffered candidates หลังจากตั้งค่า remote description
      if (window.rtcEarlyCandidates[fromUserId]) {
        console.log(`Processing ${window.rtcEarlyCandidates[fromUserId].length} buffered candidates for ${fromUserId}`);
        window.rtcEarlyCandidates[fromUserId].forEach((candidate) => {
          pc.addIceCandidate(candidate).catch(e => 
            console.warn("Error adding buffered candidate:", e)
          );
        });
        delete window.rtcEarlyCandidates[fromUserId];
      }
    })
    .catch((err) => {
      console.error("Error setting remote answer:", err);
    });
}
function receiveRemoteIceCandidate(data) {
  const fromUserId = data.user_id;
  const pc = window.rtcPeerConnections[fromUserId];
  const candidate = new RTCIceCandidate(data.candidate);

  if (pc && pc.remoteDescription && pc.remoteDescription.type) {
    // เพิ่ม candidate เมื่อมี remote description แล้วเท่านั้น
    pc.addIceCandidate(candidate).catch((err) => {
      console.error(`Error adding ICE candidate for user ${fromUserId}:`, err);
    });
  } else {
    // เก็บ candidate ไว้ก่อน
    if (!window.rtcEarlyCandidates[fromUserId]) {
      window.rtcEarlyCandidates[fromUserId] = [];
    }
    console.log(`Buffering early ICE candidate from user ${fromUserId}`);
    window.rtcEarlyCandidates[fromUserId].push(candidate);
  }
}
// ในฟังก์ชัน playRemoteAudio()
function playRemoteAudio(userId, stream) {
  if (userId == window.myRTCUserId) return;
  let remoteId = "remote-audio-" + userId;
  let audioElem = document.getElementById(remoteId);
  if (!audioElem) {
    audioElem = document.createElement("audio");
    audioElem.id = remoteId;
    audioElem.autoplay = true;
    audioElem.controls = true; // เปิด controls ไว้ชั่วคราวเพื่อดีบัก
    audioElem.muted = false;
    document.body.appendChild(audioElem);
  }
  audioElem.srcObject = stream;
  
  // เพิ่มส่วน .catch() ตรงนี้เพื่อดักจับ Error
  audioElem.play().catch((e) => {
    console.error(`🔴 AUDIO PLAYBACK FAILED for user ${userId}:`, e.message);
    // ถ้าเห็น log นี้ แสดงว่าใช่ปัญหานี้แน่นอน
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
function initVoiceRoomState() {
  window.joinedVoiceRoom = false;
  window.localStream = null;
  for (let uid in window.rtcPeerConnections) closePeerConnection(uid);
  window.rtcPeerConnections = {};
  // reset flag ใน localStorage ด้วย
  const roomId = localStorage.getItem("currentRoomId");
  if (roomId) setVoiceJoined(roomId, false);
  // ลบ audio element ที่ค้างทั้งหมด
  document.querySelectorAll('audio[id^="remote-audio-"]').forEach((el) => {
    el.srcObject = null;
    el.remove();
  });
}


function waitForRTCReady(callback, maxRetry = 30) {
  let retry = 0;
  function check() {
    // 1. เช็ค socket
    if (!window.rtcSocket || window.rtcSocket.readyState !== WebSocket.OPEN) {
      if (++retry < maxRetry) return setTimeout(check, 500);
      else return callback(new Error("Signaling socket not ready"));
    }
    // 2. เช็ค localStream
    if (!window.localStream) {
      if (++retry < maxRetry) return setTimeout(check, 500);
      else return callback(new Error("Microphone not ready"));
    }
    // 3. เช็ค peer connection (optional: รอสมาชิกในห้อง)
    // หรือจะเช็คเฉพาะตัวเองก่อน
    callback(null); // พร้อมแล้ว!
  }
  check();
}

// เรียก initVoiceRoomState() ตอน page load หรือก่อน join/leave

// ====== CONNECTION QUALITY MONITORING ======
function startConnectionQualityMonitoring() {
  // ตรวจสอบการเชื่อมต่อทุกๆ 5 วินาที
  setInterval(() => {
    if (!window.joinedVoiceRoom) return;

    // ตรวจสอบคุณภาพเสียง
    if (window.localStream) {
      const audioTracks = window.localStream.getAudioTracks();
      if (audioTracks.length === 0 || !audioTracks[0].enabled) {
        setRTCStatus("ไมโครโฟนถูกปิดอยู่", true);
      }
    }

    // ตรวจสอบการเชื่อมต่อกับ peers
    for (const [peerId, pc] of Object.entries(window.rtcPeerConnections)) {
      if (pc.connectionState === 'failed') {
        setRTCStatus(RTC_STATUS.PEER_FAILED(peerId), true);
      } else if (pc.connectionState === 'connected') {
        if (!window.rtcConnectedPeers.has(peerId)) {
          window.rtcConnectedPeers.add(peerId);
          setRTCStatus(RTC_STATUS.PEER_CONNECTED(peerId));
        }
      }
    }

    // ตรวจสอบ WebSocket
    if (window.rtcSocket && window.rtcSocket.readyState !== WebSocket.OPEN) {
      setRTCStatus(RTC_STATUS.SOCKET_ERROR, true);
    }
  }, 5000);
}

// ====== KEY ======
// - websocket signaling เชื่อมต่อ/ปิดเมื่อลูกค้าเข้าออก "ห้องแชท" เท่านั้น
// - joinVoice/leaveVoice ไม่ปิด ws! อัพเดต UI ตาม voice_update event เท่านั้น
