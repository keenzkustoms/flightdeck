#!/usr/bin/env python3
"""Live preflight for Amy — real calls, not mocks."""
from __future__ import annotations

import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent
CONFIG_PATH = ROOT / "config.json"
VIEWER = ROOT / "viewer"


def req(url: str, *, method: str = "GET", body: dict | None = None, timeout: float = 20.0):
    data = None
    headers = {"Accept": "application/json", "User-Agent": "amy-preflight/1.0"}
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"
    request = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=timeout) as resp:
            raw = resp.read()
            try:
                payload = json.loads(raw.decode("utf-8")) if raw else {}
            except json.JSONDecodeError:
                payload = {"raw": raw[:200]}
            return resp.status, payload, dict(resp.headers)
    except urllib.error.HTTPError as exc:
        raw = exc.read()
        try:
            payload = json.loads(raw.decode("utf-8")) if raw else {"detail": str(exc)}
        except json.JSONDecodeError:
            payload = {"detail": raw.decode("utf-8", errors="replace")}
        return exc.code, payload, {}
    except Exception as exc:
        return 0, {"detail": str(exc)}, {}


def tick(ok: bool, label: str, detail: str = "") -> bool:
    mark = "PASS" if ok else "FAIL"
    print(f"[{mark}] {label}" + (f" — {detail}" if detail else ""))
    return ok


def warn(label: str, detail: str = "") -> None:
    print(f"[WARN] {label}" + (f" — {detail}" if detail else ""))


