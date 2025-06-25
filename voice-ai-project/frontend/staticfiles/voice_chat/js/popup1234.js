// ฟังก์ชันสำหรับเปิด Generic Modal
function openGenericModal(options) {
  // options = {
  //     title: "หัวข้อ Popup",
  //     bodyHTML: "<p>เนื้อหา HTML ที่นี่</p> หรือ <form>...</form>", // หรือ bodyText: "ข้อความธรรมดา"
  //     footerHTML: '<button class="modal-button-primary" onclick="myConfirmAction()">ยืนยัน</button><button class="modal-button-default" onclick="closeGenericModal()">ยกเลิก</button>'
  // }

  const modal = document.getElementById("genericModal");
  const modalTitleElem = document.getElementById("genericModalTitle");
  const modalBodyElem = document.getElementById("genericModalBody");
  const modalFooterElem = document.getElementById("genericModalFooter");

  if (!modal || !modalTitleElem || !modalBodyElem || !modalFooterElem) {
    console.error("Generic modal elements not found!");
    return;
  }

  // กำหนดหัวข้อ
  modalTitleElem.textContent = options.title || "แจ้งเตือน";

  // กำหนดเนื้อหา Body
  if (options.bodyHTML) {
    modalBodyElem.innerHTML = options.bodyHTML;
  } else if (options.bodyText) {
    modalBodyElem.textContent = options.bodyText;
  } else {
    modalBodyElem.innerHTML = ""; // ไม่มีเนื้อหา
  }

  // กำหนดปุ่มใน Footer
  if (options.footerHTML) {
    modalFooterElem.innerHTML = options.footerHTML;
  } else {
    // ปุ่มปิดเริ่มต้นถ้าไม่ได้กำหนด footer มา
    modalFooterElem.innerHTML =
      '<button class="modal-button-default" onclick="closeGenericModal()">ปิด</button>';
  }

  modal.style.display = "flex"; // แสดง Modal (ใช้ flex เพื่อให้ CSS จัดกึ่งกลางทำงาน)
}

// ฟังก์ชันสำหรับปิด Generic Modal
function closeGenericModal() {
  const modal = document.getElementById("genericModal");
  if (modal) {
    modal.style.display = "none";
  }
}

// (เป็นทางเลือก) ทำให้ปิด Modal ได้เมื่อคลิกที่พื้นหลังมัวๆ (ด้านนอกกล่อง Modal)
// หรือกดปุ่ม Esc
// window.addEventListener("click", function (event) {
//   const modal = document.getElementById("genericModal");
//   if (modal && event.target == modal) {
//     // ตรวจสอบว่าคลิกที่ตัว overlay เอง (modal)
//     closeGenericModal();
//   }
// });

document.addEventListener("keydown", function (event) {
  const modal = document.getElementById("genericModal");
  if (modal && modal.style.display === "flex" && event.key === "Escape") {
    closeGenericModal();
  }
});

function displayCreateRoomPopup() {
  const formTemplate = document.getElementById("templateCreateRoomForm");
  if (!formTemplate) {
    console.error("ไม่พบ Template: templateCreateRoomForm");
    alert("เกิดข้อผิดพลาด: ไม่พบ UI สำหรับสร้างห้อง");
    return;
  }
  const formHtml = formTemplate.innerHTML; // ดึง HTML ของฟอร์มจาก template

  openGenericModal({
    // เรียกใช้ Popup กลางของเรา
    title: "สร้างห้องใหม่", // หัวข้อ Popup
    bodyHTML: formHtml, // เนื้อหา (ฟอร์ม) ที่จะแสดง
    footerHTML: `
            <button class="modal-button-default" onclick="closeGenericModal()">ยกเลิก</button>
            <button class="modal-button-primary" onclick="submitCreateRoomFormFromModal()">สร้าง</button>
        `, // ปุ่มในส่วนท้ายของ Popup
  });
}

