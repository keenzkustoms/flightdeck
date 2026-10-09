"""MakerDeck design library — vault files + reloadable param sidecars."""

from __future__ import annotations

import base64
import json
import logging
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

log = logging.getLogger(__name__)

IMPORTS_FILENAME = "makerdeck_designs.json"
IMPORT_SUBDIR = "MakerDeck"
SIDECAR_SUFFIX = ".makerdeck.json"
_MAX_DESIGNS = 100
_FOLDER_RE = re.compile(r"[^\w\s\-]+", re.UNICODE)


class MakerDeckLibraryError(Exception):
    def __init__(self, message: str, status: int = 400) -> None:
        super().__init__(message)
        self.status = status


def imports_path(data_dir: Path) -> Path:
    return data_dir / IMPORTS_FILENAME


def load_designs(data_dir: Path) -> list[dict[str, Any]]:
    path = imports_path(data_dir)
    if not path.exists():
        return []
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        log.warning("makerdeck: could not read designs manifest at %s", path)
        return []
    rows = payload.get("designs") if isinstance(payload, dict) else payload
    if not isinstance(rows, list):
        return []
    return [row for row in rows if isinstance(row, dict) and row.get("id")]


def save_designs(data_dir: Path, rows: list[dict[str, Any]]) -> None:
    path = imports_path(data_dir)
    path.parent.mkdir(parents=True, exist_ok=True)
    trimmed = [_public_record(row) for row in rows[:_MAX_DESIGNS]]
    path.write_text(json.dumps({"designs": trimmed}, indent=2), encoding="utf-8")


def _public_record(row: dict[str, Any]) -> dict[str, Any]:
    """Manifest rows stay small — thumbnails live in separate image files."""
    thumb_path = row.get("thumbnail_path")
    has_thumb = bool(thumb_path) or bool(row.get("thumbnail"))
    return {
        "id": row.get("id"),
        "name": row.get("name"),
        "format": row.get("format"),
        "part": row.get("part"),
        "exported_at": row.get("exported_at"),
        "watermark_serial": row.get("watermark_serial"),
        "vault_path": row.get("vault_path"),
        "sidecar_path": row.get("sidecar_path"),
        "thumbnail_path": thumb_path,
        "has_thumbnail": has_thumb,
        "size": row.get("size"),
        "folder": row.get("folder") or "",
    }


def _normalize_folder(raw: str | None) -> str:
    s = str(raw or "").strip().replace("\\", "/")
    if not s:
        return ""
    s = s.split("/")[0].strip()
    s = _FOLDER_RE.sub("", s).strip()
    return s[:48]


def _stem_from_name(name: str) -> str:
    stem = re.sub(r"[^\w\-]+", "-", name.strip().lower()).strip("-")
    return stem[:48] or "design"


def _unique_sidecar_stem(folder: Path, stem: str, safe_join_under: Callable[..., Path]) -> str:
    candidate = stem
    sidecar = safe_join_under(folder, f"{candidate}{SIDECAR_SUFFIX}", missing_ok=True)
    if sidecar.exists():
        stamp = datetime.utcnow().strftime("%Y%m%d%H%M%S")
        candidate = f"{stem}_{stamp}"
    return candidate


def _write_thumbnail_bytes(
    folder: Path,
    stem: str,
    raw: bytes,
    library_root: Path,
    safe_join_under: Callable[..., Path],
    ext: str = "jpg",
) -> str | None:
    if not raw:
        return None
    thumb = safe_join_under(folder, f"{stem}.thumb.{ext}", missing_ok=True)
    thumb.write_bytes(raw)
    return thumb.relative_to(library_root.resolve()).as_posix()


def _write_thumbnail_file(
    folder: Path,
    stem: str,
    data_url: str,
    library_root: Path,
    safe_join_under: Callable[..., Path],
) -> str | None:
    if not data_url or not data_url.startswith("data:image"):
        return None
    match = re.match(r"data:image/(jpeg|jpg|png|webp);base64,(.+)", data_url, re.I)
    if not match:
        return None
    ext = "jpg" if match.group(1).lower() in {"jpeg", "jpg"} else match.group(1).lower()
    try:
        raw = base64.b64decode(match.group(2), validate=True)
    except Exception:
        return None
    if not raw:
        return None
    thumb = safe_join_under(folder, f"{stem}.thumb.{ext}", missing_ok=True)
    thumb.write_bytes(raw)
    return thumb.relative_to(library_root.resolve()).as_posix()


