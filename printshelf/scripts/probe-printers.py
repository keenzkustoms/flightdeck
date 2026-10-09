#!/usr/bin/env python3
import json
import urllib.request

with urllib.request.urlopen("http://127.0.0.1:8000/api/printers", timeout=8) as r:
    data = json.loads(r.read().decode())
for p in data:
    print(
        p.get("id"),
        p.get("kind"),
        p.get("custom_name") or p.get("name"),
        p.get("state") or p.get("status"),
        sorted(p.keys())[:12],
    )
