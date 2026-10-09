#!/usr/bin/env python3
"""Pull Amy keys from Pi config into %APPDATA%\\Amy\\config.json (desktop)."""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

APP = Path.home() / "AppData" / "Roaming" / "Amy" / "config.json"
SSH = [
    "ssh",
    "-i",
    str(Path.home() / ".ssh" / "flightdeck_cursor"),
    "-o",
    "IdentitiesOnly=yes",
    "-o",
    "ConnectTimeout=15",
    "flightdeck@100.106.112.104",
    "python3 -c \"import json;print(json.dumps(json.load(open('/home/flightdeck/flightdeck/amy/config.json'))))\"",
]


def main() -> int:
    raw = subprocess.check_output(SSH, text=True)
    remote = json.loads(raw)
    if not APP.exists():
        print(f"missing {APP}", file=sys.stderr)
        return 1
    local = json.loads(APP.read_text(encoding="utf-8"))
    for key in (
        "openai_api_key",
        "openai_base_url",
        "model",
        "elevenlabs_api_key",
        "elevenlabs_voice_id",
        "elevenlabs_voice_name",
        "elevenlabs_model",
        "elevenlabs_stability",
        "elevenlabs_similarity",
        "elevenlabs_style",
        "flightdeck_base_url",
    ):
        val = remote.get(key)
        if val is None or val == "" or (isinstance(val, str) and "PUT-YOUR" in val):
            continue
        local[key] = val
    # Desktop must keep local Hands + bind
    local["hands_base_url"] = "http://127.0.0.1:4701"
    local["bind_host"] = "127.0.0.1"
    # Prefer Pi Tailscale for Flightdeck if still localhost
    fd = str(local.get("flightdeck_base_url") or "")
    if "127.0.0.1" in fd or "localhost" in fd or fd.rstrip("/") == "http://100.106.112.104:8000":
        local["flightdeck_base_url"] = "https://flightdeck.tail7de73e.ts.net"
    APP.write_text(json.dumps(local, indent=2) + "\n", encoding="utf-8")
    ok_o = bool(local.get("openai_api_key")) and "PUT-YOUR" not in str(local.get("openai_api_key"))
    ok_e = bool(local.get("elevenlabs_api_key")) and "PUT-YOUR" not in str(local.get("elevenlabs_api_key"))
    print(f"Wrote {APP}")
    print(f"openai: {'ok' if ok_o else 'MISSING'}")
    print(f"elevenlabs: {'ok' if ok_e else 'MISSING'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
