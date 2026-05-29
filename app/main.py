from __future__ import annotations
import asyncio
import csv
import io
import json
import logging
import re
import urllib.request
from contextlib import asynccontextmanager
from dataclasses import asdict
from datetime import datetime
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
from .printer_config import BambuConnection, BambuRtspCamera, MjpegDirectCamera, MoonrakerConnection, NtfyConfig, PrinterEntry, load, save
from .printers import moonraker
from .printers.bambu import BambuPrinter
from .scale import Scale

_bambu: list[BambuPrinter] = []
_moonraker: list[tuple[str, str, str, str, str]] = []  # (id, model_name, custom_name, icon, url)
_cameras: dict = {}          # printer_id → Camera config
_presets: dict[str, dict] = {}  # printer_id → temperature_presets dict
_cam_proxies: dict[str, BambuCameraProxy] = {}  # printer_id → live RTSP proxy
_ws_clients: set[WebSocket] = set()
_broadcast_task: asyncio.Task | None = None
_ntfy: NtfyConfig | None = None
_prev_states: dict[str, str] = {}  # printer_id → last known state
_last_seen_cache: dict[str, datetime] = {}  # printer_id → last successful contact
_latest_printers: dict[str, dict] = {}  # printer_id → most recent gathered status
_scale = Scale()
_label_printer = LabelPrinter()


def _dt_default(obj):
    if isinstance(obj, datetime):
        return obj.isoformat()
    raise TypeError(f"{type(obj)} not serializable")


async def _gather_all() -> list[dict]:
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
        return d

    async def _fetch_bambu(p):
        status = await asyncio.to_thread(p.status)
        status.temperature_presets = _presets.get(p.id, {})
        _update_last_seen(status)
        d = asdict(status)
        cal = db.get_calibration(p.id)
        if cal:
            d["eta_calibration"] = cal
        d["health"] = db.get_printer_health(p.id)
        d["_error_print_id"] = p._error_print_id
        return d

    tasks = (
        [_fetch_moonraker(id, model_name, custom_name, icon, url)
         for (id, model_name, custom_name, icon, url) in _moonraker] +
        [_fetch_bambu(p) for p in _bambu]
    )
    results = await asyncio.gather(*tasks, return_exceptions=True)
    out = []
    for r in results:
        if isinstance(r, Exception):
            log.warning("printer fetch failed: %s", r)
        else:
            out.append(r)
    _latest_printers.clear()
    _latest_printers.update({p["id"]: p for p in out})
    return out


def _update_last_seen(status) -> None:
    if status.last_seen is not None:
        _last_seen_cache[status.id] = status.last_seen
        db.set_last_seen(status.id, status.last_seen)
    elif status.state == "offline" and status.id in _last_seen_cache:
        status.last_seen = _last_seen_cache[status.id]


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

        if prev == "printing" and curr == "finished":
            msg = f"{name}" + (f" · {label}" if label else "")
            asyncio.create_task(_send_ntfy("Print complete", msg, ["white_check_mark"]))
            asyncio.create_task(_on_print_finished_queue(pid))
        elif curr in ("error", "estop"):
            error_pid = p.get("_error_print_id")
            is_print_failure = prev == "printing" or has_error_print
            if is_print_failure:
                asyncio.create_task(_do_failure_snapshot(pid, error_pid))
            if curr == "error" and is_print_failure:
                msg = f"{name}" + (f" · {label}" if label else "")
                asyncio.create_task(_send_ntfy("Print error", msg, ["warning"], priority=4))
                db.queue_cancel_active(pid, "failed")
        elif prev == "printing" and curr == "paused":
            msg = f"{name}" + (f" · {label}" if label else "")
            asyncio.create_task(_send_ntfy("Print paused", msg, ["double_vertical_bar"]))
        elif prev == "printing" and curr == "idle":
            msg = f"{name}" + (f" · {label}" if label else "")
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


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _broadcast_task, _ntfy
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

    # Seed prev states so startup doesn't fire spurious notifications
    try:
        for p in await _gather_all():
            _prev_states[p["id"]] = p["state"]
    except Exception:
        pass

    _broadcast_task = asyncio.create_task(_broadcast_loop())

    yield

    if _broadcast_task:
        _broadcast_task.cancel()
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