function submitCreateRoomFormFromModal() {
  const form = document.getElementById("genericModalCreateRoomForm");
  if (!form) {
    console.error("ไม่พบฟอร์ม genericModalCreateRoomForm ใน Popup!");
    alert("เกิดข้อผิดพลาด: ไม่พบข้อมูลฟอร์มสำหรับสร้างห้อง");
    return;
  }

  let formData = new FormData(form);

  fetch("/create-room/", {
    // URL ของคุณสำหรับสร้างห้อง
    method: "POST",
    body: formData,
    headers: { "X-CSRFToken": getCSRFToken() }, // ฟังก์ชัน getCSRFToken() ของคุณต้องทำงานได้
  })
    .then((response) => {
      if (!response.ok) {
        return response
          .json()
          .then((errData) => {
            throw new Error(
              errData.error || `เกิดข้อผิดพลาด HTTP ${response.status}`
            );
          })
          .catch(() => {
            throw new Error(`เกิดข้อผิดพลาด HTTP ${response.status}`);
          });
      }
      return response.json();
    })
    .then((data) => {
      if (data.error) {
        alert("ผิดพลาด: " + data.error);
      } else {
        alert("ห้องถูกสร้างเรียบร้อยแล้ว!");

        // --- VVV ส่วนที่เราเพิ่มการเรียก addRoomToSidebar VVV ---
        // ตรวจสอบว่า 'data' ที่ได้จาก server มีข้อมูลที่จำเป็นหรือไม่
        // API /create-room/ ของคุณควรจะตอบกลับมาพร้อม room_id, room_name, image_url, และ invite_code
        // if (typeof loadRooms === "function") {
        //     // คุณอาจจะยังต้องการเรียก loadRooms() เพื่อให้ข้อมูลทั้งหมดตรงกันกับ server
        //     // หรือถ้า addRoomToSidebar เพียงพอแล้ว อาจจะพิจารณาเอาออกได้ในอนาคต
        //     // การเรียก addRoomToSidebar ช่วยให้ UI อัปเดตทันที
        //     loadRooms(); // โหลดรายการห้องใหม่ (ถ้ามีฟังก์ชันนี้)
        // }
        if (data.room_id && data.room_name) {
          console.log("ข้อมูลที่ได้จากการสร้างห้อง:", data); // ลอง log ดูว่าได้อะไรมาบ้าง
          addRoomToSidebar(
            data.room_id,
            data.room_name,
            data.image_url, // API ควรส่งค่านี้มา
            data.invite_code || null, // API ควรส่งค่านี้มา, ถ้าไม่มีให้เป็น null
            // ฟังก์ชัน addRoomToSidebar ของคุณใช้ inviteCode
            true // isNew = true เพื่อให้แสดง (ห้องใหม่!)
          );
        } else {
          console.warn(
            "ข้อมูลที่ได้จากการสร้างห้องไม่ครบถ้วนสำหรับ addRoomToSidebar:",
            data
          );
        }
        // --- ^^^ สิ้นสุดส่วนที่เพิ่ม ^^^ ---

        closeGenericModal();
        if (typeof loadRooms === "function") {
          loadRooms();
        }
      }
    })
    .catch((error) => {
      console.error("เกิดข้อผิดพลาดขณะสร้างห้อง:", error);
      alert(error.message || "เกิดข้อผิดพลาดบางอย่าง กรุณาลองใหม่");
    });
}

// Store the currently open menu's ID and its trigger
let currentlyOpenMenu = {
  menuId: null,
  triggerElement: null,
};

// Generic function to toggle a popup menu
function togglePopupMenu(menuId, triggerElement) {
  if (preventMenuToggle) {
    return;
  }
  console.log(`togglePopupMenu called for: ${menuId}`);
  const menuToToggle = document.getElementById(menuId);
  if (!menuToToggle) {
    console.error(`Menu with ID '${menuId}' not found!`);
    return;
  }

  const isOpeningThisMenu = menuToToggle.style.display !== "block";

  // Close any other currently open menu
  if (currentlyOpenMenu.menuId && currentlyOpenMenu.menuId !== menuId) {
    const otherMenu = document.getElementById(currentlyOpenMenu.menuId);
    if (otherMenu) {
      otherMenu.style.display = "none";
      // Reset icon of the other trigger if applicable
      resetMenuIcon(currentlyOpenMenu.triggerElement);
    }
  }

  // Toggle the requested menu
  if (isOpeningThisMenu) {
    menuToToggle.style.display = "block";
    currentlyOpenMenu.menuId = menuId;
    currentlyOpenMenu.triggerElement = triggerElement;
    updateMenuIcon(triggerElement, true); // Update icon to "open" state
  } else {
    menuToToggle.style.display = "none";
    currentlyOpenMenu.menuId = null;
    currentlyOpenMenu.triggerElement = null;
    updateMenuIcon(triggerElement, false); // Update icon to "closed" state
  }
}

// Helper function to update menu trigger icon (▼/✕ or similar)
function updateMenuIcon(triggerElement, isOpen) {
  if (!triggerElement) return;
  // Find an icon element within the trigger
  const icon = triggerElement.querySelector(".menu-indicator-icon"); // หรือ ID เฉพาะเช่น #roomMenuIcon, #currentUserMenuIcon
  if (icon) {
    if (isOpen) {
      icon.innerHTML = "✕"; // หรือ icon.classList.add('open');
      // icon.classList.add('open'); // ถ้าใช้ CSS class 'open' เพื่อหมุน
    } else {
      icon.innerHTML = "▽"; // หรือ icon.classList.remove('open');
      // icon.classList.remove('open');
    }
  }
}

// Helper function to reset icon when a menu is closed by outside click
function resetMenuIcon(triggerElement) {
  updateMenuIcon(triggerElement, false);
}

// Add event listeners to all menu triggers
document.querySelectorAll("[data-menu-trigger-for]").forEach((trigger) => {
  trigger.addEventListener("click", function (event) {
    event.stopPropagation(); // Stop click from immediately going to document
    const menuIdToToggle = this.dataset.menuTriggerFor;
    togglePopupMenu(menuIdToToggle, this); // 'this' is the trigger element
  });
});

// Global click listener to close any open menu when clicking outside
document.addEventListener("click", function (event) {
  if (currentlyOpenMenu.menuId && currentlyOpenMenu.triggerElement) {
    const openMenu = document.getElementById(currentlyOpenMenu.menuId);
    // If the click is outside the open menu AND outside its trigger
    if (
      openMenu &&
      !openMenu.contains(event.target) &&
      !currentlyOpenMenu.triggerElement.contains(event.target)
    ) {
      console.log(
        `Closing menu ${currentlyOpenMenu.menuId} due to outside click.`
      );
      openMenu.style.display = "none";
      resetMenuIcon(currentlyOpenMenu.triggerElement); // Reset its icon
      currentlyOpenMenu.menuId = null;
      currentlyOpenMenu.triggerElement = null;
    }
  }
});

