from fastapi import FastAPI
from pydantic import BaseModel
import ctranslate2
from transformers import M2M100Tokenizer
import os

app = FastAPI()

# โหลด tokenizer และโมเดล (path ต้องตรงกับ mount/convert)
MODEL_DIR = os.getenv("M2M_CTRANSLATE2_DIR", "/app/models/ctranslate2-m2m100")
tokenizer = M2M100Tokenizer.from_pretrained("facebook/m2m100_418M")
translator = ctranslate2.Translator(MODEL_DIR, device="cuda")  # ใช้ GPU ผ่าน docker runtime

class MTItem(BaseModel):
    text: str
    src_lang: str = "en"  # ไทยยังเทรนอยู่ ให้ทดสอบ en/ja/zh ก่อน
    tgt_lang: str = "ja"

@app.get("/health")
async def health():
    return {"ok": True}

@app.post("/mt")
async def translate_api(item: MTItem):
    text = (item.text or "").strip()
    if not text:
        return {"translation": ""}

    src_lang = item.src_lang
    tgt_lang = item.tgt_lang

    # กำหนดภาษา source
    tokenizer.src_lang = src_lang

    # เข้ารหัสเป็น token string (ไม่ใช่ id)
    input_ids = tokenizer(text, return_tensors="pt").input_ids[0]
    input_tokens = tokenizer.convert_ids_to_tokens(input_ids)

    # target_prefix เป็น token string ของภาษาปลายทาง
    tgt_token = tokenizer.convert_ids_to_tokens([tokenizer.lang_code_to_id[tgt_lang]])[0]
    target_prefix = [[tgt_token]]

    # แปล (ลด latency ด้วย beam_size=1)
    results = translator.translate_batch(
        [input_tokens],
        target_prefix=target_prefix,
        beam_size=1,
        max_decoding_length=256
    )
    output_tokens = results[0].hypotheses[0]

    # แปลงกลับเป็นข้อความ
    output_ids = tokenizer.convert_tokens_to_ids(output_tokens)
    translation = tokenizer.decode(output_ids, skip_special_tokens=True)
    return {"translation": translation}
