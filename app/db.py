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
            CREATE TABLE IF NOT EXISTS print_history (
                id                INTEGER PRIMARY KEY AUTOINCREMENT,
                printer_id        TEXT NOT NULL,
                filename          TEXT NOT NULL,
                started_at        TEXT,
                finished_at       TEXT,
                cancelled         INTEGER NOT NULL DEFAULT 0,
                cancelled_at_pct  REAL,
                filament_type     TEXT,
                filament_weight_g REAL
            );
        """)


@contextmanager
def _conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


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


def get_last_print(printer_id: str) -> Optional[dict]:
    with _conn() as conn:
        row = conn.execute(
            """SELECT filename, started_at, finished_at, filament_type, filament_weight_g
               FROM print_history WHERE printer_id = ? AND cancelled = 0
               ORDER BY id DESC LIMIT 1""",
            (printer_id,),
        ).fetchone()
    return dict(row) if row else None


def log_print(
    printer_id: str,
    filename: str,
    *,
    started_at: Optional[datetime] = None,
    finished_at: Optional[datetime] = None,
    cancelled: bool = False,
    cancelled_at_pct: Optional[float] = None,
    filament_type: Optional[str] = None,
    filament_weight_g: Optional[float] = None,
) -> None:
    with _conn() as conn:
        conn.execute(
            """INSERT INTO print_history
               (printer_id, filename, started_at, finished_at,
                cancelled, cancelled_at_pct, filament_type, filament_weight_g)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                printer_id, filename,
                started_at.isoformat() if started_at else None,
                finished_at.isoformat() if finished_at else None,
                1 if cancelled else 0,
                cancelled_at_pct,
                filament_type,
                filament_weight_g,
            ),
        )
    log.info("print_history: %s %s cancelled=%s", printer_id, filename, cancelled)
