#!/usr/bin/env python3
from __future__ import annotations

import os
import sqlite3
from pathlib import Path

from app.config import db_path, load_config


def count_assets(conn: sqlite3.Connection, root_id: str, rel_prefix: str | None = None) -> tuple[int, int, int]:
    where = ["root_id = ?"]
    params: list[object] = [root_id]
    if rel_prefix:
        where.append("(rel_path = ? OR rel_path LIKE ?)")
        params.extend([rel_prefix, rel_prefix.rstrip("/") + "/%"])
    sql_where = " AND ".join(where)
    row = conn.execute(
        f"""
        SELECT
          SUM(CASE WHEN missing = 0 THEN 1 ELSE 0 END) AS present_count,
          SUM(CASE WHEN missing = 0 AND COALESCE(hidden, 0) = 1 THEN 1 ELSE 0 END) AS hidden_count,
          SUM(CASE WHEN missing = 1 THEN 1 ELSE 0 END) AS missing_count
        FROM assets
        WHERE {sql_where}
        """,
        params,
    ).fetchone()
    return tuple(int(v or 0) for v in row)


def immediate_dirs(path: Path) -> list[str]:
    try:
        with os.scandir(path) as entries:
            return sorted(
                entry.name
                for entry in entries
                if entry.is_dir(follow_symlinks=False)
            )
    except OSError:
        return []


def main() -> int:
    cfg = load_config()
    database = db_path(cfg)
    roots = cfg.get("watched_folders") or []

    print(f"PrintShelf root audit")
    print(f"Database: {database}")
    print(f"Configured roots: {len(roots)}")
    print()

    if not database.exists():
        print("ERROR: PrintShelf database does not exist.")
        return 2

    conn = sqlite3.connect(str(database))
    try:
        total_zero_roots = 0
        total_zero_folders = 0

        for root in roots:
            root_id = str(root.get("id") or "").strip()
            label = str(root.get("label") or root_id or "Unnamed root")
            path = Path(str(root.get("path") or ""))
            source_kind = str(root.get("source_kind") or "local")
            present, hidden, missing = count_assets(conn, root_id)

            exists = path.exists()
            is_dir = path.is_dir() if exists else False
            mounted = os.path.ismount(path) if is_dir else False
            status = "OK"
            if not exists or not is_dir:
                status = "PATH_UNAVAILABLE"
            elif present == 0:
                status = "ZERO_INDEXED"
                total_zero_roots += 1

            print(f"[{status}] {label}")
            print(f"  id: {root_id}")
            print(f"  path: {path}")
            print(f"  source: {source_kind} | exists: {exists} | mountpoint: {mounted}")
            print(f"  indexed present: {present} | hidden: {hidden} | missing: {missing}")

            if is_dir:
                children = immediate_dirs(path)
                zero_children: list[str] = []
                indexed_children: list[tuple[str, int]] = []
                for child in children:
                    child_present, _child_hidden, _child_missing = count_assets(conn, root_id, child)
                    if child_present == 0:
                        zero_children.append(child)
                    else:
                        indexed_children.append((child, child_present))

                if children:
                    print(f"  top-level folders: {len(children)} | with indexed files: {len(indexed_children)} | zero indexed: {len(zero_children)}")
                if zero_children:
                    total_zero_folders += len(zero_children)
                    print("  ZERO-INDEXED TOP-LEVEL FOLDERS:")
                    for child in zero_children:
                        print(f"    - {child}")
            print()

        legacy = conn.execute(
            """
            SELECT root_id, COUNT(*)
            FROM assets
            WHERE missing = 0
            GROUP BY root_id
            ORDER BY root_id
            """
        ).fetchall()
        configured_ids = {str(root.get("id") or "").strip() for root in roots}
        orphaned = [(rid, count) for rid, count in legacy if rid not in configured_ids]
        if orphaned:
            print("DB ROOT IDS NOT IN CURRENT CONFIG:")
            for rid, count in orphaned:
                print(f"  - {rid}: {count} present assets")
            print()

        print("SUMMARY")
        print(f"  configured roots with zero indexed files: {total_zero_roots}")
        print(f"  top-level folders with zero indexed files: {total_zero_folders}")
        print(f"  DB root IDs not in current config: {len(orphaned)}")
        print()
        print("This audit is read-only. It does not scan, modify, hide, or delete anything.")
    finally:
        conn.close()

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
