from __future__ import annotations
import asyncio
import json
import logging
import re
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

from fastapi import FastAPI, File, HTTPException, Request, UploadFile, WebSocket
from fastapi.responses import FileResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

import httpx

from . import db, relay
from .camera import BambuCameraProxy
from .models import PrintPreview
from .printer_config import BambuConnection, BambuRtspCamera, MjpegDirectCamera, MoonrakerConnection, NtfyConfig, PrinterEntry, load, save
from .printers import moonraker
from .printers.bambu import BambuPrinter

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

        if prev == "printing" and curr == "finished":
            msg = f"{name}" + (f" · {label}" if label else "")
            asyncio.create_task(_send_ntfy("Print complete", msg, ["white_check_mark"]))
        elif curr in ("error", "estop"):
            error_pid = p.get("_error_print_id")
            asyncio.create_task(_do_failure_snapshot(pid, error_pid))
            if curr == "error":
                msg = f"{name}" + (f" · {label}" if label else "")
                asyncio.create_task(_send_ntfy("Print error", msg, ["warning"], priority=4))
        elif prev == "printing" and curr == "paused":
            msg = f"{name}" + (f" · {label}" if label else "")
            asyncio.create_task(_send_ntfy("Print paused", msg, ["double_vertical_bar"]))
        elif prev == "printing" and curr == "idle":
            msg = f"{name}" + (f" · {label}" if label else "")
            asyncio.create_task(_send_ntfy("Print cancelled", msg, ["x"]))


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


_VALID_ACTIONS = {"pause", "resume", "cancel", "estop", "firmware_restart"}


class ControlRequest(BaseModel):
    action: str


class SetTempRequest(BaseModel):
    heater: str
    target: int


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
        await relay.moonraker_print_start(printer_id, filename, source_ip, mr_url)
        return {"result": "ok"}

    raise HTTPException(status_code=404, detail="printer not found")
