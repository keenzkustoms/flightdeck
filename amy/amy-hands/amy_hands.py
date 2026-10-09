#!/usr/bin/env python3
"""Amy Hands — tiny Windows companion for folders, Chrome tabs, and scoped desktop actions.

Run on Chris's PC (not the Pi):
  python amy_hands.py

Amy on the Pi calls this over Tailscale:
  hands_base_url in amy/config.json  e.g. http://100.x.x.x:4701

Chrome tabs need the companion extension loaded (chrome://extensions → Load unpacked → chrome-extension/).

Desktop extras (allowlisted, no arbitrary shell):
  open Explorer / file / file-with-app, launch app (Spotify+play), media keys, close window.
  Random albums belong in Cindy Vinyl — not here.
"""
from __future__ import annotations

import json
import os
import re
import threading
import time
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent
CONFIG_PATH = ROOT / "config.json"
PORT = 4701

LOCK = threading.Lock()
COMMAND_Q: list[dict[str, Any]] = []
LAST_RESULT: dict[str, Any] = {}
EXTENSION_SEEN = 0.0


def load_config() -> dict[str, Any]:
    if not CONFIG_PATH.exists():
        example = {
            "port": PORT,
            "roots": [
                str(Path.home() / "Documents"),
                str(Path.home() / "Downloads"),
                str(Path.home() / "Desktop"),
            ],
            "max_results": 40,
            "apps": {},
        }
        CONFIG_PATH.write_text(json.dumps(example, indent=2) + "\n", encoding="utf-8")
        return example
    return json.loads(CONFIG_PATH.read_text(encoding="utf-8"))


CFG: dict[str, Any] = {}


def reload_config() -> dict[str, Any]:
    global CFG
    CFG = load_config()
    return CFG


reload_config()

try:
    from desktop_actions import (
        app_audio as _app_audio,
        close_window as _close_window,
        copy_path as _copy_path,
        create_folder as _create_folder,
        delete_path as _delete_path,
        empty_email_spam as _empty_email_spam,
        launch_app as _launch_app,
        list_apps as _list_apps,
        media_control as _media_control,
        minimize_all_windows as _minimize_all_windows,
        minimize_window as _minimize_window,
        move_path as _move_path,
        open_email as _open_email,
        open_file as _open_file,
        open_file_explorer as _open_file_explorer,
        open_file_with as _open_file_with,
        register_app as _register_app,
        restore_window as _restore_window,
    )
except ImportError:  # pragma: no cover
    from amy.amy_hands.desktop_actions import (  # type: ignore
        app_audio as _app_audio,
        close_window as _close_window,
        copy_path as _copy_path,
        create_folder as _create_folder,
        delete_path as _delete_path,
        empty_email_spam as _empty_email_spam,
        launch_app as _launch_app,
        list_apps as _list_apps,
        media_control as _media_control,
        minimize_all_windows as _minimize_all_windows,
        minimize_window as _minimize_window,
        move_path as _move_path,
        open_email as _open_email,
        open_file as _open_file,
        open_file_explorer as _open_file_explorer,
        open_file_with as _open_file_with,
        register_app as _register_app,
        restore_window as _restore_window,
    )


def search_files(query: str, limit: int | None = None) -> list[dict[str, Any]]:
    q = " ".join(str(query or "").lower().split())
    if not q:
        return []
    tokens = [t for t in re.split(r"\s+", q) if t]
    limit = int(limit or CFG.get("max_results") or 40)
    roots = [Path(p) for p in (CFG.get("roots") or []) if p]
    hits: list[dict[str, Any]] = []
    skip_dirs = {".git", "node_modules", "__pycache__", ".venv", "venv", "AppData"}
    for root in roots:
        if not root.exists():
            continue
        for dirpath, dirnames, filenames in os.walk(root):
            dirnames[:] = [d for d in dirnames if d not in skip_dirs and not d.startswith(".")]
            for name in filenames:
                low = name.lower()
                if all(t in low or t in str(dirpath).lower() for t in tokens):
                    path = Path(dirpath) / name
                    try:
                        st = path.stat()
                        hits.append(
                            {
                                "name": name,
                                "path": str(path),
                                "bytes": st.st_size,
                                "mtime": int(st.st_mtime),
                            }
                        )
                    except OSError:
                        continue
                    if len(hits) >= limit:
                        return hits
    return hits


def open_file_explorer(path: str | None = None) -> dict[str, Any]:
    return _open_file_explorer(path)


def enqueue(cmd: dict[str, Any]) -> str:
    cid = f"c{int(time.time() * 1000)}"
    item = {"id": cid, "ts": time.time(), **cmd}
    with LOCK:
        COMMAND_Q.append(item)
        if len(COMMAND_Q) > 50:
            del COMMAND_Q[:-50]
    return cid


