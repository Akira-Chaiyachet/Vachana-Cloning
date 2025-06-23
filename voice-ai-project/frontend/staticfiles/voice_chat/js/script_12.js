document.addEventListener("DOMContentLoaded", function () {
    loadRooms();

    const urlParams = new URLSearchParams(window.location.search);
    const inviteCodeFromUrl = urlParams.get("invite");
    const pendingInviteCodeFromSession = sessionStorage.getItem('pending_invite_code_after_auth');
    const legacyPendingInvite = sessionStorage.getItem('pending_invite');

    fetch("/api/check-auth/")
        .then(response => response.json())
        .then(data => {
            if (!data.isAuthenticated) {
                let codeToRemember = inviteCodeFromUrl || pendingInviteCodeFromSession || legacyPendingInvite;
                if (codeToRemember) {
                    sessionStorage.setItem('pending_invite_code_after_auth', codeToRemember);
                    console.log("Homepage: Unauthenticated, invite code found. Storing and redirecting to login. Code:", codeToRemember);
                    
                    let redirectToLoginNextParam = '/';
                    if (inviteCodeFromUrl) {
                        redirectToLoginNextParam = window.location.pathname + window.location.search;
                    } else {
                        redirectToLoginNextParam = `/join-room/${codeToRemember}/`;
                    }
                    window.location.href = `/users/login/?next=${encodeURIComponent(redirectToLoginNextParam)}`;
                    return;
                }
                console.log("Homepage: User not authenticated, no pending invite.");
            } else {
                let finalInviteCode = null;

                if (inviteCodeFromUrl) {
                    finalInviteCode = inviteCodeFromUrl;
                } else if (pendingInviteCodeFromSession) {
                    finalInviteCode = pendingInviteCodeFromSession;
                } else if (legacyPendingInvite) {
                    finalInviteCode = legacyPendingInvite;
                }

                if (finalInviteCode) {
                    console.log("Processing final invite code:", finalInviteCode);
                    if (typeof searchRoom_link === "function") {
                        searchRoom_link(finalInviteCode);
                    } else {
                        console.error("ฟังก์ชัน searchRoom_link ไม่พบ!");
                    }

                    if (inviteCodeFromUrl) {
                        const newUrl = window.location.pathname;
                        window.history.replaceState({}, document.title, newUrl);
                    }
                    sessionStorage.removeItem('pending_invite_code_after_auth');
                    sessionStorage.removeItem('pending_invite');
                } else {
                    console.log("Homepage (Authenticated): No invite code to process. Loading last room from localStorage.");
                    let roomId = localStorage.getItem("currentRoomId");
                    let roomName = localStorage.getItem("currentRoomName");
                    let currentInvite = localStorage.getItem("currentInviteCode");

                    if (roomId) {
                        const welcomeMsgEl = document.getElementById("welcome-message");
                        if (welcomeMsgEl) welcomeMsgEl.style.display = "none";
                        const usersHeaderEl = document.getElementById("users-header");
                        if (usersHeaderEl) usersHeaderEl.style.display = "block";
                    }

                    if (roomId && roomName) {
                        loadRoom(roomId, roomName, currentInvite);
                    }
                }
            }
        })
        .catch(error => {
            console.error("เกิดข้อผิดพลาดในการตรวจสอบสถานะล็อกอิน หรือประมวลผล invite code:", error);
        });
});



const createRoomForm = document.getElementById("createRoomForm");
if (createRoomForm) {
    createRoomForm.addEventListener("submit", function (event) {
        event.preventDefault();

        let formData = new FormData();
        formData.append("name", document.getElementById("roomName").value);
        formData.append("image", document.getElementById("roomImage").files[0]);

        fetch("/create-room/", {
            method: "POST",
            body: formData,
            headers: { "X-CSRFToken": getCSRFToken() },
        })
            .then(response => response.json())
            .then(data => {
                if (data.error) {
                    alert(data.error);
                } else {
                    alert("สร้างห้องสำเร็จ!");
                    loadRooms(); // โหลดห้องใหม่
                }
            })
            .catch(error => console.error("เกิดข้อผิดพลาด:", error));
    });
}
document.addEventListener("click", function (event) {
    let menu = document.getElementById("settingsMenu");
    let button = document.getElementById("settingsBtn");

    // เช็คว่าคลิกข้างนอกเมนู
    if (menu.style.display === "block" && !menu.contains(event.target) && event.target !== button) {
        menu.style.display = "none";
    }
    const currentUserMenu = document.getElementById("currentUserMenu");
    const currentUserDisplayTrigger = document.querySelector(".current-user-display"); // Trigger ของ currentUserMenu
    if (currentUserMenu && currentUserDisplayTrigger) { // ตรวจสอบว่า elements มีอยู่จริง
        if (currentUserMenu.style.display === "block" &&
            !currentUserMenu.contains(event.target) &&        // คลิกไม่ได้อยู่ข้างใน currentUserMenu
            !currentUserDisplayTrigger.contains(event.target)) { // และคลิกไม่ได้อยู่ที่ .current-user-display
            currentUserMenu.style.display = "none";
        }
    }
});



