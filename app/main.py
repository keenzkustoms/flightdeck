from __future__ import annotations
import asyncio
import csv
import gzip
import io
import json
import logging
import os
import re
import shutil
import socket
import sqlite3
import subprocess
import tempfile
import urllib.parse
import urllib.request
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
from fastapi.responses import FileResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

import httpx

from . import db, relay
from .camera import BambuCameraProxy
from .label_printer import LabelPrinter
from .models import PrintPreview
from .paths import APP_DIR, DATA_DIR, DB_PATH, PRINTERS_CONFIG_PATH, PRINT_LIBRARY_DIR, UPLOADS_DIR
from .printer_config import BambuConnection, BambuRtspCamera, MjpegDirectCamera, MoonrakerConnection, NtfyConfig, PrinterEntry, SimulatedConnection, load, save
from .printers import moonraker, simulated
from .printers.bambu import BambuPrinter
from .scale import Scale
from .version import APP_RELEASE_NOTES, APP_VERSION, APP_VERSION_NAME

_bambu: list[BambuPrinter] = []
_moonraker: list[tuple[str, str, str, str, str]] = []  # (id, model_name, custom_name, icon, url)
_simulated: list[tuple[str, str, str, str, str, str]] = []  # (id, model_name, custom_name, icon, profile, scenario)
_cameras: dict = {}          # printer_id → Camera config
_presets: dict[str, dict] = {}  # printer_id → temperature_presets dict
_cam_proxies: dict[str, BambuCameraProxy] = {}  # printer_id → live RTSP proxy
_ws_clients: set[WebSocket] = set()
_broadcast_task: asyncio.Task | None = None
_ntfy: NtfyConfig | None = None
_prev_states: dict[str, str] = {}  # printer_id → last known state
_last_seen_cache: dict[str, datetime] = {}  # printer_id → last successful contact
_latest_printers: dict[str, dict] = {}  # printer_id → most recent gathered status
_latest_printers_at: datetime | None = None
_gather_lock: asyncio.Lock | None = None
_scale_keep_awake_task: asyncio.Task | None = None
_EMPTY_SLOT_AUTO_RETURN_GRACE_SECONDS = 600
_scale = Scale()
_label_printer = LabelPrinter()
_MAX_PRINT_FILE_BYTES = int(os.getenv("FLIGHTDECK_MAX_PRINT_FILE_MB", "2048")) * 1024 * 1024
_MAX_PROFILE_UPLOAD_BYTES = int(os.getenv("FLIGHTDECK_MAX_PROFILE_UPLOAD_MB", "64")) * 1024 * 1024
_UPLOAD_READ_CHUNK_BYTES = 1024 * 1024


def _dt_default(obj):
    if isinstance(obj, datetime):
        return obj.isoformat()
    raise TypeError(f"{type(obj)} not serializable")


def _simulated_entry(printer_id: str) -> Optional[tuple[str, str, str, str, str, str]]:
    for item in _simulated:
        if item[0] == printer_id:
            return item
    return None


def _active_printer_ids() -> set[str]:
    return {pid for (pid, *_rest) in _moonraker} | {p.id for p in _bambu} | {pid for (pid, *_rest) in _simulated}


async def _gather_all() -> list[dict]:
    global _latest_printers_at, _gather_lock
    if _gather_lock is None:
        _gather_lock = asyncio.Lock()
    async with _gather_lock:
        return await _gather_all_locked()


async def _gather_all_locked() -> list[dict]:
    global _latest_printers_at

    async def _fetch_moonraker(id, model_name, custom_name, icon, url):
        status = await moonraker.fetch(id, model_name, custom_name, icon, url)
        status.temperature_presets = _presets.get(id, {})
        _update_last_seen(status)
        d = asdict(status)
        cal = db.get_calibration(id)
        if cal:
            d["eta_calibration"] = cal
        d["health"] = db.get_printer_health(id)
        d["_error_print_id"] = moonraker._error_print_id.get(id)
        parsed = urllib.parse.urlparse(url)
        d["klipper_ui_url"] = f"{parsed.scheme or 'http'}://{parsed.hostname}" if parsed.hostname else url
        return d

    async def _fetch_bambu(p):
        status = await asyncio.to_thread(p.status)
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
        [_fetch_moonraker(id, model_name, custom_name, icon, url)
         for (id, model_name, custom_name, icon, url) in _moonraker] +
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


def _printer_meta(printer_id: str) -> Optional[dict]:
    for pid, model_name, custom_name, _icon, _url in _moonraker:
        if pid == printer_id:
            return {"id": pid, "model_name": model_name, "custom_name": custom_name, "kind": "moonraker"}
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
    """Keep Flightdeck-assigned AMS slots authoritative over stale Bambu profiles."""
    printer_id = printer_status.get("id")
    if not printer_id:
        return
    loaded_by_slot = db.get_spools_by_printer(str(printer_id))
    if not loaded_by_slot:
        return
    for slot in _flatten_reported_ams_slots(printer_status, include_empty=True):
        flat_slot = slot.get("flat_slot")
        if flat_slot is None:
            continue
        spool = loaded_by_slot.get(int(flat_slot))
        if not spool:
            continue
        if _reported_slot_is_stale_empty(slot):
            continue
        if _assigned_spool_matches_report(spool, slot):
            continue
        if _recent_profile_replay(str(printer_id), int(flat_slot), int(spool["id"])):
            continue
        full_spool = db.get_spool(int(spool["id"])) or spool
        asyncio.create_task(_sync_bambu_ams_slot(str(printer_id), int(flat_slot), full_spool))
        db.log_decision(
            str(printer_id),
            "ams_slot_profile_replayed",
            f"{printer_id}:{flat_slot} spool #{spool['id']} overwrote stale printer profile",
        )


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


