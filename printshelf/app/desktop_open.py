"""Open PrintShelf files on the Windows PC (Explorer / default zip app)."""
from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from .config import load_config
from .paths import to_windows_path
from .preview import get_asset_row, path_is_allowed
from .slicer_handoff import resolve_worker_url

log = logging.getLogger("printshelf.desktop")


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


def open_asset_on_pc(asset_id: int, *, mode: str = "open") -> dict[str, Any]:
    """
    mode=open → Windows default app (zip opens in Explorer/7-Zip).
    mode=reveal → Explorer with the file selected.
    """
    cfg = load_config()
    asset = get_asset_row(asset_id)
    if not asset:
        raise ValueError("Asset not found")
    abs_path = str(asset.get("abs_path") or "")
    if not path_is_allowed(abs_path):
        raise PermissionError("File is outside watched folders")
    if not Path(abs_path).exists():
        raise FileNotFoundError("File missing on disk")

    folders = list(cfg.get("watched_folders") or [])
    win_path = to_windows_path(abs_path, folders)
    if not win_path:
        raise RuntimeError(
            "No Windows path mapping for this file. "
            "Set windows_path on the watched folder in Folders."
        )

    worker = resolve_worker_url(cfg)
    if not worker:
        raise RuntimeError(
            "Windows worker is not configured. "
            "Set slicer_worker_url / orcaslicer_worker_url in Settings."
        )

    action = (mode or "open").strip().lower()
    if action not in {"open", "reveal"}:
        raise ValueError("mode must be open or reveal")

    try:
        status, payload = _http_json(
            "POST",
            f"{worker}/api/slicer/worker/shell-open",
            body=json.dumps({"path": win_path, "mode": action}).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            timeout=10.0,
        )
    except RuntimeError as exc:
        raise RuntimeError(
            f"Windows worker unreachable at {worker}. "
            "Start Flightdeck on your PC, then try again."
        ) from exc

    if status >= 400:
        detail = payload.get("detail") if isinstance(payload, dict) else payload
        if status == 404:
            raise RuntimeError(
                "Windows Flightdeck is running an older build. "
                "On your PC: pull latest flightdeck and restart the Windows Flightdeck / slicer worker, then try again."
            )
        raise RuntimeError(detail or f"Shell open failed ({status})")

    result = payload if isinstance(payload, dict) else {"ok": True}
    result["windows_path"] = win_path
    result["worker_url"] = worker
    result["asset_id"] = int(asset_id)
    result["file_name"] = asset.get("file_name")
    return result
