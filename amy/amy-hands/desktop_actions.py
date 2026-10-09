"""Scoped Windows desktop actions for Amy Hands — no arbitrary shell."""
from __future__ import annotations

import ctypes
import json
import os
import re
import subprocess
import time
from ctypes import wintypes
from pathlib import Path
from typing import Any

user32 = ctypes.windll.user32
kernel32 = ctypes.windll.kernel32

WM_CLOSE = 0x0010
SW_MINIMIZE = 6
SW_RESTORE = 9
SW_SHOW = 5
HWND_TOPMOST = -1
HWND_NOTOPMOST = -2
SWP_NOMOVE = 0x0002
SWP_NOSIZE = 0x0001
SWP_SHOWWINDOW = 0x0040


def _force_foreground(hwnd: int) -> None:
    """Restore a window and pull it in front. SetForegroundWindow alone often fails."""
    user32.keybd_event(0x12, 0, 0, 0)
    user32.keybd_event(0x12, 0, 0x0002, 0)
    user32.ShowWindow(hwnd, SW_RESTORE)
    flags = SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW
    user32.SetWindowPos(hwnd, HWND_TOPMOST, 0, 0, 0, 0, flags)
    user32.SetWindowPos(hwnd, HWND_NOTOPMOST, 0, 0, 0, 0, flags)
    fg = user32.GetForegroundWindow()
    fg_thread = user32.GetWindowThreadProcessId(fg, None)
    target_thread = user32.GetWindowThreadProcessId(hwnd, None)
    current = kernel32.GetCurrentThreadId()
    if fg_thread and fg_thread != current:
        user32.AttachThreadInput(current, fg_thread, True)
    if target_thread and target_thread != current:
        user32.AttachThreadInput(current, target_thread, True)
    user32.BringWindowToTop(hwnd)
    user32.SetForegroundWindow(hwnd)
    if fg_thread and fg_thread != current:
        user32.AttachThreadInput(current, fg_thread, False)
    if target_thread and target_thread != current:
        user32.AttachThreadInput(current, target_thread, False)


SW_SHOWMINNOACTIVE = 7
KEYEVENTF_EXTENDEDKEY = 0x0001
KEYEVENTF_KEYUP = 0x0002
VK_MEDIA = {
    "play_pause": 0xB3,
    "play": 0xB3,
    "pause": 0xB3,
    "next": 0xB0,
    "previous": 0xB1,
    "prev": 0xB1,
    "stop": 0xB2,
    "volume_up": 0xAF,
    "vol_up": 0xAF,
    "louder": 0xAF,
    "volume_down": 0xAE,
    "vol_down": 0xAE,
    "quieter": 0xAE,
    "mute": 0xAD,
    "unmute": 0xAD,
    "volume_mute": 0xAD,
}

# Built-in allowlist. Config can add/override via "apps".
DEFAULT_APPS: dict[str, dict[str, Any]] = {
    "spotify": {
        "label": "Spotify",
        "uri": "spotify:",
        "process": ["Spotify.exe"],
        "exe": [
            str(Path(os.environ.get("APPDATA", "")) / "Spotify" / "Spotify.exe"),
            str(Path(os.environ.get("LOCALAPPDATA", "")) / "Microsoft" / "WindowsApps" / "Spotify.exe"),
        ],
    },
    "chrome": {
        "label": "Google Chrome",
        "process": ["chrome.exe"],
        "exe": [
            str(Path(os.environ.get("PROGRAMFILES", r"C:\Program Files")) / "Google" / "Chrome" / "Application" / "chrome.exe"),
            str(Path(os.environ.get("PROGRAMFILES(X86)", r"C:\Program Files (x86)")) / "Google" / "Chrome" / "Application" / "chrome.exe"),
            str(Path(os.environ.get("LOCALAPPDATA", "")) / "Google" / "Chrome" / "Application" / "chrome.exe"),
        ],
    },
    "edge": {
        "label": "Microsoft Edge",
        "process": ["msedge.exe"],
        "exe": [
            str(Path(os.environ.get("PROGRAMFILES(X86)", r"C:\Program Files (x86)")) / "Microsoft" / "Edge" / "Application" / "msedge.exe"),
            str(Path(os.environ.get("PROGRAMFILES", r"C:\Program Files")) / "Microsoft" / "Edge" / "Application" / "msedge.exe"),
        ],
    },
    "notepad": {"label": "Notepad", "exe": ["notepad.exe"], "process": ["notepad.exe"]},
    "calculator": {"label": "Calculator", "uri": "calculator:", "process": ["CalculatorApp.exe", "Calculator.exe"]},
    "calc": {"label": "Calculator", "uri": "calculator:", "process": ["CalculatorApp.exe", "Calculator.exe"]},
    "explorer": {"label": "File Explorer", "exe": ["explorer.exe"], "process": ["explorer.exe"]},
    "photos": {"label": "Photos", "uri": "ms-photos:", "process": ["Photos.exe", "Microsoft.Photos.exe"]},
    "settings": {"label": "Settings", "uri": "ms-settings:"},
    "meshfinder": {
        "label": "MeshFinder",
        "exe": [
            str(
                Path(os.environ.get("APPDATA", ""))
                / "Microsoft"
                / "Windows"
                / "Start Menu"
                / "Programs"
                / "MeshFinder.lnk"
            ),
            str(Path(os.environ.get("LOCALAPPDATA", "")) / "Programs" / "Python" / "Python312" / "pythonw.exe"),
        ],
        "args": [
            str(Path(__file__).resolve().parents[2] / "printshelf" / "desktop" / "launch.py"),
        ],
        "process": ["pythonw.exe"],
    },
    "flightdeck": {
        "label": "Flightdeck",
        "exe": [
            str(
                Path(os.environ.get("APPDATA", ""))
                / "Microsoft"
                / "Windows"
                / "Start Menu"
                / "Programs"
                / "Flightdeck.lnk"
            ),
            str(Path(os.environ.get("LOCALAPPDATA", "")) / "Programs" / "Python" / "Python312" / "pythonw.exe"),
        ],
        "args": [
            str(Path(__file__).resolve().parents[2] / "desktop" / "launch.py"),
        ],
        "process": ["pythonw.exe"],
    },
    "cindyvinyl": {
        "label": "Cindy Vinyl",
        "exe": [
            str(
                Path(os.environ.get("APPDATA", ""))
                / "Microsoft"
                / "Windows"
                / "Start Menu"
                / "Programs"
                / "Cindy Vinyl.lnk"
            ),
            str(Path(os.environ.get("LOCALAPPDATA", "")) / "Programs" / "Python" / "Python312" / "pythonw.exe"),
        ],
        "args": [
            str(Path(__file__).resolve().parents[2] / "jukebox" / "desktop" / "launch.py"),
        ],
        "process": ["pythonw.exe"],
    },
    "terminal": {
        "label": "Windows Terminal",
        "process": ["WindowsTerminal.exe", "wt.exe"],
        "exe": [
            str(Path(os.environ.get("LOCALAPPDATA", "")) / "Microsoft" / "WindowsApps" / "wt.exe"),
        ],
        "uri": "wt:",
    },
    "vscode": {
        "label": "VS Code",
        "process": ["Code.exe"],
        "exe": [
            str(Path(os.environ.get("LOCALAPPDATA", "")) / "Programs" / "Microsoft VS Code" / "Code.exe"),
            str(Path(os.environ.get("PROGRAMFILES", r"C:\Program Files")) / "Microsoft VS Code" / "Code.exe"),
        ],
    },
    "code": {
        "label": "VS Code",
        "process": ["Code.exe"],
        "exe": [
            str(Path(os.environ.get("LOCALAPPDATA", "")) / "Programs" / "Microsoft VS Code" / "Code.exe"),
            str(Path(os.environ.get("PROGRAMFILES", r"C:\Program Files")) / "Microsoft VS Code" / "Code.exe"),
        ],
    },
    "cursor": {
        "label": "Cursor",
        "process": ["Cursor.exe"],
        "exe": [
            str(Path(os.environ.get("LOCALAPPDATA", "")) / "Programs" / "cursor" / "Cursor.exe"),
            str(Path(os.environ.get("LOCALAPPDATA", "")) / "Programs" / "Cursor" / "Cursor.exe"),
        ],
    },
    "outlook": {
        "label": "Outlook",
        "process": ["OUTLOOK.EXE"],
        "exe": [
            str(Path(os.environ.get("PROGRAMFILES", r"C:\Program Files")) / "Microsoft Office" / "root" / "Office16" / "OUTLOOK.EXE"),
            str(Path(os.environ.get("PROGRAMFILES(X86)", r"C:\Program Files (x86)")) / "Microsoft Office" / "root" / "Office16" / "OUTLOOK.EXE"),
        ],
        "uri": "outlookmail:",
    },
    "thunderbird": {
        "label": "Thunderbird",
        "process": ["thunderbird.exe"],
        "exe": [
            str(Path(os.environ.get("PROGRAMFILES", r"C:\Program Files")) / "Mozilla Thunderbird" / "thunderbird.exe"),
            str(Path(os.environ.get("PROGRAMFILES(X86)", r"C:\Program Files (x86)")) / "Mozilla Thunderbird" / "thunderbird.exe"),
            str(Path(os.environ.get("LOCALAPPDATA", "")) / "Programs" / "Mozilla Thunderbird" / "thunderbird.exe"),
        ],
    },
    "mail": {
        "label": "Mail",
        "uri": "mailto:",
        "process": ["HxOutlook.exe", "MailClient.exe"],
    },
    "gmail": {
        "label": "Gmail",
        "uri": "https://mail.google.com/",
    },
}

