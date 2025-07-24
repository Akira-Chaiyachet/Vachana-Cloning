window.socket = null; // ใช้ global เดียวเท่านั้น
window.RTCVoiceChannels = {}; // { channelId: RTCVoice instance }
window.activeVoiceChannelId = null; // ช่องที่ user join ล่าสุด
window.isJoiningVoice = false;
let preventMenuToggle = true;
let heartbeatInterval = null; // สำหรับเก็บ interval ของ heartbeat

// --- VVV เพิ่มตัวแปรสำหรับระบบ Role & Permissions VVV ---
let currentLoggedInUserId = null;
let currentLoggedInUserRole = "member"; // ค่าเริ่มต้น
let allMembersData = []; // เก็บข้อมูลสมาชิกทั้งหมดในห้องปัจจุบัน
// --- ^^^ สิ้นสุดการเพิ่มตัวแปร ^^^ ---
function connectWebSocket(roomId) {
  // 1. ถ้ามี socket เก่าอยู่ ให้ปิดการเชื่อมต่อและล้าง event handlers
  // เพื่อป้องกันการเชื่อมต่อซ้ำซ้อน หรือการที่ onclose ของเก่าทำงาน
  if (window.socket && window.socket.readyState === WebSocket.OPEN) {
    console.log("WS already connected, skip.");
    return;
  }
  if (socket) {
    console.log("🔌 ปิดการเชื่อมต่อ WebSocket เก่า...");
    socket.onclose = null; // ป้องกันไม่ให้ onclose ของเก่าพยายาม reconnect
    socket.close();
  }

  // --- VVV เพิ่มการหยุด Heartbeat เก่า (ถ้ามี) VVV ---
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
    console.log("🛑 Heartbeat เก่าถูกหยุดแล้ว");
  }
  // --- ^^^ สิ้นสุดการเพิ่ม ^^^ ---

  let wsProtocol = window.location.protocol === "https:" ? "wss://" : "ws://";
  let wsURL = `${wsProtocol}${window.location.host}/ws/room/${roomId}/`;
  console.log(`🔌 กำลังเชื่อมต่อ WebSocket ไปที่: ${wsURL}`);
  socket = new WebSocket(wsURL);

  socket.onopen = function () {
    console.log("✅ WebSocket เชื่อมต่อสำเร็จ!");
    // --- VVV เพิ่มการส่ง Heartbeat เพื่อบอกว่ายังออนไลน์ VVV ---
    heartbeatInterval = setInterval(() => {
      if (socket && socket.readyState === WebSocket.OPEN) {
        // console.log("💓 Sending heartbeat..."); // สามารถเปิดเพื่อ debug
        socket.send(JSON.stringify({ action: "heartbeat" }));
      }
    }, 30000); // ส่งทุก 30 วินาที
    console.log("💓 Heartbeat เริ่มทำงาน (ทุก 30 วินาที)");
    // --- ^^^ สิ้นสุดการเพิ่ม ^^^ ---
  };

  socket.onmessage = function (event) {
    let data = JSON.parse(event.data);

    // --- [NEW] จัดการ WebRTC signaling (action) ---
    // --- [ORIGINAL LOGIC] สำหรับ event อื่นๆ (type) ---
    if (data.type === "voice_member_update") {
      // ต้องมีฟังก์ชันนี้!
      updateVoiceMembersUI(data.members, data.room_id || null);
    }
    switch (data.type) {
      case "user_join":
        console.log(
          `👋 สมาชิกใหม่เข้าห้อง: ${data.user?.display_name || "Unknown"}`
        );
        loadRoomMembers();
        break;
      case "user_leave":
        console.log(
          `👋 สมาชิกออกจากห้อง: ${data.user?.display_name || "Unknown"}`
        );
        loadRoomMembers();
        break;
      case "refresh_members":
      case "update_members":
        console.log("🔄 รีเฟรชรายชื่อสมาชิกจาก API...");
        loadRoomMembers();
        break;
      case "profile_updated":
        console.log(`👤 โปรไฟล์อัปเดตสำหรับ user ID: ${data.user_id}`);
        updateUserInList(
          data.user_id,
          data.display_name,
          data.profile_image_url
        );
        break;
      case "user_status":
        // --- VVV อัปเดตสถานะผู้ใช้แบบ realtime (online/dnd/invisible) VVV ---
        console.log(
          `📶 สถานะผู้ใช้เปลี่ยนสำหรับ user ID: ${data.user_id}, สถานะ: ${data.status}`
        );
        updateUserStatusRealtime(data.user_id, data.status);
        break;
      case "role_update":
        console.log(
          `👑 Role updated for user ID: ${data.user_id} to ${data.new_role}`
        );
        updateUserRoleInList(data.user_id, data.new_role);
        break;
      case "chat_message":
        // เพิ่มโค้ดนี้เพื่อแสดงข้อความใหม่ในช่องแชท
        const chatMessages = document.getElementById("chatMessages");
        if (chatMessages && typeof renderMessage === "function") {
          const el = renderMessage(data.message);
          chatMessages.appendChild(el);
          chatMessages.scrollTop = chatMessages.scrollHeight;
        }
        break;
      // --- เพิ่ม case อื่นๆ ที่ระบบห้องใช้งาน ได้ที่นี่ ---
    }
    // --- ^^^ สิ้นสุดการจัดการ event ^^^ ---
  };

  socket.onclose = function (event) {
    console.warn("❌ WebSocket ถูกตัดการเชื่อมต่อ (Code: " + event.code + ")");
    // --- VVV เพิ่มการหยุด Heartbeat เมื่อปิดการเชื่อมต่อ VVV ---
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
      heartbeatInterval = null;
      console.log("🛑 Heartbeat หยุดทำงานเนื่องจาก WebSocket ปิด");
    }
    const joinBtn = document.getElementById("joinVoiceBtn");
    if (joinBtn) joinBtn.disabled = false; // เปิดให้ joinVoice ได้
    // --- ^^^ สิ้นสุดการเพิ่ม ^^^ ---
    // การ reconnect อัตโนมัติอาจทำให้เกิดการเชื่อมต่อซ้อนกันเมื่อผู้ใช้เปลี่ยนห้อง
    // การเชื่อมต่อควรถูกจัดการโดย loadRoom() เท่านั้นเพื่อความแน่นอน
    // setTimeout(() => connectWebSocket(roomId), 3000); // เอาออกชั่วคราวเพื่อแก้ปัญหาข้อความซ้ำ
  };

  socket.onerror = function (error) {
    console.error("⚠️ เกิดข้อผิดพลาดกับ WebSocket:", error);
  };
}