function submitCreateRoomFormFromModal() { // ชื่อใหม่ (หรือจะใช้ชื่อเดิมก็ได้ถ้าไม่สับสน)
    const form = document.getElementById("genericModalCreateRoomForm"); // ID ของ form ที่อยู่ใน Popup
    if (!form) {
        console.error("ไม่พบฟอร์ม genericModalCreateRoomForm ใน Popup!");
        alert("เกิดข้อผิดพลาด: ไม่พบข้อมูลฟอร์มสำหรับสร้างห้อง");
        return;
    }

    let formData = new FormData(form);

    fetch("/create-room/", { // URL ของคุณสำหรับสร้างห้อง
        method: "POST",
        body: formData,
        headers: { "X-CSRFToken": getCSRFToken() }, // ฟังก์ชัน getCSRFToken() ของคุณต้องทำงานได้
    })
    .then(response => {
        if (!response.ok) {
            return response.json().then(errData => {
                throw new Error(errData.error || `เกิดข้อผิดพลาด HTTP ${response.status}`);
            }).catch(() => {
                throw new Error(`เกิดข้อผิดพลาด HTTP ${response.status}`);
            });
        }
        return response.json();
    })
    .then(data => {
        if (data.error) {
            alert("ผิดพลาด: " + data.error);
        } else {
            alert("ห้องถูกสร้างเรียบร้อยแล้ว!");
            closeGenericModal(); // ปิด Popup ใหม่ของเรา
            if (typeof loadRooms === "function") {
                loadRooms(); // โหลดรายการห้องใหม่ (ถ้ามีฟังก์ชันนี้)
            }
        }
    })
    .catch(error => {
        console.error("เกิดข้อผิดพลาดขณะสร้างห้อง:", error);
        alert(error.message || "เกิดข้อผิดพลาดบางอย่าง กรุณาลองใหม่");
    });
}

function loadRooms() {
    fetch("/get-rooms/")
        .then(response => {
            if (!response.ok) {
                throw new Error(`HTTP error! Status: ${response.status}`);
            }
            return response.json();
        })
        .then(data => {
            let roomList = document.getElementById("roomList");
            if (!roomList) {
                console.error("Element #roomList ไม่พบใน DOM");
                return;
            }

            roomList.innerHTML = ""; // ล้างรายการเก่าทิ้งก่อนโหลดใหม่

            data.rooms.forEach(room => {
                let li = document.createElement("li");
                li.innerHTML = `
                <img src="${room.image_url}" onerror="this.src='/media/default/room.jpg'">
                <span>${room.name}</span>
            `;
                li.onclick = () => loadRoom(room.id, room.name, room.invite_code);
                roomList.appendChild(li);
            });

            console.log("โหลดห้องสำเร็จ:", data.rooms.length, "ห้อง");
        })
        .catch(error => console.error("เกิดข้อผิดพลาดในการโหลดห้อง:", error));

}


function loadRoom(roomId, roomName, inviteCode) {
    if (!roomId) {
        console.error("❌ ไม่มี roomId! ไม่สามารถโหลดห้องได้");
        return;
    }else{
        document.getElementById("welcome-message").style.display = "none";
        document.getElementById("users-header").style.display = "block";
    }
    document.getElementById("roomTitle").textContent = roomName;
    // document.getElementById("leaveBtn").style.display = "inline-block";
    document.getElementById("settingsBtn").style.display = "inline-block";
    // 👉 บันทึกห้องล่าสุดลง LocalStorage
    localStorage.setItem("currentRoomId", roomId);
    localStorage.setItem("currentRoomName", roomName);
    localStorage.setItem("currentInviteCode", inviteCode);
    preventMenuToggle = false; // ❌ ห้าม toggle เมนูหลังจากโหลดห้อง
    document.getElementById("copyRoomCodeBtn").style.display = "block";
    document.getElementById("munublock").style.display = "block";    
    console.log(`🔄 กำลังโหลดห้อง: ${roomName} (${roomId})`);

    connectWebSocket(roomId);
    loadRoomMembers();


    console.log(`📡 กำลังดึงข้อมูลสมาชิกจาก: /get-room-members/${roomId}/`); // ✅ Debug

    fetch(`/get-room-members/${roomId}/`)
        .then(response => response.json())
        .then(data => {
            console.log(`📡 API Response:`, data);
            if (!Array.isArray(data.members)) {
                console.error("❌ API ส่งข้อมูลสมาชิกผิดพลาด:", data.members);
                return;
            }

            updateUserList(data.members); // ✅ โหลดสมาชิกทันที ไม่ต้องดีเลย์
        })
        .catch(error => console.error("เกิดข้อผิดพลาดในการโหลดสมาชิก:", error));
}