_STATIC = Path(__file__).parent / "static"
_PRINT_LIBRARY = Path("/home/flightdeck/print_library")

app = FastAPI(title="Flightdeck", lifespan=lifespan)
app.mount("/static", StaticFiles(directory=_STATIC), name="static")


@app.get("/", include_in_schema=False)
def index():
    return FileResponse(_STATIC / "index.html")


@app.get("/healthz")
def healthz():
    return {
        "status": "ok",
        "ws_clients": len(_ws_clients),
        "broadcast_running": bool(_broadcast_task and not _broadcast_task.done()),
    }


def _file_kind(name: str) -> str:
    lower = name.lower()
    if lower.endswith(".gcode.3mf") or lower.endswith(".3mf"):
        return "3mf"
    if lower.endswith(".gcode.gz"):
        return "gcode.gz"
    if lower.endswith(".gcode"):
        return "gcode"
    if lower.endswith(".ufp"):
        return "ufp"
    return "file"


def _local_library_files() -> list[dict]:
    _PRINT_LIBRARY.mkdir(parents=True, exist_ok=True)
    rows = []
    for path in sorted(_PRINT_LIBRARY.rglob("*")):
        if path.is_dir():
            continue
        try:
            stat = path.stat()
        except OSError:
            continue
        rel = path.relative_to(_PRINT_LIBRARY).as_posix()
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


async def _moonraker_files(base_url: str) -> list[dict]:
    async with httpx.AsyncClient(timeout=8.0) as client:
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


@app.get("/api/files")
async def get_file_desk():
    targets = [{
        "id": "library",
        "label": "Pi Library",
        "kind": "library",
        "path": str(_PRINT_LIBRARY),
        "files": _local_library_files(),
        "actions": {"format_sd": False},
    }]

    for (pid, model_name, custom_name, _icon, url) in _moonraker:
        try:
            files = await _moonraker_files(url)
            error = None
        except Exception as exc:
            files = []
            error = str(exc)
        targets.append({
            "id": pid,
            "label": custom_name or model_name,
            "model": model_name,
            "kind": "moonraker",
            "files": files,
            "error": error,
            "actions": {"format_sd": False},
        })

    for p in _bambu:
        try:
            from .printers.bambu_ftp import list_bambu_files
            files = await asyncio.to_thread(list_bambu_files, p._ip, p._access_code)
            error = None
        except Exception as exc:
            files = []
            error = str(exc)
        targets.append({
            "id": p.id,
            "label": p.custom_name or p.model_name,
            "model": p.model_name,
            "kind": "bambu",
            "files": files,
            "error": error,
            "actions": {"format_sd": True, "format_sd_ready": False},
        })

    return {"library_path": str(_PRINT_LIBRARY), "targets": targets}



@app.get("/api/printers")
async def get_printers():
    return await _gather_all()


@app.get("/api/printers/{printer_id}")
async def get_printer(printer_id: str):
    for (id, model_name, custom_name, icon, url) in _moonraker:
        if id == printer_id:
            return asdict(await moonraker.fetch(id, model_name, custom_name, icon, url))

    for p in _bambu:
        if p.id == printer_id:
            return asdict(await asyncio.to_thread(p.status))

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


class AmsDryRequest(BaseModel):
    enabled: bool
    filament: str = "PLA"
    temp: int = 45
    duration: int = 12
    rotate_tray: bool = False


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

    raise HTTPException(status_code=404, detail="printer not found")


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
    camera = _cameras.get(printer_id)
    if camera is None:
        raise HTTPException(status_code=404, detail="no camera configured")
    if isinstance(camera, MjpegDirectCamera):
        return {"url": camera.stream_url, "type": "mjpeg"}
    if isinstance(camera, BambuRtspCamera):
        return {"url": f"/api/camera/{printer_id}/stream", "type": "mjpeg"}
    raise HTTPException(status_code=404, detail="unknown camera type")


