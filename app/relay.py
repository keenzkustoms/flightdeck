from __future__ import annotations
import asyncio
import io
import json
import logging
import re
import time
import zipfile
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


def _norm_hex(value: Optional[str]) -> str:
    h = str(value or "").strip().lstrip("#")[:6].upper()
    return f"#{h}" if re.fullmatch(r"[0-9A-F]{6}", h) else ""


def _hex_dist(a: Optional[str], b: Optional[str]) -> float:
    ha, hb = _norm_hex(a), _norm_hex(b)
    if not ha or not hb:
        return 999.0
    va = [int(ha[i:i + 2], 16) for i in (1, 3, 5)]
    vb = [int(hb[i:i + 2], 16) for i in (1, 3, 5)]
    return sum((x - y) ** 2 for x, y in zip(va, vb)) ** 0.5


def _norm_material(value: Optional[str]) -> str:
    return re.sub(r"[^a-z0-9]+", "", (value or "").lower())


def _bambu_preview_filaments(meta: dict) -> list[dict]:
    raw = meta.get("filament_colors")
    if not raw:
        return []
    if isinstance(raw, list):
        rows = raw
    else:
        try:
            rows = json.loads(raw)
        except Exception:
            return []
    out = []
    for row in rows if isinstance(rows, list) else []:
        if not isinstance(row, dict):
            continue
        color = _norm_hex(row.get("color"))
        material = _norm_material(row.get("type") or meta.get("filament_type"))
        if color or material:
            out.append({"color": color, "material": material, "used_g": row.get("used_g")})
    return out


def _bambu_ams_mapping(meta: dict, printer: "BambuPrinter") -> tuple[list[int], str]:
    requirements = _bambu_preview_filaments(meta)
    if not requirements:
        return [0], "no 3MF filament metadata; fallback to slot 0"

    try:
        slots = printer.ams_slots()
    except Exception as exc:
        return [0], f"AMS slot read failed ({exc}); fallback to slot 0"

    available = []
    for slot in slots:
        material = _norm_material(slot.get("type"))
        color = _norm_hex(slot.get("color"))
        if material:
            available.append({**slot, "material_norm": material, "color_norm": color})
    if not available:
        return [0], "no loaded AMS slots reported; fallback to slot 0"

    mapping: list[int] = []
    used: set[int] = set()
    notes: list[str] = []
    for req in requirements:
        material_matches = [
            slot for slot in available
            if req["material"] and (
                req["material"] == slot["material_norm"]
                or req["material"] in slot["material_norm"]
                or slot["material_norm"] in req["material"]
            )
        ] or available
        ranked = sorted(
            material_matches,
            key=lambda slot: (
                slot["bambu_tray_id"] in used,
                _hex_dist(req.get("color"), slot.get("color_norm")),
                slot["bambu_tray_id"],
            ),
        )
        best = ranked[0]
        mapping.append(int(best["bambu_tray_id"]))
        used.add(int(best["bambu_tray_id"]))
        notes.append(
            f"{req.get('material') or 'unknown'} {req.get('color') or ''}"
            f"→{best['bambu_tray_id']} {best.get('type') or ''} {best.get('color') or ''}"
        )

    return mapping or [0], "; ".join(notes)


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
        "filament_colors": preview.filament_colors if preview else None,
        "ts": time.monotonic(),
    }

    version = _parse_slicer_version(data, filename)
    if version:
        db.set_setting("slicer_detected_version", version)

    db.log_decision(printer_id, "relay_upload", json.dumps({
        "file": filename,
        "source": source_ip,
        "eta_s": preview.estimated_total_seconds if preview else None,
        "filament_g": preview.filament_weight_g if preview else None,
        "filament_type": preview.filament_type if preview else None,
        "slicer": version,
    }))
    log.info("relay: uploaded %s → %s from %s", filename, printer_id, source_ip)


async def bambu_print_start(
    printer_id: str,
    filename: str,
    source_ip: str,
    printer: "BambuPrinter",
) -> None:
    """Issue MQTT project_file command to Bambu printer."""
    meta = _pending.get((printer_id, filename), {})
    ams_mapping, mapping_note = _bambu_ams_mapping(meta, printer)
    try:
        await asyncio.to_thread(
            printer._printer.start_print,
            filename,
            1,      # plate_number — OrcaSlicer sends single-plate 3mf
            True,   # use_ams
            ams_mapping,
        )
    except Exception as exc:
        db.log_decision(printer_id, "relay_start_failed",
                        f"file={filename} source={source_ip} mapping={ams_mapping} error={exc}")
        raise

    db.log_decision(printer_id, "relay_print_start", json.dumps({
        "file": filename,
        "source": source_ip,
        "eta_s": meta.get("estimated_seconds"),
        "ams_mapping": ams_mapping,
        "mapping_note": mapping_note,
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

    version = _parse_slicer_version(data, filename)
    if version:
        db.set_setting("slicer_detected_version", version)

    db.log_decision(printer_id, "relay_upload", json.dumps({
        "file": filename, "source": source_ip, "eta_s": eta, "slicer": version,
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

def _parse_slicer_version(data: bytes, filename: str) -> Optional[str]:
    """Extract 'generated by <Name> <version>' from gcode comments.

    For .gcode.3mf, reads Metadata/plate_1.gcode inside the zip.
    Returns the full 'Name version' string, e.g. 'OrcaSlicer 2.3.0'.
    """
    header = ""
    try:
        if filename.endswith(".gcode.3mf"):
            with zipfile.ZipFile(io.BytesIO(data)) as z:
                for name in z.namelist():
                    if re.match(r"Metadata/plate_\d+\.gcode", name):
                        header = z.read(name)[:4096].decode("utf-8", errors="ignore")
                        break
        else:
            header = data[:4096].decode("utf-8", errors="ignore")

        m = re.search(r";\s*generated by\s+(.+)", header, re.IGNORECASE)
        if m:
            return m.group(1).strip()
    except Exception:
        pass
    return None


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