def _reconcile_reported_loaded_slots(printer_status: dict) -> None:
    """Claim a shelved spool when Bambu reports a loaded RFID/profile slot."""
    printer_id = printer_status.get("id")
    if not printer_id:
        return

    loaded_by_slot = db.get_spools_by_printer(str(printer_id))
    available = [
        spool for spool in db.get_spools()
        if spool.get("location_printer_id") is None and not spool.get("archived_at")
    ]
    if not available:
        return

    for slot in _flatten_reported_ams_slots(printer_status, include_empty=True):
        if slot.get("empty"):
            continue
        flat_slot = slot.get("flat_slot")
        if flat_slot is None or loaded_by_slot.get(int(flat_slot)):
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
        best = _best_spool_for_reported_slot(slot, slot_available, preferred_spool_id)
        if not best:
            continue

        spool, score, reason = best
        result = db.move_spool(
            int(spool["id"]),
            str(printer_id),
            int(flat_slot),
            spool.get("storage_location_id") or spool.get("home_storage_location_id"),
        )
        if not result.get("ok"):
            continue
        source_location = _spool_location_label(spool.get("storage_location_id") or spool.get("home_storage_location_id"))
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
                f"to {slot.get('label') or flat_slot}; matched printer report "
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
        if proxy._latest:
            return proxy._latest
        # Proxy may be idle — try starting it briefly
        try:
            await proxy._start()
            for _ in range(30):  # up to 3 s
                if proxy._latest:
                    return proxy._latest
                await asyncio.sleep(0.1)
        except Exception:
            pass
        return proxy._latest  # may still be None if camera is down

    # Moonraker: hit the crowsnest snapshot URL directly
    camera = _cameras.get(printer_id)
    if isinstance(camera, MjpegDirectCamera) and camera.snapshot_url:
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                r = await client.get(camera.snapshot_url)
                if r.status_code == 200:
                    return r.content
        except Exception as exc:
            log.warning("snapshot fetch failed for %s: %s", printer_id, exc)

    return None


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


def _check_transitions(data: list[dict]) -> None:
    for p in data:
        pid = p["id"]
        curr = p["state"]
        prev = _prev_states.get(pid)
        _prev_states[pid] = curr
        if prev is None or prev == curr:
            continue
        log.info("state transition %s: %s → %s", pid, prev, curr)
        name = p.get("custom_name") or p.get("id")
        job = p.get("job") or {}
        fname = (job.get("filename") or "").rsplit("/", 1)[-1].rsplit("\\", 1)[-1]
        sub = job.get("subtask_name", "").strip()
        label = sub if sub and sub != fname else fname
        has_error_print = p.get("_error_print_id") is not None
        is_simulated = bool(p.get("_simulated"))
        title_prefix = "SIM " if is_simulated else ""

        if prev == "printing" and curr in {"finished", "ready", "standby", "complete"}:
            if curr == "finished" or _recently_finished(pid):
                msg = f"{name}" + (f" · {label}" if label else "")
                _notify("success", f"{title_prefix}Print complete", msg, printer_id=pid, link=f"#/printer/{pid}/history")
                if not is_simulated:
                    asyncio.create_task(_send_ntfy("Print complete", msg, ["white_check_mark"]))
                asyncio.create_task(_on_print_finished_queue(pid))
            else:
                msg = f"{name}" + (f" · {label}" if label else "")
                _notify("warn", f"{title_prefix}Print cancelled", msg, printer_id=pid, link=f"#/printer/{pid}/history")
                if not is_simulated:
                    asyncio.create_task(_send_ntfy("Print cancelled", msg, ["x"]))
                db.queue_cancel_active(pid, "cancelled")
        elif curr in ("error", "estop"):
            error_pid = p.get("_error_print_id")
            is_print_failure = prev == "printing" or has_error_print
            if is_print_failure:
                asyncio.create_task(_do_failure_snapshot(pid, error_pid))
            if curr == "error" and is_print_failure:
                msg = f"{name}" + (f" · {label}" if label else "")
                if p.get("error"):
                    msg += f" · {p['error']}"
                _notify("error", f"{title_prefix}Print error", msg, printer_id=pid, print_id=error_pid, link=f"#/printer/{pid}/live")
                if not is_simulated:
                    asyncio.create_task(_send_ntfy("Print error", msg, ["warning"], priority=4))
                db.queue_cancel_active(pid, "failed")
        elif prev == "printing" and curr == "paused":
            msg = f"{name}" + (f" · {label}" if label else "")
            if p.get("error"):
                msg += f" · {p['error']}"
            _notify("info", f"{title_prefix}Print paused", msg, printer_id=pid, link=f"#/printer/{pid}/live")
            if not is_simulated:
                asyncio.create_task(_send_ntfy("Print paused", msg, ["double_vertical_bar"]))
        elif prev == "printing" and curr == "idle":
            msg = f"{name}" + (f" · {label}" if label else "")
            _notify("warn", f"{title_prefix}Print cancelled", msg, printer_id=pid, link=f"#/printer/{pid}/history")
            if not is_simulated:
                asyncio.create_task(_send_ntfy("Print cancelled", msg, ["x"]))
            db.queue_cancel_active(pid, "cancelled")


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
    while True:
        await asyncio.sleep(5)
        try:
            data = await _gather_all()
            _check_transitions(data)
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


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _broadcast_task, _scale_keep_awake_task, _ntfy
    db.init()
    _last_seen_cache.update(db.get_all_last_seen())
    cfg = load()
    _ntfy = cfg.ntfy

    for entry in cfg.printers:
        conn = entry.connection
        _cameras[entry.id] = entry.camera
        _presets[entry.id] = entry.temperature_presets or {}
        if isinstance(conn, MoonrakerConnection):
            _moonraker.append((entry.id, entry.model_name, entry.custom_name,
                               entry.icon_key(), conn.url))
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

    # Seed prev states so startup doesn't fire spurious notifications
    try:
        for p in await _gather_all():
            _prev_states[p["id"]] = p["state"]
    except Exception:
        pass

    _broadcast_task = asyncio.create_task(_broadcast_loop())
    _scale_keep_awake_task = asyncio.create_task(_scale_keep_awake_loop())

    yield

    if _broadcast_task:
        _broadcast_task.cancel()
    if _scale_keep_awake_task:
        _scale_keep_awake_task.cancel()
    for proxy in _cam_proxies.values():
        await proxy.stop()
    _cam_proxies.clear()
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
    plate: str = "auto"
    bed_type: str = "Textured PEI Plate"
    all_plates: bool = False


