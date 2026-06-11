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
_prev_raw_state: dict[str, str] = {}           # printer_id → last raw Klipper state
_active_job_key: dict[str, str] = {}           # printer_id → job_key for the running print
_active_print_id: dict[str, Optional[int]] = {}  # printer_id → prints.id for the running print
_error_print_id: dict[str, Optional[int]] = {}   # printer_id → prints.id of the last error (for snapshot)
_estimated_stored: set[str] = set()            # printer_ids where slicer estimate is already stored
_filament_grams: dict[str, float] = {}         # printer_id → filament_weight_total from slicer metadata
_mmu_gate_snapshot: dict[str, dict[int, dict]] = {}       # printer_id → {gate_index: gate_info} at print start
_mmu_gate_snapshot_print_id: dict[str, Optional[int]] = {}  # printer_id → print_id the snapshot belongs to

FINISHED_TTL = timedelta(minutes=30)

_OBJECTS = "print_stats&heater_bed&extruder&display_status&fan&toolhead&mmu_machine&mmu"


@dataclass
class MoonrakerPreview:
    image_png: bytes
    estimated_total_seconds: Optional[int]
    filament_weight_g: Optional[float]
    filament_type: Optional[str]
    layer_height_mm: Optional[float]


async def fetch(
    id: str,
    model_name: str,
    custom_name: str,
    icon: str,
    base_url: str,
    *,
    kind: str = "moonraker",
    toolhead_count: int = 1,
) -> PrinterStatus:
    import asyncio as _asyncio
    base_url = base_url.rstrip("/")

    async def _objects() -> dict:
        async with httpx.AsyncClient(timeout=5.0, trust_env=False) as client:
            r = await client.get(f"{base_url}/printer/objects/query?{_OBJECTS}")
            r.raise_for_status()
            return r.json()["result"]["status"]

    async def _extra_tool_objects() -> dict:
        if toolhead_count <= 1:
            return {}
        try:
            extra_tools = "&".join(f"extruder{idx}" for idx in range(1, min(int(toolhead_count), 8)))
            async with httpx.AsyncClient(timeout=1.5, trust_env=False) as client:
                r = await client.get(f"{base_url}/printer/objects/query?{extra_tools}")
                if r.status_code == 200:
                    return r.json().get("result", {}).get("status", {})
        except Exception as exc:
            log.debug("optional multi-tool query failed for %s: %s", id, exc)
        return {}

    async def _info_state() -> tuple[str, str]:
        try:
            async with httpx.AsyncClient(timeout=3.0, trust_env=False) as client:
                r = await client.get(f"{base_url}/printer/info")
                if r.status_code == 200:
                    result = r.json().get("result", {})
                    return result.get("state", ""), result.get("state_message", "")
        except Exception:
            pass
        return "", ""

    # Fire both requests concurrently; _info_state never raises.
    results = await _asyncio.gather(_objects(), _info_state(), _extra_tool_objects(), return_exceptions=True)
    data_or_exc, klippy_info, extra_tools = results[0], results[1], results[2]
    klippy_state, klippy_message = klippy_info if isinstance(klippy_info, tuple) else (klippy_info, "")

    if isinstance(data_or_exc, Exception):
        exc = data_or_exc
        if klippy_state == "shutdown":
            now = datetime.utcnow()
            return PrinterStatus(id=id, model_name=model_name, custom_name=custom_name,
                                 icon=icon, kind=kind, state="estop",
                                 last_seen=now, updated_at=now)
        return PrinterStatus(id=id, model_name=model_name, custom_name=custom_name,
                             icon=icon, kind=kind, state="offline", error=str(exc))

    data = data_or_exc
    if isinstance(extra_tools, dict):
        data.update(extra_tools)
    ps = data.get("print_stats", {})
    if klippy_state == "shutdown":
        raw_state = "shutdown"
    elif klippy_state == "error":
        raw_state = "error"
    else:
        raw_state = ps.get("state", "standby")

    prev_raw = _prev_raw_state.get(id)
    _prev_raw_state[id] = raw_state

    temps: dict[str, TempReading] = {}
    if "extruder" in data:
        e = data["extruder"]
        temps["hotend"] = TempReading(actual=e.get("temperature", 0), target=e.get("target", 0))
    toolheads = _parse_toolheads(data, toolhead_count) if toolhead_count > 1 else []
    for tool in toolheads:
        temps[f"tool{tool['idx']}"] = TempReading(actual=tool.get("actual", 0), target=tool.get("target", 0))
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

    error_message = ps.get("message") or klippy_message or None
    state = _resolve_state(id, raw_state, prev_raw, job, error_message)

    new_print_id = _active_print_id.get(id)
    if (state == "printing" and new_print_id is not None
            and _mmu_gate_snapshot_print_id.get(id) != new_print_id):
        mmu_data = data.get("mmu", {})
        if mmu_data.get("enabled"):
            raw_gates = _snapshot_mmu_gates(mmu_data)
            _mmu_gate_snapshot[id] = raw_gates
            _mmu_gate_snapshot_print_id[id] = new_print_id
            # Enrich with spool assignments and persist to DB
            enriched: dict[str, dict] = {}
            for gate_idx, gate_data in raw_gates.items():
                spool = db.get_spool_at_slot(id, gate_idx)
                enriched[str(gate_idx)] = {**gate_data, "spool_id": spool["id"] if spool else None}
                if spool is None:
                    db.log_decision(id, "spool_missing",
                                   f"No spool assigned to MMU gate {gate_idx}",
                                   print_id=new_print_id)
            db.write_slot_snapshot(new_print_id, enriched)
            log.info("MMU gate snapshot for %s print_id=%d: gates=%s",
                     id, new_print_id, list(raw_gates.keys()))
        else:
            # Non-MMU Voron: single extruder at slot 0
            _mmu_gate_snapshot_print_id[id] = new_print_id
            spool = db.get_spool_at_slot(id, 0)
            enriched = {"0": {"material": "", "color": "", "filament_name": "", "status": 1,
                               "spool_id": spool["id"] if spool else None}}
            if spool is None:
                db.log_decision(id, "spool_missing",
                               "No spool assigned to single-extruder slot 0",
                               print_id=new_print_id)
            db.write_slot_snapshot(new_print_id, enriched)
            log.info("Single-extruder spool snapshot for %s print_id=%d: spool=%s",
                     id, new_print_id, spool["id"] if spool else None)

    # Capture slicer estimated duration once per job via metadata endpoint (primary path).
    # Documented fallback for Bambu (no metadata API): derived in bambu.py after 60s elapsed.
    if state == "printing" and id not in _estimated_stored and id in _active_job_key:
        filename = ps.get("filename", "")
        if filename:
            try:
                async with httpx.AsyncClient(timeout=3.0, trust_env=False) as client:
                    meta_resp = await client.get(
                        f"{base_url}/server/files/metadata", params={"filename": filename}
                    )
                    if meta_resp.status_code == 200:
                        result = meta_resp.json().get("result", {})
                        estimated = result.get("estimated_time")
                        if estimated:
                            db.update_estimated_duration(id, _active_job_key[id], int(estimated))
                            log.info("stored slicer estimate for %s: %ds", id, estimated)
                            pid = _active_print_id.get(id)
                            if pid:
                                secs = int(estimated)
                                db.log_decision(id, "calibration_captured",
                                               f"Slicer estimate from metadata: {secs}s "
                                               f"({secs // 3600}h {(secs % 3600) // 60}m)",
                                               print_id=pid)
                        fw = result.get("filament_weight_total")
                        if fw:
                            _filament_grams[id] = float(fw)
            except Exception as exc:
                log.debug("metadata fetch for duration failed %s: %s", id, exc)
        _estimated_stored.add(id)  # mark attempted regardless of success

    if state == "idle":
        job = None  # MQTT/Moonraker retains last-print data; don't surface it as active

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
    fan = data.get("fan", {}) or {}
    toolhead = data.get("toolhead", {}) or {}
    return PrinterStatus(
        id=id, model_name=model_name, custom_name=custom_name, icon=icon,
        kind=kind, state=state, temps=temps, job=job,
        idle_info=idle_info, mmu=mmu_panel, toolheads=toolheads, last_seen=now, updated_at=now,
        fan_speed=fan.get("speed"),
        fan_speeds={"part": fan.get("speed")} if fan.get("speed") is not None else {},
        toolhead_position=toolhead.get("position"),
        error=error_message if state == "error" else None,
    )


