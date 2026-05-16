from __future__ import annotations
import logging
from dataclasses import dataclass
from datetime import datetime, timezone, timedelta
from typing import Optional

import httpx

from .. import db
from ..models import PrinterStatus, JobStatus, TempReading

log = logging.getLogger(__name__)

_preview_cache: dict[str, tuple[str, "MoonrakerPreview"]] = {}
_prev_raw_state: dict[str, str] = {}   # printer_id → last raw Klipper state
_active_job_key: dict[str, str] = {}   # printer_id → job_key for the running print

FINISHED_TTL = timedelta(minutes=30)

_OBJECTS = "print_stats&heater_bed&extruder&display_status&fan&toolhead&mmu_machine&mmu"


@dataclass
class MoonrakerPreview:
    image_png: bytes
    estimated_total_seconds: Optional[int]
    filament_weight_g: Optional[float]
    filament_type: Optional[str]
    layer_height_mm: Optional[float]


async def fetch(id: str, model_name: str, custom_name: str, icon: str, base_url: str) -> PrinterStatus:
    base_url = base_url.rstrip("/")
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(f"{base_url}/printer/objects/query?{_OBJECTS}")
            resp.raise_for_status()
            data = resp.json()["result"]["status"]
    except Exception as exc:
        # Objects query failed — check if Moonraker is up but Klipper is in shutdown.
        try:
            async with httpx.AsyncClient(timeout=3.0) as client:
                info_resp = await client.get(f"{base_url}/printer/info")
                if info_resp.status_code == 200:
                    klippy_state = info_resp.json().get("result", {}).get("state", "")
                    if klippy_state == "shutdown":
                        now = datetime.utcnow()
                        return PrinterStatus(id=id, model_name=model_name, custom_name=custom_name,
                                             icon=icon, kind="moonraker", state="estop",
                                             last_seen=now, updated_at=now)
        except Exception:
            pass
        return PrinterStatus(id=id, model_name=model_name, custom_name=custom_name,
                             icon=icon, kind="moonraker", state="offline", error=str(exc))

    ps = data.get("print_stats", {})
    raw_state = ps.get("state", "standby")

    # Moonraker returns print_stats.state = "standby" even when Klipper is in shutdown.
    # Always check /printer/info to catch the estop/shutdown condition.
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            info_resp = await client.get(f"{base_url}/printer/info")
            if info_resp.status_code == 200:
                klippy_state = info_resp.json().get("result", {}).get("state", "")
                if klippy_state == "shutdown":
                    raw_state = "shutdown"
    except Exception:
        pass

    prev_raw = _prev_raw_state.get(id)
    _prev_raw_state[id] = raw_state

    temps: dict[str, TempReading] = {}
    if "extruder" in data:
        e = data["extruder"]
        temps["hotend"] = TempReading(actual=e.get("temperature", 0), target=e.get("target", 0))
    if "heater_bed" in data:
        b = data["heater_bed"]
        temps["bed"] = TempReading(actual=b.get("temperature", 0), target=b.get("target", 0))

    job = None
    if ps.get("filename"):
        progress = data.get("display_status", {}).get("progress", 0.0)
        duration = ps.get("print_duration", 0)
        eta = None
        if progress > 0.01:
            eta = int(duration / progress - duration)
        info = ps.get("info", {}) or {}
        job = JobStatus(
            filename=ps["filename"],
            progress=progress,
            eta_seconds=eta,
            layer_current=info.get("current_layer"),
            layer_total=info.get("total_layer"),
        )

    error_message = ps.get("message") or None
    state = _resolve_state(id, raw_state, prev_raw, job, error_message)

    idle_info: dict[str, str] = {}
    if state == "idle":
        last = db.get_last_print(id)
        if last:
            from .bambu import _fmt_last_print
            idle_info["Last print"] = _fmt_last_print(last)

        th = data.get("toolhead", {})
        if th:
            idle_info["Toolhead"] = _fmt_toolhead(th)

        mmu = data.get("mmu", {})
        if mmu:
            idle_info["MMU"] = _fmt_mmu(mmu)

    mmu_panel = _parse_mmu(
        data.get("mmu", {}),
        data.get("mmu_machine", {}),
        {},
    )

    now = datetime.utcnow()
    return PrinterStatus(
        id=id, model_name=model_name, custom_name=custom_name, icon=icon,
        kind="moonraker", state=state, temps=temps, job=job,
        idle_info=idle_info, mmu=mmu_panel, last_seen=now, updated_at=now,
    )