# Refuse closing / bulk-minimising these window-title patterns.
PROTECTED_TITLE = re.compile(
    r"(program manager|windows input experience|amy\s*-\s*flightdeck|amy hands|"
    r"cursor|windows shell experience|search host|start)",
    re.I,
)


def _unsafe_chars(s: str) -> bool:
    return any(ch in s for ch in "\n\r\0;&|`$<>")


def normalize_local_path(path: str) -> dict[str, Any]:
    raw = str(path or "").strip().strip('"').strip("'")
    if not raw:
        return {"ok": False, "detail": "path required"}
    if _unsafe_chars(raw):
        return {"ok": False, "detail": "path has unsafe characters"}
    if re.fullmatch(r"[A-Za-z]:", raw):
        raw = raw + "\\"
    raw = raw.replace("/", "\\")
    if not re.match(r"^[A-Za-z]:\\", raw):
        return {"ok": False, "detail": "only local Windows paths like C:\\… are allowed"}
    try:
        text = os.path.normpath(raw)
    except Exception as exc:
        return {"ok": False, "detail": f"bad path: {exc}"}
    if not re.match(r"^[A-Za-z]:\\", text):
        return {"ok": False, "detail": "refused non-local path"}
    return {"ok": True, "path": text}


def app_catalog(cfg: dict[str, Any] | None = None) -> dict[str, dict[str, Any]]:
    cat = {k: dict(v) for k, v in DEFAULT_APPS.items()}
    extra = (cfg or {}).get("apps") or {}
    if isinstance(extra, dict):
        for key, val in extra.items():
            if not isinstance(val, dict):
                continue
            name = str(key).strip().lower()
            if not name:
                continue
            base = cat.get(name, {})
            merged = {**base, **val}
            cat[name] = merged
    return cat


def resolve_app(name: str, cfg: dict[str, Any] | None = None) -> dict[str, Any]:
    key = re.sub(r"\s+", " ", str(name or "").strip().lower())
    if not key:
        return {"ok": False, "detail": "app name required"}
    cat = app_catalog(cfg)
    if key in cat:
        return {"ok": True, "key": key, "spec": cat[key]}
    folded = key.replace(" ", "")
    # Fuzzy: startswith / contains, and ignore spaces ("mesh finder").
    for k, spec in cat.items():
        label = str(spec.get("label") or k).lower()
        if (
            key == label
            or key in k
            or key in label
            or k.startswith(key)
            or folded == k.replace(" ", "")
            or folded == label.replace(" ", "")
        ):
            return {"ok": True, "key": k, "spec": spec}
    known = ", ".join(sorted({str(v.get("label") or k) for k, v in cat.items()}))
    return {"ok": False, "detail": f"app “{name}” not in allowlist. Known: {known}"}


def _start_uri(uri: str) -> None:
    os.startfile(uri)  # noqa: S606 — intentional ShellExecute for allowlisted URI


def _start_exe(exe: str, args: list[str] | None = None) -> None:
    if exe.lower().endswith(".lnk"):
        os.startfile(exe)  # noqa: S606 — shortcut carries the MeshFinder window launch
        return
    cmd = [exe, *(args or [])]
    subprocess.Popen(cmd, shell=False, close_fds=True)


