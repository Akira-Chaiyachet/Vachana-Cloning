// RTC_03.13.js
// --- Discord-style Voice Chat RTC State + Auto-Reconnect (Self-contained) ---

// ========= Module-Scoped RTC/Voice State =========
let currentChatRoomId = null;
let rtcActiveRoomId = null;
let rtcIsJoined = false;
let rtcSignalingWSHandler = null; // ใช้ handler แทน ws ตรงๆ
let rtcPeerConnections = {};
let rtcLocalStream = null;

// ========= Auto-Reconnect Utility (สำหรับ WS signaling) =========
function createAutoReconnectWS(url, {onopen, onmessage, onclose}, maxRetry = 10) {
    let ws = null, retry = 0, reconnectTimer = null, shouldReconnect = true;
    function connect() {
        ws = new WebSocket(url);
        ws.onopen = function(e) { retry = 0; if (onopen) onopen(e, ws); };
        ws.onmessage = function(e) { if (onmessage) onmessage(e, ws); };
        ws.onclose = function(e) {
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
        ws.onerror = function() { ws.close(); };
    }
    connect();
    return {
        send: (...args) => ws && ws.readyState === 1 ? ws.send(...args) : null,
        close: () => { shouldReconnect = false; ws.close(); if (reconnectTimer) clearTimeout(reconnectTimer); },
        getWS: () => ws
    };
}

// ========= Voice RTC State Management =========
function resetVoiceState() {
    rtcActiveRoomId = null;
    rtcIsJoined = false;
    if (rtcSignalingWSHandler) rtcSignalingWSHandler.close();
    rtcSignalingWSHandler = null;
    for (const peerId in rtcPeerConnections) {
        try { rtcPeerConnections[peerId].close(); } catch {}
    }
    rtcPeerConnections = {};
    if (rtcLocalStream) {
        rtcLocalStream.getTracks().forEach(track => track.stop());
        rtcLocalStream = null;
    }
    resetVoiceUI();
}
function resetVoiceUI() {
    const el = document.getElementById('voiceMembersEl');
    if (el) el.innerHTML = '';
    const statusText = document.getElementById('voice-status-text');
    if (statusText) statusText.textContent = 'ยังไม่ได้เชื่อมต่อห้องเสียง';
}
function isVoiceActive() {
    return rtcIsJoined && rtcActiveRoomId !== null;
}
function ensureRoomConsistency() {
    if (rtcIsJoined && (!rtcActiveRoomId || rtcActiveRoomId !== currentChatRoomId)) {
        console.error('RTC State Inconsistent:', {rtcIsJoined, rtcActiveRoomId, currentChatRoomId});
        resetVoiceState();
    }
}

// ========= RTC Signaling WS Connect/Auto-Reconnect =========
function connectRTCSignalingWS(roomId) {
    // หยุดตัวเดิมถ้ามี
    if (rtcSignalingWSHandler) rtcSignalingWSHandler.close();
    // --- สร้าง WS ใหม่ + auto reconnect
    const wsProto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const url = `${wsProto}://${window.location.host}/ws/rtc/${roomId}/`;
    rtcSignalingWSHandler = createAutoReconnectWS(url, {
        onopen: () => {
            const statusText = document.getElementById('voice-status-text');
            if (statusText) statusText.textContent = 'เชื่อมต่อห้องเสียงสำเร็จ';
            // ส่ง join event ได้ตรงนี้ ถ้าต้องการ
            // rtcSignalingWSHandler.send(JSON.stringify({type:"voice_join"}));
        },
        onmessage: (event) => {
            // --- handle RTC signaling message (offer/answer/ICE ฯลฯ)
            let data;
            try { data = JSON.parse(event.data); } catch { return; }
            // TODO: RTC peer logic...
        },
        onclose: (e, ws, retry, interval) => {
            const statusText = document.getElementById('voice-status-text');
            if (retry === -1) {
                if (statusText) statusText.textContent = 'เชื่อมต่อเสียงล้มเหลว กรุณา leave/เข้าใหม่';
            } else if (statusText) {
                statusText.textContent = `เชื่อมต่อเสียงใหม่... (ครั้งที่ ${retry})`;
            }
        }
    });
}

// ========= Public API =========
function joinVoiceRoom(roomId) {
    if (rtcIsJoined && rtcActiveRoomId !== roomId) leaveVoiceRoom(rtcActiveRoomId);
    connectRTCSignalingWS(roomId);
    navigator.mediaDevices.getUserMedia({audio: true, video: false})
        .then(stream => {
            rtcLocalStream = stream;
            rtcActiveRoomId = roomId;
            rtcIsJoined = true;
            if (rtcSignalingWSHandler) rtcSignalingWSHandler.send(JSON.stringify({type: "voice_join"}));
            const statusText = document.getElementById('voice-status-text');
            if (statusText) statusText.textContent = 'เชื่อมต่อห้องเสียงสำเร็จ';
        })
        .catch(err => {
            rtcLocalStream = null;
            const statusText = document.getElementById('voice-status-text');
            if (statusText) statusText.textContent = 'ไมค์ใช้งานไม่ได้';
            resetVoiceState();
        });
}
function leaveVoiceRoom(roomId) {
    if (rtcSignalingWSHandler) rtcSignalingWSHandler.send(JSON.stringify({type: "voice_leave"}));
    resetVoiceState();
    const statusText = document.getElementById('voice-status-text');
    if (statusText) statusText.textContent = 'ออกจากห้องเสียงแล้ว';
}
function updateVoiceMembersUI(members) {
    const el = document.getElementById('voiceMembersEl');
    if (!el) return;
    el.innerHTML = '';
    if (!members || members.length === 0) {
        el.innerHTML = '<div class="voice-member-empty">ยังไม่มีใครอยู่ในห้องเสียง</div>';
        return;
    }
    members.forEach(member => {
        el.innerHTML += `
            <div class="voice-member">
                <img src="${member.avatarUrl || '/media/default/user.png'}" class="voice-avatar" style="width:32px;height:32px;border-radius:50%;margin-right:8px;">
                <span>${member.displayName}</span>
            </div>`;
    });
}

// ========= EXPORT (สำหรับ import หรือ assign window ถ้าต้องการ) =========
export {
    currentChatRoomId,
    rtcActiveRoomId,
    rtcIsJoined,
    rtcSignalingWSHandler,
    rtcPeerConnections,
    rtcLocalStream,
    resetVoiceState,
    resetVoiceUI,
    isVoiceActive,
    ensureRoomConsistency,
    connectRTCSignalingWS,
    joinVoiceRoom,
    leaveVoiceRoom,
    updateVoiceMembersUI,
};
window.joinVoiceRoom = joinVoiceRoom;
window.leaveVoiceRoom = leaveVoiceRoom;
window.updateVoiceMembersUI = updateVoiceMembersUI;
