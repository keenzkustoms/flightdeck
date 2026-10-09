from __future__ import annotations

import json
import mimetypes
import re
from io import BytesIO
from pathlib import Path
from typing import Any, Iterator
from urllib.parse import quote

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import FileResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
try:
    from PIL import Image, ImageFile
except Exception:  # pragma: no cover
    Image = None
    ImageFile = None

from . import __version__
from .config import data_dir, load_config, save_config
from .db import db_session, init_db, parse_json_field, row_to_dict, utcnow
from .paths import to_windows_folder, to_windows_path
from .parsers.ziparchive import list_nested_zip, split_nested_entry
from .preview import (
    MAX_PREVIEW_TRIS,
    MAX_PREVIEW_TRIS_HIGH,
    build_preview_stl,
    build_slicer_3mf,
    build_zip_entry_preview,
    entry_kind,
    get_asset_row,
    path_is_allowed,
    path_under_watched,
    read_zip_entry_bytes,
    safe_zip_entry,
)
from .scanner import (
    effective_ignore_globs,
    get_scan_state,
    get_thumb_rebuild_state,
    mark_orphaned_scans,
    start_scan_background,
    start_thumb_rebuild_background,
)
from .print_handoff import list_flightdeck_printers, queue_asset_to_flightdeck
from .desktop_open import open_asset_on_pc
from .slicer_handoff import (
    inspect_asset_manifold,
    open_asset_in_desktop_slicer,
    resolve_worker_url,
)
from .thumbs import SHARED_ZIP_THUMB, ensure_shared_zip_thumb, resolve_thumb_name
from .zip_extract import extract_all_zip_printables, extract_zip_printable

ROOT = Path(__file__).resolve().parents[1]
STATIC = ROOT / "static"
IMAGE_PREVIEW_KINDS = frozenset({"jpg", "jpeg", "png", "gif", "webp", "bmp", "svg"})
RASTER_IMAGE_KINDS = frozenset({"jpg", "jpeg", "png", "gif", "webp", "bmp"})

app = FastAPI(title="PrintShelf", version=__version__)


class FolderIn(BaseModel):
    id: str
    label: str = ""
    path: str
    source_kind: str = "local"
    windows_path: str = ""


class ConfigIn(BaseModel):
    watched_folders: list[FolderIn] = Field(default_factory=list)
    ignore_globs: list[str] | None = None


class BulkIdsIn(BaseModel):
    ids: list[int] = Field(default_factory=list, max_length=2000)


class DesignMetaIn(BaseModel):
    notes: str | None = None
    tags: list[str] | None = None


class CollectionRuleIn(BaseModel):
    q: str | None = None
    kind: str | None = None
    source_kind: str | None = None
    root_id: str | None = None
    has_textures: bool | None = None
    is_sliced: bool | None = None
    tags_any: list[str] | None = None


class CollectionIn(BaseModel):
    name: str
    mode: str = "auto"
    rules: CollectionRuleIn | None = None


class CollectionAssetIdsIn(BaseModel):
    ids: list[int] = Field(default_factory=list, max_length=2000)


class FilamentIn(BaseModel):
    name: str
    brand: str = ""
    material: str = ""
    colour_hex: str = ""
    notes: str = ""


class AssetFilamentIn(BaseModel):
    filament_id: int | None = None


class ScanIssueIdsIn(BaseModel):
    ids: list[int] = Field(default_factory=list, max_length=2000)


_ASSET_SORT = {
    "seen": "a.last_seen DESC, a.file_name ASC",
    "name": "a.file_name ASC, a.rel_path ASC",
    "name_desc": "a.file_name DESC, a.rel_path DESC",
    "size": "a.size_bytes DESC, a.file_name ASC",
    "size_asc": "a.size_bytes ASC, a.file_name ASC",
    "kind": "a.kind ASC, a.file_name ASC",
}


@app.on_event("startup")
def _startup() -> None:
    cfg = load_config()
    db_file = data_dir(cfg) / "printshelf.sqlite3"
    init_db(db_file)
    mark_orphaned_scans(db_file)
    ensure_shared_zip_thumb(data_dir(cfg) / "thumbs")


@app.get("/api/health")
def health() -> dict[str, Any]:
    return {"ok": True, "name": "PrintShelf", "version": __version__}


@app.get("/api/config")
def get_config() -> dict[str, Any]:
    cfg = load_config()
    folders = []
    for f in cfg.get("watched_folders") or []:
        item = dict(f)
        p = Path(str(item.get("path") or ""))
        item["path_ok"] = bool(p.is_dir())
        item["path_hint"] = _folder_path_hint(str(item.get("path") or ""), item["path_ok"])
        folders.append(item)
    return {
        "watched_folders": folders,
        "ignore_globs": effective_ignore_globs(cfg),
        "port": cfg.get("port") or 8100,
    }


def _folder_path_hint(path: str, path_ok: bool) -> str | None:
    raw = (path or "").strip()
    if not raw:
        return "Pi path is empty"
    looks_windows = bool(
        raw.startswith("\\\\")
        or (len(raw) >= 3 and raw[1] == ":" and raw[0].isalpha())
        or "\\" in raw and not raw.startswith("/")
    )
    if looks_windows:
        return "This looks like a Windows path — PrintShelf runs on the Pi, so use a Linux mount like /mnt/koko-kidabah"
    if not path_ok:
        return "Path not found on the Pi (not mounted, typo, or permissions)"
    return None


@app.put("/api/config")
def put_config(body: ConfigIn) -> dict[str, Any]:
    cfg = load_config()
    cfg["watched_folders"] = [f.model_dump() for f in body.watched_folders]
    if body.ignore_globs is not None:
        cfg["ignore_globs"] = body.ignore_globs
    save_config(cfg)
    out = get_config()
    bad = [f for f in out["watched_folders"] if not f.get("path_ok")]
    out["warnings"] = [
        f"{f.get('label') or f.get('id')}: {f.get('path_hint') or 'path missing on Pi'}"
        for f in bad
    ]
    return out


@app.post("/api/scan")
def trigger_scan(root_id: str | None = Query(None)) -> dict[str, Any]:
    """Rescan all watched folders, or one root via ?root_id=kidabah-pc."""
    roots = [root_id.strip()] if root_id and root_id.strip() else None
    return start_scan_background(root_ids=roots)


@app.get("/api/scan")
def scan_status() -> dict[str, Any]:
    return get_scan_state()


@app.post("/api/thumbs/rebuild")
def trigger_thumb_rebuild() -> dict[str, Any]:
    """Rebuild stale model + image thumbs without re-walking the whole NAS."""
    return start_thumb_rebuild_background(
        kinds=("stl", "obj", "3mf", "gcode.3mf", "zip", "jpg", "jpeg", "png", "gif", "webp", "bmp")
    )


@app.get("/api/thumbs/rebuild")
def thumb_rebuild_status() -> dict[str, Any]:
    return get_thumb_rebuild_state()


@app.get("/api/stats")
def stats() -> dict[str, Any]:
    cfg = load_config()
    db_file = data_dir(cfg) / "printshelf.sqlite3"
    with db_session(db_file) as conn:
        designs = conn.execute(
            """SELECT COUNT(DISTINCT d.id) AS c FROM designs d
               JOIN assets a ON a.design_id = d.id
               WHERE a.missing = 0 AND COALESCE(a.hidden, 0) = 0"""
        ).fetchone()["c"]
        assets = conn.execute(
            "SELECT COUNT(*) AS c FROM assets WHERE missing = 0 AND COALESCE(hidden, 0) = 0"
        ).fetchone()["c"]
        hidden = conn.execute(
            "SELECT COUNT(*) AS c FROM assets WHERE missing = 0 AND COALESCE(hidden, 0) = 1"
        ).fetchone()["c"]
        by_kind = {
            r["kind"]: r["c"]
            for r in conn.execute(
                "SELECT kind, COUNT(*) AS c FROM assets "
                "WHERE missing = 0 AND COALESCE(hidden, 0) = 0 GROUP BY kind"
            ).fetchall()
        }
        duplicates = conn.execute(
            """SELECT COUNT(*) AS c FROM assets a
               WHERE a.missing = 0 AND COALESCE(a.hidden, 0) = 0
                 AND a.content_hash IS NOT NULL AND TRIM(a.content_hash) != ''
                 AND a.content_hash IN (
                   SELECT content_hash FROM assets
                   WHERE missing = 0 AND COALESCE(hidden, 0) = 0
                     AND content_hash IS NOT NULL AND TRIM(content_hash) != ''
                   GROUP BY content_hash HAVING COUNT(*) > 1
                 )"""
        ).fetchone()["c"]
        collections = conn.execute(
            "SELECT COUNT(*) AS c FROM collections"
        ).fetchone()["c"]
        filaments = conn.execute(
            "SELECT COUNT(*) AS c FROM filaments"
        ).fetchone()["c"]
        scan_issues = conn.execute(
            "SELECT COUNT(*) AS c FROM scan_issues WHERE COALESCE(resolved, 0) = 0 AND COALESCE(ignored, 0) = 0"
        ).fetchone()["c"]
    return {
        "designs": designs,
        "assets": assets,
        "hidden": hidden,
        "by_kind": by_kind,
        "duplicates": int(duplicates or 0),
        "collections": int(collections or 0),
        "filaments": int(filaments or 0),
        "scan_issues": int(scan_issues or 0),
        "scan": get_scan_state(),
        "thumbs": get_thumb_rebuild_state(),
    }


@app.get("/api/collections")
def list_collections() -> dict[str, Any]:
    cfg = load_config()
    db_file = data_dir(cfg) / "printshelf.sqlite3"
    with db_session(db_file) as conn:
        rows = conn.execute(
            "SELECT id, name, mode, rules_json, created_at, updated_at FROM collections ORDER BY name COLLATE NOCASE ASC, id ASC"
        ).fetchall()
        items = [_serialize_collection_row(conn, r) for r in rows]
    return {"items": items}


@app.get("/api/collections/{collection_id}")
def get_collection(collection_id: int) -> dict[str, Any]:
    cfg = load_config()
    db_file = data_dir(cfg) / "printshelf.sqlite3"
    with db_session(db_file) as conn:
        row = _get_collection_row(conn, collection_id)
        return _serialize_collection_row(conn, row)