def _utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _parse_meta(raw: str) -> dict[str, Any]:
    if not raw or not raw.strip():
        return {}
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise MakerDeckLibraryError("Invalid meta JSON.") from exc
    if not isinstance(payload, dict):
        raise MakerDeckLibraryError("meta must be a JSON object.")
    return payload


def _vault_folder(
    library_root: Path,
    safe_join_under: Callable[..., Path],
    subfolder: str = "",
) -> Path:
    folder = safe_join_under(library_root.resolve(), IMPORT_SUBDIR, missing_ok=True)
    subfolder = _normalize_folder(subfolder)
    if subfolder:
        folder = safe_join_under(folder, subfolder, missing_ok=True)
    folder.mkdir(parents=True, exist_ok=True)
    return folder


def save_export(
    *,
    library_root: Path,
    data_dir: Path,
    filename: str,
    file_bytes: bytes,
    meta_json: str,
    safe_join_under: Callable[..., Path],
    safe_basename: Callable[[str | None, str], str],
    thumbnail_bytes: bytes | None = None,
    trace_image_bytes: bytes | None = None,
) -> dict[str, Any]:
    if not file_bytes:
        raise MakerDeckLibraryError("Empty export file.")

    meta = _parse_meta(meta_json)
    safe_name = safe_basename(filename, "makerdeck-export")
    folder_name = _normalize_folder(meta.get("folder"))
    folder = _vault_folder(library_root, safe_join_under, folder_name)
    dest = safe_join_under(folder, safe_name, missing_ok=True)
    if dest.exists():
        stem = dest.stem
        suffix = "".join(dest.suffixes) or dest.suffix
        stamp = datetime.utcnow().strftime("%Y%m%d%H%M%S")
        dest = safe_join_under(folder, f"{stem}_{stamp}{suffix}", missing_ok=True)

    dest.write_bytes(file_bytes)
    vault_rel = dest.relative_to(library_root.resolve()).as_posix()

    design_id = str(meta.get("id") or uuid.uuid4().hex[:12])
    exported_at = str(meta.get("exported_at") or _utc_now())
    name = str(meta.get("name") or dest.stem)
    fmt = str(meta.get("format") or dest.suffix.lstrip(".") or "bin")
    part = str(meta.get("part") or "body")
    thumbnail = str(meta.get("thumbnail") or "")
    state = meta.get("state") if isinstance(meta.get("state"), dict) else {}
    trace_image = meta.get("traceImage") if isinstance(meta.get("traceImage"), str) else ""
    if thumbnail_bytes:
        thumbnail_path = _write_thumbnail_bytes(dest.parent, dest.stem, thumbnail_bytes, library_root, safe_join_under)
    else:
        thumbnail_path = _write_thumbnail_file(dest.parent, dest.stem, thumbnail, library_root, safe_join_under)

    trace_image_path = None
    if trace_image_bytes:
        trace_file = safe_join_under(folder, f"{dest.stem}.trace.jpg", missing_ok=True)
        trace_file.write_bytes(trace_image_bytes)
        trace_image_path = trace_file.relative_to(library_root.resolve()).as_posix()
        trace_image = ""

    sidecar_name = f"{dest.stem}{SIDECAR_SUFFIX}"
    sidecar = safe_join_under(folder, sidecar_name, missing_ok=True)
    sidecar_payload = {
        "id": design_id,
        "name": name,
        "format": fmt,
        "part": part,
        "folder": folder_name,
        "exported_at": exported_at,
        "watermark_serial": meta.get("watermark_serial"),
        "vault_path": vault_rel,
        "state": state,
        "traceImage": trace_image,
        "trace_image_path": trace_image_path,
    }
    sidecar.write_text(json.dumps(sidecar_payload, indent=2), encoding="utf-8")
    sidecar_rel = sidecar.relative_to(library_root.resolve()).as_posix()

    record = {
        "id": design_id,
        "name": name,
        "format": fmt,
        "part": part,
        "exported_at": exported_at,
        "watermark_serial": meta.get("watermark_serial"),
        "vault_path": vault_rel,
        "sidecar_path": sidecar_rel,
        "thumbnail_path": thumbnail_path,
        "has_thumbnail": bool(thumbnail_path),
        "size": len(file_bytes),
        "folder": folder_name,
    }

    rows = load_designs(data_dir)
    rows = [row for row in rows if row.get("id") != design_id]
    rows.insert(0, record)
    save_designs(data_dir, rows)

    return {
        "ok": True,
        "design": _public_record(record),
    }