function confirmLeaveRoom() {
  openGenericModal({
    title: "ออกจากห้อง",
    bodyHTML: `
            <p style="color: #c2ffe6;">คุณกำลังจะออกจากห้องนี้ หากออกแล้วคุณอาจไม่สามารถกลับเข้ามาได้อีกหากไม่มีคำเชิญหรือรหัสห้อง</p>
            <p style="color: #dd6860;"><strong>คุณแน่ใจหรือไม่ว่าต้องการออกจากห้อง?</strong></p>
        `,
    footerHTML: `
            <button class="modal-button-default" onclick="closeGenericModal()">ยกเลิก</button>
            <button class="modal-button-primary" onclick="leaveRoom()">ยืนยันออกจากห้อง</button>
        `,
  });
}
function confirmlogout() {
  openGenericModal({
    title: "ออกจากระบบ",
    bodyHTML: `
            <p style="color: #c2ffe6;">หากคุณจำรหัสไม่ได้กรุณาเปลี่ยรหัสผ่านก่อน เนื่องจากเรายังไม่มีระบบลืมรหัสหรือผูกอีเมล</p>
            <p style="color: #dd6860;"><strong>คุณแน่ใจหรือไม่ว่าต้องการออกจากระบบ?</strong></p>
        `,
    footerHTML: `
            <button class="modal-button-default" onclick="closeGenericModal()">ยกเลิก</button>
            <button class="modal-button-primary" onclick="logout()">ออกจากระบบ</button>
        `,
  });
}

function showPopupModal(roomName, roomImage, inviteCode) {
  openGenericModal({
    title: "นี่ใช่ไหมห้องที่คุณตามหา?",
    bodyHTML: `
            <img id="modalRoomImage" src="${roomImage}" alt="รูปห้อง" style="width: 120px; height: 120px; object-fit: cover; border-radius: 50%; display: block; margin: 0 auto 12px;">
            <h3 id="modalRoomName" style="text-align: center; margin-bottom: 12px; color: #c2ffe6;">${escapeHTML(
              roomName
            )}</h3>
            <input type="hidden" id="inviteCode" value="${inviteCode}">
        `,
    footerHTML: `
            <button class="modal-button-default" onclick="closeGenericModal()">ยกเลิก</button>
            <button class="modal-button-primary" onclick="joinRoomPopup()">เข้าร่วม</button>
        `,
  });
}

async function displayEditProfileModal() {
  const userMenu = document.getElementById("currentUserMenu");
  if (userMenu && userMenu.style.display === "block") {
    userMenu.style.display = "none";
    const trigger = document.querySelector(
      '[data-menu-trigger-for="currentUserMenu"]'
    );
    if (trigger && typeof resetMenuIcon === "function") {
      resetMenuIcon(trigger);
    }
  }

  const formTemplate = document.getElementById("templateEditUserProfileForm");
  if (!formTemplate) {
    console.error("ไม่พบ Template: templateEditUserProfileForm");
    alert("เกิดข้อผิดพลาด: ไม่พบ UI สำหรับแก้ไขโปรไฟล์");
    return;
  }
  const formHtml = formTemplate.innerHTML;

  openGenericModal({
    title: "แก้ไขข้อมูลโปรไฟล์",
    bodyHTML: formHtml,
    footerHTML: `
            <button class="modal-button-default" onclick="closeGenericModal()">ยกเลิก</button>
            <button class="modal-button-primary" onclick="submitEditProfileForm()">บันทึกการเปลี่ยนแปลง</button>
        `,
  });

  // (ทางเลือก) ถ้าค่าจาก Django template tag ใน <template> ไม่ update หรือต้องการความสดใหม่
  // คุณสามารถ fetch ข้อมูลผู้ใช้ปัจจุบันที่นี่ แล้วนำไปใส่ใน input fields
  // โดยใช้ document.getElementById('modalEditProfileDisplayName').value = ...
  // และ document.getElementById('modalEditProfileCurrentImage').src = ...
  // หลังจากที่ openGenericModal ทำงานแล้ว (อาจจะใช้ setTimeout เล็กน้อย)
  // แต่ถ้า Django template tag ใน <template> ทำงานได้ดีแล้ว ส่วนนี้ก็ไม่จำเป็น
  try {
    const response = await fetch("/users/api/profile/me/"); // หรือ API ที่คุณใช้ดึงข้อมูลโปรไฟล์
    if (response.ok) {
      const userData = await response.json();
      if (userData && userData.user) {
        setTimeout(() => {
          // รอให้ modal render DOM
          const displayNameInput = document.getElementById(
            "modalEditProfileDisplayName"
          );
          const currentImageElem = document.getElementById(
            "modalEditProfileCurrentImage"
          );
          if (displayNameInput)
            displayNameInput.value =
              userData.user.display_name || userData.user.username || "";
          if (currentImageElem && userData.user.profile_image_url)
            currentImageElem.src = userData.user.profile_image_url;
        }, 0);
      }
    }
  } catch (error) {
    console.warn("ไม่สามารถโหลดข้อมูลโปรไฟล์ล่าสุดสำหรับฟอร์มแก้ไข: ", error);
    // ฟอร์มจะยังคงแสดงค่าจาก Django template tags ถ้ามี
  }
}

