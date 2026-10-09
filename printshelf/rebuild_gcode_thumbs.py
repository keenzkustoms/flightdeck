#!/usr/bin/env python3
"""One-shot migration: replace legacy G-code colour blocks with real previews."""

from __future__ import annotations

import json

from app.config import data_dir, load_config
from app.db import db_session, init_db
from app.scanner import rebuild_stale_thumbs


def main() -> int:
    cfg = load_config()
    db_file = data_dir(cfg) / "printshelf.sqlite3"
    init_db(db_file)

    # Legacy gcode1 thumbnails were deterministic colour placeholders. Clearing
    # only the DB pointer makes the normal rebuild pipeline regenerate them with
    # the new embedded-thumbnail/toolpath renderer; files on disk are untouched.
    with db_session(db_file) as conn:
        cur = conn.execute(
            """UPDATE assets
               SET thumb_path = NULL
               WHERE missing = 0
                 AND COALESCE(hidden, 0) = 0
                 AND kind = 'gcode'
                 AND COALESCE(thumb_path, '') NOT LIKE '%_gcode2.png'"""
        )
        queued = int(cur.rowcount or 0)

    print(f"Queued {queued} G-code thumbnail(s) for rebuild.", flush=True)
    result = rebuild_stale_thumbs(kinds=("gcode",))
    print(json.dumps(result, indent=2, ensure_ascii=False), flush=True)
    return 0 if result.get("status") == "ok" else 1


if __name__ == "__main__":
    raise SystemExit(main())