@app.post("/api/collections")
def create_collection(body: CollectionIn) -> dict[str, Any]:
    mode = _clean_collection_mode(body.mode)
    name = _clean_collection_name(body.name)
    rules = _normalize_collection_rules(body.rules.model_dump() if body.rules else {})
    now = utcnow()
    cfg = load_config()
    db_file = data_dir(cfg) / "printshelf.sqlite3"
    with db_session(db_file) as conn:
        cur = conn.execute(
            "INSERT INTO collections(name, mode, rules_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
            (name, mode, json.dumps(rules), now, now),
        )
        row = _get_collection_row(conn, int(cur.lastrowid))
        return _serialize_collection_row(conn, row)


@app.patch("/api/collections/{collection_id}")
def patch_collection(collection_id: int, body: CollectionIn) -> dict[str, Any]:
    mode = _clean_collection_mode(body.mode)
    name = _clean_collection_name(body.name)
    rules = _normalize_collection_rules(body.rules.model_dump() if body.rules else {})
    cfg = load_config()
    db_file = data_dir(cfg) / "printshelf.sqlite3"
    with db_session(db_file) as conn:
        _get_collection_row(conn, collection_id)
        conn.execute(
            "UPDATE collections SET name = ?, mode = ?, rules_json = ?, updated_at = ? WHERE id = ?",
            (name, mode, json.dumps(rules), utcnow(), collection_id),
        )
        row = _get_collection_row(conn, collection_id)
        return _serialize_collection_row(conn, row)


@app.delete("/api/collections/{collection_id}")
def delete_collection(collection_id: int) -> dict[str, Any]:
    cfg = load_config()
    db_file = data_dir(cfg) / "printshelf.sqlite3"
    with db_session(db_file) as conn:
        _get_collection_row(conn, collection_id)
        conn.execute("DELETE FROM collections WHERE id = ?", (collection_id,))
    return {"ok": True}


@app.post("/api/collections/{collection_id}/assets")
def add_collection_assets(collection_id: int, body: CollectionAssetIdsIn) -> dict[str, Any]:
    ids = [int(i) for i in body.ids if int(i) > 0]
    if not ids:
        return {"ok": True, "added": 0}
    cfg = load_config()
    db_file = data_dir(cfg) / "printshelf.sqlite3"
    with db_session(db_file) as conn:
        coll = _get_collection_row(conn, collection_id)
        if _clean_collection_mode(coll.get("mode")) != "manual":
            raise HTTPException(400, "Can only add assets to manual collections")
        placeholders = ",".join("?" for _ in ids)
        found = {
            int(r["id"])
            for r in conn.execute(
                f"SELECT id FROM assets WHERE id IN ({placeholders}) AND missing = 0",
                ids,
            ).fetchall()
        }
        now = utcnow()
        for asset_id in sorted(found):
            conn.execute(
                "INSERT OR IGNORE INTO collection_assets(collection_id, asset_id, created_at) VALUES (?, ?, ?)",
                (collection_id, asset_id, now),
            )
    return {"ok": True, "added": len(ids)}


@app.delete("/api/collections/{collection_id}/assets")
def remove_collection_assets(collection_id: int, body: CollectionAssetIdsIn) -> dict[str, Any]:
    ids = [int(i) for i in body.ids if int(i) > 0]
    if not ids:
        return {"ok": True, "removed": 0}
    cfg = load_config()
    db_file = data_dir(cfg) / "printshelf.sqlite3"
    with db_session(db_file) as conn:
        coll = _get_collection_row(conn, collection_id)
        if _clean_collection_mode(coll.get("mode")) != "manual":
            raise HTTPException(400, "Can only remove assets from manual collections")
        placeholders = ",".join("?" for _ in ids)
        conn.execute(
            f"DELETE FROM collection_assets WHERE collection_id = ? AND asset_id IN ({placeholders})",
            [collection_id, *ids],
        )
    return {"ok": True, "removed": len(ids)}


def _clean_colour_hex(raw: str | None) -> str:
    c = str(raw or "").strip()
    if not c:
        return ""
    if not re.fullmatch(r"#?[0-9a-fA-F]{6}", c):
        raise HTTPException(400, "Filament colour must be a 6-digit hex code")
    return c if c.startswith("#") else f"#{c}"


def _serialize_filament_row(conn, row) -> dict[str, Any]:
    item = row_to_dict(row)
    assert item
    item["usage_count"] = int(
        conn.execute(
            "SELECT COUNT(*) AS c FROM assets WHERE missing = 0 AND COALESCE(hidden, 0) = 0 AND assigned_filament_id = ?",
            (int(item["id"]),),
        ).fetchone()["c"]
    )
    return item


@app.get("/api/filaments")
def list_filaments() -> dict[str, Any]:
    cfg = load_config()
    db_file = data_dir(cfg) / "printshelf.sqlite3"
    with db_session(db_file) as conn:
        rows = conn.execute(
            "SELECT id, name, brand, material, colour_hex, notes, created_at, updated_at "
            "FROM filaments ORDER BY name COLLATE NOCASE ASC, id ASC"
        ).fetchall()
        items = [_serialize_filament_row(conn, r) for r in rows]
    return {"items": items}


@app.post("/api/filaments")
def create_filament(body: FilamentIn) -> dict[str, Any]:
    name = " ".join(str(body.name or "").strip().split())
    if not name:
        raise HTTPException(400, "Filament name is required")
    brand = " ".join(str(body.brand or "").strip().split())[:80]
    material = " ".join(str(body.material or "").strip().split())[:40]
    colour_hex = _clean_colour_hex(body.colour_hex)
    notes = str(body.notes or "").strip()[:1000]
    now = utcnow()
    cfg = load_config()
    db_file = data_dir(cfg) / "printshelf.sqlite3"
    with db_session(db_file) as conn:
        cur = conn.execute(
            "INSERT INTO filaments(name, brand, material, colour_hex, notes, created_at, updated_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            (name[:120], brand, material, colour_hex, notes, now, now),
        )
        row = conn.execute(
            "SELECT id, name, brand, material, colour_hex, notes, created_at, updated_at FROM filaments WHERE id = ?",
            (int(cur.lastrowid),),
        ).fetchone()
        return _serialize_filament_row(conn, row)


@app.patch("/api/filaments/{filament_id}")
def patch_filament(filament_id: int, body: FilamentIn) -> dict[str, Any]:
    name = " ".join(str(body.name or "").strip().split())
    if not name:
        raise HTTPException(400, "Filament name is required")
    brand = " ".join(str(body.brand or "").strip().split())[:80]
    material = " ".join(str(body.material or "").strip().split())[:40]
    colour_hex = _clean_colour_hex(body.colour_hex)
    notes = str(body.notes or "").strip()[:1000]
    cfg = load_config()
    db_file = data_dir(cfg) / "printshelf.sqlite3"
    with db_session(db_file) as conn:
        hit = conn.execute("SELECT id FROM filaments WHERE id = ?", (filament_id,)).fetchone()
        if not hit:
            raise HTTPException(404, "Filament not found")
        conn.execute(
            "UPDATE filaments SET name = ?, brand = ?, material = ?, colour_hex = ?, notes = ?, updated_at = ? "
            "WHERE id = ?",
            (name[:120], brand, material, colour_hex, notes, utcnow(), filament_id),
        )
        row = conn.execute(
            "SELECT id, name, brand, material, colour_hex, notes, created_at, updated_at FROM filaments WHERE id = ?",
            (filament_id,),
        ).fetchone()
        return _serialize_filament_row(conn, row)


@app.delete("/api/filaments/{filament_id}")
def delete_filament(filament_id: int) -> dict[str, Any]:
    cfg = load_config()
    db_file = data_dir(cfg) / "printshelf.sqlite3"
    with db_session(db_file) as conn:
        hit = conn.execute("SELECT id FROM filaments WHERE id = ?", (filament_id,)).fetchone()
        if not hit:
            raise HTTPException(404, "Filament not found")
        conn.execute("UPDATE assets SET assigned_filament_id = NULL WHERE assigned_filament_id = ?", (filament_id,))
        conn.execute("DELETE FROM filaments WHERE id = ?", (filament_id,))
    return {"ok": True}


@app.post("/api/assets/{asset_id}/filament")
def set_asset_filament(asset_id: int, body: AssetFilamentIn) -> dict[str, Any]:
    cfg = load_config()
    db_file = data_dir(cfg) / "printshelf.sqlite3"
    fid = int(body.filament_id) if body.filament_id is not None else None
    with db_session(db_file) as conn:
        hit = conn.execute("SELECT id FROM assets WHERE id = ?", (asset_id,)).fetchone()
        if not hit:
            raise HTTPException(404, "Asset not found")
        if fid is not None:
            f_hit = conn.execute("SELECT id FROM filaments WHERE id = ?", (fid,)).fetchone()
            if not f_hit:
                raise HTTPException(404, "Filament not found")
        conn.execute(
            "UPDATE assets SET assigned_filament_id = ? WHERE id = ?",
            (fid, asset_id),
        )
    return get_asset(asset_id)


@app.get("/api/scan_issues")
def list_scan_issues(
    root_id: str | None = None,
    unresolved_only: bool = Query(True),
    ignored: bool | None = None,
    limit: int = Query(200, ge=1, le=1000),
    offset: int = Query(0, ge=0),
) -> dict[str, Any]:
    cfg = load_config()
    db_file = data_dir(cfg) / "printshelf.sqlite3"
    clauses: list[str] = ["1=1"]
    params: list[Any] = []
    if root_id:
        clauses.append("root_id = ?")
        params.append(root_id)
    if unresolved_only:
        clauses.append("COALESCE(resolved, 0) = 0")
    if ignored is not None:
        clauses.append("COALESCE(ignored, 0) = ?")
        params.append(1 if ignored else 0)
    where = " AND ".join(clauses)
    with db_session(db_file) as conn:
        rows = conn.execute(
            f"""SELECT id, root_id, abs_path, file_name, error, attempts, resolved, ignored, last_seen, created_at, updated_at
                FROM scan_issues
                WHERE {where}
                ORDER BY updated_at DESC, id DESC
                LIMIT ? OFFSET ?""",
            [*params, limit, offset],
        ).fetchall()
        total = int(
            conn.execute(f"SELECT COUNT(*) AS c FROM scan_issues WHERE {where}", params).fetchone()["c"] or 0
        )
    items = [row_to_dict(r) for r in rows]
    return {"total": total, "items": [i for i in items if i]}


