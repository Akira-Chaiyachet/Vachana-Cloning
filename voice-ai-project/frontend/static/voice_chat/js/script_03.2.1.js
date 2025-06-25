let socket = null;  // เก็บ WebSocket ไว้ใช้ทั่วไฟล์
let preventMenuToggle = true;
function connectWebSocket(roomId) {
    if (socket && socket.readyState === WebSocket.OPEN) {
        console.warn("⚠️ WebSocket ยังเปิดอยู่ ไม่ต้องสร้างใหม่");
        return;
    }

    let wsProtocol = window.location.protocol === "https:" ? "wss://" : "ws://";
    let wsURL = `${wsProtocol}${window.location.host}/ws/room/${roomId}/`;
    socket = new WebSocket(wsURL);

    socket.onopen = function () {
        console.log("✅ WebSocket เชื่อมต่อสำเร็จ!");
    };

    socket.onmessage = function (event) {
        let data = JSON.parse(event.data);
        console.log("📩 ได้รับข้อมูลจาก WebSocket:", data);

        if (data.type === "refresh_members" || data.type === "update_members") {
            console.log("🔄 รีเฟรชรายชื่อสมาชิกจาก API...");
            loadRoomMembers();  // ✅ โหลดข้อมูลใหม่จากเซิร์ฟเวอร์
        }
    };

    socket.onclose = function (event) {
        console.warn("❌ WebSocket ถูกตัดการเชื่อมต่อ (Code: " + event.code + ")");
        setTimeout(() => connectWebSocket(roomId), 3000);
    };

    socket.onerror = function (error) {
        console.error("⚠️ เกิดข้อผิดพลาดกับ WebSocket:", error);
    };
}