@app.get("/api/camera/{printer_id}/stream")
async def camera_stream(printer_id: str):
    proxy = _cam_proxies.get(printer_id)
    if proxy is None:
        raise HTTPException(status_code=404, detail="no camera configured")
    return StreamingResponse(
        proxy.stream(),
        media_type="multipart/x-mixed-replace; boundary=frame",
        headers={"Cache-Control": "no-cache, no-store"},
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
    raise HTTPException(status_code=404, detail="printer not found")


class ExcludeObjectRequest(BaseModel):
    name: str


@app.get("/api/printers/{printer_id}/objects")
async def get_printer_objects(printer_id: str):
    for (id, model_name, custom_name, icon, url) in _moonraker:
        if id == printer_id:
            return await moonraker.fetch_objects(url)
    for p in _bambu:
        if p.id == printer_id:
            return {"supported": False, "objects": []}
    raise HTTPException(status_code=404, detail="printer not found")


@app.get("/api/config/printers")
async def get_config_printers():
    cfg = load()
    return [e.model_dump(mode="json", exclude_none=True) for e in cfg.printers]


@app.post("/api/config/printers", status_code=201)
async def add_printer(entry: PrinterEntry):
    if not re.match(r"^[a-z][a-z0-9_-]*$", entry.id):
        raise HTTPException(status_code=422, detail="id must be lowercase letters/digits/underscores/hyphens, starting with a letter")

    all_ids = [id for (id, *_) in _moonraker] + [p.id for p in _bambu]
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

    cfg = load()
    cfg.printers.append(entry)
    save(cfg)

    return {"ok": True}


@app.delete("/api/config/printers/{printer_id}")
async def remove_printer(printer_id: str):
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

    if not found:
        raise HTTPException(status_code=404, detail="printer not found")

    _cameras.pop(printer_id, None)
    _presets.pop(printer_id, None)
    _prev_states.pop(printer_id, None)

    cfg = load()
    cfg.printers = [e for e in cfg.printers if e.id != printer_id]
    save(cfg)

    return {"ok": True}


@app.post("/api/printers/{printer_id}/exclude-object")
async def post_exclude_object(printer_id: str, req: ExcludeObjectRequest):
    for (id, model_name, custom_name, icon, url) in _moonraker:
        if id == printer_id:
            try:
                await moonraker.exclude_object(url, req.name)
            except Exception as exc:
                raise HTTPException(status_code=502, detail=str(exc))
            return {"ok": True}
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

    raise HTTPException(status_code=404, detail="printer not found")


# ── User settings ─────────────────────────────────────────────────────────

class SettingUpdate(BaseModel):
    value: str


@app.get("/api/settings")
async def get_settings():
    return db.get_all_settings()


@app.put("/api/settings/{key}")
async def put_setting(key: str, body: SettingUpdate):
    db.set_setting(key, body.value)
    return {"ok": True}


# ── Scale and label hardware ──────────────────────────────────────────────

@app.get("/api/scale/status")
async def get_scale_status():
    available = _scale.is_available()
    return {"available": available, "model": "Dymo M10", "last_error": None if available else _scale.last_error}


@app.get("/api/scale/read")
async def read_scale():
    reading = _scale.read_stable()
    if not reading:
        db.log_decision("system", "scale_unavailable", _scale.last_error or "Scale read failed")
        raise HTTPException(status_code=503, detail=_scale.last_error or "Scale unavailable")
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
    ok = await asyncio.to_thread(_label_printer.print_spool_label, spool)
    if not ok:
        message = _label_printer.last_error or "Label printer unavailable"
        db.log_decision("system", "label_print_failed", f"Spool #{spool_id}: {message}")
        raise HTTPException(status_code=503, detail=message)
    db.log_decision("system", "label_printed", f"Spool #{spool_id}")
    return {"ok": True}


@app.post("/api/label_printer/test")
async def print_test_label():
    ok = await asyncio.to_thread(_label_printer.print_test_label)
    if not ok:
        message = _label_printer.last_error or "Label printer unavailable"
        db.log_decision("system", "label_printer_unavailable", message)
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
    label_weight_g: Optional[float] = None
    remaining_g: Optional[float] = None
    empty_spool_weight_g: Optional[float] = None
    notes: Optional[str] = None

class SpoolMove(BaseModel):
    printer_id: Optional[str] = None
    slot: Optional[int] = None
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

@app.get("/api/spools/summary")
async def get_spools_summary():
    return db.get_spools_summary()

@app.get("/api/spools/intelligence")
async def get_spool_intelligence(days: int = 30):
    return db.get_spool_intelligence(days)

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
        result = db.move_spool(-1, body.location_printer_id, body.location_slot)
        if not result["ok"]:
            raise HTTPException(status_code=409,
                detail=f"Slot occupied by spool #{result['conflict_spool_id']}")
    spool_id = db.create_spool(
        material=body.material, brand=body.brand, color_hex=body.color_hex,
        label_weight_g=body.label_weight_g, remaining_g=remaining,
        subtype=body.subtype, color_name=body.color_name,
        location_printer_id=body.location_printer_id,
        location_slot=body.location_slot,
        storage_location_id=None if body.location_printer_id else body.storage_location_id,
        notes=body.notes,
        empty_spool_weight_g=body.empty_spool_weight_g,
    )
    if db.get_all_settings().get("label_auto_print") == "true":
        spool = db.get_spool(spool_id)
        ok = await asyncio.to_thread(_label_printer.print_spool_label, spool)
        if ok:
            db.log_decision("system", "label_printed", f"Spool #{spool_id} auto-print")
        else:
            db.log_decision("system", "label_print_failed", f"Spool #{spool_id}: {_label_printer.last_error}")
    if body.location_printer_id and body.location_slot is not None:
        spool = db.get_spool(spool_id)
        await _sync_bambu_ams_slot(body.location_printer_id, body.location_slot, spool)
    return {"id": spool_id}

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
            db.log_decision("system", "scale_unavailable", _scale.last_error or "Scale read failed")
            raise HTTPException(status_code=503, detail=_scale.last_error or "Scale unavailable")
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
            db.log_decision("system", "scale_unavailable", _scale.last_error or "Scale read failed")
            raise HTTPException(status_code=503, detail=_scale.last_error or "Scale unavailable")
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


async def _sync_bambu_ams_slot(printer_id: str, slot: int, spool: Optional[dict]) -> Optional[bool]:
    for p in _bambu:
        if p.id != printer_id:
            continue
        try:
            ok = await asyncio.to_thread(p.set_ams_slot_filament, slot, spool)
            action = "ams_slot_synced" if spool else "ams_slot_cleared"
            target = f"{printer_id}:{slot}"
            detail = f"{target} {'spool #' + str(spool['id']) if spool else 'empty'}"
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


def _printer_kind(printer_id: str) -> Optional[str]:
    for (pid, *_) in _moonraker:
        if pid == printer_id:
            return "moonraker"
    for p in _bambu:
        if p.id == printer_id:
            return "bambu"
    return None


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


def _flatten_reported_ams_slots(printer_status: Optional[dict]) -> list[dict]:
    slots: list[dict] = []
    for unit in (printer_status or {}).get("ams") or []:
        unit_id = int(unit.get("unit") or 0)
        for slot in unit.get("slots") or []:
            if slot.get("empty"):
                continue
            idx = int(slot.get("idx") or 0)
            slots.append({
                **slot,
                "unit": unit_id,
                "flat_slot": unit_id * 4 + idx,
                "label": f"{unit.get('label') or 'AMS'} slot {idx + 1}",
            })
    return slots


def _reported_active_slot(printer_status: Optional[dict]) -> Optional[dict]:
    return next((s for s in _flatten_reported_ams_slots(printer_status) if s.get("active")), None)


def _reported_slot_matches_requirement(slot: dict, req: dict) -> bool:
    return (
        _spool_matches_material({"material": slot.get("type") or "", "subtype": "", "brand": ""}, req["material"])
        and _hex_dist(slot.get("color"), req["color"]) <= 95
    )


def _queue_preflight(job: dict, printer_status: Optional[dict]) -> dict:
    issues: list[dict] = []
    state = (printer_status or {}).get("state")

    if not printer_status:
        issues.append({"level": "wait", "message": "Waiting for printer telemetry"})
    elif state in ("offline", "error", "estop"):
        issues.append({"level": "block", "message": f"Printer is {state}"})
    elif state not in ("idle", "finished"):
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

    if material:
        if not loaded_spools:
            issues.append({"level": "block", "message": f"No loaded spool recorded for {material}"})
        elif not material_matches:
            issues.append({"level": "block", "message": f"No loaded spool matches {material}"})
        elif color_reqs and not color_matches:
            wanted = ", ".join(_colour_label(c["color"]) for c in color_reqs)
            issues.append({"level": "block", "message": f"No loaded spool matches required colour {wanted}"})
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
                    "level": "block",
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
                    "level": "block",
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

    raw_name = (file.filename or "upload").rsplit("/", 1)[-1].rsplit("\\", 1)[-1]
    # Resolve multi-part extensions in priority order
    if raw_name.endswith(".gcode.3mf"):
        ext = ".3mf"
    elif raw_name.endswith(".gcode.gz"):
        ext = ".gcode.gz"
    elif "." in raw_name:
        ext = "." + raw_name.rsplit(".", 1)[-1]
    else:
        ext = ""

    allowed = _ALLOWED_BAMBU_EXT if kind == "bambu" else _ALLOWED_MOONRAKER_EXT
    if ext not in allowed:
        raise HTTPException(
            status_code=422,
            detail=f"Unsupported file type '{ext}' for {kind} printer. Expected: {', '.join(sorted(allowed))}",
        )

    data = await file.read()
    if not data:
        raise HTTPException(status_code=422, detail="Empty file")

    import uuid as _uuid
    safe_name = f"{_uuid.uuid4().hex[:8]}_{raw_name}"
    file_path = str(db.UPLOADS_DIR / safe_name)
    with open(file_path, "wb") as f:
        f.write(data)

    preview_png = estimated_seconds = filament_weight_g = filament_type = filament_colors = None
    if ext == ".3mf":
        try:
            from .printers.bambu_ftp import _parse_3mf
            import io
            p = _parse_3mf(io.BytesIO(data))
            preview_png = p.image_png
            estimated_seconds = p.estimated_total_seconds
            filament_weight_g = p.filament_weight_g
            filament_type = p.filament_type
            filament_colors = p.filament_colors
        except Exception:
            pass

    job_id = db.queue_add(
        printer_id, raw_name, file_path, len(data),
        preview_png=preview_png,
        estimated_seconds=estimated_seconds,
        filament_weight_g=filament_weight_g,
        filament_type=filament_type,
        filament_colors=filament_colors,
    )
    return {"id": job_id}


@app.get("/api/queue/{job_id}/preview")
async def get_queue_preview(job_id: int):
    png = db.queue_get_preview(job_id)
    if not png:
        raise HTTPException(status_code=404, detail="no preview")
    return Response(content=png, media_type="image/png",
                    headers={"Cache-Control": "public, max-age=86400"})


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
    filename = file.filename or "upload.gcode.3mf"
    # Strip any path prefix OrcaSlicer may include (e.g. "gcodes/model.gcode.3mf")
    filename = filename.rsplit("/", 1)[-1].rsplit("\\", 1)[-1]
    data = await file.read()

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
    filename = (body.get("filename") or "").rsplit("/", 1)[-1].rsplit("\\", 1)[-1]
    if not filename:
        raise HTTPException(status_code=422, detail="filename required")

    # Belt-and-braces: refuse if printer is already busy
    current = next((p for p in _latestPrinters if p.get("id") == printer_id), None)
    if current and current.get("state") in _BUSY_STATES:
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