def _parse_toolheads(data: dict, count: int = 1) -> list[dict]:
    tools: list[dict] = []
    try:
        count = max(1, min(int(count or 1), 8))
    except (TypeError, ValueError):
        count = 1
    active_extruder = str((data.get("toolhead", {}) or {}).get("extruder") or "")
    for idx in range(count):
        key = "extruder" if idx == 0 else f"extruder{idx}"
        raw = data.get(key) if isinstance(data.get(key), dict) else {}
        tools.append({
            "idx": idx,
            "label": f"T{idx}",
            "object": key,
            "actual": raw.get("temperature", 0),
            "target": raw.get("target", 0),
            "power": raw.get("power"),
            "active": active_extruder == key or (idx == 0 and not active_extruder),
        })
    return tools


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
            job_key = existing if existing else f"{filename}@{int(now.timestamp())}"
            print_id, is_reattach = db.on_print_started(
                printer_id, job_key, filename,
                layers_total=job.layer_total if job else None,
            )
            _active_job_key[printer_id] = job_key
            _active_print_id[printer_id] = print_id
            _estimated_stored.discard(printer_id)  # new job — fetch estimate fresh
            _error_print_id.pop(printer_id, None)
            if is_reattach and print_id:
                db.log_decision(printer_id, "job_reattached",
                               f"Service restarted mid-print; reattached to existing row key={job_key}",
                               print_id=print_id)
            elif print_id:
                db.log_decision(printer_id, "job_started",
                               f"New print started key={job_key}",
                               print_id=print_id)
        return "printing"

    if raw == "complete":
        _estimated_stored.discard(printer_id)
        job_key = _active_job_key.pop(printer_id, None)
        completed_print_id = _active_print_id.pop(printer_id, None)
        _error_print_id.pop(printer_id, None)
        finished_at = db.get_finished_at(printer_id)
        if finished_at is None:
            finished_at = now
            db.set_finished_at(printer_id, finished_at)
            if job_key:
                fg = _filament_grams.pop(printer_id, None)
                closed_id = db.on_print_finished(
                    printer_id, job_key,
                    layers_completed=job.layer_current if job else None,
                    filament_grams=fg,
                )
                pid = closed_id or completed_print_id
                if pid and fg:
                    db.deduct_spool_usage(printer_id, pid, fg)
                elif pid and _mmu_gate_snapshot_print_id.get(printer_id) == pid:
                    db.log_decision(printer_id, "spool_no_deduction_cancelled",
                                   "Print finished but filament weight unknown; no spool deduction",
                                   print_id=pid)
        if (now - finished_at.replace(tzinfo=timezone.utc)) > FINISHED_TTL:
            db.clear_finished_at(printer_id)
            return "idle"
        return "finished"

    if raw == "cancelled":
        _estimated_stored.discard(printer_id)
        job_key = _active_job_key.pop(printer_id, None)
        _active_print_id.pop(printer_id, None)
        _error_print_id.pop(printer_id, None)
        if job_key:
            print_id = db.on_print_ended(
                printer_id, job_key,
                final_state="CANCELLED",
                layers_completed=job.layer_current if job else None,
            )
            if print_id:
                db.log_decision(printer_id, "cancel_resolved",
                               "Print cancelled by user",
                               print_id=print_id)
                if _mmu_gate_snapshot_print_id.get(printer_id) == print_id:
                    db.log_decision(printer_id, "spool_no_deduction_cancelled",
                                   "Print cancelled; no filament deducted from spools",
                                   print_id=print_id)
        db.clear_finished_at(printer_id)
        return "idle"

    if raw == "paused":
        return "paused"

    if raw == "shutdown":
        return "estop"

    if raw == "error":
        _estimated_stored.discard(printer_id)
        job_key = _active_job_key.pop(printer_id, None)
        _active_print_id.pop(printer_id, None)
        if job_key:
            msg = f"Klipper error: {error_message}" if error_message else "Klipper error"
            print_id = db.on_print_ended(
                printer_id, job_key,
                final_state="ERROR",
                layers_completed=job.layer_current if job else None,
                error_message=msg,
            )
            _error_print_id[printer_id] = print_id
            if print_id:
                db.log_decision(printer_id, "error_resolved", msg, print_id=print_id)
        db.clear_finished_at(printer_id)
        return "error"

    # standby/ready fallback:
    # some Klipper setups transition directly from printing to standby/ready
    # without exposing a "complete" state. If the active job came from printing,
    # treat that as a normal finish so spool deduction/queueing still advances.
    if printer_id in _active_job_key and prev_raw == "printing":
        _estimated_stored.discard(printer_id)
        job_key = _active_job_key.pop(printer_id)
        completed_print_id = _active_print_id.pop(printer_id, None)
        _error_print_id.pop(printer_id, None)
        filament_g = _filament_grams.pop(printer_id, None)
        finished_print_id = db.on_print_finished(
            printer_id,
            job_key,
            layers_completed=job.layer_current if job else None,
            filament_grams=filament_g,
        )
        pid = finished_print_id or completed_print_id
        if pid and filament_g:
            db.deduct_spool_usage(printer_id, pid)
        elif pid and _mmu_gate_snapshot_print_id.get(printer_id) == pid:
            db.log_decision(
                printer_id,
                "spool_no_deduction_cancelled",
                "Print finished without filament estimate (printing->standby)",
                print_id=pid,
            )
        finished_at = db.get_finished_at(printer_id)
        if finished_at is None:
            finished_at = now
            db.set_finished_at(printer_id, finished_at)
        if (now - finished_at.replace(tzinfo=timezone.utc)) > FINISHED_TTL:
            db.clear_finished_at(printer_id)
            return "idle"
        return "finished"

    # standby — check for recent finish (startup hydration)
    _estimated_stored.discard(printer_id)
    if printer_id in _active_job_key:
        # Printer went standby while we had an active key (restart → printer also reset)
        job_key = _active_job_key.pop(printer_id)
        _active_print_id.pop(printer_id, None)
        _error_print_id.pop(printer_id, None)
        print_id = db.on_print_ended(printer_id, job_key, final_state="ERROR",
                          error_message="Connection lost mid-print")
        if print_id:
            db.log_decision(printer_id, "connection_lost",
                           "Printer went standby while job was active; connection lost",
                           print_id=print_id)

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