function copyInviteLink() {
    let inviteCode = localStorage.getItem("currentInviteCode");
    if (!inviteCode) {
        alert("ไม่พบลิงก์คำเชิญ");
        return;
    }

    let inviteLink = `${window.location.origin}/join-room/${inviteCode}/`;
    navigator.clipboard.writeText(inviteLink)
        .then(() => alert("คัดลอกลิงก์คำเชิญเรียบร้อยแล้ว!"))
        .catch(err => console.error("คัดลอกลิงก์ล้มเหลว:", err));
}

function copyRoomCode() {
    let inviteCode = localStorage.getItem("currentInviteCode");
    if (!inviteCode) {
        alert("ไม่พบรหัสห้อง");
        return;
    }

    navigator.clipboard.writeText(inviteCode)
        .then(() => alert("คัดลอกรหัสห้องเรียบร้อยแล้ว!"))
        .catch(err => console.error("คัดลอกรหัสล้มเหลว:", err));
}

function leaveRoom() {
    let roomId = localStorage.getItem("currentRoomId");
    if (!roomId) {
        alert("❌ ไม่พบข้อมูลห้อง");
        return;
    }
    fetch(`/leave-room/${roomId}/`, {
        method: "POST",
        headers: { "X-CSRFToken": getCSRFToken() },
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {

            // 🔴 ส่งแจ้งเตือนไปยังสมาชิกในห้อง
            if (socket && socket.readyState === WebSocket.OPEN) {
                socket.send(JSON.stringify({
                    type: "user_leave",
                    username: localStorage.getItem("username") || "Unknown",
                    roomId: roomId
                }));
            }

            // ล้างข้อมูลห้องที่บันทึกไว้
            localStorage.removeItem("currentRoomId");
            localStorage.removeItem("currentRoomName");
            localStorage.removeItem("currentInviteCode");

            // ซ่อน UI ห้องแชท
            document.getElementById("roomTitle").textContent = "วัจนะโคลนนิ่ง ยินดีต้อนรับ 🥳";
            document.getElementById("leaveBtn").style.display = "none";
            document.getElementById("settingsBtn").style.display = "none";
            document.getElementById("userList").innerHTML = "";

            // ซ่อนเมนูตั้งค่า
            document.getElementById("settingsMenu").style.display = "none";

            // โหลดห้องใหม่ (ห้องที่ออกจะไม่แสดง)
            disconnectRoom()

            // ปิด WebSocket หลังจากออกจากห้อง
            if (socket) {
                socket.close();
                socket = null;
            }
        } else {
            alert("❌ " + data.message);
        }
    })
    .catch(error => {
        console.error("❌ เกิดข้อผิดพลาด:", error);
        alert("เกิดข้อผิดพลาด กรุณาลองใหม่!");
    });
}

