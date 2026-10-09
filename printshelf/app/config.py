from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CONFIG_PATH = ROOT / "config.json"
EXAMPLE_CONFIG_PATH = ROOT / "config.example.json"

DEFAULT_IGNORE_GLOBS = [
    "**/node_modules/**",
    "**/.git/**",
    "**/__pycache__/**",
    "**/__MACOSX/**",
    "**/.Trash/**",
    "**/._*",
    "**/.DS_Store",
    "**/Thumbs.db",
    "**/*_temp.obj",
    "**/*_temp.OBJ",
    "**/temp.obj",
]


def _default_config() -> dict[str, Any]:
    return {
        "host": "0.0.0.0",
        "port": 8100,
        "data_dir": "data",
        "watched_folders": [],
        "ignore_globs": list(DEFAULT_IGNORE_GLOBS),
        "flightdeck_url": "http://127.0.0.1:8000",
        "flightdeck_public_url": "https://flightdeck.tail7de73e.ts.net",
    }


def load_config(path: Path | None = None) -> dict[str, Any]:
    cfg_path = path or Path(os.environ.get("PRINTSHELF_CONFIG", DEFAULT_CONFIG_PATH))
    base = _default_config()
    if not cfg_path.exists():
        if EXAMPLE_CONFIG_PATH.exists() and not DEFAULT_CONFIG_PATH.exists():
            # First run: seed a private config from the example (edit paths locally).
            DEFAULT_CONFIG_PATH.write_text(EXAMPLE_CONFIG_PATH.read_text(encoding="utf-8"), encoding="utf-8")
            cfg_path = DEFAULT_CONFIG_PATH
        else:
            return base
    try:
        data = json.loads(cfg_path.read_text(encoding="utf-8"))
    except Exception:
        return base
    if not isinstance(data, dict):
        return base
    base.update(data)
    return base


def save_config(cfg: dict[str, Any], path: Path | None = None) -> None:
    cfg_path = path or Path(os.environ.get("PRINTSHELF_CONFIG", DEFAULT_CONFIG_PATH))
    cfg_path.write_text(json.dumps(cfg, indent=2) + "\n", encoding="utf-8")


def data_dir(cfg: dict[str, Any] | None = None) -> Path:
    cfg = cfg or load_config()
    raw = cfg.get("data_dir") or "data"
    p = Path(raw)
    if not p.is_absolute():
        p = ROOT / p
    p.mkdir(parents=True, exist_ok=True)
    (p / "thumbs").mkdir(parents=True, exist_ok=True)
    return p


def db_path(cfg: dict[str, Any] | None = None) -> Path:
    return data_dir(cfg) / "printshelf.sqlite3"