def pop_command(max_age_s: float = 45.0) -> dict[str, Any] | None:
    """Drop stale tab commands so a late-loaded extension doesn't fire old asks."""
    now = time.time()
    with LOCK:
        while COMMAND_Q and now - float(COMMAND_Q[0].get("ts") or 0) > max_age_s:
            COMMAND_Q.pop(0)
        return COMMAND_Q.pop(0) if COMMAND_Q else None


def clear_commands() -> int:
    with LOCK:
        n = len(COMMAND_Q)
        COMMAND_Q.clear()
        return n


class Handler(BaseHTTPRequestHandler):
    server_version = "AmyHands/1.0"

    def log_message(self, fmt: str, *args: Any) -> None:
        # Chrome extension polls /commands/next constantly — don't flood the console.
        try:
            line = fmt % args if args else str(fmt)
        except Exception:
            line = str(fmt)
        if "/commands/next" in line or " /health" in line or line.endswith("/health"):
            return
        print(f"[hands] {self.address_string()} {line}")

    def _cors(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def _json(self, code: int, payload: dict[str, Any]) -> None:
        raw = json.dumps(payload).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self._cors()
        self.end_headers()
        self.wfile.write(raw)

    def _read_json(self) -> dict[str, Any]:
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length else b"{}"
        return json.loads(raw.decode("utf-8") or "{}")

    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802
        global EXTENSION_SEEN
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        qs = urllib.parse.parse_qs(parsed.query)

        if path in ("/", "/health"):
            self._json(
                200,
                {
                    "ok": True,
                    "name": "Amy Hands",
                    "extension_seen_ago_s": round(time.time() - EXTENSION_SEEN, 1) if EXTENSION_SEEN else None,
                    "queue": len(COMMAND_Q),
                    "roots": CFG.get("roots") or [],
                },
            )
            return

        if path == "/search":
            q = (qs.get("q") or qs.get("query") or [""])[0]
            hits = search_files(q)
            self._json(200, {"ok": True, "query": q, "count": len(hits), "hits": hits})
            return

        if path == "/commands/next":
            EXTENSION_SEEN = time.time()
            cmd = pop_command()
            self._json(200, {"ok": True, "command": cmd})
            return

        if path == "/commands/last":
            self._json(200, {"ok": True, "result": LAST_RESULT})
            return

        if path == "/commands/clear":
            n = clear_commands()
            self._json(200, {"ok": True, "cleared": n})
            return

        self._json(404, {"detail": "not found"})

    def do_POST(self) -> None:  # noqa: N802
        global LAST_RESULT, EXTENSION_SEEN
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        try:
            body = self._read_json()
        except Exception as exc:
            self._json(400, {"detail": str(exc)})
            return

        if path == "/search":
            q = str(body.get("query") or body.get("q") or "")
            hits = search_files(q, body.get("limit"))
            self._json(200, {"ok": True, "query": q, "count": len(hits), "hits": hits})
            return

        if path == "/tabs/list":
            cid = enqueue({"action": "tabs_list"})
            self._json(200, {"ok": True, "id": cid, "detail": "queued for Chrome extension"})
            return

        if path == "/tabs/focus":
            query = str(body.get("query") or body.get("title") or body.get("url") or "").strip()
            if not query:
                self._json(400, {"detail": "query required"})
                return
            cid = enqueue({"action": "tabs_focus", "query": query})
            self._json(200, {"ok": True, "id": cid, "query": query})
            return

        if path == "/tabs/open":
            url = str(body.get("url") or "").strip()
            if not url:
                self._json(400, {"detail": "url required"})
                return
            cid = enqueue({"action": "tabs_open", "url": url})
            self._json(200, {"ok": True, "id": cid, "url": url})
            return

        if path in ("/explorer/open", "/open_explorer", "/open_file_explorer"):
            result = open_file_explorer(str(body.get("path") or body.get("folder") or "") or None)
            self._json(200 if result.get("ok") else 400, result)
            return

        if path in ("/file/open", "/open_file"):
            result = _open_file(str(body.get("path") or body.get("file") or ""))
            self._json(200 if result.get("ok") else 400, result)
            return

        if path in ("/file/open_with", "/open_file_with"):
            result = _open_file_with(
                str(body.get("path") or body.get("file") or ""),
                str(body.get("app") or body.get("with") or ""),
                cfg=CFG,
            )
            self._json(200 if result.get("ok") else 400, result)
            return

        if path in ("/file/mkdir", "/folder/create", "/create_folder"):
            result = _create_folder(
                str(body.get("parent") or body.get("path") or body.get("folder") or ""),
                str(body.get("name") or body.get("folder_name") or ""),
                cfg=CFG,
            )
            self._json(200 if result.get("ok") else 400, result)
            return

        if path in ("/file/copy", "/copy_path"):
            result = _copy_path(
                str(body.get("src") or body.get("source") or body.get("path") or ""),
                str(body.get("dest") or body.get("destination") or body.get("to") or ""),
                cfg=CFG,
            )
            self._json(200 if result.get("ok") else 400, result)
            return

        if path in ("/file/move", "/move_path", "/file/cut"):
            result = _move_path(
                str(body.get("src") or body.get("source") or body.get("path") or ""),
                str(body.get("dest") or body.get("destination") or body.get("to") or ""),
                cfg=CFG,
            )
            self._json(200 if result.get("ok") else 400, result)
            return

        if path in ("/file/delete", "/delete_path"):
            result = _delete_path(
                str(body.get("path") or body.get("file") or body.get("folder") or ""),
                confirm=bool(body.get("confirm") or body.get("approved") or body.get("yes")),
                cfg=CFG,
            )
            # needs_confirm is a soft refusal — still 200 so Amy can ask
            code = 200 if result.get("ok") or result.get("needs_confirm") else 400
            self._json(code, result)
            return

        if path in ("/email/open", "/open_email"):
            result = _open_email(str(body.get("provider") or body.get("app") or "auto"), cfg=CFG)
            self._json(200 if result.get("ok") else 400, result)
            return

        if path in ("/email/empty_spam", "/empty_spam"):
            result = _empty_email_spam(
                confirm=bool(body.get("confirm") or body.get("approved") or body.get("yes")),
                provider=str(body.get("provider") or body.get("app") or "auto"),
                cfg=CFG,
            )
            code = 200 if result.get("ok") or result.get("needs_confirm") else 400
            self._json(code, result)
            return

        if path in ("/app/launch", "/launch_app"):
            result = _launch_app(
                str(body.get("name") or body.get("app") or ""),
                cfg=CFG,
                play=bool(body.get("play") or body.get("and_play")),
                front=True if body.get("front") is None and body.get("focus") is None else bool(body.get("front") or body.get("focus")),
            )
            self._json(200 if result.get("ok") else 400, result)
            return

        if path in ("/app/list", "/list_apps"):
            self._json(200, _list_apps(CFG))
            return

        if path in ("/app/register", "/register_app"):
            result = _register_app(
                str(body.get("name") or body.get("app") or ""),
                config_path=CONFIG_PATH,
                process=body.get("process"),
                exe=body.get("exe") or body.get("path"),
                uri=body.get("uri"),
                label=body.get("label"),
            )
            if result.get("ok"):
                reload_config()
            self._json(200 if result.get("ok") else 400, result)
            return

        if path in ("/media", "/media/control"):
            steps = body.get("steps") or body.get("count") or 1
            result = _media_control(
                str(body.get("action") or body.get("command") or "play_pause"),
                steps=steps,
                app=str(body.get("app") or body.get("target") or "") or None,
            )
            self._json(200 if result.get("ok") else 400, result)
            return

        if path in ("/app/audio", "/app_volume", "/app/volume"):
            result = _app_audio(
                str(body.get("app") or body.get("name") or "spotify"),
                str(body.get("action") or body.get("command") or "volume_down"),
                steps=body.get("steps") or body.get("count") or 1,
                level=body.get("level"),
                cfg=CFG,
            )
            self._json(200 if result.get("ok") else 400, result)
            return

        if path in ("/window/close", "/close_window"):
            result = _close_window(str(body.get("query") or body.get("title") or ""))
            self._json(200 if result.get("ok") else 400, result)
            return

        if path in ("/window/minimize", "/minimize_window"):
            result = _minimize_window(str(body.get("query") or body.get("title") or ""))
            self._json(200 if result.get("ok") else 400, result)
            return

        if path in ("/window/minimize_all", "/minimize_all", "/minimize_all_windows"):
            result = _minimize_all_windows()
            self._json(200 if result.get("ok") else 400, result)
            return

        if path in ("/window/restore", "/restore_window"):
            result = _restore_window(str(body.get("query") or body.get("title") or ""))
            self._json(200 if result.get("ok") else 400, result)
            return

        if path == "/commands/result":
            EXTENSION_SEEN = time.time()
            LAST_RESULT = body if isinstance(body, dict) else {"raw": body}
            self._json(200, {"ok": True})
            return

        self._json(404, {"detail": "not found"})


def main() -> None:
    port = int(CFG.get("port") or PORT)
    server = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    print(f"Amy Hands on http://0.0.0.0:{port}")
    print(f"Roots: {CFG.get('roots')}")
    print("Load chrome-extension/ in Chrome, then point Pi Amy config hands_base_url here.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nbye")
        server.shutdown()


if __name__ == "__main__":
    main()
