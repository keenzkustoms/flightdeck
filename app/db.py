from __future__ import annotations
import sqlite3
import logging
import json
import re
import secrets
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Iterable, Optional

from .paths import DB_PATH, FLIGHT_RECORDER_DIR, UPLOADS_DIR

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
    "ams_auto_claim_enabled": "true",
    "bambu_cloud_last_auth_at": "",
    "bambu_cloud_token": "",
    "bambu_cloud_token_days": "90",
    "bambu_cloud_warn_days": "75",
    "bambu_cloud_urgent_days": "85",
    "print_vault_path": "",
    "orcaslicer_docker_url": "",
    "bambustudio_docker_url": "",
    "orcaslicer_browser_username": "flightdeck",
    "orcaslicer_browser_password": "flightdeck",
    "orcaslicer_worker_url": "",
    "orcaslicer_api_url": "",
    "slicer_open_mode": "same",
    "slicer_use_api": "false",
}

COSTING_SETTINGS_KEY = "shop_costing"

DEFAULT_COSTING_OVERHEADS = [
    {"id": "bambu", "name": "Bambu / subscriptions", "amount": 0.0},
    {"id": "electricity", "name": "Electricity", "amount": 0.0},
    {"id": "other", "name": "Other", "amount": 0.0},
]

_PRINTER_PRINTING_ENABLED_PREFIX = "printer_print_enabled_"
_PRINTER_PRINTING_NOTE_PREFIX = "printer_print_note_"


def _canonical_brand(value: str | None) -> str:
    """Keep one operator-facing spelling for brands with established aliases."""
    brand = str(value or "").strip()
    compact = re.sub(r"[^a-z0-9]+", "", brand.lower())
    if compact in {"bambu", "bambulab"}:
        return "Bambu Lab"
    return brand


def _costing_float(value, default: float = 0.0, lo: float = 0.0, hi: float = 1_000_000.0) -> float:
    try:
        n = float(value)
    except (TypeError, ValueError):
        return default
    if n != n or n in (float("inf"), float("-inf")):
        return default
    return max(lo, min(hi, n))


_PRICING_STRATEGIES = ("shop", "batch", "machine", "value")


def _pricing_strategy(value) -> str:
    raw = str(value or "shop").strip().lower()
    return raw if raw in _PRICING_STRATEGIES else "shop"


def _money_or_none(value: float) -> Optional[float]:
    n = round(float(value or 0), 2)
    return n if n > 0 else None


def _sell_prices(cfg: dict, *, filament: float, hours: float, floor: float) -> dict:
    """Turn cost into the three sell strategies plus shop markup.

    Fail buffer applies to sell prices only, not the shop floor.
    machine_hour_rate 0 means “use the derived shop rate”.
    """
    fail_pct = float(cfg.get("fail_pct") or 0)
    batch_mult = float(cfg.get("batch_multiplier") or 5)
    machine_rate = float(cfg.get("machine_hour_rate") or 0)
    shop_rate = float(cfg.get("shop_rate") or 0)
    if machine_rate <= 0:
        machine_rate = shop_rate
    value_mult = float(cfg.get("value_multiplier") or 10)
    markup = float(cfg.get("markup_pct") or 0)
    strategy = _pricing_strategy(cfg.get("pricing_strategy"))
    fil = max(0.0, float(filament or 0))
    hrs = max(0.0, float(hours or 0))
    floor = max(0.0, float(floor or 0))
    buffered = fil * (1.0 + fail_pct / 100.0)
    shop = floor * (1.0 + markup / 100.0) if floor > 0 else 0.0
    batch = buffered * batch_mult if buffered > 0 else 0.0
    machine = 0.0
    if buffered > 0 or (hrs > 0 and machine_rate > 0):
        machine = buffered + hrs * machine_rate
    value = buffered * value_mult if buffered > 0 else 0.0
    picked = {"shop": shop, "batch": batch, "machine": machine, "value": value}.get(strategy) or shop
    return {
        "pricing_strategy": strategy,
        "fail_pct": round(fail_pct, 2),
        "batch_multiplier": round(batch_mult, 2),
        "machine_hour_rate": round(machine_rate, 4) if machine_rate > 0 else None,
        "value_multiplier": round(value_mult, 2),
        "shop_price": _money_or_none(shop),
        "batch_price": _money_or_none(batch),
        "machine_price": _money_or_none(machine),
        "value_price": _money_or_none(value),
        "suggested_price": _money_or_none(picked),
    }


def _normalise_costing(raw: Optional[dict]) -> dict:
    data = raw if isinstance(raw, dict) else {}
    overheads = []
    seen_ids: set[str] = set()
    for entry in data.get("overheads") or []:
        if not isinstance(entry, dict):
            continue
        name = str(entry.get("name") or "").strip()[:80] or "Overhead"
        oid = str(entry.get("id") or "").strip()[:24]
        if not oid or oid in seen_ids or not all(c.isalnum() or c in "-_" for c in oid):
            oid = secrets.token_hex(4)
        seen_ids.add(oid)
        overheads.append({
            "id": oid,
            "name": name,
            "amount": round(_costing_float(entry.get("amount"), 0.0, 0.0, 999_999.0), 2),
        })
    if not overheads:
        overheads = [dict(row) for row in DEFAULT_COSTING_OVERHEADS]
    power_watts: dict[str, float] = {}
    raw_watts = data.get("power_watts")
    if isinstance(raw_watts, dict):
        for key, value in raw_watts.items():
            pid = str(key or "").strip()[:64]
            if not pid:
                continue
            watts = round(_costing_float(value, 0.0, 0.0, 2000.0), 1)
            if watts > 0:
                power_watts[pid] = watts
    return {
        "overheads": overheads,
        "expected_hours": round(_costing_float(data.get("expected_hours"), 40.0, 0.0, 1000.0), 2),
        "markup_pct": round(_costing_float(data.get("markup_pct"), 35.0, 0.0, 500.0), 2),
        "labour_per_hour": round(_costing_float(data.get("labour_per_hour"), 0.0, 0.0, 1000.0), 2),
        # Tariff for “Power this month” — print hours × wiki kW, not the bill-share overhead line.
        "electricity_rate_per_kwh": round(
            _costing_float(data.get("electricity_rate_per_kwh"), 0.30, 0.0, 10.0), 4
        ),
        "power_watts": power_watts,
        "pricing_strategy": _pricing_strategy(data.get("pricing_strategy")),
        "fail_pct": round(_costing_float(data.get("fail_pct"), 8.0, 0.0, 25.0), 2),
        "batch_multiplier": round(_costing_float(data.get("batch_multiplier"), 5.0, 1.0, 12.0), 2),
        "machine_hour_rate": round(_costing_float(data.get("machine_hour_rate"), 0.0, 0.0, 100.0), 2),
        "value_multiplier": round(_costing_float(data.get("value_multiplier"), 10.0, 1.0, 50.0), 2),
        "design_per_hour": round(_costing_float(data.get("design_per_hour"), 50.0, 0.0, 500.0), 2),
    }


# Average print draw (W) from Bambu Lab wiki — PLA baseline; material keys when known.
# https://wiki.bambulab.com/en/general/power-consumption
# Peaks (bed/nozzle heat) are not used for cost — averages during printing are.
_POWER_W_BY_MODEL: dict[str, dict[str, float]] = {
    "h2d": {"PLA": 197, "PETG": 230, "ABS": 310, "ASA": 310, "PC": 395, "PA": 350, "TPU": 180, "_": 197},
    "h2c": {"PLA": 200, "PETG": 230, "ABS": 310, "PC": 395, "_": 200},
    "h2s": {"PLA": 200, "PETG": 230, "ABS": 310, "PC": 395, "_": 200},
    "x1c": {"PLA": 105, "PETG": 125, "ABS": 180, "ASA": 180, "PC": 220, "PA": 200, "TPU": 100, "_": 105},
    "x1e": {"PLA": 185, "PETG": 200, "ABS": 250, "ASA": 250, "PC": 280, "PA": 260, "_": 185},
    "x1": {"PLA": 105, "PETG": 125, "ABS": 180, "_": 105},
    "p1s": {"PLA": 105, "PETG": 125, "ABS": 160, "ASA": 160, "TPU": 100, "_": 105},
    "p1p": {"PLA": 110, "PETG": 125, "ABS": 150, "_": 110},
    "a1": {"PLA": 100, "PETG": 115, "ABS": 140, "TPU": 95, "_": 100},
    "a1_mini": {"PLA": 55, "PETG": 65, "TPU": 50, "_": 55},
    "default": {"_": 120},
}

_POWER_MODEL_ALIASES = (
    ("a1_mini", ("A1MINI", "A1-MINI", "A1 MINI")),
    ("h2d", ("H2D",)),
    ("h2c", ("H2C",)),
    ("h2s", ("H2S",)),
    ("x1e", ("X1E",)),
    ("x1c", ("X1C",)),
    ("x1", ("X1",)),
    ("p1s", ("P1S",)),
    ("p1p", ("P1P",)),
    ("a1", ("A1",)),
)


def _power_model_key(model_name: str) -> str:
    compact = re.sub(r"[^A-Z0-9]+", "", str(model_name or "").upper())
    spaced = str(model_name or "").upper()
    for key, aliases in _POWER_MODEL_ALIASES:
        for alias in aliases:
            needle = re.sub(r"[^A-Z0-9]+", "", alias)
            if needle and needle in compact:
                return key
            if alias in spaced:
                return key
    return "default"


def _power_material_key(material: str) -> str:
    raw = str(material or "").strip().upper()
    if not raw:
        return "_"
    token = re.split(r"[\s_/+\-]+", raw)[0]
    for family in ("PLA", "PETG", "ABS", "ASA", "PC", "PA", "TPU", "PVA", "HIPS"):
        if token.startswith(family) or family in token:
            return family
    return "_"


def default_print_watts(model_name: str, material: str = "") -> tuple[float, str]:
    """Return (watts, source label) for average print draw."""
    model_key = _power_model_key(model_name)
    mat_key = _power_material_key(material)
    table = _POWER_W_BY_MODEL.get(model_key) or _POWER_W_BY_MODEL["default"]
    if mat_key in table:
        return float(table[mat_key]), f"wiki:{model_key.upper()}/{mat_key}"
    watts = float(table.get("_") or _POWER_W_BY_MODEL["default"]["_"])
    label = f"wiki:{model_key.upper()}/PLA" if mat_key == "_" else f"wiki:{model_key.upper()}/default"
    return watts, label


def _parse_year_month(month: Optional[str]) -> tuple[int, int, str]:
    raw = str(month or "").strip()
    now = datetime.utcnow()
    if re.fullmatch(r"\d{4}-\d{2}", raw):
        year, mon = int(raw[:4]), int(raw[5:7])
        if 1 <= mon <= 12 and 2000 <= year <= 2100:
            return year, mon, f"{year:04d}-{mon:02d}"
    return now.year, now.month, f"{now.year:04d}-{now.month:02d}"


def _month_start_end(year: int, month: int) -> tuple[str, str]:
    start = f"{year:04d}-{month:02d}-01"
    if month == 12:
        end = f"{year + 1:04d}-01-01"
    else:
        end = f"{year:04d}-{month + 1:02d}-01"
    return start, end


def print_hours_by_printer_month(month: Optional[str] = None) -> dict:
    """Sum print duration by printer (+ material) for a calendar month (UTC started_at)."""
    year, mon, ym = _parse_year_month(month)
    start, end = _month_start_end(year, mon)
    with _conn() as conn:
        rows = conn.execute(
            """SELECT printer_id,
                      COALESCE(NULLIF(TRIM(material), ''), '') AS material,
                      COALESCE(SUM(duration_seconds), 0) AS secs
               FROM prints
               WHERE duration_seconds IS NOT NULL AND duration_seconds > 0
                 AND started_at >= ? AND started_at < ?
                 AND COALESCE(exclude_from_stats, 0) = 0
               GROUP BY printer_id, material
               ORDER BY printer_id, material""",
            (start, end),
        ).fetchall()
    by_printer: dict[str, list[dict]] = {}
    for row in rows:
        pid = str(row["printer_id"] or "")
        secs = float(row["secs"] or 0)
        if not pid or secs <= 0:
            continue
        by_printer.setdefault(pid, []).append({
            "material": str(row["material"] or ""),
            "hours": round(secs / 3600.0, 3),
            "seconds": int(secs),
        })
    return {"month": ym, "start": start, "end": end, "by_printer": by_printer}


def estimate_power_month(
    month: Optional[str] = None,
    *,
    printers: Optional[list[dict]] = None,
    rate_per_kwh: Optional[float] = None,
    watt_overrides: Optional[dict] = None,
) -> dict:
    """Estimate kWh/$ from History hours × wiki average W × tariff."""
    cfg = get_costing_settings()
    rate = _costing_float(
        rate_per_kwh if rate_per_kwh is not None else cfg.get("electricity_rate_per_kwh"),
        0.30,
        0.0,
        10.0,
    )
    overrides = watt_overrides if isinstance(watt_overrides, dict) else cfg.get("power_watts") or {}
    hours_payload = print_hours_by_printer_month(month)
    meta_by_id = {
        str(p.get("id") or ""): p
        for p in (printers or [])
        if isinstance(p, dict) and p.get("id")
    }
    rows_out = []
    total_hours = 0.0
    total_kwh = 0.0
    for pid, segments in sorted(hours_payload["by_printer"].items()):
        meta = meta_by_id.get(pid) or {}
        model_name = str(meta.get("model_name") or meta.get("model") or pid)
        label = str(meta.get("custom_name") or meta.get("label") or model_name or pid)
        override = _costing_float(overrides.get(pid), 0.0, 0.0, 2000.0) if pid in overrides else 0.0
        breakdown = []
        printer_hours = 0.0
        printer_kwh = 0.0
        weighted_w = 0.0
        weighted_default_w = 0.0
        for seg in segments:
            hours = float(seg["hours"])
            printer_hours += hours
            default_w, default_source = default_print_watts(model_name, seg.get("material") or "")
            weighted_default_w += default_w * hours
            if override > 0:
                watts = override
                source = "override"
            else:
                watts, source = default_w, default_source
            kwh = hours * (watts / 1000.0)
            printer_kwh += kwh
            weighted_w += watts * hours
            breakdown.append({
                "material": seg.get("material") or "unknown",
                "hours": round(hours, 2),
                "watts": round(watts, 1),
                "kwh": round(kwh, 3),
                "watts_source": source,
            })
        avg_w = (weighted_w / printer_hours) if printer_hours > 0 else 0.0
        avg_default_w = (weighted_default_w / printer_hours) if printer_hours > 0 else 0.0
        if avg_default_w <= 0:
            avg_default_w, _ = default_print_watts(model_name, "PLA")
        cost = printer_kwh * rate
        total_hours += printer_hours
        total_kwh += printer_kwh
        rows_out.append({
            "printer_id": pid,
            "label": label,
            "model_name": model_name,
            "hours": round(printer_hours, 2),
            "watts": round(avg_w, 1),
            "watts_default": round(float(avg_default_w), 1),
            "watts_override": round(override, 1) if override > 0 else None,
            "kwh": round(printer_kwh, 3),
            "cost": round(cost, 2),
            "breakdown": breakdown,
        })
    # Include configured printers with zero hours so overrides can still be edited.
    seen = {r["printer_id"] for r in rows_out}
    for pid, meta in sorted(meta_by_id.items()):
        if pid in seen:
            continue
        model_name = str(meta.get("model_name") or meta.get("model") or pid)
        label = str(meta.get("custom_name") or meta.get("label") or model_name or pid)
        override = _costing_float(overrides.get(pid), 0.0, 0.0, 2000.0) if pid in overrides else 0.0
        watts_default, source = default_print_watts(model_name, "PLA")
        watts = override if override > 0 else watts_default
        if override > 0:
            source = "override"
        rows_out.append({
            "printer_id": pid,
            "label": label,
            "model_name": model_name,
            "hours": 0.0,
            "watts": round(float(watts), 1),
            "watts_default": round(float(watts_default), 1),
            "watts_override": round(override, 1) if override > 0 else None,
            "kwh": 0.0,
            "cost": 0.0,
            "breakdown": [],
            "watts_source": source,
        })
    rows_out.sort(key=lambda r: (-float(r["hours"]), str(r["label"]).lower()))
    return {
        "month": hours_payload["month"],
        "start": hours_payload["start"],
        "end": hours_payload["end"],
        "rate_per_kwh": round(rate, 4),
        "wiki_url": "https://wiki.bambulab.com/en/general/power-consumption",
        "note": "Uses History print hours × Bambu wiki average print watts (not heater peaks). Idle/standby not included.",
        "printers": rows_out,
        "total_hours": round(total_hours, 2),
        "total_kwh": round(total_kwh, 3),
        "total_cost": round(total_kwh * rate, 2),
    }


