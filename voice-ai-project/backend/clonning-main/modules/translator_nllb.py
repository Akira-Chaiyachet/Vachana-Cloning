# modules/translator_nllb.py
from transformers import AutoTokenizer, AutoModelForSeq2SeqLM
import torch

model_name = "facebook/nllb-200-distilled-600M"

print("🚀 กำลังโหลดโมเดล NLLB...")
tokenizer = AutoTokenizer.from_pretrained(model_name)
model = AutoModelForSeq2SeqLM.from_pretrained(
    model_name,
    trust_remote_code=True,
    torch_dtype=torch.float32,
    use_safetensors=True,
    device_map="auto"
)
LANG_CODES = {
    "thai": "tha_Thai",
    "english": "eng_Latn",
    "chinese": "zho_Hans",   # จีนตัวย่อ
    "japanese": "jpn_Jpan"
}

def translate_nllb(text: str, source_lang="thai", target_lang="english") -> str:
    src_code = LANG_CODES[source_lang]
    tgt_code = LANG_CODES[target_lang]

    print(f"🌐 กำลังแปล: {source_lang} → {target_lang}")
    tokenizer.src_lang = src_code
    encoded = tokenizer(text, return_tensors="pt").to(model.device)

    generated_tokens = model.generate(
        **encoded,
        forced_bos_token_id=tokenizer.lang_code_to_id[tgt_code],
        max_length=512
    )

    translated = tokenizer.batch_decode(generated_tokens, skip_special_tokens=True)[0]
    return translated
