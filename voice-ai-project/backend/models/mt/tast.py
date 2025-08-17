import requests
r = requests.post("http://localhost:8002/mt", json={"text": "มีอีกไหมไอ้งามใส", "src_lang": "th", "tgt_lang": "en"})
print(r.json())
