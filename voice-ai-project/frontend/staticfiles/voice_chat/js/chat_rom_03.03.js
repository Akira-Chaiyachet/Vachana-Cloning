// ตัวแปร global สำหรับเก็บ ID ของห้องที่กำลังใช้งาน
// จะถูกตั้งค่าโดยฟังก์ชัน loadMessages
let currentRoomId = null;

/**
 * โหลดประวัติข้อความสำหรับห้องที่กำหนดและแสดงผล
 * @param {string} roomId - ID ของห้องที่ต้องการโหลด
 */
function loadMessages(roomId) {
    // 1. ตั้งค่า ID ห้องปัจจุบัน เพื่อให้ฟอร์มส่งข้อความรู้ว่าจะส่งไปที่ไหน
    currentRoomId = roomId;

    const chatMessages = document.getElementById('chatMessages');
    if (!chatMessages) {
        console.error("Element #chatMessages not found!");
        return;
    }

    // 2. ล้างข้อความเก่าทิ้งทั้งหมด (สำคัญมากเมื่อเปลี่ยนห้อง)
    chatMessages.innerHTML = '';

    // 3. เรียก API เพื่อดึงประวัติแชท (ใช้ URL ที่ถูกต้อง)
    fetch(`/api/room/${roomId}/messages/`)
        .then(res => res.json())
        .then(data => {
            // data.messages คือ array ของข้อความ
            if (data.messages && Array.isArray(data.messages)) {
                data.messages.forEach(msg => {
                    chatMessages.appendChild(renderMessage(msg));
                });
                // เลื่อนไปที่ข้อความล่าสุด
                chatMessages.scrollTop = chatMessages.scrollHeight;
            }
        })
        .catch(error => {
            console.error("Error loading messages:", error);
            chatMessages.innerHTML = '<li>เกิดข้อผิดพลาดในการโหลดข้อความ</li>';
        });
}

/**
 * สร้าง Element ของข้อความเพื่อนำไปแสดงผล
 * @param {object} msg - Object ของข้อความที่ได้จาก API หรือ WebSocket
 * @returns {HTMLElement} - div element ของข้อความ
 */
function renderMessage(msg) {
    const div = document.createElement('div');
    div.className = 'chat-message'; // ตรวจสอบว่า CSS class นี้ถูกต้อง

    // ตรวจสอบว่าเป็นข้อความของผู้ใช้ที่ล็อกอินอยู่หรือไม่
    // `currentLoggedInUserId` เป็นตัวแปร global ที่มาจาก script_03.2.10.js
    if (msg.user && msg.user.id == currentLoggedInUserId) {
        div.classList.add('sent');
    } else {
        div.classList.add('received');
    }

    // ตรวจสอบโครงสร้าง msg object ให้แน่ใจว่ามี user.profile_image_url และ user.display_name
    const profileImageUrl = msg.user?.profile_image_url || '/media/default/profile.jpg';
    const displayName = msg.user?.display_name || 'Unknown User';

    // แก้ไขปัญหาเวลา: บอกให้ JavaScript ทราบว่าเวลาที่ได้รับจาก server เป็น UTC
    // โดยการเติม 'Z' (Timezone designator for UTC) ต่อท้ายสตริงเวลา
    // ซึ่งจะทำให้ toLocaleTimeString() แปลงเป็นเวลาท้องถิ่นของผู้ใช้ได้อย่างถูกต้อง
    // ถ้าไม่มี msg.created_at (เช่น ข้อความที่เพิ่งพิมพ์แต่ยังไม่ถูกส่ง) ให้ใช้เวลาปัจจุบันแทน
    const dateObj = msg.created_at ? new Date(msg.created_at + 'Z') : new Date();

    // จัดรูปแบบวันที่เป็น ว/ด/ป (เช่น 09/03/2567) สำหรับโซนเวลาไทย
    const datePart = dateObj.toLocaleDateString('th-TH', {
        day: '2-digit', month: '2-digit', year: 'numeric'
    });
    // จัดรูปแบบเวลาเป็น ชม:นาที (เช่น 15:30)
    const timePart = dateObj.toLocaleTimeString('th-TH', {
        hour: '2-digit', minute: '2-digit'
    });
    const createdAt = `${datePart} ${timePart}`;

    div.innerHTML = `
        <img src="${profileImageUrl}" alt="${escapeHtml(displayName)}">
        <div>
            <div class="chat-message-meta"><b style="font-size: 18px; color: #9cc0b2;">${escapeHtml(displayName)}</b> <span style="color:rgba(156, 192, 178, 0.44);">${createdAt}</span></div>
            <div class="chat-message-content">${escapeHtml(msg.content)}</div>
        </div>
    `;
    return div;
}

/**
 * ป้องกัน XSS โดยการแปลงอักขระพิเศษเป็น HTML entities
 * @param {string} text - ข้อความที่ต้องการ escape
 * @returns {string} - ข้อความที่ปลอดภัย
 */
function escapeHtml(text) {
    if (typeof text !== 'string') return '';
    var map = {
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, function(m) { return map[m]; });
}

// Event Listener สำหรับฟอร์มส่งข้อความ
// จะถูกตั้งค่าแค่ครั้งเดียวเมื่อหน้าเว็บโหลดเสร็จ
document.addEventListener('DOMContentLoaded', function() {
    const chatForm = document.getElementById('chatForm');
    if (chatForm) {
        chatForm.addEventListener('submit', function(e) {
            e.preventDefault();
            const input = document.getElementById('chatInput');
            const content = input.value.trim();

            // ตรวจสอบว่ามีข้อความและอยู่ในห้องหรือไม่
            if (!content || !currentRoomId) {
                console.warn("Cannot send message: No content or not in a room.");
                return;
            }

            // ส่งข้อความผ่าน API (ใช้ URL ที่ถูกต้อง)
            fetch(`/api/room/${currentRoomId}/send-message/`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': getCSRFToken(),
                },
                body: JSON.stringify({ content: content })
            })
            .then(res => {
                if (!res.ok) {
                    // ถ้า Server ตอบกลับมาด้วย status error (เช่น 400, 500)
                    res.json().then(err => {
                        console.error("Error sending message:", err.error || 'Unknown error');
                        alert(`ส่งข้อความไม่สำเร็จ: ${err.error || 'เกิดข้อผิดพลาดไม่ทราบสาเหตุ'}`);
                    }).catch(() => {
                        console.error(`Error sending message: HTTP ${res.status}`);
                        alert(`ส่งข้อความไม่สำเร็จ: เกิดข้อผิดพลาด HTTP ${res.status}`);
                    });
                } else {
                    // ถ้าสำเร็จ (201) ให้ล้างช่อง input
                    // ไม่ต้องทำอะไรกับ UI ที่นี่ เพราะข้อความจะถูกส่งกลับมาผ่าน WebSocket
                    input.value = '';
                }
            })
            .catch(error => {
                console.error("Network error sending message:", error);
                alert("ส่งข้อความไม่สำเร็จ: เกิดข้อผิดพลาดในการเชื่อมต่อ");
            });
        });
    }
});

// ฟังก์ชัน getCSRFToken ถูกย้ายไปที่ script_03.12.js แล้วเพื่อให้ใช้ร่วมกันได้
// จึงไม่จำเป็นต้องมีในไฟล์นี้อีก