function submitEditProfileForm() {
  const form = document.getElementById("genericModalEditProfileForm");
  const errorMessagesDiv = document.getElementById(
    "modalEditProfileErrorMessages"
  ); // div สำหรับแสดง error

  if (!form) {
    console.error("ไม่พบฟอร์ม genericModalEditProfileForm ใน Popup!");
    alert("เกิดข้อผิดพลาด: ไม่พบข้อมูลฟอร์ม");
    return;
  }

  // เคลียร์ error เก่า (ถ้ามี)
  if (errorMessagesDiv) {
    errorMessagesDiv.innerHTML = "";
    errorMessagesDiv.style.display = "none";
  }

  let formData = new FormData(form);

  fetch("/users/api/update-profile/", {
    // API endpoint สำหรับอัปเดตโปรไฟล์
    method: "POST", // หรือ PUT/PATCH ตามการออกแบบ API ของคุณ
    body: formData,
    headers: { "X-CSRFToken": getCSRFToken() },
  })
    .then((response) => {
      if (!response.ok) {
        // พยายามอ่าน error message จาก JSON response ถ้ามี
        return response
          .json()
          .then((errData) => {
            // เก็บ error data ไว้เพื่อใช้แสดงผลหลาย errors ถ้าเป็น object
            const errorToThrow = new Error(
              errData.detail ||
                errData.error ||
                `เกิดข้อผิดพลาด HTTP ${response.status}`
            );
            errorToThrow.responsePayload = errData.error; // เก็บ raw error object
            throw errorToThrow;
          })
          .catch(() => {
            // ถ้า error response ไม่ใช่ JSON
            throw new Error(`เกิดข้อผิดพลาด HTTP ${response.status}`);
          });
      }
      return response.json();
    })
    .then((data) => {
      // ตรวจสอบ error จาก business logic ที่ Server อาจจะส่งมา (แม้ HTTP status จะเป็น 200 OK)
      if (data.error) {
        // alert("ผิดพลาด: " + JSON.stringify(data.error)); // แบบเดิมของคุณ
        if (errorMessagesDiv) {
          if (typeof data.error === "object" && data.error !== null) {
            let errorHtml = "<ul>";
            for (const field in data.error) {
              if (Array.isArray(data.error[field])) {
                // Django form errors มักจะเป็น list
                data.error[field].forEach((msg) => {
                  errorHtml += `<li><span class="math-inline">\{field \=\=\= '\_\_all\_\_' ? '' \: \(field \+ '\: '\)\}</span>{escapeHTML(msg)}</li>`;
                });
              } else {
                errorHtml += `<li><span class="math-inline">\{field \=\=\= '\_\_all\_\_' ? '' \: \(field \+ '\: '\)\}</span>{escapeHTML(data.error[field])}</li>`;
              }
            }
            errorHtml += "</ul>";
            errorMessagesDiv.innerHTML = errorHtml;
          } else {
            errorMessagesDiv.textContent = escapeHTML(data.error.toString());
          }
          errorMessagesDiv.style.display = "block";
        } else {
          alert(
            "ผิดพลาด: " +
              (typeof data.error === "string"
                ? data.error
                : JSON.stringify(data.error))
          );
        }
      } else {
        alert(data.message || "อัปเดตโปรไฟล์สำเร็จ!");
        closeGenericModal();

        // อัปเดต UI ที่แสดงชื่อและรูปโปรไฟล์ของผู้ใช้ปัจจุบันทันที
        if (data.user) {
          const updatedUser = data.user;
          const userNameTextElement = document.querySelector(
            ".current-user-name-text"
          );
          const userAvatarImgElement = document.querySelector(
            ".current-user-avatar-img"
          );

          if (userNameTextElement && updatedUser.display_name) {
            // ควรจะใช้ display_name ที่ server ส่งกลับมา
            userNameTextElement.textContent = escapeHTML(
              updatedUser.display_name
            );
          }
          if (userAvatarImgElement && updatedUser.profile_image_url) {
            userAvatarImgElement.src =
              updatedUser.profile_image_url + "?t=" + new Date().getTime(); // เพิ่ม timestamp กัน cache
          }
          // อาจจะต้องอัปเดตชื่อที่แสดงใน userList ของห้องปัจจุบันด้วย ถ้ามีการแสดงผลที่นั่น
        }
      }
    })
    .catch((error) => {
      console.error("เกิดข้อผิดพลาดขณะอัปเดตโปรไฟล์:", error);
      if (errorMessagesDiv) {
        // ถ้า error.responsePayload มีค่า (จากที่เราโยนมา) และเป็น object
        if (
          error.responsePayload &&
          typeof error.responsePayload === "object"
        ) {
          let errorHtml = "<ul>";
          for (const field in error.responsePayload) {
            if (Array.isArray(error.responsePayload[field])) {
              error.responsePayload[field].forEach((msg) => {
                errorHtml += `<li><span class="math-inline">\{field \=\=\= '\_\_all\_\_' ? '' \: \(field \+ '\: '\)\}</span>{escapeHTML(msg)}</li>`;
              });
            } else {
              errorHtml += `<li><span class="math-inline">\{field \=\=\= '\_\_all\_\_' ? '' \: \(field \+ '\: '\)\}</span>{escapeHTML(error.responsePayload[field])}</li>`;
            }
          }
          errorHtml += "</ul>";
          errorMessagesDiv.innerHTML = errorHtml;
        } else {
          errorMessagesDiv.textContent =
            escapeHTML(error.message) || "เกิดข้อผิดพลาดบางอย่าง กรุณาลองใหม่";
        }
        errorMessagesDiv.style.display = "block";
      } else {
        alert(error.message || "เกิดข้อผิดพลาดบางอย่าง กรุณาลองใหม่");
      }
    });
}