function connectLobbySocket() {
  console.log("🔌 Attempting to connect to the Lobby WebSocket...");

  const lobbyProtocol =
    window.location.protocol === "https:" ? "wss://" : "ws://";
  const lobbyUrl = `${lobbyProtocol}${window.location.host}/ws/lobby/`;
  const lobbySocket = new WebSocket(lobbyUrl);

  lobbySocket.onopen = function () {
    console.log("✅ Lobby WebSocket connection established.");
  };

  lobbySocket.onmessage = function (event) {
    const data = JSON.parse(event.data);
    console.log("🛎️ Received a notification from Lobby:", data);

    // ตรวจสอบชนิดของข้อความที่ได้รับ
    if (data.type === "room_updated" && data.room) {
      const room = data.room;
      console.log(
        `🔄 Updating room in sidebar: ID=${room.id}, Name=${room.name}`
      );

      // ค้นหารายการห้องใน Sidebar ด้วย ID
      const roomListItem = document.querySelector(
        `#roomList li[onclick*="loadRoom('${room.id}'"]`
      );

      if (roomListItem) {
        // อัปเดตชื่อ
        const roomNameSpan = roomListItem.querySelector("span");
        if (roomNameSpan) {
          roomNameSpan.textContent = room.name;
        }

        // อัปเดตรูปภาพ
        const roomImageElem = roomListItem.querySelector("img");
        if (roomImageElem) {
          roomImageElem.src = room.image_url;
        }

        // อัปเดต onclick attribute เพื่อให้ชื่อใหม่ถูกส่งไปเมื่อคลิก
        // นี่เป็นวิธีที่ง่ายที่สุดโดยไม่ต้องสร้าง element ใหม่ทั้งหมด
        const oldOnclick = roomListItem.getAttribute("onclick");
        const oldInviteCode = oldOnclick
          .split(",")[2]
          .replace(/['")]/g, "")
          .trim();
        roomListItem.setAttribute(
          "onclick",
          `loadRoom('${room.id}', '${room.name}', '${oldInviteCode}')`
        );
      } else {
        console.warn(
          `Could not find room with ID ${room.id} in the sidebar to update.`
        );
      }
    }
  };

  lobbySocket.onclose = function (event) {
    console.warn(
      "❌ Lobby WebSocket connection closed. Reconnecting in 5 seconds..."
    );
    setTimeout(connectLobbySocket, 5000); // พยายามเชื่อมต่อใหม่
  };

  lobbySocket.onerror = function (error) {
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
    .then((response) => {
      if (!response.ok) {
        throw new Error(`HTTP Error! Status: ${response.status}`);
      }
      return response.json();
    })
    .then((data) => {
      console.log("📡 อัปเดตรายชื่อสมาชิกจาก API:", data);

      let userList = document.getElementById("userList");
      if (!userList) {
        console.error("❌ ไม่พบ <ul id='userList'> ใน HTML");
        return;
      }

      // --- VVV จัดการข้อมูล Role & Permissions VVV ---
      allMembersData = data.members; // เก็บข้อมูลสมาชิกทั้งหมดไว้ในตัวแปร global

      // ค้นหา Role ของผู้ใช้ที่ล็อกอินอยู่
      const currentUserMember = allMembersData.find(
        (m) => m.id == currentLoggedInUserId
      );
      if (currentUserMember) {
        currentLoggedInUserRole = currentUserMember.role;
        console.log(`🔑 Your role in this room is: ${currentLoggedInUserRole}`);
      }
      // --- ^^^ สิ้นสุดการจัดการข้อมูล Role ^^^ ---

      userList.innerHTML = ""; // ล้างรายการเก่า
      if (Array.isArray(data.members) && data.members.length > 0) {
        data.members.forEach((member) => {
          // VVV เพิ่มโค้ดสำหรับ Debug VVV
          console.log(
            `[DEBUG] Processing member: ${member.username}, Role: '${member.role}'`
          );
          // ^^^ สิ้นสุดโค้ดสำหรับ Debug ^^^
          let li = document.createElement("li");
          li.dataset.userId = member.id; // เพิ่ม data-user-id ที่นี่

          // เพิ่ม class ตามสถานะจริง (online/dnd/invisible)
          if (member.status === "online") {
            li.classList.add("online-user");
          } else if (member.status === "dnd") {
            li.classList.add("dnd-user");
          } else if (member.status === "invisible") {
            li.classList.add("invisible-user");
          } else {
            li.classList.add("offline-user");
          }

          // เพิ่ม data-attribute สำหรับ Role เพื่อใช้ใน context menu
          li.dataset.role = member.role;

          // VVV ใช้ name_to_display จาก API VVV
          // ถ้าไม่มี name_to_display ให้ใช้ username หรือ "ไม่ทราบชื่อ" เป็น fallback
          const displayName =
            member.name_to_display || member.username || "ผู้ใช้ไม่ทราบชื่อ";
          // ^^^ สิ้นสุดการเปลี่ยนแปลง ^^^
          const roleClass = member.role
            ? `role-${member.role.toLowerCase()}`
            : ""; // <--- 🐞 BUG FIX 1: แปลงเป็นตัวพิมพ์เล็กเสมอ
          li.innerHTML = `
                        <img src="${
                          member.profile_image || "/media/default/profile.jpg"
                        }" 
                            onerror="this.src='/media/default/profile.jpg'" 
                            class="profile-img">
                        <span class="user-display-name">${escapeHTML(
                          displayName
                        )}</span><span class="crown-icon ${roleClass}"></span>
                    `; // <--- 🐞 BUG FIX 2: แก้ไขโครงสร้าง HTML ให้ถูกต้อง

          // เพิ่ม Event Listener สำหรับเมนู (ทั้งคลิกซ้ายและขวา)
          li.addEventListener("contextmenu", handleUserContextMenu);
          li.addEventListener("click", handleUserContextMenu);
          userList.appendChild(li);
        });
      } else {
        console.warn("⚠️ ไม่มีสมาชิกในห้องนี้ หรือข้อมูลสมาชิกไม่ถูกต้อง");
        userList.innerHTML = "<li>ไม่มีสมาชิกในห้องนี้</li>";
      }
    })
    .catch((error) => {
      console.error("❌ เกิดข้อผิดพลาดในการโหลดสมาชิก:", error);
      let userList = document.getElementById("userList");
      if (userList) {
        // แสดง error ใน list ถ้าเป็นไปได้
        userList.innerHTML = "<li>เกิดข้อผิดพลาดในการโหลดรายชื่อสมาชิก</li>";
      }
    });
}

// --- VVV เพิ่มฟังก์ชันสำหรับอัปเดต UI เมื่อโปรไฟล์ผู้ใช้เปลี่ยน VVV ---
function updateUserInList(userId, newDisplayName, newProfileImageUrl) {
  // ค้นหา li ของผู้ใช้ใน #userList จาก data-user-id ที่เราเคยเพิ่มไว้
  const userListItem = document.querySelector(
    `#userList li[data-user-id="${userId}"]`
  );

  if (userListItem) {
    const userNameSpan = userListItem.querySelector(".user-display-name"); // ใช้ class ใหม่
    const userImageImg = userListItem.querySelector("img.profile-img");

    if (userNameSpan) {
      userNameSpan.textContent = escapeHTML(newDisplayName);
    }
    if (userImageImg && newProfileImageUrl) {
      // เพิ่ม timestamp ต่อท้าย URL เพื่อป้องกันไม่ให้ browser ใช้รูปเก่าจาก cache
      userImageImg.src = newProfileImageUrl + "?t=" + new Date().getTime();
    }
    console.log(`✅ อัปเดต UI ในรายชื่อสมาชิกสำหรับ user ID: ${userId} สำเร็จ`);
  } else {
    console.warn(`⚠️ ไม่พบ user ID: ${userId} ในรายชื่อสมาชิกเพื่ออัปเดต UI`);
  }

  // หมายเหตุ: หากต้องการอัปเดต UI ของผู้ใช้ปัจจุบันที่มุมขวาล่างด้วย
  // จะต้องมีวิธีในการเข้าถึง ID ของผู้ใช้ปัจจุบันใน JavaScript
  // และเพิ่มโค้ดเพื่ออัปเดต element .current-user-name-text และ .current-user-avatar-img ที่นี่
}

function escapeHTML(str) {
  if (typeof str !== "string") return "";
  // ใช้ object map เพื่อความปลอดภัยและอ่านง่าย
  return str.replace(
    /[&<>"']/g,
    (match) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      }[match])
  );
}
// --- ^^^ สิ้นสุดฟังก์ชันใหม่ ^^^ ---

// --- VVV ฟังก์ชันใหม่: อัปเดตสถานะผู้ใช้แบบ realtime (online/dnd/invisible) ---
function updateUserStatusRealtime(userId, status) {
  const userListItem = document.querySelector(
    `#userList li[data-user-id="${userId}"]`
  );
  if (userListItem) {
    // ลบ class สถานะเดิมทั้งหมดก่อน
    userListItem.classList.remove(
      "online-user",
      "offline-user",
      "dnd-user",
      "invisible-user"
    );
    // เพิ่ม class ตามสถานะใหม่
    switch (status) {
      case "online":
        userListItem.classList.add("online-user");
        break;
      case "dnd":
        userListItem.classList.add("dnd-user");
        break;
      case "invisible":
        userListItem.classList.add("invisible-user");
        break;
      default:
        userListItem.classList.add("offline-user");
    }
    // (Optional) ย้ายตำแหน่งในลิสต์ตามสถานะ
    if (status === "online") {
      userListItem.parentElement.prepend(userListItem);
    } else if (status === "dnd") {
      // DND อยู่ถัดจากออนไลน์
      const onlineUser =
        userListItem.parentElement.querySelector(".online-user");
      if (onlineUser && onlineUser !== userListItem) {
        onlineUser.after(userListItem);
      } else {
        userListItem.parentElement.prepend(userListItem);
      }
    } else if (status === "invisible") {
      userListItem.parentElement.appendChild(userListItem);
    } else {
      userListItem.parentElement.appendChild(userListItem);
    }
    // (Optional) อัปเดตไอคอน/ข้อความแสดงสถานะใน UI เพิ่มเติมที่นี่
    console.log(`✅ User ID: ${userId} สถานะใหม่: ${status}`);
  } else {
    // ถ้าไม่พบผู้ใช้ในลิสต์ (อาจจะเพิ่งเข้าห้องมา) ให้โหลดรายชื่อใหม่ทั้งหมด
    console.warn(
      `⚠️ ไม่พบ user ID: ${userId} ในรายชื่อ, กำลังโหลดรายชื่อใหม่ทั้งหมด...`
    );
    loadRoomMembers();
  }
}
// --- ^^^ END ฟังก์ชันใหม่ ^^^ ---

// --- VVV เพิ่มฟังก์ชันทั้งหมดสำหรับระบบ Role & Context Menu VVV ---

/**
 * อัปเดต UI (มงกุฎ) และข้อมูล Role ของผู้ใช้ในลิสต์เมื่อมีการเปลี่ยนแปลง
 * @param {number} userId - ID ของผู้ใช้ที่ถูกเปลี่ยน Role
 * @param {string} newRole - Role ใหม่ (เช่น 'admin', 'family', 'member')
 */
function updateUserRoleInList(userId, newRole) {
  const userListItem = document.querySelector(
    `#userList li[data-user-id="${userId}"]`
  ); // เลือก li element
  if (userListItem) {
    // ค้นหาไอคอนมงกุฎและอัปเดต class role ของมัน
    const crownIcon = userListItem.querySelector(".crown-icon");
    if (crownIcon) {
      crownIcon.className = "crown-icon"; // รีเซ็ต class
      crownIcon.classList.add(`role-${newRole.toLowerCase()}`); // <--- 🐞 BUG FIX 3: แปลงเป็นตัวพิมพ์เล็กเสมอ
    }
    userListItem.dataset.role = newRole;
    console.log(`✅ UI updated for user ${userId} to role ${newRole}`);
  }

  // อัปเดตข้อมูลใน global state ของเราด้วย
  const memberToUpdate = allMembersData.find((m) => m.id == userId);
  if (memberToUpdate) {
    memberToUpdate.role = newRole;
  }

  // ถ้าผู้ใช้ที่ถูกเปลี่ยน Role คือตัวเราเอง ให้อัปเดต role ของเราด้วย
  if (userId == currentLoggedInUserId) {
    currentLoggedInUserRole = newRole;
    console.log(`👑 Your role has been updated to: ${newRole}`);
  }
}

/**
 * จัดการ Event เมื่อผู้ใช้คลิกขวาที่สมาชิก
 * @param {MouseEvent} event - The contextmenu event object.
 */
function handleUserContextMenu(event) {
  // สำหรับคลิกขวา (contextmenu) เราต้องป้องกันไม่ให้เมนูของเบราว์เซอร์แสดงขึ้นมา
  if (event.type === "contextmenu") {
    event.preventDefault();
  }
  // หยุดการแพร่กระจายของ event ไม่ให้ลอยขึ้นไปหา element แม่ (สำคัญมากในการแก้บั๊ก)
  event.stopPropagation();

  // ปิดเมนูอื่นๆ ที่อาจจะเปิดอยู่ก่อน
  hideAllPopups();

  const targetLi = event.currentTarget;
  const targetUserId = targetLi.dataset.userId; // ID ของผู้ใช้ที่ถูกคลิก

  // ถ้าคลิกที่โปรไฟล์ของตัวเองในรายชื่อ ให้เปิดเมนูหลักของตัวเอง (ที่มุมขวาล่าง)
  if (targetUserId == currentLoggedInUserId) {
    toggleCurrentUserMenu(); // ฟังก์ชันนี้อยู่ใน popup_03.4.js
    return; // จบการทำงาน
  }

  // ถ้าคลิกที่คนอื่น ให้สร้างเมนูสำหรับคนนั้น
  const targetUserRole = targetLi.dataset.role;
  const targetUserName =
    targetLi.querySelector(".user-display-name").textContent;
  buildAndShowUserContextMenu(
    event,
    targetUserId,
    targetUserRole,
    targetUserName
  );
}

/**
 * สร้างและแสดงเมนูคลิกขวาตามสิทธิ์ของผู้ใช้
 */
function buildAndShowUserContextMenu(
  event,
  targetUserId,
  targetUserRole,
  targetUserName
) {
  const contextMenu = document.getElementById("userContextMenu");
  const menuUl = contextMenu.querySelector("ul");
  menuUl.innerHTML = ""; // ล้างเมนูเก่า

  // --- สร้างรายการเมนูตามสิทธิ์ ---
  const isSelf = targetUserId == currentLoggedInUserId;
  const isTargetOwner = targetUserRole === "owner";
  const canManage = ["owner", "admin"].includes(currentLoggedInUserRole); // ผู้ใช้ปัจจุบันมีสิทธิ์จัดการหรือไม่

  // Header
  menuUl.innerHTML += `<li class="menu-header">${escapeHTML(
    targetUserName
  )}</li>`;

  // ดูโปรไฟล์ (ทุกคนทำได้)
  menuUl.innerHTML += `<li onclick="alert('ดูโปรไฟล์ของ ${escapeHTML(
    targetUserName
  )} (ยังไม่ implement)'); hideAllPopups();">ดูโปรไฟล์</li>`;

  // ตรวจสอบสิทธิ์ในการจัดการ (ต้องมีสิทธิ์จัดการ, ไม่ใช่ตัวเอง, และไม่ใช่เจ้าของห้อง)
  if (canManage && !isSelf && !isTargetOwner) {
    menuUl.innerHTML += `<li class="separator"></li>`;

    // มอบมง
    menuUl.innerHTML += `<li onclick="displayAssignRoleModal('${targetUserId}', '${escapeHTML(
      targetUserName
    )}', '${targetUserRole}')">มอบมง 👑</li>`;

    // เตะผู้ใช้
    const canKick =
      currentLoggedInUserRole === "owner" ||
      (currentLoggedInUserRole === "admin" && targetUserRole !== "admin");
    if (canKick) {
      menuUl.innerHTML += `<li class="danger-zone" onclick="alert('เตะ ${escapeHTML(
        targetUserName
      )} (ยังไม่ implement)'); hideAllPopups();">เตะผู้ใช้</li>`;
    }
  }

  // --- แสดงและจัดตำแหน่งเมนู ---
  contextMenu.style.display = "block";
  const { clientX: mouseX, clientY: mouseY } = event;
  const { innerWidth, innerHeight } = window;
  const menuRect = contextMenu.getBoundingClientRect();

  contextMenu.style.top = `${
    mouseY + menuRect.height > innerHeight
      ? innerHeight - menuRect.height - 5
      : mouseY
  }px`;
  contextMenu.style.left = `${
    mouseX + menuRect.width > innerWidth
      ? innerWidth - menuRect.width - 5
      : mouseX
  }px`;

  // เพิ่ม event listener เพื่อปิดเมนูเมื่อคลิกที่อื่น
  setTimeout(() => {
    // ใช้ setTimeout เพื่อให้ event click ปัจจุบันไม่ถูกดักจับ
    document.addEventListener("click", hideAllPopups, { once: true });
    document.addEventListener("contextmenu", hideAllPopups, { once: true }); // ปิดเมื่อคลิกขวาที่อื่นด้วย
  }, 0);
}

/**
 * แสดง Popup (Generic Modal) สำหรับเลือก Role
 */
function displayAssignRoleModal(targetUserId, targetUserName, currentRole) {
  hideAllPopups(); // ปิด context menu ก่อน
  let rolesHtml = "";
  const availableRoles = [
    { name: "แอดมิน", value: "admin" },
    { name: "สมาชิกครอบครัว", value: "family" },
    { name: "สมาชิก", value: "member" },
  ];

  availableRoles.forEach((role) => {
    // Admin ไม่สามารถมอบสิทธิ์ Admin ให้คนอื่นได้
    if (currentLoggedInUserRole === "admin" && role.value === "admin") {
      return; // ข้ามตัวเลือกนี้ไป
    }
    const isChecked = currentRole === role.value ? "checked" : "";
    // เพิ่ม CSS เล็กน้อยเพื่อให้สวยงาม
    rolesHtml += `
            <div style="margin-bottom: 10px;">
                <input type="radio" id="role-option-${
                  role.value
                }" name="new_role" value="${
      role.value
    }" ${isChecked} style="margin-right: 8px;">
                <label for="role-option-${role.value}">${escapeHTML(
      role.name
    )}</label>
            </div>
        `;
  });

  const body = `
        <p>เลือกสถานะใหม่สำหรับ <strong>${targetUserName}</strong>:</p>
        <div style="margin-top: 15px;">${rolesHtml}</div>
    `;

  openGenericModal({
    title: "มอบสถานะ (มง)",
    bodyHTML: body,
    footerHTML: `
            <button class="modal-button-default" onclick="closeGenericModal()">ยกเลิก</button>
            <button class="modal-button-primary" onclick="confirmAssignRole(${targetUserId})">ยืนยัน</button>
        `,
  });
}

/**
 * ยืนยันการเปลี่ยน Role และส่ง Request ไปยัง API
 */
function confirmAssignRole(targetUserId) {
  const selectedRole = document.querySelector('input[name="new_role"]:checked');
  if (!selectedRole) {
    alert("กรุณาเลือกสถานะที่ต้องการมอบ");
    return;
  }
  const newRoleName = selectedRole.value;
  const roomId = localStorage.getItem("currentRoomId");
  if (!roomId) {
    alert("ไม่พบห้องปัจจุบัน");
    return;
  }

  const formData = new FormData();
  formData.append("user_id", targetUserId);
  formData.append("role_name", newRoleName);

  fetch(`/api/room/${roomId}/assign-role/`, {
    method: "POST",
    body: formData,
    headers: { "X-CSRFToken": getCSRFToken() },
  })
    .then((response) => response.json())
    .then((data) => {
      if (!data.success) {
        alert(`เกิดข้อผิดพลาด: ${data.error}`);
      }
      // ไม่ต้องทำอะไรกับ UI เพราะ WebSocket จะจัดการให้เอง
      closeGenericModal();
    })
    .catch((error) => {
      console.error("Error assigning role:", error);
      alert("เกิดข้อผิดพลาดในการเชื่อมต่อเพื่อเปลี่ยนสถานะ");
      closeGenericModal();
    });
}

/**
 * ฟังก์ชันสำหรับซ่อน Popup ทั้งหมด
 */
function hideAllPopups() {
  document.querySelectorAll(".popup-menu").forEach((menu) => {
    menu.style.display = "none";
  });
}

// --- ^^^ สิ้นสุดฟังก์ชันสำหรับระบบ Role & Context Menu ^^^ ---

function disconnectRoom() {
  preventMenuToggle = true;

  // >>> หยุดการเชื่อมต่อ Voice Chat <<<
  if (window.stopVoiceChat) {
    console.log("🎤 Stopping voice chat before disconnecting room...");
    window.stopVoiceChat();
  }
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

// --- VVV เพิ่มระบบสถานะผู้ใช้ (ออนไลน์/ไม่รับแจ้งเตือน/ล่องหน) ---

// โหลดสถานะล่าสุดของผู้ใช้เมื่อเข้าเว็บ
document.addEventListener("DOMContentLoaded", () => {
  currentLoggedInUserId = document.body.dataset.currentUserId;
  fetch("/users/api/profile/me/")
    .then((res) => res.json())
    .then((data) => {
      if (data && data.user && data.user.status) {
        setUserStatusUI(data.user.status);
        // --- ไม่ว่า status อะไร ถ้ามีห้อง ให้ connectWebSocket เสมอ ---
        let roomId = localStorage.getItem("currentRoomId");
        if (roomId) {
          connectWebSocket(roomId);
        }
      }
    });
});

function setUserStatusUI(status) {
  const statusText = {
    online: "[ออนไลน์]",
    dnd: "[ไม่รับแจ้งเตือน]",
    invisible: "[ล่องหน]",
  };
  const statusColor = {
    online: "#43b581",
    dnd: "#faa61a",
    invisible: "#747f8d",
  };
  const textEl = document.getElementById("userMenuStatusText");
  if (textEl) {
    textEl.textContent = statusText[status] || "[ออนไลน์]";
    textEl.style.color = statusColor[status] || "#43b581";
  }
}
// --- ^^^ END ระบบสถานะผู้ใช้ ---

function setUserStatus(status) {
  const statusText = {
    online: "[ออนไลน์]",
    dnd: "[ไม่รับแจ้งเตือน]",
    invisible: "[ล่องหน]",
  };
  const statusColor = {
    online: "#43b581", // เขียว
    dnd: "#faa61a", // เหลือง
    invisible: "#747f8d", // เทา
  };
  // อัปเดตข้อความและสี
  const textEl = document.getElementById("userMenuStatusText");
  if (textEl) {
    textEl.textContent = statusText[status] || "[ออนไลน์]";
    textEl.style.color = statusColor[status] || "#43b581";
  }
  const popup = document.getElementById("userStatusPopup");
  if (popup) popup.style.display = "none";

  // ส่งสถานะไป backend (API)
  fetch("/users/api/set-status/", {
    method: "POST",
    headers: {
      "X-CSRFToken": getCSRFToken(),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "status=" + encodeURIComponent(status),
  })
    .then((res) => res.json())
    .then((data) => {
      if (!data.success) {
        alert("เปลี่ยนสถานะไม่สำเร็จ: " + (data.error || ""));
      }
    })
    .catch((err) => {
      alert("เกิดข้อผิดพลาดในการเปลี่ยนสถานะ");
    });

  // --- ปรับ logic: invisible = แค่ส่ง set_status, ไม่ต้องปิด socket ---
  if (
    typeof socket !== "undefined" &&
    socket &&
    socket.readyState === WebSocket.OPEN
  ) {
    socket.send(JSON.stringify({ action: "set_status", status: status }));
  }
  // ถ้าเปลี่ยนจาก invisible → online/dnd และ socket ไม่ได้เชื่อมต่อ ให้ connect ใหม่
  if (
    (status === "online" || status === "dnd") &&
    (!socket || socket.readyState !== WebSocket.OPEN)
  ) {
    let roomId = localStorage.getItem("currentRoomId");
    if (roomId) {
      connectWebSocket(roomId);
    }
  }
}
