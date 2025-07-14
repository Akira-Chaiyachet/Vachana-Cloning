let currentRoomId = null;
let ws = null;

// เรียกใช้เมื่อเลือกห้อง

function loadMessages(roomId) {
    console.log("loadMessages called");
    fetch(`/voice_chat/room/${roomId}/messages/`)
        .then(res => res.json())
        .then(data => {
            const chatMessages = document.getElementById('chatMessages');
            chatMessages.innerHTML = '';
            data.messages.forEach(msg => {
                chatMessages.appendChild(renderMessage(msg));
            });
            chatMessages.scrollTop = chatMessages.scrollHeight;
        });
}

function renderMessage(msg) {
    const div = document.createElement('div');
    div.className = 'chat-message';
    div.innerHTML = `
        <img src="${msg.user.profile_image_url}" alt="${msg.user.display_name}">
        <div>
            <div class="chat-message-meta"><b>${msg.user.display_name}</b> <span>${msg.created_at}</span></div>
            <div class="chat-message-content">${escapeHtml(msg.content)}</div>
        </div>
    `;
    console.log("สร้าง div แชท:", div, "msg:", msg);
    return div;
}

function escapeHtml(text) {
    var map = {
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, function(m) { return map[m]; });
}

document.addEventListener('DOMContentLoaded', function() {
    const chatForm = document.getElementById('chatForm');
    if (chatForm) {
        chatForm.addEventListener('submit', function(e) {
            e.preventDefault();
            const input = document.getElementById('chatInput');
            const content = input.value.trim();
            console.log('currentRoomId:', currentRoomId, 'content:', content);
            if (!content || !currentRoomId) return;
            fetch(`/room/${currentRoomId}/send_message/`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': getCSRFToken(),
                },
                body: JSON.stringify({ content })
            })
            .then(res => res.json())
            .then(msg => {
                if (msg.error) return;
                const chatMessages = document.getElementById('chatMessages');
                chatMessages.appendChild(renderMessage(msg));
                chatMessages.scrollTop = chatMessages.scrollHeight;
                input.value = '';
            });
        });
    }
});

// ดึง CSRF token จาก cookie
function getCSRFToken() {
    let name = 'csrftoken';
    let cookieValue = null;
    if (document.cookie && document.cookie !== '') {
        let cookies = document.cookie.split(';');
        for (let i = 0; i < cookies.length; i++) {
            let cookie = cookies[i].trim();
            if (cookie.substring(0, name.length + 1) === (name + '=')) {
                cookieValue = decodeURIComponent(cookie.substring(name.length + 1));
                break;
            }
        }
    }
    return cookieValue;
}

function connectWebSocket(roomId) {
    if (ws) {
        ws.close();
    }
    ws = new WebSocket(`ws://${window.location.host}/ws/room/${roomId}/`);
    ws.onmessage = function(event) {
        const data = JSON.parse(event.data);
        if (data.type === "chat_message") {
            const chatMessages = document.getElementById('chatMessages');
            const el = renderMessage(data.message);
            chatMessages.appendChild(el);
            chatMessages.scrollTop = chatMessages.scrollHeight;
        }
    };
}

// เรียก loadMessages เฉพาะตอนเปลี่ยนห้อง
function onRoomChange(roomId) {
    loadMessages(roomId);      // โหลดข้อความทั้งหมด เฉพาะตอนเปลี่ยนห้อง
    connectWebSocket(roomId);  // connect websocket ใหม่
}