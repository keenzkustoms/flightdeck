#!/usr/bin/env python3
import json
import urllib.request


def post(url, body):
    data = json.dumps(body).encode()
    req = urllib.request.Request(
        url, data=data, headers={"Content-Type": "application/json"}, method="POST"
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            print(r.status, r.read().decode())
    except Exception as e:
        if hasattr(e, "read"):
            print("ERR", getattr(e, "code", e), e.read().decode())
        else:
            print("ERR", e)


with urllib.request.urlopen("http://127.0.0.1:8000/api/printers", timeout=10) as r:
    printers = json.load(r)
for p in printers:
    print(p.get("id"), p.get("state"), p.get("model") or p.get("model_name"))

print("--- chat calibrate ---")
post("http://127.0.0.1:4700/chat", {"question": "run a calibration on BigBoy"})
print("--- status ask ---")
post("http://127.0.0.1:4700/chat", {"question": "what's BigBoy doing"})
