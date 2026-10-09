from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator


SCHEMA = """
CREATE TABLE IF NOT EXISTS designs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  tags_json TEXT NOT NULL DEFAULT '[]',
  content_hash TEXT,
  group_key TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS filaments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  brand TEXT NOT NULL DEFAULT '',
  material TEXT NOT NULL DEFAULT '',
  colour_hex TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS assets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  design_id INTEGER NOT NULL REFERENCES designs(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  source_kind TEXT NOT NULL,
  root_id TEXT NOT NULL,
  root_path TEXT NOT NULL,
  rel_path TEXT NOT NULL,
  abs_path TEXT NOT NULL UNIQUE,
  file_name TEXT NOT NULL,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  mtime REAL NOT NULL DEFAULT 0,
  content_hash TEXT,
  triangle_count INTEGER,
  bbox_json TEXT,
  meta_json TEXT NOT NULL DEFAULT '{}',
  thumb_path TEXT,
  has_textures INTEGER NOT NULL DEFAULT 0,
  is_sliced INTEGER NOT NULL DEFAULT 0,
  assigned_filament_id INTEGER REFERENCES filaments(id) ON DELETE SET NULL,
  last_seen TEXT NOT NULL,
  missing INTEGER NOT NULL DEFAULT 0,
  hidden INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sidecars (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  asset_id INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  abs_path TEXT NOT NULL,
  file_name TEXT NOT NULL,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  UNIQUE(asset_id, abs_path)
);

CREATE TABLE IF NOT EXISTS scan_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL,
  files_seen INTEGER NOT NULL DEFAULT 0,
  files_upserted INTEGER NOT NULL DEFAULT 0,
  error TEXT
);

CREATE TABLE IF NOT EXISTS scan_issues (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  root_id TEXT NOT NULL DEFAULT '',
  abs_path TEXT NOT NULL UNIQUE,
  file_name TEXT NOT NULL,
  error TEXT NOT NULL DEFAULT '',
  attempts INTEGER NOT NULL DEFAULT 1,
  resolved INTEGER NOT NULL DEFAULT 0,
  ignored INTEGER NOT NULL DEFAULT 0,
  last_seen TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS collections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'auto',
  rules_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS collection_assets (
  collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  asset_id INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (collection_id, asset_id)
);

CREATE INDEX IF NOT EXISTS idx_assets_kind ON assets(kind);
CREATE INDEX IF NOT EXISTS idx_assets_hash ON assets(content_hash);
CREATE INDEX IF NOT EXISTS idx_assets_design ON assets(design_id);
CREATE INDEX IF NOT EXISTS idx_designs_hash ON designs(content_hash);
CREATE INDEX IF NOT EXISTS idx_scan_issues_state ON scan_issues(resolved, ignored, root_id);
CREATE INDEX IF NOT EXISTS idx_collections_mode ON collections(mode);
CREATE INDEX IF NOT EXISTS idx_collection_assets_asset ON collection_assets(asset_id);
"""


def utcnow() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def connect(db_file: Path) -> sqlite3.Connection:
    db_file.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(db_file), check_same_thread=False, timeout=8.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    # Readers (the grid, thumbs, scan banner) must not sit behind a scan write.
    conn.execute("PRAGMA busy_timeout = 8000")
    conn.execute("PRAGMA synchronous = NORMAL")
    return conn


def _migrate(conn: sqlite3.Connection) -> None:
    asset_cols = {row[1] for row in conn.execute("PRAGMA table_info(assets)").fetchall()}
    if "hidden" not in asset_cols:
        conn.execute("ALTER TABLE assets ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0")
    if "assigned_filament_id" not in asset_cols:
        conn.execute(
            "ALTER TABLE assets ADD COLUMN assigned_filament_id INTEGER REFERENCES filaments(id) ON DELETE SET NULL"
        )
    conn.execute("CREATE INDEX IF NOT EXISTS idx_assets_hidden ON assets(hidden)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_assets_assigned_filament ON assets(assigned_filament_id)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_scan_issues_state ON scan_issues(resolved, ignored, root_id)")

    design_cols = {row[1] for row in conn.execute("PRAGMA table_info(designs)").fetchall()}
    if "group_key" not in design_cols:
        conn.execute("ALTER TABLE designs ADD COLUMN group_key TEXT")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_designs_group_key ON designs(group_key)")

    collection_cols = {
        row[1] for row in conn.execute("PRAGMA table_info(collections)").fetchall()
    }
    if collection_cols:
        if "mode" not in collection_cols:
            conn.execute("ALTER TABLE collections ADD COLUMN mode TEXT NOT NULL DEFAULT 'auto'")
        if "rules_json" not in collection_cols:
            conn.execute("ALTER TABLE collections ADD COLUMN rules_json TEXT NOT NULL DEFAULT '{}'")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_collections_mode ON collections(mode)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_collection_assets_asset ON collection_assets(asset_id)")


def init_db(db_file: Path) -> None:
    with connect(db_file) as conn:
        conn.executescript(SCHEMA)
        _migrate(conn)
        conn.commit()


@contextmanager
def db_session(db_file: Path) -> Iterator[sqlite3.Connection]:
    conn = connect(db_file)
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def row_to_dict(row: sqlite3.Row | None) -> dict[str, Any] | None:
    if row is None:
        return None
    return {k: row[k] for k in row.keys()}


def parse_json_field(raw: str | None, default: Any) -> Any:
    if not raw:
        return default
    try:
        return json.loads(raw)
    except Exception:
        return default