_CONTROL_GCODE = {
    "light_on":  "STATUS_IDLE",
    "light_off": "STATUS_SLEEP",
}


_HEATER_NAMES = {"hotend": "extruder", "bed": "heater_bed"}


async def run_gcode(base_url: str, script: str) -> None:
    async with httpx.AsyncClient(timeout=5.0) as client:
        resp = await client.post(
            f"{base_url.rstrip('/')}/printer/gcode/script",
            json={"script": script},
        )
        resp.raise_for_status()


async def set_temp(base_url: str, heater: str, target: int) -> None:
    name = _HEATER_NAMES.get(heater)
    if not name:
        return
    gcode = f"SET_HEATER_TEMPERATURE HEATER={name} TARGET={target}"
    await run_gcode(base_url, gcode)


async def set_fan(base_url: str, speed_percent: int) -> None:
    pct = max(0, min(100, int(speed_percent)))
    if pct <= 0:
        await run_gcode(base_url, "M107")
        return
    pwm = round(pct * 255 / 100)
    await run_gcode(base_url, f"M106 S{pwm}")


async def jog_axis(base_url: str, axis: str, distance: float, speed: int | float | None = None) -> None:
    axis_key = str(axis or "").strip().lower()
    if axis_key not in {"x", "y", "z"}:
        raise ValueError("invalid jog axis")
    limit = 50.0 if axis_key in {"x", "y"} else 10.0
    delta = max(-limit, min(limit, float(distance)))
    if abs(delta) < 0.01:
        raise ValueError("distance must be non-zero")
    default_speed = 3000 if axis_key in {"x", "y"} else 600
    feed = int(speed or default_speed)
    feed = max(60, min(6000, feed))
    await run_gcode(base_url, f"G91\nG1 {axis_key.upper()}{delta:.2f} F{feed}\nG90")


