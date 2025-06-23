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
        modalFooterElem.innerHTML = '<button class="modal-button-default" onclick="closeGenericModal()">ปิด</button>';
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
window.addEventListener('click', function(event) {
    const modal = document.getElementById("genericModal");
    if (modal && event.target == modal) { // ตรวจสอบว่าคลิกที่ตัว overlay เอง (modal)
        closeGenericModal();
    }
});

document.addEventListener('keydown', function(event) {
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

    openGenericModal({ // เรียกใช้ Popup กลางของเรา
        title: "สร้างห้องใหม่", // หัวข้อ Popup
        bodyHTML: formHtml,    // เนื้อหา (ฟอร์ม) ที่จะแสดง
        footerHTML: `
            <button class="modal-button-default" onclick="closeGenericModal()">ยกเลิก</button>
            <button class="modal-button-primary" onclick="submitCreateRoomFormFromModal()">สร้าง</button>
        ` // ปุ่มในส่วนท้ายของ Popup
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
                console.warn("ข้อมูลที่ได้จากการสร้างห้องไม่ครบถ้วนสำหรับ addRoomToSidebar:", data);
            }
            // --- ^^^ สิ้นสุดส่วนที่เพิ่ม ^^^ ---

            closeGenericModal(); // ปิด Popup ใหม่ของเรา
        }
    })
    .catch(error => {
        console.error("เกิดข้อผิดพลาดขณะสร้างห้อง:", error);
        alert(error.message || "เกิดข้อผิดพลาดบางอย่าง กรุณาลองใหม่");
    });
}

// Store the currently open menu's ID and its trigger
let currentlyOpenMenu = {
    menuId: null,
    triggerElement: null
};

// Generic function to toggle a popup menu
function togglePopupMenu(menuId, triggerElement) {
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
    const icon = triggerElement.querySelector('.menu-indicator-icon'); // หรือ ID เฉพาะเช่น #roomMenuIcon, #currentUserMenuIcon
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
document.querySelectorAll('[data-menu-trigger-for]').forEach(trigger => {
    trigger.addEventListener('click', function(event) {
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
        if (openMenu && 
            !openMenu.contains(event.target) && 
            !currentlyOpenMenu.triggerElement.contains(event.target)) {
            
            console.log(`Closing menu ${currentlyOpenMenu.menuId} due to outside click.`);
            openMenu.style.display = "none";
            resetMenuIcon(currentlyOpenMenu.triggerElement); // Reset its icon
            currentlyOpenMenu.menuId = null;
            currentlyOpenMenu.triggerElement = null;
        }
    }
});