function connectLobbySocket() {
    console.log("🔌 Attempting to connect to the Lobby WebSocket...");
    
    const lobbyProtocol = window.location.protocol === "https:" ? "wss://" : "ws://";
    const lobbyUrl = `${lobbyProtocol}${window.location.host}/ws/lobby/`;
    const lobbySocket = new WebSocket(lobbyUrl);

    lobbySocket.onopen = function() {
        console.log("✅ Lobby WebSocket connection established.");
    };

    lobbySocket.onmessage = function(event) {
        const data = JSON.parse(event.data);
        console.log("🛎️ Received a notification from Lobby:", data);

        // ตรวจสอบชนิดของข้อความที่ได้รับ
        if (data.type === 'room_updated' && data.room) {
            const room = data.room;
            console.log(`🔄 Updating room in sidebar: ID=${room.id}, Name=${room.name}`);
            
            // ค้นหารายการห้องใน Sidebar ด้วย ID
            const roomListItem = document.querySelector(`#roomList li[onclick*="loadRoom('${room.id}'"]`);

            if (roomListItem) {
                // อัปเดตชื่อ
                const roomNameSpan = roomListItem.querySelector('span');
                if (roomNameSpan) {
                    roomNameSpan.textContent = room.name;
                }
                
                // อัปเดตรูปภาพ
                const roomImageElem = roomListItem.querySelector('img');
                if (roomImageElem) {
                    roomImageElem.src = room.image_url;
                }
                
                // อัปเดต onclick attribute เพื่อให้ชื่อใหม่ถูกส่งไปเมื่อคลิก
                // นี่เป็นวิธีที่ง่ายที่สุดโดยไม่ต้องสร้าง element ใหม่ทั้งหมด
                const oldOnclick = roomListItem.getAttribute('onclick');
                const oldInviteCode = oldOnclick.split(',')[2].replace(/['")]/g, '').trim();
                roomListItem.setAttribute('onclick', `loadRoom('${room.id}', '${room.name}', '${oldInviteCode}')`);

            } else {
                console.warn(`Could not find room with ID ${room.id} in the sidebar to update.`);
            }
        }
    };

    lobbySocket.onclose = function(event) {
        console.warn("❌ Lobby WebSocket connection closed. Reconnecting in 5 seconds...");
        setTimeout(connectLobbySocket, 5000); // พยายามเชื่อมต่อใหม่
    };

    lobbySocket.onerror = function(error) {
        console.error("⚠️ Lobby WebSocket error:", error);
    };
}

function loadRoomMembers() {
    let roomId = localStorage.getItem("currentRoomId");
    if (!roomId) {
        console.error("❌ ไม่พบ roomId! ไม่สามารถโหลดสมาชิกได้");
        return;
    }

    fetch(`/get-room-members/${roomId}/?timestamp=${Date.now()}`) // timestamp ป้องกัน cache
        .then(response => {
            if (!response.ok) {
                throw new Error(`HTTP Error! Status: ${response.status}`);
            }
            return response.json();
        })
        .then(data => {
            console.log("📡 อัปเดตรายชื่อสมาชิกจาก API:", data);

            let userList = document.getElementById("userList");
            if (!userList) {
                console.error("❌ ไม่พบ <ul id='userList'> ใน HTML");
                return;
            }

            userList.innerHTML = ""; // ล้างรายการเก่า
            if (Array.isArray(data.members) && data.members.length > 0) {
                data.members.forEach(member => {
                    let li = document.createElement("li");
                    li.dataset.userId = member.id; // เพิ่ม data-user-id ที่นี่

                    // VVV ใช้ name_to_display จาก API VVV
                    // ถ้าไม่มี name_to_display ให้ใช้ username หรือ "ไม่ทราบชื่อ" เป็น fallback
                    const displayName = member.name_to_display || member.username || 'ผู้ใช้ไม่ทราบชื่อ';
                    // ^^^ สิ้นสุดการเปลี่ยนแปลง ^^^

                    li.innerHTML = `
                        <img src="${member.profile_image || '/media/default/profile.jpg'}" 
                            onerror="this.src='/media/default/profile.jpg'" 
                            class="profile-img">
                        <span>${escapeHTML(displayName)}</span>
                    `;
                    userList.appendChild(li);
                });
            } else {
                console.warn("⚠️ ไม่มีสมาชิกในห้องนี้ หรือข้อมูลสมาชิกไม่ถูกต้อง");
                userList.innerHTML = "<li>ไม่มีสมาชิกในห้องนี้</li>";
            }
        })
        .catch(error => {
            console.error("❌ เกิดข้อผิดพลาดในการโหลดสมาชิก:", error);
            let userList = document.getElementById("userList");
            if (userList) { // แสดง error ใน list ถ้าเป็นไปได้
                userList.innerHTML = "<li>เกิดข้อผิดพลาดในการโหลดรายชื่อสมาชิก</li>";
            }
        });
}



function disconnectRoom() {
    preventMenuToggle = true; 
    // ✅ ลบข้อมูลห้องที่ถูกบันทึกไว้
    localStorage.removeItem("currentRoomId");
    localStorage.removeItem("currentRoomName");
    localStorage.removeItem("currentInviteCode");

    // ✅ ซ่อน UI ห้องแชท แล้วแสดง Sidebar (เลือกห้อง)
    document.querySelector(".user-container").style.display = "none";
    document.querySelector(".sidebar").style.display = "block";

    // ✅ รีเซ็ต UI ของห้อง
    document.getElementById("roomTitle").textContent = "เลือกห้อง";
    document.getElementById("leaveBtn").style.display = "none";
    document.getElementById("settingsBtn").style.display = "none";
    document.getElementById("userList").innerHTML = "";

    // ✅ ปิดเมนูตั้งค่า (ถ้ามี)
    document.getElementById("settingsMenu").style.display = "none";
    // ✅ บังคับโหลดหน้าใหม่เพื่อเคลียร์ข้อมูลค้าง
    setTimeout(() => {
        window.location.reload();
    }, 50); // ให้เวลาสั้น ๆ ก่อนรีโหลด
}
