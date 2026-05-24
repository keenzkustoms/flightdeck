from __future__ import annotations
import asyncio
import json
import logging
import re
import time
from typing import TYPE_CHECKING, Optional

import httpx

from . import db
from .printers.bambu_ftp import upload_bambu_file

if TYPE_CHECKING:
    from .printers.bambu import BambuPrinter

log = logging.getLogger(__name__)

# (printer_id, filename) → upload metadata + timestamp
# Bridges the two-step OrcaSlicer flow: upload arrives first, print/start follows.
_pending: dict[tuple[str, str], dict] = {}
_PENDING_TTL = 300  # seconds — stale entries from upload-without-start


def _evict_stale() -> None:
    cutoff = time.monotonic() - _PENDING_TTL
    stale = [k for k, v in _pending.items() if v["ts"] < cutoff]
    for k in stale:
        del _pending[k]


# ── Bambu relay ───────────────────────────────────────────────────────────

async def bambu_upload(
    printer_id: str,
    filename: str,
    data: bytes,
    source_ip: str,
    printer: "BambuPrinter",
) -> None:
    """Upload .gcode.3mf to Bambu via FTPS. Parses metadata, seeds preview cache.

    Retries once on FTPS failure. Raises on second failure.
    """
    preview = None
    for attempt in range(2):
        try:
            preview = await asyncio.to_thread(
                upload_bambu_file, printer._ip, printer._access_code, filename, data,
            )
            break
        except Exception as exc:
            if attempt == 0:
                db.log_decision(printer_id, "relay_upload_retry",
                                f"file={filename} source={source_ip} error={exc}")
                log.warning("relay: FTPS upload attempt 1 failed for %s: %s — retrying", filename, exc)
                await asyncio.sleep(2)
            else:
                db.log_decision(printer_id, "relay_upload_failed",
                                f"file={filename} source={source_ip} error={exc}")
                raise

    subtask_name = filename.removesuffix(".gcode.3mf")
    if preview and preview.image_png:
        printer.seed_preview(subtask_name, preview)

    _evict_stale()
    _pending[(printer_id, filename)] = {
        "estimated_seconds": preview.estimated_total_seconds if preview else None,
        "filament_g": preview.filament_weight_g if preview else None,
        "filament_type": preview.filament_type if preview else None,
        "ts": time.monotonic(),
    }

    db.log_decision(printer_id, "relay_upload", json.dumps({
        "file": filename,
        "source": source_ip,
        "eta_s": preview.estimated_total_seconds if preview else None,
        "filament_g": preview.filament_weight_g if preview else None,
        "filament_type": preview.filament_type if preview else None,
    }))
    log.info("relay: uploaded %s → %s from %s", filename, printer_id, source_ip)


async def bambu_print_start(
    printer_id: str,
    filename: str,
    source_ip: str,
    printer: "BambuPrinter",
) -> None:
    """Issue MQTT project_file command to Bambu printer.

    SCOPE NOTE: ams_mapping defaults to [0] (single tray / AMS tray 0).
    Multi-colour ams_mapping passthrough is a known gap — surface if needed.
    """
    try:
        await asyncio.to_thread(
            printer._printer.start_print,
            filename,
            1,      # plate_number — OrcaSlicer sends single-plate 3mf
            True,   # use_ams
            [0],    # ams_mapping — default; see scope note above
        )
    except Exception as exc:
        db.log_decision(printer_id, "relay_start_failed",
                        f"file={filename} source={source_ip} error={exc}")
        raise

    meta = _pending.get((printer_id, filename), {})
    db.log_decision(printer_id, "relay_print_start", json.dumps({
        "file": filename,
        "source": source_ip,
        "eta_s": meta.get("estimated_seconds"),
    }))
    log.info("relay: print started %s → %s from %s", filename, printer_id, source_ip)


# ── Moonraker relay ───────────────────────────────────────────────────────

async def moonraker_upload(
    printer_id: str,
    filename: str,
    data: bytes,
    source_ip: str,
    moonraker_url: str,
) -> None:
    """Forward upload to Moonraker and record pending state."""
    async with httpx.AsyncClient(timeout=60) as client:
        try:
            r = await client.post(
                f"{moonraker_url}/server/files/upload",
                files={"file": (filename, data, "application/octet-stream")},
                data={"root": "gcodes"},
            )
            r.raise_for_status()
        except Exception as exc:
            db.log_decision(printer_id, "relay_upload_failed",
                            f"file={filename} source={source_ip} error={exc}")
            raise

    eta = _parse_gcode_eta(data)
    _evict_stale()
    _pending[(printer_id, filename)] = {"estimated_seconds": eta, "ts": time.monotonic()}

    db.log_decision(printer_id, "relay_upload", json.dumps({
        "file": filename, "source": source_ip, "eta_s": eta,
    }))
    log.info("relay: forwarded %s → moonraker %s from %s", filename, printer_id, source_ip)


async def moonraker_print_start(
    printer_id: str,
    filename: str,
    source_ip: str,
    moonraker_url: str,
) -> None:
    """Forward print-start to Moonraker."""
    async with httpx.AsyncClient(timeout=15) as client:
        try:
            r = await client.post(
                f"{moonraker_url}/printer/print/start",
                json={"filename": filename},
            )
            r.raise_for_status()
        except Exception as exc:
            db.log_decision(printer_id, "relay_start_failed",
                            f"file={filename} source={source_ip} error={exc}")
            raise

    meta = _pending.get((printer_id, filename), {})
    db.log_decision(printer_id, "relay_print_start", json.dumps({
        "file": filename, "source": source_ip, "eta_s": meta.get("estimated_seconds"),
    }))
    log.info("relay: moonraker print started %s → %s from %s", filename, printer_id, source_ip)


# ── Helpers ───────────────────────────────────────────────────────────────

def _parse_gcode_eta(data: bytes) -> Optional[int]:
    """Extract slicer ETA from gcode header comments. Returns seconds or None.

    OrcaSlicer:   ; estimated_printing_time = 1h 23m 45s
    PrusaSlicer:  ; estimated printing time (normal mode) = 1h 23m 45s
    """
    try:
        header = data[:8192].decode("utf-8", errors="ignore")
        for line in header.splitlines():
            lower = line.lower()
            if "estimated_printing_time" in lower or "estimated printing time" in lower:
                part = line.split("=", 1)[-1].strip()
                m = re.search(r'(?:(\d+)h\s*)?(?:(\d+)m\s*)?(?:(\d+)s)?', part)
                if m and any(m.groups()):
                    h, mins, s = (int(x or 0) for x in m.groups())
                    total = h * 3600 + mins * 60 + s
                    if total > 0:
                        return total
    except Exception:
        pass
    return None
