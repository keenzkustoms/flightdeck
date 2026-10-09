#!/usr/bin/env python3
"""Resolve Amy desktop paths (dev checkout vs frozen PyInstaller)."""
from __future__ import annotations

import os
import sys
from pathlib import Path


APP_NAME = "Amy"


def is_frozen() -> bool:
    return bool(getattr(sys, "frozen", False))


def amy_root() -> Path:
    """Directory that contains server.py, viewer/, notes/, amy-hands/."""
    env = (os.environ.get("AMY_ROOT") or "").strip()
    if env:
        return Path(env).expanduser().resolve()
    if is_frozen():
        # PyInstaller onedir: _MEIPASS holds bundled data; exe sits in dist/Amy/
        meipass = getattr(sys, "_MEIPASS", None)
        if meipass:
            bundled = Path(meipass) / "amy"
            if (bundled / "server.py").exists() or (bundled / "viewer").exists():
                return bundled.resolve()
            # Spec may unpack amy contents at _MEIPASS root
            if (Path(meipass) / "viewer").exists():
                return Path(meipass).resolve()
        return Path(sys.executable).resolve().parent
    # amy/desktop/paths.py → amy/
    return Path(__file__).resolve().parent.parent


def app_data_dir() -> Path:
    base = os.environ.get("AMY_APPDATA") or os.environ.get("APPDATA")
    if base:
        path = Path(base) / APP_NAME
    else:
        path = Path.home() / f".{APP_NAME.lower()}"
    path.mkdir(parents=True, exist_ok=True)
    return path.resolve()


def config_path() -> Path:
    env = (os.environ.get("AMY_CONFIG") or "").strip()
    if env:
        return Path(env).expanduser().resolve()
    return app_data_dir() / "config.json"


def uploads_dir() -> Path:
    env = (os.environ.get("AMY_UPLOADS") or "").strip()
    if env:
        return Path(env).expanduser().resolve()
    path = app_data_dir() / "uploads"
    path.mkdir(parents=True, exist_ok=True)
    return path


def hands_dir() -> Path:
    return amy_root() / "amy-hands"


def hands_script() -> Path:
    return hands_dir() / "amy_hands.py"


def server_script() -> Path:
    return amy_root() / "server.py"


def ensure_desktop_config(flightdeck_default: str = "https://flightdeck.tail7de73e.ts.net") -> Path:
    """Copy config.example.json into AppData on first run; force local Hands + bind."""
    import json

    cfg = config_path()
    if cfg.exists():
        return cfg
    example = amy_root() / "config.example.json"
    repo_cfg = amy_root() / "config.json"
    if repo_cfg.exists():
        try:
            obj = json.loads(repo_cfg.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            obj = {}
    elif example.exists():
        try:
            obj = json.loads(example.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            obj = {}
    else:
        obj = {}
    obj["hands_base_url"] = "http://127.0.0.1:4701"
    obj["flightdeck_base_url"] = obj.get("flightdeck_base_url") or flightdeck_default
    if str(obj.get("flightdeck_base_url") or "").rstrip("/") in (
        "http://127.0.0.1:8000",
        "http://localhost:8000",
        "http://100.106.112.104:8000",
    ):
        obj["flightdeck_base_url"] = flightdeck_default
    obj["bind_host"] = "127.0.0.1"
    obj["port"] = int(obj.get("port") or 4700)
    cfg.parent.mkdir(parents=True, exist_ok=True)
    cfg.write_text(json.dumps(obj, indent=2) + "\n", encoding="utf-8")
    return cfg