async def jog_z(base_url: str, distance: float) -> None:
    await jog_axis(base_url, "z", distance, 600)


async def home_axes(base_url: str, axes: str) -> None:
    axes_key = axes.lower()
    axis_map = {
        "xy": "X Y",
        "z": "Z",
        "all": "",
    }
    if axes_key not in axis_map:
        raise ValueError("invalid axes")
    suffix = axis_map[axes_key]
    await run_gcode(base_url, f"G28 {suffix}".strip())


async def control(base_url: str, action: str) -> None:
    if action in _CONTROL_GCODE:
        await run_gcode(base_url, _CONTROL_GCODE[action])
        return

    path = _CONTROL_PATHS.get(action)
    if not path:
        raise ValueError(f"unknown action: {action}")
    async with httpx.AsyncClient(timeout=5.0, trust_env=False) as client:
        resp = await client.post(f"{base_url.rstrip('/')}{path}")
        resp.raise_for_status()


async def fetch_preview(base_url: str, filename: str) -> Optional[MoonrakerPreview]:
    """Fetch slicer thumbnail + metadata for the given gcode filename."""
    global _preview_cache
    if filename in _preview_cache:
        return _preview_cache[filename][1]

    base_url = base_url.rstrip("/")
    try:
        async with httpx.AsyncClient(timeout=5.0, trust_env=False) as client:
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