function displayChangeUsernamePasswordPopup() {
  // ไม่จำเป็นต้องปิด genericModal เก่า เพราะ openGenericModal จะเขียนทับเนื้อหา
  // แต่ถ้ามี state อื่นๆ ที่ต้อง reset จาก modal ก่อนหน้า อาจจะต้องทำที่นี่หรือใน closeGenericModal

  const formTemplate = document.getElementById(
    "templateChangeUsernamePasswordForm"
  );
  if (!formTemplate) {
    console.error("ไม่พบ Template: templateChangeUsernamePasswordForm");
    alert("เกิดข้อผิดพลาด: ไม่พบ UI สำหรับเปลี่ยน Username/Password");
    return;
  }
  const formHtml = formTemplate.innerHTML;

  openGenericModal({
    title: "เปลี่ยน Username หรือ Password",
    bodyHTML: formHtml,
    footerHTML: `
            <button class="modal-button-default" onclick="closeGenericModalAndReopenEditProfile()">ยกเลิก</button>
            <button class="modal-button-primary" onclick="submitChangeUsernamePassword()">บันทึก Username/Password</button>
        `,
  });

  // แสดง username ปัจจุบันใน placeholder (ถ้า HTML template ไม่ได้ทำ)
  setTimeout(() => {
    const usernameInput = document.getElementById("modalChangeUsername");
    if (
      usernameInput &&
      typeof currentUserData !== "undefined" &&
      currentUserData.username
    ) {
      // currentUserData ต้องมีข้อมูล
      usernameInput.placeholder = `Username ปัจจุบัน: ${currentUserData.username}`;
    } else if (usernameInput) {
      // พยายามดึงจาก request.user ถ้ามี (กรณีที่ template ไม่ได้ถูก render โดย Django context เต็มรูปแบบ)
      // หรืออาจจะต้อง fetch มาใหม่
      // usernameInput.placeholder = "Username ปัจจุบัน: {{ request.user.username }}"; // ถ้าใช้ Django render ใส่ template
    }
  }, 0);
}

// ฟังก์ชันเสริม ถ้ากดยกเลิกจาก Popup เปลี่ยน Username/Password แล้วอยากให้กลับไปเปิด Popup แก้ไขโปรไฟล์เดิม
function closeGenericModalAndReopenEditProfile() {
  closeGenericModal();
  // เรียก displayEditProfileModal() อีกครั้งถ้าต้องการให้มันเปิดขึ้นมาใหม่
  // หรืออาจจะไม่ต้องทำอะไรเลยก็ได้ แล้วแต่ UX ที่คุณต้องการ
  displayEditProfileModal(); // เปิด Popup แก้ไขโปรไฟล์ (display_name, image) กลับมา
}

// ตัวแปรสำหรับเก็บ FormData ชั่วคราวระหว่างรอการยืนยัน
let pendingCredentialsFormData = null;

