"""Local MeshFinder. Lists folders on this PC and serves a file into the viewer.

The Pi is not on this path. Nothing here starts a print.
"""
from __future__ import annotations

import array
import hashlib
import json
import mimetypes
import os
import random
import struct
import subprocess
import threading
import time
import urllib.request
import zipfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, quote, unquote, urlparse

HOST = "127.0.0.1"
PORT = 8111
FLIGHTDECK_URL = "https://flightdeck.tail7de73e.ts.net"
STATIC = Path(__file__).resolve().parent / "static"

MESH = {".stl", ".obj"}
IMAGE = {".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"}
DOC = {".pdf", ".txt", ".md", ".csv"}
SKIP_NAMES = {
    "desktop.ini",
    "thumbs.db",
    ".ds_store",
}


def config_path() -> Path:
    base = os.environ.get("APPDATA") or str(Path.home())
    path = Path(base) / "MeshFinder" / "desk.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


def default_roots() -> list[str]:
    downloads = Path.home() / "Downloads"
    if downloads.is_dir():
        return [str(downloads)]
    return []


def _read_config() -> dict:
    path = config_path()
    if not path.is_file():
        return {"roots": default_roots(), "favourites": []}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {"roots": default_roots(), "favourites": []}
    return data if isinstance(data, dict) else {"roots": default_roots(), "favourites": []}


def _write_config(data: dict) -> None:
    config_path().write_text(json.dumps(data, indent=2), encoding="utf-8")


def load_roots() -> list[str]:
    data = _read_config()
    raw_roots = data.get("roots")
    if not isinstance(raw_roots, list):
        raw_roots = default_roots()
        data["roots"] = raw_roots
        _write_config(data)
    roots = []
    for raw in raw_roots:
        try:
            folder = Path(raw).expanduser().resolve()
        except Exception:
            continue
        if folder.is_dir():
            roots.append(str(folder))
    return roots


def save_roots(roots: list[str]) -> None:
    data = _read_config()
    data["roots"] = roots
    _write_config(data)


def load_favourites() -> list[dict]:
    data = _read_config()
    roots = load_roots()
    items = []
    for raw in data.get("favourites") or []:
        if not isinstance(raw, dict):
            continue
        try:
            target = Path(str(raw.get("path") or "")).resolve()
        except Exception:
            continue
        if not target.is_file() or not _under_root(target, roots):
            continue
        try:
            size = int(raw.get("size") or 0)
        except (TypeError, ValueError):
            size = 0
        items.append({
            "path": str(target),
            "entry": str(raw.get("entry") or ""),
            "name": str(raw.get("name") or target.name),
            "kind": str(raw.get("kind") or "file"),
            "size": size,
        })
    return items


def save_favourites(items: list[dict]) -> None:
    data = _read_config()
    data["favourites"] = items
    _write_config(data)


def load_excluded() -> list[str]:
    data = _read_config()
    found = []
    for raw in data.get("excluded") or []:
        try:
            folder = Path(str(raw)).expanduser().resolve()
        except Exception:
            continue
        if folder.exists():
            found.append(str(folder))
    return found


def save_excluded(items: list[str]) -> None:
    data = _read_config()
    data["excluded"] = items
    _write_config(data)


_excluded_stamp: int | None = None
_excluded_prefixes_cache: list[str] = []


def _excluded_prefixes() -> list[str]:
    """Folder prefixes to hide. Cached so a library walk does not stat the config each file."""
    global _excluded_stamp, _excluded_prefixes_cache
    path = config_path()
    try:
        stamp = path.stat().st_mtime_ns
    except OSError:
        stamp = 0
    if _excluded_stamp == stamp:
        return _excluded_prefixes_cache
    prefixes = []
    for raw in _read_config().get("excluded") or []:
        text = str(raw).replace("/", "\\").strip().rstrip("\\").casefold()
        if text.startswith("\\\\?\\unc\\"):
            text = "\\\\" + text[8:]
        elif text.startswith("\\\\?\\"):
            text = text[4:]
        if text:
            prefixes.append(text)
    _excluded_stamp = stamp
    _excluded_prefixes_cache = prefixes
    return prefixes


def _is_excluded(path: Path) -> bool:
    key = str(path).replace("/", "\\").rstrip("\\").casefold()
    if key.startswith("\\\\?\\unc\\"):
        key = "\\\\" + key[8:]
    elif key.startswith("\\\\?\\"):
        key = key[4:]
    for other in _excluded_prefixes():
        if key == other or key.startswith(other + "\\"):
            return True
    return False


def _collection_member(raw) -> dict | None:
    if isinstance(raw, str):
        path, entry, name, kind, size = raw, "", Path(raw).name, "folder", 0
    elif isinstance(raw, dict):
        path = str(raw.get("path") or "")
        entry = str(raw.get("entry") or "")
        name = str(raw.get("name") or Path(path).name)
        kind = str(raw.get("kind") or "folder")
        try:
            size = int(raw.get("size") or 0)
        except (TypeError, ValueError):
            size = 0
    else:
        return None
    try:
        target = Path(path).expanduser().resolve()
    except Exception:
        return None
    if not target.exists() or _is_excluded(target) or not _under_root(target, load_roots()):
        return None
    return {"path": str(target), "entry": entry, "name": name or target.name, "kind": kind, "size": size}


def load_collections() -> list[dict]:
    data = _read_config()
    groups = []
    for raw in data.get("collections") or []:
        if not isinstance(raw, dict):
            continue
        name = str(raw.get("name") or "").strip()
        if not name:
            continue
        items = []
        seen = set()
        for item in raw.get("items") or raw.get("paths") or []:
            member = _collection_member(item)
            if not member:
                continue
            key = f"{member['path']}|{member['entry']}".casefold()
            if key in seen:
                continue
            seen.add(key)
            items.append(member)
        groups.append({"name": name, "items": items})
    return groups


def save_collections(items: list[dict]) -> None:
    data = _read_config()
    data["collections"] = items
    _write_config(data)


def load_session() -> dict:
    data = _read_config()
    raw = data.get("session") if isinstance(data.get("session"), dict) else {}
    place = raw.get("place") if isinstance(raw.get("place"), dict) else {}
    opened = []
    for item in raw.get("open") or []:
        text = str(item or "").strip()
        if text and text not in opened:
            opened.append(text)
    return {
        "open": opened[:80],
        "place": {"path": str(place.get("path") or ""), "name": str(place.get("name") or "")},
        "printable": raw.get("printable") is not False,
        "showAll": bool(raw.get("showAll")),
    }


def save_session(body: dict) -> dict:
    data = _read_config()
    place = body.get("place") if isinstance(body.get("place"), dict) else {}
    opened = []
    for item in body.get("open") or []:
        text = str(item or "").strip()
        if text and text not in opened:
            opened.append(text)
    session = {
        "open": opened[:80],
        "place": {"path": str(place.get("path") or ""), "name": str(place.get("name") or "")},
        "printable": body.get("printable") is not False,
        "showAll": bool(body.get("showAll")),
    }
    data["session"] = session
    _write_config(data)
    return session


def _under_root(path: Path, roots: list[str]) -> bool:
    resolved = path.resolve()
    for root in roots:
        try:
            resolved.relative_to(Path(root).resolve())
            return True
        except ValueError:
            continue
    return False


def _kind_for(name: str) -> str:
    lower = name.lower()
    if lower.endswith(".gcode.3mf"):
        return "gcode.3mf"
    suffix = Path(lower).suffix
    if suffix == ".zip":
        return "zip"
    if suffix in MESH:
        return suffix[1:]
    if suffix == ".3mf":
        return "3mf"
    if suffix == ".svg":
        return "svg"
    if suffix in IMAGE:
        return "image"
    if suffix in DOC:
        return "doc"
    if lower.endswith((".gcode", ".gco")):
        return "gcode"
    return "file"


def _skip_name(name: str) -> bool:
    base = Path(name).name
    if not base or base.startswith("._") or base.startswith("."):
        return True
    if base.lower() in SKIP_NAMES:
        return True
    if "__macosx" in name.replace("\\", "/").lower():
        return True
    return False


def list_folder(folder: Path) -> dict:
    folders = []
    files = []
    try:
        children = list(folder.iterdir())
    except OSError as exc:
        return {"error": str(exc), "folders": [], "files": []}
    for child in children:
        if _skip_name(child.name) or _is_excluded(child):
            continue
        try:
            if child.is_dir():
                folders.append({"name": child.name, "path": str(child), "kind": "folder"})
            elif child.is_file():
                kind = _kind_for(child.name)
                item = {
                    "name": child.name,
                    "path": str(child),
                    "kind": "zip" if kind == "zip" else kind,
                    "size": child.stat().st_size,
                    "entry": "",
                }
                if kind == "zip":
                    continue
                files.append(item)
        except OSError:
            continue
    folders.sort(key=lambda item: (item["kind"] != "folder", item["name"].lower()))
    files.sort(key=lambda item: item["name"].lower())
    return {"folders": folders, "files": files}


PRINTABLE_KINDS = {"stl", "obj", "3mf", "gcode.3mf", "gcode"}
LIBRARY_KINDS = PRINTABLE_KINDS | {"image", "doc", "svg"}


def _card_from_name(path: Path, name: str, size: int, entry: str = "", printable: bool = True) -> dict | None:
    kind = _kind_for(Path(name).name)
    allowed = PRINTABLE_KINDS if printable else LIBRARY_KINDS
    if kind not in allowed:
        return None
    return {
        "name": Path(name).name,
        "path": str(path),
        "kind": kind,
        "size": int(size or 0),
        "entry": entry,
    }


