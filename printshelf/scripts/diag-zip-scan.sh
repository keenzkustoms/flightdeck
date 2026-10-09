#!/bin/bash
set -euo pipefail
DB=/home/flightdeck/flightdeck/printshelf/data/printshelf.sqlite3
ROOT=/mnt/koko-kidabah

echo "---ZIP_DIRS---"
sqlite3 "$DB" <<'SQL'
SELECT replace(abs_path, '/' || file_name, ''), COUNT(*) AS c
FROM assets WHERE kind='zip'
GROUP BY 1 ORDER BY c DESC LIMIT 25;
SQL

echo "---SCAN_RUNS---"
sqlite3 "$DB" <<'SQL'
SELECT id, status, files_seen, files_upserted, started_at, finished_at,
       substr(coalesce(error,''),1,120)
FROM scan_runs ORDER BY id DESC LIMIT 8;
SQL

echo "---COUNTS---"
sqlite3 "$DB" <<'SQL'
SELECT kind, COUNT(*) FROM assets GROUP BY kind;
SELECT COUNT(*) AS total FROM assets;
SQL

echo "---QUICK_ZIP_SAMPLES---"
for d in "3D Models" "3D Print" "3D Print Stuff" downloads Kidabah "KIDABAH TO CHECK" backup Back_UP "Chris's Projects"; do
  n=$(timeout 60 find "$ROOT/$d" -type f -iname '*.zip' 2>/dev/null | wc -l || echo timeout)
  echo "$d: $n"
done

echo "---JOURNAL---"
journalctl -u printshelf.service -n 25 --no-pager