def _resolve_state(
    printer_id: str,
    raw: str,
    prev_raw: Optional[str],
    job: Optional[JobStatus],
    error_message: Optional[str] = None,
) -> str:
    now = datetime.now(timezone.utc)

    if raw == "printing":
        db.clear_finished_at(printer_id)
        if printer_id not in _active_job_key:
            filename = job.filename if job else ""
            # On backend restart mid-print: reuse existing open row rather than
            # creating a duplicate with a different timestamp key
            existing = db.get_open_print_key(printer_id, filename)
            if existing:
                job_key = existing
            else:
                job_key = f"{filename}@{int(now.timestamp())}"
                db.on_print_started(
                    printer_id, job_key, filename,
                    layers_total=job.layer_total if job else None,
                )
            _active_job_key[printer_id] = job_key
        return "printing"

    if raw == "complete":
        job_key = _active_job_key.pop(printer_id, None)
        finished_at = db.get_finished_at(printer_id)
        if finished_at is None:
            finished_at = now
            db.set_finished_at(printer_id, finished_at)
            if job_key:
                db.on_print_finished(
                    printer_id, job_key,
                    layers_completed=job.layer_current if job else None,
                )
        if (now - finished_at.replace(tzinfo=timezone.utc)) > FINISHED_TTL:
            db.clear_finished_at(printer_id)
            return "idle"
        return "finished"

    if raw == "cancelled":
        job_key = _active_job_key.pop(printer_id, None)
        if job_key:
            db.on_print_ended(
                printer_id, job_key,
                final_state="CANCELLED",
                layers_completed=job.layer_current if job else None,
            )
        db.clear_finished_at(printer_id)
        return "idle"

    if raw == "paused":
        return "paused"

    if raw == "shutdown":
        return "estop"

    if raw == "error":
        job_key = _active_job_key.pop(printer_id, None)
        if job_key:
            db.on_print_ended(
                printer_id, job_key,
                final_state="ERROR",
                layers_completed=job.layer_current if job else None,
                error_message=error_message or "Unknown error",
            )
        db.clear_finished_at(printer_id)
        return "error"

    # standby — check for recent finish (startup hydration)
    if printer_id in _active_job_key:
        # Printer went standby while we had an active key (restart → printer also reset)
        job_key = _active_job_key.pop(printer_id)
        db.on_print_ended(printer_id, job_key, final_state="ERROR",
                          error_message="Connection lost mid-print")

    finished_at = db.get_finished_at(printer_id)
    if finished_at is not None:
        if (now - finished_at.replace(tzinfo=timezone.utc)) <= FINISHED_TTL:
            return "finished"
        db.clear_finished_at(printer_id)
    return "idle"


_CONTROL_PATHS = {
    "pause":            "/printer/print/pause",
    "resume":           "/printer/print/resume",
    "cancel":           "/printer/print/cancel",
    "estop":            "/printer/emergency_stop",
    "firmware_restart": "/printer/firmware_restart",
}


_HEATER_NAMES = {"hotend": "extruder", "bed": "heater_bed"}


async def set_temp(base_url: str, heater: str, target: int) -> None:
    name = _HEATER_NAMES.get(heater)
    if not name:
        return
    gcode = f"SET_HEATER_TEMPERATURE HEATER={name} TARGET={target}"
    async with httpx.AsyncClient(timeout=5.0) as client:
        resp = await client.post(
            f"{base_url.rstrip('/')}/printer/gcode/script",
            json={"script": gcode},
        )
        resp.raise_for_status()


async def control(base_url: str, action: str) -> None:
    path = _CONTROL_PATHS.get(action)
    if not path:
        raise ValueError(f"unknown action: {action}")
    async with httpx.AsyncClient(timeout=5.0) as client:
        resp = await client.post(f"{base_url.rstrip('/')}{path}")
        resp.raise_for_status()


async def fetch_preview(base_url: str, filename: str) -> Optional[MoonrakerPreview]:
    """Fetch slicer thumbnail + metadata for the given gcode filename."""
    global _preview_cache
    if filename in _preview_cache:
        return _preview_cache[filename][1]

    base_url = base_url.rstrip("/")
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            meta_resp = await client.get(
                f"{base_url}/server/files/metadata", params={"filename": filename}
            )
            meta_resp.raise_for_status()
            meta = meta_resp.json()["result"]

            thumbnails = meta.get("thumbnails") or []
            best = _pick_thumbnail(thumbnails)
            image_png = b""
            if best:
                img_resp = await client.get(
                    f"{base_url}/server/files/gcodes/{best['relative_path']}"
                )
                img_resp.raise_for_status()
                image_png = img_resp.content

    except Exception as exc:
        log.warning("Moonraker preview fetch failed for %s: %s", filename, exc)
        return None

    preview = MoonrakerPreview(
        image_png=image_png,
        estimated_total_seconds=meta.get("estimated_time"),
        filament_weight_g=meta.get("filament_weight_total"),
        filament_type=None,
        layer_height_mm=meta.get("layer_height"),
    )
    _preview_cache[filename] = (filename, preview)
    return preview