def _iter_zip_cards(zip_path: Path, printable: bool = True):
    try:
        with zipfile.ZipFile(zip_path) as zf:
            for info in zf.infolist():
                name = info.filename.replace("\\", "/")
                if not name or name.endswith("/") or _skip_name(name):
                    continue
                card = _card_from_name(zip_path, name, int(info.file_size or 0), name, printable)
                if card:
                    yield card
    except (OSError, zipfile.BadZipFile):
        return


def _iter_loose_and_zips(folder: Path, printable: bool, with_archives: bool = False):
    """Loose files in this folder, then a mix of every zip sitting beside them.

    One zip used to fill the whole first page, so a directory of zips felt like
    you had to open each one. Taking a turn from each zip shows the folder.
    """
    try:
        children = sorted(folder.iterdir(), key=lambda item: item.name.lower())
    except OSError:
        return
    zips = []
    for child in children:
        if _skip_name(child.name) or not child.is_file() or _is_excluded(child):
            continue
        if child.suffix.lower() == ".zip":
            zips.append(child)
            if with_archives:
                try:
                    size = child.stat().st_size
                except OSError:
                    size = 0
                if size > 0:
                    yield {
                        "name": child.name,
                        "path": str(child),
                        "kind": "zip",
                        "size": size,
                        "entry": "",
                    }
            continue
        try:
            size = child.stat().st_size
        except OSError:
            continue
        card = _card_from_name(child, child.name, size, printable=printable)
        if card:
            yield card
    streams = [_iter_zip_cards(path, printable) for path in zips]
    while streams:
        alive = []
        for stream in streams:
            try:
                yield next(stream)
            except StopIteration:
                continue
            alive.append(stream)
        streams = alive


def _iter_dir_cards(folder: Path, recursive: bool, printable: bool = True, with_archives: bool = False):
    if not recursive:
        yield from _iter_loose_and_zips(folder, printable, with_archives)
        return
    for dirpath, dirnames, _filenames in os.walk(folder):
        dirnames[:] = sorted(
            (name for name in dirnames if not _skip_name(name) and not _is_excluded(Path(dirpath) / name)),
            key=str.lower,
        )
        yield from _iter_loose_and_zips(Path(dirpath), printable, with_archives)


def _search_hit(needle: str, card: dict) -> bool:
    if needle in card["name"].casefold():
        return True
    if card.get("entry") and needle in Path(card["path"]).name.casefold():
        return True
    return False


def _search_page(matches: list[dict], *, needle: str, offset: int, limit: int, indexing: bool) -> dict:
    matches.sort(key=lambda item: item["name"].casefold())
    page = matches[offset:offset + limit]
    return {
        "items": page,
        "offset": offset,
        "limit": limit,
        "truncated": offset + len(page) < len(matches),
        "capped": False,
        "query": needle,
        "indexing": indexing,
    }


_index_lock = threading.Lock()
_index_cache: dict | None = None
_index_building = False


def _index_path() -> Path:
    return config_path().parent / "search-index.json"


def _row_hit(needle: str, row: list) -> bool:
    if needle in str(row[0]).casefold():
        return True
    if row[4] and needle in Path(str(row[1])).name.casefold():
        return True
    return False


def _local_root(root: str) -> bool:
    return not root.startswith("\\\\") and not root.startswith("//")


def _search_loose(needle: str, *, printable: bool, offset: int, limit: int) -> dict:
    """File names on this PC only. Zip members and network folders wait for the index."""
    matches = []
    for root in load_roots():
        if not _local_root(root):
            continue
        for dirpath, dirnames, filenames in os.walk(root):
            dirnames[:] = sorted((name for name in dirnames if not _skip_name(name) and not _is_excluded(Path(dirpath) / name)), key=str.lower)
            for name in filenames:
                if _skip_name(name) or name.lower().endswith(".zip"):
                    continue
                if needle not in name.casefold():
                    continue
                path = Path(dirpath) / name
                try:
                    size = path.stat().st_size
                except OSError:
                    continue
                card = _card_from_name(path, name, size, printable=printable)
                if card:
                    matches.append(card)
    return _search_page(matches, needle=needle, offset=offset, limit=limit, indexing=True)


def _refresh_index() -> None:
    global _index_cache, _index_building
    roots = load_roots()
    path = _index_path()
    if path.is_file():
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            same_roots = data.get("roots") == roots and isinstance(data.get("items"), list)
            fresh = same_roots and time.time() - float(data.get("built") or 0) < 6 * 3600
            if same_roots:
                with _index_lock:
                    _index_cache = data
                if fresh:
                    with _index_lock:
                        _index_building = False
                    return
        except Exception:
            pass
    items = []
    for root in roots:
        for card in _iter_dir_cards(Path(root), True, False):
            items.append([card["name"], card["path"], card["kind"], card["size"], card["entry"]])
    data = {"roots": roots, "built": time.time(), "items": items}
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(data), encoding="utf-8")
    except OSError:
        pass
    with _index_lock:
        _index_cache = data
        _index_building = False


def _start_index() -> None:
    global _index_building
    with _index_lock:
        if _index_building or _index_cache is not None:
            return
        _index_building = True
    threading.Thread(target=_refresh_index, name="meshfinder-index", daemon=True).start()


def search_library(needle: str, *, printable: bool, offset: int, limit: int) -> dict:
    needle = needle.strip().casefold()
    if len(needle) < 2:
        return _search_page([], needle=needle, offset=0, limit=limit, indexing=False)
    with _index_lock:
        index = _index_cache
    roots = load_roots()
    if index and index.get("roots") == roots and isinstance(index.get("items"), list):
        allowed = PRINTABLE_KINDS if printable else LIBRARY_KINDS
        matches = []
        for row in index["items"]:
            if row[2] not in allowed or not _row_hit(needle, row):
                continue
            matches.append({
                "name": row[0],
                "path": row[1],
                "kind": row[2],
                "size": row[3],
                "entry": row[4],
            })
        return _search_page(matches, needle=needle, offset=offset, limit=limit, indexing=False)
    _start_index()
    return _search_loose(needle, printable=printable, offset=offset, limit=limit)


DUP_SHOW = 500
_dup_lock = threading.Lock()
_dup_state: dict = {
    "running": False,
    "phase": "idle",
    "scanned": 0,
    "candidates": 0,
    "hashed": 0,
    "groups": [],
    "groupCount": 0,
    "reclaimable": 0,
    "capped": False,
    "cancel": False,
    "error": "",
    "warnings": [],
    "complete": False,
    "built": 0,
}


def _dup_file() -> Path:
    return config_path().parent / "duplicates.json"


def _dup_snapshot() -> dict:
    with _dup_lock:
        groups = list(_dup_state["groups"])
        return {
            "running": bool(_dup_state["running"]),
            "phase": _dup_state["phase"],
            "scanned": int(_dup_state["scanned"]),
            "candidates": int(_dup_state["candidates"]),
            "hashed": int(_dup_state["hashed"]),
            "groups": groups[:DUP_SHOW],
            "groupCount": int(_dup_state["groupCount"]),
            "reclaimable": int(_dup_state["reclaimable"]),
            "capped": bool(_dup_state["capped"]),
            "error": _dup_state["error"],
            "warnings": list(_dup_state.get("warnings") or []),
            "complete": bool(_dup_state.get("complete")),
            "built": _dup_state["built"],
        }


def _dup_set(**kwargs) -> None:
    with _dup_lock:
        _dup_state.update(kwargs)


def _load_saved_duplicates() -> None:
    with _dup_lock:
        if _dup_state["running"] or _dup_state["groups"] or _dup_state["built"]:
            return
    path = _dup_file()
    if not path.is_file():
        return
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return
    if not isinstance(data, dict):
        return
    groups = data.get("groups") if isinstance(data.get("groups"), list) else []
    complete = bool(data.get("complete"))
    if complete or data.get("built"):
        phase = "done"
    elif groups:
        phase = "partial"
    else:
        phase = "idle"
    warnings = data.get("warnings") if isinstance(data.get("warnings"), list) else []
    _dup_set(
        phase=phase,
        groups=groups,
        groupCount=int(data.get("groupCount") or len(groups)),
        reclaimable=int(data.get("reclaimable") or 0),
        capped=len(groups) > DUP_SHOW,
        scanned=int(data.get("scanned") or 0),
        candidates=int(data.get("candidates") or 0),
        hashed=int(data.get("hashed") or 0),
        built=data.get("built") or 0,
        warnings=warnings,
        complete=complete or bool(data.get("built")),
        error="",
    )


def _save_duplicates() -> None:
    snap = _dup_snapshot()
    snap["groups"] = []
    with _dup_lock:
        snap["groups"] = list(_dup_state["groups"])
    try:
        path = _dup_file()
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(snap), encoding="utf-8")
    except OSError:
        pass


class _DupStop(Exception):
    pass


def _dup_check() -> None:
    with _dup_lock:
        if _dup_state.get("cancel"):
            raise _DupStop()


def _sha256_stream(stream, limit: int | None = None) -> str:
    digest = hashlib.sha256()
    left = limit
    while True:
        if left is not None and left <= 0:
            break
        chunk = stream.read(1024 * 1024 if left is None else min(1024 * 1024, left))
        if not chunk:
            break
        digest.update(chunk)
        if left is not None:
            left -= len(chunk)
    return digest.hexdigest()


def _hash_loose(path: str, limit: int | None) -> str:
    with open(path, "rb") as handle:
        return _sha256_stream(handle, limit)