def _parse_costing_value(value: Optional[str]) -> dict:
    raw = {}
    if value:
        try:
            parsed = json.loads(value)
            if isinstance(parsed, dict):
                raw = parsed
        except Exception:
            raw = {}
    return _normalise_costing(raw)


def _costing_with_rates(cfg: dict) -> dict:
    monthly = sum(float(row.get("amount") or 0) for row in cfg.get("overheads") or [])
    hours = float(cfg.get("expected_hours") or 0)
    shop_rate = (monthly / hours) if hours > 0 else 0.0
    labour = float(cfg.get("labour_per_hour") or 0)
    return {
        **cfg,
        "monthly_total": round(monthly, 2),
        "shop_rate": round(shop_rate, 4),
        "effective_rate": round(shop_rate + labour, 4),
    }


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
                timelapse_path     TEXT,
                timelapse_source   TEXT,
                timelapse_captured_at TIMESTAMP,
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

            CREATE TABLE IF NOT EXISTS empty_spool_profiles (
                id                    INTEGER PRIMARY KEY AUTOINCREMENT,
                brand                 TEXT NOT NULL DEFAULT '',
                material              TEXT,
                profile_name          TEXT NOT NULL,
                empty_spool_weight_g  REAL NOT NULL,
                source                TEXT NOT NULL DEFAULT 'manual',
                notes                 TEXT,
                is_default            INTEGER NOT NULL DEFAULT 0,
                archived_at           TEXT,
                created_at            TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at            TEXT NOT NULL DEFAULT (datetime('now')),
                UNIQUE(brand, material, profile_name)
            );

            CREATE INDEX IF NOT EXISTS idx_empty_spool_profiles_lookup
                ON empty_spool_profiles(brand, material, archived_at);

            CREATE TABLE IF NOT EXISTS spools (
                id                  INTEGER PRIMARY KEY AUTOINCREMENT,
                display_id          INTEGER,
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

            CREATE TABLE IF NOT EXISTS incoming_stock_orders (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                supplier    TEXT,
                order_ref   TEXT,
                notes       TEXT,
                created_at  TEXT NOT NULL DEFAULT (datetime('now')),
                closed_at   TEXT
            );

            CREATE TABLE IF NOT EXISTS incoming_stock_rolls (
                id                   INTEGER PRIMARY KEY AUTOINCREMENT,
                order_id             INTEGER NOT NULL REFERENCES incoming_stock_orders(id),
                token                TEXT NOT NULL UNIQUE,
                material             TEXT NOT NULL,
                brand                TEXT NOT NULL,
                subtype              TEXT,
                color_hex            TEXT NOT NULL,
                color_name           TEXT,
                color_scheme         TEXT NOT NULL DEFAULT 'solid',
                color_hex_2          TEXT,
                color_hex_3          TEXT,
                label_weight_g       REAL NOT NULL DEFAULT 1000,
                empty_spool_weight_g REAL,
                storage_location_id  INTEGER,
                notes                TEXT,
                status               TEXT NOT NULL DEFAULT 'pending',
                spool_id             INTEGER REFERENCES spools(id),
                received_at          TEXT,
                created_at           TEXT NOT NULL DEFAULT (datetime('now'))
            );

            CREATE INDEX IF NOT EXISTS idx_incoming_stock_rolls_order
                ON incoming_stock_rolls(order_id, id);

            CREATE INDEX IF NOT EXISTS idx_incoming_stock_rolls_token
                ON incoming_stock_rolls(token);

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
                plate_number        INTEGER,
                plate_count         INTEGER,
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

            CREATE TABLE IF NOT EXISTS slicer_profile_catalog (
                vendor      TEXT PRIMARY KEY,
                payload     TEXT NOT NULL,
                synced_at   TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS projects (
                id                  INTEGER PRIMARY KEY AUTOINCREMENT,
                name                TEXT NOT NULL,
                notes               TEXT,
                vault_folder        TEXT NOT NULL,
                parallel_printers   INTEGER NOT NULL DEFAULT 1,
                created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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
            "ALTER TABLE material_costs ADD COLUMN brand TEXT",
            "ALTER TABLE material_costs ADD COLUMN comment TEXT",
            "ALTER TABLE material_costs ADD COLUMN empty_spool_weight_g REAL",
            "ALTER TABLE prints ADD COLUMN notes TEXT",
            "ALTER TABLE prints ADD COLUMN tags TEXT",
            "ALTER TABLE prints ADD COLUMN exclude_from_stats INTEGER NOT NULL DEFAULT 0",
            "ALTER TABLE prints ADD COLUMN spool_usage TEXT",
            "ALTER TABLE prints ADD COLUMN ams_slot_snapshot TEXT",
            "ALTER TABLE prints ADD COLUMN timelapse_path TEXT",
            "ALTER TABLE prints ADD COLUMN timelapse_source TEXT",
            "ALTER TABLE prints ADD COLUMN timelapse_captured_at TIMESTAMP",
            "ALTER TABLE spools ADD COLUMN empty_spool_weight_g REAL",
            "ALTER TABLE spools ADD COLUMN storage_location_id INTEGER",
            "ALTER TABLE spools ADD COLUMN home_storage_location_id INTEGER",
            "ALTER TABLE spools ADD COLUMN color_scheme TEXT NOT NULL DEFAULT 'solid'",
            "ALTER TABLE spools ADD COLUMN color_hex_2 TEXT",
            "ALTER TABLE spools ADD COLUMN color_hex_3 TEXT",
            "ALTER TABLE spools ADD COLUMN display_id INTEGER",
            "ALTER TABLE spools ADD COLUMN updated_at TIMESTAMP",
            "ALTER TABLE incoming_stock_rolls ADD COLUMN cancelled_at TEXT",
            "ALTER TABLE incoming_stock_rolls ADD COLUMN cancel_reason TEXT",
            "ALTER TABLE print_queue ADD COLUMN filament_colors TEXT",
            "ALTER TABLE print_queue ADD COLUMN calibrate_before_start INTEGER NOT NULL DEFAULT 0",
            "ALTER TABLE print_queue ADD COLUMN allow_short_filament INTEGER NOT NULL DEFAULT 0",
            "ALTER TABLE print_queue ADD COLUMN plate_number INTEGER",
            "ALTER TABLE print_queue ADD COLUMN plate_count INTEGER",
            "ALTER TABLE filament_catalog ADD COLUMN updated_at TEXT NOT NULL DEFAULT (datetime('now'))",
            "ALTER TABLE empty_spool_profiles ADD COLUMN source TEXT NOT NULL DEFAULT 'manual'",
            "ALTER TABLE empty_spool_profiles ADD COLUMN notes TEXT",
            "ALTER TABLE empty_spool_profiles ADD COLUMN is_default INTEGER NOT NULL DEFAULT 0",
            "ALTER TABLE empty_spool_profiles ADD COLUMN archived_at TEXT",
            "ALTER TABLE projects ADD COLUMN parallel_printers INTEGER NOT NULL DEFAULT 1",
            "ALTER TABLE projects ADD COLUMN quote_printer_id TEXT",
        ):
            try:
                conn.execute(stmt)
            except Exception:
                pass
        conn.execute("UPDATE spools SET display_id = id WHERE display_id IS NULL")
        try:
            conn.execute(
                """CREATE UNIQUE INDEX IF NOT EXISTS idx_spools_display_active
                   ON spools(display_id) WHERE archived_at IS NULL AND display_id IS NOT NULL"""
            )
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

        # Bambu's printer API uses "Bambu Lab", while older Flightdeck records
        # used "Bambu". Store only the printer spelling so it is obvious in the
        # UI and cannot create a false AMS brand mismatch.
        bambu_aliases = ("bambu", "bambulab")
        for table in ("spools", "incoming_stock_rolls", "filament_catalog"):
            conn.execute(
                f"""UPDATE {table}
                    SET brand = 'Bambu Lab'
                    WHERE LOWER(REPLACE(brand, ' ', '')) IN (?, ?)
                      AND brand != 'Bambu Lab'""",
                bambu_aliases,
            )

        # Costs use a composite key. Preserve the canonical Bambu Lab amount
        # if both spellings exist, otherwise promote the old record in place.
        old_costs = conn.execute(
            """SELECT material, brand FROM material_costs
               WHERE LOWER(REPLACE(brand, ' ', '')) IN (?, ?)
                 AND brand != 'Bambu Lab'""",
            bambu_aliases,
        ).fetchall()
        for row in old_costs:
            canonical = conn.execute(
                "SELECT 1 FROM material_costs WHERE material = ? AND brand = 'Bambu Lab'",
                (row["material"],),
            ).fetchone()
            if canonical:
                conn.execute(
                    "DELETE FROM material_costs WHERE material = ? AND brand = ?",
                    (row["material"], row["brand"]),
                )
            else:
                conn.execute(
                    "UPDATE material_costs SET brand = 'Bambu Lab' WHERE material = ? AND brand = ?",
                    (row["material"], row["brand"]),
                )

    UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
    FLIGHT_RECORDER_DIR.mkdir(parents=True, exist_ok=True)

    with _conn() as conn:
        def ensure_seed_location(name: str, notes: str, sort_order: int):
            existing = conn.execute(
                "SELECT id, archived_at FROM spool_locations WHERE name = ?",
                (name,),
            ).fetchone()
            if existing:
                return existing
            cursor = conn.execute(
                "INSERT INTO spool_locations (name, notes, sort_order) VALUES (?, ?, ?)",
                (name, notes, sort_order),
            )
            return conn.execute(
                "SELECT id, archived_at FROM spool_locations WHERE id = ?",
                (cursor.lastrowid,),
            ).fetchone()

        shelf1 = ensure_seed_location("Shelf #1", "Inside main cupboard top shelf", 10)

        defaults = (
            ("Shelf #2", "Inside main cupboard middle shelf", 20),
            ("Shelf #3", "Inside main cupboard bottom shelf", 30),
        )
        for name, notes, order in defaults:
            ensure_seed_location(name, notes, order)

        storage = conn.execute(
            "SELECT id FROM spool_locations WHERE name = ? AND archived_at IS NULL",
            ("Storage",),
        ).fetchone()
        if storage and not shelf1["archived_at"]:
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
        seeded = conn.execute("SELECT COUNT(*) AS n FROM empty_spool_profiles").fetchone()
        if int(seeded["n"] or 0) == 0:
            conn.execute(
                """INSERT OR IGNORE INTO empty_spool_profiles
                   (brand, material, profile_name, empty_spool_weight_g, source, is_default)
                   SELECT COALESCE(brand, ''), material,
                          CASE WHEN COALESCE(brand, '') = '' THEN material || ' standard spool'
                               ELSE brand || ' standard spool' END,
                          empty_spool_weight_g, 'material_costs', 1
                   FROM material_costs
                   WHERE empty_spool_weight_g IS NOT NULL AND empty_spool_weight_g >= 0"""
            )

    # Clean up prints that started >24 h ago but never got a final_state
    # (backend crash during a print that has since ended)
    _close_stale_orphans()


@contextmanager
def _conn():
    # timeout avoids indefinite event-loop stalls when a worker thread holds the DB.
    conn = sqlite3.connect(DB_PATH, timeout=10)
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


def on_print_finished_by_id(
    print_id: int,
    *,
    ended_at: Optional[datetime] = None,
    layers_completed: Optional[int] = None,
    filament_grams: Optional[float] = None,
    material: Optional[str] = None,
) -> bool:
    """Close an open print row by id when the printer-side job key drifts."""
    now = (ended_at or datetime.utcnow()).isoformat()
    with _conn() as conn:
        row = conn.execute(
            "SELECT printer_id, job_key FROM prints WHERE id = ? AND final_state IS NULL",
            (print_id,),
        ).fetchone()
        if not row:
            return False
        updated = conn.execute(
            """UPDATE prints
               SET ended_at         = ?,
                   duration_seconds = CAST(
                       (julianday(?) - julianday(started_at)) * 86400 AS INTEGER),
                   final_state      = 'FINISHED',
                   layers_completed = COALESCE(?, layers_completed),
                   filament_grams   = COALESCE(?, filament_grams),
                   material         = COALESCE(?, material)
               WHERE id = ? AND final_state IS NULL""",
            (now, now, layers_completed, filament_grams, material, print_id),
        ).rowcount
    if updated:
        _cal_cache.pop(str(row["printer_id"]), None)
        log.info("print finished by id: %s key=%s id=%s", row["printer_id"], row["job_key"], print_id)
        return True
    return False


def update_print_filament_metadata(
    print_id: int,
    *,
    filament_grams: Optional[float] = None,
    material: Optional[str] = None,
) -> bool:
    """Fill missing filament metadata for a print without overwriting known values."""
    grams_value = None
    if filament_grams is not None:
        try:
            grams_value = float(filament_grams)
        except (TypeError, ValueError):
            grams_value = None
    material_value = (material or "").strip() or None
    if grams_value is None and material_value is None:
        return False
    with _conn() as conn:
        n = conn.execute(
            """UPDATE prints
               SET filament_grams = COALESCE(filament_grams, ?),
                   material       = COALESCE(material, ?)
               WHERE id = ?""",
            (grams_value, material_value, print_id),
        ).rowcount
    return n > 0


def _relay_metadata_key(value: str | None) -> str:
    name = str(value or "").rsplit("/", 1)[-1].rsplit("\\", 1)[-1].lower()
    for suffix in (".gcode.3mf", ".3mf", ".gcode"):
        if name.endswith(suffix):
            name = name[: -len(suffix)]
    return name


def _parse_relay_ts(value: str | None) -> Optional[datetime]:
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00")).replace(tzinfo=None)
    except Exception:
        return None


def _find_relay_filament_match(
    *,
    printer_id: str,
    filename: str | None,
    subtask_name: str | None,
    started_at: str | None = None,
    ended_at: str | None = None,
    material_fallback: str | None = None,
) -> Optional[dict]:
    wanted = {_relay_metadata_key(filename), _relay_metadata_key(subtask_name)}
    wanted.discard("")
    with _conn() as conn:
        decisions = conn.execute(
            """SELECT detail, logged_at
               FROM decisions
               WHERE printer_id = ? AND event = 'relay_upload'
               ORDER BY logged_at DESC, id DESC
               LIMIT 120""",
            (printer_id,),
        ).fetchall()

    match = None
    fallback_candidates: list[tuple[float, dict]] = []
    start_ts = _parse_relay_ts(started_at)
    end_ts = _parse_relay_ts(ended_at)
    for decision in decisions:
        try:
            payload = json.loads(decision["detail"] or "{}")
        except Exception:
            continue
        if not isinstance(payload, dict):
            continue
        grams = payload.get("filament_g")
        try:
            grams = float(grams)
        except (TypeError, ValueError):
            grams = None
        if not grams or grams <= 0:
            continue
        file_key = _relay_metadata_key(payload.get("file"))
        candidate = {
            "filament_grams": grams,
            "material": (payload.get("filament_type") or material_fallback or None),
            "source_file": payload.get("file"),
            "logged_at": decision["logged_at"],
        }
        if wanted and file_key in wanted:
            match = candidate
            break
        logged_ts = _parse_relay_ts(decision["logged_at"])
        if start_ts and logged_ts:
            before_start = (start_ts - logged_ts).total_seconds()
            within_print = end_ts is not None and start_ts <= logged_ts <= end_ts
            if 0 <= before_start <= 7200 or within_print:
                fallback_candidates.append((abs(before_start), candidate))
        elif not wanted:
            fallback_candidates.append((0, candidate))

    if not match and fallback_candidates:
        fallback_candidates.sort(key=lambda item: item[0])
        match = fallback_candidates[0][1]
    return match


def try_apply_relay_filament_metadata(print_id: int, *, log_event: str = "print_filament_metadata_recovered") -> bool:
    """Apply relay upload metadata to a print row when FTP preview is unavailable."""
    with _conn() as conn:
        row = conn.execute(
            """SELECT id, printer_id, filename, subtask_name, started_at, ended_at,
                      filament_grams, material
               FROM prints
               WHERE id = ?""",
            (print_id,),
        ).fetchone()
    if not row or row["filament_grams"] is not None:
        return False
    match = _find_relay_filament_match(
        printer_id=row["printer_id"],
        filename=row["filename"],
        subtask_name=row["subtask_name"],
        started_at=row["started_at"],
        ended_at=row["ended_at"],
        material_fallback=row["material"],
    )
    if not match:
        return False
    update_print_filament_metadata(
        print_id,
        filament_grams=match["filament_grams"],
        material=match["material"],
    )
    detail = (
        f"Recovered filament metadata from relay upload {match.get('source_file') or ''}: "
        f"{float(match['filament_grams']):.1f}g"
    )
    if match.get("material"):
        detail += f" {match['material']}"
    log_decision(row["printer_id"], log_event, detail, print_id=print_id)
    return True


def _find_bambu_ftp_filament_match(
    *,
    printer_id: str,
    filename: str | None,
    subtask_name: str | None,
    material_fallback: str | None = None,
) -> Optional[dict]:
    from .printer_config import load
    from .printers.bambu_ftp import fetch_bambu_preview, resolve_preview_job_lookup

    printer = next((p for p in load().printers if p.id == printer_id), None)
    if not printer or printer.connection.type != "bambu":
        return None
    conn = printer.connection
    stem, plate_number = resolve_preview_job_lookup(filename, subtask_name)
    if not stem and plate_number is None:
        return None
    try:
        preview = fetch_bambu_preview(
            conn.host,
            conn.access_code,
            stem or "",
            plate_number=plate_number,
        )
    except Exception as exc:
        log.warning("FTP filament repair failed for %s: %s", printer_id, exc)
        return None
    if not preview or not preview.filament_weight_g or preview.filament_weight_g <= 0:
        return None
    return {
        "filament_grams": float(preview.filament_weight_g),
        "material": preview.filament_type or material_fallback,
        "source": "printer_ftp",
        "source_file": stem,
    }


def repair_print_filament_metadata(print_id: int) -> Optional[dict]:
    """Recover missing filament grams/material from relay logs or printer FTP storage."""
    with _conn() as conn:
        row = conn.execute(
            """SELECT id, printer_id, filename, subtask_name, started_at, ended_at,
                      filament_grams, material
               FROM prints
               WHERE id = ?""",
            (print_id,),
        ).fetchone()
    if not row:
        return None
    if row["filament_grams"] is not None:
        return {"error": "already_has_metadata"}
    match = _find_relay_filament_match(
        printer_id=row["printer_id"],
        filename=row["filename"],
        subtask_name=row["subtask_name"],
        started_at=row["started_at"],
        ended_at=row["ended_at"],
        material_fallback=row["material"],
    )
    source = "relay"
    if match:
        match = {**match, "source": source}
    else:
        match = _find_bambu_ftp_filament_match(
            printer_id=row["printer_id"],
            filename=row["filename"],
            subtask_name=row["subtask_name"],
            material_fallback=row["material"],
        )
        source = "printer_ftp"
    if not match:
        return {"error": "metadata_not_found"}
    update_print_filament_metadata(
        print_id,
        filament_grams=match["filament_grams"],
        material=match["material"],
    )
    if source == "relay":
        detail = (
            f"Recovered filament metadata from relay upload {match.get('source_file') or ''}: "
            f"{float(match['filament_grams']):.1f}g"
        )
    else:
        detail = (
            f"Recovered filament metadata from printer FTP {match.get('source_file') or 'job file'}: "
            f"{float(match['filament_grams']):.1f}g"
        )
    if match.get("material"):
        detail += f" {match['material']}"
    log_decision(row["printer_id"], "print_filament_metadata_recovered", detail, print_id=print_id)
    return match


def repair_print_filament_metadata_from_relay(print_id: int) -> Optional[dict]:
    """Backward-compatible alias for relay-only callers."""
    return repair_print_filament_metadata(print_id)


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
                      timelapse_captured_at IS NOT NULL AS has_timelapse,
                      timelapse_source,
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
            """SELECT id, material, brand, label_weight_g, remaining_g
               FROM spools"""
        ).fetchall()
        cost_rows = conn.execute(
            "SELECT material, brand, cost_per_gram FROM material_costs"
        ).fetchall()
        costing_row = conn.execute(
            "SELECT value FROM settings WHERE key = ?", (COSTING_SETTINGS_KEY,)
        ).fetchone()
    spools = {int(r["id"]): dict(r) for r in spool_rows}
    cost_lookup = _print_cost_lookup(cost_rows)
    costing = _costing_with_rates(_parse_costing_value(costing_row["value"] if costing_row else None))
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
        _attach_print_cost(item, spools, cost_lookup, costing)
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
            """SELECT id, material, brand, label_weight_g, remaining_g
               FROM spools"""
        ).fetchall()
        cost_rows = conn.execute(
            "SELECT material, brand, cost_per_gram FROM material_costs"
        ).fetchall()
        costing_row = conn.execute(
            "SELECT value FROM settings WHERE key = ?", (COSTING_SETTINGS_KEY,)
        ).fetchone()
    spools = {int(r["id"]): dict(r) for r in spool_rows}
    cost_lookup = _print_cost_lookup(cost_rows)
    costing = _costing_with_rates(_parse_costing_value(costing_row["value"] if costing_row else None))
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
        _attach_print_cost(item, spools, cost_lookup, costing)
        result.append(item)
    return result


