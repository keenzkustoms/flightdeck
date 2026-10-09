from __future__ import annotations

import fnmatch
import hashlib
import json
import logging
import os
import re
import threading
import time
from pathlib import Path, PurePosixPath
from typing import Any, Callable

from .config import DEFAULT_IGNORE_GLOBS, data_dir, load_config
from .db import db_session, init_db, utcnow
from .grouping import design_display_name, design_group_key
from .mesh_junk import is_fake_mesh_file
from .parsers import detect_kind, parse_asset
from .thumbs import make_placeholder_thumb, save_thumb_bytes

log = logging.getLogger("printshelf.scan")

# Always prune these directory names (case-insensitive), even if config omits them.
HARD_SKIP_DIR_NAMES = frozenset({
    "node_modules",
    ".git",
    "__pycache__",
    "__macosx",
    ".trash",
    "$recycle.bin",
    "system volume information",
    "documents",
    ".svn",
    ".hg",
})

SCAN_LOCK = threading.Lock()
SCAN_STATE: dict[str, Any] = {
    "running": False,
    "status": "idle",
    "files_seen": 0,
    "files_upserted": 0,
    "files_skipped": 0,
    "files_failed": 0,
    "current_path": "",
    "error": None,
    "skipped_roots": [],
    "started_at": None,
    "finished_at": None,
}

THUMB_LOCK = threading.Lock()
THUMB_STATE: dict[str, Any] = {
    "running": False,
    "status": "idle",
    "checked": 0,
    "updated": 0,
    "error": None,
    "started_at": None,
    "finished_at": None,
}

IMAGE_KINDS_WITH_THUMBS = frozenset({"jpg", "jpeg", "png", "gif", "webp", "bmp"})


def get_scan_state() -> dict[str, Any]:
    return dict(SCAN_STATE)


def get_thumb_rebuild_state() -> dict[str, Any]:
    return dict(THUMB_STATE)


def _dir_hard_skipped(name: str) -> bool:
    n = (name or "").strip().lower()
    return bool(n) and (n in HARD_SKIP_DIR_NAMES or n.startswith("._"))


def _decode_mountinfo_path(value: str) -> str:
    """Decode Linux mountinfo octal escapes (space, tab, newline, backslash)."""
    def repl(match: re.Match[str]) -> str:
        try:
            return chr(int(match.group(1), 8))
        except Exception:
            return match.group(0)

    return re.sub(r"\\([0-7]{3})", repl, value)


def _mountinfo_mount_points() -> set[str]:
    """Return mount points visible to this process, including bind mounts.

    os.path.ismount() can miss Linux bind mounts because the bind target may
    share the same st_dev as its parent. /proc/self/mountinfo is authoritative
    for the service's own mount namespace and lists bind/CIFS/NFS mounts too.
    """
    points: set[str] = set()
    try:
        with open('/proc/self/mountinfo', 'r', encoding='utf-8') as fh:
            for line in fh:
                fields = line.rstrip('\n').split()
                if len(fields) < 5:
                    continue
                points.add(_decode_mountinfo_path(fields[4]))
    except Exception:
        pass
    return points


def _has_real_mount_ancestor(root: Path) -> bool:
    """True when root sits on a mount below /mnt or /media.

    This deliberately ignores the filesystem root itself. A plain empty
    /mnt/foo directory on the Pi must still be treated as an unavailable share,
    while /mnt/foo supplied by CIFS/NFS/bind mount must be accepted.
    """
    try:
        resolved = root.resolve()
    except Exception:
        resolved = root

    candidates = [resolved, *resolved.parents]
    mount_points = _mountinfo_mount_points()
    for candidate in candidates:
        ps = str(candidate)
        if ps in ('/', '/mnt', '/media', ''):
            continue
        if not (ps.startswith('/mnt/') or ps.startswith('/media/')):
            continue
        if ps in mount_points or os.path.ismount(ps):
            return True
    return False


