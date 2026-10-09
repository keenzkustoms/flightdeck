from __future__ import annotations

from pathlib import Path

from app.config import data_dir, load_config
from app.db import db_session
from app.scanner import _resolve_design_id


def _resolved(path: str) -> Path:
    try:
        return Path(path).resolve()
    except Exception:
        return Path(path)


def main() -> int:
    cfg = load_config()
    db_file = data_dir(cfg) / "printshelf.sqlite3"

    roots = []
    for folder in cfg.get("watched_folders") or []:
        raw = str(folder.get("path") or "").strip()
        root_id = str(folder.get("id") or "").strip()
        if not raw or not root_id:
            continue
        root_path = _resolved(raw)
        roots.append((root_path, folder))

    roots.sort(key=lambda pair: len(pair[0].parts), reverse=True)

    moved = 0
    unchanged = 0
    unmatched = 0

    with db_session(db_file) as conn:
        rows = conn.execute(
            """SELECT id, design_id, abs_path, file_name, content_hash,
                      root_id, root_path, rel_path, source_kind
               FROM assets
               WHERE missing = 0
               ORDER BY id"""
        ).fetchall()

        for row in rows:
            abs_path = _resolved(str(row["abs_path"] or ""))
            match = None
            for root_path, folder in roots:
                try:
                    abs_path.relative_to(root_path)
                    match = (root_path, folder)
                    break
                except Exception:
                    continue

            if match is None:
                unmatched += 1
                continue

            root_path, folder = match
            root_id = str(folder.get("id") or "folder")
            source_kind = str(folder.get("source_kind") or "local")
            rel_path = str(abs_path.relative_to(root_path)).replace("\\", "/")
            root_path_s = str(root_path)

            changed = (
                str(row["root_id"] or "") != root_id
                or str(row["root_path"] or "") != root_path_s
                or str(row["rel_path"] or "") != rel_path
                or str(row["source_kind"] or "") != source_kind
            )
            if not changed:
                unchanged += 1
                continue

            design_id = _resolve_design_id(
                conn,
                root_id=root_id,
                rel_path=rel_path,
                file_name=str(row["file_name"] or abs_path.name),
                content_hash="",
                path=abs_path,
                root_path=root_path_s,
            )

            conn.execute(
                """UPDATE assets
                   SET design_id = ?, source_kind = ?, root_id = ?,
                       root_path = ?, rel_path = ?
                   WHERE id = ?""",
                (design_id, source_kind, root_id, root_path_s, rel_path, row["id"]),
            )
            moved += 1

        conn.commit()

    print(f"Reassigned: {moved}")
    print(f"Already correct: {unchanged}")
    print(f"No watched-root match: {unmatched}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