def invalidate_preview_cache(filename: str) -> None:
    _preview_cache.pop(filename, None)


def _fmt_toolhead(th: dict) -> str:
    homed = th.get("homed_axes", "")
    pos = th.get("position", [0, 0, 0])
    if set("xyz") <= set(homed):
        x, y, z = pos[0], pos[1], pos[2]
        return f"homed · X{x:.0f} Y{y:.0f} Z{z:.1f}"
    if homed:
        return f"partially homed ({homed.upper()})"
    return "not homed"


def _fmt_mmu(mmu: dict) -> str:
    gate = mmu.get("gate", 0)
    gate_status = mmu.get("gate_status", [])
    num_gates = mmu.get("num_gates", len(gate_status))
    ready = sum(1 for s in gate_status if s == 1)
    filament = mmu.get("active_filament", {})
    parts = [f"Gate {gate}"]
    mat = filament.get("material")
    if mat:
        parts.append(mat)
    parts.append(f"{ready}/{num_gates} loaded")
    return " · ".join(parts)


def _parse_mmu(mmu: dict, mmu_machine: dict, _gate_map: dict) -> list:
    """Parse Happy Hare MMU state into a gate list for the UI panel.

    Gate arrays live directly on the mmu object (not mmu_gate_map).
    Colors are RRGGBBAA hex — only the first 6 chars are used.
    Vendor comes from mmu_machine["unit_0"]["name"].
    """
    if not mmu.get("enabled"):
        return []

    num_gates = int(mmu.get("num_gates", 0))
    if not num_gates:
        return []

    current_gate = int(mmu.get("gate", -1))

    statuses       = mmu.get("gate_status", [])
    materials      = mmu.get("gate_material", [])
    colors         = mmu.get("gate_color", [])
    filament_names = mmu.get("gate_filament_name", [])

    def _at(lst, i, default=""):
        try:
            return lst[i]
        except (IndexError, TypeError):
            return default

    def _norm_color(raw: str) -> str:
        # RRGGBBAA → take first 6 hex chars; skip black/transparent
        h = (raw or "").lstrip("#")[:6].upper()
        return f"#{h}" if h and h not in ("000000", "FFFFFF") else ""

    gates = []
    for i in range(num_gates):
        status = _at(statuses, i, 0)  # 0=empty, 1=available, 2=buffered
        empty = (status == 0)
        gates.append({
            "idx": i,
            "material": _at(materials, i, ""),
            "color": _norm_color(_at(colors, i, "")),
            "filament_name": _at(filament_names, i, ""),
            "status": status,
            "active": (i == current_gate) and not empty,
            "empty": empty,
        })

    if not any(not g["empty"] for g in gates):
        return []

    unit0 = mmu_machine.get("unit_0", {})
    vendor = unit0.get("name") or unit0.get("vendor") or "MMU"
    return [{"vendor": vendor, "num_gates": num_gates, "current_gate": current_gate, "gates": gates}]


def _pick_thumbnail(thumbnails: list) -> Optional[dict]:
    """Return the largest available thumbnail."""
    return max(thumbnails, key=lambda t: t.get("width", 0) * t.get("height", 0), default=None)


async def fetch_objects(base_url: str) -> dict:
    """Return exclude_object state: {supported, objects: [{name, state}]}."""
    base_url = base_url.rstrip("/")
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(f"{base_url}/printer/objects/query?exclude_object")
            resp.raise_for_status()
            data = resp.json()["result"]["status"].get("exclude_object")
    except Exception as exc:
        log.warning("fetch_objects failed: %s", exc)
        return {"supported": False, "objects": []}

    if not data:
        return {"supported": False, "objects": []}

    raw_objects = data.get("objects") or []
    current = data.get("current_object")
    excluded_set = set(data.get("excluded_objects") or [])

    result = []
    for obj in raw_objects:
        name = obj if isinstance(obj, str) else obj.get("name", "")
        if not name:
            continue
        if name in excluded_set:
            state = "excluded"
        elif name == current:
            state = "current"
        else:
            state = "printing"
        result.append({"name": name, "state": state})

    return {"supported": True, "objects": result}


async def exclude_object(base_url: str, name: str) -> None:
    """Send EXCLUDE_OBJECT NAME=<name> gcode to Moonraker."""
    gcode = f"EXCLUDE_OBJECT NAME={name}"
    async with httpx.AsyncClient(timeout=5.0) as client:
        resp = await client.post(
            f"{base_url.rstrip('/')}/printer/gcode/script",
            json={"script": gcode},
        )
        resp.raise_for_status()
