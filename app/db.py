from __future__ import annotations
import sqlite3
import logging
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from typing import Optional

from .paths import DB_PATH, UPLOADS_DIR

log = logging.getLogger(__name__)

DEFAULT_SETTINGS = {
    "accent": "#3b82f6",
    "temp_unit": "C",
    "time_format": "24h",
    "label_auto_print": "false",
    "system_base_url": "https://flightdeck.tail7de73e.ts.net",
    "spool_low_stock_pct": "20",
    "spool_near_empty_g": "50",
    "spool_confidence_warn_pct": "75",
    "default_label_weight_g": "1000",
    "label_include_colour": "true",
    "label_include_brand": "true",
    "label_include_location": "true",
    "queue_strict_colour": "true",
    "print_vault_path": "",
}

_PRINTER_PRINTING_ENABLED_PREFIX = "printer_print_enabled_"
_PRINTER_PRINTING_NOTE_PREFIX = "printer_print_note_"


def init() -> None:
    with _conn() as conn:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS printer_state (
                printer_id   TEXT PRIMARY KEY,
                finished_at  TEXT,
                last_seen    TEXT
            );

            CREATE TABLE IF NOT EXISTS prints (
                id                 INTEGER PRIMARY KEY AUTOINCREMENT,
                printer_id         TEXT NOT NULL,
                job_key            TEXT NOT NULL,
                filename           TEXT NOT NULL,
                subtask_name       TEXT,
                started_at         TIMESTAMP NOT NULL,
                ended_at           TIMESTAMP,
                duration_seconds   INTEGER,
                final_state        TEXT,
                error_message      TEXT,
                layers_total       INTEGER,
                layers_completed   INTEGER,
                filament_grams     REAL,
                material           TEXT,
                created_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            CREATE INDEX IF NOT EXISTS idx_prints_printer_started
                ON prints(printer_id, started_at DESC);

            CREATE UNIQUE INDEX IF NOT EXISTS idx_prints_job_key
                ON prints(printer_id, job_key);

            CREATE TABLE IF NOT EXISTS decisions (
                id           INTEGER PRIMARY KEY AUTOINCREMENT,
                print_id     INTEGER REFERENCES prints(id),
                printer_id   TEXT NOT NULL,
                event        TEXT NOT NULL,
                detail       TEXT,
                logged_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            CREATE INDEX IF NOT EXISTS idx_decisions_print_id
                ON decisions(print_id);

            CREATE INDEX IF NOT EXISTS idx_decisions_printer_logged
                ON decisions(printer_id, logged_at DESC);

            DROP TABLE IF EXISTS print_history;

            CREATE TABLE IF NOT EXISTS settings (
                key        TEXT PRIMARY KEY,
                value      TEXT NOT NULL,
                updated_at TIMESTAMP NOT NULL
            );

            CREATE TABLE IF NOT EXISTS material_costs (
                material      TEXT NOT NULL,
                brand         TEXT NOT NULL DEFAULT '',
                cost_per_gram REAL NOT NULL,
                comment       TEXT,
                empty_spool_weight_g REAL,
                updated_at    TEXT NOT NULL,
                PRIMARY KEY (material, brand)
            );

            CREATE TABLE IF NOT EXISTS spools (
                id                  INTEGER PRIMARY KEY AUTOINCREMENT,
                material            TEXT NOT NULL,
                brand               TEXT NOT NULL,
                subtype             TEXT,
                color_hex           TEXT NOT NULL,
                color_name          TEXT,
                color_hex_2         TEXT,
                color_hex_3         TEXT,
                color_scheme        TEXT NOT NULL DEFAULT 'solid',
                -- REAL so partial-spool additions and gram-precision deductions don't lose precision
                label_weight_g      REAL NOT NULL,
                remaining_g         REAL NOT NULL,
                empty_spool_weight_g REAL,
                location_printer_id TEXT,
                location_slot       INTEGER,
                storage_location_id INTEGER,
                home_storage_location_id INTEGER,
                notes               TEXT,
                added_at            TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                archived_at         TIMESTAMP,
                UNIQUE(location_printer_id, location_slot)
            );

            CREATE INDEX IF NOT EXISTS idx_spools_active
                ON spools(archived_at) WHERE archived_at IS NULL;

            CREATE INDEX IF NOT EXISTS idx_spools_location
                ON spools(location_printer_id, location_slot) WHERE archived_at IS NULL;

            CREATE TABLE IF NOT EXISTS filament_catalog (
                id                   INTEGER PRIMARY KEY AUTOINCREMENT,
                source               TEXT NOT NULL DEFAULT 'open_filament_database',
                source_variant_id    TEXT,
                source_filament_id   TEXT,
                brand                TEXT NOT NULL,
                material             TEXT NOT NULL,
                product              TEXT,
                subtype              TEXT,
                color_name           TEXT NOT NULL,
                color_hex            TEXT NOT NULL,
                filament_weight_g    REAL,
                empty_spool_weight_g REAL,
                diameter             REAL,
                traits               TEXT,
                discontinued         INTEGER NOT NULL DEFAULT 0,
                updated_at           TEXT NOT NULL,
                UNIQUE(source, source_variant_id, filament_weight_g, diameter)
            );

            CREATE INDEX IF NOT EXISTS idx_filament_catalog_lookup
                ON filament_catalog(brand, material, color_name);

            CREATE TABLE IF NOT EXISTS spool_locations (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                name        TEXT NOT NULL UNIQUE,
                notes       TEXT,
                sort_order  INTEGER NOT NULL DEFAULT 0,
                archived_at TIMESTAMP,
                created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS print_queue (
                id                  INTEGER PRIMARY KEY AUTOINCREMENT,
                printer_id          TEXT NOT NULL,
                position            INTEGER NOT NULL DEFAULT 0,
                filename            TEXT NOT NULL,
                file_path           TEXT NOT NULL,
                file_size           INTEGER,
                status              TEXT NOT NULL DEFAULT 'pending',
                preview_png         BLOB,
                estimated_seconds   INTEGER,
                filament_weight_g   REAL,
                filament_type       TEXT,
                filament_colors     TEXT,
                created_at          TEXT DEFAULT (datetime('now')),
                started_at          TEXT,
                finished_at         TEXT,
                error_msg           TEXT
            );

            CREATE INDEX IF NOT EXISTS idx_queue_printer_status
                ON print_queue(printer_id, status, position);

            CREATE TABLE IF NOT EXISTS maintenance_items (
                id                    INTEGER PRIMARY KEY AUTOINCREMENT,
                printer_id            TEXT NOT NULL,
                title                 TEXT NOT NULL,
                notes                 TEXT,
                due_at                TEXT,
                interval_days         INTEGER,
                interval_prints       INTEGER,
                interval_hours        REAL,
                last_completed_at     TEXT,
                created_at            TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at            TEXT NOT NULL DEFAULT (datetime('now')),
                archived_at           TEXT
            );

            CREATE INDEX IF NOT EXISTS idx_maintenance_printer_active
                ON maintenance_items(printer_id, archived_at, due_at);

            CREATE TABLE IF NOT EXISTS notifications (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                level       TEXT NOT NULL DEFAULT 'info',
                title       TEXT NOT NULL,
                message     TEXT,
                printer_id  TEXT,
                print_id    INTEGER,
                link        TEXT,
                created_at  TEXT NOT NULL DEFAULT (datetime('now')),
                read_at     TEXT,
                cleared_at  TEXT
            );

            CREATE INDEX IF NOT EXISTS idx_notifications_active
                ON notifications(cleared_at, created_at DESC);
        """)
    # Migrate existing DB: add columns if missing
    with _conn() as conn:
        for stmt in (
            "ALTER TABLE printer_state ADD COLUMN last_seen TEXT",
            "ALTER TABLE prints ADD COLUMN snapshot_jpeg BLOB",
            "ALTER TABLE prints ADD COLUMN snapshot_captured_at TIMESTAMP",
            "ALTER TABLE prints ADD COLUMN estimated_duration_seconds INTEGER",
            "ALTER TABLE prints ADD COLUMN filament_grams REAL",
            "ALTER TABLE prints ADD COLUMN material TEXT",
            "ALTER TABLE material_costs ADD COLUMN brand TEXT",
            "ALTER TABLE material_costs ADD COLUMN comment TEXT",
            "ALTER TABLE material_costs ADD COLUMN empty_spool_weight_g REAL",
            "ALTER TABLE prints ADD COLUMN notes TEXT",
            "ALTER TABLE prints ADD COLUMN tags TEXT",
            "ALTER TABLE prints ADD COLUMN exclude_from_stats INTEGER NOT NULL DEFAULT 0",
            "ALTER TABLE prints ADD COLUMN spool_usage TEXT",
            "ALTER TABLE prints ADD COLUMN ams_slot_snapshot TEXT",
            "ALTER TABLE spools ADD COLUMN empty_spool_weight_g REAL",
            "ALTER TABLE spools ADD COLUMN storage_location_id INTEGER",
            "ALTER TABLE spools ADD COLUMN home_storage_location_id INTEGER",
            "ALTER TABLE spools ADD COLUMN color_scheme TEXT NOT NULL DEFAULT 'solid'",
            "ALTER TABLE spools ADD COLUMN color_hex_2 TEXT",
            "ALTER TABLE spools ADD COLUMN color_hex_3 TEXT",
            "ALTER TABLE print_queue ADD COLUMN filament_colors TEXT",
        ):
            try:
                conn.execute(stmt)
            except Exception:
                pass
    # Migrate material_costs to composite PK (material, brand) if still on single-column PK
    with _conn() as conn:
        info = conn.execute("PRAGMA table_info(material_costs)").fetchall()
        pk_cols = [r["name"] for r in info if r["pk"] > 0]
        if pk_cols == ["material"]:
            conn.execute("""
                CREATE TABLE _mat_new (
                    material      TEXT NOT NULL,
                    brand         TEXT NOT NULL DEFAULT '',
                    cost_per_gram REAL NOT NULL,
                    comment       TEXT,
                    empty_spool_weight_g REAL,
                    updated_at    TEXT NOT NULL,
                    PRIMARY KEY (material, brand)
                )""")
            conn.execute("""
                INSERT INTO _mat_new (material, brand, cost_per_gram, comment, empty_spool_weight_g, updated_at)
                SELECT material, COALESCE(brand, ''), cost_per_gram, comment, empty_spool_weight_g,
                       COALESCE(updated_at, datetime('now'))
                FROM material_costs""")
            conn.execute("DROP TABLE material_costs")
            conn.execute("ALTER TABLE _mat_new RENAME TO material_costs")

    UPLOADS_DIR.mkdir(exist_ok=True)

    with _conn() as conn:
        shelf1 = conn.execute(
            "SELECT id FROM spool_locations WHERE name = ? AND archived_at IS NULL",
            ("Shelf #1",),
        ).fetchone()
        if not shelf1:
            cursor = conn.execute(
                "INSERT INTO spool_locations (name, notes, sort_order) VALUES (?, ?, ?)",
                ("Shelf #1", "Inside main cupboard top shelf", 10),
            )
            shelf1 = {"id": cursor.lastrowid}

        defaults = (
            ("Shelf #2", "Inside main cupboard middle shelf", 20),
            ("Shelf #3", "Inside main cupboard bottom shelf", 30),
        )
        for name, notes, order in defaults:
            exists = conn.execute(
                "SELECT id FROM spool_locations WHERE name = ? AND archived_at IS NULL",
                (name,),
            ).fetchone()
            if not exists:
                conn.execute(
                    "INSERT INTO spool_locations (name, notes, sort_order) VALUES (?, ?, ?)",
                    (name, notes, order),
                )

        storage = conn.execute(
            "SELECT id FROM spool_locations WHERE name = ? AND archived_at IS NULL",
            ("Storage",),
        ).fetchone()
        if storage:
            conn.execute(
                "UPDATE spools SET storage_location_id = ? WHERE storage_location_id = ?",
                (shelf1["id"], storage["id"]),
            )
            conn.execute(
                "UPDATE spools SET home_storage_location_id = ? WHERE home_storage_location_id = ?",
                (shelf1["id"], storage["id"]),
            )
            conn.execute(
                "UPDATE spool_locations SET archived_at = CURRENT_TIMESTAMP WHERE id = ?",
                (storage["id"],),
            )
        conn.execute(
            """UPDATE spools
               SET home_storage_location_id = storage_location_id
               WHERE home_storage_location_id IS NULL
                 AND location_printer_id IS NULL
                 AND storage_location_id IS NOT NULL"""
        )

    # Clean up prints that started >24 h ago but never got a final_state
    # (backend crash during a print that has since ended)
    _close_stale_orphans()


@contextmanager
def _conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def _close_stale_orphans() -> None:
    with _conn() as conn:
        orphans = conn.execute(
            """SELECT id, printer_id FROM prints
               WHERE final_state IS NULL
                 AND started_at < datetime('now', '-24 hours')""",
        ).fetchall()
        n = conn.execute(
            """UPDATE prints
               SET ended_at = CURRENT_TIMESTAMP,
                   final_state = 'ERROR',
                   error_message = 'Abandoned (Flightdeck restarted)'
               WHERE final_state IS NULL
                 AND started_at < datetime('now', '-24 hours')""",
        ).rowcount
    if n:
        log.info("Closed %d stale print row(s) as ERROR", n)
        for row in orphans:
            log_decision(row["printer_id"], "orphan_closed",
                        "Row open >24h at service start; Flightdeck restarted during this print",
                        print_id=row["id"])


# ── printer_state (FINISHED TTL) ──────────────────────────────────────────

def get_finished_at(printer_id: str) -> Optional[datetime]:
    with _conn() as conn:
        row = conn.execute(
            "SELECT finished_at FROM printer_state WHERE printer_id = ?",
            (printer_id,),
        ).fetchone()
    if row and row["finished_at"]:
        return datetime.fromisoformat(row["finished_at"])
    return None


def set_finished_at(printer_id: str, ts: datetime) -> None:
    with _conn() as conn:
        conn.execute(
            """INSERT INTO printer_state (printer_id, finished_at) VALUES (?, ?)
               ON CONFLICT(printer_id) DO UPDATE SET finished_at = excluded.finished_at""",
            (printer_id, ts.isoformat()),
        )


def clear_finished_at(printer_id: str) -> None:
    with _conn() as conn:
        conn.execute(
            """INSERT INTO printer_state (printer_id, finished_at) VALUES (?, NULL)
               ON CONFLICT(printer_id) DO UPDATE SET finished_at = NULL""",
            (printer_id,),
        )


# ── last_seen persistence ─────────────────────────────────────────────────

def set_last_seen(printer_id: str, ts: datetime) -> None:
    with _conn() as conn:
        conn.execute(
            """INSERT INTO printer_state (printer_id, last_seen) VALUES (?, ?)
               ON CONFLICT(printer_id) DO UPDATE SET last_seen = excluded.last_seen""",
            (printer_id, ts.isoformat()),
        )


def get_all_last_seen() -> dict:
    with _conn() as conn:
        rows = conn.execute(
            "SELECT printer_id, last_seen FROM printer_state WHERE last_seen IS NOT NULL"
        ).fetchall()
    result = {}
    for row in rows:
        try:
            result[row["printer_id"]] = datetime.fromisoformat(row["last_seen"])
        except Exception:
            pass
    return result


# ── prints lifecycle ───────────────────────────────────────────────────────

def on_print_started(
    printer_id: str,
    job_key: str,
    filename: str,
    *,
    subtask_name: Optional[str] = None,
    started_at: Optional[datetime] = None,
    layers_total: Optional[int] = None,
    material: Optional[str] = None,
) -> tuple[Optional[int], bool]:
    """Returns (print_id, is_reattach). is_reattach=True when row already existed."""
    ts = (started_at or datetime.utcnow()).isoformat()
    with _conn() as conn:
        cursor = conn.execute(
            """INSERT INTO prints
               (printer_id, job_key, filename, subtask_name, started_at, layers_total, material)
               VALUES (?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(printer_id, job_key) DO NOTHING""",
            (printer_id, job_key, filename, subtask_name, ts, layers_total, material),
        )
        if cursor.rowcount > 0:
            print_id, is_reattach = cursor.lastrowid, False
        else:
            row = conn.execute(
                "SELECT id FROM prints WHERE printer_id = ? AND job_key = ?",
                (printer_id, job_key),
            ).fetchone()
            print_id, is_reattach = (row["id"] if row else None), True
    log.info("print started: %s key=%s file=%s reattach=%s", printer_id, job_key, filename, is_reattach)
    return print_id, is_reattach


def on_print_finished(
    printer_id: str,
    job_key: str,
    *,
    ended_at: Optional[datetime] = None,
    layers_completed: Optional[int] = None,
    filament_grams: Optional[float] = None,
    material: Optional[str] = None,
) -> Optional[int]:
    """Returns print_id of the row that was closed, or None if not found."""
    now = (ended_at or datetime.utcnow()).isoformat()
    with _conn() as conn:
        row = conn.execute(
            "SELECT id FROM prints WHERE printer_id = ? AND job_key = ? AND final_state IS NULL",
            (printer_id, job_key),
        ).fetchone()
        print_id = row["id"] if row else None
        conn.execute(
            """UPDATE prints
               SET ended_at         = ?,
                   duration_seconds = CAST(
                       (julianday(?) - julianday(started_at)) * 86400 AS INTEGER),
                   final_state      = 'FINISHED',
                   layers_completed = COALESCE(?, layers_completed),
                   filament_grams   = COALESCE(?, filament_grams),
                   material         = COALESCE(?, material)
               WHERE printer_id = ? AND job_key = ? AND final_state IS NULL""",
            (now, now, layers_completed, filament_grams, material, printer_id, job_key),
        )
    _cal_cache.pop(printer_id, None)
    log.info("print finished: %s key=%s", printer_id, job_key)
    return print_id


def on_print_ended(
    printer_id: str,
    job_key: str,
    *,
    final_state: str,           # 'CANCELLED' | 'ERROR'
    ended_at: Optional[datetime] = None,
    layers_completed: Optional[int] = None,
    error_message: Optional[str] = None,
) -> Optional[int]:
    """Returns print_id of the row that was closed, or None if not found."""
    now = (ended_at or datetime.utcnow()).isoformat()
    with _conn() as conn:
        row = conn.execute(
            "SELECT id FROM prints WHERE printer_id = ? AND job_key = ? AND final_state IS NULL",
            (printer_id, job_key),
        ).fetchone()
        print_id = row["id"] if row else None
        conn.execute(
            """UPDATE prints
               SET ended_at         = ?,
                   duration_seconds = CAST(
                       (julianday(?) - julianday(started_at)) * 86400 AS INTEGER),
                   final_state      = ?,
                   layers_completed = COALESCE(?, layers_completed),
                   error_message    = COALESCE(?, error_message)
               WHERE printer_id = ? AND job_key = ? AND final_state IS NULL""",
            (now, now, final_state, layers_completed, error_message, printer_id, job_key),
        )
    log.info("print ended %s: %s key=%s", final_state, printer_id, job_key)
    return print_id


# ── queries ────────────────────────────────────────────────────────────────

def get_open_print_key(printer_id: str, filename: str) -> Optional[str]:
    """Return the job_key of any open (final_state IS NULL) row for this printer/filename."""
    with _conn() as conn:
        row = conn.execute(
            """SELECT job_key FROM prints
               WHERE printer_id = ? AND filename = ? AND final_state IS NULL
               ORDER BY started_at DESC LIMIT 1""",
            (printer_id, filename),
        ).fetchone()
    return row["job_key"] if row else None


def get_history_calendar(printer_id: str, year: int) -> dict:
    """Per-day print counts for a calendar year, plus year summary (FINISHED only)."""
    y0, y1 = f"{year}-01-01", f"{year + 1}-01-01"
    with _conn() as conn:
        day_rows = conn.execute(
            """SELECT date(started_at) AS day,
                      COUNT(*)                                                    AS total,
                      SUM(CASE WHEN final_state = 'FINISHED'  THEN 1 ELSE 0 END) AS finished,
                      SUM(CASE WHEN final_state = 'CANCELLED' THEN 1 ELSE 0 END) AS cancelled,
                      SUM(CASE WHEN final_state = 'ERROR'     THEN 1 ELSE 0 END) AS errors
               FROM prints
               WHERE printer_id = ? AND final_state IS NOT NULL
                 AND started_at >= ? AND started_at < ?
               GROUP BY day ORDER BY day""",
            (printer_id, y0, y1),
        ).fetchall()
        sum_row = conn.execute(
            """SELECT COUNT(*)             AS prints,
                      SUM(duration_seconds) AS seconds,
                      SUM(filament_grams)   AS grams
               FROM prints
               WHERE printer_id = ? AND final_state = 'FINISHED'
                 AND started_at >= ? AND started_at < ?""",
            (printer_id, y0, y1),
        ).fetchone()
    return {
        "days": [dict(r) for r in day_rows],
        "summary": dict(sum_row) if sum_row else {},
    }


def get_printer_usage_summary() -> list[dict]:
    """All-time print counters per printer from Flightdeck history."""
    with _conn() as conn:
        rows = conn.execute(
            """SELECT printer_id,
                      COUNT(*) AS total_prints,
                      SUM(CASE WHEN final_state = 'FINISHED' THEN 1 ELSE 0 END) AS finished_prints,
                      SUM(CASE WHEN final_state IN ('ERROR', 'ESTOP') THEN 1 ELSE 0 END) AS failed_prints,
                      SUM(CASE WHEN final_state = 'CANCELLED' THEN 1 ELSE 0 END) AS cancelled_prints,
                      COALESCE(SUM(CASE WHEN duration_seconds IS NOT NULL THEN duration_seconds ELSE 0 END), 0) AS total_seconds,
                      COALESCE(SUM(CASE WHEN final_state = 'FINISHED' THEN duration_seconds ELSE 0 END), 0) AS finished_seconds,
                      COALESCE(SUM(filament_grams), 0) AS filament_grams
               FROM prints
               WHERE final_state IS NOT NULL
               GROUP BY printer_id
               ORDER BY printer_id""",
        ).fetchall()
    return [dict(r) for r in rows]


def get_prints_for_day(printer_id: str, date_str: str) -> list[dict]:
    """All prints (any state) whose started_at is on the given UTC date (YYYY-MM-DD)."""
    with _conn() as conn:
        rows = conn.execute(
            """SELECT id, filename, subtask_name, started_at, ended_at,
                      duration_seconds, final_state, error_message,
                      layers_total, layers_completed, filament_grams, material,
                      snapshot_captured_at IS NOT NULL AS has_snapshot, notes,
                      tags, exclude_from_stats,
                      spool_usage
               FROM prints
               WHERE printer_id = ? AND date(started_at) = ?
               ORDER BY started_at""",
            (printer_id, date_str),
        ).fetchall()
        threshold_row = conn.execute(
            "SELECT value FROM settings WHERE key = 'spool_low_stock_pct'"
        ).fetchone()
        low_pct = float(threshold_row["value"]) if threshold_row else 20.0
        spool_rows = conn.execute(
            """SELECT id, label_weight_g, remaining_g
               FROM spools"""
        ).fetchall()
    spools = {int(r["id"]): dict(r) for r in spool_rows}
    result = []
    import json
    for r in rows:
        item = dict(r)
        raw_usage = item.pop("spool_usage", None)
        raw_tags = item.pop("tags", None)
        try:
            item["spool_usage"] = json.loads(raw_usage) if raw_usage else []
        except Exception:
            item["spool_usage"] = []
        try:
            tags = json.loads(raw_tags) if raw_tags else []
            item["tags"] = [str(t).strip() for t in tags if str(t).strip()]
        except Exception:
            item["tags"] = []
        item["exclude_from_stats"] = bool(item.get("exclude_from_stats"))
        _mark_reconcile_suggestions(item["spool_usage"], spools, low_pct)
        result.append(item)
    return result


def _hydrate_print_rows(rows) -> list[dict]:
    import json
    with _conn() as conn:
        threshold_row = conn.execute(
            "SELECT value FROM settings WHERE key = 'spool_low_stock_pct'"
        ).fetchone()
        low_pct = float(threshold_row["value"]) if threshold_row else 20.0
        spool_rows = conn.execute(
            """SELECT id, label_weight_g, remaining_g
               FROM spools"""
        ).fetchall()
    spools = {int(r["id"]): dict(r) for r in spool_rows}
    result = []
    for r in rows:
        item = dict(r)
        raw_usage = item.pop("spool_usage", None)
        raw_tags = item.pop("tags", None)
        try:
            item["spool_usage"] = json.loads(raw_usage) if raw_usage else []
        except Exception:
            item["spool_usage"] = []
        try:
            tags = json.loads(raw_tags) if raw_tags else []
            item["tags"] = [str(t).strip() for t in tags if str(t).strip()]
        except Exception:
            item["tags"] = []
        item["exclude_from_stats"] = bool(item.get("exclude_from_stats"))
        _mark_reconcile_suggestions(item["spool_usage"], spools, low_pct)
        result.append(item)
    return result


def get_print_memory(
    *,
    limit: int = 120,
    printer_id: Optional[str] = None,
    state: Optional[str] = None,
    material: Optional[str] = None,
    tag: Optional[str] = None,
    query: Optional[str] = None,
    days: Optional[int] = None,
) -> list[dict]:
    """Fleet-wide print memory rows for the Print Memory surface."""
    limit = max(1, min(int(limit or 120), 400))
    where = ["final_state IS NOT NULL"]
    params: list = []
    if printer_id:
        where.append("printer_id = ?")
        params.append(printer_id)
    if state:
        where.append("final_state = ?")
        params.append(state)
    if material:
        where.append("LOWER(COALESCE(material, '')) = LOWER(?)")
        params.append(material)
    if tag:
        where.append("LOWER(COALESCE(tags, '')) LIKE ?")
        params.append(f"%{tag.strip().lower()}%")
    if query:
        like = f"%{query.strip().lower()}%"
        where.append("""(
            LOWER(COALESCE(filename, '')) LIKE ?
            OR LOWER(COALESCE(subtask_name, '')) LIKE ?
            OR LOWER(COALESCE(notes, '')) LIKE ?
            OR LOWER(COALESCE(tags, '')) LIKE ?
            OR LOWER(COALESCE(error_message, '')) LIKE ?
        )""")
        params.extend([like, like, like, like, like])
    if days:
        days = max(1, min(int(days), 3650))
        where.append("started_at >= datetime('now', ?)")
        params.append(f"-{days} days")
    sql = f"""SELECT id, printer_id, filename, subtask_name, started_at, ended_at,
                     duration_seconds, estimated_duration_seconds, final_state, error_message,
                     layers_total, layers_completed, filament_grams, material,
                     snapshot_captured_at IS NOT NULL AS has_snapshot, notes,
                     tags, exclude_from_stats,
                     spool_usage
              FROM prints
              WHERE {' AND '.join(where)}
              ORDER BY started_at DESC
              LIMIT ?"""
    with _conn() as conn:
        rows = conn.execute(sql, (*params, limit)).fetchall()
    return _hydrate_print_rows(rows)


def get_print_by_id(print_id: int) -> Optional[dict]:
    with _conn() as conn:
        rows = conn.execute(
            """SELECT id, printer_id, filename, subtask_name, started_at, ended_at,
                      duration_seconds, estimated_duration_seconds, final_state, error_message,
                      layers_total, layers_completed, filament_grams, material,
                      snapshot_captured_at IS NOT NULL AS has_snapshot, notes,
                      tags, exclude_from_stats,
                      spool_usage
               FROM prints
               WHERE id = ?""",
            (print_id,),
        ).fetchall()
    items = _hydrate_print_rows(rows)
    return items[0] if items else None


def get_print_memory_facets() -> dict:
    with _conn() as conn:
        printers = conn.execute(
            """SELECT DISTINCT printer_id FROM prints
               WHERE final_state IS NOT NULL
               ORDER BY printer_id"""
        ).fetchall()
        materials = conn.execute(
            """SELECT DISTINCT material FROM prints
               WHERE final_state IS NOT NULL AND material IS NOT NULL AND material != ''
               ORDER BY material"""
        ).fetchall()
        tag_rows = conn.execute(
            """SELECT tags FROM prints
               WHERE final_state IS NOT NULL AND tags IS NOT NULL AND tags != ''"""
        ).fetchall()
    import json
    tags = set()
    for row in tag_rows:
        try:
            tags.update(str(t).strip() for t in json.loads(row["tags"]) if str(t).strip())
        except Exception:
            continue
    return {
        "printers": [r["printer_id"] for r in printers],
        "materials": [r["material"] for r in materials],
        "tags": sorted(tags, key=str.lower),
        "states": ["FINISHED", "CANCELLED", "ERROR", "ESTOP"],
    }


def get_print_memory_score(days: Optional[int] = None) -> dict:
    """Fleet reliability scorecard from Print Memory operator-trusted rows."""
    where = ["final_state IS NOT NULL"]
    params: list = []
    excluded_where = ["final_state IS NOT NULL", "COALESCE(exclude_from_stats, 0) = 1"]
    excluded_params: list = []
    if days:
        days = max(1, min(int(days), 3650))
        clause = "started_at >= datetime('now', ?)"
        value = f"-{days} days"
        where.append(clause)
        params.append(value)
        excluded_where.append(clause)
        excluded_params.append(value)

    trusted_where = where + ["COALESCE(exclude_from_stats, 0) = 0"]
    with _conn() as conn:
        fleet = conn.execute(
            f"""SELECT COUNT(*) AS total,
                       SUM(CASE WHEN final_state = 'FINISHED' THEN 1 ELSE 0 END) AS finished,
                       SUM(CASE WHEN final_state IN ('ERROR', 'ESTOP') THEN 1 ELSE 0 END) AS failed,
                       SUM(CASE WHEN final_state = 'CANCELLED' THEN 1 ELSE 0 END) AS cancelled,
                       COALESCE(SUM(CASE WHEN duration_seconds IS NOT NULL THEN duration_seconds ELSE 0 END), 0) AS seconds,
                       COALESCE(SUM(CASE WHEN final_state = 'FINISHED' THEN duration_seconds ELSE 0 END), 0) AS finished_seconds,
                       COALESCE(SUM(filament_grams), 0) AS filament_grams
                FROM prints
                WHERE {' AND '.join(trusted_where)}""",
            params,
        ).fetchone()
        excluded = conn.execute(
            f"""SELECT COUNT(*) AS total
                FROM prints
                WHERE {' AND '.join(excluded_where)}""",
            excluded_params,
        ).fetchone()
        printers = conn.execute(
            f"""SELECT printer_id,
                       COUNT(*) AS total,
                       SUM(CASE WHEN final_state = 'FINISHED' THEN 1 ELSE 0 END) AS finished,
                       SUM(CASE WHEN final_state IN ('ERROR', 'ESTOP') THEN 1 ELSE 0 END) AS failed,
                       SUM(CASE WHEN final_state = 'CANCELLED' THEN 1 ELSE 0 END) AS cancelled,
                       COALESCE(SUM(CASE WHEN duration_seconds IS NOT NULL THEN duration_seconds ELSE 0 END), 0) AS seconds,
                       COALESCE(SUM(CASE WHEN final_state = 'FINISHED' THEN duration_seconds ELSE 0 END), 0) AS finished_seconds,
                       COALESCE(AVG(CASE
                           WHEN final_state = 'FINISHED'
                            AND estimated_duration_seconds IS NOT NULL
                            AND estimated_duration_seconds > 0
                            AND duration_seconds IS NOT NULL
                           THEN ABS(duration_seconds - estimated_duration_seconds) * 1.0 / estimated_duration_seconds
                       END), NULL) AS eta_error_ratio
                FROM prints
                WHERE {' AND '.join(trusted_where)}
                GROUP BY printer_id
                ORDER BY printer_id""",
            params,
        ).fetchall()
        materials = conn.execute(
            f"""SELECT COALESCE(NULLIF(material, ''), 'Unknown') AS material,
                       COUNT(*) AS total,
                       SUM(CASE WHEN final_state = 'FINISHED' THEN 1 ELSE 0 END) AS finished,
                       SUM(CASE WHEN final_state IN ('ERROR', 'ESTOP') THEN 1 ELSE 0 END) AS failed
                FROM prints
                WHERE {' AND '.join(trusted_where)}
                GROUP BY COALESCE(NULLIF(material, ''), 'Unknown')
                ORDER BY total DESC, material
                LIMIT 8""",
            params,
        ).fetchall()

    def _score(finished, failed) -> Optional[float]:
        finished = int(finished or 0)
        failed = int(failed or 0)
        attempts = finished + failed
        if attempts <= 0:
            return None
        return round((finished / attempts) * 100, 1)

    fleet_d = dict(fleet) if fleet else {}
    excluded_d = dict(excluded) if excluded else {}
    fleet_d["excluded"] = int(excluded_d.get("total") or 0)
    fleet_d["score"] = _score(fleet_d.get("finished"), fleet_d.get("failed"))
    printer_rows = []
    for row in printers:
        item = dict(row)
        item["score"] = _score(item.get("finished"), item.get("failed"))
        if item.get("eta_error_ratio") is not None:
            item["eta_error_pct"] = round(float(item["eta_error_ratio"]) * 100, 1)
        else:
            item["eta_error_pct"] = None
        item.pop("eta_error_ratio", None)
        printer_rows.append(item)

    return {
        "days": days,
        "fleet": fleet_d,
        "printers": printer_rows,
        "materials": [dict(r) for r in materials],
    }


def _mark_reconcile_suggestions(usage: list[dict], spools: dict[int, dict], low_pct: float) -> None:
    """Add light-touch weigh-in hints to risky usage rows.

    These hints are deliberately conservative so normal prints do not turn into
    an operator chore. Reconcile is suggested only when inventory accuracy is
    likely to matter or the usage attribution looks suspicious.
    """
    if not usage:
        return
    multiple_rows = len(usage) > 1
    for entry in usage:
        if entry.get("actual_grams") is not None:
            continue
        reasons: list[str] = []
        spool = spools.get(int(entry.get("spool_id") or 0), {})
        remaining = entry.get("remaining_after_g")
        if remaining is None:
            remaining = spool.get("remaining_g")
        label = spool.get("label_weight_g") or 0
        pct = None
        try:
            pct = float(remaining) * 100.0 / float(label) if label else None
        except (TypeError, ValueError, ZeroDivisionError):
            pct = None

        trusted_multi_row = bool(entry.get("repaired")) or entry.get("attribution") == "filament_usage"
        if multiple_rows and not trusted_multi_row:
            reasons.append("multiple spools recorded")
        if pct is not None and pct < min(float(low_pct), 20.0):
            reasons.append(f"low spool ({pct:.0f}%)")
        if pct is not None and pct < 8:
            reasons.append("near empty")
        grams = float(entry.get("grams") or 0)
        if pct is not None and pct < 25 and grams >= max(10.0, float(remaining or 0) * 0.25):
            reasons.append("deduction close to remaining stock")

        if reasons:
            entry["reconcile_suggested"] = True
            entry["reconcile_reasons"] = reasons[:3]


def get_failure_review(days: int = 90) -> dict:
    """Recent failed prints plus aggregate buckets for review."""
    import json
    days = max(1, min(int(days or 90), 365))
    with _conn() as conn:
        rows = conn.execute(
            """SELECT id, printer_id, filename, subtask_name, started_at, ended_at,
                      duration_seconds, final_state, error_message,
                      layers_total, layers_completed, filament_grams, material,
                      snapshot_captured_at IS NOT NULL AS has_snapshot,
                      spool_usage
               FROM prints
               WHERE final_state IN ('ERROR', 'ESTOP')
                 AND started_at >= datetime('now', ?)
               ORDER BY started_at DESC
               LIMIT 200""",
            (f"-{days} days",),
        ).fetchall()

    items = []
    by_printer: dict[str, int] = {}
    by_material: dict[str, int] = {}
    by_state: dict[str, int] = {}
    by_timing = {"first_10m": 0, "first_25pct": 0, "mid_print": 0, "late_print": 0, "unknown": 0}
    by_spool: dict[str, dict] = {}

    for row in rows:
        item = dict(row)
        raw_usage = item.pop("spool_usage", None)
        try:
            usage = json.loads(raw_usage) if raw_usage else []
        except Exception:
            usage = []
        item["spool_usage"] = usage

        pct = None
        if item["layers_completed"] is not None and item["layers_total"]:
            pct = max(0, min(100, round(item["layers_completed"] * 100 / item["layers_total"])))
        item["progress_pct"] = pct

        if item["duration_seconds"] is not None and item["duration_seconds"] <= 600:
            timing = "first_10m"
        elif pct is None:
            timing = "unknown"
        elif pct <= 25:
            timing = "first_25pct"
        elif pct < 75:
            timing = "mid_print"
        else:
            timing = "late_print"
        item["timing_bucket"] = timing

        by_printer[item["printer_id"]] = by_printer.get(item["printer_id"], 0) + 1
        mat = item["material"] or "Unknown"
        by_material[mat] = by_material.get(mat, 0) + 1
        by_state[item["final_state"]] = by_state.get(item["final_state"], 0) + 1
        by_timing[timing] = by_timing.get(timing, 0) + 1

        for u in usage:
            sid = str(u.get("spool_id") or "unknown")
            rec = by_spool.setdefault(sid, {"spool_id": u.get("spool_id"), "count": 0, "grams": 0.0})
            rec["count"] += 1
            rec["grams"] += float(u.get("grams") or 0)

        items.append(item)

    def _pairs(d: dict) -> list[dict]:
        return [{"key": k, "count": v} for k, v in sorted(d.items(), key=lambda x: (-x[1], str(x[0])))]

    return {
        "days": days,
        "total": len(items),
        "items": items,
        "summary": {
            "by_printer": _pairs(by_printer),
            "by_material": _pairs(by_material),
            "by_state": _pairs(by_state),
            "by_timing": [{"key": k, "count": v} for k, v in by_timing.items() if v],
            "by_spool": sorted(
                [{"spool_id": v["spool_id"], "count": v["count"], "grams": round(v["grams"], 1)}
                 for v in by_spool.values()],
                key=lambda x: (-x["count"], str(x["spool_id"])),
            ),
        },
    }


def get_printer_health(printer_id: str) -> dict:
    """Explainable compact health signal for dashboard cards."""
    reasons: list[dict] = []
    with _conn() as conn:
        recent = conn.execute(
            """SELECT
                   SUM(CASE WHEN final_state IN ('FINISHED', 'ERROR', 'ESTOP') THEN 1 ELSE 0 END) AS total,
                   SUM(CASE WHEN final_state = 'FINISHED' THEN 1 ELSE 0 END) AS finished,
                   SUM(CASE WHEN final_state IN ('ERROR', 'ESTOP') THEN 1 ELSE 0 END) AS failed,
                   SUM(CASE WHEN final_state = 'CANCELLED' THEN 1 ELSE 0 END) AS cancelled
               FROM prints
               WHERE printer_id = ?
                 AND final_state IS NOT NULL
                 AND started_at >= datetime('now', '-14 days')""",
            (printer_id,),
        ).fetchone()
        early = conn.execute(
            """SELECT COUNT(*) AS n
               FROM prints
               WHERE printer_id = ?
                 AND final_state IN ('ERROR', 'ESTOP')
                 AND started_at >= datetime('now', '-14 days')
                 AND (
                   (duration_seconds IS NOT NULL AND duration_seconds <= 600)
                   OR (layers_total IS NOT NULL AND layers_total > 0
                       AND layers_completed IS NOT NULL
                       AND layers_completed * 1.0 / layers_total <= 0.25)
                 )""",
            (printer_id,),
        ).fetchone()
        queue = conn.execute(
            """SELECT
                   SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
                   SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending
               FROM print_queue
               WHERE printer_id = ?""",
            (printer_id,),
        ).fetchone()

    total = int(recent["total"] or 0)
    failed = int(recent["failed"] or 0)
    cancelled = int(recent["cancelled"] or 0)
    finished = int(recent["finished"] or 0)
    early_failures = int(early["n"] or 0)
    failed_queue = int(queue["failed"] or 0)

    due_maintenance = [m for m in get_maintenance_items(printer_id) if m.get("is_due")]
    if due_maintenance:
        reasons.append({"level": "attention", "message": f"{len(due_maintenance)} maintenance due"})
    if failed >= 3:
        reasons.append({"level": "attention", "message": f"{failed} failed prints in 14d"})
    elif failed >= 1:
        reasons.append({"level": "watch", "message": f"{failed} failed print{'s' if failed != 1 else ''} in 14d"})
    if early_failures >= 3:
        reasons.append({"level": "watch", "message": f"{early_failures} early failures in 14d"})
    if failed_queue:
        reasons.append({"level": "watch", "message": f"{failed_queue} failed queue job{'s' if failed_queue != 1 else ''}"})

    success_rate = round(finished * 100 / total) if total else None
    if success_rate is not None and total >= 5 and success_rate < 70:
        reasons.append({"level": "attention", "message": f"{success_rate}% success over 14d"})
    elif success_rate is not None and total >= 5 and success_rate < 85:
        reasons.append({"level": "watch", "message": f"{success_rate}% success over 14d"})

    if any(r["level"] == "attention" for r in reasons):
        status, label = "attention", "Needs attention"
    elif reasons:
        status, label = "watch", "Watch"
    else:
        status, label = "healthy", "Healthy"

    return {
        "status": status,
        "label": label,
        "success_rate_14d": success_rate,
        "prints_14d": total,
        "failures_14d": failed,
        "cancelled_14d": cancelled,
        "early_failures_14d": early_failures,
        "reasons": reasons[:4],
    }


def get_last_ended_at(printer_id: str) -> Optional[datetime]:
    """Return ended_at of the most recently ended print for this printer."""
    with _conn() as conn:
        row = conn.execute(
            """SELECT ended_at FROM prints
               WHERE printer_id = ? AND final_state IS NOT NULL AND ended_at IS NOT NULL
               ORDER BY ended_at DESC LIMIT 1""",
            (printer_id,),
        ).fetchone()
    if row and row["ended_at"]:
        return datetime.fromisoformat(row["ended_at"])
    return None


def close_open_prints(
    printer_id: str,
    *,
    final_state: str = "ERROR",
    error_message: Optional[str] = None,
) -> list[int]:
    """Close every open (final_state IS NULL) row for a printer. Returns list of closed print_ids."""
    now = datetime.utcnow().isoformat()
    with _conn() as conn:
        rows = conn.execute(
            "SELECT id FROM prints WHERE printer_id = ? AND final_state IS NULL",
            (printer_id,),
        ).fetchall()
        closed_ids = [r["id"] for r in rows]
        n = conn.execute(
            """UPDATE prints
               SET ended_at         = ?,
                   duration_seconds = CAST(
                       (julianday(?) - julianday(started_at)) * 86400 AS INTEGER),
                   final_state      = ?,
                   error_message    = COALESCE(?, error_message)
               WHERE printer_id = ? AND final_state IS NULL""",
            (now, now, final_state, error_message, printer_id),
        ).rowcount
    if n:
        log.info("close_open_prints: closed %d row(s) for %s as %s", n, printer_id, final_state)
    return closed_ids


def is_print_closed(printer_id: str, job_key: str) -> bool:
    """Return True if the given job already has a final_state recorded."""
    with _conn() as conn:
        row = conn.execute(
            "SELECT final_state FROM prints WHERE printer_id = ? AND job_key = ?",
            (printer_id, job_key),
        ).fetchone()
    return bool(row and row["final_state"] is not None)


def get_most_recent_print_id(printer_id: str) -> Optional[int]:
    """Return the id of the most recently started print row for this printer."""
    with _conn() as conn:
        row = conn.execute(
            "SELECT id FROM prints WHERE printer_id = ? ORDER BY started_at DESC LIMIT 1",
            (printer_id,),
        ).fetchone()
    return row["id"] if row else None


def save_print_snapshot(print_id: int, jpeg: bytes) -> None:
    with _conn() as conn:
        conn.execute(
            """UPDATE prints SET snapshot_jpeg = ?, snapshot_captured_at = CURRENT_TIMESTAMP
               WHERE id = ?""",
            (jpeg, print_id),
        )


def get_print_snapshot(print_id: int) -> Optional[bytes]:
    with _conn() as conn:
        row = conn.execute(
            "SELECT snapshot_jpeg FROM prints WHERE id = ?",
            (print_id,),
        ).fetchone()
    return row["snapshot_jpeg"] if row else None


def update_print_notes(print_id: int, notes: str) -> bool:
    """Update notes for a print row. Returns True if a row was updated."""
    with _conn() as conn:
        n = conn.execute(
            "UPDATE prints SET notes = ? WHERE id = ?",
            (notes or None, print_id),
        ).rowcount
    return n > 0


def update_print_memory_metadata(
    print_id: int,
    *,
    tags: Optional[list[str]] = None,
    exclude_from_stats: Optional[bool] = None,
) -> Optional[dict]:
    """Update operator metadata on a print and return the hydrated row."""
    import json
    assignments = []
    params: list = []
    if tags is not None:
        clean_tags = []
        seen = set()
        for tag in tags:
            value = str(tag).strip()
            if not value:
                continue
            key = value.lower()
            if key in seen:
                continue
            clean_tags.append(value[:96])
            seen.add(key)
            if len(clean_tags) >= 12:
                break
        assignments.append("tags = ?")
        params.append(json.dumps(clean_tags) if clean_tags else None)
    if exclude_from_stats is not None:
        assignments.append("exclude_from_stats = ?")
        params.append(1 if exclude_from_stats else 0)
    if not assignments:
        return get_print_by_id(print_id)
    params.append(print_id)
    with _conn() as conn:
        n = conn.execute(
            f"UPDATE prints SET {', '.join(assignments)} WHERE id = ?",
            params,
        ).rowcount
    return get_print_by_id(print_id) if n > 0 else None


def get_latest_finished_print_id(printer_id: str) -> Optional[int]:
    """Return the id of the most recently finished (FINISHED) print for this printer."""
    with _conn() as conn:
        row = conn.execute(
            """SELECT id FROM prints
               WHERE printer_id = ? AND final_state = 'FINISHED'
               ORDER BY ended_at DESC LIMIT 1""",
            (printer_id,),
        ).fetchone()
    return row["id"] if row else None


# ── decision log ──────────────────────────────────────────────────────────

def log_decision(
    printer_id: str,
    event: str,
    detail: Optional[str] = None,
    *,
    print_id: Optional[int] = None,
) -> None:
    """Append a structured decision entry. Never raises — fire-and-forget."""
    try:
        with _conn() as conn:
            conn.execute(
                "INSERT INTO decisions (print_id, printer_id, event, detail) VALUES (?, ?, ?, ?)",
                (print_id, printer_id, event, detail),
            )
    except Exception as exc:
        log.warning("log_decision failed (%s %s): %s", printer_id, event, exc)


def get_decisions(print_id: int) -> list[dict]:
    """Return decisions for a given print row, ordered by first occurrence.

    Exact repeated event/detail pairs are folded into one row with a repeat
    count so restart/poll noise remains auditable without dominating history.
    """
    with _conn() as conn:
        rows = conn.execute(
            "SELECT id, event, detail, logged_at FROM decisions WHERE print_id = ? ORDER BY logged_at",
            (print_id,),
        ).fetchall()
    grouped: list[dict] = []
    by_key: dict[tuple[str, str], dict] = {}
    for row in rows:
        item = dict(row)
        key = (item.get("event") or "", item.get("detail") or "")
        existing = by_key.get(key)
        if existing:
            existing["repeat_count"] += 1
            existing["last_logged_at"] = item.get("logged_at")
            continue
        item["repeat_count"] = 1
        item["first_logged_at"] = item.get("logged_at")
        item["last_logged_at"] = item.get("logged_at")
        by_key[key] = item
        grouped.append(item)
    return grouped


# ── ETA calibration ───────────────────────────────────────────────────────
# Per-printer cache of (ratio, count). Invalidated by on_print_finished.
# Sample: last 50 FINISHED rows with estimated_duration_seconds set.
# Minimum 5 samples to produce a ratio; below that ratio is None.
# Why 50: stable enough to smooth outliers, recent enough to reflect
# current slicer profile and hardware config.
_cal_cache: dict[str, Optional[dict]] = {}


def update_estimated_duration(printer_id: str, job_key: str, seconds: int) -> None:
    """Store the slicer's estimated total duration for a running print."""
    with _conn() as conn:
        conn.execute(
            "UPDATE prints SET estimated_duration_seconds = ? WHERE printer_id = ? AND job_key = ?",
            (seconds, printer_id, job_key),
        )


def get_calibration(printer_id: str) -> Optional[dict]:
    """Return {ratio, count} for ETA calibration, or None if no samples exist.

    ratio is None when count < 5 (insufficient data — show 'calibrating').
    ratio = sum(actual_duration) / sum(estimated_duration) over last 50 FINISHED prints.
    """
    if printer_id in _cal_cache:
        return _cal_cache[printer_id]
    with _conn() as conn:
        row = conn.execute(
            """SELECT SUM(duration_seconds)           AS actual,
                      SUM(estimated_duration_seconds) AS estimated,
                      COUNT(*)                        AS cnt
               FROM (
                   SELECT duration_seconds, estimated_duration_seconds
                   FROM prints
                   WHERE printer_id = ?
                     AND final_state = 'FINISHED'
                     AND estimated_duration_seconds IS NOT NULL
                     AND estimated_duration_seconds > 0
                   ORDER BY started_at DESC
                   LIMIT 50
               )""",
            (printer_id,),
        ).fetchone()
    result = None
    if row and row["cnt"] > 0 and row["estimated"]:
        ratio = (row["actual"] / row["estimated"]) if row["cnt"] >= 5 else None
        result = {"ratio": ratio, "count": int(row["cnt"])}
    _cal_cache[printer_id] = result
    return result


# ── user settings ─────────────────────────────────────────────────────────

def get_all_settings() -> dict:
    with _conn() as conn:
        rows = conn.execute("SELECT key, value FROM settings").fetchall()
    settings = dict(DEFAULT_SETTINGS)
    settings.update({r["key"]: r["value"] for r in rows})
    return settings


def _print_enabled_key(printer_id: str) -> str:
    return f"{_PRINTER_PRINTING_ENABLED_PREFIX}{printer_id}"


def _print_note_key(printer_id: str) -> str:
    return f"{_PRINTER_PRINTING_NOTE_PREFIX}{printer_id}"


def _parse_bool(value: Optional[str]) -> bool:
    return str(value or "").strip().lower() in {"1", "true", "yes", "on"}


def is_printer_printing_enabled(printer_id: str) -> bool:
    key = _print_enabled_key(printer_id)
    with _conn() as conn:
        row = conn.execute("SELECT value FROM settings WHERE key = ?", (key,)).fetchone()
    if row is None:
        return True
    return _parse_bool(row["value"])


def set_printer_printing_enabled(printer_id: str, enabled: bool) -> None:
    set_setting(_print_enabled_key(printer_id), "true" if enabled else "false")


def get_printer_printing_note(printer_id: str) -> Optional[str]:
    key = _print_note_key(printer_id)
    with _conn() as conn:
        row = conn.execute("SELECT value FROM settings WHERE key = ?", (key,)).fetchone()
    if row is None:
        return None
    note = str(row["value"] or "").strip()
    return note or None


def set_printer_printing_note(printer_id: str, note: Optional[str]) -> None:
    cleaned = (note or "").strip()
    if cleaned:
        set_setting(_print_note_key(printer_id), cleaned[:500])
        return
    with _conn() as conn:
        conn.execute("DELETE FROM settings WHERE key = ?", (_print_note_key(printer_id),))


def set_setting(key: str, value: str) -> None:
    with _conn() as conn:
        conn.execute(
            """INSERT INTO settings (key, value, updated_at)
               VALUES (?, ?, CURRENT_TIMESTAMP)
               ON CONFLICT(key) DO UPDATE
               SET value = excluded.value, updated_at = excluded.updated_at""",
            (key, value),
        )


# ── notifications ─────────────────────────────────────────────────────────

def add_notification(
    level: str,
    title: str,
    message: str = "",
    *,
    printer_id: Optional[str] = None,
    print_id: Optional[int] = None,
    link: Optional[str] = None,
) -> int:
    with _conn() as conn:
        cur = conn.execute(
            """INSERT INTO notifications (level, title, message, printer_id, print_id, link)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (level, title, message, printer_id, print_id, link),
        )
    return int(cur.lastrowid)


def list_notifications(limit: int = 50, include_cleared: bool = False) -> list[dict]:
    where = "" if include_cleared else "WHERE cleared_at IS NULL"
    with _conn() as conn:
        rows = conn.execute(
            f"""SELECT id, level, title, message, printer_id, print_id, link,
                       created_at, read_at, cleared_at
                FROM notifications
                {where}
                ORDER BY created_at DESC, id DESC
                LIMIT ?""",
            (limit,),
        ).fetchall()
    return [dict(r) for r in rows]


def unread_notification_count() -> int:
    with _conn() as conn:
        row = conn.execute(
            """SELECT COUNT(*) AS n FROM notifications
               WHERE cleared_at IS NULL AND read_at IS NULL"""
        ).fetchone()
    return int(row["n"] or 0)


def mark_notifications_read() -> int:
    with _conn() as conn:
        cur = conn.execute(
            """UPDATE notifications
               SET read_at = COALESCE(read_at, datetime('now'))
               WHERE cleared_at IS NULL"""
        )
    return cur.rowcount


def clear_notification(notification_id: int) -> bool:
    with _conn() as conn:
        cur = conn.execute(
            """UPDATE notifications
               SET cleared_at = COALESCE(cleared_at, datetime('now')),
                   read_at = COALESCE(read_at, datetime('now'))
               WHERE id = ? AND cleared_at IS NULL""",
            (notification_id,),
        )
    return cur.rowcount > 0


def clear_all_notifications() -> int:
    with _conn() as conn:
        cur = conn.execute(
            """UPDATE notifications
               SET cleared_at = COALESCE(cleared_at, datetime('now')),
                   read_at = COALESCE(read_at, datetime('now'))
               WHERE cleared_at IS NULL"""
        )
    return cur.rowcount


# ── maintenance schedule ─────────────────────────────────────────────────

def _maintenance_usage(conn, printer_id: str, anchor: Optional[str]) -> dict:
    params: list = [printer_id]
    where = "printer_id = ? AND final_state = 'FINISHED'"
    if anchor:
        where += " AND ended_at > ?"
        params.append(anchor)
    row = conn.execute(
        f"""SELECT COUNT(*) AS prints,
                   COALESCE(SUM(duration_seconds), 0) AS seconds
            FROM prints
            WHERE {where}""",
        params,
    ).fetchone()
    return {"prints": int(row["prints"] or 0), "hours": round((row["seconds"] or 0) / 3600, 2)}


def _maintenance_enrich(conn, row) -> dict:
    item = dict(row)
    anchor = item["last_completed_at"] or item["created_at"]
    usage = _maintenance_usage(conn, item["printer_id"], anchor)
    item["prints_since"] = usage["prints"]
    item["hours_since"] = usage["hours"]

    reasons = []
    now = datetime.utcnow()
    if item.get("due_at"):
        try:
            due = datetime.fromisoformat(item["due_at"])
            item["days_until_due"] = (due.date() - now.date()).days
            if due <= now:
                reasons.append("date")
        except Exception:
            item["days_until_due"] = None
    else:
        item["days_until_due"] = None

    if item.get("interval_days"):
        try:
            started = datetime.fromisoformat(anchor)
            item["days_since"] = max(0, (now.date() - started.date()).days)
            if item["days_since"] >= int(item["interval_days"]):
                reasons.append("days")
        except Exception:
            item["days_since"] = None
    else:
        item["days_since"] = None

    if item.get("interval_prints") and usage["prints"] >= int(item["interval_prints"]):
        reasons.append("prints")
    if item.get("interval_hours") and usage["hours"] >= float(item["interval_hours"]):
        reasons.append("hours")

    item["due_reasons"] = reasons
    item["is_due"] = bool(reasons)
    return item


def get_maintenance_items(printer_id: str, include_archived: bool = False) -> list[dict]:
    with _conn() as conn:
        where = "printer_id = ?"
        if not include_archived:
            where += " AND archived_at IS NULL"
        rows = conn.execute(
            f"""SELECT id, printer_id, title, notes, due_at, interval_days,
                       interval_prints, interval_hours, last_completed_at,
                       created_at, updated_at, archived_at
                FROM maintenance_items
                WHERE {where}
                ORDER BY archived_at IS NOT NULL, due_at IS NULL, due_at, title""",
            (printer_id,),
        ).fetchall()
        items = [_maintenance_enrich(conn, r) for r in rows]
    return sorted(items, key=lambda x: (not x["is_due"], x.get("due_at") is None, x.get("due_at") or "", x["title"].lower()))


def create_maintenance_item(
    printer_id: str,
    title: str,
    *,
    notes: Optional[str] = None,
    due_at: Optional[str] = None,
    interval_days: Optional[int] = None,
    interval_prints: Optional[int] = None,
    interval_hours: Optional[float] = None,
) -> int:
    with _conn() as conn:
        cursor = conn.execute(
            """INSERT INTO maintenance_items
               (printer_id, title, notes, due_at, interval_days, interval_prints, interval_hours)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (printer_id, title, notes, due_at, interval_days, interval_prints, interval_hours),
        )
        item_id = cursor.lastrowid
    log_decision(printer_id, "maintenance_added", f"Maintenance #{item_id}: {title}")
    return item_id


def update_maintenance_item(item_id: int, printer_id: str, **fields) -> bool:
    allowed = {"title", "notes", "due_at", "interval_days", "interval_prints", "interval_hours"}
    updates = {k: v for k, v in fields.items() if k in allowed}
    if not updates:
        return False
    updates["updated_at"] = datetime.utcnow().isoformat()
    cols = ", ".join(f"{k} = ?" for k in updates)
    vals = list(updates.values()) + [item_id, printer_id]
    with _conn() as conn:
        c = conn.execute(
            f"UPDATE maintenance_items SET {cols} WHERE id = ? AND printer_id = ? AND archived_at IS NULL",
            vals,
        )
    return c.rowcount > 0


def complete_maintenance_item(item_id: int, printer_id: str) -> bool:
    now = datetime.utcnow()
    with _conn() as conn:
        row = conn.execute(
            """SELECT title, due_at, interval_days
               FROM maintenance_items
               WHERE id = ? AND printer_id = ? AND archived_at IS NULL""",
            (item_id, printer_id),
        ).fetchone()
        if not row:
            return False
        next_due = None
        if row["interval_days"]:
            today = now.replace(hour=0, minute=0, second=0, microsecond=0)
            next_due = (today + timedelta(days=int(row["interval_days"]))).date().isoformat()
        conn.execute(
            """UPDATE maintenance_items
               SET last_completed_at = ?,
                   due_at = ?,
                   updated_at = ?
               WHERE id = ? AND printer_id = ?""",
            (now.isoformat(), next_due, now.isoformat(), item_id, printer_id),
        )
    log_decision(printer_id, "maintenance_completed", f"Maintenance #{item_id}: {row['title']}")
    return True


def archive_maintenance_item(item_id: int, printer_id: str) -> bool:
    with _conn() as conn:
        row = conn.execute(
            "SELECT title FROM maintenance_items WHERE id = ? AND printer_id = ?",
            (item_id, printer_id),
        ).fetchone()
        c = conn.execute(
            """UPDATE maintenance_items
               SET archived_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
               WHERE id = ? AND printer_id = ? AND archived_at IS NULL""",
            (item_id, printer_id),
        )
    if c.rowcount and row:
        log_decision(printer_id, "maintenance_archived", f"Maintenance #{item_id}: {row['title']}")
    return c.rowcount > 0


# ── material costs ────────────────────────────────────────────────────────

def get_material_costs() -> list:
    with _conn() as conn:
        rows = conn.execute(
            "SELECT material, brand, cost_per_gram, comment, empty_spool_weight_g FROM material_costs ORDER BY material, brand"
        ).fetchall()
    return [
        {"material": r["material"], "brand": r["brand"],
         "cost_per_gram": r["cost_per_gram"], "comment": r["comment"],
         "empty_spool_weight_g": r["empty_spool_weight_g"]}
        for r in rows
    ]


def replace_filament_catalog(rows: list[dict], source: str = "open_filament_database") -> int:
    now = datetime.utcnow().isoformat()
    with _conn() as conn:
        conn.execute("DELETE FROM filament_catalog WHERE source = ?", (source,))
        conn.executemany(
            """INSERT OR REPLACE INTO filament_catalog
               (source, source_variant_id, source_filament_id, brand, material, product,
                subtype, color_name, color_hex, filament_weight_g, empty_spool_weight_g,
                diameter, traits, discontinued, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            [
                (
                    source,
                    r.get("source_variant_id"),
                    r.get("source_filament_id"),
                    r.get("brand") or "",
                    r.get("material") or "",
                    r.get("product"),
                    r.get("subtype"),
                    r.get("color_name") or "",
                    r.get("color_hex") or "",
                    r.get("filament_weight_g"),
                    r.get("empty_spool_weight_g"),
                    r.get("diameter"),
                    r.get("traits"),
                    1 if r.get("discontinued") else 0,
                    now,
                )
                for r in rows
            ],
        )
    return len(rows)


def get_filament_catalog_status(source: str = "open_filament_database") -> dict:
    with _conn() as conn:
        row = conn.execute(
            """SELECT COUNT(*) AS count, MAX(updated_at) AS updated_at
               FROM filament_catalog WHERE source = ?""",
            (source,),
        ).fetchone()
    return {"source": source, "count": int(row["count"] or 0), "updated_at": row["updated_at"]}


def search_filament_catalog(q: str = "", brand: str = "", material: str = "", limit: int = 25) -> list:
    clauses = ["discontinued = 0"]
    params: list = []
    if brand:
        clauses.append("brand LIKE ?")
        params.append(f"%{brand}%")
    if material:
        clauses.append("material = ?")
        params.append(material)
    if q:
        for term in [t for t in q.lower().split() if t][:5]:
            clauses.append(
                "(LOWER(brand || ' ' || material || ' ' || COALESCE(product,'') || ' ' || COALESCE(subtype,'') || ' ' || color_name || ' ' || color_hex) LIKE ?)"
            )
            params.append(f"%{term}%")
    with _conn() as conn:
        rows = conn.execute(
            f"""SELECT brand, material, product, subtype, color_name, color_hex,
                       filament_weight_g, empty_spool_weight_g, diameter, traits, source
                FROM filament_catalog
                WHERE {' AND '.join(clauses)}
                ORDER BY brand,
                         CASE material
                           WHEN 'PLA' THEN 0
                           WHEN 'PLA+' THEN 1
                           WHEN 'PETG' THEN 2
                           WHEN 'ASA' THEN 3
                           WHEN 'ABS' THEN 4
                           WHEN 'TPU' THEN 5
                           ELSE 9
                         END,
                         material, product, color_name
                LIMIT ?""",
            params + [max(1, min(int(limit or 25), 100))],
        ).fetchall()
    return [dict(r) for r in rows]


def set_material_cost(
    material: str,
    brand: str,
    cost_per_gram: float,
    comment: Optional[str] = None,
    empty_spool_weight_g: Optional[float] = None,
) -> None:
    with _conn() as conn:
        conn.execute(
            """INSERT INTO material_costs (material, brand, cost_per_gram, comment, empty_spool_weight_g, updated_at)
               VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
               ON CONFLICT(material, brand) DO UPDATE
               SET cost_per_gram = excluded.cost_per_gram,
                   comment       = excluded.comment,
                   empty_spool_weight_g = excluded.empty_spool_weight_g,
                   updated_at    = excluded.updated_at""",
            (material, brand, cost_per_gram, comment, empty_spool_weight_g),
        )


def delete_material_cost(material: str, brand: str) -> None:
    with _conn() as conn:
        conn.execute(
            "DELETE FROM material_costs WHERE material = ? AND brand = ?",
            (material, brand),
        )


def get_filament_summary(printer_id: Optional[str] = None) -> dict:
    """Aggregate filament usage: totals, by material, by month (last 12), by printer."""
    where = "WHERE final_state = 'FINISHED' AND filament_grams IS NOT NULL"
    params_base: list = []
    if printer_id:
        where += " AND printer_id = ?"
        params_base.append(printer_id)

    with _conn() as conn:
        costs = {r["material"]: r["avg_cpg"]
                 for r in conn.execute(
                     "SELECT material, AVG(cost_per_gram) AS avg_cpg FROM material_costs GROUP BY material"
                 ).fetchall()}

        total_row = conn.execute(
            f"SELECT COALESCE(SUM(filament_grams), 0) AS grams FROM prints {where}",
            params_base,
        ).fetchone()
        total_g = total_row["grams"] if total_row else 0.0

        mat_rows = conn.execute(
            f"""SELECT COALESCE(material, 'Unknown') AS material,
                       SUM(filament_grams) AS grams
                FROM prints {where}
                GROUP BY material ORDER BY grams DESC""",
            params_base,
        ).fetchall()

        month_rows = conn.execute(
            f"""SELECT strftime('%Y-%m', started_at) AS month,
                       SUM(filament_grams) AS grams
                FROM prints {where}
                GROUP BY month ORDER BY month DESC LIMIT 12""",
            params_base,
        ).fetchall()

        printer_rows = conn.execute(
            f"""SELECT printer_id, SUM(filament_grams) AS grams
                FROM prints {where}
                GROUP BY printer_id ORDER BY grams DESC""",
            params_base,
        ).fetchall() if not printer_id else []

    def _cost(material: str, grams: float) -> Optional[float]:
        cpg = costs.get(material)
        return round(cpg * grams, 2) if cpg is not None else None

    by_material = [
        {"material": r["material"], "grams": round(r["grams"], 1),
         "cost": _cost(r["material"], r["grams"])}
        for r in mat_rows
    ]
    total_cost = sum(e["cost"] for e in by_material if e["cost"] is not None) or None

    return {
        "total_grams": round(total_g, 1),
        "total_cost":  round(total_cost, 2) if total_cost else None,
        "by_material": by_material,
        "by_month":    [{"month": r["month"], "grams": round(r["grams"], 1)} for r in month_rows],
        "by_printer":  [{"printer_id": r["printer_id"], "grams": round(r["grams"], 1)}
                        for r in printer_rows],
    }


def get_last_print(printer_id: str) -> Optional[dict]:
    with _conn() as conn:
        row = conn.execute(
            """SELECT filename, subtask_name, duration_seconds, final_state,
                      layers_completed, layers_total
               FROM prints
               WHERE printer_id = ? AND final_state IS NOT NULL
                 AND (error_message IS NULL OR error_message != 'Abandoned (stale open row)')
               ORDER BY started_at DESC LIMIT 1""",
            (printer_id,),
        ).fetchone()
    return dict(row) if row else None


def get_recent_reprints(limit: int = 12) -> list[dict]:
    """Recent completed/cancelled/error prints for Print Bay reprint staging."""
    limit = max(1, min(int(limit or 12), 48))
    with _conn() as conn:
        rows = conn.execute(
            """SELECT id, printer_id, filename, subtask_name, started_at, ended_at,
                      duration_seconds, final_state, error_message,
                      layers_total, layers_completed, filament_grams, material,
                      snapshot_captured_at IS NOT NULL AS has_snapshot
               FROM prints
               WHERE final_state IS NOT NULL
                 AND (error_message IS NULL OR error_message != 'Abandoned (stale open row)')
               ORDER BY started_at DESC
               LIMIT ?""",
            (limit,),
        ).fetchall()
    return [dict(r) for r in rows]


# ── spools ────────────────────────────────────────────────────────────────

_SPOOL_COLOR_SCHEMES = {"solid", "dual", "tri", "rainbow", "gradient", "mixed"}


def _clean_spool_color_scheme(value: Optional[str]) -> str:
    scheme = (value or "solid").strip().lower()
    return scheme if scheme in _SPOOL_COLOR_SCHEMES else "solid"


def _clean_optional_hex(value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    hex_value = value.strip()
    if len(hex_value) == 7 and hex_value.startswith("#"):
        try:
            int(hex_value[1:], 16)
            return hex_value.upper()
        except ValueError:
            return None
    return None


def create_spool(
    material: str,
    brand: str,
    color_hex: str,
    label_weight_g: float,
    remaining_g: float,
    *,
    subtype: Optional[str] = None,
    color_name: Optional[str] = None,
    color_hex_2: Optional[str] = None,
    color_hex_3: Optional[str] = None,
    color_scheme: str = "solid",
    location_printer_id: Optional[str] = None,
    location_slot: Optional[int] = None,
    storage_location_id: Optional[int] = None,
    notes: Optional[str] = None,
    empty_spool_weight_g: Optional[float] = None,
) -> int:
    color_scheme = _clean_spool_color_scheme(color_scheme)
    color_hex_2 = _clean_optional_hex(color_hex_2)
    color_hex_3 = _clean_optional_hex(color_hex_3)
    with _conn() as conn:
        cursor = conn.execute(
            """INSERT INTO spools
               (material, brand, subtype, color_hex, color_name, color_hex_2, color_hex_3, color_scheme,
                label_weight_g, remaining_g, empty_spool_weight_g,
                location_printer_id, location_slot, storage_location_id,
                home_storage_location_id, notes)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (material, brand, subtype, color_hex, color_name, color_hex_2, color_hex_3, color_scheme,
             label_weight_g, remaining_g, empty_spool_weight_g,
             location_printer_id, location_slot, storage_location_id,
             storage_location_id, notes),
        )
        spool_id = cursor.lastrowid
    printer = location_printer_id or "none"
    log_decision(printer, "spool_added",
                f"Spool #{spool_id} {material}/{brand} {color_hex} {remaining_g}g added")
    return spool_id


def get_spools(include_archived: bool = False) -> list:
    with _conn() as conn:
        where = "" if include_archived else "WHERE archived_at IS NULL"
        rows = conn.execute(
            f"""SELECT id, material, brand, subtype, color_hex, color_name, color_hex_2, color_hex_3, color_scheme,
                       label_weight_g, remaining_g, empty_spool_weight_g,
                       location_printer_id, location_slot, storage_location_id,
                       home_storage_location_id,
                       (SELECT name FROM spool_locations WHERE id = spools.storage_location_id) AS storage_location_name,
                       (SELECT name FROM spool_locations WHERE id = spools.home_storage_location_id) AS home_storage_location_name,
                       notes, added_at, archived_at
                FROM spools {where}
                ORDER BY material, brand, id"""
        ).fetchall()
        spools = [dict(r) for r in rows]
        _attach_spool_confidence(conn, spools)
    return spools


def get_spool(spool_id: int) -> Optional[dict]:
    with _conn() as conn:
        row = conn.execute(
            """SELECT id, material, brand, subtype, color_hex, color_name, color_hex_2, color_hex_3, color_scheme,
                      label_weight_g, remaining_g, empty_spool_weight_g,
                      location_printer_id, location_slot, storage_location_id,
                      home_storage_location_id,
                      (SELECT name FROM spool_locations WHERE id = spools.storage_location_id) AS storage_location_name,
                      (SELECT name FROM spool_locations WHERE id = spools.home_storage_location_id) AS home_storage_location_name,
                      notes, added_at, archived_at
               FROM spools WHERE id = ?""",
            (spool_id,),
        ).fetchone()
        if not row:
            return None
        spool = dict(row)
        _attach_spool_confidence(conn, [spool])
    return spool


def _parse_ts(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00")).replace(tzinfo=None)
    except Exception:
        try:
            return datetime.strptime(str(value).split(".")[0], "%Y-%m-%d %H:%M:%S")
        except Exception:
            return None


def _attach_spool_confidence(conn: sqlite3.Connection, spools: list[dict]) -> None:
    """Add a simple trust signal to spool remaining weights."""
    if not spools:
        return
    import json
    spool_ids = {int(s["id"]) for s in spools}
    stats = {
        sid: {
            "usage_count": 0,
            "deducted_g": 0.0,
            "reconciled_count": 0,
            "last_usage_at": None,
            "last_reconciled_at": None,
            "overdrawn": False,
        }
        for sid in spool_ids
    }
    rows = conn.execute(
        """SELECT id, ended_at, started_at, spool_usage
           FROM prints
           WHERE spool_usage IS NOT NULL
           ORDER BY COALESCE(ended_at, started_at) DESC"""
    ).fetchall()
    for row in rows:
        when = _parse_ts(row["ended_at"] or row["started_at"])
        try:
            entries = json.loads(row["spool_usage"] or "[]")
        except Exception:
            entries = []
        for entry in entries:
            sid = int(entry.get("spool_id") or 0)
            if sid not in stats:
                continue
            rec = stats[sid]
            grams = float(entry.get("actual_grams") or entry.get("grams") or 0)
            rec["usage_count"] += 1
            rec["deducted_g"] += max(0.0, grams)
            if when and (rec["last_usage_at"] is None or when > rec["last_usage_at"]):
                rec["last_usage_at"] = when
            if entry.get("reconciled_at"):
                rec["reconciled_count"] += 1
                rwhen = _parse_ts(entry.get("reconciled_at"))
                if rwhen and (rec["last_reconciled_at"] is None or rwhen > rec["last_reconciled_at"]):
                    rec["last_reconciled_at"] = rwhen

    overdraw_rows = conn.execute(
        "SELECT detail FROM decisions WHERE event = 'spool_overdrawn' ORDER BY logged_at DESC LIMIT 200"
    ).fetchall()
    for row in overdraw_rows:
        detail = row["detail"] or ""
        for sid in spool_ids:
            if f"Spool #{sid} " in detail or f"Spool #{sid}:" in detail:
                stats[sid]["overdrawn"] = True

    now = datetime.utcnow()
    for spool in spools:
        sid = int(spool["id"])
        rec = stats[sid]
        label_weight = float(spool.get("label_weight_g") or 0)
        remaining = float(spool.get("remaining_g") or 0)
        pct = (remaining * 100 / label_weight) if label_weight > 0 else 0
        added_at = _parse_ts(spool.get("added_at"))
        age_days = (now - added_at).days if added_at else None
        score = 84
        reasons = []
        if rec["reconciled_count"]:
            score = 95
            reasons.append("scale reconciled")
        elif rec["usage_count"]:
            score -= min(28, rec["usage_count"] * 4)
            reasons.append(f"{rec['usage_count']} print deduction{'s' if rec['usage_count'] != 1 else ''}")
        else:
            reasons.append("entered weight")
        if spool.get("empty_spool_weight_g") is not None:
            score += 4
            reasons.append("tare set")
        if age_days is not None and age_days > 60 and not rec["reconciled_count"]:
            score -= 8
            reasons.append(f"{age_days}d since added")
        if pct < 10 and not rec["reconciled_count"]:
            score -= 18
            reasons.append("near empty")
        elif pct < 20 and not rec["reconciled_count"]:
            score -= 8
            reasons.append("low spool")
        if rec["overdrawn"]:
            score -= 25
            reasons.append("overdraw event")
        score = max(0, min(100, int(round(score))))
        if score >= 85:
            level = "verified"
            label = "Verified"
        elif score >= 60:
            level = "estimated"
            label = "Estimated"
        else:
            level = "weigh"
            label = "Needs weigh-in"
        spool["confidence"] = {
            "score": score,
            "level": level,
            "label": label,
            "reasons": reasons[:3],
            "usage_count": rec["usage_count"],
            "deducted_g": round(rec["deducted_g"], 1),
            "reconciled_count": rec["reconciled_count"],
            "last_usage_at": rec["last_usage_at"].isoformat() if rec["last_usage_at"] else None,
            "last_reconciled_at": rec["last_reconciled_at"].isoformat() if rec["last_reconciled_at"] else None,
        }


def get_spool_trace(spool_id: int) -> Optional[dict]:
    """Return spool identity plus print usage and movement/activity rows."""
    spool = get_spool(spool_id)
    if not spool:
        return None
    import json
    import re
    usage = []
    activity = []
    spool_ref = re.compile(rf"\bSpool #{int(spool_id)}(?!\d)\b")
    with _conn() as conn:
        rows = conn.execute(
            """SELECT id, printer_id, filename, subtask_name, started_at, ended_at,
                      duration_seconds, final_state, filament_grams, material,
                      spool_usage
               FROM prints
               WHERE spool_usage IS NOT NULL
               ORDER BY started_at DESC""",
        ).fetchall()
        activity_rows = conn.execute(
            """SELECT id, printer_id, event, detail, logged_at
               FROM decisions
               WHERE detail LIKE ?
               ORDER BY logged_at DESC, id DESC
               LIMIT 80""",
            (f"%Spool #{int(spool_id)}%",),
        ).fetchall()
    total_used = 0.0
    for row in rows:
        try:
            entries = json.loads(row["spool_usage"] or "[]")
        except Exception:
            entries = []
        for entry in entries:
            if int(entry.get("spool_id") or 0) != int(spool_id):
                continue
            grams = float(entry.get("actual_grams") or entry.get("grams") or 0)
            total_used += grams
            item = dict(row)
            item.pop("spool_usage", None)
            item["usage_grams"] = round(grams, 2)
            item["model_grams"] = round(float(entry.get("grams") or 0), 2)
            item["waste_grams"] = round(float(entry.get("waste_grams") or 0), 2)
            item["usage_slot"] = entry.get("slot")
            usage.append(item)
    for row in activity_rows:
        item = dict(row)
        if spool_ref.search(item.get("detail") or ""):
            activity.append(item)
    spool["usage"] = usage
    spool["usage_count"] = len(usage)
    spool["usage_total_g"] = round(total_used, 2)
    spool["activity"] = activity
    return spool


def update_spool(spool_id: int, **fields) -> bool:
    allowed = {"material", "brand", "subtype", "color_hex", "color_name", "color_hex_2", "color_hex_3", "color_scheme",
               "label_weight_g", "remaining_g", "empty_spool_weight_g", "notes"}
    updates = {k: v for k, v in fields.items() if k in allowed}
    if "color_scheme" in updates:
        updates["color_scheme"] = _clean_spool_color_scheme(updates.get("color_scheme"))
    for key in ("color_hex_2", "color_hex_3"):
        if key in updates:
            updates[key] = _clean_optional_hex(updates.get(key))
    if not updates:
        return False
    cols = ", ".join(f"{k} = ?" for k in updates)
    vals = list(updates.values()) + [spool_id]
    with _conn() as conn:
        c = conn.execute(f"UPDATE spools SET {cols} WHERE id = ?", vals)
    return c.rowcount > 0


def delete_spool(spool_id: int) -> bool:
    with _conn() as conn:
        c = conn.execute("DELETE FROM spools WHERE id = ?", (spool_id,))
    return c.rowcount > 0


def archive_spool(spool_id: int) -> bool:
    with _conn() as conn:
        c = conn.execute(
            "UPDATE spools SET archived_at = CURRENT_TIMESTAMP WHERE id = ? AND archived_at IS NULL",
            (spool_id,),
        )
    if c.rowcount:
        log_decision("system", "spool_archived", f"Spool #{spool_id} archived")
    return c.rowcount > 0


def restore_spool(spool_id: int) -> bool:
    with _conn() as conn:
        c = conn.execute(
            "UPDATE spools SET archived_at = NULL WHERE id = ?",
            (spool_id,),
        )
    if c.rowcount:
        log_decision("system", "spool_restored", f"Spool #{spool_id} restored")
    return c.rowcount > 0


def reset_spool_weight(spool_id: int) -> bool:
    with _conn() as conn:
        c = conn.execute(
            "UPDATE spools SET remaining_g = label_weight_g WHERE id = ?",
            (spool_id,),
        )
    if c.rowcount:
        log_decision("system", "spool_weight_reset", f"Spool #{spool_id} weight reset to label weight")
    return c.rowcount > 0


def correct_spool_weight(
    spool_id: int,
    remaining_g: float,
    *,
    reading_g: Optional[float] = None,
    empty_spool_weight_g: Optional[float] = None,
) -> bool:
    updates = {"remaining_g": max(0.0, float(remaining_g))}
    if empty_spool_weight_g is not None:
        updates["empty_spool_weight_g"] = float(empty_spool_weight_g)
    cols = ", ".join(f"{k} = ?" for k in updates)
    vals = list(updates.values()) + [spool_id]
    with _conn() as conn:
        c = conn.execute(f"UPDATE spools SET {cols} WHERE id = ?", vals)
    if c.rowcount:
        detail = f"Spool #{spool_id} corrected to {updates['remaining_g']:.1f}g"
        if reading_g is not None:
            detail += f" from scale reading {float(reading_g):.1f}g"
        log_decision("system", "spool_weight_corrected", detail)
    return c.rowcount > 0


def move_spool(
    spool_id: int,
    printer_id: Optional[str],
    slot: Optional[int],
    storage_location_id: Optional[int] = None,
) -> dict:
    """Move spool to a new location. Returns {ok: bool, conflict_spool_id: int|None}."""
    with _conn() as conn:
        if printer_id is not None:
            conflict = conn.execute(
                """SELECT id FROM spools
                   WHERE location_printer_id = ? AND location_slot IS ?
                     AND archived_at IS NULL AND id != ?""",
                (printer_id, slot, spool_id),
            ).fetchone()
            if conflict:
                return {"ok": False, "conflict_spool_id": conflict["id"]}
        old = conn.execute(
            """SELECT location_printer_id, location_slot, storage_location_id, home_storage_location_id
               FROM spools WHERE id = ?""",
            (spool_id,),
        ).fetchone()
        old_storage_id = old["storage_location_id"] if old else None
        old_home_id = old["home_storage_location_id"] if old else None
        if printer_id is not None:
            target_storage_id = None
            target_home_id = old_home_id
            if old and old["location_printer_id"] is None and old_storage_id is not None:
                target_home_id = old_storage_id
            elif target_home_id is None and storage_location_id is not None:
                target_home_id = storage_location_id
        else:
            target_storage_id = storage_location_id if storage_location_id is not None else (old_home_id or old_storage_id)
            target_home_id = target_storage_id or old_home_id
        conn.execute(
            """UPDATE spools
               SET location_printer_id = ?, location_slot = ?,
                   storage_location_id = ?, home_storage_location_id = ?
               WHERE id = ?""",
            (printer_id, slot, target_storage_id, target_home_id, spool_id),
        )
    if old:
        old_loc = f"{old['location_printer_id']}:{old['location_slot']}" if old["location_printer_id"] else "storage"
        new_loc = f"{printer_id}:{slot}" if printer_id else f"storage:{target_storage_id or 'none'}"
        log_decision("system", "spool_moved", f"Spool #{spool_id} {old_loc} → {new_loc}")
    return {
        "ok": True,
        "conflict_spool_id": None,
        "storage_location_id": target_storage_id,
        "home_storage_location_id": target_home_id,
    }


def get_spool_locations(include_archived: bool = False) -> list:
    where = "" if include_archived else "WHERE archived_at IS NULL"
    with _conn() as conn:
        rows = conn.execute(
            f"""SELECT id, name, notes, sort_order, archived_at, created_at
                FROM spool_locations {where}
                ORDER BY sort_order, name"""
        ).fetchall()
    return [dict(r) for r in rows]


def create_spool_location(name: str, notes: Optional[str] = None) -> int:
    with _conn() as conn:
        max_order = conn.execute(
            "SELECT COALESCE(MAX(sort_order), 0) AS max_order FROM spool_locations"
        ).fetchone()["max_order"]
        cursor = conn.execute(
            "INSERT INTO spool_locations (name, notes, sort_order) VALUES (?, ?, ?)",
            (name.strip(), notes, int(max_order) + 10),
        )
        loc_id = cursor.lastrowid
    log_decision("system", "spool_location_added", f"Storage location #{loc_id} {name.strip()} added")
    return loc_id


def update_spool_location(location_id: int, name: str, notes: Optional[str] = None) -> bool:
    with _conn() as conn:
        c = conn.execute(
            "UPDATE spool_locations SET name = ?, notes = ? WHERE id = ?",
            (name.strip(), notes, location_id),
        )
    return c.rowcount > 0


def archive_spool_location(location_id: int) -> bool:
    with _conn() as conn:
        c = conn.execute(
            "UPDATE spool_locations SET archived_at = CURRENT_TIMESTAMP WHERE id = ? AND archived_at IS NULL",
            (location_id,),
        )
        if c.rowcount:
            conn.execute(
                "UPDATE spools SET storage_location_id = NULL WHERE storage_location_id = ?",
                (location_id,),
            )
            conn.execute(
                "UPDATE spools SET home_storage_location_id = NULL WHERE home_storage_location_id = ?",
                (location_id,),
            )
    return c.rowcount > 0


def get_spools_summary() -> dict:
    with _conn() as conn:
        row = conn.execute(
            """SELECT COUNT(*)                                                        AS total_count,
                      COALESCE(SUM(remaining_g), 0)                                  AS total_remaining_g,
                      COALESCE(SUM(label_weight_g - remaining_g), 0)                 AS total_consumed_g,
                      COALESCE(SUM(CASE WHEN location_printer_id IS NOT NULL THEN 1 ELSE 0 END), 0) AS in_printer_count
               FROM spools WHERE archived_at IS NULL"""
        ).fetchone()
        threshold_row = conn.execute(
            "SELECT value FROM settings WHERE key = 'spool_low_stock_pct'"
        ).fetchone()
        low_pct = float(threshold_row["value"]) if threshold_row else 20.0
        low_count = conn.execute(
            """SELECT COUNT(*) AS n FROM spools
               WHERE archived_at IS NULL AND label_weight_g > 0
                 AND (remaining_g * 100.0 / label_weight_g) < ?""",
            (low_pct,),
        ).fetchone()["n"]
        by_mat = conn.execute(
            """SELECT material, COALESCE(SUM(remaining_g), 0) AS grams
               FROM spools WHERE archived_at IS NULL
               GROUP BY material ORDER BY material"""
        ).fetchall()
    return {
        "total_count": row["total_count"],
        "total_remaining_g": round(row["total_remaining_g"], 1),
        "total_consumed_g": round(row["total_consumed_g"], 1),
        "in_printer_count": row["in_printer_count"],
        "low_stock_count": low_count,
        "low_stock_pct": low_pct,
        "by_material": [{"material": r["material"], "grams": round(r["grams"], 1)} for r in by_mat],
    }


def get_spool_intelligence(days: int = 30) -> dict:
    """Operational spool signals for the Spools dashboard."""
    import json
    days = max(1, min(int(days or 30), 365))
    since = f"-{days} days"
    with _conn() as conn:
        threshold_row = conn.execute(
            "SELECT value FROM settings WHERE key = 'spool_low_stock_pct'"
        ).fetchone()
        low_pct = float(threshold_row["value"]) if threshold_row else 20.0

        loaded_rows = conn.execute(
            """SELECT id, material, brand, subtype, color_hex, color_name, color_hex_2, color_hex_3, color_scheme,
                      label_weight_g, remaining_g, location_printer_id, location_slot
               FROM spools
               WHERE archived_at IS NULL AND location_printer_id IS NOT NULL
               ORDER BY location_printer_id, location_slot"""
        ).fetchall()

        unattributed = conn.execute(
            """SELECT COUNT(*) AS n,
                      COALESCE(SUM(filament_grams), 0) AS grams
               FROM prints
               WHERE final_state = 'FINISHED'
                 AND filament_grams IS NOT NULL
                 AND filament_grams > 0
                 AND spool_usage IS NULL
                 AND ended_at >= datetime('now', ?)""",
            (since,),
        ).fetchone()

        recent_prints = conn.execute(
            """SELECT id, printer_id, filename, subtask_name, ended_at, final_state, spool_usage
               FROM prints
               WHERE spool_usage IS NOT NULL
                 AND ended_at >= datetime('now', ?)
               ORDER BY ended_at DESC
               LIMIT 80""",
            (since,),
        ).fetchall()

        spool_rows = conn.execute(
            """SELECT id, material, brand, subtype, color_hex, color_name, color_hex_2, color_hex_3, color_scheme,
                      remaining_g, label_weight_g
               FROM spools"""
        ).fetchall()

        overdraw_rows = conn.execute(
            """SELECT print_id, printer_id, detail, logged_at
               FROM decisions
               WHERE event = 'spool_overdrawn'
                 AND logged_at >= datetime('now', ?)
               ORDER BY logged_at DESC
               LIMIT 8""",
            (since,),
        ).fetchall()

    spools = {int(r["id"]): dict(r) for r in spool_rows}

    loaded = []
    loaded_low = []
    for row in loaded_rows:
        item = dict(row)
        pct = (float(item["remaining_g"] or 0) * 100 / float(item["label_weight_g"] or 1)) if item.get("label_weight_g") else None
        item["remaining_pct"] = round(pct, 1) if pct is not None else None
        loaded.append(item)
        if pct is not None and pct < low_pct:
            loaded_low.append(item)

    usage_events = []
    total_deducted = 0.0
    usage_print_ids: set[int] = set()
    by_spool: dict[int, dict] = {}
    for row in recent_prints:
        try:
            entries = json.loads(row["spool_usage"] or "[]")
        except Exception:
            entries = []
        for entry in entries:
            spool_id = int(entry.get("spool_id") or 0)
            grams = float(entry.get("actual_grams") or entry.get("grams") or 0)
            if not spool_id or grams <= 0:
                continue
            spool = spools.get(spool_id, {})
            total_deducted += grams
            usage_print_ids.add(int(row["id"]))
            rec = by_spool.setdefault(spool_id, {
                "spool_id": spool_id,
                "grams": 0.0,
                "count": 0,
                "material": spool.get("material"),
                "brand": spool.get("brand"),
                "color_name": spool.get("color_name"),
                "color_hex": spool.get("color_hex"),
                "color_scheme": spool.get("color_scheme"),
            })
            rec["grams"] += grams
            rec["count"] += 1
            usage_events.append({
                "print_id": row["id"],
                "printer_id": row["printer_id"],
                "filename": row["filename"],
                "subtask_name": row["subtask_name"],
                "ended_at": row["ended_at"],
                "spool_id": spool_id,
                "slot": entry.get("slot"),
                "grams": round(grams, 1),
                "material": spool.get("material"),
                "brand": spool.get("brand"),
                "color_name": spool.get("color_name"),
                "color_hex": spool.get("color_hex"),
                "color_scheme": spool.get("color_scheme"),
            })

    usage_events.sort(key=lambda x: x.get("ended_at") or "", reverse=True)

    alerts = []
    if loaded_low:
        alerts.append({
            "level": "warn",
            "message": f"{len(loaded_low)} loaded spool{'s' if len(loaded_low) != 1 else ''} below {low_pct:.0f}%",
        })
    unattributed_count = int(unattributed["n"] or 0) if unattributed else 0
    if unattributed_count:
        alerts.append({
            "level": "watch",
            "message": f"{unattributed_count} finished print{'s' if unattributed_count != 1 else ''} had filament grams but no spool deduction",
        })
    overdraws = [dict(r) for r in overdraw_rows]
    if overdraws:
        alerts.append({
            "level": "warn",
            "message": f"{len(overdraws)} spool overdraw event{'s' if len(overdraws) != 1 else ''} in {days}d",
        })
    if not alerts:
        alerts.append({"level": "ok", "message": "Spool tracking is clean"})

    return {
        "days": days,
        "summary": {
            "deducted_g": round(total_deducted, 1),
            "deducted_prints": len(usage_print_ids),
            "usage_events": len(usage_events),
            "loaded_spools": len(loaded),
            "loaded_low": len(loaded_low),
            "unattributed_prints": unattributed_count,
            "unattributed_g": round(float(unattributed["grams"] or 0), 1) if unattributed else 0.0,
            "low_stock_pct": low_pct,
        },
        "alerts": alerts,
        "loaded_low": loaded_low,
        "recent_usage": usage_events[:10],
        "by_spool": sorted(
            [{**v, "grams": round(v["grams"], 1)} for v in by_spool.values()],
            key=lambda x: (-x["grams"], x["spool_id"]),
        )[:8],
        "overdraws": overdraws,
    }


def get_spools_by_printer(printer_id: str) -> dict:
    """Returns {slot_index: spool_dict} for active spools loaded on this printer."""
    with _conn() as conn:
        rows = conn.execute(
            """SELECT id, material, brand, subtype, color_hex, color_name, color_hex_2, color_hex_3, color_scheme,
                      label_weight_g, remaining_g, location_slot, notes
               FROM spools
               WHERE location_printer_id = ? AND archived_at IS NULL""",
            (printer_id,),
        ).fetchall()
    return {r["location_slot"]: dict(r) for r in rows}


def get_spool_at_slot(printer_id: str, slot: int) -> Optional[dict]:
    with _conn() as conn:
        row = conn.execute(
            """SELECT id, material, brand, color_hex, color_name, color_hex_2, color_hex_3, color_scheme, remaining_g, label_weight_g
               FROM spools
               WHERE location_printer_id = ? AND location_slot = ? AND archived_at IS NULL""",
            (printer_id, slot),
        ).fetchone()
    return dict(row) if row else None


def get_recent_spool_for_slot(printer_id: str, slot: int, limit: int = 25) -> Optional[int]:
    """Return the most recent print-start spool id captured for a printer slot."""
    import json
    with _conn() as conn:
        rows = conn.execute(
            """SELECT ams_slot_snapshot
               FROM prints
               WHERE printer_id = ? AND ams_slot_snapshot IS NOT NULL
               ORDER BY started_at DESC, id DESC
               LIMIT ?""",
            (printer_id, int(limit)),
        ).fetchall()
    key = str(int(slot))
    for row in rows:
        try:
            snapshot = json.loads(row["ams_slot_snapshot"] or "{}")
        except Exception:
            continue
        entry = snapshot.get(key)
        if isinstance(entry, dict) and entry.get("spool_id"):
            try:
                return int(entry["spool_id"])
            except (TypeError, ValueError):
                return None
    return None


def write_slot_snapshot(print_id: int, snapshot: dict) -> None:
    """Persist the enriched slot/gate snapshot (with spool_ids) to the prints row.

    No-op if a snapshot already exists — preserves the original print-start
    snapshot across service restarts (the condition that triggers this fires
    again after restart, but the original data must not be overwritten).
    """
    import json
    with _conn() as conn:
        conn.execute(
            "UPDATE prints SET ams_slot_snapshot = ? WHERE id = ? AND ams_slot_snapshot IS NULL",
            (json.dumps(snapshot), print_id),
        )


def deduct_spool_usage(
    printer_id: str,
    print_id: int,
    total_grams: float,
    active_slot: Optional[int] = None,
    filament_usage: Optional[list[dict]] = None,
) -> None:
    """Read stored slot snapshot, deduct grams from mapped spools, write spool_usage JSON."""
    import json
    with _conn() as conn:
        row = conn.execute(
            "SELECT ams_slot_snapshot FROM prints WHERE id = ?", (print_id,)
        ).fetchone()
        if not row or not row["ams_slot_snapshot"]:
            log.info("No slot snapshot for print %d, skipping spool deduction", print_id)
            return
        snapshot = json.loads(row["ams_slot_snapshot"])
        meta = snapshot.pop("__meta__", {}) if isinstance(snapshot, dict) else {}

    if active_slot is None:
        try:
            active_slot = int(meta.get("active_slot")) if meta.get("active_slot") is not None else None
        except (TypeError, ValueError):
            active_slot = None
    if active_slot is None:
        active_slots = [int(s) for s, d in snapshot.items() if isinstance(d, dict) and d.get("active")]
        if len(active_slots) == 1:
            active_slot = active_slots[0]

    # snapshot: {slot_str: {... "spool_id": int|null}}
    slot_snapshot = {int(s): d for s, d in snapshot.items() if isinstance(d, dict)}
    slots_with = [(slot, d["spool_id"]) for slot, d in slot_snapshot.items() if d.get("spool_id")]
    slots_without = [slot for slot, d in slot_snapshot.items() if not d.get("spool_id")]

    # Attribute grams: sliced colour/material usage first, then active slot, then equal split.
    slot_grams: dict[int, float] = {}
    if filament_usage:
        reqs = _normalise_filament_usage(filament_usage)
        req_total = sum(r["used_g"] for r in reqs)
        used_slots: set[int] = set()
        if req_total > 0:
            available = [
                (slot, sid, slot_snapshot.get(slot, {}))
                for slot, sid in slots_with
            ]
            for req in reqs:
                matches = [
                    item for item in available
                    if item[0] not in used_slots
                    and _usage_material_matches(req["material"], item[2].get("type"))
                ] or [item for item in available if item[0] not in used_slots] or available
                if not matches:
                    continue
                best = min(
                    matches,
                    key=lambda item: (
                        _hex_distance(req["color"], item[2].get("color")),
                        item[0],
                    ),
                )
                slot = best[0]
                used_slots.add(slot)
                slot_grams[slot] = slot_grams.get(slot, 0.0) + total_grams * (req["used_g"] / req_total)

    if not slot_grams and active_slot is not None and any(s == active_slot for s, _ in slots_with):
        slot_grams[active_slot] = total_grams
    elif not slot_grams and slots_with:
        per = total_grams / len(slots_with)
        for s, _ in slots_with:
            slot_grams[s] = per

    spool_usage = []
    spool_id_map = {s: sid for s, sid in slots_with}

    with _conn() as conn:
        decision_logs = []
        for slot, grams in slot_grams.items():
            spool_id = spool_id_map[slot]
            cur = conn.execute("SELECT remaining_g FROM spools WHERE id = ?", (spool_id,)).fetchone()
            if not cur:
                continue
            old_r = cur["remaining_g"]
            new_r = max(0.0, old_r - grams)
            conn.execute("UPDATE spools SET remaining_g = ? WHERE id = ?", (new_r, spool_id))
            usage = {
                "spool_id": spool_id,
                "grams": round(grams, 2),
                "slot": slot,
                "remaining_before_g": round(float(old_r), 2),
                "remaining_after_g": round(float(new_r), 2),
            }
            if filament_usage:
                usage["attribution"] = "filament_usage"
            start_g = slot_snapshot.get(slot, {}).get("remaining_g_at_start")
            if start_g is not None:
                try:
                    usage["remaining_start_g"] = round(float(start_g), 2)
                except (TypeError, ValueError):
                    pass
            spool_usage.append(usage)
            if old_r - grams < 0:
                decision_logs.append(("spool_overdrawn",
                                      f"Spool #{spool_id} slot {slot}: tried to deduct {grams:.1f}g "
                                      f"but only {old_r:.1f}g remained; clamped to 0"))
            else:
                decision_logs.append(("spool_deducted",
                                      f"Spool #{spool_id} slot {slot}: {grams:.1f}g deducted "
                                      f"({old_r:.1f}g -> {new_r:.1f}g)"))

        for slot in slots_without:
            unattr = slot_grams.get(slot, 0.0) if not slots_with else 0.0
            decision_logs.append(("spool_missing",
                                  f"Slot {slot}: no spool assigned; {unattr:.1f}g unattributed"))

        if spool_usage:
            conn.execute(
                "UPDATE prints SET spool_usage = ? WHERE id = ?",
                (json.dumps(spool_usage), print_id),
            )

    for event, detail in decision_logs:
        log_decision(printer_id, event, detail, print_id=print_id)


def _normalise_filament_usage(rows: list[dict]) -> list[dict]:
    out: list[dict] = []
    for row in rows or []:
        if not isinstance(row, dict):
            continue
        try:
            used_g = float(row.get("used_g") or row.get("grams") or 0)
        except (TypeError, ValueError):
            used_g = 0.0
        if used_g <= 0:
            continue
        out.append({
            "material": _normalise_material(row.get("type") or row.get("material")),
            "color": _normalise_hex(row.get("color")),
            "used_g": used_g,
        })
    return out


def _normalise_material(value) -> str:
    import re
    return re.sub(r"[^a-z0-9]+", "", str(value or "").lower())


def _normalise_hex(value) -> str:
    import re
    text = str(value or "").strip().lstrip("#")[:6].upper()
    return f"#{text}" if re.fullmatch(r"[0-9A-F]{6}", text) else ""


def _usage_material_matches(wanted: str, got) -> bool:
    material = _normalise_material(got)
    return bool(wanted and material and (wanted in material or material in wanted))


def _hex_distance(a, b) -> int:
    a = _normalise_hex(a)
    b = _normalise_hex(b)
    if not a or not b:
        return 999
    try:
        av = tuple(int(a[i:i + 2], 16) for i in (1, 3, 5))
        bv = tuple(int(b[i:i + 2], 16) for i in (1, 3, 5))
    except ValueError:
        return 999
    return sum(abs(x - y) for x, y in zip(av, bv))


def reconcile_spool_usage(
    print_id: int,
    spool_id: int,
    actual_remaining_g: float,
    *,
    start_remaining_g: Optional[float] = None,
    exclusive: bool = False,
    reading_g: Optional[float] = None,
    empty_spool_weight_g: Optional[float] = None,
) -> Optional[dict]:
    """Correct a spool after re-weighing and annotate the print's recorded usage."""
    import json
    actual_remaining = max(0.0, float(actual_remaining_g))
    with _conn() as conn:
        prow = conn.execute(
            "SELECT id, printer_id, spool_usage FROM prints WHERE id = ?",
            (print_id,),
        ).fetchone()
        if not prow:
            return None
        spool = conn.execute(
            "SELECT id, remaining_g FROM spools WHERE id = ?",
            (spool_id,),
        ).fetchone()
        if not spool:
            return None

        try:
            usage = json.loads(prow["spool_usage"] or "[]")
        except Exception:
            usage = []

        target = None
        for entry in usage:
            if int(entry.get("spool_id") or 0) == int(spool_id):
                target = entry
                break
        if target is None:
            target = {"spool_id": spool_id, "grams": 0}
            usage.append(target)

        recorded = float(target.get("grams") or 0)
        current_remaining = float(spool["remaining_g"] or 0)
        start_remaining = start_remaining_g
        if start_remaining is None:
            start_remaining = target.get("remaining_start_g")
        if start_remaining is None:
            start_remaining = target.get("remaining_before_g")
        try:
            start_remaining = float(start_remaining)
        except (TypeError, ValueError):
            start_remaining = current_remaining + recorded

        restored = []
        if exclusive:
            for entry in list(usage):
                other_id = int(entry.get("spool_id") or 0)
                if not other_id or other_id == int(spool_id):
                    continue
                restore_g = float(entry.get("actual_grams") or entry.get("grams") or 0)
                if restore_g > 0:
                    conn.execute(
                        "UPDATE spools SET remaining_g = remaining_g + ? WHERE id = ?",
                        (restore_g, other_id),
                    )
                    restored.append({"spool_id": other_id, "grams": round(restore_g, 2)})
            usage = [target]

        actual_loss = max(0.0, start_remaining - actual_remaining)
        waste = max(0.0, actual_loss - recorded)
        target["actual_grams"] = round(actual_loss, 2)
        target["waste_grams"] = round(waste, 2)
        target["remaining_start_g"] = round(start_remaining, 2)
        target["remaining_after_g"] = round(actual_remaining, 2)
        target["reconciled_at"] = datetime.utcnow().isoformat()
        if reading_g is not None:
            target["scale_reading_g"] = round(float(reading_g), 2)
        if empty_spool_weight_g is not None:
            target["empty_spool_weight_g"] = round(float(empty_spool_weight_g), 2)

        updates = ["remaining_g = ?"]
        vals = [actual_remaining]
        if empty_spool_weight_g is not None:
            updates.append("empty_spool_weight_g = ?")
            vals.append(float(empty_spool_weight_g))
        vals.append(spool_id)
        conn.execute(f"UPDATE spools SET {', '.join(updates)} WHERE id = ?", vals)
        conn.execute(
            "UPDATE prints SET spool_usage = ? WHERE id = ?",
            (json.dumps(usage), print_id),
        )

    detail = (
        f"Spool #{spool_id} reconciled: recorded {recorded:.1f}g, "
        f"actual {actual_loss:.1f}g"
    )
    if waste > 0:
        detail += f", purge/waste {waste:.1f}g"
    if restored:
        detail += f", restored {len(restored)} other spool(s)"
    log_decision(prow["printer_id"], "spool_reconciled", detail, print_id=print_id)
    return {
        "spool_id": spool_id,
        "remaining_g": round(actual_remaining, 1),
        "recorded_grams": round(recorded, 2),
        "actual_grams": round(actual_loss, 2),
        "waste_grams": round(waste, 2),
        "restored": restored,
    }


# ── print queue ───────────────────────────────────────────────────────────

def queue_add(
    printer_id: str,
    filename: str,
    file_path: str,
    file_size: int,
    *,
    preview_png: Optional[bytes] = None,
    estimated_seconds: Optional[int] = None,
    filament_weight_g: Optional[float] = None,
    filament_type: Optional[str] = None,
    filament_colors: Optional[str] = None,
) -> int:
    with _conn() as conn:
        row = conn.execute(
            "SELECT COALESCE(MAX(position), 0) + 1 AS next FROM print_queue WHERE printer_id = ?",
            (printer_id,),
        ).fetchone()
        position = row["next"]
        cursor = conn.execute(
            """INSERT INTO print_queue
               (printer_id, position, filename, file_path, file_size,
                preview_png, estimated_seconds, filament_weight_g, filament_type, filament_colors)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (printer_id, position, filename, file_path, file_size,
             preview_png, estimated_seconds, filament_weight_g, filament_type, filament_colors),
        )
        return cursor.lastrowid


def queue_list(printer_id: Optional[str] = None) -> list[dict]:
    _STATUS_ORDER = "CASE status WHEN 'printing' THEN 0 WHEN 'uploading' THEN 1 WHEN 'pending' THEN 2 ELSE 3 END"
    with _conn() as conn:
        if printer_id:
            rows = conn.execute(
                f"""SELECT id, printer_id, position, filename, file_size, status,
                           estimated_seconds, filament_weight_g, filament_type, filament_colors,
                           created_at, started_at, finished_at, error_msg,
                           (preview_png IS NOT NULL) AS has_preview
                    FROM print_queue WHERE printer_id = ?
                    ORDER BY {_STATUS_ORDER}, position, id""",
                (printer_id,),
            ).fetchall()
        else:
            rows = conn.execute(
                f"""SELECT id, printer_id, position, filename, file_size, status,
                           estimated_seconds, filament_weight_g, filament_type, filament_colors,
                           created_at, started_at, finished_at, error_msg,
                           (preview_png IS NOT NULL) AS has_preview
                    FROM print_queue
                    ORDER BY printer_id, {_STATUS_ORDER}, position, id""",
            ).fetchall()
    return [dict(r) for r in rows]


def queue_get_preview(job_id: int) -> Optional[bytes]:
    with _conn() as conn:
        row = conn.execute(
            "SELECT preview_png FROM print_queue WHERE id = ?", (job_id,)
        ).fetchone()
    return row["preview_png"] if row else None


def queue_get(job_id: int) -> Optional[dict]:
    with _conn() as conn:
        row = conn.execute(
            """SELECT id, printer_id, position, filename, file_path, file_size,
                      status, estimated_seconds, filament_weight_g, filament_type, filament_colors,
                      created_at, started_at, finished_at, error_msg
               FROM print_queue WHERE id = ?""",
            (job_id,),
        ).fetchone()
    return dict(row) if row else None


def queue_active_job(printer_id: str) -> Optional[dict]:
    with _conn() as conn:
        row = conn.execute(
            """SELECT id, printer_id, filename, file_path, status,
                      estimated_seconds, filament_weight_g, filament_type, filament_colors,
                      started_at
               FROM print_queue
               WHERE printer_id = ? AND status IN ('printing', 'uploading')
               ORDER BY started_at DESC, id DESC
               LIMIT 1""",
            (printer_id,),
        ).fetchone()
    return dict(row) if row else None


def queue_update_metadata(
    job_id: int,
    *,
    estimated_seconds: Optional[int] = None,
    filament_weight_g: Optional[float] = None,
    filament_type: Optional[str] = None,
    filament_colors: Optional[str] = None,
) -> None:
    with _conn() as conn:
        conn.execute(
            """UPDATE print_queue
               SET estimated_seconds = COALESCE(?, estimated_seconds),
                   filament_weight_g = COALESCE(?, filament_weight_g),
                   filament_type = COALESCE(?, filament_type),
                   filament_colors = COALESCE(?, filament_colors)
               WHERE id = ?""",
            (estimated_seconds, filament_weight_g, filament_type, filament_colors, job_id),
        )


def queue_update_status(job_id: int, status: str, error_msg: Optional[str] = None) -> bool:
    with _conn() as conn:
        if error_msg is not None:
            c = conn.execute(
                "UPDATE print_queue SET status = ?, error_msg = ? WHERE id = ?",
                (status, error_msg, job_id),
            )
        else:
            c = conn.execute(
                "UPDATE print_queue SET status = ? WHERE id = ?", (status, job_id)
            )
    return c.rowcount > 0


def queue_set_started(job_id: int) -> bool:
    with _conn() as conn:
        c = conn.execute(
            "UPDATE print_queue SET status = 'printing', started_at = datetime('now') WHERE id = ?",
            (job_id,),
        )
    return c.rowcount > 0


def queue_finish_active(printer_id: str) -> int:
    with _conn() as conn:
        c = conn.execute(
            """UPDATE print_queue SET status = 'done', finished_at = datetime('now')
               WHERE printer_id = ? AND status IN ('printing', 'uploading')""",
            (printer_id,),
        )
    return c.rowcount


def queue_cancel_active(printer_id: str, status: str = "cancelled") -> int:
    with _conn() as conn:
        c = conn.execute(
            "UPDATE print_queue SET status = ? WHERE printer_id = ? AND status IN ('printing', 'uploading')",
            (status, printer_id),
        )
    return c.rowcount


def queue_delete(job_id: int) -> tuple[bool, Optional[str]]:
    """Delete a pending/failed/cancelled job. Returns (deleted, file_path)."""
    with _conn() as conn:
        row = conn.execute(
            "SELECT file_path FROM print_queue WHERE id = ? AND status IN ('pending', 'failed', 'cancelled')",
            (job_id,),
        ).fetchone()
        if not row:
            return False, None
        conn.execute("DELETE FROM print_queue WHERE id = ?", (job_id,))
    return True, row["file_path"]


def queue_next_pending(printer_id: str) -> Optional[dict]:
    with _conn() as conn:
        row = conn.execute(
            """SELECT id, printer_id, filename, file_path,
                      estimated_seconds, filament_weight_g, filament_type, filament_colors
               FROM print_queue
               WHERE printer_id = ? AND status = 'pending'
               ORDER BY position ASC, id ASC LIMIT 1""",
            (printer_id,),
        ).fetchone()
    return dict(row) if row else None


def queue_retry(job_id: int) -> bool:
    """Reset a failed/cancelled job to pending."""
    with _conn() as conn:
        c = conn.execute(
            """UPDATE print_queue SET status = 'pending', error_msg = NULL, started_at = NULL
               WHERE id = ? AND status IN ('failed', 'cancelled')""",
            (job_id,),
        )
    return c.rowcount > 0


def queue_clear_completed(printer_id: str) -> list[str]:
    """Delete done/failed/cancelled jobs for a printer. Returns file_paths deleted."""
    with _conn() as conn:
        rows = conn.execute(
            """SELECT file_path FROM print_queue
               WHERE printer_id = ? AND status IN ('done', 'failed', 'cancelled')""",
            (printer_id,),
        ).fetchall()
        conn.execute(
            "DELETE FROM print_queue WHERE printer_id = ? AND status IN ('done', 'failed', 'cancelled')",
            (printer_id,),
        )
    return [r["file_path"] for r in rows]


def queue_pending_counts() -> dict:
    """Return {printer_id: pending_count} for all printers with queued pending jobs."""
    with _conn() as conn:
        rows = conn.execute(
            "SELECT printer_id, COUNT(*) AS n FROM print_queue WHERE status = 'pending' GROUP BY printer_id"
        ).fetchall()
    return {r["printer_id"]: r["n"] for r in rows}


def queue_reorder(job_id: int, direction: str) -> bool:
    with _conn() as conn:
        job = conn.execute(
            "SELECT printer_id, position FROM print_queue WHERE id = ? AND status = 'pending'",
            (job_id,),
        ).fetchone()
        if not job:
            return False
        pid, pos = job["printer_id"], job["position"]
        if direction == "up":
            nbr = conn.execute(
                """SELECT id, position FROM print_queue
                   WHERE printer_id = ? AND status = 'pending' AND position < ?
                   ORDER BY position DESC LIMIT 1""",
                (pid, pos),
            ).fetchone()
        else:
            nbr = conn.execute(
                """SELECT id, position FROM print_queue
                   WHERE printer_id = ? AND status = 'pending' AND position > ?
                   ORDER BY position ASC LIMIT 1""",
                (pid, pos),
            ).fetchone()
        if not nbr:
            return False
        conn.execute("UPDATE print_queue SET position = ? WHERE id = ?", (nbr["position"], job_id))
        conn.execute("UPDATE print_queue SET position = ? WHERE id = ?", (pos, nbr["id"]))
    return True
