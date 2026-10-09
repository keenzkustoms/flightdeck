#!/usr/bin/env python3
"""Read-only count of supported PrintShelf files in configured roots.

Walks names only. It does not parse models/archives, generate thumbnails, or touch DB.
"""
from __future__ import annotations

import argparse
import fnmatch
import os
from collections import Counter
from pathlib import Path

from app.config import load_config
from app.parsers import detect_kind
from app.scanner import HARD_SKIP_DIR_NAMES

PRIORITY_ROOTS = (
    "koko-extracted",
    "koko-3d-print-stuff",
    "koko-kidabah-folder",
    "koko-surface",
    "koko-to-check",
)


def is_ignored(path: Path, root: Path, globs: list[str]) -> bool:
    try:
        rel = path.relative_to(root).as_posix()
    except ValueError:
        rel = path.as_posix()
    return any(fnmatch.fnmatch(rel, pattern) for pattern in globs)


def inspect(folder: dict, globs: list[str]) -> None:
    root = Path(str(folder.get("path") or ""))
    root_id = str(folder.get("id") or "")
    label = str(folder.get("label") or root_id)
    print(f"\n[{root_id}] {label}")
    print(f"  path: {root}")
    if not root.is_dir():
        print("  NOT AVAILABLE")
        return

    kinds: Counter[str] = Counter()
    tops: Counter[str] = Counter()
    for dirpath, dirnames, filenames in os.walk(root, followlinks=False):
        here = Path(dirpath)
        dirnames[:] = [
            name for name in dirnames
            if name.strip().lower() not in HARD_SKIP_DIR_NAMES
            and not name.startswith("._")
            and not is_ignored(here / name, root, globs)
        ]
        for name in filenames:
            path = here / name
            if is_ignored(path, root, globs):
                continue
            kind = detect_kind(path)
            if not kind:
                continue
            kinds[kind] += 1
            rel = path.relative_to(root)
            top = rel.parts[0] if len(rel.parts) > 1 else "(root files)"
            tops[top] += 1

    total = sum(kinds.values())
    print(f"  supported files: {total}")
    if kinds:
        print("  kinds: " + ", ".join(f"{k}={v}" for k, v in sorted(kinds.items())))
    if tops:
        print("  branches with supported files:")
        for name, count in tops.most_common():
            print(f"    {count:6d}  {name}")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--root", action="append", default=[], help="configured root id; repeatable")
    ap.add_argument("--priority", action="store_true", help="inspect likely print-heavy missing Koko roots")
    args = ap.parse_args()

    cfg = load_config()
    folders = list(cfg.get("watched_folders") or [])
    wanted = set(args.root)
    if args.priority or not wanted:
        wanted.update(PRIORITY_ROOTS)
    selected = [f for f in folders if str(f.get("id") or "") in wanted]
    missing = wanted - {str(f.get("id") or "") for f in selected}
    if missing:
        print("Unknown configured root id(s): " + ", ".join(sorted(missing)))
    globs = [str(x) for x in (cfg.get("ignore_globs") or [])]
    print("PrintShelf supported-file census (read-only)")
    for folder in selected:
        inspect(folder, globs)
    return 0 if selected else 2


if __name__ == "__main__":
    raise SystemExit(main())
