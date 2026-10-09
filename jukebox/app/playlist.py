"""Single running playlist, vinyl-only — Cindy files stay untouched."""

from __future__ import annotations

import json
import os
import threading
import time
from pathlib import Path
from typing import Any

DATA_DIR = Path(os.environ.get("VINYL_DATA", "/vinyl-data"))
STORE_PATH = DATA_DIR / "playlist.json"
_lock = threading.Lock()


def _load() -> list[dict[str, Any]]:
    try:
        if not STORE_PATH.is_file():
            return []
        data = json.loads(STORE_PATH.read_text(encoding="utf-8"))
        return data if isinstance(data, list) else []
    except (OSError, json.JSONDecodeError):
        return []


def _save(items: list[dict[str, Any]]) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    tmp = STORE_PATH.with_suffix(".tmp")
    tmp.write_text(json.dumps(items, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    tmp.replace(STORE_PATH)


def get_playlist() -> list[dict[str, Any]]:
    with _lock:
        return _load()


def _entry(song: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": str(song.get("id") or ""),
        "title": song.get("title") or "Track",
        "artist": song.get("artist") or "",
        "album": song.get("album") or "",
        "coverArt": song.get("coverArt") or "",
        "duration": song.get("duration"),
        "addedAt": time.time(),
    }


def add_track(song: dict[str, Any]) -> list[dict[str, Any]]:
    song_id = str(song.get("id") or "")
    if not song_id:
        raise ValueError("song id required")
    with _lock:
        items = _load()
        if any(str(it.get("id")) == song_id for it in items):
            return items
        items.append(_entry(song))
        _save(items)
        return items


def add_tracks(songs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    with _lock:
        items = _load()
        have = {str(it.get("id")) for it in items}
        for song in songs:
            song_id = str(song.get("id") or "")
            if not song_id or song_id in have:
                continue
            have.add(song_id)
            items.append(_entry(song))
        _save(items)
        return items


def remove_track(song_id: str) -> list[dict[str, Any]]:
    with _lock:
        items = [it for it in _load() if str(it.get("id")) != str(song_id)]
        _save(items)
        return items


def clear_playlist() -> None:
    with _lock:
        _save([])