def _hash_bucket(items: list[dict], limit: int | None) -> list[tuple[str, dict]]:
    hashed: list[tuple[str, dict]] = []
    loose = [item for item in items if not item.get("entry")]
    zipped: dict[str, list[dict]] = {}
    for item in items:
        if item.get("entry"):
            zipped.setdefault(item["path"], []).append(item)
    for item in loose:
        try:
            digest = _hash_loose(item["path"], limit)
        except OSError:
            continue
        hashed.append((digest, item))
        _dup_check()
        with _dup_lock:
            _dup_state["hashed"] = int(_dup_state["hashed"]) + 1
    for zip_path, members in zipped.items():
        try:
            archive = zipfile.ZipFile(zip_path)
        except (OSError, zipfile.BadZipFile):
            continue
        try:
            for item in members:
                try:
                    with archive.open(item["entry"], "r") as handle:
                        digest = _sha256_stream(handle, limit)
                except (OSError, KeyError, RuntimeError, zipfile.BadZipFile):
                    continue
                hashed.append((digest, item))
                _dup_check()
                with _dup_lock:
                    _dup_state["hashed"] = int(_dup_state["hashed"]) + 1
        finally:
            archive.close()
    return hashed


def _group_by_hash(pairs: list[tuple[str, dict]]) -> dict[str, list[dict]]:
    buckets: dict[str, list[dict]] = {}
    for digest, item in pairs:
        buckets.setdefault(digest, []).append(item)
    return {digest: copies for digest, copies in buckets.items() if len(copies) > 1}


def _dup_groups_from(found: list[list[dict]]) -> list[dict]:
    groups = []
    for copies in found:
        size = int(copies[0].get("size") or 0)
        waste = size * (len(copies) - 1)
        groups.append({
            "hash": hashlib.sha256("|".join(
                f"{item.get('path')}|{item.get('entry')}" for item in copies
            ).encode("utf-8", "replace")).hexdigest()[:16],
            "size": size,
            "count": len(copies),
            "reclaimable": waste,
            "copies": copies,
        })
    groups.sort(key=lambda item: (-item["reclaimable"], item["copies"][0]["name"].casefold()))
    return groups


def _dup_store(groups: list[dict], *, running: bool, phase: str, scanned: int, candidates: int, hashed: int, complete: bool, warnings: list[str], error: str = "") -> None:
    reclaimable = sum(int(item["reclaimable"]) for item in groups)
    _dup_set(
        running=running,
        phase=phase,
        groups=groups,
        groupCount=len(groups),
        reclaimable=reclaimable,
        capped=len(groups) > DUP_SHOW,
        scanned=scanned,
        candidates=candidates,
        hashed=hashed,
        complete=complete,
        warnings=warnings,
        built=time.time() if complete else 0,
        error=error,
    )
    if not running:
        _dup_set(cancel=False)
    _save_duplicates()


def _hash_one(card: dict, limit: int | None) -> str | None:
    hashed = _hash_bucket([card], limit)
    if not hashed:
        return None
    return hashed[0][0]


def _run_duplicate_scan() -> None:
    warnings: list[str] = []
    scanned = 0
    candidates = 0
    singles: dict[int, dict] = {}
    buckets: dict[int, list[dict]] = {}
    groups_by_digest: dict[str, list[dict]] = {}
    dirty = False
    last_save = time.monotonic()

    def publish(running: bool, phase: str, complete: bool, error: str = "") -> None:
        nonlocal dirty, last_save
        with _dup_lock:
            hashed_now = int(_dup_state["hashed"])
        _dup_store(
            _dup_groups_from(list(groups_by_digest.values())),
            running=running,
            phase=phase,
            scanned=scanned,
            candidates=candidates,
            hashed=hashed_now,
            complete=complete,
            warnings=warnings,
            error=error,
        )
        dirty = False
        last_save = time.monotonic()

    def maybe_publish() -> None:
        if dirty and time.monotonic() - last_save > 2:
            publish(True, "listing", False)

    def absorb(size: int, card: dict) -> None:
        nonlocal dirty, candidates
        partial_limit = 65536 if size > 65536 else None
        partial = _hash_one(card, partial_limit)
        if partial is None:
            return
        candidates += 1
        if size <= 65536:
            digest = partial
            buckets[size].append({"card": card, "partial": partial, "full": partial})
        else:
            mates = [row for row in buckets[size] if row["partial"] == partial]
            if not mates:
                buckets[size].append({"card": card, "partial": partial, "full": None})
                return
            digest = _hash_one(card, None)
            if digest is None:
                return
            for mate in mates:
                if mate["full"] is None:
                    mate["full"] = _hash_one(mate["card"], None)
            buckets[size].append({"card": card, "partial": partial, "full": digest})
        same = [row["card"] for row in buckets[size] if row["full"] == digest]
        if len(same) > 1:
            groups_by_digest[digest] = same
            dirty = True
            maybe_publish()

    try:
        _dup_set(phase="listing", scanned=0, candidates=0, hashed=0, error="", warnings=[], complete=False, groups=[], groupCount=0, reclaimable=0)
        for root in load_roots():
            folder = Path(root)
            if not folder.exists():
                warnings.append(f"{folder} is not reachable")
                continue
            if _is_excluded(folder):
                continue
            for card in _iter_dir_cards(folder, True, True, True):
                size = int(card.get("size") or 0)
                if size <= 0:
                    continue
                scanned += 1
                if size in singles:
                    first = singles.pop(size)
                    buckets[size] = []
                    absorb(size, first)
                    absorb(size, card)
                elif size in buckets:
                    absorb(size, card)
                else:
                    singles[size] = card
                if scanned % 250 == 0:
                    _dup_check()
                    _dup_set(scanned=scanned, candidates=candidates, warnings=warnings)
                    maybe_publish()
        _dup_check()
        publish(False, "done", True)
    except _DupStop:
        publish(False, "partial", False)
    except Exception as exc:
        publish(False, "done", False, str(exc))


def start_duplicate_scan() -> bool:
    _load_saved_duplicates()
    with _dup_lock:
        if _dup_state["running"]:
            return False
        _dup_state["running"] = True
        _dup_state["phase"] = "listing"
        _dup_state["error"] = ""
        _dup_state["groups"] = []
        _dup_state["groupCount"] = 0
        _dup_state["reclaimable"] = 0
        _dup_state["capped"] = False
        _dup_state["cancel"] = False
    threading.Thread(target=_run_duplicate_scan, name="meshfinder-duplicates", daemon=True).start()
    return True


def stop_duplicate_scan() -> dict:
    with _dup_lock:
        if _dup_state["running"]:
            _dup_state["cancel"] = True
    return duplicates_status()


def duplicates_status() -> dict:
    _load_saved_duplicates()
    return _dup_snapshot()


def _copy_identity(path: str, entry: str) -> tuple[str, str]:
    return (str(path).casefold(), str(entry or "").replace("\\", "/"))


def delete_duplicate_copies(body: dict) -> dict:
    group_hash = str(body.get("hash") or "")
    requested = body.get("remove") if isinstance(body.get("remove"), list) else []
    with _dup_lock:
        groups = _dup_state["groups"]
        group = next((item for item in groups if item.get("hash") == group_hash), None)
    if group is None:
        return {"ok": False, "error": "That duplicate group is gone. Analyze again."}
    identities = {
        _copy_identity(item.get("path") or "", item.get("entry") or ""): item
        for item in group.get("copies") or []
    }
    targets = []
    for raw in requested:
        if not isinstance(raw, dict):
            continue
        entry = str(raw.get("entry") or "")
        if entry:
            return {"ok": False, "error": "A copy inside a zip stays put. MeshFinder will not rewrite the archive."}
        identity = _copy_identity(str(raw.get("path") or ""), "")
        item = identities.get(identity)
        if item is None:
            continue
        targets.append(item)
    if not targets:
        return {"ok": False, "error": "Nothing loose to delete in that group."}
    if len(targets) >= len(identities):
        return {"ok": False, "error": "One copy has to stay."}
    deleted = []
    errors = []
    for item in targets:
        try:
            target = Path(str(item["path"])).resolve()
        except Exception:
            errors.append(item["path"])
            continue
        if not target.is_file() or not _under_root(target, load_roots()):
            errors.append(str(item["path"]))
            continue
        try:
            target.unlink()
        except OSError as exc:
            errors.append(f"{item['path']}: {exc}")
            continue
        deleted.append(_copy_identity(item["path"], ""))
    if deleted:
        gone = set(deleted)
        with _dup_lock:
            kept = []
            reclaimable = 0
            for item in _dup_state["groups"]:
                copies = [
                    copy for copy in item.get("copies") or []
                    if _copy_identity(copy.get("path") or "", copy.get("entry") or "") not in gone
                ]
                if len(copies) < 2:
                    continue
                size = int(copies[0].get("size") or 0)
                waste = size * (len(copies) - 1)
                reclaimable += waste
                item = dict(item)
                item["copies"] = copies
                item["count"] = len(copies)
                item["reclaimable"] = waste
                item["size"] = size
                kept.append(item)
            _dup_state["groups"] = kept
            _dup_state["groupCount"] = len(kept)
            _dup_state["reclaimable"] = reclaimable
            _dup_state["capped"] = len(kept) > DUP_SHOW
        _save_duplicates()
    status = duplicates_status()
    status["ok"] = bool(deleted) and not errors
    status["deleted"] = len(deleted)
    if errors and not deleted:
        status["ok"] = False
        status["error"] = errors[0]
    elif errors:
        status["ok"] = True
        status["error"] = f"Deleted {len(deleted)}. {len(errors)} could not be removed."
    return status


