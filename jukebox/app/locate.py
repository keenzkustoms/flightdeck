"""Resolve Cindy library paths for albums / tracks (live Navidrome index)."""

from __future__ import annotations

import os
import sqlite3
from pathlib import PurePosixPath
from typing import Any

from .folder_albums import DB_PATH, resolve_folder_key

# LAN share host for Explorer / UNC links (Cindy is read-only CIFS).
CINDY_SMB_HOST = os.environ.get("CINDY_SMB_HOST", "192.168.4.53")

_MEDIA_WANT = (
    "id",
    "path",
    "title",
    "album",
    "artist",
    "album_artist",
    "album_id",
    "track_number",
    "disc_number",
    "year",
    "duration",
    "bit_rate",
    "size",
    "suffix",
    "genre",
)


def _connect() -> sqlite3.Connection | None:
    if not os.path.isfile(DB_PATH):
        return None
    try:
        con = sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True, timeout=5.0)
        con.row_factory = sqlite3.Row
        return con
    except sqlite3.Error:
        return None


def _media_select(con: sqlite3.Connection) -> str:
    cols = {r[1] for r in con.execute("pragma table_info(media_file)")}
    return ", ".join(c for c in _MEDIA_WANT if c in cols)


def media_row(song_id: str) -> dict[str, Any] | None:
    if not song_id:
        return None
    con = _connect()
    if not con:
        return None
    try:
        row = con.execute(
            f"SELECT {_media_select(con)} FROM media_file WHERE id = ?",
            (song_id,),
        ).fetchone()
        return dict(row) if row else None
    except sqlite3.Error:
        return None
    finally:
        con.close()


def normalize_library_path(path: str | None) -> str | None:
    if not path:
        return None
    p = path.replace("\\", "/").lstrip("/")
    # Strip container music-root prefixes if present.
    for prefix in ("music/", "/music/"):
        if p.lower().startswith(prefix.lstrip("/")):
            p = p[len(prefix.lstrip("/")) :]
            break
    return p


def unc_from_library_path(path: str | None) -> str | None:
    rel = normalize_library_path(path)
    if not rel:
        return None
    return f"\\\\{CINDY_SMB_HOST}\\" + rel.replace("/", "\\")


def folder_unc_from_library_path(path: str | None) -> str | None:
    rel = normalize_library_path(path)
    if not rel:
        return None
    parent = str(PurePosixPath(rel).parent)
    if parent in (".", ""):
        return f"\\\\{CINDY_SMB_HOST}\\{rel.split('/')[0]}"
    return f"\\\\{CINDY_SMB_HOST}\\" + parent.replace("/", "\\")


def folder_unc_from_folder_key(folder_key: str | None) -> str | None:
    rel = normalize_library_path(folder_key)
    if not rel:
        return None
    return f"\\\\{CINDY_SMB_HOST}\\" + rel.replace("/", "\\")


def _track_payload(row: dict[str, Any]) -> dict[str, Any]:
    rel = normalize_library_path(row.get("path"))
    return {
        "id": row.get("id"),
        "title": row.get("title") or (PurePosixPath(rel).stem if rel else None),
        "album": row.get("album"),
        "artist": row.get("artist") or row.get("album_artist"),
        "albumArtist": row.get("album_artist"),
        "track": row.get("track_number"),
        "discNumber": row.get("disc_number"),
        "year": row.get("year"),
        "duration": row.get("duration"),
        "bitRate": row.get("bit_rate"),
        "size": row.get("size"),
        "suffix": row.get("suffix"),
        "genre": row.get("genre"),
        "path": rel,
        "unc": unc_from_library_path(rel),
        "folderUnc": folder_unc_from_library_path(rel),
        "found": bool(rel),
    }


def locate_song(song_id: str, fallback_path: str | None = None) -> dict[str, Any]:
    row = media_row(song_id) or {}
    if fallback_path and not row.get("path"):
        row = {**row, "path": fallback_path, "id": song_id}
    payload = _track_payload(row if row else {"id": song_id, "path": fallback_path})
    share = PurePosixPath(payload["path"]).parts[0] if payload.get("path") else None
    payload.update(
        {
            "share": share,
            "smbHost": CINDY_SMB_HOST,
        }
    )
    return payload


