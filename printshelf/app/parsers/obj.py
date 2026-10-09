from __future__ import annotations

from pathlib import Path
from typing import Any

from ..mesh_thumb import render_triangles_png, sample_stride

TEX_EXTS = {".png", ".jpg", ".jpeg", ".bmp", ".tga", ".tif", ".tiff", ".webp"}
MAX_PREVIEW_TRIS = 2_500_000


def _parse_mtl_textures(mtl_path: Path) -> list[str]:
    refs: list[str] = []
    try:
        text = mtl_path.read_text(encoding="utf-8", errors="ignore")
    except Exception:
        return refs
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        parts = line.split()
        if len(parts) >= 2 and parts[0].lower() in {
            "map_kd", "map_ka", "map_ks", "map_bump", "bump", "disp", "map_d", "refl",
        }:
            refs.append(parts[-1].strip().strip('"'))
    return refs


def _face_indices(token: str) -> int | None:
    try:
        return int(token.split("/", 1)[0])
    except Exception:
        return None


def parse_obj(path: Path) -> dict[str, Any]:
    verts: list[tuple[float, float, float]] = []
    tris: list = []
    face_count = 0
    mtllibs: list[str] = []

    try:
        with path.open("r", encoding="utf-8", errors="ignore") as f:
            for line in f:
                if line.startswith("v "):
                    parts = line.split()
                    if len(parts) >= 4:
                        try:
                            verts.append((float(parts[1]), float(parts[2]), float(parts[3])))
                        except Exception:
                            continue
                elif line.startswith("f "):
                    face_count += 1
                    if len(tris) >= MAX_PREVIEW_TRIS:
                        continue
                    idxs: list[int] = []
                    for tok in line.split()[1:]:
                        vi = _face_indices(tok)
                        if vi is None:
                            continue
                        if vi < 0:
                            vi = len(verts) + vi
                        else:
                            vi -= 1
                        if 0 <= vi < len(verts):
                            idxs.append(vi)
                    if len(idxs) < 3:
                        continue
                    for i in range(1, len(idxs) - 1):
                        if len(tris) >= MAX_PREVIEW_TRIS:
                            break
                        tris.append((verts[idxs[0]], verts[idxs[i]], verts[idxs[i + 1]]))
                elif line.startswith("mtllib "):
                    mtllibs.append(line.split(None, 1)[1].strip())
    except Exception as exc:
        return {
            "kind": "obj",
            "triangle_count": None,
            "bbox": None,
            "meta": {"error": str(exc)},
            "sidecars": [],
            "thumb_bytes": None,
            "is_sliced": False,
            "has_textures": False,
        }

    if len(tris) > MAX_PREVIEW_TRIS:
        stride = sample_stride(len(tris), MAX_PREVIEW_TRIS)
        tris = tris[::stride]

    sidecars: list[dict[str, Any]] = []
    texture_names: list[str] = []
    parent = path.parent
    for mtl_name in mtllibs:
        mtl_path = (parent / mtl_name).resolve()
        if mtl_path.exists():
            sidecars.append({
                "role": "mtl",
                "abs_path": str(mtl_path),
                "file_name": mtl_path.name,
                "size_bytes": mtl_path.stat().st_size,
            })
            for tex in _parse_mtl_textures(mtl_path):
                texture_names.append(tex)
                tex_path = (parent / tex).resolve()
                if tex_path.exists():
                    sidecars.append({
                        "role": "texture",
                        "abs_path": str(tex_path),
                        "file_name": tex_path.name,
                        "size_bytes": tex_path.stat().st_size,
                    })

    # Note: do NOT scrape random sibling images from the folder for thumbs —
    # packs share textures and every OBJ ends up with the same preview.

    seen: set[str] = set()
    uniq = []
    for s in sidecars:
        if s["abs_path"] in seen:
            continue
        seen.add(s["abs_path"])
        uniq.append(s)

    has_textures = any(s["role"] == "texture" for s in uniq)
    missing_tex = [name for name in texture_names if not (parent / name).exists()]

    # Mesh-only preview so each OBJ gets its own shape.
    thumb_bytes = render_triangles_png(tris) if tris else None
    if thumb_bytes is None:
        # Only the MTL-referenced maps for THIS file — never folder leftovers.
        for s in uniq:
            if s["role"] != "texture":
                continue
            try:
                thumb_bytes = Path(s["abs_path"]).read_bytes()
                break
            except Exception:
                continue

    return {
        "kind": "obj",
        "triangle_count": face_count,
        "bbox": None,
        "meta": {
            "vertex_count": len(verts),
            "face_count": face_count,
            "mtllibs": mtllibs,
            "texture_refs": texture_names,
            "missing_textures": missing_tex,
            "texture_pack_complete": not missing_tex and (has_textures or not texture_names),
            "preview_tris": len(tris),
        },
        "sidecars": uniq,
        "thumb_bytes": thumb_bytes,
        "is_sliced": False,
        "has_textures": has_textures,
    }
