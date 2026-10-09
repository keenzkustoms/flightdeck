#!/usr/bin/env python3
"""Migrate FlightDeck spool storage to the six-drawer physical layout.

Creates 162 permanent drawer slots:
  D1..D6, three rows per drawer, nine positions per row.
Global spool positions run #1..#162.

Existing FlightDeck spool **display** numbers (the label) are the physical drawer-home
numbers. If a spool has already been assigned into drawer storage, this migration
normalises it back to its matching numbered position. Spools that are currently loaded in
a printer, or visiting SUNLU, get their matching Home reserved without changing
their Current location. Legacy-stored spools that have not been assigned yet are
left alone for Fast Assign.

Drawer moves are also guarded at the database layer. Once a numbered spool is
sent to drawer storage, FlightDeck redirects it to the drawer position with the
same **display_id**, regardless of which older storage UI path initiated the move.

Also creates SUNLU Dryer as a temporary location. A small SQLite trigger keeps a
spool's home_storage_location_id unchanged while its current storage location is
SUNLU Dryer, so moving it back with the existing FlightDeck move path returns it
to its remembered drawer slot.

The migration is deliberately non-destructive. Existing Shelf #1/#2/#3
locations are archived only when no active spool currently uses them as either
current storage or home. Occupied legacy locations remain visible until those
spools have been assigned real drawer slots.
"""
from __future__ import annotations

import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.paths import DB_PATH

DRAWERS = 6
ROWS_PER_DRAWER = 3
SLOTS_PER_ROW = 9
TOTAL_SLOTS = DRAWERS * ROWS_PER_DRAWER * SLOTS_PER_ROW
SUNLU_NAME = "SUNLU Dryer"
SUNLU_NOTE = "[temporary] SUNLU filament dryer; current location only, never replaces spool home"