// 1. ถูกเรียกเมื่อผู้ใช้กด "บันทึก Username/Password" ในฟอร์มเปลี่ยน Username/Password
function submitChangeUsernamePassword() {
    console.log("submitChangeUsernamePassword called");
    const form = document.getElementById("genericModalChangeUsernamePasswordForm");
    const errorMessagesDiv = document.getElementById("modalChangeUsernamePasswordErrorMessages");

    if (!form) {
        console.error("Form 'genericModalChangeUsernamePasswordForm' not found.");
        alert("เกิดข้อผิดพลาด: ไม่พบฟอร์มข้อมูล");
        return;
    }
    if (errorMessagesDiv) {
        errorMessagesDiv.innerHTML = "";
        errorMessagesDiv.style.display = "none";
    }

    const newUsername = form.new_username.value.trim();
    const currentPassword = form.current_password.value;
    const newPassword1 = form.new_password1.value;
    const newPassword2 = form.new_password2.value;

    let validationError = null;
    if (!currentPassword) {
        validationError = "กรุณาใส่ Password ปัจจุบันเพื่อยืนยัน";
    } else if (newPassword1 || newPassword2) { // ถ้ามีการพยายามเปลี่ยน password
        if (newPassword1 !== newPassword2) {
            validationError = "Password ใหม่และการยืนยัน Password ไม่ตรงกัน";
        } else if (newPassword1 && newPassword1.length < 8) { // ตรวจสอบความยาวถ้ามีการกรอก password ใหม่
            validationError = "Password ใหม่ต้องมีอย่างน้อย 8 ตัวอักษร";
        }
    } else if (!newUsername) { // ถ้าไม่ได้กรอก password ใหม่ และไม่ได้กรอก username ใหม่ด้วย
        validationError = "คุณไม่ได้ทำการเปลี่ยนแปลง Username หรือ Password";
    }
    // ถ้า newUsername มีค่า แต่ newPassword1 ไม่มีค่า ก็ถือว่าเป็นการพยายามเปลี่ยน username อย่างเดียว

    if (validationError) {
        if (errorMessagesDiv) {
            errorMessagesDiv.textContent = validationError;
            errorMessagesDiv.style.display = "block";
        } else {
            alert(validationError);
        }
        return;
    }

    // รวบรวม FormData
    pendingCredentialsFormData = new FormData();
    if (newUsername) {
        pendingCredentialsFormData.append('new_username', newUsername);
    }
    pendingCredentialsFormData.append('current_password', currentPassword); // ส่ง password ปัจจุบันเสมอ
    if (newPassword1) { // ส่ง password ใหม่ถ้ามีการกรอก
        pendingCredentialsFormData.append('new_password1', newPassword1);
        pendingCredentialsFormData.append('new_password2', newPassword2);
    }
    console.log("FormData prepared for confirmation:", pendingCredentialsFormData);

    // เปิด Popup ยืนยัน (Popup นี้จะใช้ genericModal)
    openGenericModal({
        title: "ยืนยันการเปลี่ยนแปลงข้อมูลสำคัญ",
        bodyHTML: `<p>คุณแน่ใจหรือไม่ว่าต้องการบันทึกการเปลี่ยนแปลง Username/Password นี้?</p>
                   <p style='font-size:0.8em; color: #ffc107;'>การเปลี่ยนแปลงนี้อาจทำให้คุณต้อง Login ใหม่อีกครั้ง</p>`,
        footerHTML: `
            <button class="modal-button-default" onclick="cancelCredentialChangeAndReopenForm()">ยกเลิก</button>
            <button class="modal-button-danger" onclick="processActualUsernamePasswordChange()">ยืนยันและบันทึก</button>
        `
    });
}

// 2. ถูกเรียกเมื่อผู้ใช้กด "ยกเลิก" ใน Popup ยืนยัน (จะกลับไปเปิดฟอร์มเปลี่ยน username/password)
function cancelCredentialChangeAndReopenForm() {
    console.log("User cancelled credential change confirmation.");
    closeGenericModal(); // ปิด Popup ยืนยัน
    pendingCredentialsFormData = null; // ล้างข้อมูลที่รออยู่
    displayChangeUsernamePasswordPopup(); // เปิดฟอร์มเปลี่ยน username/password ขึ้นมาใหม่
                                          // displayChangeUsernamePasswordPopup ควรจะดึงข้อมูลเริ่มต้นมาแสดงในฟอร์มอีกครั้ง
}

