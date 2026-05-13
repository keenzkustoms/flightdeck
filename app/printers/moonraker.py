from __future__ import annotations
import httpx
from ..models import PrinterStatus, JobStatus, TempReading
from datetime import datetime

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
        job = JobStatus(
            filename=ps["filename"],
            progress=progress,
            eta_seconds=eta,
        )

    return PrinterStatus(
        id=id, name=name, kind="moonraker", state=state,
        temps=temps, job=job, updated_at=datetime.utcnow(),
    )
