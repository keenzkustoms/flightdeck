"""Queue a PrintShelf asset onto Flightdeck's print queue.

PrintShelf reads the file from the NAS/local mount and POSTs it to
Flightdeck ``/api/queue/upload`` on localhost (same trust model as slicer handoff).
"""
from __future__ import annotations

import json
import logging
import uuid
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from .config import load_config
from .preview import entry_kind, get_asset_row, path_is_allowed, read_zip_entry_bytes

log = logging.getLogger("printshelf.print")

_DEFAULT_FLIGHTDECK = "http://127.0.0.1:8000"
_DEFAULT_PUBLIC = "https://flightdeck.tail7de73e.ts.net"

# Flightdeck queue rules (mirrored from app/main.py).
_BAMBU_EXTS = {".3mf"}  # includes .gcode.3mf → .3mf
_MOONRAKER_EXTS = {".gcode", ".gcode.gz", ".ufp"}


def resolve_flightdeck_url(cfg: dict[str, Any] | None = None) -> str:
    cfg = cfg or load_config()
    return str(cfg.get("flightdeck_url") or _DEFAULT_FLIGHTDECK).strip().rstrip("/")


def resolve_flightdeck_public_url(cfg: dict[str, Any] | None = None) -> str:
    cfg = cfg or load_config()
    return str(cfg.get("flightdeck_public_url") or _DEFAULT_PUBLIC).strip().rstrip("/")


def _http_json(
    method: str,
    url: str,
    *,
    body: bytes | None = None,
    headers: dict[str, str] | None = None,
    timeout: float = 30.0,
) -> tuple[int, Any]:
    req = Request(url, data=body, method=method, headers=headers or {})
    try:
        with urlopen(req, timeout=timeout) as resp:
            raw = resp.read()
            ctype = resp.headers.get("Content-Type") or ""
            if "application/json" in ctype and raw:
                return resp.status, json.loads(raw.decode("utf-8"))
            return resp.status, raw.decode("utf-8", errors="replace") if raw else {}
    except HTTPError as exc:
        raw = exc.read() if exc.fp else b""
        try:
            payload = json.loads(raw.decode("utf-8")) if raw else {}
        except Exception:
            payload = raw.decode("utf-8", errors="replace") if raw else {}
        return exc.code, payload
    except URLError as exc:
        raise RuntimeError(f"Flightdeck unreachable: {exc.reason or exc}") from exc


def _queue_ext(filename: str) -> str:
    name = (filename or "").lower()
    if name.endswith(".gcode.3mf"):
        return ".3mf"
    if name.endswith(".gcode.gz"):
        return ".gcode.gz"
    if "." in name:
        return "." + name.rsplit(".", 1)[-1]
    return ""


def _safe_filename(name: str, fallback: str = "print.3mf") -> str:
    base = Path(name or "").name.strip() or fallback
    return base.replace("\\", "_").replace("/", "_") or fallback


def _normalize_queue_name(filename: str, printer_kind: str) -> str:
    """Map .gco → .gcode for Moonraker; keep .gcode.3mf as-is for Bambu."""
    name = _safe_filename(filename)
    lower = name.lower()
    if printer_kind != "bambu" and lower.endswith(".gco"):
        return name[:-4] + ".gcode"
    return name


def list_flightdeck_printers() -> list[dict[str, Any]]:
    """Return printable printers from Flightdeck (id, name, kind, state)."""
    base = resolve_flightdeck_url()
    status, payload = _http_json("GET", f"{base}/api/printers", timeout=8.0)
    if status >= 400:
        detail = payload.get("detail") if isinstance(payload, dict) else payload
        raise RuntimeError(f"Could not list printers ({status}): {detail}")
    rows = payload if isinstance(payload, list) else []
    out: list[dict[str, Any]] = []
    for p in rows:
        if not isinstance(p, dict):
            continue
        kind = str(p.get("kind") or "").lower()
        if kind == "bambu":
            norm_kind = "bambu"
        elif kind in ("moonraker", "voron", "klipper", "snapmaker_u1"):
            norm_kind = "moonraker"
        else:
            continue  # simulated / unknown
        pid = str(p.get("id") or "").strip()
        if not pid:
            continue
        name = (
            str(p.get("custom_name") or "").strip()
            or str(p.get("name") or "").strip()
            or str(p.get("model_name") or "").strip()
            or pid
        )
        state = str(p.get("state") or p.get("status") or "").strip() or "unknown"
        out.append({
            "id": pid,
            "name": name,
            "kind": norm_kind,
            "state": state,
            "model": str(p.get("model_name") or p.get("model") or ""),
        })
    return out