@app.post("/api/scan_issues/{issue_id}/ignore")
def ignore_scan_issue(issue_id: int) -> dict[str, Any]:
    cfg = load_config()
    db_file = data_dir(cfg) / "printshelf.sqlite3"
    with db_session(db_file) as conn:
        row = conn.execute("SELECT id FROM scan_issues WHERE id = ?", (issue_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Scan issue not found")
        conn.execute(
            "UPDATE scan_issues SET ignored = 1, updated_at = ? WHERE id = ?",
            (utcnow(), issue_id),
        )
    return {"ok": True}


@app.post("/api/scan_issues/ignore")
def ignore_scan_issues(body: ScanIssueIdsIn) -> dict[str, Any]:
    ids = [int(i) for i in body.ids if int(i) > 0]
    if not ids:
        return {"ok": True, "updated": 0}
    cfg = load_config()
    db_file = data_dir(cfg) / "printshelf.sqlite3"
    with db_session(db_file) as conn:
        placeholders = ",".join("?" for _ in ids)
        cur = conn.execute(
            f"UPDATE scan_issues SET ignored = 1, updated_at = ? WHERE id IN ({placeholders})",
            [utcnow(), *ids],
        )
        updated = int(cur.rowcount or 0)
    return {"ok": True, "updated": updated}


@app.post("/api/scan_issues/retry")
def retry_scan_issues(body: ScanIssueIdsIn | None = None) -> dict[str, Any]:
    cfg = load_config()
    db_file = data_dir(cfg) / "printshelf.sqlite3"
    issue_ids = [int(i) for i in (body.ids if body else []) if int(i) > 0]
    with db_session(db_file) as conn:
        if issue_ids:
            placeholders = ",".join("?" for _ in issue_ids)
            rows = conn.execute(
                f"SELECT DISTINCT root_id FROM scan_issues WHERE id IN ({placeholders})",
                issue_ids,
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT DISTINCT root_id FROM scan_issues WHERE COALESCE(resolved, 0) = 0 AND COALESCE(ignored, 0) = 0"
            ).fetchall()
        roots = sorted({str(r["root_id"] or "").strip() for r in rows if str(r["root_id"] or "").strip()})
        if issue_ids:
            conn.execute(
                f"UPDATE scan_issues SET ignored = 0, updated_at = ? WHERE id IN ({','.join('?' for _ in issue_ids)})",
                [utcnow(), *issue_ids],
            )
    if not roots:
        return {"ok": True, "restarted": False, "root_ids": []}
    state = start_scan_background(root_ids=roots)
    return {"ok": True, "restarted": True, "root_ids": roots, "scan": state}


def _clean_collection_mode(raw: str | None) -> str:
    mode = str(raw or "auto").strip().lower()
    if mode not in {"auto", "manual"}:
        raise HTTPException(400, "Collection mode must be 'auto' or 'manual'")
    return mode


def _clean_collection_name(raw: str | None) -> str:
    name = " ".join(str(raw or "").strip().split())
    if not name:
        raise HTTPException(400, "Collection name is required")
    return name[:120]


def _normalize_collection_rules(raw: dict[str, Any] | None) -> dict[str, Any]:
    src = raw or {}
    tags: list[str] = []
    seen: set[str] = set()
    for t in src.get("tags_any") or []:
        tag = " ".join(str(t or "").strip().split())
        if not tag:
            continue
        key = tag.lower()
        if key in seen:
            continue
        seen.add(key)
        tags.append(tag[:64])
        if len(tags) >= 24:
            break
    out = {
        "q": str(src.get("q") or "").strip()[:200],
        "kind": str(src.get("kind") or "").strip()[:40],
        "source_kind": str(src.get("source_kind") or "").strip()[:40],
        "root_id": str(src.get("root_id") or "").strip()[:100],
        "has_textures": src.get("has_textures") if src.get("has_textures") is not None else None,
        "is_sliced": src.get("is_sliced") if src.get("is_sliced") is not None else None,
        "tags_any": tags,
    }
    return out


def _collection_where_clause(collection_row: dict[str, Any] | None) -> tuple[str, list[Any]]:
    if not collection_row:
        return "", []
    mode = _clean_collection_mode(collection_row.get("mode"))
    if mode == "manual":
        cid = int(collection_row["id"])
        return "a.id IN (SELECT asset_id FROM collection_assets WHERE collection_id = ?)", [cid]

    rules = _normalize_collection_rules(
        parse_json_field(collection_row.get("rules_json"), {}) if collection_row.get("rules_json") else {}
    )
    clauses: list[str] = []
    params: list[Any] = []
    if rules.get("kind"):
        clauses.append("a.kind = ?")
        params.append(rules["kind"])
    if rules.get("source_kind"):
        clauses.append("a.source_kind = ?")
        params.append(rules["source_kind"])
    if rules.get("root_id"):
        clauses.append("a.root_id = ?")
        params.append(rules["root_id"])
    if rules.get("has_textures") is not None:
        clauses.append("a.has_textures = ?")
        params.append(1 if rules["has_textures"] else 0)
    if rules.get("is_sliced") is not None:
        clauses.append("a.is_sliced = ?")
        params.append(1 if rules["is_sliced"] else 0)
    if rules.get("q"):
        like = f"%{rules['q']}%"
        clauses.append(
            "(a.file_name LIKE ? OR a.rel_path LIKE ? OR d.name LIKE ? OR d.notes LIKE ? OR d.tags_json LIKE ?)"
        )
        params.extend([like, like, like, like, like])
    for tag in rules.get("tags_any") or []:
        clauses.append("d.tags_json LIKE ?")
        params.append(f'%"{tag}"%')
    if not clauses:
        return "", []
    return "(" + " AND ".join(clauses) + ")", params


def _get_collection_row(conn, collection_id: int | None) -> dict[str, Any] | None:
    if not collection_id:
        return None
    row = conn.execute(
        "SELECT id, name, mode, rules_json, created_at, updated_at FROM collections WHERE id = ?",
        (int(collection_id),),
    ).fetchone()
    if not row:
        raise HTTPException(404, "Collection not found")
    item = row_to_dict(row)
    assert item
    return item


def _serialize_collection_row(conn, row) -> dict[str, Any]:
    item = row_to_dict(row)
    assert item
    item["mode"] = _clean_collection_mode(item.get("mode"))
    item["rules"] = _normalize_collection_rules(parse_json_field(item.pop("rules_json", "{}"), {}))
    cid = int(item["id"])
    c_where, c_params = _collection_where_clause(
        {"id": cid, "mode": item["mode"], "rules_json": json.dumps(item["rules"])}
    )
    where = c_where or "1=1"
    item["asset_count"] = int(
        conn.execute(
            f"SELECT COUNT(*) AS c FROM assets a JOIN designs d ON d.id = a.design_id "
            f"WHERE a.missing = 0 AND COALESCE(a.hidden, 0) = 0 AND {where}",
            c_params,
        ).fetchone()["c"]
    )
    return item


def _asset_visibility_clauses(
    *,
    missing: bool = False,
    hidden: bool | None = False,
    kind: str | None = None,
    kinds: list[str] | None = None,
    source_kind: str | None = None,
    has_textures: bool | None = None,
    is_sliced: bool | None = None,
    q: str | None = None,
    root_id: str | None = None,
    filament_id: int | None = None,
    duplicates: bool = False,
    collection_where: str | None = None,
    collection_params: list[Any] | None = None,
) -> tuple[list[str], list[Any]]:
    clauses = ["a.missing = ?"]
    params: list[Any] = [1 if missing else 0]
    if hidden is None:
        pass
    elif hidden:
        clauses.append("COALESCE(a.hidden, 0) = 1")
    else:
        clauses.append("COALESCE(a.hidden, 0) = 0")
    if kind:
        clauses.append("a.kind = ?")
        params.append(kind)
    if kinds:
        clean = [str(k).strip() for k in kinds if str(k).strip()]
        if clean:
            placeholders = ",".join("?" for _ in clean)
            clauses.append(f"a.kind IN ({placeholders})")
            params.extend(clean)
    if source_kind:
        clauses.append("a.source_kind = ?")
        params.append(source_kind)
    if has_textures is not None:
        clauses.append("a.has_textures = ?")
        params.append(1 if has_textures else 0)
    if is_sliced is not None:
        clauses.append("a.is_sliced = ?")
        params.append(1 if is_sliced else 0)
    if root_id:
        clauses.append("a.root_id = ?")
        params.append(root_id)
    if filament_id is not None:
        clauses.append("a.assigned_filament_id = ?")
        params.append(int(filament_id))
    if collection_where:
        clauses.append(collection_where)
        params.extend(collection_params or [])
    if duplicates:
        clauses.append(
            """a.content_hash IS NOT NULL AND TRIM(a.content_hash) != ''
               AND a.content_hash IN (
                 SELECT content_hash FROM assets
                 WHERE missing = 0 AND COALESCE(hidden, 0) = 0
                   AND content_hash IS NOT NULL AND TRIM(content_hash) != ''
                 GROUP BY content_hash HAVING COUNT(*) > 1
               )"""
        )
    if q:
        clauses.append(
            "(a.file_name LIKE ? OR a.rel_path LIKE ? OR d.name LIKE ?"
            " OR d.notes LIKE ? OR d.tags_json LIKE ?)"
        )
        like = f"%{q}%"
        params.extend([like, like, like, like, like])
    return clauses, params


def _normalize_folder(folder: str | None) -> str:
    raw = (folder or "").replace("\\", "/").strip("/")
    if ".." in raw.split("/"):
        raise HTTPException(400, "Invalid folder path")
    return raw


def _parse_kinds_csv(raw: str | None) -> list[str]:
    if not raw:
        return []
    out: list[str] = []
    seen: set[str] = set()
    for part in str(raw).split(","):
        k = part.strip().lower()
        if not k or k in seen:
            continue
        seen.add(k)
        out.append(k[:24])
        if len(out) >= 24:
            break
    return out


@app.get("/api/browse")
def browse_library(
    root_id: str | None = None,
    folder: str = "",
    q: str | None = None,
    kind: str | None = None,
    kinds: str | None = None,
    source_kind: str | None = None,
    has_textures: bool | None = None,
    is_sliced: bool | None = None,
    filament_id: int | None = None,
    collection_id: int | None = None,
    hidden: bool | None = False,
    limit: int = Query(500, ge=1, le=1000),
) -> dict[str, Any]:
    """Folder browser: watched roots → relative folders → files in the current folder."""
    cfg = load_config()
    db_file = data_dir(cfg) / "printshelf.sqlite3"
    folder = _normalize_folder(folder)
    watched = {f.get("id"): f for f in (cfg.get("watched_folders") or []) if f.get("id")}

    with db_session(db_file) as conn:
        coll = _get_collection_row(conn, collection_id) if collection_id else None
    c_where, c_params = _collection_where_clause(coll)
    kind_list = _parse_kinds_csv(kinds)
    clauses, params = _asset_visibility_clauses(
        hidden=hidden,
        kind=kind,
        kinds=kind_list,
        source_kind=source_kind,
        has_textures=has_textures,
        is_sliced=is_sliced,
        q=q,
        root_id=root_id,
        filament_id=filament_id,
        collection_where=c_where or None,
        collection_params=c_params,
    )
    where = " AND ".join(clauses)

    # Top level: list watched roots with counts
    if not root_id:
        with db_session(db_file) as conn:
            rows = conn.execute(
                f"""SELECT a.root_id, a.source_kind, COUNT(*) AS c
                    FROM assets a
                    JOIN designs d ON d.id = a.design_id
                    WHERE {where}
                    GROUP BY a.root_id, a.source_kind
                    ORDER BY a.root_id""",
                params,
            ).fetchall()
        roots = []
        for r in rows:
            rid = r["root_id"]
            wf = watched.get(rid) or {}
            roots.append({
                "id": rid,
                "label": wf.get("label") or rid,
                "path": wf.get("path") or "",
                "source_kind": r["source_kind"] or wf.get("source_kind") or "local",
                "asset_count": int(r["c"] or 0),
            })
        return {
            "mode": "roots",
            "root_id": None,
            "folder": "",
            "crumbs": [{"label": "Library", "root_id": None, "folder": ""}],
            "roots": roots,
            "folders": [],
            "items": [],
            "total_files": sum(x["asset_count"] for x in roots),
        }

    if root_id not in watched and root_id not in {r.get("id") for r in (cfg.get("watched_folders") or [])}:
        # Still allow browse if assets reference a root_id even if config drifted
        pass

    with db_session(db_file) as conn:
        rows = conn.execute(
            f"""SELECT a.rel_path, a.id, a.file_name, a.kind, a.source_kind, a.root_id,
                       a.root_path, a.abs_path, a.size_bytes, a.content_hash, a.thumb_path,
                       a.triangle_count, a.has_textures, a.is_sliced, a.hidden, a.meta_json,
                       a.bbox_json, a.last_seen, d.name AS design_name, d.tags_json
                FROM assets a
                JOIN designs d ON d.id = a.design_id
                WHERE {where}
                ORDER BY a.file_name ASC""",
            params,
        ).fetchall()

    prefix = f"{folder}/" if folder else ""
    subfolders: dict[str, int] = {}
    file_rows = []
    for r in rows:
        rel = (r["rel_path"] or "").replace("\\", "/").lstrip("/")
        if folder:
            if rel == folder:
                # odd: asset path equals folder name (file without parent) — treat as file
                file_rows.append(r)
                continue
            if not rel.startswith(prefix):
                continue
            rest = rel[len(prefix):]
        else:
            rest = rel
        if not rest:
            continue
        if "/" in rest:
            child = rest.split("/", 1)[0]
            if child:
                subfolders[child] = subfolders.get(child, 0) + 1
        else:
            file_rows.append(r)

    folder_list = [
        {
            "name": name,
            "folder": f"{folder}/{name}".strip("/") if folder else name,
            "asset_count": count,
        }
        for name, count in sorted(subfolders.items(), key=lambda x: x[0].lower())
    ]

    thumbs = data_dir(cfg) / "thumbs"
    items = []
    for r in file_rows[:limit]:
        item = row_to_dict(r)
        assert item
        item["meta"] = parse_json_field(item.pop("meta_json", "{}"), {})
        item["bbox"] = parse_json_field(item.pop("bbox_json", None), None)
        item["tags"] = parse_json_field(item.pop("tags_json", "[]"), [])
        item["thumb_path"] = resolve_thumb_name(
            thumbs,
            thumb_path=item.get("thumb_path"),
            content_hash=item.get("content_hash"),
            kind=item.get("kind"),
        )
        items.append(item)

    wf = watched.get(root_id) or {}
    crumbs = [{"label": "Library", "root_id": None, "folder": ""}]
    crumbs.append({
        "label": wf.get("label") or root_id,
        "root_id": root_id,
        "folder": "",
    })
    if folder:
        parts = folder.split("/")
        acc = []
        for part in parts:
            acc.append(part)
            crumbs.append({
                "label": part,
                "root_id": root_id,
                "folder": "/".join(acc),
            })

    return {
        "mode": "folder",
        "root_id": root_id,
        "folder": folder,
        "crumbs": crumbs,
        "roots": [],
        "folders": folder_list,
        "items": items,
        "total_files": len(file_rows),
        "truncated": len(file_rows) > limit,
    }


_COVER_KIND_RANK = {
    "3mf": 0,
    "gcode.3mf": 1,
    "stl": 2,
    "obj": 3,
    "gcode": 4,
    "zip": 5,
}


def _cover_rank(kind: str | None) -> int:
    return _COVER_KIND_RANK.get(str(kind or ""), 99)


def _serialize_design_row(
    conn,
    row,
    *,
    thumbs: Path,
    include_assets: bool = False,
) -> dict[str, Any]:
    item = row_to_dict(row)
    assert item
    design_id = int(item["id"])
    item["tags"] = parse_json_field(item.pop("tags_json", "[]"), [])
    assets = [
        row_to_dict(a)
        for a in conn.execute(
            """SELECT id, kind, file_name, rel_path, abs_path, root_id, source_kind,
                      size_bytes, content_hash, thumb_path, has_textures, is_sliced,
                      triangle_count, hidden, last_seen
               FROM assets
               WHERE design_id = ? AND missing = 0 AND COALESCE(hidden, 0) = 0
               ORDER BY kind ASC, file_name ASC""",
            (design_id,),
        ).fetchall()
    ]
    assets = [a for a in assets if a]
    for a in assets:
        a["thumb_path"] = resolve_thumb_name(
            thumbs,
            thumb_path=a.get("thumb_path"),
            content_hash=a.get("content_hash"),
            kind=a.get("kind"),
        )
    cover = None
    if assets:
        cover = sorted(assets, key=lambda a: (_cover_rank(a.get("kind")), str(a.get("file_name") or "")))[0]
    kinds = sorted({str(a.get("kind")) for a in assets if a.get("kind")})
    item["asset_count"] = len(assets)
    item["kinds"] = kinds
    item["has_textures"] = any(bool(a.get("has_textures")) for a in assets)
    item["is_sliced"] = any(bool(a.get("is_sliced")) for a in assets)
    item["thumb_path"] = cover.get("thumb_path") if cover else None
    item["cover_asset_id"] = cover.get("id") if cover else None
    item["cover_kind"] = cover.get("kind") if cover else None
    item["root_id"] = cover.get("root_id") if cover else None
    item["source_kind"] = cover.get("source_kind") if cover else None
    item["rel_folder"] = str(Path(str(cover.get("rel_path") or "")).parent).replace("\\", "/") if cover else ""
    if item["rel_folder"] == ".":
        item["rel_folder"] = ""
    if include_assets:
        item["assets"] = assets
        item["notes"] = item.get("notes") or ""
    else:
        item.pop("notes", None)
    return item


@app.get("/api/designs")
def list_designs(
    q: str | None = None,
    kind: str | None = None,
    kinds: str | None = None,
    source_kind: str | None = None,
    has_textures: bool | None = None,
    is_sliced: bool | None = None,
    hidden: bool | None = False,
    root_id: str | None = None,
    filament_id: int | None = None,
    collection_id: int | None = None,
    sort: str | None = None,
    limit: int = Query(200, ge=1, le=500),
    offset: int = Query(0, ge=0),
) -> dict[str, Any]:
    """Design-centric catalogue: one card per grouped printable pack."""
    cfg = load_config()
    db_file = data_dir(cfg) / "printshelf.sqlite3"
    with db_session(db_file) as conn:
        coll = _get_collection_row(conn, collection_id) if collection_id else None
    c_where, c_params = _collection_where_clause(coll)
    kind_list = _parse_kinds_csv(kinds)
    # Visible assets drive which designs appear.
    asset_clauses = ["a.missing = 0"]
    params: list[Any] = []
    if hidden is None:
        pass
    elif hidden:
        asset_clauses.append("COALESCE(a.hidden, 0) = 1")
    else:
        asset_clauses.append("COALESCE(a.hidden, 0) = 0")
    if kind:
        asset_clauses.append("a.kind = ?")
        params.append(kind)
    if kind_list:
        placeholders = ",".join("?" for _ in kind_list)
        asset_clauses.append(f"a.kind IN ({placeholders})")
        params.extend(kind_list)
    if source_kind:
        asset_clauses.append("a.source_kind = ?")
        params.append(source_kind)
    if root_id:
        asset_clauses.append("a.root_id = ?")
        params.append(root_id)
    if has_textures is not None:
        asset_clauses.append("a.has_textures = ?")
        params.append(1 if has_textures else 0)
    if is_sliced is not None:
        asset_clauses.append("a.is_sliced = ?")
        params.append(1 if is_sliced else 0)
    if filament_id is not None:
        asset_clauses.append("a.assigned_filament_id = ?")
        params.append(int(filament_id))
    if c_where:
        asset_clauses.append(c_where)
        params.extend(c_params)
    where_assets = " AND ".join(asset_clauses)

    design_clauses = [f"EXISTS (SELECT 1 FROM assets a WHERE a.design_id = d.id AND {where_assets})"]
    design_params: list[Any] = list(params)
    if q:
        design_clauses.append(
            """(
              d.name LIKE ? OR d.notes LIKE ? OR d.tags_json LIKE ?
              OR EXISTS (
                SELECT 1 FROM assets a2
                WHERE a2.design_id = d.id AND a2.missing = 0
                  AND (a2.file_name LIKE ? OR a2.rel_path LIKE ?)
              )
            )"""
        )
        like = f"%{q}%"
        design_params.extend([like, like, like, like, like])
    where = " AND ".join(design_clauses)

    order = {
        "name": "d.name ASC, d.id ASC",
        "name_desc": "d.name DESC, d.id DESC",
        "seen": "d.updated_at DESC, d.name ASC",
        "assets": "asset_count DESC, d.name ASC",
    }.get((sort or "seen").strip().lower(), "d.updated_at DESC, d.name ASC")

    sql = f"""
      SELECT d.*,
        (SELECT COUNT(*) FROM assets a
         WHERE a.design_id = d.id AND {where_assets}) AS asset_count
      FROM designs d
      WHERE {where}
      ORDER BY {order}
      LIMIT ? OFFSET ?
    """
    # Placeholder order: asset_count subquery, then EXISTS (+ optional q), then limit/offset.
    select_params = list(params) + list(design_params) + [limit, offset]

    with db_session(db_file) as conn:
        rows = conn.execute(sql, select_params).fetchall()
        total = conn.execute(
            f"SELECT COUNT(*) AS c FROM designs d WHERE {where}",
            design_params,
        ).fetchone()["c"]
        thumbs = data_dir(cfg) / "thumbs"
        items = [_serialize_design_row(conn, r, thumbs=thumbs) for r in rows]
    return {"total": total, "items": items}


@app.get("/api/designs/{design_id}")
def get_design(design_id: int) -> dict[str, Any]:
    cfg = load_config()
    db_file = data_dir(cfg) / "printshelf.sqlite3"
    with db_session(db_file) as conn:
        row = conn.execute("SELECT * FROM designs WHERE id = ?", (design_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Design not found")
        item = _serialize_design_row(
            conn, row, thumbs=data_dir(cfg) / "thumbs", include_assets=True
        )
    if not item.get("asset_count"):
        raise HTTPException(404, "Design has no visible assets")
    return item


@app.patch("/api/designs/{design_id}")
def patch_design(design_id: int, body: DesignMetaIn) -> dict[str, Any]:
    if body.notes is None and body.tags is None:
        raise HTTPException(400, "Provide notes and/or tags")
    cfg = load_config()
    db_file = data_dir(cfg) / "printshelf.sqlite3"
    with db_session(db_file) as conn:
        row = conn.execute("SELECT id FROM designs WHERE id = ?", (design_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Design not found")
        fields: list[str] = []
        params: list[Any] = []
        if body.notes is not None:
            fields.append("notes = ?")
            params.append(str(body.notes)[:8000])
        if body.tags is not None:
            cleaned: list[str] = []
            seen: set[str] = set()
            for raw in body.tags:
                tag = " ".join(str(raw or "").strip().split())
                if not tag:
                    continue
                key = tag.lower()
                if key in seen:
                    continue
                seen.add(key)
                cleaned.append(tag[:64])
                if len(cleaned) >= 24:
                    break
            fields.append("tags_json = ?")
            params.append(json.dumps(cleaned))
        fields.append("updated_at = ?")
        params.append(utcnow())
        params.append(design_id)
        conn.execute(f"UPDATE designs SET {', '.join(fields)} WHERE id = ?", params)
    return get_design(design_id)


@app.get("/api/assets")
def list_assets(
    q: str | None = None,
    kind: str | None = None,
    kinds: str | None = None,
    source_kind: str | None = None,
    has_textures: bool | None = None,
    is_sliced: bool | None = None,
    missing: bool = False,
    hidden: bool | None = False,
    root_id: str | None = None,
    filament_id: int | None = None,
    collection_id: int | None = None,
    duplicates: bool = False,
    sort: str | None = None,
    limit: int = Query(200, ge=1, le=500),
    offset: int = Query(0, ge=0),
) -> dict[str, Any]:
    cfg = load_config()
    db_file = data_dir(cfg) / "printshelf.sqlite3"
    with db_session(db_file) as conn:
        coll = _get_collection_row(conn, collection_id) if collection_id else None
    c_where, c_params = _collection_where_clause(coll)
    kind_list = _parse_kinds_csv(kinds)
    clauses, params = _asset_visibility_clauses(
        missing=missing,
        hidden=hidden,
        kind=kind,
        kinds=kind_list,
        source_kind=source_kind,
        has_textures=has_textures,
        is_sliced=is_sliced,
        q=q,
        root_id=root_id,
        filament_id=filament_id,
        duplicates=duplicates,
        collection_where=c_where or None,
        collection_params=c_params,
    )
    where = " AND ".join(clauses)
    order = (
        "a.content_hash ASC, a.file_name ASC, a.rel_path ASC"
        if duplicates
        else _ASSET_SORT.get((sort or "seen").strip().lower(), _ASSET_SORT["seen"])
    )
    sql = f"""
      SELECT a.*, d.name AS design_name, d.tags_json,
        (SELECT COUNT(*) FROM assets x
         WHERE x.content_hash = a.content_hash
           AND x.missing = 0 AND COALESCE(x.hidden, 0) = 0) AS copy_count
      FROM assets a
      JOIN designs d ON d.id = a.design_id
      WHERE {where}
      ORDER BY {order}
      LIMIT ? OFFSET ?
    """
    params.extend([limit, offset])
    with db_session(db_file) as conn:
        rows = conn.execute(sql, params).fetchall()
        total = conn.execute(
            f"SELECT COUNT(*) AS c FROM assets a JOIN designs d ON d.id = a.design_id WHERE {where}",
            params[:-2],
        ).fetchone()["c"]
    thumbs = data_dir(cfg) / "thumbs"
    items = []
    for r in rows:
        item = row_to_dict(r)
        assert item
        item["meta"] = parse_json_field(item.pop("meta_json", "{}"), {})
        item["bbox"] = parse_json_field(item.pop("bbox_json", None), None)
        item["tags"] = parse_json_field(item.pop("tags_json", "[]"), [])
        item["copy_count"] = int(item.get("copy_count") or 0)
        resolved = resolve_thumb_name(
            thumbs,
            thumb_path=item.get("thumb_path"),
            content_hash=item.get("content_hash"),
            kind=item.get("kind"),
        )
        item["thumb_path"] = resolved
        items.append(item)
    return {"total": total, "items": items, "duplicates": duplicates}


@app.get("/api/assets/{asset_id}")
def get_asset(asset_id: int) -> dict[str, Any]:
    cfg = load_config()
    db_file = data_dir(cfg) / "printshelf.sqlite3"
    with db_session(db_file) as conn:
        row = conn.execute(
            """SELECT a.*, d.name AS design_name, d.notes AS design_notes, d.tags_json
               FROM assets a JOIN designs d ON d.id = a.design_id
               WHERE a.id = ?""",
            (asset_id,),
        ).fetchone()
        if not row:
            raise HTTPException(404, "Asset not found")
        sidecars = [
            row_to_dict(s)
            for s in conn.execute(
                "SELECT * FROM sidecars WHERE asset_id = ? ORDER BY role, file_name",
                (asset_id,),
            ).fetchall()
        ]
        filament_row = None
        if row and row["assigned_filament_id"]:
            filament_row = conn.execute(
                "SELECT id, name, brand, material, colour_hex, notes, created_at, updated_at "
                "FROM filaments WHERE id = ?",
                (int(row["assigned_filament_id"]),),
            ).fetchone()
    item = row_to_dict(row)
    assert item
    item["meta"] = parse_json_field(item.pop("meta_json", "{}"), {})
    item["bbox"] = parse_json_field(item.pop("bbox_json", None), None)
    item["tags"] = parse_json_field(item.pop("tags_json", "[]"), [])
    item["sidecars"] = sidecars
    item["assigned_filament"] = row_to_dict(filament_row) if filament_row else None
    folders = list(cfg.get("watched_folders") or [])
    abs_path = str(item.get("abs_path") or "")
    item["windows_path"] = to_windows_path(abs_path, folders)
    item["windows_folder"] = to_windows_folder(abs_path, folders)
    kind = item.get("kind")
    meta = item.get("meta") or {}
    nested = list(meta.get("nested_zips") or [])
    if not nested and kind == "zip":
        # Pre-rescan indexes only have entries — derive nested zip names live.
        nested = [
            e for e in (meta.get("entries") or [])
            if str((e or {}).get("name") or "").lower().endswith(".zip")
        ]
        if nested:
            meta = {**meta, "nested_zips": nested, "nested_zip_count": len(nested)}
            item["meta"] = meta
    nested_n = int(meta.get("nested_zip_count") or len(nested))
    if kind in ("3mf", "gcode.3mf"):
        # gcode.3mf often has plate thumbs but no mesh — don't claim orbit works.
        item["can_orbit"] = bool(meta.get("has_mesh")) or bool(item.get("triangle_count"))
    else:
        item["can_orbit"] = kind in ("stl", "obj") or (
            kind == "zip" and (int(meta.get("printable_count") or 0) > 0 or nested_n > 0)
        )
    item["has_nested_zips"] = nested_n > 0
    item["thumb_path"] = resolve_thumb_name(
        data_dir(cfg) / "thumbs",
        thumb_path=item.get("thumb_path"),
        content_hash=item.get("content_hash"),
        kind=kind,
    )
    item["has_plate_preview"] = bool(item.get("thumb_path")) and kind in ("3mf", "gcode.3mf", "gcode")
    item["suggested_printer"] = _suggest_printer_hint(item)
    item["hidden"] = bool(item.get("hidden"))
    return item


def _suggest_printer_hint(item: dict[str, Any]) -> dict[str, Any] | None:
    """Soft hint for Print this — never a hard lock. From 3MF settings + path folder."""
    meta = item.get("meta") or {}
    model = str(meta.get("printer_model") or meta.get("printer_settings_id") or "").strip()
    path = str(item.get("rel_path") or item.get("abs_path") or "")
    folders = [p for p in path.replace("\\", "/").split("/") if p]
    folder_hint = ""
    for part in reversed(folders[:-1]):
        low = part.lower()
        if re.search(r"\b(h2[cd]|x1[ce]|p1[sp]|a1[\s_-]?mini|a1|voron)\b", low):
            folder_hint = part
            break
    if not model and not folder_hint:
        return None
    return {
        "printer_model": model or None,
        "folder_hint": folder_hint or None,
        "label": model or folder_hint,
    }


@app.patch("/api/assets/{asset_id}/design")
def patch_asset_design(asset_id: int, body: DesignMetaIn) -> dict[str, Any]:
    """Update notes/tags on the design that owns this asset."""
    if body.notes is None and body.tags is None:
        raise HTTPException(400, "Provide notes and/or tags")
    cfg = load_config()
    db_file = data_dir(cfg) / "printshelf.sqlite3"
    with db_session(db_file) as conn:
        row = conn.execute(
            "SELECT design_id FROM assets WHERE id = ?",
            (asset_id,),
        ).fetchone()
        if not row:
            raise HTTPException(404, "Asset not found")
        design_id = int(row["design_id"])
        fields: list[str] = []
        params: list[Any] = []
        if body.notes is not None:
            fields.append("notes = ?")
            params.append(str(body.notes)[:8000])
        if body.tags is not None:
            cleaned: list[str] = []
            seen: set[str] = set()
            for raw in body.tags:
                tag = " ".join(str(raw or "").strip().split())
                if not tag:
                    continue
                key = tag.lower()
                if key in seen:
                    continue
                seen.add(key)
                cleaned.append(tag[:64])
                if len(cleaned) >= 24:
                    break
            fields.append("tags_json = ?")
            params.append(json.dumps(cleaned))
        fields.append("updated_at = ?")
        params.append(utcnow())
        params.append(design_id)
        conn.execute(
            f"UPDATE designs SET {', '.join(fields)} WHERE id = ?",
            params,
        )
    return get_asset(asset_id)


def _load_asset_or_404(asset_id: int) -> dict[str, Any]:
    cfg = load_config()
    db_file = data_dir(cfg) / "printshelf.sqlite3"
    with db_session(db_file) as conn:
        row = conn.execute("SELECT * FROM assets WHERE id = ?", (asset_id,)).fetchone()
    item = row_to_dict(row)
    if not item:
        raise HTTPException(404, "Asset not found")
    return item


def _asset_copies(conn, asset: dict[str, Any]) -> list[dict[str, Any]]:
    """Other indexed copies of the same bytes (same content hash), still visible."""
    content_hash = str(asset.get("content_hash") or "").strip()
    asset_id = int(asset.get("id") or 0)
    if not content_hash or not asset_id:
        return []
    rows = conn.execute(
        """SELECT id, file_name, rel_path, abs_path, root_id, size_bytes, kind,
                  content_hash, thumb_path
           FROM assets
           WHERE missing = 0
             AND content_hash = ?
             AND id != ?
           ORDER BY root_id, rel_path""",
        (content_hash, asset_id),
    ).fetchall()
    return [row_to_dict(r) for r in rows if row_to_dict(r)]


def _delete_asset_disk(
    asset_id: int,
    delete_sidecars: bool = True,
    delete_duplicates: bool = False,
) -> dict[str, Any]:
    """Delete one asset from disk + DB. Raises HTTPException on hard failures."""
    asset = _load_asset_or_404(asset_id)
    abs_path = str(asset.get("abs_path") or "")
    if not path_under_watched(abs_path):
        raise HTTPException(403, "File is outside watched folders")

    cfg = load_config()
    db_file = data_dir(cfg) / "printshelf.sqlite3"

    with db_session(db_file) as conn:
        copies = _asset_copies(conn, asset)

    targets = [asset]
    if delete_duplicates and copies:
        targets.extend(copies)

    deleted_ids: list[int] = []
    deleted_files: list[str] = []
    errors: list[str] = []
    remaining_copies: list[dict[str, Any]] = []

    for target in targets:
        tid = int(target["id"])
        t_abs = str(target.get("abs_path") or "")
        if not t_abs:
            errors.append(f"id {tid}: missing abs_path")
            continue
        if not path_under_watched(t_abs):
            errors.append(f"id {tid}: outside watched folders")
            continue

        with db_session(db_file) as conn:
            sidecars = [
                row_to_dict(s)
                for s in conn.execute(
                    "SELECT * FROM sidecars WHERE asset_id = ?",
                    (tid,),
                ).fetchall()
            ]

        paths_to_delete = [t_abs]
        if delete_sidecars:
            for sc in sidecars:
                p = str((sc or {}).get("abs_path") or "")
                if p:
                    paths_to_delete.append(p)

        for p in paths_to_delete:
            path = Path(p)
            try:
                if not path.exists():
                    continue
                if not path_under_watched(str(path.resolve())):
                    if p != t_abs:
                        errors.append(f"skipped (outside watched folders): {p}")
                        continue
                    raise HTTPException(403, "File is outside watched folders")
                path.unlink()
                deleted_files.append(p)
            except HTTPException:
                raise
            except Exception as exc:
                errors.append(f"{p}: {exc}")

        # Re-check after unlink — CIFS can lie if we don't verify.
        still = Path(t_abs)
        if still.exists():
            errors.append(f"still on disk after unlink: {t_abs}")
            continue

        thumb = target.get("thumb_path")
        if thumb and str(thumb) != SHARED_ZIP_THUMB and not str(thumb).startswith("_shared_"):
            try:
                (data_dir(cfg) / "thumbs" / str(thumb)).unlink(missing_ok=True)
            except Exception:
                pass
        content_hash = str(target.get("content_hash") or "")[:20]
        if content_hash:
            prev_dir = data_dir(cfg) / "previews"
            if prev_dir.exists():
                for f in prev_dir.glob(f"{content_hash}_*.stl"):
                    try:
                        f.unlink(missing_ok=True)
                    except Exception:
                        pass

        with db_session(db_file) as conn:
            conn.execute("DELETE FROM assets WHERE id = ?", (tid,))
        deleted_ids.append(tid)

    if asset_id not in deleted_ids:
        raise HTTPException(
            500,
            f"Could not delete file on disk: {'; '.join(errors) or abs_path}",
        )

    if not delete_duplicates:
        # Refresh remaining copies after primary delete.
        with db_session(db_file) as conn:
            remaining_copies = _asset_copies(conn, {**asset, "id": asset_id})

    return {
        "ok": True,
        "id": asset_id,
        "deleted": deleted_ids,
        "deleted_count": len(deleted_ids),
        "deleted_files": deleted_files,
        "errors": errors,
        "file_name": asset.get("file_name"),
        "other_copies": remaining_copies,
        "other_copies_count": len(remaining_copies),
    }


# Bulk routes must be registered before /api/assets/{asset_id}/... or "bulk" is parsed as an id.
@app.post("/api/assets/bulk/hide")
def bulk_hide(body: BulkIdsIn) -> dict[str, Any]:
    ids = sorted({int(i) for i in body.ids if int(i) > 0})
    if not ids:
        return {"ok": True, "updated": 0, "ids": []}
    cfg = load_config()
    db_file = data_dir(cfg) / "printshelf.sqlite3"
    placeholders = ",".join("?" for _ in ids)
    with db_session(db_file) as conn:
        cur = conn.execute(
            f"UPDATE assets SET hidden = 1 WHERE id IN ({placeholders})",
            ids,
        )
        updated = cur.rowcount or 0
    return {"ok": True, "updated": updated, "ids": ids}


@app.post("/api/assets/bulk/unhide")
def bulk_unhide(body: BulkIdsIn) -> dict[str, Any]:
    ids = sorted({int(i) for i in body.ids if int(i) > 0})
    if not ids:
        return {"ok": True, "updated": 0, "ids": []}
    cfg = load_config()
    db_file = data_dir(cfg) / "printshelf.sqlite3"
    placeholders = ",".join("?" for _ in ids)
    with db_session(db_file) as conn:
        cur = conn.execute(
            f"UPDATE assets SET hidden = 0 WHERE id IN ({placeholders})",
            ids,
        )
        updated = cur.rowcount or 0
    return {"ok": True, "updated": updated, "ids": ids}


@app.post("/api/designs/{design_id}/hide")
def hide_design(design_id: int) -> dict[str, Any]:
    if design_id <= 0:
        raise HTTPException(400, "Invalid design id")
    cfg = load_config()
    db_file = data_dir(cfg) / "printshelf.sqlite3"
    with db_session(db_file) as conn:
        row = conn.execute("SELECT id FROM designs WHERE id = ?", (design_id,)).fetchone()
        target_design_id = int(row["id"]) if row else 0
        if not target_design_id:
            # Compatibility fallback: older clients could send asset ids.
            a = conn.execute("SELECT design_id FROM assets WHERE id = ?", (design_id,)).fetchone()
            if not a:
                raise HTTPException(404, "Design not found")
            target_design_id = int(a["design_id"])
        cur = conn.execute("UPDATE assets SET hidden = 1 WHERE design_id = ?", (target_design_id,))
        updated = cur.rowcount or 0
    return {"ok": True, "updated": updated, "design_id": target_design_id}


@app.post("/api/designs/{design_id}/unhide")
def unhide_design(design_id: int) -> dict[str, Any]:
    if design_id <= 0:
        raise HTTPException(400, "Invalid design id")
    cfg = load_config()
    db_file = data_dir(cfg) / "printshelf.sqlite3"
    with db_session(db_file) as conn:
        row = conn.execute("SELECT id FROM designs WHERE id = ?", (design_id,)).fetchone()
        target_design_id = int(row["id"]) if row else 0
        if not target_design_id:
            # Compatibility fallback: older clients could send asset ids.
            a = conn.execute("SELECT design_id FROM assets WHERE id = ?", (design_id,)).fetchone()
            if not a:
                raise HTTPException(404, "Design not found")
            target_design_id = int(a["design_id"])
        cur = conn.execute("UPDATE assets SET hidden = 0 WHERE design_id = ?", (target_design_id,))
        updated = cur.rowcount or 0
    return {"ok": True, "updated": updated, "design_id": target_design_id}


@app.post("/api/designs/hide-bulk")
def bulk_hide_designs(body: BulkIdsIn) -> dict[str, Any]:
    ids = sorted({int(i) for i in body.ids if int(i) > 0})
    if not ids:
        return {"ok": True, "updated": 0, "ids": []}
    cfg = load_config()
    db_file = data_dir(cfg) / "printshelf.sqlite3"
    with db_session(db_file) as conn:
        design_ids: set[int] = set(ids)
        placeholders = ",".join("?" for _ in ids)
        # Compatibility fallback: if ids are actually asset ids, hide owning designs.
        mapped = conn.execute(
            f"SELECT DISTINCT design_id FROM assets WHERE id IN ({placeholders})",
            ids,
        ).fetchall()
        for r in mapped:
            design_ids.add(int(r["design_id"]))
        if not design_ids:
            return {"ok": True, "updated": 0, "ids": ids}
        dids = sorted(design_ids)
        dplaceholders = ",".join("?" for _ in dids)
        cur = conn.execute(
            f"UPDATE assets SET hidden = 1 WHERE design_id IN ({dplaceholders})",
            dids,
        )
        updated = cur.rowcount or 0
    return {"ok": True, "updated": updated, "ids": ids}


@app.post("/api/designs/unhide-bulk")
def bulk_unhide_designs(body: BulkIdsIn) -> dict[str, Any]:
    ids = sorted({int(i) for i in body.ids if int(i) > 0})
    if not ids:
        return {"ok": True, "updated": 0, "ids": []}
    cfg = load_config()
    db_file = data_dir(cfg) / "printshelf.sqlite3"
    with db_session(db_file) as conn:
        design_ids: set[int] = set(ids)
        placeholders = ",".join("?" for _ in ids)
        # Compatibility fallback: if ids are actually asset ids, unhide owning designs.
        mapped = conn.execute(
            f"SELECT DISTINCT design_id FROM assets WHERE id IN ({placeholders})",
            ids,
        ).fetchall()
        for r in mapped:
            design_ids.add(int(r["design_id"]))
        if not design_ids:
            return {"ok": True, "updated": 0, "ids": ids}
        dids = sorted(design_ids)
        dplaceholders = ",".join("?" for _ in dids)
        cur = conn.execute(
            f"UPDATE assets SET hidden = 0 WHERE design_id IN ({dplaceholders})",
            dids,
        )
        updated = cur.rowcount or 0
    return {"ok": True, "updated": updated, "ids": ids}


@app.post("/api/assets/bulk/delete")
def bulk_delete(
    body: BulkIdsIn,
    delete_duplicates: bool = Query(False),
) -> dict[str, Any]:
    ids = sorted({int(i) for i in body.ids if int(i) > 0})
    deleted: list[int] = []
    failed: list[dict[str, Any]] = []
    for asset_id in ids:
        if asset_id in deleted:
            continue
        try:
            result = _delete_asset_disk(
                asset_id,
                delete_sidecars=True,
                delete_duplicates=delete_duplicates,
            )
            deleted.extend(int(x) for x in (result.get("deleted") or [asset_id]))
        except HTTPException as exc:
            failed.append({"id": asset_id, "error": str(exc.detail)})
        except Exception as exc:
            failed.append({"id": asset_id, "error": str(exc)})
    # de-dupe deleted ids
    deleted = sorted(set(deleted))

    # Fresh leftover count after the whole batch (not mid-loop snapshots).
    cfg = load_config()
    db_file = data_dir(cfg) / "printshelf.sqlite3"
    with db_session(db_file) as conn:
        leftover = conn.execute(
            """SELECT COUNT(*) AS c FROM assets a
               WHERE a.missing = 0 AND COALESCE(a.hidden, 0) = 0
                 AND a.content_hash IS NOT NULL AND TRIM(a.content_hash) != ''
                 AND a.content_hash IN (
                   SELECT content_hash FROM assets
                   WHERE missing = 0 AND COALESCE(hidden, 0) = 0
                     AND content_hash IS NOT NULL AND TRIM(content_hash) != ''
                   GROUP BY content_hash HAVING COUNT(*) > 1
                 )"""
        ).fetchone()["c"]

    return {
        "ok": not failed,
        "deleted": deleted,
        "deleted_count": len(deleted),
        "failed": failed,
        "other_copies": [],
        "other_copies_count": int(leftover or 0),
    }


@app.get("/api/assets/{asset_id}/copies")
def get_asset_copies(asset_id: int) -> dict[str, Any]:
    """List other library rows that share this file's content hash (duplicate copies)."""
    asset = _load_asset_or_404(asset_id)
    cfg = load_config()
    db_file = data_dir(cfg) / "printshelf.sqlite3"
    with db_session(db_file) as conn:
        copies = _asset_copies(conn, asset)
    return {
        "id": asset_id,
        "file_name": asset.get("file_name"),
        "content_hash": asset.get("content_hash"),
        "copies": copies,
        "copies_count": len(copies),
    }


@app.post("/api/assets/{asset_id}/open-slicer")
def open_asset_slicer(
    asset_id: int,
    entry: str | None = Query(None),
    target: str = Query("bambu_studio"),
) -> dict[str, Any]:
    """
    Open in desktop Bambu Studio / Orca via Flightdeck's Windows worker —
    same path as Flightdeck Slice handoff (exe + file path), not bambustudio:// URL-open.
    STL/OBJ get MakerDeck-style manifold check + sanitize before handoff.
    """
    try:
        result = open_asset_in_desktop_slicer(asset_id, entry=entry, target=target)
    except FileNotFoundError as exc:
        raise HTTPException(404, str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(403, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(503, str(exc)) from exc
    except Exception as exc:
        raise HTTPException(502, f"Slicer handoff failed: {exc}") from exc
    return {"ok": True, **(result if isinstance(result, dict) else {"result": result})}


@app.get("/api/assets/{asset_id}/manifold")
def asset_manifold(
    asset_id: int,
    entry: str | None = Query(None),
    repair: bool = Query(True),
) -> dict[str, Any]:
    """Dry-run manifold check (+ optional sanitize). Does not call the Windows worker."""
    try:
        return inspect_asset_manifold(asset_id, entry=entry, repair=repair)
    except FileNotFoundError as exc:
        raise HTTPException(404, str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(403, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    except Exception as exc:
        raise HTTPException(502, f"Manifold check failed: {exc}") from exc


@app.get("/api/slicer/status")
def slicer_status() -> dict[str, Any]:
    worker = resolve_worker_url()
    return {"ok": bool(worker), "worker_url": worker or None}


@app.get("/api/printers")
def list_printers() -> dict[str, Any]:
    """Proxy Flightdeck printers for Print this picker."""
    try:
        printers = list_flightdeck_printers()
    except RuntimeError as exc:
        raise HTTPException(503, str(exc)) from exc
    except Exception as exc:
        raise HTTPException(502, f"Could not reach Flightdeck printers: {exc}") from exc
    return {"ok": True, "printers": printers}


@app.post("/api/assets/{asset_id}/print")
def print_asset(
    asset_id: int,
    printer_id: str = Query(...),
    entry: str | None = Query(None),
    calibrate_before_start: bool = Query(False),
) -> dict[str, Any]:
    """
    Queue this file onto Flightdeck's print queue (auto-sends when the printer is free).
    Ready-to-print only: .3mf / .gcode.3mf (Bambu), .gcode (Voron). STL/OBJ → Open in slicer.
    """
    try:
        result = queue_asset_to_flightdeck(
            asset_id,
            printer_id=printer_id,
            entry=entry,
            calibrate_before_start=calibrate_before_start,
        )
    except FileNotFoundError as exc:
        raise HTTPException(404, str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(403, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(502, str(exc)) from exc
    except Exception as exc:
        raise HTTPException(502, f"Print handoff failed: {exc}") from exc
    return result


@app.post("/api/assets/{asset_id}/hide")
def hide_asset(asset_id: int) -> dict[str, Any]:
    """Hide from library; file stays on disk. Survives rescan."""
    asset = _load_asset_or_404(asset_id)
    cfg = load_config()
    db_file = data_dir(cfg) / "printshelf.sqlite3"
    with db_session(db_file) as conn:
        conn.execute("UPDATE assets SET hidden = 1 WHERE id = ?", (asset_id,))
    return {"ok": True, "id": asset_id, "hidden": True, "file_name": asset.get("file_name")}


@app.post("/api/assets/{asset_id}/unhide")
def unhide_asset(asset_id: int) -> dict[str, Any]:
    asset = _load_asset_or_404(asset_id)
    cfg = load_config()
    db_file = data_dir(cfg) / "printshelf.sqlite3"
    with db_session(db_file) as conn:
        conn.execute("UPDATE assets SET hidden = 0 WHERE id = ?", (asset_id,))
    return {"ok": True, "id": asset_id, "hidden": False, "file_name": asset.get("file_name")}


@app.post("/api/assets/{asset_id}/delete")
def delete_asset(
    asset_id: int,
    delete_sidecars: bool = Query(True),
    delete_duplicates: bool = Query(False),
) -> dict[str, Any]:
    """Permanently delete the file on disk (and indexed sidecars), then drop the DB row."""
    return _delete_asset_disk(
        asset_id,
        delete_sidecars=delete_sidecars,
        delete_duplicates=delete_duplicates,
    )


def _media_type_for_name(name: str) -> str:
    # Prefer octet-stream for mesh downloads — Bambu Studio’s HTTP client is
    # happier with a generic type + real filename.ext than model/stl / model/3mf.
    lower = (name or "").lower()
    if lower.endswith((".stl", ".obj", ".3mf", ".gcode.3mf")):
        return "application/octet-stream"
    if lower.endswith(".zip"):
        return "application/zip"
    guessed, _ = mimetypes.guess_type(name)
    return guessed or "application/octet-stream"


def _content_disposition(filename: str) -> str:
    # ASCII fallback + RFC 5987 filename* for Unicode names.
    safe = "".join(ch if 32 <= ord(ch) < 127 and ch not in '"\\' else "_" for ch in filename) or "download"
    return f"attachment; filename=\"{safe}\"; filename*=UTF-8''{quote(filename)}"


def _serve_asset_file(
    asset_id: int,
    entry: str | None = None,
    *,
    method: str = "GET",
    for_slicer: bool = False,
):
    """Stream the original file (or one printable inside a ZIP / nested ZIP) for slicer download/open."""
    asset = get_asset_row(asset_id)
    if not asset:
        raise HTTPException(404, "Asset not found")
    abs_path = str(asset.get("abs_path") or "")
    if not path_is_allowed(abs_path):
        raise HTTPException(403, "File is outside watched folders")
    src = Path(abs_path)
    if not src.is_file():
        raise HTTPException(404, "File missing on disk")

    kind = asset.get("kind") or ""
    head = method.upper() == "HEAD"

    # Bambu Studio URL-open only accepts .3mf — wrap STL/OBJ (and zip meshes) when asked.
    if for_slicer:
        try:
            raw, filename = build_slicer_3mf(asset, entry=entry)
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc
        except FileNotFoundError as exc:
            raise HTTPException(404, str(exc)) from exc
        except Exception as exc:
            raise HTTPException(500, f"Slicer package failed: {exc}") from exc
        headers = {
            "Content-Disposition": _content_disposition(filename).replace("attachment;", "inline;", 1),
            "Cache-Control": "private, max-age=120",
            "Content-Length": str(len(raw)),
            "Accept-Ranges": "bytes",
            "X-PrintShelf-Slicer": "3mf",
        }
        if head:
            return Response(content=b"", media_type="application/octet-stream", headers=headers)

        def _iter_slicer() -> Iterator[bytes]:
            view = memoryview(raw)
            step = 1024 * 1024
            for i in range(0, len(view), step):
                yield bytes(view[i : i + step])

        return StreamingResponse(_iter_slicer(), media_type="application/octet-stream", headers=headers)

    if entry:
        if kind != "zip":
            raise HTTPException(400, "entry= is only valid for ZIP assets")
        try:
            entry_name = safe_zip_entry(entry)
            nested, inner = split_nested_entry(entry_name)
            mesh_name = inner if nested else entry_name
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc
        if not entry_kind(mesh_name):
            raise HTTPException(400, "Zip entry is not a printable mesh (stl/obj/3mf)")
        try:
            raw, filename = read_zip_entry_bytes(src, entry_name)
        except FileNotFoundError as exc:
            raise HTTPException(404, str(exc)) from exc
        media = _media_type_for_name(filename)
        headers = {
            "Content-Disposition": _content_disposition(filename).replace("attachment;", "inline;", 1),
            "Cache-Control": "private, max-age=60",
            "Content-Length": str(len(raw)),
            "Accept-Ranges": "bytes",
            "X-PrintShelf-Zip-Entry": entry_name,
        }
        if head:
            return Response(content=b"", media_type=media, headers=headers)

        def _iter_bytes() -> Iterator[bytes]:
            # Already in memory (nested) or small enough; chunk for StreamingResponse.
            view = memoryview(raw)
            step = 1024 * 1024
            for i in range(0, len(view), step):
                yield bytes(view[i : i + step])

        return StreamingResponse(
            _iter_bytes(),
            media_type=media,
            headers=headers,
        )

    filename = asset.get("file_name") or src.name
    return FileResponse(
        src,
        media_type=_media_type_for_name(filename),
        filename=filename,
        content_disposition_type="inline",
        headers={
            "Cache-Control": "private, max-age=60",
            "Accept-Ranges": "bytes",
            "X-PrintShelf-Kind": kind,
        },
    )


@app.get("/api/assets/{asset_id}/nested")
def peek_nested_zip(
    asset_id: int,
    entry: str = Query(..., description="Nested .zip member path inside the outer archive"),
) -> dict[str, Any]:
    """List printables one level inside a nested ZIP (no extract to NAS)."""
    asset = get_asset_row(asset_id)
    if not asset:
        raise HTTPException(404, "Asset not found")
    if (asset.get("kind") or "") != "zip":
        raise HTTPException(400, "Only ZIP assets support nested peek")
    abs_path = str(asset.get("abs_path") or "")
    if not path_is_allowed(abs_path):
        raise HTTPException(403, "File is outside watched folders")
    src = Path(abs_path)
    if not src.is_file():
        raise HTTPException(404, "File missing on disk")
    try:
        return {"ok": True, **list_nested_zip(src, entry)}
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    except FileNotFoundError as exc:
        raise HTTPException(404, str(exc)) from exc
    except Exception as exc:
        raise HTTPException(500, f"Nested peek failed: {exc}") from exc


@app.post("/api/assets/{asset_id}/extract")
def extract_asset_printable(
    asset_id: int,
    entry: str = Query(..., description="Path inside the ZIP (or Nested.zip/inner.stl)"),
) -> dict[str, Any]:
    """
    Rescue a printable from a ZIP into PrintShelf Extracted on the NAS,
    index it, and return the new design/asset ids for the pretty card.
    """
    try:
        return extract_zip_printable(asset_id, entry)
    except FileNotFoundError as exc:
        raise HTTPException(404, str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(403, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    except Exception as exc:
        raise HTTPException(502, f"Extract failed: {exc}") from exc


@app.post("/api/assets/{asset_id}/extract-all")
def extract_all_asset_printables(asset_id: int) -> dict[str, Any]:
    """
    Rescue all printables from a ZIP (and unpack nested .rar via 7z when needed).
    """
    try:
        return extract_all_zip_printables(asset_id)
    except FileNotFoundError as exc:
        raise HTTPException(404, str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(403, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    except Exception as exc:
        raise HTTPException(502, f"Extract all failed: {exc}") from exc


@app.post("/api/assets/{asset_id}/open-on-pc")
def open_asset_desktop(
    asset_id: int,
    mode: str = Query("open", description="open = default app; reveal = Explorer select"),
) -> dict[str, Any]:
    """Open the file on the Windows PC (zip → Explorer/7-Zip) or reveal in Explorer."""
    try:
        return open_asset_on_pc(asset_id, mode=mode)
    except FileNotFoundError as exc:
        raise HTTPException(404, str(exc)) from exc
    except PermissionError as exc:
        raise HTTPException(403, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(503, str(exc)) from exc
    except Exception as exc:
        raise HTTPException(502, f"Open on PC failed: {exc}") from exc


@app.api_route("/api/assets/{asset_id}/file", methods=["GET", "HEAD"])
def get_asset_file(
    request: Request,
    asset_id: int,
    entry: str | None = Query(None, description="Path inside a ZIP for a printable member"),
    slicer: bool = Query(False, description="Package as .3mf for Bambu Studio URL-open"),
):
    # HEAD must work — Studio often probes with HEAD before GET; GET-only → 404 JSON → "unknown file format".
    return _serve_asset_file(asset_id, entry=entry, method=request.method, for_slicer=slicer)


@app.api_route("/api/assets/{asset_id}/file/{filename}", methods=["GET", "HEAD"])
def get_asset_file_named(
    request: Request,
    asset_id: int,
    filename: str,
    entry: str | None = Query(None, description="Path inside a ZIP for a printable member"),
    slicer: bool = Query(False, description="Package as .3mf for Bambu Studio URL-open"),
):
    """Same as /file, but path ends with a real name.ext so Bambu/Orca accept the download URL."""
    kind = (get_asset_row(asset_id) or {}).get("kind") or ""
    fname = str(filename or "").lower()
    # Studio URL-open requires .3mf — auto-package STL/OBJ/ZIP meshes when the URL says .3mf.
    want_slicer = bool(slicer) or (
        fname.endswith(".3mf") and kind in ("stl", "obj", "zip")
    )
    return _serve_asset_file(
        asset_id, entry=entry, method=request.method, for_slicer=want_slicer,
    )


@app.get("/api/assets/{asset_id}/model")
def get_asset_model(
    asset_id: int,
    max_tris: int = Query(MAX_PREVIEW_TRIS, ge=20_000, le=MAX_PREVIEW_TRIS_HIGH),
    detail: str = Query("standard", pattern="^(standard|high)$"),
    entry: str | None = Query(None, description="Path inside a ZIP for printable orbit"),
):
    """Mesh for the orbit viewer (may be decimated for huge files)."""
    asset = get_asset_row(asset_id)
    if not asset:
        raise HTTPException(404, "Asset not found")
    kind = asset.get("kind")
    abs_path = str(asset.get("abs_path") or "")
    if not path_is_allowed(abs_path):
        raise HTTPException(403, "File is outside watched folders")
    if detail == "high":
        max_tris = max(max_tris, MAX_PREVIEW_TRIS_HIGH)
    try:
        if kind == "zip":
            if not entry:
                raise HTTPException(400, "Pick a printable inside the ZIP (entry=…)")
            path, simplified = build_zip_entry_preview(asset, entry, max_tris=max_tris)
        elif kind in ("stl", "obj", "3mf", "gcode.3mf"):
            path, simplified = build_preview_stl(asset, max_tris=max_tris)
        else:
            raise HTTPException(400, "Orbit preview is only available for STL, OBJ, 3MF, and ZIP printables")
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(500, f"Preview failed: {exc}") from exc
    if not path.exists():
        raise HTTPException(404, "Preview file missing")
    headers = {
        "Cache-Control": "private, max-age=3600",
        "X-PrintShelf-Simplified": "1" if simplified else "0",
        "X-PrintShelf-Kind": kind or "",
        "X-PrintShelf-Detail": detail,
        "X-PrintShelf-MaxTris": str(max_tris),
    }
    if entry:
        headers["X-PrintShelf-Zip-Entry"] = entry
    stem = Path(entry or asset.get("file_name") or "model").stem
    return FileResponse(
        path,
        media_type="model/stl",
        filename=f"{stem}_preview.stl",
        headers=headers,
    )


@app.get("/api/thumbs/{name}")
def get_thumb(name: str):
    if "/" in name or "\\" in name or ".." in name:
        raise HTTPException(400, "Invalid thumb name")
    thumbs = data_dir() / "thumbs"
    path = thumbs / name
    if not path.exists() and name == SHARED_ZIP_THUMB:
        ensure_shared_zip_thumb(thumbs)
    if not path.exists():
        raise HTTPException(404, "Thumb not found")
    return FileResponse(path, headers={"Cache-Control": "public, max-age=86400"})


@app.get("/api/assets/{asset_id}/image")
def get_asset_image(asset_id: int):
    cfg = load_config()
    db_file = data_dir(cfg) / "printshelf.sqlite3"
    with db_session(db_file) as conn:
        row = conn.execute(
            "SELECT id, abs_path, root_path, rel_path, file_name, kind, mtime "
            "FROM assets WHERE id = ? AND missing = 0 AND COALESCE(hidden, 0) = 0",
            (asset_id,),
        ).fetchone()
    if not row:
        raise HTTPException(404, "Asset not found")
    kind = str(row["kind"] or "").lower()
    if kind not in IMAGE_PREVIEW_KINDS:
        raise HTTPException(400, "Asset is not an image")

    abs_path = str(row["abs_path"] or "")
    root_path = str(row["root_path"] or "")

    # Build candidate on-disk paths defensively.
    candidates: list[Path] = []
    rel_path = str(row["rel_path"] or "").lstrip("/\\")
    if root_path and rel_path:
        candidates.append(Path(root_path) / rel_path)
    if abs_path:
        candidates.append(Path(abs_path))

    path = None
    for cand in candidates:
        try:
            if cand.exists() and cand.is_file():
                path = cand
                break
        except Exception:
            continue
    if path is None:
        raise HTTPException(404, "Image file missing")

    # Keep root-bound safety when root info exists; otherwise ensure file is under watched folders.
    if root_path:
        try:
            path.relative_to(Path(root_path))
        except Exception:
            if not path_under_watched(str(path), cfg):
                raise HTTPException(403, "Path outside asset root")
    elif not path_under_watched(str(path), cfg):
        raise HTTPException(403, "Path outside watched folders")

    if not path.exists() or not path.is_file():
        raise HTTPException(404, "Image file missing")
    if kind in RASTER_IMAGE_KINDS and Image is not None and ImageFile is not None:
        try:
            # Some exported/repacked image files are slightly non-compliant; PIL can
            # often decode where browser direct decode fails.
            ImageFile.LOAD_TRUNCATED_IMAGES = True
            with Image.open(path) as im:
                im = im.convert("RGBA")
                bio = BytesIO()
                im.save(bio, format="PNG", optimize=True)
                data = bio.getvalue()
            return Response(data, media_type="image/png", headers={"Cache-Control": "public, max-age=86400"})
        except Exception:
            pass
    media_type = mimetypes.guess_type(str(path))[0] or "application/octet-stream"
    return FileResponse(
        path,
        media_type=media_type,
        filename=str(row["file_name"] or path.name),
        headers={"Cache-Control": "public, max-age=86400"},
    )


app.mount("/", StaticFiles(directory=str(STATIC), html=True), name="static")