class SliceOutputStatusRequest(BaseModel):
    filename: str


class SliceRunRequest(SlicePlanRequest):
    output_filename: Optional[str] = None


class SlicerConnectionCheckRequest(BaseModel):
    kind: str
    url: str


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
    timeout = httpx.Timeout(4.0, connect=1.0)
    async with httpx.AsyncClient(timeout=timeout) as client:
        r = await client.get(f"{base_url.rstrip('/')}/server/files/list", params={"root": "gcodes"})
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


async def _download_moonraker_file(base_url: str, path: str) -> bytes:
    from urllib.parse import quote
    safe = quote(path.lstrip("/"), safe="/")
    async with httpx.AsyncClient(timeout=120.0) as client:
        r = await client.get(f"{base_url.rstrip('/')}/server/files/gcodes/{safe}")
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
            p = _parse_3mf(io.BytesIO(data))
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
        try:
            from .printers.bambu_ftp import list_bambu_files
            files = await asyncio.to_thread(list_bambu_files, p._ip, p._access_code)
            error = None
        except Exception as exc:
            files = []
            error = str(exc)
        return {
            "id": p.id,
            "label": p.custom_name or p.model_name,
            "model": p.model_name,
            "kind": "bambu",
            "files": _mark_vaulted_files(files, vault_lookup),
            "error": error,
            "actions": {"format_sd": True, "format_sd_ready": False},
        }

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
         for (pid, model_name, custom_name, _icon, url) in _moonraker
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
        id: {"id": id, "model_name": model_name, "custom_name": custom_name, "kind": "moonraker"}
        for (id, model_name, custom_name, _icon, _url) in _moonraker
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
    if target_kind not in {"moonraker", "bambu"}:
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

    meta = _queue_file_metadata(filename, data)
    job_id = db.queue_add(
        printer_id, filename, file_path, len(data),
        preview_png=meta["preview_png"],
        estimated_seconds=meta["estimated_seconds"],
        filament_weight_g=meta["filament_weight_g"],
        filament_type=meta["filament_type"],
        filament_colors=meta["filament_colors"],
    )
    db.log_decision(printer_id, "filedesk_queued", f"{source_id}:{source_path} -> job #{job_id}")
    return {"id": job_id}


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
    worker_url = (settings.get("orcaslicer_worker_url") or "").strip().rstrip("/")
    api_url = (settings.get("orcaslicer_api_url") or "").strip().rstrip("/")
    output_ext = ".gcode.3mf" if target_kind == "bambu" else ".gcode"
    base_name = _file_archive_key(filename) or "sliced_model"
    target = next((p for p in await _gather_all() if p.get("id") == printer_id), None)
    profiles = {
        "printer": settings.get(_slicer_profile_key(printer_id, "printer"), ""),
        "process": settings.get(_slicer_profile_key(printer_id, "process"), ""),
        "filament": settings.get(_slicer_profile_key(printer_id, "filament"), ""),
    }
    missing_profiles = [label for label, value in profiles.items() if not str(value or "").strip()]
    can_slice = bool(worker_url or api_url or _orca_executable()) and not missing_profiles and not is_step_source
    can_handoff = is_step_source and not missing_profiles
    return {
        "ok": True,
        "ready": can_slice or can_handoff,
        "can_background_slice": can_slice,
        "manual_handoff": can_handoff,
        "sidecar_url": browser_url,
        "browser_url": browser_url,
        "api_url": api_url,
        "worker_url": worker_url,
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
        "missing_profiles": missing_profiles,
        "plate": body.plate or "auto",
        "all_plates": bool(body.all_plates),
        "message": (
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


@app.post("/api/slicer/check")
async def check_slicer_connection(body: SlicerConnectionCheckRequest):
    kind = (body.kind or "").strip().lower()
    base_url = (body.url or "").strip().rstrip("/")
    if kind not in {"api", "worker", "browser"}:
        raise HTTPException(status_code=422, detail="kind must be api, worker, or browser")
    parsed = urllib.parse.urlparse(base_url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise HTTPException(status_code=422, detail="Enter a full http:// or https:// URL")

    path = "/health" if kind == "api" else ("/api/slicer/worker/status" if kind == "worker" else "")
    target = f"{base_url}{path}"
    verify_tls = False if kind == "browser" else True
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(connect=3.0, read=8.0, write=3.0, pool=3.0), follow_redirects=True, verify=verify_tls) as client:
            resp = await client.get(target)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Could not reach {kind} URL: {exc}") from exc
    auth_required = kind == "browser" and resp.status_code in {401, 403}
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
    if sidecar_url:
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
        )
    else:
        name, data, _log = await asyncio.to_thread(
            _run_orca_slice_local,
            filename=source_name,
            data=source_data,
            profiles=profiles,
            output_kind=output_kind,
            output_filename=output_filename,
            plate=plate,
            all_plates=all_plates,
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

    settings = db.get_all_settings()
    profiles = {
        "printer": settings.get(_slicer_profile_key(printer_id, "printer"), ""),
        "process": settings.get(_slicer_profile_key(printer_id, "process"), ""),
        "filament": settings.get(_slicer_profile_key(printer_id, "filament"), ""),
    }
    missing_profiles = [label for label, value in profiles.items() if not str(value or "").strip()]
    if missing_profiles:
        raise HTTPException(status_code=422, detail=f"Set slicer defaults for {', '.join(missing_profiles)} first")

    output_kind = "gcode.3mf" if target_kind == "bambu" else "gcode"
    output_ext = ".gcode.3mf" if output_kind == "gcode.3mf" else ".gcode"
    base_name = _file_archive_key(filename) or "sliced_model"
    output_filename = (body.output_filename or f"{base_name}_{printer_id}{output_ext}").strip()
    worker_url = (settings.get("orcaslicer_worker_url") or "").strip().rstrip("/")
    sidecar_url = (settings.get("orcaslicer_api_url") or "").strip().rstrip("/")
    target = _printer_meta(printer_id) or {}
    target_name = " ".join(str(v or "") for v in ((target or {}).get("model_name"), (target or {}).get("custom_name"), profiles["printer"]))
    arrange = target_kind == "bambu" and ("h2d" in target_name.lower() or filename.lower().endswith(".3mf"))

    if worker_url:
        form = {
            "printer_profile": profiles["printer"],
            "process_profile": profiles["process"],
            "filament_profile": profiles["filament"],
            "output_kind": output_kind,
            "output_filename": output_filename,
            "plate": body.plate or "1",
            "all_plates": str(bool(body.all_plates)).lower(),
            "sidecar_url": sidecar_url,
            "arrange": str(bool(arrange)).lower(),
            "bed_type": body.bed_type or "Textured PEI Plate",
        }
        files = {"file": (filename, data, "application/octet-stream")}
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(connect=10.0, read=900.0, write=30.0, pool=10.0)) as client:
                resp = await client.post(f"{worker_url}/api/slicer/worker/slice", data=form, files=files)
        except Exception as exc:
            if not sidecar_url:
                detail = str(exc).strip() or "connection timed out"
                raise HTTPException(status_code=502, detail=f"Slicer worker unreachable: {detail}") from exc
            log.warning("slicer worker unreachable, falling back to API: %s", exc)
            sliced_name, sliced_data, _log = await asyncio.to_thread(
                _run_orca_slice_sidecar,
                sidecar_url=sidecar_url,
                filename=filename,
                data=data,
                profiles=profiles,
                output_kind=output_kind,
                output_filename=output_filename,
                plate=body.plate or "1",
                all_plates=bool(body.all_plates),
                arrange=arrange,
                bed_type=body.bed_type or "Textured PEI Plate",
            )
        else:
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
            plate=body.plate or "1",
            all_plates=bool(body.all_plates),
            arrange=arrange,
            bed_type=body.bed_type or "Textured PEI Plate",
        )
    else:
        sliced_name, sliced_data, _log = await asyncio.to_thread(
            _run_orca_slice_local,
            filename=filename,
            data=data,
            profiles=profiles,
            output_kind=output_kind,
            output_filename=output_filename,
            plate=body.plate or "1",
            all_plates=bool(body.all_plates),
        )

    library_root = _print_library_path().resolve()
    library_root.mkdir(parents=True, exist_ok=True)
    _enforce_file_size(len(sliced_data), label="Sliced output")
    dest = _unique_library_destination(library_root, sliced_name or output_filename)
    dest.write_bytes(sliced_data)
    stat = dest.stat()
    db.log_decision(printer_id, "slicer_run", json.dumps({
        "source": filename,
        "output": dest.name,
        "worker": worker_url or "local",
        "profiles": profiles,
    }))
    return {
        "ok": True,
        "filename": dest.name,
        "path": dest.relative_to(library_root).as_posix(),
        "kind": _file_kind(dest.name),
        "size": stat.st_size,
        "printer_id": printer_id,
        "profiles": profiles,
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
    cached = _cached_printers()
    if cached is not None:
        return cached
    return await _gather_all()


@app.get("/api/printers/{printer_id}")
async def get_printer(printer_id: str):
    for (id, model_name, custom_name, icon, url) in _moonraker:
        if id == printer_id:
            return asdict(await moonraker.fetch(id, model_name, custom_name, icon, url))

    for p in _bambu:
        if p.id == printer_id:
            return asdict(await asyncio.to_thread(p.status))

    for (id, model_name, custom_name, icon, profile, scenario) in _simulated:
        if id == printer_id:
            return asdict(simulated.status(id, model_name, custom_name, icon, profile, scenario))

    raise HTTPException(status_code=404, detail="printer not found")


@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket):
    await ws.accept()
    _ws_clients.add(ws)
    try:
        data = await _gather_all()
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
    for (id, model_name, custom_name, icon, url) in _moonraker:
        if id == printer_id:
            status = await moonraker.fetch(id, model_name, custom_name, icon, url)
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


