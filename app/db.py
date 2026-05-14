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
                finished_at  TEXT
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


def get_last_print(printer_id: str) -> Optional[dict]:
    with _conn() as conn:
        row = conn.execute(
            """SELECT filename, subtask_name, duration_seconds, final_state,
                      layers_completed, layers_total
               FROM prints
               WHERE printer_id = ? AND final_state IS NOT NULL
               ORDER BY started_at DESC LIMIT 1""",
            (printer_id,),
        ).fetchone()
    return dict(row) if row else None
