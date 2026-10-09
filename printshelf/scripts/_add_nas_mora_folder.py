#!/usr/bin/env python3
"""Ensure nas-mora watched folder exists in PrintShelf config.json."""
import json
from pathlib import Path

CFG = Path("/home/flightdeck/flightdeck/printshelf/config.json")
folder = {
    "id": "nas-mora",
    "label": "Mora Kidabah home",
    "path": "/mnt/nas-mora",
    "source_kind": "nas",
    "windows_path": r"\\192.168.4.77\User Homes\Kidabah",
}
cfg = json.loads(CFG.read_text(encoding="utf-8"))
folders = list(cfg.get("watched_folders") or [])
by_id = {str(f.get("id") or ""): f for f in folders}
by_id[folder["id"]] = {**by_id.get(folder["id"], {}), **folder}
cfg["watched_folders"] = list(by_id.values())
CFG.write_text(json.dumps(cfg, indent=2) + "\n", encoding="utf-8")
print("watched_folders:")
for f in cfg["watched_folders"]:
    print(f"  {f.get('id')}: {f.get('path')}")
