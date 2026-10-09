#!/usr/bin/env python3
"""Install ElevenLabs key for Amy = Laura voice.

Usage:
  ELEVENLABS_API_KEY='...' python3 deploy/set-elevenlabs-key.py
  # or paste when prompted
"""
from __future__ import annotations

import getpass
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CONFIG = ROOT / "config.json"
EXAMPLE = ROOT / "config.example.json"

LAURA_ID = "FGY2WhTYpPnrIDTdsKH5"


def main() -> int:
    if not CONFIG.exists():
        if EXAMPLE.exists():
            CONFIG.write_text(EXAMPLE.read_text(encoding="utf-8"), encoding="utf-8")
        else:
            print("No config.json", file=sys.stderr)
            return 1

    key = (os.environ.get("ELEVENLABS_API_KEY") or "").strip()
    if not key:
        print("Paste ElevenLabs API key (hidden). Get one at:")
        print("  https://elevenlabs.io/app/settings/api-keys")
        key = getpass.getpass("ELEVENLABS_API_KEY: ").strip()
    if not key or key.startswith("PUT-YOUR"):
        print("No key.", file=sys.stderr)
        return 1

    data = json.loads(CONFIG.read_text(encoding="utf-8"))
    data["elevenlabs_api_key"] = key
    data["elevenlabs_voice_id"] = data.get("elevenlabs_voice_id") or LAURA_ID
    data["elevenlabs_voice_name"] = data.get("elevenlabs_voice_name") or "Laura"
    data["elevenlabs_model"] = data.get("elevenlabs_model") or "eleven_turbo_v2_5"
    data.setdefault("elevenlabs_stability", 0.38)
    data.setdefault("elevenlabs_similarity", 0.82)
    data.setdefault("elevenlabs_style", 0.45)
    CONFIG.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    os.chmod(CONFIG, 0o600)
    print(f"Laura voice keyed in {CONFIG}. Restart:")
    print("  systemctl --user restart amy")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
