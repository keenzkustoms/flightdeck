#!/usr/bin/env python3
"""Merge default ignore globs into printshelf/config.json (Pi helper)."""
from __future__ import annotations

import json
from pathlib import Path

DEFAULTS = [
    "**/node_modules/**",
    "**/.git/**",
    "**/__pycache__/**",
    "**/__MACOSX/**",
    "**/.Trash/**",
    "**/._*",
    "**/.DS_Store",
    "**/Thumbs.db",
    "**/*_temp.obj",
    "**/*_temp.OBJ",
    "**/temp.obj",
]


def main() -> None:
    root = Path(__file__).resolve().parents[1]
    p = root / "config.json"
    cfg = json.loads(p.read_text(encoding="utf-8"))
    cur = list(cfg.get("ignore_globs") or [])
    seen = {str(x).replace("\\", "/").lower() for x in cur}
    merged = list(cur)
    for d in DEFAULTS:
        if d.lower() not in seen:
            merged.append(d)
            seen.add(d.lower())
    cfg["ignore_globs"] = merged
    p.write_text(json.dumps(cfg, indent=2) + "\n", encoding="utf-8")
    print(f"ignore_globs {len(merged)}")


if __name__ == "__main__":
    main()
