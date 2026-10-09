#!/usr/bin/env python3
import json
from pathlib import Path

paths = [
    Path("/home/flightdeck/flightdeck/amy/config.json"),
    Path("/home/flightdeck/amy/config.json"),
    Path("/home/flightdeck/flightdeck/amy/config.example.json"),
]
for p in paths:
    print("exists" if p.exists() else "missing", p)
    if not p.exists():
        continue
    d = json.loads(p.read_text(encoding="utf-8"))
    k = str(d.get("openai_api_key") or "")
    ready = bool(k) and not k.startswith("PUT-YOUR")
    print("  model", d.get("model"))
    print("  base", d.get("openai_base_url"))
    print("  key_ready", ready)
    print("  key_looks_like", "sk-..." if k.startswith("sk-") else ("placeholder" if k.startswith("PUT") else f"len={len(k)}"))