// 3. ถูกเรียกเมื่อผู้ใช้กด "ยืนยันและบันทึก" ใน Popup ยืนยัน
function processActualUsernamePasswordChange() {
    console.log("processActualUsernamePasswordChange CALLED");
    // ไม่จำเป็นต้อง closeGenericModal() ที่นี่ทันที เพราะถ้ามี error เราอาจจะอยากให้ Popup ยืนยันยังอยู่
    // หรือถ้าจะปิด ให้ปิดหลังจาก fetch สำเร็จหรือล้มเหลว

    if (!pendingCredentialsFormData) {
        console.error("No pending FormData to submit for credential change.");
        alert("เกิดข้อผิดพลาด: ไม่พบข้อมูลที่จะบันทึก กรุณาลองใหม่อีกครั้ง");
        closeGenericModal(); // ปิด Popup ยืนยัน (ถ้ายังเปิดอยู่)
        displayChangeUsernamePasswordPopup(); // กลับไปที่ฟอร์มหลัก
        return;
    }

    const formDataToSubmit = pendingCredentialsFormData;
    pendingCredentialsFormData = null; // เคลียร์หลังจากดึงค่ามาใช้แล้ว เพื่อไม่ให้ใช้ซ้ำ

    // เราจะแสดง error ในฟอร์มเปลี่ยน Username/Password เดิม ถ้ามีปัญหา
    // ดังนั้น เราต้องแน่ใจว่า ID ของ error message div ในฟอร์มนั้นยังคงถูกต้อง
    // const errorMessagesDivInOriginalForm = document.getElementById("modalChangeUsernamePasswordErrorMessages");

    fetch("/users/api/change-credentials/", { // ตรวจสอบ URL นี้ให้ถูกต้อง
        method: "POST",
        body: formDataToSubmit,
        headers: { "X-CSRFToken": getCSRFToken() },
    })
    .then(response => {
        const contentType = response.headers.get("content-type");
        if (contentType && contentType.includes("application/json")) {
            return response.json().then(data => ({ ok: response.ok, status: response.status, data }));
        }
        return response.text().then(text => { // ถ้าไม่ใช่ JSON ให้โยน error พร้อมข้อความดิบ
            throw new Error(`Server response was not JSON. Status: ${response.status}. Response: ${text.substring(0,200)}...`);
        });
    })
    .then(res => { // res = { ok, status, data }
        if (!res.ok) { // ถ้า HTTP Status ไม่ใช่ 2xx (เช่น 400, 500)
            // data อาจจะมี error object จาก server
            const serverError = (res.data && (res.data.error || res.data.detail)) || `เกิดข้อผิดพลาดจาก Server (สถานะ: ${res.status})`;
            // ถ้า res.data.error เป็น object (เช่น Django form errors) ให้แปลงเป็น string หรือ HTML
            if (typeof serverError === 'object') {
                throw new Error(JSON.stringify(serverError));
            }
            throw new Error(serverError);
        }
        // ถ้า HTTP Status เป็น 2xx แต่ server อาจจะยังส่ง error ใน business logic กลับมา
        if (res.data.error) {
            // ถ้า res.data.error เป็น object (เช่น Django form errors)
            if (typeof res.data.error === 'object' && res.data.error !== null) {
                 throw new Error(JSON.stringify(res.data.error)); // โยน error ที่เป็น object เพื่อให้ catch จัดการแสดงผล
            }
            throw new Error(res.data.error); // ถ้าเป็น string error
        }

        // --- สำเร็จ ---
        alert(res.data.message || "Username/Password อัปเดตสำเร็จ! กรุณา Login ใหม่อีกครั้ง");
        closeGenericModal(); // ปิด Popup ยืนยัน (หรือ Popup ใดๆ ที่ genericModal แสดงอยู่)
        if (typeof logout === "function") {
            logout(); // เรียกฟังก์ชัน logout ที่คุณมี
        } else {
            window.location.href = "/users/login/"; // Fallback ไปหน้า login
        }
    })
    .catch(error => {
        console.error("เกิดข้อผิดพลาดขณะเปลี่ยน Username/Password (catch block):", error);
        closeGenericModal(); // ปิด Popup ยืนยัน (ถ้ายังเปิดอยู่)
        
        // เปิดฟอร์มเปลี่ยน Username/Password กลับมาใหม่เพื่อแสดง error
        displayChangeUsernamePasswordPopup(); 
        
        setTimeout(() => { // หน่วงเวลาเล็กน้อยเพื่อให้ DOM ของฟอร์มพร้อม
            const errorDiv = document.getElementById("modalChangeUsernamePasswordErrorMessages");
            if (errorDiv) {
                let displayErrorMessage = "เกิดข้อผิดพลาดบางอย่าง กรุณาลองใหม่";
                if (error && error.message) {
                    try {
                        // พยายาม parse error.message ถ้ามันเป็น JSON string (เช่น Django form errors)
                        const parsedErrors = JSON.parse(error.message);
                        if (typeof parsedErrors === 'object' && parsedErrors !== null) {
                            let errorHtml = "<ul>";
                            for (const field in parsedErrors) {
                                if (Array.isArray(parsedErrors[field])) {
                                    parsedErrors[field].forEach(msg => {
                                        errorHtml += `<li>${field === '__all__' ? '' : (escapeHTML(field) + ': ')}${escapeHTML(msg)}</li>`;
                                    });
                                } else {
                                    errorHtml += `<li>${field === '__all__' ? '' : (escapeHTML(field) + ': ')}${escapeHTML(parsedErrors[field])}</li>`;
                                }
                            }
                            errorHtml += "</ul>";
                            errorDiv.innerHTML = errorHtml;
                        } else { // ถ้า parse ได้ แต่ไม่ใช่ object ที่เราคาดหวัง
                            errorDiv.textContent = escapeHTML(error.message);
                        }
                    } catch (e) { // ถ้า error.message ไม่ใช่ JSON string
                        errorDiv.textContent = escapeHTML(error.message);
                    }
                } else {
                     errorDiv.textContent = displayErrorMessage;
                }
                errorDiv.style.display = "block";
            } else {
                alert(error.message || "เกิดข้อผิดพลาดบางอย่าง กรุณาลองใหม่");
            }
        }, 100); // หน่วงเวลาเพื่อให้ displayChangeUsernamePasswordPopup() แสดง modal เสร็จก่อน
    });
}

// ฟังก์ชันสำหรับเปิด Modal แก้ไขโปรไฟล์ห้อง
function displayEditRoomProfileModal() {
    // ปิดเมนูตั้งค่าห้องก่อนเปิด Modal
    const settingsMenu = document.getElementById("settingsMenu");
    if (settingsMenu && settingsMenu.style.display === "block") {
        settingsMenu.style.display = "none";
        // รีเซ็ตไอคอนของปุ่ม Trigger ถ้ามี
        const trigger = document.querySelector('[data-menu-trigger-for="settingsMenu"]');
        if (trigger && typeof resetMenuIcon === "function") {
            resetMenuIcon(trigger);
        }
    }

    const formTemplate = document.getElementById("templateEditRoomProfileForm");
    if (!formTemplate) {
        console.error("ไม่พบ Template: templateEditRoomProfileForm");
        alert("เกิดข้อผิดพลาด: ไม่พบ UI สำหรับแก้ไขโปรไฟล์ห้อง");
        return;
    }
    const formHtml = formTemplate.innerHTML;

    // ดึงข้อมูลห้องปัจจุบันจาก localStorage
    const currentRoomId = localStorage.getItem("currentRoomId");
    const currentRoomName = localStorage.getItem("currentRoomName");
    
    // พยายามดึงรูปภาพห้องจากรายการห้องใน sidebar
    let currentRoomImage = "/media/default/room.jpg"; // รูปภาพเริ่มต้น
    const currentRoomListItem = document.querySelector(`li[data-room-id="${currentRoomId}"]`);
    if (currentRoomListItem) {
        const imgElement = currentRoomListItem.querySelector('img');
        if (imgElement) {
            currentRoomImage = imgElement.src;
        }
    }

    if (!currentRoomId) {
        alert("กรุณาเลือกห้องที่ต้องการแก้ไขก่อน");
        return;
    }

    openGenericModal({
        title: `แก้ไขโปรไฟล์ห้อง: ${escapeHTML(currentRoomName)}`,
        bodyHTML: formHtml,
        footerHTML: `
            <button class="modal-button-default" onclick="closeGenericModal()">ยกเลิก</button>
            <button class="modal-button-primary" onclick="submitEditRoomProfileForm()">บันทึกการเปลี่ยนแปลง</button>
        `,
    });

    // กำหนดค่าเริ่มต้นให้กับฟอร์มหลังจาก Modal เปิด
    setTimeout(() => {
        const roomNameInput = document.getElementById("modalEditRoomName");
        const roomCurrentImageElem = document.getElementById("modalEditRoomCurrentImage");

        if (roomNameInput) {
            roomNameInput.value = currentRoomName || "";
        }
        if (roomCurrentImageElem) {
            roomCurrentImageElem.src = currentRoomImage;
        }
    }, 0); // ใช้ setTimeout เพื่อให้แน่ใจว่า DOM elements ถูก render แล้ว
}

