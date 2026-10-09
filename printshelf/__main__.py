"""python -m printshelf from repo root, or: python -m app inside printshelf/."""

from __future__ import annotations

import sys
from pathlib import Path

# Allow `python -m printshelf` from repo root.
ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import uvicorn

from app.config import load_config


def main() -> None:
    cfg = load_config()
    uvicorn.run(
        "app.main:app",
        host=str(cfg.get("host") or "0.0.0.0"),
        port=int(cfg.get("port") or 8100),
        reload=False,
    )


if __name__ == "__main__":
    main()