function joinRoomPopup() {
    const inviteCode = document.getElementById("inviteCode")?.value;

    if (!inviteCode) {
        alert("❌ ไม่พบโค้ดเชิญ");
        return;
    }

    // ✅ ดึงชื่อห้องและรูปจาก modal
    const roomName = document.getElementById("modalRoomName")?.textContent || `ห้อง ${inviteCode}`;
    const roomImage = document.getElementById("modalRoomImage")?.src || "/media/default/room.jpg";

    console.log("🔄 กำลังขอโค้ดห้อง:", inviteCode);

    // ✅ เช็คสถานะการล็อกอินก่อน
    fetch("/api/check-auth/")
        .then(response => response.json())
        .then(data => {
            if (!data.isAuthenticated) {
                alert("กรุณาล็อกอินก่อนที่จะเข้าห้อง");
                window.location.href = "/login/";
                return;
            }

            // 🔄 เรียก API เข้าห้อง
            fetch(`/api/join-room/${inviteCode}/`, {
                method: "POST",
                headers: {
                    "X-CSRFToken": getCSRFToken()
                },
            })
            .then(response => {
                if (response.headers.get("Content-Type").includes("text/html")) {
                    return response.text();
                }
                return response.json();
            })
            .then(data => {
                if (typeof data === "string") {
                    console.log("📢 Response HTML:", data);
                    alert("เกิดข้อผิดพลาดในการเข้าสู่ห้อง");
                    window.location.href = "/";
                } else {
                    console.log("📢 API Data:", data);
                    if (data.success) {
                        alert(data.message);
                        closeGenericModal();

                        // ✅ ใช้ชื่อห้องและรูปจาก modal แทน fallback จาก API
                        const finalRoomName = data.room_name || roomName;
                        const finalRoomImage = data.room_image || roomImage;

                        if (!document.querySelector(`[data-room-id="${data.roomId}"]`)) {
                            addRoomToSidebar(data.roomId, finalRoomName, finalRoomImage, inviteCode);
                        }
                    } else {
                        alert("❌ " + (data.error || data.message));
                    }
                }
            })
            .catch(error => {
                console.error("❌ เกิดข้อผิดพลาดในการเข้าห้อง:", error);
                alert("เกิดข้อผิดพลาด กรุณาลองใหม่!");
            });
        })
        .catch(error => {
            console.error("❌ ไม่สามารถเช็คสถานะล็อกอินได้:", error);
            alert("เกิดข้อผิดพลาดในการตรวจสอบสถานะล็อกอิน");
        });
}




// ✅ ฟังก์ชันเพิ่มห้องใหม่ใน Sidebar
function addRoomToSidebar(roomId, roomName, roomImage, inviteCode, isNew = true) {
    let roomList = document.getElementById("roomList");
    if (!roomList) {
        console.error("❌ ไม่พบ <ul id='roomList'> ใน HTML");
        return;
    }

    // ✅ ตรวจสอบก่อนว่า ห้องนี้มีอยู่แล้วหรือไม่
    if (document.querySelector(`[data-room-id="${roomId}"]`)) {
        console.warn(`⚠️ ห้อง ${roomName} มีอยู่แล้วในรายการ`);
        return;
    }

    let li = document.createElement("li");
    li.className = "room-item";
    li.dataset.roomId = roomId;
    li.dataset.inviteCode = inviteCode;

    // ✅ ถ้าเป็นห้องใหม่ ให้เพิ่ม "(ห้องใหม่!)"
    let displayName = isNew ? `${roomName} <b style="color: red;">(ห้องใหม่!)</b>` : roomName;

    li.innerHTML = `
        <img src="${roomImage}" class="room-icon" onerror="this.src='/media/default/room.jpg'">
        <span class="room-name">${displayName}</span>
    `;

    // ✅ เมื่อกดที่ชื่อห้อง ให้โหลดห้อง และลบ "(ห้องใหม่!)"
    li.onclick = function() {
        loadRoom(roomId, roomName, inviteCode);

        // ลบ "(ห้องใหม่!)" ออกจากชื่อห้อง
        let span = li.querySelector(".room-name");
        if (span) {
            span.innerHTML = roomName; // เปลี่ยนกลับเป็นชื่อปกติ
        }
    };

    roomList.appendChild(li);
}


function toggleSettingsMenu() {
    let menu = document.getElementById("settingsMenu");
    menu.style.display = menu.style.display === "block" ? "none" : "block";
}

function toggleCurrentUserMenu() {
    let menu = document.getElementById("currentUserMenu");
    if (!menu) {
        return;
    }

    // (ทางเลือก) ถ้าต้องการให้เมนูห้องปิด เมื่อเมนูผู้ใช้เปิด
    let roomSettingsMenu = document.getElementById("settingsMenu");
    if (roomSettingsMenu && roomSettingsMenu.style.display === "block") {
        roomSettingsMenu.style.display = "none";
    }

    // สลับการแสดงผลของ currentUserMenu
    if (menu.style.display === "block") {
        menu.style.display = "none";
    } else {
        menu.style.display = "block";
    }
}

// function getCSRFToken() {
//     return document.querySelector("input[name=csrfmiddlewaretoken]").value;
// }