def _cost_brand_key(value: str | None) -> str:
    brand = _canonical_brand(value).upper()
    aliases = {
        "BAMBU": "BAMBU LAB",
        "BAMBULAB": "BAMBU LAB",
        "BAMBU LAB": "BAMBU LAB",
        "ESUN": "ESUN",
        "E-SUN": "ESUN",
        "3D FILLIES": "3DFILLIES",
        "3DFILLIES": "3DFILLIES",
    }
    return aliases.get(brand, brand)


def _print_cost_lookup(cost_rows) -> dict:
    lookup: dict = {"exact": {}, "default": {}, "material": {}}
    by_material: dict[str, list[float]] = {}
    for row in cost_rows:
        material = str(row["material"] or "").strip().upper()
        raw_brand = str(row["brand"] or "").strip()
        brand = _cost_brand_key(raw_brand)
        try:
            cpg = float(row["cost_per_gram"])
        except (TypeError, ValueError):
            continue
        if not material or cpg <= 0:
            continue
        if brand:
            lookup["exact"][(material, brand)] = cpg
        else:
            lookup["default"][material] = cpg
        by_material.setdefault(material, []).append(cpg)
    lookup["material"] = {
        material: sum(values) / len(values)
        for material, values in by_material.items()
        if values
    }
    return lookup


def _usage_grams(entry: dict) -> float:
    try:
        return max(0.0, float(entry.get("actual_grams") if entry.get("actual_grams") is not None else entry.get("grams") or 0))
    except (TypeError, ValueError):
        return 0.0


def _attach_print_cost(item: dict, spools: dict[int, dict], cost_lookup: dict, costing: Optional[dict] = None) -> None:
    usage = item.get("spool_usage") or []
    if not isinstance(usage, list) or not usage:
        item["total_cost"] = None
        item["cost_pending"] = bool(item.get("filament_grams"))
        _attach_shop_cost(item, costing)
        return
    total = 0.0
    pending = False
    for entry in usage:
        if not isinstance(entry, dict):
            continue
        try:
            spool_id = int(entry.get("spool_id") or 0)
        except (TypeError, ValueError):
            spool_id = 0
        spool = spools.get(spool_id, {})
        material = str(spool.get("material") or entry.get("material") or item.get("material") or "").strip().upper()
        brand = _cost_brand_key(spool.get("brand") or entry.get("brand") or "")
        grams = _usage_grams(entry)
        cpg = None
        source = None
        if material:
            cpg = cost_lookup.get("exact", {}).get((material, brand))
            if cpg is not None:
                source = "spool brand"
            if cpg is None:
                cpg = cost_lookup.get("default", {}).get(material)
                if cpg is not None:
                    source = "material default"
            if cpg is None:
                cpg = cost_lookup.get("material", {}).get(material)
                if cpg is not None:
                    source = "material average"
        if cpg is None or grams <= 0:
            entry.pop("cost", None)
            entry.pop("cost_per_gram", None)
            entry.pop("cost_source", None)
            pending = True
            continue
        cost = round(grams * cpg, 2)
        entry["cost"] = cost
        entry["cost_per_gram"] = round(cpg, 4)
        entry["cost_source"] = source
        total += cost
    item["total_cost"] = round(total, 2) if total > 0 else None
    item["cost_pending"] = pending
    _attach_shop_cost(item, costing)


def _attach_shop_cost(item: dict, costing: Optional[dict] = None) -> None:
    rates = costing if isinstance(costing, dict) and "shop_rate" in costing else _costing_with_rates(
        costing if isinstance(costing, dict) else _normalise_costing({})
    )
    filament = item.get("total_cost")
    item["filament_cost"] = filament
    try:
        hours = max(0.0, float(item.get("duration_seconds") or 0) / 3600.0)
    except (TypeError, ValueError):
        hours = 0.0
    shop_rate = float(rates.get("shop_rate") or 0)
    labour_rate = float(rates.get("labour_per_hour") or 0)
    time_cost = round(hours * shop_rate, 2) if hours > 0 and shop_rate > 0 else 0.0
    labour_cost = round(hours * labour_rate, 2) if hours > 0 and labour_rate > 0 else 0.0
    item["time_cost"] = time_cost if time_cost > 0 else None
    item["labour_cost"] = labour_cost if labour_cost > 0 else None
    floor = float(filament or 0) + time_cost + labour_cost
    item["floor_price"] = round(floor, 2) if floor > 0 else None
    sell = _sell_prices(rates, filament=float(filament or 0), hours=hours, floor=floor)
    item["suggested_price"] = sell["suggested_price"]
    item["pricing_strategy"] = sell["pricing_strategy"]
    item["shop_price"] = sell["shop_price"]
    item["batch_price"] = sell["batch_price"]
    item["machine_price"] = sell["machine_price"]
    item["value_price"] = sell["value_price"]
    item["fail_pct"] = sell["fail_pct"]
    item["shop_rate"] = round(shop_rate, 4) if shop_rate > 0 else None
    item["labour_rate"] = round(labour_rate, 4) if labour_rate > 0 else None


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
                     timelapse_captured_at IS NOT NULL AS has_timelapse,
                     timelapse_source,
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
                      timelapse_captured_at IS NOT NULL AS has_timelapse,
                      timelapse_source,
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
                       COALESCE(SUM(filament_grams), 0) AS filament_grams,
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
                 AND COALESCE(exclude_from_stats, 0) = 0
                 AND started_at >= datetime('now', '-14 days')""",
            (printer_id,),
        ).fetchone()
        early = conn.execute(
            """SELECT COUNT(*) AS n
               FROM prints
               WHERE printer_id = ?
                 AND final_state IN ('ERROR', 'ESTOP')
                 AND COALESCE(exclude_from_stats, 0) = 0
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