def save_design(
    *,
    library_root: Path,
    data_dir: Path,
    meta_json: str,
    safe_join_under: Callable[..., Path],
    thumbnail_bytes: bytes | None = None,
    trace_image_bytes: bytes | None = None,
) -> dict[str, Any]:
    meta = _parse_meta(meta_json)
    name = str(meta.get("name") or "Untitled design").strip() or "Untitled design"
    folder_name = _normalize_folder(meta.get("folder"))
    folder = _vault_folder(library_root, safe_join_under, folder_name)

    design_id = str(meta.get("id") or uuid.uuid4().hex[:12])
    exported_at = str(meta.get("exported_at") or _utc_now())
    thumbnail = str(meta.get("thumbnail") or "")
    state = meta.get("state") if isinstance(meta.get("state"), dict) else {}
    trace_image = meta.get("traceImage") if isinstance(meta.get("traceImage"), str) else ""

    stem = _unique_sidecar_stem(folder, _stem_from_name(name), safe_join_under)
    if thumbnail_bytes:
        thumbnail_path = _write_thumbnail_bytes(folder, stem, thumbnail_bytes, library_root, safe_join_under)
    else:
        thumbnail_path = _write_thumbnail_file(folder, stem, thumbnail, library_root, safe_join_under)

    trace_image_path = None
    if trace_image_bytes:
        trace_file = safe_join_under(folder, f"{stem}.trace.jpg", missing_ok=True)
        trace_file.write_bytes(trace_image_bytes)
        trace_image_path = trace_file.relative_to(library_root.resolve()).as_posix()
        trace_image = ""

    sidecar = safe_join_under(folder, f"{stem}{SIDECAR_SUFFIX}", missing_ok=True)
    sidecar_payload = {
        "id": design_id,
        "name": name,
        "format": "design",
        "part": "body",
        "folder": folder_name,
        "exported_at": exported_at,
        "watermark_serial": meta.get("watermark_serial"),
        "vault_path": "",
        "state": state,
        "traceImage": trace_image,
        "trace_image_path": trace_image_path,
    }
    sidecar.write_text(json.dumps(sidecar_payload, indent=2), encoding="utf-8")
    sidecar_rel = sidecar.relative_to(library_root.resolve()).as_posix()

    record = {
        "id": design_id,
        "name": name,
        "format": "design",
        "part": "body",
        "exported_at": exported_at,
        "watermark_serial": meta.get("watermark_serial"),
        "vault_path": "",
        "sidecar_path": sidecar_rel,
        "thumbnail_path": thumbnail_path,
        "has_thumbnail": bool(thumbnail_path),
        "size": 0,
        "folder": folder_name,
    }

    rows = load_designs(data_dir)
    rows = [row for row in rows if row.get("id") != design_id]
    rows.insert(0, record)
    save_designs(data_dir, rows)

    return {
        "ok": True,
        "design": _public_record(record),
    }


def ensure_compact_manifest(
    data_dir: Path,
    library_root: Path,
    safe_join_under: Callable[..., Path],
) -> None:
    rows = load_designs(data_dir)
    if not rows:
        return
    changed = False
    for row in rows:
        inline = row.get("thumbnail")
        if isinstance(inline, str) and inline.startswith("data:image"):
            if not row.get("thumbnail_path"):
                vault_rel = str(row.get("vault_path") or "").strip()
                if vault_rel:
                    model = safe_join_under(library_root.resolve(), vault_rel, missing_ok=True)
                    if model.is_file():
                        rel = _write_thumbnail_file(
                            model.parent,
                            model.stem,
                            inline,
                            library_root,
                            safe_join_under,
                        )
                        if rel:
                            row["thumbnail_path"] = rel
                            row["has_thumbnail"] = True
            row.pop("thumbnail", None)
            changed = True
    if changed:
        save_designs(data_dir, rows)


def recent_designs(
    data_dir: Path,
    limit: int = 50,
    folder: str | None = None,
) -> list[dict[str, Any]]:
    rows = load_designs(data_dir)
    if folder is not None:
        if folder == "":
            rows = [row for row in rows if not _normalize_folder(row.get("folder"))]
        else:
            norm = _normalize_folder(folder)
            norm_key = norm.casefold()
            rows = [
                row for row in rows
                if _normalize_folder(row.get("folder")).casefold() == norm_key
            ]
    cap = max(1, min(limit, _MAX_DESIGNS))
    return [_public_record(row) for row in rows[:cap]]


