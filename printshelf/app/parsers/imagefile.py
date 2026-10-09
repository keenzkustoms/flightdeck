from __future__ import annotations

from io import BytesIO
from pathlib import Path
from typing import Any

try:
    from PIL import Image
except Exception:  # pragma: no cover
    Image = None


def parse_image(path: Path, kind: str) -> dict[str, Any]:
    meta: dict[str, Any] = {}
    thumb_bytes: bytes | None = None

    if Image is not None and kind != "svg":
        try:
            with Image.open(path) as im:
                w, h = im.size
                meta["width"] = int(w)
                meta["height"] = int(h)
                im = im.convert("RGBA")
                im.thumbnail((640, 640))
                bio = BytesIO()
                im.save(bio, format="PNG", optimize=True)
                thumb_bytes = bio.getvalue()
        except Exception as exc:
            meta["error"] = str(exc)[:300]

    return {
        "kind": kind,
        "triangle_count": 0,
        "bbox": None,
        "meta": meta,
        "sidecars": [],
        "thumb_bytes": thumb_bytes,
        "is_sliced": False,
        "has_textures": False,
    }

