from __future__ import annotations
import asyncio
import json
import logging
from contextlib import asynccontextmanager
from dataclasses import asdict
from datetime import datetime
from pathlib import Path

log = logging.getLogger(__name__)

from fastapi import FastAPI, HTTPException, WebSocket
from fastapi.responses import FileResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles

from . import db
from .camera import BambuCameraProxy
from .models import PrintPreview
from .printer_config import BambuConnection, BambuRtspCamera, MjpegDirectCamera, MoonrakerConnection, load
from .printers import moonraker
from .printers.bambu import BambuPrinter

_bambu: list[BambuPrinter] = []
_moonraker: list[tuple[str, str, str, str, str]] = []  # (id, model_name, custom_name, icon, url)
_cameras: dict = {}          # printer_id → Camera config
_cam_proxies: dict[str, BambuCameraProxy] = {}  # printer_id → live RTSP proxy
_ws_clients: set[WebSocket] = set()
_broadcast_task: asyncio.Task | None = None


def _dt_default(obj):
    if isinstance(obj, datetime):
        return obj.isoformat()
    raise TypeError(f"{type(obj)} not serializable")


async def _gather_all() -> list[dict]:
    results = []
    for (id, model_name, custom_name, icon, url) in _moonraker:
        status = await moonraker.fetch(id, model_name, custom_name, icon, url)
        results.append(asdict(status))
    for p in _bambu:
        status = await asyncio.to_thread(p.status)
        results.append(asdict(status))
    return results


async def _broadcast_loop():
    while True:
        await asyncio.sleep(5)
        if not _ws_clients:
            continue
        try:
            data = await _gather_all()
            msg = json.dumps(data, default=_dt_default)
            dead: set[WebSocket] = set()
            for ws in list(_ws_clients):
                try:
                    await ws.send_text(msg)
                except Exception:
                    dead.add(ws)
            _ws_clients.difference_update(dead)
        except Exception:
            pass


@asynccontextmanager
async def lifespan(app: FastAPI):
    global _broadcast_task
    db.init()
    cfg = load()

    for entry in cfg.printers:
        conn = entry.connection
        _cameras[entry.id] = entry.camera
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

    _broadcast_task = asyncio.create_task(_broadcast_loop())

    yield

    if _broadcast_task:
        _broadcast_task.cancel()
    for proxy in _cam_proxies.values():
        await proxy.stop()
    _cam_proxies.clear()
    for p in _bambu:
        await asyncio.to_thread(p.stop)
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
