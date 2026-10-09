#!/usr/bin/env python3
import json
import urllib.request

with urllib.request.urlopen("http://127.0.0.1:8000/api/printers", timeout=10) as r:
    printers = json.load(r)
for p in printers:
    if p.get("id") == "h2d":
        print("h2d", p.get("state"), p.get("calibration"))
