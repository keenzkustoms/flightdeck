from __future__ import annotations

import json
import re
import zipfile
from io import BytesIO
from pathlib import Path
from typing import Any
from xml.etree import ElementTree as ET

from ..mesh_thumb import render_triangles_png, sample_stride

Tri = tuple[tuple[float, float, float], tuple[float, float, float], tuple[float, float, float]]
MAX_MESH_TRIS = 2_500_000


def _read_zip_text(z: zipfile.ZipFile, name: str) -> str:
    try:
        return z.read(name).decode("utf-8", "ignore")
    except Exception:
        return ""


def _parse_project_settings(raw: str) -> dict[str, Any]:
    if not raw.strip():
        return {}
    try:
        data = json.loads(raw)
        if isinstance(data, dict):
            return data
    except Exception:
        pass
    return {}


def _filament_summary(settings: dict[str, Any], plate: dict[str, Any] | None) -> list[dict[str, Any]]:
    colours = settings.get("filament_colour") or settings.get("filament_colors") or []
    types_ = settings.get("filament_type") or []
    ids = []
    if isinstance(plate, dict):
        ids = plate.get("filament_ids") or plate.get("filaments") or []
    out = []
    if isinstance(ids, list) and ids:
        for fid in ids:
            try:
                i = int(fid) - 1
            except Exception:
                continue
            entry = {"filament_id": fid}
            if isinstance(colours, list) and 0 <= i < len(colours):
                entry["colour"] = colours[i]
            if isinstance(types_, list) and 0 <= i < len(types_):
                entry["type"] = types_[i]
            out.append(entry)
        return out
    if isinstance(colours, list):
        for i, c in enumerate(colours[:16]):
            out.append({
                "filament_id": i + 1,
                "colour": c,
                "type": (types_[i] if isinstance(types_, list) and i < len(types_) else None),
            })
    return out


def _local(tag: str) -> str:
    return tag.split("}")[-1].lower()


def _mesh_tris_from_root(root: ET.Element, max_tris: int) -> list[Tri]:
    tris: list[Tri] = []
    for mesh in root.iter():
        if _local(mesh.tag) != "mesh":
            continue
        verts: list[tuple[float, float, float]] = []
        for child in list(mesh):
            tag = _local(child.tag)
            if tag == "vertices":
                for v in child:
                    if _local(v.tag) != "vertex":
                        continue
                    try:
                        verts.append((
                            float(v.attrib.get("x", 0)),
                            float(v.attrib.get("y", 0)),
                            float(v.attrib.get("z", 0)),
                        ))
                    except Exception:
                        continue
            elif tag == "triangles":
                for t in child:
                    if _local(t.tag) != "triangle":
                        continue
                    try:
                        i0 = int(t.attrib.get("v1", -1))
                        i1 = int(t.attrib.get("v2", -1))
                        i2 = int(t.attrib.get("v3", -1))
                    except Exception:
                        continue
                    if 0 <= i0 < len(verts) and 0 <= i1 < len(verts) and 0 <= i2 < len(verts):
                        tris.append((verts[i0], verts[i1], verts[i2]))
                        if len(tris) >= max_tris:
                            return tris
    return tris


def extract_3mf_triangles(path: Path, max_tris: int = MAX_MESH_TRIS) -> list[Tri]:
    """Pull triangle meshes from all .model parts inside a 3MF zip."""
    tris: list[Tri] = []
    with zipfile.ZipFile(path, "r") as z:
        model_names = [
            n for n in z.namelist()
            if n.replace("\\", "/").lower().endswith(".model")
        ]
        # Prefer object models, then root 3dmodel.model
        model_names.sort(key=lambda n: (0 if "/objects/" in n.replace("\\", "/").lower() else 1, n))
        for mn in model_names:
            if len(tris) >= max_tris:
                break
            try:
                root = ET.fromstring(z.read(mn))
            except Exception:
                continue
            part = _mesh_tris_from_root(root, max_tris - len(tris))
            if part:
                tris.extend(part)
    if len(tris) > max_tris:
        stride = sample_stride(len(tris), max_tris)
        tris = tris[::stride][:max_tris]
    return tris


def _embedded_thumb_useless(data: bytes) -> bool:
    """True when the baked preview is basically a black/empty square."""
    try:
        from PIL import Image
    except Exception:
        return False
    try:
        im = Image.open(BytesIO(data)).convert("L")
        im.thumbnail((64, 64))
        pixels = list(im.getdata())
        if not pixels:
            return True
        mean = sum(pixels) / len(pixels)
        return mean < 18
    except Exception:
        return False