def _snapshot_mmu_gates(mmu: dict) -> dict[int, dict]:
    """Capture MMU gate state at print start. Returns {gate_index: gate_info} for loaded gates."""
    num_gates = int(mmu.get("num_gates", 0))
    statuses = mmu.get("gate_status", [])
    materials = mmu.get("gate_material", [])
    colors = mmu.get("gate_color", [])
    filament_names = mmu.get("gate_filament_name", [])
    result: dict[int, dict] = {}
    for i in range(num_gates):
        status = statuses[i] if i < len(statuses) else 0
        if status == 0:
            continue
        color = colors[i] if i < len(colors) else ""
        result[i] = {
            "material": materials[i] if i < len(materials) else "",
            "color": f"#{color}" if color and not color.startswith("#") else color,
            "filament_name": filament_names[i] if i < len(filament_names) else "",
            "status": status,
        }
    return result


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
        # RRGGBBAA → take first 6 hex chars; skip transparent/unset only
        h = (raw or "").lstrip("#")[:6].upper()
        return f"#{h}" if len(h) == 6 else ""

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
    return [{
        "vendor": vendor,
        "num_gates": num_gates,
        "current_gate": current_gate,
        "tool": mmu.get("tool"),
        "filament": mmu.get("filament"),
        "filament_position": mmu.get("filament_position"),
        "filament_pos": mmu.get("filament_pos"),
        "operation": mmu.get("operation"),
        "action": mmu.get("action"),
        "sensors": mmu.get("sensors") or {},
        "gates": gates,
    }]


def _pick_thumbnail(thumbnails: list) -> Optional[dict]:
    """Return the largest available thumbnail."""
    return max(thumbnails, key=lambda t: t.get("width", 0) * t.get("height", 0), default=None)


async def fetch_objects(base_url: str) -> dict:
    """Return exclude_object state with optional polygon geometry from Klipper."""
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
    xs: list[float] = []
    ys: list[float] = []
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
        item = {"name": name, "state": state}
        if isinstance(obj, dict):
            polygon = _normalise_object_polygon(obj.get("polygon"))
            if polygon:
                px = [point[0] for point in polygon]
                py = [point[1] for point in polygon]
                xs.extend(px)
                ys.extend(py)
                item["bbox"] = {
                    "x": min(px),
                    "y": min(py),
                    "w": max(px) - min(px),
                    "h": max(py) - min(py),
                }
                item["shape"] = {"polygon": polygon}
                center = obj.get("center")
                if isinstance(center, list) and len(center) >= 2:
                    try:
                        item["x"] = float(center[0])
                        item["y"] = float(center[1])
                    except (TypeError, ValueError):
                        pass
        result.append(item)

    response = {"supported": True, "objects": result}
    if xs and ys:
        pad = 8.0
        response.update({
            "plate_bounds": {
                "x": min(xs) - pad,
                "y": min(ys) - pad,
                "w": (max(xs) - min(xs)) + (pad * 2),
                "h": (max(ys) - min(ys)) + (pad * 2),
            },
            "map_view": "top_down",
            "map_image_mode": "top_down",
        })
    return response


def _normalise_object_polygon(value) -> list[list[float]]:
    if not isinstance(value, list):
        return []
    points: list[list[float]] = []
    for point in value:
        if not isinstance(point, list) or len(point) < 2:
            continue
        try:
            points.append([float(point[0]), float(point[1])])
        except (TypeError, ValueError):
            continue
    return points if len(points) >= 3 else []


async def exclude_object(base_url: str, name: str) -> None:
    """Send EXCLUDE_OBJECT NAME=<name> gcode to Moonraker."""
    gcode = f"EXCLUDE_OBJECT NAME={name}"
    async with httpx.AsyncClient(timeout=5.0) as client:
        resp = await client.post(
            f"{base_url.rstrip('/')}/printer/gcode/script",
            json={"script": gcode},
        )
        resp.raise_for_status()


async def upload_and_start(base_url: str, file_path: str, filename: str) -> None:
    """Upload a .gcode file to Moonraker and immediately start printing it."""
    base = base_url.rstrip("/")
    with open(file_path, "rb") as f:
        data = f.read()
    async with httpx.AsyncClient(timeout=120.0) as client:
        r = await client.post(
            f"{base}/server/files/upload",
            files={"file": (filename, data, "application/octet-stream")},
            data={"root": "gcodes"},
        )
        r.raise_for_status()
        r2 = await client.post(
            f"{base}/printer/print/start",
            json={"filename": filename},
        )
        r2.raise_for_status()
