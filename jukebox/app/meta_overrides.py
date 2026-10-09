"""Vinyl-only display metadata overrides. Cindy files stay untouched."""

from __future__ import annotations

import hashlib
import json
import os
import re
import threading
from pathlib import Path
from typing import Any

DATA_DIR = Path(os.environ.get("VINYL_DATA", "/vinyl-data"))
STORE_PATH = DATA_DIR / "meta-overrides.json"
COVERS_DIR = DATA_DIR / "covers"
COVER_ID_PREFIX = "vinylcover:"
_lock = threading.Lock()


def _empty() -> dict[str, Any]:
    return {"albums": {}, "songs": {}, "covers": {}}


def _load() -> dict[str, Any]:
    try:
        if not STORE_PATH.is_file():
            return _empty()
        data = json.loads(STORE_PATH.read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            return _empty()
        data.setdefault("albums", {})
        data.setdefault("songs", {})
        data.setdefault("covers", {})
        return data
    except (OSError, json.JSONDecodeError):
        return _empty()


def _save(data: dict[str, Any]) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    tmp = STORE_PATH.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    tmp.replace(STORE_PATH)


def get_store() -> dict[str, Any]:
    with _lock:
        return _load()


def patch_album(album_id: str, fields: dict[str, str]) -> dict[str, Any]:
    with _lock:
        data = _load()
        cur = dict(data["albums"].get(album_id) or {})
        for key in ("name", "artist"):
            if key in fields and fields[key] is not None:
                val = str(fields[key]).strip()
                if val:
                    cur[key] = val
                else:
                    cur.pop(key, None)
        if cur:
            data["albums"][album_id] = cur
        else:
            data["albums"].pop(album_id, None)
        _save(data)
        return cur


def patch_song(song_id: str, fields: dict[str, str]) -> dict[str, Any]:
    with _lock:
        data = _load()
        cur = dict(data["songs"].get(song_id) or {})
        for key in ("title", "artist", "album"):
            if key in fields and fields[key] is not None:
                val = str(fields[key]).strip()
                if val:
                    cur[key] = val
                else:
                    cur.pop(key, None)
        if cur:
            data["songs"][song_id] = cur
        else:
            data["songs"].pop(song_id, None)
        _save(data)
        return cur


def _cover_id(album_id: str, store: dict[str, Any]) -> str | None:
    """Versioned cover id — changes whenever the override image changes, so a
    new cover always gets a new URL instead of hiding behind the browser's
    immutable image cache from before the change."""
    entry = store["covers"].get(album_id)
    if not entry:
        return None
    ver = entry.get("version") or "0"
    return f"{COVER_ID_PREFIX}{album_id}@{ver}"


def apply_song(song: dict[str, Any] | None) -> dict[str, Any] | None:
    if not song:
        return song
    sid = song.get("id")
    store = get_store()
    out = dict(song)
    ov = store["songs"].get(sid) or {} if sid else {}
    if ov.get("title"):
        out["title"] = ov["title"]
    if ov.get("artist"):
        out["artist"] = ov["artist"]
    if ov.get("album"):
        out["album"] = ov["album"]
    aid = song.get("albumId")
    cover_id = _cover_id(aid, store) if aid else None
    if cover_id:
        out["coverArt"] = cover_id
    if ov or cover_id:
        out["vinylOverride"] = True
    return out


def apply_album(album: dict[str, Any] | None) -> dict[str, Any] | None:
    if not album:
        return album
    out = dict(album)
    aid = out.get("id")
    if aid:
        store = get_store()
        ov = store["albums"].get(aid) or {}
        if ov.get("name"):
            out["name"] = ov["name"]
            out["title"] = ov["name"]
        if ov.get("artist"):
            out["artist"] = ov["artist"]
            out["displayArtist"] = ov["artist"]
        cover_id = _cover_id(aid, store)
        if cover_id:
            out["coverArt"] = cover_id
            out["vinylOverride"] = True
        elif ov:
            out["vinylOverride"] = True
    songs = out.get("song")
    if isinstance(songs, list):
        out["song"] = [apply_song(s) or s for s in songs]
    return out


def apply_album_list(albums: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [apply_album(a) or a for a in albums]


def apply_song_list(songs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [apply_song(s) or s for s in songs]


def _cover_path(album_id: str) -> Path:
    safe = re.sub(r"[^A-Za-z0-9_.-]", "_", album_id) or "cover"
    return COVERS_DIR / safe


def set_album_cover(album_id: str, content: bytes, content_type: str) -> str:
    """Saves the override image and returns its versioned cover id
    (vinylcover:<albumId>@<version>) for the caller to hand back to the client."""
    version = hashlib.md5(content).hexdigest()[:10]
    with _lock:
        COVERS_DIR.mkdir(parents=True, exist_ok=True)
        _cover_path(album_id).write_bytes(content)
        data = _load()
        data["covers"][album_id] = {
            "contentType": content_type or "image/jpeg",
            "size": len(content),
            "version": version,
        }
        _save(data)
    return f"{COVER_ID_PREFIX}{album_id}@{version}"


def clear_album_cover(album_id: str) -> None:
    with _lock:
        data = _load()
        if album_id in data["covers"]:
            data["covers"].pop(album_id, None)
            _save(data)
        try:
            _cover_path(album_id).unlink()
        except OSError:
            pass


def get_album_cover(album_id: str) -> tuple[bytes, str] | None:
    meta = get_store()["covers"].get(album_id)
    if not meta:
        return None
    try:
        content = _cover_path(album_id).read_bytes()
    except OSError:
        return None
    return content, meta.get("contentType") or "image/jpeg"