def launch_app(name: str, *, cfg: dict[str, Any] | None = None, play: bool = False, front: bool = False) -> dict[str, Any]:
    hit = resolve_app(name, cfg)
    if not hit.get("ok"):
        return hit
    spec = hit["spec"]
    label = str(spec.get("label") or hit["key"])
    if front:
        already = _focus_app_window(label, spec, allow_other=not spec.get("process"))
        if already.get("ok"):
            return {
                "ok": True,
                "app": label,
                "via": "already open",
                "focused": True,
                "title": already.get("title"),
            }
    started_via = ""
    try:
        uri = str(spec.get("uri") or "").strip()
        if uri:
            _start_uri(uri)
            started_via = f"uri:{uri}"
        else:
            exes = spec.get("exe") or []
            if isinstance(exes, str):
                exes = [exes]
            raw_args = spec.get("args") or []
            if isinstance(raw_args, str):
                raw_args = [raw_args]
            launch_args = [str(a) for a in raw_args]
            launched = False
            for exe in exes:
                exe_s = str(exe)
                if "\\" in exe_s or "/" in exe_s:
                    if not Path(exe_s).exists():
                        continue
                _start_exe(exe_s, launch_args if not exe_s.lower().endswith(".lnk") else None)
                started_via = exe_s
                launched = True
                break
            if not launched:
                return {"ok": False, "detail": f"could not find executable for {label}"}
    except Exception as exc:
        return {"ok": False, "detail": str(exc)}
    out: dict[str, Any] = {"ok": True, "app": label, "via": started_via}
    if play:
        time.sleep(1.6)
        media = media_control("play_pause")
        out["media"] = media
    if front:
        focused = _bring_app_forward(label, spec)
        out["focused"] = bool(focused.get("ok"))
        if focused.get("title"):
            out["title"] = focused.get("title")
    return out


def _process_names(spec: dict[str, Any] | None) -> set[str]:
    raw = (spec or {}).get("process") or []
    if isinstance(raw, str):
        raw = [raw]
    return {str(name).strip().lower() for name in raw if str(name).strip()}


def _window_process_name(hwnd: int) -> str:
    pid = wintypes.DWORD()
    user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
    if not pid.value:
        return ""
    handle = kernel32.OpenProcess(0x1000, False, pid.value)
    if not handle:
        return ""
    try:
        size = wintypes.DWORD(1024)
        buf = ctypes.create_unicode_buffer(1024)
        if not kernel32.QueryFullProcessImageNameW(handle, 0, buf, ctypes.byref(size)):
            return ""
        return Path(buf.value).name.lower()
    finally:
        kernel32.CloseHandle(handle)


def _focus_app_window(label: str, spec: dict[str, Any] | None, *, allow_other: bool) -> dict[str, Any]:
    """Bring the app's own window forward. A title that merely contains the name is not enough."""
    processes = _process_names(spec)
    found = _find_windows(label, protected=False, loose=bool(processes))
    if not found.get("ok"):
        return found
    chosen: tuple[int, str] | None = None
    if processes:
        for hwnd, title in found["matches"]:
            if _window_process_name(hwnd) in processes:
                chosen = (hwnd, title)
                break
    if chosen is None and allow_other:
        chosen = found["matches"][0]
    if chosen is None:
        return {"ok": False, "detail": f"no {label} window yet"}
    hwnd, title = chosen
    try:
        _force_foreground(hwnd)
    except Exception as exc:
        return {"ok": False, "detail": str(exc)}
    return {"ok": True, "title": title, "hwnd": hwnd, "action": "restore"}


def _bring_app_forward(label: str, spec: dict[str, Any] | None = None) -> dict[str, Any]:
    """Wait briefly for the app window, then restore it to the front."""
    last: dict[str, Any] = {"ok": False, "detail": "window not up yet"}
    attempts = 12
    for i in range(attempts):
        found = _focus_app_window(label, spec, allow_other=i == attempts - 1 and not _process_names(spec))
        if found.get("ok"):
            return found
        last = found
        time.sleep(0.3)
    return last


def open_file(path: str) -> dict[str, Any]:
    norm = normalize_local_path(path)
    if not norm.get("ok"):
        return norm
    text = str(norm["path"])
    p = Path(text)
    if not p.exists():
        return {"ok": False, "detail": f"path not found: {text}"}
    if p.is_dir():
        return open_file_explorer(text)
    try:
        os.startfile(text)  # noqa: S606 — default file association
    except Exception as exc:
        return {"ok": False, "detail": str(exc)}
    return {"ok": True, "path": text, "how": "default app", "reveal": True}


def _focus_explorer() -> None:
    """Bring a File Explorer window forward (Amy is often always-on-top)."""
    time.sleep(0.45)
    found: list[int] = []

    @ctypes.WINFUNCTYPE(ctypes.c_bool, wintypes.HWND, wintypes.LPARAM)
    def enum_proc(hwnd, _lparam):  # noqa: N803
        if not user32.IsWindowVisible(hwnd):
            return True
        cls = ctypes.create_unicode_buffer(256)
        user32.GetClassNameW(hwnd, cls, 256)
        if cls.value not in ("CabinetWClass", "ExploreWClass"):
            return True
        found.append(int(hwnd))
        return True

    try:
        user32.EnumWindows(enum_proc, 0)
    except Exception:
        return
    if not found:
        return
    hwnd = found[0]
    try:
        _force_foreground(hwnd)
    except Exception:
        pass


def open_file_explorer(path: str | None = None) -> dict[str, Any]:
    raw = str(path or "C:\\").strip().strip('"').strip("'") or "C:\\"
    if re.fullmatch(r"[A-Za-z]:", raw):
        raw = raw + "\\"
    norm = normalize_local_path(raw)
    if not norm.get("ok"):
        return norm
    text = str(norm["path"])
    is_drive = bool(re.fullmatch(r"[A-Za-z]:\\", text))
    if not is_drive and not Path(text).exists():
        return {"ok": False, "detail": f"path not found: {text}"}
    try:
        # ShellExecute tends to raise Explorer above other windows better than Popen.
        rc = ctypes.windll.shell32.ShellExecuteW(None, "open", text, None, None, 1)  # SW_SHOWNORMAL
        if int(rc) <= 32:
            subprocess.Popen(["explorer.exe", text], shell=False, close_fds=True)
        _focus_explorer()
    except Exception as exc:
        return {"ok": False, "detail": str(exc)}
    return {"ok": True, "path": text, "reveal": True}


def open_file_with(path: str, app: str, *, cfg: dict[str, Any] | None = None) -> dict[str, Any]:
    norm = normalize_local_path(path)
    if not norm.get("ok"):
        return norm
    text = str(norm["path"])
    if not Path(text).exists():
        return {"ok": False, "detail": f"path not found: {text}"}
    hit = resolve_app(app, cfg)
    if not hit.get("ok"):
        return hit
    spec = hit["spec"]
    label = str(spec.get("label") or hit["key"])
    try:
        exes = spec.get("exe") or []
        if isinstance(exes, str):
            exes = [exes]
        for exe in exes:
            exe_s = str(exe)
            if ("\\" in exe_s or "/" in exe_s) and not Path(exe_s).exists():
                continue
            _start_exe(exe_s, [text])
            return {"ok": True, "path": text, "app": label, "via": exe_s}
        # URI apps can't open arbitrary files cleanly.
        return {"ok": False, "detail": f"{label} has no executable for open-with"}
    except Exception as exc:
        return {"ok": False, "detail": str(exc)}


