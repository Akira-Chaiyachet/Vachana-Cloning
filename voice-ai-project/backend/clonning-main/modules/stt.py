def transcribe_audio(audio_path, model):
    print("🧠 แปลงเสียงเป็นข้อความ...")
    # Force model to use GPU if available
    import torch
    if hasattr(model, 'to') and torch.cuda.is_available():
        model = model.to('cuda')
    result = model.transcribe(audio_path, task="transcribe", language="th")
    print("[DEBUG] result:", result)
    return result["text"]
