from __future__ import annotations

from pathlib import PurePosixPath, PureWindowsPath
from typing import Any


def _norm_posix(path: str) -> str:
    return path.replace("\\", "/").rstrip("/")


def windows_root_for(abs_path: str, folders: list[dict[str, Any]]) -> tuple[str, str] | None:
    """Return (linux_root, windows_root) for the longest matching watched folder."""
    target = _norm_posix(abs_path)
    best: tuple[str, str] | None = None
    best_len = -1
    for folder in folders or []:
        linux = _norm_posix(str(folder.get("path") or ""))
        win = str(folder.get("windows_path") or "").strip()
        if not linux or not win:
            continue
        if target == linux or target.startswith(linux + "/"):
            if len(linux) > best_len:
                best = (linux, win)
                best_len = len(linux)
    return best


def to_windows_path(abs_path: str, folders: list[dict[str, Any]]) -> str | None:
    match = windows_root_for(abs_path, folders)
    if not match:
        return None
    linux_root, win_root = match
    rel = _norm_posix(abs_path)[len(linux_root) :].lstrip("/")
    win = win_root.replace("/", "\\").rstrip("\\")
    if not rel:
        return win
    # Preserve UNC (\\server\share) vs drive (Z:)
    rel_win = str(PureWindowsPath(*PurePosixPath(rel).parts))
    return f"{win}\\{rel_win}"


def to_windows_folder(abs_path: str, folders: list[dict[str, Any]]) -> str | None:
    win = to_windows_path(abs_path, folders)
    if not win:
        return None
    p = PureWindowsPath(win)
    return str(p.parent) if p.parent != p else win


def windows_path_to_file_url(win_path: str) -> str | None:
    """Convert a Windows/UNC path to a file:// URL for slicer protocol handlers."""
    p = (win_path or "").strip().replace("/", "\\")
    if not p:
        return None
    if p.startswith("\\\\"):
        # \\server\share\a\b.3mf -> file://server/share/a/b.3mf
        return "file://" + p[2:].replace("\\", "/")
    if len(p) >= 2 and p[1] == ":":
        # Z:\foo\bar.stl -> file:///Z:/foo/bar.stl
        return "file:///" + p.replace("\\", "/")
    return "file:///" + p.replace("\\", "/")