class SetTempRequest(BaseModel):
    heater: str
    target: int


class FanRequest(BaseModel):
    speed: int
    channel: str = "part"


class JogZRequest(BaseModel):
    distance: float


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
    if req.heater not in ("hotend", "bed", "chamber"):
        raise HTTPException(status_code=400, detail="invalid heater")
    if not (0 <= req.target <= 350):
        raise HTTPException(status_code=400, detail="target out of range (0-350)")

    for (id, model_name, custom_name, icon, url) in _moonraker:
        if id == printer_id:
            try:
                await moonraker.set_temp(url, req.heater, req.target)
            except Exception as exc:
                raise HTTPException(status_code=502, detail=str(exc))
            return {"ok": True}

    for p in _bambu:
        if p.id == printer_id:
            await asyncio.to_thread(p.set_temp, req.heater, req.target)
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

    for (id, model_name, custom_name, icon, url) in _moonraker:
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

    for (id, model_name, custom_name, icon, url) in _moonraker:
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


@app.post("/api/printers/{printer_id}/home")
async def home_printer_axes(printer_id: str, req: HomeRequest):
    axes = req.axes.lower().strip()
    if axes not in ("xy", "z", "all"):
        raise HTTPException(status_code=400, detail="invalid home axes")

    for (id, model_name, custom_name, icon, url) in _moonraker:
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

    for (id, model_name, custom_name, icon, url) in _moonraker:
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
        return {"url": f"/api/camera/{printer_id}/simulated.svg", "type": "simulated"}
    camera = _cameras.get(printer_id)
    if camera is None:
        raise HTTPException(status_code=404, detail="no camera configured")
    if isinstance(camera, MjpegDirectCamera):
        return {"url": f"/api/camera/{printer_id}/stream", "type": "mjpeg"}
    if isinstance(camera, BambuRtspCamera):
        return {"url": f"/api/camera/{printer_id}/stream", "type": "mjpeg"}
    raise HTTPException(status_code=404, detail="unknown camera type")


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