def _root_ready_to_scan(root: Path) -> tuple[bool, str]:
    """Skip dead mount placeholders without rejecting valid bind mounts.

    After a Pi reboot, /mnt/koko-kidabah etc. can remain as empty directories.
    Walking those placeholders and then marking files missing would hide the
    whole library. Older code used os.path.ismount() alone, which can reject
    perfectly valid bind mounts. We now consult /proc/self/mountinfo first.
    """
    if not root.exists() or not root.is_dir():
        return False, "missing_or_not_dir"
    if not os.access(root, os.R_OK | os.X_OK):
        return False, "not_readable"

    root_s = str(root)
    try:
        resolved_s = str(root.resolve())
    except Exception:
        resolved_s = root_s
    under_removable = any(
        s.startswith(prefix)
        for s in (root_s, resolved_s)
        for prefix in ("/mnt/", "/media/")
    )
    if under_removable and not _has_real_mount_ancestor(root):
        return False, "not_mounted"
    return True, "ok"


def _ignored(rel: str, patterns: list[str]) -> bool:
    """Match ignore globs. Supports **/seg/** style (plain fnmatch does not)."""
    rel_posix = rel.replace("\\", "/").strip("/")
    name = PurePosixPath(rel_posix).name if rel_posix else ""
    parts = [p for p in rel_posix.split("/") if p]
    for raw in patterns:
        pat = (raw or "").replace("\\", "/").strip()
        if not pat:
            continue
        if fnmatch.fnmatch(rel_posix, pat) or (name and fnmatch.fnmatch(name, pat)):
            return True
        try:
            if rel_posix and PurePosixPath(rel_posix).match(pat):
                return True
            stripped = pat.rstrip("/")
            if stripped and rel_posix and PurePosixPath(rel_posix).match(stripped):
                return True
        except Exception:
            pass
        m = re.fullmatch(r"\*\*/([^/]+)/\*\*", pat) or re.fullmatch(r"\*\*/([^/]+)/?", pat)
        if m:
            seg_pat = m.group(1)
            if any(fnmatch.fnmatch(p, seg_pat) for p in parts):
                return True
            continue
        if pat.startswith("**/") and "/" not in pat[3:].rstrip("/"):
            leaf = pat[3:].rstrip("/")
            if leaf and name and fnmatch.fnmatch(name, leaf):
                return True
    return False


def effective_ignore_globs(cfg: dict[str, Any] | None = None) -> list[str]:
    """Config ignore list, or built-in defaults when unset/empty."""
    cfg = cfg or load_config()
    custom = [str(p).replace("\\", "/").strip() for p in (cfg.get("ignore_globs") or []) if str(p).strip()]
    return custom or list(DEFAULT_IGNORE_GLOBS)


def file_hash(path: Path, max_bytes: int = 262_144, st: os.stat_result | None = None) -> str:
    """Inventory fingerprint: size + mtime + a small head read (NAS-friendly)."""
    st = st or path.stat()
    h = hashlib.sha256()
    h.update(str(st.st_size).encode("utf-8"))
    h.update(b"|")
    h.update(f"{st.st_mtime:.6f}".encode("utf-8"))
    h.update(b"|")
    h.update(path.name.encode("utf-8", "surrogateescape"))
    with path.open("rb") as f:
        remaining = max_bytes
        while remaining > 0:
            chunk = f.read(min(64 * 1024, remaining))
            if not chunk:
                break
            h.update(chunk)
            remaining -= len(chunk)
    return h.hexdigest()


def _name_may_be_printable(name: str) -> bool:
    lower = name.lower()
    if lower.endswith(".gcode.3mf"):
        return True
    return lower.endswith((
        ".stl",
        ".obj",
        ".3mf",
        ".gcode",
        ".gco",
        ".zip",
        ".rar",
        ".7z",
        ".tar",
        ".tgz",
        ".tar.gz",
        ".step",
        ".stp",
        ".fbx",
        ".3dm",
        ".jpg",
        ".jpeg",
        ".png",
        ".gif",
        ".webp",
        ".bmp",
        ".svg",
        ".pdf",
        ".txt",
        ".md",
    ))


def _has_image_dimensions(meta_json: Any) -> bool:
    if not meta_json:
        return False
    try:
        meta = json.loads(meta_json) if isinstance(meta_json, str) else dict(meta_json)
    except Exception:
        return False
    try:
        return int(meta.get("width") or 0) > 0 and int(meta.get("height") or 0) > 0
    except Exception:
        return False


def _needs_image_backfill(existing_row: Any, kind: str) -> bool:
    if kind not in IMAGE_KINDS_WITH_THUMBS:
        return False
    # Older image rows were indexed with placeholders and empty meta.
    return not _has_image_dimensions(existing_row["meta_json"])