def _roots_from_cfg(cfg: dict[str, Any] | None) -> list[Path]:
    roots: list[Path] = []
    for raw in (cfg or {}).get("roots") or []:
        try:
            roots.append(Path(str(raw)).expanduser().resolve())
        except OSError:
            continue
    if not roots:
        home = Path.home()
        roots = [home / "Desktop", home / "Documents", home / "Downloads"]
    return roots


def path_allowed(path: str, *, cfg: dict[str, Any] | None = None, must_exist: bool = False) -> dict[str, Any]:
    """Only allow file ops inside configured Hands roots."""
    norm = normalize_local_path(path)
    if not norm.get("ok"):
        return norm
    text = str(norm["path"])
    try:
        target = Path(text).resolve()
    except OSError as exc:
        return {"ok": False, "detail": f"bad path: {exc}"}
    if must_exist and not target.exists():
        return {"ok": False, "detail": f"path not found: {text}"}
    roots = _roots_from_cfg(cfg)
    for root in roots:
        try:
            target.relative_to(root)
            return {"ok": True, "path": str(target), "root": str(root)}
        except ValueError:
            continue
    return {
        "ok": False,
        "detail": f"path outside allowlisted roots. Allowed: {', '.join(str(r) for r in roots)}",
    }


def _is_protected_path(target: Path, cfg: dict[str, Any] | None = None) -> bool:
    """Refuse deleting/moving the root folders themselves or system-ish paths."""
    try:
        resolved = target.resolve()
    except OSError:
        return True
    roots = {r.resolve() for r in _roots_from_cfg(cfg)}
    if resolved in roots:
        return True
    low = str(resolved).lower()
    blocked = ("\\windows\\", "\\program files", "\\program files (x86)", "\\$recycle.bin")
    return any(b in low for b in blocked)


def resolve_friendly_dir(place: str, *, cfg: dict[str, Any] | None = None) -> dict[str, Any]:
    """Map 'desktop' / 'downloads' / full paths to an allowed folder."""
    raw = str(place or "").strip().strip('"').strip("'")
    if not raw:
        return {"ok": False, "detail": "folder required"}
    key = re.sub(r"\s+", " ", raw.lower())
    home = Path.home()
    aliases = {
        "desktop": home / "Desktop",
        "my desktop": home / "Desktop",
        "downloads": home / "Downloads",
        "download": home / "Downloads",
        "documents": home / "Documents",
        "docs": home / "Documents",
        "flightdeck": home / "flightdeck",
    }
    if key in aliases:
        return path_allowed(str(aliases[key]), cfg=cfg, must_exist=True)
    # "X on desktop"
    m = re.match(r"^(.+?)\s+on\s+(my\s+)?desktop$", key)
    if m:
        name = m.group(1).strip()
        return path_allowed(str(home / "Desktop" / name), cfg=cfg, must_exist=False)
    return path_allowed(raw, cfg=cfg, must_exist=False)


def create_folder(parent: str, name: str, *, cfg: dict[str, Any] | None = None) -> dict[str, Any]:
    parent_hit = resolve_friendly_dir(parent, cfg=cfg)
    if not parent_hit.get("ok"):
        return parent_hit
    folder_name = str(name or "").strip().strip("\\/")
    if not folder_name or any(ch in folder_name for ch in '<>:"|?*\n\r\0'):
        return {"ok": False, "detail": "invalid folder name"}
    if ".." in folder_name.split("\\") or ".." in folder_name.split("/"):
        return {"ok": False, "detail": "invalid folder name"}
    dest = Path(str(parent_hit["path"])) / folder_name
    check = path_allowed(str(dest), cfg=cfg, must_exist=False)
    if not check.get("ok"):
        return check
    try:
        dest.mkdir(parents=False, exist_ok=False)
    except FileExistsError:
        return {"ok": False, "detail": f"already exists: {dest}"}
    except OSError as exc:
        return {"ok": False, "detail": str(exc)}
    return {"ok": True, "path": str(dest), "action": "create_folder", "reveal": True}


def copy_path(src: str, dest_dir: str, *, cfg: dict[str, Any] | None = None) -> dict[str, Any]:
    import shutil

    src_hit = path_allowed(src, cfg=cfg, must_exist=True)
    if not src_hit.get("ok"):
        return src_hit
    dest_hit = resolve_friendly_dir(dest_dir, cfg=cfg)
    if not dest_hit.get("ok"):
        return dest_hit
    source = Path(str(src_hit["path"]))
    dest_parent = Path(str(dest_hit["path"]))
    if not dest_parent.is_dir():
        return {"ok": False, "detail": f"destination is not a folder: {dest_parent}"}
    target = dest_parent / source.name
    if target.exists():
        return {"ok": False, "detail": f"already exists: {target}"}
    try:
        if source.is_dir():
            shutil.copytree(source, target)
        else:
            shutil.copy2(source, target)
    except OSError as exc:
        return {"ok": False, "detail": str(exc)}
    return {"ok": True, "path": str(target), "from": str(source), "action": "copy", "reveal": True}


def move_path(src: str, dest_dir: str, *, cfg: dict[str, Any] | None = None) -> dict[str, Any]:
    import shutil

    src_hit = path_allowed(src, cfg=cfg, must_exist=True)
    if not src_hit.get("ok"):
        return src_hit
    source = Path(str(src_hit["path"]))
    if _is_protected_path(source, cfg):
        return {"ok": False, "detail": f"refused to move protected path: {source}"}
    dest_hit = resolve_friendly_dir(dest_dir, cfg=cfg)
    if not dest_hit.get("ok"):
        return dest_hit
    dest_parent = Path(str(dest_hit["path"]))
    if not dest_parent.is_dir():
        return {"ok": False, "detail": f"destination is not a folder: {dest_parent}"}
    target = dest_parent / source.name
    if target.exists():
        return {"ok": False, "detail": f"already exists: {target}"}
    try:
        shutil.move(str(source), str(target))
    except OSError as exc:
        return {"ok": False, "detail": str(exc)}
    return {"ok": True, "path": str(target), "from": str(source), "action": "move", "reveal": True}


def delete_path(path: str, *, confirm: bool = False, cfg: dict[str, Any] | None = None) -> dict[str, Any]:
    import shutil

    hit = path_allowed(path, cfg=cfg, must_exist=True)
    if not hit.get("ok"):
        return hit
    target = Path(str(hit["path"]))
    if _is_protected_path(target, cfg):
        return {"ok": False, "detail": f"refused to delete protected path: {target}"}
    if not confirm:
        kind = "folder" if target.is_dir() else "file"
        return {
            "ok": False,
            "needs_confirm": True,
            "path": str(target),
            "detail": (
                f"Delete needs your OK — say “yes delete” / “approve delete” for this {kind}: {target}"
            ),
        }
    try:
        if target.is_dir():
            shutil.rmtree(target)
        else:
            target.unlink()
    except OSError as exc:
        return {"ok": False, "detail": str(exc)}
    return {"ok": True, "path": str(target), "action": "delete"}


