from __future__ import annotations

import io
import tempfile
import zipfile
from pathlib import Path
from typing import Any

PRINTABLE_SUFFIXES = (".stl", ".obj", ".3mf", ".gcode.3mf", ".gcode", ".gco")
MAX_LISTED = 120
MAX_THUMB_ENTRY_BYTES = 24 * 1024 * 1024


def _is_printable(name: str) -> bool:
    lower = name.lower().replace("\\", "/")
    if lower.endswith("/") or "/__macosx/" in f"/{lower}" or lower.startswith("__macosx/"):
        return False
    base = Path(lower).name
    if base.startswith("."):
        return False
    return any(lower.endswith(suf) for suf in PRINTABLE_SUFFIXES)


def _kind_inside(name: str) -> str | None:
    lower = name.lower()
    if lower.endswith(".gcode.3mf"):
        return "gcode.3mf"
    if lower.endswith(".3mf"):
        return "3mf"
    if lower.endswith(".stl"):
        return "stl"
    if lower.endswith(".obj"):
        return "obj"
    if lower.endswith((".gcode", ".gco")):
        return "gcode"
    return None


def _pick_preview_candidate(printables: list[dict[str, Any]]) -> dict[str, Any] | None:
    if not printables:
        return None
    # Keep ZIP preview generation lightweight on Pi: prefer mesh types with
    # cheaper parsers and avoid heavy 3MF decode in archive backfills.
    rank = {"stl": 0, "obj": 1}
    ordered = sorted(
        printables,
        key=lambda p: (
            rank.get(str(p.get("kind") or ""), 99),
            int(p.get("size_bytes") or 0),
            str(p.get("name") or ""),
        ),
    )
    for p in ordered:
        if str(p.get("kind") or "") in rank:
            return p
    return None


def _thumb_from_zip_printable(zf: zipfile.ZipFile, printable: dict[str, Any]) -> bytes | None:
    kind = str(printable.get("kind") or "")
    name = str(printable.get("name") or "")
    if kind not in {"stl", "obj"} or not name:
        return None
    if int(printable.get("size_bytes") or 0) > MAX_THUMB_ENTRY_BYTES:
        return None
    try:
        raw = zf.read(name)
    except Exception:
        return None
    if not raw or len(raw) > MAX_THUMB_ENTRY_BYTES:
        return None
    suffix = Path(name).suffix.lower() or ".bin"
    if name.lower().endswith(".gcode.3mf"):
        suffix = ".gcode.3mf"
    try:
        from .obj import parse_obj
        from .stl import parse_stl
        from .threemf import parse_3mf
    except Exception:
        return None
    try:
        with tempfile.TemporaryDirectory(prefix="printshelf-zip-thumb-") as td:
            tmp = Path(td) / f"entry{suffix}"
            tmp.write_bytes(raw)
            if kind == "stl":
                parsed = parse_stl(tmp)
            elif kind in {"3mf", "gcode.3mf"}:
                parsed = parse_3mf(tmp, kind=kind)
            elif kind == "obj":
                parsed = parse_obj(tmp)
            else:
                return None
            tb = parsed.get("thumb_bytes")
            return tb if isinstance(tb, (bytes, bytearray)) and tb else None
    except Exception:
        return None


def _list_printables_from_zipfile(zf: zipfile.ZipFile) -> tuple[list[dict[str, Any]], dict[str, int], int, int]:
    entries: list[dict[str, Any]] = []
    printable: list[dict[str, Any]] = []
    by_kind: dict[str, int] = {}
    total_files = 0
    total_uncompressed = 0
    for info in zf.infolist():
        name = info.filename.replace("\\", "/")
        if not name or name.endswith("/"):
            continue
        lower = name.lower()
        if "/__macosx/" in f"/{lower}" or lower.startswith("__macosx/"):
            continue
        total_files += 1
        total_uncompressed += int(info.file_size or 0)
        row = {
            "name": name,
            "size_bytes": int(info.file_size or 0),
            "compressed_bytes": int(info.compress_size or 0),
        }
        if len(entries) < MAX_LISTED:
            entries.append(row)
        pk = _kind_inside(name)
        if pk:
            by_kind[pk] = by_kind.get(pk, 0) + 1
            if len(printable) < MAX_LISTED:
                printable.append({**row, "kind": pk})
    return printable, by_kind, total_files, total_uncompressed