def gallery_page(folder: Path, *, recursive: bool, offset: int, limit: int, printable: bool = True) -> dict:
    items = []
    skipped = 0
    truncated = False
    source = _iter_zip_cards(folder, printable) if folder.is_file() and folder.suffix.lower() == ".zip" else _iter_dir_cards(folder, recursive, printable)
    for card in source:
        if skipped < offset:
            skipped += 1
            continue
        if len(items) >= limit:
            truncated = True
            break
        items.append(card)
    return {"items": items, "offset": offset, "limit": limit, "truncated": truncated}


def list_zip(zip_path: Path, prefix: str) -> dict:
    prefix = prefix.replace("\\", "/").lstrip("/")
    if prefix and not prefix.endswith("/"):
        prefix += "/"
    folders: dict[str, dict] = {}
    files = []
    try:
        with zipfile.ZipFile(zip_path) as zf:
            for info in zf.infolist():
                name = info.filename.replace("\\", "/")
                if not name or name.endswith("/") or _skip_name(name):
                    continue
                if prefix and not name.startswith(prefix):
                    continue
                rest = name[len(prefix):]
                if not rest:
                    continue
                head, sep, tail = rest.partition("/")
                if sep:
                    folders.setdefault(head, {
                        "name": head,
                        "path": str(zip_path),
                        "kind": "zipdir",
                        "prefix": f"{prefix}{head}",
                    })
                    continue
                files.append({
                    "name": head,
                    "path": str(zip_path),
                    "kind": _kind_for(head),
                    "size": int(info.file_size or 0),
                    "entry": name,
                })
    except (OSError, zipfile.BadZipFile) as exc:
        return {"error": str(exc), "folders": [], "files": []}
    folder_rows = sorted(folders.values(), key=lambda item: item["name"].lower())
    files.sort(key=lambda item: item["name"].lower())
    return {"folders": folder_rows, "files": files}


MAX_PREVIEW_TRIS = 8000
_preview_lock = threading.Lock()


def _preview_cache(path: Path, entry: str) -> Path:
    folder = config_path().parent / "previews"
    folder.mkdir(parents=True, exist_ok=True)
    st = path.stat()
    raw = f"{path.resolve()}|{entry}|{st.st_mtime_ns}|{st.st_size}|solid2"
    name = hashlib.sha1(raw.encode("utf-8", "replace")).hexdigest()
    return folder / f"{name}.bin"


def _pack_tris(verts: array.array) -> bytes:
    count = len(verts) // 9
    return struct.pack("<I", count) + verts.tobytes()


def _stl_triangle_count(head: bytes, size: int) -> int | None:
    """How many complete binary triangles this buffer actually holds.

    The header count is trusted when those records fit, even if the file has
    extra bytes after them. A file shorter than the header still returns the
    records that are present, so a cut-off STL can be previewed.
    """
    if len(head) < 84 or size < 84:
        return None
    count = struct.unpack_from("<I", head, 80)[0]
    if count <= 0:
        return None
    expect = 84 + count * 50
    looks_ascii = head[:5].lower() == b"solid"
    if expect <= size:
        if looks_ascii and size != expect and size - expect >= 1024:
            return None
        return count
    if looks_ascii:
        return None
    room = (size - 84) // 50
    return room if room > 0 else None