def _zip_printable_count(meta_json: Any) -> int:
    if not meta_json:
        return -1
    try:
        meta = json.loads(meta_json) if isinstance(meta_json, str) else dict(meta_json)
    except Exception:
        return -1
    try:
        return int(meta.get("printable_count") or 0)
    except Exception:
        return -1


def _needs_zip_thumb_backfill(existing_row: Any, kind: str) -> bool:
    if kind != "zip":
        return False
    thumb_path = str(existing_row["thumb_path"] or "")
    printable_n = _zip_printable_count(existing_row["meta_json"])
    # Unknown legacy meta: force one reparse so we can compute preview_entry/printable_count.
    if printable_n < 0:
        return True
    # No printables inside zip: shared icon is acceptable.
    if printable_n == 0:
        return False
    # Printable zips should use per-asset zip3 thumbs.
    return not thumb_path.endswith("_zip3.png")


def mark_orphaned_scans(db_file: Path | None = None) -> int:
    """Mark scan_runs left as 'running' after a process restart."""
    cfg = load_config()
    db_file = db_file or (data_dir(cfg) / "printshelf.sqlite3")
    init_db(db_file)
    with db_session(db_file) as conn:
        cur = conn.execute(
            """UPDATE scan_runs
               SET finished_at = ?, status = 'interrupted',
                   error = COALESCE(NULLIF(error, ''), 'Process restarted before scan finished')
               WHERE status = 'running'""",
            (utcnow(),),
        )
        return int(cur.rowcount or 0)


def _flush_scan_progress(conn, run_id: int | None) -> None:
    if run_id is None:
        return
    conn.execute(
        "UPDATE scan_runs SET files_seen=?, files_upserted=? WHERE id=?",
        (SCAN_STATE["files_seen"], SCAN_STATE["files_upserted"], run_id),
    )
    conn.commit()


def _clear_scan_issue(conn, abs_path: str) -> None:
    conn.execute(
        "UPDATE scan_issues SET resolved = 1, updated_at = ? WHERE abs_path = ?",
        (utcnow(), abs_path),
    )


def _record_scan_issue(conn, *, root_id: str, abs_path: str, file_name: str, error: str) -> None:
    now = utcnow()
    row = conn.execute("SELECT id, attempts FROM scan_issues WHERE abs_path = ?", (abs_path,)).fetchone()
    if row:
        conn.execute(
            "UPDATE scan_issues SET root_id = ?, file_name = ?, error = ?, attempts = ?, "
            "resolved = 0, ignored = 0, last_seen = ?, updated_at = ? WHERE id = ?",
            (root_id, file_name, error[:1000], int(row["attempts"] or 0) + 1, now, now, int(row["id"])),
        )
    else:
        conn.execute(
            "INSERT INTO scan_issues(root_id, abs_path, file_name, error, attempts, resolved, ignored, last_seen, created_at, updated_at) "
            "VALUES (?, ?, ?, ?, 1, 0, 0, ?, ?, ?)",
            (root_id, abs_path, file_name, error[:1000], now, now, now),
        )


def _design_name_for(path: Path, root: Path) -> str:
    try:
        rel = str(path.relative_to(root)).replace("\\", "/")
    except Exception:
        rel = path.name
    return design_display_name(rel, path.name)


def _resolve_design_id(
    conn,
    *,
    root_id: str,
    rel_path: str,
    file_name: str,
    content_hash: str,
    path: Path,
    root_path: str,
) -> int:
    """Attach asset to a design via group_key (stem+folder), falling back to content_hash."""
    now = utcnow()
    group_key = design_group_key(root_id, rel_path, file_name)
    name = _design_name_for(path, Path(root_path))

    row = conn.execute(
        "SELECT id, name FROM designs WHERE group_key = ? LIMIT 1",
        (group_key,),
    ).fetchone()
    if row:
        design_id = int(row["id"])
        if name and name != row["name"] and len(name) >= len(str(row["name"] or "")):
            conn.execute(
                "UPDATE designs SET name = ?, updated_at = ? WHERE id = ?",
                (name, now, design_id),
            )
        else:
            conn.execute("UPDATE designs SET updated_at = ? WHERE id = ?", (now, design_id))
        return design_id

    if content_hash:
        legacy = conn.execute(
            "SELECT id FROM designs WHERE content_hash = ? LIMIT 1",
            (content_hash,),
        ).fetchone()
        if legacy:
            design_id = int(legacy["id"])
            conn.execute(
                "UPDATE designs SET group_key = COALESCE(group_key, ?), updated_at = ? WHERE id = ?",
                (group_key, now, design_id),
            )
            return design_id

    cur = conn.execute(
        """INSERT INTO designs(name, notes, tags_json, content_hash, group_key, created_at, updated_at)
           VALUES (?,?,?,?,?,?,?)""",
        (name, "", "[]", content_hash, group_key, now, now),
    )
    return int(cur.lastrowid)


