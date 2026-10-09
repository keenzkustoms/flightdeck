#!/usr/bin/env python3
"""Cindy Vinyl desktop window. The player stays on Mora."""
from __future__ import annotations

import ctypes
import os
import sys
from pathlib import Path

URL = "http://flightdeck-nas:4541"
MUTEX_NAME = "Local\\CindyVinylDesktop"
# Small player is 680×210. The room can still open large.
MIN_SIZE = (640, 160)

# The page only resizes itself in a Chrome app window, and WebView2 ignores
# window.resizeTo. Small player adds class "ribbon" and leaves this window
# full size, which is the big black page. Watch that class and size the
# real window. Native resizeTo/moveTo are swallowed so they cannot fight it.
_BRIDGE = r"""
(function () {
  if (window.__cindyDesktop) return;
  window.__cindyDesktop = true;
  var nativeMatch = window.matchMedia.bind(window);
  window.matchMedia = function (query) {
    var q = String(query);
    if (q.indexOf("display-mode") !== -1) {
      return {
        matches: true,
        media: q,
        addListener: function () {},
        removeListener: function () {},
        addEventListener: function () {},
        removeEventListener: function () {},
        dispatchEvent: function () { return false; }
      };
    }
    return nativeMatch(query);
  };
  window.resizeTo = function () {};
  window.moveTo = function () {};
  var room = null;
  var compact = false;
  function bounds(w, h, x, y) {
    var bridge = window.pywebview && window.pywebview.api;
    if (!bridge || !bridge.set_bounds) return;
    bridge.set_bounds(Math.round(w), Math.round(h), Math.round(x), Math.round(y));
  }
  function shrink() {
    if (!room) {
      room = {
        x: window.screenX || 40,
        y: window.screenY || 40,
        w: window.outerWidth || 1440,
        h: window.outerHeight || 960
      };
    }
    var screen = window.screen || {};
    var availLeft = screen.availLeft || 0;
    var availTop = screen.availTop || 0;
    var availW = screen.availWidth || 1280;
    var availH = screen.availHeight || 800;
    var screenH = screen.height || availH;
    var gap = Math.max(0, screenH - (availTop + availH));
    var reserve = gap > 8 ? 8 : 56;
    var w = Math.min(680, Math.max(640, availW - 24));
    var h = Math.min(210, Math.max(160, availH - 24));
    var x = availLeft + Math.max(0, Math.floor((availW - w) / 2));
    var y = Math.max(availTop, availTop + availH - h - reserve);
    bounds(w, h, x, y);
  }
  function grow() {
    var saved = room || { x: 40, y: 40, w: 1440, h: 960 };
    room = null;
    bounds(Math.max(saved.w, 980), Math.max(saved.h, 640), saved.x, saved.y);
  }
  function sync() {
    var next = !!(document.body && document.body.classList.contains("ribbon"));
    if (next === compact) return;
    compact = next;
    if (next) shrink();
    else grow();
  }
  var timer = 0;
  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(sync, 40);
  }
  if (document.body) {
    new MutationObserver(schedule).observe(document.body, {
      attributes: true,
      attributeFilter: ["class"]
    });
    compact = document.body.classList.contains("ribbon");
    if (compact) shrink();
  }
})();
"""

_user32 = ctypes.WinDLL("user32", use_last_error=True)
_user32.SetWindowPos.argtypes = [
    ctypes.c_void_p,
    ctypes.c_void_p,
    ctypes.c_int,
    ctypes.c_int,
    ctypes.c_int,
    ctypes.c_int,
    ctypes.c_uint,
]
_user32.SetWindowPos.restype = ctypes.c_bool


def _apply_bounds(native, width: int, height: int, x: int, y: int) -> None:
    """Size the WinForms window on the UI thread. pywebview's resize uses a
    32-bit handle and is easy to call off-thread, so the small player never moved."""
    try:
        from System.Windows.Forms import FormWindowState

        if native.WindowState != FormWindowState.Normal:
            native.WindowState = FormWindowState.Normal
    except Exception:
        pass
    scale = float(getattr(native, "_scale", 1) or 1)
    hwnd = ctypes.c_void_p(int(native.Handle.ToInt64()))
    _user32.SetWindowPos(
        hwnd,
        None,
        int(x * scale),
        int(y * scale),
        max(1, int(width * scale)),
        max(1, int(height * scale)),
        0x0004 | 0x0040,  # SWP_NOZORDER | SWP_SHOWWINDOW
    )


class VinylApi:
    def __init__(self) -> None:
        # Underscore so pywebview does not walk the window while exposing
        # set_bounds. A public attribute recurses into the WebView and the
        # JS bridge never gets installed.
        self._window = None

    def set_bounds(self, width: int, height: int, x: int, y: int) -> bool:
        window = self._window
        if window is None:
            return False
        native = getattr(window, "native", None)
        if native is None:
            return False
        w = max(MIN_SIZE[0], min(int(width), 2400))
        h = max(MIN_SIZE[1], min(int(height), 1600))
        x = int(x)
        y = int(y)

        def _apply() -> None:
            _apply_bounds(native, w, h, x, y)

        if bool(getattr(native, "InvokeRequired", False)):
            from System import Func, Type

            native.Invoke(Func[Type](_apply))
        else:
            _apply()
        return True


def _storage() -> str:
    base = os.environ.get("APPDATA") or str(Path.home())
    path = Path(base) / "CindyVinyl" / "webview"
    path.mkdir(parents=True, exist_ok=True)
    return str(path)


def _is_vinyl_title(title: str) -> bool:
    text = " ".join(title.replace("·", " ").split())
    return text == "Cindy Vinyl" or text.startswith("Cindy Vinyl ")


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
        if _is_vinyl_title(buf.value or ""):
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


def main() -> int:
    if _already_running():
        return 0
    import webview

    api = VinylApi()
    window = webview.create_window(
        "Cindy Vinyl",
        URL,
        width=1440,
        height=960,
        min_size=MIN_SIZE,
        confirm_close=False,
        js_api=api,
    )
    api._window = window
    window.events.loaded += lambda: window.evaluate_js(_BRIDGE)
    storage = _storage()
    try:
        webview.start(gui="edgechromium", private_mode=False, storage_path=storage)
    except TypeError:
        webview.start(gui="edgechromium", private_mode=False)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
