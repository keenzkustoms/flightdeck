from __future__ import annotations
import sqlite3
import logging
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

log = logging.getLogger(__name__)

DB_PATH = Path(__file__).parent.parent / "flightdeck.db"


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

            DROP TABLE IF EXISTS print_history;
        """)
    # Migrate existing DB: add columns if missing
    with _conn() as conn:
        for stmt in (
            "ALTER TABLE printer_state ADD COLUMN last_seen TEXT",
            "ALTER TABLE prints ADD COLUMN snapshot_jpeg BLOB",
            "ALTER TABLE prints ADD COLUMN snapshot_captured_at TIMESTAMP",
            "ALTER TABLE prints ADD COLUMN estimated_duration_seconds INTEGER",
        ):
            try:
                conn.execute(stmt)
            except Exception:
                pass
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
) -> None:
    ts = (started_at or datetime.utcnow()).isoformat()
    with _conn() as conn:
        conn.execute(
            """INSERT INTO prints
               (printer_id, job_key, filename, subtask_name, started_at, layers_total, material)
               VALUES (?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(printer_id, job_key) DO NOTHING""",
            (printer_id, job_key, filename, subtask_name, ts, layers_total, material),
        )
    log.info("print started: %s key=%s file=%s", printer_id, job_key, filename)


def on_print_finished(
    printer_id: str,
    job_key: str,
    *,
    ended_at: Optional[datetime] = None,
    layers_completed: Optional[int] = None,
    filament_grams: Optional[float] = None,
) -> None:
    now = (ended_at or datetime.utcnow()).isoformat()
    with _conn() as conn:
        conn.execute(
            """UPDATE prints
               SET ended_at         = ?,
                   duration_seconds = CAST(
                       (julianday(?) - julianday(started_at)) * 86400 AS INTEGER),
                   final_state      = 'FINISHED',
                   layers_completed = COALESCE(?, layers_completed),
                   filament_grams   = COALESCE(?, filament_grams)
               WHERE printer_id = ? AND job_key = ? AND final_state IS NULL""",
            (now, now, layers_completed, filament_grams, printer_id, job_key),
        )
    _cal_cache.pop(printer_id, None)
    log.info("print finished: %s key=%s", printer_id, job_key)


def on_print_ended(
    printer_id: str,
    job_key: str,
    *,
    final_state: str,           # 'CANCELLED' | 'ERROR'
    ended_at: Optional[datetime] = None,
    layers_completed: Optional[int] = None,
    error_message: Optional[str] = None,
) -> None:
    now = (ended_at or datetime.utcnow()).isoformat()
    with _conn() as conn:
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


def get_prints_for_day(printer_id: str, date_str: str) -> list[dict]:
    """All prints (any state) whose started_at is on the given UTC date (YYYY-MM-DD)."""
    with _conn() as conn:
        rows = conn.execute(
            """SELECT id, filename, subtask_name, started_at, ended_at,
                      duration_seconds, final_state, error_message,
                      layers_total, layers_completed, filament_grams, material,
                      snapshot_captured_at IS NOT NULL AS has_snapshot
               FROM prints
               WHERE printer_id = ? AND date(started_at) = ?
               ORDER BY started_at""",
            (printer_id, date_str),
        ).fetchall()
    return [dict(r) for r in rows]


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
) -> int:
    """Close every open (final_state IS NULL) row for a printer. Returns row count."""
    now = datetime.utcnow().isoformat()
    with _conn() as conn:
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
    return n


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