def upsert_asset(
    conn,
    folder: dict[str, Any],
    path: Path,
    parsed: dict[str, Any],
    content_hash: str,
    thumbs: Path,
) -> tuple[int, int]:
    kind = parsed.get("kind") or detect_kind(path) or "unknown"
    st = path.stat()
    root_path = str(Path(folder["path"]).resolve())
    abs_path = str(path.resolve())
    try:
        rel_path = str(path.resolve().relative_to(Path(root_path))).replace("\\", "/")
    except Exception:
        rel_path = path.name

    thumb_name = None
    if parsed.get("thumb_bytes"):
        thumb_name = save_thumb_bytes(thumbs, content_hash, kind, parsed["thumb_bytes"])
    if not thumb_name:
        thumb_name = make_placeholder_thumb(thumbs, content_hash, kind, kind)

    root_id = folder.get("id") or "folder"
    design_id = _resolve_design_id(
        conn,
        root_id=str(root_id),
        rel_path=rel_path,
        file_name=path.name,
        content_hash=content_hash,
        path=path,
        root_path=root_path,
    )
    now = utcnow()

    meta_json = json.dumps(parsed.get("meta") or {}, ensure_ascii=False)
    bbox_json = json.dumps(parsed.get("bbox"), ensure_ascii=False) if parsed.get("bbox") else None
    existing = conn.execute("SELECT id FROM assets WHERE abs_path = ?", (abs_path,)).fetchone()
    common = (
        design_id,
        kind,
        folder.get("source_kind") or "local",
        root_id,
        root_path,
        rel_path,
        path.name,
        int(st.st_size),
        float(st.st_mtime),
        content_hash,
        parsed.get("triangle_count"),
        bbox_json,
        meta_json,
        thumb_name,
        1 if parsed.get("has_textures") else 0,
        1 if parsed.get("is_sliced") else 0,
        now,
        0,
    )
    if existing:
        asset_id = existing["id"]
        conn.execute(
            """UPDATE assets SET
              design_id=?, kind=?, source_kind=?, root_id=?, root_path=?, rel_path=?,
              file_name=?, size_bytes=?, mtime=?, content_hash=?, triangle_count=?,
              bbox_json=?, meta_json=?, thumb_path=?, has_textures=?, is_sliced=?,
              last_seen=?, missing=?
            WHERE id=?""",
            common + (asset_id,),
        )
        conn.execute("DELETE FROM sidecars WHERE asset_id = ?", (asset_id,))
    else:
        cur = conn.execute(
            """INSERT INTO assets(
              design_id, kind, source_kind, root_id, root_path, rel_path, abs_path,
              file_name, size_bytes, mtime, content_hash, triangle_count, bbox_json,
              meta_json, thumb_path, has_textures, is_sliced, last_seen, missing
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (
                design_id,
                kind,
                folder.get("source_kind") or "local",
                root_id,
                root_path,
                rel_path,
                abs_path,
                path.name,
                int(st.st_size),
                float(st.st_mtime),
                content_hash,
                parsed.get("triangle_count"),
                bbox_json,
                meta_json,
                thumb_name,
                1 if parsed.get("has_textures") else 0,
                1 if parsed.get("is_sliced") else 0,
                now,
                0,
            ),
        )
        asset_id = cur.lastrowid

    for sc in parsed.get("sidecars") or []:
        conn.execute(
            "INSERT OR IGNORE INTO sidecars(asset_id, role, abs_path, file_name, size_bytes) VALUES (?,?,?,?,?)",
            (asset_id, sc.get("role") or "sidecar", sc["abs_path"], sc["file_name"], int(sc.get("size_bytes") or 0)),
        )
    return int(asset_id), int(design_id)


def run_scan(
    progress: Callable[[dict[str, Any]], None] | None = None,
    *,
    root_ids: list[str] | None = None,
) -> dict[str, Any]:
    if not SCAN_LOCK.acquire(blocking=False):
        return get_scan_state()

    cfg = load_config()
    db_file = data_dir(cfg) / "printshelf.sqlite3"
    init_db(db_file)
    mark_orphaned_scans(db_file)
    thumbs = data_dir(cfg) / "thumbs"
    ignore = effective_ignore_globs(cfg)
    folders = list(cfg.get("watched_folders") or [])
    if root_ids:
        want = {str(r).strip() for r in root_ids if str(r).strip()}
        folders = [f for f in folders if str(f.get("id") or "") in want]
        if not folders:
            SCAN_STATE.update({
                "running": False,
                "status": "error",
                "error": f"No watched folders match: {', '.join(sorted(want))}",
                "finished_at": utcnow(),
            })
            SCAN_LOCK.release()
            return get_scan_state()
    else:
        folders = sorted(
            folders,
            key=lambda f: (
                0 if str(f.get("source_kind") or "") in {"local", "windows"} else 1,
                str(f.get("id") or ""),
            ),
        )

    SCAN_STATE.update({
        "running": True,
        "status": "scanning",
        "files_seen": 0,
        "files_upserted": 0,
        "files_skipped": 0,
        "files_failed": 0,
        "current_path": "",
        "error": None,
        "skipped_roots": [],
        "started_at": utcnow(),
        "finished_at": None,
    })
    if progress:
        progress(get_scan_state())

    run_id = None
    try:
        with db_session(db_file) as conn:
            cur = conn.execute(
                "INSERT INTO scan_runs(started_at, status) VALUES (?,?)",
                (SCAN_STATE["started_at"], "running"),
            )
            run_id = cur.lastrowid
            purge_junk_assets(conn)

            seen_paths: set[str] = set()
            scanned_roots: list[str] = []
            skipped_roots: list[dict[str, str]] = []
            status = "ok"
            err = None
            # Unchanged files only need last_seen. One commit per file was
            # locking the library (blank cards) for the whole walk.
            pending_seen: list[int] = []

            def flush_seen(*, force: bool = False) -> None:
                if not pending_seen:
                    return
                if not force and len(pending_seen) < 400:
                    return
                now_seen = utcnow()
                ids = pending_seen[:]
                pending_seen.clear()
                for i in range(0, len(ids), 400):
                    chunk = ids[i:i + 400]
                    marks = ",".join("?" * len(chunk))
                    conn.execute(
                        f"UPDATE assets SET last_seen = ?, missing = 0 WHERE id IN ({marks})",
                        (now_seen, *chunk),
                    )
                conn.commit()
            for folder in folders:
                root = Path(folder.get("path") or "")
                ready, reason = _root_ready_to_scan(root)
                if not ready:
                    label = str(folder.get("label") or folder.get("id") or root)
                    log.warning("Skipping watched folder (%s): %s", reason, root)
                    skipped_roots.append({
                        "id": str(folder.get("id") or ""),
                        "path": str(root),
                        "label": label,
                        "reason": reason,
                    })
                    continue
                try:
                    root_resolved = root.resolve()
                except Exception:
                    root_resolved = root
                root_s = str(root_resolved)
                scanned_roots.append(root_s)
                root_label = str(folder.get("label") or folder.get("id") or root.name or root_s)

                for dirpath, dirnames, filenames in os.walk(root_s, followlinks=False):
                    kept = []
                    for d in dirnames:
                        if _dir_hard_skipped(d):
                            continue
                        rel_dir = str((Path(dirpath) / d).relative_to(root_resolved)).replace("\\", "/")
                        if _ignored(rel_dir, ignore) or _ignored(f"{rel_dir}/", ignore):
                            continue
                        kept.append(d)
                    dirnames[:] = kept

                    rel_cwd = str(Path(dirpath).relative_to(root_resolved)).replace("\\", "/") if dirpath != root_s else ""
                    SCAN_STATE["current_path"] = f"{root_label} / {rel_cwd or '.'}"

                    for name in filenames:
                        if not _name_may_be_printable(name):
                            continue
                        path = Path(dirpath) / name
                        if _is_junk_printable(path):
                            try:
                                abs_junk = str(path.resolve())
                                conn.execute(
                                    "UPDATE assets SET missing = 1 WHERE abs_path = ? AND missing = 0",
                                    (abs_junk,),
                                )
                            except Exception:
                                pass
                            continue
                        kind = detect_kind(path)
                        if not kind:
                            continue
                        try:
                            rel = str(path.relative_to(root_resolved)).replace("\\", "/")
                        except Exception:
                            rel = name
                        if _ignored(rel, ignore):
                            continue

                        SCAN_STATE["files_seen"] += 1
                        try:
                            st = path.stat()
                            abs_path = str(path.resolve())
                            existing = conn.execute(
                                "SELECT id, size_bytes, mtime FROM assets WHERE abs_path = ?",
                                (abs_path,),
                            ).fetchone()
                            unchanged = bool(
                                existing
                                and int(existing["size_bytes"] or 0) == int(st.st_size)
                                and abs(float(existing["mtime"] or 0) - float(st.st_mtime)) < 0.001
                            )
                            if unchanged:
                                # Same size and time: the file is already in the library.
                                # Mesh thumbs for old zips stay on Rebuild thumbs, not this walk.
                                pending_seen.append(int(existing["id"]))
                                SCAN_STATE["files_skipped"] += 1
                                seen_paths.add(abs_path)
                                flush_seen()
                            else:
                                flush_seen(force=True)
                                digest = file_hash(path, max_bytes=32_768 if kind == "zip" else 262_144, st=st)
                                parsed = parse_asset(path, kind)
                                upsert_asset(conn, folder, path, parsed, digest, thumbs)
                                SCAN_STATE["files_upserted"] += 1
                                seen_paths.add(abs_path)
                                _clear_scan_issue(conn, abs_path)
                                conn.commit()
                                # Let the grid and thumb requests run between new files.
                                time.sleep(0.02)
                        except Exception as exc:
                            SCAN_STATE["files_failed"] += 1
                            SCAN_STATE["error"] = f"{name}: {exc}"
                            try:
                                abs_path = str(path.resolve())
                            except Exception:
                                abs_path = str(path)
                            _record_scan_issue(
                                conn,
                                root_id=str(folder.get("id") or ""),
                                abs_path=abs_path,
                                file_name=name,
                                error=str(exc),
                            )
                            conn.commit()
                            log.warning("Scan skip %s: %s", path, exc)
                            continue

                        if SCAN_STATE["files_seen"] % 200 == 0:
                            flush_seen(force=True)
                            _flush_scan_progress(conn, run_id)
                            if progress:
                                progress(get_scan_state())

                flush_seen(force=True)

            flush_seen(force=True)
            SCAN_STATE["skipped_roots"] = skipped_roots
            if scanned_roots:
                # Seen files were already touched. Only stat files the walk did not list,
                # and mark those missing in batches so the grid is not locked at the end.
                rows = conn.execute(
                    "SELECT id, abs_path, root_path FROM assets WHERE missing = 0"
                ).fetchall()
                gone: list[int] = []
                for row in rows:
                    if row["root_path"] not in scanned_roots:
                        continue
                    if row["abs_path"] in seen_paths:
                        continue
                    if Path(row["abs_path"]).exists():
                        continue
                    gone.append(int(row["id"]))
                for i in range(0, len(gone), 400):
                    chunk = gone[i:i + 400]
                    marks = ",".join("?" * len(chunk))
                    conn.execute(
                        f"UPDATE assets SET missing = 1 WHERE id IN ({marks})",
                        tuple(chunk),
                    )
                    conn.commit()

            status = "ok"
            err = None if not SCAN_STATE.get("files_failed") else SCAN_STATE.get("error")
            if skipped_roots and not scanned_roots:
                status = "error"
                labels = ", ".join(s.get("label") or s.get("path") or "?" for s in skipped_roots)
                err = f"No mounts ready to scan ({labels}). Remount shares, then Rescan."
            elif skipped_roots:
                labels = ", ".join(s.get("label") or s.get("path") or "?" for s in skipped_roots)
                note = f"Skipped unmounted: {labels}"
                err = f"{err}; {note}" if err else note

            conn.execute(
                "UPDATE scan_runs SET finished_at=?, status=?, files_seen=?, files_upserted=? WHERE id=?",
                (utcnow(), status, SCAN_STATE["files_seen"], SCAN_STATE["files_upserted"], run_id),
            )

        SCAN_STATE.update({
            "running": False,
            "status": status,
            "finished_at": utcnow(),
            "current_path": "",
            "error": err,
            "skipped_roots": skipped_roots,
        })
    except Exception as exc:
        SCAN_STATE.update({
            "running": False,
            "status": "error",
            "error": str(exc),
            "finished_at": utcnow(),
            "current_path": "",
        })
        if run_id is not None:
            try:
                with db_session(db_file) as conn:
                    conn.execute(
                        "UPDATE scan_runs SET finished_at=?, status=?, error=?, files_seen=?, files_upserted=? WHERE id=?",
                        (utcnow(), "error", str(exc), SCAN_STATE["files_seen"], SCAN_STATE["files_upserted"], run_id),
                    )
            except Exception:
                pass
    finally:
        SCAN_LOCK.release()
        if progress:
            progress(get_scan_state())
    return get_scan_state()


def start_scan_background(root_ids: list[str] | None = None) -> dict[str, Any]:
    if SCAN_STATE.get("running"):
        return {"ok": True, **get_scan_state(), "root_ids": list(root_ids or [])}

    requested = [str(r).strip() for r in (root_ids or []) if str(r).strip()]
    SCAN_STATE.update({
        "running": True,
        "status": "starting",
        "files_seen": 0,
        "files_upserted": 0,
        "files_skipped": 0,
        "files_failed": 0,
        "current_path": "Preparing scan…",
        "error": None,
        "skipped_roots": [],
        "started_at": utcnow(),
        "finished_at": None,
    })

    def _run():
        run_scan(root_ids=requested or None)

    t = threading.Thread(target=_run, name="printshelf-scan", daemon=True)
    t.start()
    return {"ok": True, **get_scan_state(), "root_ids": requested}


def _thumb_is_current(kind: str, thumb_path: str) -> bool:
    if kind == "stl":
        return thumb_path.endswith("_stl6.png")
    if kind == "obj":
        return thumb_path.endswith("_obj5.png")
    if kind in ("3mf", "gcode.3mf"):
        return thumb_path.endswith("_3mf3.png")
    if kind == "zip":
        return thumb_path == "_shared_zip2.png" or thumb_path.endswith("_zip3.png")
    if kind == "jpg":
        return thumb_path.endswith("_jpg2.png")
    if kind == "jpeg":
        return thumb_path.endswith("_jpeg2.png")
    if kind == "png":
        return thumb_path.endswith("_png2.png")
    if kind == "gif":
        return thumb_path.endswith("_gif2.png")
    if kind == "webp":
        return thumb_path.endswith("_webp2.png")
    if kind == "bmp":
        return thumb_path.endswith("_bmp2.png")
    return bool(thumb_path)


def _is_junk_printable(path: Path) -> bool:
    return is_fake_mesh_file(path)


def purge_junk_assets(conn) -> int:
    cur = conn.execute(
        """UPDATE assets SET missing = 1
           WHERE missing = 0 AND (
             file_name LIKE '._%'
             OR lower(file_name) LIKE '%\\_temp.obj' ESCAPE '\\'
             OR lower(file_name) = 'temp.obj'
             OR lower(file_name) LIKE 'card_preview\\_%' ESCAPE '\\'
             OR lower(file_name) LIKE 'tiny_preview\\_%' ESCAPE '\\'
             OR lower(file_name) LIKE 'tinycard_preview\\_%' ESCAPE '\\'
             OR lower(file_name) LIKE 'large_preview\\_%' ESCAPE '\\'
             OR lower(file_name) LIKE 'large_display\\_%' ESCAPE '\\'
             OR lower(file_name) LIKE 'small_display\\_%' ESCAPE '\\'
             OR lower(file_name) LIKE 'small_thumb\\_%' ESCAPE '\\'
             OR lower(file_name) LIKE 'tiny_thumb\\_%' ESCAPE '\\'
             OR lower(rel_path) LIKE 'documents/%'
             OR lower(rel_path) LIKE '%/documents/%'
             OR lower(rel_path) LIKE 'documents\\%'
             OR lower(rel_path) LIKE '%\\documents\\%'
             OR lower(abs_path) LIKE '%/documents/%'
             OR lower(abs_path) LIKE '%\\documents\\%'
           )"""
    )
    return cur.rowcount or 0


def rebuild_stale_thumbs(
    kinds: tuple[str, ...] = ("stl", "obj", "3mf", "gcode.3mf", "zip", "jpg", "jpeg", "png", "gif", "webp", "bmp")
) -> dict[str, Any]:
    if not THUMB_LOCK.acquire(blocking=False):
        return get_thumb_rebuild_state()

    cfg = load_config()
    db_file = data_dir(cfg) / "printshelf.sqlite3"
    thumbs = data_dir(cfg) / "thumbs"
    THUMB_STATE.update({
        "running": True,
        "status": "rebuilding",
        "checked": 0,
        "updated": 0,
        "error": None,
        "started_at": utcnow(),
        "finished_at": None,
    })
    try:
        placeholders = ",".join("?" for _ in kinds)
        with db_session(db_file) as conn:
            purged = purge_junk_assets(conn)
            conn.commit()
            if purged:
                THUMB_STATE["status"] = f"rebuilding (purged {purged} junk)"
            rows = conn.execute(
                f"""SELECT id, abs_path, kind, content_hash, thumb_path, meta_json
                    FROM assets
                    WHERE missing = 0 AND COALESCE(hidden, 0) = 0 AND kind IN ({placeholders})
                    ORDER BY id""",
                kinds,
            ).fetchall()

            for row in rows:
                THUMB_STATE["checked"] += 1
                thumb_path = row["thumb_path"] or ""
                kind = row["kind"]
                thumb_file = thumbs / thumb_path if thumb_path else None
                min_size = 800 if kind == "zip" else 2500
                if kind == "zip":
                    needs = (
                        _needs_zip_thumb_backfill(row, kind)
                        or not thumb_path
                        or thumb_file is None
                        or not thumb_file.exists()
                        or thumb_file.stat().st_size < min_size
                    )
                else:
                    needs = (
                        not thumb_path
                        or not _thumb_is_current(kind, thumb_path)
                        or thumb_file is None
                        or not thumb_file.exists()
                        or thumb_file.stat().st_size < min_size
                    )
                if not needs:
                    continue
                path = Path(row["abs_path"])
                if kind != "zip" and (_is_junk_printable(path) or not path.is_file()):
                    continue
                try:
                    content_hash = row["content_hash"] or (file_hash(path) if path.is_file() else "x")
                    thumb_name = None
                    triangle_count = None
                    if kind == "zip":
                        if not path.is_file():
                            continue
                        parsed = parse_asset(path, kind)
                        if parsed.get("thumb_bytes"):
                            thumb_name = save_thumb_bytes(thumbs, content_hash, kind, parsed["thumb_bytes"])
                        if not thumb_name:
                            thumb_name = make_placeholder_thumb(thumbs, content_hash, kind, kind)
                    else:
                        if not path.is_file():
                            continue
                        parsed = parse_asset(path, kind)
                        triangle_count = parsed.get("triangle_count")
                        if parsed.get("thumb_bytes"):
                            thumb_name = save_thumb_bytes(thumbs, content_hash, kind, parsed["thumb_bytes"])
                        if not thumb_name:
                            thumb_name = make_placeholder_thumb(thumbs, content_hash, kind, kind)
                    if thumb_name and thumb_name != thumb_path:
                        conn.execute(
                            "UPDATE assets SET thumb_path = ?, triangle_count = COALESCE(?, triangle_count) WHERE id = ?",
                            (thumb_name, triangle_count, row["id"]),
                        )
                        THUMB_STATE["updated"] += 1
                        conn.commit()
                except Exception:
                    continue

        THUMB_STATE.update({"running": False, "status": "ok", "finished_at": utcnow()})
    except Exception as exc:
        THUMB_STATE.update({
            "running": False,
            "status": "error",
            "error": str(exc),
            "finished_at": utcnow(),
        })
    finally:
        THUMB_LOCK.release()
    return get_thumb_rebuild_state()


def start_thumb_rebuild_background(
    kinds: tuple[str, ...] = ("stl", "obj", "3mf", "gcode.3mf", "zip", "jpg", "jpeg", "png", "gif", "webp", "bmp")
) -> dict[str, Any]:
    if THUMB_STATE.get("running"):
        return get_thumb_rebuild_state()

    def _run():
        rebuild_stale_thumbs(kinds=kinds)

    t = threading.Thread(target=_run, name="printshelf-thumbs", daemon=True)
    t.start()
    return get_thumb_rebuild_state()