def _album_row(con: sqlite3.Connection, album_id: str) -> dict[str, Any] | None:
    cols = {r[1] for r in con.execute("pragma table_info(album)")}
    select = ["id", "name", "album_artist", "song_count"]
    for c in ("max_year", "min_year", "duration", "genre", "compilation"):
        if c in cols:
            select.append(c)
    try:
        row = con.execute(
            f"SELECT {', '.join(select)} FROM album WHERE id = ?",
            (album_id,),
        ).fetchone()
        return dict(row) if row else None
    except sqlite3.Error:
        return None


def _tracks_for_album_id(con: sqlite3.Connection, album_id: str) -> list[dict[str, Any]]:
    sel = _media_select(con)
    rows = con.execute(
        f"""
        SELECT {sel}
        FROM media_file
        WHERE album_id = ? AND COALESCE(missing, 0) = 0
        ORDER BY disc_number, track_number, path
        """,
        (album_id,),
    ).fetchall()
    return [_track_payload(dict(r)) for r in rows]


def _tracks_for_folder(con: sqlite3.Connection, folder_key: str) -> list[dict[str, Any]]:
    sel = _media_select(con)
    rows = con.execute(
        f"""
        SELECT {sel}
        FROM media_file
        WHERE COALESCE(missing, 0) = 0
          AND path LIKE ? || '/%'
          AND instr(substr(path, length(?) + 2), '/') = 0
        ORDER BY disc_number, track_number, path
        """,
        (folder_key, folder_key),
    ).fetchall()
    return [_track_payload(dict(r)) for r in rows]


def locate_album(album_id: str) -> dict[str, Any]:
    """Live Cindy index for a sleeve — album tags + per-track paths/UNC."""
    if not album_id:
        return {"found": False, "tracks": [], "smbHost": CINDY_SMB_HOST}

    con = _connect()
    if not con:
        return {"found": False, "tracks": [], "smbHost": CINDY_SMB_HOST, "id": album_id}

    try:
        folder_key = resolve_folder_key(album_id)
        tracks: list[dict[str, Any]] = []
        album_name = None
        album_artist = None
        year = None
        song_count = None
        genre = None
        compilation = None
        merged = False

        if album_id.startswith("folder:") or folder_key:
            fk = folder_key
            if album_id.startswith("folder:") and not fk:
                return {
                    "id": album_id,
                    "found": False,
                    "tracks": [],
                    "smbHost": CINDY_SMB_HOST,
                    "merged": True,
                }
            if fk:
                tracks = _tracks_for_folder(con, fk)
                merged = True
                album_name = PurePosixPath(fk).name
                album_artist = "Various Artists"
                folder_unc = folder_unc_from_folder_key(fk)
                folder_path = normalize_library_path(fk)
            else:
                folder_unc = None
                folder_path = None
        else:
            al = _album_row(con, album_id) or {}
            tracks = _tracks_for_album_id(con, album_id)
            album_name = al.get("name")
            album_artist = al.get("album_artist")
            year = al.get("max_year") or al.get("min_year")
            song_count = al.get("song_count")
            genre = al.get("genre")
            compilation = bool(al.get("compilation")) if al else None
            sample = tracks[0] if tracks else None
            folder_unc = sample.get("folderUnc") if sample else None
            folder_path = (
                str(PurePosixPath(sample["path"]).parent)
                if sample and sample.get("path")
                else None
            )
            if folder_key:
                # ND album is a fragment inside a mergeable pack — prefer pack folder.
                folder_unc = folder_unc_from_folder_key(folder_key)
                folder_path = normalize_library_path(folder_key)
                merged = True

        if tracks and not album_name:
            album_name = tracks[0].get("album")
        if tracks and not album_artist:
            album_artist = tracks[0].get("albumArtist") or tracks[0].get("artist")
        if song_count is None:
            song_count = len(tracks)
        if year is None:
            years = [t.get("year") for t in tracks if t.get("year")]
            year = min(years) if years else None

        share = None
        if folder_path:
            share = PurePosixPath(folder_path).parts[0] if folder_path else None

        return {
            "id": album_id,
            "name": album_name,
            "artist": album_artist,
            "year": year,
            "genre": genre,
            "songCount": song_count,
            "compilation": compilation,
            "merged": merged,
            "folderKey": folder_key,
            "path": folder_path,
            "folderUnc": folder_unc,
            "unc": folder_unc,
            "share": share,
            "smbHost": CINDY_SMB_HOST,
            "found": bool(tracks) or bool(folder_path),
            "tracks": tracks,
        }
    except sqlite3.Error:
        return {
            "id": album_id,
            "found": False,
            "tracks": [],
            "smbHost": CINDY_SMB_HOST,
        }
    finally:
        con.close()
