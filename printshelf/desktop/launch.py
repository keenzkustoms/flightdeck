#!/usr/bin/env python3
"""MeshFinder desktop window. The library stays on the Pi."""
from __future__ import annotations

import ctypes
import os
import sys
from pathlib import Path

URL = "https://flightdeck.tail7de73e.ts.net:8100"
MUTEX_NAME = "Local\\MeshFinderDesktop"


def _storage() -> str:
    base = os.environ.get("APPDATA") or str(Path.home())
    path = Path(base) / "MeshFinder" / "webview"
    path.mkdir(parents=True, exist_ok=True)
    return str(path)


def _focus_existing() -> bool:
    if sys.platform != "win32":
        return False
    kernel32 = ctypes.windll.kernel32  # type: ignore[attr-defined]
    user32 = ctypes.windll.user32  # type: ignore[attr-defined]
    found: list[int] = []

    @ctypes.WINFUNCTYPE(ctypes.c_bool, ctypes.c_void_p, ctypes.c_void_p)
    def enum_proc(hwnd, _lparam):  # noqa: N803
        style = user32.GetWindowLongW(hwnd, -16) & 0xFFFFFFFF
        visible = bool(user32.IsWindowVisible(hwnd) or user32.IsIconic(hwnd) or (style & 0x00C00000))
        if not visible:
            return True
        length = user32.GetWindowTextLengthW(hwnd)
        if length <= 0:
            return True
        buf = ctypes.create_unicode_buffer(length + 1)
        user32.GetWindowTextW(hwnd, buf, length + 1)
        title = buf.value or ""
        if title == "MeshFinder" or title.startswith("MeshFinder "):
            found.append(int(hwnd))
        return True

    user32.EnumWindows(enum_proc, 0)
    if not found:
        return False
    hwnd = found[0]
    user32.keybd_event(0x12, 0, 0, 0)
    user32.keybd_event(0x12, 0, 2, 0)
    user32.ShowWindow(hwnd, 9)
    user32.SetWindowPos(hwnd, -1, 0, 0, 0, 0, 0x0002 | 0x0001 | 0x0040)
    user32.SetWindowPos(hwnd, -2, 0, 0, 0, 0, 0x0002 | 0x0001 | 0x0040)
    fg = user32.GetForegroundWindow()
    current = kernel32.GetCurrentThreadId()
    fg_thread = user32.GetWindowThreadProcessId(fg, None)
    target_thread = user32.GetWindowThreadProcessId(hwnd, None)
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
    return True


def _already_running() -> bool:
    if sys.platform != "win32":
        return False
    kernel32 = ctypes.windll.kernel32  # type: ignore[attr-defined]
    kernel32.CreateMutexW(None, False, MUTEX_NAME)
    already = int(kernel32.GetLastError()) == 183
    if not already:
        return False
    _focus_existing()
    return True


def _own_taskbar_icon() -> None:
    """The Pi library is not the local MeshFinder window."""
    if sys.platform != "win32":
        return
    ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID("Kidabah.MeshFinder.Library")


def main() -> int:
    _own_taskbar_icon()
    if _already_running():
        return 0
    import webview

    webview.create_window(
        "MeshFinder",
        URL,
        width=1440,
        height=960,
        min_size=(900, 640),
        confirm_close=False,
    )
    storage = _storage()
    try:
        webview.start(gui="edgechromium", private_mode=False, storage_path=storage)
    except TypeError:
        webview.start(gui="edgechromium", private_mode=False)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