def open_email(provider: str = "auto", *, cfg: dict[str, Any] | None = None) -> dict[str, Any]:
    """Open Thunderbird (Chris's mail), Outlook, Gmail, or Windows Mail."""
    key = re.sub(r"\s+", " ", str(provider or "auto").strip().lower())
    order: list[str]
    if key in ("thunderbird", "tb", "mozilla"):
        order = ["thunderbird"]
    elif key in ("outlook", "desktop outlook"):
        order = ["outlook"]
    elif key in ("mail", "windows mail"):
        order = ["mail"]
    elif key in ("gmail", "google mail", "google"):
        order = ["gmail", "chrome"]
    else:
        # Chris uses Thunderbird day-to-day
        order = ["thunderbird", "outlook", "gmail", "mail"]

    last_err = "no email app found"
    for name in order:
        if name == "gmail":
            try:
                _start_uri("https://mail.google.com/")
                return {"ok": True, "app": "Gmail", "via": "https://mail.google.com/", "reveal": True}
            except Exception as exc:
                last_err = str(exc)
                continue
        hit = launch_app(name, cfg=cfg)
        if hit.get("ok"):
            hit["reveal"] = True
            return hit
        last_err = str(hit.get("detail") or last_err)
    return {"ok": False, "detail": last_err}


def empty_email_spam(*, confirm: bool = False, provider: str = "auto", cfg: dict[str, Any] | None = None) -> dict[str, Any]:
    """Empty junk/spam. Thunderbird: open app + Junk guidance. Outlook: COM clear. Gmail: open Spam."""
    if not confirm:
        return {
            "ok": False,
            "needs_confirm": True,
            "detail": (
                "Emptying spam needs your OK — say “yes empty spam” / “approve empty spam”. "
                "Thunderbird will open so you can Empty Junk; Outlook can clear Junk automatically."
            ),
        }

    key = re.sub(r"\s+", " ", str(provider or "auto").strip().lower())

    # Thunderbird first for Chris (no reliable empty-junk CLI — open + instruct)
    if key in ("auto", "thunderbird", "tb", "mozilla"):
        hit = launch_app("thunderbird", cfg=cfg)
        if hit.get("ok"):
            # Try bringing Thunderbird forward
            try:
                time.sleep(0.8)
                restore_window("Thunderbird")
            except Exception:
                pass
            return {
                "ok": True,
                "app": "Thunderbird",
                "action": "open_junk_hint",
                "detail": (
                    "Opened Thunderbird — click Junk, then Empty Junk "
                    "(or right-click Junk → Empty Junk)."
                ),
                "reveal": True,
            }
        if key in ("thunderbird", "tb", "mozilla"):
            return {"ok": False, "detail": hit.get("detail") or "Thunderbird not found"}

    # Outlook COM when asked or as fallback
    if key in ("auto", "outlook", "desktop outlook"):
        try:
            import win32com.client  # type: ignore

            outlook = win32com.client.Dispatch("Outlook.Application")
            ns = outlook.GetNamespace("MAPI")
            junk = ns.GetDefaultFolder(23)  # olFolderJunk
            count = int(junk.Items.Count)
            deleted = 0
            while junk.Items.Count > 0:
                junk.Items.Item(1).Delete()
                deleted += 1
                if deleted > 5000:
                    break
            return {
                "ok": True,
                "app": "Outlook",
                "action": "empty_spam",
                "deleted": deleted,
                "had": count,
            }
        except Exception as exc:
            if key == "outlook":
                return {"ok": False, "detail": f"Outlook spam clear failed: {exc}"}

    # Gmail spam folder
    try:
        _start_uri("https://mail.google.com/mail/u/0/#spam")
        return {
            "ok": True,
            "app": "Gmail",
            "action": "open_spam",
            "detail": "Opened Gmail Spam — tap Empty spam in the browser when you’re ready.",
            "reveal": True,
        }
    except Exception as exc:
        return {"ok": False, "detail": str(exc)}


def media_control(action: str = "play_pause", steps: int = 1, app: str | None = None) -> dict[str, Any]:
    key_name = str(action or "play_pause").strip().lower().replace("-", "_").replace(" ", "_")
    # Friendly aliases
    aliases = {
        "up": "volume_up",
        "down": "volume_down",
        "volumeup": "volume_up",
        "volumedown": "volume_down",
        "increase": "volume_up",
        "decrease": "volume_down",
        "lower": "volume_down",
        "raise": "volume_up",
        "turn_up": "volume_up",
        "turn_down": "volume_down",
    }
    key_name = aliases.get(key_name, key_name)
    # Per-app volume/mute — does NOT touch Amy's voice (system / other apps).
    vol_actions = {"volume_up", "volume_down", "mute", "unmute", "volume_mute"}
    target = str(app or "").strip()
    if key_name in vol_actions and target and target.lower() not in ("system", "master", "pc"):
        return app_audio(target, key_name, steps=steps)
    # Default volume nudges prefer Spotify when it's running, so Amy stays audible.
    if key_name in vol_actions and not target:
        spot = app_audio("spotify", key_name, steps=steps)
        if spot.get("ok"):
            spot["via"] = "spotify_session"
            return spot
        # fall through to system keys if Spotify isn't open
    vk = VK_MEDIA.get(key_name)
    if vk is None:
        return {
            "ok": False,
            "detail": (
                f"unknown media action “{action}”. "
                "Use play_pause/next/previous/stop/volume_up/volume_down/mute."
            ),
        }
    try:
        n = max(1, min(int(steps or 1), 20))
    except (TypeError, ValueError):
        n = 1
    # Volume taps: a few keypresses feel like a real nudge
    if key_name in ("volume_up", "volume_down") and n == 1:
        n = 2
    try:
        for _ in range(n):
            user32.keybd_event(vk, 0, KEYEVENTF_EXTENDEDKEY, 0)
            time.sleep(0.03)
            user32.keybd_event(vk, 0, KEYEVENTF_EXTENDEDKEY | KEYEVENTF_KEYUP, 0)
            time.sleep(0.04)
    except Exception as exc:
        return {"ok": False, "detail": str(exc)}
    return {"ok": True, "action": key_name, "steps": n, "via": "system"}