def slot_name(number: int) -> str:
    per_drawer = ROWS_PER_DRAWER * SLOTS_PER_ROW
    drawer = ((number - 1) // per_drawer) + 1
    within_drawer = (number - 1) % per_drawer
    row = (within_drawer // SLOTS_PER_ROW) + 1
    return f"D{drawer} R{row} #{number}"


def ensure_location(conn: sqlite3.Connection, name: str, notes: str, sort_order: int) -> int:
    row = conn.execute("SELECT id, archived_at FROM spool_locations WHERE name = ?", (name,)).fetchone()
    if row:
        conn.execute(
            "UPDATE spool_locations SET notes = ?, sort_order = ?, archived_at = NULL WHERE id = ?",
            (notes, sort_order, row[0]),
        )
        return int(row[0])
    cur = conn.execute(
        "INSERT INTO spool_locations (name, notes, sort_order) VALUES (?, ?, ?)",
        (name, notes, sort_order),
    )
    return int(cur.lastrowid)


def column_names(conn: sqlite3.Connection, table: str) -> set[str]:
    return {str(row[1]) for row in conn.execute(f"PRAGMA table_info({table})")}


def normalise_numbered_homes(
    conn: sqlite3.Connection,
    slot_ids: dict[int, int],
    drawer_location_ids: set[int],
    sunlu_id: int,
) -> tuple[int, int]:
    """Repair numbered drawer homes without auto-placing untouched legacy spools.

    Rules:
      * An active spool's **display_id** (the number on the label) owns drawer home #N.
      * If it is already in any drawer slot, correct both Current and Home to that
        matching numbered slot. This fixes id/display drift (S96 parked at #97).
      * If it is currently loaded in a printer or in SUNLU, reserve the matching
        Home only and leave Current untouched.
      * If it is still sitting in legacy storage and has never entered a drawer,
        leave it for Fast Assign.
    """
    cols = column_names(conn, "spools")
    if not {"id", "storage_location_id", "home_storage_location_id"}.issubset(cols):
        return 0, 0

    printer_col = "location_printer_id" if "location_printer_id" in cols else None
    has_display = "display_id" in cols
    select_cols = ["id", "storage_location_id", "home_storage_location_id"]
    if has_display:
        select_cols.append("display_id")
    if printer_col:
        select_cols.append(printer_col)

    rows = conn.execute(
        f"SELECT {', '.join(select_cols)} FROM spools WHERE archived_at IS NULL"
    ).fetchall()

    repaired_drawer = 0
    reserved_away = 0
    for row in rows:
        row = dict(zip(select_cols, row))
        spool_id = int(row["id"])
        number = int(row["display_id"]) if has_display and row.get("display_id") is not None else spool_id
        if number < 1 or number > TOTAL_SLOTS:
            continue
        target_id = slot_ids.get(number)
        if target_id is None:
            continue

        current_id = int(row["storage_location_id"]) if row["storage_location_id"] is not None else None
        home_id = int(row["home_storage_location_id"]) if row["home_storage_location_id"] is not None else None
        printer_id = row.get(printer_col) if printer_col else None

        if current_id in drawer_location_ids:
            if current_id != target_id or home_id != target_id:
                conn.execute(
                    "UPDATE spools SET storage_location_id = ?, home_storage_location_id = ? WHERE id = ?",
                    (target_id, target_id, spool_id),
                )
                repaired_drawer += 1
            continue

        is_away = bool(printer_id) or current_id == sunlu_id
        if is_away and home_id != target_id:
            conn.execute(
                "UPDATE spools SET home_storage_location_id = ? WHERE id = ?",
                (target_id, spool_id),
            )
            reserved_away += 1
        elif home_id is not None and home_id in drawer_location_ids and home_id != target_id:
            # Already has a drawer home but it's the wrong number (id vs display drift).
            # Keep Current if away/null; otherwise bring Current along to the correct home.
            if current_id is None or is_away:
                conn.execute(
                    "UPDATE spools SET home_storage_location_id = ? WHERE id = ?",
                    (target_id, spool_id),
                )
            else:
                conn.execute(
                    "UPDATE spools SET storage_location_id = ?, home_storage_location_id = ? WHERE id = ?",
                    (target_id, target_id, spool_id),
                )
            repaired_drawer += 1

    return repaired_drawer, reserved_away


def install_numbered_drawer_guard(
    conn: sqlite3.Connection,
    slot_ids: dict[int, int],
) -> None:
    """Redirect drawer moves to the home matching the spool's label number (display_id)."""
    drawer_ids_sql = ", ".join(str(value) for value in sorted(slot_ids.values()))
    cases = " ".join(
        f"WHEN {number} THEN {location_id}"
        for number, location_id in sorted(slot_ids.items())
    )
    # Prefer display_id (label); fall back to id for ancient rows.
    target_case = f"CASE COALESCE(NEW.display_id, NEW.id) {cases} END"

    conn.execute("DROP TRIGGER IF EXISTS enforce_numbered_drawer_home")
    conn.execute(
        f"""
        CREATE TRIGGER enforce_numbered_drawer_home
        AFTER UPDATE OF storage_location_id ON spools
        WHEN COALESCE(NEW.display_id, NEW.id) BETWEEN 1 AND {TOTAL_SLOTS}
         AND NEW.storage_location_id IN ({drawer_ids_sql})
         AND NEW.storage_location_id IS NOT ({target_case})
        BEGIN
            UPDATE spools
               SET storage_location_id = ({target_case}),
                   home_storage_location_id = ({target_case})
             WHERE id = NEW.id;
        END
        """
    )


def main() -> None:
    conn = sqlite3.connect(DB_PATH)
    try:
        conn.execute("PRAGMA foreign_keys = ON")
        created = 0
        slot_ids: dict[int, int] = {}
        for number in range(1, TOTAL_SLOTS + 1):
            name = slot_name(number)
            existed = conn.execute("SELECT 1 FROM spool_locations WHERE name = ?", (name,)).fetchone()
            loc_id = ensure_location(
                conn,
                name,
                f"Permanent spool home: {name}",
                1000 + number,
            )
            slot_ids[number] = loc_id
            if not existed:
                created += 1

        sunlu_id = ensure_location(conn, SUNLU_NAME, SUNLU_NOTE, 900)

        # move_spool() currently treats any storage-to-storage move as a new home.
        # This persistent DB trigger makes SUNLU the exception: it is a temporary
        # current location and cannot steal a spool's remembered drawer home.
        conn.execute("DROP TRIGGER IF EXISTS preserve_spool_home_in_sunlu")
        conn.execute(
            f"""
            CREATE TRIGGER preserve_spool_home_in_sunlu
            AFTER UPDATE OF storage_location_id, home_storage_location_id ON spools
            WHEN NEW.storage_location_id = {sunlu_id}
             AND OLD.home_storage_location_id IS NOT NULL
             AND NEW.home_storage_location_id IS NOT OLD.home_storage_location_id
            BEGIN
                UPDATE spools
                   SET home_storage_location_id = OLD.home_storage_location_id
                 WHERE id = NEW.id;
            END
            """
        )

        # Older Quick Move paths can still target a drawer row/slot directly.
        # Once the target is any drawer location, enforce the numbered Home rule.
        install_numbered_drawer_guard(conn, slot_ids)

        repaired_drawer, reserved_away = normalise_numbered_homes(
            conn,
            slot_ids,
            set(slot_ids.values()),
            sunlu_id,
        )

        archived_legacy = []
        retained_legacy = []
        for legacy in ("Shelf #1", "Shelf #2", "Shelf #3"):
            row = conn.execute(
                "SELECT id FROM spool_locations WHERE name = ? AND archived_at IS NULL",
                (legacy,),
            ).fetchone()
            if not row:
                continue
            loc_id = int(row[0])
            usage = conn.execute(
                """SELECT COUNT(*) FROM spools
                   WHERE archived_at IS NULL
                     AND (storage_location_id = ? OR home_storage_location_id = ?)""",
                (loc_id, loc_id),
            ).fetchone()[0]
            if usage:
                retained_legacy.append(f"{legacy} ({usage} spool(s))")
            else:
                conn.execute(
                    "UPDATE spool_locations SET archived_at = CURRENT_TIMESTAMP WHERE id = ?",
                    (loc_id,),
                )
                archived_legacy.append(legacy)

        conn.commit()
        print(f"Drawer storage ready: {TOTAL_SLOTS} permanent slots ({created} newly created).")
        print(f"Temporary location ready: {SUNLU_NAME} (id {sunlu_id}).")
        print(f"Numbered drawer assignments repaired: {repaired_drawer}.")
        print(f"Away spool homes reserved by spool number: {reserved_away}.")
        if archived_legacy:
            print("Archived unused legacy locations: " + ", ".join(archived_legacy))
        if retained_legacy:
            print("Kept occupied legacy locations for safe reassignment: " + ", ".join(retained_legacy))
        print("SUNLU home-location protection trigger installed.")
        print("Numbered drawer-home guard installed.")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
