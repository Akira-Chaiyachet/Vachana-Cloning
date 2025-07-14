
from transformers import M2M100ForConditionalGeneration, M2M100Tokenizer
import torch

model_name = "facebook/m2m100_418M"
device = "cuda" if torch.cuda.is_available() else "cpu"
print(f"🖥️ กำลังใช้ device: {device}")
print("🚀 กำลังโหลดโมเดล M2M-100...")

# โหลด tokenizer
tokenizer = M2M100Tokenizer.from_pretrained(model_name)

# โหลดโมเดลแบบเต็ม (อย่าใช้ use_safetensors)
model = M2M100ForConditionalGeneration.from_pretrained(
    model_name,
    torch_dtype=torch.float32,
    #trust_remote_code=True,
    low_cpu_mem_usage=False  # ❗ ต้องปิด meta tensor
)

# ส่งไปยัง device
model = model.to(device)

# ISO 639-1 to lang code used by m2m100
LANG_CODES = {
    "thai": "th",
    "english": "en",
    "chinese": "zh",
    "japanese": "ja"
}

def translator_m2m100(text: str, source_lang="thai", target_lang="english") -> str:
    src_code = LANG_CODES[source_lang]
    tgt_code = LANG_CODES[target_lang]

    print(f"🌐 แปล: {source_lang} → {target_lang}")

    tokenizer.src_lang = src_code
    encoded = tokenizer(text, return_tensors="pt").to(device)

    with torch.no_grad():
        generated_tokens = model.generate(
            **encoded,
            forced_bos_token_id=tokenizer.lang_code_to_id[tgt_code],
            max_length=256,
            no_repeat_ngram_size=3
        )

    translated = tokenizer.batch_decode(generated_tokens, skip_special_tokens=True)[0]
    return translated
