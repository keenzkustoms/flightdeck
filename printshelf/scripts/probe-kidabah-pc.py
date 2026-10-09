#!/usr/bin/env python3
import json
import os
import sqlite3
from pathlib import Path

cfg = json.loads(Path("/home/flightdeck/flightdeck/printshelf/config.json").read_text())
print("watched_folders:")
for f in cfg.get("watched_folders") or []:
    p = Path(f.get("path") or "")
    print(f"  id={f.get('id')} path={p} exists={p.is_dir()} win={f.get('windows_path')}")

mnt = Path("/mnt/kidabah-pc")
print("\nmount /mnt/kidabah-pc:")
print("  exists", mnt.exists(), "isdir", mnt.is_dir())
if mnt.is_dir():
    try:
        entries = sorted(os.listdir(mnt))[:30]
        print("  entries", entries)
    except Exception as e:
        print("  listdir error", e)

db = Path("/home/flightdeck/flightdeck/printshelf/data/printshelf.sqlite3")
conn = sqlite3.connect(str(db))
print("\nassets by root_id:")
for row in conn.execute(
    "SELECT root_id, COUNT(*) FROM assets WHERE missing=0 GROUP BY root_id ORDER BY 2 DESC"
):
    print(" ", row)
print(
    "kidabah-pc paths:",
    conn.execute(
        "SELECT COUNT(*) FROM assets WHERE abs_path LIKE '%kidabah-pc%' OR root_id LIKE '%kidabah%'"
    ).fetchone()[0],
)