def _session_volumes_for_app(app: str, cfg: dict[str, Any] | None = None) -> dict[str, Any]:
    """Return pycaw SimpleAudioVolume controls for an allowlisted app's processes."""
    try:
        from pycaw.pycaw import AudioUtilities, ISimpleAudioVolume
    except ImportError:
        return {
            "ok": False,
            "detail": "Per-app volume needs pycaw — run: pip install pycaw comtypes",
        }
    hit = resolve_app(app, cfg)
    if not hit.get("ok"):
        return hit
    spec = hit["spec"]
    label = str(spec.get("label") or hit["key"])
    names = [str(n).lower() for n in (spec.get("process") or [])]
    if not names:
        # Derive from exe basenames
        for exe in spec.get("exe") or []:
            names.append(Path(str(exe)).name.lower())
    names = [n for n in names if n]
    if not names:
        return {"ok": False, "detail": f"no process name mapped for {label}"}

    controls = []
    try:
        sessions = AudioUtilities.GetAllSessions()
    except Exception as exc:
        return {"ok": False, "detail": f"audio session error: {exc}"}
    for session in sessions:
        proc = session.Process
        if not proc:
            continue
        try:
            pname = str(proc.name() or "").lower()
        except Exception:
            continue
        if pname not in names:
            continue
        try:
            vol = session._ctl.QueryInterface(ISimpleAudioVolume)
            controls.append((pname, vol))
        except Exception:
            continue
    if not controls:
        return {"ok": False, "detail": f"{label} isn’t playing audio right now (no session)."}
    return {"ok": True, "app": label, "controls": controls}