// ฟังก์ชันสำหรับส่งข้อมูลฟอร์มแก้ไขโปรไฟล์ห้อง
function submitEditRoomProfileForm() {
    const form = document.getElementById("genericModalEditRoomProfileForm");
    const errorMessagesDiv = document.getElementById("modalEditRoomErrorMessages");

    if (!form) {
        console.error("ไม่พบฟอร์ม genericModalEditRoomProfileForm ใน Popup!");
        alert("เกิดข้อผิดพลาด: ไม่พบข้อมูลฟอร์มสำหรับแก้ไขโปรไฟล์ห้อง");
        return;
    }

    // เคลียร์ error เก่า (ถ้ามี)
    if (errorMessagesDiv) {
        errorMessagesDiv.innerHTML = "";
        errorMessagesDiv.style.display = "none";
    }

    const currentRoomId = localStorage.getItem("currentRoomId");
    if (!currentRoomId) {
        alert("ไม่พบ ID ห้องปัจจุบัน กรุณาลองใหม่อีกครั้ง");
        closeGenericModal();
        return;
    }

    let formData = new FormData(form);
    // เพิ่ม room_id เข้าไปใน formData เพื่อส่งไปยัง backend
    formData.append('room_id', currentRoomId);

    fetch(`/rooms/api/update-room-profile/${currentRoomId}/`, { // API endpoint สำหรับอัปเดตโปรไฟล์ห้อง
        method: "POST", // หรือ PUT/PATCH ตามการออกแบบ API ของคุณ
        body: formData,
        headers: { "X-CSRFToken": getCSRFToken() },
    })
    .then(response => {
        if (!response.ok) {
            return response.json().then(errData => {
                const errorToThrow = new Error(
                    errData.detail || errData.error || `เกิดข้อผิดพลาด HTTP ${response.status}`
                );
                errorToThrow.responsePayload = errData.error; // เก็บ raw error object
                throw errorToThrow;
            }).catch(() => {
                throw new Error(`เกิดข้อผิดพลาด HTTP ${response.status}`);
            });
        }
        return response.json();
    })
    .then(data => {
        if (data.error) {
            if (errorMessagesDiv) {
                if (typeof data.error === "object" && data.error !== null) {
                    let errorHtml = "<ul>";
                    for (const field in data.error) {
                        if (Array.isArray(data.error[field])) {
                            data.error[field].forEach(msg => {
                                errorHtml += `<li>${field === '__all__' ? '' : (escapeHTML(field) + ': ')}${escapeHTML(msg)}</li>`;
                            });
                        } else {
                            errorHtml += `<li>${field === '__all__' ? '' : (escapeHTML(field) + ': ')}${escapeHTML(data.error[field])}</li>`;
                        }
                    }
                    errorHtml += "</ul>";
                    errorMessagesDiv.innerHTML = errorHtml;
                } else {
                    errorMessagesDiv.textContent = escapeHTML(data.error.toString());
                }
                errorMessagesDiv.style.display = "block";
            } else {
                alert("ผิดพลาด: " + (typeof data.error === "string" ? data.error : JSON.stringify(data.error)));
            }
        } else {
            alert(data.message || "อัปเดตโปรไฟล์ห้องสำเร็จ!");
            closeGenericModal();

            // อัปเดต UI ใน sidebar ทันที
            if (data.room_id && data.room_name) {
                updateRoomInSidebar(data.room_id, data.room_name, data.image_url);
                localStorage.setItem("currentRoomName", data.room_name); // อัปเดต localStorage ด้วย
            }
        }
    })
    .catch(error => {
        console.error("เกิดข้อผิดพลาดขณะอัปเดตโปรไฟล์ห้อง:", error);
        const displayError = error.responsePayload ? JSON.stringify(error.responsePayload) : (error.message || "เกิดข้อผิดพลาดบางอย่าง กรุณาลองใหม่");
        alert(displayError);
    });
}
