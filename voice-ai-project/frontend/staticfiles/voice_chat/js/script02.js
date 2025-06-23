document.addEventListener("DOMContentLoaded", function () {
    loadRooms();

    // 👉 ดึง inviteCode จาก URL
    const pathParts = window.location.pathname.split("/");
    const inviteCode = pathParts[pathParts.length - 1] || null;

    // 👉 เช็คว่ามีห้องที่เคยอยู่ก่อนรีเฟรชไหม
    let roomId = localStorage.getItem("currentRoomId");
    let roomName = localStorage.getItem("currentRoomName");



    if (roomId && roomName) {
        loadRoom(roomId, roomName, inviteCode);
    }
    if (inviteCode) {  // ถ้ามีโค้ด ให้ดึงข้อมูลห้อง
        if (roomId && roomName && inviteCode === localStorage.getItem("currentInviteCode")) {
            console.log("ห้องถูกโหลดไปแล้ว:", roomName);
        } else {

            fetch(`/api/get-room/${inviteCode}/`)
                .then(response => {
                    if (!response.ok) {
                        throw new Error("ไม่พบห้อง");
                    }
                    return response.json();
                })
                .then(data => {
                    if (data.success) {
                        openPopup(inviteCode, data.room_name, data.room_image);
                    } else {
                        alert("ไม่พบห้องหรือโค้ดเชิญไม่ถูกต้อง");
                        window.location.href = "/";
                    }
                })
                .catch(error => {
                    console.error("เกิดข้อผิดพลาด:", error);
                    alert("เกิดข้อผิดพลาดในการโหลดห้อง");
                });
        }
    }
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
});


function openCreateRoomModal() {
    document.getElementById("createRoomModal").style.display = "block";
}

function closeCreateRoomModal() {
    document.getElementById("createRoomModal").style.display = "none";
}

function createRoom() {
    let formData = new FormData(document.getElementById("createRoomForm"));
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
                alert("ห้องถูกสร้างเรียบร้อยแล้ว!");
                closeCreateRoomModal();
                loadRooms();
            }
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
    document.getElementById("roomTitle").textContent = roomName;
    document.getElementById("leaveBtn").style.display = "inline-block";
    document.getElementById("settingsBtn").style.display = "inline-block";

    // 👉 บันทึกห้องล่าสุดลง LocalStorage
    localStorage.setItem("currentRoomId", roomId);
    localStorage.setItem("currentRoomName", roomName);
    localStorage.setItem("currentInviteCode", inviteCode);
    console.log(`🔄 กำลังโหลดห้อง: ${roomName} (${roomId})`);

    connectWebSocket(roomId); // ✅ เชื่อม WebSocket เพื่อฟัง event update_members

    // ✅ ตั้งค่า WebSocket ให้รับข้อมูลอัปเดตสมาชิก
    socket.onmessage = function (event) {
        const data = JSON.parse(event.data);

        if (data.type === "update_members") {
            updateUserList(data.members);
        }
    };

    // ✅ ดึงข้อมูลสมาชิกล่าสุดจากเซิร์ฟเวอร์เมื่อเข้าห้องครั้งแรก
    fetch(`/get-room-members/${roomId}/`)
        .then(response => response.json())
        .then(data => updateUserList(data.members))
        .catch(error => console.error("เกิดข้อผิดพลาด:", error));
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
        alert("ไม่พบข้อมูลห้อง");
        return;
    }

    if (!confirm("คุณแน่ใจหรือไม่ว่าต้องการออกจากห้องนี้?")) return;

    fetch(`/leave-room/${roomId}/`, {
        method: "POST",
        headers: { "X-CSRFToken": getCSRFToken() },
    })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                alert("ออกจากห้องเรียบร้อยแล้ว!");
                // ล้างข้อมูลห้องที่บันทึกไว้
                localStorage.removeItem("currentRoomId");
                localStorage.removeItem("currentRoomName");
                localStorage.removeItem("currentInviteCode");
                
                // ซ่อน UI ห้องแชท
                document.getElementById("roomTitle").textContent = "เลือกห้อง";
                document.getElementById("leaveBtn").style.display = "none";
                document.getElementById("settingsBtn").style.display = "none";
                document.getElementById("userList").innerHTML = "";
                
                // ซ่อนเมนูตั้งค่า
                document.getElementById("settingsMenu").style.display = "none";
                
                // โหลดห้องใหม่ (ห้องที่ออกจะไม่แสดง)
                loadRooms();
                if (roomSocket) {
                    roomSocket.send(JSON.stringify({
                        action: "user_leave",
                        username: localStorage.getItem("username") || "Unknown"
                    }));
                    roomSocket.close();  // ปิด WebSocket หลังจากออกจากห้อง
                }                
            } else {
                alert(data.message);
            }
        });
    }
function joinRoomPopup() {
    let popup = document.getElementById("roomPopup");

    if (!popup) {
        alert("ไม่พบป็อปอัป");
        return;
    }

    let inviteCode = popup.getAttribute("data-invite");

    if (!inviteCode) {
        alert("ไม่พบโค้ดเชิญ");
        return;
    }

    console.log("กำลังเข้าร่วมห้อง:", inviteCode);

    fetch(`/join-room/${inviteCode}/`, {
        method: "POST",
        headers: { "X-CSRFToken": getCSRFToken() },
    })
        .then(response => response.json())
        .then(data => {
            console.log("📢 API Response:", data);
            if (data.success) {
                alert(data.message);
                closePopup();
                loadRooms(); 
                connectWebSocket(data.roomId);
            } else {
                alert(data.error || data.message);
            }
        })
        .catch(error => console.error("เกิดข้อผิดพลาด:", error));
}


function toggleSettingsMenu() {
    let menu = document.getElementById("settingsMenu");
    menu.style.display = menu.style.display === "block" ? "none" : "block";
}

// function getCSRFToken() {
//     return document.querySelector("input[name=csrfmiddlewaretoken]").value;
// }


function searchRoom() {
    let input = document.getElementById("searchRoom").value.trim();
    if (!input) return alert("กรุณากรอกรหัสห้องหรือ URL");

    // ตรวจสอบว่าเป็นลิงก์คำเชิญหรือรหัสห้อง
    let match = input.match(/\/join-room\/([\w-]+)/);
    let inviteCode = match ? match[1] : input;


    fetch(`/api/search-room/${inviteCode}/`)
    .then(response => response.json())
    .then(data => {
            if (data.error) {
                alert("ไม่พบห้องนี้");
            } else {
                showPopup(data.room_name, data.room_image, inviteCode);
            }
        })
        .catch(error => console.error("เกิดข้อผิดพลาดในการค้นหาห้อง:", error));
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