def parse_3mf(path: Path, kind: str = "3mf") -> dict[str, Any]:
    meta: dict[str, Any] = {"plates": [], "objects": [], "filaments": []}
    thumb_bytes = None
    is_sliced = kind == "gcode.3mf" or path.name.lower().endswith(".gcode.3mf")
    triangle_count = None
    mesh_tris: list[Tri] = []

    try:
        with zipfile.ZipFile(path, "r") as z:
            names = z.namelist()
            name_map = {n.replace("\\", "/"): n for n in names}
            preferred = (
                "Metadata/plate_1.png",
                "Metadata/plate_no_light_1.png",
                "Metadata/top_1.png",
                "Metadata/pick_1.png",
                "Metadata/thumbnail.png",
                "Metadata/Thumbnail.png",
                "Metadata/thumbnail.jpg",
                "Thumbnails/thumbnail.png",
                "Thumbnails/Thumbnail.png",
            )
            for candidate in preferred:
                real = name_map.get(candidate)
                if real:
                    try:
                        thumb_bytes = z.read(real)
                        break
                    except Exception:
                        pass
            if thumb_bytes is None:
                for n in names:
                    nl = n.replace("\\", "/").lower()
                    if not nl.endswith((".png", ".jpg", ".jpeg")):
                        continue
                    if nl.startswith("metadata/") or nl.startswith("thumbnails/") or "thumb" in nl:
                        try:
                            thumb_bytes = z.read(n)
                            break
                        except Exception:
                            pass
            if thumb_bytes is None:
                for n in names:
                    if n.lower().endswith((".png", ".jpg", ".jpeg")):
                        try:
                            thumb_bytes = z.read(n)
                            break
                        except Exception:
                            pass

            settings = _parse_project_settings(_read_zip_text(z, "Metadata/project_settings.config"))
            if not settings:
                settings = _parse_project_settings(_read_zip_text(z, "project_settings.config"))

            plate_files = sorted(
                n for n in names
                if re.match(r"Metadata/plate_\d+\.json$", n.replace("\\", "/"))
            )
            for pf in plate_files:
                try:
                    plate = json.loads(z.read(pf).decode("utf-8", "ignore"))
                except Exception:
                    continue
                if not isinstance(plate, dict):
                    continue
                meta["plates"].append({
                    "file": pf,
                    "name": plate.get("name") or plate.get("plate_name") or Path(pf).stem,
                    "filament_ids": plate.get("filament_ids") or [],
                })
                if not meta["filaments"]:
                    meta["filaments"] = _filament_summary(settings, plate)

            if not meta["filaments"] and settings:
                meta["filaments"] = _filament_summary(settings, None)

            if any(n.endswith(".gcode") for n in names) or any("slice_info" in n for n in names):
                is_sliced = True

            model_names = [n for n in names if n.endswith(".model") or n.endswith("3dmodel.model")]
            for mn in model_names[:8]:
                try:
                    root = ET.fromstring(z.read(mn))
                except Exception:
                    continue
                for el in root.iter():
                    tag = _local(el.tag)
                    if tag == "object":
                        name = el.attrib.get("name") or el.attrib.get("id")
                        if name:
                            meta["objects"].append(str(name))

            meta["settings_keys"] = sorted(list(settings.keys()))[:40] if settings else []
            if settings.get("printer_model"):
                meta["printer_model"] = settings.get("printer_model")
            if settings.get("print_settings_id"):
                meta["print_settings_id"] = settings.get("print_settings_id")

        # Mesh extract once for count / thumb / orbit readiness
        need_mesh = (
            thumb_bytes is None
            or _embedded_thumb_useless(thumb_bytes)
        )
        mesh_tris = extract_3mf_triangles(path, max_tris=MAX_MESH_TRIS)
        triangle_count = len(mesh_tris) if mesh_tris else None
        meta["has_mesh"] = bool(mesh_tris)
        if need_mesh and mesh_tris:
            thumb_bytes = render_triangles_png(mesh_tris) or thumb_bytes

    except Exception as exc:
        return {
            "kind": kind,
            "triangle_count": None,
            "bbox": None,
            "meta": {"error": str(exc)},
            "sidecars": [],
            "thumb_bytes": None,
            "is_sliced": is_sliced,
            "has_textures": False,
        }

    return {
        "kind": kind,
        "triangle_count": triangle_count,
        "bbox": None,
        "meta": meta,
        "sidecars": [],
        "thumb_bytes": thumb_bytes,
        "is_sliced": is_sliced,
        "has_textures": False,
    }
