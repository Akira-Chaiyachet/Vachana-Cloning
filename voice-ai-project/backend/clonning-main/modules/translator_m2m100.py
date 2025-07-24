
import torch
from transformers import M2M100ForConditionalGeneration, M2M100Tokenizer
device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
model_name = "facebook/m2m100_418M"

LANG_CODES = {
    "english": "en",
    "thai": "th",
    "chinese": "zh",
    "japanese": "ja"}

def translator_m2m100_init():
    tokenizer = M2M100Tokenizer.from_pretrained(model_name)
    model = M2M100ForConditionalGeneration.from_pretrained(model_name).to(device)


    def translate(text, source_lang="thai", target_lang="english"):
        src_code = LANG_CODES[source_lang]
        tgt_code = LANG_CODES[target_lang]

        tokenizer.src_lang = src_code
        encoded = tokenizer(text, return_tensors="pt").to(device)

        with torch.no_grad():
            tokens = model.generate(
                **encoded,
                forced_bos_token_id=tokenizer.lang_code_to_id[tgt_code],
                max_length=256,
                no_repeat_ngram_size=3
            )
        return tokenizer.batch_decode(tokens, skip_special_tokens=True)[0]

    return translate