def _sample_binary_seek(handle, count: int, origin: int = 84) -> bytes:
    step = max(1, count // MAX_PREVIEW_TRIS)
    out = array.array("f")
    for index in range(0, count, step):
        handle.seek(origin + index * 50 + 12)
        chunk = handle.read(36)
        if len(chunk) < 36:
            break
        out.frombytes(chunk)
        if len(out) // 9 >= MAX_PREVIEW_TRIS:
            break
    return _pack_tris(out)


def _sample_binary_seq(handle, count: int) -> bytes:
    step = max(1, count // MAX_PREVIEW_TRIS)
    out = array.array("f")
    for index in range(count):
        rec = handle.read(50)
        if len(rec) < 50:
            break
        if index % step == 0:
            out.frombytes(rec[12:48])
            if len(out) // 9 >= MAX_PREVIEW_TRIS:
                break
    return _pack_tris(out)


def _sample_ascii_stl(data: bytes) -> bytes:
    verts = array.array("f")
    for line in data.splitlines():
        stripped = line.lstrip()
        if stripped[:6].lower() != b"vertex":
            continue
        parts = stripped.split()
        if len(parts) < 4:
            continue
        try:
            verts.extend((float(parts[1]), float(parts[2]), float(parts[3])))
        except ValueError:
            continue
    count = len(verts) // 9
    if count <= MAX_PREVIEW_TRIS:
        return _pack_tris(verts[: count * 9])
    step = max(1, count // MAX_PREVIEW_TRIS)
    sampled = array.array("f")
    for index in range(0, count, step):
        start = index * 9
        sampled.extend(verts[start : start + 9])
        if len(sampled) // 9 >= MAX_PREVIEW_TRIS:
            break
    return _pack_tris(sampled)


def _sample_stl_handle(handle, size: int, *, seek: bool) -> bytes:
    head = handle.read(84)
    count = _stl_triangle_count(head, size)
    if count is not None:
        if seek:
            return _sample_binary_seek(handle, count, 84)
        return _sample_binary_seq(handle, count)
    rest = handle.read()
    return _sample_ascii_stl(head + rest)


def _face_indexes(tokens: list[bytes], nverts: int) -> list[int] | None:
    indexes = []
    for token in tokens:
        head = token.split(b"/", 1)[0]
        if not head:
            return None
        try:
            raw = int(head)
        except ValueError:
            return None
        if raw < 0:
            raw = nverts + raw
        else:
            raw -= 1
        indexes.append(raw)
    return indexes if len(indexes) >= 3 else None


def _sample_obj_handle(handle) -> bytes:
    verts = array.array("f")
    faces: list[tuple[int, int, int]] = []
    seen = 0
    for line in handle:
        if line.startswith((b"v ", b"v\t")):
            parts = line.split()
            if len(parts) < 4:
                continue
            try:
                verts.extend((float(parts[1]), float(parts[2]), float(parts[3])))
            except ValueError:
                continue
            continue
        if not line.startswith((b"f ", b"f\t")):
            continue
        nverts = len(verts) // 3
        indexes = _face_indexes(line.split()[1:], nverts)
        if not indexes:
            continue
        for slot in range(1, len(indexes) - 1):
            tri = (indexes[0], indexes[slot], indexes[slot + 1])
            seen += 1
            if len(faces) < MAX_PREVIEW_TRIS:
                faces.append(tri)
            else:
                pick = random.randrange(seen)
                if pick < MAX_PREVIEW_TRIS:
                    faces[pick] = tri
    nverts = len(verts) // 3
    out = array.array("f")
    for a, b, c in faces:
        if not (0 <= a < nverts and 0 <= b < nverts and 0 <= c < nverts):
            continue
        out.extend(verts[a * 3 : a * 3 + 3])
        out.extend(verts[b * 3 : b * 3 + 3])
        out.extend(verts[c * 3 : c * 3 + 3])
    return _pack_tris(out)


def _load_ascii_stl_tris(data: bytes):
    import numpy as np

    verts = []
    for line in data.splitlines():
        stripped = line.lstrip()
        if stripped[:6].lower() != b"vertex":
            continue
        parts = stripped.split()
        if len(parts) < 4:
            continue
        try:
            verts.append((float(parts[1]), float(parts[2]), float(parts[3])))
        except ValueError:
            continue
    count = len(verts) // 3
    if count <= 0:
        raise ValueError("not a binary stl")
    return np.asarray(verts[: count * 3], np.float32).reshape(count, 3, 3)


def _load_stl_tris(data: bytes):
    import numpy as np

    count = _stl_triangle_count(data[:84], len(data))
    if count is None:
        return _load_ascii_stl_tris(data)
    recs = np.frombuffer(data, dtype=np.uint8, offset=84, count=count * 50).reshape(count, 50)
    verts = np.empty((count, 3, 3), np.float32)
    for corner in range(3):
        chunk = np.ascontiguousarray(recs[:, 12 + corner * 12 : 24 + corner * 12])
        verts[:, corner] = chunk.view(np.float32).reshape(count, 3)
    return verts


def _load_obj_tris(data: bytes):
    import numpy as np

    verts = []
    faces = []
    for line in data.splitlines():
        if line.startswith((b"v ", b"v\t")):
            parts = line.split()
            if len(parts) < 4:
                continue
            try:
                verts.append((float(parts[1]), float(parts[2]), float(parts[3])))
            except ValueError:
                continue
            continue
        if not line.startswith((b"f ", b"f\t")):
            continue
        indexes = []
        total = len(verts)
        for token in line.split()[1:]:
            head = token.split(b"/", 1)[0]
            if not head:
                indexes = []
                break
            try:
                raw = int(head)
            except ValueError:
                indexes = []
                break
            indexes.append(total + raw if raw < 0 else raw - 1)
        if len(indexes) < 3:
            continue
        for slot in range(1, len(indexes) - 1):
            faces.append((indexes[0], indexes[slot], indexes[slot + 1]))
    if not verts or not faces:
        raise ValueError("empty mesh")
    points = np.asarray(verts, np.float32)
    tris = np.asarray(faces, np.int32)
    ok = (tris >= 0).all(axis=1) & (tris < len(points)).all(axis=1)
    return points[tris[ok]]


def _cluster_tris(tris, grid: int = 120):
    import numpy as np

    mins = tris.min(axis=(0, 1))
    span = np.maximum(tris.max(axis=(0, 1)) - mins, 1e-8)
    quantized = np.floor((tris - mins) / span * (grid - 1)).astype(np.int32)
    quantized = np.clip(quantized, 0, grid - 1)
    keys = (quantized[..., 0] + (quantized[..., 1] + quantized[..., 2] * grid) * grid).reshape(-1)
    positions = tris.reshape(-1, 3).astype(np.float64)
    _uniq, inverse = np.unique(keys, return_inverse=True)
    totals = np.zeros((int(inverse.max()) + 1, 3), np.float64)
    weight = np.zeros(totals.shape[0], np.float64)
    np.add.at(totals, inverse, positions)
    np.add.at(weight, inverse, 1.0)
    centers = totals / weight[:, None]
    faces = inverse.reshape(-1, 3)
    keep = (faces[:, 0] != faces[:, 1]) & (faces[:, 1] != faces[:, 2]) & (faces[:, 0] != faces[:, 2])
    return centers[faces[keep]]


def _shade_png(tris, up: str) -> bytes:
    import io
    import math

    import numpy as np
    from PIL import Image, ImageDraw

    if len(tris) == 0:
        raise ValueError("empty mesh")
    if up == "z":
        x = tris[..., 0].copy()
        y = tris[..., 1].copy()
        z = tris[..., 2].copy()
        tris = np.stack([x, z, -y], axis=-1)
    tris = tris.astype(np.float64)
    center = tris.mean(axis=1)
    tris = tris - np.array([
        (center[:, 0].min() + center[:, 0].max()) * 0.5,
        center[:, 1].min(),
        (center[:, 2].min() + center[:, 2].max()) * 0.5,
    ])
    yaw, pitch = math.radians(42), math.radians(26)
    cos_yaw, sin_yaw = math.cos(yaw), math.sin(yaw)
    cos_pitch, sin_pitch = math.cos(pitch), math.sin(pitch)
    x = tris[..., 0] * cos_yaw + tris[..., 2] * sin_yaw
    z = -tris[..., 0] * sin_yaw + tris[..., 2] * cos_yaw
    y2 = tris[..., 1] * cos_pitch - z * sin_pitch
    z2 = tris[..., 1] * sin_pitch + z * cos_pitch
    width, height = 640, 480
    span_x = max(float(np.ptp(x)), 1e-6)
    span_y = max(float(np.ptp(y2)), 1e-6)
    scale = min(width * 0.88 / span_x, height * 0.88 / span_y)
    sx = width * 0.5 + (x - float((x.min() + x.max()) * 0.5)) * scale
    sy = height * 0.5 - (y2 - float((y2.min() + y2.max()) * 0.5)) * scale
    normal = np.cross(
        np.stack([x[:, 1] - x[:, 0], y2[:, 1] - y2[:, 0], z2[:, 1] - z2[:, 0]], axis=1),
        np.stack([x[:, 2] - x[:, 0], y2[:, 2] - y2[:, 0], z2[:, 2] - z2[:, 0]], axis=1),
    )
    length = np.linalg.norm(normal, axis=1)
    length[length < 1e-8] = 1.0
    normal /= length[:, None]
    light = np.array([0.25, 0.85, 0.45])
    light /= np.linalg.norm(light)
    shade = 0.28 + 0.72 * np.abs(normal @ light)
    order = np.argsort(z2.mean(axis=1))
    image = Image.new("RGB", (width, height), (26, 32, 40))
    draw = ImageDraw.Draw(image)
    base = np.array([232, 236, 242])
    for index in order:
        tone = float(shade[index])
        color = tuple(int(channel * tone) for channel in base)
        draw.polygon(
            [
                (float(sx[index, 0]), float(sy[index, 0])),
                (float(sx[index, 1]), float(sy[index, 1])),
                (float(sx[index, 2]), float(sy[index, 2])),
            ],
            fill=color,
        )
    image = image.resize((480, 360), Image.Resampling.LANCZOS)
    buf = io.BytesIO()
    image.save(buf, format="PNG")
    return buf.getvalue()


def _xf_matrix(text: str):
    import numpy as np

    eye = np.eye(4)
    parts = (text or "").split()
    if len(parts) != 12:
        return eye
    try:
        n = [float(part) for part in parts]
    except ValueError:
        return eye
    eye = np.eye(4)
    eye[0, :3] = n[0:3]
    eye[1, :3] = n[3:6]
    eye[2, :3] = n[6:9]
    eye[0, 3], eye[1, 3], eye[2, 3] = n[9], n[10], n[11]
    return eye


def _xml_local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1].lower()


def _load_3mf_tris(data: bytes):
    """Triangles from a 3MF package, in the build layout, Z-up millimetres."""
    import io

    import numpy as np
    from xml.etree import ElementTree as ET

    archive = zipfile.ZipFile(io.BytesIO(data))
    names = {item.replace("\\", "/").lstrip("/"): item for item in archive.namelist()}
    parsed: dict = {}

    def parse_model(zip_name: str):
        if zip_name in parsed:
            return parsed[zip_name]
        root = ET.fromstring(archive.read(zip_name))
        objects: dict = {}
        for node in root.iter():
            if _xml_local(node.tag) != "object":
                continue
            oid = node.attrib.get("id")
            if not oid:
                continue
            verts: list[tuple[float, float, float]] = []
            faces: list[tuple[int, int, int]] = []
            comps: list[dict] = []
            for child in list(node):
                tag = _xml_local(child.tag)
                if tag == "mesh":
                    for part in list(child):
                        part_tag = _xml_local(part.tag)
                        if part_tag == "vertices":
                            for vert in list(part):
                                if _xml_local(vert.tag) != "vertex":
                                    continue
                                try:
                                    verts.append((
                                        float(vert.attrib.get("x", 0)),
                                        float(vert.attrib.get("y", 0)),
                                        float(vert.attrib.get("z", 0)),
                                    ))
                                except ValueError:
                                    continue
                        elif part_tag == "triangles":
                            for tri in list(part):
                                if _xml_local(tri.tag) != "triangle":
                                    continue
                                try:
                                    faces.append((
                                        int(tri.attrib.get("v1", -1)),
                                        int(tri.attrib.get("v2", -1)),
                                        int(tri.attrib.get("v3", -1)),
                                    ))
                                except ValueError:
                                    continue
                elif tag == "components":
                    for comp in list(child):
                        if _xml_local(comp.tag) == "component":
                            comps.append(comp.attrib)
            objects[oid] = (verts, faces, comps)
        parsed[zip_name] = root
        parsed[zip_name + "\0objects"] = objects
        return root, objects

    def objects_of(zip_name: str):
        parse_model(zip_name)
        return parsed[zip_name + "\0objects"]

    def resolve_name(path: str, fallback: str) -> str:
        key = (path or "").replace("\\", "/").lstrip("/")
        return names.get(key, fallback)

    def component_fields(attrib: dict) -> tuple[str, str, str]:
        path = ""
        oid = ""
        transform = ""
        for key, value in attrib.items():
            local = _xml_local(key)
            if local == "path":
                path = value
            elif local == "objectid":
                oid = value
            elif local == "transform":
                transform = value
        return path, oid, transform

    chunks = []

    def collect(zip_name: str, oid: str, transform, stack: set):
        key = (zip_name, oid)
        if key in stack:
            return
        stack.add(key)
        try:
            verts, faces, comps = objects_of(zip_name).get(oid, ([], [], []))
            if verts and faces:
                points = np.asarray(verts, np.float64)
                index = np.asarray(faces, np.int32)
                ok = (index >= 0).all(axis=1) & (index < len(points)).all(axis=1)
                index = index[ok]
                if len(index):
                    xyz = np.c_[points, np.ones(len(points))]
                    world = (transform @ xyz.T).T[:, :3]
                    chunks.append(world[index].astype(np.float32))
            for attrib in comps:
                path, child_id, raw = component_fields(attrib)
                if not child_id:
                    continue
                child_name = resolve_name(path, zip_name)
                collect(child_name, child_id, transform @ _xf_matrix(raw), stack)
        finally:
            stack.discard(key)

    root_name = names.get("3D/3dmodel.model") or names.get("3d/3dmodel.model")
    if root_name is None:
        models = [real for key, real in names.items() if key.lower().endswith(".model")]
        root_name = models[0] if models else ""
    if not root_name:
        raise ValueError("No mesh in this 3MF")
    root, _objects = parse_model(root_name)
    for node in root.iter():
        if _xml_local(node.tag) != "item":
            continue
        oid = node.attrib.get("objectid")
        if oid:
            collect(root_name, oid, _xf_matrix(node.attrib.get("transform", "")), set())
    if not chunks:
        for key, real in names.items():
            if not key.lower().endswith(".model"):
                continue
            for oid in objects_of(real):
                collect(real, oid, np.eye(4), set())
    if not chunks:
        raise ValueError("No mesh in this 3MF")
    return np.concatenate(chunks, axis=0)


def _cap_tris(tris, limit: int = 180000):
    import numpy as np

    count = len(tris)
    if count <= limit:
        return tris
    step = int(np.ceil(count / limit))
    return tris[::step]


def _pack_mesh(tris) -> bytes:
    import numpy as np

    flat = np.ascontiguousarray(tris.reshape(-1), dtype=np.float32)
    return struct.pack("<I", len(tris)) + flat.tobytes()


def _view_mesh(tris):
    # Stride-sampling a round model leaves a cloud of specks. Clustering keeps a solid surface.
    return _cluster_tris(tris, 200)


def mesh_preview(path: Path, entry: str = "") -> bytes:
    cache = _preview_cache(path, entry).with_suffix(".m2")
    if cache.is_file() and cache.stat().st_size > 16:
        return cache.read_bytes()
    with _preview_lock:
        if cache.is_file() and cache.stat().st_size > 16:
            return cache.read_bytes()
        data = _mesh_bytes(path, entry)
        packed = _pack_mesh(_view_mesh(_load_3mf_tris(data)))
        tmp = cache.with_suffix(".tmp")
        tmp.write_bytes(packed)
        tmp.replace(cache)
        return packed


def _mesh_bytes(path: Path, entry: str) -> bytes:
    if not entry:
        return path.read_bytes()
    entry = entry.replace("\\", "/").lstrip("/")
    with zipfile.ZipFile(path) as zf:
        return zf.read(entry)


def _png_bytes(image) -> bytes:
    import io

    buf = io.BytesIO()
    image.save(buf, format="PNG")
    return buf.getvalue()


def _doc_label(name: str) -> str:
    suffix = Path(name).suffix.lower().lstrip(".")
    return (suffix or "doc").upper()[:8]


def _text_sheet_png(data: bytes, name: str) -> bytes:
    from PIL import Image, ImageDraw, ImageFont

    width, height = 480, 360
    image = Image.new("RGB", (width, height), (17, 17, 24))
    draw = ImageDraw.Draw(image)
    left, top, right, bottom = 108, 24, 372, 336
    draw.rounded_rectangle((left, top, right, bottom), radius=8, fill=(244, 241, 234))
    fold = 26
    draw.polygon(
        [(right - fold, top), (right, top + fold), (right - fold, top + fold)],
        fill=(214, 208, 196),
    )
    font = ImageFont.load_default()
    lines = []
    for raw in data[:6000].decode("utf-8", "replace").splitlines():
        line = " ".join(raw.split())
        if not line:
            continue
        lines.append(line[:42])
        if len(lines) >= 8:
            break
    y = top + 46
    for line in lines:
        draw.text((left + 18, y), line, fill=(55, 65, 80), font=font)
        y += 16
    label = _doc_label(name)
    draw.rounded_rectangle((left + 18, bottom - 44, left + 28 + 8 * len(label), bottom - 18), radius=4, fill=(59, 130, 246))
    draw.text((left + 26, bottom - 38), label, fill=(255, 255, 255), font=font)
    return _png_bytes(image)


def _pdf_preview_png(data: bytes, name: str) -> bytes:
    try:
        import pypdfium2 as pdfium

        pdf = pdfium.PdfDocument(data)
        try:
            if len(pdf) < 1:
                raise ValueError("empty pdf")
            page = pdf[0]
            page_w, page_h = page.get_size()
            scale = 480 / max(float(page_w), float(page_h), 1.0)
            scale = min(max(scale, 0.4), 2.5)
            image = page.render(scale=scale).to_pil().convert("RGB")
        finally:
            pdf.close()
        return _png_bytes(image)
    except Exception:
        return _text_sheet_png(b"", name)


def _doc_preview_png(data: bytes, name: str) -> bytes:
    if name.lower().endswith(".pdf"):
        return _pdf_preview_png(data, name)
    return _text_sheet_png(data, name)


def preview_png(path: Path, entry: str = "") -> bytes:
    cache = _preview_cache(path, entry).with_suffix(".s5.png")
    if cache.is_file() and cache.stat().st_size > 32:
        return cache.read_bytes()
    with _preview_lock:
        if cache.is_file() and cache.stat().st_size > 32:
            return cache.read_bytes()
        kind = _kind_for(Path(entry).name if entry else path.name)
        data = _mesh_bytes(path, entry)
        if kind == "doc":
            png = _doc_preview_png(data, Path(entry).name if entry else path.name)
        elif kind in {"3mf", "gcode.3mf"}:
            tris = _load_3mf_tris(data)
            mesh_cache = _preview_cache(path, entry).with_suffix(".m2")
            if not mesh_cache.is_file():
                packed = _pack_mesh(_view_mesh(tris))
                tmp_mesh = mesh_cache.with_suffix(".tmp")
                tmp_mesh.write_bytes(packed)
                tmp_mesh.replace(mesh_cache)
            png = _shade_png(_cluster_tris(tris), "z")
        elif kind == "obj":
            tris = _cluster_tris(_load_obj_tris(data))
            png = _shade_png(tris, "y")
        else:
            tris = _cluster_tris(_load_stl_tris(data))
            png = _shade_png(tris, "z")
        tmp = cache.with_suffix(".tmp")
        tmp.write_bytes(png)
        tmp.replace(cache)
        return png


def build_preview(path: Path, entry: str = "") -> bytes:
    cache = _preview_cache(path, entry)
    if cache.is_file() and cache.stat().st_size >= 4:
        return cache.read_bytes()
    with _preview_lock:
        if cache.is_file() and cache.stat().st_size >= 4:
            return cache.read_bytes()
        kind = _kind_for(Path(entry).name if entry else path.name)
        if entry:
            if path.suffix.lower() != ".zip":
                raise ValueError("Entry only works on a zip")
            entry = entry.replace("\\", "/").lstrip("/")
            with zipfile.ZipFile(path) as zf:
                info = zf.getinfo(entry)
                with zf.open(info, "r") as handle:
                    if kind == "obj":
                        data = _sample_obj_handle(handle)
                    else:
                        data = _sample_stl_handle(handle, int(info.file_size or 0), seek=False)
        elif kind == "obj":
            with path.open("rb") as handle:
                data = _sample_obj_handle(handle)
        else:
            with path.open("rb") as handle:
                data = _sample_stl_handle(handle, path.stat().st_size, seek=True)
        tmp = cache.with_suffix(".tmp")
        tmp.write_bytes(data)
        tmp.replace(cache)
        return data


def read_zip_entry(zip_path: Path, entry: str) -> bytes:
    entry = entry.replace("\\", "/").lstrip("/")
    if not entry or ".." in entry.split("/"):
        raise ValueError("Bad entry")
    with zipfile.ZipFile(zip_path) as zf:
        try:
            zf.getinfo(entry)
        except KeyError as exc:
            raise FileNotFoundError(entry) from exc
        return zf.read(entry)


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt: str, *args) -> None:
        return

    def _send(self, code: int, body: bytes, content_type: str, extra: dict | None = None) -> None:
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        for key, value in (extra or {}).items():
            self.send_header(key, value)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _json(self, code: int, payload: dict) -> None:
        body = json.dumps(payload).encode("utf-8")
        self._send(code, body, "application/json; charset=utf-8")

    def _read_json(self) -> dict:
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0:
            return {}
        raw = self.rfile.read(length)
        try:
            data = json.loads(raw.decode("utf-8"))
        except Exception:
            return {}
        return data if isinstance(data, dict) else {}

    def _allowed(self, path: Path) -> bool:
        return _under_root(path, load_roots())

    def do_GET(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        path = unquote(parsed.path)
        query = parse_qs(parsed.query)
        if path in ("/", "/index.html"):
            self._file(STATIC / "index.html", "text/html; charset=utf-8")
            return
        if path.startswith("/static/"):
            rel = path[len("/static/"):]
            target = (STATIC / rel).resolve()
            if STATIC.resolve() not in target.parents and target != STATIC.resolve():
                self._json(404, {"error": "Not found"})
                return
            ctype = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
            if target.suffix == ".js":
                ctype = "text/javascript; charset=utf-8"
            if target.suffix == ".css":
                ctype = "text/css; charset=utf-8"
            self._file(target, ctype)
            return
        if path == "/api/roots":
            self._json(200, {"roots": load_roots()})
            return
        if path == "/api/list":
            self._list(query)
            return
        if path == "/api/gallery":
            self._gallery(query)
            return
        if path == "/api/search":
            self._search(query)
            return
        if path == "/api/file":
            self._file_bytes(query)
            return
        if path == "/api/preview":
            self._preview(query)
            return
        if path == "/api/mesh":
            self._mesh(query)
            return
        if path == "/api/favourites":
            self._json(200, {"items": load_favourites()})
            return
        if path == "/api/collections":
            self._json(200, {"items": load_collections()})
            return
        if path == "/api/session":
            self._json(200, load_session())
            return
        if path == "/api/duplicates":
            self._json(200, duplicates_status())
            return
        self._json(404, {"error": "Not found"})

    def do_POST(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        if parsed.path == "/api/roots":
            body = self._read_json()
            raw = str(body.get("path") or "").strip().strip('"')
            if not raw:
                self._json(400, {"error": "Pick a folder"})
                return
            folder = Path(raw).expanduser()
            if not folder.is_dir():
                self._json(400, {"error": "That folder is not on this PC"})
                return
            resolved = str(folder.resolve())
            roots = load_roots()
            if resolved not in roots:
                roots.append(resolved)
                save_roots(roots)
            self._json(200, {"roots": roots, "added": resolved})
            return
        if parsed.path == "/api/open":
            self._open_external()
            return
        if parsed.path == "/api/reveal":
            self._reveal()
            return
        if parsed.path == "/api/painter":
            self._send_painter()
            return
        if parsed.path == "/api/favourites":
            self._add_favourite()
            return
        if parsed.path == "/api/exclude":
            self._exclude_folder()
            return
        if parsed.path == "/api/rename":
            self._rename_folder()
            return
        if parsed.path == "/api/collections":
            self._add_collection()
            return
        if parsed.path == "/api/session":
            self._json(200, save_session(self._read_json()))
            return
        if parsed.path == "/api/collections/items":
            self._add_collection_items()
            return
        if parsed.path == "/api/collections/rename":
            self._rename_collection()
            return
        if parsed.path == "/api/duplicates/analyze":
            self._read_json()
            start_duplicate_scan()
            self._json(200, duplicates_status())
            return
        if parsed.path == "/api/duplicates/stop":
            self._read_json()
            self._json(200, stop_duplicate_scan())
            return
        if parsed.path == "/api/duplicates/delete":
            result = delete_duplicate_copies(self._read_json())
            self._json(200 if result.get("ok") else 400, result)
            return
        self._json(404, {"error": "Not found"})

    def do_DELETE(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        query = parse_qs(parsed.query)
        if parsed.path == "/api/favourites":
            self._remove_favourite(query)
            return
        if parsed.path == "/api/collections":
            self._delete_collection(query)
            return
        if parsed.path != "/api/roots":
            self._json(404, {"error": "Not found"})
            return
        raw = (query.get("path") or [""])[0]
        try:
            target = str(Path(raw).resolve())
        except Exception:
            target = raw
        roots = [item for item in load_roots() if item != target]
        save_roots(roots)
        self._json(200, {"roots": roots})

    def _favourite_from_body(self, body: dict) -> dict | None:
        raw = str(body.get("path") or "")
        entry = str(body.get("entry") or "")
        try:
            target = Path(raw).resolve()
        except Exception:
            return None
        if not target.is_file() or not self._allowed(target):
            return None
        try:
            size = int(body.get("size") or 0)
        except (TypeError, ValueError):
            size = 0
        return {
            "path": str(target),
            "entry": entry,
            "name": str(body.get("name") or target.name),
            "kind": str(body.get("kind") or "file"),
            "size": size,
        }

    def _add_favourite(self) -> None:
        item = self._favourite_from_body(self._read_json())
        if not item:
            self._json(400, {"error": "That file is not in the library"})
            return
        items = [
            saved for saved in load_favourites()
            if not (saved["path"] == item["path"] and saved["entry"] == item["entry"])
        ]
        items.insert(0, item)
        save_favourites(items)
        self._json(200, {"items": items})

    def _remove_favourite(self, query: dict) -> None:
        raw = (query.get("path") or [""])[0]
        entry = (query.get("entry") or [""])[0]
        try:
            target = str(Path(raw).resolve())
        except Exception:
            target = raw
        items = [
            saved for saved in load_favourites()
            if not (saved["path"] == target and saved["entry"] == entry)
        ]
        save_favourites(items)
        self._json(200, {"items": items})

    def _file(self, target: Path, content_type: str) -> None:
        if not target.is_file():
            self._json(404, {"error": "Not found"})
            return
        data = target.read_bytes()
        self._send(200, data, content_type)

    def _gallery(self, query: dict) -> None:
        raw = (query.get("path") or [""])[0]
        recursive = (query.get("recursive") or ["0"])[0] in {"1", "true", "yes"}
        printable = (query.get("printable") or ["1"])[0] not in {"0", "false", "no"}
        try:
            offset = max(0, int((query.get("offset") or ["0"])[0]))
            limit = int((query.get("limit") or ["120"])[0])
        except ValueError:
            offset, limit = 0, 120
        limit = min(240, max(1, limit))
        if not raw:
            self._json(400, {"error": "Pick a folder"})
            return
        try:
            target = Path(raw).resolve()
        except Exception:
            self._json(400, {"error": "Bad path"})
            return
        if not self._allowed(target) or not (target.is_dir() or target.suffix.lower() == ".zip"):
            self._json(404, {"error": "Folder not found"})
            return
        payload = gallery_page(target, recursive=recursive, offset=offset, limit=limit, printable=printable)
        payload["path"] = str(target)
        self._json(200, payload)

    def _search(self, query: dict) -> None:
        needle = (query.get("q") or [""])[0]
        printable = (query.get("printable") or ["1"])[0] not in {"0", "false", "no"}
        try:
            offset = max(0, int((query.get("offset") or ["0"])[0]))
            limit = int((query.get("limit") or ["120"])[0])
        except ValueError:
            offset, limit = 0, 120
        limit = min(240, max(1, limit))
        self._json(200, search_library(needle, printable=printable, offset=offset, limit=limit))

    def _list(self, query: dict) -> None:
        raw = (query.get("path") or [""])[0]
        prefix = (query.get("prefix") or [""])[0]
        roots = load_roots()
        if not raw:
            self._json(200, {
                "path": "",
                "prefix": "",
                "folders": [
                    {"name": Path(root).name or root, "path": root, "kind": "folder"}
                    for root in roots
                    if not _is_excluded(Path(root))
                ],
                "files": [],
                "roots": roots,
            })
            return
        try:
            target = Path(raw).resolve()
        except Exception:
            self._json(400, {"error": "Bad path"})
            return
        if not self._allowed(target):
            self._json(403, {"error": "Folder is outside the library"})
            return
        if target.is_dir():
            payload = list_folder(target)
        elif target.is_file() and target.suffix.lower() == ".zip":
            payload = list_zip(target, prefix)
        else:
            self._json(400, {"error": "Not a folder"})
            return
        payload["path"] = str(target)
        payload["prefix"] = prefix.replace("\\", "/").strip("/")
        payload["roots"] = roots
        self._json(200, payload)

    def _preview(self, query: dict) -> None:
        raw = (query.get("path") or [""])[0]
        entry = (query.get("entry") or [""])[0]
        try:
            target = Path(raw).resolve()
        except Exception:
            self._json(400, {"error": "Bad path"})
            return
        if not target.is_file() or not self._allowed(target):
            self._json(404, {"error": "File not found"})
            return
        kind = _kind_for(Path(entry).name if entry else target.name)
        if kind not in {"stl", "obj", "3mf", "gcode.3mf", "doc"}:
            self._json(400, {"error": "No preview for this file"})
            return
        try:
            data = preview_png(target, entry)
        except (OSError, zipfile.BadZipFile, ValueError, FileNotFoundError, KeyError, ImportError) as exc:
            self._json(404, {"error": str(exc)})
            return
        self._send(200, data, "image/png")

    def _mesh(self, query: dict) -> None:
        raw = (query.get("path") or [""])[0]
        entry = (query.get("entry") or [""])[0]
        try:
            target = Path(raw).resolve()
        except Exception:
            self._json(400, {"error": "Bad path"})
            return
        if not target.is_file() or not self._allowed(target):
            self._json(404, {"error": "File not found"})
            return
        kind = _kind_for(Path(entry).name if entry else target.name)
        if kind not in {"3mf", "gcode.3mf"}:
            self._json(400, {"error": "No mesh for this file"})
            return
        try:
            data = mesh_preview(target, entry)
        except (OSError, zipfile.BadZipFile, ValueError, FileNotFoundError, KeyError, ImportError) as exc:
            self._json(404, {"error": str(exc)})
            return
        self._send(200, data, "application/octet-stream")

    def _file_bytes(self, query: dict) -> None:
        raw = (query.get("path") or [""])[0]
        entry = (query.get("entry") or [""])[0]
        try:
            target = Path(raw).resolve()
        except Exception:
            self._json(400, {"error": "Bad path"})
            return
        if not target.is_file() or not self._allowed(target):
            self._json(404, {"error": "File not found"})
            return
        try:
            if entry:
                if target.suffix.lower() != ".zip":
                    self._json(400, {"error": "Entry only works on a zip"})
                    return
                data = read_zip_entry(target, entry)
                name = Path(entry).name
            else:
                data = target.read_bytes()
                name = target.name
        except (OSError, zipfile.BadZipFile, ValueError, FileNotFoundError) as exc:
            self._json(404, {"error": str(exc)})
            return
        ctype = mimetypes.guess_type(name)[0] or "application/octet-stream"
        self._send(200, data, ctype, {"X-MeshFinder-Name": name})

    def _open_external(self) -> None:
        body = self._read_json()
        raw = str(body.get("path") or "")
        entry = str(body.get("entry") or "")
        try:
            target = Path(raw).resolve()
        except Exception:
            self._json(400, {"error": "Bad path"})
            return
        if not target.is_file() or not self._allowed(target):
            self._json(404, {"error": "File not found"})
            return
        try:
            if entry:
                data = read_zip_entry(target, entry)
                dest_dir = config_path().parent / "open"
                dest_dir.mkdir(parents=True, exist_ok=True)
                dest = dest_dir / Path(entry).name
                dest.write_bytes(data)
                os.startfile(dest)  # noqa: S606  Windows shell open of a file the user picked
                self._json(200, {"ok": True, "opened": str(dest)})
                return
            os.startfile(target)  # noqa: S606
        except Exception as exc:
            self._json(500, {"error": str(exc)})
            return
        self._json(200, {"ok": True, "opened": str(target)})

    def _reveal(self) -> None:
        body = self._read_json()
        raw = str(body.get("path") or "")
        try:
            target = Path(raw).resolve()
        except Exception:
            self._json(400, {"error": "Bad path"})
            return
        if not target.exists() or not self._allowed(target):
            self._json(404, {"error": "File not found"})
            return
        subprocess.Popen(["explorer", f"/select,{target}"])
        self._json(200, {"ok": True, "revealed": str(target)})

    def _send_painter(self) -> None:
        body = self._read_json()
        raw = str(body.get("path") or "")
        entry = str(body.get("entry") or "")
        try:
            target = Path(raw).resolve()
        except Exception:
            self._json(400, {"error": "Bad path"})
            return
        if not target.is_file() or not self._allowed(target):
            self._json(404, {"error": "File not found"})
            return
        try:
            if entry:
                data = read_zip_entry(target, entry)
                name = Path(entry).name
            else:
                data = target.read_bytes()
                name = target.name
        except (OSError, zipfile.BadZipFile, ValueError, FileNotFoundError) as exc:
            self._json(404, {"error": str(exc)})
            return
        lower = name.lower()
        if not lower.endswith((".stl", ".obj", ".3mf")) or lower.endswith(".gcode.3mf"):
            self._json(400, {"error": "STL Painter takes an STL, OBJ, or 3MF"})
            return
        safe = Path(name).name.replace('"', "")
        boundary = "----MeshFinderPainter"
        head = (
            f"--{boundary}\r\n"
            f'Content-Disposition: form-data; name="file"; filename="{safe}"\r\n'
            f"Content-Type: application/octet-stream\r\n\r\n"
        ).encode("utf-8")
        payload = head + data + f"\r\n--{boundary}--\r\n".encode("utf-8")
        req = urllib.request.Request(
            f"{FLIGHTDECK_URL}/api/painter/inbox",
            data=payload,
            method="POST",
            headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
        )
        try:
            with urllib.request.urlopen(req, timeout=180) as resp:
                sent = json.loads(resp.read().decode("utf-8"))
        except Exception as exc:
            self._json(502, {"error": f"Flightdeck did not take the file: {exc}"})
            return
        token = str(sent.get("token") or "")
        if not token:
            self._json(502, {"error": "Flightdeck did not take the file"})
            return
        target_hash = f"#/painter?src=/api/painter/inbox/{token}&name={quote(safe)}"
        if not _open_flightdeck_app(target_hash):
            self._json(502, {"error": "The Flightdeck app did not open"})
            return
        self._json(200, {"ok": True, "opened": target_hash, "name": safe})

    def _exclude_folder(self) -> None:
        target = _library_target(str(self._read_json().get("path") or ""))
        if target is None:
            self._json(404, {"error": "Folder not found"})
            return
        items = load_excluded()
        key = str(target).casefold()
        if key not in {item.casefold() for item in items}:
            items.append(str(target))
            save_excluded(items)
        self._json(200, {"ok": True, "excluded": str(target)})

    def _rename_folder(self) -> None:
        body = self._read_json()
        target = _library_target(str(body.get("path") or ""))
        new_name = Path(str(body.get("name") or "")).name.strip()
        if target is None:
            self._json(404, {"error": "Folder not found"})
            return
        if not new_name or new_name in {".", ".."} or any(ch in new_name for ch in '\\/:*?"<>|'):
            self._json(400, {"error": "That name will not work"})
            return
        dest = target.parent / new_name
        if dest.exists():
            self._json(409, {"error": "Something already has that name"})
            return
        old = str(target)
        try:
            target.rename(dest)
        except OSError as exc:
            self._json(500, {"error": str(exc)})
            return
        new = str(dest.resolve())
        data = _read_config()
        data["roots"] = [_replace_stored_path(old, new, str(item)) for item in data.get("roots") or []]
        data["excluded"] = [_replace_stored_path(old, new, str(item)) for item in data.get("excluded") or []]
        groups = []
        for raw in data.get("collections") or []:
            if not isinstance(raw, dict):
                continue
            items = []
            for item in raw.get("items") or raw.get("paths") or []:
                if isinstance(item, str):
                    items.append({"path": _replace_stored_path(old, new, item), "entry": "", "name": Path(item).name, "kind": "folder", "size": 0})
                elif isinstance(item, dict):
                    item["path"] = _replace_stored_path(old, new, str(item.get("path") or ""))
                    items.append(item)
            groups.append({"name": str(raw.get("name") or ""), "items": items})
        data["collections"] = groups
        favourites = []
        for raw in data.get("favourites") or []:
            if not isinstance(raw, dict):
                continue
            raw["path"] = _replace_stored_path(old, new, str(raw.get("path") or ""))
            favourites.append(raw)
        data["favourites"] = favourites
        _write_config(data)
        self._json(200, {"ok": True, "path": new, "name": dest.name})

    def _add_collection(self) -> None:
        body = self._read_json()
        name = str(body.get("name") or "").strip()
        if not name:
            self._json(400, {"error": "Name the collection"})
            return
        groups = load_collections()
        found = next((group for group in groups if group["name"].casefold() == name.casefold()), None)
        raw_path = str(body.get("path") or "")
        if found is None:
            found = {"name": name, "items": []}
            groups.append(found)
        elif not raw_path:
            self._json(409, {"error": "That collection already exists"})
            return
        if raw_path:
            target = _library_target(raw_path)
            if target is None:
                self._json(404, {"error": "Folder not found"})
                return
            member = {"path": str(target), "entry": "", "name": target.name, "kind": "folder" if target.is_dir() else "file", "size": 0}
            key = member["path"].casefold()
            if key not in {item["path"].casefold() for item in found["items"] if not item.get("entry")}:
                found["items"].append(member)
        save_collections(groups)
        self._json(200, {"ok": True, "items": groups})

    def _add_collection_items(self) -> None:
        body = self._read_json()
        name = str(body.get("name") or "").strip()
        if not name:
            self._json(400, {"error": "Name the collection"})
            return
        groups = load_collections()
        found = next((group for group in groups if group["name"].casefold() == name.casefold()), None)
        if found is None:
            self._json(404, {"error": "Collection not found"})
            return
        seen = {f"{item['path']}|{item['entry']}".casefold() for item in found["items"]}
        for raw in body.get("items") or []:
            if not isinstance(raw, dict):
                continue
            member = _collection_member(raw)
            if not member:
                continue
            key = f"{member['path']}|{member['entry']}".casefold()
            if key in seen:
                continue
            seen.add(key)
            found["items"].append(member)
        save_collections(groups)
        self._json(200, {"ok": True, "items": groups})

    def _rename_collection(self) -> None:
        body = self._read_json()
        name = str(body.get("name") or "").strip()
        new_name = str(body.get("newName") or "").strip()
        if not name or not new_name:
            self._json(400, {"error": "Name the collection"})
            return
        groups = load_collections()
        found = next((group for group in groups if group["name"].casefold() == name.casefold()), None)
        if found is None:
            self._json(404, {"error": "Collection not found"})
            return
        if any(group["name"].casefold() == new_name.casefold() and group is not found for group in groups):
            self._json(409, {"error": "That collection already exists"})
            return
        found["name"] = new_name
        save_collections(groups)
        self._json(200, {"ok": True, "items": groups})

    def _delete_collection(self, query: dict) -> None:
        name = (query.get("name") or [""])[0].strip()
        groups = [group for group in load_collections() if group["name"].casefold() != name.casefold()]
        save_collections(groups)
        self._json(200, {"ok": True, "items": groups})


def _library_target(raw: str) -> Path | None:
    try:
        target = Path(raw).expanduser().resolve()
    except Exception:
        return None
    if not target.exists() or not _under_root(target, load_roots()):
        return None
    return target


def _replace_stored_path(old: str, new: str, value: str) -> str:
    old_key = old.casefold()
    value_key = value.casefold()
    if value_key == old_key:
        return new
    prefix = old_key.rstrip("\\") + "\\"
    if value_key.startswith(prefix):
        return new.rstrip("\\") + value[len(old):]
    return value


def _post_flightdeck_page(target: str) -> bool:
    req = urllib.request.Request(
        "http://127.0.0.1:4712/navigate",
        data=json.dumps({"hash": target}).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=2) as resp:
            return resp.status == 200
    except Exception:
        return False


def _flightdeck_desktop_pids() -> list[int]:
    script = (
        "Get-CimInstance Win32_Process -Filter \"Name = 'pythonw.exe' OR Name = 'python.exe'\" | "
        "Where-Object { $_.CommandLine -match 'flightdeck\\\\desktop\\\\launch.py' } | "
        "Select-Object -ExpandProperty ProcessId"
    )
    try:
        out = subprocess.check_output(
            ["powershell", "-NoProfile", "-Command", script],
            text=True,
            timeout=15,
            stderr=subprocess.DEVNULL,
        )
    except Exception:
        return []
    return [int(line) for line in out.splitlines() if line.strip().isdigit()]


def _start_flightdeck_window() -> None:
    py = Path(os.environ.get("LOCALAPPDATA", "")) / "Programs" / "Python" / "Python312" / "pythonw.exe"
    script = Path(__file__).resolve().parents[2] / "desktop" / "launch.py"
    if not py.is_file() or not script.is_file():
        return
    subprocess.Popen([str(py), str(script)], cwd=str(script.parent))


def _write_pending_page(target: str) -> None:
    base = Path(os.environ.get("APPDATA") or Path.home()) / "Flightdeck"
    base.mkdir(parents=True, exist_ok=True)
    (base / "pending-hash.txt").write_text(target + "\n", encoding="utf-8")


def _open_flightdeck_app(target: str) -> bool:
    if _post_flightdeck_page(target):
        return True
    _write_pending_page(target)
    _start_flightdeck_window()
    for _ in range(12):
        time.sleep(0.25)
        if _post_flightdeck_page(target):
            return True
    for pid in _flightdeck_desktop_pids():
        subprocess.run(["taskkill", "/PID", str(pid), "/F"], capture_output=True, timeout=10)
    time.sleep(0.4)
    _write_pending_page(target)
    _start_flightdeck_window()
    for _ in range(40):
        time.sleep(0.25)
        if _post_flightdeck_page(target):
            return True
    return False


def serve(port: int = PORT) -> ThreadingHTTPServer:
    _start_index()
    httpd = ThreadingHTTPServer((HOST, port), Handler)
    httpd.serve_forever()
    return httpd


if __name__ == "__main__":
    print(f"MeshFinder desk on http://{HOST}:{PORT}")
    serve()