def list_folders(data_dir: Path) -> list[str]:
    seen: dict[str, str] = {}
    for row in load_designs(data_dir):
        folder = _normalize_folder(row.get("folder"))
        if not folder:
            continue
        key = folder.casefold()
        if key not in seen:
            seen[key] = folder
    return sorted(seen.values(), key=str.lower)


def _find_design(data_dir: Path, design_id: str) -> dict[str, Any] | None:
    design_id = (design_id or "").strip()
    if not design_id:
        return None
    for row in load_designs(data_dir):
        if str(row.get("id")) == design_id:
            return row
    return None


def design_params(
    data_dir: Path,
    library_root: Path,
    design_id: str,
    safe_join_under: Callable[..., Path],
) -> dict[str, Any]:
    row = _find_design(data_dir, design_id)
    if not row:
        raise MakerDeckLibraryError("Design not found.", status=404)
    sidecar_rel = str(row.get("sidecar_path") or "").strip()
    if not sidecar_rel:
        raise MakerDeckLibraryError("Design sidecar missing.", status=404)
    sidecar = safe_join_under(library_root.resolve(), sidecar_rel, missing_ok=True)
    if not sidecar.is_file():
        raise MakerDeckLibraryError("Design sidecar not found on disk.", status=404)
    try:
        payload = json.loads(sidecar.read_text(encoding="utf-8"))
    except Exception as exc:
        raise MakerDeckLibraryError("Could not read design sidecar.") from exc
    if not isinstance(payload, dict):
        raise MakerDeckLibraryError("Invalid design sidecar.")
    trace_rel = str(payload.get("trace_image_path") or "").strip()
    if trace_rel and not payload.get("traceImage"):
        trace_file = safe_join_under(library_root.resolve(), trace_rel, missing_ok=True)
        if trace_file.is_file():
            try:
                raw = trace_file.read_bytes()
                payload = {
                    **payload,
                    "traceImage": f"data:image/jpeg;base64,{base64.b64encode(raw).decode('ascii')}",
                }
            except Exception:
                log.warning("makerdeck: could not read trace image for %s", design_id)
    return payload


def design_thumbnail(
    data_dir: Path,
    library_root: Path,
    design_id: str,
    safe_join_under: Callable[..., Path],
) -> tuple[bytes, str]:
    row = _find_design(data_dir, design_id)
    if not row:
        raise MakerDeckLibraryError("Design not found.", status=404)
    thumb_rel = str(row.get("thumbnail_path") or "").strip()
    if thumb_rel:
        thumb = safe_join_under(library_root.resolve(), thumb_rel, missing_ok=True)
        if thumb.is_file():
            ext = thumb.suffix.lower()
            media = "image/jpeg" if ext in {".jpg", ".jpeg"} else "image/png" if ext == ".png" else "image/webp"
            return thumb.read_bytes(), media
    inline = row.get("thumbnail")
    if isinstance(inline, str) and inline.startswith("data:image"):
        match = re.match(r"data:(image/[^;]+);base64,(.+)", inline, re.I)
        if match:
            try:
                return base64.b64decode(match.group(2), validate=True), match.group(1)
            except Exception:
                pass
    raise MakerDeckLibraryError("Thumbnail not found.", status=404)


def delete_design(
    data_dir: Path,
    library_root: Path,
    design_id: str,
    safe_join_under: Callable[..., Path],
) -> bool:
    row = _find_design(data_dir, design_id)
    if not row:
        return False
    for key in ("vault_path", "sidecar_path", "thumbnail_path"):
        rel = str(row.get(key) or "").strip()
        if not rel:
            continue
        try:
            path = safe_join_under(library_root.resolve(), rel, missing_ok=True)
            if path.is_file():
                path.unlink()
        except Exception:
            log.warning("makerdeck: could not delete %s for design %s", key, design_id)
    sidecar_rel = str(row.get("sidecar_path") or "").strip()
    if sidecar_rel:
        try:
            sidecar = safe_join_under(library_root.resolve(), sidecar_rel, missing_ok=True)
            if sidecar.is_file():
                payload = json.loads(sidecar.read_text(encoding="utf-8"))
                trace_rel = str(payload.get("trace_image_path") or "").strip()
                if trace_rel:
                    trace = safe_join_under(library_root.resolve(), trace_rel, missing_ok=True)
                    if trace.is_file():
                        trace.unlink()
        except Exception:
            pass
    rows = [r for r in load_designs(data_dir) if str(r.get("id")) != design_id]
    save_designs(data_dir, rows)
    return True