def split_nested_entry(entry: str) -> tuple[str | None, str]:
    """Split `Nested.zip/path/inside.stl` → (Nested.zip, path/inside.stl). Flat entries → (None, entry)."""
    e = (entry or "").replace("\\", "/").lstrip("/")
    if not e or ".." in e.split("/"):
        raise ValueError("Invalid zip entry path")
    lower = e.lower()
    idx = lower.find(".zip/")
    if idx >= 0:
        return e[: idx + 4], e[idx + 5 :]
    return None, e


def list_nested_zip(outer_path: Path, nested_entry: str) -> dict[str, Any]:
    """Open a nested .zip member inside an outer archive (in memory). No extract to disk."""
    nested_entry = nested_entry.replace("\\", "/").lstrip("/")
    if not nested_entry.lower().endswith(".zip") or ".." in nested_entry.split("/"):
        raise ValueError("Nested entry must be a .zip member path")

    with zipfile.ZipFile(outer_path, "r") as outer:
        names = {n.replace("\\", "/"): n for n in outer.namelist()}
        real = names.get(nested_entry)
        if real is None:
            lower_map = {k.lower(): v for k, v in names.items()}
            real = lower_map.get(nested_entry.lower())
        if real is None:
            raise FileNotFoundError(f"Nested zip not found: {nested_entry}")
        raw = outer.read(real)

    error = None
    printable: list[dict[str, Any]] = []
    by_kind: dict[str, int] = {}
    total_files = 0
    total_uncompressed = 0
    try:
        with zipfile.ZipFile(io.BytesIO(raw), "r") as inner:
            printable, by_kind, total_files, total_uncompressed = _list_printables_from_zipfile(inner)
    except zipfile.BadZipFile as exc:
        error = f"Bad nested zip: {exc}"
    except Exception as exc:
        error = str(exc)

    # Prefix printable names so orbit/file can address Nested.zip/inner.stl
    prefixed = [
        {**p, "name": f"{nested_entry}/{p['name']}", "nested_zip": nested_entry, "inner_name": p["name"]}
        for p in printable
    ]
    return {
        "nested_entry": nested_entry,
        "entry_count": total_files,
        "uncompressed_bytes": total_uncompressed,
        "printable_count": sum(by_kind.values()),
        "printable_by_kind": by_kind,
        "printables": prefixed,
        "error": error,
    }


def parse_zip(path: Path) -> dict[str, Any]:
    """Index a .zip in place — list members, count printables. No extract."""
    entries: list[dict[str, Any]] = []
    printable: list[dict[str, Any]] = []
    nested_zips: list[dict[str, Any]] = []
    by_kind: dict[str, int] = {}
    total_files = 0
    total_uncompressed = 0
    error = None
    thumb_bytes = None
    preview_entry = None

    try:
        with zipfile.ZipFile(path, "r") as zf:
            infos = zf.infolist()
            for info in infos:
                name = info.filename.replace("\\", "/")
                if not name or name.endswith("/"):
                    continue
                lower = name.lower()
                if "/__macosx/" in f"/{lower}" or lower.startswith("__macosx/"):
                    continue
                total_files += 1
                total_uncompressed += int(info.file_size or 0)
                row = {
                    "name": name,
                    "size_bytes": int(info.file_size or 0),
                    "compressed_bytes": int(info.compress_size or 0),
                }
                if len(entries) < MAX_LISTED:
                    entries.append(row)
                if lower.endswith(".zip"):
                    if len(nested_zips) < MAX_LISTED:
                        nested_zips.append(row)
                    continue
                pk = _kind_inside(name)
                if pk:
                    by_kind[pk] = by_kind.get(pk, 0) + 1
                    if len(printable) < MAX_LISTED:
                        printable.append({**row, "kind": pk})
            candidate = _pick_preview_candidate(printable)
            if candidate:
                preview_entry = candidate.get("name")
                thumb_bytes = _thumb_from_zip_printable(zf, candidate)
    except zipfile.BadZipFile as exc:
        error = f"Bad zip: {exc}"
    except Exception as exc:
        error = str(exc)

    printable_count = sum(by_kind.values())
    return {
        "kind": "zip",
        "triangle_count": None,
        "bbox": None,
        "has_textures": False,
        "is_sliced": False,
        "thumb_bytes": thumb_bytes,
        "sidecars": [],
        "error": error,
        "meta": {
            "archive": True,
            "entry_count": total_files,
            "listed_count": len(entries),
            "list_truncated": total_files > len(entries),
            "uncompressed_bytes": total_uncompressed,
            "printable_count": printable_count,
            "printable_by_kind": by_kind,
            "entries": entries,
            "printables": printable,
            "preview_entry": preview_entry,
            "nested_zips": nested_zips,
            "nested_zip_count": len(nested_zips),
            "error": error,
        },
    }