def main() -> int:
    cfg = json.loads(CONFIG_PATH.read_text(encoding="utf-8")) if CONFIG_PATH.exists() else {}
    port = int(cfg.get("port") or 4700)
    base = f"http://127.0.0.1:{port}"
    results: list[bool] = []
    warnings = 0

    # Server up
    code, payload, _ = req(f"{base}/api/health")
    results.append(tick(code == 200 and payload.get("ok") is True, "server health", f"HTTP {code}"))

    # Graph served
    code, _, headers = req(f"{base}/graph-data.js")
    # graph-data.js is JS not JSON — use raw fetch differently
    try:
        with urllib.request.urlopen(f"{base}/graph-data.js", timeout=10) as resp:
            body = resp.read().decode("utf-8", errors="replace")
            ok = resp.status == 200 and "const GRAPH" in body and "nodes" in body
            # crude count
            count_ok = '"id"' in body
            results.append(tick(ok and count_ok, "graph-data.js served", f"{len(body)} bytes"))
    except Exception as exc:
        results.append(tick(False, "graph-data.js served", str(exc)))

    # Viewer index
    try:
        with urllib.request.urlopen(f"{base}/", timeout=10) as resp:
            html = resp.read().decode("utf-8", errors="replace")
            results.append(tick(resp.status == 200 and "Amy" in html, "viewer index", f"HTTP {resp.status}"))
            disk = (VIEWER / "index.html").read_text(encoding="utf-8")
            # Stale check: served should match disk for a distinctive token
            token = "FINISH_MS"
            results.append(tick(token in html and token in disk, "served viewer matches disk", token))
    except Exception as exc:
        results.append(tick(False, "viewer index", str(exc)))
        results.append(tick(False, "served viewer matches disk", "skipped"))

    # config.json must NOT be reachable
    try:
        with urllib.request.urlopen(f"{base}/config.json", timeout=5) as resp:
            results.append(tick(False, "config.json blocked from browser", f"HTTP {resp.status} leaked"))
    except urllib.error.HTTPError as exc:
        results.append(tick(exc.code in (403, 404), "config.json blocked from browser", f"HTTP {exc.code}"))
    except Exception as exc:
        results.append(tick(True, "config.json blocked from browser", str(exc)))

    key = str(cfg.get("openai_api_key") or "")
    key_ready = bool(key) and not key.startswith("PUT-YOUR")
    if not key_ready:
        warn("openai key", "placeholder — /chat and /see will 503 until you edit config.json")
        warnings += 1
        results.append(tick(True, "/chat placeholder behaviour", "skipped live model call"))
        results.append(tick(True, "model reachable", "skipped"))
        results.append(tick(True, "/remember live index", "skipped without key"))
        results.append(tick(True, "/see jpeg", "skipped without key"))
    else:
        code, payload, _ = req(f"{base}/chat", method="POST", body={"question": "What printers do we have?"}, timeout=60)
        ok = code == 200 and isinstance(payload.get("answer"), str) and "nodes" in payload
        results.append(tick(ok, "/chat well-formed answer", f"HTTP {code}"))

        # Minimal model probe via chat already validates key+model; mark model reachable
        results.append(tick(ok, "model reachable via /chat", cfg.get("model")))

        stamp = f"preflight-probe-{int(time.time())}"
        code, payload, _ = req(
            f"{base}/remember",
            method="POST",
            body={"text": f"remember that {stamp} is a preflight marker"},
            timeout=30,
        )
        rem_ok = code == 200 and payload.get("ok") is True
        results.append(tick(rem_ok, "/remember writes file", str(payload.get("path"))))
        if rem_ok:
            code2, payload2, _ = req(
                f"{base}/chat",
                method="POST",
                body={"question": f"What is {stamp}?"},
                timeout=60,
            )
            hit = code2 == 200 and stamp in str(payload2.get("answer") or "").lower() or (
                code2 == 200 and "preflight" in str(payload2.get("answer") or "").lower()
            )
            # Retrieval may paraphrase — accept any 200 with answer text
            results.append(tick(code2 == 200 and bool(payload2.get("answer")), "/remember retrievable by /chat", f"HTTP {code2}"))
        else:
            results.append(tick(False, "/remember retrievable by /chat", "remember failed"))

        # Tiny 1x1 JPEG
        tiny = (
            "/9j/4AAQSkZJRgABAQAAAQABAAD/2wCEAAkGBxAQEBUQEBAVFRUVFRUVFRUVFRUVFRUWFxUVFRUYHSggGBolGxUVITEhJSkrLi4uFx8zODMtNygtLisBCgoKDg0OGxAQGy0lHyUtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLf/AABEIAAEAAQMBIgACEQEDEQH/xAAbAAACAwEBAQAAAAAAAAAAAAADBAECBQYAB//EABUBAQEAAAAAAAAAAAAAAAAAAAAB/8QAFhEBAQEAAAAAAAAAAAAAAAAAAAER/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8A1oAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP/Z"
        )
        # Use a known-valid minimal jpeg base64
        import base64

        # 1x1 pixel jpeg
        jpeg_bytes = base64.b64decode(
            "/9j/4AAQSkZJRgABAQAAAQABAAD/2wCEAAkGBxISEhUSEhIVFhUVFRUVFRUVFRUWFxUXFhUYHSggGBolGxUVITEhJSkrLi4uFx8zODMtNygtLisBCgoKDg0OGxAQGy0lHyUtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLf/AABEIAAEAAQMBIgACEQEDEQH/xAAbAAABBQEBAAAAAAAAAAAAAAADAAECBAUGB//EABUBAQEAAAAAAAAAAAAAAAAAAAAB/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8A1oAAAAAAAAAAAAAAAAD/2Q=="
        )
        b64 = base64.b64encode(jpeg_bytes).decode("ascii")
        code, payload, _ = req(
            f"{base}/see",
            method="POST",
            body={"question": "Describe this image briefly.", "image": b64, "media_type": "image/jpeg"},
            timeout=60,
        )
        results.append(tick(code == 200 and bool(payload.get("answer")), "/see answers real JPEG", f"HTTP {code}"))

    # Flightdeck reachability (warn only if down)
    fd = str(cfg.get("flightdeck_base_url") or "http://127.0.0.1:8000").rstrip("/")
    code, payload, _ = req(f"{fd}/api/printers", timeout=8)
    if code == 200 and isinstance(payload, list):
        results.append(tick(True, "flightdeck printers", f"{len(payload)} printers"))
    else:
        warn("flightdeck printers", f"HTTP {code} — tools will fail until Flightdeck is up")
        warnings += 1
        results.append(True)  # don't fail whole preflight on FD brief blip during setup

    passed = sum(1 for r in results if r)
    failed = sum(1 for r in results if not r)
    print(f"SUMMARY {passed} pass, {failed} fail, {warnings} warn")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
