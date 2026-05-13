from __future__ import annotations
import logging
from dataclasses import dataclass
from typing import Optional

import httpx

from ..models import PrinterStatus, JobStatus, TempReading
from datetime import datetime

log = logging.getLogger(__name__)

_preview_cache: dict[str, tuple[str, "MoonrakerPreview"]] = {}  # filename -> (url, preview)


@dataclass
class MoonrakerPreview:
    image_png: bytes
    estimated_total_seconds: Optional[int]
    filament_weight_g: Optional[float]
    filament_type: Optional[str]
    layer_height_mm: Optional[float]

_OBJECTS = "print_stats&heater_bed&extruder&display_status&fan"

_STATE_MAP = {
    "printing": "printing",
    "paused": "paused",
    "standby": "idle",
    "complete": "idle",
    "error": "error",
    "cancelled": "idle",
}


async def fetch(id: str, name: str, base_url: str) -> PrinterStatus:
    base_url = base_url.rstrip("/")
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(f"{base_url}/printer/objects/query?{_OBJECTS}")
            resp.raise_for_status()
            data = resp.json()["result"]["status"]
    except Exception as exc:
        return PrinterStatus(id=id, name=name, kind="moonraker", state="offline", error=str(exc))

    ps = data.get("print_stats", {})
    raw_state = ps.get("state", "standby")
    state = _STATE_MAP.get(raw_state, "idle")

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

    return PrinterStatus(
        id=id, name=name, kind="moonraker", state=state,
        temps=temps, job=job, updated_at=datetime.utcnow(),
    )


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


def _pick_thumbnail(thumbnails: list) -> Optional[dict]:
    """Return the largest thumbnail with both dimensions ≤ 200px."""
    candidates = [
        t for t in thumbnails
        if t.get("width", 0) <= 200 and t.get("height", 0) <= 200
    ]
    return max(candidates, key=lambda t: t["width"] * t["height"], default=None)
