"""Open PrintShelf assets in desktop Bambu/Orca the same way Flightdeck does.

Flightdeck never uses bambustudio://open?file=https://… for local models.
It launches bambu-studio.exe with a real path via the Windows slicer worker.

STL/OBJ (and zip printables) get a MakerDeck-style manifold check + sanitize
before handoff. Repaired meshes are uploaded as temp STLs — NAS originals stay untouched.
"""
from __future__ import annotations

import hashlib
import json
import logging
import tempfile
import uuid
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from .config import data_dir, load_config
from .manifold import prepare_mesh_for_slicer
from .paths import to_windows_path
from .preview import (
    _parse_binary_stl_tris,
    _write_binary_stl,
    decimate_obj_to_stl,
    entry_kind,
    get_asset_row,
    path_is_allowed,
    read_zip_entry_bytes,
)

log = logging.getLogger("printshelf.slicer")

_FLIGHTDECK_SETTINGS_URL = "http://127.0.0.1:8000/api/settings"
_DEFAULT_TARGET = "bambu_studio"


def resolve_worker_url(cfg: dict[str, Any] | None = None) -> str:
    cfg = cfg or load_config()
    explicit = str(cfg.get("slicer_worker_url") or "").strip().rstrip("/")
    if explicit:
        return explicit
    try:
        with urlopen(_FLIGHTDECK_SETTINGS_URL, timeout=3) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        if isinstance(data, dict):
            return str(data.get("orcaslicer_worker_url") or "").strip().rstrip("/")
    except Exception as exc:
        log.info("Could not read Flightdeck slicer worker URL: %s", exc)
    return ""


def _safe_name(name: str, fallback: str = "model.stl") -> str:
    base = Path(name or "").name.strip() or fallback
    return base.replace("\\", "_").replace("/", "_") or fallback


