#!/usr/bin/env python3
"""Flightdeck desktop window. The dashboard stays on the Pi."""
from __future__ import annotations

import ctypes
import json
import os
import re
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

URL = "https://flightdeck.tail7de73e.ts.net"
MUTEX_NAME = "Local\\FlightdeckDesktop"
NAV_HOST = "127.0.0.1"
NAV_PORT = 4712
_HASH = re.compile(r"^#/(?:[a-z0-9_-]+(?:/[a-z0-9._-]+)*)?$", re.I)
_PAINTER_HASH = re.compile(
    r"^#/painter\?src=/api/painter/inbox/[0-9a-f]{32}&name=[A-Za-z0-9._%~+-]+$",
    re.I,
)
_window = None


def _app_dir() -> Path:
    base = os.environ.get("APPDATA") or str(Path.home())
    path = Path(base) / "Flightdeck"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _storage() -> str:
    path = _app_dir() / "webview"
    path.mkdir(parents=True, exist_ok=True)
    return str(path)


def _pending_path() -> Path:
    return _app_dir() / "pending-hash.txt"


def _peek_pending() -> str:
    try:
        raw = _pending_path().read_text(encoding="utf-8").strip()
    except OSError:
        return ""
    return raw if _hash_ok(raw) else ""


def _take_pending() -> str:
    raw = _peek_pending()
    try:
        _pending_path().unlink(missing_ok=True)
    except OSError:
        pass
    return raw


def _hash_ok(raw: str) -> bool:
    return bool(_HASH.fullmatch(raw) or _PAINTER_HASH.fullmatch(raw))


def _apply_hash(raw: str) -> tuple[bool, str]:
    target = (raw or "").strip()
    if not _hash_ok(target):
        return False, "bad page"
    win = _window
    if win is None:
        return False, "window not ready"
    win.evaluate_js("location.hash = " + json.dumps(target))
    _focus_existing()
    return True, target


class _NavHandler(BaseHTTPRequestHandler):
    def do_POST(self) -> None:  # noqa: N802
        if self.path.split("?", 1)[0] != "/navigate":
            self.send_error(404)
            return
        try:
            length = int(self.headers.get("Content-Length") or "0")
        except ValueError:
            length = 0
        if length < 0 or length > 4096:
            self.send_error(400)
            return
        raw = self.rfile.read(length) if length else b"{}"
        try:
            body = json.loads(raw.decode("utf-8") or "{}")
        except json.JSONDecodeError:
            body = {}
        ok, detail = _apply_hash(str(body.get("hash") or ""))
        payload = json.dumps({"ok": ok, "detail": detail}).encode("utf-8")
        self.send_response(200 if ok else 409)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, fmt: str, *args) -> None:
        return


def _serve_nav() -> None:
    try:
        httpd = ThreadingHTTPServer((NAV_HOST, NAV_PORT), _NavHandler)
    except OSError:
        return
    httpd.serve_forever()


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
        if title == "Flightdeck" or title.startswith("Flightdeck "):
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


def _post_nav(target: str) -> bool:
    import urllib.request

    req = urllib.request.Request(
        f"http://{NAV_HOST}:{NAV_PORT}/navigate",
        data=json.dumps({"hash": target}).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=2) as resp:
            return resp.status == 200
    except Exception:
        return False


def _own_taskbar_icon() -> None:
    """Keep this window off the MeshFinder pythonw icon."""
    if sys.platform != "win32":
        return
    ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID("Kidabah.Flightdeck.Desktop")


def main() -> int:
    _own_taskbar_icon()
    pending = _peek_pending()
    if _already_running():
        if pending:
            _post_nav(pending)
        return 0
    pending = _take_pending()
    import webview

    global _window
    _window = webview.create_window(
        "Flightdeck",
        URL + (pending or ""),
        width=1500,
        height=980,
        min_size=(960, 640),
        confirm_close=False,
    )
    threading.Thread(target=_serve_nav, name="flightdeck-nav", daemon=True).start()
    storage = _storage()
    try:
        webview.start(gui="edgechromium", private_mode=False, storage_path=storage)
    except TypeError:
        webview.start(gui="edgechromium", private_mode=False)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