@app.get("/api/camera/{printer_id}/stream")
async def camera_stream(printer_id: str):
    camera = _cameras.get(printer_id)
    if isinstance(camera, MjpegDirectCamera):
        return await _mjpeg_direct_response(camera.stream_url)

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
    return db.get_prints_for_day(printer_id, date)


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
    for (id, model_name, custom_name, icon, url) in _moonraker:
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

    if isinstance(conn, MoonrakerConnection):
        _moonraker.append((entry.id, entry.model_name, entry.custom_name, entry.icon_key(), conn.url))
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

    if isinstance(conn, MoonrakerConnection):
        _moonraker.append((entry.id, entry.model_name, entry.custom_name, entry.icon_key(), conn.url))
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
    for (id, model_name, custom_name, icon, url) in _moonraker:
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
async def get_printer_thumbnail(printer_id: str):
    for (id, model_name, custom_name, icon, url) in _moonraker:
        if id == printer_id:
            status = await moonraker.fetch(id, model_name, custom_name, icon, url)
            if status.job:
                preview = await moonraker.fetch_preview(url, status.job.filename)
                if preview and preview.image_png:
                    return Response(content=preview.image_png, media_type="image/png")
            raise HTTPException(status_code=404, detail="no thumbnail")

    for p in _bambu:
        if p.id == printer_id:
            preview = await asyncio.to_thread(p.get_preview)
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


@app.get("/api/settings")
async def get_settings():
    return db.get_all_settings()


@app.put("/api/settings/{key}")
async def put_setting(key: str, body: SettingUpdate):
    value = body.value
    if key == "print_vault_path":
        value = "" if not value.strip() else str(_validate_print_library_path(value))
    db.set_setting(key, value)
    return {"ok": True, "value": value}


_ORCA_PROFILE_VENDORS = ["BBL", "Sovol", "Voron", "Prusa", "Anycubic", "Creality"]
_ORCA_PROFILE_BASE = "https://raw.githubusercontent.com/OrcaSlicer/OrcaSlicer/main/resources/profiles"


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
    name = str(profile.get("name") or Path(source_path).stem).strip()
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
    for root in _orca_profile_roots(exe):
        candidates = list(root.glob(f"*/{category}/*.json")) + list(root.glob(f"{category}/*.json"))
        for path in candidates:
            if path.name.lower() == filename:
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
            rel_path = str(row.get("path") or "").strip()
            if not vendor_key or not rel_path:
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


def _slicer_profile_blob(profile_name: str, category: str, exe: Path | None = None) -> tuple[str, bytes]:
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
    if "unknown file format" in lowered and ".step" in lowered:
        return "Orca background slicing cannot import STEP files. Use Open Orca/Download model, or export the source as STL/3MF first."
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    important = [
        line for line in lines
        if "[error]" in line.lower() or "error" in line.lower() or "failed" in line.lower()
    ]
    picked = important[-3:] if important else lines[-4:]
    summary = " ".join(picked).strip()
    return summary[-500:] if summary else text[-500:]


def _slicer_model_mime(filename: str) -> str:
    lower = (filename or "").lower()
    if lower.endswith(".stl"):
        return "model/stl"
    if lower.endswith((".step", ".stp")):
        return "model/step"
    if lower.endswith(".3mf"):
        return "model/3mf"
    return "application/octet-stream"


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
) -> tuple[str, bytes, str]:
    exe = _orca_executable()
    machine_name, machine_data = _slicer_profile_blob(str(profiles.get("printer") or ""), "machine", exe)
    process_name, process_data = _slicer_profile_blob(str(profiles.get("process") or ""), "process", exe)
    filament_name, filament_data = _slicer_profile_blob(str(profiles.get("filament") or ""), "filament", exe)

    safe_source = _safe_basename(filename, "flightdeck-model.stl")
    requested = _safe_basename(output_filename, f"{_file_archive_key(safe_source)}.gcode.3mf")
    sidecar_url = sidecar_url.strip().rstrip("/")
    if not sidecar_url:
        raise HTTPException(status_code=422, detail="Slicer API URL is not set")

    files = [
        ("file", (safe_source, data, _slicer_model_mime(safe_source))),
        ("printerProfile", (machine_name, machine_data, "application/json")),
        ("presetProfile", (process_name, process_data, "application/json")),
        ("filamentProfile", (filament_name, filament_data, "application/json")),
    ]
    form = {
        "plate": "0" if all_plates else str(plate or "1"),
        "exportType": "3mf" if output_kind == "gcode.3mf" else "gcode",
        "arrange": "true" if arrange else "false",
        "bedType": (bed_type or "Textured PEI Plate").strip() or "Textured PEI Plate",
        "requestId": f"flightdeck-{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S%f')}",
    }
    try:
        with httpx.Client(timeout=httpx.Timeout(connect=10.0, read=900.0, write=60.0, pool=10.0)) as client:
            response = client.post(f"{sidecar_url}/slice", data=form, files=files)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Slicer API unreachable: {exc}") from exc

    if response.status_code >= 400:
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
    return name, response.content, f"Slicer API {response.status_code}"