def _http_json(
    method: str,
    url: str,
    *,
    body: bytes | None = None,
    headers: dict[str, str] | None = None,
    timeout: float = 12.0,
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
        raise RuntimeError(str(exc.reason or exc)) from exc


def _multipart_upload(
    url: str,
    filename: str,
    data: bytes,
    target: str,
    timeout: float = 45.0,
) -> tuple[int, Any]:
    boundary = f"----PrintShelfBoundary{uuid.uuid4().hex}"
    disposition = (
        f'Content-Disposition: form-data; name="file"; filename="{filename}"\r\n'
        f"Content-Type: application/octet-stream\r\n\r\n"
    ).encode("utf-8")
    target_part = (
        f'Content-Disposition: form-data; name="target"\r\n\r\n{target}\r\n'
    ).encode("utf-8")
    body = (
        f"--{boundary}\r\n".encode("ascii")
        + disposition
        + data
        + b"\r\n"
        + f"--{boundary}\r\n".encode("ascii")
        + target_part
        + f"--{boundary}--\r\n".encode("ascii")
    )
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


def _cached_manifold_stl_path(content_hash: str, kind: str, entry_key: str = "") -> Path:
    prev = data_dir() / "previews"
    prev.mkdir(parents=True, exist_ok=True)
    key = hashlib.md5(f"{content_hash}|{kind}|{entry_key}|manifold2".encode("utf-8")).hexdigest()[:20]
    return prev / f"{key}_manifold.stl"


def _tris_from_mesh_bytes(raw: bytes, kind: str) -> list:
    if kind == "stl":
        return _parse_binary_stl_tris(raw)
    if kind == "obj":
        with tempfile.NamedTemporaryFile(suffix=".obj", delete=False) as tmp:
            tmp.write(raw)
            tmp_path = Path(tmp.name)
        try:
            stl_blob = decimate_obj_to_stl(tmp_path, max_tris=5_000_000)
        finally:
            try:
                tmp_path.unlink()
            except Exception:
                pass
        if not stl_blob:
            raise ValueError("Could not read OBJ mesh")
        return _parse_binary_stl_tris(stl_blob)
    raise ValueError(f"Cannot manifold-check kind={kind}")


def _prepare_slicer_payload(
    *,
    raw: bytes,
    kind: str,
    filename: str,
    content_hash: str,
    entry_key: str = "",
) -> tuple[bytes, str, dict[str, Any]]:
    """
    For STL/OBJ: manifold check + sanitize when needed.
    Returns (bytes_to_send, filename_to_send, manifold_meta).
    """
    if kind not in ("stl", "obj"):
        return raw, filename, {"before": 0, "after": 0, "repaired": False, "skipped": True}

    tris = _tris_from_mesh_bytes(raw, kind)
    result = prepare_mesh_for_slicer(tris)
    meta = {
        "before": int(result["before"]),
        "after": int(result["after"]),
        "repaired": bool(result["repaired"]),
        "skipped": False,
    }
    if not result["repaired"]:
        # Already OK (or sanitize failed) — send original bytes with original name.
        return raw, filename, meta

    cache = _cached_manifold_stl_path(content_hash, kind, entry_key)
    blob = _write_binary_stl(result["tris"])
    try:
        cache.write_bytes(blob)
    except Exception as exc:
        log.warning("Could not cache manifold STL: %s", exc)
    stem = Path(filename).stem or "model"
    out_name = f"{stem}_manifold.stl"
    return blob, out_name, meta


def open_asset_in_desktop_slicer(
    asset_id: int,
    *,
    entry: str | None = None,
    target: str = _DEFAULT_TARGET,
) -> dict[str, Any]:
    cfg = load_config()
    asset = get_asset_row(asset_id)
    if not asset:
        raise ValueError("Asset not found")
    abs_path = str(asset.get("abs_path") or "")
    if not path_is_allowed(abs_path):
        raise PermissionError("File is outside watched folders")
    src = Path(abs_path)
    if not src.is_file():
        raise FileNotFoundError("Asset file missing on disk")

    kind = str(asset.get("kind") or "")
    worker = resolve_worker_url(cfg)
    if not worker:
        raise RuntimeError(
            "Windows slicer worker is not configured. "
            "Set slicer_worker_url in PrintShelf config, or configure "
            "orcaslicer_worker_url in Flightdeck Settings → Slicer."
        )

    target = (target or _DEFAULT_TARGET).strip().lower() or _DEFAULT_TARGET
    folders = list(cfg.get("watched_folders") or [])
    win_path = to_windows_path(abs_path, folders) if not entry else None
    content_hash = str(asset.get("content_hash") or src.name)

    # Load source bytes + kind for manifold prep.
    if entry:
        raw, inner_name = read_zip_entry_bytes(src, entry)
        filename = _safe_name(inner_name)
        mesh_kind = entry_kind(inner_name) or ""
        if mesh_kind not in ("stl", "obj", "3mf", "gcode.3mf"):
            raise ValueError("Zip entry is not a printable mesh")
        entry_key = entry
    else:
        if kind not in ("stl", "obj", "3mf", "gcode.3mf"):
            raise ValueError(f"Cannot open kind={kind} in slicer")
        raw = src.read_bytes()
        filename = _safe_name(str(asset.get("file_name") or src.name))
        mesh_kind = kind
        entry_key = ""

    send_bytes, send_name, manifold = _prepare_slicer_payload(
        raw=raw,
        kind=mesh_kind,
        filename=filename,
        content_hash=content_hash,
        entry_key=entry_key,
    )

    # Prefer NAS UNC path only when we did NOT repair (original == what Studio should open).
    if win_path and not entry and not manifold.get("repaired"):
        try:
            status, payload = _http_json(
                "POST",
                f"{worker}/api/slicer/worker/open-path",
                body=json.dumps({"path": win_path, "target": target}).encode("utf-8"),
                headers={"Content-Type": "application/json"},
                timeout=8.0,
            )
            if status < 400:
                if isinstance(payload, dict):
                    payload["via"] = "open-path"
                    payload["windows_path"] = win_path
                    payload["worker_url"] = worker
                    payload["manifold"] = manifold
                    return payload
                return {
                    "ok": True,
                    "via": "open-path",
                    "windows_path": win_path,
                    "worker_url": worker,
                    "manifold": manifold,
                }
            detail = payload.get("detail") if isinstance(payload, dict) else payload
            log.warning("open-path failed (%s): %s — falling back to upload", status, detail)
        except Exception as exc:
            log.warning("open-path unreachable (%s) — falling back to upload", exc)

    try:
        status, payload = _multipart_upload(
            f"{worker}/api/slicer/worker/open",
            send_name,
            send_bytes,
            target,
            timeout=45.0,
        )
    except RuntimeError as exc:
        raise RuntimeError(
            f"Windows slicer worker unreachable at {worker}. "
            "On your PC start Flightdeck (worker) or run Start-Flightdeck-Slicers-Windows.cmd, then try again."
        ) from exc

    if status >= 400:
        detail = payload.get("detail") if isinstance(payload, dict) else payload
        raise RuntimeError(detail or f"Worker open failed ({status})")
    if isinstance(payload, dict):
        payload["via"] = "upload"
        payload["worker_url"] = worker
        payload["filename"] = send_name
        payload["manifold"] = manifold
        return payload
    return {
        "ok": True,
        "via": "upload",
        "worker_url": worker,
        "filename": send_name,
        "manifold": manifold,
    }


def inspect_asset_manifold(
    asset_id: int,
    *,
    entry: str | None = None,
    repair: bool = True,
) -> dict[str, Any]:
    """Dry-run manifold check/repair for an asset (does not call the worker)."""
    from .manifold import count_open_edges

    asset = get_asset_row(asset_id)
    if not asset:
        raise ValueError("Asset not found")
    abs_path = str(asset.get("abs_path") or "")
    if not path_is_allowed(abs_path):
        raise PermissionError("File is outside watched folders")
    src = Path(abs_path)
    if not src.is_file():
        raise FileNotFoundError("Asset file missing on disk")

    kind = str(asset.get("kind") or "")
    if entry:
        raw, inner_name = read_zip_entry_bytes(src, entry)
        mesh_kind = entry_kind(inner_name) or ""
        name = Path(inner_name).name
    else:
        raw = src.read_bytes()
        mesh_kind = kind
        name = str(asset.get("file_name") or src.name)

    if mesh_kind not in ("stl", "obj"):
        return {
            "ok": True,
            "file_name": name,
            "kind": mesh_kind,
            "before": 0,
            "after": 0,
            "repaired": False,
            "skipped": True,
            "reason": "Manifold check applies to STL/OBJ only",
        }

    tris = _tris_from_mesh_bytes(raw, mesh_kind)
    before = count_open_edges(tris)
    if not repair:
        return {
            "ok": True,
            "file_name": name,
            "kind": mesh_kind,
            "triangle_count": len(tris),
            "before": before,
            "after": before,
            "repaired": False,
            "skipped": False,
        }

    result = prepare_mesh_for_slicer(tris)
    return {
        "ok": True,
        "file_name": name,
        "kind": mesh_kind,
        "triangle_count": len(tris),
        "before": int(result["before"]),
        "after": int(result["after"]),
        "repaired": bool(result["repaired"]),
        "skipped": False,
        "triangle_count_after": len(result["tris"]),
    }
