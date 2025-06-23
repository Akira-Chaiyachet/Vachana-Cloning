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