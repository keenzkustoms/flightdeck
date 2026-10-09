from __future__ import annotations
import asyncio
import csv
import gzip
import ipaddress
import io
import json
import logging
import math
import os
import re
import shutil
import socket
import sqlite3
import struct
import subprocess
import tempfile
import time
import urllib.parse
import urllib.request
import uuid
import zipfile
from html import escape as html_escape
from contextlib import asynccontextmanager
from dataclasses import asdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

_app_log = logging.getLogger("app")
_app_log.setLevel(logging.INFO)
if not _app_log.handlers:
    _h = logging.StreamHandler()
    _h.setFormatter(logging.Formatter("%(levelname)s:%(name)s: %(message)s"))
    _app_log.addHandler(_h)
    _app_log.propagate = False
log = logging.getLogger(__name__)

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile, WebSocket
from fastapi.responses import FileResponse, RedirectResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

import httpx

from . import db, makerdeck_library, makerworld, relay, slice_meta
from .camera import BambuCameraProxy
from .native_recorder import PrintNativeRecorder, finalize_capture_dir
from .label_printer import LabelPrinter
from .models import PrintPreview, PrinterStatus
from .paths import APP_DIR, DATA_DIR, DB_PATH, FLIGHT_RECORDER_DIR, PRINTERS_CONFIG_PATH, PRINT_LIBRARY_DIR, UPLOADS_DIR
from .printer_config import AdaptiveCamera, BambuConnection, BambuRtspCamera, MjpegDirectCamera, MoonrakerConnection, NtfyConfig, PrinterEntry, SimulatedConnection, SnapmakerU1Connection, WebrtcCamera, load, save
from .printers import moonraker, simulated
from .printers.bambu import BambuPrinter
from .scale import Scale
from .version import APP_RELEASE_NOTES, APP_VERSION, APP_VERSION_NAME

_bambu: list[BambuPrinter] = []
_moonraker: list[tuple[str, str, str, str, str, str, int]] = []  # (id, model_name, custom_name, icon, url, kind, toolheads)
_simulated: list[tuple[str, str, str, str, str, str]] = []  # (id, model_name, custom_name, icon, profile, scenario)
_cameras: dict = {}          # printer_id → Camera config
_presets: dict[str, dict] = {}  # printer_id → temperature_presets dict
_cam_proxies: dict[str, BambuCameraProxy] = {}  # printer_id → live RTSP proxy
_native_recorders: dict[str, PrintNativeRecorder] = {}  # printer_id → active camera capture
_calibration_sessions: dict[str, dict] = {}  # printer_id → active calibration orchestration
_ws_clients: set[WebSocket] = set()
_project_slice_jobs: dict[str, dict] = {}  # vault-relative path → slice job status
_broadcast_task: asyncio.Task | None = None
_ntfy: NtfyConfig | None = None
_prev_states: dict[str, str] = {}  # printer_id → last known state
_last_seen_cache: dict[str, datetime] = {}  # printer_id → last successful contact
_latest_printers: dict[str, dict] = {}  # printer_id → most recent gathered status
_latest_printers_at: datetime | None = None
_gather_lock: asyncio.Lock | None = None
_scale_keep_awake_task: asyncio.Task | None = None
_EMPTY_SLOT_AUTO_RETURN_GRACE_SECONDS = 600
_AMS_SLOT_FINGERPRINTS: dict[str, dict] = {}
_scale = Scale()
_label_printer = LabelPrinter()
_MAX_PRINT_FILE_BYTES = int(os.getenv("FLIGHTDECK_MAX_PRINT_FILE_MB", "2048")) * 1024 * 1024
_MAX_PROFILE_UPLOAD_BYTES = int(os.getenv("FLIGHTDECK_MAX_PROFILE_UPLOAD_MB", "64")) * 1024 * 1024
_MAX_MAKERDECK_DESIGN_PART_BYTES = int(os.getenv("FLIGHTDECK_MAKERDECK_DESIGN_PART_MB", "8")) * 1024 * 1024
_MAX_FLIGHT_RECORDER_BYTES = int(os.getenv("FLIGHTDECK_MAX_FLIGHT_RECORDER_MB", "2048")) * 1024 * 1024
_QUEUE_ACTIVE_STALE_GRACE_SECONDS = int(os.getenv("FLIGHTDECK_QUEUE_ACTIVE_STALE_GRACE_SECONDS", "480"))
_UPLOAD_READ_CHUNK_BYTES = 1024 * 1024
_BAMBU_FILE_LIST_TIMEOUT_SECONDS = float(os.getenv("FLIGHTDECK_BAMBU_FILE_LIST_TIMEOUT", "2.5"))
_FILE_DESK_TARGET_CACHE_SECONDS = float(os.getenv("FLIGHTDECK_FILE_DESK_TARGET_CACHE_SECONDS", "20"))
_file_desk_target_cache: dict[str, dict] = {}
_FLIGHT_RECORDER_EXTS = {".mp4", ".webm", ".mov", ".avi"}
_BAMBU_RECORDER_ROOTS = ("timelapse", "video", "movie", "ipcam", "record", "records")
_MOONRAKER_RECORDER_ROOTS = ("timelapse", "gcodes")
_LOCAL_RECORDER_SEARCH_NAMES = ("flight_recorder", "timelapse", "timelapses", "recordings", "records", "videos", "camera")
_FLIGHT_RECORDER_AUTO_RETRY_DELAYS = tuple(
    int(part.strip())
    for part in os.getenv("FLIGHTDECK_RECORDER_AUTO_RETRY_SECONDS", "30,90,180").split(",")
    if part.strip().isdigit()
) or (30, 90, 180)
_NATIVE_RECORDER_ENABLED = os.getenv("FLIGHTDECK_NATIVE_RECORDER", "1").strip().lower() not in {
    "0", "false", "no", "off",
}
_flight_recorder_harvest_pending: set[tuple[str, int]] = set()
_ATTACHED_TIMELAPSE_NAME_RE = re.compile(r"^(\d+)-")


def _dt_default(obj):
    if isinstance(obj, datetime):
        return obj.isoformat()
    raise TypeError(f"{type(obj)} not serializable")


def _simulated_entry(printer_id: str) -> Optional[tuple[str, str, str, str, str, str]]:
    for item in _simulated:
        if item[0] == printer_id:
            return item
    return None


def _moonraker_runtime_entry(entry: PrinterEntry, conn: MoonrakerConnection | SnapmakerU1Connection) -> tuple[str, str, str, str, str, str, int]:
    if isinstance(conn, SnapmakerU1Connection):
        return (entry.id, entry.model_name, entry.custom_name, entry.icon_key(), conn.url, "snapmaker_u1", 4)
    return (entry.id, entry.model_name, entry.custom_name, entry.icon_key(), conn.url, "moonraker", 1)


def _is_moonraker_family(kind: Optional[str]) -> bool:
    return kind in {"moonraker", "snapmaker_u1"}


def _active_printer_ids() -> set[str]:
    return {pid for (pid, *_rest) in _moonraker} | {p.id for p in _bambu} | {pid for (pid, *_rest) in _simulated}


def _offline_printer_entry(
    printer_id: str,
    model_name: str,
    custom_name: str,
    icon: str,
    kind: str,
    error: str = "waiting for telemetry",
    extra: Optional[dict] = None,
) -> dict:
    entry = {
        "id": printer_id,
        "model_name": model_name,
        "custom_name": custom_name,
        "icon": icon,
        "kind": kind,
        "state": "offline",
        "error": error,
        "temps": {},
        "job": None,
        "ams": [],
        "toolheads": [],
        "last_seen": _last_seen_cache.get(printer_id),
        "updated_at": datetime.utcnow(),
        "temperature_presets": _presets.get(printer_id, {}),
        "health": db.get_printer_health(printer_id),
        "print_enabled": db.is_printer_printing_enabled(printer_id),
        "print_enabled_note": db.get_printer_printing_note(printer_id),
    }
    if extra:
        entry.update(extra)
    return entry


def _stale_or_offline_printer_entry(
    printer_id: str,
    model_name: str,
    custom_name: str,
    icon: str,
    kind: str,
    error: str = "telemetry timeout",
    extra: Optional[dict] = None,
) -> dict:
    """Keep the last good status (flagged stale) rather than flipping a slow printer to offline."""
    previous = _latest_printers.get(printer_id)
    if previous and previous.get("state") != "offline":
        stale = dict(previous)
        stale["stale"] = True
        stale["telemetry_error"] = error
        return stale
    return _offline_printer_entry(printer_id, model_name, custom_name, icon, kind, error=error, extra=extra)


def _prime_printer_cache() -> None:
    """Fill the printer cache with placeholder entries so the UI renders before the first poll finishes."""
    global _latest_printers_at
    out: list[dict] = []
    for pid, model_name, custom_name, icon, url, kind, toolhead_count in _moonraker:
        extra = {
            "klipper_ui_url": url,
            "toolheads": [
                {
                    "idx": idx,
                    "label": f"T{idx}",
                    "object": "extruder" if idx == 0 else f"extruder{idx}",
                    "actual": None,
                    "target": None,
                    "power": None,
                    "active": idx == 0,
                }
                for idx in range(toolhead_count)
            ] if kind == "snapmaker_u1" else [],
        }
        out.append(_offline_printer_entry(pid, model_name, custom_name, icon, kind, extra=extra))
    for p in _bambu:
        out.append(_offline_printer_entry(p.id, p.model_name, p.custom_name, p.icon, "bambu", extra={"_error_print_id": p._error_print_id}))
    for pid, model_name, custom_name, icon, _profile, _scenario in _simulated:
        out.append(_offline_printer_entry(pid, model_name, custom_name, icon, "simulated"))
    _latest_printers.clear()
    _latest_printers.update({p["id"]: p for p in out})
    _latest_printers_at = datetime.utcnow()


async def _gather_all() -> list[dict]:
    global _latest_printers_at, _gather_lock
    if _gather_lock is None:
        _gather_lock = asyncio.Lock()
    async with _gather_lock:
        return await _gather_all_locked()


async def _gather_all_locked() -> list[dict]:
    global _latest_printers_at

    async def _fetch_moonraker(id, model_name, custom_name, icon, url, kind, toolhead_count):
        try:
            status = await asyncio.wait_for(
                moonraker.fetch(id, model_name, custom_name, icon, url, kind=kind, toolhead_count=toolhead_count),
                timeout=8.0,
            )
        except Exception as exc:
            log.warning("moonraker fetch timed out/failed for %s: %s", id, exc)
            return _stale_or_offline_printer_entry(
                id,
                model_name,
                custom_name,
                icon,
                kind,
                error=str(exc) or "telemetry timeout",
                extra={
                    "_error_print_id": moonraker._error_print_id.get(id),
                    "klipper_ui_url": url,
                },
            )
        status.temperature_presets = _presets.get(id, {})
        _update_last_seen(status)
        d = asdict(status)
        cal = db.get_calibration(id)
        if cal:
            d["eta_calibration"] = cal
        d["health"] = db.get_printer_health(id)
        d["_error_print_id"] = moonraker._error_print_id.get(id)
        d["_last_finished_print_id"] = moonraker._last_finished_print_id.get(id)
        d["_last_timelapse_path"] = None
        parsed = urllib.parse.urlparse(url)
        d["klipper_ui_url"] = f"{parsed.scheme or 'http'}://{parsed.hostname}" if parsed.hostname else url
        return d

    async def _fetch_bambu(p):
        try:
            status = await asyncio.wait_for(asyncio.to_thread(p.status), timeout=4.0)
        except asyncio.TimeoutError:
            log.warning("bambu status timed out for %s", p.id)
            previous = _latest_printers.get(p.id)
            if previous and previous.get("state") != "offline":
                stale = dict(previous)
                stale["stale"] = True
                stale["telemetry_error"] = "Status timed out"
                return stale
            d = {
                "id": p.id,
                "model_name": p.model_name,
                "custom_name": p.custom_name,
                "icon": p.icon,
                "kind": "bambu",
                "state": "offline",
                "error": "Status timed out",
                "temps": {},
                "job": None,
                "ams": [],
                "toolheads": [],
                "last_seen": getattr(p, "_last_seen", None),
                "updated_at": datetime.utcnow(),
            }
            d["temperature_presets"] = _presets.get(p.id, {})
            d["health"] = db.get_printer_health(p.id)
            d["_error_print_id"] = p._error_print_id
            d["_current_print_id"] = p._current_print_id
            d["_last_finished_print_id"] = p._last_finished_print_id
            d["_last_timelapse_path"] = p._last_timelapse_path
            return d
        status.temperature_presets = _presets.get(p.id, {})
        _update_last_seen(status)
        d = asdict(status)
        _reconcile_empty_reported_slots(d)
        _reconcile_reported_loaded_slots(d)
        _replay_assigned_bambu_profiles(d)
        cal = db.get_calibration(p.id)
        if cal:
            d["eta_calibration"] = cal
        d["health"] = db.get_printer_health(p.id)
        d["_error_print_id"] = p._error_print_id
        d["_current_print_id"] = p._current_print_id
        d["_last_finished_print_id"] = p._last_finished_print_id
        d["_last_timelapse_path"] = p._last_timelapse_path
        cal_session = _calibration_sessions.get(p.id)
        if cal_session:
            d["calibration"] = {
                "active": bool(cal_session.get("active")),
                "pending_job_id": cal_session.get("pending_job_id"),
            }
        return d

    async def _fetch_simulated(id, model_name, custom_name, icon, profile, scenario):
        status = simulated.status(id, model_name, custom_name, icon, profile, scenario)
        status.temperature_presets = _presets.get(id, {})
        _update_last_seen(status)
        d = asdict(status)
        cal = db.get_calibration(id)
        if cal:
            d["eta_calibration"] = cal
        d["health"] = db.get_printer_health(id)
        d["_simulated"] = True
        return d

    tasks = (
        [_fetch_moonraker(id, model_name, custom_name, icon, url, kind, toolhead_count)
         for (id, model_name, custom_name, icon, url, kind, toolhead_count) in _moonraker] +
        [_fetch_bambu(p) for p in _bambu]
        + [_fetch_simulated(id, model_name, custom_name, icon, profile, scenario)
           for (id, model_name, custom_name, icon, profile, scenario) in _simulated]
    )
    results = await asyncio.gather(*tasks, return_exceptions=True)
    out = []
    for r in results:
        if isinstance(r, Exception):
            log.warning("printer fetch failed: %s", r)
        else:
            out.append(r)
    for entry in out:
        entry["print_enabled"] = db.is_printer_printing_enabled(entry["id"])
        entry["print_enabled_note"] = db.get_printer_printing_note(entry["id"])
    _latest_printers.clear()
    _latest_printers.update({p["id"]: p for p in out})
    _latest_printers_at = datetime.utcnow()
    return out


def _cached_printers(max_age_seconds: float = 8.0) -> Optional[list[dict]]:
    if not _latest_printers or _latest_printers_at is None:
        return None
    age = (datetime.utcnow() - _latest_printers_at).total_seconds()
    if age > max_age_seconds:
        return None
    return list(_latest_printers.values())


def _stale_printers() -> Optional[list[dict]]:
    """Any in-memory snapshot, even if older than the fresh-cache window."""
    if not _latest_printers:
        return None
    return list(_latest_printers.values())


def _gather_in_progress() -> bool:
    return _gather_lock is not None and _gather_lock.locked()


async def _gather_all_with_cache(timeout: float = 5.0) -> list[dict]:
    """Serve fresh cache, else the stale snapshot, else a bounded live gather."""
    cached = _cached_printers()
    if cached is not None:
        return cached
    stale = _stale_printers()
    if stale is not None:
        if not _gather_in_progress():
            asyncio.create_task(_gather_all())
        return stale
    try:
        return await asyncio.wait_for(_gather_all(), timeout=timeout)
    except Exception as exc:
        log.warning("printer gather timed out/failed: %s", exc)
        return _stale_printers() or []


async def _seed_prev_states() -> None:
    try:
        for p in await _gather_all_with_cache(timeout=6.0):
            _prev_states[p["id"]] = p["state"]
    except Exception:
        pass


async def _delayed_seed_prev_states() -> None:
    await asyncio.sleep(3)
    await _seed_prev_states()


def _printer_meta(printer_id: str) -> Optional[dict]:
    for pid, model_name, custom_name, _icon, _url, kind, _toolhead_count in _moonraker:
        if pid == printer_id:
            return {"id": pid, "model_name": model_name, "custom_name": custom_name, "kind": kind}
    for p in _bambu:
        if p.id == printer_id:
            return {"id": p.id, "model_name": p.model_name, "custom_name": p.custom_name, "kind": "bambu"}
    for pid, model_name, custom_name, _icon, profile, _scenario in _simulated:
        if pid == printer_id:
            return {"id": pid, "model_name": model_name, "custom_name": custom_name, "kind": profile}
    return None


def _update_last_seen(status) -> None:
    if status.last_seen is not None:
        _last_seen_cache[status.id] = status.last_seen
        db.set_last_seen(status.id, status.last_seen)
    elif status.state == "offline" and status.id in _last_seen_cache:
        status.last_seen = _last_seen_cache[status.id]


def _default_spool_location_id() -> Optional[int]:
    for loc in db.get_spool_locations():
        if not loc.get("archived_at"):
            return int(loc["id"])
    return None


def _spool_location_label(location_id: Optional[int]) -> str:
    if location_id is None:
        return "storage"
    for loc in db.get_spool_locations():
        if str(loc.get("id")) == str(location_id):
            return str(loc.get("name") or f"Shelf #{location_id}")
    return f"Shelf #{location_id}"


def _recent_spool_move_to_slot(printer_id: str, flat_slot: int, spool_id: int) -> bool:
    """Avoid auto-returning a slot while Bambu is still catching up to a fresh assignment."""
    try:
        with sqlite3.connect(DB_PATH) as conn:
            row = conn.execute(
                """
                SELECT 1
                FROM decisions
                WHERE event = 'spool_moved'
                  AND detail LIKE ?
                  AND logged_at >= datetime('now', ?)
                LIMIT 1
                """,
                (
                    f"Spool #{spool_id} %{printer_id}:{flat_slot}",
                    f"-{_EMPTY_SLOT_AUTO_RETURN_GRACE_SECONDS} seconds",
                ),
            ).fetchone()
        return row is not None
    except Exception as exc:
        log.debug("fresh spool move check failed: %s", exc)
        return False


def _recent_profile_replay(printer_id: str, flat_slot: int, spool_id: int, seconds: int = 60) -> bool:
    try:
        with sqlite3.connect(DB_PATH) as conn:
            row = conn.execute(
                """
                SELECT 1
                FROM decisions
                WHERE event = 'ams_slot_profile_replayed'
                  AND detail LIKE ?
                  AND logged_at >= datetime('now', ?)
                LIMIT 1
                """,
                (f"{printer_id}:{flat_slot} spool #{spool_id}%", f"-{seconds} seconds"),
            ).fetchone()
        return row is not None
    except Exception as exc:
        log.debug("recent AMS profile replay check failed: %s", exc)
        return False


def _reconcile_empty_reported_slots(printer_status: dict) -> None:
    """Return stale Flightdeck assignments when Bambu reports the slot empty."""
    printer_id = printer_status.get("id")
    if not printer_id:
        return
    loaded_by_slot = db.get_spools_by_printer(str(printer_id))
    if not loaded_by_slot:
        return

    for slot in _flatten_reported_ams_slots(printer_status, include_empty=True):
        if not slot.get("empty"):
            continue
        flat_slot = slot.get("flat_slot")
        if flat_slot is None:
            continue
        spool = loaded_by_slot.get(int(flat_slot))
        if not spool:
            continue
        if _recent_spool_move_to_slot(str(printer_id), int(flat_slot), int(spool["id"])):
            continue

        full_spool = db.get_spool(int(spool["id"])) or spool
        home_id = full_spool.get("home_storage_location_id") or full_spool.get("storage_location_id")
        target_location_id = int(home_id) if home_id is not None else _default_spool_location_id()
        result = db.move_spool(int(spool["id"]), None, None, target_location_id)
        if result.get("ok"):
            returned_to = _spool_location_label(result.get("storage_location_id") or target_location_id)
            db.log_decision(
                str(printer_id),
                "spool_auto_returned",
                (
                    f"Spool #{spool['id']} auto-returned to {returned_to} "
                    f"from empty {slot.get('label') or flat_slot}; printer reported empty"
                ),
            )


def _reported_slot_is_stale_empty(slot: dict) -> bool:
    """Bambu can keep old tray profile fields after a physical unload."""
    state = slot.get("tray_state")
    try:
        state_int = int(state)
    except (TypeError, ValueError):
        state_int = None
    if state_int == 11:
        return False
    if state_int in (9, 10):
        return True
    return bool(slot.get("empty"))


def _reported_slot_is_generic(slot: dict) -> bool:
    text = " ".join(
        str(slot.get(key) or "")
        for key in ("brand", "profile_name", "profile_id")
    ).lower()
    return "generic" in text or str(slot.get("profile_id") or "").upper().endswith("99")


def _assigned_spool_matches_report(spool: dict, slot: dict) -> bool:
    if _reported_slot_is_stale_empty(slot):
        return False
    if not _spool_matches_material(spool, str(slot.get("type") or "")):
        return False
    return _hex_dist(spool.get("color_hex"), slot.get("color")) <= 35


def _replay_assigned_bambu_profiles(printer_status: dict) -> None:
    """Never background-write AMS profiles.

    The AMS Profile Doctor/Trust Flightdeck button is the operator-approved
    path for writing a Flightdeck spool profile back to Bambu. Auto-replaying
    here fought real spool swaps on AMS HT because a stale Flightdeck assignment
    could overwrite the printer every poll cycle.
    """
    return


def _remaining_g(spool: dict) -> float:
    try:
        return float(spool.get("remaining_g") or 0)
    except Exception:
        return 0.0


def _reported_slot_material_text(slot: dict) -> str:
    """Return the best material hint from a printer-reported AMS slot."""
    material = str(slot.get("type") or slot.get("material") or "").strip()
    if material:
        return material

    fallback = " ".join(
        str(slot.get(key) or "").strip()
        for key in ("profile_name", "brand")
        if str(slot.get(key) or "").strip()
    )
    if not fallback:
        return ""

    # Some firmware reports only a profile family, e.g. "Generic PLA".
    known_materials = (
        "PA-CF",
        "PLA+",
        "PETG",
        "PLA",
        "ABS",
        "ASA",
        "TPU",
        "PVA",
        "PC",
        "PA",
    )
    normalised = _norm_material(fallback)
    fallback_lower = fallback.lower()
    for candidate in known_materials:
        if "+" in candidate and "+" not in fallback and "plus" not in fallback_lower:
            continue
        if _norm_material(candidate) in normalised:
            return candidate
    return re.sub(r"\bgeneric\b", "", fallback, flags=re.IGNORECASE).strip() or fallback


def _spool_reported_profile_score(slot: dict, spool: dict) -> Optional[tuple[float, str]]:
    """Score a shelved spool against a non-empty printer-reported AMS slot."""
    if spool.get("location_printer_id") is not None or spool.get("archived_at"):
        return None

    reported_material = _reported_slot_material_text(slot)
    if not _spool_matches_material(spool, str(reported_material)):
        return None
    if _generic_profile_rejects_spool(slot, spool):
        return None

    color_dist = _hex_dist(slot.get("color"), spool.get("color_hex"))
    if color_dist > 125:
        return None

    score = 0.0
    reasons: list[str] = []
    reported_brand = str(slot.get("brand") or "")
    reported_profile = str(slot.get("profile_name") or "")
    reported_profile_id = str(slot.get("profile_id") or "")
    spool_brand = _norm_material(spool.get("brand") or "")
    spool_subtype = _norm_material(spool.get("subtype") or "")
    reported_brand_norm = _norm_material(reported_brand)
    reported_profile_norm = _norm_material(reported_profile)
    reported_is_generic = _is_generic_profile(reported_brand) or _is_generic_profile(reported_profile)

    if not reported_is_generic and _reported_brand_matches_spool(reported_brand, spool):
        score += 30
        reasons.append("profile")

    # Bambu RFID reports profile families such as "PLA Basic" with codes like
    # A00-P6/GFA00. Prefer the operator's Bambu Lab Basic spool over older
    # generic catalog entries that only happen to share a nearby colour.
    if spool_brand == "bambulab" and not reported_is_generic:
        score += 18
        reasons.append("bambu")
    if spool_subtype and spool_subtype in reported_brand_norm:
        score += 18
        reasons.append("subtype")
    if reported_brand_norm and reported_brand_norm in _norm_material(" ".join([
        str(spool.get("material") or ""),
        str(spool.get("subtype") or ""),
        str(spool.get("brand") or ""),
    ])):
        score += 12
    if _looks_like_bambu_profile_code(reported_profile) or _looks_like_bambu_profile_code(reported_profile_id):
        score += 8
    if reported_profile_norm and reported_profile_norm in _norm_material(spool.get("brand") or ""):
        score += 8

    score += max(0.0, 45.0 - (color_dist / 2.5))
    reasons.append(f"colour {color_dist:.0f}")

    remaining = _remaining_g(spool)
    if remaining >= 150:
        score += 20
        reasons.append("usable")
    elif remaining >= 75:
        score += 5
    else:
        score -= 40
        reasons.append("near-empty")

    confidence = spool.get("confidence_score")
    try:
        if confidence is not None:
            score += max(0.0, min(float(confidence), 100.0)) / 10.0
    except Exception:
        pass

    return score, ", ".join(reasons)


def _best_spool_for_reported_slot(slot: dict, candidates: list[dict], preferred_spool_id: Optional[int] = None) -> Optional[tuple[dict, float, str]]:
    scored: list[tuple[float, float, float, dict, str]] = []
    for spool in candidates:
        result = _spool_reported_profile_score(slot, spool)
        if result is None:
            continue
        score, reason = result
        if preferred_spool_id is not None and int(spool.get("id") or 0) == int(preferred_spool_id):
            score += 25
            reason = f"{reason}, recent slot memory"
        scored.append((score, -_hex_dist(slot.get("color"), spool.get("color_hex")), _remaining_g(spool), spool, reason))

    if not scored:
        return None
    scored.sort(key=lambda item: (item[0], item[1], item[2]), reverse=True)
    best = scored[0]
    runner_up = scored[1] if len(scored) > 1 else None
    if best[0] < 70:
        return None
    if runner_up and best[0] - runner_up[0] < 18:
        return None
    return best[3], best[0], best[4]


def _ams_auto_claim_enabled() -> bool:
    try:
        settings = db.get_all_settings()
    except Exception:
        settings = {}
    return str(settings.get("ams_auto_claim_enabled", "true")).strip().lower() in {"1", "true", "yes", "on"}


def _slot_fingerprint_key(printer_id: str, flat_slot: int) -> str:
    return f"{printer_id}:{flat_slot}"


def _tray_state_int(slot: dict) -> Optional[int]:
    try:
        return int(slot.get("tray_state"))
    except (TypeError, ValueError):
        return None


def _reported_slot_is_unknown_loaded(slot: dict) -> bool:
    if not slot or slot.get("empty"):
        return False
    material = str(_reported_slot_material_text(slot) or "").strip()
    color = str(slot.get("color") or "").strip()
    brandish = str(slot.get("brand") or slot.get("profile_name") or slot.get("profile_id") or "").strip()
    return not material and not color and not brandish


def _reported_slot_is_low_confidence(slot: dict) -> bool:
    return _reported_slot_is_generic(slot) or _reported_slot_is_unknown_loaded(slot)


def _slot_loaded_signature(slot: dict) -> str:
    parts = [
        str(slot.get("profile_id") or "").strip().upper(),
        str(slot.get("color") or "").strip().upper(),
        str(slot.get("type") or "").strip().upper(),
        _norm_material(str(slot.get("brand") or "")),
        _norm_material(str(slot.get("profile_name") or "")),
        str(_tray_state_int(slot) or ""),
    ]
    return "|".join(parts)


def _slot_fingerprint(slot: dict) -> dict:
    empty = bool(slot.get("empty")) or _reported_slot_is_stale_empty(slot)
    return {
        "empty": empty,
        "loaded_sig": "" if empty else _slot_loaded_signature(slot),
        "tray_state": _tray_state_int(slot),
    }


def _slot_report_transition(prev: Optional[dict], curr: dict) -> bool:
    """True when the MQTT report changed like a fresh spool insert."""
    if not prev:
        return False
    if prev.get("empty") and not curr.get("empty"):
        return True
    if prev.get("tray_state") != 11 and curr.get("tray_state") == 11 and not curr.get("empty"):
        return True
    if (
        not prev.get("empty")
        and not curr.get("empty")
        and prev.get("loaded_sig") != curr.get("loaded_sig")
    ):
        return True
    return False


def _generic_slot_spool_match(
    slot: dict,
    spool: dict,
    preferred_spool_id: Optional[int],
) -> Optional[tuple[float, str]]:
    """Match a shelved spool to a generic Bambu report using material + slot memory."""
    if spool.get("location_printer_id") is not None or spool.get("archived_at"):
        return None
    if preferred_spool_id is not None and int(spool.get("id") or 0) != int(preferred_spool_id):
        return None
    if preferred_spool_id is None:
        return None
    reported_material = _reported_slot_material_text(slot)
    if not _spool_matches_material(spool, str(reported_material)):
        return None
    if _generic_profile_rejects_spool(slot, spool):
        return None
    return 85.0, "slot memory, generic report"


def _best_spool_for_generic_reported_slot(
    slot: dict,
    candidates: list[dict],
    preferred_spool_id: Optional[int],
) -> Optional[tuple[dict, float, str]]:
    if preferred_spool_id is None:
        return None
    for spool in candidates:
        result = _generic_slot_spool_match(slot, spool, preferred_spool_id)
        if result:
            score, reason = result
            return spool, score, reason
    return None


def _slot_physically_present(slot: dict) -> bool:
    if slot.get("empty") or _reported_slot_is_stale_empty(slot):
        return False
    if _tray_state_int(slot) == 11:
        return True
    tray_type = str(slot.get("type") or "").strip()
    color = str(slot.get("color") or "").strip()
    return bool(tray_type and color)


def _recent_auto_return_from_slot(printer_id: str, flat_slot: int, spool_id: int) -> bool:
    try:
        with sqlite3.connect(DB_PATH) as conn:
            row = conn.execute(
                """
                SELECT 1
                FROM decisions
                WHERE event = 'spool_auto_returned'
                  AND detail LIKE ?
                  AND logged_at >= datetime('now', ?)
                LIMIT 1
                """,
                (
                    f"Spool #{spool_id} %from empty %{printer_id}:{flat_slot}%",
                    f"-{_EMPTY_SLOT_AUTO_RETURN_GRACE_SECONDS} seconds",
                ),
            ).fetchone()
        return row is not None
    except Exception as exc:
        log.debug("recent auto-return check failed: %s", exc)
        return False


def _reconcile_reported_loaded_slots(printer_status: dict) -> None:
    """Claim a shelved spool when Bambu reports a fresh AMS/MMU load.

    Only reacts to empty→loaded or profile/colour transitions between polls.
    Persistent stale tray data — common on AMS HT — is ignored until the report
    actually changes, which is what caused false auto-claims before.
    """
    printer_id = printer_status.get("id")
    if not printer_id:
        return

    loaded_by_slot = db.get_spools_by_printer(str(printer_id))
    auto_claim = _ams_auto_claim_enabled()
    available = [
        spool for spool in db.get_spools()
        if spool.get("location_printer_id") is None and not spool.get("archived_at")
    ]

    for slot in _flatten_reported_ams_slots(printer_status, include_empty=True):
        flat_slot = slot.get("flat_slot")
        if flat_slot is None:
            continue
        key = _slot_fingerprint_key(str(printer_id), int(flat_slot))
        curr_fp = _slot_fingerprint(slot)
        prev_fp = _AMS_SLOT_FINGERPRINTS.get(key)
        _AMS_SLOT_FINGERPRINTS[key] = curr_fp

        if not auto_claim or not available:
            continue
        if curr_fp.get("empty"):
            continue
        if loaded_by_slot.get(int(flat_slot)):
            continue
        if not _slot_report_transition(prev_fp, curr_fp):
            continue
        if not _slot_physically_present(slot):
            continue
        if _reported_slot_is_unknown_loaded(slot):
            continue

        preferred_spool_id = db.get_recent_spool_for_slot(str(printer_id), int(flat_slot))
        slot_available = available
        if _reported_slot_is_generic(slot):
            if preferred_spool_id is None:
                continue
            slot_available = [
                spool for spool in available
                if int(spool.get("id") or 0) == int(preferred_spool_id)
            ]
            if not slot_available:
                continue
            best = _best_spool_for_generic_reported_slot(slot, slot_available, preferred_spool_id)
        else:
            best = _best_spool_for_reported_slot(slot, slot_available, preferred_spool_id)
        if not best:
            continue

        spool, score, reason = best
        if _recent_auto_return_from_slot(str(printer_id), int(flat_slot), int(spool["id"])):
            continue

        result = db.move_spool(
            int(spool["id"]),
            str(printer_id),
            int(flat_slot),
            spool.get("storage_location_id") or spool.get("home_storage_location_id"),
        )
        if not result.get("ok"):
            continue

        source_location = _spool_location_label(
            spool.get("storage_location_id") or spool.get("home_storage_location_id")
        )
        reported = " ".join(
            str(slot.get(key) or "").strip()
            for key in ("brand", "type", "profile_name")
            if str(slot.get(key) or "").strip()
        ) or "filament"
        db.log_decision(
            str(printer_id),
            "spool_auto_claimed",
            (
                f"Spool #{spool['id']} auto-claimed from {source_location} "
                f"to {slot.get('label') or flat_slot}; fresh printer report "
                f"{reported} {slot.get('color') or ''} (score {score:.0f}: {reason})"
            ),
        )
        loaded_by_slot[int(flat_slot)] = spool
        available = [candidate for candidate in available if int(candidate["id"]) != int(spool["id"])]


async def _grab_snapshot(printer_id: str) -> Optional[bytes]:
    """Return a JPEG frame for the given printer, or None if unavailable."""
    # Bambu: pull latest frame from the RTSP proxy (already decoded JPEG)
    proxy = _cam_proxies.get(printer_id)
    if proxy is not None:
        try:
            return await proxy.snapshot(timeout=3.0)
        except Exception:
            pass
        return None

    # Moonraker: hit the crowsnest snapshot URL directly
    camera = _cameras.get(printer_id)
    if isinstance(camera, (AdaptiveCamera, MjpegDirectCamera)) and camera.snapshot_url:
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                r = await client.get(camera.snapshot_url)
                if r.status_code == 200:
                    return r.content
        except Exception as exc:
            log.warning("snapshot fetch failed for %s: %s", printer_id, exc)

    return None


def _fetch_http_image_sync(url: str, timeout: float = 5.0) -> tuple[bytes, str]:
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    request = urllib.request.Request(
        url,
        headers={
            "Cache-Control": "no-cache",
            "Pragma": "no-cache",
            "User-Agent": "Flightdeck camera snapshot",
        },
    )
    with opener.open(request, timeout=timeout) as response:
        content_type = (response.headers.get("content-type") or "image/jpeg").split(";", 1)[0] or "image/jpeg"
        return response.read(), content_type


def _fetch_mjpeg_frame_sync(url: str) -> tuple[bytes, str]:
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    request = urllib.request.Request(
        url,
        headers={
            "Cache-Control": "no-cache",
            "Pragma": "no-cache",
            "User-Agent": "Flightdeck fleet wall snapshot",
        },
    )
    buf = b""
    with opener.open(request, timeout=3) as response:
        content_type = (response.headers.get("content-type") or "image/jpeg").split(";", 1)[0] or "image/jpeg"
        deadline = time.monotonic() + 3
        while time.monotonic() < deadline:
            chunk = response.read(65536)
            if not chunk:
                break
            buf += chunk
            start = buf.find(b"\xff\xd8")
            if start >= 0:
                end = buf.find(b"\xff\xd9", start + 2)
                if end >= 0:
                    return buf[start:end + 2], "image/jpeg"
            if len(buf) > 2_000_000:
                buf = buf[-512_000:]
    if buf and content_type.startswith("image/") and "multipart" not in content_type:
        return buf, content_type
    raise RuntimeError("MJPEG frame unavailable")


def _camera_unavailable_response(printer_id: str, detail: str = "Camera frame unavailable") -> Response:
    name = html_escape(printer_id)
    note = html_escape(detail[:80])
    svg = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360">
  <rect width="640" height="360" fill="#050914"/>
  <rect x="24" y="24" width="592" height="312" rx="18" fill="#0b1120" stroke="#1f3657" stroke-width="2"/>
  <path d="M260 148 h120 l34 84 H226 z" fill="#1e293b" stroke="#475569" stroke-width="8" stroke-linejoin="round"/>
  <circle cx="320" cy="192" r="34" fill="#020617" stroke="#64748b" stroke-width="8"/>
  <path d="M242 250 L398 94" stroke="#ef4444" stroke-width="12" stroke-linecap="round"/>
  <text x="320" y="292" fill="#dbeafe" font-family="Segoe UI, Arial, sans-serif" font-size="28" font-weight="800" text-anchor="middle">{name}</text>
  <text x="320" y="320" fill="#93a4bd" font-family="Segoe UI, Arial, sans-serif" font-size="16" text-anchor="middle">{note}</text>
</svg>'''
    return Response(content=svg, media_type="image/svg+xml", headers={
        "Cache-Control": "no-cache, no-store, must-revalidate",
        "Pragma": "no-cache",
        "Expires": "0",
    })


async def _do_failure_snapshot(printer_id: str, print_id: Optional[int]) -> None:
    jpeg = await _grab_snapshot(printer_id)
    if not jpeg:
        log.debug("no camera frame available for failure snapshot: %s", printer_id)
        if print_id:
            db.log_decision(printer_id, "failure_snapshot_unavailable",
                           "No camera frame available", print_id=print_id)
        return
    if print_id is None:
        log.debug("no print row to attach snapshot to: %s", printer_id)
        db.log_decision(printer_id, "failure_snapshot_unavailable",
                       "No print_id available (snapshot discarded)", print_id=None)
        return
    db.save_print_snapshot(print_id, jpeg)
    log.info("failure snapshot saved: %s print_id=%d (%d bytes)", printer_id, print_id, len(jpeg))
    db.log_decision(printer_id, "failure_snapshot_saved",
                   f"{len(jpeg)} bytes", print_id=print_id)


async def _send_ntfy(title: str, message: str, tags: list[str], priority: int = 3) -> None:
    if not _ntfy:
        log.debug("ntfy not configured, skipping: %s", title)
        return
    log.info("ntfy sending: %s | %s", title, message)
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                f"{_ntfy.url}/{_ntfy.topic}",
                content=message.encode(),
                headers={
                    "Title": title,
                    "Tags": ",".join(tags),
                    "Priority": str(priority),
                },
                timeout=5,
            )
        log.info("ntfy sent OK (HTTP %d): %s", resp.status_code, title)
    except Exception as exc:
        log.warning("ntfy send failed: %s", exc)


def _notify(level: str, title: str, message: str = "", *, printer_id: Optional[str] = None, print_id: Optional[int] = None, link: Optional[str] = None) -> None:
    if printer_id and printer_id not in _active_printer_ids():
        log.info("dropping notification for removed printer %s: %s", printer_id, title)
        return
    try:
        db.add_notification(level, title, message, printer_id=printer_id, print_id=print_id, link=link)
    except Exception as exc:
        log.warning("notification insert failed: %s", exc)


def _recently_finished(printer_id: str, ttl: timedelta | None = None) -> bool:
    ttl = ttl or moonraker.FINISHED_TTL
    finished_at = db.get_finished_at(printer_id)
    if not finished_at:
        return False
    if finished_at.tzinfo is not None:
        finished_at = finished_at.astimezone(timezone.utc).replace(tzinfo=None)
    return (datetime.utcnow() - finished_at) <= ttl


def _native_recorder_enabled() -> bool:
    return _NATIVE_RECORDER_ENABLED


def _native_recorder_proxy(printer_id: str) -> Optional[BambuCameraProxy]:
    return _cam_proxies.get(printer_id)


def _resolve_native_print_id(printer_id: str, p: Optional[dict] = None) -> Optional[int]:
    if p:
        current = p.get("_current_print_id")
        if current:
            return int(current)
    open_id = db.get_open_print_id(printer_id)
    if open_id:
        return int(open_id)
    return None


def _native_recorder_first_layer_ready(p: dict) -> bool:
    """Wait for first-layer extrusion — skip AMS prep / bed heat / calibration."""
    if str(p.get("state") or "").lower() not in {"printing", "paused"}:
        return False
    job = p.get("job") or {}
    try:
        layer = job.get("layer_current")
        if layer is not None and int(layer) >= 1:
            return True
    except (TypeError, ValueError):
        pass
    progress = float(job.get("progress") or 0)
    return progress >= 0.015


def _native_capture_paths(printer_id: str, print_id: int, filename: str = "print") -> tuple[Path, Path]:
    safe_printer = re.sub(r"[^a-zA-Z0-9_.-]+", "-", printer_id).strip("-") or "printer"
    work_dir = FLIGHT_RECORDER_DIR / safe_printer / f".{print_id}-capture"
    output_path = _timelapse_safe_output_path(printer_id, print_id, filename or "print", ".mp4")
    return work_dir, output_path


def _attach_native_timelapse_path(printer_id: str, print_id: int, path: Path) -> bool:
    if path.stat().st_size > _MAX_FLIGHT_RECORDER_BYTES:
        log.warning(
            "native recorder clip too large for %s print_id=%s (%d bytes)",
            printer_id,
            print_id,
            path.stat().st_size,
        )
        try:
            path.unlink(missing_ok=True)
        except Exception:
            pass
        return False
    if db.attach_print_timelapse(print_id, path, source="flightdeck-native"):
        db.log_decision(
            printer_id,
            "flight_recorder_native",
            f"Attached native RTSP clip {path.name}",
            print_id=print_id,
        )
        log.info("native recorder attached: %s print_id=%s", printer_id, print_id)
        return True
    log.warning("native recorder attach failed: %s print_id=%s", printer_id, print_id)
    return False


async def _finalize_orphan_native_capture(printer_id: str, print_id: int) -> bool:
    """Concat leftover seg_*.mp4 for a finished print when no in-memory recorder is running."""
    item = db.get_print_by_id(print_id)
    if not item or item.get("printer_id") != printer_id:
        return False
    if item.get("has_timelapse"):
        return False
    work_dir, output_path = _native_capture_paths(printer_id, print_id, item.get("filename") or "print")
    if not work_dir.is_dir():
        return False
    if not any(work_dir.glob("seg_*.mp4")):
        shutil.rmtree(work_dir, ignore_errors=True)
        return False
    try:
        path = await finalize_capture_dir(
            work_dir,
            output_path,
            printer_id=printer_id,
            print_id=print_id,
        )
    except Exception as exc:
        log.warning("orphan native finalize failed for %s print_id=%s: %s", printer_id, print_id, exc)
        return False
    if not path:
        return False
    return _attach_native_timelapse_path(printer_id, print_id, path)


async def _maybe_start_native_recorder(printer_id: str, p: dict) -> None:
    if not _native_recorder_enabled():
        return
    if printer_id in _native_recorders:
        return
    if p.get("kind") != "bambu":
        return
    if not _native_recorder_first_layer_ready(p):
        return
    proxy = _native_recorder_proxy(printer_id)
    if not proxy:
        return
    print_id = _resolve_native_print_id(printer_id, p)
    if not print_id:
        return
    item = db.get_print_by_id(print_id)
    if not item or item.get("printer_id") != printer_id:
        return
    if item.get("has_timelapse"):
        return
    work_dir, output_path = _native_capture_paths(printer_id, print_id, item.get("filename") or "print")
    recorder = PrintNativeRecorder(proxy, printer_id, print_id, work_dir, output_path)
    prior_segments = recorder.existing_segment_count()
    try:
        await recorder.start()
    except Exception as exc:
        log.warning("native recorder start failed for %s print_id=%s: %s", printer_id, print_id, exc)
        return
    _native_recorders[printer_id] = recorder
    if prior_segments:
        db.log_decision(
            printer_id,
            "flight_recorder_native_resume",
            f"Resumed native timelapse for print #{print_id} with {prior_segments} existing segment(s)",
            print_id=print_id,
        )
    else:
        db.log_decision(
            printer_id,
            "flight_recorder_native_start",
            f"Recording timelapse from first layer for print #{print_id}",
            print_id=print_id,
        )


async def _stop_native_recorder(printer_id: str, print_id: Optional[int] = None) -> None:
    recorder = _native_recorders.pop(printer_id, None)
    target_print_id = print_id or (recorder.print_id if recorder else None)
    if recorder:
        try:
            path = await recorder.stop()
        except Exception as exc:
            log.warning("native recorder stop failed for %s: %s", printer_id, exc)
            path = None
        if path and target_print_id:
            _attach_native_timelapse_path(printer_id, target_print_id, path)
            return
    if target_print_id:
        await _finalize_orphan_native_capture(printer_id, target_print_id)


async def _handle_print_recorder_finish(
    printer_id: str,
    print_id: Optional[int],
    mqtt_hint: Optional[str] = None,
) -> None:
    await _stop_native_recorder(printer_id, print_id)
    if print_id:
        await _auto_harvest_flight_recorder(printer_id, print_id, mqtt_hint)


def _check_transitions(data: list[dict]) -> None:
    for p in data:
        pid = p["id"]
        curr = p["state"]
        prev = _prev_states.get(pid)
        _prev_states[pid] = curr
        is_simulated = bool(p.get("_simulated"))
        if prev is None:
            finished_print_id = p.get("_last_finished_print_id")
            if not is_simulated and curr == "finished" and finished_print_id:
                asyncio.create_task(_handle_print_recorder_finish(
                    pid, finished_print_id, p.get("_last_timelapse_path"),
                ))
            if not is_simulated and curr in ("printing", "paused"):
                asyncio.create_task(_maybe_start_native_recorder(pid, p))
            continue
        if prev == curr:
            if not is_simulated and curr in ("printing", "paused") and pid not in _native_recorders:
                asyncio.create_task(_maybe_start_native_recorder(pid, p))
            continue
        log.info("state transition %s: %s → %s", pid, prev, curr)
        name = p.get("custom_name") or p.get("id")
        job = p.get("job") or {}
        fname = (job.get("filename") or "").rsplit("/", 1)[-1].rsplit("\\", 1)[-1]
        sub = job.get("subtask_name", "").strip()
        label = sub if sub and sub != fname else fname
        has_error_print = p.get("_error_print_id") is not None
        title_prefix = "SIM " if is_simulated else ""

        if prev == "printing" and curr in {"finished", "ready", "standby", "complete", "idle"}:
            last = None if is_simulated else db.get_last_print(pid)
            last_finished = str((last or {}).get("final_state") or "").upper() == "FINISHED"
            completed = (
                curr == "finished"
                or _recently_finished(pid)
                or (curr == "idle" and last_finished)
            )
            if completed:
                msg = f"{name}" + (f" · {label}" if label else "")
                _notify("success", f"{title_prefix}Print complete", msg, printer_id=pid, link=f"#/printer/{pid}/history")
                if not is_simulated:
                    asyncio.create_task(_send_ntfy("Print complete", msg, ["white_check_mark"]))
                asyncio.create_task(_on_print_finished_queue(pid))
                if not is_simulated:
                    finished_print_id = p.get("_last_finished_print_id") or db.get_latest_finished_print_id(pid)
                    if finished_print_id:
                        asyncio.create_task(_handle_print_recorder_finish(
                            pid, finished_print_id, p.get("_last_timelapse_path"),
                        ))
            elif curr == "idle":
                # Idle without a finish window — leave queue row for reconciler
                # (stale cancel / filename match) instead of assuming user cancel.
                pass
            else:
                msg = f"{name}" + (f" · {label}" if label else "")
                _notify("warn", f"{title_prefix}Print cancelled", msg, printer_id=pid, link=f"#/printer/{pid}/history")
                if not is_simulated:
                    asyncio.create_task(_send_ntfy("Print cancelled", msg, ["x"]))
                db.queue_cancel_active(pid, "cancelled")
                asyncio.create_task(_maybe_auto_advance_queue(pid, trigger="print_cancelled"))
                if not is_simulated:
                    asyncio.create_task(_handle_print_recorder_finish(
                        pid, _resolve_native_print_id(pid, p), p.get("_last_timelapse_path"),
                    ))
        elif curr in ("error", "estop"):
            error_pid = p.get("_error_print_id")
            is_print_failure = prev == "printing" or has_error_print
            if is_print_failure:
                asyncio.create_task(_do_failure_snapshot(pid, error_pid))
                if error_pid and not is_simulated:
                    asyncio.create_task(_handle_print_recorder_finish(
                        pid, error_pid, p.get("_last_timelapse_path"),
                    ))
            if curr == "error" and is_print_failure:
                msg = f"{name}" + (f" · {label}" if label else "")
                if p.get("error"):
                    msg += f" · {p['error']}"
                _notify("error", f"{title_prefix}Print error", msg, printer_id=pid, print_id=error_pid, link=f"#/printer/{pid}/live")
                if not is_simulated:
                    asyncio.create_task(_send_ntfy("Print error", msg, ["warning"], priority=4))
                db.queue_fail_active(pid, str(p.get("error") or "Printer reported an error"))
        elif prev == "printing" and curr == "paused":
            msg = f"{name}" + (f" · {label}" if label else "")
            if p.get("error"):
                msg += f" · {p['error']}"
            _notify("info", f"{title_prefix}Print paused", msg, printer_id=pid, link=f"#/printer/{pid}/live")
            if not is_simulated:
                asyncio.create_task(_send_ntfy("Print paused", msg, ["double_vertical_bar"]))
            if "ams mapping" in str(p.get("error") or "").lower():
                db.queue_fail_active(pid, str(p.get("error") or "Failed to get AMS mapping table"))
        elif prev == "printing" and curr == "idle":
            msg = f"{name}" + (f" · {label}" if label else "")
            _notify("warn", f"{title_prefix}Print cancelled", msg, printer_id=pid, link=f"#/printer/{pid}/history")
            if not is_simulated:
                asyncio.create_task(_send_ntfy("Print cancelled", msg, ["x"]))
            db.queue_cancel_active(pid, "cancelled")
            asyncio.create_task(_maybe_auto_advance_queue(pid, trigger="print_cancelled"))
            if not is_simulated:
                asyncio.create_task(_handle_print_recorder_finish(
                    pid, _resolve_native_print_id(pid, p), p.get("_last_timelapse_path"),
                ))
        elif prev == "paused" and curr not in ("printing", "paused") and not is_simulated:
            asyncio.create_task(_handle_print_recorder_finish(
                pid,
                p.get("_last_finished_print_id") or p.get("_error_print_id") or _resolve_native_print_id(pid, p),
                p.get("_last_timelapse_path"),
            ))

        if not is_simulated and prev not in ("printing", "paused") and curr in ("printing", "paused"):
            asyncio.create_task(_maybe_start_native_recorder(pid, p))


async def _push_toast(message: str, sub: str = "", toast_type: str = "warning") -> None:
    """Push a one-shot toast to all connected WebSocket clients."""
    payload = json.dumps({"type": "toast", "message": message, "sub": sub, "toastType": toast_type})
    dead: set[WebSocket] = set()
    for ws in list(_ws_clients):
        try:
            await ws.send_text(payload)
        except Exception:
            dead.add(ws)
    _ws_clients.difference_update(dead)


async def _broadcast_loop():
    poll_counter = 0
    while True:
        await asyncio.sleep(5)
        try:
            try:
                data = await asyncio.wait_for(_gather_all(), timeout=8.0)
            except asyncio.TimeoutError:
                log.warning("broadcast gather timed out; serving stale printer snapshot")
                data = _stale_printers() or []
            if not data:
                continue
            _check_transitions(data)
            _check_calibration_sessions(data)
            poll_counter += 1
            if poll_counter >= 12:
                poll_counter = 0
                await _scan_idle_queue_dispatch()
            if not _ws_clients:
                continue
            msg = json.dumps(data, default=_dt_default)
            dead: set[WebSocket] = set()
            for ws in list(_ws_clients):
                try:
                    await ws.send_text(msg)
                except Exception:
                    dead.add(ws)
            _ws_clients.difference_update(dead)
        except Exception as exc:
            log.warning("broadcast loop error: %s", exc)


def _scale_keep_awake_enabled() -> bool:
    return os.getenv("FLIGHTDECK_SCALE_KEEP_AWAKE", "true").strip().lower() not in {"0", "false", "no", "off"}


def _scale_keep_awake_interval() -> float:
    try:
        return max(30.0, float(os.getenv("FLIGHTDECK_SCALE_KEEP_AWAKE_INTERVAL", "120")))
    except ValueError:
        return 120.0


async def _scale_keep_awake_loop():
    if not _scale_keep_awake_enabled():
        return
    interval = _scale_keep_awake_interval()
    while True:
        try:
            await asyncio.sleep(interval)
            await asyncio.to_thread(_scale.keep_awake_ping)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            log.debug("scale keep-awake ping failed: %s", exc)


def _raise_multipart_limits() -> None:
    """Starlette defaults to 1 MB per multipart part — too small for MakerDeck 3MF library saves."""
    try:
        from starlette import formparsers

        cap = _MAX_PRINT_FILE_BYTES
        formparsers.MultiPartParser.max_part_size = cap
        if hasattr(formparsers.MultiPartParser, "max_file_size"):
            formparsers.MultiPartParser.max_file_size = cap
    except Exception:
        log.warning("Could not raise Starlette multipart upload limits", exc_info=True)


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _broadcast_task, _scale_keep_awake_task, _ntfy
    _raise_multipart_limits()
    db.init()
    _last_seen_cache.update(db.get_all_last_seen())
    cfg = load()
    _ntfy = cfg.ntfy

    for entry in cfg.printers:
        conn = entry.connection
        _cameras[entry.id] = entry.camera
        _presets[entry.id] = entry.temperature_presets or {}
        if isinstance(conn, (MoonrakerConnection, SnapmakerU1Connection)):
            _moonraker.append(_moonraker_runtime_entry(entry, conn))
        elif isinstance(conn, BambuConnection):
            p = BambuPrinter(
                id=entry.id,
                model_name=entry.model_name,
                custom_name=entry.custom_name,
                icon=entry.icon_key(),
                ip=conn.host,
                access_code=conn.access_code,
                serial=conn.serial,
            )
            await asyncio.to_thread(p.start)
            _bambu.append(p)
            if isinstance(entry.camera, BambuRtspCamera):
                rtsp_url = (
                    f"rtsps://bblp:{conn.access_code}@{conn.host}"
                    f":322/streaming/live/1"
                )
                _cam_proxies[entry.id] = BambuCameraProxy(rtsp_url, entry.id)
        elif isinstance(conn, SimulatedConnection):
            _simulated.append((
                entry.id,
                entry.model_name,
                entry.custom_name,
                entry.icon_key(),
                conn.profile,
                conn.scenario,
            ))

    # Seed prev states so startup doesn't fire spurious notifications.
    # Prime the cache with placeholders and seed in the background so a slow or
    # offline printer never blocks the app shell from coming up.
    _prime_printer_cache()
    asyncio.create_task(_delayed_seed_prev_states())

    _broadcast_task = asyncio.create_task(_broadcast_loop())
    _scale_keep_awake_task = asyncio.create_task(_scale_keep_awake_loop())
    asyncio.create_task(_boot_queue_auto_dispatch())

    yield

    if _broadcast_task:
        _broadcast_task.cancel()
    if _scale_keep_awake_task:
        _scale_keep_awake_task.cancel()
    for proxy in _cam_proxies.values():
        await proxy.stop()
    _cam_proxies.clear()
    # Suspend only — keep seg_*.mp4 so a mid-print restart can resume the same capture.
    for recorder in list(_native_recorders.values()):
        try:
            kept = await recorder.suspend()
            log.info(
                "native recorder suspended on shutdown: %s print_id=%s segments=%s",
                recorder.printer_id,
                recorder.print_id,
                kept,
            )
        except Exception as exc:
            log.warning("native recorder suspend failed for %s: %s", recorder.printer_id, exc)
    _native_recorders.clear()
    for p in _bambu:
        try:
            await asyncio.wait_for(asyncio.to_thread(p.stop), timeout=5)
        except asyncio.TimeoutError:
            pass
    _bambu.clear()
    _moonraker.clear()
    _simulated.clear()


_STATIC = Path(__file__).parent / "static"
app = FastAPI(title="Flightdeck", lifespan=lifespan)


class NoCacheStaticFiles(StaticFiles):
    async def get_response(self, path: str, scope):
        response = await super().get_response(path, scope)
        response.headers["Cache-Control"] = "no-store, max-age=0"
        response.headers["Pragma"] = "no-cache"
        return response


app.mount("/static", NoCacheStaticFiles(directory=_STATIC), name="static")

_MAKERDECK = APP_DIR / "makerforge"
if _MAKERDECK.is_dir():
    app.mount(
        "/makerdeck",
        NoCacheStaticFiles(directory=_MAKERDECK, html=True),
        name="makerdeck",
    )


class FileQueueRequest(BaseModel):
    source_id: str
    path: str
    printer_id: str


class FileDeskPathRequest(BaseModel):
    source_id: str
    path: str
    replace: bool = False


class FileDeskDeleteRequest(FileDeskPathRequest):
    confirm: str = ""


class SlicePlanRequest(BaseModel):
    source_id: str
    path: str
    printer_id: str
    printer_profile: str = ""
    process_profile: str = ""
    filament_profile: str = ""
    plate: str = "auto"
    bed_type: str = "Textured PEI Plate"
    support_mode: str = "profile"
    brim_mode: str = "profile"
    all_plates: bool = False


class SliceOutputStatusRequest(BaseModel):
    filename: str


class SliceRunRequest(SlicePlanRequest):
    output_filename: Optional[str] = None


class SlicerOpenRequest(BaseModel):
    source_id: str
    path: str
    filename: str = ""
    target: str = "desktop_orca"


class SlicerOpenPathRequest(BaseModel):
    """Open an existing local/UNC path on the Windows worker (PrintShelf NAS handoff)."""
    path: str
    target: str = "bambu_studio"


class ShellOpenPathRequest(BaseModel):
    """Open or reveal a local/UNC path on the Windows worker (Explorer / default app)."""
    path: str
    mode: str = "open"  # open | reveal


class SlicerConnectionCheckRequest(BaseModel):
    kind: str
    url: str


class OrcaDockerActionRequest(BaseModel):
    target: str = "all"


def _slice_request_profiles(body: SlicePlanRequest, settings: dict, printer_id: str) -> dict:
    return {
        "printer": (body.printer_profile or settings.get(_slicer_profile_key(printer_id, "printer"), "") or "").strip(),
        "process": (body.process_profile or settings.get(_slicer_profile_key(printer_id, "process"), "") or "").strip(),
        "filament": (body.filament_profile or settings.get(_slicer_profile_key(printer_id, "filament"), "") or "").strip(),
    }


class BambuSdClearRequest(BaseModel):
    confirm: str = ""


@app.get("/", include_in_schema=False)
def index():
    return FileResponse(
        _STATIC / "index.html",
        headers={
            "Cache-Control": "no-store, max-age=0",
            "Pragma": "no-cache",
        },
    )


@app.get("/demo", include_in_schema=False)
@app.get("/demo/", include_in_schema=False)
def standalone_demo():
    return FileResponse(
        _STATIC / "demo.html",
        headers={
            "Cache-Control": "no-store, max-age=0",
            "Pragma": "no-cache",
        },
    )


@app.get("/makerdeck", include_in_schema=False)
def makerdeck_redirect():
    return RedirectResponse(url="/makerdeck/", status_code=307)


@app.get("/health")
@app.get("/healthz")
def healthz():
    return {
        "status": "ok",
        "version": APP_VERSION,
        "ws_clients": len(_ws_clients),
        "broadcast_running": bool(_broadcast_task and not _broadcast_task.done()),
    }


def _file_kind(name: str) -> str:
    lower = name.lower()
    if lower.endswith(".gcode.3mf"):
        return "gcode.3mf"
    if lower.endswith(".3mf"):
        return "3mf"
    if lower.endswith(".stl"):
        return "stl"
    if lower.endswith(".step") or lower.endswith(".stp"):
        return "step"
    if lower.endswith(".obj"):
        return "obj"
    if lower.endswith(".gcode.gz"):
        return "gcode.gz"
    if lower.endswith(".gcode"):
        return "gcode"
    if lower.endswith(".ufp"):
        return "ufp"
    return "file"


def _file_archive_key(name: str) -> str:
    text = str(name or "").rsplit("/", 1)[-1].rsplit("\\", 1)[-1].lower()
    for suffix in (".gcode.3mf", ".gcode.gz", ".3mf", ".gcode", ".ufp", ".step", ".stp", ".stl", ".obj"):
        if text.endswith(suffix):
            text = text[: -len(suffix)]
            break
    return text.strip()


def _safe_basename(name: str | None, fallback: str = "flightdeck-file") -> str:
    raw = str(name or fallback).replace("\x00", "")
    raw = raw.rsplit("/", 1)[-1].rsplit("\\", 1)[-1]
    safe = re.sub(r"[^A-Za-z0-9._ -]+", "_", raw).strip(" ._")
    return safe or fallback


def _safe_join_under(root: Path, *parts: str | Path, missing_ok: bool = False) -> Path:
    base = root.resolve()
    target = base.joinpath(*[str(p) for p in parts]).resolve()
    try:
        target.relative_to(base)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid path")
    if not missing_ok and not target.exists():
        raise HTTPException(status_code=404, detail="File not found")
    return target


def _format_bytes(size: int) -> str:
    value = float(max(0, int(size or 0)))
    for unit in ("B", "KB", "MB", "GB"):
        if value < 1024 or unit == "GB":
            return f"{value:.1f} {unit}" if unit != "B" else f"{int(value)} B"
        value /= 1024
    return f"{value:.1f} GB"


def _enforce_file_size(size: int, limit: int = _MAX_PRINT_FILE_BYTES, label: str = "File") -> None:
    if size > limit:
        raise HTTPException(
            status_code=413,
            detail=f"{label} is too large ({_format_bytes(size)}). Limit is {_format_bytes(limit)}.",
        )


async def _read_upload_bytes(file: UploadFile, limit: int = _MAX_PRINT_FILE_BYTES, label: str = "File") -> bytes:
    data = bytearray()
    while True:
        chunk = await file.read(_UPLOAD_READ_CHUNK_BYTES)
        if not chunk:
            break
        data.extend(chunk)
        _enforce_file_size(len(data), limit, label)
    if not data:
        raise HTTPException(status_code=422, detail="Empty file")
    return bytes(data)


def _print_library_path(raw: str | None = None) -> Path:
    if raw is None:
        raw = db.get_all_settings().get("print_vault_path") or ""
    text = str(raw or "").strip()
    if not text:
        return PRINT_LIBRARY_DIR
    path = Path(text).expanduser()
    if not path.is_absolute():
        path = (DATA_DIR / path).resolve()
    return path


def _validate_print_library_path(raw: str) -> Path:
    path = _print_library_path(raw)
    if path.exists() and not path.is_dir():
        raise HTTPException(status_code=422, detail="Print Vault path must be a directory")
    parent = path if path.exists() else path.parent
    if not parent.exists():
        raise HTTPException(status_code=422, detail=f"Parent directory does not exist: {parent}")
    if not _is_writable_dir(path):
        raise HTTPException(status_code=422, detail=f"Print Vault path is not writable: {path}")
    return path


def _local_library_files() -> list[dict]:
    root = _print_library_path()
    root.mkdir(parents=True, exist_ok=True)
    rows = []
    for path in sorted(root.rglob("*")):
        if path.is_dir():
            continue
        try:
            stat = path.stat()
        except OSError:
            continue
        rel = path.relative_to(root).as_posix()
        rows.append({
            "name": path.name,
            "path": rel,
            "folder": path.parent.relative_to(root).as_posix() if path.parent != root else "",
            "kind": _file_kind(path.name),
            "size": stat.st_size,
            "modified": datetime.fromtimestamp(stat.st_mtime).isoformat(),
        })
        if len(rows) >= 400:
            break
    return rows


def _mark_vaulted_files(files: list[dict], vault_lookup: dict[str, dict]) -> list[dict]:
    rows = []
    for item in files:
        row = dict(item)
        key = _file_archive_key(row.get("path") or row.get("name"))
        vaulted = vault_lookup.get(key)
        if vaulted:
            row["in_vault"] = True
            row["vault_path"] = vaulted.get("path") or vaulted.get("name")
        rows.append(row)
    return rows


def _safe_library_path(rel_path: str) -> Path:
    root = _print_library_path()
    target = _safe_join_under(root, rel_path)
    if not target.is_file():
        raise HTTPException(status_code=404, detail="Library file not found")
    return target


async def _moonraker_files(base_url: str) -> list[dict]:
    return await _moonraker_files_root(base_url, "gcodes")


async def _moonraker_files_root(base_url: str, root: str) -> list[dict]:
    timeout = httpx.Timeout(4.0, connect=1.0)
    async with httpx.AsyncClient(timeout=timeout) as client:
        r = await client.get(f"{base_url.rstrip('/')}/server/files/list", params={"root": root})
        r.raise_for_status()
        result = r.json().get("result", [])
    rows = []
    for item in result:
        path = item.get("path") or item.get("filename") or item.get("name") or ""
        name = path.rsplit("/", 1)[-1]
        if not name:
            continue
        rows.append({
            "name": name,
            "path": path,
            "kind": "dir" if item.get("type") == "directory" else _file_kind(name),
            "size": item.get("size"),
            "modified": item.get("modified") or item.get("date"),
        })
    return sorted(rows, key=lambda r: (r["kind"] != "dir", r["path"].lower()))


async def _download_moonraker_file(base_url: str, path: str, root: str = "gcodes") -> bytes:
    from urllib.parse import quote
    safe = quote(path.lstrip("/"), safe="/")
    async with httpx.AsyncClient(timeout=120.0) as client:
        r = await client.get(f"{base_url.rstrip('/')}/server/files/{root}/{safe}")
        r.raise_for_status()
        return r.content


async def _delete_moonraker_file(base_url: str, path: str) -> None:
    from urllib.parse import quote
    safe = quote(path.lstrip("/"), safe="/")
    async with httpx.AsyncClient(timeout=30.0) as client:
        r = await client.delete(f"{base_url.rstrip('/')}/server/files/gcodes/{safe}")
        r.raise_for_status()


def _queue_file_extension(filename: str) -> str:
    name = filename.lower()
    if name.endswith(".gcode.3mf"):
        return ".3mf"
    if name.endswith(".gcode.gz"):
        return ".gcode.gz"
    if "." in name:
        return "." + name.rsplit(".", 1)[-1]
    return ""


_SOURCE_MODEL_EXT = {".stl", ".3mf", ".obj", ".step", ".stp"}


_GCODE_METADATA_LINES = 5000


def _parse_gcode_metadata_from_lines(lines) -> tuple[Optional[int], Optional[float], Optional[str], Optional[str]]:
    estimated_seconds = filament_weight_g = None
    filament_type = None
    colors: set[str] = set()

    # Common slicer metadata comment patterns
    re_time = re.compile(r"\bTIME\s*:\s*(\d+)", re.I)
    re_filament_weight = re.compile(
        r"\b(?:filament[_ -]?weight|filament[_ -]?used|filament_total|filament_total_weight)\s*(?:\[[gG]\])?\s*=\s*([0-9]+(?:\.[0-9]+)?)",
        re.I,
    )
    re_material = re.compile(r"\b(?:material|filament[_ -]?type)\b\s*[:=]\s*([A-Za-z0-9+\\-/* ]+)", re.I)
    re_colour = re.compile(r"\b(?:filament[_ -]?(?:colour|color)|material[_ -]?color)\b\s*[:=]\s*([^;]+)", re.I)
    re_hex = re.compile(r"#[0-9a-fA-F]{3,8}\b")

    for raw in lines:
        if not raw:
            continue
        line = raw.decode("utf-8", "ignore") if isinstance(raw, bytes) else str(raw)
        if not line.startswith(";"):
            continue
        if estimated_seconds is None:
            m_time = re_time.search(line)
            if m_time:
                try:
                    estimated_seconds = int(m_time.group(1))
                except ValueError:
                    pass

        if filament_weight_g is None:
            m_weight = re_filament_weight.search(line)
            if m_weight:
                try:
                    filament_weight_g = float(m_weight.group(1))
                except ValueError:
                    pass

        if filament_type is None:
            m_type = re_material.search(line)
            if m_type:
                t = m_type.group(1).strip()
                # Prefer the first clearly material-like token.
                t = re.split(r"[,/;]", t)[0].strip()
                if t:
                    filament_type = t

        for colour in re_colour.findall(line):
            for token in re.split(r"[;,\\s]+", str(colour).strip()):
                token = token.strip().strip(",")
                if not token:
                    continue
                for hit in re_hex.findall(token):
                    colors.add(hit.upper())

    color_entry = None
    if colors:
        entries = []
        for c in sorted(colors):
            entries.append({"color": c, "type": filament_type or "", "used_g": 0})
        color_entry = json.dumps(entries)
    return estimated_seconds, filament_weight_g, filament_type, color_entry


def _queue_file_metadata(filename: str, data: bytes) -> dict:
    preview_png = estimated_seconds = filament_weight_g = filament_type = filament_colors = None
    if _queue_file_extension(filename) == ".3mf":
        try:
            from .printers.bambu_ftp import _parse_3mf
            # Queue only needs slice_info filament/nozzle metadata + thumbnail —
            # never walk plate gcode for object shapes (that pegs the API).
            p = _parse_3mf(io.BytesIO(data), include_object_geometry=False)
            preview_png = p.image_png
            estimated_seconds = p.estimated_total_seconds
            filament_weight_g = p.filament_weight_g
            filament_type = p.filament_type
            filament_colors = p.filament_colors
        except Exception:
            pass
    else:
        ext = _queue_file_extension(filename)
        if ext in {".gcode", ".gcode.gz", ".ufp"}:
            try:
                if ext == ".gcode.gz":
                    lines = gzip.open(io.BytesIO(data), mode="rt", encoding="utf-8", errors="ignore")
                    with lines:
                        meta = _parse_gcode_metadata_from_lines(list(lines)[:_GCODE_METADATA_LINES])
                else:
                    text = data.decode("utf-8", "ignore")
                    meta = _parse_gcode_metadata_from_lines(text.splitlines()[:_GCODE_METADATA_LINES])
                if meta[0] is not None:
                    estimated_seconds = meta[0]
                if meta[1] is not None:
                    filament_weight_g = meta[1]
                if meta[2] and not filament_type:
                    filament_type = meta[2]
                if meta[3] and not filament_colors:
                    filament_colors = meta[3]
            except Exception:
                pass
    return {
        "preview_png": preview_png,
        "estimated_seconds": estimated_seconds,
        "filament_weight_g": filament_weight_g,
        "filament_type": filament_type,
        "filament_colors": filament_colors,
    }


def _queue_plate_metas(filename: str, data: bytes, *, split_plates: bool) -> list[dict]:
    """One metadata dict per printable plate (or a single whole-file job)."""
    base = _queue_file_metadata(filename, data)
    if not split_plates or _queue_file_extension(filename) != ".3mf":
        return [{**base, "plate_number": None, "plate_count": None}]
    try:
        from .printers.bambu_ftp import _parse_3mf, list_3mf_gcode_plates
        plates = list_3mf_gcode_plates(data)
    except Exception:
        plates = []
    if len(plates) <= 1:
        plate_n = plates[0] if plates else None
        return [{**base, "plate_number": plate_n, "plate_count": len(plates) or None}]
    out: list[dict] = []
    buf = io.BytesIO(data)
    for n in plates:
        try:
            buf.seek(0)
            p = _parse_3mf(buf, plate_number=n, include_object_geometry=False)
            out.append({
                "preview_png": p.image_png or base["preview_png"],
                "estimated_seconds": p.estimated_total_seconds,
                "filament_weight_g": p.filament_weight_g,
                "filament_type": p.filament_type or base["filament_type"],
                "filament_colors": p.filament_colors or base["filament_colors"],
                "plate_number": n,
                "plate_count": len(plates),
            })
        except Exception:
            out.append({**base, "plate_number": n, "plate_count": len(plates)})
    return out or [{**base, "plate_number": None, "plate_count": None}]


def _enqueue_print_file(
    printer_id: str,
    filename: str,
    file_path: str,
    data: bytes,
    *,
    calibrate_before_start: bool = False,
    split_plates: bool = False,
) -> list[int]:
    metas = _queue_plate_metas(filename, data, split_plates=split_plates)
    job_ids: list[int] = []
    for i, meta in enumerate(metas):
        job_ids.append(db.queue_add(
            printer_id, filename, file_path, len(data),
            preview_png=meta["preview_png"],
            estimated_seconds=meta["estimated_seconds"],
            filament_weight_g=meta["filament_weight_g"],
            filament_type=meta["filament_type"],
            filament_colors=meta["filament_colors"],
            calibrate_before_start=bool(calibrate_before_start and i == 0),
            plate_number=meta.get("plate_number"),
            plate_count=meta.get("plate_count"),
        ))
    return job_ids


def _queue_enqueue_response(job_ids: list[int]) -> dict:
    return {
        "id": job_ids[0] if job_ids else None,
        "ids": job_ids,
        "count": len(job_ids),
    }


async def _read_file_desk_source(source_id: str, source_path: str) -> tuple[str, bytes]:
    source_id = source_id.strip()
    source_path = source_path.strip().lstrip("/")
    if not source_path:
        raise HTTPException(status_code=422, detail="File path required")

    if source_id == "queue":
        try:
            job_id = int(source_path)
        except ValueError:
            raise HTTPException(status_code=422, detail="Queue job id required")
        job = db.queue_get(job_id)
        if not job:
            raise HTTPException(status_code=404, detail="Queue job not found")
        filename = job["filename"]
        ext = _queue_file_extension(filename)
        if ext not in _SOURCE_MODEL_EXT:
            raise HTTPException(status_code=422, detail="Only source model queue jobs can be sliced")
        file_path = Path(job["file_path"])
        if not file_path.is_file():
            raise HTTPException(status_code=404, detail="Queued source file not found")
        _enforce_file_size(file_path.stat().st_size, label="Queued source file")
        data = file_path.read_bytes()
        if not data:
            raise HTTPException(status_code=422, detail="Empty file")
        return filename, data

    filename = source_path.rsplit("/", 1)[-1].rsplit("\\", 1)[-1]
    ext = _queue_file_extension(filename)
    if ext not in (_ALLOWED_BAMBU_EXT | _ALLOWED_MOONRAKER_EXT | _SOURCE_MODEL_EXT):
        raise HTTPException(status_code=422, detail="Unsupported file type")

    if source_id == "library":
        source_file = _safe_library_path(source_path)
        _enforce_file_size(source_file.stat().st_size, label="Print Vault file")
        data = source_file.read_bytes()
    else:
        bambu = _find_bambu(source_id)
        if bambu:
            from .printers.bambu_ftp import download_bambu_file
            data = await asyncio.to_thread(download_bambu_file, bambu._ip, bambu._access_code, source_path)
        else:
            mr_url = _find_moonraker_url(source_id)
            if not mr_url:
                raise HTTPException(status_code=404, detail="Source not found")
            data = await _download_moonraker_file(mr_url, source_path)

    if not data:
        raise HTTPException(status_code=422, detail="Empty file")
    _enforce_file_size(len(data), label="Source file")
    return filename, data


def _library_import_path(filename: str) -> Path:
    root = _print_library_path()
    return _safe_join_under(root, _safe_basename(filename, "print_file"), missing_ok=True)


@app.get("/api/files")
async def get_file_desk(printer_id: Optional[str] = None):
    library_root = _print_library_path().resolve()
    library_files = _local_library_files()
    vault_lookup = {
        _file_archive_key(f.get("path") or f.get("name")): f
        for f in library_files
        if f.get("kind") != "dir" and _file_archive_key(f.get("path") or f.get("name"))
    }
    targets = [{
        "id": "library",
        "label": "Print Vault",
        "kind": "library",
        "path": str(library_root),
        "files": library_files,
        "actions": {"format_sd": False},
    }]

    async def _moonraker_target(pid: str, model_name: str, custom_name: str, url: str) -> dict:
        try:
            files = await _moonraker_files(url)
            error = None
        except Exception as exc:
            files = []
            error = str(exc)
        return {
            "id": pid,
            "label": custom_name or model_name,
            "model": model_name,
            "kind": "moonraker",
            "files": _mark_vaulted_files(files, vault_lookup),
            "error": error,
            "actions": {"format_sd": False},
        }

    async def _bambu_target(p: BambuPrinter) -> dict:
        cache_key = f"bambu:{p.id}"
        cached = _file_desk_target_cache.get(cache_key)
        if cached and (time.monotonic() - cached.get("at", 0)) < _FILE_DESK_TARGET_CACHE_SECONDS:
            return dict(cached["target"])
        try:
            from .printers.bambu_ftp import list_bambu_files
            files = await asyncio.wait_for(
                asyncio.to_thread(list_bambu_files, p._ip, p._access_code),
                timeout=_BAMBU_FILE_LIST_TIMEOUT_SECONDS,
            )
            error = None
        except asyncio.TimeoutError:
            files = []
            error = "Printer file list timed out; retry in a moment."
        except Exception as exc:
            files = []
            error = str(exc)
        target = {
            "id": p.id,
            "label": p.custom_name or p.model_name,
            "model": p.model_name,
            "kind": "bambu",
            "files": _mark_vaulted_files(files, vault_lookup),
            "error": error,
            "actions": {"format_sd": True, "format_sd_ready": False},
        }
        if error is None:
            _file_desk_target_cache[cache_key] = {"at": time.monotonic(), "target": dict(target)}
        return target

    async def _simulated_target(pid: str, model_name: str, custom_name: str, profile: str) -> dict:
        return {
            "id": pid,
            "label": custom_name or model_name,
            "model": model_name,
            "kind": profile,
            "files": [],
            "error": "Simulated printer: no hardware file store",
            "actions": {"format_sd": False},
        }

    source_tasks = (
        [_moonraker_target(pid, model_name, custom_name, url)
         for (pid, model_name, custom_name, _icon, url, _kind, _toolhead_count) in _moonraker
         if printer_id is None or pid == printer_id] +
        [_bambu_target(p) for p in _bambu
         if printer_id is None or p.id == printer_id]
        + [_simulated_target(pid, model_name, custom_name, profile)
           for (pid, model_name, custom_name, _icon, profile, _scenario) in _simulated
           if printer_id is None or pid == printer_id]
    )
    if source_tasks:
        targets.extend(await asyncio.gather(*source_tasks))

    return {"library_path": str(library_root), "targets": targets}


@app.get("/api/files/reprints")
async def get_file_desk_reprints(limit: int = 12):
    limit = max(1, min(int(limit or 12), 48))
    printers = {
        id: {"id": id, "model_name": model_name, "custom_name": custom_name, "kind": kind}
        for (id, model_name, custom_name, _icon, _url, kind, _toolhead_count) in _moonraker
    }
    printers.update({
        p.id: {"id": p.id, "model_name": p.model_name, "custom_name": p.custom_name, "kind": "bambu"}
        for p in _bambu
    })
    printers.update({
        id: {"id": id, "model_name": model_name, "custom_name": custom_name, "kind": profile}
        for (id, model_name, custom_name, _icon, profile, _scenario) in _simulated
    })
    items = []
    for row in db.get_recent_reprints(limit):
        item = dict(row)
        item["printer"] = printers.get(item["printer_id"], {"id": item["printer_id"]})
        items.append(item)
    return {"items": items}


@app.post("/api/files/queue", status_code=201)
async def queue_file_from_file_desk(body: FileQueueRequest):
    printer_id = body.printer_id.strip()
    source_id = body.source_id.strip()
    source_path = body.path.strip().lstrip("/")

    target_kind = _printer_kind(printer_id)
    if target_kind is None:
        raise HTTPException(status_code=404, detail="Target printer not found")
    if not (_is_moonraker_family(target_kind) or target_kind == "bambu"):
        raise HTTPException(status_code=422, detail="queueing to simulated printers is not supported yet")

    filename, data = await _read_file_desk_source(source_id, source_path)
    ext = _queue_file_extension(filename)
    allowed = _ALLOWED_BAMBU_EXT if target_kind == "bambu" else _ALLOWED_MOONRAKER_EXT
    if ext not in allowed:
        raise HTTPException(
            status_code=422,
            detail=f"Unsupported file type '{ext}' for {target_kind} printer. Expected: {', '.join(sorted(allowed))}",
        )

    import uuid as _uuid
    safe_name = f"{_uuid.uuid4().hex[:8]}_{_safe_basename(filename, 'queued-print')}"
    file_path = str(_safe_join_under(db.UPLOADS_DIR, safe_name, missing_ok=True))
    with open(file_path, "wb") as f:
        f.write(data)

    job_ids = _enqueue_print_file(
        printer_id, filename, file_path, data,
        split_plates=target_kind == "bambu",
    )
    db.log_decision(
        printer_id,
        "filedesk_queued",
        f"{source_id}:{source_path} -> jobs {job_ids}",
    )
    asyncio.create_task(_maybe_auto_advance_queue(printer_id, trigger="filedesk_queue"))
    return _queue_enqueue_response(job_ids)


@app.post("/api/files/library/copy", status_code=201)
async def copy_file_to_library(body: FileDeskPathRequest):
    source_id = body.source_id.strip()
    source_path = body.path.strip().lstrip("/")
    if source_id == "library":
        raise HTTPException(status_code=422, detail="File is already in the Print Vault")
    filename, data = await _read_file_desk_source(source_id, source_path)
    library_root = _print_library_path().resolve()
    library_root.mkdir(parents=True, exist_ok=True)
    dest = _library_import_path(filename)
    replaced = dest.exists()
    if replaced and not body.replace:
        raise HTTPException(
            status_code=409,
            detail={"code": "exists", "name": dest.name, "message": "File already exists in Print Vault"},
        )
    dest.write_bytes(data)
    return {
        "ok": True,
        "name": dest.name,
        "path": dest.relative_to(library_root).as_posix(),
        "size": len(data),
        "replaced": replaced,
    }


@app.post("/api/files/library/upload", status_code=201)
async def upload_file_to_library(file: UploadFile = File(...)):
    raw_name = _safe_basename(file.filename, "model")
    ext = _queue_file_extension(raw_name)
    if raw_name.lower().endswith(".gcode.3mf"):
        allowed = _ALLOWED_BAMBU_EXT
    else:
        allowed = _ALLOWED_BAMBU_EXT | _ALLOWED_MOONRAKER_EXT | _SOURCE_MODEL_EXT
    if ext not in allowed:
        raise HTTPException(status_code=422, detail="Unsupported file type")
    data = await _read_upload_bytes(file, label="Print Vault upload")
    library_root = _print_library_path().resolve()
    library_root.mkdir(parents=True, exist_ok=True)
    dest = _library_import_path(raw_name)
    if dest.exists():
        stem = dest.stem
        suffix = "".join(dest.suffixes) or ext
        dest = _library_import_path(f"{stem}_{datetime.utcnow().strftime('%Y%m%d%H%M%S')}{suffix}")
    dest.write_bytes(data)
    return {
        "ok": True,
        "name": dest.name,
        "path": dest.relative_to(library_root).as_posix(),
        "kind": _file_kind(dest.name),
        "size": len(data),
    }


@app.get("/api/files/source/download")
async def download_file_desk_source(source_id: str, path: str):
    source_id = source_id.strip()
    source_path = path.strip().lstrip("/")
    if not source_id or not source_path:
        raise HTTPException(status_code=422, detail="Source and path required")
    filename, data = await _read_file_desk_source(source_id, source_path)
    safe_name = (filename.rsplit("/", 1)[-1].rsplit("\\", 1)[-1] or "flightdeck-model").replace('"', "_")
    return Response(
        content=data,
        media_type="application/octet-stream",
        headers={"Content-Disposition": f'attachment; filename="{safe_name}"'},
    )


@app.get("/api/files/source/preview")
async def preview_file_desk_source(source_id: str, path: str, view: Optional[str] = None):
    source_id = source_id.strip()
    source_path = path.strip().lstrip("/")
    if not source_id or not source_path:
        raise HTTPException(status_code=422, detail="Source and path required")
    filename, data = await _read_file_desk_source(source_id, source_path)
    if not filename.lower().endswith(".gcode.3mf") and _queue_file_extension(filename) != ".3mf":
        raise HTTPException(status_code=404, detail="No preview available")
    try:
        from .printers.bambu_ftp import _parse_3mf
        preview = _parse_3mf(io.BytesIO(data), include_object_geometry=False)
    except Exception as exc:
        raise HTTPException(status_code=404, detail="No preview available") from exc
    prefer_top = (view or "").strip().lower() == "top"
    png = preview.top_image_png if prefer_top and preview and preview.top_image_png else None
    if not png and preview:
        png = preview.image_png or preview.top_image_png
    if not png:
        raise HTTPException(status_code=404, detail="No preview available")
    return Response(
        content=png,
        media_type="image/png",
        headers={"Cache-Control": "no-store, max-age=0"},
    )


@app.post("/api/slicer/plan")
async def plan_slice_from_file_desk(body: SlicePlanRequest):
    printer_id = body.printer_id.strip()
    source_id = body.source_id.strip()
    source_path = body.path.strip().lstrip("/")
    target_kind = _printer_kind(printer_id)
    if target_kind is None:
        raise HTTPException(status_code=404, detail="Target printer not found")

    filename, data = await _read_file_desk_source(source_id, source_path)
    ext = _queue_file_extension(filename)
    if filename.lower().endswith(".gcode.3mf") or ext not in _SOURCE_MODEL_EXT:
        raise HTTPException(status_code=422, detail="Only source model files can be sliced")
    is_step_source = ext in {".step", ".stp"}

    settings = db.get_all_settings()
    browser_url = (settings.get("orcaslicer_docker_url") or "").strip().rstrip("/")
    bambustudio_url = (settings.get("bambustudio_docker_url") or "").strip().rstrip("/")
    worker_url = (settings.get("orcaslicer_worker_url") or "").strip().rstrip("/")
    api_url = (settings.get("orcaslicer_api_url") or "").strip().rstrip("/")
    slicer_use_api = str(settings.get("slicer_use_api") or "").strip().lower() in {"1", "true", "yes", "on"}
    slicer_open_mode = (settings.get("slicer_open_mode") or "same").strip() or "same"
    output_ext = ".gcode.3mf" if target_kind == "bambu" else ".gcode"
    base_name = _file_archive_key(filename) or "sliced_model"
    target = next((p for p in await _gather_all() if p.get("id") == printer_id), None)
    slice_options = _slice_option_summary(body.bed_type, body.support_mode, body.brim_mode)
    profiles = _slice_request_profiles(body, settings, printer_id)
    missing_profiles = [label for label, value in profiles.items() if not str(value or "").strip()]
    can_slice = slicer_use_api and bool(worker_url or api_url or _orca_executable()) and not missing_profiles and not is_step_source
    can_handoff = is_step_source and not missing_profiles
    h2d_loose_mesh = _h2d_loose_mesh_requires_sidecar(filename, profiles)
    slicer_api_probe = None
    if slicer_use_api and h2d_loose_mesh and api_url:
        slicer_api_probe = await _probe_slicer_api(api_url)
    if slicer_use_api and h2d_loose_mesh and not (slicer_api_probe or {}).get("ok"):
        can_slice = False
        can_handoff = not missing_profiles
    background_slice_paused = not slicer_use_api
    if background_slice_paused and not missing_profiles:
        can_slice = False
        can_handoff = True
    return {
        "ok": True,
        "ready": can_slice or can_handoff,
        "can_background_slice": can_slice,
        "manual_handoff": can_handoff,
        "background_slice_paused": background_slice_paused,
        "sidecar_url": browser_url,
        "browser_url": browser_url,
        "bambustudio_url": bambustudio_url,
        "api_url": api_url,
        "api_health": slicer_api_probe,
        "worker_url": worker_url,
        "slicer_use_api": slicer_use_api,
        "slicer_open_mode": slicer_open_mode,
        "source": {
            "source_id": source_id,
            "path": source_path,
            "filename": filename,
            "kind": _file_kind(filename),
            "size": len(data),
            "download_url": (
                "/api/files/source/download?"
                f"source_id={urllib.parse.quote(source_id)}&path={urllib.parse.quote(source_path)}"
            ),
        },
        "target": {
            "id": printer_id,
            "kind": target_kind,
            "model_name": target.get("model_name") if target else printer_id,
            "custom_name": target.get("custom_name") if target else printer_id,
        },
        "output": {
            "filename": f"{base_name}_{printer_id}{output_ext}",
            "kind": "gcode.3mf" if target_kind == "bambu" else "gcode",
        },
        "profiles": profiles,
        "slice_options": slice_options,
        "missing_profiles": missing_profiles,
        "plate": body.plate or "auto",
        "all_plates": bool(body.all_plates),
        "message": (
            "In-Flightdeck background slicing is paused while the managed Orca printer/AMS workflow is validated. Open the model in Orca, inspect the plate, then export the sliced job back to the Print Vault."
            if background_slice_paused and not missing_profiles else
            f"H2D STL/OBJ background slicing needs a running slicer API sidecar. {(slicer_api_probe or {}).get('detail') or 'Configure the sidecar API URL first.'} Use Open Orca until it is online."
            if h2d_loose_mesh and not (slicer_api_probe or {}).get("ok") and not missing_profiles else
            "STEP models need Orca GUI import; use Download model/Open Orca, then export the sliced job back to the Print Vault."
            if can_handoff else
            "Slicer API configured. Flightdeck can slice this in the background."
            if api_url and can_slice else
            "Slicer worker configured. Flightdeck can slice this in the background."
            if worker_url and can_slice else
            "Use the profiles below in Orca, then export the printer-specific job back to the Print Vault."
            if browser_url and not missing_profiles else
            f"Set slicer defaults for {', '.join(missing_profiles)} in Settings -> Slicer before slicing this model."
            if missing_profiles else
            "Set a Slicer API URL or Worker URL in Settings -> Slicer before Flightdeck can slice this model."
        ),
    }


@app.post("/api/slicer/output-status")
async def slicer_output_status(body: SliceOutputStatusRequest):
    filename = _safe_basename(body.filename, "")
    if not filename:
        raise HTTPException(status_code=422, detail="Output filename required")
    library_root = _print_library_path().resolve()
    path = _safe_join_under(library_root, filename, missing_ok=True)
    if not path.exists():
        return {"exists": False, "filename": filename, "path": filename}
    stat = path.stat()
    return {
        "exists": True,
        "filename": filename,
        "path": filename,
        "kind": _file_kind(filename),
        "size": stat.st_size,
        "modified": datetime.fromtimestamp(stat.st_mtime, timezone.utc).isoformat(),
    }


@app.get("/api/slicer/worker/status")
async def slicer_worker_status():
    exe = _orca_executable()
    return {
        "available": bool(exe),
        "executable": str(exe) if exe else "",
        "datadir": str(_orca_datadir() or ""),
        "profile_roots": [str(p) for p in _orca_profile_roots(exe)],
        "platform": os.name,
    }


_ORCA_DOCKER_BROWSER_CONTAINER = "flightdeck-orcaslicer"
_ORCA_DOCKER_API_CONTAINER = "orca-slicer-api"
_ORCA_DOCKER_BROWSER_IMAGE = "lscr.io/linuxserver/orcaslicer:latest"
_ORCA_DOCKER_CONFIG_TARGET = "/config"
_ORCA_DOCKER_PRINTS_TARGET = "/prints"


def _docker_binary() -> str | None:
    return shutil.which("docker") or shutil.which("docker.exe")


def _run_docker(args: list[str], *, timeout: int = 30, check: bool = True) -> subprocess.CompletedProcess:
    docker = _docker_binary()
    if not docker:
        raise HTTPException(status_code=404, detail="Docker command not found on this Flightdeck host")
    try:
        proc = subprocess.run(
            [docker, *args],
            text=True,
            capture_output=True,
            timeout=timeout,
        )
    except subprocess.TimeoutExpired as exc:
        raise HTTPException(status_code=504, detail=f"Docker command timed out: docker {' '.join(args)}") from exc
    if check and proc.returncode != 0:
        detail = (proc.stderr or proc.stdout or "Docker command failed").strip()
        raise HTTPException(status_code=502, detail=detail)
    return proc


def _docker_inspect_container(name: str) -> dict | None:
    proc = _run_docker(["inspect", name], timeout=15, check=False)
    if proc.returncode != 0:
        return None
    try:
        payload = json.loads(proc.stdout or "[]")
    except Exception:
        return None
    if not isinstance(payload, list) or not payload:
        return None
    return payload[0] if isinstance(payload[0], dict) else None


def _docker_port_summary(port_bindings: dict | None) -> list[str]:
    out: list[str] = []
    if not isinstance(port_bindings, dict):
        return out
    for container_port, bindings in sorted(port_bindings.items()):
        if not isinstance(bindings, list):
            continue
        for binding in bindings:
            if not isinstance(binding, dict):
                continue
            host_ip = str(binding.get("HostIp") or "").strip()
            host_port = str(binding.get("HostPort") or "").strip()
            prefix = f"{host_ip}:" if host_ip else ""
            if host_port:
                out.append(f"{prefix}{host_port}->{container_port}")
    return out


def _docker_container_summary(name: str) -> dict:
    info = _docker_inspect_container(name)
    if not info:
        return {
            "name": name,
            "exists": False,
            "status": "missing",
            "health": "",
            "image": "",
            "ports": [],
            "restart": "",
            "can_update": False,
        }
    state = info.get("State") if isinstance(info.get("State"), dict) else {}
    config = info.get("Config") if isinstance(info.get("Config"), dict) else {}
    host_config = info.get("HostConfig") if isinstance(info.get("HostConfig"), dict) else {}
    health = ""
    if isinstance(state.get("Health"), dict):
        health = str(state["Health"].get("Status") or "")
    image = str(config.get("Image") or info.get("Image") or "")
    restart = ""
    if isinstance(host_config.get("RestartPolicy"), dict):
        restart = str(host_config["RestartPolicy"].get("Name") or "")
    return {
        "name": name,
        "exists": True,
        "status": str(state.get("Status") or ""),
        "running": bool(state.get("Running")),
        "health": health,
        "image": image,
        "image_id": str(info.get("Image") or ""),
        "ports": _docker_port_summary(host_config.get("PortBindings")),
        "restart": restart,
        "can_update": name == _ORCA_DOCKER_BROWSER_CONTAINER and image == _ORCA_DOCKER_BROWSER_IMAGE,
    }


def _docker_bind_source(bind: str, target: str) -> str:
    raw = str(bind or "")
    for suffix in (f":{target}:rw", f":{target}:ro", f":{target}"):
        if raw.endswith(suffix):
            return raw[: -len(suffix)]
    marker = f":{target}:"
    if marker in raw:
        return raw.rsplit(marker, 1)[0]
    return ""


def _orca_docker_config_dir() -> Path | None:
    info = _docker_inspect_container(_ORCA_DOCKER_BROWSER_CONTAINER)
    if not info:
        return None
    host_config = info.get("HostConfig") if isinstance(info.get("HostConfig"), dict) else {}
    for bind in host_config.get("Binds") or []:
        source = _docker_bind_source(str(bind), _ORCA_DOCKER_CONFIG_TARGET)
        if source:
            return Path(source)
    mounts = info.get("Mounts") if isinstance(info.get("Mounts"), list) else []
    for mount in mounts:
        if not isinstance(mount, dict):
            continue
        if str(mount.get("Destination") or "") == _ORCA_DOCKER_CONFIG_TARGET:
            source = str(mount.get("Source") or "").strip()
            if source:
                return Path(source)
    return None


def _orca_docker_prints_dir() -> Path | None:
    info = _docker_inspect_container(_ORCA_DOCKER_BROWSER_CONTAINER)
    if not info:
        return None
    host_config = info.get("HostConfig") if isinstance(info.get("HostConfig"), dict) else {}
    for bind in host_config.get("Binds") or []:
        source = _docker_bind_source(str(bind), _ORCA_DOCKER_PRINTS_TARGET)
        if source:
            return Path(source)
    mounts = info.get("Mounts") if isinstance(info.get("Mounts"), list) else []
    for mount in mounts:
        if not isinstance(mount, dict):
            continue
        if str(mount.get("Destination") or "") == _ORCA_DOCKER_PRINTS_TARGET:
            source = str(mount.get("Source") or "").strip()
            if source:
                return Path(source)
    return None


def _orca_container_path_for_library_file(path: Path) -> str:
    prints_dir = _orca_docker_prints_dir()
    if not prints_dir:
        raise HTTPException(status_code=404, detail="Orca /prints mount was not found")
    try:
        rel = path.resolve().relative_to(prints_dir.resolve()).as_posix()
    except ValueError:
        library_root = _print_library_path().resolve()
        try:
            rel = path.resolve().relative_to(library_root).as_posix()
        except ValueError:
            raise HTTPException(status_code=400, detail="File is not inside the shared Print Vault")
    return f"{_ORCA_DOCKER_PRINTS_TARGET}/{rel}"


def _open_orca_container_file(container_path: str) -> None:
    if not _docker_inspect_container(_ORCA_DOCKER_BROWSER_CONTAINER):
        raise HTTPException(status_code=404, detail="Browser Orca container is not running on this Flightdeck host")
    _run_docker(
        [
            "exec",
            "-d",
            "-u",
            "abc",
            "-e",
            "HOME=/config",
            "-e",
            "DISPLAY=:1",
            "-e",
            "XDG_RUNTIME_DIR=/config/.XDG",
            "-e",
            "WAYLAND_DISPLAY=wayland-0",
            _ORCA_DOCKER_BROWSER_CONTAINER,
            "/opt/orcaslicer/bin/orca-slicer",
            container_path,
        ],
        timeout=10,
    )


def _import_model_for_orca(filename: str, data: bytes) -> tuple[Path, str]:
    library_root = _print_library_path().resolve()
    library_root.mkdir(parents=True, exist_ok=True)
    safe_name = _safe_basename(filename, "flightdeck-model.3mf")
    dest = _unique_library_destination(library_root, safe_name)
    dest.write_bytes(data)
    return dest, dest.relative_to(library_root).as_posix()


def _open_orca_model_bytes(filename: str, data: bytes) -> dict:
    _enforce_file_size(len(data), label="Orca model")
    dest, rel = _import_model_for_orca(filename, data)
    container_path = _orca_container_path_for_library_file(dest)
    _open_orca_container_file(container_path)
    return {
        "ok": True,
        "filename": dest.name,
        "path": rel,
        "container_path": container_path,
        "mode": "local-docker",
    }


def _launch_desktop_orca(path: Path) -> dict:
    if not path.exists():
        raise HTTPException(status_code=404, detail="Model file was not found")
    resolved = path.resolve()
    exe = _orca_executable()
    if exe:
        args = [str(exe), str(resolved)]
        kwargs: dict = {
            "stdout": subprocess.DEVNULL,
            "stderr": subprocess.DEVNULL,
            "stdin": subprocess.DEVNULL,
            "close_fds": True,
        }
        if os.name == "nt":
            detached = getattr(subprocess, "DETACHED_PROCESS", 0)
            new_group = getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
            if detached or new_group:
                kwargs["creationflags"] = detached | new_group
        try:
            subprocess.Popen(args, **kwargs)
            return {
                "ok": True,
                "filename": resolved.name,
                "path": str(resolved),
                "executable": str(exe),
                "mode": "desktop-orca",
            }
        except OSError as exc:
            log.warning("Desktop Orca executable launch failed for %s: %s", resolved, exc)
    if os.name == "nt":
        try:
            os.startfile(str(resolved))  # type: ignore[attr-defined]
            return {
                "ok": True,
                "filename": resolved.name,
                "path": str(resolved),
                "executable": "windows-file-association",
                "mode": "desktop-file-association",
            }
        except OSError as exc:
            log.warning("Windows file association open failed for %s: %s", resolved, exc)
    raise HTTPException(status_code=404, detail="Desktop OrcaSlicer executable was not found on this machine")


def _open_desktop_orca_model_bytes(filename: str, data: bytes) -> dict:
    _enforce_file_size(len(data), label="Orca model")
    dest, rel = _import_model_for_orca(filename, data)
    result = _launch_desktop_orca(dest)
    result["path"] = rel
    return result


def _bambu_studio_executable() -> Path | None:
    candidates: list[Path] = []
    env_exe = os.environ.get("BAMBUSTUDIO_EXE", "").strip()
    if env_exe:
        candidates.append(Path(env_exe))
    if os.name == "nt":
        local_app = os.environ.get("LOCALAPPDATA")
        if local_app:
            candidates.extend([
                Path(local_app) / "Programs" / "BambuStudio" / "bambu-studio.exe",
                Path(local_app) / "Programs" / "Bambu Studio" / "bambu-studio.exe",
            ])
        for base in (os.environ.get("ProgramFiles"), os.environ.get("ProgramFiles(x86)")):
            if base:
                candidates.append(Path(base) / "Bambu Studio" / "bambu-studio.exe")
                candidates.append(Path(base) / "BambuStudio" / "bambu-studio.exe")
    else:
        candidates.extend([
            Path("/usr/bin/bambu-studio"),
            Path("/usr/local/bin/bambu-studio"),
        ])
    for path in candidates:
        if path.exists():
            return path
    found = shutil.which("bambu-studio") or shutil.which("bambu-studio.exe")
    return Path(found) if found else None


def _launch_desktop_bambu_studio(path: Path) -> dict:
    if not path.exists():
        raise HTTPException(status_code=404, detail="Model file was not found")
    resolved = path.resolve()
    exe = _bambu_studio_executable()
    if exe:
        args = [str(exe), str(resolved)]
        kwargs: dict = {
            "stdout": subprocess.DEVNULL,
            "stderr": subprocess.DEVNULL,
            "stdin": subprocess.DEVNULL,
            "close_fds": True,
        }
        if os.name == "nt":
            detached = getattr(subprocess, "DETACHED_PROCESS", 0)
            new_group = getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
            if detached or new_group:
                kwargs["creationflags"] = detached | new_group
        try:
            subprocess.Popen(args, **kwargs)
            return {
                "ok": True,
                "filename": resolved.name,
                "path": str(resolved),
                "executable": str(exe),
                "mode": "desktop-bambu",
            }
        except OSError as exc:
            log.warning("Desktop Bambu Studio executable launch failed for %s: %s", resolved, exc)
    if os.name == "nt":
        try:
            os.startfile(str(resolved))  # type: ignore[attr-defined]
            return {
                "ok": True,
                "filename": resolved.name,
                "path": str(resolved),
                "executable": "windows-file-association",
                "mode": "desktop-file-association",
            }
        except OSError as exc:
            log.warning("Windows file association open failed for %s: %s", resolved, exc)
    raise HTTPException(status_code=404, detail="Desktop Bambu Studio executable was not found on this machine")


def _open_desktop_bambu_studio_model_bytes(filename: str, data: bytes) -> dict:
    _enforce_file_size(len(data), label="Bambu model")
    dest, rel = _import_model_for_orca(filename, data)
    result = _launch_desktop_bambu_studio(dest)
    result["path"] = rel
    return result


def _suppress_orca_internal_update_prompt() -> dict:
    result = {
        "configured": False,
        "stable_only": False,
        "removed_downloads": [],
        "message": "",
    }
    config_dir = _orca_docker_config_dir()
    if not config_dir:
        result["message"] = "Orca /config mount was not found"
        return result
    pref_path = config_dir / ".config" / "OrcaSlicer" / "OrcaSlicer.conf"
    if pref_path.exists():
        try:
            payload = json.loads(pref_path.read_text(encoding="utf-8"))
            if not isinstance(payload, dict):
                payload = {}
            app_prefs = payload.get("app")
            if not isinstance(app_prefs, dict):
                app_prefs = {}
                payload["app"] = app_prefs
            if app_prefs.get("check_stable_update_only") is not True:
                app_prefs["check_stable_update_only"] = True
                pref_path.write_text(json.dumps(payload, indent=4, sort_keys=False) + "\n", encoding="utf-8")
            result["configured"] = True
            result["stable_only"] = app_prefs.get("check_stable_update_only") is True
        except Exception as exc:
            result["message"] = f"Could not update Orca preferences: {exc}"
    else:
        result["message"] = "Orca preferences file has not been created yet"

    downloads_dir = config_dir / "Downloads"
    removed: list[str] = []
    if downloads_dir.exists():
        patterns = [
            "OrcaSlicer_Windows_Installer_*beta*.exe",
            "OrcaSlicer_Windows_Installer_V2.4.0-beta.exe",
        ]
        for pattern in patterns:
            for candidate in downloads_dir.glob(pattern):
                if not candidate.is_file():
                    continue
                try:
                    candidate.unlink()
                    removed.append(candidate.name)
                except Exception as exc:
                    result["message"] = f"Could not remove {candidate.name}: {exc}"
    result["removed_downloads"] = sorted(set(removed))
    if not result["message"]:
        result["message"] = "Orca beta update prompt is suppressed"
    return result


def _orca_docker_status() -> dict:
    docker = _docker_binary()
    if not docker:
        return {
            "available": False,
            "message": "Docker command not found on this Flightdeck host",
            "containers": [],
        }
    proc = _run_docker(["version", "--format", "{{.Server.Version}}"], timeout=10, check=False)
    if proc.returncode != 0:
        detail = (proc.stderr or proc.stdout or "Docker is not responding").strip()
        return {
            "available": False,
            "message": detail,
            "containers": [],
        }
    containers = [
        _docker_container_summary(_ORCA_DOCKER_BROWSER_CONTAINER),
        _docker_container_summary(_ORCA_DOCKER_API_CONTAINER),
    ]
    prompt = _suppress_orca_internal_update_prompt() if containers[0].get("exists") else None
    return {
        "available": True,
        "version": (proc.stdout or "").strip(),
        "message": "Docker is available",
        "containers": containers,
        "orca_prompt": prompt,
    }


def _docker_restart_orca_containers(target: str = "all") -> dict:
    target = (target or "all").strip().lower()
    names = {
        "browser": [_ORCA_DOCKER_BROWSER_CONTAINER],
        "api": [_ORCA_DOCKER_API_CONTAINER],
        "all": [_ORCA_DOCKER_BROWSER_CONTAINER, _ORCA_DOCKER_API_CONTAINER],
    }.get(target)
    if not names:
        raise HTTPException(status_code=422, detail="target must be browser, api, or all")
    restarted: list[str] = []
    skipped: list[str] = []
    prompt = _suppress_orca_internal_update_prompt() if _ORCA_DOCKER_BROWSER_CONTAINER in names else None
    for name in names:
        if not _docker_inspect_container(name):
            skipped.append(name)
            continue
        _run_docker(["restart", name], timeout=90)
        restarted.append(name)
    status = _orca_docker_status()
    status.update({"ok": True, "restarted": restarted, "skipped": skipped, "orca_prompt": prompt or status.get("orca_prompt")})
    return status


def _recreate_orca_browser_container() -> dict:
    name = _ORCA_DOCKER_BROWSER_CONTAINER
    info = _docker_inspect_container(name)
    if not info:
        raise HTTPException(status_code=404, detail=f"{name} container was not found")
    config = info.get("Config") if isinstance(info.get("Config"), dict) else {}
    host_config = info.get("HostConfig") if isinstance(info.get("HostConfig"), dict) else {}
    image = str(config.get("Image") or "")
    if image != _ORCA_DOCKER_BROWSER_IMAGE:
        raise HTTPException(status_code=422, detail=f"{name} uses {image or 'an unknown image'}; managed update only supports {_ORCA_DOCKER_BROWSER_IMAGE}")

    _run_docker(["pull", _ORCA_DOCKER_BROWSER_IMAGE], timeout=900)

    env = [str(item) for item in (config.get("Env") or []) if str(item)]
    binds = [str(item) for item in (host_config.get("Binds") or []) if str(item)]
    port_bindings = host_config.get("PortBindings") if isinstance(host_config.get("PortBindings"), dict) else {}
    restart_policy = host_config.get("RestartPolicy") if isinstance(host_config.get("RestartPolicy"), dict) else {}
    restart_name = str(restart_policy.get("Name") or "").strip()
    backup_name = f"{name}-backup-{datetime.now().strftime('%Y%m%d%H%M%S')}"

    run_args = ["run", "-d", "--name", name]
    if restart_name and restart_name != "no":
        run_args.extend(["--restart", restart_name])
    for bind in binds:
        run_args.extend(["-v", bind])
    for container_port, bindings in sorted(port_bindings.items()):
        if not isinstance(bindings, list):
            continue
        for binding in bindings:
            if not isinstance(binding, dict):
                continue
            host_ip = str(binding.get("HostIp") or "").strip()
            host_port = str(binding.get("HostPort") or "").strip()
            if not host_port:
                continue
            published = f"{host_ip}:{host_port}:{container_port}" if host_ip else f"{host_port}:{container_port}"
            run_args.extend(["-p", published])
    for item in env:
        run_args.extend(["-e", item])
    run_args.append(_ORCA_DOCKER_BROWSER_IMAGE)

    _run_docker(["stop", name], timeout=90, check=False)
    _run_docker(["rename", name, backup_name], timeout=30)
    try:
        _run_docker(run_args, timeout=120)
    except HTTPException:
        _run_docker(["rm", "-f", name], timeout=30, check=False)
        _run_docker(["rename", backup_name, name], timeout=30, check=False)
        _run_docker(["start", name], timeout=60, check=False)
        raise

    # Keep one rollback container around briefly, but stop it so ports stay free.
    _run_docker(["stop", backup_name], timeout=30, check=False)
    prompt = _suppress_orca_internal_update_prompt()
    _run_docker(["restart", name], timeout=90, check=False)
    status = _orca_docker_status()
    status.update({"ok": True, "updated": name, "backup": backup_name, "orca_prompt": prompt or status.get("orca_prompt")})
    return status


@app.get("/api/slicer/orca-docker/status")
async def slicer_orca_docker_status():
    return await asyncio.to_thread(_orca_docker_status)


@app.post("/api/slicer/orca-docker/restart")
async def slicer_orca_docker_restart(body: OrcaDockerActionRequest):
    return await asyncio.to_thread(_docker_restart_orca_containers, body.target)


@app.post("/api/slicer/orca-docker/update")
async def slicer_orca_docker_update():
    return await asyncio.to_thread(_recreate_orca_browser_container)


async def _probe_slicer_api(api_url: str, *, timeout: float = 3.0) -> dict:
    base_url = (api_url or "").strip().rstrip("/")
    if not base_url:
        return {"configured": False, "ok": False, "detail": "Slicer API URL is not configured"}
    parsed = urllib.parse.urlparse(base_url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        return {"configured": True, "ok": False, "detail": "Slicer API URL must be a full http:// or https:// URL"}
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(connect=timeout, read=timeout, write=timeout, pool=timeout), follow_redirects=True) as client:
            resp = await client.get(f"{base_url}/health")
    except Exception as exc:
        return {"configured": True, "ok": False, "detail": f"Could not reach slicer API: {exc}"}
    if resp.status_code >= 400:
        return {"configured": True, "ok": False, "detail": f"Slicer API /health returned HTTP {resp.status_code}"}
    payload = None
    try:
        payload = resp.json()
    except Exception:
        payload = None
    version = ""
    if isinstance(payload, dict):
        version = str(payload.get("version") or payload.get("slicer") or payload.get("name") or "")
    detail = f"{base_url}/health OK"
    if version:
        detail += f" ({version})"
    return {"configured": True, "ok": True, "detail": detail, "payload": payload}


@app.post("/api/slicer/check")
async def check_slicer_connection(body: SlicerConnectionCheckRequest):
    kind = (body.kind or "").strip().lower()
    base_url = (body.url or "").strip().rstrip("/")
    browser_like = kind in {"browser", "bambu_browser"}
    if kind not in {"api", "worker", "browser", "bambu_browser"}:
        raise HTTPException(status_code=422, detail="kind must be api, worker, browser, or bambu_browser")
    parsed = urllib.parse.urlparse(base_url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise HTTPException(status_code=422, detail="Enter a full http:// or https:// URL")

    path = "/health" if kind == "api" else ("/api/slicer/worker/status" if kind == "worker" else "")
    target = f"{base_url}{path}"
    verify_tls = False if browser_like else True
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(connect=3.0, read=8.0, write=3.0, pool=3.0), follow_redirects=True, verify=verify_tls) as client:
            resp = await client.get(target)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Could not reach {kind} URL: {exc}") from exc
    auth_required = browser_like and resp.status_code in {401, 403}
    if resp.status_code >= 400 and not auth_required:
        raise HTTPException(status_code=resp.status_code, detail=f"{kind} URL returned HTTP {resp.status_code}")

    payload = None
    try:
        payload = resp.json()
    except Exception:
        payload = None
    version = ""
    if isinstance(payload, dict):
        version = str(payload.get("version") or payload.get("executable") or payload.get("status") or "")
    return {
        "ok": True,
        "kind": kind,
        "url": target,
        "status": resp.status_code,
        "version": version,
        "auth_required": auth_required,
    }


@app.get("/api/slicer/health")
async def slicer_health_summary():
    """Probe all configured slicer components concurrently and return a health summary."""
    settings = db.get_all_settings()
    worker_url = (settings.get("orcaslicer_worker_url") or "").strip().rstrip("/")
    browser_url = (settings.get("orcaslicer_docker_url") or "").strip().rstrip("/")
    bambu_url = (settings.get("bambustudio_docker_url") or "").strip().rstrip("/")
    api_url = (settings.get("orcaslicer_api_url") or "").strip().rstrip("/")

    async def _probe(url: str, path: str = "", *, verify: bool = True, timeout: float = 3.0) -> dict:
        if not url:
            return {"configured": False, "ok": False, "url": "", "detail": "Not configured"}
        target = url.rstrip("/") + path
        try:
            async with httpx.AsyncClient(
                timeout=httpx.Timeout(connect=timeout, read=timeout, write=timeout, pool=timeout),
                follow_redirects=True, verify=verify,
            ) as client:
                resp = await client.get(target)
        except Exception as exc:
            return {"configured": True, "ok": False, "url": url, "detail": str(exc)}
        if not verify and resp.status_code in {401, 403}:
            return {"configured": True, "ok": True, "url": url, "detail": "Reachable (sign-in required)"}
        if resp.status_code >= 400:
            return {"configured": True, "ok": False, "url": url, "detail": f"HTTP {resp.status_code}"}
        payload = None
        try:
            payload = resp.json()
        except Exception:
            pass
        version = str((payload or {}).get("version") or (payload or {}).get("executable") or "") if payload else ""
        return {"configured": True, "ok": True, "url": url, "detail": f"Reachable{f' · {version}' if version else ''}"}

    worker_r, browser_r, bambu_r, api_r = await asyncio.gather(
        _probe(worker_url, "/api/slicer/worker/status"),
        _probe(browser_url, verify=False),
        _probe(bambu_url, verify=False),
        _probe(api_url, "/health"),
    )
    configured = [r for r in (worker_r, browser_r, bambu_r, api_r) if r["configured"]]
    return {
        "worker": worker_r,
        "orca_browser": browser_r,
        "bambu_browser": bambu_r,
        "slicer_api": api_r,
        "all_ok": all(r["ok"] for r in configured),
        "any_configured": bool(configured),
    }


@app.post("/api/slicer/worker/slice")
async def slicer_worker_slice(
    file: UploadFile = File(...),
    printer_profile: str = Form(...),
    process_profile: str = Form(...),
    filament_profile: str = Form(...),
    output_kind: str = Form("gcode.3mf"),
    output_filename: str = Form("flightdeck-sliced.gcode.3mf"),
    plate: str = Form("1"),
    all_plates: bool = Form(False),
    sidecar_url: str = Form(""),
    arrange: bool = Form(False),
    bed_type: str = Form("Textured PEI Plate"),
    support_mode: str = Form("profile"),
    brim_mode: str = Form("profile"),
):
    output_kind = "gcode.3mf" if output_kind == "gcode.3mf" else "gcode"
    source_name = _safe_basename(file.filename, "flightdeck-model.stl")
    output_filename = _safe_basename(output_filename, "flightdeck-sliced.gcode.3mf")
    source_data = await _read_upload_bytes(file, label="Slicer source file")
    profiles = {
        "printer": printer_profile,
        "process": process_profile,
        "filament": filament_profile,
    }
    sidecar_url = (sidecar_url or "").strip().rstrip("/")
    # Prefer the Docker sidecar when the Pi passed a URL. Fall back to local
    # Orca if the sidecar is unreachable (unless this file truly needs it).
    use_sidecar = bool(sidecar_url)
    if use_sidecar:
        try:
            name, data, _log = await asyncio.to_thread(
                _run_orca_slice_sidecar,
                sidecar_url=sidecar_url,
                filename=source_name,
                data=source_data,
                profiles=profiles,
                output_kind=output_kind,
                output_filename=output_filename,
                plate=plate,
                all_plates=all_plates,
                arrange=arrange,
                bed_type=bed_type,
                support_mode=support_mode,
                brim_mode=brim_mode,
            )
        except HTTPException as exc:
            detail = str(exc.detail or "")
            unreachable = exc.status_code == 502 and "unreachable" in detail.lower()
            if not unreachable or _h2d_loose_mesh_requires_sidecar(source_name, profiles):
                if unreachable:
                    raise HTTPException(status_code=502, detail=_h2d_sidecar_required_message()) from exc
                raise
            log.warning("slicer sidecar unreachable on worker, falling back to local Orca: %s", detail)
            name, data, _log = await asyncio.to_thread(
                _run_orca_slice_local,
                filename=source_name,
                data=source_data,
                profiles=profiles,
                output_kind=output_kind,
                output_filename=output_filename,
                plate=plate,
                all_plates=all_plates,
                support_mode=support_mode,
                brim_mode=brim_mode,
            )
    else:
        if _h2d_loose_mesh_requires_sidecar(source_name, profiles):
            raise HTTPException(status_code=422, detail=_h2d_sidecar_required_message())
        name, data, _log = await asyncio.to_thread(
            _run_orca_slice_local,
            filename=source_name,
            data=source_data,
            profiles=profiles,
            output_kind=output_kind,
            output_filename=output_filename,
            plate=plate,
            all_plates=all_plates,
            support_mode=support_mode,
            brim_mode=brim_mode,
        )
    media = "application/octet-stream"
    return Response(
        content=data,
        media_type=media,
        headers={
            "Content-Disposition": f'attachment; filename="{name.replace(chr(34), "_")}"',
            "X-Flightdeck-Sliced-Filename": name,
        },
    )


@app.post("/api/slicer/worker/open")
async def slicer_worker_open(file: UploadFile = File(...), target: str = Form("desktop_orca")):
    source_name = _safe_basename(file.filename, "flightdeck-model.3mf")
    source_data = await _read_upload_bytes(file, label="Orca model")
    target = (target or "desktop_orca").strip().lower()
    if target in {"browser_orca", "docker_orca"}:
        return await asyncio.to_thread(_open_orca_model_bytes, source_name, source_data)
    if target in {"desktop_orca", "orca", "same"}:
        return await asyncio.to_thread(_open_desktop_orca_model_bytes, source_name, source_data)
    if target in {"bambu_studio", "desktop_bambu"}:
        return await asyncio.to_thread(_open_desktop_bambu_studio_model_bytes, source_name, source_data)
    raise HTTPException(status_code=422, detail="target must be desktop_orca, browser_orca, or bambu_studio")


@app.post("/api/slicer/worker/open-path")
async def slicer_worker_open_path(body: SlicerOpenPathRequest):
    """
    Launch desktop Orca/Bambu with an already-local Windows/UNC path.
    Used by PrintShelf so NAS files open like File → Open (no HTTP 3MF dance).
    """
    raw = (body.path or "").strip()
    if not raw:
        raise HTTPException(status_code=422, detail="path is required")
    target = (body.target or "bambu_studio").strip().lower()
    path = Path(raw)
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"Path not found on worker: {raw}")
    if target in {"bambu_studio", "desktop_bambu"}:
        result = await asyncio.to_thread(_launch_desktop_bambu_studio, path)
    elif target in {"desktop_orca", "orca", "same"}:
        result = await asyncio.to_thread(_launch_desktop_orca, path)
    else:
        raise HTTPException(status_code=422, detail="target must be desktop_orca or bambu_studio")
    if isinstance(result, dict):
        result["mode"] = result.get("mode") or "open-path"
        result["path"] = str(path)
    return result


def _shell_open_windows_path(path: Path, mode: str = "open") -> dict:
    """Open with the default app, or reveal in Explorer (Windows worker only)."""
    if os.name != "nt":
        raise HTTPException(status_code=400, detail="Shell open only runs on the Windows worker")
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"Path not found on worker: {path}")
    resolved = path.resolve() if path.exists() else path
    action = (mode or "open").strip().lower()
    if action not in {"open", "reveal"}:
        raise HTTPException(status_code=422, detail="mode must be open or reveal")
    try:
        if action == "reveal":
            # explorer /select,<path> — select file in its folder
            subprocess.Popen(
                ["explorer", f"/select,{resolved}"],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                stdin=subprocess.DEVNULL,
                close_fds=True,
                creationflags=getattr(subprocess, "DETACHED_PROCESS", 0)
                | getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0),
            )
            return {"ok": True, "path": str(resolved), "mode": "reveal"}
        os.startfile(str(resolved))  # type: ignore[attr-defined]
        return {"ok": True, "path": str(resolved), "mode": "open"}
    except OSError as exc:
        raise HTTPException(status_code=500, detail=f"Could not open path: {exc}") from exc


@app.post("/api/slicer/worker/shell-open")
async def slicer_worker_shell_open(body: ShellOpenPathRequest):
    """
    Open a file with the Windows default app (zip → Explorer/7-Zip) or reveal in Explorer.
    Used by PrintShelf card ⋮ → Open on PC.
    """
    raw = (body.path or "").strip()
    if not raw:
        raise HTTPException(status_code=422, detail="path is required")
    return await asyncio.to_thread(_shell_open_windows_path, Path(raw), body.mode or "open")


@app.post("/api/slicer/open")
async def open_file_in_orca(body: SlicerOpenRequest):
    source_id = body.source_id.strip()
    source_path = body.path.strip().lstrip("/")
    filename, data = await _read_file_desk_source(source_id, source_path)
    if body.filename.strip():
        filename = _safe_basename(body.filename, filename)
    target = (body.target or "desktop_orca").strip().lower()
    if target == "same":
        target = "desktop_orca"
    if target == "orca":
        target = "desktop_orca"
    if target not in {"desktop_orca", "browser_orca", "docker_orca", "bambu_studio"}:
        raise HTTPException(status_code=422, detail="target must be desktop_orca, browser_orca, or bambu_studio")

    settings = db.get_all_settings()
    worker_url = (settings.get("orcaslicer_worker_url") or "").strip().rstrip("/")
    local_orca = _docker_inspect_container(_ORCA_DOCKER_BROWSER_CONTAINER)
    if target == "bambu_studio" and worker_url:
        files = {"file": (filename, data, "application/octet-stream")}
        form_data = {"target": target}
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(connect=10.0, read=45.0, write=60.0, pool=10.0)) as client:
                resp = await client.post(f"{worker_url}/api/slicer/worker/open", files=files, data=form_data)
        except Exception as exc:
            detail = str(exc).strip() or "connection timed out"
            raise HTTPException(status_code=502, detail=f"Slicer worker unreachable: {detail}") from exc
        payload = resp.json() if resp.headers.get("content-type", "").startswith("application/json") else {}
        if resp.status_code >= 400:
            detail = payload.get("detail") if isinstance(payload, dict) else resp.text
            raise HTTPException(status_code=resp.status_code, detail=detail or "Slicer worker could not open desktop Bambu Studio")
        if isinstance(payload, dict):
            payload["forwarded"] = True
            payload["worker_url"] = worker_url
            return payload
        return {"ok": True, "forwarded": True, "worker_url": worker_url}

    if target == "bambu_studio":
        if source_id == "library":
            try:
                source_file = _safe_library_path(source_path)
                result = await asyncio.to_thread(_launch_desktop_bambu_studio, source_file)
                result["forwarded"] = False
                return result
            except HTTPException as exc:
                if exc.status_code != 404 or not worker_url:
                    raise
        elif _bambu_studio_executable():
            result = await asyncio.to_thread(_open_desktop_bambu_studio_model_bytes, filename, data)
            result["forwarded"] = False
            return result
        raise HTTPException(status_code=404, detail="Desktop Bambu Studio was not found here and no Windows worker is configured")

    if target == "desktop_orca" and worker_url:
        files = {"file": (filename, data, "application/octet-stream")}
        form_data = {"target": target}
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(connect=10.0, read=45.0, write=60.0, pool=10.0)) as client:
                resp = await client.post(f"{worker_url}/api/slicer/worker/open", files=files, data=form_data)
        except Exception as exc:
            detail = str(exc).strip() or "connection timed out"
            raise HTTPException(status_code=502, detail=f"Slicer worker unreachable: {detail}") from exc
        payload = resp.json() if resp.headers.get("content-type", "").startswith("application/json") else {}
        if resp.status_code >= 400:
            detail = payload.get("detail") if isinstance(payload, dict) else resp.text
            raise HTTPException(status_code=resp.status_code, detail=detail or "Slicer worker could not open desktop Orca")
        if isinstance(payload, dict):
            payload["forwarded"] = True
            payload["worker_url"] = worker_url
            return payload
        return {"ok": True, "forwarded": True, "worker_url": worker_url}

    if target == "desktop_orca":
        if source_id == "library":
            try:
                source_file = _safe_library_path(source_path)
                result = await asyncio.to_thread(_launch_desktop_orca, source_file)
                result["forwarded"] = False
                return result
            except HTTPException as exc:
                if exc.status_code != 404 or not worker_url:
                    raise
        elif _orca_executable():
            result = await asyncio.to_thread(_open_desktop_orca_model_bytes, filename, data)
            result["forwarded"] = False
            return result

    if target != "desktop_orca" and worker_url:
        files = {"file": (filename, data, "application/octet-stream")}
        form_data = {"target": target}
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(connect=10.0, read=45.0, write=60.0, pool=10.0)) as client:
                resp = await client.post(f"{worker_url}/api/slicer/worker/open", files=files, data=form_data)
        except Exception as exc:
            if local_orca:
                log.warning("Slicer worker unreachable for browser open; falling back to local Orca container: %s", exc)
            else:
                detail = str(exc).strip() or "connection timed out"
                raise HTTPException(status_code=502, detail=f"Slicer worker unreachable: {detail}") from exc
        else:
            payload = resp.json() if resp.headers.get("content-type", "").startswith("application/json") else {}
            if resp.status_code < 400:
                if isinstance(payload, dict):
                    payload["forwarded"] = True
                    payload["worker_url"] = worker_url
                    return payload
                return {"ok": True, "forwarded": True, "worker_url": worker_url}
            if not local_orca:
                detail = payload.get("detail") if isinstance(payload, dict) else resp.text
                raise HTTPException(status_code=resp.status_code, detail=detail or "Slicer worker could not open Orca")
            log.warning("Slicer worker could not open Orca; falling back to local Orca container: %s", payload or resp.text)

    if target in {"browser_orca", "docker_orca"} and source_id == "library" and local_orca:
        source_file = _safe_library_path(source_path)
        container_path = _orca_container_path_for_library_file(source_file)
        await asyncio.to_thread(_open_orca_container_file, container_path)
        return {
            "ok": True,
            "filename": source_file.name,
            "path": source_file.relative_to(_print_library_path().resolve()).as_posix(),
            "container_path": container_path,
            "mode": "local-docker",
            "forwarded": False,
        }
    if target == "desktop_orca":
        raise HTTPException(status_code=404, detail="Desktop OrcaSlicer was not found here and no Windows worker is configured")
    result = await asyncio.to_thread(_open_orca_model_bytes, filename, data)
    result["forwarded"] = False
    return result


async def _slice_model_to_bytes(
    *,
    filename: str,
    data: bytes,
    printer_id: str,
    output_filename: str,
    all_plates: bool = False,
    plate: str = "1",
    bed_type: str = "Textured PEI Plate",
    support_mode: str = "profile",
    brim_mode: str = "profile",
) -> tuple[str, bytes, dict, dict]:
    """Slice a source model. Returns (sliced_name, sliced_data, profiles, slice_options)."""
    target_kind = _printer_kind(printer_id)
    if target_kind is None:
        raise HTTPException(status_code=404, detail="Target printer not found")
    settings = db.get_all_settings()
    profiles = {
        "printer": (settings.get(_slicer_profile_key(printer_id, "printer"), "") or "").strip(),
        "process": (settings.get(_slicer_profile_key(printer_id, "process"), "") or "").strip(),
        "filament": (settings.get(_slicer_profile_key(printer_id, "filament"), "") or "").strip(),
    }
    missing_profiles = [label for label, value in profiles.items() if not str(value or "").strip()]
    if missing_profiles:
        raise HTTPException(status_code=422, detail=f"Set slicer defaults for {', '.join(missing_profiles)} first")

    output_kind = "gcode.3mf" if target_kind == "bambu" else "gcode"
    worker_url = (settings.get("orcaslicer_worker_url") or "").strip().rstrip("/")
    sidecar_url = (settings.get("orcaslicer_api_url") or "").strip().rstrip("/")
    target = _printer_meta(printer_id) or {}
    target_name = " ".join(
        str(v or "") for v in ((target or {}).get("model_name"), (target or {}).get("custom_name"), profiles["printer"])
    )
    arrange = target_kind == "bambu" and ("h2d" in target_name.lower() or filename.lower().endswith(".3mf"))
    slice_options = _slice_option_summary(bed_type, support_mode, brim_mode)
    h2d_loose_mesh = _h2d_loose_mesh_requires_sidecar(filename, profiles)
    if h2d_loose_mesh and not sidecar_url:
        raise HTTPException(status_code=422, detail=_h2d_sidecar_required_message())
    if filename.lower().endswith(".3mf") and not filename.lower().endswith(".gcode.3mf"):
        data = slice_meta.sanitize_3mf_cli_sentinels(data)

    sliced_name = output_filename
    sliced_data = b""
    slicer_use_api = str(settings.get("slicer_use_api") or "").strip().lower() in {"1", "true", "yes", "on"}
    # H2D STL/OBJ always needs the sidecar. Other files use it when Settings → Use Slicer API is on.
    worker_sidecar = sidecar_url if sidecar_url and (h2d_loose_mesh or slicer_use_api) else ""
    if worker_url:
        form = {
            "printer_profile": profiles["printer"],
            "process_profile": profiles["process"],
            "filament_profile": profiles["filament"],
            "output_kind": output_kind,
            "output_filename": output_filename,
            "plate": plate or "1",
            "all_plates": str(bool(all_plates)).lower(),
            "sidecar_url": worker_sidecar,
            "arrange": str(bool(arrange)).lower(),
            "bed_type": slice_options["bed_type"],
            "support_mode": slice_options["support_mode"],
            "brim_mode": slice_options["brim_mode"],
        }
        files = {"file": (filename, data, "application/octet-stream")}
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(connect=15.0, read=900.0, write=180.0, pool=15.0)) as client:
                resp = await client.post(f"{worker_url}/api/slicer/worker/slice", data=form, files=files)
        except Exception as exc:
            detail = str(exc).strip() or "connection timed out"
            raise HTTPException(
                status_code=502,
                detail=f"Windows slicer worker unreachable ({worker_url}): {detail}",
            ) from exc
        if resp.status_code >= 400:
            try:
                detail = resp.json().get("detail")
            except Exception:
                detail = resp.text
            raise HTTPException(status_code=resp.status_code, detail=detail or "Slicer worker failed")
        sliced_name = resp.headers.get("X-Flightdeck-Sliced-Filename") or output_filename
        sliced_data = resp.content
        _enforce_file_size(len(sliced_data), label="Sliced output")
    elif sidecar_url:
        sliced_name, sliced_data, _log = await asyncio.to_thread(
            _run_orca_slice_sidecar,
            sidecar_url=sidecar_url,
            filename=filename,
            data=data,
            profiles=profiles,
            output_kind=output_kind,
            output_filename=output_filename,
            plate=plate or "1",
            all_plates=bool(all_plates),
            arrange=arrange,
            bed_type=slice_options["bed_type"],
            support_mode=slice_options["support_mode"],
            brim_mode=slice_options["brim_mode"],
        )
    else:
        sliced_name, sliced_data, _log = await asyncio.to_thread(
            _run_orca_slice_local,
            filename=filename,
            data=data,
            profiles=profiles,
            output_kind=output_kind,
            output_filename=output_filename,
            plate=plate or "1",
            all_plates=bool(all_plates),
            support_mode=slice_options["support_mode"],
            brim_mode=slice_options["brim_mode"],
        )
    _enforce_file_size(len(sliced_data), label="Sliced output")
    # Sidecar often returns a generic result.3mf — keep the printable .gcode.3mf name.
    return output_filename, sliced_data, profiles, slice_options


@app.post("/api/slicer/run")
async def run_slice_from_file_desk(body: SliceRunRequest):
    printer_id = body.printer_id.strip()
    source_id = body.source_id.strip()
    source_path = body.path.strip().lstrip("/")
    target_kind = _printer_kind(printer_id)
    if target_kind is None:
        raise HTTPException(status_code=404, detail="Target printer not found")
    filename, data = await _read_file_desk_source(source_id, source_path)
    ext = _queue_file_extension(filename)
    if filename.lower().endswith(".gcode.3mf") or ext not in _SOURCE_MODEL_EXT:
        raise HTTPException(status_code=422, detail="Only source model files can be sliced")

    output_kind = "gcode.3mf" if target_kind == "bambu" else "gcode"
    output_ext = ".gcode.3mf" if output_kind == "gcode.3mf" else ".gcode"
    base_name = _file_archive_key(filename) or "sliced_model"
    output_filename = (body.output_filename or f"{base_name}_{printer_id}{output_ext}").strip()
    sliced_name, sliced_data, profiles, slice_options = await _slice_model_to_bytes(
        filename=filename,
        data=data,
        printer_id=printer_id,
        output_filename=output_filename,
        all_plates=bool(body.all_plates),
        plate=body.plate or "1",
        bed_type=body.bed_type,
        support_mode=body.support_mode,
        brim_mode=body.brim_mode,
    )

    library_root = _print_library_path().resolve()
    library_root.mkdir(parents=True, exist_ok=True)
    dest = _unique_library_destination(library_root, sliced_name or output_filename)
    dest.write_bytes(sliced_data)
    stat = dest.stat()
    output_path = dest.relative_to(library_root).as_posix()
    feature_counts = _slicer_output_feature_counts(sliced_data, dest.name)
    preview_url = None
    if dest.name.lower().endswith(".gcode.3mf") or _queue_file_extension(dest.name) == ".3mf":
        preview_url = "/api/files/source/preview?" + urllib.parse.urlencode({
            "source_id": "library",
            "path": output_path,
            "view": "top",
        })
    db.log_decision(printer_id, "slicer_run", json.dumps({
        "source": filename,
        "output": dest.name,
        "profiles": profiles,
        "slice_options": slice_options,
    }))
    return {
        "ok": True,
        "filename": dest.name,
        "path": output_path,
        "kind": _file_kind(dest.name),
        "size": stat.st_size,
        "printer_id": printer_id,
        "preview_url": preview_url,
        "profiles": profiles,
        "slice_options": slice_options,
        "feature_counts": feature_counts,
    }


@app.delete("/api/files")
async def delete_file_from_file_desk(body: FileDeskDeleteRequest):
    source_id = body.source_id.strip()
    source_path = body.path.strip().lstrip("/")
    if body.confirm.strip().upper() != "DELETE":
        raise HTTPException(status_code=422, detail="Type DELETE to confirm")
    if not source_path:
        raise HTTPException(status_code=422, detail="File path required")
    filename = source_path.rsplit("/", 1)[-1].rsplit("\\", 1)[-1]
    ext = _queue_file_extension(filename)
    if ext not in (_ALLOWED_BAMBU_EXT | _ALLOWED_MOONRAKER_EXT | _SOURCE_MODEL_EXT):
        raise HTTPException(status_code=422, detail="Unsupported file type")

    if source_id == "library":
        _safe_library_path(source_path).unlink()
    else:
        bambu = _find_bambu(source_id)
        if bambu:
            from .printers.bambu_ftp import delete_bambu_file
            await asyncio.to_thread(delete_bambu_file, bambu._ip, bambu._access_code, source_path)
        else:
            mr_url = _find_moonraker_url(source_id)
            if not mr_url:
                raise HTTPException(status_code=404, detail="Source not found")
            await _delete_moonraker_file(mr_url, source_path)
    return {"ok": True, "deleted": source_path}


@app.post("/api/files/bambu/{printer_id}/clear")
async def clear_bambu_sd_print_files(printer_id: str, body: BambuSdClearRequest):
    if body.confirm.strip().upper() != "CLEAR":
        raise HTTPException(status_code=422, detail="Type CLEAR to confirm")
    printer = _find_bambu(printer_id)
    if not printer:
        raise HTTPException(status_code=404, detail="Bambu printer not found")
    state = (_latest_printers.get(printer_id) or {}).get("state")
    if state in ("printing", "paused"):
        raise HTTPException(status_code=409, detail="Cannot clear SD while printer has an active print")
    from .printers.bambu_ftp import clear_bambu_print_files
    result = await asyncio.to_thread(clear_bambu_print_files, printer._ip, printer._access_code)
    db.log_decision(printer_id, "bambu_sd_cleared", f"Deleted {len(result.get('deleted', []))} print files")
    return {"ok": True, **result}



@app.get("/api/printers")
async def get_printers():
    cached = _cached_printers(max_age_seconds=12.0)
    if cached is not None:
        return cached
    stale = _stale_printers()
    if stale is not None:
        # Refresh in background; don't stall the UI behind a hung printer.
        if _gather_lock is None or not _gather_lock.locked():
            asyncio.create_task(_gather_all())
        return stale
    try:
        return await asyncio.wait_for(_gather_all(), timeout=5.0)
    except asyncio.TimeoutError:
        log.warning("get_printers: gather timed out")
        return _stale_printers() or []


@app.get("/api/printers/bed-sizes")
async def get_printer_bed_sizes():
    cfg = load()
    return [
        {
            "id": entry.id,
            "model_name": entry.model_name,
            "custom_name": entry.custom_name,
            "build_volume": entry.build_volume,
        }
        for entry in cfg.printers
    ]


@app.get("/api/printers/{printer_id}")
async def get_printer(printer_id: str):
    for (id, model_name, custom_name, icon, url, kind, toolhead_count) in _moonraker:
        if id == printer_id:
            return asdict(await moonraker.fetch(id, model_name, custom_name, icon, url, kind=kind, toolhead_count=toolhead_count))

    for p in _bambu:
        if p.id == printer_id:
            return asdict(await asyncio.to_thread(p.status))

    for (id, model_name, custom_name, icon, profile, scenario) in _simulated:
        if id == printer_id:
            return asdict(simulated.status(id, model_name, custom_name, icon, profile, scenario))

    raise HTTPException(status_code=404, detail="printer not found")


@app.get("/api/printers/{printer_id}/slots/{slot}/memory")
async def get_printer_slot_memory(printer_id: str, slot: int):
    spool_id = db.get_recent_spool_for_slot(printer_id, int(slot))
    spool = db.get_spool(spool_id) if spool_id else None
    return {"spool_id": spool_id, "spool": spool}


@app.get("/api/printers/{printer_id}/bambu/mqtt")
async def get_bambu_mqtt_debug(printer_id: str):
    printer = _find_bambu(printer_id)
    if not printer:
        raise HTTPException(status_code=404, detail="Bambu printer not found")
    try:
        payload = await asyncio.to_thread(printer.mqtt_debug_snapshot)
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Could not read Bambu MQTT snapshot: {exc}") from exc
    return _diagnostic_redact_value("", payload)


@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket):
    await ws.accept()
    _ws_clients.add(ws)
    try:
        data = await _gather_all_with_cache()
        await ws.send_text(json.dumps(data, default=_dt_default))
    except Exception:
        pass
    try:
        while True:
            try:
                await asyncio.wait_for(ws.receive_text(), timeout=30)
            except asyncio.TimeoutError:
                continue
    except Exception:
        pass
    finally:
        _ws_clients.discard(ws)


@app.get("/api/printers/{printer_id}/preview", response_model=PrintPreview)
async def get_printer_preview(printer_id: str):
    for (id, model_name, custom_name, icon, url, kind, toolhead_count) in _moonraker:
        if id == printer_id:
            status = await moonraker.fetch(id, model_name, custom_name, icon, url, kind=kind, toolhead_count=toolhead_count)
            if not status.job:
                raise HTTPException(status_code=404, detail="no active job")

            # Fetch static thumbnail in parallel — needed for fallback or static-only
            preview = await moonraker.fetch_preview(url, status.job.filename)
            thumb_url = f"/api/printers/{printer_id}/thumbnail" if preview and preview.image_png else None
            elapsed = int(status.job.progress * (preview.estimated_total_seconds or 0)) if preview else None

            camera = _cameras.get(printer_id)
            if isinstance(camera, MjpegDirectCamera) and _camera_active(status):
                return PrintPreview(
                    image_url=camera.stream_url,
                    image_type="mjpeg",
                    fallback_thumbnail_url=thumb_url,
                    filename=status.job.filename,
                    estimated_total_seconds=preview.estimated_total_seconds if preview else None,
                    elapsed_seconds=elapsed,
                    layer_height_mm=preview.layer_height_mm if preview else None,
                    filament_weight_g=preview.filament_weight_g if preview else None,
                    filament_type=preview.filament_type if preview else None,
                )
            if isinstance(camera, AdaptiveCamera) and _camera_active(status):
                return PrintPreview(
                    image_url=f"/api/camera/{printer_id}/stream",
                    image_type="mjpeg",
                    fallback_thumbnail_url=thumb_url,
                    filename=status.job.filename,
                    estimated_total_seconds=preview.estimated_total_seconds if preview else None,
                    elapsed_seconds=elapsed,
                    layer_height_mm=preview.layer_height_mm if preview else None,
                    filament_weight_g=preview.filament_weight_g if preview else None,
                    filament_type=preview.filament_type if preview else None,
                )

            if preview is None:
                raise HTTPException(status_code=404, detail="preview unavailable")
            return PrintPreview(
                image_url=thumb_url,
                image_type="static",
                filename=status.job.filename,
                estimated_total_seconds=preview.estimated_total_seconds,
                elapsed_seconds=elapsed,
                layer_height_mm=preview.layer_height_mm,
                filament_weight_g=preview.filament_weight_g,
                filament_type=preview.filament_type,
            )

    for p in _bambu:
        if p.id == printer_id:
            status = await asyncio.to_thread(p.status)
            if not status.job:
                raise HTTPException(status_code=404, detail="no active job")

            camera = _cameras.get(printer_id)
            preview = await asyncio.to_thread(p.get_preview)
            thumb_url = f"/api/printers/{printer_id}/thumbnail" if preview else None
            elapsed = int(status.job.progress * (preview.estimated_total_seconds or 0)) if preview else None

            if isinstance(camera, BambuRtspCamera) and _camera_active(status):
                return PrintPreview(
                    image_url=f"/api/camera/{printer_id}/stream",
                    image_type="mjpeg",
                    fallback_thumbnail_url=thumb_url,
                    filename=status.job.subtask_name or status.job.filename,
                    estimated_total_seconds=preview.estimated_total_seconds if preview else None,
                    elapsed_seconds=elapsed,
                    filament_weight_g=preview.filament_weight_g if preview else None,
                    filament_type=preview.filament_type if preview else None,
                )

            if preview is None:
                # No FTP thumbnail — fall back to camera stream if one exists
                if isinstance(camera, BambuRtspCamera):
                    return PrintPreview(
                        image_url=f"/api/camera/{printer_id}/stream",
                        image_type="mjpeg",
                        fallback_thumbnail_url=None,
                        filename=status.job.subtask_name or status.job.filename,
                    )
                raise HTTPException(status_code=404, detail="preview unavailable")
            return PrintPreview(
                image_url=thumb_url,
                image_type="static",
                filename=status.job.subtask_name or status.job.filename,
                estimated_total_seconds=preview.estimated_total_seconds,
                elapsed_seconds=elapsed,
                filament_weight_g=preview.filament_weight_g,
                filament_type=preview.filament_type,
            )

    for (id, model_name, custom_name, icon, profile, scenario) in _simulated:
        if id == printer_id:
            status = simulated.status(id, model_name, custom_name, icon, profile, scenario)
            if not status.job:
                raise HTTPException(status_code=404, detail="no active job")
            estimated = 16200
            elapsed = int(status.job.progress * estimated)
            return PrintPreview(
                image_url=f"/api/printers/{printer_id}/thumbnail",
                image_type="static",
                filename=status.job.subtask_name or status.job.filename,
                estimated_total_seconds=estimated,
                elapsed_seconds=elapsed,
                filament_weight_g=86.5,
                filament_type="PETG" if profile == "prusalink" else "PLA+" if profile == "ideaformer" else "PLA",
            )

    raise HTTPException(status_code=404, detail="printer not found")


def _camera_active(status) -> bool:
    """Return True when live camera is the right thing to show."""
    if status.state in ("printing", "paused", "error"):
        return True
    if status.state == "finished":
        hotend = status.temps.get("hotend")
        return (hotend.actual if hotend else 0) > 50
    return False


_VALID_ACTIONS = {"pause", "resume", "cancel", "estop", "firmware_restart", "light_on", "light_off"}


class ControlRequest(BaseModel):
    action: str


class CalibrationRequest(BaseModel):
    bed_leveling: bool = True
    vibration: bool = True
    motor_noise: bool = True
    nozzle_offset: bool = False
    high_temp_heatbed: bool = False


class QueueCalibrateRequest(BaseModel):
    calibrate_before_start: bool


class QueueAllowShortFilamentRequest(BaseModel):
    allow_short_filament: bool


class SetTempRequest(BaseModel):
    heater: str
    target: int


class FanRequest(BaseModel):
    speed: int
    channel: str = "part"


class JogZRequest(BaseModel):
    distance: float


class JogRequest(BaseModel):
    axis: str
    distance: float
    speed: int | None = None


class HomeRequest(BaseModel):
    axes: str


class AmsDryRequest(BaseModel):
    enabled: bool
    filament: str = "PLA"
    temp: int = 45
    duration: int = 12
    rotate_tray: bool = False


class AmsFilamentActionRequest(BaseModel):
    slot: int | None = None


@app.post("/api/printers/{printer_id}/set-temp")
async def set_printer_temp(printer_id: str, req: SetTempRequest):
    heater = req.heater
    command_heater = "hotend" if heater in ("hotend_l", "hotend_r") else heater
    if command_heater not in ("hotend", "bed", "chamber"):
        raise HTTPException(status_code=400, detail="invalid heater")
    if not (0 <= req.target <= 350):
        raise HTTPException(status_code=400, detail="target out of range (0-350)")

    for (id, model_name, custom_name, icon, url, _kind, _toolhead_count) in _moonraker:
        if id == printer_id:
            try:
                await moonraker.set_temp(url, command_heater, req.target)
            except Exception as exc:
                raise HTTPException(status_code=502, detail=str(exc))
            return {"ok": True}

    for p in _bambu:
        if p.id == printer_id:
            await asyncio.to_thread(p.set_temp, command_heater, req.target)
            return {"ok": True}

    for (id, *_) in _simulated:
        if id == printer_id:
            raise HTTPException(status_code=422, detail="simulated printer does not accept hardware temperature commands")

    raise HTTPException(status_code=404, detail="printer not found")


@app.post("/api/printers/{printer_id}/fan")
async def set_printer_fan(printer_id: str, req: FanRequest):
    if not (0 <= req.speed <= 100):
        raise HTTPException(status_code=400, detail="fan speed out of range (0-100)")
    channel = req.channel.lower().strip()
    if channel not in ("part", "aux", "chamber"):
        raise HTTPException(status_code=400, detail="invalid fan channel")

    for (id, model_name, custom_name, icon, url, _kind, _toolhead_count) in _moonraker:
        if id == printer_id:
            if channel != "part":
                raise HTTPException(status_code=422, detail="Klipper fan control only supports the part fan from Flightdeck")
            try:
                await moonraker.set_fan(url, req.speed)
            except Exception as exc:
                raise HTTPException(status_code=502, detail=str(exc))
            return {"ok": True}

    for p in _bambu:
        if p.id == printer_id:
            try:
                await asyncio.to_thread(p.set_fan, channel, req.speed)
            except Exception as exc:
                raise HTTPException(status_code=502, detail=str(exc))
            return {"ok": True}

    for (id, *_) in _simulated:
        if id == printer_id:
            raise HTTPException(status_code=422, detail="simulated printer does not accept hardware fan commands")

    raise HTTPException(status_code=404, detail="printer not found")


@app.post("/api/printers/{printer_id}/jog-z")
async def jog_printer_z(printer_id: str, req: JogZRequest):
    if abs(req.distance) < 0.01:
        raise HTTPException(status_code=400, detail="distance must be non-zero")
    if not (-10 <= req.distance <= 10):
        raise HTTPException(status_code=400, detail="Z jog out of range (-10 to 10mm)")

    for (id, model_name, custom_name, icon, url, _kind, _toolhead_count) in _moonraker:
        if id == printer_id:
            try:
                await moonraker.jog_z(url, req.distance)
            except Exception as exc:
                raise HTTPException(status_code=502, detail=str(exc))
            return {"ok": True}

    for p in _bambu:
        if p.id == printer_id:
            raise HTTPException(status_code=422, detail="Z jog is only available for Klipper/Moonraker printers")

    for (id, *_) in _simulated:
        if id == printer_id:
            raise HTTPException(status_code=422, detail="simulated printer does not accept hardware movement commands")

    raise HTTPException(status_code=404, detail="printer not found")


@app.post("/api/printers/{printer_id}/jog")
async def jog_printer_axis(printer_id: str, req: JogRequest):
    axis = req.axis.lower().strip()
    if axis not in ("x", "y", "z"):
        raise HTTPException(status_code=400, detail="invalid jog axis")
    if abs(req.distance) < 0.01:
        raise HTTPException(status_code=400, detail="distance must be non-zero")
    limit = 50 if axis in ("x", "y") else 10
    if not (-limit <= req.distance <= limit):
        raise HTTPException(status_code=400, detail=f"{axis.upper()} jog out of range (-{limit} to {limit}mm)")
    if req.speed is not None and not (60 <= req.speed <= 6000):
        raise HTTPException(status_code=400, detail="jog speed out of range (60-6000mm/min)")

    for (id, model_name, custom_name, icon, url, _kind, _toolhead_count) in _moonraker:
        if id == printer_id:
            try:
                await moonraker.jog_axis(url, axis, req.distance, req.speed)
            except Exception as exc:
                raise HTTPException(status_code=502, detail=str(exc))
            return {"ok": True}

    for p in _bambu:
        if p.id == printer_id:
            try:
                await asyncio.to_thread(p.jog_axis, axis, req.distance, req.speed)
            except Exception as exc:
                raise HTTPException(status_code=502, detail=str(exc))
            return {"ok": True}

    for (id, *_) in _simulated:
        if id == printer_id:
            raise HTTPException(status_code=422, detail="simulated printer does not accept hardware movement commands")

    raise HTTPException(status_code=404, detail="printer not found")


@app.post("/api/printers/{printer_id}/home")
async def home_printer_axes(printer_id: str, req: HomeRequest):
    axes = req.axes.lower().strip()
    if axes not in ("xy", "z", "all"):
        raise HTTPException(status_code=400, detail="invalid home axes")

    for (id, model_name, custom_name, icon, url, _kind, _toolhead_count) in _moonraker:
        if id == printer_id:
            try:
                await moonraker.home_axes(url, axes)
            except Exception as exc:
                raise HTTPException(status_code=502, detail=str(exc))
            return {"ok": True}

    for p in _bambu:
        if p.id == printer_id:
            if axes != "all":
                raise HTTPException(status_code=422, detail="Bambu homing only supports Home All from Flightdeck")
            try:
                await asyncio.to_thread(p.home_all)
            except Exception as exc:
                raise HTTPException(status_code=502, detail=str(exc))
            return {"ok": True}

    for (id, *_) in _simulated:
        if id == printer_id:
            raise HTTPException(status_code=422, detail="simulated printer does not accept hardware movement commands")

    raise HTTPException(status_code=404, detail="printer not found")


@app.post("/api/printers/{printer_id}/control")
async def control_printer(printer_id: str, req: ControlRequest):
    if req.action not in _VALID_ACTIONS:
        raise HTTPException(status_code=400, detail="invalid action")

    for (id, model_name, custom_name, icon, url, _kind, _toolhead_count) in _moonraker:
        if id == printer_id:
            try:
                await moonraker.control(url, req.action)
            except Exception as exc:
                raise HTTPException(status_code=502, detail=str(exc))
            return {"ok": True}

    for p in _bambu:
        if p.id == printer_id:
            if req.action == "firmware_restart":
                raise HTTPException(status_code=422, detail="firmware_restart not supported for this printer")
            fn = getattr(p, req.action)
            await asyncio.to_thread(fn)
            return {"ok": True}

    for (id, *_) in _simulated:
        if id == printer_id:
            raise HTTPException(status_code=422, detail="simulated printer does not accept hardware control commands")

    raise HTTPException(status_code=404, detail="printer not found")


def _bambu_printer(printer_id: str) -> Optional[BambuPrinter]:
    for p in _bambu:
        if p.id == printer_id:
            return p
    return None


def _default_calibration_options(printer_status: Optional[dict]) -> dict[str, bool]:
    h2 = _is_h2_printer_status(printer_status)
    return {
        "bed_leveling": True,
        "vibration": True,
        "motor_noise": True,
        "nozzle_offset": h2,
        "high_temp_heatbed": False,
    }


_CALIBRATION_IDLE_STATES = {"idle", "ready", "standby", "finished"}
_CALIBRATION_SUBSTAGES = {
    1, 3, 8, 9, 12, 18, 19, 25, 36, 37, 38, 39, 40, 47, 48,
}


def _is_calibration_substage(substage: object) -> bool:
    if substage is None:
        return False
    try:
        return int(substage) in _CALIBRATION_SUBSTAGES
    except (TypeError, ValueError):
        text = str(substage).lower()
        return "calibrat" in text or "bed level" in text or "vibration" in text


def _printer_idle_for_calibration(status: Optional[dict]) -> bool:
    return str((status or {}).get("state") or "").lower() in _CALIBRATION_IDLE_STATES


def _calibration_option_summary(options: dict[str, bool]) -> str:
    labels = []
    if options.get("bed_leveling"):
        labels.append("bed")
    if options.get("vibration"):
        labels.append("vibration")
    if options.get("motor_noise"):
        labels.append("motor noise")
    if options.get("nozzle_offset"):
        labels.append("nozzle offset")
    if options.get("high_temp_heatbed"):
        labels.append("high-temp bed")
    return ", ".join(labels) or "calibration"


async def _begin_bambu_calibration(
    printer_id: str,
    *,
    options: Optional[dict[str, bool]] = None,
    pending_job_id: Optional[int] = None,
    notify: bool = True,
) -> None:
    if printer_id in _calibration_sessions:
        raise HTTPException(status_code=409, detail="Calibration already running on this printer")
    p = _bambu_printer(printer_id)
    if not p:
        raise HTTPException(status_code=404, detail="Bambu printer not found")
    statuses = await _printer_status_map()
    status = statuses.get(printer_id)
    if not _printer_idle_for_calibration(status):
        raise HTTPException(
            status_code=409,
            detail=f"Printer is {status.get('state') if status else 'unknown'}; wait until idle before calibrating",
        )
    opts = options or _default_calibration_options(status)
    if not any(opts.values()):
        raise HTTPException(status_code=422, detail="Select at least one calibration option")
    try:
        await asyncio.to_thread(p.start_calibration, **opts)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    _calibration_sessions[printer_id] = {
        "started_at": time.monotonic(),
        "pending_job_id": pending_job_id,
        "options": opts,
        "active": False,
    }
    summary = _calibration_option_summary(opts)
    db.log_decision(
        printer_id,
        "calibration_start",
        summary + (f" before job #{pending_job_id}" if pending_job_id else ""),
        print_id=None,
    )
    name = (status or {}).get("custom_name") or printer_id
    if notify:
        detail = f"{name} · {summary}"
        if pending_job_id:
            job = db.queue_get(pending_job_id)
            if job:
                detail += f" · then {job['filename']}"
        _notify("info", "Calibration started", detail, printer_id=printer_id, link=f"#/printer/{printer_id}/live")
        asyncio.create_task(_send_ntfy("Calibration started", detail, ["gear"]))


async def _finish_bambu_calibration(printer_id: str) -> None:
    session = _calibration_sessions.pop(printer_id, None)
    if not session:
        return
    statuses = await _printer_status_map()
    status = statuses.get(printer_id) or {}
    name = status.get("custom_name") or printer_id
    summary = _calibration_option_summary(session.get("options") or {})
    db.log_decision(printer_id, "calibration_complete", summary)
    job_id = session.get("pending_job_id")
    if job_id:
        job = db.queue_get(job_id)
        job_name = job["filename"] if job else f"job #{job_id}"
        msg = f"{name} calibrated · starting {job_name} next"
        _notify("success", "Calibration complete", msg, printer_id=printer_id, link="#/queue")
        asyncio.create_task(_send_ntfy("Calibration complete", msg, ["white_check_mark"]))
        if job and job["status"] == "pending":
            asyncio.create_task(_advance_queue_specific(
                job_id, printer_id, job["filename"], job["file_path"],
            ))
    else:
        msg = f"{name} · {summary}"
        _notify("success", "Calibration complete", msg, printer_id=printer_id, link=f"#/printer/{printer_id}/live")
        asyncio.create_task(_send_ntfy("Calibration complete", msg, ["white_check_mark"]))


def _check_calibration_sessions(data: list[dict]) -> None:
    now = time.monotonic()
    for p in data:
        pid = p["id"]
        session = _calibration_sessions.get(pid)
        if not session:
            continue
        state = str(p.get("state") or "").lower()
        substage = p.get("substage")
        if state in {"printing", "paused"}:
            if _is_calibration_substage(substage) or not session.get("active"):
                session["active"] = True
            continue
        if session.get("active") and state in _CALIBRATION_IDLE_STATES:
            asyncio.create_task(_finish_bambu_calibration(pid))
        elif not session.get("active") and now - float(session.get("started_at") or now) > 120:
            _calibration_sessions.pop(pid, None)
            db.log_decision(pid, "calibration_timeout", "Calibration did not start within 120s")
        elif now - float(session.get("started_at") or now) > 3600:
            _calibration_sessions.pop(pid, None)


async def _maybe_calibrate_before_queue(printer_id: str, job: dict) -> bool:
    """Start calibration for a queued job. Returns True if dispatch should wait."""
    if not bool(job.get("calibrate_before_start")):
        return False
    if _bambu_printer(printer_id) is None:
        return False
    if printer_id in _calibration_sessions:
        return True
    try:
        await _begin_bambu_calibration(
            printer_id,
            pending_job_id=int(job["id"]),
            notify=True,
        )
    except HTTPException as exc:
        detail = exc.detail if isinstance(exc.detail, str) else str(exc.detail)
        db.log_decision(printer_id, "calibration_blocked", f"Job #{job['id']}: {detail}")
        log.warning("queue calibration blocked on %s job #%s: %s", printer_id, job["id"], detail)
    return True


@app.post("/api/printers/{printer_id}/calibration")
async def start_printer_calibration(printer_id: str, req: CalibrationRequest):
    await _begin_bambu_calibration(
        printer_id,
        options=req.model_dump(),
        notify=True,
    )
    return {"ok": True}


@app.get("/api/printers/{printer_id}/calibration/defaults")
async def printer_calibration_defaults(printer_id: str):
    statuses = await _printer_status_map()
    status = statuses.get(printer_id)
    if not status:
        raise HTTPException(status_code=404, detail="printer not found")
    if _bambu_printer(printer_id) is None:
        raise HTTPException(status_code=422, detail="Calibration is only available for Bambu printers")
    return _default_calibration_options(status)


@app.post("/api/printers/{printer_id}/ams/unload")
async def unload_ams_filament(printer_id: str, req: AmsFilamentActionRequest):
    for p in _bambu:
        if p.id != printer_id:
            continue
        try:
            ok = await asyncio.to_thread(p.unload_ams_filament, req.slot)
        except Exception as exc:
            raise HTTPException(status_code=502, detail=str(exc))
        slot_note = f" slot={req.slot}" if req.slot is not None else ""
        db.log_decision(printer_id, "ams_unload_requested", f"AMS unload requested{slot_note}")
        return {"ok": bool(ok)}

    raise HTTPException(status_code=404, detail="Bambu printer not found")


@app.post("/api/printers/{printer_id}/ams/load")
async def load_ams_filament(printer_id: str, req: AmsFilamentActionRequest):
    for p in _bambu:
        if p.id != printer_id:
            continue
        try:
            ok = await asyncio.to_thread(p.load_ams_filament, req.slot)
        except Exception as exc:
            raise HTTPException(status_code=502, detail=str(exc))
        slot_note = f" slot={req.slot}" if req.slot is not None else ""
        db.log_decision(printer_id, "ams_load_requested", f"AMS load requested{slot_note}")
        return {"ok": bool(ok)}

    raise HTTPException(status_code=404, detail="Bambu printer not found")


@app.post("/api/printers/{printer_id}/ams/{ams_id}/dry")
async def control_ams_drying(printer_id: str, ams_id: int, req: AmsDryRequest):
    reason_messages = {
        0: "Printer is busy",
        1: "Insufficient power; connect an external AMS power adapter or stop other AMS drying",
        2: "AMS is busy",
        3: "Filament is at the AMS outlet; retract/unload it first",
        4: "AMS is already starting a drying cycle",
        5: "Drying is not supported in the current mode",
        6: "AMS is already drying",
        7: "AMS firmware is upgrading",
        8: "Plug in the external AMS power adapter to start drying",
    }
    for p in _bambu:
        if p.id != printer_id:
            continue
        if req.enabled:
            status = _latest_printers.get(printer_id)
            target_ams = None
            for unit in (status or {}).get("ams") or []:
                if int(unit.get("unit", -1)) == int(ams_id):
                    target_ams = unit
                    break
            if target_ams:
                for reason in target_ams.get("dry_sf_reason") or []:
                    msg = reason_messages.get(int(reason))
                    if msg:
                        raise HTTPException(status_code=409, detail=msg)
        try:
            ok = await asyncio.to_thread(
                p.set_ams_drying,
                ams_id,
                req.enabled,
                filament=req.filament,
                temp=req.temp,
                duration=req.duration,
                rotate_tray=req.rotate_tray,
            )
        except Exception as exc:
            raise HTTPException(status_code=502, detail=str(exc))
        action = "ams_drying_started" if req.enabled else "ams_drying_stopped"
        db.log_decision(printer_id, action, f"AMS {ams_id} {req.filament} temp={req.temp} duration={req.duration}h")
        return {"ok": bool(ok)}

    raise HTTPException(status_code=404, detail="Bambu printer not found")


@app.get("/api/printers/{printer_id}/camera")
async def get_printer_camera(printer_id: str):
    """Return camera stream URL for the given printer, regardless of print state."""
    if _simulated_entry(printer_id):
        return {
            "url": f"/api/camera/{printer_id}/simulated.svg",
            "type": "simulated",
            "fleet_url": f"/api/camera/{printer_id}/simulated.svg",
            "fleet_refresh_ms": 4000,
            "rotation": 0,
        }
    camera = _cameras.get(printer_id)
    if camera is None:
        raise HTTPException(status_code=404, detail="no camera configured")
    if isinstance(camera, MjpegDirectCamera):
        return {
            "url": f"/api/camera/{printer_id}/stream",
            "type": "mjpeg",
            "snapshot_url": camera.snapshot_url,
            "fleet_url": f"/api/camera/{printer_id}/snapshot",
            "fleet_refresh_ms": 3500,
            "rotation": camera.rotation,
        }
    if isinstance(camera, AdaptiveCamera):
        fps = _adaptive_camera_fps(camera, printer_id)
        return {
            "url": f"/api/camera/{printer_id}/stream",
            "type": "mjpeg",
            "snapshot_url": camera.snapshot_url,
            "active_fps": camera.active_fps,
            "idle_fps": camera.idle_fps,
            "refresh_ms": max(100, int(1000 / fps)),
            "fleet_url": f"/api/camera/{printer_id}/snapshot",
            "fleet_refresh_ms": max(1000, int(1000 / fps)),
            "rotation": camera.rotation,
        }
    if isinstance(camera, WebrtcCamera):
        return {
            "url": camera.stream_url,
            "type": "webrtc",
            "snapshot_url": camera.snapshot_url,
            "fleet_url": f"/api/camera/{printer_id}/snapshot" if camera.snapshot_url else None,
            "fleet_refresh_ms": 3500,
            "rotation": camera.rotation,
        }
    if isinstance(camera, BambuRtspCamera):
        return {
            "url": f"/api/camera/{printer_id}/stream",
            "type": "mjpeg",
            "fleet_url": f"/api/camera/{printer_id}/snapshot",
            "fleet_refresh_ms": 3500,
            "rotation": camera.rotation,
        }
    raise HTTPException(status_code=404, detail="unknown camera type")


@app.get("/api/camera/{printer_id}/snapshot")
async def camera_snapshot(printer_id: str):
    camera = _cameras.get(printer_id)
    try:
        if isinstance(camera, (AdaptiveCamera, WebrtcCamera)) and camera.snapshot_url:
            content, content_type = await asyncio.to_thread(_fetch_http_image_sync, camera.snapshot_url, 5.0)
            return Response(content=content, media_type=content_type, headers={
                "Cache-Control": "no-cache, no-store, must-revalidate",
                "Pragma": "no-cache",
                "Expires": "0",
            })
        if isinstance(camera, MjpegDirectCamera):
            if camera.snapshot_url:
                content, content_type = await asyncio.to_thread(_fetch_http_image_sync, camera.snapshot_url, 5.0)
            else:
                content, content_type = await asyncio.to_thread(_fetch_mjpeg_frame_sync, camera.stream_url)
            return Response(content=content, media_type=content_type, headers={
                "Cache-Control": "no-cache, no-store, must-revalidate",
                "Pragma": "no-cache",
                "Expires": "0",
            })

        if isinstance(camera, BambuRtspCamera):
            content = await _grab_snapshot(printer_id)
            if content:
                return Response(content=content, media_type="image/jpeg", headers={
                    "Cache-Control": "no-cache, no-store, must-revalidate",
                    "Pragma": "no-cache",
                    "Expires": "0",
                })
            return _camera_unavailable_response(printer_id)
    except Exception as exc:
        log.warning("camera snapshot failed for %s: %s", printer_id, exc)
        return _camera_unavailable_response(printer_id)

    if _simulated_entry(printer_id):
        return await simulated_camera(printer_id)
    raise HTTPException(status_code=404, detail="snapshot not configured")


def _simulated_camera_svg(printer_id: str, model_name: str, custom_name: str, icon: str, profile: str, scenario: str) -> str:
    status = simulated.status(printer_id, model_name, custom_name, icon, profile, scenario)
    job = status.job
    progress = int((job.progress if job else 0) * 100)
    state = status.state.upper()
    hotend = status.temps.get("hotend")
    bed = status.temps.get("bed")
    material = "PLA+" if profile == "ideaformer" else "PETG" if profile == "prusalink" else "PLA"
    accent = {
        "prusalink": "#f97316",
        "reprap": "#22c55e",
        "octoprint": "#38bdf8",
        "ideaformer": "#eab308",
    }.get(profile, "#60a5fa")
    name = html_escape(custom_name or model_name or printer_id)
    model = html_escape(model_name or printer_id)
    filename = html_escape(job.filename if job else status.idle_info.get("Last print", "Ready"))
    hot_text = f"{hotend.actual:.0f}/{hotend.target:.0f}C" if hotend else "--"
    bed_text = f"{bed.actual:.0f}/{bed.target:.0f}C" if bed else "--"
    is_belt = profile == "ideaformer"
    belt_marks = "".join(
        f'<path d="M {80 + i * 82} 560 l42 -28" stroke="#334155" stroke-width="6" stroke-linecap="round"/>'
        for i in range(10)
    )
    bed_shape = (
        f'<g class="belt-bed"><rect x="70" y="500" width="980" height="105" rx="10" fill="#111827" stroke="#334155" stroke-width="3"/>{belt_marks}</g>'
        if is_belt
        else '<g><rect x="160" y="500" width="760" height="110" rx="10" fill="#111827" stroke="#334155" stroke-width="3"/><path d="M190 530h700M190 565h700M190 600h700" stroke="#1f2937" stroke-width="2"/></g>'
    )
    part_shape = (
        '<g class="print-part"><path d="M480 490 h210 l40 72 h-270 z" fill="#94a3b8" opacity="0.92"/><path d="M505 512h160M518 536h176" stroke="#cbd5e1" stroke-width="4" opacity="0.45"/></g>'
        if job
        else '<g opacity="0.34"><rect x="500" y="500" width="160" height="54" rx="8" fill="#475569"/></g>'
    )
    nozzle_x = 520 + (int(datetime.now(timezone.utc).timestamp()) % 140)
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1120 630">
  <style>
    @keyframes scan {{ 0% {{ transform: translateX(-80px); }} 100% {{ transform: translateX(150px); }} }}
    @keyframes belt {{ 0% {{ transform: translateX(0); }} 100% {{ transform: translateX(-82px); }} }}
    @keyframes blink {{ 0%, 100% {{ opacity: 0.35; }} 50% {{ opacity: 1; }} }}
    @keyframes glow {{ 0%,100% {{ opacity: 0.72; }} 50% {{ opacity: 1; }} }}
    .gantry {{ animation: scan 4.2s ease-in-out infinite alternate; transform-origin: center; }}
    .belt-bed {{ animation: belt 3.4s linear infinite; }}
    .print-part {{ animation: glow 2.2s ease-in-out infinite; }}
    .status-dot {{ animation: blink 1.4s ease-in-out infinite; }}
    text {{ font-family: Inter, Segoe UI, Arial, sans-serif; }}
  </style>
  <rect width="1120" height="630" fill="#05070d"/>
  <rect x="24" y="22" width="1068" height="586" rx="20" fill="#0b1120" stroke="#1e3a5f" stroke-width="3"/>
  <rect x="58" y="82" width="1004" height="500" rx="16" fill="#070b14" stroke="#1f2937"/>
  <path d="M120 475 h880" stroke="#243244" stroke-width="14" stroke-linecap="round"/>
  {bed_shape}
  <g class="gantry">
    <path d="M250 185 h690" stroke="#475569" stroke-width="16" stroke-linecap="round"/>
    <path d="M{nozzle_x} 190 v250" stroke="#64748b" stroke-width="10" stroke-linecap="round"/>
    <path d="M{nozzle_x - 36} 414 h72 l-20 52 h-32 z" fill="{accent}" stroke="#fde68a" stroke-width="3"/>
    <circle cx="{nozzle_x}" cy="472" r="9" fill="#fef3c7"/>
  </g>
  {part_shape}
  <rect x="58" y="82" width="1004" height="52" rx="16" fill="#020617" opacity="0.78"/>
  <text x="82" y="116" fill="#dbeafe" font-size="24" font-weight="800">{name}</text>
  <text x="82" y="150" fill="#7f98bc" font-size="15">{model} simulated camera</text>
  <circle class="status-dot" cx="980" cy="108" r="9" fill="{accent}"/>
  <text x="1000" y="115" fill="#e2e8f0" font-size="18" font-weight="800">{state}</text>
  <rect x="82" y="526" width="360" height="44" rx="9" fill="#020617" opacity="0.74"/>
  <text x="102" y="554" fill="#e2e8f0" font-size="17" font-weight="700">{filename}</text>
  <rect x="760" y="526" width="260" height="44" rx="9" fill="#020617" opacity="0.74"/>
  <text x="780" y="554" fill="#cbd5e1" font-size="17">Hotend {hot_text}  Bed {bed_text}</text>
  <rect x="82" y="582" width="936" height="9" rx="4.5" fill="#111827"/>
  <rect x="82" y="582" width="{max(10, int(936 * progress / 100))}" height="9" rx="4.5" fill="{accent}"/>
  <text x="1030" y="592" fill="#cbd5e1" font-size="16" text-anchor="end">{progress}% · {material}</text>
</svg>'''


@app.get("/api/camera/{printer_id}/simulated.svg")
async def simulated_camera(printer_id: str):
    entry = _simulated_entry(printer_id)
    if not entry:
        raise HTTPException(status_code=404, detail="simulated printer not found")
    svg = _simulated_camera_svg(*entry)
    return Response(
        content=svg,
        media_type="image/svg+xml",
        headers=_camera_stream_headers(),
    )


def _camera_stream_headers() -> dict:
    return {
        "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
        "Pragma": "no-cache",
        "Expires": "0",
        "X-Accel-Buffering": "no",
    }


async def _mjpeg_direct_response(url: str) -> StreamingResponse:
    timeout = httpx.Timeout(connect=5.0, read=None, write=5.0, pool=None)
    client = httpx.AsyncClient(timeout=timeout, follow_redirects=True)
    try:
        request = client.build_request("GET", url)
        upstream = await client.send(request, stream=True)
        upstream.raise_for_status()
    except Exception:
        await client.aclose()
        raise

    async def chunks():
        try:
            async for chunk in upstream.aiter_bytes():
                if chunk:
                    yield chunk
        finally:
            await upstream.aclose()
            await client.aclose()

    content_type = upstream.headers.get("content-type", "multipart/x-mixed-replace")
    return StreamingResponse(
        chunks(),
        media_type=content_type,
        headers=_camera_stream_headers(),
    )


def _adaptive_camera_fps(camera: AdaptiveCamera, printer_id: str) -> float:
    """Poll the snapshot URL fast while printing and slowly while idle."""
    status = _latest_printers.get(printer_id) or {}
    active = str(status.get("state") or "").lower() in {"printing", "paused", "error", "finished"}
    raw = camera.active_fps if active else camera.idle_fps
    try:
        return max(0.05, min(float(raw or 0), 10.0))
    except (TypeError, ValueError):
        return 1.0


def _fetch_adaptive_snapshot_sync(url: str) -> tuple[bytes, str]:
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    request = urllib.request.Request(
        url,
        headers={
            "Cache-Control": "no-cache",
            "Pragma": "no-cache",
            "User-Agent": "Flightdeck adaptive camera",
        },
    )
    with opener.open(request, timeout=8) as response:
        content_type = (response.headers.get("content-type") or "image/jpeg").split(";", 1)[0] or "image/jpeg"
        return response.read(), content_type


async def _adaptive_camera_response(camera: AdaptiveCamera, printer_id: str) -> StreamingResponse:
    """Turn a snapshot-only camera into an MJPEG stream whose rate follows the printer state."""

    def cache_busted_url(url: str) -> str:
        sep = "&" if "?" in url else "?"
        return f"{url}{sep}_fd_ts={int(time.time() * 1000)}"

    async def fetch_snapshot() -> tuple[Optional[bytes], str]:
        content, content_type = await asyncio.to_thread(_fetch_adaptive_snapshot_sync, cache_busted_url(camera.snapshot_url))
        if not content:
            return None, "image/jpeg"
        return content, content_type

    def frame_bytes(frame: bytes, content_type: str) -> bytes:
        return (
            b"--frame\r\n"
            + f"Content-Type: {content_type}\r\n".encode()
            + b"Content-Length: " + str(len(frame)).encode() + b"\r\n\r\n"
            + frame + b"\r\n"
        )

    first_frame: Optional[bytes] = None
    first_content_type = "image/jpeg"
    try:
        first_frame, first_content_type = await fetch_snapshot()
    except Exception as exc:
        log.warning("adaptive camera initial snapshot failed for %s: %s", printer_id, exc)

    async def chunks():
        last_frame = first_frame
        last_content_type = first_content_type
        if last_frame:
            yield frame_bytes(last_frame, last_content_type)
        while True:
            fps = _adaptive_camera_fps(camera, printer_id)
            try:
                frame, content_type = await fetch_snapshot()
                if frame:
                    last_frame = frame
                    last_content_type = content_type
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                log.debug("adaptive camera snapshot failed for %s: %s", printer_id, exc)
            if last_frame:
                yield frame_bytes(last_frame, last_content_type)
            await asyncio.sleep(1.0 / fps)

    return StreamingResponse(
        chunks(),
        media_type="multipart/x-mixed-replace; boundary=frame",
        headers=_camera_stream_headers(),
    )


@app.get("/api/camera/{printer_id}/health")
async def camera_health(printer_id: str):
    proxy = _cam_proxies.get(printer_id)
    if proxy is None:
        raise HTTPException(status_code=404, detail="no camera configured")
    return proxy.health()


@app.get("/api/camera/{printer_id}/stream")
async def camera_stream(printer_id: str):
    camera = _cameras.get(printer_id)
    if isinstance(camera, MjpegDirectCamera):
        return await _mjpeg_direct_response(camera.stream_url)
    if isinstance(camera, AdaptiveCamera):
        return await _adaptive_camera_response(camera, printer_id)

    proxy = _cam_proxies.get(printer_id)
    if proxy is None:
        raise HTTPException(status_code=404, detail="no camera configured")
    return StreamingResponse(
        proxy.stream(),
        media_type="multipart/x-mixed-replace; boundary=frame",
        headers=_camera_stream_headers(),
    )


@app.get("/api/printers/{printer_id}/prints/{print_id}/snapshot")
async def get_failure_snapshot(printer_id: str, print_id: int):
    _assert_printer(printer_id)
    jpeg = db.get_print_snapshot(print_id)
    if not jpeg:
        raise HTTPException(status_code=404, detail="no snapshot")
    return Response(
        content=jpeg,
        media_type="image/jpeg",
        headers={"Cache-Control": "public, max-age=31536000, immutable"},
    )


@app.get("/api/printers/{printer_id}/prints/{print_id}/decisions")
async def get_print_decisions(printer_id: str, print_id: int):
    _assert_printer(printer_id)
    return db.get_decisions(print_id)


class NotesRequest(BaseModel):
    notes: str = ""


class PrintMemoryMetadataRequest(BaseModel):
    tags: Optional[list[str]] = None
    exclude_from_stats: Optional[bool] = None


class MaintenanceRequest(BaseModel):
    title: str
    notes: Optional[str] = None
    due_at: Optional[str] = None
    interval_days: Optional[int] = None
    interval_prints: Optional[int] = None
    interval_hours: Optional[float] = None


@app.patch("/api/printers/{printer_id}/prints/{print_id}/notes")
async def update_print_notes(printer_id: str, print_id: int, body: NotesRequest):
    _assert_printer(printer_id)
    found = db.update_print_notes(print_id, body.notes)
    if not found:
        raise HTTPException(status_code=404, detail="print not found")
    return {"ok": True}


@app.get("/api/printers/{printer_id}/prints/latest-finished")
async def get_latest_finished(printer_id: str):
    _assert_printer(printer_id)
    print_id = db.get_latest_finished_print_id(printer_id)
    if print_id is None:
        raise HTTPException(status_code=404, detail="no finished prints")
    return {"print_id": print_id}


@app.get("/api/printers/{printer_id}/history/calendar")
async def get_history_calendar(printer_id: str, year: int | None = None):
    from datetime import datetime as _dt
    _assert_printer(printer_id)
    if year is None:
        year = _dt.utcnow().year
    return db.get_history_calendar(printer_id, year)


@app.get("/api/printers/{printer_id}/history/day/{date}")
async def get_history_day(printer_id: str, date: str):
    import re
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", date):
        raise HTTPException(status_code=400, detail="date must be YYYY-MM-DD")
    _assert_printer(printer_id)
    return [_enrich_print_timelapse_meta(item) for item in db.get_prints_for_day(printer_id, date)]


@app.get("/api/print-memory")
async def get_print_memory(
    limit: int = 120,
    printer_id: Optional[str] = None,
    state: Optional[str] = None,
    material: Optional[str] = None,
    tag: Optional[str] = None,
    q: Optional[str] = None,
    days: Optional[int] = None,
):
    return {
        "items": db.get_print_memory(
            limit=limit,
            printer_id=printer_id or None,
            state=state or None,
            material=material or None,
            tag=tag or None,
            query=q or None,
            days=days,
        ),
        "facets": db.get_print_memory_facets(),
    }


@app.get("/api/print-memory/{print_id}")
async def get_print_memory_detail(print_id: int):
    item = db.get_print_by_id(print_id)
    if not item:
        raise HTTPException(status_code=404, detail="print not found")
    return item


@app.post("/api/print-memory/{print_id}/repair-filament")
async def repair_print_memory_filament(print_id: int):
    result = db.repair_print_filament_metadata(print_id)
    if not result:
        raise HTTPException(status_code=404, detail="print not found")
    if result.get("error") == "already_has_metadata":
        raise HTTPException(status_code=409, detail="Print already has filament metadata")
    if result.get("error") == "metadata_not_found":
        raise HTTPException(
            status_code=404,
            detail="No filament metadata found on relay logs or printer storage. Assign manually.",
        )
    item = db.get_print_by_id(print_id)
    return {"ok": True, "print": item, **result}


@app.get("/api/print-memory-score")
async def get_print_memory_score(days: Optional[int] = None):
    return db.get_print_memory_score(days=days)


@app.patch("/api/print-memory/{print_id}")
async def update_print_memory_metadata(print_id: int, body: PrintMemoryMetadataRequest):
    item = db.update_print_memory_metadata(
        print_id,
        tags=body.tags,
        exclude_from_stats=body.exclude_from_stats,
    )
    if not item:
        raise HTTPException(status_code=404, detail="print not found")
    return item


@app.get("/api/printers/usage")
async def get_printer_usage():
    return db.get_printer_usage_summary()


@app.get("/api/failures")
async def get_failures(days: int = 90):
    return db.get_failure_review(days)


def _clean_maintenance(body: MaintenanceRequest) -> dict:
    title = body.title.strip()
    if not title:
        raise HTTPException(status_code=422, detail="title is required")
    if body.due_at and not re.fullmatch(r"\d{4}-\d{2}-\d{2}", body.due_at):
        raise HTTPException(status_code=422, detail="due_at must be YYYY-MM-DD")
    return {
        "title": title,
        "notes": body.notes.strip() if body.notes else None,
        "due_at": body.due_at or None,
        "interval_days": body.interval_days if body.interval_days and body.interval_days > 0 else None,
        "interval_prints": body.interval_prints if body.interval_prints and body.interval_prints > 0 else None,
        "interval_hours": body.interval_hours if body.interval_hours and body.interval_hours > 0 else None,
    }


@app.get("/api/printers/{printer_id}/maintenance")
async def get_maintenance(printer_id: str, include_archived: bool = False):
    _assert_printer(printer_id)
    return db.get_maintenance_items(printer_id, include_archived=include_archived)


@app.post("/api/printers/{printer_id}/maintenance", status_code=201)
async def create_maintenance(printer_id: str, body: MaintenanceRequest):
    _assert_printer(printer_id)
    item_id = db.create_maintenance_item(printer_id, **_clean_maintenance(body))
    return {"ok": True, "id": item_id}


@app.put("/api/printers/{printer_id}/maintenance/{item_id}")
async def update_maintenance(printer_id: str, item_id: int, body: MaintenanceRequest):
    _assert_printer(printer_id)
    if not db.update_maintenance_item(item_id, printer_id, **_clean_maintenance(body)):
        raise HTTPException(status_code=404, detail="maintenance item not found")
    return {"ok": True}


@app.post("/api/printers/{printer_id}/maintenance/{item_id}/complete")
async def complete_maintenance(printer_id: str, item_id: int):
    _assert_printer(printer_id)
    if not db.complete_maintenance_item(item_id, printer_id):
        raise HTTPException(status_code=404, detail="maintenance item not found")
    return {"ok": True}


@app.delete("/api/printers/{printer_id}/maintenance/{item_id}")
async def delete_maintenance(printer_id: str, item_id: int):
    _assert_printer(printer_id)
    if not db.archive_maintenance_item(item_id, printer_id):
        raise HTTPException(status_code=404, detail="maintenance item not found")
    return {"ok": True}


def _assert_printer(printer_id: str) -> None:
    for (id, *_) in _moonraker:
        if id == printer_id:
            return
    for p in _bambu:
        if p.id == printer_id:
            return
    for (id, *_) in _simulated:
        if id == printer_id:
            return
    raise HTTPException(status_code=404, detail="printer not found")


class ExcludeObjectRequest(BaseModel):
    name: str
    id: Optional[int] = None


@app.get("/api/printers/{printer_id}/objects")
async def get_printer_objects(printer_id: str):
    for (id, model_name, custom_name, icon, url, _kind, _toolhead_count) in _moonraker:
        if id == printer_id:
            data = await moonraker.fetch_objects(url)
            return {
                **data,
                "mode": "klipper_exclude_object",
                "label": "Klipper exclude object",
                "detail": "Klipper excludes objects by object name.",
            }
    for p in _bambu:
        if p.id == printer_id:
            return await asyncio.to_thread(p.get_objects)
    for (id, *_) in _simulated:
        if id == printer_id:
            return {"objects": [], "simulated": True}
    raise HTTPException(status_code=404, detail="printer not found")


@app.get("/api/config/printers")
async def get_config_printers():
    cfg = load()
    return [e.model_dump(mode="json", exclude_none=True) for e in cfg.printers]


class PrinterScanRequest(BaseModel):
    cidr: Optional[str] = None


def _local_lan_cidr() -> str:
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
            sock.settimeout(0.2)
            sock.connect(("8.8.8.8", 80))
            ip = sock.getsockname()[0]
    except Exception:
        try:
            ip = socket.gethostbyname(socket.gethostname())
        except Exception:
            ip = "192.168.1.1"
    return str(ipaddress.ip_network(f"{ip}/24", strict=False))


def _scan_network_from_request(cidr: Optional[str]) -> ipaddress.IPv4Network:
    raw = (cidr or "").strip() or _local_lan_cidr()
    try:
        network = ipaddress.ip_network(raw, strict=False)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=f"Invalid CIDR: {raw}") from exc
    if network.version != 4:
        raise HTTPException(status_code=422, detail="LAN scan currently supports IPv4 networks only")
    if network.num_addresses > 256:
        raise HTTPException(status_code=422, detail="Scan range is capped at /24 or smaller")
    return network


async def _tcp_port_open(host: str, port: int, timeout: float = 0.45) -> bool:
    try:
        reader, writer = await asyncio.wait_for(asyncio.open_connection(host, port), timeout=timeout)
        writer.close()
        try:
            await writer.wait_closed()
        except Exception:
            pass
        return True
    except Exception:
        return False


def _printer_scan_id(name: str, host: str) -> str:
    base = re.sub(r"[^a-z0-9_-]+", "_", (name or "").lower()).strip("_")
    if not base or not re.match(r"^[a-z]", base):
        base = f"printer_{host.split('.')[-1]}"
    return base[:40]


def _ipv4_sort_key(host: str) -> int:
    try:
        return int(ipaddress.ip_address(host))
    except ValueError:
        return 0


def _guess_moonraker_model(hostname: str, info: dict) -> tuple[str, str, str]:
    text = " ".join(str(v) for v in [hostname, info.get("software_version"), info.get("hostname"), info.get("klipper_path")] if v).lower()
    if "snapmaker" in text or re.search(r"\bu1\b", text):
        return ("snapmaker_u1", "Snapmaker U1", "Snapmaker U1")
    if "voron" in text:
        return ("voron", "Voron 2.4 350", "Voron")
    return ("moonraker", "Custom Moonraker", "Moonraker")


_BAMBU_SSDP_ADDR = "239.255.255.250"
_BAMBU_SSDP_PORT = 2021
_BAMBU_SSDP_TARGET = "urn:bambulab-com:device:3dprinter:1"
_BAMBU_SSDP_MSEARCH = (
    "M-SEARCH * HTTP/1.1\r\n"
    f"HOST: {_BAMBU_SSDP_ADDR}:{_BAMBU_SSDP_PORT}\r\n"
    'MAN: "ssdp:discover"\r\n'
    "MX: 2\r\n"
    f"ST: {_BAMBU_SSDP_TARGET}\r\n"
    "\r\n"
)


def _parse_bambu_ssdp_response(message: str, host: str) -> Optional[dict]:
    if _BAMBU_SSDP_TARGET not in message and "bambulab" not in message.lower():
        return None
    serial_match = re.search(r"USN:\s*(?:uuid:)?([^\s\r\n]+)", message, re.IGNORECASE)
    serial = serial_match.group(1).strip() if serial_match else ""
    name_match = re.search(r"DevName\.bambu\.com:\s*(.+?)(?:\r\n|\n|$)", message, re.IGNORECASE)
    model_match = re.search(r"DevModel\.bambu\.com:\s*(.+?)(?:\r\n|\n|$)", message, re.IGNORECASE)
    if not model_match:
        model_match = re.search(r"NT:\s*urn:bambulab-com:device:([^:]+)", message, re.IGNORECASE)
    model = model_match.group(1).strip() if model_match else ""
    name = name_match.group(1).strip() if name_match else ""
    if not (serial or name or model):
        return None
    return {
        "host": host,
        "serial": serial,
        "name": name or serial,
        "model": model,
    }


async def _scan_bambu_ssdp(duration: float = 2.6) -> dict[str, dict]:
    """Best-effort Bambu SSDP metadata discovery.

    Bambu exposes serial/model/name through local SSDP on UDP 2021. It does not
    expose the LAN access code; that remains a user-entered secret.
    """
    found: dict[str, dict] = {}

    def run() -> dict[str, dict]:
        sock = None
        try:
            sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM, socket.IPPROTO_UDP)
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
            try:
                sock.setsockopt(socket.IPPROTO_IP, socket.IP_MULTICAST_TTL, 2)
            except OSError:
                pass
            sock.settimeout(0.15)
            sock.bind(("", 0))
            try:
                mreq = struct.pack("4sl", socket.inet_aton(_BAMBU_SSDP_ADDR), socket.INADDR_ANY)
                sock.setsockopt(socket.IPPROTO_IP, socket.IP_ADD_MEMBERSHIP, mreq)
            except OSError:
                pass
            deadline = time.monotonic() + max(0.5, duration)
            last_send = 0.0
            while time.monotonic() < deadline:
                now = time.monotonic()
                if now - last_send > 0.8:
                    try:
                        sock.sendto(_BAMBU_SSDP_MSEARCH.encode("utf-8"), (_BAMBU_SSDP_ADDR, _BAMBU_SSDP_PORT))
                    except OSError:
                        pass
                    last_send = now
                try:
                    data, addr = sock.recvfrom(4096)
                except socket.timeout:
                    continue
                except OSError:
                    break
                parsed = _parse_bambu_ssdp_response(data.decode("utf-8", errors="ignore"), addr[0])
                if parsed:
                    found[addr[0]] = parsed
            return found
        finally:
            if sock:
                try:
                    sock.close()
                except OSError:
                    pass

    return await asyncio.to_thread(run)


async def _probe_printer_host(host: str, existing_hosts: set[str], existing_serials: set[str], bambu_ssdp: dict[str, dict]) -> Optional[dict]:
    async with httpx.AsyncClient(timeout=httpx.Timeout(connect=0.6, read=0.8, write=0.6, pool=0.6)) as client:
        try:
            r = await client.get(f"http://{host}:7125/server/info")
            if r.status_code == 200:
                info = r.json() if r.content else {}
                family, model, label = _guess_moonraker_model(str(info.get("hostname") or ""), info if isinstance(info, dict) else {})
                cam_stream = f"http://{host}/webcam/stream.mjpg" if family == "snapmaker_u1" else f"http://{host}/webcam/?action=stream"
                cam_snapshot = f"http://{host}/webcam/snapshot.jpg" if family == "snapmaker_u1" else f"http://{host}/webcam/?action=snapshot"
                return {
                    "host": host,
                    "port": 7125,
                    "family": family,
                    "connection_type": "snapmaker_u1" if family == "snapmaker_u1" else "moonraker",
                    "model_name": model,
                    "custom_name": str(info.get("hostname") or label),
                    "suggested_id": _printer_scan_id(str(info.get("hostname") or label), host),
                    "camera_type": "mjpeg_direct",
                    "stream_url": cam_stream,
                    "snapshot_url": cam_snapshot,
                    "confidence": "high",
                    "reason": "Moonraker API responded on port 7125",
                    "already_configured": host in existing_hosts,
                }
        except Exception:
            pass

    bambu_info = bambu_ssdp.get(host) or {}
    if bambu_info or await _tcp_port_open(host, 8883):
        model = str(bambu_info.get("model") or "H2D").strip()
        name = str(bambu_info.get("name") or f"Bambu {host.split('.')[-1]}").strip()
        serial = str(bambu_info.get("serial") or "").strip()
        return {
            "host": host,
            "family": "bambu",
            "connection_type": "bambu",
            "model_name": model,
            "custom_name": name,
            "suggested_id": _printer_scan_id(name or "bambu", host),
            "serial": serial,
            "confidence": "high" if serial else "medium",
            "reason": "Bambu SSDP advertised serial/model; access code still required" if serial else "Bambu LAN MQTT port 8883 is open; access code and serial still required",
            "already_configured": host in existing_hosts or (serial and serial in existing_serials),
        }
    return None


@app.post("/api/config/printers/scan")
async def scan_config_printers(payload: PrinterScanRequest):
    network = _scan_network_from_request(payload.cidr)
    cfg = load()
    existing_hosts = {
        str(getattr(entry.connection, "host", "")).strip()
        for entry in cfg.printers
        if str(getattr(entry.connection, "host", "")).strip()
    }
    existing_serials = {
        str(getattr(entry.connection, "serial", "")).strip()
        for entry in cfg.printers
        if str(getattr(entry.connection, "serial", "")).strip()
    }
    hosts = [str(ip) for ip in network.hosts()]
    bambu_ssdp = await _scan_bambu_ssdp()
    sem = asyncio.Semaphore(64)

    async def bounded(host: str) -> Optional[dict]:
        async with sem:
            return await _probe_printer_host(host, existing_hosts, existing_serials, bambu_ssdp)

    found = [row for row in await asyncio.gather(*(bounded(host) for host in hosts)) if row]
    found.sort(key=lambda row: (row.get("already_configured", False), row.get("family") != "bambu", _ipv4_sort_key(row.get("host", ""))))
    return {
        "ok": True,
        "cidr": str(network),
        "scanned": len(hosts),
        "found": found,
    }


@app.post("/api/config/printers", status_code=201)
async def add_printer(entry: PrinterEntry):
    if not re.match(r"^[a-z][a-z0-9_-]*$", entry.id):
        raise HTTPException(status_code=422, detail="id must be lowercase letters/digits/underscores/hyphens, starting with a letter")

    all_ids = [id for (id, *_) in _moonraker] + [p.id for p in _bambu] + [id for (id, *_) in _simulated]
    if entry.id in all_ids:
        raise HTTPException(status_code=409, detail=f"printer id '{entry.id}' already exists")

    conn = entry.connection
    _cameras[entry.id] = entry.camera
    _presets[entry.id] = entry.temperature_presets or {}

    if isinstance(conn, (MoonrakerConnection, SnapmakerU1Connection)):
        _moonraker.append(_moonraker_runtime_entry(entry, conn))
    elif isinstance(conn, BambuConnection):
        p = BambuPrinter(
            id=entry.id,
            model_name=entry.model_name,
            custom_name=entry.custom_name,
            icon=entry.icon_key(),
            ip=conn.host,
            access_code=conn.access_code,
            serial=conn.serial,
        )
        await asyncio.to_thread(p.start)
        _bambu.append(p)
        if isinstance(entry.camera, BambuRtspCamera):
            rtsp_url = f"rtsps://bblp:{conn.access_code}@{conn.host}:322/streaming/live/1"
            _cam_proxies[entry.id] = BambuCameraProxy(rtsp_url, entry.id)
    elif isinstance(conn, SimulatedConnection):
        _simulated.append((
            entry.id,
            entry.model_name,
            entry.custom_name,
            entry.icon_key(),
            conn.profile,
            conn.scenario,
        ))

    cfg = load()
    cfg.printers.append(entry)
    save(cfg)

    return {"ok": True}


@app.put("/api/config/printers/{printer_id}")
async def update_printer(printer_id: str, entry: PrinterEntry):
    if entry.id != printer_id:
        raise HTTPException(status_code=422, detail="printer id cannot be changed; add a new printer if this is a different machine")

    cfg = load()
    old_entry = next((p for p in cfg.printers if p.id == printer_id), None)
    if old_entry is None:
        raise HTTPException(status_code=404, detail="printer not found")

    await _detach_runtime_printer(printer_id)
    await _attach_runtime_printer(entry)

    cfg.printers = [entry if p.id == printer_id else p for p in cfg.printers]
    save(cfg)
    _latest_printers.pop(printer_id, None)

    db.log_decision(printer_id, "printer_config_updated", "Printer connection/details edited")
    return {"ok": True}


@app.delete("/api/config/printers/{printer_id}")
async def remove_printer(printer_id: str):
    found = await _detach_runtime_printer(printer_id)

    if not found:
        raise HTTPException(status_code=404, detail="printer not found")

    _prev_states.pop(printer_id, None)
    _latest_printers.pop(printer_id, None)
    db.clear_notifications_for_printer(printer_id)

    cfg = load()
    cfg.printers = [e for e in cfg.printers if e.id != printer_id]
    save(cfg)

    return {"ok": True}


async def _detach_runtime_printer(printer_id: str) -> bool:
    found = False

    for item in list(_moonraker):
        if item[0] == printer_id:
            _moonraker.remove(item)
            found = True
            break
    for p in list(_bambu):
        if p.id == printer_id:
            _bambu.remove(p)
            try:
                await asyncio.wait_for(asyncio.to_thread(p.stop), timeout=5)
            except asyncio.TimeoutError:
                pass
            proxy = _cam_proxies.pop(printer_id, None)
            if proxy:
                await proxy.stop()
            found = True
            break
    for item in list(_simulated):
        if item[0] == printer_id:
            _simulated.remove(item)
            found = True
            break

    _cameras.pop(printer_id, None)
    _presets.pop(printer_id, None)
    _cam_proxies.pop(printer_id, None)
    return found


async def _attach_runtime_printer(entry: PrinterEntry) -> None:
    conn = entry.connection
    _cameras[entry.id] = entry.camera
    _presets[entry.id] = entry.temperature_presets or {}

    if isinstance(conn, (MoonrakerConnection, SnapmakerU1Connection)):
        _moonraker.append(_moonraker_runtime_entry(entry, conn))
    elif isinstance(conn, BambuConnection):
        p = BambuPrinter(
            id=entry.id,
            model_name=entry.model_name,
            custom_name=entry.custom_name,
            icon=entry.icon_key(),
            ip=conn.host,
            access_code=conn.access_code,
            serial=conn.serial,
        )
        await asyncio.to_thread(p.start)
        _bambu.append(p)
        if isinstance(entry.camera, BambuRtspCamera):
            rtsp_url = f"rtsps://bblp:{conn.access_code}@{conn.host}:322/streaming/live/1"
            _cam_proxies[entry.id] = BambuCameraProxy(rtsp_url, entry.id)
    elif isinstance(conn, SimulatedConnection):
        _simulated.append((
            entry.id,
            entry.model_name,
            entry.custom_name,
            entry.icon_key(),
            conn.profile,
            conn.scenario,
        ))


class PrinterPrintEnabledRequest(BaseModel):
    enabled: bool
    note: Optional[str] = None


@app.get("/api/printers/{printer_id}/print-enabled")
async def get_printer_print_enabled(printer_id: str):
    cfg = load()
    if not any(p.id == printer_id for p in cfg.printers):
        raise HTTPException(status_code=404, detail="printer not found")
    return {
        "printer_id": printer_id,
        "print_enabled": db.is_printer_printing_enabled(printer_id),
        "print_enabled_note": db.get_printer_printing_note(printer_id),
    }


@app.put("/api/printers/{printer_id}/print-enabled")
async def set_printer_print_enabled(printer_id: str, body: PrinterPrintEnabledRequest):
    cfg = load()
    if not any(p.id == printer_id for p in cfg.printers):
        raise HTTPException(status_code=404, detail="printer not found")
    enabled = bool(body.enabled)
    note = None if enabled else (body.note or "").strip()
    db.set_printer_printing_enabled(printer_id, enabled)
    db.set_printer_printing_note(printer_id, None if enabled else note)
    db.log_decision(
        printer_id,
        "print_enabled_changed",
        "enabled" if enabled else f"disabled: {note or 'No reason entered'}",
    )
    if printer_id in _latest_printers:
        _latest_printers[printer_id]["print_enabled"] = enabled
        _latest_printers[printer_id]["print_enabled_note"] = None if enabled else note
    return {"ok": True, "print_enabled": enabled, "print_enabled_note": None if enabled else note}


@app.post("/api/printers/{printer_id}/exclude-object")
async def post_exclude_object(printer_id: str, req: ExcludeObjectRequest):
    for (id, model_name, custom_name, icon, url, _kind, _toolhead_count) in _moonraker:
        if id == printer_id:
            try:
                await moonraker.exclude_object(url, req.name)
            except Exception as exc:
                raise HTTPException(status_code=502, detail=str(exc))
            db.log_decision(printer_id, "object_excluded", f"Klipper object {req.name}")
            return {"ok": True, "mode": "klipper_exclude_object"}
    for p in _bambu:
        if p.id == printer_id:
            if req.id is None:
                raise HTTPException(status_code=422, detail="Bambu object id required")
            try:
                ok = await asyncio.to_thread(p.skip_object, req.id)
            except Exception as exc:
                raise HTTPException(status_code=502, detail=str(exc))
            if not ok:
                raise HTTPException(status_code=502, detail="Bambu skip object command failed")
            db.log_decision(printer_id, "object_excluded", f"Bambu object id={req.id} name={req.name}")
            return {"ok": True, "mode": "bambu_skip_objects"}
    raise HTTPException(status_code=400, detail="object exclusion not supported for this printer")


@app.get("/api/printers/{printer_id}/thumbnail")
async def get_printer_thumbnail(printer_id: str, view: str | None = None):
    for (id, model_name, custom_name, icon, url, kind, toolhead_count) in _moonraker:
        if id == printer_id:
            status = await moonraker.fetch(id, model_name, custom_name, icon, url, kind=kind, toolhead_count=toolhead_count)
            if status.job:
                preview = await moonraker.fetch_preview(url, status.job.filename)
                if preview and preview.image_png:
                    return Response(content=preview.image_png, media_type="image/png")
            raise HTTPException(status_code=404, detail="no thumbnail")

    for p in _bambu:
        if p.id == printer_id:
            preview = await asyncio.to_thread(p.get_preview)
            if view == "top" and preview and preview.top_image_png:
                return Response(content=preview.top_image_png, media_type="image/png")
            if preview and preview.image_png:
                return Response(content=preview.image_png, media_type="image/png")
            raise HTTPException(status_code=404, detail="no thumbnail")

    for (id, model_name, custom_name, _icon, profile, scenario) in _simulated:
        if id == printer_id:
            status = simulated.status(id, model_name, custom_name, _icon, profile, scenario)
            if not status.job:
                raise HTTPException(status_code=404, detail="no thumbnail")
            label = status.job.subtask_name or status.job.filename
            if profile == "prusalink":
                colour = "#f97316"
            elif profile == "reprap":
                colour = "#22c55e"
            elif profile == "ideaformer":
                colour = "#2dd4bf"
            else:
                colour = "#60a5fa"
            svg = f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360">
  <rect width="640" height="360" fill="#070910"/>
  <rect x="32" y="36" width="576" height="288" rx="18" fill="#111827" stroke="#334155"/>
  <path d="M122 244h396" stroke="#475569" stroke-width="10" stroke-linecap="round"/>
  <path d="M168 132h262l62 76H108z" fill="{colour}" opacity="0.92"/>
  <circle cx="204" cy="250" r="18" fill="#64748b"/>
  <circle cx="484" cy="250" r="18" fill="#64748b"/>
  <text x="58" y="78" fill="#93c5fd" font-family="Arial, sans-serif" font-size="20" font-weight="700">SIMULATED {profile.upper()}</text>
  <text x="58" y="308" fill="#e5e7eb" font-family="Arial, sans-serif" font-size="25" font-weight="700">{label}</text>
</svg>"""
            return Response(content=svg, media_type="image/svg+xml")

    raise HTTPException(status_code=404, detail="printer not found")


# ── User settings ─────────────────────────────────────────────────────────

class SettingUpdate(BaseModel):
    value: str


class SlicerProfileSyncRequest(BaseModel):
    vendors: list[str] = []


class SlicerProfileDefaultsRequest(BaseModel):
    printer_profile: str = ""
    process_profile: str = ""
    filament_profile: str = ""


class SupportBundleRequest(BaseModel):
    name: str = ""
    email: str = ""
    problem: str = ""
    expected: str = ""
    notes: str = ""


@app.get("/api/settings")
async def get_settings():
    settings = dict(db.get_all_settings())
    token = str(settings.get("bambu_cloud_token") or "").strip()
    if token:
        settings["bambu_cloud_token"] = ""
        settings["bambu_cloud_token_configured"] = "true"
        settings["bambu_cloud_token_hint"] = makerworld._token_hint(token)
    else:
        settings["bambu_cloud_token_configured"] = "false"
        settings["bambu_cloud_token_hint"] = ""
    browser_password = str(settings.get("orcaslicer_browser_password") or "").strip()
    if browser_password:
        settings["orcaslicer_browser_password"] = ""
        settings["orcaslicer_browser_password_configured"] = "true"
    else:
        settings["orcaslicer_browser_password_configured"] = "false"
    return settings


@app.put("/api/settings/{key}")
async def put_setting(key: str, body: SettingUpdate):
    value = body.value
    if key == "print_vault_path":
        value = "" if not value.strip() else str(_validate_print_library_path(value))
    db.set_setting(key, value)
    if key == "bambu_cloud_token":
        token = str(value or "").strip()
        return {
            "ok": True,
            "value": "",
            "configured": bool(token),
            "hint": makerworld._token_hint(token),
        }
    if key == "orcaslicer_browser_password":
        password = str(value or "").strip()
        return {"ok": True, "value": "", "configured": bool(password)}
    return {"ok": True, "value": value}


class CostingOverhead(BaseModel):
    id: str = ""
    name: str = ""
    amount: float = 0


class CostingUpdate(BaseModel):
    overheads: list[CostingOverhead] = []
    expected_hours: float = 40
    markup_pct: float = 35
    labour_per_hour: float = 0
    electricity_rate_per_kwh: float = 0.30
    power_watts: dict[str, float] = {}
    pricing_strategy: str = "shop"
    fail_pct: float = 8
    batch_multiplier: float = 5
    machine_hour_rate: float = 0
    value_multiplier: float = 10
    design_per_hour: float = 50


class CostingQuoteRequest(BaseModel):
    hours: float = 0
    grams: float = 0
    material: str = ""
    brand: str = ""
    filament_cost: Optional[float] = None


def _costing_printer_meta() -> list[dict]:
    rows: list[dict] = []
    for p in _bambu:
        rows.append({
            "id": p.id,
            "model_name": p.model_name,
            "custom_name": p.custom_name,
            "kind": "bambu",
        })
    for pid, model_name, custom_name, _icon, _url, kind, _toolhead_count in _moonraker:
        rows.append({
            "id": pid,
            "model_name": model_name,
            "custom_name": custom_name,
            "kind": kind,
        })
    for pid, model_name, custom_name, _icon, profile, _scenario in _simulated:
        rows.append({
            "id": pid,
            "model_name": model_name,
            "custom_name": custom_name,
            "kind": profile,
        })
    return rows


@app.get("/api/costing")
async def get_costing():
    return db.get_costing_settings()


@app.put("/api/costing")
async def put_costing(body: CostingUpdate):
    return db.set_costing_settings(body.model_dump())


@app.post("/api/costing/quote")
async def post_costing_quote(body: CostingQuoteRequest):
    return db.quote_print_cost(
        hours=body.hours,
        grams=body.grams,
        material=body.material,
        brand=body.brand,
        filament_cost=body.filament_cost,
    )


@app.get("/api/costing/power")
async def get_costing_power(month: Optional[str] = None):
    """Estimate electricity from History print hours × wiki average watts × tariff."""
    return db.estimate_power_month(month, printers=_costing_printer_meta())


_PROJECTS_VAULT_ROOT = "Projects"


def _project_folder_slug(name: str) -> str:
    safe = re.sub(r"[^A-Za-z0-9._ -]+", "_", str(name or "").strip())[:60].strip(" ._")
    return safe or "Project"


def _project_dir(vault_folder: str, *, missing_ok: bool = False) -> Path:
    root = _print_library_path().resolve()
    parts = [p for p in str(vault_folder or "").replace("\\", "/").split("/") if p and p not in {".", ".."}]
    if not parts:
        raise HTTPException(status_code=400, detail="Project folder missing")
    return _safe_join_under(root, *parts, missing_ok=missing_ok)


def _unique_project_folder(name: str) -> str:
    slug = _project_folder_slug(name)
    root = _print_library_path().resolve()
    claimed = {str(p.get("vault_folder") or "") for p in db.list_projects()}

    def exists(rel: str) -> bool:
        return _safe_join_under(root, *rel.split("/"), missing_ok=True).exists()

    candidates = [f"{_PROJECTS_VAULT_ROOT}/{slug}"]
    candidates.extend(f"{_PROJECTS_VAULT_ROOT}/{slug}_{n}" for n in range(2, 51))
    # Prefer an existing orphan folder first, then a free new name.
    for folder in candidates:
        if folder not in claimed and exists(folder):
            return folder
    for folder in candidates:
        if folder not in claimed and not exists(folder):
            return folder
    return f"{_PROJECTS_VAULT_ROOT}/{slug}_{int(time.time())}"


def _adopt_orphan_project_folders() -> None:
    """Re-register Print Vault Projects/* folders that lost their DB rows."""
    root = _print_library_path().resolve()
    projects_root = _safe_join_under(root, _PROJECTS_VAULT_ROOT, missing_ok=True)
    if not projects_root.exists() or not projects_root.is_dir():
        return
    claimed = {str(p.get("vault_folder") or "") for p in db.list_projects()}
    dismissed = db.get_dismissed_project_folders()
    for child in sorted(projects_root.iterdir()):
        if not child.is_dir():
            continue
        rel = child.relative_to(root).as_posix()
        if rel in claimed or rel in dismissed:
            continue
        try:
            has_files = any(p.is_file() for p in child.rglob("*"))
        except OSError:
            has_files = False
        if not has_files:
            continue
        db.create_project(child.name, rel, notes="Recovered from Print Vault folder")


def _project_source_needs_slice(filename: str, meta: Optional[dict] = None) -> bool:
    name = str(filename or "").lower()
    if name.endswith(".gcode.3mf") or name.endswith(".gcode.gz") or name.endswith(".gcode") or name.endswith(".ufp"):
        return False
    ext = _queue_file_extension(filename)
    if ext in {".step", ".stp"}:
        return False
    if ext not in _SOURCE_MODEL_EXT:
        return False
    return not bool((meta or {}).get("sliced"))


def _guess_3mf_printer_blob(data: bytes) -> str:
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as zf:
            for name in zf.namelist():
                n = name.replace("\\", "/").lower()
                if n.endswith("project_settings.config"):
                    return zf.read(name).decode("utf-8", "ignore")[:8000]
    except Exception:
        return ""
    return ""


def _project_slice_targets() -> list[dict]:
    settings = db.get_all_settings()
    rows = []
    for meta in _costing_printer_meta():
        pid = str(meta.get("id") or "")
        if not pid:
            continue
        profiles = {
            "printer": (settings.get(_slicer_profile_key(pid, "printer"), "") or "").strip(),
            "process": (settings.get(_slicer_profile_key(pid, "process"), "") or "").strip(),
            "filament": (settings.get(_slicer_profile_key(pid, "filament"), "") or "").strip(),
        }
        rows.append({
            "id": pid,
            "label": str(meta.get("custom_name") or meta.get("model_name") or pid),
            "model_name": str(meta.get("model_name") or ""),
            "kind": str(meta.get("kind") or ""),
            "has_defaults": all(profiles.values()),
        })
    rows.sort(key=lambda r: (not r["has_defaults"], 0 if r["kind"] == "bambu" else 1, r["label"].lower()))
    return rows


def _pick_project_slice_printer(row: dict, filename: str, data: bytes) -> dict:
    targets = [t for t in _project_slice_targets() if t.get("has_defaults")]
    if not targets:
        raise HTTPException(
            status_code=422,
            detail="Set slicer defaults on a printer in Settings → Slicer before auto-quoting unsliced files.",
        )
    wanted = str(row.get("quote_printer_id") or "").strip()
    if wanted:
        match = next((t for t in targets if t["id"] == wanted), None)
        if match:
            return match
    blob = _guess_3mf_printer_blob(data).upper() if str(filename or "").lower().endswith(".3mf") else ""
    compact_blob = re.sub(r"[^A-Z0-9]+", "", blob)
    if compact_blob:
        scored = []
        for t in targets:
            model = re.sub(r"[^A-Z0-9]+", "", str(t.get("model_name") or "").upper())
            if model and model in compact_blob:
                scored.append(t)
        if scored:
            return scored[0]
    bambu = next((t for t in targets if t.get("kind") == "bambu"), None)
    return bambu or targets[0]


def _project_matching_slice(folder: Path, source_name: str) -> Optional[str]:
    key = _file_archive_key(source_name)
    if not key or not folder.exists():
        return None
    try:
        names = [p.name for p in folder.iterdir() if p.is_file()]
    except OSError:
        return None
    for name in names:
        lower = name.lower()
        if name == source_name:
            continue
        if not (lower.endswith(".gcode.3mf") or lower.endswith(".gcode") or lower.endswith(".gcode.gz")):
            continue
        other = _file_archive_key(name)
        if other == key or other.startswith(f"{key}_") or key.startswith(f"{other}_"):
            return name
    return None


def _http_error_detail(exc: Exception) -> str:
    if isinstance(exc, HTTPException):
        detail = exc.detail
        if isinstance(detail, str) and detail.strip():
            return detail.strip()
        return str(detail)
    return str(exc).strip() or "Slice failed"


def _queue_project_file_slice(project_id: int, dest: Path, row: dict, data: bytes) -> None:
    root = _print_library_path().resolve()
    rel = dest.relative_to(root).as_posix()
    existing = _project_slice_jobs.get(rel) or {}
    if existing.get("status") == "slicing":
        return
    meta = slice_meta.parse_slice_totals(dest.name, data)
    if not _project_source_needs_slice(dest.name, meta):
        return
    matched = _project_matching_slice(dest.parent, dest.name)
    if matched:
        _project_slice_jobs[rel] = {
            "status": "sliced_source",
            "status_detail": f"Using existing sliced file {matched}",
            "output": matched,
            "project_id": project_id,
        }
        return
    _project_slice_jobs[rel] = {
        "status": "slicing",
        "status_detail": "Slicing for quote…",
        "project_id": project_id,
        "source": dest.name,
    }
    asyncio.create_task(_run_project_file_slice(project_id, dest, rel, row, data))


async def _run_project_file_slice(project_id: int, dest: Path, rel: str, row: dict, data: bytes) -> None:
    try:
        target = _pick_project_slice_printer(row, dest.name, data)
        printer_id = target["id"]
        kind = _printer_kind(printer_id) or "bambu"
        output_ext = ".gcode.3mf" if kind == "bambu" else ".gcode"
        output_name = f"{_file_archive_key(dest.name) or dest.stem}_{printer_id}{output_ext}"
        _project_slice_jobs[rel] = {
            "status": "slicing",
            "status_detail": f"Slicing on {target.get('label') or printer_id}…",
            "project_id": project_id,
            "printer_id": printer_id,
            "source": dest.name,
        }
        _, sliced_data, profiles, slice_options = await _slice_model_to_bytes(
            filename=dest.name,
            data=data,
            printer_id=printer_id,
            output_filename=output_name,
            all_plates=dest.name.lower().endswith(".3mf") and not dest.name.lower().endswith(".gcode.3mf"),
        )
        out_path = dest.parent / output_name
        out_path.write_bytes(sliced_data)
        db.touch_project(project_id)
        db.log_decision(printer_id, "project_slice", json.dumps({
            "project_id": project_id,
            "source": dest.name,
            "output": out_path.name,
            "profiles": profiles,
            "slice_options": slice_options,
        }))
        _project_slice_jobs[rel] = {
            "status": "sliced_source",
            "status_detail": f"Quoted from {out_path.name}",
            "output": out_path.name,
            "project_id": project_id,
            "printer_id": printer_id,
        }
    except Exception as exc:
        log.exception("Project auto-slice failed for %s", dest)
        _project_slice_jobs[rel] = {
            "status": "error",
            "status_detail": _http_error_detail(exc),
            "project_id": project_id,
            "source": dest.name,
        }


def _scan_project_files(vault_folder: str) -> list[dict]:
    folder = _project_dir(vault_folder, missing_ok=True)
    if not folder.exists() or not folder.is_dir():
        return []
    rows = []
    root = _print_library_path().resolve()
    for path in sorted(folder.rglob("*")):
        if not path.is_file():
            continue
        try:
            stat = path.stat()
            data = path.read_bytes()
        except OSError:
            continue
        meta = slice_meta.parse_slice_totals(path.name, data)
        rel = path.relative_to(root).as_posix()
        job = _project_slice_jobs.get(rel) or {}
        status = job.get("status") or meta.get("status") or ("sliced" if meta.get("sliced") else "not_sliced")
        detail = job.get("status_detail") or meta.get("status_detail") or ("Sliced" if meta.get("sliced") else "Not sliced yet")
        rows.append({
            "name": path.name,
            "path": rel,
            "kind": _file_kind(path.name),
            "size": stat.st_size,
            "modified": datetime.fromtimestamp(stat.st_mtime).isoformat(),
            "sliced": bool(meta.get("sliced")),
            "seconds": meta.get("seconds"),
            "grams": meta.get("grams"),
            "material": meta.get("material"),
            "plate_count": int(meta.get("plate_count") or 0),
            "status": status,
            "status_detail": detail,
            "output": job.get("output"),
        })
        if len(rows) >= 80:
            break
    return rows


def _project_quote(files: list[dict], parallel_printers: int = 1) -> dict:
    grams = sum(float(f.get("grams") or 0) for f in files)
    seconds = sum(int(f.get("seconds") or 0) for f in files)
    longest = max((int(f.get("seconds") or 0) for f in files), default=0)
    printer_hours = seconds / 3600.0 if seconds else 0.0
    longest_hours = longest / 3600.0 if longest else 0.0
    n = max(1, min(int(parallel_printers or 1), 12))
    elapsed_hours = max(longest_hours, printer_hours / n) if printer_hours else 0.0
    materials = [str(f.get("material") or "").strip() for f in files if f.get("material")]
    material = materials[0] if len({m.upper() for m in materials}) == 1 else ""
    fleet = db.quote_print_cost(hours=printer_hours, grams=grams, material=material)
    elapsed = db.quote_print_cost(hours=elapsed_hours, grams=grams, material=material)
    sliced = sum(1 for f in files if f.get("sliced"))
    slicing = sum(1 for f in files if f.get("status") == "slicing")
    return {
        "file_count": len(files),
        "sliced_count": sliced,
        "unsliced_count": len(files) - sliced,
        "slicing_count": slicing,
        "grams": round(grams, 1) if grams else None,
        "printer_hours": round(printer_hours, 2),
        "elapsed_hours": round(elapsed_hours, 2),
        "longest_hours": round(longest_hours, 2),
        "parallel_printers": n,
        "material": material or None,
        "filament_cost": fleet.get("filament_cost"),
        "filament_source": fleet.get("filament_source"),
        "fleet": {
            "hours": fleet.get("hours"),
            "time_cost": fleet.get("time_cost"),
            "labour_cost": fleet.get("labour_cost"),
            "floor_price": fleet.get("floor_price"),
            "suggested_price": fleet.get("suggested_price"),
        },
        "elapsed": {
            "hours": elapsed.get("hours"),
            "time_cost": elapsed.get("time_cost"),
            "labour_cost": elapsed.get("labour_cost"),
            "floor_price": elapsed.get("floor_price"),
            "suggested_price": elapsed.get("suggested_price"),
        },
        "quote_floor": elapsed.get("floor_price"),
        "quote_suggested": elapsed.get("suggested_price"),
        "pricing_strategy": elapsed.get("pricing_strategy"),
        "shop_price": elapsed.get("shop_price"),
        "batch_price": elapsed.get("batch_price"),
        "machine_price": elapsed.get("machine_price"),
        "value_price": elapsed.get("value_price"),
        "shop_rate": fleet.get("shop_rate"),
        "markup_pct": fleet.get("markup_pct"),
    }


def _project_payload(row: dict) -> dict:
    files = _scan_project_files(row.get("vault_folder") or "")
    quote = _project_quote(files, row.get("parallel_printers") or 1)
    slicing = any(f.get("status") == "slicing" for f in files)
    return {
        **row,
        "files": files,
        "quote": quote,
        "slicing": slicing,
        "slice_targets": _project_slice_targets(),
    }


class ProjectCreateRequest(BaseModel):
    name: str
    notes: str = ""
    parallel_printers: int = 1


class ProjectUpdateRequest(BaseModel):
    name: Optional[str] = None
    notes: Optional[str] = None
    parallel_printers: Optional[int] = None
    quote_printer_id: Optional[str] = None


@app.get("/api/projects")
async def api_list_projects():
    _adopt_orphan_project_folders()
    rows = []
    for row in db.list_projects():
        files = _scan_project_files(row.get("vault_folder") or "")
        quote = _project_quote(files, row.get("parallel_printers") or 1)
        rows.append({
            **row,
            "file_count": quote["file_count"],
            "sliced_count": quote["sliced_count"],
            "slicing": quote.get("slicing_count", 0) > 0,
            "quote": quote,
        })
    return {"items": rows}


@app.post("/api/projects", status_code=201)
async def api_create_project(body: ProjectCreateRequest):
    folder = _unique_project_folder(body.name)
    dest = _project_dir(folder, missing_ok=True)
    dest.mkdir(parents=True, exist_ok=True)
    db.undismiss_project_folder(folder)
    row = db.create_project(
        body.name,
        folder,
        notes=body.notes,
        parallel_printers=body.parallel_printers,
    )
    return _project_payload(row)


@app.get("/api/projects/{project_id}")
async def api_get_project(project_id: int):
    row = db.get_project_row(project_id)
    if not row:
        raise HTTPException(status_code=404, detail="Project not found")
    return _project_payload(row)


@app.put("/api/projects/{project_id}")
async def api_update_project(project_id: int, body: ProjectUpdateRequest):
    row = db.update_project(
        project_id,
        name=body.name,
        notes=body.notes,
        parallel_printers=body.parallel_printers,
        quote_printer_id=body.quote_printer_id,
    )
    if not row:
        raise HTTPException(status_code=404, detail="Project not found")
    return _project_payload(row)


@app.delete("/api/projects/{project_id}")
async def api_delete_project(project_id: int):
    row = db.get_project_row(project_id)
    if not row:
        raise HTTPException(status_code=404, detail="Project not found")
    folder = str(row.get("vault_folder") or "")
    if not db.delete_project(project_id):
        raise HTTPException(status_code=404, detail="Project not found")
    # Keep vault files, but don't auto-resurrect this folder on the next list.
    db.dismiss_project_folder(folder)
    return {"ok": True, "vault_folder": folder}


@app.post("/api/projects/{project_id}/files", status_code=201)
async def api_upload_project_file(project_id: int, file: UploadFile = File(...)):
    row = db.get_project_row(project_id)
    if not row:
        raise HTTPException(status_code=404, detail="Project not found")
    raw_name = _safe_basename(file.filename, "model")
    ext = _queue_file_extension(raw_name)
    if raw_name.lower().endswith(".gcode.3mf"):
        allowed = _ALLOWED_BAMBU_EXT
    else:
        allowed = _ALLOWED_BAMBU_EXT | _ALLOWED_MOONRAKER_EXT | _SOURCE_MODEL_EXT
    if ext not in allowed:
        raise HTTPException(status_code=422, detail="Unsupported file type")
    data = await _read_upload_bytes(file, label="Project upload")
    folder = _project_dir(row["vault_folder"], missing_ok=True)
    folder.mkdir(parents=True, exist_ok=True)
    dest = folder / raw_name
    if dest.exists():
        stem = dest.stem
        suffix = "".join(dest.suffixes) or ext
        dest = folder / f"{stem}_{datetime.utcnow().strftime('%Y%m%d%H%M%S')}{suffix}"
    dest.write_bytes(data)
    db.touch_project(project_id)
    fresh = db.get_project_row(project_id) or row
    _queue_project_file_slice(project_id, dest, fresh, data)
    return _project_payload(fresh)


@app.post("/api/projects/{project_id}/slice")
async def api_slice_project(project_id: int):
    row = db.get_project_row(project_id)
    if not row:
        raise HTTPException(status_code=404, detail="Project not found")
    folder = _project_dir(row["vault_folder"], missing_ok=True)
    started = 0
    if folder.exists():
        for path in sorted(folder.iterdir()):
            if not path.is_file():
                continue
            try:
                data = path.read_bytes()
            except OSError:
                continue
            before = (_project_slice_jobs.get(path.relative_to(_print_library_path().resolve()).as_posix()) or {}).get("status")
            _queue_project_file_slice(project_id, path, row, data)
            after = (_project_slice_jobs.get(path.relative_to(_print_library_path().resolve()).as_posix()) or {}).get("status")
            if after == "slicing" and before != "slicing":
                started += 1
    payload = _project_payload(row)
    payload["started"] = started
    return payload


class MakerWorldResolveRequest(BaseModel):
    url: str


class MakerWorldImportRequest(BaseModel):
    url: str
    profile_id: int


class MakerWorldImportAllRequest(BaseModel):
    url: str
    only_missing: bool = False


def _db_setting(key: str) -> str:
    return str(db.get_all_settings().get(key) or "").strip()


@app.get("/api/makerworld/status")
async def makerworld_status():
    token = _db_setting("bambu_cloud_token")
    return {
        "has_token": bool(token),
        "token_hint": makerworld._token_hint(token),
        "import_dir": makerworld.IMPORT_SUBDIR,
    }


@app.post("/api/makerworld/resolve")
async def makerworld_resolve(body: MakerWorldResolveRequest):
    token = _db_setting("bambu_cloud_token")
    try:
        return makerworld.resolve_url(
            body.url.strip(),
            token,
            DATA_DIR,
            library_root=_print_library_path().resolve(),
            safe_join_under=_safe_join_under,
        )
    except makerworld.MakerWorldError as exc:
        raise HTTPException(status_code=exc.status, detail=str(exc))


@app.post("/api/makerworld/import")
async def makerworld_import(body: MakerWorldImportRequest):
    token = _db_setting("bambu_cloud_token")
    try:
        return makerworld.import_plate(
            url=body.url.strip(),
            profile_id=int(body.profile_id),
            token=token,
            data_dir=DATA_DIR,
            library_root=_print_library_path().resolve(),
            safe_basename=_safe_basename,
            safe_join_under=_safe_join_under,
            enforce_file_size=_enforce_file_size,
        )
    except makerworld.MakerWorldError as exc:
        raise HTTPException(status_code=exc.status, detail=str(exc))


@app.post("/api/makerworld/import-all")
async def makerworld_import_all(body: MakerWorldImportAllRequest):
    token = _db_setting("bambu_cloud_token")
    try:
        return makerworld.import_all_plates(
            url=body.url.strip(),
            token=token,
            data_dir=DATA_DIR,
            library_root=_print_library_path().resolve(),
            safe_basename=_safe_basename,
            safe_join_under=_safe_join_under,
            enforce_file_size=_enforce_file_size,
            only_missing=body.only_missing,
        )
    except makerworld.MakerWorldError as exc:
        raise HTTPException(status_code=exc.status, detail=str(exc))


@app.get("/api/makerworld/recent")
async def makerworld_recent(limit: int = 10):
    return {"imports": makerworld.recent_imports(DATA_DIR, limit)}


@app.post("/api/makerworld/recent/clear")
async def makerworld_recent_clear():
    cleared = makerworld.clear_imports(DATA_DIR)
    return {"ok": True, "cleared": cleared}


@app.get("/api/makerworld/thumbnail")
async def makerworld_thumbnail(url: str):
    try:
        data, content_type = makerworld.fetch_thumbnail(url)
    except makerworld.MakerWorldError as exc:
        raise HTTPException(status_code=exc.status, detail=str(exc))
    return Response(content=data, media_type=content_type)


@app.post("/api/painter/inbox", status_code=201)
async def painter_inbox(file: UploadFile = File(...)):
    raw_name = _safe_basename(file.filename, "model.stl")
    lower = raw_name.lower()
    if lower.endswith(".gcode.3mf"):
        raise HTTPException(status_code=422, detail="STL Painter takes the model, not a sliced plate")
    ext = _queue_file_extension(raw_name)
    if ext not in {".stl", ".obj", ".3mf"}:
        raise HTTPException(status_code=422, detail="STL Painter takes an STL, OBJ, or 3MF")
    data = await _read_upload_bytes(file, label="STL Painter")
    token = uuid.uuid4().hex
    folder = (DATA_DIR / "painter-inbox" / token)
    folder.mkdir(parents=True, exist_ok=True)
    (folder / raw_name).write_bytes(data)
    return {
        "ok": True,
        "token": token,
        "name": raw_name,
        "url": f"/api/painter/inbox/{token}",
    }


@app.get("/api/painter/inbox/{token}")
async def painter_inbox_file(token: str):
    if not re.fullmatch(r"[0-9a-f]{32}", token):
        raise HTTPException(status_code=404, detail="Not found")
    folder = _safe_join_under(DATA_DIR / "painter-inbox", token)
    chosen = next((path for path in folder.iterdir() if path.is_file()), None)
    if chosen is None:
        raise HTTPException(status_code=404, detail="Not found")
    return FileResponse(chosen, filename=chosen.name)


@app.post("/api/makerdeck/exports", status_code=201)
async def makerdeck_save_export(request: Request):
    max_bytes = _MAX_PRINT_FILE_BYTES
    try:
        form = await request.form(max_part_size=max_bytes)
    except Exception as exc:
        raise HTTPException(status_code=413, detail=str(exc)) from exc

    upload = form.get("file")
    if upload is None or not hasattr(upload, "read"):
        raise HTTPException(status_code=422, detail="Missing export file")
    raw_name = _safe_basename(getattr(upload, "filename", None), "makerdeck-export")
    ext = _queue_file_extension(raw_name)
    if ext not in {".stl", ".3mf"}:
        raise HTTPException(status_code=422, detail="Only STL and 3MF exports are supported")
    data = await _read_upload_bytes(upload, label="MakerDeck export")

    thumb_field = form.get("thumbnail")
    thumb_data = b""
    if thumb_field is not None and hasattr(thumb_field, "read"):
        thumb_data = await thumb_field.read()

    trace_field = form.get("trace_image")
    trace_data = b""
    if trace_field is not None and hasattr(trace_field, "read"):
        trace_data = await trace_field.read()

    meta_field = form.get("meta")
    meta = meta_field if isinstance(meta_field, str) else ""

    try:
        return makerdeck_library.save_export(
            library_root=_print_library_path().resolve(),
            data_dir=DATA_DIR,
            filename=raw_name,
            file_bytes=data,
            meta_json=meta,
            safe_join_under=_safe_join_under,
            safe_basename=_safe_basename,
            thumbnail_bytes=thumb_data or None,
            trace_image_bytes=trace_data or None,
        )
    except makerdeck_library.MakerDeckLibraryError as exc:
        raise HTTPException(status_code=exc.status, detail=str(exc))


@app.post("/api/makerdeck/designs", status_code=201)
async def makerdeck_save_design(request: Request):
    try:
        form = await request.form(max_part_size=_MAX_MAKERDECK_DESIGN_PART_BYTES)
    except Exception as exc:
        raise HTTPException(status_code=413, detail=str(exc)) from exc

    thumb_field = form.get("thumbnail")
    thumb_data = b""
    if thumb_field is not None and hasattr(thumb_field, "read"):
        thumb_data = await thumb_field.read()

    trace_field = form.get("trace_image")
    trace_data = b""
    if trace_field is not None and hasattr(trace_field, "read"):
        trace_data = await trace_field.read()

    meta_field = form.get("meta")
    meta = meta_field if isinstance(meta_field, str) else ""

    try:
        return makerdeck_library.save_design(
            library_root=_print_library_path().resolve(),
            data_dir=DATA_DIR,
            meta_json=meta,
            safe_join_under=_safe_join_under,
            thumbnail_bytes=thumb_data or None,
            trace_image_bytes=trace_data or None,
        )
    except makerdeck_library.MakerDeckLibraryError as exc:
        raise HTTPException(status_code=exc.status, detail=str(exc))


@app.get("/api/makerdeck/designs")
async def makerdeck_list_designs(limit: int = 50, folder: str | None = None):
    makerdeck_library.ensure_compact_manifest(DATA_DIR, _print_library_path().resolve(), _safe_join_under)
    return {"designs": makerdeck_library.recent_designs(DATA_DIR, limit, folder)}


@app.get("/api/makerdeck/folders")
async def makerdeck_list_folders():
    makerdeck_library.ensure_compact_manifest(DATA_DIR, _print_library_path().resolve(), _safe_join_under)
    return {"folders": makerdeck_library.list_folders(DATA_DIR)}


@app.get("/api/makerdeck/designs/{design_id}/thumbnail")
async def makerdeck_design_thumbnail(design_id: str):
    try:
        data, media = makerdeck_library.design_thumbnail(
            DATA_DIR,
            _print_library_path().resolve(),
            design_id,
            _safe_join_under,
        )
    except makerdeck_library.MakerDeckLibraryError as exc:
        raise HTTPException(status_code=exc.status, detail=str(exc))
    return Response(content=data, media_type=media, headers={"Cache-Control": "no-store, max-age=0"})


@app.get("/api/makerdeck/designs/{design_id}/params")
async def makerdeck_design_params(design_id: str):
    try:
        return makerdeck_library.design_params(
            DATA_DIR,
            _print_library_path().resolve(),
            design_id,
            _safe_join_under,
        )
    except makerdeck_library.MakerDeckLibraryError as exc:
        raise HTTPException(status_code=exc.status, detail=str(exc))


@app.delete("/api/makerdeck/designs/{design_id}")
async def makerdeck_delete_design(design_id: str):
    deleted = makerdeck_library.delete_design(
        DATA_DIR,
        _print_library_path().resolve(),
        design_id,
        _safe_join_under,
    )
    if not deleted:
        raise HTTPException(status_code=404, detail="Design not found")
    return {"ok": True}


_ORCA_PROFILE_VENDORS = ["BBL", "Sovol", "Voron", "Prusa", "Anycubic", "Creality"]
_ORCA_PROFILE_BASE = "https://raw.githubusercontent.com/OrcaSlicer/OrcaSlicer/main/resources/profiles"
_ORCA_LOCAL_VENDOR = "Orca Local"
_ORCA_LOCAL_PROFILE_LIMIT = 20000


def _slicer_profile_key(printer_id: str, slot: str) -> str:
    clean = re.sub(r"[^A-Za-z0-9_.:-]+", "_", printer_id.strip())
    return f"slicer_default_{clean}_{slot}"


def _profile_item_list(payload: dict, key: str) -> list[dict]:
    rows = payload.get(key) or []
    out = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        name = str(row.get("name") or "").strip()
        sub_path = str(row.get("sub_path") or "").strip()
        if not name or name.startswith("fdm_"):
            continue
        out.append({"name": name, "path": sub_path})
    return out


def _normalise_orca_profile_vendor(vendor: str, payload: dict) -> dict:
    return {
        "vendor": vendor,
        "name": payload.get("name") or vendor,
        "version": payload.get("version"),
        "source": "OrcaSlicer standard profiles",
        "source_url": f"{_ORCA_PROFILE_BASE}/{urllib.parse.quote(vendor)}.json",
        "machines": _profile_item_list(payload, "machine_list"),
        "machine_models": _profile_item_list(payload, "machine_model_list"),
        "processes": _profile_item_list(payload, "process_list"),
        "filaments": _profile_item_list(payload, "filament_list"),
    }


def _fetch_orca_profile_vendor(vendor: str) -> dict:
    url = f"{_ORCA_PROFILE_BASE}/{urllib.parse.quote(vendor)}.json"
    req = urllib.request.Request(
        url,
        headers={"User-Agent": "Flightdeck/1.0 slicer-profile-sync", "Accept": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=45) as resp:
        payload = json.loads(resp.read().decode("utf-8-sig"))
    return _normalise_orca_profile_vendor(vendor, payload)


def _profile_name_from_json(payload: dict, source_path: str) -> str:
    name = str(payload.get("name") or "").strip()
    if name:
        return name
    return Path(source_path).stem.strip()


def _profile_bucket_from_json(payload: dict, source_path: str = "") -> Optional[str]:
    text = " ".join(str(payload.get(k) or "") for k in ("type", "preset_type", "inherits", "name")).lower()
    path = source_path.replace("\\", "/").lower()
    if "filament" in path or "filament" in text:
        return "filaments"
    if "process" in path or "process" in text or "print" in text:
        return "processes"
    if "machine" in path or "printer" in path or "machine" in text:
        return "machines"
    return None


def _profile_relative_path(path: Path, roots: list[Path]) -> str:
    for root in roots:
        try:
            return path.resolve().relative_to(root.resolve()).as_posix()
        except Exception:
            continue
    return path.name


def _local_orca_profile_paths(roots: list[Path]) -> list[Path]:
    out: list[Path] = []
    seen: set[str] = set()
    for root in roots:
        try:
            iterator = root.rglob("*.json")
        except Exception:
            continue
        for path in iterator:
            if len(out) >= _ORCA_LOCAL_PROFILE_LIMIT:
                return out
            parts = {p.lower() for p in path.parts}
            if "cache" in parts or "log" in parts:
                continue
            key = str(path.resolve()).lower()
            if key in seen:
                continue
            seen.add(key)
            out.append(path)
    def sort_key(path: Path) -> tuple[int, float, str]:
        backup = 1 if any(part.lower().startswith("user_backup") for part in path.parts) else 0
        try:
            mtime = -path.stat().st_mtime
        except Exception:
            mtime = 0.0
        return (backup, mtime, str(path).lower())

    return sorted(out, key=sort_key)[:_ORCA_LOCAL_PROFILE_LIMIT]


def _sync_local_orca_profiles() -> dict:
    roots = _orca_profile_roots(_orca_executable())
    payload = {
        "vendor": _ORCA_LOCAL_VENDOR,
        "name": _ORCA_LOCAL_VENDOR,
        "version": None,
        "source": "Local OrcaSlicer AppData/config profiles",
        "source_url": "",
        "machines": [],
        "machine_models": [],
        "processes": [],
        "filaments": [],
    }
    seen: dict[str, set[str]] = {key: set() for key in ("machines", "machine_models", "processes", "filaments")}
    scanned = 0
    errors = 0
    for path in _local_orca_profile_paths(roots):
        scanned += 1
        try:
            profile = json.loads(path.read_text(encoding="utf-8-sig"))
        except Exception:
            errors += 1
            continue
        if not isinstance(profile, dict):
            continue
        bucket = _profile_bucket_from_json(profile, str(path))
        if not bucket:
            continue
        name = _profile_name_from_json(profile, str(path))
        if not name or name.startswith("fdm_") or name in seen[bucket]:
            continue
        item = {
            "name": name,
            "path": _profile_relative_path(path, roots),
            "local_path": str(path),
        }
        payload[bucket].append(item)
        seen[bucket].add(name)
    for key in ("machines", "machine_models", "processes", "filaments"):
        payload[key] = sorted(payload[key], key=lambda row: row.get("name", "").lower())
    return {
        "payload": payload,
        "scanned": scanned,
        "errors": errors,
        "added": {
            "machines": len(payload["machines"]),
            "processes": len(payload["processes"]),
            "filaments": len(payload["filaments"]),
        },
    }


def _profile_vendor_payload_counts(payload: dict) -> dict:
    return {
        "machines": len(payload.get("machines") or []),
        "processes": len(payload.get("processes") or []),
        "filaments": len(payload.get("filaments") or []),
    }


def _sync_worker_orca_profiles(worker_url: str) -> Optional[dict]:
    worker_url = (worker_url or "").strip().rstrip("/")
    if not worker_url:
        return None
    parsed = urllib.parse.urlparse(worker_url)
    if not parsed.scheme or not parsed.netloc:
        return None
    try:
        with httpx.Client(timeout=httpx.Timeout(connect=3.0, read=90.0, write=10.0, pool=5.0)) as client:
            resp = client.post(
                f"{worker_url}/api/slicer/profiles/sync?include_worker=false",
                json={"vendors": ["local"]},
            )
    except Exception as exc:
        return {"error": str(exc)}
    if resp.status_code >= 400:
        return {"error": f"HTTP {resp.status_code}: {resp.text[:240]}"}
    try:
        payload = resp.json()
    except Exception as exc:
        return {"error": f"Invalid JSON: {exc}"}
    local = next(
        (vendor for vendor in payload.get("vendors") or [] if vendor.get("vendor") == _ORCA_LOCAL_VENDOR),
        None,
    )
    if not local:
        return {"error": "Worker did not return Orca Local profiles"}
    local["source"] = f"Local OrcaSlicer profiles from worker {worker_url}"
    local["source_url"] = worker_url
    return {"payload": local, "added": _profile_vendor_payload_counts(local)}


def _custom_profile_payload() -> dict:
    for vendor in db.get_slicer_profile_vendors():
        if vendor.get("vendor") == "Custom":
            return {
                "vendor": "Custom",
                "name": "Custom",
                "version": None,
                "source": "User uploaded profiles",
                "source_url": "",
                "machines": list(vendor.get("machines") or []),
                "machine_models": list(vendor.get("machine_models") or []),
                "processes": list(vendor.get("processes") or []),
                "filaments": list(vendor.get("filaments") or []),
            }
    return {
        "vendor": "Custom",
        "name": "Custom",
        "version": None,
        "source": "User uploaded profiles",
        "source_url": "",
        "machines": [],
        "machine_models": [],
        "processes": [],
        "filaments": [],
    }


def _add_custom_profile(payload: dict, profile: dict, source_path: str) -> Optional[str]:
    if not isinstance(profile, dict):
        return None
    name = _profile_name_from_json(profile, source_path)
    if not name or name.startswith("fdm_"):
        return None
    bucket = _profile_bucket_from_json(profile, source_path)
    if not bucket:
        return None
    item = {"name": name, "path": f"custom/{source_path}"}
    existing = {row.get("name") for row in payload[bucket]}
    if name not in existing:
        payload[bucket].append(item)
    return bucket


def _parse_uploaded_slicer_profiles(filename: str, data: bytes, payload: dict) -> dict:
    added = {"machines": 0, "processes": 0, "filaments": 0}
    lower = filename.lower()
    if lower.endswith((".bbscfg", ".zip")):
        with zipfile.ZipFile(io.BytesIO(data)) as zf:
            for info in zf.infolist():
                if info.is_dir() or not info.filename.lower().endswith(".json"):
                    continue
                try:
                    profile = json.loads(zf.read(info).decode("utf-8-sig"))
                except Exception:
                    continue
                bucket = _add_custom_profile(payload, profile, info.filename)
                if bucket:
                    added[bucket] += 1
    else:
        profile = json.loads(data.decode("utf-8-sig"))
        bucket = _add_custom_profile(payload, profile, filename)
        if bucket:
            added[bucket] += 1
    for key in ("machines", "machine_models", "processes", "filaments"):
        payload[key] = sorted(payload[key], key=lambda row: row.get("name", ""))
    return {"payload": payload, "added": added}


def _slicer_profile_defaults(settings: dict, printers: list[dict]) -> dict:
    return {
        p.get("id"): {
            "printer_profile": settings.get(_slicer_profile_key(p.get("id", ""), "printer"), ""),
            "process_profile": settings.get(_slicer_profile_key(p.get("id", ""), "process"), ""),
            "filament_profile": settings.get(_slicer_profile_key(p.get("id", ""), "filament"), ""),
        }
        for p in printers
        if p.get("id")
    }


def _orca_executable() -> Path | None:
    candidates: list[Path] = []
    env_exe = os.environ.get("ORCASLICER_EXE", "").strip()
    if env_exe:
        candidates.append(Path(env_exe))
    if os.name == "nt":
        local_app = os.environ.get("LOCALAPPDATA")
        if local_app:
            candidates.extend([
                Path(local_app) / "Programs" / "OrcaSlicer" / "orca-slicer.exe",
                Path(local_app) / "Programs" / "OrcaSlicer" / "OrcaSlicer.exe",
            ])
        for base in (os.environ.get("ProgramFiles"), os.environ.get("ProgramFiles(x86)")):
            if base:
                candidates.append(Path(base) / "OrcaSlicer" / "orca-slicer.exe")
                candidates.append(Path(base) / "OrcaSlicer" / "OrcaSlicer.exe")
    else:
        candidates.extend([
            Path("/opt/orcaslicer/bin/orca-slicer"),
            Path("/usr/bin/orca-slicer"),
            Path("/usr/local/bin/orca-slicer"),
        ])
    for path in candidates:
        if path.exists():
            return path
    found = shutil.which("orca-slicer") or shutil.which("orca-slicer.exe")
    return Path(found) if found else None


def _orca_datadir() -> Path | None:
    raw = os.environ.get("ORCASLICER_DATADIR", "").strip()
    if raw:
        path = Path(raw).expanduser()
        if path.exists():
            return path
    if os.name == "nt":
        appdata = os.environ.get("APPDATA")
        if appdata:
            path = Path(appdata) / "OrcaSlicer"
            if path.exists():
                return path
    path = Path.home() / ".config" / "OrcaSlicer"
    return path if path.exists() else None


def _orca_profile_roots(exe: Path | None = None) -> list[Path]:
    roots: list[Path] = []
    raw = os.environ.get("ORCASLICER_PROFILE_ROOT", "").strip()
    if raw:
        roots.append(Path(raw).expanduser())
    data = _orca_datadir()
    if data:
        roots.extend([data / "user" / "default", data / "system", data])
    if exe:
        roots.append(exe.parent.parent / "resources" / "profiles")
        roots.append(exe.parent / "resources" / "profiles")
    seen: set[str] = set()
    out: list[Path] = []
    for root in roots:
        try:
            resolved = root.resolve()
        except Exception:
            resolved = root
        key = str(resolved).lower()
        if key in seen or not root.exists():
            continue
        seen.add(key)
        out.append(root)
    return out


def _orca_profile_file(profile_name: str, category: str, exe: Path | None = None) -> Path:
    name = (profile_name or "").strip()
    if not name:
        raise HTTPException(status_code=422, detail=f"{category} profile is not set")
    filename = f"{name}.json".lower()
    bucket = {"machine": "machines", "process": "processes", "filament": "filaments"}.get(category)
    for path in _local_orca_profile_paths(_orca_profile_roots(exe)):
        if path.name.lower() == filename:
            return path
        try:
            profile = json.loads(path.read_text(encoding="utf-8-sig"))
        except Exception:
            continue
        if _profile_bucket_from_json(profile, str(path)) != bucket:
            continue
        if _profile_name_from_json(profile, str(path)).lower() == name.lower():
            return path
    raise HTTPException(status_code=422, detail=f"Orca {category} profile not found on worker: {name}")


def _slicer_catalog_profile_blob(profile_name: str, category: str) -> tuple[str, bytes]:
    name = (profile_name or "").strip()
    if not name:
        raise HTTPException(status_code=422, detail=f"{category} profile is not set")
    bucket = {"machine": "machines", "process": "processes", "filament": "filaments"}.get(category)
    if not bucket:
        raise HTTPException(status_code=422, detail=f"Unknown slicer profile category: {category}")

    for vendor in db.get_slicer_profile_vendors():
        vendor_key = str(vendor.get("vendor") or vendor.get("name") or "").strip()
        for row in vendor.get(bucket) or []:
            if str(row.get("name") or "").strip().lower() != name.lower():
                continue
            local_path = str(row.get("local_path") or "").strip()
            if local_path:
                path = Path(local_path)
                if path.exists() and path.is_file():
                    return path.name, path.read_bytes()
            rel_path = str(row.get("path") or "").strip()
            if not vendor_key or not rel_path:
                continue
            if vendor_key == _ORCA_LOCAL_VENDOR:
                continue
            url = f"{_ORCA_PROFILE_BASE}/{urllib.parse.quote(vendor_key, safe='')}/{urllib.parse.quote(rel_path, safe='/')}"
            try:
                with urllib.request.urlopen(url, timeout=15) as resp:
                    data = resp.read()
            except Exception as exc:
                raise HTTPException(status_code=502, detail=f"Could not fetch Orca {category} profile {name}: {exc}") from exc
            if not data:
                raise HTTPException(status_code=502, detail=f"Downloaded Orca {category} profile {name} was empty")
            return Path(rel_path).name, data
    raise HTTPException(status_code=422, detail=f"Orca {category} profile not found in synced catalog: {name}")


def _local_catalog_profile_blob(profile_name: str, category: str) -> Optional[tuple[str, bytes]]:
    name = (profile_name or "").strip()
    bucket = {"machine": "machines", "process": "processes", "filament": "filaments"}.get(category)
    if not name or not bucket:
        return None
    for vendor in db.get_slicer_profile_vendors():
        for row in vendor.get(bucket) or []:
            if str(row.get("name") or "").strip().lower() != name.lower():
                continue
            local_path = str(row.get("local_path") or "").strip()
            if not local_path:
                continue
            path = Path(local_path)
            if path.exists() and path.is_file():
                return path.name, path.read_bytes()
    return None


def _slicer_profile_blob(profile_name: str, category: str, exe: Path | None = None) -> tuple[str, bytes]:
    local = _local_catalog_profile_blob(profile_name, category)
    if local:
        return local
    try:
        path = _orca_profile_file(profile_name, category, exe)
        return path.name, path.read_bytes()
    except HTTPException:
        return _slicer_catalog_profile_blob(profile_name, category)


def _content_disposition_filename(value: str) -> str:
    for part in (value or "").split(";"):
        key, _, raw = part.strip().partition("=")
        if key.lower() == "filename":
            return raw.strip().strip('"')
    return ""


def _friendly_slicer_error(detail: str) -> str:
    text = (detail or "").strip()
    if not text:
        return "Slicer failed without returning an error"
    lowered = text.lower()
    if "some filaments can not be mapped" in lowered:
        return (
            "Slicer could not map the selected filament to the target printer. "
            "Try the slicer API sidecar, or choose matching printer/process/filament profiles."
        )
    if "param values in 3mf/config" in lowered:
        return (
            "Orca CLI rejected Bambu inherit-settings in this 3MF "
            "(Param values in 3mf/config). Flightdeck strips those sentinels automatically — "
            "hit Slice unsliced to retry."
        )
    noise = (
        "slic3r::cli::run found error",
        "run found error, return",
        "run found error, exit",
        "mesa opengl",
        "system opengl library",
        "cli_callback_mgr",
        "update: percent=",
        "update: m_total_progress",
    )
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    useful = [line for line in lines if not any(token in line.lower() for token in noise)]
    preferred_needles = (
        "parsing error",
        "failed to generate g-code",
        "invalid custom g-code",
        "not a variable name",
        "param values",
        "not in range",
        "unknown file format",
        "failed slicing",
    )
    preferred = [
        line for line in useful
        if any(needle in line.lower() for needle in preferred_needles)
    ]
    if preferred:
        extras = []
        for idx, line in enumerate(useful):
            if "not a variable name" in line.lower() and idx + 1 < len(useful):
                snippet = useful[idx + 1]
                if snippet not in preferred and len(snippet) < 240:
                    extras.append(snippet)
        summary = " ".join((preferred + extras)[-8:]).strip()
        return summary[-700:] if summary else text[-500:]
    important = [
        line for line in useful
        if "[error]" in line.lower() or "error" in line.lower() or "failed" in line.lower()
    ]
    picked = important[-4:] if important else useful[-6:] or lines[-4:]
    summary = " ".join(picked).strip()
    return summary[-500:] if summary else text[-500:]


def _looks_like_h2d_slice_profile(profiles: dict) -> bool:
    haystack = " ".join(str(profiles.get(key) or "") for key in ("printer", "process", "filament"))
    return "h2d" in haystack.lower()


def _is_loose_mesh_source(filename: str) -> bool:
    return _queue_file_extension(filename) in {".stl", ".obj"}


def _h2d_loose_mesh_requires_sidecar(filename: str, profiles: dict) -> bool:
    return _is_loose_mesh_source(filename) and _looks_like_h2d_slice_profile(profiles)


def _h2d_sidecar_required_message() -> str:
    return (
        "H2D loose STL/OBJ slicing needs the Orca/Bambu slicer API sidecar. "
        "Flightdeck local Orca can slice this file for single-toolhead printers, "
        "but this Orca CLI build rejects the H2D loose-mesh profile path."
    )


def _slicer_model_mime(filename: str) -> str:
    lower = (filename or "").lower()
    if lower.endswith(".stl"):
        return "model/stl"
    if lower.endswith((".step", ".stp")):
        return "model/step"
    if lower.endswith(".3mf"):
        return "model/3mf"
    return "application/octet-stream"


_SLICE_SUPPORT_MODES = {
    "profile": "Profile default",
    "off": "Supports off",
    "normal_auto": "Normal auto",
    "tree_auto": "Tree auto",
    "tree_strong": "Tree strong",
}

_SLICE_BRIM_MODES = {
    "profile": "Profile default",
    "off": "No brim",
    "auto": "Auto brim",
    "outer": "Outer brim",
    "mouse_ears": "Mouse ears",
}


def _normalise_slice_support_mode(value: str | None) -> str:
    key = str(value or "").strip().lower().replace("-", "_")
    return key if key in _SLICE_SUPPORT_MODES else "profile"


def _normalise_slice_brim_mode(value: str | None) -> str:
    key = str(value or "").strip().lower().replace("-", "_")
    return key if key in _SLICE_BRIM_MODES else "profile"


def _slice_option_summary(bed_type: str | None, support_mode: str | None, brim_mode: str | None) -> dict:
    support = _normalise_slice_support_mode(support_mode)
    brim = _normalise_slice_brim_mode(brim_mode)
    return {
        "bed_type": (bed_type or "Textured PEI Plate").strip() or "Textured PEI Plate",
        "support": _SLICE_SUPPORT_MODES[support],
        "brim": _SLICE_BRIM_MODES[brim],
        "support_mode": support,
        "brim_mode": brim,
    }


def _normalise_slicer_profile_type(profile_data: bytes, category: str) -> bytes:
    profile_type = {"machine": "machine", "process": "process", "filament": "filament"}.get(category)
    if not profile_type:
        return profile_data
    try:
        profile = json.loads(profile_data.decode("utf-8-sig"))
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Selected {category} profile is not valid JSON") from exc
    if not isinstance(profile, dict):
        raise HTTPException(status_code=422, detail=f"Selected {category} profile is not a valid Orca profile")
    if profile.get("type") != profile_type:
        profile["type"] = profile_type
    encoded = json.dumps(profile, ensure_ascii=False, indent=4).encode("utf-8")
    return slice_meta.sanitize_profile_gcode_placeholders(encoded)


def _apply_slice_process_overrides(process_data: bytes, *, support_mode: str | None = "profile", brim_mode: str | None = "profile") -> bytes:
    support = _normalise_slice_support_mode(support_mode)
    brim = _normalise_slice_brim_mode(brim_mode)
    try:
        profile = json.loads(process_data.decode("utf-8-sig"))
    except Exception as exc:
        raise HTTPException(status_code=422, detail="Selected process profile could not be adjusted for supports/brim") from exc
    if not isinstance(profile, dict):
        raise HTTPException(status_code=422, detail="Selected process profile is not a valid Orca profile")

    profile["type"] = "process"
    if support == "profile" and brim == "profile":
        return json.dumps(profile, ensure_ascii=False, indent=4).encode("utf-8")

    if support == "off":
        profile["enable_support"] = "0"
    elif support == "normal_auto":
        profile["enable_support"] = "1"
        profile["support_type"] = "normal(auto)"
        profile["support_style"] = "default"
    elif support == "tree_auto":
        profile["enable_support"] = "1"
        profile["support_type"] = "tree(auto)"
        profile["support_style"] = "default"
    elif support == "tree_strong":
        profile["enable_support"] = "1"
        profile["support_type"] = "tree(auto)"
        profile["support_style"] = "tree_strong"

    if brim == "off":
        profile["enable_brim"] = "0"
        profile["brim_type"] = "no_brim"
    elif brim == "auto":
        profile["enable_brim"] = "1"
        profile["brim_type"] = "auto_brim"
    elif brim == "outer":
        profile["enable_brim"] = "1"
        profile["brim_type"] = "outer_only"
        profile.setdefault("brim_width", "5")
        profile.setdefault("brim_object_gap", "0.1")
    elif brim == "mouse_ears":
        profile["enable_brim"] = "1"
        profile["brim_type"] = "brim_ears"
        profile["brim_ears"] = "1"
        profile.setdefault("brim_ears_max_angle", "125")
        profile.setdefault("brim_ears_detection_length", "1")

    return json.dumps(profile, ensure_ascii=False, indent=4).encode("utf-8")


def _slicer_output_feature_counts(data: bytes, filename: str = "") -> dict:
    names_and_blobs: list[tuple[str, bytes]] = []
    lower_name = (filename or "").lower()
    if lower_name.endswith(".3mf") or lower_name.endswith(".gcode.3mf"):
        try:
            with zipfile.ZipFile(io.BytesIO(data)) as archive:
                for name in archive.namelist():
                    if name.lower().endswith(".gcode"):
                        names_and_blobs.append((name, archive.read(name)))
        except Exception:
            return {}
    elif lower_name.endswith(".gcode"):
        names_and_blobs.append((filename, data))

    counts: dict[str, int] = {}
    for _name, blob in names_and_blobs:
        text = blob.decode("utf-8", "ignore")
        for match in re.finditer(r"^\s*;\s*FEATURE:\s*(.+?)\s*$", text, re.MULTILINE):
            feature = match.group(1).strip()
            if feature:
                counts[feature] = counts.get(feature, 0) + 1
    return counts


def _run_orca_slice_sidecar(
    *,
    sidecar_url: str,
    filename: str,
    data: bytes,
    profiles: dict,
    output_kind: str,
    output_filename: str,
    plate: str = "1",
    all_plates: bool = False,
    arrange: bool = False,
    bed_type: str = "Textured PEI Plate",
    support_mode: str = "profile",
    brim_mode: str = "profile",
) -> tuple[str, bytes, str]:
    exe = _orca_executable()
    machine_name, machine_data = _slicer_profile_blob(str(profiles.get("printer") or ""), "machine", exe)
    process_name, process_data = _slicer_profile_blob(str(profiles.get("process") or ""), "process", exe)
    filament_name, filament_data = _slicer_profile_blob(str(profiles.get("filament") or ""), "filament", exe)
    machine_data = _normalise_slicer_profile_type(machine_data, "machine")
    process_data = _apply_slice_process_overrides(process_data, support_mode=support_mode, brim_mode=brim_mode)
    process_data = slice_meta.sanitize_profile_gcode_placeholders(process_data)
    filament_data = _normalise_slicer_profile_type(filament_data, "filament")

    safe_source = _safe_basename(filename, "flightdeck-model.stl")
    if safe_source.lower().endswith(".3mf") and not safe_source.lower().endswith(".gcode.3mf"):
        data = slice_meta.sanitize_3mf_cli_sentinels(data)
    requested = _safe_basename(output_filename, f"{_file_archive_key(safe_source)}.gcode.3mf")
    sidecar_url = sidecar_url.strip().rstrip("/")
    if not sidecar_url:
        raise HTTPException(status_code=422, detail="Slicer API URL is not set")

    form = {
        "plate": "0" if all_plates else str(plate or "1"),
        "exportType": "3mf" if output_kind == "gcode.3mf" else "gcode",
        "arrange": "true" if arrange else "false",
        "bedType": (bed_type or "Textured PEI Plate").strip() or "Textured PEI Plate",
        "requestId": f"flightdeck-{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S%f')}",
    }
    detail = ""
    try:
        with httpx.Client(timeout=httpx.Timeout(connect=4.0, read=900.0, write=60.0, pool=4.0)) as client:
            response = None
            for _attempt in range(6):
                files = [
                    ("file", (safe_source, data, _slicer_model_mime(safe_source))),
                    ("printerProfile", (machine_name, machine_data, "application/json")),
                    ("presetProfile", (process_name, process_data, "application/json")),
                    ("filamentProfile", (filament_name, filament_data, "application/json")),
                ]
                response = client.post(f"{sidecar_url}/slice", data=form, files=files)
                if response.status_code < 400:
                    break
                try:
                    payload = response.json()
                    detail = (
                        payload.get("details")
                        or payload.get("detail")
                        or payload.get("error")
                        or payload.get("message")
                        or json.dumps(payload)
                    )
                except Exception:
                    detail = response.text
                extra_vars = slice_meta.parse_unknown_gcode_vars(
                    str(detail or ""),
                    [machine_data, process_data, filament_data, data],
                )
                if not extra_vars:
                    break
                machine_data = slice_meta.sanitize_profile_gcode_placeholders(machine_data, extra_vars)
                process_data = slice_meta.sanitize_profile_gcode_placeholders(process_data, extra_vars)
                filament_data = slice_meta.sanitize_profile_gcode_placeholders(filament_data, extra_vars)
                if safe_source.lower().endswith(".3mf"):
                    data = slice_meta.sanitize_3mf_cli_sentinels(data, extra_gcode_names=extra_vars)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Slicer API unreachable: {exc}") from exc

    if response is None:
        raise HTTPException(status_code=502, detail="Slicer API returned no response")
    if response.status_code >= 400:
        if not detail:
            try:
                payload = response.json()
                detail = (
                    payload.get("details")
                    or payload.get("detail")
                    or payload.get("error")
                    or payload.get("message")
                    or json.dumps(payload)
                )
            except Exception:
                detail = response.text
        if _h2d_loose_mesh_requires_sidecar(safe_source, profiles):
            raw = str(detail or "").strip()
            lowered = raw.lower()
            if "failed to slice" in lowered or "slic3r::cli" in lowered or response.status_code >= 500:
                raise HTTPException(
                    status_code=response.status_code,
                    detail=(
                        "The slicer API sidecar is reachable, but Orca still rejected this H2D STL/OBJ slice. "
                        "That means the sidecar is running, but this loose mesh still needs manual Open Orca/export "
                        "or the next preset-bundle slicing lane. Raw slicer detail: "
                        f"{_friendly_slicer_error(raw)}"
                    ),
                )
        raise HTTPException(status_code=response.status_code, detail=_friendly_slicer_error(str(detail)))

    content_type = response.headers.get("content-type", "")
    if "application/json" in content_type:
        payload = response.json()
        encoded = payload.get("data") or payload.get("content") or payload.get("file")
        if isinstance(encoded, str):
            import base64
            try:
                decoded = base64.b64decode(encoded)
            except Exception:
                pass
            else:
                _enforce_file_size(len(decoded), label="Sliced output")
                name = payload.get("filename") or payload.get("name") or requested
                return str(name), decoded, json.dumps({k: v for k, v in payload.items() if k not in {"data", "content", "file"}})
        raise HTTPException(status_code=502, detail=_friendly_slicer_error(payload.get("details") or payload.get("error") or payload.get("message") or "Slicer API did not return a file"))

    name = (
        response.headers.get("X-Flightdeck-Sliced-Filename")
        or response.headers.get("X-Sliced-Filename")
        or _content_disposition_filename(response.headers.get("content-disposition", ""))
        or requested
    )
    if not response.content:
        raise HTTPException(status_code=502, detail="Slicer API returned an empty file")
    _enforce_file_size(len(response.content), label="Sliced output")
    return requested, response.content, f"Slicer API {response.status_code}"


def _run_orca_slice_local(
    *,
    filename: str,
    data: bytes,
    profiles: dict,
    output_kind: str,
    output_filename: str,
    plate: str = "1",
    all_plates: bool = False,
    support_mode: str = "profile",
    brim_mode: str = "profile",
) -> tuple[str, bytes, str]:
    exe = _orca_executable()
    if not exe:
        raise HTTPException(status_code=503, detail="OrcaSlicer executable not found on this machine")
    machine = _orca_profile_file(str(profiles.get("printer") or ""), "machine", exe)
    process = _orca_profile_file(str(profiles.get("process") or ""), "process", exe)
    filament = _orca_profile_file(str(profiles.get("filament") or ""), "filament", exe)

    safe_source = _safe_basename(filename, "flightdeck-model")
    if safe_source.lower().endswith(".3mf") and not safe_source.lower().endswith(".gcode.3mf"):
        data = slice_meta.sanitize_3mf_cli_sentinels(data)
    suffixes = "".join(Path(safe_source).suffixes)
    suffix = suffixes if suffixes.lower() in {".stl", ".obj", ".step", ".stp", ".3mf"} else ".stl"
    requested = _safe_basename(output_filename, f"{_file_archive_key(safe_source)}.gcode.3mf")
    with tempfile.TemporaryDirectory(prefix="flightdeck-slice-") as tmp_raw:
        tmp = Path(tmp_raw)
        source_path = tmp / f"source{suffix}"
        source_path.write_bytes(data)
        machine_for_slice = tmp / "flightdeck-machine.json"
        process_for_slice = tmp / "flightdeck-process.json"
        filament_for_slice = tmp / "flightdeck-filament.json"
        machine_for_slice.write_bytes(_normalise_slicer_profile_type(machine.read_bytes(), "machine"))
        process_for_slice.write_bytes(slice_meta.sanitize_profile_gcode_placeholders(
            _apply_slice_process_overrides(process.read_bytes(), support_mode=support_mode, brim_mode=brim_mode)
        ))
        filament_for_slice.write_bytes(_normalise_slicer_profile_type(filament.read_bytes(), "filament"))
        args = [str(exe)]
        datadir = _orca_datadir()
        if datadir:
            args += ["--datadir", str(datadir)]
        args += [
            "--load-settings", f"{machine_for_slice};{process_for_slice}",
            "--load-filaments", str(filament_for_slice),
            "--allow-newer-file",
            "--slice", "0" if all_plates else str(plate or "1"),
        ]
        if output_kind == "gcode.3mf":
            output_path = tmp / requested
            if not output_path.name.lower().endswith(".gcode.3mf"):
                output_path = output_path.with_name(f"{output_path.stem}.gcode.3mf")
            args += ["--export-3mf", str(output_path)]
        else:
            output_path = tmp / requested
            if not output_path.name.lower().endswith(".gcode"):
                output_path = output_path.with_suffix(".gcode")
            args += ["--outputdir", str(tmp)]
        args.append(str(source_path))

        proc = subprocess.run(args, text=True, capture_output=True, timeout=900)
        if proc.returncode not in (0, None):
            detail = (proc.stderr or proc.stdout or f"OrcaSlicer exited {proc.returncode}").strip()
            extra = slice_meta.parse_3mf_cli_param_keys(detail)
            if extra and suffix.lower() == ".3mf":
                retried = slice_meta.sanitize_3mf_cli_sentinels(data, extra_keys=extra)
                if retried != data:
                    source_path.write_bytes(retried)
                    proc = subprocess.run(args, text=True, capture_output=True, timeout=900)
                    if proc.returncode in (0, None):
                        detail = ""
                    else:
                        detail = (proc.stderr or proc.stdout or f"OrcaSlicer exited {proc.returncode}").strip()
            if proc.returncode not in (0, None):
                source_ext = _queue_file_extension(safe_source)
                friendly = _friendly_slicer_error(detail)
                if (
                    _looks_like_h2d_slice_profile(profiles)
                    and source_ext in {".stl", ".obj"}
                    and "slic3r::cli::run found error" in detail.lower()
                ):
                    friendly = (
                        "Orca local CLI can slice this STL for single-toolhead printers, but this Orca build rejects "
                        "the H2D loose STL slice profile. Open Orca for this H2D STL or start the Orca slicer API sidecar."
                    )
                raise HTTPException(status_code=502, detail=friendly)
        if output_kind != "gcode.3mf" and not output_path.exists():
            generated = sorted(tmp.glob("*.gcode"), key=lambda p: p.stat().st_mtime, reverse=True)
            if generated:
                output_path = generated[0]
        if not output_path.exists():
            detail = (proc.stderr or proc.stdout or "OrcaSlicer finished without creating an output file").strip()
            raise HTTPException(status_code=502, detail=_friendly_slicer_error(detail))
        _enforce_file_size(output_path.stat().st_size, label="Sliced output")
        return output_path.name, output_path.read_bytes(), (proc.stdout or proc.stderr or "").strip()[-2000:]


def _unique_library_destination(root: Path, filename: str) -> Path:
    safe = _safe_basename(filename, "flightdeck-sliced.gcode.3mf")
    dest = _safe_join_under(root, safe, missing_ok=True)
    if not dest.exists():
        return dest
    stem = dest.name
    suffix = ""
    for ext in (".gcode.3mf", ".gcode.gz", ".gcode", ".3mf"):
        if stem.lower().endswith(ext):
            stem = stem[: -len(ext)]
            suffix = ext
            break
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
    return dest.with_name(f"{stem}_{stamp}{suffix}")


@app.get("/api/slicer/profiles")
async def get_slicer_profiles():
    settings = db.get_all_settings()
    printers = await _gather_all()
    return {
        "vendors": db.get_slicer_profile_vendors(),
        "defaults": _slicer_profile_defaults(settings, printers),
        "available_vendors": _ORCA_PROFILE_VENDORS,
        "attribution": {
            "name": "OrcaSlicer standard profiles",
            "url": "https://github.com/OrcaSlicer/OrcaSlicer/tree/main/resources/profiles",
            "license": "AGPL-3.0",
        },
    }


@app.post("/api/slicer/profiles/sync")
async def sync_slicer_profiles(body: SlicerProfileSyncRequest, include_worker: bool = True):
    settings = db.get_all_settings()
    vendors = [v.strip() for v in (body.vendors or []) if v.strip()] or ["BBL", "Sovol", "Voron", "Prusa", "Anycubic"]
    vendors = [v for v in vendors if v in _ORCA_PROFILE_VENDORS]
    synced = []
    errors = []
    for vendor in vendors:
        try:
            payload = await asyncio.to_thread(_fetch_orca_profile_vendor, vendor)
            db.save_slicer_profile_vendor(vendor, payload)
            synced.append(vendor)
        except Exception as exc:
            errors.append({"vendor": vendor, "error": str(exc)})
    try:
        local = await asyncio.to_thread(_sync_local_orca_profiles)
        if any(local["added"].values()):
            db.save_slicer_profile_vendor(_ORCA_LOCAL_VENDOR, local["payload"])
            synced.append(_ORCA_LOCAL_VENDOR)
        elif not vendors:
            errors.append({"vendor": _ORCA_LOCAL_VENDOR, "error": "No local Orca profiles found"})
    except Exception as exc:
        errors.append({"vendor": _ORCA_LOCAL_VENDOR, "error": str(exc)})
    worker_url = (settings.get("orcaslicer_worker_url") or "").strip().rstrip("/")
    if include_worker and worker_url:
        worker = await asyncio.to_thread(_sync_worker_orca_profiles, worker_url)
        if worker and worker.get("payload"):
            db.save_slicer_profile_vendor(_ORCA_LOCAL_VENDOR, worker["payload"])
            if _ORCA_LOCAL_VENDOR not in synced:
                synced.append(_ORCA_LOCAL_VENDOR)
        elif worker and worker.get("error") and _ORCA_LOCAL_VENDOR not in synced:
            errors.append({"vendor": f"{_ORCA_LOCAL_VENDOR} worker", "error": worker["error"]})
    if errors and not synced:
        raise HTTPException(status_code=502, detail={"message": "Profile sync failed", "errors": errors})
    return {"ok": True, "synced": synced, "errors": errors, "vendors": db.get_slicer_profile_vendors()}


@app.post("/api/slicer/profiles/upload")
async def upload_slicer_profiles(files: list[UploadFile] = File(...)):
    if not files:
        raise HTTPException(status_code=422, detail="Profile file required")
    total = {"machines": 0, "processes": 0, "filaments": 0}
    errors = []
    payload = _custom_profile_payload()
    for file in files:
        name = (file.filename or "profile").rsplit("/", 1)[-1].rsplit("\\", 1)[-1]
        if not name.lower().endswith((".json", ".bbscfg", ".zip")):
            errors.append({"file": name, "error": "Unsupported profile file type"})
            continue
        try:
            profile_data = await _read_upload_bytes(file, limit=_MAX_PROFILE_UPLOAD_BYTES, label="Profile upload")
            parsed = await asyncio.to_thread(_parse_uploaded_slicer_profiles, name, profile_data, payload)
            payload = parsed["payload"]
            for key, count in parsed["added"].items():
                total[key] += count
        except Exception as exc:
            errors.append({"file": name, "error": str(exc)})
    if not any(total.values()) and errors:
        raise HTTPException(status_code=422, detail={"message": "No profiles imported", "errors": errors})
    db.save_slicer_profile_vendor("Custom", payload)
    return {"ok": True, "added": total, "errors": errors, "vendors": db.get_slicer_profile_vendors()}


@app.put("/api/slicer/profiles/defaults/{printer_id}")
async def put_slicer_profile_defaults(printer_id: str, body: SlicerProfileDefaultsRequest):
    printers = await _gather_all()
    if not any(p.get("id") == printer_id for p in printers):
        raise HTTPException(status_code=404, detail="Printer not found")
    db.set_setting(_slicer_profile_key(printer_id, "printer"), body.printer_profile.strip())
    db.set_setting(_slicer_profile_key(printer_id, "process"), body.process_profile.strip())
    db.set_setting(_slicer_profile_key(printer_id, "filament"), body.filament_profile.strip())
    settings = db.get_all_settings()
    return {"ok": True, "defaults": _slicer_profile_defaults(settings, printers).get(printer_id, {})}


@app.get("/api/notifications")
async def get_notifications(limit: int = 50):
    limit = max(1, min(limit, 100))
    db.clear_notifications_for_missing_printers(_active_printer_ids())
    return {
        "unread": db.unread_notification_count(),
        "items": db.list_notifications(limit=limit),
    }


@app.post("/api/notifications/read")
async def read_notifications():
    return {"ok": True, "updated": db.mark_notifications_read()}


@app.delete("/api/notifications/{notification_id}")
async def delete_notification(notification_id: int):
    if not db.clear_notification(notification_id):
        raise HTTPException(status_code=404, detail="Notification not found")
    return {"ok": True}


@app.delete("/api/notifications")
async def delete_notifications():
    return {"ok": True, "cleared": db.clear_all_notifications()}


def _label_base_url() -> str:
    return db.get_all_settings().get("system_base_url") or "https://flightdeck.tail7de73e.ts.net"


def _label_spool(spool: dict) -> dict:
    settings = db.get_all_settings()
    return {**spool, "_label_preferences": settings}


def _run_git(args: list[str], timeout: int = 8) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["git", *args],
        cwd=APP_DIR,
        text=True,
        capture_output=True,
        timeout=timeout,
    )


def _git_text(args: list[str], fallback: str = "", timeout: int = 8) -> str:
    try:
        proc = _run_git(args, timeout=timeout)
        if proc.returncode == 0:
            return proc.stdout.strip()
    except Exception:
        pass
    return fallback


_SAFE_UPDATE_DIRTY_PREFIXES = (
    "logs/",
    "tmp/",
    "temp/",
)
_SAFE_UPDATE_DIRTY_FILENAMES = {
    "00000.log",
}


def _git_dirty_entries() -> list[str]:
    # Porcelain columns include a leading space for unstaged changes. The
    # general Git text helper strips it and truncates the first filename.
    try:
        proc = _run_git(["status", "--porcelain"])
        raw = proc.stdout if proc.returncode == 0 else ""
    except Exception:
        raw = ""
    entries: list[str] = []
    for line in raw.splitlines():
        if not line.strip():
            continue
        path = line[3:].strip() if len(line) > 3 else line.strip()
        if " -> " in path:
            path = path.split(" -> ", 1)[1].strip()
        entries.append(path.replace("\\", "/"))
    return entries


def _is_safe_update_dirty_entry(path: str) -> bool:
    clean = path.strip().lstrip("./").replace("\\", "/")
    if clean in _SAFE_UPDATE_DIRTY_FILENAMES:
        return True
    if re.fullmatch(r"\d{5}\.log", clean):
        return True
    return any(clean.startswith(prefix) for prefix in _SAFE_UPDATE_DIRTY_PREFIXES)


def _blocking_git_dirty_entries() -> list[str]:
    return [path for path in _git_dirty_entries() if not _is_safe_update_dirty_entry(path)]


def _app_version_info(include_remote: bool = False) -> dict:
    branch = _git_text(["rev-parse", "--abbrev-ref", "HEAD"], "unknown")
    commit = _git_text(["rev-parse", "--short", "HEAD"], "unknown")
    dirty_entries = _blocking_git_dirty_entries()
    dirty = bool(dirty_entries)
    info = {
        "version": APP_VERSION,
        "name": APP_VERSION_NAME,
        "release_notes": APP_RELEASE_NOTES,
        "branch": branch,
        "commit": commit,
        "dirty": dirty,
        "dirty_entries": dirty_entries[:20],
        "runtime": os.environ.get("FLIGHTDECK_RUNTIME", "").strip() or ("docker" if Path("/.dockerenv").exists() else "systemd"),
        "remote": _git_text(["config", "--get", "remote.origin.url"], ""),
    }
    if include_remote and branch not in {"", "unknown", "HEAD"}:
        try:
            fetch = _run_git(["fetch", "origin", branch], timeout=20)
            info["fetch_ok"] = fetch.returncode == 0
            info["fetch_detail"] = (fetch.stderr or fetch.stdout).strip()
            local = _git_text(["rev-parse", "HEAD"], "")
            remote = _git_text(["rev-parse", f"origin/{branch}"], "")
            base = _git_text(["merge-base", "HEAD", f"origin/{branch}"], "")
            info["remote_commit"] = remote[:7] if remote else ""
            info["behind"] = bool(local and remote and local != remote and base == local)
            info["ahead"] = bool(local and remote and local != remote and base == remote)
            info["diverged"] = bool(local and remote and local != remote and base not in {local, remote})
        except Exception as exc:
            info["fetch_ok"] = False
            info["fetch_detail"] = str(exc)
    return info


def _setup_check(
    key: str,
    label: str,
    ok: bool,
    detail: str,
    level: str | None = None,
    optional: bool = False,
) -> dict:
    if level is None:
        level = "ok" if ok else ("optional" if optional else "warn")
    return {"key": key, "label": label, "ok": ok, "level": level, "detail": detail, "optional": optional}


_TESTED_FFMPEG_MAJOR_VERSIONS = {"5", "6", "7", "8"}
_TESTED_FFMPEG_DETAIL = "Tested with Raspberry Pi OS/Debian apt FFmpeg 5.x and Gyan Windows FFmpeg 8.x"


def _ffmpeg_compatibility() -> dict:
    ffmpeg_path = shutil.which("ffmpeg")
    if not ffmpeg_path:
        return {
            "available": False,
            "tested": False,
            "version_line": "",
            "detail": "ffmpeg not found; Bambu camera streams will not work",
        }
    try:
        proc = subprocess.run(
            [ffmpeg_path, "-version"],
            capture_output=True,
            text=True,
            timeout=5,
            check=False,
        )
        version_line = (proc.stdout or proc.stderr or "").splitlines()[0].strip()
    except Exception as exc:
        return {
            "available": True,
            "tested": False,
            "version_line": "",
            "detail": f"{ffmpeg_path} found but version check failed: {exc}",
        }
    match = re.search(r"ffmpeg version\s+([0-9]+)(?:\.([0-9]+))?", version_line, re.IGNORECASE)
    major = match.group(1) if match else ""
    tested = bool(major in _TESTED_FFMPEG_MAJOR_VERSIONS)
    return {
        "available": True,
        "tested": tested,
        "version_line": version_line,
        "detail": f"{version_line} ({_TESTED_FFMPEG_DETAIL if tested else 'untested FFmpeg major version for Flightdeck camera proxy'})",
    }


def _is_writable_dir(path: Path) -> bool:
    path.mkdir(parents=True, exist_ok=True)
    probe = path / ".flightdeck-write-test"
    try:
        probe.write_text("ok", encoding="utf-8")
        probe.unlink(missing_ok=True)
        return True
    except Exception:
        return False


_DIAGNOSTIC_MAX_TEXT_BYTES = 320 * 1024
_DIAGNOSTIC_SECRET_KEY_RE = re.compile(
    r"(access[_-]?code|serial|token|secret|password|passwd|passcode|api[_-]?key|mqtt[_-]?password)",
    re.IGNORECASE,
)
_DIAGNOSTIC_ASSIGNMENT_RE = re.compile(
    r"^(\s*(?:[A-Za-z0-9_.-]*(?:access[_-]?code|serial|token|secret|password|passwd|passcode|api[_-]?key|mqtt[_-]?password)[A-Za-z0-9_.-]*)\s*[:=]\s*).*$",
    re.IGNORECASE | re.MULTILINE,
)


def _diagnostic_redact_value(key: str, value):
    if _DIAGNOSTIC_SECRET_KEY_RE.search(str(key or "")):
        return "[redacted]"
    if isinstance(value, dict):
        return {k: _diagnostic_redact_value(k, v) for k, v in value.items()}
    if isinstance(value, list):
        return [_diagnostic_redact_value(key, item) for item in value]
    return value


def _diagnostic_redact_text(text: str) -> str:
    return _DIAGNOSTIC_ASSIGNMENT_RE.sub(r"\1[redacted]", text)


def _diagnostic_tail_text(path: Path, max_bytes: int = _DIAGNOSTIC_MAX_TEXT_BYTES) -> str:
    data = path.read_bytes()
    if len(data) > max_bytes:
        data = data[-max_bytes:]
        prefix = f"[truncated to last {max_bytes} bytes from {path}]\n"
    else:
        prefix = ""
    return prefix + _diagnostic_redact_text(data.decode("utf-8", errors="replace"))


def _diagnostic_json(value) -> str:
    return json.dumps(value, indent=2, sort_keys=True, default=_dt_default) + "\n"


def _diagnostic_support_field(value, max_len: int = 4000) -> str:
    text = str(value or "")
    text = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", " ", text).strip()
    if len(text) > max_len:
        text = text[:max_len].rstrip() + "\n[truncated]"
    return text


def _diagnostic_support_payload(payload: dict | None) -> dict:
    payload = payload or {}
    fields = {
        "name": 200,
        "email": 320,
        "problem": 4000,
        "expected": 4000,
        "notes": 4000,
    }
    return {key: _diagnostic_support_field(payload.get(key), max_len) for key, max_len in fields.items()}


def _diagnostic_support_text(support: dict) -> str:
    labels = [
        ("name", "Name"),
        ("email", "Email"),
        ("problem", "Problem / what happened"),
        ("expected", "Expected / what they were trying to do"),
        ("notes", "Extra notes"),
    ]
    lines = ["Flightdeck support request", ""]
    for key, label in labels:
        value = support.get(key) or ""
        lines.extend([label, value or "(blank)", ""])
    lines.append("Send this zip to flightdeck3dprinters@gmail.com.")
    return "\n".join(lines) + "\n"


def _diagnostic_recent_decisions(limit: int = 250) -> list[dict]:
    try:
        with sqlite3.connect(DB_PATH) as conn:
            conn.row_factory = sqlite3.Row
            rows = conn.execute(
                """SELECT id, print_id, printer_id, event, detail, logged_at
                   FROM decisions
                   ORDER BY logged_at DESC
                   LIMIT ?""",
                (limit,),
            ).fetchall()
        return [dict(row) for row in rows]
    except Exception as exc:
        return [{"error": str(exc)}]


def _diagnostic_recent_notifications(limit: int = 120) -> list[dict]:
    try:
        return db.list_notifications(limit=limit, include_cleared=True)
    except Exception as exc:
        return [{"error": str(exc)}]


def _diagnostic_command(name: str, args: list[str], timeout: int = 5) -> tuple[str, str]:
    try:
        proc = subprocess.run(args, text=True, capture_output=True, timeout=timeout)
        output = (proc.stdout or "") + (("\n" + proc.stderr) if proc.stderr else "")
        if not output.strip():
            output = f"{name} exited {proc.returncode} with no output\n"
        if name == "journal-flightdeck.txt" and (
            "No journal files were opened due to insufficient permissions" in output
            or "Hint: You are currently not seeing messages" in output
        ):
            output += (
                "\nFlightdeck could not read systemd journal logs from the running service user.\n"
                "Refresh the systemd unit with scripts/install-systemd.sh, or run:\n"
                "  sudo usermod -aG systemd-journal flightdeck\n"
                "  sudo systemctl restart flightdeck\n"
            )
        return name, _diagnostic_redact_text(output)
    except Exception as exc:
        return name, f"{name} unavailable: {exc}\n"


def _journal_status() -> tuple[bool, str]:
    runtime = os.environ.get("FLIGHTDECK_RUNTIME", "").strip().lower()
    if os.name == "nt" or runtime in {"windows", "tray", "windows-tray"}:
        return True, "Windows runtime"
    if runtime in {"docker", "container", "portainer"} or Path("/.dockerenv").exists():
        return True, "Container-managed logs"
    try:
        proc = subprocess.run(
            ["journalctl", "-u", "flightdeck.service", "-n", "1", "--no-pager", "--quiet"],
            text=True,
            capture_output=True,
            timeout=3,
        )
        output = (proc.stdout or "") + (("\n" + proc.stderr) if proc.stderr else "")
        if "No journal files were opened due to insufficient permissions" in output:
            return False, "Service user cannot read journal logs; rerun scripts/install-systemd.sh or add flightdeck to systemd-journal"
        return proc.returncode == 0, "Readable" if proc.returncode == 0 else (output.strip() or f"journalctl exited {proc.returncode}")
    except Exception as exc:
        return False, str(exc)


async def _diagnostic_bundle_bytes(support: dict | None = None) -> bytes:
    now = datetime.now(timezone.utc)
    support_payload = _diagnostic_support_payload(support) if support is not None else None
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        def add_text(name: str, text: str) -> None:
            zf.writestr(name, text)

        add_text("README.txt", "\n".join([
            "Flightdeck diagnostic bundle",
            f"Generated: {now.isoformat()}",
            "",
            "This bundle is intended for support/debugging.",
            "Known secret-like settings are redacted, but review before sharing publicly.",
            "",
        ]))
        if support_payload is not None:
            add_text("support-request.txt", _diagnostic_support_text(support_payload))
            add_text("support-request.json", _diagnostic_json({
                "generated_at": now.isoformat(),
                "contact": {
                    "name": support_payload.get("name", ""),
                    "email": support_payload.get("email", ""),
                },
                "problem": support_payload.get("problem", ""),
                "expected": support_payload.get("expected", ""),
                "notes": support_payload.get("notes", ""),
            }))
        add_text("version.json", _diagnostic_json(_app_version_info(include_remote=False)))
        add_text("instance.json", _diagnostic_json({
            "app": "flightdeck",
            "version": APP_VERSION,
            "version_name": APP_VERSION_NAME,
            "address": _local_ipv4(),
            "hardware": _hardware_label(),
            "runtime": os.environ.get("FLIGHTDECK_RUNTIME", "").strip() or ("docker" if Path("/.dockerenv").exists() else "systemd"),
            "host": _host_health(),
            "camera_workers": _camera_worker_status(),
        }))
        add_text("setup-health.json", _diagnostic_json(await setup_health()))
        add_text("settings.redacted.json", _diagnostic_json(_diagnostic_redact_value("", db.get_all_settings())))
        add_text("recent-decisions.json", _diagnostic_json(_diagnostic_recent_decisions()))
        add_text("recent-notifications.json", _diagnostic_json(_diagnostic_recent_notifications()))

        if PRINTERS_CONFIG_PATH.exists():
            add_text("printers.redacted.yaml", _diagnostic_tail_text(PRINTERS_CONFIG_PATH, max_bytes=512 * 1024))
        else:
            add_text("printers.redacted.yaml", f"Missing printer config: {PRINTERS_CONFIG_PATH}\n")

        env_keys = {
            key: value
            for key, value in os.environ.items()
            if key.startswith("FLIGHTDECK_") or key in {"PATH", "PYTHONPATH", "LOCALAPPDATA"}
        }
        add_text("environment.redacted.json", _diagnostic_json(_diagnostic_redact_value("", env_keys)))

        log_dirs = [DATA_DIR / "logs", APP_DIR / "logs"]
        seen_logs: set[Path] = set()
        for log_dir in log_dirs:
            if not log_dir.exists():
                continue
            for path in sorted(log_dir.glob("*.log"), key=lambda p: p.stat().st_mtime if p.exists() else 0, reverse=True)[:8]:
                resolved = path.resolve()
                if resolved in seen_logs or not path.is_file():
                    continue
                seen_logs.add(resolved)
                add_text(f"logs/{path.name}", _diagnostic_tail_text(path))

        for name, args in [
            ("git-status.txt", ["git", "-C", str(APP_DIR), "status", "--short", "--branch"]),
            ("git-log.txt", ["git", "-C", str(APP_DIR), "log", "--oneline", "-20"]),
            ("python-version.txt", [shutil.which("python") or "python", "--version"]),
            ("ffmpeg-version.txt", [shutil.which("ffmpeg") or "ffmpeg", "-version"]),
        ]:
            command_name, output = _diagnostic_command(name, args)
            add_text(f"commands/{command_name}", output)

        if os.name != "nt":
            for name, args in [
                ("systemd-flightdeck.txt", ["systemctl", "status", "flightdeck.service", "--no-pager"]),
                ("journal-flightdeck.txt", ["journalctl", "-u", "flightdeck.service", "-n", "250", "--no-pager"]),
                ("processes.txt", ["ps", "-eo", "pid,ppid,comm,args"]),
            ]:
                command_name, output = _diagnostic_command(name, args, timeout=8)
                add_text(f"commands/{command_name}", output)

    return buffer.getvalue()


@app.get("/api/setup/logs/download")
async def download_setup_logs():
    data = await _diagnostic_bundle_bytes()
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    return Response(
        content=data,
        media_type="application/zip",
        headers={
            "Content-Disposition": f'attachment; filename="flightdeck-diagnostics-{stamp}.zip"',
            "Cache-Control": "no-store",
        },
    )


@app.post("/api/setup/logs/support")
async def download_support_logs(body: SupportBundleRequest):
    support = body.model_dump()
    required = {
        "name": "Name",
        "email": "Email",
        "problem": "Problem / what happened",
    }
    missing = [label for key, label in required.items() if not _diagnostic_support_field(support.get(key))]
    if missing:
        raise HTTPException(status_code=422, detail=f"Please fill in: {', '.join(missing)}")
    data = await _diagnostic_bundle_bytes(support=support)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    return Response(
        content=data,
        media_type="application/zip",
        headers={
            "Content-Disposition": f'attachment; filename="flightdeck-support-{stamp}.zip"',
            "Cache-Control": "no-store",
        },
    )


def _systemd_status() -> tuple[bool, str]:
    runtime = os.environ.get("FLIGHTDECK_RUNTIME", "").strip().lower()
    if runtime in {"docker", "container", "portainer"} or Path("/.dockerenv").exists():
        manager = os.environ.get("FLIGHTDECK_SERVICE_MANAGER", "Docker / Portainer").strip()
        return True, f"{manager} managed"
    if runtime in {"windows", "tray", "windows-tray"}:
        manager = os.environ.get("FLIGHTDECK_SERVICE_MANAGER", "Windows tray").strip()
        return True, f"{manager} managed"
    try:
        active = subprocess.run(
            ["systemctl", "is-active", "flightdeck.service"],
            text=True,
            capture_output=True,
            timeout=2,
        )
        enabled = subprocess.run(
            ["systemctl", "is-enabled", "flightdeck.service"],
            text=True,
            capture_output=True,
            timeout=2,
        )
        state = active.stdout.strip() or active.stderr.strip() or "unknown"
        enable_state = enabled.stdout.strip() or enabled.stderr.strip() or "unknown"
        return active.returncode == 0, f"{state}, {enable_state}"
    except Exception as exc:
        return False, str(exc)


def _local_ipv4() -> str:
    configured = os.environ.get("FLIGHTDECK_HOST_ADDRESS", "").strip()
    if configured:
        return configured
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
            sock.connect(("8.8.8.8", 80))
            return sock.getsockname()[0]
    except Exception:
        pass
    try:
        output = subprocess.run(
            ["hostname", "-I"],
            text=True,
            capture_output=True,
            timeout=2,
        ).stdout
        for token in output.split():
            if "." in token and not token.startswith("127."):
                return token
    except Exception:
        pass
    return socket.gethostname()


def _ram_label() -> str:
    try:
        meminfo = Path("/proc/meminfo").read_text(encoding="utf-8", errors="ignore")
        match = re.search(r"^MemTotal:\s+(\d+)\s+kB", meminfo, re.MULTILINE)
        if not match:
            return ""
        gib = int(match.group(1)) / 1024 / 1024
        for size in (2, 4, 8, 16, 32, 64):
            if gib <= size + 0.5:
                return f"{size}GB"
        return f"{round(gib)}GB"
    except Exception:
        return ""


def _hardware_label() -> str:
    configured = (
        os.environ.get("FLIGHTDECK_INSTANCE_NAME", "").strip()
        or os.environ.get("FLIGHTDECK_HARDWARE_LABEL", "").strip()
    )
    if configured:
        return configured
    try:
        model = Path("/proc/device-tree/model").read_text(encoding="utf-8", errors="ignore").strip("\x00\n ")
    except Exception:
        model = ""
    ram = _ram_label()
    if model.startswith("Raspberry Pi"):
        model = re.sub(r"\s+Rev\s+.*$", "", model)
        model = model.replace("Raspberry ", "")
        return " ".join(part for part in (model, ram) if part)
    if Path("/.dockerenv").exists():
        manager = os.environ.get("FLIGHTDECK_SERVICE_MANAGER", "").strip()
        return manager or "Container"
    return " ".join(part for part in (socket.gethostname(), ram) if part) or "Local host"


def _camera_worker_status() -> dict:
    expected_max = max(0, len(_cam_proxies))
    try:
        proc = subprocess.run(
            ["ps", "-eo", "pid=,ppid=,comm=,args="],
            text=True,
            capture_output=True,
            timeout=2,
        )
        workers = [
            line.strip()
            for line in proc.stdout.splitlines()
            if "ffmpeg" in line and "streaming/live" in line and "image2pipe" in line
        ]
    except Exception as exc:
        return {
            "count": None,
            "expected_max": expected_max,
            "ok": False,
            "detail": str(exc),
        }
    count = len(workers)
    ok = count <= expected_max
    detail = f"{count} active Bambu camera worker{'s' if count != 1 else ''}"
    if expected_max:
        detail += f" (expected <= {expected_max})"
    if not ok:
        detail += "; run scripts/clear-camera-workers.sh"
    return {
        "count": count,
        "expected_max": expected_max,
        "ok": ok,
        "detail": detail,
    }


def _memory_status() -> dict:
    try:
        meminfo = Path("/proc/meminfo").read_text(encoding="utf-8", errors="ignore")
        values: dict[str, int] = {}
        for line in meminfo.splitlines():
            if ":" not in line:
                continue
            key, raw = line.split(":", 1)
            parts = raw.strip().split()
            if not parts:
                continue
            try:
                values[key] = int(parts[0]) * 1024
            except ValueError:
                continue
        total = values.get("MemTotal", 0)
        available = values.get("MemAvailable", 0)
        used = max(0, total - available) if total else 0
        return {
            "total": total,
            "available": available,
            "used": used,
            "pct": round((used / total) * 100, 1) if total else None,
        }
    except Exception as exc:
        return {"error": str(exc)}


def _load_status() -> dict:
    try:
        one, five, fifteen = os.getloadavg()
        cores = os.cpu_count() or 1
        return {
            "one": round(one, 2),
            "five": round(five, 2),
            "fifteen": round(fifteen, 2),
            "cores": cores,
            "pct": round((one / cores) * 100, 1) if cores else None,
        }
    except Exception as exc:
        return {"error": str(exc)}


def _disk_status() -> dict:
    path = DATA_DIR if DATA_DIR.exists() else APP_DIR
    try:
        usage = shutil.disk_usage(path)
        used = usage.total - usage.free
        return {
            "path": str(path),
            "total": usage.total,
            "free": usage.free,
            "used": used,
            "pct": round((used / usage.total) * 100, 1) if usage.total else None,
        }
    except Exception as exc:
        return {"path": str(path), "error": str(exc)}


def _host_health() -> dict:
    return {
        "load": _load_status(),
        "memory": _memory_status(),
        "disk": _disk_status(),
    }


@app.get("/api/instance")
async def instance_info():
    return {
        "app": "flightdeck",
        "version": APP_VERSION,
        "version_name": APP_VERSION_NAME,
        "address": _local_ipv4(),
        "hardware": _hardware_label(),
        "runtime": os.environ.get("FLIGHTDECK_RUNTIME", "").strip() or ("docker" if Path("/.dockerenv").exists() else "systemd"),
        "host": _host_health(),
        "camera_workers": _camera_worker_status(),
    }


def _tailnet_hint(url: str) -> tuple[bool, str]:
    if not url:
        return False, "No base URL configured"
    if ".ts.net" in url or "tailscale" in url.lower():
        return True, url
    return True, f"{url} (LAN or custom URL)"


@app.get("/api/update/status")
async def update_status(check_remote: bool = False):
    return _app_version_info(include_remote=check_remote)


@app.post("/api/update")
async def run_update():
    info = _app_version_info(include_remote=False)
    if info.get("dirty"):
        entries = info.get("dirty_entries") or []
        suffix = f": {', '.join(entries[:5])}" if entries else ""
        raise HTTPException(status_code=409, detail=f"Local changes are present. Commit or stash them before updating{suffix}.")
    branch = str(info.get("branch") or "")
    if branch in {"", "unknown", "HEAD"}:
        raise HTTPException(status_code=409, detail="Flightdeck is not on a named Git branch.")
    try:
        proc = _run_git(["pull", "--ff-only", "origin", branch], timeout=120)
    except FileNotFoundError:
        raise HTTPException(status_code=500, detail="Git is not installed or not on PATH.")
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=504, detail="Git update timed out.")
    detail = (proc.stdout or proc.stderr or "").strip()
    if proc.returncode != 0:
        raise HTTPException(status_code=502, detail=detail or "Git update failed.")
    updated = _app_version_info(include_remote=False)
    return {
        "ok": True,
        "message": detail or "Already up to date.",
        "version": updated,
        "restart_required": True,
    }


@app.get("/api/setup/health")
async def setup_health():
    settings = db.get_all_settings()
    checks: list[dict] = []

    checks.append(_setup_check(
        "app_dir",
        "App checkout",
        APP_DIR.exists(),
        str(APP_DIR),
    ))
    checks.append(_setup_check(
        "data_dir",
        "Data directory",
        DATA_DIR.exists() and os.access(DATA_DIR, os.R_OK | os.W_OK),
        f"{DATA_DIR} ({'portable' if DATA_DIR != APP_DIR else 'repo-local legacy mode'})",
        level="ok" if DATA_DIR.exists() and os.access(DATA_DIR, os.R_OK | os.W_OK) else "warn",
    ))
    db_ok = False
    db_detail = str(DB_PATH)
    try:
        with sqlite3.connect(DB_PATH) as conn:
            conn.execute("SELECT 1").fetchone()
        db_ok = True
    except Exception as exc:
        db_detail = f"{DB_PATH} ({exc})"
    checks.append(_setup_check("database", "SQLite database", db_ok, db_detail))

    checks.append(_setup_check(
        "uploads",
        "Uploads directory",
        _is_writable_dir(UPLOADS_DIR),
        str(UPLOADS_DIR),
    ))
    checks.append(_setup_check(
        "print_library",
        "Print Vault",
        _is_writable_dir(_print_library_path()),
        str(_print_library_path()),
    ))
    backup_script = APP_DIR / "scripts" / "backup-flightdeck-data.sh"
    restore_script = APP_DIR / "scripts" / "restore-flightdeck-data.sh"
    backup_ok = backup_script.exists() and restore_script.exists()
    checks.append(_setup_check(
        "backup",
        "Backup tools",
        backup_ok,
        f"{backup_script}" if backup_ok else "Backup/restore scripts not found",
        optional=True,
    ))

    try:
        config = load()
        printer_count = len(config.printers)
        checks.append(_setup_check(
            "printer_config",
            "Printer config",
            printer_count > 0,
            f"{PRINTERS_CONFIG_PATH} ({printer_count} printer{'s' if printer_count != 1 else ''})",
        ))
        ntfy_ok = bool(config.ntfy and config.ntfy.topic)
        checks.append(_setup_check(
            "ntfy",
            "ntfy alerts",
            ntfy_ok,
            f"{config.ntfy.url} / {config.ntfy.topic}" if ntfy_ok else "Not configured",
            optional=True,
        ))
    except Exception as exc:
        checks.append(_setup_check("printer_config", "Printer config", False, f"{PRINTERS_CONFIG_PATH} ({exc})"))
        checks.append(_setup_check("ntfy", "ntfy alerts", False, "Unavailable until printer config loads", optional=True))

    base_ok, base_detail = _tailnet_hint(settings.get("system_base_url", ""))
    checks.append(_setup_check("base_url", "Base URL", base_ok, base_detail))

    slicer_api_url = str(settings.get("orcaslicer_api_url") or "").strip()
    slicer_api = await _probe_slicer_api(slicer_api_url) if slicer_api_url else {
        "configured": False,
        "ok": False,
        "detail": "Not configured",
    }
    checks.append(_setup_check(
        "slicer_api",
        "Slicer API sidecar",
        bool(slicer_api.get("ok")),
        str(slicer_api.get("detail") or "Unavailable"),
        level="ok" if slicer_api.get("ok") else "warn",
        optional=True,
    ))

    scale_status = _scale.is_available()
    checks.append(_setup_check(
        "scale",
        "Dymo scale",
        scale_status,
        "Detected" if scale_status else (_scale.last_error or "Not detected"),
        optional=True,
    ))
    label_status = _label_printer.status()
    checks.append(_setup_check(
        "label_printer",
        f"{label_status.model} label printer",
        label_status.available,
        "Detected" if label_status.available else (label_status.last_error or "Not detected"),
        optional=True,
    ))
    camera_workers = _camera_worker_status()
    camera_workers_ok = bool(camera_workers.get("ok"))
    checks.append(_setup_check(
        "camera_workers",
        "Camera workers",
        camera_workers_ok,
        str(camera_workers.get("detail") or "Unavailable"),
        level="ok" if camera_workers_ok else "warn",
        optional=True,
    ))
    ffmpeg = _ffmpeg_compatibility()
    checks.append(_setup_check(
        "ffmpeg",
        "FFmpeg camera driver",
        bool(ffmpeg.get("available") and ffmpeg.get("tested")),
        str(ffmpeg.get("detail") or "Unknown"),
        level="ok" if ffmpeg.get("tested") else "warn",
        optional=True,
    ))

    systemd_ok, systemd_detail = _systemd_status()
    container_managed = "managed" in systemd_detail.lower()
    service_label = "Container service" if container_managed else "systemd service"
    checks.append(_setup_check(
        "systemd",
        service_label,
        systemd_ok,
        systemd_detail,
        level="ok" if container_managed and systemd_ok else None,
        optional=not container_managed,
    ))
    journal_ok, journal_detail = _journal_status()
    checks.append(_setup_check(
        "journal",
        "Journal logs",
        journal_ok,
        journal_detail,
        level="ok" if journal_ok else "warn",
        optional=True,
    ))

    required = [c for c in checks if not c["optional"]]
    optional = [c for c in checks if c["optional"]]
    status = "ready" if all(c["ok"] for c in required) else "needs_attention"
    return {
        "status": status,
        "summary": {
            "required_ok": sum(1 for c in required if c["ok"]),
            "required_total": len(required),
            "optional_ok": sum(1 for c in optional if c["ok"]),
            "optional_total": len(optional),
        },
        "paths": {
            "app_dir": str(APP_DIR),
            "data_dir": str(DATA_DIR),
            "database": str(DB_PATH),
            "uploads": str(UPLOADS_DIR),
            "printer_config": str(PRINTERS_CONFIG_PATH),
            "print_vault": str(_print_library_path()),
            "backup_script": str(APP_DIR / "scripts" / "backup-flightdeck-data.sh"),
        },
        "checks": checks,
    }


# ── Scale and label hardware ──────────────────────────────────────────────

@app.get("/api/scale/status")
async def get_scale_status():
    available = _scale.is_available()
    return {
        "available": available,
        "model": "Dymo M10",
        "last_error": None if available else _scale.last_error,
        "keep_awake": {
            "enabled": _scale_keep_awake_enabled(),
            "interval_s": _scale_keep_awake_interval(),
            "method": _scale.last_keep_awake_method,
            "units_gpio": os.getenv("FLIGHTDECK_SCALE_UNITS_GPIO") or None,
            "last_ping_at": datetime.fromtimestamp(_scale.last_keep_awake_at).isoformat() if _scale.last_keep_awake_at else None,
        },
    }


@app.post("/api/scale/keep-awake")
async def keep_scale_awake():
    ok = await asyncio.to_thread(_scale.keep_awake_ping)
    return {
        "ok": ok,
        "last_error": None if ok else _scale.last_error,
        "method": _scale.last_keep_awake_method,
        "last_ping_at": datetime.fromtimestamp(_scale.last_keep_awake_at).isoformat() if _scale.last_keep_awake_at else None,
    }


async def _read_scale_stable_async(timeout_s: float = 12.0):
    try:
        return await asyncio.wait_for(asyncio.to_thread(_scale.read_stable), timeout=timeout_s)
    except asyncio.TimeoutError:
        _scale.last_error = f"Scale read timed out after {timeout_s:.0f}s"
        return None


@app.get("/api/scale/read")
async def read_scale():
    reading = await _read_scale_stable_async()
    if not reading:
        message = _scale.last_error or "Scale unavailable"
        db.log_decision("system", "scale_unavailable", message)
        _notify("warn", "Scale unavailable", message, link="#/settings/hardware")
        raise HTTPException(status_code=503, detail=message)
    db.log_decision("system", "scale_read", f"{reading.grams:.1f}g")
    return asdict(reading)


@app.get("/api/label_printer/status")
async def get_label_printer_status():
    return asdict(_label_printer.status())


@app.post("/api/label_printer/print/{spool_id}")
async def print_spool_label(spool_id: int):
    spool = db.get_spool(spool_id)
    if not spool:
        raise HTTPException(status_code=404, detail="Spool not found")
    ok = await asyncio.to_thread(_label_printer.print_spool_label, _label_spool(spool), _label_base_url())
    if not ok:
        message = _label_printer.last_error or "Label printer unavailable"
        db.log_decision("system", "label_print_failed", f"Spool #{spool_id}: {message}")
        _notify("warn", "Label print failed", f"Spool #{spool_id}: {message}", link="#/settings/hardware")
        raise HTTPException(status_code=503, detail=message)
    db.log_decision("system", "label_printed", f"Spool #{spool_id}")
    return {"ok": True}


@app.post("/api/label_printer/print/{spool_id}/compact")
async def print_compact_spool_label(spool_id: int):
    spool = db.get_spool(spool_id)
    if not spool:
        raise HTTPException(status_code=404, detail="Spool not found")
    ok = await asyncio.to_thread(_label_printer.print_compact_spool_label, _label_spool(spool), _label_base_url())
    if not ok:
        message = _label_printer.last_error or "Label printer unavailable"
        db.log_decision("system", "label_print_failed", f"Compact spool #{spool_id}: {message}")
        _notify("warn", "Label print failed", f"Spool #{spool_id}: {message}", link="#/settings/hardware")
        raise HTTPException(status_code=503, detail=message)
    db.log_decision("system", "label_printed", f"Compact spool #{spool_id}")
    return {"ok": True}


@app.post("/api/label_printer/location/{location_id}")
async def print_location_label(location_id: int):
    location = next((loc for loc in db.get_spool_locations(include_archived=True) if int(loc["id"]) == int(location_id)), None)
    if not location:
        raise HTTPException(status_code=404, detail="Location not found")
    ok = await asyncio.to_thread(_label_printer.print_location_label, location, _label_base_url())
    if not ok:
        message = _label_printer.last_error or "Label printer unavailable"
        db.log_decision("system", "label_print_failed", f"Location {location.get('name') or location_id}: {message}")
        _notify("warn", "Label print failed", f"{location.get('name') or location_id}: {message}", link="#/settings/hardware")
        raise HTTPException(status_code=503, detail=message)
    db.log_decision("system", "label_printed", f"Location {location.get('name') or location_id}")
    return {"ok": True}


@app.post("/api/label_printer/home/{location_id}")
async def print_home_slot_label(location_id: int):
    location = next((loc for loc in db.get_spool_locations(include_archived=True) if int(loc["id"]) == int(location_id)), None)
    if not location:
        raise HTTPException(status_code=404, detail="Location not found")
    ok = await asyncio.to_thread(_label_printer.print_home_slot_label, location)
    if not ok:
        message = _label_printer.last_error or "Label printer unavailable"
        db.log_decision("system", "label_print_failed", f"Home {location.get('name') or location_id}: {message}")
        _notify("warn", "Label print failed", f"{location.get('name') or location_id}: {message}", link="#/settings/hardware")
        raise HTTPException(status_code=503, detail=message)
    db.log_decision("system", "label_printed", f"Home {location.get('name') or location_id}")
    return {"ok": True}


@app.post("/api/label_printer/drawer/{drawer}")
async def print_drawer_banner(drawer: int):
    if drawer < 1 or drawer > 6:
        raise HTTPException(status_code=400, detail="Drawer must be 1–6")
    ok = await asyncio.to_thread(_label_printer.print_drawer_banner, drawer)
    if not ok:
        message = _label_printer.last_error or "Label printer unavailable"
        db.log_decision("system", "label_print_failed", f"Drawer D{drawer}: {message}")
        _notify("warn", "Label print failed", f"D{drawer}: {message}", link="#/settings/hardware")
        raise HTTPException(status_code=503, detail=message)
    db.log_decision("system", "label_printed", f"Drawer D{drawer} banner")
    return {"ok": True}


@app.post("/api/label_printer/drawer/{drawer}/row/{row}")
async def print_drawer_row_label(drawer: int, row: int):
    if drawer < 1 or drawer > 6 or row < 1 or row > 3:
        raise HTTPException(status_code=400, detail="Drawer must be 1–6 and row 1–3")
    ok = await asyncio.to_thread(_label_printer.print_drawer_row_label, drawer, row)
    if not ok:
        message = _label_printer.last_error or "Label printer unavailable"
        db.log_decision("system", "label_print_failed", f"D{drawer} R{row}: {message}")
        _notify("warn", "Label print failed", f"D{drawer} R{row}: {message}", link="#/settings/hardware")
        raise HTTPException(status_code=503, detail=message)
    db.log_decision("system", "label_printed", f"D{drawer} R{row} row label")
    return {"ok": True}


@app.post("/api/label_printer/test")
async def print_test_label():
    ok = await asyncio.to_thread(_label_printer.print_test_label)
    if not ok:
        message = _label_printer.last_error or "Label printer unavailable"
        db.log_decision("system", "label_printer_unavailable", message)
        _notify("warn", "Label printer unavailable", message, link="#/settings/hardware")
        raise HTTPException(status_code=503, detail=message)
    db.log_decision("system", "label_printed", "Test label")
    return {"ok": True}


# ── Filament tracking ─────────────────────────────────────────────────────

class CostUpdate(BaseModel):
    cost_per_gram: float
    comment: Optional[str] = None
    empty_spool_weight_g: Optional[float] = None


class ColourMatchTarget(BaseModel):
    id: Optional[str] = None
    hex: str
    label: Optional[str] = None


class ColourMatchRequest(BaseModel):
    hex: Optional[str] = None
    targets: Optional[list[ColourMatchTarget]] = None
    material: Optional[str] = "low"
    brand: Optional[str] = None
    limit: int = 12
    include_inventory: bool = True
    prefer_inventory_pct: float = 2.0


class EmptySpoolProfileUpdate(BaseModel):
    brand: str = ""
    material: Optional[str] = None
    profile_name: str
    empty_spool_weight_g: float
    source: Optional[str] = "manual"
    notes: Optional[str] = None
    is_default: bool = False


OPEN_FILAMENT_CSV_BASES = [
    "https://api.openfilamentdatabase.org/csv",
    "https://openfilamentcollective.github.io/open-filament-database/csv",
]
SIDDAMENT_PRODUCTS_URL = "https://siddament.com.au/products.json"
SIDDAMENT_PRODUCT_BASE_URL = "https://siddament.com.au/products"
SIDDAMENT_FILAMENT_TYPES = {
    "PLA": ("PLA", None),
    "PLA PRO": ("PLA+", "Pro"),
    "PLA MATTE": ("PLA", "Matte"),
    "PLA SILK": ("PLA", "Silk"),
    "PLA SINGLE ROLL": ("PLA", "Single Roll"),
    "PLA SILK DUAL COLOR": ("PLA", "Silk Dual Colour"),
    "PLA SILK TRI-COLOR": ("PLA", "Silk Tri Colour"),
    "PLA RAINBOW": ("PLA", "Rainbow"),
    "PLA STARLIGHT": ("PLA", "Starlight"),
    "PLA MARBLE": ("PLA", "Marble"),
    "PLA LUMINOUS": ("PLA", "Luminous"),
    "PLA WOODEN": ("PLA", "Wood"),
    "PLA-CFRP-CF": ("PLA-CF", "Carbon Fibre"),
    "LW PLA": ("PLA", "LW"),
    "HTPLA": ("HTPLA", None),
    "PETG": ("PETG", None),
    "PETG DUAL COLOR": ("PETG", "Dual Colour"),
    "PETG SINGLE ROLL": ("PETG", "Single Roll"),
    "ASA": ("ASA", None),
    "ABS": ("ABS", None),
    "ABS PRO": ("ABS", "Pro"),
    "TPU": ("TPU", None),
    "TPU 95A": ("TPU", "95A"),
    "SILK TPU 95A": ("TPU", "Silk 95A"),
    "SHOEFLEX": ("TPU", "ShoeFlex"),
    "PCTG": ("PCTG", None),
    "PC": ("PC", None),
    "PCCF": ("PC-CF", None),
    "PA12 CF": ("PA12-CF", None),
    "PA6 CF": ("PA6-CF", None),
    "PPA CF": ("PPA-CF", None),
    "FILAMENT": ("PLA", None),
}
SIDDAMENT_NON_FILAMENT_TAGS = {"hidden", "printed-parts", "surcharge"}
SIDDAMENT_COLOUR_HEX = {
    "BLACK": "#111111",
    "WHITE": "#F8FAFC",
    "PURE WHITE": "#FFFFFF",
    "GREY": "#808080",
    "GRAY": "#808080",
    "SILVER": "#C0C0C0",
    "RED": "#EF4444",
    "ORANGE": "#F97316",
    "YELLOW": "#EAB308",
    "GOLD": "#B8860B",
    "GREEN": "#22C55E",
    "PEAK GREEN": "#8EDD65",
    "BLUE": "#3B82F6",
    "NAVY BLUE": "#0F2A44",
    "PURPLE": "#8B5CF6",
    "PINK": "#EC4899",
    "HOT PINK": "#FF4F8B",
    "BROWN": "#7C4B00",
    "BEIGE": "#D8C6A5",
    "NATURAL": "#E7E5DA",
    "TRANSPARENT": "#DDEEFF",
    "CLEAR": "#DDEEFF",
    "CARBON FIBRE": "#202020",
    "CARBON FIBER": "#202020",
}


def _catalog_float(value: object) -> Optional[float]:
    try:
        text = str(value or "").strip()
        return float(text) if text else None
    except Exception:
        return None


def _catalog_rows(name: str) -> list[dict]:
    last_error: Optional[Exception] = None
    headers = {
        "User-Agent": "Flightdeck/1.0 filament-catalog-sync",
        "Accept": "text/csv,*/*",
    }
    for base in OPEN_FILAMENT_CSV_BASES:
        url = f"{base}/{name}.csv"
        try:
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=45) as resp:
                text = resp.read().decode("utf-8-sig")
            return list(csv.DictReader(io.StringIO(text)))
        except Exception as exc:
            last_error = exc
            _app_log.warning("catalogue fetch failed for %s: %s", url, exc)
    raise RuntimeError(f"Could not fetch {name}.csv: {last_error}")


def _siddament_tags(product: dict) -> list[str]:
    tags = product.get("tags") or []
    if isinstance(tags, str):
        return [t.strip() for t in tags.split(",") if t.strip()]
    if isinstance(tags, list):
        return [str(t).strip() for t in tags if str(t).strip()]
    return []


def _siddament_material(product: dict) -> tuple[Optional[str], Optional[str]]:
    product_type = str(product.get("product_type") or "").strip().upper()
    title = str(product.get("title") or "").strip()
    tags = _siddament_tags(product)
    if product_type in SIDDAMENT_FILAMENT_TYPES:
        material, subtype = SIDDAMENT_FILAMENT_TYPES[product_type]
    else:
        text = " ".join([product_type, title, " ".join(tags)]).upper()
        material, subtype = None, None
        for key in sorted(SIDDAMENT_FILAMENT_TYPES, key=len, reverse=True):
            if re.search(rf"\b{re.escape(key)}\b", text):
                material, subtype = SIDDAMENT_FILAMENT_TYPES[key]
                break
        if not material:
            return None, None
    title_upper = title.upper()
    if "PLA+" in title_upper or "PLA PLUS" in title_upper:
        material = "PLA+"
    if "CARBON FIB" in title_upper and material in {"PLA", "PETG", "ASA", "ABS", "PC"}:
        subtype = "Carbon Fibre" if not subtype else subtype
    return material, subtype


def _siddament_colour(product: dict) -> tuple[str, str]:
    title = str(product.get("title") or "").strip()
    tags = _siddament_tags(product)
    candidates = tags + [title]
    for candidate in candidates:
        upper = str(candidate or "").upper()
        for name in sorted(SIDDAMENT_COLOUR_HEX, key=len, reverse=True):
            if re.search(rf"\b{re.escape(name)}\b", upper):
                label = name.title().replace("Pla", "PLA").replace("Petg", "PETG")
                return label, SIDDAMENT_COLOUR_HEX[name]
    cleaned = re.sub(
        r"\b(PLA\+?|PLA PLUS|PETG|ASA|ABS|TPU|PCTG|PC|PA12|PA6|PPA|CF|CARBON|FIB(?:RE|ER)|MATTE|SILK|PRO|NORMAL|FILAMENT)\b",
        "",
        title,
        flags=re.I,
    )
    cleaned = re.sub(r"[-_/]+", " ", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned).strip(" -")
    return (cleaned or "Siddament colour"), "#808080"


def _siddament_filament_weight(title: str, variant: dict) -> Optional[float]:
    text = " ".join([title, str(variant.get("title") or ""), str(variant.get("sku") or "")])
    match = re.search(r"\b(\d+(?:\.\d+)?)\s*kg\b", text, flags=re.I)
    if match:
        return float(match.group(1)) * 1000
    match = re.search(r"\b(\d{3,4})\s*g\b", text, flags=re.I)
    if match:
        return float(match.group(1))
    grams = _catalog_float(variant.get("grams"))
    if grams:
        if 2500 <= grams <= 3600:
            return 3000.0
        if 1100 <= grams <= 1800:
            return 1000.0
        if 650 <= grams <= 950:
            return 500.0
    return None


def _siddament_subtype(product: dict, material: str, fallback: Optional[str]) -> Optional[str]:
    title = str(product.get("title") or "").strip()
    bits = []
    if fallback:
        bits.append(fallback)
    title_upper = title.upper()
    for label, pattern in [
        ("Matte", r"\bMATTE\b"),
        ("Silk", r"\bSILK\b"),
        ("Carbon Fibre", r"\bCARBON FIB(?:RE|ER)\b|\bCF\b"),
        ("Glass Fibre", r"\bGLASS FIB(?:RE|ER)\b|\bGF\b"),
        ("Dual Colour", r"\bDUAL COLOU?R\b"),
        ("Tri Colour", r"\bTRI[-\s]?COLOU?R\b"),
        ("Translucent", r"\bTRANSLUCENT\b|\bTRANSPARENT\b"),
        ("Wood", r"\bWOOD(?:EN)?\b"),
        ("Marble", r"\bMARBLE\b"),
        ("Glow", r"\bGLOW\b|\bLUMINOUS\b"),
        ("Sparkle", r"\bSPARKLE\b|STARDUST|STARLIGHT"),
    ]:
        if re.search(pattern, title_upper) and label not in bits:
            bits.append(label)
    if material == "PLA+" and "PLA+" not in bits:
        bits.insert(0, "PLA+")
    return " ".join(bits) or None


def _sync_siddament_catalog() -> dict:
    rows: list[dict] = []
    page = 1
    headers = {
        "User-Agent": "Flightdeck/1.0 Siddament filament-catalog-sync",
        "Accept": "application/json,*/*",
    }
    while page <= 20:
        url = f"{SIDDAMENT_PRODUCTS_URL}?limit=250&page={page}"
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=45) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
        products = payload.get("products") or []
        if not products:
            break
        for product in products:
            tags = _siddament_tags(product)
            tag_keys = {t.strip().lower() for t in tags}
            if tag_keys & SIDDAMENT_NON_FILAMENT_TAGS:
                continue
            material, base_subtype = _siddament_material(product)
            if not material:
                continue
            title = str(product.get("title") or "").strip()
            colour_name, colour_hex = _siddament_colour(product)
            subtype = _siddament_subtype(product, material, base_subtype)
            product_url = f"{SIDDAMENT_PRODUCT_BASE_URL}/{product.get('handle')}" if product.get("handle") else ""
            variants = product.get("variants") or [{}]
            for variant in variants:
                if variant.get("requires_shipping") is False:
                    continue
                filament_weight = _siddament_filament_weight(title, variant)
                gross_weight = _catalog_float(variant.get("grams"))
                tare = None
                if gross_weight and filament_weight and gross_weight > filament_weight:
                    tare = round(gross_weight - filament_weight, 1)
                variant_title = str(variant.get("title") or "").strip()
                row_colour = colour_name
                if variant_title and variant_title.lower() != "default title":
                    row_colour = f"{colour_name} {variant_title}".strip()
                traits = {
                    "source": "Siddament Shopify products.json",
                    "product_url": product_url,
                    "sku": variant.get("sku") or "",
                    "barcode": variant.get("barcode") or "",
                    "price_aud": variant.get("price"),
                    "available": bool(variant.get("available")),
                    "product_type": product.get("product_type") or "",
                    "tags": tags,
                    "gross_weight_g": gross_weight,
                    "shop_updated_at": product.get("updated_at") or variant.get("updated_at") or "",
                }
                rows.append({
                    "source_variant_id": str(variant.get("id") or product.get("id") or ""),
                    "source_filament_id": str(product.get("id") or ""),
                    "brand": "Siddament",
                    "material": material,
                    "product": title,
                    "subtype": subtype,
                    "color_name": row_colour,
                    "color_hex": colour_hex,
                    "filament_weight_g": filament_weight,
                    "empty_spool_weight_g": tare,
                    "diameter": 1.75,
                    "traits": json.dumps(traits, sort_keys=True),
                    "discontinued": (not bool(variant.get("available", True))) or ("discontinued" in tag_keys),
                })
        page += 1
    count = db.replace_filament_catalog(rows, source="siddament")
    db.log_decision("system", "filament_catalog_synced", f"Siddament rows imported: {count}")
    return {"ok": True, "imported": count, **db.get_filament_catalog_status("siddament")}


def _sync_open_filament_catalog() -> dict:
    brands = {r["id"]: r for r in _catalog_rows("brands")}
    filaments = {r["id"]: r for r in _catalog_rows("filaments")}
    variants = _catalog_rows("variants")
    sizes_by_variant: dict[str, list[dict]] = {}
    for row in _catalog_rows("sizes"):
        sizes_by_variant.setdefault(row.get("variant_id") or "", []).append(row)

    rows: list[dict] = []
    for variant in variants:
        color_hex = (variant.get("color_hex") or "").strip().upper()
        if not re.fullmatch(r"#[0-9A-F]{6}", color_hex):
            continue
        filament = filaments.get(variant.get("filament_id") or "")
        if not filament:
            continue
        brand = brands.get(filament.get("brand_id") or "", {})
        product = filament.get("name") or ""
        product_bits = product.replace("-", " ").split()
        material = (filament.get("material") or "").upper()
        subtype = " ".join(bit for bit in product_bits if bit.upper() != material) or product or None
        sizes = sizes_by_variant.get(variant.get("id") or "") or [{}]
        for size in sizes:
            diameter = _catalog_float(size.get("diameter"))
            if diameter and abs(diameter - 1.75) > 0.01:
                continue
            rows.append({
                "source_variant_id": variant.get("id"),
                "source_filament_id": filament.get("id"),
                "brand": brand.get("name") or "",
                "material": material,
                "product": product,
                "subtype": subtype,
                "color_name": variant.get("name") or "",
                "color_hex": color_hex,
                "filament_weight_g": _catalog_float(size.get("filament_weight")),
                "empty_spool_weight_g": _catalog_float(size.get("empty_spool_weight")),
                "diameter": diameter,
                "traits": variant.get("traits"),
                "discontinued": (variant.get("discontinued") == "1" or filament.get("discontinued") == "1" or size.get("discontinued") == "1"),
            })
    count = db.replace_filament_catalog(rows)
    db.log_decision("system", "filament_catalog_synced", f"Open Filament Database rows imported: {count}")
    return {"ok": True, "imported": count, **db.get_filament_catalog_status()}


@app.get("/api/filament/costs")
async def get_filament_costs():
    return db.get_material_costs()


@app.get("/api/filament/catalog/status")
async def get_filament_catalog_status(source: str = "open_filament_database"):
    if source == "all":
        return {
            "sources": [
                db.get_filament_catalog_status("open_filament_database"),
                db.get_filament_catalog_status("siddament"),
            ]
        }
    return db.get_filament_catalog_status(source)


@app.post("/api/filament/catalog/sync")
async def sync_filament_catalog(source: str = "all"):
    source = (source or "all").strip().lower()
    syncers = {
        "open_filament_database": _sync_open_filament_catalog,
        "ofd": _sync_open_filament_catalog,
        "siddament": _sync_siddament_catalog,
    }
    if source not in {"all", *syncers.keys()}:
        raise HTTPException(status_code=422, detail=f"Unknown catalogue source: {source}")
    targets = [("open_filament_database", _sync_open_filament_catalog), ("siddament", _sync_siddament_catalog)]
    if source != "all":
        target_name = "open_filament_database" if source == "ofd" else source
        targets = [(target_name, syncers[source])]
    results: list[dict] = []
    errors: list[dict] = []
    for name, syncer in targets:
        try:
            result = await asyncio.to_thread(syncer)
            result["source"] = name
            results.append(result)
        except Exception as exc:
            _app_log.exception("%s filament catalog sync failed", name)
            errors.append({"source": name, "error": str(exc)})
    if not results:
        detail = "; ".join(f"{e['source']}: {e['error']}" for e in errors) or "Catalogue sync failed"
        _notify("warn", "Filament catalogue sync failed", detail, link="#/settings/filament")
        raise HTTPException(status_code=502, detail=f"Filament catalogue sync failed: {detail}")
    imported = sum(int(r.get("imported") or 0) for r in results)
    if errors:
        _notify("warn", "Filament catalogue partially synced", "; ".join(f"{e['source']}: {e['error']}" for e in errors), link="#/spools?view=catalogue")
    return {"ok": not errors, "imported": imported, "results": results, "errors": errors}


@app.get("/api/filament/catalog/search")
async def search_filament_catalog(q: str = "", brand: str = "", material: str = "", limit: int = 25):
    return db.search_filament_catalog(q=q, brand=brand, material=material, limit=limit)


_HEX_MAX_DIST = (3 * 255 * 255) ** 0.5  # ~441.67
# LAB + chroma/hue score ceiling used only by Colour Match % display.
_COLOUR_MATCH_MAX_DIST = 80.0


def _catalogue_traits(raw: object) -> dict:
    if isinstance(raw, dict):
        return raw
    if not raw:
        return {}
    try:
        parsed = json.loads(str(raw))
        return parsed if isinstance(parsed, dict) else {}
    except Exception:
        return {}


def _match_pct(delta: float) -> int:
    """Map Colour Match distance → 0–100% (LAB/chroma score, not raw RGB)."""
    if _COLOUR_MATCH_MAX_DIST <= 0:
        return 0
    return max(0, min(100, int(round(100.0 * (1.0 - float(delta) / _COLOUR_MATCH_MAX_DIST)))))


def _srgb_to_linear(c: float) -> float:
    c = float(c) / 255.0
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def _hex_to_lab(hex_value: str) -> Optional[tuple[float, float, float]]:
    hx = _norm_hex(hex_value)
    if not hx:
        return None
    r, g, b = (int(hx[i:i + 2], 16) for i in (1, 3, 5))
    rl, gl, bl = _srgb_to_linear(r), _srgb_to_linear(g), _srgb_to_linear(b)
    x = rl * 0.4124564 + gl * 0.3575761 + bl * 0.1804375
    y = rl * 0.2126729 + gl * 0.7151522 + bl * 0.0721750
    z = rl * 0.0193339 + gl * 0.1191920 + bl * 0.9503041
    xr, yr, zr = x / 0.95047, y / 1.00000, z / 1.08883

    def _f(t: float) -> float:
        return t ** (1 / 3) if t > 0.008856 else (7.787 * t) + (16 / 116)

    fx, fy, fz = _f(xr), _f(yr), _f(zr)
    return ((116 * fy) - 16, 500 * (fx - fy), 200 * (fy - fz))


def _colour_match_dist(target_hex: str, candidate_hex: str) -> float:
    """Perceptual distance for filament matching.

    RGB Euclidean distance collapses dark reds toward black. Use CIE Lab ΔE
    plus chroma/hue penalties so blood-red stays red, not Hatchbox Black.
    Lower is better.
    """
    tlab = _hex_to_lab(target_hex)
    clab = _hex_to_lab(candidate_hex)
    if not tlab or not clab:
        return 999.0
    de = (
        (tlab[0] - clab[0]) ** 2
        + (tlab[1] - clab[1]) ** 2
        + (tlab[2] - clab[2]) ** 2
    ) ** 0.5
    tc = (tlab[1] ** 2 + tlab[2] ** 2) ** 0.5
    cc = (clab[1] ** 2 + clab[2] ** 2) ** 0.5
    if tc >= 8:
        chroma_pen = max(0.0, (tc - cc) * 1.35)
        if cc < 6:
            chroma_pen += 18.0
        th = (math.degrees(math.atan2(tlab[2], tlab[1])) + 360.0) % 360.0
        ch = (math.degrees(math.atan2(clab[2], clab[1])) + 360.0) % 360.0
        dh = abs(th - ch)
        dh = min(dh, 360.0 - dh)
        hue_w = min(1.0, cc / max(tc, 1e-6))
        hue_pen = (dh / 180.0) * 28.0 * max(0.25, hue_w) if cc >= 4 else 12.0
    else:
        chroma_pen = abs(tc - cc) * 0.35
        hue_pen = 0.0
    return de + chroma_pen + hue_pen


def _colour_match_label(color: Optional[str]) -> str:
    """Human label that keeps dark chromatic colours (e.g. blood red) off 'Black'."""
    lab = _hex_to_lab(color or "")
    if not lab:
        return "Unknown colour"
    L, a, b = lab
    chroma = (a * a + b * b) ** 0.5
    hue = (math.degrees(math.atan2(b, a)) + 360.0) % 360.0
    if chroma < 8:
        if L <= 20:
            return "Black"
        if L >= 85:
            return "White"
        return "Grey"
    if L <= 35 and chroma >= 12:
        if 15 <= hue <= 70:
            return "Blood red" if a >= 12 else "Dark brown"
        if hue >= 330 or hue <= 15:
            return "Blood red"
    # Fall back to nearest named swatch in Lab space.
    best_name, best_d = "Colour", 1e9
    for name, ref in _COLOUR_NAMES:
        rlab = _hex_to_lab(ref)
        if not rlab:
            continue
        d = ((L - rlab[0]) ** 2 + (a - rlab[1]) ** 2 + (b - rlab[2]) ** 2) ** 0.5
        if d < best_d:
            best_name, best_d = name, d
    return best_name if best_d <= 45 else (_norm_hex(color) or "Colour")


# Colour Match never mixes low-temp with high-temp (PLA/PETG vs ABS/ASA).
_COLOUR_MATCH_LOW_TEMP = frozenset({"PLA", "PLA+", "PETG"})
_COLOUR_MATCH_HIGH_TEMP = frozenset({"ABS", "ASA"})


def _colour_match_material_filter(material: Optional[str]) -> tuple[str, list[str], str]:
    """Resolve UI material → (key, allowed materials, human label).

    Low-temp (PLA / PLA+ / PETG) may share a print. High-temp (ABS / ASA) stay together.
    Cross-family mixes are blocked. Bare "all" falls back to low-temp.
    """
    raw = (material or "").strip()
    key = raw.lower().replace("_", " ").replace("-", " ")
    if key in {"", "all", "*", "low", "low temp", "lowtemp"}:
        mats = sorted(_COLOUR_MATCH_LOW_TEMP)
        return "low", mats, "Low temp (PLA / PETG)"
    if key in {"high", "high temp", "hightemp"}:
        mats = sorted(_COLOUR_MATCH_HIGH_TEMP)
        return "high", mats, "High temp (ABS / ASA)"
    mat = raw.upper()
    if mat in _COLOUR_MATCH_LOW_TEMP or mat == "PLA+":
        # PLA / PETG selections search the whole low-temp family so substitutes
        # stay printable together — never pull in ABS/ASA.
        mats = sorted(_COLOUR_MATCH_LOW_TEMP)
        return "low", mats, "Low temp (PLA / PETG)"
    if mat in _COLOUR_MATCH_HIGH_TEMP:
        mats = sorted(_COLOUR_MATCH_HIGH_TEMP)
        return "high", mats, "High temp (ABS / ASA)"
    return mat.lower(), [mat], mat


def _colour_match_catalog_rows(target: str, catalog_rows: list, top_n: int) -> list[dict]:
    matches: list[dict] = []
    for row in catalog_rows:
        candidate = _norm_hex(row.get("color_hex"))
        if not candidate:
            continue
        delta = _colour_match_dist(target, candidate)
        traits = _catalogue_traits(row.get("traits"))
        price = traits.get("price_aud")
        try:
            price_aud = float(price) if price not in (None, "") else None
        except (TypeError, ValueError):
            price_aud = None
        matches.append({
            "brand": row.get("brand") or "",
            "material": row.get("material") or "",
            "product": row.get("product"),
            "subtype": row.get("subtype"),
            "color_name": row.get("color_name") or "",
            "color_hex": candidate,
            "filament_weight_g": row.get("filament_weight_g"),
            "empty_spool_weight_g": row.get("empty_spool_weight_g"),
            "delta": round(float(delta), 2),
            "match_pct": _match_pct(delta),
            "product_url": traits.get("product_url") or None,
            "price_aud": price_aud,
            "sku": traits.get("sku") or None,
            "source": row.get("source") or "",
        })
    matches.sort(key=lambda item: (item["delta"], item.get("brand") or "", item.get("color_name") or ""))
    return matches[:top_n]


def _colour_match_inventory_rows(
    target: str,
    spools: list,
    materials: Optional[list],
    brand: str,
    top_n: int,
) -> list[dict]:
    mat_ok = {str(m).strip().upper() for m in (materials or []) if str(m).strip()} or None
    if mat_ok and "PLA" in mat_ok:
        mat_ok.add("PLA+")
    matches: list[dict] = []
    for spool in spools:
        spool_mat = str(spool.get("material") or "").upper()
        if mat_ok is not None and spool_mat not in mat_ok:
            continue
        if brand and brand.lower() not in str(spool.get("brand") or "").lower():
            continue
        candidate = _norm_hex(spool.get("color_hex"))
        if not candidate:
            continue
        delta = _colour_match_dist(target, candidate)
        matches.append({
            "id": spool.get("id"),
            "display_id": spool.get("display_id"),
            "brand": spool.get("brand") or "",
            "material": spool.get("material") or "",
            "subtype": spool.get("subtype"),
            "color_name": spool.get("color_name") or "",
            "color_hex": candidate,
            "remaining_g": spool.get("remaining_g"),
            "location_printer_id": spool.get("location_printer_id"),
            "location_slot": spool.get("location_slot"),
            "storage_location_name": spool.get("storage_location_name"),
            "delta": round(float(delta), 2),
            "match_pct": _match_pct(delta),
        })
    matches.sort(key=lambda item: (item["delta"], -(item.get("remaining_g") or 0)))
    return matches[:top_n]


def _colour_match_recommendation(
    inventory_matches: list[dict],
    catalog_matches: list[dict],
    prefer_inventory_pct: float = 2.0,
) -> dict:
    """Prefer truest colour; use shelf when within prefer_inventory_pct of best buy."""
    inv = inventory_matches[0] if inventory_matches else None
    cat = catalog_matches[0] if catalog_matches else None
    prefer = max(0.0, float(prefer_inventory_pct or 0))
    if inv and cat:
        gap = float(cat.get("match_pct") or 0) - float(inv.get("match_pct") or 0)
        if gap <= prefer:
            return {
                "action": "use_inventory",
                "reason": (
                    f"Shelf is only {gap:.0f}% under the closest buy — use what you have"
                    if gap > 0
                    else "Shelf match is as close or closer than the best buy"
                ),
                "gap_pct": round(gap, 1),
                "prefer_inventory_pct": prefer,
                "inventory": inv,
                "catalog": cat,
            }
        return {
            "action": "order",
            "reason": f"Best buy is {gap:.0f}% closer than shelf — order for a truer colour",
            "gap_pct": round(gap, 1),
            "prefer_inventory_pct": prefer,
            "inventory": inv,
            "catalog": cat,
        }
    if inv:
        return {
            "action": "use_inventory",
            "reason": "Closest match is already on the shelf",
            "gap_pct": 0.0,
            "prefer_inventory_pct": prefer,
            "inventory": inv,
            "catalog": None,
        }
    if cat:
        return {
            "action": "order",
            "reason": "No inventory match — order the closest catalogue colour",
            "gap_pct": None,
            "prefer_inventory_pct": prefer,
            "inventory": None,
            "catalog": cat,
        }
    return {
        "action": "none",
        "reason": "No inventory or catalogue matches",
        "gap_pct": None,
        "prefer_inventory_pct": prefer,
        "inventory": None,
        "catalog": None,
    }


def _colour_match_payload(
    hex_value: Optional[str] = None,
    material: Optional[str] = None,
    brand: Optional[str] = None,
    limit: int = 12,
    include_inventory: bool = True,
    targets: Optional[list] = None,
    prefer_inventory_pct: float = 2.0,
) -> dict:
    target_items: list[dict] = []
    for raw in targets or []:
        if isinstance(raw, dict):
            hx = raw.get("hex")
            tid = raw.get("id")
            label = raw.get("label")
        else:
            hx = getattr(raw, "hex", None)
            tid = getattr(raw, "id", None)
            label = getattr(raw, "label", None)
        norm = _norm_hex(hx)
        if not norm:
            continue
        target_items.append({
            "id": tid or f"t-{len(target_items) + 1}",
            "hex": norm,
            "label": (label or "").strip() or f"Pick {len(target_items) + 1}",
        })

    primary = _norm_hex(hex_value) or (target_items[0]["hex"] if target_items else "")
    if not primary:
        raise HTTPException(status_code=422, detail="Invalid hex colour (expected #RRGGBB)")

    mat_key, mat_list, mat_label = _colour_match_material_filter(material)
    br = (brand or "").strip()
    if br.lower() in {"", "all", "*"}:
        br = ""
    top_n = max(1, min(int(limit or 12), 40))
    prefer = max(0.0, min(float(prefer_inventory_pct or 0), 20.0))

    catalog_rows = db.list_filament_catalog_for_colour_match(
        brand=br, materials=mat_list, limit=8000
    )
    spools = db.get_spools(include_archived=False) if include_inventory else []

    catalog_matches = _colour_match_catalog_rows(primary, catalog_rows, top_n)
    inventory_matches = (
        _colour_match_inventory_rows(primary, spools, mat_list, br, top_n) if include_inventory else []
    )
    recommendation = _colour_match_recommendation(inventory_matches, catalog_matches, prefer)

    palette: list[dict] = []
    for item in target_items:
        inv_rows = (
            _colour_match_inventory_rows(item["hex"], spools, mat_list, br, top_n)
            if include_inventory else []
        )
        cat_rows = _colour_match_catalog_rows(item["hex"], catalog_rows, top_n)
        rec = _colour_match_recommendation(inv_rows, cat_rows, prefer)
        palette.append({
            "id": item["id"],
            "hex": item["hex"],
            "label": item["label"],
            "colour_label": _colour_match_label(item["hex"]),
            "recommendation": rec,
            "inventory_best": inv_rows[0] if inv_rows else None,
            "catalog_best": cat_rows[0] if cat_rows else None,
        })

    use_count = sum(1 for p in palette if p["recommendation"]["action"] == "use_inventory")
    order_count = sum(1 for p in palette if p["recommendation"]["action"] == "order")

    status = {
        "sources": [
            db.get_filament_catalog_status("open_filament_database"),
            db.get_filament_catalog_status("siddament"),
        ]
    }
    catalog_count = sum(int(s.get("count") or 0) for s in status["sources"])
    return {
        "ok": True,
        "hex": primary,
        "material": mat_key,
        "material_label": mat_label,
        "materials": mat_list,
        "brand": br or None,
        "label": _colour_match_label(primary),
        "catalog_matches": catalog_matches,
        "inventory_matches": inventory_matches,
        "recommendation": recommendation,
        "prefer_inventory_pct": prefer,
        "palette": palette,
        "palette_summary": {
            "total": len(palette),
            "use_inventory": use_count,
            "order": order_count,
            "none": len(palette) - use_count - order_count,
        },
        "catalog_count": catalog_count,
        "catalog_status": status,
    }


@app.get("/api/filament/colour-match")
async def get_filament_colour_match(
    hex: str = "",
    material: str = "low",
    brand: str = "",
    limit: int = 12,
    include_inventory: bool = True,
    prefer_inventory_pct: float = 2.0,
):
    return _colour_match_payload(
        hex_value=hex,
        material=material,
        brand=brand,
        limit=limit,
        include_inventory=include_inventory,
        prefer_inventory_pct=prefer_inventory_pct,
    )


@app.post("/api/filament/colour-match")
async def post_filament_colour_match(body: ColourMatchRequest):
    return _colour_match_payload(
        hex_value=body.hex,
        material=body.material,
        brand=body.brand,
        limit=body.limit,
        include_inventory=body.include_inventory,
        targets=body.targets,
        prefer_inventory_pct=body.prefer_inventory_pct,
    )


@app.put("/api/filament/costs/{material}/{brand}")
async def put_filament_cost(material: str, brand: str, body: CostUpdate):
    db.set_material_cost(material, brand, body.cost_per_gram, body.comment, body.empty_spool_weight_g)
    return {"ok": True}

@app.delete("/api/filament/costs/{material}/{brand}")
async def delete_filament_cost(material: str, brand: str):
    db.delete_material_cost(material, brand)
    return {"ok": True}

@app.get("/api/empty-spool-profiles")
async def get_empty_spool_profiles(include_archived: bool = False):
    return db.get_empty_spool_profiles(include_archived=include_archived)

@app.post("/api/empty-spool-profiles")
async def create_empty_spool_profile(body: EmptySpoolProfileUpdate):
    try:
        item = db.create_empty_spool_profile(
            body.brand,
            body.material,
            body.profile_name,
            body.empty_spool_weight_g,
            body.source,
            body.notes,
            body.is_default,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    return item

@app.put("/api/empty-spool-profiles/{profile_id}")
async def update_empty_spool_profile(profile_id: int, body: EmptySpoolProfileUpdate):
    try:
        item = db.update_empty_spool_profile(
            profile_id,
            body.brand,
            body.material,
            body.profile_name,
            body.empty_spool_weight_g,
            body.source,
            body.notes,
            body.is_default,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    if not item:
        raise HTTPException(status_code=404, detail="Empty spool profile not found")
    return item

@app.delete("/api/empty-spool-profiles/{profile_id}")
async def delete_empty_spool_profile(profile_id: int):
    if not db.archive_empty_spool_profile(profile_id):
        raise HTTPException(status_code=404, detail="Empty spool profile not found")
    return {"ok": True}

@app.get("/api/filament/summary")
async def get_filament_summary():
    return db.get_filament_summary()

@app.get("/api/filament/summary/{printer_id}")
async def get_filament_summary_printer(printer_id: str):
    return db.get_filament_summary(printer_id)


# ── Spools ───────────────────────────────────────────────────────────────

class SpoolCreate(BaseModel):
    material: str
    brand: str
    color_hex: str
    label_weight_g: float
    remaining_g: Optional[float] = None
    subtype: Optional[str] = None
    color_name: Optional[str] = None
    color_hex_2: Optional[str] = None
    color_hex_3: Optional[str] = None
    color_scheme: Optional[str] = "solid"
    location_printer_id: Optional[str] = None
    location_slot: Optional[int] = None
    storage_location_id: Optional[int] = None
    notes: Optional[str] = None
    empty_spool_weight_g: Optional[float] = None

class SpoolUpdate(BaseModel):
    material: Optional[str] = None
    brand: Optional[str] = None
    subtype: Optional[str] = None
    color_hex: Optional[str] = None
    color_name: Optional[str] = None
    color_hex_2: Optional[str] = None
    color_hex_3: Optional[str] = None
    color_scheme: Optional[str] = None
    label_weight_g: Optional[float] = None
    remaining_g: Optional[float] = None
    empty_spool_weight_g: Optional[float] = None
    notes: Optional[str] = None

class AmsSlotProfileOverride(BaseModel):
    profile_name: Optional[str] = None
    tray_type: Optional[str] = None
    tray_info_idx: Optional[str] = None
    brand: Optional[str] = None
    color: Optional[str] = None
    nozzle_temp_min: Optional[int] = None
    nozzle_temp_max: Optional[int] = None

class SpoolMove(BaseModel):
    printer_id: Optional[str] = None
    slot: Optional[int] = None
    storage_location_id: Optional[int] = None
    replace_existing: bool = False
    ams_profile: Optional[AmsSlotProfileOverride] = None
    sync_ams: bool = False

class SpoolTrustPrinter(BaseModel):
    printer_id: str
    slot: int
    storage_location_id: Optional[int] = None

class SpoolLocationBody(BaseModel):
    name: str
    notes: Optional[str] = None

class SpoolWeightCorrection(BaseModel):
    remaining_g: Optional[float] = None
    reading_g: Optional[float] = None
    empty_spool_weight_g: Optional[float] = None

class SpoolUsageReconcile(BaseModel):
    remaining_g: Optional[float] = None
    start_remaining_g: Optional[float] = None
    exclusive: bool = False
    reading_g: Optional[float] = None
    empty_spool_weight_g: Optional[float] = None

class SpoolUsageCorrection(BaseModel):
    to_spool_id: int
    grams: Optional[float] = None
    note: Optional[str] = None

class SpoolUsageAssignment(BaseModel):
    spool_id: int
    grams: Optional[float] = None
    note: Optional[str] = None

class IncomingStockLine(BaseModel):
    quantity: int = 1
    material: str
    brand: str
    subtype: Optional[str] = None
    color_hex: str = "#808080"
    color_name: Optional[str] = None
    color_hex_2: Optional[str] = None
    color_hex_3: Optional[str] = None
    color_scheme: Optional[str] = "solid"
    label_weight_g: float = 1000
    empty_spool_weight_g: Optional[float] = None
    storage_location_id: Optional[int] = None
    notes: Optional[str] = None

class IncomingStockOrderCreate(BaseModel):
    supplier: Optional[str] = None
    order_ref: Optional[str] = None
    notes: Optional[str] = None
    lines: list[IncomingStockLine]

class IncomingStockReceive(BaseModel):
    restock_spool_id: Optional[int] = None
    restock_display_id: Optional[int] = None
    storage_location_id: Optional[int] = None
    remaining_g: Optional[float] = None
    label_weight_g: Optional[float] = None
    empty_spool_weight_g: Optional[float] = None
    notes: Optional[str] = None
    print_label: bool = True

class IncomingStockRollUpdate(BaseModel):
    material: Optional[str] = None
    brand: Optional[str] = None
    subtype: Optional[str] = None
    color_hex: Optional[str] = None
    color_name: Optional[str] = None
    color_hex_2: Optional[str] = None
    color_hex_3: Optional[str] = None
    color_scheme: Optional[str] = None
    label_weight_g: Optional[float] = None
    empty_spool_weight_g: Optional[float] = None
    storage_location_id: Optional[int] = None
    notes: Optional[str] = None

class IncomingStockCancel(BaseModel):
    reason: Optional[str] = None

@app.get("/api/spools/summary")
async def get_spools_summary():
    return db.get_spools_summary()

@app.get("/api/spools/intelligence")
async def get_spool_intelligence(days: int = 30):
    return db.get_spool_intelligence(days)

@app.get("/api/stock-in/orders")
async def get_incoming_stock_orders(limit: int = 20):
    return db.get_incoming_stock_orders(limit)

@app.post("/api/stock-in/orders")
async def create_incoming_stock_order(body: IncomingStockOrderCreate):
    lines = []
    for line in body.lines:
        item = line.model_dump()
        item["quantity"] = max(1, min(int(item.get("quantity") or 1), 100))
        if not (item.get("material") or "").strip():
            raise HTTPException(status_code=400, detail="Material required")
        if not (item.get("brand") or "").strip():
            raise HTTPException(status_code=400, detail="Brand required")
        lines.append(item)
    try:
        return db.create_incoming_stock_order(body.supplier, body.order_ref, body.notes, lines)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

@app.get("/api/stock-in/rolls/{token}")
async def get_incoming_stock_roll(token: str):
    roll = db.get_incoming_stock_roll(token)
    if not roll:
        raise HTTPException(status_code=404, detail="Incoming roll not found")
    return roll

@app.put("/api/stock-in/rolls/{token}")
async def update_incoming_stock_roll(token: str, body: IncomingStockRollUpdate):
    fields = body.model_dump(exclude_unset=True)
    if "material" in fields and not (fields.get("material") or "").strip():
        raise HTTPException(status_code=400, detail="Material required")
    if "brand" in fields and not (fields.get("brand") or "").strip():
        raise HTTPException(status_code=400, detail="Brand required")
    try:
        roll = db.update_incoming_stock_roll(token, fields)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    if not roll:
        raise HTTPException(status_code=404, detail="Incoming roll not found")
    return roll

@app.post("/api/stock-in/rolls/{token}/cancel")
async def cancel_incoming_stock_roll(token: str, body: IncomingStockCancel):
    try:
        roll = db.cancel_incoming_stock_roll(token, body.reason)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    if not roll:
        raise HTTPException(status_code=404, detail="Incoming roll not found")
    return roll

@app.get("/api/stock-in/rolls/{token}/qr.png")
async def get_incoming_stock_roll_qr(token: str):
    if not db.get_incoming_stock_roll(token):
        raise HTTPException(status_code=404, detail="Incoming roll not found")
    import qrcode
    url = f"{_label_base_url().rstrip('/')}/#/spools?view=incoming&token={urllib.parse.quote(token)}"
    qr = qrcode.QRCode(border=2, box_size=6)
    qr.add_data(url)
    qr.make(fit=True)
    img = qr.make_image(fill_color="black", back_color="white")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return Response(content=buf.getvalue(), media_type="image/png")

@app.post("/api/stock-in/rolls/{token}/receive")
async def receive_incoming_stock_roll(token: str, body: IncomingStockReceive):
    try:
        result = db.receive_incoming_stock_roll(
            token,
            restock_spool_id=body.restock_spool_id,
            restock_display_id=body.restock_display_id,
            storage_location_id=body.storage_location_id,
            remaining_g=body.remaining_g,
            label_weight_g=body.label_weight_g,
            empty_spool_weight_g=body.empty_spool_weight_g,
            notes=body.notes,
        )
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    if not result:
        raise HTTPException(status_code=404, detail="Incoming roll not found")
    label_printed = False
    label_error = None
    spool = result.get("spool")
    if body.print_label and spool:
        ok = await asyncio.to_thread(_label_printer.print_spool_label, _label_spool(spool), _label_base_url())
        if ok:
            label_printed = True
            db.log_decision("system", "label_printed", f"Spool #{spool.get('display_id') or spool['id']} stock-in receive")
        else:
            label_error = _label_printer.last_error or "Label printer unavailable"
            db.log_decision("system", "label_print_failed", f"Spool #{spool.get('display_id') or spool['id']}: {label_error}")
            _notify("warn", "Label print failed", f"Spool #{spool.get('display_id') or spool['id']}: {label_error}", link="#/settings/hardware")
    return {**result, "label_printed": label_printed, "label_error": label_error}

@app.post("/api/spools/{spool_id}/restock")
async def restock_spool(spool_id: int, body: SpoolCreate):
    target = db.get_spool(spool_id)
    if not target:
        raise HTTPException(status_code=404, detail="Spool not found")
    if not target.get("archived_at"):
        raise HTTPException(status_code=409, detail="Only reserved archived spool lines can be restocked")
    remaining = body.remaining_g if body.remaining_g is not None else body.label_weight_g
    try:
        ok = db.restock_spool_line(
            spool_id,
            material=body.material,
            brand=body.brand,
            color_hex=body.color_hex,
            label_weight_g=body.label_weight_g,
            remaining_g=remaining,
            subtype=body.subtype,
            color_name=body.color_name,
            color_hex_2=body.color_hex_2,
            color_hex_3=body.color_hex_3,
            color_scheme=body.color_scheme or "solid",
            storage_location_id=body.storage_location_id,
            notes=body.notes,
            empty_spool_weight_g=body.empty_spool_weight_g,
        )
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    if not ok:
        raise HTTPException(status_code=404, detail="Spool not found")
    spool = db.get_spool(spool_id)
    label_printed = False
    label_error = None
    if db.get_all_settings().get("label_auto_print") == "true" and spool:
        ok = await asyncio.to_thread(_label_printer.print_spool_label, _label_spool(spool), _label_base_url())
        if ok:
            label_printed = True
            db.log_decision("system", "label_printed", f"Spool #{spool.get('display_id') or spool_id} restock")
        else:
            label_error = _label_printer.last_error or "Label printer unavailable"
            db.log_decision("system", "label_print_failed", f"Spool #{spool.get('display_id') or spool_id}: {label_error}")
            _notify("warn", "Label print failed", f"Spool #{spool.get('display_id') or spool_id}: {label_error}", link="#/settings/hardware")
    return {"ok": True, "spool": spool, "label_printed": label_printed, "label_error": label_error}

@app.get("/api/spools/by-printer/{printer_id}")
async def get_spools_by_printer(printer_id: str):
    return db.get_spools_by_printer(printer_id)

@app.get("/api/spools")
async def get_spools(include_archived: bool = False):
    return db.get_spools(include_archived=include_archived)

@app.get("/api/spools/all")
async def get_all_spools():
    return db.get_spools(include_archived=True)

@app.get("/api/spool-locations")
async def get_spool_locations(include_archived: bool = False):
    return db.get_spool_locations(include_archived=include_archived)

@app.post("/api/spool-locations")
async def create_spool_location(body: SpoolLocationBody):
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Location name required")
    try:
        return {"id": db.create_spool_location(name, body.notes)}
    except Exception as exc:
        raise HTTPException(status_code=409, detail="Location already exists") from exc

@app.put("/api/spool-locations/{location_id}")
async def update_spool_location(location_id: int, body: SpoolLocationBody):
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Location name required")
    try:
        ok = db.update_spool_location(location_id, name, body.notes)
    except Exception as exc:
        raise HTTPException(status_code=409, detail="Location already exists") from exc
    if not ok:
        raise HTTPException(status_code=404, detail="Location not found")
    return {"ok": True}

@app.delete("/api/spool-locations/{location_id}")
async def archive_spool_location(location_id: int, archive_spools: bool = False):
    usage = db.get_spool_location_usage(location_id)
    if not usage["exists"]:
        raise HTTPException(status_code=404, detail="Location not found")
    if usage["active_stored_count"] and not archive_spools:
        count = usage["active_stored_count"]
        label = "spool" if count == 1 else "spools"
        raise HTTPException(
            status_code=409,
            detail={
                "message": f"{usage['name']} still has {count} active stored {label}.",
                "active_stored_count": count,
                "active_home_count": usage["active_home_count"],
                "location_name": usage["name"],
            },
        )
    if not db.archive_spool_location(location_id, archive_spools=archive_spools):
        raise HTTPException(status_code=404, detail="Location not found")
    return {"ok": True, "archived_spools": usage["active_stored_count"] if archive_spools else 0}

@app.get("/api/spools/by-number/{display_id}")
async def get_spool_by_number(display_id: int, include_archived: bool = True):
    s = db.get_spool_by_display_id(display_id, include_archived=include_archived)
    if not s:
        raise HTTPException(status_code=404, detail="Spool not found")
    return s

@app.get("/api/spools/{spool_id}")
async def get_spool(spool_id: int):
    s = db.get_spool(spool_id)
    if not s:
        raise HTTPException(status_code=404, detail="Spool not found")
    return s

@app.get("/api/spools/{spool_id}/trace")
async def get_spool_trace(spool_id: int):
    s = db.get_spool_trace(spool_id)
    if not s:
        raise HTTPException(status_code=404, detail="Spool not found")
    return s

@app.post("/api/spools")
async def create_spool(body: SpoolCreate):
    remaining = body.remaining_g if body.remaining_g is not None else body.label_weight_g
    if body.location_printer_id and body.location_slot is not None:
        conflict = db.get_spool_at_slot(body.location_printer_id, body.location_slot)
        if conflict:
            raise HTTPException(status_code=409,
                detail={"message": f"Slot occupied by spool #{conflict.get('display_id') or conflict['id']}", "conflict_spool_id": conflict["id"]})
    try:
        spool_id = db.create_spool(
            material=body.material, brand=body.brand, color_hex=body.color_hex,
            label_weight_g=body.label_weight_g, remaining_g=remaining,
            subtype=body.subtype, color_name=body.color_name,
            color_hex_2=body.color_hex_2, color_hex_3=body.color_hex_3,
            color_scheme=body.color_scheme or "solid",
            location_printer_id=body.location_printer_id,
            location_slot=body.location_slot,
            storage_location_id=None if body.location_printer_id else body.storage_location_id,
            notes=body.notes,
            empty_spool_weight_g=body.empty_spool_weight_g,
        )
    except sqlite3.IntegrityError as exc:
        if body.location_printer_id and body.location_slot is not None:
            raise HTTPException(status_code=409,
                detail={"message": "Slot is already occupied", "conflict_spool_id": None}) from exc
        raise
    if db.get_all_settings().get("label_auto_print") == "true":
        spool = db.get_spool(spool_id)
        ok = await asyncio.to_thread(_label_printer.print_spool_label, _label_spool(spool), _label_base_url())
        if ok:
            db.log_decision("system", "label_printed", f"Spool #{spool.get('display_id') if spool else spool_id} auto-print")
        else:
            message = _label_printer.last_error or "Label printer unavailable"
            db.log_decision("system", "label_print_failed", f"Spool #{spool.get('display_id') if spool else spool_id}: {message}")
            _notify("warn", "Label print failed", f"Spool #{spool.get('display_id') if spool else spool_id}: {message}", link="#/settings/hardware")
    ams_sync = None
    if body.location_printer_id and body.location_slot is not None:
        spool = db.get_spool(spool_id)
        ams_sync = await _sync_bambu_ams_slot(body.location_printer_id, body.location_slot, spool)
    spool = db.get_spool(spool_id)
    return {"id": spool_id, "display_id": spool.get("display_id") if spool else spool_id, "ams_sync": ams_sync}

@app.put("/api/spools/{spool_id}")
async def update_spool(spool_id: int, body: SpoolUpdate):
    fields = body.model_dump(exclude_unset=True)
    if not db.update_spool(spool_id, **fields):
        raise HTTPException(status_code=404, detail="Spool not found")
    return {"ok": True}

@app.delete("/api/spools/{spool_id}")
async def delete_spool(spool_id: int):
    if not db.delete_spool(spool_id):
        raise HTTPException(status_code=404, detail="Spool not found")
    return {"ok": True}

@app.post("/api/spools/{spool_id}/archive")
async def archive_spool(spool_id: int):
    db.archive_spool(spool_id)
    return {"ok": True}

@app.post("/api/spools/{spool_id}/restore")
async def restore_spool(spool_id: int):
    db.restore_spool(spool_id)
    return {"ok": True}

@app.post("/api/spools/{spool_id}/reset_weight")
async def reset_spool_weight(spool_id: int):
    db.reset_spool_weight(spool_id)
    return {"ok": True}

@app.post("/api/spools/{spool_id}/correct_weight")
async def correct_spool_weight(spool_id: int, body: SpoolWeightCorrection):
    spool = db.get_spool(spool_id)
    if not spool:
        raise HTTPException(status_code=404, detail="Spool not found")

    empty_g = body.empty_spool_weight_g
    if empty_g is None:
        empty_g = spool.get("empty_spool_weight_g")
    if empty_g is None:
        costs = db.get_material_costs()
        for cost in costs:
            if cost.get("material") == spool.get("material") and cost.get("brand") == spool.get("brand"):
                empty_g = cost.get("empty_spool_weight_g")
                break

    if body.remaining_g is not None:
        remaining = body.remaining_g
    elif body.reading_g is not None:
        remaining = float(body.reading_g) - float(empty_g or 0)
    else:
        reading = await _read_scale_stable_async()
        if not reading:
            message = _scale.last_error or "Scale unavailable"
            db.log_decision("system", "scale_unavailable", message)
            _notify("warn", "Scale unavailable", message, link="#/settings/hardware")
            raise HTTPException(status_code=503, detail=message)
        remaining = float(reading.grams or 0) - float(empty_g or 0)
        body.reading_g = reading.grams

    if not db.correct_spool_weight(
        spool_id,
        remaining,
        reading_g=body.reading_g,
        empty_spool_weight_g=body.empty_spool_weight_g,
    ):
        raise HTTPException(status_code=404, detail="Spool not found")
    return {"ok": True, "remaining_g": max(0.0, round(float(remaining), 1)), "empty_spool_weight_g": empty_g}

@app.post("/api/prints/{print_id}/spool_usage/{spool_id}/reconcile")
async def reconcile_print_spool_usage(print_id: int, spool_id: int, body: SpoolUsageReconcile):
    spool = db.get_spool(spool_id)
    if not spool:
        raise HTTPException(status_code=404, detail="Spool not found")

    empty_g = body.empty_spool_weight_g
    if empty_g is None:
        empty_g = spool.get("empty_spool_weight_g")
    if empty_g is None:
        costs = db.get_material_costs()
        for cost in costs:
            if cost.get("material") == spool.get("material") and cost.get("brand") == spool.get("brand"):
                empty_g = cost.get("empty_spool_weight_g")
                break

    if body.remaining_g is not None:
        remaining = body.remaining_g
    elif body.reading_g is not None:
        remaining = float(body.reading_g) - float(empty_g or 0)
    else:
        reading = await _read_scale_stable_async()
        if not reading:
            message = _scale.last_error or "Scale unavailable"
            db.log_decision("system", "scale_unavailable", message)
            _notify("warn", "Scale unavailable", message, link="#/settings/hardware")
            raise HTTPException(status_code=503, detail=message)
        body.reading_g = reading.grams
        remaining = float(reading.grams or 0) - float(empty_g or 0)

    result = db.reconcile_spool_usage(
        print_id,
        spool_id,
        remaining,
        start_remaining_g=body.start_remaining_g,
        exclusive=body.exclusive,
        reading_g=body.reading_g,
        empty_spool_weight_g=body.empty_spool_weight_g,
    )
    if not result:
        raise HTTPException(status_code=404, detail="Print usage not found")
    return {"ok": True, **result}

@app.post("/api/prints/{print_id}/spool_usage/{spool_id}/correct")
async def correct_print_spool_usage(print_id: int, spool_id: int, body: SpoolUsageCorrection):
    if not db.get_spool(spool_id):
        raise HTTPException(status_code=404, detail="Original spool not found")
    if not db.get_spool(body.to_spool_id):
        raise HTTPException(status_code=404, detail="Correct spool not found")
    result = db.correct_print_spool_attribution(
        print_id,
        spool_id,
        body.to_spool_id,
        grams=body.grams,
        note=body.note,
    )
    if not result:
        raise HTTPException(status_code=404, detail="Print usage correction not available")
    return {"ok": True, **result}

@app.post("/api/prints/{print_id}/spool_usage/assign")
async def assign_print_spool_usage(print_id: int, body: SpoolUsageAssignment):
    if not db.get_spool(body.spool_id):
        raise HTTPException(status_code=404, detail="Spool not found")
    result = db.assign_print_spool_usage(
        print_id,
        body.spool_id,
        grams=body.grams,
        note=body.note,
    )
    if not result:
        raise HTTPException(status_code=404, detail="Print or spool not found")
    if result.get("error") == "already_assigned":
        raise HTTPException(status_code=409, detail="Print already has spool usage recorded")
    if result.get("error") == "no_grams":
        raise HTTPException(status_code=422, detail="Print has no filament grams to deduct")
    return {"ok": True, **result}


def _timelapse_media_type(path: Path) -> str:
    suffix = path.suffix.lower()
    if suffix == ".webm":
        return "video/webm"
    if suffix == ".mov":
        return "video/quicktime"
    if suffix == ".avi":
        return "video/x-msvideo"
    return "video/mp4"


def _timelapse_suffix(filename: str) -> str:
    suffix = Path(filename or "").suffix.lower()
    return suffix if suffix in _FLIGHT_RECORDER_EXTS else ""


def _timelapse_safe_output_path(printer_id: str, print_id: int, print_filename: str, suffix: str) -> Path:
    safe_printer = re.sub(r"[^a-zA-Z0-9_.-]+", "-", printer_id).strip("-") or "printer"
    safe_name = re.sub(r"[^a-zA-Z0-9_.-]+", "-", Path(print_filename or "print").stem).strip("-")[:80] or "print"
    out_dir = FLIGHT_RECORDER_DIR / safe_printer
    out_dir.mkdir(parents=True, exist_ok=True)
    return out_dir / f"{print_id}-{safe_name}{suffix}"


def _timelapse_path_from_record(record: dict) -> Path:
    raw = Path(str(record.get("timelapse_path") or ""))
    if raw.is_absolute():
        raise HTTPException(status_code=404, detail="timelapse path unavailable")
    path = FLIGHT_RECORDER_DIR / raw
    try:
        resolved = path.resolve()
        base = FLIGHT_RECORDER_DIR.resolve()
        resolved.relative_to(base)
        return resolved
    except Exception as exc:
        raise HTTPException(status_code=404, detail="timelapse path unavailable") from exc


def _mp4_needs_faststart(path: Path) -> bool:
    """True when moov is after mdat — browsers must download the whole file before play."""
    if path.suffix.lower() != ".mp4" or not path.is_file():
        return False
    try:
        size = path.stat().st_size
        peek = min(size, 256 * 1024)
        with path.open("rb") as fh:
            head = fh.read(peek)
        moov = head.find(b"moov")
        mdat = head.find(b"mdat")
        if moov >= 0 and (mdat < 0 or moov < mdat):
            return False
        return True
    except OSError:
        return False


async def _faststart_timelapse(path: Path) -> None:
    """Rewrite MP4 so the index is at the front. Copy-only; skip if already faststart."""
    if not _mp4_needs_faststart(path):
        return
    tmp = path.with_name(path.stem + ".faststart" + path.suffix)
    proc = await asyncio.create_subprocess_exec(
        "ffmpeg",
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        str(path),
        "-c",
        "copy",
        "-movflags",
        "+faststart",
        str(tmp),
        stdout=asyncio.subprocess.DEVNULL,
        stderr=asyncio.subprocess.PIPE,
    )
    _, err = await proc.communicate()
    if proc.returncode == 0 and tmp.is_file() and tmp.stat().st_size > 1024:
        tmp.replace(path)
        return
    try:
        tmp.unlink(missing_ok=True)
    except OSError:
        pass
    log.warning(
        "flight recorder faststart remux failed for %s: %s",
        path.name,
        (err or b"").decode("utf-8", "ignore").strip()[:240],
    )


def _timelapse_realtime_factor() -> float:
    interval = float(os.getenv("FLIGHTDECK_TIMELAPSE_INTERVAL", "8"))
    fps = float(os.getenv("FLIGHTDECK_TIMELAPSE_FPS", "30"))
    return max(1.0, interval * fps)


def _ffprobe_video_duration(path: Path) -> Optional[float]:
    if not path.is_file() or path.stat().st_size < 1024:
        return None
    try:
        proc = subprocess.run(
            [
                "ffprobe",
                "-v", "error",
                "-show_entries", "format=duration",
                "-of", "default=noprint_wrappers=1:nokey=1",
                str(path),
            ],
            capture_output=True,
            text=True,
            timeout=12,
            check=False,
        )
        if proc.returncode != 0:
            return None
        return float(proc.stdout.strip())
    except (ValueError, subprocess.TimeoutExpired, OSError):
        return None


def _timelapse_native_coverage(item: dict, video_seconds: float) -> float:
    print_sec = float(item.get("duration_seconds") or 0)
    if print_sec <= 0 or video_seconds <= 0:
        return 1.0
    expected = print_sec / _timelapse_realtime_factor()
    if expected <= 0:
        return 1.0
    return min(1.0, video_seconds / expected)


def _timelapse_should_upgrade(item: dict) -> bool:
    source = str(item.get("timelapse_source") or "")
    if "ipcam" in source:
        return True
    if not source.startswith("flightdeck-native"):
        return False
    try:
        path = _timelapse_path_from_record(item)
    except HTTPException:
        return True
    video_seconds = _ffprobe_video_duration(path)
    if video_seconds is None:
        return True
    return _timelapse_native_coverage(item, video_seconds) < 0.45


def _timelapse_coverage_meta(item: dict) -> Optional[dict]:
    if not item.get("has_timelapse"):
        return None
    print_sec = float(item.get("duration_seconds") or 0)
    if print_sec <= 0:
        return None
    try:
        path = _timelapse_path_from_record(item)
    except HTTPException:
        return None
    video_seconds = _ffprobe_video_duration(path)
    if video_seconds is None:
        return None
    source = str(item.get("timelapse_source") or "")
    if source.startswith("flightdeck-native"):
        coverage = _timelapse_native_coverage(item, video_seconds)
        expected_video = print_sec / _timelapse_realtime_factor()
    else:
        coverage = min(1.0, video_seconds / print_sec) if print_sec > 0 else 1.0
        expected_video = print_sec
    return {
        "video_seconds": round(video_seconds, 1),
        "print_seconds": round(print_sec),
        "coverage": round(coverage, 3),
        "low_coverage": coverage < 0.45,
        "expected_video_seconds": round(expected_video, 1),
    }


def _enrich_print_timelapse_meta(item: dict) -> dict:
    out = dict(item)
    coverage = _timelapse_coverage_meta(item)
    if coverage:
        out["timelapse_coverage"] = coverage
        out["timelapse_should_upgrade"] = _timelapse_should_upgrade(item)
    return out


def _normalise_timelapse_key(value: str) -> str:
    text = Path(value or "").stem.lower()
    text = re.sub(r"\.gcode$", "", text)
    text = re.sub(r"[^a-z0-9]+", "", text)
    return text


_TIMELAPSE_FILENAME_TS = re.compile(
    r"(?:video|ipcam-record)[._](?P<date>\d{4}-\d{2}-\d{2})[_-](?P<hour>\d{2})[-:](?P<minute>\d{2})[-:](?P<second>\d{2})",
    re.IGNORECASE,
)


def _parse_timelapse_filename_time(value: str) -> Optional[datetime]:
    """Parse Bambu-style recorder filenames like video_2026-07-02_07-18-05.mp4."""
    text = str(value or "")
    match = _TIMELAPSE_FILENAME_TS.search(text)
    if not match:
        return None
    try:
        dt = datetime.strptime(
            f"{match.group('date')} {match.group('hour')}:{match.group('minute')}:{match.group('second')}",
            "%Y-%m-%d %H:%M:%S",
        )
        return dt.replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def _parse_timelapse_modified(value) -> Optional[datetime]:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        try:
            return datetime.fromtimestamp(float(value), tz=timezone.utc)
        except Exception:
            return None
    raw = str(value).strip()
    if not raw:
        return None
    for fmt in ("%Y%m%d%H%M%S", "%Y-%m-%dT%H:%M:%S%z", "%Y-%m-%dT%H:%M:%S"):
        try:
            dt = datetime.strptime(raw, fmt)
            return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
        except ValueError:
            pass
    try:
        dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def _timelapse_candidate_time(candidate: dict) -> Optional[datetime]:
    modified = _parse_timelapse_modified(candidate.get("modified"))
    if modified:
        return modified
    name = str(candidate.get("name") or candidate.get("path") or "")
    return _parse_timelapse_filename_time(name)


def _print_time_window(item: dict) -> tuple[Optional[datetime], Optional[datetime]]:
    def parse(value) -> Optional[datetime]:
        if not value:
            return None
        if isinstance(value, datetime):
            return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
        try:
            dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
            return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
        except ValueError:
            return None
    return parse(item.get("started_at")), parse(item.get("ended_at"))


def _timelapse_has_name_match(item: dict, candidate: dict) -> bool:
    filename_key = _normalise_timelapse_key(item.get("filename") or "")
    subtask_key = _normalise_timelapse_key(item.get("subtask_name") or "")
    candidate_key = _normalise_timelapse_key(candidate.get("name") or candidate.get("path") or "")
    if not candidate_key:
        return False
    if filename_key and (filename_key in candidate_key or candidate_key in filename_key):
        return True
    if subtask_key and (subtask_key in candidate_key or candidate_key in subtask_key):
        return True
    return False


def _timelapse_store_source(candidate: dict) -> str:
    source = str(candidate.get("source") or "printer-media")
    origin = str(candidate.get("path") or candidate.get("name") or "").replace("\\", "/").lstrip("/")
    if origin and source.startswith("bambu"):
        return f"{source}|{origin}"[:64]
    return source[:64]


def _timelapse_candidate_reserved(item: dict, candidate: dict, claimed_paths: set[str], claimed_origins: set[str]) -> bool:
    print_id = int(item.get("id") or 0)
    name = Path(str(candidate.get("local_path") or candidate.get("name") or candidate.get("path") or "")).name
    owned = _ATTACHED_TIMELAPSE_NAME_RE.match(name)
    if owned and int(owned.group(1)) != print_id:
        return True

    rel_path = str(candidate.get("path") or "").replace("\\", "/").lstrip("/")
    if rel_path and rel_path in claimed_paths:
        return True
    if rel_path and rel_path in claimed_origins:
        return True

    local_path = str(candidate.get("local_path") or "")
    if local_path:
        try:
            rel = Path(local_path).resolve().relative_to(FLIGHT_RECORDER_DIR.resolve())
            if str(rel).replace("\\", "/") in claimed_paths:
                return True
        except Exception:
            pass
    return False


def _timelapse_candidate_score(item: dict, candidate: dict) -> float:
    filename_key = _normalise_timelapse_key(item.get("filename") or "")
    subtask_key = _normalise_timelapse_key(item.get("subtask_name") or "")
    candidate_key = _normalise_timelapse_key(candidate.get("name") or candidate.get("path") or "")
    score = 0.0
    print_id = int(item.get("id") or 0)
    owned = _ATTACHED_TIMELAPSE_NAME_RE.match(
        Path(str(candidate.get("local_path") or candidate.get("name") or "")).name
    )
    if owned and int(owned.group(1)) == print_id:
        score += 220
    if filename_key and (filename_key in candidate_key or candidate_key in filename_key):
        score += 80
    if subtask_key and (subtask_key in candidate_key or candidate_key in subtask_key):
        score += 100

    started, ended = _print_time_window(item)
    modified = _timelapse_candidate_time(candidate)
    if modified and (started or ended):
        anchor = ended or started
        if anchor:
            delta = (modified - anchor).total_seconds()
            abs_delta = abs(delta)
            # Bambu timelapses usually land near print end; allow a short pre-end window too.
            if -20 * 60 <= delta <= 6 * 3600:
                score += max(0.0, 95.0 - (abs_delta / 120.0))
            elif abs_delta <= 8 * 3600:
                score += max(0.0, 35.0 - (abs_delta / 900.0))
        if started and modified >= started - timedelta(minutes=10):
            score += 10
        if started and ended and started - timedelta(minutes=10) <= modified <= ended + timedelta(hours=2):
            score += 45

    path = str(candidate.get("path") or candidate.get("name") or "").lower().replace("\\", "/")
    if path.startswith("timelapse/") or "/timelapse/" in path:
        score += 45
    elif path.startswith("ipcam/") or "/ipcam/" in path or "ipcam-record" in path:
        score -= 80
        if not _timelapse_has_name_match(item, candidate):
            score -= 40

    size = candidate.get("size")
    if score > 0 and isinstance(size, int) and size > 0:
        score += min(10.0, size / (25 * 1024 * 1024))
    return score


def _pick_timelapse_candidate(item: dict, candidates: list[dict]) -> Optional[dict]:
    print_id = int(item.get("id") or 0)
    claimed_paths = db.get_claimed_timelapse_paths(exclude_print_id=print_id)
    claimed_origins = db.get_claimed_timelapse_origins(exclude_print_id=print_id)
    viable = []
    for candidate in candidates:
        if _timelapse_candidate_reserved(item, candidate, claimed_paths, claimed_origins):
            continue
        suffix = _timelapse_suffix(candidate.get("name") or candidate.get("path") or "")
        if not suffix:
            continue
        size = candidate.get("size")
        if isinstance(size, int) and size > _MAX_FLIGHT_RECORDER_BYTES:
            continue
        scored = dict(candidate)
        scored["_score"] = _timelapse_candidate_score(item, candidate)
        viable.append(scored)
    if not viable:
        return None
    viable.sort(key=lambda c: (float(c.get("_score") or 0), c.get("modified") or "", c.get("size") or 0), reverse=True)
    best = viable[0]
    if float(best.get("_score") or 0) <= 0:
        return None
    if not _timelapse_has_name_match(item, best):
        started, ended = _print_time_window(item)
        modified = _timelapse_candidate_time(best)
        if not (started and ended and modified):
            return None
        delta = abs((modified - ended).total_seconds())
        if delta > 25 * 60:
            return None
    return best


def _local_recorder_search_roots() -> list[Path]:
    roots: list[Path] = []

    def add(path: Path | str | None) -> None:
        if not path:
            return
        try:
            resolved = Path(path).expanduser().resolve()
        except Exception:
            return
        if resolved not in roots:
            roots.append(resolved)

    add(FLIGHT_RECORDER_DIR)
    for name in _LOCAL_RECORDER_SEARCH_NAMES:
        add(DATA_DIR / name)
        add(PRINT_LIBRARY_DIR / name)
    add(DATA_DIR)

    env_value = os.getenv("FLIGHTDECK_RECORDER_SEARCH_DIRS", "")
    for raw in re.split(r"[;\n]", env_value):
        raw = raw.strip()
        if raw:
            add(raw)
    return roots


def _list_local_recorder_candidates() -> list[dict]:
    rows: list[dict] = []
    seen: set[Path] = set()
    for root in _local_recorder_search_roots():
        if not root.exists() or not root.is_dir():
            continue
        try:
            base = root.resolve()
            paths = root.rglob("*")
            for idx, path in enumerate(paths):
                if idx > 3000 or len(rows) >= 600:
                    break
                if not path.is_file() or not _timelapse_suffix(path.name):
                    continue
                try:
                    resolved = path.resolve()
                    if resolved in seen:
                        continue
                    rel = resolved.relative_to(base)
                    stat = resolved.stat()
                except Exception:
                    continue
                seen.add(resolved)
                rows.append({
                    "name": path.name,
                    "path": str(rel).replace("\\", "/"),
                    "local_path": str(resolved),
                    "size": int(stat.st_size),
                    "modified": datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat(),
                    "source": "flightdeck-pi",
                    "root": str(base),
                })
        except Exception as exc:
            log.debug("Flight Recorder local scan failed for %s: %s", root, exc)
    return rows


async def _list_bambu_recorder_candidates(printer) -> list[dict]:
    from .printers.bambu_ftp import list_bambu_files
    roots = [""] + list(_BAMBU_RECORDER_ROOTS)
    seen: set[str] = set()
    rows: list[dict] = []

    async def scan(root: str, depth: int = 0) -> None:
        if root in seen or depth > 2:
            return
        seen.add(root)
        try:
            files = await asyncio.to_thread(list_bambu_files, printer._ip, printer._access_code, root)
        except Exception as exc:
            log.debug("Bambu recorder scan failed for %s:%s: %s", printer.id, root or "/", exc)
            return
        for file in files[:200]:
            path = str(file.get("path") or file.get("name") or "").lstrip("/")
            if not path:
                continue
            kind = file.get("kind")
            if kind == "dir":
                if depth < 2:
                    await scan(path, depth + 1)
                continue
            if _timelapse_suffix(path):
                rows.append({**file, "path": path, "source": "bambu-sd"})

    for root in roots:
        await scan(root)
    return rows


async def _list_moonraker_recorder_candidates(base_url: str) -> list[dict]:
    rows: list[dict] = []
    for root in _MOONRAKER_RECORDER_ROOTS:
        try:
            files = await _moonraker_files_root(base_url, root)
        except Exception as exc:
            log.debug("Moonraker recorder scan failed for %s: %s", root, exc)
            continue
        for file in files:
            if file.get("kind") == "dir":
                continue
            path = str(file.get("path") or file.get("name") or "").lstrip("/")
            if _timelapse_suffix(path):
                rows.append({**file, "path": path, "root": root, "source": "moonraker"})
    return rows


async def _discover_print_timelapse(printer_id: str, item: dict) -> tuple[dict, bytes]:
    local_best = _pick_timelapse_candidate(item, _list_local_recorder_candidates())
    if local_best:
        path = Path(str(local_best.get("local_path") or ""))
        try:
            resolved = path.resolve()
            root = Path(str(local_best.get("root") or FLIGHT_RECORDER_DIR)).resolve()
            resolved.relative_to(root)
        except Exception as exc:
            raise HTTPException(status_code=404, detail="local recorder clip unavailable") from exc
        return local_best, await asyncio.to_thread(resolved.read_bytes)

    bambu = _find_bambu(printer_id)
    if bambu:
        candidates = await _list_bambu_recorder_candidates(bambu)
        best = _pick_timelapse_candidate(item, candidates)
        if not best:
            raise HTTPException(status_code=404, detail="no matching Bambu recorder clip found")
        from .printers.bambu_ftp import download_bambu_file
        data = await asyncio.to_thread(download_bambu_file, bambu._ip, bambu._access_code, best["path"])
        return best, data

    mr_url = _find_moonraker_url(printer_id)
    if mr_url:
        raise HTTPException(status_code=404, detail="automatic printer-storage discovery is Bambu-tested for beta; use Add video for this printer")

    raise HTTPException(status_code=404, detail="printer does not support recorder discovery")


def _bambu_ftp_paths_from_mqtt_timelapse(mqtt_path: str) -> list[str]:
    """Map Bambu MQTT timelapse paths onto FTPS paths we can actually download."""
    raw = str(mqtt_path or "").strip().replace("\\", "/")
    if not raw:
        return []
    stripped = raw.lstrip("/")
    for prefix in ("userdata/media/", "userdata/"):
        if stripped.startswith(prefix):
            stripped = stripped[len(prefix):]
            break
    candidates: list[str] = []
    seen: set[str] = set()

    def add(path: str) -> None:
        clean = path.strip().lstrip("/")
        if clean and clean not in seen:
            seen.add(clean)
            candidates.append(clean)

    if stripped:
        add(stripped)
        name = Path(stripped).name
        if name:
            for root in _BAMBU_RECORDER_ROOTS:
                add(f"{root}/{name}")
    return candidates


async def _save_and_attach_timelapse(
    printer_id: str,
    print_id: int,
    item: dict,
    candidate: dict,
    data: bytes,
    *,
    source: str,
    decision_event: str = "flight_recorder_discovered",
) -> dict:
    if not data:
        raise HTTPException(status_code=422, detail="recorder clip is empty")
    if len(data) > _MAX_FLIGHT_RECORDER_BYTES:
        raise HTTPException(status_code=413, detail="recorder clip too large")
    suffix = _timelapse_suffix(candidate.get("name") or candidate.get("path") or "")
    if not suffix:
        raise HTTPException(status_code=422, detail="recorder clip type is unsupported")
    out_path = _timelapse_safe_output_path(printer_id, print_id, item.get("filename") or "print", suffix)
    out_path.write_bytes(data)
    await _faststart_timelapse(out_path)
    if not db.attach_print_timelapse(print_id, out_path, source=source):
        raise HTTPException(status_code=404, detail="print not found")
    detail = candidate.get("path") or candidate.get("name") or out_path.name
    db.log_decision(
        printer_id,
        decision_event,
        f"Attached {source} clip {detail}",
        print_id=print_id,
    )
    updated = db.get_print_by_id(print_id) or item
    updated["timelapse_url"] = f"/api/printers/{urllib.parse.quote(printer_id)}/prints/{print_id}/timelapse"
    updated["recorder_candidate"] = {
        "source": source,
        "path": candidate.get("path"),
        "size": candidate.get("size") or len(data),
        "score": candidate.get("_score"),
    }
    return updated


async def _try_harvest_bambu_mqtt_timelapse(
    printer_id: str,
    print_id: int,
    item: dict,
    mqtt_path: str,
) -> bool:
    bambu = _find_bambu(printer_id)
    if not bambu or not mqtt_path:
        return False
    from .printers.bambu_ftp import download_bambu_file
    for ftp_path in _bambu_ftp_paths_from_mqtt_timelapse(mqtt_path):
        try:
            data = await asyncio.to_thread(download_bambu_file, bambu._ip, bambu._access_code, ftp_path)
        except Exception as exc:
            log.debug("MQTT timelapse download failed for %s:%s: %s", printer_id, ftp_path, exc)
            continue
        if not data:
            continue
        suffix = _timelapse_suffix(ftp_path)
        if not suffix:
            continue
        candidate = {
            "name": Path(ftp_path).name,
            "path": ftp_path,
            "source": "bambu-mqtt",
            "size": len(data),
        }
        await _save_and_attach_timelapse(
            printer_id,
            print_id,
            item,
            candidate,
            data,
            source="bambu-mqtt",
            decision_event="flight_recorder_auto_mqtt",
        )
        return True
    return False


async def _auto_harvest_flight_recorder(
    printer_id: str,
    print_id: int,
    mqtt_hint: Optional[str] = None,
) -> None:
    """Best-effort recorder harvest after a print ends. Retries while printer media catches up."""
    key = (printer_id, print_id)
    if key in _flight_recorder_harvest_pending:
        return
    _flight_recorder_harvest_pending.add(key)
    try:
        delays = (0,) + _FLIGHT_RECORDER_AUTO_RETRY_DELAYS
        last_detail = "no matching recorder clip found"
        for attempt, delay in enumerate(delays):
            if delay:
                await asyncio.sleep(delay)
            item = db.get_print_by_id(print_id)
            if not item or item.get("printer_id") != printer_id:
                return
            if item.get("has_timelapse") and not _timelapse_should_upgrade(item):
                return
            try:
                if mqtt_hint and await _try_harvest_bambu_mqtt_timelapse(printer_id, print_id, item, mqtt_hint):
                    log.info("flight recorder auto-attached via MQTT hint: %s print_id=%s", printer_id, print_id)
                    return
                candidate, data = await _discover_print_timelapse(printer_id, item)
                await _save_and_attach_timelapse(
                    printer_id,
                    print_id,
                    item,
                    candidate,
                    data,
                    source=_timelapse_store_source(candidate),
                    decision_event="flight_recorder_auto_discovered",
                )
                log.info("flight recorder auto-attached via discovery: %s print_id=%s", printer_id, print_id)
                return
            except HTTPException as exc:
                last_detail = str(exc.detail or exc)
                if exc.status_code not in {404, 422}:
                    log.warning("flight recorder auto-harvest stopped for %s print_id=%s: %s", printer_id, print_id, last_detail)
                    return
            except Exception as exc:
                log.warning("flight recorder auto-harvest failed for %s print_id=%s: %s", printer_id, print_id, exc)
                return
        db.log_decision(
            printer_id,
            "flight_recorder_auto_miss",
            f"No recorder clip after {len(delays)} attempts ({last_detail})",
            print_id=print_id,
        )
    finally:
        _flight_recorder_harvest_pending.discard(key)


@app.get("/api/printers/{printer_id}/prints/{print_id}/timelapse")
async def get_print_timelapse(printer_id: str, print_id: int):
    _assert_printer(printer_id)
    record = db.get_print_timelapse(print_id)
    if not record or record.get("printer_id") != printer_id:
        raise HTTPException(status_code=404, detail="no timelapse")
    path = _timelapse_path_from_record(record)
    if not path.exists() or not path.is_file():
        raise HTTPException(status_code=404, detail="timelapse file missing")
    return FileResponse(
        path,
        media_type=_timelapse_media_type(path),
        headers={"Cache-Control": "public, max-age=31536000, immutable"},
    )


@app.get("/api/printers/{printer_id}/prints/{print_id}/timelapse/debug")
async def debug_print_timelapse(printer_id: str, print_id: int):
    _assert_printer(printer_id)
    item = db.get_print_by_id(print_id)
    if not item or item.get("printer_id") != printer_id:
        raise HTTPException(status_code=404, detail="print not found")

    statuses = await _printer_status_map()
    status = statuses.get(printer_id) or {}
    mqtt_hint = str(status.get("_last_timelapse_path") or "")
    ftp_hint_paths = _bambu_ftp_paths_from_mqtt_timelapse(mqtt_hint)

    local_candidates = _list_local_recorder_candidates()
    local_best = _pick_timelapse_candidate(item, local_candidates)

    bambu_candidates: list[dict] = []
    bambu_best = None
    bambu_error = None
    bambu = _find_bambu(printer_id)
    if bambu:
        try:
            bambu_candidates = await _list_bambu_recorder_candidates(bambu)
            bambu_best = _pick_timelapse_candidate(item, bambu_candidates)
        except Exception as exc:
            bambu_error = str(exc)

    def summarise(candidate: dict) -> dict:
        return {
            "name": candidate.get("name"),
            "path": candidate.get("path"),
            "source": candidate.get("source"),
            "size": candidate.get("size"),
            "modified": candidate.get("modified"),
            "score": candidate.get("_score"),
        }

    return {
        "print_id": print_id,
        "printer_id": printer_id,
        "has_timelapse": bool(item.get("has_timelapse")),
        "timelapse_path": item.get("timelapse_path"),
        "timelapse_source": item.get("timelapse_source"),
        "printer_state": status.get("state"),
        "last_finished_print_id": status.get("_last_finished_print_id"),
        "mqtt_timelapse_hint": mqtt_hint or None,
        "mqtt_ftp_hint_paths": ftp_hint_paths,
        "local_candidate_count": len(local_candidates),
        "local_best": summarise(local_best) if local_best else None,
        "local_samples": [summarise(c) for c in local_candidates[:8]],
        "bambu_candidate_count": len(bambu_candidates),
        "bambu_best": summarise(bambu_best) if bambu_best else None,
        "bambu_samples": [summarise(c) for c in bambu_candidates[:8]],
        "bambu_error": bambu_error,
        "timelapse_coverage": _timelapse_coverage_meta(item),
        "timelapse_should_upgrade": _timelapse_should_upgrade(item),
    }


@app.post("/api/printers/{printer_id}/prints/{print_id}/timelapse")
async def upload_print_timelapse(printer_id: str, print_id: int, file: UploadFile = File(...)):
    _assert_printer(printer_id)
    item = db.get_print_by_id(print_id)
    if not item or item.get("printer_id") != printer_id:
        raise HTTPException(status_code=404, detail="print not found")
    suffix = _timelapse_suffix(file.filename or "")
    if not suffix:
        raise HTTPException(status_code=400, detail="upload an mp4, webm, mov, or avi timelapse")
    out_path = _timelapse_safe_output_path(printer_id, print_id, item.get("filename") or "print", suffix)
    total = 0
    with out_path.open("wb") as fh:
        while True:
            chunk = await file.read(_UPLOAD_READ_CHUNK_BYTES)
            if not chunk:
                break
            total += len(chunk)
            if total > _MAX_FLIGHT_RECORDER_BYTES:
                fh.close()
                try:
                    out_path.unlink()
                except OSError:
                    pass
                raise HTTPException(status_code=413, detail="timelapse upload too large")
            fh.write(chunk)
    if total <= 0:
        try:
            out_path.unlink()
        except OSError:
            pass
        raise HTTPException(status_code=400, detail="empty timelapse upload")
    await _faststart_timelapse(out_path)
    if not db.attach_print_timelapse(print_id, out_path, source="upload"):
        raise HTTPException(status_code=404, detail="print not found")
    db.log_decision(printer_id, "flight_recorder_attached", f"Attached timelapse {out_path.name}", print_id=print_id)
    updated = db.get_print_by_id(print_id) or item
    updated["timelapse_url"] = f"/api/printers/{urllib.parse.quote(printer_id)}/prints/{print_id}/timelapse"
    return updated


@app.post("/api/printers/{printer_id}/prints/{print_id}/timelapse/discover")
async def discover_print_timelapse(printer_id: str, print_id: int):
    _assert_printer(printer_id)
    item = db.get_print_by_id(print_id)
    if not item or item.get("printer_id") != printer_id:
        raise HTTPException(status_code=404, detail="print not found")
    if item.get("has_timelapse") and not _timelapse_should_upgrade(item):
        updated = db.get_print_by_id(print_id) or item
        updated["timelapse_url"] = f"/api/printers/{urllib.parse.quote(printer_id)}/prints/{print_id}/timelapse"
        return updated

    if item.get("has_timelapse") and _timelapse_should_upgrade(item):
        try:
            old_path = _timelapse_path_from_record(item)
            if old_path.exists():
                old_path.unlink(missing_ok=True)
        except Exception:
            pass

    candidate, data = await _discover_print_timelapse(printer_id, item)
    updated = await _save_and_attach_timelapse(
        printer_id,
        print_id,
        item,
        candidate,
        data,
        source=_timelapse_store_source(candidate),
        decision_event="flight_recorder_upgraded" if item.get("has_timelapse") else "flight_recorder_discovered",
    )
    return updated

@app.post("/api/spools/{spool_id}/move")
async def move_spool(spool_id: int, body: SpoolMove):
    before = db.get_spool(spool_id)
    result = db.move_spool(spool_id, body.printer_id, body.slot, body.storage_location_id)
    replaced_spool = None
    if not result["ok"]:
        conflict = db.get_spool(result["conflict_spool_id"])
        if body.replace_existing and body.printer_id and body.slot is not None and conflict:
            replaced_spool = conflict
            clear_result = db.move_spool(int(conflict["id"]), None, None, None)
            if not clear_result["ok"]:
                raise HTTPException(status_code=409, detail={
                    "message": "Unable to return existing spool before assigning slot",
                    "conflict_spool_id": conflict["id"],
                    "conflict_spool": conflict,
                })
            result = db.move_spool(spool_id, body.printer_id, body.slot, body.storage_location_id)
        if not result["ok"]:
            conflict = db.get_spool(result["conflict_spool_id"])
            raise HTTPException(status_code=409, detail={
                "message": "Slot occupied",
                "conflict_spool_id": result["conflict_spool_id"],
                "conflict_spool": conflict,
            })
    ams_sync = None
    if before and before.get("location_printer_id") and before.get("location_slot") is not None:
        moved_slot = (
            before.get("location_printer_id") != body.printer_id
            or before.get("location_slot") != body.slot
        )
        if moved_slot:
            ams_sync = await _sync_bambu_ams_slot(
                before["location_printer_id"],
                before["location_slot"],
                None,
            )
    if body.printer_id and body.slot is not None:
        spool = db.get_spool(spool_id)
        profile_override = body.ams_profile.model_dump(exclude_none=True) if body.ams_profile else None
        if body.sync_ams or profile_override:
            ams_sync = await _sync_bambu_ams_slot(body.printer_id, body.slot, spool, profile_override)
    return {
        "ok": True,
        "ams_sync": ams_sync,
        "replaced_spool_id": replaced_spool["id"] if replaced_spool else None,
    }


@app.post("/api/spools/{spool_id}/trust_printer")
async def trust_printer_spool(spool_id: int, body: SpoolTrustPrinter):
    spool = db.get_spool(spool_id)
    if not spool:
        raise HTTPException(status_code=404, detail="Spool not found")
    if spool.get("location_printer_id") != body.printer_id or int(spool.get("location_slot") or -1) != int(body.slot):
        raise HTTPException(status_code=409, detail="Spool is no longer assigned to that printer slot")

    statuses = await _printer_status_map()
    slot = next(
        (s for s in _flatten_reported_ams_slots(statuses.get(body.printer_id), include_empty=True)
         if int(s.get("flat_slot") or -1) == int(body.slot)),
        None,
    )
    if not slot:
        raise HTTPException(status_code=404, detail="Printer slot report not available")

    if slot.get("empty"):
        result = db.move_spool(spool_id, None, None, body.storage_location_id)
        if not result["ok"]:
            raise HTTPException(status_code=409, detail="Unable to clear spool from slot")
        db.log_decision(body.printer_id, "spool_trusted_printer", f"Spool #{spool_id} cleared from AMS slot {body.slot}; printer reports empty")
        return {"ok": True, "cleared": True}

    fields: dict[str, object] = {}
    material = str(slot.get("type") or "").strip()
    if material:
        fields["material"] = material
    color = _norm_hex(slot.get("color"))
    if color:
        fields["color_hex"] = color
        fields["color_name"] = _colour_label(color)
    brand = str(slot.get("brand") or "").strip()
    if brand:
        fields["brand"] = brand

    if not fields:
        raise HTTPException(status_code=422, detail="Printer slot does not report enough filament data")
    if not db.update_spool(spool_id, **fields):
        raise HTTPException(status_code=404, detail="Spool not found")

    summary = ", ".join(f"{k}={v}" for k, v in fields.items())
    db.log_decision(body.printer_id, "spool_trusted_printer", f"Spool #{spool_id} updated from AMS slot {body.slot}: {summary}")
    return {"ok": True, "updated": fields}


async def _sync_bambu_ams_slot(
    printer_id: str,
    slot: int,
    spool: Optional[dict],
    profile_override: Optional[dict] = None,
) -> Optional[bool]:
    for p in _bambu:
        if p.id != printer_id:
            continue
        try:
            ok = await asyncio.to_thread(p.set_ams_slot_filament, slot, spool, profile_override)
            action = "ams_slot_synced" if spool else "ams_slot_cleared"
            target = f"{printer_id}:{slot}"
            detail = f"{target} {'spool #' + str(spool['id']) if spool else 'empty'}"
            if profile_override and spool:
                detail += f" profile={profile_override.get('profile_name') or profile_override.get('tray_type') or 'custom'}"
            db.log_decision(printer_id, action, detail)
            return bool(ok)
        except Exception as exc:
            db.log_decision(printer_id, "ams_slot_sync_failed", f"{printer_id}:{slot}: {exc}")
            log.warning("AMS slot sync failed for %s:%s: %s", printer_id, slot, exc)
            return False
    return None


# ── Print queue ──────────────────────────────────────────────────────────

_ALLOWED_BAMBU_EXT = {".3mf"}
_ALLOWED_MOONRAKER_EXT = {".gcode", ".gcode.gz", ".ufp"}
_QUEUE_SOURCE_MODEL_EXT = {".step", ".stp"}


def _printer_kind(printer_id: str) -> Optional[str]:
    for (pid, _model_name, _custom_name, _icon, _url, kind, _toolhead_count) in _moonraker:
        if pid == printer_id:
            return kind
    for p in _bambu:
        if p.id == printer_id:
            return "bambu"
    for (pid, _model_name, _custom_name, _icon, profile, _scenario) in _simulated:
        if pid == printer_id:
            return profile
    return None


def _is_queue_source_model(filename: str) -> bool:
    return _queue_file_extension(filename) in _QUEUE_SOURCE_MODEL_EXT


async def _printer_status_map() -> dict[str, dict]:
    # Never block the queue UI on a slow printer poll — serve last snapshot.
    if _latest_printers:
        return dict(_latest_printers)
    try:
        await asyncio.wait_for(_gather_all(), timeout=5.0)
    except asyncio.TimeoutError:
        log.warning("printer status map: cold gather timed out")
    return dict(_latest_printers)


def _norm_material(value: Optional[str]) -> str:
    return re.sub(r"[^a-z0-9]+", "", (value or "").lower())


def _canon_brand(value: Optional[str]) -> str:
    normalised = _norm_material(value)
    return "bambulab" if normalised in {"bambu", "bambulab"} else normalised


def _canon_profile(value: Optional[str]) -> str:
    """Normalise a profile string for brand-agnostic comparison. Bambu's own profile
    names say 'Bambu' (e.g. 'Bambu PLA Pure') while Flightdeck stores the brand as
    'Bambu Lab' — collapse 'bambu lab' -> 'bambu' so they compare equal."""
    text = re.sub(r"\bbambu\s+lab\b", "bambu", (value or "").lower())
    return re.sub(r"[^a-z0-9]+", "", text)


def _spool_matches_material(spool: dict, material: str) -> bool:
    wanted = _norm_material(material)
    if not wanted:
        return False
    haystack = " ".join([
        str(spool.get("material") or ""),
        str(spool.get("subtype") or ""),
        str(spool.get("brand") or ""),
    ])
    got = _norm_material(haystack)
    return bool(got) and (wanted in got or got in wanted)


_COMPOSITE_PROFILE_TOKENS = ("cf", "carbon", "gf", "glass", "wood", "metal", "support")


def _spool_profile_text(spool: dict) -> str:
    return " ".join([
        str(spool.get("brand") or ""),
        str(spool.get("material") or ""),
        str(spool.get("subtype") or ""),
    ])


def _reported_profile_text(slot: dict) -> str:
    return " ".join(
        str(slot.get(key) or "").strip()
        for key in ("brand", "type", "material", "profile_name", "profile_id")
        if str(slot.get(key) or "").strip()
    )


def _looks_like_bambu_profile_code(value: Optional[str]) -> bool:
    raw = str(value or "").strip().upper()
    return bool(re.fullmatch(r"[A-Z]\d{2}[-_ ]?[A-Z0-9]+", raw))


def _is_generic_profile(value: Optional[str]) -> bool:
    normalised = _norm_material(value or "")
    return normalised == "generic" or normalised.startswith("generic")


def _generic_profile_rejects_spool(slot: dict, spool: dict) -> bool:
    """Generic PLA/PETG/etc. should not auto-match composite/specialty rolls."""
    if not (_is_generic_profile(slot.get("brand")) or _is_generic_profile(slot.get("profile_name"))):
        return False
    reported = _norm_material(_reported_profile_text(slot))
    spool_text = _norm_material(_spool_profile_text(spool))
    return any(token in spool_text and token not in reported for token in _COMPOSITE_PROFILE_TOKENS)


def _reported_brand_matches_spool(reported_brand: str, spool: dict) -> bool:
    reported = _canon_brand(reported_brand)
    spool_brand = _canon_brand(spool.get("brand") or "")
    if not reported or reported == "generic" or reported == spool_brand:
        return True
    spool_profile = _norm_material(" ".join([
        str(spool.get("brand") or ""),
        str(spool.get("material") or ""),
        str(spool.get("subtype") or ""),
    ]))
    if reported in spool_profile or spool_profile in reported:
        return True
    # Bambu RFID reports profile-family names such as "PLA Basic" where the
    # operator-facing spool may be stored as Bambu Lab / Basic / PLA.
    reported_material = _norm_material(re.sub(r"\bbambu\s+lab\b", "", reported_brand, flags=re.I))
    spool_material_profile = _norm_material(" ".join([
        str(spool.get("material") or ""),
        str(spool.get("subtype") or ""),
    ]))
    return bool(reported_material and spool_material_profile and (
        reported_material in spool_material_profile or spool_material_profile in reported_material
    ))


def _queue_filament_colors(job: dict) -> list[dict]:
    raw = job.get("filament_colors")
    if not raw:
        return []
    if isinstance(raw, list):
        return raw
    try:
        parsed = json.loads(raw)
        return parsed if isinstance(parsed, list) else []
    except Exception:
        return []


def _queue_filament_colors_for_preflight(job: dict, printer_status: Optional[dict]) -> list[dict]:
    """Prefer stored filament/nozzle metadata; only re-parse when nozzles are missing.

    Historically this re-read the full 3MF (including gcode object geometry) on
    every H2D queue preflight — a 16MB job froze the whole API at ~80% CPU.
    """
    colors = _queue_filament_colors(job)
    if not _is_h2d_printer_status(printer_status):
        return colors
    if colors and all(
        isinstance(c, dict) and c.get("nozzle") is not None
        for c in colors
    ):
        return colors
    filename = str(job.get("filename") or "")
    if _queue_file_extension(filename) != ".3mf":
        return colors
    file_path = job.get("file_path")
    if not file_path:
        job_id = job.get("id")
        if job_id is not None:
            full = db.queue_get(int(job_id))
            file_path = (full or {}).get("file_path")
    if not file_path:
        return colors
    try:
        data = Path(file_path).read_bytes()
    except OSError:
        return colors
    try:
        refreshed = _queue_filament_colors(
            {"filament_colors": _queue_file_metadata(filename, data).get("filament_colors")}
        )
    except Exception:
        return colors
    return refreshed or colors


def _queue_colour_requirements(job: dict, printer_status: Optional[dict] = None) -> list[dict]:
    material = _norm_material(job.get("filament_type"))
    grouped: dict[tuple[str, str], dict] = {}
    for item in _queue_filament_colors_for_preflight(job, printer_status):
        color = _norm_hex(item.get("color"))
        if not color:
            continue
        item_material = _norm_material(item.get("type")) or material
        key = (item_material, color)
        req = grouped.setdefault(key, {"material": item_material, "color": color, "used_g": 0.0})
        req["used_g"] += float(item.get("used_g") or 0)
    return list(grouped.values())


def _queue_nozzle_requirements(job: dict, printer_status: Optional[dict] = None) -> list[dict]:
    material = _norm_material(job.get("filament_type"))
    out = []
    for item in _queue_filament_colors_for_preflight(job, printer_status):
        try:
            nozzle = int(item.get("nozzle"))
        except (TypeError, ValueError):
            continue
        if nozzle not in (0, 1):
            continue
        color = _norm_hex(item.get("color"))
        item_material = _norm_material(item.get("type")) or material
        if color or item_material:
            out.append({
                "material": item_material,
                "color": color,
                "used_g": float(item.get("used_g") or 0),
                "nozzle": nozzle,
            })
    return out


def _norm_hex(value: Optional[str]) -> str:
    h = str(value or "").strip().lstrip("#")[:6].upper()
    return f"#{h}" if re.fullmatch(r"[0-9A-F]{6}", h) else ""


def _hex_dist(a: Optional[str], b: Optional[str]) -> float:
    ha, hb = _norm_hex(a), _norm_hex(b)
    if not ha or not hb:
        return 0.0
    va = [int(ha[i:i + 2], 16) for i in (1, 3, 5)]
    vb = [int(hb[i:i + 2], 16) for i in (1, 3, 5)]
    return sum((x - y) ** 2 for x, y in zip(va, vb)) ** 0.5


_COLOUR_NAMES = [
    ("Black", "#000000"),
    ("White", "#FFFFFF"),
    ("Grey", "#808080"),
    ("Silver", "#C0C0C0"),
    ("Red", "#EF4444"),
    ("Orange", "#F97316"),
    ("Yellow", "#EAB308"),
    ("Green", "#22C55E"),
    ("Teal", "#14B8A6"),
    ("Blue", "#3B82F6"),
    ("Dark Blue", "#1D4ED8"),
    ("Purple", "#8B5CF6"),
    ("Pink", "#EC4899"),
    ("Brown", "#7C4B00"),
    ("Gold", "#B8860B"),
]


def _colour_label(color: Optional[str]) -> str:
    color = _norm_hex(color)
    if not color:
        return "Unknown colour"
    name, ref = min(_COLOUR_NAMES, key=lambda item: _hex_dist(color, item[1]))
    dist = _hex_dist(color, ref)
    return name if dist <= 115 else color


def _colour_family(color: Optional[str]) -> str:
    color = _norm_hex(color)
    if not color:
        return ""
    rgb = [int(color[i:i + 2], 16) for i in (1, 3, 5)]
    spread = max(rgb) - min(rgb)
    avg = sum(rgb) / 3
    if spread <= 45:
        if avg <= 45:
            return "black"
        if avg >= 220:
            return "white"
        return "grey_silver"
    return _colour_label(color).lower().replace(" ", "_")


def _colour_matches(actual: Optional[str], expected: Optional[str]) -> bool:
    if not expected:
        return True
    if _hex_dist(actual, expected) <= 95:
        return True
    actual_family = _colour_family(actual)
    expected_family = _colour_family(expected)
    return bool(actual_family and actual_family == expected_family == "grey_silver")


def _queue_nozzle_label(nozzle: Optional[int]) -> str:
    return "left nozzle" if nozzle == 0 else "right nozzle" if nozzle == 1 else "unknown nozzle"


def _is_h_series_printer_status(printer_status: Optional[dict]) -> bool:
    return str((printer_status or {}).get("model_name") or "").upper().startswith("H")


def _is_h2_printer_status(printer_status: Optional[dict]) -> bool:
    return str((printer_status or {}).get("model_name") or "").upper().startswith("H2")


def _is_h2d_printer_status(printer_status: Optional[dict]) -> bool:
    return str((printer_status or {}).get("model_name") or "").upper() == "H2D"


# Queue safety: PLA/PETG/TPU left in the nozzle while the next job heats for
# ABS/ASA/PA/PC will cook the soft filament. Broader than Colour Match families.
def _filament_temp_family(material: Optional[str]) -> Optional[str]:
    """Classify filament as 'low' / 'high' for nozzle unload safety. None = unknown."""
    n = _norm_material(material)
    if not n:
        return None
    if any(n == token or n.startswith(token) for token in ("pla", "petg", "pctg", "tpu", "pva", "bvoh")):
        return "low"
    if n == "pet" or n.startswith("pet"):
        return "low"
    if any(n == token or n.startswith(token) for token in ("abs", "asa", "nylon", "pacf", "pagf", "pps", "ppa")):
        return "high"
    if n == "pc" or (n.startswith("pc") and not n.startswith("pct")):
        return "high"
    # PA / nylon family — after PLA so "pla*" is never treated as PA.
    if n == "pa" or (n.startswith("pa") and not n.startswith("pla")):
        return "high"
    return None


def _job_high_temp_nozzle_targets(job: dict, printer_status: Optional[dict]) -> set[Optional[int]]:
    """Nozzles that will print high-temp for this job.

    Empty set = job is not high-temp. {None} = high-temp but path unknown
    (treat as any/all paths). {0}/{1}/both = H2D path-aware.
    """
    nozzles: set[Optional[int]] = set()
    for req in _queue_nozzle_requirements(job, printer_status):
        if _filament_temp_family(req.get("material")) == "high":
            nozzles.add(req.get("nozzle"))
    if nozzles:
        return nozzles
    for req in _queue_colour_requirements(job, printer_status):
        if _filament_temp_family(req.get("material")) == "high":
            nozzles.add(None)
    if nozzles:
        return nozzles
    if _filament_temp_family(job.get("filament_type")) == "high":
        nozzles.add(None)
    return nozzles


def _h_series_nozzle_low_temp_conflict(job: dict, printer_status: Optional[dict]) -> Optional[dict]:
    """Detect H-series high-temp job with low-temp filament still at the nozzle.

    Uses AMS tray_now (last-used when idle) as the nozzle filament signal.
    Always treat low-temp at tray_now as a conflict before any high-temp job —
    H2D L/R path metadata is often inconsistent with AMS HT mapping, and
    skipping "other path" missed real PETG-loaded-then-ASA-print cases.
    """
    if not _is_h_series_printer_status(printer_status):
        return None
    if not _job_high_temp_nozzle_targets(job, printer_status):
        return None
    active = _reported_active_slot(printer_status)
    if not active or active.get("empty"):
        return None
    active_mat = _reported_slot_material_text(active)
    if _filament_temp_family(active_mat) != "low":
        return None
    try:
        active_nozzle = int(active["nozzle"]) if active.get("nozzle") is not None else None
    except (TypeError, ValueError):
        active_nozzle = None
    label = active.get("label") or "AMS"
    return {
        "material": active_mat,
        "label": label,
        "flat_slot": active.get("flat_slot"),
        "nozzle": active_nozzle,
        "message": (
            f"Will auto-unload {label} ({active_mat or 'low-temp'}) "
            f"before high-temp print — nozzle still loaded"
        ),
    }


def _reported_ams_path_slots(printer_status: Optional[dict]) -> list[dict]:
    if not printer_status or not _is_h2d_printer_status(printer_status):
        return []
    slots = []
    for unit in printer_status.get("ams") or []:
        try:
            unit_id = int(unit.get("unit") or 0)
        except (TypeError, ValueError):
            continue
        # H-series nozzle IDs are 0=left, 1=right. H2D regular AMS feeds
        # the left path, while AMS HT feeds the right path.
        nozzle = 1 if unit_id >= 128 else 0
        bay = "AMS HT" if unit_id >= 128 else f"AMS {unit_id + 1}"
        for slot in unit.get("slots") or []:
            if slot.get("empty"):
                continue
            try:
                slot_idx = int(slot.get("idx") or 0)
            except (TypeError, ValueError):
                slot_idx = 0
            slots.append({
                "unit": unit_id,
                "idx": slot_idx,
                "label": bay if unit_id >= 128 else f"{bay} slot {slot_idx + 1}",
                "nozzle": nozzle,
                "material": _norm_material(slot.get("type")),
                "color": _norm_hex(slot.get("color")),
            })
    return slots


def _h2d_nozzle_mapping_issues(job: dict, printer_status: Optional[dict]) -> list[dict]:
    requirements = _queue_nozzle_requirements(job, printer_status)
    if not requirements:
        return []
    slots = _reported_ams_path_slots(printer_status)
    if not slots:
        return []
    issues = []
    for req in requirements:
        material_matches = [
            s for s in slots
            if req["material"] and (
                req["material"] == s["material"]
                or req["material"] in s["material"]
                or s["material"] in req["material"]
            )
        ] or slots
        same_path = [s for s in material_matches if s["nozzle"] == req["nozzle"]]
        same_path_match = [
            s for s in same_path
            if _colour_matches(s.get("color"), req.get("color"))
        ]
        if same_path_match:
            continue
        other_path_match = [
            s for s in material_matches
            if s["nozzle"] != req["nozzle"] and _colour_matches(s.get("color"), req.get("color"))
        ]
        wanted = " ".join(p for p in [req.get("material"), _colour_label(req.get("color"))] if p).strip()
        target = _queue_nozzle_label(req["nozzle"])
        if other_path_match:
            issues.append({
                "level": "block",
                "message": (
                    f"H2D nozzle/AMS mismatch: job is sliced for {target}, but matching {wanted} "
                    f"is loaded in {other_path_match[0]['label']} ({_queue_nozzle_label(other_path_match[0]['nozzle'])}). "
                    "Move the filament to the matching nozzle path or re-slice for the loaded AMS path."
                ),
            })
        elif same_path:
            issues.append({
                "level": "block",
                "message": f"H2D nozzle/AMS mismatch: job needs {wanted} on {target}, but that nozzle path has no matching colour loaded.",
            })
        else:
            issues.append({
                "level": "block",
                "message": f"H2D nozzle/AMS mismatch: job needs {wanted} on {target}, but no AMS tray feeding that nozzle is loaded.",
            })
    return issues


def _coverage_label(coverage: dict) -> str:
    spools = coverage.get("spools") or []
    spool_bits = []
    for spool in spools[:2]:
        sid = db._spool_number(spool)
        colour = str(spool.get("color_name") or "").strip()
        brand = str(spool.get("brand") or "").strip()
        label = " ".join(p for p in [f"#{sid}" if sid and sid != "-" else "", colour] if p).strip()
        if brand:
            label = f"{label} ({brand})" if label else brand
        if label:
            spool_bits.append(label)
    if len(spools) > 2:
        spool_bits.append(f"+{len(spools) - 2} more")
    if spool_bits:
        brand_text = ", ".join(spool_bits)
    else:
        brand_text = "no loaded spool"
    requested = _colour_label(coverage["color"])
    spool_label = f"{requested} via {brand_text}" if spools else f"{requested} ({brand_text})"
    return (
        f"{spool_label} "
        f"{coverage['available_g']:.0f}g/{coverage['used_g']:.0f}g"
    )

def _spool_h2d_nozzle(spool: dict) -> Optional[int]:
    try:
        slot = int(spool.get("location_slot"))
    except (TypeError, ValueError):
        return None
    # H2D/H-series path numbering is 0=left, 1=right. Regular AMS units feed
    # the left path; AMS HT virtual slots (128+) feed the right path.
    return 1 if slot >= 128 else 0


def _queue_nozzle_coverage(requirements: list[dict], spools: list[dict], required_g: Optional[float]) -> list[dict]:
    reqs = [dict(req) for req in requirements]
    if required_g is not None and len(reqs) == 1 and float(reqs[0].get("used_g") or 0) <= 0:
        reqs[0]["used_g"] = float(required_g)

    coverage = []
    for req in reqs:
        matching = [
            s for s in spools
            if _spool_h2d_nozzle(s) == req.get("nozzle")
            and _spool_matches_material(s, req["material"])
            and _spool_matches_color(s, req["color"])
        ]
        available = sum(float(s.get("remaining_g") or 0) for s in matching)
        coverage.append({
            **req,
            "available_g": available,
            "spools": matching,
            "ok": available + 0.1 >= float(req.get("used_g") or 0),
        })
    return coverage


def _nozzle_coverage_label(coverage: dict) -> str:
    base = _coverage_label(coverage)
    return f"{_queue_nozzle_label(coverage.get('nozzle'))} {base}"


def _spool_matches_color(spool: dict, color: Optional[str]) -> bool:
    if str(spool.get("color_scheme") or "").lower() in {"rainbow", "multicolor", "multi", "gradient"}:
        return True
    return _colour_matches(spool.get("color_hex"), color)


def _queue_colour_coverage(requirements: list[dict], spools: list[dict]) -> list[dict]:
    coverage = []
    for req in requirements:
        matching = [
            s for s in spools
            if _spool_matches_material(s, req["material"]) and _spool_matches_color(s, req["color"])
        ]
        available = sum(float(s.get("remaining_g") or 0) for s in matching)
        coverage.append({
            **req,
            "available_g": available,
            "spools": matching,
            "ok": available + 0.1 >= float(req.get("used_g") or 0),
        })
    return coverage


def _ams_slot_index(unit_id: int, slot_idx: int) -> int:
    """Flightdeck canonical AMS slot index; AMS HT uses Bambu's 128+ tray ids."""
    unit_id = int(unit_id)
    slot_idx = int(slot_idx)
    return unit_id + slot_idx if unit_id >= 128 else unit_id * 4 + slot_idx


def _flatten_reported_ams_slots(printer_status: Optional[dict], include_empty: bool = False) -> list[dict]:
    slots: list[dict] = []
    for unit in (printer_status or {}).get("ams") or []:
        unit_id = int(unit.get("unit") or 0)
        for slot in unit.get("slots") or []:
            if slot.get("empty") and not include_empty:
                continue
            idx = int(slot.get("idx") or 0)
            slots.append({
                **slot,
                "unit": unit_id,
                "flat_slot": _ams_slot_index(unit_id, idx),
                "label": f"{unit.get('label') or 'AMS'} slot {idx + 1}",
            })
    return slots


def _reported_active_slot(printer_status: Optional[dict]) -> Optional[dict]:
    return next((s for s in _flatten_reported_ams_slots(printer_status) if s.get("active")), None)


def _reported_slot_matches_requirement(slot: dict, req: dict) -> bool:
    return (
        _spool_matches_material(
            {"material": _reported_slot_material_text(slot), "subtype": "", "brand": ""},
            req["material"],
        )
        and _colour_matches(slot.get("color"), req["color"])
    )


def _reported_slot_mismatch(spool: Optional[dict], slot: Optional[dict]) -> str:
    printer_loaded = bool(slot and not slot.get("empty"))
    if spool and slot and slot.get("empty"):
        return f"Flightdeck has spool #{spool.get('id')} assigned but printer reports empty"
    if not spool and printer_loaded:
        return "Printer reports filament but no Flightdeck spool is assigned"
    if not spool or not printer_loaded or not slot:
        return ""

    reported_material_text = _reported_slot_material_text(slot)
    reported_mat = _norm_material(reported_material_text)
    spool_mat = _norm_material(" ".join([
        str(spool.get("material") or ""),
        str(spool.get("subtype") or ""),
    ]))
    if reported_mat and spool_mat and reported_mat not in spool_mat and spool_mat not in reported_mat:
        return f"Material mismatch: printer {reported_material_text or 'unknown'}, Flightdeck {spool.get('material') or 'unknown'}"
    if _generic_profile_rejects_spool(slot, spool):
        expected = " ".join(str(spool.get(k) or "") for k in ("brand", "material", "subtype")).strip()
        return f"Profile mismatch: printer {_reported_profile_text(slot) or 'Generic'}, Flightdeck {expected}"
    if not _colour_matches(slot.get("color"), spool.get("color_hex")):
        return f"Colour mismatch: printer {_colour_label(slot.get('color'))}, Flightdeck {_colour_label(spool.get('color_hex'))}"

    reported_brand = _canon_brand(slot.get("brand") or "")
    spool_brand = _canon_brand(spool.get("brand") or "")
    if reported_brand and spool_brand and not _reported_brand_matches_spool(str(slot.get("brand") or ""), spool):
        return f"Brand mismatch: printer {slot.get('brand')}, Flightdeck {spool.get('brand')}"
    reported_profile = _canon_profile(slot.get("profile_name") or "")
    spool_profile = _canon_profile(" ".join([
        str(spool.get("brand") or ""),
        str(spool.get("material") or ""),
        str(spool.get("subtype") or ""),
    ]))
    if _looks_like_bambu_profile_code(slot.get("profile_name")):
        return ""
    if _is_generic_profile(slot.get("brand")) or _is_generic_profile(slot.get("profile_name")):
        return ""
    if reported_profile and spool_profile and reported_profile != "generic" and reported_profile not in spool_profile and spool_profile not in reported_profile:
        expected = " ".join(str(spool.get(k) or "") for k in ("brand", "material", "subtype")).strip()
        return f"Profile mismatch: printer {slot.get('profile_name')}, Flightdeck {expected}"
    return ""


def _printer_ams_mismatches(printer_status: Optional[dict], loaded_spools: list[dict]) -> list[dict]:
    if not printer_status:
        return []
    reported_by_slot = {
        int(slot["flat_slot"]): slot
        for slot in _flatten_reported_ams_slots(printer_status, include_empty=True)
    }
    loaded_by_slot = {
        int(s.get("location_slot")): s
        for s in loaded_spools
        if s.get("location_slot") is not None
    }
    mismatches: list[dict] = []
    for flat_slot in sorted(set(reported_by_slot) | set(loaded_by_slot)):
        slot = reported_by_slot.get(flat_slot)
        spool = loaded_by_slot.get(flat_slot)
        mismatch = _reported_slot_mismatch(spool, slot)
        if not mismatch:
            continue
        label = (slot or {}).get("label") or f"AMS slot {flat_slot}"
        mismatches.append({
            "slot": flat_slot,
            "label": label,
            "message": mismatch,
            "spool": spool,
            "report": slot,
        })
    return mismatches


def _ams_mismatch_impacts_job(mismatch: dict, material: Optional[str], color_reqs: list[dict]) -> bool:
    spool = mismatch.get("spool") or {}
    report = mismatch.get("report") or {}
    if color_reqs:
        return any(
            (
                spool and _spool_matches_material(spool, req["material"]) and _spool_matches_color(spool, req["color"])
            ) or (
                report and _reported_slot_matches_requirement(report, req)
            )
            for req in color_reqs
        )
    if material:
        return (
            bool(spool and _spool_matches_material(spool, material))
            or bool(
                report
                and _spool_matches_material(
                    {"material": _reported_slot_material_text(report), "subtype": "", "brand": ""},
                    material,
                )
            )
        )
    return False


def _queue_preflight(job: dict, printer_status: Optional[dict]) -> dict:
    issues: list[dict] = []
    state = (printer_status or {}).get("state")
    settings = db.get_all_settings()
    strict_colour = settings.get("queue_strict_colour", "true") == "true"

    if _is_queue_source_model(job.get("filename") or ""):
        issues.append({
            "level": "block",
            "message": "STEP source model queued; slice it to a printer-ready job before dispatch.",
        })

    if not (printer_status or {}).get("print_enabled", db.is_printer_printing_enabled(job["printer_id"])):
        note = (printer_status or {}).get("print_enabled_note") or db.get_printer_printing_note(job["printer_id"])
        suffix = f" Reason: {note}" if note else ""
        issues.append({"level": "block", "message": f"Printer disabled in Flightdeck.{suffix} Tick 'Print enabled' to dispatch."})

    if not printer_status:
        issues.append({"level": "wait", "message": "Waiting for printer telemetry"})
    elif state in ("offline", "error", "estop"):
        printer_error = str((printer_status or {}).get("error") or "").strip()
        if state == "error":
            message = f"Printer error: {printer_error}" if printer_error else "Printer reports an error; clear the printer screen or Bambu app, then retry."
        elif state == "estop":
            message = "Emergency stop is active"
        else:
            message = "Printer is offline"
        issues.append({"level": "block", "message": message})
    elif state not in ("idle", "ready", "standby", "finished"):
        issues.append({"level": "wait", "message": f"Printer is {state}"})
        has_block = any(i["level"] == "block" for i in issues)
        return {
            "status": "blocked" if has_block else "waiting",
            "label": "Blocked" if has_block else "Waiting",
            "can_start": False,
            "issues": issues,
        }

    printer_id = job["printer_id"]
    if printer_id in _calibration_sessions or bool((printer_status or {}).get("calibration", {}).get("active")):
        issues.append({"level": "wait", "message": "Printer calibrating — dispatch waits until complete"})
    elif bool(job.get("calibrate_before_start")) and _bambu_printer(printer_id):
        issues.append({"level": "info", "message": "Will run calibration before dispatch"})

    due_maintenance = [m for m in db.get_maintenance_items(job["printer_id"]) if m.get("is_due")]
    if due_maintenance:
        names = ", ".join(m["title"] for m in due_maintenance[:3])
        more = f" +{len(due_maintenance) - 3}" if len(due_maintenance) > 3 else ""
        issues.append({"level": "block", "message": f"Maintenance due: {names}{more}"})

    required_g = job.get("filament_weight_g")
    material = job.get("filament_type")
    color_reqs = _queue_colour_requirements(job, printer_status)
    nozzle_reqs = _queue_nozzle_requirements(job, printer_status)
    loaded = db.get_spools_by_printer(job["printer_id"])
    loaded_spools = list(loaded.values())
    material_matches = [s for s in loaded_spools if _spool_matches_material(s, material)]
    color_coverage = _queue_colour_coverage(color_reqs, loaded_spools) if color_reqs else []
    use_nozzle_path_checks = _is_h2d_printer_status(printer_status)
    nozzle_coverage = (
        _queue_nozzle_coverage(nozzle_reqs, loaded_spools, required_g)
        if use_nozzle_path_checks and nozzle_reqs else []
    )
    color_matches = [
        s for s in material_matches
        if any(_spool_matches_color(s, c["color"]) for c in color_reqs)
    ] if color_reqs else material_matches
    active_reported = _reported_active_slot(printer_status)
    ams_mismatches = _printer_ams_mismatches(printer_status, loaded_spools)
    issues.extend(_h2d_nozzle_mapping_issues(job, printer_status))
    nozzle_conflict = _h_series_nozzle_low_temp_conflict(job, printer_status)
    if nozzle_conflict:
        issues.append({"level": "info", "message": nozzle_conflict["message"]})
    impacted_mismatches = [m for m in ams_mismatches if _ams_mismatch_impacts_job(m, material, color_reqs)]
    if impacted_mismatches:
        detail = "; ".join(f"{m['label']}: {m['message']}" for m in impacted_mismatches[:2])
        more = f"; +{len(impacted_mismatches) - 2} more" if len(impacted_mismatches) > 2 else ""
        issues.append({
            "level": "block",
            "message": f"AMS profile mismatch affects this job: {detail}{more}",
        })

    if material:
        if not loaded_spools:
            issues.append({"level": "block", "message": f"No loaded spool recorded for {material}"})
        elif not material_matches:
            issues.append({"level": "block", "message": f"No loaded spool matches {material}"})
        elif color_reqs and not color_matches:
            wanted = ", ".join(_colour_label(c["color"]) for c in color_reqs)
            issues.append({
                "level": "block" if strict_colour else "warn",
                "message": f"No loaded spool matches required colour {wanted}",
            })
        elif len(color_reqs) == 1 and active_reported and state in {"printing", "paused"}:
            # Only check the active slot mid-print. When idle, tray_now reflects
            # the last-used slot, not the slot the next job will use — the AMS
            # mapping in the print command handles slot selection at dispatch time.
            req = color_reqs[0]
            if not _reported_slot_matches_requirement(active_reported, req):
                actual = " ".join(
                    p for p in [
                        _colour_label(active_reported.get("color")),
                        str(active_reported.get("type") or "").strip(),
                    ] if p
                ) or "unknown filament"
                expected = f"{_colour_label(req['color'])} {req['material']}".strip()
                issues.append({
                    "level": "block" if strict_colour else "warn",
                    "message": f"Active AMS slot mismatch: printer is using {active_reported['label']} ({actual}), expected {expected}",
                })
    else:
        issues.append({"level": "warn", "message": "No material metadata; material check skipped"})

    if required_g is not None:
        if nozzle_coverage:
            missing = [c for c in nozzle_coverage if not c["ok"]]
            if missing:
                detail = "; ".join(_nozzle_coverage_label(c) for c in missing)
                issues.append({
                    "level": "block" if strict_colour else "warn",
                    "message": f"Loaded nozzle-path stock short: {detail}",
                })
            elif any(c["available_g"] < float(c["used_g"] or 0) * 1.15 for c in nozzle_coverage):
                detail = "; ".join(_nozzle_coverage_label(c) for c in nozzle_coverage)
                issues.append({
                    "level": "warn",
                    "message": f"Low nozzle-path margin: {detail}",
                })
        elif color_reqs:
            missing = [c for c in color_coverage if not c["ok"]]
            if missing:
                detail = "; ".join(_coverage_label(c) for c in missing)
                issues.append({
                    "level": "block" if strict_colour else "warn",
                    "message": f"Loaded colour coverage short: {detail}",
                })
            elif any(c["available_g"] < float(c["used_g"] or 0) * 1.15 for c in color_coverage):
                detail = "; ".join(_coverage_label(c) for c in color_coverage)
                issues.append({
                    "level": "warn",
                    "message": f"Low colour margin: {detail}",
                })
        candidates = material_matches if material and material_matches else loaded_spools
        if not color_reqs and not candidates:
            issues.append({"level": "block", "message": f"No inventory spool available for {required_g:.0f}g check"})
        elif not color_reqs:
            remaining_g = sum(float(s.get("remaining_g") or 0) for s in candidates)
            if remaining_g + 0.1 < float(required_g):
                issues.append({
                    "level": "block",
                    "message": f"Loaded filament short: {remaining_g:.0f}g available, {float(required_g):.0f}g needed",
                })
            elif remaining_g < float(required_g) * 1.15:
                issues.append({
                    "level": "warn",
                    "message": f"Low filament margin: {remaining_g:.0f}g available, {float(required_g):.0f}g needed",
                })
    else:
        issues.append({"level": "warn", "message": "No filament weight metadata; stock check skipped"})

    # Optional override: allow start when stock is short (operator will swap rolls mid-print).
    if job.get("allow_short_filament"):
        stock_short_re = re.compile(
            r"filament short|colour coverage short|nozzle-path stock short|No inventory spool available",
            re.I,
        )
        for issue in issues:
            if issue.get("level") == "block" and stock_short_re.search(str(issue.get("message") or "")):
                issue["level"] = "warn"
                msg = str(issue.get("message") or "")
                if not msg.lower().startswith("override:"):
                    issue["message"] = f"Override: {msg}"

    has_block = any(i["level"] == "block" for i in issues)
    has_wait = any(i["level"] == "wait" for i in issues)
    has_warn = any(i["level"] == "warn" for i in issues)
    status = "blocked" if has_block else "waiting" if has_wait else "warning" if has_warn else "ready"
    return {
        "status": status,
        "label": {"ready": "Ready", "warning": "Warning", "waiting": "Waiting", "blocked": "Blocked"}[status],
        "can_start": not has_block and not has_wait,
        "issues": issues,
    }


def _apply_queue_preflight(jobs: list[dict], statuses: dict[str, dict]) -> list[dict]:
    for job in jobs:
        if job.get("status") == "pending":
            job["preflight"] = _queue_preflight(job, statuses.get(job["printer_id"]))
        else:
            job["preflight"] = None
    return jobs


def _queue_printer_error(status: Optional[dict]) -> str:
    if not status:
        return ""
    error = str(status.get("error") or "").strip()
    if not error:
        return ""
    state = str(status.get("state") or "").lower()
    if state in {"error", "estop"}:
        return error
    if state == "paused" and "ams mapping" in error.lower():
        return error
    return ""


def _queue_active_age_seconds(job: dict) -> Optional[float]:
    raw = job.get("started_at") or job.get("created_at")
    if not raw:
        return None
    try:
        dt = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
    except ValueError:
        return None
    if dt.tzinfo is not None:
        dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
    return max(0.0, (datetime.utcnow() - dt).total_seconds())


def _queue_name_matches_print(job: dict, print_row: Optional[dict]) -> bool:
    """True when an active queue row looks like the printer's last finished print."""
    if not print_row:
        return False
    job_name = str(job.get("filename") or "").strip().lower()
    if not job_name:
        return False
    candidates = {
        str(print_row.get("filename") or "").strip().lower(),
        str(print_row.get("subtask_name") or "").strip().lower(),
    }
    candidates = {c for c in candidates if c}
    if job_name in candidates:
        return True
    job_base = job_name.rsplit("/", 1)[-1].rsplit("\\", 1)[-1]
    for c in candidates:
        c_base = c.rsplit("/", 1)[-1].rsplit("\\", 1)[-1]
        if job_base == c_base or job_base in c_base or c_base in job_base:
            return True
    return False


def _reconcile_queue_active_state(jobs: list[dict], statuses: dict[str, dict]) -> tuple[bool, list[str]]:
    changed = False
    cleared_printers: list[str] = []
    active_by_printer: dict[str, list[dict]] = {}
    for job in jobs:
        if job.get("status") in {"printing", "uploading"}:
            active_by_printer.setdefault(str(job.get("printer_id") or ""), []).append(job)

    for printer_id, active in active_by_printer.items():
        printer_error = _queue_printer_error(statuses.get(printer_id))
        if printer_error:
            changed = db.queue_fail_active(printer_id, printer_error) > 0 or changed
            continue
        state = str((statuses.get(printer_id) or {}).get("state") or "").lower()
        if state in {"idle", "ready", "standby", "finished", "cancelled", "failed"}:
            ages = [
                age for age in (_queue_active_age_seconds(row) for row in active)
                if age is not None
            ]
            if ages and min(ages) < _QUEUE_ACTIVE_STALE_GRACE_SECONDS:
                continue

            # Successful finish often lands here if we missed printing→finished.
            # Prefer DONE over a scary CANCELLED when history says the print completed.
            last = db.get_last_print(printer_id)
            last_finished = str((last or {}).get("final_state") or "").upper() == "FINISHED"
            matched_finish = last_finished and any(
                _queue_name_matches_print(row, last) for row in active
            )
            if state == "finished" or _recently_finished(printer_id) or matched_finish:
                finished = db.queue_finish_active(printer_id)
                changed = finished > 0 or changed
                if finished:
                    db.log_decision(
                        printer_id,
                        "queue_active_finished",
                        f"Printer is {state or 'idle'}; completed active queue job after successful print",
                    )
                    cleared_printers.append(printer_id)
                continue

            detail = f"Printer is {state or 'not printing'}; stale active queue job cleared"
            cleared = db.queue_cancel_active(
                printer_id,
                "cancelled",
                "Cleared stale queue state after printer returned to idle",
            )
            changed = cleared > 0 or changed
            if cleared:
                db.log_decision(printer_id, "queue_active_cleared", detail)
                cleared_printers.append(printer_id)
            continue
        if len(active) <= 1:
            continue
        keep = max(
            active,
            key=lambda row: (
                str(row.get("started_at") or ""),
                int(row.get("id") or 0),
            ),
        )
        changed = db.queue_fail_active_except(
            printer_id,
            int(keep["id"]),
            "Superseded by newer active queue job",
        ) > 0 or changed
    return changed, cleared_printers


def _reconcile_queue_from_printer_state(jobs: list[dict], statuses: dict[str, dict]) -> bool:
    changed = False
    active_printers = {
        str(row.get("printer_id") or "")
        for row in jobs
        if row.get("status") in {"printing", "uploading"}
    }
    for printer_id, status in statuses.items():
        state = str((status or {}).get("state") or "").lower()
        if state not in {"printing", "paused"} or printer_id in active_printers:
            continue
        restored = db.queue_reopen_stale_cleared_active(printer_id)
        if restored:
            changed = True
            db.log_decision(
                printer_id,
                "queue_active_restored",
                f"Restored stale-cleared queue job #{restored['id']} {restored['filename']} after printer reported {state}",
            )
    return changed


_QUEUE_PRINTER_BUSY_STATES = {"printing", "paused"}
_QUEUE_ADVANCE_LOCKS: dict[str, asyncio.Lock] = {}


def _queue_printer_ids() -> list[str]:
    return [pid for pid, *_ in _moonraker] + [p.id for p in _bambu]


def _queue_advance_lock(printer_id: str) -> asyncio.Lock:
    lock = _QUEUE_ADVANCE_LOCKS.get(printer_id)
    if lock is None:
        lock = asyncio.Lock()
        _QUEUE_ADVANCE_LOCKS[printer_id] = lock
    return lock


def _printer_available_for_queue_dispatch(status: Optional[dict], printer_id: Optional[str] = None) -> bool:
    pid = printer_id or str((status or {}).get("id") or "")
    if pid and pid in _calibration_sessions:
        return False
    state = str((status or {}).get("state") or "").lower()
    if state in _QUEUE_PRINTER_BUSY_STATES or state in {"error", "estop"}:
        return False
    return True


async def _maybe_auto_advance_queue(printer_id: str, *, trigger: str = "unknown") -> None:
    """Send the next pending queue job when the printer has no active queue row."""
    if db.queue_has_active(printer_id) or not db.queue_next_pending(printer_id):
        return
    statuses = await _printer_status_map()
    if not _printer_available_for_queue_dispatch(statuses.get(printer_id), printer_id):
        return
    lock = _queue_advance_lock(printer_id)
    if lock.locked():
        return
    async with lock:
        if db.queue_has_active(printer_id):
            return
        job = db.queue_next_pending(printer_id)
        if not job:
            return
        statuses = await _printer_status_map()
        status = statuses.get(printer_id)
        if not _printer_available_for_queue_dispatch(status, printer_id):
            return
        preflight = _queue_preflight(job, status)
        if not preflight["can_start"]:
            log.info(
                "queue auto-dispatch skipped on %s trigger=%s: %s",
                printer_id,
                trigger,
                preflight.get("status"),
            )
            return
        db.log_decision(
            printer_id,
            "queue_auto_dispatch",
            f"Job #{job['id']} {job['filename']} ({trigger})",
        )
        await _advance_queue(printer_id)


async def _scan_idle_queue_dispatch() -> None:
    for printer_id in _queue_printer_ids():
        await _maybe_auto_advance_queue(printer_id, trigger="idle_poll")


async def _boot_queue_auto_dispatch() -> None:
    await asyncio.sleep(10)
    for printer_id in _queue_printer_ids():
        await _maybe_auto_advance_queue(printer_id, trigger="startup")


async def _ensure_low_temp_unloaded_for_high_temp(printer_id: str, job: dict) -> bool:
    """Unload low-temp filament before an H-series high-temp queue job.

    Returns True when dispatch may proceed. Returns False when the job was
    failed (unload refused / timed out / printer fault).
    """
    p = _bambu_printer(printer_id)
    if p is None:
        return True

    async def _fresh_status() -> Optional[dict]:
        try:
            status = await asyncio.to_thread(p.status)
        except Exception as exc:
            log.warning("queue: high-temp unload status failed on %s: %s", printer_id, exc)
            return None
        return asdict(status)

    status = await _fresh_status()
    if status is None:
        status = (await _printer_status_map()).get(printer_id)
    conflict = _h_series_nozzle_low_temp_conflict(job, status)
    if not conflict:
        return True

    job_id = job.get("id")
    label = conflict.get("label") or "AMS"
    mat = conflict.get("material") or "low-temp"
    note = f"Job #{job_id}: unloading {label} ({mat}) before high-temp print"
    log.info("queue: %s on %s", note, printer_id)
    db.log_decision(printer_id, "ams_unload_before_high_temp", note)

    try:
        ok = await asyncio.to_thread(p.unload_ams_filament, None)
    except Exception as exc:
        reason = f"Failed to unload {label} ({mat}) before high-temp print: {exc}"
        log.error("queue: %s on %s", reason, printer_id)
        if job_id is not None:
            db.queue_update_status(int(job_id), "failed", reason)
        db.log_decision(printer_id, "ams_unload_before_high_temp_failed", reason)
        return False
    if not ok:
        reason = f"Printer refused unload of {label} ({mat}) before high-temp print"
        if job_id is not None:
            db.queue_update_status(int(job_id), "failed", reason)
        db.log_decision(printer_id, "ams_unload_before_high_temp_failed", reason)
        return False

    deadline = time.monotonic() + 300.0
    while time.monotonic() < deadline:
        await asyncio.sleep(3.0)
        status = await _fresh_status()
        if status is None:
            continue
        state = str(status.get("state") or "").lower()
        if state in {"offline", "error", "estop"}:
            reason = f"Printer {state} while unloading {mat} before high-temp print"
            if job_id is not None:
                db.queue_update_status(int(job_id), "failed", reason)
            db.log_decision(printer_id, "ams_unload_before_high_temp_failed", reason)
            return False
        if not _h_series_nozzle_low_temp_conflict(job, status):
            db.log_decision(
                printer_id,
                "ams_unload_before_high_temp_done",
                f"Job #{job_id}: nozzle clear after unloading {mat}",
            )
            return True

    reason = f"Timed out waiting for unload of {label} ({mat}) before high-temp print"
    if job_id is not None:
        db.queue_update_status(int(job_id), "failed", reason)
    db.log_decision(printer_id, "ams_unload_before_high_temp_failed", reason)
    return False


async def _advance_queue(printer_id: str) -> None:
    job = db.queue_next_pending(printer_id)
    if not job:
        return
    job_id, filename, file_path = job["id"], job["filename"], job["file_path"]
    plate_number = job.get("plate_number")
    statuses = await _printer_status_map()
    preflight = _queue_preflight(job, statuses.get(printer_id))
    if not preflight["can_start"]:
        reason = "; ".join(i["message"] for i in preflight["issues"] if i["level"] in ("block", "wait"))
        log.info("queue: preflight blocked job %d on %s: %s", job_id, printer_id, reason)
        db.log_decision(printer_id, "queue_preflight_blocked", f"Job #{job_id} {filename}: {reason}")
        return
    if await _maybe_calibrate_before_queue(printer_id, job):
        return
    if not await _ensure_low_temp_unloaded_for_high_temp(printer_id, job):
        return
    db.queue_update_status(job_id, "uploading")
    try:
        for (pid, _, _, _, url, _kind, _toolhead_count) in _moonraker:
            if pid == printer_id:
                await moonraker.upload_and_start(url, file_path, filename)
                db.queue_set_started(job_id)
                log.info("queue: started job %d on %s (%s)", job_id, printer_id, filename)
                return
        for p in _bambu:
            if p.id == printer_id:
                await asyncio.to_thread(p.send_file, file_path, filename, plate_number)
                db.queue_set_started(job_id)
                await _wait_for_bambu_physical_start(p, job_id, filename)
                log.info("queue: started job %d on %s (%s plate %s)",
                         job_id, printer_id, filename, plate_number or 1)
                return
        db.queue_update_status(job_id, "failed", "Printer not found")
    except Exception as exc:
        log.error("queue: failed to start job %d on %s: %s", job_id, printer_id, exc)
        db.queue_update_status(job_id, "failed", str(exc))


async def _on_print_finished_queue(printer_id: str) -> None:
    db.queue_finish_active(printer_id)
    await _maybe_auto_advance_queue(printer_id, trigger="print_finished")


@app.get("/api/queue/summary")
async def get_queue_summary():
    return db.queue_pending_counts()


@app.get("/api/queue")
async def get_queue(printer_id: Optional[str] = None):
    statuses = await _printer_status_map()
    jobs = db.queue_list(printer_id)
    restored = _reconcile_queue_from_printer_state(jobs, statuses)
    if restored:
        jobs = db.queue_list(printer_id)
    cleared, cleared_printers = _reconcile_queue_active_state(jobs, statuses)
    if restored or cleared:
        jobs = db.queue_list(printer_id)
    for pid in cleared_printers:
        asyncio.create_task(_maybe_auto_advance_queue(pid, trigger="stale_cleared"))
    return _apply_queue_preflight(jobs, statuses)


@app.post("/api/queue/upload", status_code=201)
async def queue_upload(
    printer_id: str = Form(...),
    file: UploadFile = File(...),
    calibrate_before_start: bool = Form(False),
    dispatch: str = Form("true"),
):
    kind = _printer_kind(printer_id)
    if kind is None:
        raise HTTPException(status_code=404, detail="printer not found")
    if not (_is_moonraker_family(kind) or kind == "bambu"):
        raise HTTPException(status_code=422, detail="queueing to simulated printers is not supported yet")

    raw_name = _safe_basename(file.filename, "upload")
    ext = _queue_file_extension(raw_name)
    allowed = (_ALLOWED_BAMBU_EXT if kind == "bambu" else _ALLOWED_MOONRAKER_EXT) | _QUEUE_SOURCE_MODEL_EXT
    if ext not in allowed:
        raise HTTPException(
            status_code=422,
            detail=f"Unsupported file type '{ext}' for {kind} printer. Expected: {', '.join(sorted(allowed))}",
        )

    data = await _read_upload_bytes(file, label="Queue upload")

    import uuid as _uuid
    safe_name = f"{_uuid.uuid4().hex[:8]}_{raw_name}"
    file_path = str(_safe_join_under(db.UPLOADS_DIR, safe_name, missing_ok=True))
    with open(file_path, "wb") as f:
        f.write(data)

    job_ids = _enqueue_print_file(
        printer_id, raw_name, file_path, data,
        calibrate_before_start=bool(calibrate_before_start and kind == "bambu"),
        split_plates=kind == "bambu",
    )
    # The queue button in the app may start a waiting printer. A voice "queue it"
    # passes dispatch=false. Pending jobs are still picked up by the idle poll,
    # so those rows are marked held until Chris sends them.
    if str(dispatch).strip().lower() not in {"0", "false", "no", "off"}:
        asyncio.create_task(_maybe_auto_advance_queue(printer_id, trigger="queue_upload"))
    else:
        for job_id in job_ids:
            db.queue_update_status(int(job_id), "held")
    return _queue_enqueue_response(job_ids)


@app.get("/api/queue/{job_id}/preview")
async def get_queue_preview(job_id: int):
    png = db.queue_get_preview(job_id)
    if not png:
        raise HTTPException(status_code=404, detail="no preview")
    return Response(content=png, media_type="image/png",
                    headers={"Cache-Control": "public, max-age=86400"})


@app.get("/api/queue/{job_id}/preflight")
async def get_queue_preflight(job_id: int):
    job = db.queue_get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    statuses = await _printer_status_map()
    return {
        "job_id": job_id,
        "printer_id": job["printer_id"],
        "preflight": _queue_preflight(job, statuses.get(job["printer_id"])),
    }


@app.delete("/api/queue/{job_id}")
async def delete_queue_job(job_id: int):
    deleted, file_path = db.queue_delete(job_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Job not found or not deletable")
    if file_path:
        try:
            Path(file_path).unlink(missing_ok=True)
        except Exception:
            pass
    return {"ok": True}


@app.post("/api/queue/{job_id}/release")
async def release_queue_job(job_id: int):
    """Drop a queue row from Flightdeck only. Does not cancel or stop the printer."""
    job = db.queue_get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    deleted, file_path = db.queue_release(job_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Job not found")
    if file_path:
        try:
            Path(file_path).unlink(missing_ok=True)
        except Exception:
            pass
    db.log_decision(
        job["printer_id"],
        "queue_released",
        f"Released queue job #{job_id} {job.get('filename') or ''} (Flightdeck only)",
    )
    asyncio.create_task(_maybe_auto_advance_queue(job["printer_id"], trigger="queue_release"))
    return {"ok": True, "printer_id": job["printer_id"], "filename": job.get("filename")}


class QueueReorderRequest(BaseModel):
    direction: str  # "up" | "down"


@app.post("/api/queue/{job_id}/calibrate-before")
async def set_queue_calibrate_before(job_id: int, body: QueueCalibrateRequest):
    job = db.queue_get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if job["status"] != "pending":
        raise HTTPException(status_code=409, detail="Only pending jobs can change calibration setting")
    if _bambu_printer(job["printer_id"]) is None and body.calibrate_before_start:
        raise HTTPException(status_code=422, detail="Calibrate-before-start is only available for Bambu printers")
    if not db.queue_set_calibrate_before(job_id, body.calibrate_before_start):
        raise HTTPException(status_code=409, detail="Could not update queue job")
    return {"ok": True, "calibrate_before_start": body.calibrate_before_start}


@app.post("/api/queue/{job_id}/allow-short-filament")
async def set_queue_allow_short_filament(job_id: int, body: QueueAllowShortFilamentRequest):
    job = db.queue_get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if job["status"] != "pending":
        raise HTTPException(status_code=409, detail="Only pending jobs can change filament override")
    if not db.queue_set_allow_short_filament(job_id, body.allow_short_filament):
        raise HTTPException(status_code=409, detail="Could not update queue job")
    return {"ok": True, "allow_short_filament": body.allow_short_filament}


@app.post("/api/queue/{job_id}/reorder")
async def reorder_queue_job(job_id: int, body: QueueReorderRequest):
    if body.direction not in ("up", "down"):
        raise HTTPException(status_code=422, detail="direction must be 'up' or 'down'")
    if not db.queue_reorder(job_id, body.direction):
        raise HTTPException(status_code=404, detail="Job not found or cannot reorder")
    return {"ok": True}


@app.post("/api/queue/{job_id}/retry")
async def retry_queue_job(job_id: int):
    job = db.queue_get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if not db.queue_retry(job_id):
        raise HTTPException(status_code=404, detail="Job not found or not retryable")
    asyncio.create_task(_maybe_auto_advance_queue(job["printer_id"], trigger="queue_retry"))
    return {"ok": True}


@app.post("/api/printers/{printer_id}/queue/reprint-last")
async def reprint_last_queue_job(printer_id: str):
    cfg = load()
    if not any(p.id == printer_id for p in cfg.printers):
        raise HTTPException(status_code=404, detail="printer not found")
    job = db.queue_latest_reprintable(printer_id)
    if not job:
        raise HTTPException(status_code=404, detail="No completed queue file found for this printer")
    if not db.queue_retry(int(job["id"])):
        raise HTTPException(status_code=409, detail="Last completed queue file could not be reprinted")
    db.log_decision(printer_id, "queue_reprint_last", f"Reprint last queued file: job #{job['id']} {job['filename']}")
    return {"ok": True, "job_id": job["id"], "filename": job["filename"]}


@app.delete("/api/queue/completed")
async def clear_completed_jobs(printer_id: str):
    file_paths = db.queue_clear_completed(printer_id)
    for fp in file_paths:
        try:
            Path(fp).unlink(missing_ok=True)
        except Exception:
            pass
    return {"ok": True, "deleted": len(file_paths)}


@app.delete("/api/queue/completed/clear")
async def clear_completed_jobs_alias(printer_id: str):
    return await clear_completed_jobs(printer_id)


@app.post("/api/queue/{job_id}/send")
async def send_queue_job(job_id: int):
    job = db.queue_get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if job["status"] not in {"pending", "held"}:
        raise HTTPException(status_code=409, detail=f"Job status is '{job['status']}', must be pending")
    statuses = await _printer_status_map()
    preflight = _queue_preflight(job, statuses.get(job["printer_id"]))
    if not preflight["can_start"]:
        raise HTTPException(status_code=409, detail={"message": "Preflight blocked", "preflight": preflight})
    asyncio.create_task(_advance_queue_specific(job_id, job["printer_id"],
                                                job["filename"], job["file_path"]))
    return {"ok": True}


async def _advance_queue_specific(job_id: int, printer_id: str,
                                   filename: str, file_path: str) -> None:
    job = db.queue_get(job_id)
    if job:
        statuses = await _printer_status_map()
        preflight = _queue_preflight(job, statuses.get(printer_id))
        if not preflight["can_start"]:
            reason = "; ".join(i["message"] for i in preflight["issues"] if i["level"] in ("block", "wait"))
            log.info("queue send: preflight blocked job %d on %s: %s", job_id, printer_id, reason)
            db.log_decision(printer_id, "queue_preflight_blocked", f"Job #{job_id} {filename}: {reason}")
            return
    if job and await _maybe_calibrate_before_queue(printer_id, job):
        return
    if job and not await _ensure_low_temp_unloaded_for_high_temp(printer_id, job):
        return
    db.queue_update_status(job_id, "uploading")
    plate_number = (job or {}).get("plate_number")
    try:
        for (pid, _, _, _, url, _kind, _toolhead_count) in _moonraker:
            if pid == printer_id:
                await moonraker.upload_and_start(url, file_path, filename)
                db.queue_set_started(job_id)
                return
        for p in _bambu:
            if p.id == printer_id:
                await asyncio.to_thread(p.send_file, file_path, filename, plate_number)
                db.queue_set_started(job_id)
                await _wait_for_bambu_physical_start(p, job_id, filename)
                return
        db.queue_update_status(job_id, "failed", "Printer not found")
    except Exception as exc:
        log.error("queue send: job %d failed: %s", job_id, exc)
        db.queue_update_status(job_id, "failed", str(exc))


def _bambu_physical_start_confirmed(status: PrinterStatus) -> bool:
    if (status.state or "").lower() not in {"printing", "paused"}:
        return False
    if any(float((r.target if r else 0) or 0) > 0 for r in status.temps.values()):
        return True
    if status.job and float(status.job.progress or 0) > 0.001:
        return True
    return False


def _block_printer_dispatch(printer_id: str, note: str) -> None:
    db.set_printer_printing_enabled(printer_id, False)
    db.set_printer_printing_note(printer_id, note)
    if printer_id in _latest_printers:
        _latest_printers[printer_id]["print_enabled"] = False
        _latest_printers[printer_id]["print_enabled_note"] = note


async def _wait_for_bambu_physical_start(p: BambuPrinter, job_id: int, filename: str) -> bool:
    # H-series / AMS preparation can legitimately take several minutes.  Do not
    # treat an unrelated or stale HMS entry as evidence that project_file failed.
    started_at = time.monotonic()
    deadline = started_at + 360.0
    last_state = "unknown"
    while time.monotonic() < deadline:
        await asyncio.sleep(3.0)
        try:
            status_obj = await asyncio.to_thread(p.status)
        except Exception as exc:
            last_state = f"status error: {exc}"
            continue
        last_state = str(status_obj.state or "unknown").lower()
        if _bambu_physical_start_confirmed(status_obj):
            db.log_decision(
                p.id,
                "queue_bambu_start_confirmed",
                f"Job #{job_id} {filename}: physical start confirmed",
            )
            return True

        # Only the printer's actual runtime state is authoritative for a
        # start failure. HMS telemetry can contain advisory/stale entries.
        if last_state in {"error", "estop"}:
            detail = str(status_obj.error or f"Printer reported {last_state} before physical start")
            db.queue_update_status(job_id, "failed", detail)
            try:
                hms = await asyncio.to_thread(p.hms_summary)
            except Exception:
                hms = None
            log_detail = f"Job #{job_id} {filename}: {detail}"
            if hms:
                log_detail += f"; HMS advisory: {hms}"
            db.log_decision(p.id, "queue_bambu_start_failed", log_detail)
            return False

    # A start that never produces physical evidence is still a failure, but
    # report that fact directly instead of blaming whichever HMS happened to
    # be present in the MQTT snapshot.
    detail = f"Printer did not confirm physical start within 360 seconds (last state: {last_state})"
    db.queue_update_status(job_id, "failed", detail)
    try:
        hms = await asyncio.to_thread(p.hms_summary)
    except Exception:
        hms = None
    log_detail = f"Job #{job_id} {filename}: {detail}"
    if hms:
        log_detail += f"; HMS advisory: {hms}"
    db.log_decision(p.id, "queue_bambu_start_unconfirmed", log_detail)
    return False


# ── OrcaSlicer relay ──────────────────────────────────────────────────────
# Configure OrcaSlicer Physical Printer host as:
#   http://<flightdeck-host>:8000/relay/<printer_id>
# OrcaSlicer appends /printer/info, /server/files/upload, /printer/print/start.

def _find_bambu(printer_id: str):
    return next((p for p in _bambu if p.id == printer_id), None)

def _find_moonraker_url(printer_id: str):
    return next((url for (id, _, _, _, url, _kind, _toolhead_count) in _moonraker if id == printer_id), None)

_BUSY_STATES = {"printing", "paused"}


@app.get("/relay/{printer_id}/printer/info")
async def relay_printer_info(printer_id: str):
    if _find_bambu(printer_id) or _find_moonraker_url(printer_id):
        return {"result": {"hostname": printer_id, "state": "ready", "state_message": ""}}
    raise HTTPException(status_code=404, detail="printer not found")


@app.post("/relay/{printer_id}/server/files/upload")
async def relay_upload(printer_id: str, request: Request, file: UploadFile = File(...)):
    source_ip = request.client.host if request.client else "unknown"
    filename = _safe_basename(file.filename, "upload.gcode.3mf")
    data = await _read_upload_bytes(file, label="Relay upload")

    bambu = _find_bambu(printer_id)
    if bambu:
        await relay.bambu_upload(printer_id, filename, data, source_ip, bambu)
        return {"result": {"item": {"path": filename, "root": "gcodes"}, "action": "create_file"}}

    mr_url = _find_moonraker_url(printer_id)
    if mr_url:
        await relay.moonraker_upload(printer_id, filename, data, source_ip, mr_url)
        return {"result": {"item": {"path": filename, "root": "gcodes"}, "action": "create_file"}}

    raise HTTPException(status_code=404, detail="printer not found")


@app.post("/relay/{printer_id}/printer/print/start")
async def relay_print_start(printer_id: str, request: Request):
    source_ip = request.client.host if request.client else "unknown"
    body = await request.json()
    filename = _safe_basename(body.get("filename"), "")
    if not filename:
        raise HTTPException(status_code=422, detail="filename required")

    if not db.is_printer_printing_enabled(printer_id):
        note = db.get_printer_printing_note(printer_id)
        db.log_decision(
            printer_id,
            "relay_start_blocked",
            f"file={filename} source={source_ip} printer_disabled{f' note={note}' if note else ''}",
        )
        detail = f"Printer is currently disabled: {note}" if note else "Printer is currently disabled"
        raise HTTPException(status_code=409, detail=detail)

    if not _latest_printers:
        await _gather_all()
    current = _latest_printers.get(printer_id)
    if not current:
        raise HTTPException(status_code=409, detail="Waiting for printer telemetry")

    state = current.get("state")
    if state in ("offline", "error", "estop"):
        db.log_decision(printer_id, "relay_start_blocked",
                        f"file={filename} source={source_ip} printer_state={state}")
        raise HTTPException(status_code=409, detail=f"Printer is {state}")

    if state not in ("idle", "ready", "standby", "finished"):
        db.log_decision(printer_id, "relay_start_blocked",
                        f"file={filename} source={source_ip} printer_state={state}")
        raise HTTPException(status_code=409, detail=f"Printer is {state}")

    # Belt-and-braces: refuse if printer is already busy
    if state in _BUSY_STATES:
        state = current["state"]
        db.log_decision(printer_id, "relay_start_blocked",
                        f"file={filename} source={source_ip} printer_state={state}")
        raise HTTPException(status_code=409, detail=f"Printer is {state}")

    bambu = _find_bambu(printer_id)
    if bambu:
        await relay.bambu_print_start(printer_id, filename, source_ip, bambu)
        return {"result": "ok"}

    mr_url = _find_moonraker_url(printer_id)
    if mr_url:
        # Pre-print spool low-stock warning
        try:
            async with httpx.AsyncClient(timeout=3.0) as client:
                meta_r = await client.get(f"{mr_url}/server/files/metadata",
                                          params={"filename": filename})
                if meta_r.status_code == 200:
                    fw = meta_r.json().get("result", {}).get("filament_weight_total")
                    if fw:
                        needed = float(fw)
                        loaded = db.get_spools_by_printer(printer_id)
                        if loaded:
                            for slot, spool in loaded.items():
                                remaining = spool["remaining_g"]
                                if needed > remaining:
                                    detail = (f"Spool #{spool['id']} ({spool['material']} {spool['brand']}): "
                                              f"needs {needed:.0f}g, only {remaining:.0f}g remaining")
                                    db.log_decision(printer_id, "spool_low_warning", detail)
                                    await _push_toast(
                                        f"⚠️ Low filament on slot {slot}",
                                        f"Needs {needed:.0f}g · {remaining:.0f}g remaining",
                                    )
        except Exception:
            pass
        await relay.moonraker_print_start(printer_id, filename, source_ip, mr_url)
        return {"result": "ok"}

    raise HTTPException(status_code=404, detail="printer not found")
