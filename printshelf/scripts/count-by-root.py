#!/usr/bin/env python3
import sqlite3
import urllib.request

print(urllib.request.urlopen("http://127.0.0.1:8100/api/scan", timeout=5).read().decode())
c = sqlite3.connect("/home/flightdeck/flightdeck/printshelf/data/printshelf.sqlite3")
print("by root:")
for r in c.execute(
    "SELECT root_id, missing, COUNT(*) FROM assets GROUP BY 1, 2 ORDER BY 1, 2"
):
    print(" ", r)
print("kidabah sample:")
for r in c.execute(
    "SELECT file_name, rel_path FROM assets WHERE root_id='kidabah-pc' AND missing=0 ORDER BY id DESC LIMIT 10"
):
    print(" ", r)