def get_open_print_id(printer_id: str) -> Optional[int]:
    """Return the active (unfinished) print row for this printer, if any."""
    with _conn() as conn:
        row = conn.execute(
            """SELECT id FROM prints
               WHERE printer_id = ? AND final_state IS NULL
               ORDER BY started_at DESC LIMIT 1""",
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


def attach_print_timelapse(print_id: int, media_path: str | Path, *, source: str = "manual") -> bool:
    """Attach a Flight Recorder video to a print row."""
    path = Path(media_path)
    try:
        stored = str(path.resolve().relative_to(FLIGHT_RECORDER_DIR.resolve()))
    except Exception:
        stored = str(path)
    with _conn() as conn:
        n = conn.execute(
            """UPDATE prints
               SET timelapse_path = ?,
                   timelapse_source = ?,
                   timelapse_captured_at = CURRENT_TIMESTAMP
               WHERE id = ?""",
            (stored, source[:64] if source else "manual", print_id),
        ).rowcount
    return n > 0


def get_print_timelapse(print_id: int) -> Optional[dict]:
    with _conn() as conn:
        row = conn.execute(
            """SELECT id, printer_id, filename, timelapse_path, timelapse_source, timelapse_captured_at
               FROM prints
               WHERE id = ? AND timelapse_path IS NOT NULL""",
            (print_id,),
        ).fetchone()
    return dict(row) if row else None


def get_claimed_timelapse_paths(*, exclude_print_id: Optional[int] = None) -> set[str]:
    """Relative flight_recorder paths already attached to other prints."""
    with _conn() as conn:
        rows = conn.execute(
            """SELECT id, timelapse_path
               FROM prints
               WHERE timelapse_path IS NOT NULL AND timelapse_path != ''"""
        ).fetchall()
    claimed: set[str] = set()
    for row in rows:
        if exclude_print_id and int(row["id"]) == int(exclude_print_id):
            continue
        path = str(row["timelapse_path"] or "").strip().replace("\\", "/")
        if path:
            claimed.add(path)
    return claimed


def get_claimed_timelapse_origins(*, exclude_print_id: Optional[int] = None) -> set[str]:
    """Printer-origin clip paths already attached to other prints (from timelapse_source)."""
    with _conn() as conn:
        rows = conn.execute(
            """SELECT id, timelapse_source
               FROM prints
               WHERE timelapse_source IS NOT NULL AND timelapse_source != ''"""
        ).fetchall()
    claimed: set[str] = set()
    for row in rows:
        if exclude_print_id and int(row["id"]) == int(exclude_print_id):
            continue
        source = str(row["timelapse_source"] or "")
        if "|" in source:
            _, origin = source.split("|", 1)
            origin = origin.strip().replace("\\", "/").lstrip("/")
            if origin:
                claimed.add(origin)
    return claimed


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


def _coerce_layer_value(value: Optional[int]) -> Optional[int]:
    if value is None:
        return None
    try:
        return max(0, int(value))
    except (TypeError, ValueError):
        return None


def update_print_live_progress(
    print_id: int,
    *,
    layers_completed: Optional[int] = None,
    layers_total: Optional[int] = None,
) -> None:
    """Refresh live layer progress for a running print.

    Bambu H-series printers can briefly report a stale/alternate layer total
    while the live job payload settles. Keep normal progress monotonic, but let
    a later sane total replace a wildly larger stored value so history can
    recover from 1000+ layer ghosts on 100-layer jobs.
    """
    current = _coerce_layer_value(layers_completed)
    total = _coerce_layer_value(layers_total)
    if current is None and total is None:
        return
    with _conn() as conn:
        row = conn.execute(
            """SELECT layers_completed, layers_total
               FROM prints
               WHERE id = ? AND final_state IS NULL""",
            (print_id,),
        ).fetchone()
        if not row:
            return

        stored_current = _coerce_layer_value(row["layers_completed"])
        stored_total = _coerce_layer_value(row["layers_total"])
        next_current = stored_current
        next_total = stored_total
        corrected_total_down = False

        if total is not None and total > 0:
            if stored_total is None or stored_total <= 0 or total > stored_total:
                next_total = total
            elif stored_total > total * 3 and (current is None or current <= total):
                next_total = total
                corrected_total_down = True

        if current is not None:
            if corrected_total_down:
                next_current = current
            elif stored_current is None or current > stored_current:
                next_current = current
            elif next_total and stored_current and stored_current > next_total and current <= next_total:
                next_current = current

        conn.execute(
            """UPDATE prints
               SET layers_completed = ?,
                   layers_total = ?
               WHERE id = ? AND final_state IS NULL""",
            (next_current, next_total, print_id),
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


def recent_print_hours(days: int = 30) -> float:
    days = max(1, min(int(days or 30), 365))
    with _conn() as conn:
        row = conn.execute(
            """SELECT COALESCE(SUM(duration_seconds), 0) AS secs
               FROM prints
               WHERE duration_seconds IS NOT NULL AND duration_seconds > 0
                 AND started_at >= datetime('now', ?)""",
            (f"-{days} days",),
        ).fetchone()
    secs = float(row["secs"] if row else 0)
    return round(secs / 3600.0, 2)


def get_costing_settings() -> dict:
    with _conn() as conn:
        row = conn.execute(
            "SELECT value FROM settings WHERE key = ?", (COSTING_SETTINGS_KEY,)
        ).fetchone()
    cfg = _costing_with_rates(_parse_costing_value(row["value"] if row else None))
    cfg["recent_hours_30d"] = recent_print_hours(30)
    return cfg


def set_costing_settings(payload: Optional[dict]) -> dict:
    cfg = _normalise_costing(payload if isinstance(payload, dict) else {})
    set_setting(COSTING_SETTINGS_KEY, json.dumps(cfg))
    return get_costing_settings()


def quote_print_cost(
    *,
    hours: float = 0.0,
    grams: float = 0.0,
    material: str = "",
    brand: str = "",
    filament_cost: Optional[float] = None,
) -> dict:
    cfg = get_costing_settings()
    hours = _costing_float(hours, 0.0, 0.0, 1000.0)
    grams = _costing_float(grams, 0.0, 0.0, 100_000.0)
    filament = None
    filament_source = None
    if filament_cost is not None:
        filament = round(_costing_float(filament_cost, 0.0, 0.0, 100_000.0), 2)
        filament_source = "entered"
    elif grams > 0:
        lookup = _print_cost_lookup(get_material_costs())
        mat = str(material or "").strip().upper()
        brand_key = _cost_brand_key(brand)
        cpg = None
        if mat:
            cpg = lookup.get("exact", {}).get((mat, brand_key))
            if cpg is not None:
                filament_source = "spool brand"
            if cpg is None:
                cpg = lookup.get("default", {}).get(mat)
                if cpg is not None:
                    filament_source = "material default"
            if cpg is None:
                cpg = lookup.get("material", {}).get(mat)
                if cpg is not None:
                    filament_source = "material average"
        if cpg is None:
            averages = list(lookup.get("material", {}).values())
            if averages:
                cpg = sum(averages) / len(averages)
                filament_source = "catalogue average"
        if cpg is not None:
            filament = round(grams * float(cpg), 2)
    shop_rate = float(cfg.get("shop_rate") or 0)
    labour_rate = float(cfg.get("labour_per_hour") or 0)
    time_cost = round(hours * shop_rate, 2) if hours > 0 and shop_rate > 0 else 0.0
    labour_cost = round(hours * labour_rate, 2) if hours > 0 and labour_rate > 0 else 0.0
    floor = float(filament or 0) + time_cost + labour_cost
    sell = _sell_prices(cfg, filament=float(filament or 0), hours=hours, floor=floor)
    return {
        "hours": round(hours, 2),
        "grams": round(grams, 1),
        "material": str(material or "").strip(),
        "filament_cost": filament,
        "filament_source": filament_source,
        "time_cost": time_cost if time_cost > 0 else None,
        "labour_cost": labour_cost if labour_cost > 0 else None,
        "floor_price": round(floor, 2) if floor > 0 else None,
        "suggested_price": sell["suggested_price"],
        "pricing_strategy": sell["pricing_strategy"],
        "shop_price": sell["shop_price"],
        "batch_price": sell["batch_price"],
        "machine_price": sell["machine_price"],
        "value_price": sell["value_price"],
        "fail_pct": sell["fail_pct"],
        "shop_rate": shop_rate if shop_rate > 0 else None,
        "labour_rate": labour_rate if labour_rate > 0 else None,
        "markup_pct": float(cfg.get("markup_pct") or 0),
        "batch_multiplier": sell["batch_multiplier"],
        "machine_hour_rate": sell["machine_hour_rate"],
        "value_multiplier": sell["value_multiplier"],
        "design_per_hour": float(cfg.get("design_per_hour") or 0),
    }


def _project_row(row) -> dict:
    return {
        "id": int(row["id"]),
        "name": row["name"],
        "notes": row["notes"] or "",
        "vault_folder": row["vault_folder"],
        "parallel_printers": max(1, min(int(row["parallel_printers"] or 1), 12)),
        "quote_printer_id": str(row["quote_printer_id"] or "") if "quote_printer_id" in row.keys() else "",
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def list_projects() -> list[dict]:
    with _conn() as conn:
        rows = conn.execute(
            """SELECT id, name, notes, vault_folder, parallel_printers, quote_printer_id, created_at, updated_at
               FROM projects
               ORDER BY updated_at DESC, id DESC"""
        ).fetchall()
    return [_project_row(r) for r in rows]


def get_project_row(project_id: int) -> Optional[dict]:
    with _conn() as conn:
        row = conn.execute(
            """SELECT id, name, notes, vault_folder, parallel_printers, quote_printer_id, created_at, updated_at
               FROM projects WHERE id = ?""",
            (int(project_id),),
        ).fetchone()
    return _project_row(row) if row else None


def create_project(name: str, vault_folder: str, notes: str = "", parallel_printers: int = 1) -> dict:
    cleaned = str(name or "").strip()[:80] or "Untitled project"
    folder = str(vault_folder or "").strip().strip("/")[:180]
    printers = max(1, min(int(parallel_printers or 1), 12))
    with _conn() as conn:
        cur = conn.execute(
            """INSERT INTO projects (name, notes, vault_folder, parallel_printers)
               VALUES (?, ?, ?, ?)""",
            (cleaned, str(notes or "").strip()[:500] or None, folder, printers),
        )
        project_id = int(cur.lastrowid)
    return get_project_row(project_id) or {
        "id": project_id,
        "name": cleaned,
        "vault_folder": folder,
        "parallel_printers": printers,
        "notes": "",
    }


def update_project(
    project_id: int,
    *,
    name: Optional[str] = None,
    notes: Optional[str] = None,
    parallel_printers: Optional[int] = None,
    quote_printer_id: Optional[str] = None,
) -> Optional[dict]:
    if get_project_row(project_id) is None:
        return None
    with _conn() as conn:
        if name is not None:
            conn.execute(
                "UPDATE projects SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                (str(name).strip()[:80] or "Untitled project", int(project_id)),
            )
        if notes is not None:
            conn.execute(
                "UPDATE projects SET notes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                (str(notes).strip()[:500] or None, int(project_id)),
            )
        if parallel_printers is not None:
            conn.execute(
                "UPDATE projects SET parallel_printers = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                (max(1, min(int(parallel_printers), 12)), int(project_id)),
            )
        if quote_printer_id is not None:
            conn.execute(
                "UPDATE projects SET quote_printer_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                (str(quote_printer_id).strip()[:64] or None, int(project_id)),
            )
    return get_project_row(project_id)


def touch_project(project_id: int) -> None:
    with _conn() as conn:
        conn.execute(
            "UPDATE projects SET updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            (int(project_id),),
        )


def delete_project(project_id: int) -> bool:
    with _conn() as conn:
        cur = conn.execute("DELETE FROM projects WHERE id = ?", (int(project_id),))
    return cur.rowcount > 0


_PROJECT_DISMISSED_KEY = "project_vault_dismissed"


def get_dismissed_project_folders() -> set[str]:
    raw = get_all_settings().get(_PROJECT_DISMISSED_KEY) or "[]"
    try:
        parsed = json.loads(raw)
    except Exception:
        return set()
    if not isinstance(parsed, list):
        return set()
    return {str(item).strip().strip("/") for item in parsed if str(item).strip()}


def dismiss_project_folder(vault_folder: str) -> None:
    folder = str(vault_folder or "").strip().strip("/")
    if not folder:
        return
    dismissed = get_dismissed_project_folders()
    dismissed.add(folder)
    set_setting(_PROJECT_DISMISSED_KEY, json.dumps(sorted(dismissed)))


def undismiss_project_folder(vault_folder: str) -> None:
    folder = str(vault_folder or "").strip().strip("/")
    if not folder:
        return
    dismissed = get_dismissed_project_folders()
    if folder not in dismissed:
        return
    dismissed.discard(folder)
    set_setting(_PROJECT_DISMISSED_KEY, json.dumps(sorted(dismissed)))


# ── slicer profiles ───────────────────────────────────────────────────────

def save_slicer_profile_vendor(vendor: str, payload: dict) -> None:
    with _conn() as conn:
        conn.execute(
            """INSERT INTO slicer_profile_catalog (vendor, payload, synced_at)
               VALUES (?, ?, CURRENT_TIMESTAMP)
               ON CONFLICT(vendor) DO UPDATE
               SET payload = excluded.payload, synced_at = excluded.synced_at""",
            (vendor, json.dumps(payload)),
        )


def get_slicer_profile_vendors() -> list[dict]:
    with _conn() as conn:
        rows = conn.execute(
            "SELECT vendor, payload, synced_at FROM slicer_profile_catalog ORDER BY vendor"
        ).fetchall()
    out = []
    for row in rows:
        try:
            payload = json.loads(row["payload"] or "{}")
        except Exception:
            payload = {}
        payload["vendor"] = row["vendor"]
        payload["synced_at"] = row["synced_at"]
        out.append(payload)
    return out


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


def clear_notifications_for_printer(printer_id: str) -> int:
    with _conn() as conn:
        cur = conn.execute(
            """UPDATE notifications
               SET cleared_at = COALESCE(cleared_at, datetime('now')),
                   read_at = COALESCE(read_at, datetime('now'))
               WHERE cleared_at IS NULL AND printer_id = ?""",
            (printer_id,),
        )
    return cur.rowcount


def clear_notifications_for_missing_printers(valid_printer_ids: Iterable[str]) -> int:
    valid = [str(pid) for pid in valid_printer_ids if pid]
    with _conn() as conn:
        if valid:
            placeholders = ",".join("?" for _ in valid)
            cur = conn.execute(
                f"""UPDATE notifications
                    SET cleared_at = COALESCE(cleared_at, datetime('now')),
                        read_at = COALESCE(read_at, datetime('now'))
                    WHERE cleared_at IS NULL
                      AND printer_id IS NOT NULL
                      AND printer_id NOT IN ({placeholders})""",
                tuple(valid),
            )
        else:
            cur = conn.execute(
                """UPDATE notifications
                   SET cleared_at = COALESCE(cleared_at, datetime('now')),
                       read_at = COALESCE(read_at, datetime('now'))
                   WHERE cleared_at IS NULL AND printer_id IS NOT NULL"""
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


def get_empty_spool_profiles(include_archived: bool = False) -> list:
    where = "" if include_archived else "WHERE archived_at IS NULL"
    with _conn() as conn:
        rows = conn.execute(
            f"""SELECT id, brand, material, profile_name, empty_spool_weight_g,
                       source, notes, is_default, archived_at, created_at, updated_at
                FROM empty_spool_profiles
                {where}
                ORDER BY LOWER(brand), LOWER(COALESCE(material, '')), is_default DESC,
                         empty_spool_weight_g, LOWER(profile_name)"""
        ).fetchall()
    return [
        {
            "id": int(r["id"]),
            "brand": r["brand"] or "",
            "material": r["material"] or "",
            "profile_name": r["profile_name"],
            "empty_spool_weight_g": r["empty_spool_weight_g"],
            "source": r["source"] or "manual",
            "notes": r["notes"],
            "is_default": bool(r["is_default"]),
            "archived_at": r["archived_at"],
            "created_at": r["created_at"],
            "updated_at": r["updated_at"],
        }
        for r in rows
    ]


def _normalise_empty_spool_profile(
    brand: str,
    material: Optional[str],
    profile_name: str,
    empty_spool_weight_g: float,
    source: Optional[str] = None,
    notes: Optional[str] = None,
    is_default: bool = False,
) -> dict:
    cleaned_brand = _canonical_brand(brand)
    cleaned_material = (material or "").strip().upper() or None
    cleaned_name = (profile_name or "").strip()
    if not cleaned_name:
        cleaned_name = f"{cleaned_brand or cleaned_material or 'Generic'} spool"
    grams = round(float(empty_spool_weight_g), 1)
    if grams < 0:
        raise ValueError("empty_spool_weight_g must be 0 or greater")
    return {
        "brand": cleaned_brand,
        "material": cleaned_material,
        "profile_name": cleaned_name[:120],
        "empty_spool_weight_g": grams,
        "source": (source or "manual").strip()[:60] or "manual",
        "notes": (notes or "").strip()[:500] or None,
        "is_default": bool(is_default),
    }


def create_empty_spool_profile(
    brand: str,
    material: Optional[str],
    profile_name: str,
    empty_spool_weight_g: float,
    source: Optional[str] = None,
    notes: Optional[str] = None,
    is_default: bool = False,
) -> dict:
    item = _normalise_empty_spool_profile(
        brand, material, profile_name, empty_spool_weight_g, source, notes, is_default
    )
    with _conn() as conn:
        if item["is_default"]:
            conn.execute(
                """UPDATE empty_spool_profiles
                   SET is_default = 0, updated_at = datetime('now')
                   WHERE brand = ? AND COALESCE(material, '') = COALESCE(?, '')
                     AND archived_at IS NULL""",
                (item["brand"], item["material"]),
            )
        cursor = conn.execute(
            """INSERT INTO empty_spool_profiles
               (brand, material, profile_name, empty_spool_weight_g, source, notes, is_default)
               VALUES (?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(brand, material, profile_name) DO UPDATE
               SET empty_spool_weight_g = excluded.empty_spool_weight_g,
                   source = excluded.source,
                   notes = excluded.notes,
                   is_default = excluded.is_default,
                   archived_at = NULL,
                   updated_at = datetime('now')""",
            (
                item["brand"], item["material"], item["profile_name"],
                item["empty_spool_weight_g"], item["source"], item["notes"],
                1 if item["is_default"] else 0,
            ),
        )
        profile_id = cursor.lastrowid
        row = conn.execute(
            """SELECT id FROM empty_spool_profiles
               WHERE brand = ? AND COALESCE(material, '') = COALESCE(?, '')
                 AND profile_name = ?""",
            (item["brand"], item["material"], item["profile_name"]),
        ).fetchone()
        if row:
            profile_id = int(row["id"])
    return get_empty_spool_profile(profile_id) or {}


def get_empty_spool_profile(profile_id: int) -> Optional[dict]:
    with _conn() as conn:
        row = conn.execute(
            """SELECT id, brand, material, profile_name, empty_spool_weight_g,
                      source, notes, is_default, archived_at, created_at, updated_at
               FROM empty_spool_profiles WHERE id = ?""",
            (profile_id,),
        ).fetchone()
    if not row:
        return None
    return {
        "id": int(row["id"]),
        "brand": row["brand"] or "",
        "material": row["material"] or "",
        "profile_name": row["profile_name"],
        "empty_spool_weight_g": row["empty_spool_weight_g"],
        "source": row["source"] or "manual",
        "notes": row["notes"],
        "is_default": bool(row["is_default"]),
        "archived_at": row["archived_at"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def update_empty_spool_profile(
    profile_id: int,
    brand: str,
    material: Optional[str],
    profile_name: str,
    empty_spool_weight_g: float,
    source: Optional[str] = None,
    notes: Optional[str] = None,
    is_default: bool = False,
) -> Optional[dict]:
    item = _normalise_empty_spool_profile(
        brand, material, profile_name, empty_spool_weight_g, source, notes, is_default
    )
    with _conn() as conn:
        if item["is_default"]:
            conn.execute(
                """UPDATE empty_spool_profiles
                   SET is_default = 0, updated_at = datetime('now')
                   WHERE brand = ? AND COALESCE(material, '') = COALESCE(?, '')
                     AND id != ? AND archived_at IS NULL""",
                (item["brand"], item["material"], profile_id),
            )
        c = conn.execute(
            """UPDATE empty_spool_profiles
               SET brand = ?, material = ?, profile_name = ?, empty_spool_weight_g = ?,
                   source = ?, notes = ?, is_default = ?, updated_at = datetime('now')
               WHERE id = ? AND archived_at IS NULL""",
            (
                item["brand"], item["material"], item["profile_name"],
                item["empty_spool_weight_g"], item["source"], item["notes"],
                1 if item["is_default"] else 0, profile_id,
            ),
        )
    if c.rowcount <= 0:
        return None
    return get_empty_spool_profile(profile_id)


def archive_empty_spool_profile(profile_id: int) -> bool:
    with _conn() as conn:
        c = conn.execute(
            """UPDATE empty_spool_profiles
               SET archived_at = datetime('now'), is_default = 0, updated_at = datetime('now')
               WHERE id = ? AND archived_at IS NULL""",
            (profile_id,),
        )
    return c.rowcount > 0


def replace_filament_catalog(rows: list[dict], source: str = "open_filament_database") -> int:
    now = datetime.utcnow().isoformat()
    with _conn() as conn:
        conn.execute("DELETE FROM filament_catalog WHERE source = ?", (source,))
        conn.executemany(
            """INSERT OR REPLACE INTO filament_catalog
               (source, source_variant_id, source_filament_id, brand, material, product,
                subtype, color_name, color_hex, filament_weight_g, empty_spool_weight_g,
                diameter, traits, discontinued, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            [
                (
                    source,
                    r.get("source_variant_id"),
                    r.get("source_filament_id"),
                    _canonical_brand(r.get("brand")),
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
        columns = {r["name"] for r in conn.execute("PRAGMA table_info(filament_catalog)").fetchall()}
        if "updated_at" in columns:
            row = conn.execute(
                """SELECT COUNT(*) AS count, MAX(updated_at) AS updated_at
                   FROM filament_catalog WHERE source = ?""",
                (source,),
            ).fetchone()
        else:
            row = conn.execute(
                "SELECT COUNT(*) AS count, NULL AS updated_at FROM filament_catalog WHERE source = ?",
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


def list_filament_catalog_for_colour_match(
    brand: str = "",
    material: str = "",
    materials: Optional[list] = None,
    limit: int = 8000,
) -> list:
    """Return catalogue rows with usable hex for nearest-colour ranking."""
    clauses = [
        "discontinued = 0",
        "color_hex IS NOT NULL",
        "TRIM(color_hex) != ''",
        "LENGTH(REPLACE(REPLACE(UPPER(color_hex), '#', ''), ' ', '')) >= 6",
    ]
    params: list = []
    if brand:
        clauses.append("brand LIKE ?")
        params.append(f"%{brand}%")
    mat_list = [str(m).strip().upper() for m in (materials or []) if str(m).strip()]
    if not mat_list and material:
        mat = material.strip().upper()
        mat_list = ["PLA", "PLA+"] if mat == "PLA" else [mat]
    if mat_list:
        # Expand PLA → PLA+ for catalogue search convenience.
        expanded: list[str] = []
        for mat in mat_list:
            if mat not in expanded:
                expanded.append(mat)
            if mat == "PLA" and "PLA+" not in expanded:
                expanded.append("PLA+")
        placeholders = ", ".join("?" for _ in expanded)
        clauses.append(f"UPPER(material) IN ({placeholders})")
        params.extend(expanded)
    with _conn() as conn:
        rows = conn.execute(
            f"""SELECT brand, material, product, subtype, color_name, color_hex,
                       filament_weight_g, empty_spool_weight_g, diameter, traits, source
                FROM filament_catalog
                WHERE {' AND '.join(clauses)}
                LIMIT ?""",
            params + [max(1, min(int(limit or 8000), 20000))],
        ).fetchall()
    return [dict(r) for r in rows]


def set_material_cost(
    material: str,
    brand: str,
    cost_per_gram: float,
    comment: Optional[str] = None,
    empty_spool_weight_g: Optional[float] = None,
) -> None:
    brand = _canonical_brand(brand)
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
    brand = _canonical_brand(brand)
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


def _next_spool_display_id(conn: sqlite3.Connection) -> int:
    row = conn.execute(
        """SELECT MAX(display_id) AS max_display_id
           FROM spools
           WHERE display_id IS NOT NULL"""
    ).fetchone()
    current = int(row["max_display_id"] or 0) if row else 0
    return current + 1


def _spool_number(spool: Optional[dict]) -> str:
    if not spool:
        return "-"
    return str(spool.get("display_id") or spool.get("id") or "-")


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
    brand = _canonical_brand(brand)
    color_scheme = _clean_spool_color_scheme(color_scheme)
    color_hex_2 = _clean_optional_hex(color_hex_2)
    color_hex_3 = _clean_optional_hex(color_hex_3)
    with _conn() as conn:
        display_id = _next_spool_display_id(conn)
        cursor = conn.execute(
            """INSERT INTO spools
               (display_id, material, brand, subtype, color_hex, color_name, color_hex_2, color_hex_3, color_scheme,
                label_weight_g, remaining_g, empty_spool_weight_g,
                location_printer_id, location_slot, storage_location_id,
                home_storage_location_id, notes)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (display_id, material, brand, subtype, color_hex, color_name, color_hex_2, color_hex_3, color_scheme,
             label_weight_g, remaining_g, empty_spool_weight_g,
             location_printer_id, location_slot, storage_location_id,
             storage_location_id, notes),
        )
        spool_id = cursor.lastrowid
    printer = location_printer_id or "none"
    log_decision(printer, "spool_added",
                f"Spool #{display_id} {material}/{brand} {color_hex} {remaining_g}g added")
    return spool_id


def restock_spool_line(
    spool_id: int,
    *,
    material: str,
    brand: str,
    color_hex: str,
    label_weight_g: float,
    remaining_g: float,
    subtype: Optional[str] = None,
    color_name: Optional[str] = None,
    color_hex_2: Optional[str] = None,
    color_hex_3: Optional[str] = None,
    color_scheme: str = "solid",
    storage_location_id: Optional[int] = None,
    notes: Optional[str] = None,
    empty_spool_weight_g: Optional[float] = None,
) -> bool:
    existing = get_spool(spool_id)
    if not existing:
        return False
    display_id = int(existing.get("display_id") or spool_id)
    brand = _canonical_brand(brand)
    color_scheme = _clean_spool_color_scheme(color_scheme)
    color_hex_2 = _clean_optional_hex(color_hex_2)
    color_hex_3 = _clean_optional_hex(color_hex_3)
    with _conn() as conn:
        taken = conn.execute(
            """SELECT 1
               FROM spools
               WHERE archived_at IS NULL AND display_id = ? AND id != ?""",
            (display_id, spool_id),
        ).fetchone()
        if taken:
            raise ValueError(f"Spool #{display_id} is already active")
        c = conn.execute(
            """UPDATE spools
               SET material = ?, brand = ?, subtype = ?, color_hex = ?, color_name = ?,
                   color_hex_2 = ?, color_hex_3 = ?, color_scheme = ?,
                   label_weight_g = ?, remaining_g = ?, empty_spool_weight_g = ?,
                   location_printer_id = NULL, location_slot = NULL,
                   storage_location_id = ?, home_storage_location_id = ?,
                   notes = ?, archived_at = NULL, updated_at = CURRENT_TIMESTAMP
               WHERE id = ?""",
            (
                material, brand, subtype, color_hex, color_name,
                color_hex_2, color_hex_3, color_scheme,
                label_weight_g, remaining_g, empty_spool_weight_g,
                storage_location_id, storage_location_id,
                notes, spool_id,
            ),
        )
    if c.rowcount:
        log_decision("system", "spool_restocked",
                     f"Spool #{display_id} restocked as {material}/{brand} {color_hex} {remaining_g}g")
    return c.rowcount > 0


def get_spools(include_archived: bool = False) -> list:
    with _conn() as conn:
        where = "" if include_archived else "WHERE archived_at IS NULL"
        rows = conn.execute(
            f"""SELECT id, display_id, material, brand, subtype, color_hex, color_name, color_hex_2, color_hex_3, color_scheme,
                       label_weight_g, remaining_g, empty_spool_weight_g,
                       location_printer_id, location_slot, storage_location_id,
                       home_storage_location_id,
                       (SELECT name FROM spool_locations WHERE id = spools.storage_location_id) AS storage_location_name,
                       (SELECT name FROM spool_locations WHERE id = spools.home_storage_location_id) AS home_storage_location_name,
                       notes, added_at, archived_at
                FROM spools {where}
                ORDER BY material, brand, display_id, id"""
        ).fetchall()
        spools = [dict(r) for r in rows]
        _attach_spool_confidence(conn, spools)
    return spools


def get_spool(spool_id: int) -> Optional[dict]:
    with _conn() as conn:
        row = conn.execute(
            """SELECT id, display_id, material, brand, subtype, color_hex, color_name, color_hex_2, color_hex_3, color_scheme,
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


def get_spool_by_display_id(display_id: int, include_archived: bool = True) -> Optional[dict]:
    with _conn() as conn:
        row = conn.execute(
            f"""SELECT id
                FROM spools
                WHERE display_id = ?
                {'ORDER BY archived_at IS NULL DESC, id DESC' if include_archived else 'AND archived_at IS NULL ORDER BY id DESC'}
                LIMIT 1""",
            (display_id,),
        ).fetchone()
    return get_spool(int(row["id"])) if row else None


def _incoming_roll_from_row(row) -> dict:
    item = dict(row)
    item["label_weight_g"] = float(item.get("label_weight_g") or 0)
    if item.get("empty_spool_weight_g") is not None:
        item["empty_spool_weight_g"] = float(item["empty_spool_weight_g"])
    return item


def _new_stock_token(conn) -> str:
    for _ in range(12):
        token = secrets.token_urlsafe(10).replace("-", "").replace("_", "")[:12]
        if not conn.execute("SELECT 1 FROM incoming_stock_rolls WHERE token = ?", (token,)).fetchone():
            return token
    return secrets.token_hex(12)


def create_incoming_stock_order(supplier: Optional[str], order_ref: Optional[str], notes: Optional[str], lines: list[dict]) -> dict:
    clean_lines = []
    for line in lines or []:
        qty = max(1, int(line.get("quantity") or 1))
        clean_lines.append({**line, "quantity": qty})
    if not clean_lines:
        raise ValueError("At least one roll is required")
    with _conn() as conn:
        cursor = conn.execute(
            "INSERT INTO incoming_stock_orders (supplier, order_ref, notes) VALUES (?, ?, ?)",
            (supplier, order_ref, notes),
        )
        order_id = cursor.lastrowid
        for line in clean_lines:
            for _ in range(line["quantity"]):
                conn.execute(
                    """INSERT INTO incoming_stock_rolls
                       (order_id, token, material, brand, subtype, color_hex, color_name,
                        color_scheme, color_hex_2, color_hex_3, label_weight_g,
                        empty_spool_weight_g, storage_location_id, notes)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    (
                        order_id,
                        _new_stock_token(conn),
                        (line.get("material") or "PLA").strip(),
                        _canonical_brand(line.get("brand") or "Unknown"),
                        line.get("subtype"),
                        (line.get("color_hex") or "#808080").strip(),
                        line.get("color_name"),
                        _clean_spool_color_scheme(line.get("color_scheme")),
                        _clean_optional_hex(line.get("color_hex_2")),
                        _clean_optional_hex(line.get("color_hex_3")),
                        float(line.get("label_weight_g") or 1000),
                        line.get("empty_spool_weight_g"),
                        line.get("storage_location_id"),
                        line.get("notes"),
                    ),
                )
    log_decision("system", "stock_in_created", f"Incoming stock order #{order_id} created")
    return get_incoming_stock_order(order_id) or {"id": order_id, "rolls": []}


def get_incoming_stock_order(order_id: int) -> Optional[dict]:
    with _conn() as conn:
        order = conn.execute(
            """SELECT id, supplier, order_ref, notes, created_at, closed_at
               FROM incoming_stock_orders WHERE id = ?""",
            (order_id,),
        ).fetchone()
        if not order:
            return None
        rolls = conn.execute(
            """SELECT r.*,
                      (SELECT name FROM spool_locations WHERE id = r.storage_location_id) AS storage_location_name
               FROM incoming_stock_rolls r
               WHERE r.order_id = ?
               ORDER BY r.id""",
            (order_id,),
        ).fetchall()
    item = dict(order)
    item["rolls"] = [_incoming_roll_from_row(r) for r in rolls]
    item["pending_count"] = sum(1 for r in item["rolls"] if r.get("status") == "pending")
    item["received_count"] = sum(1 for r in item["rolls"] if r.get("status") == "received")
    return item


def get_incoming_stock_orders(limit: int = 20) -> list:
    with _conn() as conn:
        rows = conn.execute(
            """SELECT id FROM incoming_stock_orders
               ORDER BY created_at DESC, id DESC
               LIMIT ?""",
            (max(1, min(int(limit or 20), 100)),),
        ).fetchall()
    return [order for row in rows if (order := get_incoming_stock_order(int(row["id"])))]


def get_incoming_stock_roll(token: str) -> Optional[dict]:
    with _conn() as conn:
        row = conn.execute(
            """SELECT r.*,
                      o.supplier, o.order_ref,
                      (SELECT name FROM spool_locations WHERE id = r.storage_location_id) AS storage_location_name
               FROM incoming_stock_rolls r
               JOIN incoming_stock_orders o ON o.id = r.order_id
               WHERE r.token = ?""",
            (token,),
        ).fetchone()
    return _incoming_roll_from_row(row) if row else None


def update_incoming_stock_roll(token: str, fields: dict) -> Optional[dict]:
    roll = get_incoming_stock_roll(token)
    if not roll:
        return None
    if roll.get("status") != "pending":
        raise ValueError("Only pending incoming rolls can be edited")
    allowed = {
        "material", "brand", "subtype", "color_hex", "color_name",
        "color_scheme", "color_hex_2", "color_hex_3", "label_weight_g",
        "empty_spool_weight_g", "storage_location_id", "notes",
    }
    updates = {}
    for key, value in fields.items():
        if key not in allowed:
            continue
        if key == "color_scheme":
            value = _clean_spool_color_scheme(value)
        if key in {"color_hex_2", "color_hex_3"}:
            value = _clean_optional_hex(value)
        if key == "brand":
            value = _canonical_brand(value)
        elif key == "material" and isinstance(value, str):
            value = value.strip()
        updates[key] = value
    if not updates:
        return roll
    assignments = ", ".join(f"{key} = ?" for key in updates)
    with _conn() as conn:
        conn.execute(
            f"UPDATE incoming_stock_rolls SET {assignments} WHERE token = ?",
            [*updates.values(), token],
        )
    log_decision("system", "stock_in_roll_updated", f"Incoming roll {token} updated")
    return get_incoming_stock_roll(token)


def cancel_incoming_stock_roll(token: str, reason: Optional[str] = None) -> Optional[dict]:
    roll = get_incoming_stock_roll(token)
    if not roll:
        return None
    if roll.get("status") == "received":
        raise ValueError("Received incoming rolls cannot be cancelled")
    if roll.get("status") == "cancelled":
        return roll
    with _conn() as conn:
        conn.execute(
            """UPDATE incoming_stock_rolls
               SET status = 'cancelled', cancelled_at = datetime('now'), cancel_reason = ?
               WHERE token = ?""",
            (reason, token),
        )
    log_decision("system", "stock_in_roll_cancelled", f"Incoming roll {token} cancelled: {reason or 'no reason'}")
    return get_incoming_stock_roll(token)


def receive_incoming_stock_roll(
    token: str,
    *,
    restock_spool_id: Optional[int] = None,
    restock_display_id: Optional[int] = None,
    storage_location_id: Optional[int] = None,
    remaining_g: Optional[float] = None,
    label_weight_g: Optional[float] = None,
    empty_spool_weight_g: Optional[float] = None,
    notes: Optional[str] = None,
) -> Optional[dict]:
    roll = get_incoming_stock_roll(token)
    if not roll:
        return None
    if roll.get("status") == "received" and roll.get("spool_id"):
        return {"roll": roll, "spool": get_spool(int(roll["spool_id"])), "already_received": True}

    final_label = float(label_weight_g if label_weight_g is not None else roll["label_weight_g"])
    final_remaining = float(remaining_g if remaining_g is not None else final_label)
    final_tare = empty_spool_weight_g if empty_spool_weight_g is not None else roll.get("empty_spool_weight_g")
    final_location = storage_location_id if storage_location_id is not None else roll.get("storage_location_id")
    final_notes = notes if notes is not None else roll.get("notes")
    target_spool = None
    if restock_spool_id:
        target_spool = get_spool(int(restock_spool_id))
    elif restock_display_id:
        target_spool = get_spool_by_display_id(int(restock_display_id), include_archived=True)
    if target_spool:
        if not target_spool.get("archived_at"):
            raise ValueError(f"Spool #{_spool_number(target_spool)} is active already. Archive it before restocking that number.")
        spool_id = int(target_spool["id"])
        restock_spool_line(
            spool_id,
            material=roll["material"],
            brand=roll["brand"],
            color_hex=roll["color_hex"],
            label_weight_g=final_label,
            remaining_g=final_remaining,
            subtype=roll.get("subtype"),
            color_name=roll.get("color_name"),
            color_hex_2=roll.get("color_hex_2"),
            color_hex_3=roll.get("color_hex_3"),
            color_scheme=roll.get("color_scheme") or "solid",
            storage_location_id=final_location,
            notes=final_notes,
            empty_spool_weight_g=final_tare,
        )
    else:
        spool_id = create_spool(
            material=roll["material"],
            brand=roll["brand"],
            color_hex=roll["color_hex"],
            label_weight_g=final_label,
            remaining_g=final_remaining,
            subtype=roll.get("subtype"),
            color_name=roll.get("color_name"),
            color_hex_2=roll.get("color_hex_2"),
            color_hex_3=roll.get("color_hex_3"),
            color_scheme=roll.get("color_scheme") or "solid",
            storage_location_id=final_location,
            notes=final_notes,
            empty_spool_weight_g=final_tare,
        )
    with _conn() as conn:
        conn.execute(
            """UPDATE incoming_stock_rolls
               SET status = 'received', spool_id = ?, received_at = datetime('now'),
                   storage_location_id = ?, label_weight_g = ?, empty_spool_weight_g = ?, notes = ?
               WHERE token = ?""",
            (spool_id, final_location, final_label, final_tare, final_notes, token),
        )
    spool = get_spool(spool_id)
    log_decision("system", "stock_in_received", f"Incoming roll {token} received as spool #{_spool_number(spool)}")
    return {"roll": get_incoming_stock_roll(token), "spool": get_spool(spool_id), "already_received": False}


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


def _auto_archive_empty_spool(conn: sqlite3.Connection, spool_id: int) -> bool:
    row = conn.execute(
        "SELECT remaining_g, archived_at FROM spools WHERE id = ?",
        (spool_id,),
    ).fetchone()
    if not row or row["archived_at"] is not None:
        return False
    try:
        remaining = float(row["remaining_g"] or 0)
    except (TypeError, ValueError):
        return False
    if remaining > 0.005:
        return False
    c = conn.execute(
        """UPDATE spools
           SET archived_at = CURRENT_TIMESTAMP,
               location_printer_id = NULL,
               location_slot = NULL,
               storage_location_id = NULL,
               home_storage_location_id = NULL,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = ? AND archived_at IS NULL""",
        (spool_id,),
    )
    return c.rowcount > 0


def update_spool(spool_id: int, **fields) -> bool:
    allowed = {"material", "brand", "subtype", "color_hex", "color_name", "color_hex_2", "color_hex_3", "color_scheme",
               "label_weight_g", "remaining_g", "empty_spool_weight_g", "notes"}
    updates = {k: v for k, v in fields.items() if k in allowed}
    if "brand" in updates:
        updates["brand"] = _canonical_brand(updates["brand"])
    if "color_scheme" in updates:
        updates["color_scheme"] = _clean_spool_color_scheme(updates.get("color_scheme"))
    for key in ("color_hex_2", "color_hex_3"):
        if key in updates:
            updates[key] = _clean_optional_hex(updates.get(key))
    if not updates:
        return False
    cols = ", ".join(f"{k} = ?" for k in updates)
    vals = list(updates.values()) + [spool_id]
    archived_empty = False
    with _conn() as conn:
        c = conn.execute(f"UPDATE spools SET {cols} WHERE id = ?", vals)
        if c.rowcount and "remaining_g" in updates:
            archived_empty = _auto_archive_empty_spool(conn, spool_id)
    if archived_empty:
        log_decision("system", "spool_auto_archived_empty", f"Spool #{spool_id} archived after remaining weight reached 0g")
    return c.rowcount > 0


def delete_spool(spool_id: int) -> bool:
    with _conn() as conn:
        c = conn.execute("DELETE FROM spools WHERE id = ?", (spool_id,))
    return c.rowcount > 0


def archive_spool(spool_id: int) -> bool:
    spool = get_spool(spool_id)
    with _conn() as conn:
        c = conn.execute(
            "UPDATE spools SET archived_at = CURRENT_TIMESTAMP WHERE id = ? AND archived_at IS NULL",
            (spool_id,),
        )
    if c.rowcount:
        log_decision("system", "spool_archived", f"Spool #{_spool_number(spool)} archived")
    return c.rowcount > 0


def restore_spool(spool_id: int) -> bool:
    spool = get_spool(spool_id)
    with _conn() as conn:
        display_id = None
        if spool:
            wanted = int(spool.get("display_id") or spool_id)
            taken = conn.execute(
                """SELECT 1
                   FROM spools
                   WHERE archived_at IS NULL AND display_id = ? AND id != ?""",
                (wanted, spool_id),
            ).fetchone()
            display_id = wanted if not taken else _next_spool_display_id(conn)
        c = conn.execute(
            "UPDATE spools SET archived_at = NULL, display_id = COALESCE(?, display_id, id) WHERE id = ?",
            (display_id, spool_id),
        )
    if c.rowcount:
        label = display_id or (spool.get("display_id") if spool else spool_id)
        log_decision("system", "spool_restored", f"Spool #{label} restored")
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
    spool = get_spool(spool_id)
    updates = {"remaining_g": max(0.0, float(remaining_g))}
    if empty_spool_weight_g is not None:
        updates["empty_spool_weight_g"] = float(empty_spool_weight_g)
    cols = ", ".join(f"{k} = ?" for k in updates)
    vals = list(updates.values()) + [spool_id]
    archived_empty = False
    with _conn() as conn:
        c = conn.execute(f"UPDATE spools SET {cols} WHERE id = ?", vals)
        if c.rowcount:
            archived_empty = _auto_archive_empty_spool(conn, spool_id)
    if c.rowcount:
        detail = f"Spool #{_spool_number(spool)} corrected to {updates['remaining_g']:.1f}g"
        if reading_g is not None:
            detail += f" from scale reading {float(reading_g):.1f}g"
        log_decision("system", "spool_weight_corrected", detail)
        if archived_empty:
            log_decision("system", "spool_auto_archived_empty", f"Spool #{_spool_number(spool)} archived after weight correction reached 0g")
    return c.rowcount > 0


def move_spool(
    spool_id: int,
    printer_id: Optional[str],
    slot: Optional[int],
    storage_location_id: Optional[int] = None,
) -> dict:
    """Move spool to a new location. Returns {ok: bool, conflict_spool_id: int|None}."""
    spool = get_spool(spool_id)
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
        if old_loc != new_loc or old_storage_id != target_storage_id:
            log_decision("system", "spool_moved", f"Spool #{_spool_number(spool)} {old_loc} → {new_loc}")
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


def get_spool_location_usage(location_id: int) -> dict:
    with _conn() as conn:
        loc = conn.execute(
            "SELECT id, name FROM spool_locations WHERE id = ? AND archived_at IS NULL",
            (location_id,),
        ).fetchone()
        active_stored = conn.execute(
            """SELECT COUNT(*) AS n FROM spools
               WHERE storage_location_id = ?
                 AND location_printer_id IS NULL
                 AND archived_at IS NULL""",
            (location_id,),
        ).fetchone()["n"]
        active_home = conn.execute(
            """SELECT COUNT(*) AS n FROM spools
               WHERE home_storage_location_id = ?
                 AND archived_at IS NULL""",
            (location_id,),
        ).fetchone()["n"]
    return {
        "exists": bool(loc),
        "name": loc["name"] if loc else None,
        "active_stored_count": int(active_stored or 0),
        "active_home_count": int(active_home or 0),
    }


def archive_spool_location(location_id: int, archive_spools: bool = False) -> bool:
    archived_spool_ids: list[int] = []
    with _conn() as conn:
        loc = conn.execute(
            "SELECT name FROM spool_locations WHERE id = ? AND archived_at IS NULL",
            (location_id,),
        ).fetchone()
        c = conn.execute(
            "UPDATE spool_locations SET archived_at = CURRENT_TIMESTAMP WHERE id = ? AND archived_at IS NULL",
            (location_id,),
        )
        if c.rowcount:
            if archive_spools:
                archived_spool_ids = [
                    int(r["id"])
                    for r in conn.execute(
                        """SELECT id FROM spools
                           WHERE storage_location_id = ?
                             AND location_printer_id IS NULL
                             AND archived_at IS NULL""",
                        (location_id,),
                    ).fetchall()
                ]
                conn.execute(
                    """UPDATE spools
                       SET archived_at = CURRENT_TIMESTAMP,
                           storage_location_id = NULL,
                           home_storage_location_id = NULL,
                           updated_at = CURRENT_TIMESTAMP
                       WHERE storage_location_id = ?
                         AND location_printer_id IS NULL
                         AND archived_at IS NULL""",
                    (location_id,),
                )
            conn.execute(
                "UPDATE spools SET storage_location_id = NULL WHERE storage_location_id = ?",
                (location_id,),
            )
            conn.execute(
                "UPDATE spools SET home_storage_location_id = NULL WHERE home_storage_location_id = ?",
                (location_id,),
            )
    ok = c.rowcount > 0
    if ok:
        name = loc["name"] if loc else f"#{location_id}"
        log_decision("system", "spool_location_archived", f"Storage location {name} archived")
        if archived_spool_ids:
            log_decision(
                "system",
                "spools_archived_with_location",
                f"Archived {len(archived_spool_ids)} stored spool(s) with location {name}",
            )
    return ok


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
            """SELECT id, display_id, material, brand, subtype, color_hex, color_name, color_hex_2, color_hex_3, color_scheme,
                      label_weight_g, remaining_g, location_slot, notes
               FROM spools
               WHERE location_printer_id = ? AND archived_at IS NULL""",
            (printer_id,),
        ).fetchall()
    return {r["location_slot"]: dict(r) for r in rows}


def get_spool_at_slot(printer_id: str, slot: int) -> Optional[dict]:
    with _conn() as conn:
        row = conn.execute(
            """SELECT id, display_id, material, brand, color_hex, color_name, color_hex_2, color_hex_3, color_scheme, remaining_g, label_weight_g
               FROM spools
               WHERE location_printer_id = ? AND location_slot = ? AND archived_at IS NULL""",
            (printer_id, slot),
        ).fetchone()
    return dict(row) if row else None


def get_recent_spool_for_slot(printer_id: str, slot: int, limit: int = 25) -> Optional[int]:
    """Return the most recent spool id known for a printer slot."""
    slot_int = int(slot)
    from_decisions = _recent_spool_id_from_slot_decisions(printer_id, slot_int)
    if from_decisions is not None:
        spool = get_spool(from_decisions)
        if spool and not spool.get("archived_at"):
            return from_decisions

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
    keys = [str(slot_int)]
    if 128 <= slot_int < 512:
        keys.append(str(slot_int * 4))
    for row in rows:
        try:
            snapshot = json.loads(row["ams_slot_snapshot"] or "{}")
        except Exception:
            continue
        entry = next((snapshot.get(key) for key in keys if snapshot.get(key) is not None), None)
        if isinstance(entry, dict) and entry.get("spool_id"):
            try:
                spool_id = int(entry["spool_id"])
            except (TypeError, ValueError):
                return None
            spool = get_spool(spool_id)
            if spool and not spool.get("archived_at"):
                return spool_id
    return None


def _recent_spool_id_from_slot_decisions(printer_id: str, slot: int) -> Optional[int]:
    """Last spool moved into this printer slot according to the decision log."""
    import re

    target = f"{printer_id}:{int(slot)}"
    move_re = re.compile(rf"Spool #(\d+)\b.*→ {re.escape(target)}\b")
    claim_re = re.compile(rf"Spool #(\d+)\b.*auto-claimed\b")
    with _conn() as conn:
        rows = conn.execute(
            """
            SELECT detail, event
            FROM decisions
            WHERE event IN ('spool_moved', 'spool_auto_claimed', 'spool_auto_returned')
            ORDER BY logged_at DESC
            LIMIT 80
            """,
        ).fetchall()
    for row in rows:
        detail = str(row["detail"] or "")
        if row["event"] == "spool_auto_returned" and target in detail:
            continue
        match = move_re.search(detail)
        if match:
            return int(match.group(1))
        if row["event"] == "spool_auto_claimed" and target.split(":")[0] in detail and f"to " in detail:
            claim_match = claim_re.search(detail)
            if claim_match:
                return int(claim_match.group(1))
    return None


def write_slot_snapshot(print_id: int, snapshot: dict) -> None:
    """Persist the enriched slot/gate snapshot (with spool_ids) to the prints row.

    Existing print-start snapshots are preserved across service restarts, but
    missing spool assignments may be filled in if a later snapshot can now match
    the same slot. This repairs direct-printer starts that captured before the
    H-series AMS HT slot was normalised.
    """
    import json
    with _conn() as conn:
        row = conn.execute(
            "SELECT ams_slot_snapshot FROM prints WHERE id = ?",
            (print_id,),
        ).fetchone()
        if not row or not row["ams_slot_snapshot"]:
            conn.execute(
                "UPDATE prints SET ams_slot_snapshot = ? WHERE id = ?",
                (json.dumps(snapshot), print_id),
            )
            return

        try:
            existing = json.loads(row["ams_slot_snapshot"] or "{}")
        except Exception:
            return
        if not isinstance(existing, dict):
            return

        changed = False
        for key, incoming in snapshot.items():
            if not isinstance(incoming, dict):
                continue
            current = existing.get(key)
            if not isinstance(current, dict):
                existing[key] = incoming
                changed = True
                continue
            if not current.get("spool_id") and incoming.get("spool_id"):
                current["spool_id"] = incoming.get("spool_id")
                current["remaining_g_at_start"] = incoming.get("remaining_g_at_start")
                current.setdefault("flat_slot", incoming.get("flat_slot"))
                changed = True

        incoming_meta = snapshot.get("__meta__")
        if isinstance(incoming_meta, dict):
            existing_meta = existing.get("__meta__")
            if not isinstance(existing_meta, dict):
                existing["__meta__"] = incoming_meta
                changed = True
            elif incoming_meta.get("active_slot") is not None and existing_meta.get("active_slot") != incoming_meta.get("active_slot"):
                existing_meta["active_slot"] = incoming_meta.get("active_slot")
                changed = True

        if changed:
            conn.execute(
                "UPDATE prints SET ams_slot_snapshot = ? WHERE id = ?",
                (json.dumps(existing), print_id),
            )


def deduct_spool_usage(
    printer_id: str,
    print_id: int,
    total_grams: float,
    active_slot: Optional[int] = None,
    filament_usage: Optional[list[dict]] = None,
) -> None:
    """Read stored slot snapshot, deduct remaining grams from mapped spools."""
    _deduct_spool_usage_to_target(
        printer_id,
        print_id,
        total_grams,
        target_ratio=1.0,
        active_slot=active_slot,
        filament_usage=filament_usage,
    )


def deduct_spool_usage_progress(
    printer_id: str,
    print_id: int,
    total_grams: float,
    progress: float,
    active_slot: Optional[int] = None,
    filament_usage: Optional[list[dict]] = None,
) -> bool:
    """Deduct spool usage at 10% live-print checkpoints.

    Returns True when a new checkpoint deducted filament. The final 10% is
    reserved for deduct_spool_usage() once the printer reports FINISHED.
    """
    try:
        pct = max(0.0, min(float(progress), 0.999))
    except (TypeError, ValueError):
        return False
    checkpoint = int(pct * 10) * 10
    if checkpoint < 10:
        return False
    checkpoint = min(checkpoint, 90)
    return _deduct_spool_usage_to_target(
        printer_id,
        print_id,
        total_grams,
        target_ratio=checkpoint / 100.0,
        active_slot=active_slot,
        filament_usage=filament_usage,
    )


def _deduct_spool_usage_to_target(
    printer_id: str,
    print_id: int,
    total_grams: float,
    *,
    target_ratio: float,
    active_slot: Optional[int] = None,
    filament_usage: Optional[list[dict]] = None,
) -> bool:
    """Deduct only the delta needed to bring spool_usage up to target_ratio."""
    import json
    try:
        total_grams = float(total_grams or 0)
        target_ratio = max(0.0, min(float(target_ratio), 1.0))
    except (TypeError, ValueError):
        return False
    if total_grams <= 0 or target_ratio <= 0:
        return False

    slot_snapshot: dict[int, dict] = {}
    existing_usage = []
    with _conn() as conn:
        row = conn.execute(
            "SELECT ams_slot_snapshot, spool_usage FROM prints WHERE id = ?", (print_id,)
        ).fetchone()
        if not row or not row["ams_slot_snapshot"]:
            log.info("No slot snapshot for print %d, skipping spool deduction", print_id)
            return False
        try:
            snapshot_raw = json.loads(row["ams_slot_snapshot"])
        except Exception:
            log.warning("Invalid slot snapshot for print %d, skipping spool deduction", print_id)
            return False
        if not isinstance(snapshot_raw, dict):
            log.warning("Unexpected slot snapshot shape for print %d, skipping spool deduction", print_id)
            return False
        meta = snapshot_raw.get("__meta__", {}) if isinstance(snapshot_raw.get("__meta__"), dict) else {}
        for raw_slot, data in snapshot_raw.items():
            if raw_slot == "__meta__" or not isinstance(data, dict):
                continue
            try:
                slot_snapshot[int(raw_slot)] = data
            except (TypeError, ValueError):
                log.debug("Ignoring non-numeric snapshot slot %r for print %d", raw_slot, print_id)
        try:
            existing_usage = json.loads(row["spool_usage"] or "[]")
        except Exception:
            existing_usage = []

    if not slot_snapshot:
        log.info("No usable slot snapshot for print %d, skipping spool deduction", print_id)
        return False

    if active_slot is None:
        try:
            active_slot = int(meta.get("active_slot")) if meta.get("active_slot") is not None else None
        except (TypeError, ValueError):
            active_slot = None
    if active_slot is None:
        active_slots = [s for s, d in slot_snapshot.items() if d.get("active")]
        if len(active_slots) == 1:
            active_slot = active_slots[0]

    # snapshot: {slot_str: {... "spool_id": int|null}}
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
                    and _usage_material_score(req["material"], item[2].get("type")) < 99
                ] or [item for item in available if item[0] not in used_slots] or available
                if not matches:
                    continue
                best = min(
                    matches,
                    key=lambda item: (
                        _usage_material_score(req["material"], item[2].get("type")),
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
    existing_by_key: dict[tuple[int, int], dict] = {}
    existing_rows = existing_usage if isinstance(existing_usage, list) else []
    for entry in existing_rows:
        if not isinstance(entry, dict):
            continue
        try:
            key = (int(entry.get("slot")), int(entry.get("spool_id")))
        except (TypeError, ValueError):
            spool_usage.append(entry)
            continue
        existing_by_key[key] = entry
        spool_usage.append(entry)

    with _conn() as conn:
        decision_logs = []
        auto_archived_spool_ids: set[int] = set()
        for slot, grams in slot_grams.items():
            spool_id = spool_id_map[slot]
            target_grams = round(float(grams) * target_ratio, 4)
            key = (int(slot), int(spool_id))
            existing = existing_by_key.get(key)
            try:
                already = float(existing.get("grams") or 0) if existing else 0.0
            except (TypeError, ValueError):
                already = 0.0
            delta = target_grams - already
            if delta <= 0.05:
                if existing:
                    existing["progress_pct"] = max(int(existing.get("progress_pct") or 0), int(target_ratio * 100))
                continue
            cur = conn.execute("SELECT remaining_g, display_id FROM spools WHERE id = ?", (spool_id,)).fetchone()
            if not cur:
                continue
            spool_label = cur["display_id"] or spool_id
            old_r = cur["remaining_g"]
            new_r = max(0.0, old_r - delta)
            conn.execute("UPDATE spools SET remaining_g = ? WHERE id = ?", (new_r, spool_id))
            if _auto_archive_empty_spool(conn, spool_id):
                auto_archived_spool_ids.add(int(spool_id))
            if existing:
                usage = existing
                usage["grams"] = round(already + delta, 2)
                usage["remaining_after_g"] = round(float(new_r), 2)
            else:
                usage = {
                    "spool_id": spool_id,
                    "display_id": spool_label,
                    "grams": round(delta, 2),
                    "slot": slot,
                    "remaining_before_g": round(float(old_r), 2),
                    "remaining_after_g": round(float(new_r), 2),
                }
                spool_usage.append(usage)
                existing_by_key[key] = usage
            usage["progress_pct"] = int(target_ratio * 100)
            if target_ratio < 1.0:
                usage["live_deduction"] = True
            if filament_usage:
                usage["attribution"] = "filament_usage"
            start_g = slot_snapshot.get(slot, {}).get("remaining_g_at_start")
            if start_g is not None:
                try:
                    usage["remaining_start_g"] = round(float(start_g), 2)
                except (TypeError, ValueError):
                    pass
            if old_r - delta < 0:
                decision_logs.append(("spool_overdrawn",
                                      f"Spool #{spool_label} slot {slot}: tried to deduct {delta:.1f}g "
                                      f"but only {old_r:.1f}g remained; clamped to 0"))
            else:
                event = "spool_deducted_live" if target_ratio < 1.0 else "spool_deducted"
                if target_ratio < 1.0 and already <= 0.05 and target_ratio >= 0.2:
                    action_note = f"catch-up deducted to {int(target_ratio * 100)}%"
                else:
                    action_note = f"{delta:.1f}g deducted"
                    if target_ratio < 1.0:
                        action_note += f" at {int(target_ratio * 100)}%"
                decision_logs.append((event,
                                      f"Spool #{spool_label} slot {slot}: {action_note} "
                                      f"({old_r:.1f}g -> {new_r:.1f}g)"))
            if int(spool_id) in auto_archived_spool_ids:
                decision_logs.append(("spool_auto_archived_empty", f"Spool #{spool_label} archived after remaining weight reached 0g"))

        if target_ratio >= 1.0:
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
    return bool(decision_logs)


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
    return _usage_material_score(wanted, got) < 99


def _usage_material_score(wanted: str, got) -> int:
    """Rank material matches before colour proximity.

    A sliced ABS job should prefer an exact ABS slot over an ABS+ slot even if
    the ABS+ colour is closer to the preview colour. Compatibility remains as a
    fallback for loose slicer metadata, but it should not beat exact material.
    """
    material = _material_match_key(got)
    wanted = _material_match_key(wanted)
    if not wanted or not material:
        return 99
    if wanted == material:
        return 0
    if wanted in material or material in wanted:
        return 10
    return 99


def _material_match_key(value) -> str:
    import re
    text = str(value or "").lower().replace("+", "plus")
    return re.sub(r"[^a-z0-9]+", "", text)


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
        archived_empty = _auto_archive_empty_spool(conn, spool_id)
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
    if archived_empty:
        log_decision(prow["printer_id"], "spool_auto_archived_empty", f"Spool #{spool_id} archived after reconcile reached 0g", print_id=print_id)
    return {
        "spool_id": spool_id,
        "remaining_g": round(actual_remaining, 1),
        "recorded_grams": round(recorded, 2),
        "actual_grams": round(actual_loss, 2),
        "waste_grams": round(waste, 2),
        "restored": restored,
    }


def correct_print_spool_attribution(
    print_id: int,
    from_spool_id: int,
    to_spool_id: int,
    *,
    grams: Optional[float] = None,
    note: Optional[str] = None,
) -> Optional[dict]:
    """Move recorded print usage from one spool to another.

    This is for attribution mistakes where the print did consume the recorded
    grams, but Flightdeck attached them to the wrong loaded spool. It restores
    the old spool and deducts the same grams from the corrected spool.
    """
    import json
    if int(from_spool_id) == int(to_spool_id):
        return None
    with _conn() as conn:
        prow = conn.execute(
            "SELECT id, printer_id, spool_usage FROM prints WHERE id = ?",
            (print_id,),
        ).fetchone()
        if not prow:
            return None
        old_spool = conn.execute(
            "SELECT id, display_id, remaining_g, location_slot FROM spools WHERE id = ?",
            (from_spool_id,),
        ).fetchone()
        new_spool = conn.execute(
            "SELECT id, display_id, remaining_g, location_slot FROM spools WHERE id = ?",
            (to_spool_id,),
        ).fetchone()
        if not old_spool or not new_spool:
            return None
        try:
            usage = json.loads(prow["spool_usage"] or "[]")
        except Exception:
            usage = []
        if not isinstance(usage, list):
            usage = []

        source = None
        for entry in usage:
            if isinstance(entry, dict) and int(entry.get("spool_id") or 0) == int(from_spool_id):
                source = entry
                break
        if source is None:
            return None

        source_original = dict(source)
        recorded = _usage_grams(source)
        try:
            move_grams = float(grams) if grams is not None else recorded
        except (TypeError, ValueError):
            move_grams = recorded
        move_grams = round(max(0.0, min(move_grams, recorded)), 2)
        if move_grams <= 0:
            return None

        conn.execute(
            "UPDATE spools SET remaining_g = remaining_g + ? WHERE id = ?",
            (move_grams, from_spool_id),
        )
        new_remaining = max(0.0, float(new_spool["remaining_g"] or 0) - move_grams)
        conn.execute(
            "UPDATE spools SET remaining_g = ? WHERE id = ?",
            (new_remaining, to_spool_id),
        )
        archived_empty = _auto_archive_empty_spool(conn, to_spool_id)

        if move_grams >= recorded - 0.005:
            usage = [entry for entry in usage if entry is not source]
        else:
            source["grams"] = round(recorded - move_grams, 2)
            if source.get("actual_grams") is not None:
                source["actual_grams"] = round(max(0.0, float(source.get("actual_grams") or 0) - move_grams), 2)
            if source.get("remaining_after_g") is not None:
                try:
                    source["remaining_after_g"] = round(float(source["remaining_after_g"]) + move_grams, 2)
                except (TypeError, ValueError):
                    pass

        replacement = dict(source_original)
        replacement["spool_id"] = int(to_spool_id)
        replacement["display_id"] = int(new_spool["display_id"] or to_spool_id)
        replacement["grams"] = move_grams
        replacement["actual_grams"] = move_grams
        replacement["slot"] = new_spool["location_slot"]
        replacement["remaining_before_g"] = round(float(new_spool["remaining_g"] or 0), 2)
        replacement["remaining_after_g"] = round(new_remaining, 2)
        replacement["corrected_from_spool_id"] = int(from_spool_id)
        replacement["corrected_at"] = datetime.utcnow().isoformat()
        replacement["correction_note"] = (note or "").strip()[:200]
        replacement.pop("cost", None)
        replacement.pop("cost_per_gram", None)
        replacement.pop("cost_source", None)
        usage.append(replacement)

        conn.execute(
            "UPDATE prints SET spool_usage = ? WHERE id = ?",
            (json.dumps(usage), print_id),
        )

    old_label = old_spool["display_id"] or from_spool_id
    new_label = new_spool["display_id"] or to_spool_id
    detail = f"Spool usage corrected from #{old_label} to #{new_label}: {move_grams:.1f}g"
    if note:
        detail += f" - {note.strip()[:120]}"
    log_decision(prow["printer_id"], "spool_usage_corrected", detail, print_id=print_id)
    if archived_empty:
        log_decision(prow["printer_id"], "spool_auto_archived_empty", f"Spool #{new_label} archived after corrected deduction reached 0g", print_id=print_id)
    return {
        "from_spool_id": int(from_spool_id),
        "to_spool_id": int(to_spool_id),
        "grams": move_grams,
        "to_remaining_g": round(new_remaining, 1),
    }


def assign_print_spool_usage(
    print_id: int,
    spool_id: int,
    *,
    grams: Optional[float] = None,
    note: Optional[str] = None,
) -> Optional[dict]:
    """Assign a previously unattributed print to a spool and deduct once.

    History repair can legitimately target an archived spool when a printer
    finished a job but reported it as cancelled after the roll was emptied.
    In that case keep the spool archived, but still attach the usage so the
    print history and consumed totals are truthful.
    """
    import json
    with _conn() as conn:
        prow = conn.execute(
            """SELECT id, printer_id, filename, subtask_name, filament_grams,
                      material, spool_usage
               FROM prints
               WHERE id = ?""",
            (print_id,),
        ).fetchone()
        if not prow:
            return None
        try:
            existing_usage = json.loads(prow["spool_usage"] or "[]")
        except Exception:
            existing_usage = []
        if isinstance(existing_usage, list) and any(isinstance(e, dict) and int(e.get("spool_id") or 0) for e in existing_usage):
            return {"error": "already_assigned"}

        spool = conn.execute(
            """SELECT id, display_id, remaining_g, location_slot, material, brand, archived_at
               FROM spools
               WHERE id = ?""",
            (spool_id,),
        ).fetchone()
        if not spool:
            return None

        try:
            deduct_g = float(grams) if grams is not None else float(prow["filament_grams"] or 0)
        except (TypeError, ValueError):
            deduct_g = 0.0
        deduct_g = round(max(0.0, deduct_g), 2)
        if deduct_g <= 0:
            return {"error": "no_grams"}

        old_r = float(spool["remaining_g"] or 0)
        new_r = max(0.0, old_r - deduct_g)
        was_archived = spool["archived_at"] is not None
        archived_empty = False
        usage = {
            "spool_id": int(spool_id),
            "display_id": int(spool["display_id"] or spool_id),
            "grams": deduct_g,
            "actual_grams": deduct_g,
            "slot": spool["location_slot"],
            "remaining_before_g": round(old_r, 2),
            "remaining_after_g": round(new_r, 2),
            "material": spool["material"] or prow["material"],
            "brand": spool["brand"],
            "assigned_after_print": True,
            "assigned_to_archived_spool": was_archived,
            "assigned_at": datetime.utcnow().isoformat(),
            "assignment_note": (note or "").strip()[:200],
        }
        conn.execute("UPDATE spools SET remaining_g = ? WHERE id = ?", (new_r, spool_id))
        if not was_archived:
            archived_empty = _auto_archive_empty_spool(conn, spool_id)
        conn.execute(
            "UPDATE prints SET spool_usage = ? WHERE id = ?",
            (json.dumps([usage]), print_id),
        )

    spool_label = spool["display_id"] or spool_id
    detail = (
        f"Spool #{spool_label} assigned after print: {deduct_g:.1f}g deducted "
        f"({old_r:.1f}g -> {new_r:.1f}g)"
    )
    if was_archived:
        detail += " on archived spool"
    if note:
        detail += f" - {note.strip()[:120]}"
    log_decision(prow["printer_id"], "spool_usage_assigned_after_print", detail, print_id=print_id)
    if archived_empty:
        log_decision(prow["printer_id"], "spool_auto_archived_empty", f"Spool #{spool_label} archived after assigned print reached 0g", print_id=print_id)
    if old_r - deduct_g < 0:
        log_decision(
            prow["printer_id"],
            "spool_overdrawn",
            f"Spool #{spool_label}: assigned-after-print deduction wanted {deduct_g:.1f}g but only {old_r:.1f}g remained; clamped to 0",
            print_id=print_id,
        )
    return {
        "spool_id": int(spool_id),
        "grams": deduct_g,
        "remaining_g": round(new_r, 1),
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
    calibrate_before_start: bool = False,
    plate_number: Optional[int] = None,
    plate_count: Optional[int] = None,
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
                preview_png, estimated_seconds, filament_weight_g, filament_type, filament_colors,
                calibrate_before_start, plate_number, plate_count)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (printer_id, position, filename, file_path, file_size,
             preview_png, estimated_seconds, filament_weight_g, filament_type, filament_colors,
             1 if calibrate_before_start else 0, plate_number, plate_count),
        )
        return cursor.lastrowid


def queue_list(printer_id: Optional[str] = None) -> list[dict]:
    _STATUS_ORDER = "CASE status WHEN 'printing' THEN 0 WHEN 'uploading' THEN 1 WHEN 'held' THEN 2 WHEN 'pending' THEN 2 ELSE 3 END"
    with _conn() as conn:
        if printer_id:
            rows = conn.execute(
                f"""SELECT id, printer_id, position, filename, file_path, file_size, status,
                           estimated_seconds, filament_weight_g, filament_type, filament_colors,
                           calibrate_before_start, allow_short_filament,
                           plate_number, plate_count,
                           created_at, started_at, finished_at, error_msg,
                           (preview_png IS NOT NULL) AS has_preview
                    FROM print_queue WHERE printer_id = ?
                    ORDER BY {_STATUS_ORDER}, position, id""",
                (printer_id,),
            ).fetchall()
        else:
            rows = conn.execute(
                f"""SELECT id, printer_id, position, filename, file_path, file_size, status,
                           estimated_seconds, filament_weight_g, filament_type, filament_colors,
                           calibrate_before_start, allow_short_filament,
                           plate_number, plate_count,
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
                      calibrate_before_start, allow_short_filament,
                      plate_number, plate_count,
                      created_at, started_at, finished_at, error_msg
               FROM print_queue WHERE id = ?""",
            (job_id,),
        ).fetchone()
    return dict(row) if row else None


def queue_latest_reprintable(printer_id: str) -> Optional[dict]:
    with _conn() as conn:
        row = conn.execute(
            """SELECT id, printer_id, position, filename, file_path, file_size,
                      status, estimated_seconds, filament_weight_g, filament_type, filament_colors,
                      plate_number, plate_count,
                      created_at, started_at, finished_at, error_msg
               FROM print_queue
               WHERE printer_id = ? AND status = 'done'
               ORDER BY datetime(COALESCE(finished_at, started_at, created_at)) DESC, id DESC
               LIMIT 1""",
            (printer_id,),
        ).fetchone()
    return dict(row) if row else None


def queue_active_job(printer_id: str) -> Optional[dict]:
    with _conn() as conn:
        row = conn.execute(
            """SELECT id, printer_id, filename, file_path, status,
                      estimated_seconds, filament_weight_g, filament_type, filament_colors,
                      plate_number, plate_count,
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


def queue_set_calibrate_before(job_id: int, enabled: bool) -> bool:
    with _conn() as conn:
        n = conn.execute(
            """UPDATE print_queue
               SET calibrate_before_start = ?
               WHERE id = ? AND status IN ('pending', 'held')""",
            (1 if enabled else 0, job_id),
        ).rowcount
    return n > 0


def queue_set_allow_short_filament(job_id: int, enabled: bool) -> bool:
    with _conn() as conn:
        n = conn.execute(
            """UPDATE print_queue
               SET allow_short_filament = ?
               WHERE id = ? AND status IN ('pending', 'held')""",
            (1 if enabled else 0, job_id),
        ).rowcount
    return n > 0


def queue_update_status(job_id: int, status: str, error_msg: Optional[str] = None) -> bool:
    terminal = status in {"done", "failed", "cancelled"}
    with _conn() as conn:
        sets = ["status = ?"]
        params: list = [status]
        if error_msg is not None:
            sets.append("error_msg = ?")
            params.append(error_msg)
        if terminal:
            sets.append("finished_at = COALESCE(finished_at, datetime('now'))")
        elif status == "uploading":
            sets.append("started_at = COALESCE(started_at, datetime('now'))")
        params.append(job_id)
        c = conn.execute(
            f"UPDATE print_queue SET {', '.join(sets)} WHERE id = ?",
            params,
        )
    return c.rowcount > 0


def queue_set_started(job_id: int) -> bool:
    with _conn() as conn:
        row = conn.execute(
            "SELECT printer_id FROM print_queue WHERE id = ?",
            (job_id,),
        ).fetchone()
        if row:
            conn.execute(
                """UPDATE print_queue
                   SET status = 'failed',
                       finished_at = datetime('now'),
                       error_msg = 'Superseded by another queue start'
                   WHERE printer_id = ?
                     AND id != ?
                     AND status IN ('printing', 'uploading')""",
                (row["printer_id"], job_id),
            )
        c = conn.execute(
            "UPDATE print_queue SET status = 'printing', started_at = datetime('now'), error_msg = NULL WHERE id = ?",
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


def queue_cancel_active(printer_id: str, status: str = "cancelled", error_msg: Optional[str] = None) -> int:
    with _conn() as conn:
        if error_msg is None:
            c = conn.execute(
                """UPDATE print_queue
                   SET status = ?,
                       finished_at = COALESCE(finished_at, datetime('now'))
                   WHERE printer_id = ? AND status IN ('printing', 'uploading')""",
                (status, printer_id),
            )
        else:
            c = conn.execute(
                """UPDATE print_queue
                   SET status = ?,
                       finished_at = COALESCE(finished_at, datetime('now')),
                       error_msg = ?
                   WHERE printer_id = ? AND status IN ('printing', 'uploading')""",
                (status, error_msg, printer_id),
            )
    return c.rowcount


def queue_reopen_stale_cleared_active(printer_id: str) -> Optional[dict]:
    """Restore the latest queue row only if Flightdeck cleared it as stale."""
    with _conn() as conn:
        row = conn.execute(
            """SELECT id, filename, status, error_msg
               FROM print_queue
               WHERE printer_id = ?
                 AND (
                       (status IN ('cancelled', 'failed')
                        AND error_msg = 'Cleared stale queue state after printer returned to idle')
                    OR (status = 'failed'
                        AND error_msg LIKE 'Printer accepted the start command but did not begin heating or progressing%'
                        AND datetime(COALESCE(finished_at, started_at, created_at)) >= datetime('now', '-30 minutes'))
                    OR (status = 'cancelled'
                        AND datetime(COALESCE(finished_at, started_at, created_at)) >= datetime('now', '-30 minutes'))
                 )
               ORDER BY datetime(COALESCE(finished_at, started_at, created_at)) DESC, id DESC
               LIMIT 1""",
            (printer_id,),
        ).fetchone()
        if not row:
            return None
        conn.execute(
            """UPDATE print_queue
               SET status = 'printing',
                   started_at = COALESCE(started_at, datetime('now')),
                   finished_at = NULL,
                   error_msg = NULL
               WHERE id = ?""",
            (row["id"],),
        )
    return dict(row)


def queue_fail_active(printer_id: str, error_msg: str) -> int:
    with _conn() as conn:
        c = conn.execute(
            """UPDATE print_queue
               SET status = 'failed',
                   finished_at = COALESCE(finished_at, datetime('now')),
                   error_msg = ?
               WHERE printer_id = ? AND status IN ('printing', 'uploading')""",
            (error_msg, printer_id),
        )
    return c.rowcount


def queue_fail_active_except(printer_id: str, keep_job_id: int, error_msg: str) -> int:
    with _conn() as conn:
        c = conn.execute(
            """UPDATE print_queue
               SET status = 'failed',
                   finished_at = COALESCE(finished_at, datetime('now')),
                   error_msg = ?
               WHERE printer_id = ?
                 AND id != ?
                 AND status IN ('printing', 'uploading')""",
            (error_msg, printer_id, keep_job_id),
        )
    return c.rowcount


def queue_delete(job_id: int) -> tuple[bool, Optional[str]]:
    """Delete a pending/failed/cancelled job. Returns (deleted, file_path).

    file_path is only returned when no other queue row still uses that file
    (multi-plate jobs share one .gcode.3mf).
    """
    with _conn() as conn:
        row = conn.execute(
            "SELECT file_path FROM print_queue WHERE id = ? AND status IN ('pending', 'held', 'failed', 'cancelled')",
            (job_id,),
        ).fetchone()
        if not row:
            return False, None
        conn.execute("DELETE FROM print_queue WHERE id = ?", (job_id,))
        still = conn.execute(
            "SELECT 1 FROM print_queue WHERE file_path = ? LIMIT 1",
            (row["file_path"],),
        ).fetchone()
    return True, None if still else row["file_path"]


def queue_release(job_id: int) -> tuple[bool, Optional[str]]:
    """Force-remove a queue row from Flightdeck. Never talks to a printer.

    Use this for stuck printing/uploading jobs that are not actually on the
    machine. file_path is only returned when no other queue row still uses it.
    """
    with _conn() as conn:
        row = conn.execute(
            "SELECT file_path FROM print_queue WHERE id = ?",
            (job_id,),
        ).fetchone()
        if not row:
            return False, None
        conn.execute("DELETE FROM print_queue WHERE id = ?", (job_id,))
        still = conn.execute(
            "SELECT 1 FROM print_queue WHERE file_path = ? LIMIT 1",
            (row["file_path"],),
        ).fetchone()
    return True, None if still else row["file_path"]


def queue_next_pending(printer_id: str) -> Optional[dict]:
    with _conn() as conn:
        row = conn.execute(
            """SELECT id, printer_id, filename, file_path,
                      estimated_seconds, filament_weight_g, filament_type, filament_colors,
                      plate_number, plate_count
               FROM print_queue
               WHERE printer_id = ? AND status = 'pending'
               ORDER BY position ASC, id ASC LIMIT 1""",
            (printer_id,),
        ).fetchone()
    return dict(row) if row else None


def queue_has_active(printer_id: str) -> bool:
    with _conn() as conn:
        row = conn.execute(
            """SELECT 1 FROM print_queue
               WHERE printer_id = ? AND status IN ('printing', 'uploading')
               LIMIT 1""",
            (printer_id,),
        ).fetchone()
    return row is not None


def queue_retry(job_id: int) -> bool:
    """Reset a failed/cancelled/done job to pending at the end of its printer queue."""
    with _conn() as conn:
        row = conn.execute(
            "SELECT printer_id FROM print_queue WHERE id = ? AND status IN ('failed', 'cancelled', 'done')",
            (job_id,),
        ).fetchone()
        if not row:
            return False
        pos = conn.execute(
            "SELECT COALESCE(MAX(position), 0) + 1 AS next FROM print_queue WHERE printer_id = ?",
            (row["printer_id"],),
        ).fetchone()["next"]
        c = conn.execute(
            """UPDATE print_queue
               SET status = 'pending',
                   position = ?,
                   error_msg = NULL,
                   started_at = NULL,
                   finished_at = NULL
               WHERE id = ?""",
            (pos, job_id),
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
        remaining = {
            r["file_path"]
            for r in conn.execute("SELECT DISTINCT file_path FROM print_queue").fetchall()
            if r["file_path"]
        }
    seen: set[str] = set()
    out: list[str] = []
    for r in rows:
        fp = r["file_path"]
        if not fp or fp in remaining or fp in seen:
            continue
        seen.add(fp)
        out.append(fp)
    return out


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