def app_audio(
    app: str,
    action: str = "volume_down",
    *,
    steps: int = 1,
    level: float | None = None,
    cfg: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Per-app volume/mute via Windows audio sessions — leaves Amy's TTS alone."""
    act = str(action or "volume_down").strip().lower().replace("-", "_").replace(" ", "_")
    aliases = {
        "up": "volume_up",
        "down": "volume_down",
        "lower": "volume_down",
        "louder": "volume_up",
        "raise": "volume_up",
        "increase": "volume_up",
        "decrease": "volume_down",
        "unmute": "unmute",
        "mute": "mute",
        "set": "set",
        "volume_mute": "mute",
    }
    act = aliases.get(act, act)
    found = _session_volumes_for_app(app, cfg)
    if not found.get("ok"):
        return found
    controls = found["controls"]
    label = found["app"]
    try:
        n = max(1, min(int(steps or 1), 20))
    except (TypeError, ValueError):
        n = 1
    if act in ("volume_up", "volume_down") and n == 1:
        n = 2
    step = 0.06
    touched = 0
    try:
        for _pname, vol in controls:
            if act == "mute":
                vol.SetMute(1, None)
                touched += 1
            elif act == "unmute":
                vol.SetMute(0, None)
                touched += 1
            elif act == "set":
                if level is None:
                    return {"ok": False, "detail": "level 0.0–1.0 required for set"}
                lv = max(0.0, min(1.0, float(level)))
                vol.SetMute(0, None)
                vol.SetMasterVolume(lv, None)
                touched += 1
            elif act == "volume_up":
                vol.SetMute(0, None)
                cur = float(vol.GetMasterVolume())
                for _ in range(n):
                    cur = min(1.0, cur + step)
                vol.SetMasterVolume(cur, None)
                touched += 1
            elif act == "volume_down":
                cur = float(vol.GetMasterVolume())
                for _ in range(n):
                    cur = max(0.0, cur - step)
                vol.SetMasterVolume(cur, None)
                touched += 1
            else:
                return {"ok": False, "detail": f"unknown app audio action “{action}”"}
    except Exception as exc:
        return {"ok": False, "detail": str(exc)}
    out: dict[str, Any] = {"ok": True, "app": label, "action": act, "sessions": touched}
    if act in ("volume_up", "volume_down"):
        out["steps"] = n
    if act == "set" and level is not None:
        out["level"] = max(0.0, min(1.0, float(level)))
    return out


def _is_task_window(hwnd: int) -> bool:
    """Visible, minimized, or a captioned app window sitting on the taskbar without the visible bit."""
    if user32.IsWindowVisible(hwnd) or user32.IsIconic(hwnd):
        return True
    style = user32.GetWindowLongW(hwnd, -16) & 0xFFFFFFFF
    exstyle = user32.GetWindowLongW(hwnd, -20) & 0xFFFFFFFF
    if exstyle & 0x00000080 and not exstyle & 0x00040000:
        return False
    return bool(style & 0x00C00000)


def _soft_title(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", text.lower()).strip()


def _title_rank(query: str, title: str, *, loose: bool = False) -> int | None:
    """0 is an exact title. A whole-word hit is next. Loose also allows Flightdeck3dprinters."""
    q = _soft_title(query)
    t = _soft_title(title)
    if len(q) < 2 or not t:
        return None
    if t == q:
        return 0
    if re.search(rf"(?<![a-z0-9]){re.escape(q)}(?![a-z0-9])", t):
        return 1000 + len(t)
    if loose and re.search(rf"(?<![a-z0-9]){re.escape(q)}", t):
        return 5000 + len(t)
    return None


def _find_windows(query: str, *, protected: bool = True, loose: bool = False) -> dict[str, Any]:
    q = str(query or "").strip().lower()
    if len(q) < 2:
        return {"ok": False, "detail": "window title query too short"}
    if _unsafe_chars(q):
        return {"ok": False, "detail": "unsafe query"}

    ranked: list[tuple[int, int, str]] = []

    @ctypes.WINFUNCTYPE(ctypes.c_bool, wintypes.HWND, wintypes.LPARAM)
    def enum_proc(hwnd, _lparam):  # noqa: N803
        if not _is_task_window(hwnd):
            return True
        length = user32.GetWindowTextLengthW(hwnd)
        if length <= 0:
            return True
        buf = ctypes.create_unicode_buffer(length + 1)
        user32.GetWindowTextW(hwnd, buf, length + 1)
        title = buf.value or ""
        if not title:
            return True
        if re.search(r"program manager|windows input experience|windows shell experience|search host", title, re.I):
            return True
        if re.match(r"amy(\s*-\s*flightdeck|\s+hands)?$", title.strip(), re.I) and q != "amy":
            return True
        if protected and PROTECTED_TITLE.search(title):
            return True
        rank = _title_rank(q, title, loose=loose)
        if rank is None:
            return True
        ranked.append((rank, int(hwnd), title))
        return True

    user32.EnumWindows(enum_proc, 0)
    if not ranked:
        return {"ok": False, "detail": f"no visible window matched “{query}”"}
    ranked.sort(key=lambda item: (item[0], len(item[2])))
    return {"ok": True, "matches": [(hwnd, title) for _, hwnd, title in ranked]}


def close_window(query: str) -> dict[str, Any]:
    found = _find_windows(query)
    if not found.get("ok"):
        return found
    hwnd, title = found["matches"][0]
    try:
        user32.PostMessageW(hwnd, WM_CLOSE, 0, 0)
    except Exception as exc:
        return {"ok": False, "detail": str(exc)}
    return {"ok": True, "title": title, "hwnd": hwnd, "action": "close"}


def minimize_window(query: str) -> dict[str, Any]:
    found = _find_windows(query)
    if not found.get("ok"):
        return found
    hwnd, title = found["matches"][0]
    try:
        user32.ShowWindow(hwnd, SW_MINIMIZE)
    except Exception as exc:
        return {"ok": False, "detail": str(exc)}
    return {"ok": True, "title": title, "hwnd": hwnd, "action": "minimize"}


def minimize_all_windows() -> dict[str, Any]:
    """Minimise every visible titled window except protected ones (Amy stays up)."""
    matches: list[tuple[int, str]] = []

    @ctypes.WINFUNCTYPE(ctypes.c_bool, wintypes.HWND, wintypes.LPARAM)
    def enum_proc(hwnd, _lparam):  # noqa: N803
        if not user32.IsWindowVisible(hwnd):
            return True
        # Skip already-minimised
        if user32.IsIconic(hwnd):
            return True
        length = user32.GetWindowTextLengthW(hwnd)
        if length <= 0:
            return True
        buf = ctypes.create_unicode_buffer(length + 1)
        user32.GetWindowTextW(hwnd, buf, length + 1)
        title = buf.value or ""
        if not title:
            return True
        if PROTECTED_TITLE.search(title):
            return True
        matches.append((int(hwnd), title))
        return True

    user32.EnumWindows(enum_proc, 0)
    done: list[str] = []
    for hwnd, title in matches:
        try:
            user32.ShowWindow(hwnd, SW_SHOWMINNOACTIVE)
            done.append(title)
        except Exception:
            continue
    return {"ok": True, "action": "minimize_all", "count": len(done), "titles": done[:30]}


def restore_window(query: str) -> dict[str, Any]:
    found = _find_windows(query, protected=False)
    if not found.get("ok"):
        return found
    hwnd, title = found["matches"][0]
    try:
        _force_foreground(hwnd)
    except Exception as exc:
        return {"ok": False, "detail": str(exc)}
    return {"ok": True, "title": title, "hwnd": hwnd, "action": "restore"}


def list_apps(cfg: dict[str, Any] | None = None) -> dict[str, Any]:
    cat = app_catalog(cfg)
    apps = sorted({str(v.get("label") or k) for k, v in cat.items()})
    return {"ok": True, "apps": apps}


# Common apps Amy can register by name without Chris hunting paths.
_REGISTER_HINTS: dict[str, dict[str, Any]] = {
    "discord": {
        "label": "Discord",
        "process": ["Discord.exe"],
        "exe_globs": [
            str(Path(os.environ.get("LOCALAPPDATA", "")) / "Discord" / "app-*" / "Discord.exe"),
        ],
    },
    "steam": {
        "label": "Steam",
        "process": ["steam.exe"],
        "exe": [
            str(Path(os.environ.get("PROGRAMFILES(X86)", r"C:\Program Files (x86)")) / "Steam" / "steam.exe"),
            str(Path(os.environ.get("PROGRAMFILES", r"C:\Program Files")) / "Steam" / "steam.exe"),
        ],
    },
    "vlc": {
        "label": "VLC",
        "process": ["vlc.exe"],
        "exe": [
            str(Path(os.environ.get("PROGRAMFILES", r"C:\Program Files")) / "VideoLAN" / "VLC" / "vlc.exe"),
            str(Path(os.environ.get("PROGRAMFILES(X86)", r"C:\Program Files (x86)")) / "VideoLAN" / "VLC" / "vlc.exe"),
        ],
    },
    "firefox": {
        "label": "Firefox",
        "process": ["firefox.exe"],
        "exe": [
            str(Path(os.environ.get("PROGRAMFILES", r"C:\Program Files")) / "Mozilla Firefox" / "firefox.exe"),
            str(Path(os.environ.get("PROGRAMFILES(X86)", r"C:\Program Files (x86)")) / "Mozilla Firefox" / "firefox.exe"),
        ],
    },
    "obs": {
        "label": "OBS Studio",
        "process": ["obs64.exe", "obs32.exe"],
        "exe": [
            str(Path(os.environ.get("PROGRAMFILES", r"C:\Program Files")) / "obs-studio" / "bin" / "64bit" / "obs64.exe"),
        ],
    },
    "whatsapp": {
        "label": "WhatsApp",
        "process": ["WhatsApp.exe"],
        "uri": "whatsapp:",
        "exe_globs": [
            str(Path(os.environ.get("LOCALAPPDATA", "")) / "WhatsApp" / "app-*" / "WhatsApp.exe"),
        ],
    },
}


def _first_existing(paths: list[str]) -> str | None:
    for p in paths:
        if p and Path(p).exists():
            return str(Path(p))
    return None


def _expand_globs(patterns: list[str]) -> list[str]:
    import glob

    out: list[str] = []
    for pat in patterns:
        out.extend(sorted(glob.glob(pat)))
    # Prefer highest version folder last → reverse so latest app-* wins often
    return list(reversed(out))


def _sanitize_app_key(name: str) -> str:
    key = re.sub(r"[^a-z0-9]+", "", str(name or "").strip().lower())
    return key


def _sanitize_process_list(raw: Any) -> list[str] | None:
    if raw is None:
        return None
    items = raw if isinstance(raw, list) else [raw]
    out: list[str] = []
    for item in items:
        s = str(item or "").strip()
        if not s:
            continue
        base = Path(s).name
        if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]*\.exe", base, re.I):
            return None
        out.append(base)
    return out or None


def discover_app_hint(name: str) -> dict[str, Any] | None:
    key = _sanitize_app_key(name)
    if not key:
        return None
    hint = _REGISTER_HINTS.get(key)
    if not hint:
        # fuzzy
        for k, v in _REGISTER_HINTS.items():
            if key in k or k in key or key in str(v.get("label") or "").lower().replace(" ", ""):
                hint = v
                key = k
                break
    if not hint:
        return None
    entry: dict[str, Any] = {
        "label": hint.get("label") or key.title(),
        "process": list(hint.get("process") or []),
    }
    if hint.get("uri"):
        entry["uri"] = hint["uri"]
    exes = list(hint.get("exe") or [])
    exes.extend(_expand_globs(list(hint.get("exe_globs") or [])))
    found = _first_existing(exes)
    if found:
        entry["exe"] = [found]
    return {"key": key, "entry": entry}


def _norm_app_name(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", str(name or "").lower())


def _shortcut_roots() -> list[Path]:
    roots: list[Path] = []
    appdata = os.environ.get("APPDATA") or ""
    programdata = os.environ.get("PROGRAMDATA") or r"C:\ProgramData"
    profile = os.environ.get("USERPROFILE") or ""
    for folder in (
        Path(appdata) / "Microsoft" / "Windows" / "Start Menu",
        Path(programdata) / "Microsoft" / "Windows" / "Start Menu",
        Path.home() / "Desktop",
        Path(profile) / "Desktop",
    ):
        if folder.is_dir():
            roots.append(folder)
    seen: set[str] = set()
    out: list[Path] = []
    for folder in roots:
        key = str(folder).lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(folder)
    return out


def _matching_shortcuts(name: str) -> list[Path]:
    want = _norm_app_name(name)
    if len(want) < 2:
        return []
    hits: list[tuple[int, Path]] = []
    seen = 0
    for root in _shortcut_roots():
        for dirpath, _dirnames, filenames in os.walk(root):
            for filename in filenames:
                if not filename.lower().endswith(".lnk"):
                    continue
                seen += 1
                if seen > 2500:
                    break
                stem = _norm_app_name(Path(filename).stem)
                if not stem or "uninstall" in stem:
                    continue
                if stem == want:
                    score = 0
                elif len(stem) >= 3 and (want in stem or stem in want):
                    score = 1
                else:
                    continue
                hits.append((score, Path(dirpath) / filename))
            else:
                continue
            break
    hits.sort(key=lambda item: (item[0], len(item[1].name)))
    return [path for _score, path in hits]


def _read_shortcut(path: Path) -> tuple[str, str]:
    env = os.environ.copy()
    env["AMY_LNK"] = str(path)
    try:
        proc = subprocess.run(
            [
                "powershell",
                "-NoProfile",
                "-Command",
                "$s=(New-Object -ComObject WScript.Shell).CreateShortcut($env:AMY_LNK); "
                "Write-Output $s.TargetPath; Write-Output '---'; Write-Output $s.Arguments",
            ],
            capture_output=True,
            text=True,
            timeout=8,
            env=env,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        return "", ""
    text = (proc.stdout or "").replace("\r", "")
    if "---" not in text:
        return text.strip(), ""
    target, args = text.split("---", 1)
    return target.strip(), args.strip()


def _registry_app_path(name: str) -> str | None:
    import winreg

    stem = re.sub(r"[^A-Za-z0-9._ -]+", "", str(name or "")).strip()
    if not stem:
        return None
    candidates = []
    for item in (stem, stem.replace(" ", "")):
        exe_name = item if item.lower().endswith(".exe") else item + ".exe"
        if exe_name not in candidates:
            candidates.append(exe_name)
    roots = (
        (winreg.HKEY_CURRENT_USER, r"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths"),
        (winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths"),
        (winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\App Paths"),
    )
    for root, sub in roots:
        for exe_name in candidates:
            try:
                with winreg.OpenKey(root, sub + "\\" + exe_name) as key:
                    val, _ = winreg.QueryValueEx(key, "")
            except OSError:
                continue
            if val and Path(str(val)).exists():
                return str(Path(str(val)))
    return None


def discover_installed_app(name: str) -> dict[str, Any] | None:
    """Find a Start Menu shortcut or registered exe for an app name. No whole-disk search."""
    reg = _registry_app_path(name)
    if reg:
        label = str(name or "").strip() or Path(reg).stem
        return {"label": label, "exe": [reg], "process": [Path(reg).name], "path": reg}
    for lnk in _matching_shortcuts(name)[:8]:
        target, _args = _read_shortcut(lnk)
        target_path = Path(target) if target else None
        entry: dict[str, Any] = {"label": lnk.stem, "exe": [str(lnk)], "path": str(lnk)}
        if target_path and target_path.suffix.lower() == ".exe":
            entry["process"] = [target_path.name]
            entry["path"] = str(target_path if target_path.exists() else lnk)
        return entry
    return None


def register_app(
    name: str,
    *,
    config_path: str | Path,
    process: list[str] | str | None = None,
    exe: str | list[str] | None = None,
    uri: str | None = None,
    label: str | None = None,
) -> dict[str, Any]:
    """Persist an allowlisted app into Hands config.json (safe fields only)."""
    key = _sanitize_app_key(name)
    if len(key) < 2:
        return {"ok": False, "detail": "app name too short / invalid"}
    if key in ("amy", "system", "cmd", "powershell", "python", "explorer"):
        # explorer already built-in; block dangerous names
        if key != "explorer":
            return {"ok": False, "detail": f"can't register reserved name “{name}”"}

    entry: dict[str, Any] = {}
    hint = discover_app_hint(name)
    if hint:
        entry.update(hint["entry"])
        key = hint["key"]

    if label:
        lab = str(label).strip()[:64]
        if lab:
            entry["label"] = lab
    entry.setdefault("label", key.title())

    procs = _sanitize_process_list(process) if process is not None else None
    if procs:
        entry["process"] = procs

    if exe is not None:
        paths = exe if isinstance(exe, list) else [exe]
        clean: list[str] = []
        for p in paths:
            norm = normalize_local_path(str(p))
            if not norm.get("ok"):
                return {"ok": False, "detail": f"bad exe path: {norm.get('detail')}"}
            text = str(norm["path"])
            if not text.lower().endswith((".exe", ".lnk")):
                return {"ok": False, "detail": "path must be a .exe or a shortcut"}
            clean.append(text)
        if clean:
            entry["exe"] = clean

    if uri is not None:
        u = str(uri).strip()
        if u and not re.fullmatch(r"[a-z][a-z0-9+.-]*:", u, re.I):
            return {"ok": False, "detail": "uri must look like discord: or spotify:"}
        if u:
            entry["uri"] = u

    if not entry.get("exe") and not entry.get("uri"):
        found = discover_installed_app(str(label or name))
        if found:
            entry["exe"] = list(found.get("exe") or [])
            if found.get("process") and not entry.get("process"):
                entry["process"] = list(found["process"])
            if not label:
                entry["label"] = str(found.get("label") or entry.get("label") or key.title())
            entry["path"] = found.get("path") or (entry["exe"][0] if entry.get("exe") else "")

    if not entry.get("process") and entry.get("exe"):
        first = str(entry["exe"][0])
        if first.lower().endswith(".exe"):
            entry["process"] = [Path(first).name]

    if not entry.get("exe") and not entry.get("uri"):
        return {
            "ok": False,
            "detail": (
                f"I couldn't find “{name}” on this PC. "
                "Tell me the path and I’ll add it."
            ),
        }

    found_path = str(entry.pop("path", "") or "")
    if not found_path and entry.get("exe"):
        found_path = str(entry["exe"][0])

    path = Path(config_path)
    try:
        data = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    except Exception as exc:
        return {"ok": False, "detail": f"couldn't read config: {exc}"}
    if not isinstance(data, dict):
        data = {}
    apps = data.get("apps")
    if not isinstance(apps, dict):
        apps = {}
    apps[key] = entry
    data["apps"] = apps
    try:
        path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    except Exception as exc:
        return {"ok": False, "detail": f"couldn't write config: {exc}"}
    return {
        "ok": True,
        "key": key,
        "app": entry.get("label") or key,
        "entry": entry,
        "path": found_path,
        "config": str(path),
    }
