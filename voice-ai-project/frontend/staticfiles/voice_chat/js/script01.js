let socket = null;  // เก็บ WebSocket ไว้ใช้ทั่วไฟล์

function connectWebSocket(roomId) {
    if (socket && socket.readyState === WebSocket.OPEN) {
        console.warn("⚠️ WebSocket ยังทำงานอยู่ ไม่ต้องสร้างใหม่");
        return;
    }

    let wsProtocol = window.location.protocol === "https:" ? "wss://" : "ws://";
    let wsURL = `${wsProtocol}${window.location.host}/ws/room/${roomId}/`;
    socket = new WebSocket(wsURL);

    socket.onopen = function () {
        console.log("✅ WebSocket เชื่อมต่อสำเร็จ!");
    };

    socket.onmessage = function(event) {
        let data = JSON.parse(event.data);
        console.log("📩 ได้รับข้อมูลจาก WebSocket:", data);

        if (data.type === "update_members") {
            let membersList = data.members || [];

            if (data.new_user && !membersList.includes(data.new_user)) {
                membersList.push(data.new_user);
            }

            updateMemberList(membersList);
        }
    };

    socket.onclose = function(event) {
        console.warn("❌ WebSocket ถูกตัดการเชื่อมต่อ (Code: " + event.code + ")");
        setTimeout(() => connectWebSocket(roomId), 3000); // 🔄 ลองเชื่อมใหม่ทุก 3 วิ
    };

    socket.onerror = function (error) {
        console.error("⚠️ เกิดข้อผิดพลาดกับ WebSocket:", error);
    };
}


function updateUserList(members) {
    let userList = document.getElementById("userList");
    if (!userList) return;

    userList.innerHTML = ""; // ✅ ล้างรายชื่อเก่า
    members.forEach(member => {
        let li = document.createElement("li");
        li.innerHTML = `
            <img src="${member.profile_image}" onerror="this.src='/media/default/profile.jpg'" class="profile-img">
            <span>${member.username} (${member.role})</span>
        `;
        userList.appendChild(li);
    });
}