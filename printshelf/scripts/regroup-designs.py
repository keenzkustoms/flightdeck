#!/usr/bin/env python3
"""Regroup assets into designs by stem+folder (PrintShelf design grouping v1).

Usage (on Pi):
  python3 printshelf/scripts/regroup-designs.py --dry-run
  python3 printshelf/scripts/regroup-designs.py
"""
from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.db import init_db, utcnow  # noqa: E402
from app.grouping import design_display_name, design_group_key  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", default=str(ROOT / "data" / "printshelf.sqlite3"))
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    db_path = Path(args.db)
    if not db_path.exists():
        print(f"DB missing: {db_path}", file=sys.stderr)
        return 1

    init_db(db_path)
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row

    assets = list(
        conn.execute(
            """SELECT id, design_id, root_id, rel_path, file_name, content_hash
               FROM assets WHERE missing = 0"""
        )
    )
    groups: dict[str, list[sqlite3.Row]] = defaultdict(list)
    for a in assets:
        key = design_group_key(a["root_id"], a["rel_path"], a["file_name"])
        groups[key].append(a)

    multi = {k: v for k, v in groups.items() if len(v) > 1}
    print(f"assets={len(assets)} group_keys={len(groups)} multi_asset_groups={len(multi)}")
    for key, rows in sorted(multi.items(), key=lambda kv: -len(kv[1]))[:15]:
        names = ", ".join(r["file_name"] for r in rows[:6])
        more = f" (+{len(rows)-6})" if len(rows) > 6 else ""
        print(f"  [{len(rows)}] {key} → {names}{more}")

    if args.dry_run:
        print("dry-run — no changes")
        return 0

    now = utcnow()
    moved = 0
    created = 0
    for key, rows in groups.items():
        # Prefer an existing design that already has notes/tags, else lowest id.
        design_ids = sorted({int(r["design_id"]) for r in rows})
        canonical = None
        best_score = -1
        for did in design_ids:
            d = conn.execute(
                "SELECT id, notes, tags_json, name FROM designs WHERE id = ?",
                (did,),
            ).fetchone()
            if not d:
                continue
            tags = []
            try:
                tags = json.loads(d["tags_json"] or "[]")
            except Exception:
                tags = []
            score = (10 if (d["notes"] or "").strip() else 0) + (5 if tags else 0) + (1 if d["name"] else 0)
            if score > best_score or (score == best_score and (canonical is None or did < canonical)):
                best_score = score
                canonical = did
        sample = rows[0]
        name = design_display_name(sample["rel_path"], sample["file_name"])
        if canonical is None:
            cur = conn.execute(
                """INSERT INTO designs(name, notes, tags_json, content_hash, group_key, created_at, updated_at)
                   VALUES (?,?,?,?,?,?,?)""",
                (name, "", "[]", sample["content_hash"], key, now, now),
            )
            canonical = int(cur.lastrowid)
            created += 1
        else:
            # Merge notes/tags from siblings onto canonical.
            notes_bits: list[str] = []
            tag_set: dict[str, str] = {}
            for did in design_ids:
                d = conn.execute(
                    "SELECT notes, tags_json FROM designs WHERE id = ?",
                    (did,),
                ).fetchone()
                if not d:
                    continue
                n = (d["notes"] or "").strip()
                if n and n not in notes_bits:
                    notes_bits.append(n)
                try:
                    for t in json.loads(d["tags_json"] or "[]"):
                        if isinstance(t, str) and t.strip():
                            tag_set[t.strip().lower()] = t.strip()
                except Exception:
                    pass
            conn.execute(
                """UPDATE designs SET name = ?, notes = ?, tags_json = ?, group_key = ?, updated_at = ?
                   WHERE id = ?""",
                (
                    name,
                    "\n\n".join(notes_bits)[:8000],
                    json.dumps(list(tag_set.values())[:24]),
                    key,
                    now,
                    canonical,
                ),
            )

        for r in rows:
            if int(r["design_id"]) != canonical:
                conn.execute(
                    "UPDATE assets SET design_id = ? WHERE id = ?",
                    (canonical, int(r["id"])),
                )
                moved += 1

    orphans = conn.execute(
        "SELECT COUNT(*) AS c FROM designs d WHERE NOT EXISTS (SELECT 1 FROM assets a WHERE a.design_id = d.id)"
    ).fetchone()["c"]
    conn.execute(
        "DELETE FROM designs WHERE NOT EXISTS (SELECT 1 FROM assets a WHERE a.design_id = designs.id)"
    )
    conn.commit()
    designs_left = conn.execute("SELECT COUNT(*) AS c FROM designs").fetchone()["c"]
    print(f"moved_assets={moved} created_designs={created} deleted_orphans={orphans} designs_now={designs_left}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
