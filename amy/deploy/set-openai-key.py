#!/usr/bin/env python3
"""Set Amy's brain key without printing it back.

Usage on the Pi:
  python3 deploy/set-openai-key.py
  # then paste the key when prompted (input is hidden)

Or non-interactive:
  OPENAI_API_KEY='sk-...' python3 deploy/set-openai-key.py

Defaults brain to OpenAI GPT-5.6 Luna (cheap everyday Amy).
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


def main() -> int:
    if not CONFIG.exists():
        if EXAMPLE.exists():
            CONFIG.write_text(EXAMPLE.read_text(encoding="utf-8"), encoding="utf-8")
        else:
            print("No config.json or config.example.json found", file=sys.stderr)
            return 1

    key = (os.environ.get("OPENAI_API_KEY") or "").strip()
    if not key:
        print("Paste your OpenAI API key (input hidden), then Enter.")
        print("Get one at: https://platform.openai.com/api-keys")
        print("Add prepaid credits at: https://platform.openai.com/settings/organization/billing/")
        key = getpass.getpass("OPENAI_API_KEY: ").strip()
    if not key or key.startswith("PUT-YOUR"):
        print("No key provided.", file=sys.stderr)
        return 1

    data = json.loads(CONFIG.read_text(encoding="utf-8"))
    data["openai_api_key"] = key
    data["provider"] = "openai"
    data["openai_base_url"] = "https://api.openai.com/v1"
    data["model"] = "gpt-5.6-luna"
    data.setdefault("reasoning_effort", "low")
    CONFIG.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    os.chmod(CONFIG, 0o600)
    print(f"Wrote Luna brain key to {CONFIG} (mode 600). Restart:")
    print("  systemctl --user restart amy")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