def _run_orca_slice_local(
    *,
    filename: str,
    data: bytes,
    profiles: dict,
    output_kind: str,
    output_filename: str,
    plate: str = "1",
    all_plates: bool = False,
) -> tuple[str, bytes, str]:
    exe = _orca_executable()
    if not exe:
        raise HTTPException(status_code=503, detail="OrcaSlicer executable not found on this machine")
    machine = _orca_profile_file(str(profiles.get("printer") or ""), "machine", exe)
    process = _orca_profile_file(str(profiles.get("process") or ""), "process", exe)
    filament = _orca_profile_file(str(profiles.get("filament") or ""), "filament", exe)

    safe_source = _safe_basename(filename, "flightdeck-model")
    suffixes = "".join(Path(safe_source).suffixes)
    suffix = suffixes if suffixes.lower() in {".stl", ".obj", ".step", ".stp", ".3mf"} else ".stl"
    requested = _safe_basename(output_filename, f"{_file_archive_key(safe_source)}.gcode.3mf")
    with tempfile.TemporaryDirectory(prefix="flightdeck-slice-") as tmp_raw:
        tmp = Path(tmp_raw)
        source_path = tmp / f"source{suffix}"
        source_path.write_bytes(data)
        args = [str(exe)]
        datadir = _orca_datadir()
        if datadir:
            args += ["--datadir", str(datadir)]
        args += [
            "--load-settings", f"{machine};{process}",
            "--load-filaments", str(filament),
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
            raise HTTPException(status_code=502, detail=_friendly_slicer_error(detail))
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
async def sync_slicer_profiles(body: SlicerProfileSyncRequest):
    vendors = [v.strip() for v in (body.vendors or []) if v.strip()] or ["BBL", "Sovol", "Voron", "Prusa", "Anycubic"]
    vendors = [v for v in vendors if v in _ORCA_PROFILE_VENDORS]
    if not vendors:
        raise HTTPException(status_code=422, detail="No supported profile vendors selected")
    synced = []
    errors = []
    for vendor in vendors:
        try:
            payload = await asyncio.to_thread(_fetch_orca_profile_vendor, vendor)
            db.save_slicer_profile_vendor(vendor, payload)
            synced.append(vendor)
        except Exception as exc:
            errors.append({"vendor": vendor, "error": str(exc)})
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


def _app_version_info(include_remote: bool = False) -> dict:
    branch = _git_text(["rev-parse", "--abbrev-ref", "HEAD"], "unknown")
    commit = _git_text(["rev-parse", "--short", "HEAD"], "unknown")
    dirty = bool(_git_text(["status", "--porcelain"], ""))
    info = {
        "version": APP_VERSION,
        "name": APP_VERSION_NAME,
        "release_notes": APP_RELEASE_NOTES,
        "branch": branch,
        "commit": commit,
        "dirty": dirty,
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


def _is_writable_dir(path: Path) -> bool:
    path.mkdir(parents=True, exist_ok=True)
    probe = path / ".flightdeck-write-test"
    try:
        probe.write_text("ok", encoding="utf-8")
        probe.unlink(missing_ok=True)
        return True
    except Exception:
        return False


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
        raise HTTPException(status_code=409, detail="Local changes are present. Commit or stash them before updating.")
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
        "QL-700 label printer",
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


@app.get("/api/scale/read")
async def read_scale():
    reading = _scale.read_stable()
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


OPEN_FILAMENT_CSV_BASES = [
    "https://api.openfilamentdatabase.org/csv",
    "https://openfilamentcollective.github.io/open-filament-database/csv",
]


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
async def get_filament_catalog_status():
    return db.get_filament_catalog_status()


@app.post("/api/filament/catalog/sync")
async def sync_filament_catalog():
    try:
        return await asyncio.to_thread(_sync_open_filament_catalog)
    except Exception as exc:
        _app_log.exception("filament catalog sync failed")
        _notify("warn", "Filament catalogue sync failed", str(exc), link="#/settings/filament")
        raise HTTPException(status_code=502, detail=f"Filament catalogue sync failed: {exc}")


@app.get("/api/filament/catalog/search")
async def search_filament_catalog(q: str = "", brand: str = "", material: str = "", limit: int = 25):
    return db.search_filament_catalog(q=q, brand=brand, material=material, limit=limit)


@app.put("/api/filament/costs/{material}/{brand}")
async def put_filament_cost(material: str, brand: str, body: CostUpdate):
    db.set_material_cost(material, brand, body.cost_per_gram, body.comment, body.empty_spool_weight_g)
    return {"ok": True}

@app.delete("/api/filament/costs/{material}/{brand}")
async def delete_filament_cost(material: str, brand: str):
    db.delete_material_cost(material, brand)
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

class SpoolMove(BaseModel):
    printer_id: Optional[str] = None
    slot: Optional[int] = None
    storage_location_id: Optional[int] = None

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
    result = db.receive_incoming_stock_roll(
        token,
        storage_location_id=body.storage_location_id,
        remaining_g=body.remaining_g,
        label_weight_g=body.label_weight_g,
        empty_spool_weight_g=body.empty_spool_weight_g,
        notes=body.notes,
    )
    if not result:
        raise HTTPException(status_code=404, detail="Incoming roll not found")
    label_printed = False
    label_error = None
    spool = result.get("spool")
    if body.print_label and spool:
        ok = await asyncio.to_thread(_label_printer.print_spool_label, _label_spool(spool), _label_base_url())
        if ok:
            label_printed = True
            db.log_decision("system", "label_printed", f"Spool #{spool['id']} stock-in receive")
        else:
            label_error = _label_printer.last_error or "Label printer unavailable"
            db.log_decision("system", "label_print_failed", f"Spool #{spool['id']}: {label_error}")
            _notify("warn", "Label print failed", f"Spool #{spool['id']}: {label_error}", link="#/settings/hardware")
    return {**result, "label_printed": label_printed, "label_error": label_error}

@app.get("/api/spools/by-printer/{printer_id}")
async def get_spools_by_printer(printer_id: str):
    return db.get_spools_by_printer(printer_id)

@app.get("/api/spools")
async def get_spools(include_archived: bool = False):
    return db.get_spools(include_archived=include_archived)

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
async def archive_spool_location(location_id: int):
    if not db.archive_spool_location(location_id):
        raise HTTPException(status_code=404, detail="Location not found")
    return {"ok": True}

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
                detail={"message": f"Slot occupied by spool #{conflict['id']}", "conflict_spool_id": conflict["id"]})
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
            db.log_decision("system", "label_printed", f"Spool #{spool_id} auto-print")
        else:
            message = _label_printer.last_error or "Label printer unavailable"
            db.log_decision("system", "label_print_failed", f"Spool #{spool_id}: {message}")
            _notify("warn", "Label print failed", f"Spool #{spool_id}: {message}", link="#/settings/hardware")
    ams_sync = None
    if body.location_printer_id and body.location_slot is not None:
        spool = db.get_spool(spool_id)
        ams_sync = await _sync_bambu_ams_slot(body.location_printer_id, body.location_slot, spool)
    return {"id": spool_id, "ams_sync": ams_sync}

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
        reading = _scale.read_stable()
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
        reading = _scale.read_stable()
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

@app.post("/api/spools/{spool_id}/move")
async def move_spool(spool_id: int, body: SpoolMove):
    before = db.get_spool(spool_id)
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
        ams_sync = await _sync_bambu_ams_slot(body.printer_id, body.slot, spool)
    return {"ok": True, "ams_sync": ams_sync}


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


async def _sync_bambu_ams_slot(printer_id: str, slot: int, spool: Optional[dict]) -> Optional[bool]:
    for p in _bambu:
        if p.id != printer_id:
            continue
        try:
            clear_first = False
            if spool:
                status = _latest_printers.get(printer_id)
                reported = next(
                    (
                        s for s in _flatten_reported_ams_slots(status, include_empty=True)
                        if int(s.get("flat_slot", -1)) == int(slot)
                    ),
                    None,
                )
                if reported and not reported.get("empty"):
                    reported_material = _norm_material(reported.get("type"))
                    spool_material = _norm_material(spool.get("material"))
                    colour_mismatch = _hex_dist(reported.get("color"), spool.get("color_hex")) > 35
                    material_mismatch = (
                        reported_material
                        and spool_material
                        and not _spool_matches_material(spool, reported.get("type"))
                    )
                    clear_first = bool(colour_mismatch or material_mismatch)
            if clear_first:
                await asyncio.to_thread(p.set_ams_slot_filament, slot, None)
                await asyncio.sleep(3)
            ok = await asyncio.to_thread(p.set_ams_slot_filament, slot, spool)
            action = "ams_slot_synced" if spool else "ams_slot_cleared"
            target = f"{printer_id}:{slot}"
            detail = f"{target} {'spool #' + str(spool['id']) if spool else 'empty'}"
            if clear_first:
                detail += " after clearing stale printer profile"
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
    for (pid, *_) in _moonraker:
        if pid == printer_id:
            return "moonraker"
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
    if not _latest_printers:
        await _gather_all()
    return dict(_latest_printers)


def _norm_material(value: Optional[str]) -> str:
    return re.sub(r"[^a-z0-9]+", "", (value or "").lower())


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
    reported = _norm_material(reported_brand)
    spool_brand = _norm_material(spool.get("brand") or "")
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


def _queue_colour_requirements(job: dict) -> list[dict]:
    material = _norm_material(job.get("filament_type"))
    grouped: dict[tuple[str, str], dict] = {}
    for item in _queue_filament_colors(job):
        color = _norm_hex(item.get("color"))
        if not color:
            continue
        item_material = _norm_material(item.get("type")) or material
        key = (item_material, color)
        req = grouped.setdefault(key, {"material": item_material, "color": color, "used_g": 0.0})
        req["used_g"] += float(item.get("used_g") or 0)
    return list(grouped.values())


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


def _coverage_label(coverage: dict) -> str:
    brands = sorted({
        str(s.get("brand") or "").strip()
        for s in coverage.get("spools") or []
        if str(s.get("brand") or "").strip()
    })
    brand_text = ", ".join(brands[:2])
    if len(brands) > 2:
        brand_text += f" +{len(brands) - 2}"
    if not brand_text:
        brand_text = "no loaded spool"
    return (
        f"{_colour_label(coverage['color'])} ({brand_text}) "
        f"{coverage['available_g']:.0f}g/{coverage['used_g']:.0f}g"
    )


def _spool_matches_color(spool: dict, color: Optional[str]) -> bool:
    if not color:
        return True
    return _hex_dist(spool.get("color_hex"), color) <= 95


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
        and _hex_dist(slot.get("color"), req["color"]) <= 95
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
    if _hex_dist(slot.get("color"), spool.get("color_hex")) > 95:
        return f"Colour mismatch: printer {_colour_label(slot.get('color'))}, Flightdeck {_colour_label(spool.get('color_hex'))}"

    reported_brand = _norm_material(slot.get("brand") or "")
    spool_brand = _norm_material(spool.get("brand") or "")
    if reported_brand and spool_brand and not _reported_brand_matches_spool(str(slot.get("brand") or ""), spool):
        return f"Brand mismatch: printer {slot.get('brand')}, Flightdeck {spool.get('brand')}"
    reported_profile = _norm_material(slot.get("profile_name") or "")
    spool_profile = _norm_material(" ".join([
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
        issues.append({"level": "block", "message": f"Printer is {state}"})
    elif state not in ("idle", "ready", "standby", "finished"):
        issues.append({"level": "wait", "message": f"Printer is {state}"})

    due_maintenance = [m for m in db.get_maintenance_items(job["printer_id"]) if m.get("is_due")]
    if due_maintenance:
        names = ", ".join(m["title"] for m in due_maintenance[:3])
        more = f" +{len(due_maintenance) - 3}" if len(due_maintenance) > 3 else ""
        issues.append({"level": "block", "message": f"Maintenance due: {names}{more}"})

    required_g = job.get("filament_weight_g")
    material = job.get("filament_type")
    color_reqs = _queue_colour_requirements(job)
    loaded = db.get_spools_by_printer(job["printer_id"])
    loaded_spools = list(loaded.values())
    material_matches = [s for s in loaded_spools if _spool_matches_material(s, material)]
    color_coverage = _queue_colour_coverage(color_reqs, loaded_spools) if color_reqs else []
    color_matches = [
        s for s in material_matches
        if any(_spool_matches_color(s, c["color"]) for c in color_reqs)
    ] if color_reqs else material_matches
    active_reported = _reported_active_slot(printer_status)
    ams_mismatches = _printer_ams_mismatches(printer_status, loaded_spools)
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
        elif len(color_reqs) == 1 and active_reported:
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
        if color_reqs:
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


async def _advance_queue(printer_id: str) -> None:
    job = db.queue_next_pending(printer_id)
    if not job:
        return
    job_id, filename, file_path = job["id"], job["filename"], job["file_path"]
    statuses = await _printer_status_map()
    preflight = _queue_preflight(job, statuses.get(printer_id))
    if not preflight["can_start"]:
        reason = "; ".join(i["message"] for i in preflight["issues"] if i["level"] in ("block", "wait"))
        log.info("queue: preflight blocked job %d on %s: %s", job_id, printer_id, reason)
        db.log_decision(printer_id, "queue_preflight_blocked", f"Job #{job_id} {filename}: {reason}")
        return
    db.queue_update_status(job_id, "uploading")
    try:
        for (pid, _, _, _, url) in _moonraker:
            if pid == printer_id:
                await moonraker.upload_and_start(url, file_path, filename)
                db.queue_set_started(job_id)
                log.info("queue: started job %d on %s (%s)", job_id, printer_id, filename)
                return
        for p in _bambu:
            if p.id == printer_id:
                await asyncio.to_thread(p.send_file, file_path, filename)
                db.queue_set_started(job_id)
                log.info("queue: started job %d on %s (%s)", job_id, printer_id, filename)
                return
        db.queue_update_status(job_id, "failed", "Printer not found")
    except Exception as exc:
        log.error("queue: failed to start job %d on %s: %s", job_id, printer_id, exc)
        db.queue_update_status(job_id, "failed", str(exc))


async def _on_print_finished_queue(printer_id: str) -> None:
    db.queue_finish_active(printer_id)
    await _advance_queue(printer_id)


@app.get("/api/queue/summary")
async def get_queue_summary():
    return db.queue_pending_counts()


@app.get("/api/queue")
async def get_queue(printer_id: Optional[str] = None):
    jobs = db.queue_list(printer_id)
    statuses = await _printer_status_map()
    return _apply_queue_preflight(jobs, statuses)


@app.post("/api/queue/upload", status_code=201)
async def queue_upload(printer_id: str = Form(...), file: UploadFile = File(...)):
    kind = _printer_kind(printer_id)
    if kind is None:
        raise HTTPException(status_code=404, detail="printer not found")
    if kind not in {"moonraker", "bambu"}:
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

    meta = _queue_file_metadata(raw_name, data)

    job_id = db.queue_add(
        printer_id, raw_name, file_path, len(data),
        preview_png=meta["preview_png"],
        estimated_seconds=meta["estimated_seconds"],
        filament_weight_g=meta["filament_weight_g"],
        filament_type=meta["filament_type"],
        filament_colors=meta["filament_colors"],
    )
    return {"id": job_id}


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


class QueueReorderRequest(BaseModel):
    direction: str  # "up" | "down"


@app.post("/api/queue/{job_id}/reorder")
async def reorder_queue_job(job_id: int, body: QueueReorderRequest):
    if body.direction not in ("up", "down"):
        raise HTTPException(status_code=422, detail="direction must be 'up' or 'down'")
    if not db.queue_reorder(job_id, body.direction):
        raise HTTPException(status_code=404, detail="Job not found or cannot reorder")
    return {"ok": True}


@app.post("/api/queue/{job_id}/retry")
async def retry_queue_job(job_id: int):
    if not db.queue_retry(job_id):
        raise HTTPException(status_code=404, detail="Job not found or not retryable")
    return {"ok": True}


@app.delete("/api/queue/completed")
async def clear_completed_jobs(printer_id: str):
    file_paths = db.queue_clear_completed(printer_id)
    for fp in file_paths:
        try:
            Path(fp).unlink(missing_ok=True)
        except Exception:
            pass
    return {"ok": True, "deleted": len(file_paths)}


@app.post("/api/queue/{job_id}/send")
async def send_queue_job(job_id: int):
    job = db.queue_get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if job["status"] != "pending":
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
    db.queue_update_status(job_id, "uploading")
    try:
        for (pid, _, _, _, url) in _moonraker:
            if pid == printer_id:
                await moonraker.upload_and_start(url, file_path, filename)
                db.queue_set_started(job_id)
                return
        for p in _bambu:
            if p.id == printer_id:
                await asyncio.to_thread(p.send_file, file_path, filename)
                db.queue_set_started(job_id)
                return
        db.queue_update_status(job_id, "failed", "Printer not found")
    except Exception as exc:
        log.error("queue send: job %d failed: %s", job_id, exc)
        db.queue_update_status(job_id, "failed", str(exc))


# ── OrcaSlicer relay ──────────────────────────────────────────────────────
# Configure OrcaSlicer Physical Printer host as:
#   http://<flightdeck-host>:8000/relay/<printer_id>
# OrcaSlicer appends /printer/info, /server/files/upload, /printer/print/start.

def _find_bambu(printer_id: str):
    return next((p for p in _bambu if p.id == printer_id), None)

def _find_moonraker_url(printer_id: str):
    return next((url for (id, _, _, _, url) in _moonraker if id == printer_id), None)

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
