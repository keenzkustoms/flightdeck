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
                material      TEXT PRIMARY KEY,
                cost_per_gram REAL NOT NULL,
                updated_at    TEXT NOT NULL
            );
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
    """Return all decisions for a given print row, ordered by time."""
    with _conn() as conn:
        rows = conn.execute(
            "SELECT id, event, detail, logged_at FROM decisions WHERE print_id = ? ORDER BY logged_at",
            (print_id,),
        ).fetchall()
    return [dict(r) for r in rows]


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
    return {r["key"]: r["value"] for r in rows}


def set_setting(key: str, value: str) -> None:
    with _conn() as conn:
        conn.execute(
            """INSERT INTO settings (key, value, updated_at)
               VALUES (?, ?, CURRENT_TIMESTAMP)
               ON CONFLICT(key) DO UPDATE
               SET value = excluded.value, updated_at = excluded.updated_at""",
            (key, value),
        )


# ── material costs ────────────────────────────────────────────────────────

def get_material_costs() -> dict:
    with _conn() as conn:
        rows = conn.execute("SELECT material, cost_per_gram FROM material_costs").fetchall()
    return {r["material"]: r["cost_per_gram"] for r in rows}


def set_material_cost(material: str, cost_per_gram: float) -> None:
    with _conn() as conn:
        conn.execute(
            """INSERT INTO material_costs (material, cost_per_gram, updated_at)
               VALUES (?, ?, CURRENT_TIMESTAMP)
               ON CONFLICT(material) DO UPDATE
               SET cost_per_gram = excluded.cost_per_gram, updated_at = excluded.updated_at""",
            (material, cost_per_gram),
        )


def get_filament_summary(printer_id: Optional[str] = None) -> dict:
    """Aggregate filament usage: totals, by material, by month (last 12), by printer."""
    where = "WHERE final_state = 'FINISHED' AND filament_grams IS NOT NULL"
    params_base: list = []
    if printer_id:
        where += " AND printer_id = ?"
        params_base.append(printer_id)

    with _conn() as conn:
        costs = {r["material"]: r["cost_per_gram"]
                 for r in conn.execute("SELECT material, cost_per_gram FROM material_costs").fetchall()}

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
