from __future__ import annotations

import struct
from pathlib import Path
from typing import Any

from ..mesh_junk import describe_fake_mesh, looks_like_image_bytes
from ..mesh_thumb import render_triangles_png, sample_stride

# Scanned animal STLs are often 1–2M tris. Stride sampling punches holes → "fuzzy" thumbs.
# Keep effectively all faces for typical library files.
MAX_PREVIEW_TRIS = 2_500_000


def parse_stl(path: Path) -> dict[str, Any]:
    fake = describe_fake_mesh(path)
    if fake:
        return {
            "kind": "stl",
            "triangle_count": 0,
            "bbox": None,
            "meta": {"encoding": "invalid", "error": fake},
            "sidecars": [],
            "thumb_bytes": None,
            "is_sliced": False,
            "has_textures": False,
            "error": fake,
        }

    data = path.read_bytes()
    if looks_like_image_bytes(data[:16]):
        err = describe_fake_mesh(path) or "Image file with .stl extension"
        return {
            "kind": "stl",
            "triangle_count": 0,
            "bbox": None,
            "meta": {"encoding": "invalid", "error": err},
            "sidecars": [],
            "thumb_bytes": None,
            "is_sliced": False,
            "has_textures": False,
            "error": err,
        }

    n_tri = 0
    bbox = None
    binary = False
    thumb_bytes = None
    try:
        if len(data) >= 84:
            n = struct.unpack_from("<I", data, 80)[0]
            expected = 84 + n * 50
            # Allow small trailing padding; reject clearly wrong counts
            if n > 0 and expected <= len(data) + 50 and (expected == len(data) or abs(expected - len(data)) < 512):
                binary = True
                n_tri = n
                mins = [1e30, 1e30, 1e30]
                maxs = [-1e30, -1e30, -1e30]
                stride = sample_stride(n_tri, MAX_PREVIEW_TRIS)
                tris = []
                off = 84
                for i in range(n_tri):
                    if off + 50 > len(data):
                        break
                    v0 = struct.unpack_from("<fff", data, off + 12)
                    v1 = struct.unpack_from("<fff", data, off + 24)
                    v2 = struct.unpack_from("<fff", data, off + 36)
                    for x, y, z in (v0, v1, v2):
                        mins[0] = min(mins[0], x); maxs[0] = max(maxs[0], x)
                        mins[1] = min(mins[1], y); maxs[1] = max(maxs[1], y)
                        mins[2] = min(mins[2], z); maxs[2] = max(maxs[2], z)
                    if i % stride == 0:
                        tris.append((v0, v1, v2))
                    off += 50
                if n_tri:
                    bbox = {"min": mins, "max": maxs}
                if tris:
                    thumb_bytes = render_triangles_png(tris)
    except Exception:
        binary = False
        thumb_bytes = None

    if not binary:
        text = data.decode("utf-8", "ignore")
        n_tri = text.lower().count("facet normal")

    return {
        "kind": "stl",
        "triangle_count": n_tri,
        "bbox": bbox,
        "meta": {"encoding": "binary" if binary else "ascii"},
        "sidecars": [],
        "thumb_bytes": thumb_bytes,
        "is_sliced": False,
        "has_textures": False,
    }