function searchRoom() {
    let input = document.getElementById("searchRoom").value.trim();
    if (!input) return alert("กรุณากรอกรหัสห้องหรือ URL");

    let match = input.match(/\/join-room\/([\w-]+)/);
    let inviteCode = match ? match[1] : input;

    fetch(`/api/search-room/${inviteCode}/`)
        .then(response => response.json())
        .then(data => {
            if (data.error) {
                alert("ไม่พบห้องนี้");
            } else {
                showPopupModal(data.room_name, data.room_image, inviteCode);
            }
        })
        .catch(error => {
            console.error("เกิดข้อผิดพลาดในการค้นหาห้อง:", error);
            alert("เกิดข้อผิดพลาดในการค้นหาห้อง");
        });
}

function escapeHTML(str) {
    return str.replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function searchRoom_link(inviteCode) {
    console.log("Attempting to process inviteCode:", inviteCode); // << Log inviteCode ที่ได้รับ
    if (!inviteCode) {
        console.error("No inviteCode provided to process.");
        return;
    }

    fetch(`/api/search-room/${inviteCode}/`)
        .then(response => {
            if (!response.ok) { // เพิ่มการตรวจสอบนี้เพื่อความปลอดภัย
                console.error("Response not OK from /api/search-room/", response);
                throw new Error(`Server error: ${response.status}`);
            }
            return response.json();
        })
        .then(data => {
            console.log("Data received from /api/search-room/:", data); // << Log ข้อมูลที่ได้จาก server
            if (data.error) {
                alert("ไม่พบห้องนี้: " + data.error);
            } else if (data.room_name && data.room_image !== undefined) { // ตรวจสอบข้อมูลก่อนเรียก
                showPopupModal(data.room_name, data.room_image, inviteCode);
            } else {
                alert("ข้อมูลห้องที่ได้รับไม่สมบูรณ์");
                console.error("Incomplete room data for showPopupModal:", data);
            }
        })
        .catch(error => {
            console.error("เกิดข้อผิดพลาดในการค้นหาห้อง (searchRoomOrProcessInvite):", error);
            alert("เกิดข้อผิดพลาดในการค้นหาห้อง: " + error.message);
        });
}

function handleSearch(event) {
    if (event.key === "Enter") {
        searchRoom();  // เรียกฟังก์ชัน searchRoom เมื่อกด Enter
    }
}


// แสดง Popup ยืนยัน
function showPopup(roomName, roomImage, inviteCode) {
    closePopup(); // ซ่อน Popup ก่อนเปิดใหม่

    document.getElementById("popupRoomName").textContent = roomName;
    document.getElementById("popupRoomImage").src = roomImage || "/media/default/room.jpg";
    document.getElementById("roomPopup").style.display = "flex";

    // เก็บ inviteCode ไว้ในปุ่ม Join
    document.getElementById("roomPopup").setAttribute("data-invite", inviteCode);
}


function closePopup() {
    const popup = document.getElementById("roomPopup");
    if (popup) {
        popup.style.display = "none";
        document.body.classList.remove("popup-active");
    }
}
window.onload = function () {
    closePopup();
};

// เข้าร่วมห้องจาก Popup


function openPopup(inviteCode, roomName, roomImage) {
    let popup = document.getElementById("roomPopup");

    if (!popup) {
        console.error("ไม่พบ #roomPopup");
        return;
    }

    // กำหนดค่า data-invite
    popup.setAttribute("data-invite", inviteCode);

    // อัปเดตรูปและชื่อห้อง
    document.getElementById("popupRoomImage").src = roomImage || "/media/default/room.jpg";
    document.getElementById("popupRoomName").textContent = roomName;

    // แสดงป็อปอัป
    popup.style.display = "block";
}

function showInvitePopup(inviteCode) {
    let popup = document.getElementById("roomPopup");
    popup.setAttribute("data-invite", inviteCode);

    // โหลดข้อมูลห้องจากโค้ดเชิญ
    fetch(`/api/search-room/${inviteCode}/`)
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                document.getElementById("roomPopupTitle").textContent = data.room_name;
                document.getElementById("roomPopupImage").src = data.room_image;
                popup.style.display = "block"; // แสดงป็อปอัป
            } else {
                alert("ไม่พบห้องนี้");
            }
        });
}

function displaySystemMessage(message) {
    const chatBox = document.getElementById("chat-box");
    const systemMessage = document.createElement("p");
    systemMessage.classList.add("system-message");
    systemMessage.innerText = message;
    chatBox.appendChild(systemMessage);
}

function getCSRFToken() {
    let csrfToken = document.cookie
        .split('; ')
        .find(row => row.startsWith('csrftoken='))
        ?.split('=')[1];
    return csrfToken || "";
}

