from __future__ import annotations

import os
from pathlib import Path

APP_DIR = Path(__file__).resolve().parent.parent


def _load_dotenv() -> None:
    env_path = APP_DIR / ".env"
    if not env_path.exists():
        return
    for raw in env_path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


def _path_from_env(name: str, default: Path) -> Path:
    value = os.environ.get(name)
    if not value:
        return default
    return Path(value).expanduser()


_load_dotenv()

_data_dir_configured = bool(os.environ.get("FLIGHTDECK_DATA_DIR"))
DATA_DIR = _path_from_env("FLIGHTDECK_DATA_DIR", APP_DIR)
DB_PATH = _path_from_env("FLIGHTDECK_DB_PATH", DATA_DIR / "flightdeck.db")
UPLOADS_DIR = _path_from_env("FLIGHTDECK_UPLOADS_DIR", DATA_DIR / "uploads")
PRINTERS_CONFIG_PATH = _path_from_env("FLIGHTDECK_PRINTERS_CONFIG", DATA_DIR / "printers.yaml")
PRINT_LIBRARY_DIR = _path_from_env(
    "FLIGHTDECK_PRINT_LIBRARY",
    DATA_DIR / "print_library" if _data_dir_configured else Path("/home/flightdeck/print_library"),
)
