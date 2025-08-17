// sub_01.js — แสดงซับไตเติลจากอีเวนต์ STT/MT (lazy lookup + DOM-ready safe)
(function () {
  const SEG = new Map(); // segId -> { srcText, mtText }
  let box = null;
  function getBox() {
    if (!box) box = document.getElementById("vc-captions");
    return box;
  }
  function normalizeText(s) {
    return (s || "").toString().trim().replace(/\s+/g, " ");
  }

  function showCaption(srcText, mtText, keepMs = 2000) {
    const el = getBox();
    if (!el) return;
    const src = normalizeText(srcText);
    const mt = normalizeText(mtText);
    if (!src && !mt) {
      el.classList.remove("show");
      return;
    }
    el.innerHTML = mt
      ? `<div class="src">${src}</div><div class="mt">${mt}</div>`
      : `<div class="src">${src}</div>`;
    el.classList.add("show");
    if (el._hideTimer) clearTimeout(el._hideTimer);
    el._hideTimer = setTimeout(() => {
      el.classList.remove("show");
      el._hideTimer = null;
    }, keepMs);
  }

  function wireOnce() {
    // ต้องมี voicePipeline และ ws handler ก่อน
    if (
      !window.voicePipeline ||
      !window.voicePipeline.ws ||
      !window.voicePipeline.ws.on
    ) {
      setTimeout(wireOnce, 150);
      return;
    }
    // STT → โชว์ต้นฉบับก่อน
    window.voicePipeline.ws.on("stt_final", (m) => {
      const seg = SEG.get(m.segmentId) || {};
      seg.srcText = m.text || "";
      SEG.set(m.segmentId, seg);

      // ถ้าเปิดแปล ให้โชว์สถานะกำลังแปลไว้บรรทัดล่าง
      const tgt =
        (window.voicePipeline && window.voicePipeline.targetLang) || "off";
      const waiting = tgt && tgt !== "off" ? "…กำลังแปล…" : "";
      showCaption(seg.srcText, waiting); // จะถูกแทนด้วย mt_final ทีหลัง
    });

    // MT → อัปเดตบรรทัดแปล
    window.voicePipeline.ws.on("mt_final", (m) => {
      const seg = SEG.get(m.segmentId) || {};
      seg.mtText = m.text || "";
      SEG.set(m.segmentId, seg);
      showCaption(seg.srcText || "", seg.mtText || "");
    });
    // debug
    window._testCaption = () => showCaption("สวัสดีครับ", "Hello!", 2000);
  }

  // ให้แน่ใจว่า DOM พร้อม แล้วค่อยเริ่ม wire (เผื่อ div อยู่ท้าย body)
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", wireOnce);
  } else {
    wireOnce();
  }
})();