def _load_printable_bytes(
    asset: dict[str, Any],
    *,
    entry: str | None,
) -> tuple[bytes, str, str]:
    """Return (bytes, filename, logical_kind) for queue upload."""
    abs_path = str(asset.get("abs_path") or "")
    if not path_is_allowed(abs_path):
        raise PermissionError("File is outside watched folders")
    src = Path(abs_path)
    if not src.is_file():
        raise FileNotFoundError("Asset file missing on disk")

    kind = str(asset.get("kind") or "")
    if entry:
        if kind != "zip":
            raise ValueError("entry= only applies to ZIP assets")
        raw, inner_name = read_zip_entry_bytes(src, entry)
        filename = _safe_filename(inner_name)
        mesh_kind = entry_kind(inner_name) or ""
        if mesh_kind not in ("3mf", "gcode.3mf", "gcode"):
            # Also allow raw .gcode / .gco / .ufp by extension
            ext = _queue_ext(filename)
            if ext not in (".3mf", ".gcode", ".gcode.gz", ".ufp", ".gco"):
                raise ValueError(
                    "Zip entry is not a ready-to-print file (.3mf / .gcode.3mf / .gcode). "
                    "Open in slicer first."
                )
            mesh_kind = "gcode.3mf" if ext == ".3mf" and filename.lower().endswith(".gcode.3mf") else (
                "3mf" if ext == ".3mf" else "gcode"
            )
        return raw, filename, mesh_kind

    if kind == "zip":
        raise ValueError("Pick a printable inside the ZIP first")
    if kind in ("stl", "obj"):
        raise ValueError("STL/OBJ need slicing first — use Open in slicer")
    if kind not in ("3mf", "gcode.3mf", "gcode"):
        raise ValueError(f"Cannot queue kind={kind} — use Open in slicer for models")

    # Plain project .3mf (not sliced) — still allowed for Bambu (studio project),
    # but warn via is_sliced=false in response. Reject for Moonraker.
    raw = src.read_bytes()
    filename = _safe_filename(str(asset.get("file_name") or src.name))
    return raw, filename, kind


def _multipart_queue_upload(
    url: str,
    *,
    printer_id: str,
    filename: str,
    data: bytes,
    calibrate_before_start: bool = False,
    timeout: float = 120.0,
) -> tuple[int, Any]:
    boundary = f"----PrintShelfPrint{uuid.uuid4().hex}"
    parts: list[bytes] = []
    parts.append(
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="printer_id"\r\n\r\n'
        f"{printer_id}\r\n".encode("utf-8")
    )
    parts.append(
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="calibrate_before_start"\r\n\r\n'
        f"{'true' if calibrate_before_start else 'false'}\r\n".encode("utf-8")
    )
    parts.append(
        (
            f"--{boundary}\r\n"
            f'Content-Disposition: form-data; name="file"; filename="{filename}"\r\n'
            f"Content-Type: application/octet-stream\r\n\r\n"
        ).encode("utf-8")
        + data
        + b"\r\n"
    )
    parts.append(f"--{boundary}--\r\n".encode("ascii"))
    body = b"".join(parts)
    return _http_json(
        "POST",
        url,
        body=body,
        headers={
            "Content-Type": f"multipart/form-data; boundary={boundary}",
            "Content-Length": str(len(body)),
        },
        timeout=timeout,
    )


def queue_asset_to_flightdeck(
    asset_id: int,
    *,
    printer_id: str,
    entry: str | None = None,
    calibrate_before_start: bool = False,
) -> dict[str, Any]:
    cfg = load_config()
    asset = get_asset_row(asset_id)
    if not asset:
        raise ValueError("Asset not found")

    printer_id = (printer_id or "").strip()
    if not printer_id:
        raise ValueError("printer_id is required")

    printers = list_flightdeck_printers()
    match = next((p for p in printers if p["id"] == printer_id), None)
    if not match:
        raise ValueError(f"Printer '{printer_id}' not found (or not queueable)")

    printer_kind = match["kind"]  # bambu | moonraker
    raw, filename, logical_kind = _load_printable_bytes(asset, entry=entry)
    queue_name = _normalize_queue_name(filename, printer_kind)
    ext = _queue_ext(queue_name)

    allowed = _BAMBU_EXTS if printer_kind == "bambu" else _MOONRAKER_EXTS
    if ext not in allowed:
        if printer_kind == "bambu":
            raise ValueError(
                f"Bambu queue needs a .3mf / .gcode.3mf (got {ext or 'unknown'}). "
                "Slice first with Open in slicer."
            )
        raise ValueError(
            f"Voron/Moonraker queue needs .gcode (got {ext or 'unknown'}). "
            "Slice first with Open in slicer."
        )

    # Soft guard: unsliced project 3MF on Bambu still queues (Studio project),
    # but flag it so the UI can warn.
    is_sliced = bool(asset.get("is_sliced")) or logical_kind == "gcode.3mf" or logical_kind == "gcode"
    if printer_kind == "bambu" and logical_kind == "3mf" and not is_sliced and not entry:
        # Still allow — Flightdeck accepts project 3MF for Bambu.
        pass

    base = resolve_flightdeck_url(cfg)
    public = resolve_flightdeck_public_url(cfg)
    status, payload = _multipart_queue_upload(
        f"{base}/api/queue/upload",
        printer_id=printer_id,
        filename=queue_name,
        data=raw,
        calibrate_before_start=calibrate_before_start and printer_kind == "bambu",
        timeout=180.0,
    )
    if status >= 400:
        detail = payload.get("detail") if isinstance(payload, dict) else payload
        if isinstance(detail, dict):
            detail = detail.get("message") or json.dumps(detail)
        raise RuntimeError(f"Flightdeck queue rejected upload ({status}): {detail}")

    job_id = payload.get("id") if isinstance(payload, dict) else None
    return {
        "ok": True,
        "job_id": job_id,
        "printer_id": printer_id,
        "printer_name": match["name"],
        "printer_kind": printer_kind,
        "printer_state": match["state"],
        "filename": queue_name,
        "size_bytes": len(raw),
        "is_sliced": is_sliced,
        "queue_url": f"{public}/#/queue",
        "flightdeck_url": public,
    }
