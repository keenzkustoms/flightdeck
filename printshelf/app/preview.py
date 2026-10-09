from __future__ import annotations

import hashlib
import io
import struct
import tempfile
import zipfile
from pathlib import Path
from typing import Any

from .config import data_dir, load_config
from .db import db_session, row_to_dict
from .mesh_junk import looks_like_image_bytes
from .parsers.threemf import extract_3mf_triangles


MAX_DIRECT_BYTES = 24_000_000
MAX_PREVIEW_TRIS = 400_000
MAX_PREVIEW_TRIS_HIGH = 750_000


def get_asset_row(asset_id: int) -> dict[str, Any] | None:
    cfg = load_config()
    db_file = data_dir(cfg) / "printshelf.sqlite3"
    with db_session(db_file) as conn:
        row = conn.execute(
            "SELECT * FROM assets WHERE id = ? AND missing = 0 AND COALESCE(hidden, 0) = 0",
            (asset_id,),
        ).fetchone()
    return row_to_dict(row)


def path_under_watched(abs_path: str, cfg: dict[str, Any] | None = None) -> bool:
    """True if path resolves under a watched folder root (file need not exist)."""
    cfg = cfg or load_config()
    try:
        target = Path(abs_path).resolve()
    except Exception:
        return False
    for folder in cfg.get("watched_folders") or []:
        root = Path(folder.get("path") or "")
        if not root.exists():
            continue
        try:
            target.relative_to(root.resolve())
            return True
        except Exception:
            continue
    return False


def path_is_allowed(abs_path: str, cfg: dict[str, Any] | None = None) -> bool:
    cfg = cfg or load_config()
    try:
        target = Path(abs_path).resolve()
    except Exception:
        return False
    if not target.is_file():
        return False
    return path_under_watched(str(target), cfg)


def _write_binary_stl(tris: list[tuple[tuple[float, float, float], tuple[float, float, float], tuple[float, float, float]]]) -> bytes:
    header = b"PrintShelf preview".ljust(80, b"\0")
    out = [header, struct.pack("<I", len(tris))]
    for a, b, c in tris:
        # rough normal
        ux, uy, uz = b[0] - a[0], b[1] - a[1], b[2] - a[2]
        vx, vy, vz = c[0] - a[0], c[1] - a[1], c[2] - a[2]
        nx = uy * vz - uz * vy
        ny = uz * vx - ux * vz
        nz = ux * vy - uy * vx
        out.append(struct.pack("<3f", nx, ny, nz))
        out.append(struct.pack("<3f", *a))
        out.append(struct.pack("<3f", *b))
        out.append(struct.pack("<3f", *c))
        out.append(struct.pack("<H", 0))
    return b"".join(out)


def decimate_binary_stl(path: Path, max_tris: int = MAX_PREVIEW_TRIS) -> bytes | None:
    data = path.read_bytes()
    if looks_like_image_bytes(data[:16]):
        return None
    if len(data) < 84:
        return None
    # ASCII STL (or binary that failed the size check): convert via shared parser.
    head = data[:80].lstrip().lower()
    is_ascii = head.startswith(b"solid") and b"facet" in data[:8192].lower()
    if is_ascii:
        tris = _parse_binary_stl_tris(data)
        if not tris:
            return None
        if len(tris) > max_tris:
            stride = max(1, (len(tris) + max_tris - 1) // max_tris)
            tris = tris[::stride][:max_tris]
        return _write_binary_stl(tris)

    n = struct.unpack_from("<I", data, 80)[0]
    expected = 84 + n * 50
    if n <= 0 or expected > len(data) + 50:
        # Last chance: some exporters write odd padding / ASCII without a clean solid header.
        tris = _parse_binary_stl_tris(data)
        if not tris:
            return None
        if len(tris) > max_tris:
            stride = max(1, (len(tris) + max_tris - 1) // max_tris)
            tris = tris[::stride][:max_tris]
        return _write_binary_stl(tris)
    if n <= max_tris:
        return data
    stride = max(1, (n + max_tris - 1) // max_tris)
    tris = []
    off = 84
    for i in range(n):
        if off + 50 > len(data):
            break
        if i % stride == 0:
            v0 = struct.unpack_from("<fff", data, off + 12)
            v1 = struct.unpack_from("<fff", data, off + 24)
            v2 = struct.unpack_from("<fff", data, off + 36)
            tris.append((v0, v1, v2))
        off += 50
        if len(tris) >= max_tris:
            break
    return _write_binary_stl(tris)


def decimate_obj_to_stl(path: Path, max_tris: int = MAX_PREVIEW_TRIS) -> bytes | None:
    verts: list[tuple[float, float, float]] = []
    tris: list = []
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
                idxs = []
                for tok in line.split()[1:]:
                    try:
                        vi = int(tok.split("/", 1)[0])
                    except Exception:
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
                    tris.append((verts[idxs[0]], verts[idxs[i]], verts[idxs[i + 1]]))
    if not tris:
        return None
    if len(tris) > max_tris:
        stride = max(1, (len(tris) + max_tris - 1) // max_tris)
        tris = tris[::stride][:max_tris]
    return _write_binary_stl(tris)


def cached_preview_path(content_hash: str, kind: str, max_tris: int) -> Path:
    prev = data_dir() / "previews"
    prev.mkdir(parents=True, exist_ok=True)
    return prev / f"{(content_hash or 'x')[:20]}_{kind}_{max_tris}.stl"


def cached_slicer_3mf_path(content_hash: str, kind: str, entry_key: str = "") -> Path:
    prev = data_dir() / "previews"
    prev.mkdir(parents=True, exist_ok=True)
    # v4: MakerDeck-style Bambu project (bed transform + plate_N.json + project_settings).
    key = hashlib.md5(f"{content_hash}|{kind}|{entry_key}|v4".encode("utf-8")).hexdigest()[:20]
    return prev / f"{key}_slicer4.3mf"


def _parse_binary_stl_tris(data: bytes) -> list[tuple[tuple[float, float, float], tuple[float, float, float], tuple[float, float, float]]]:
    if len(data) < 84:
        return []
    # ASCII STL — fall back via a temp decode path.
    head = data[:80].lstrip().lower()
    if head.startswith(b"solid") and b"facet" in data[:4096].lower():
        text = data.decode("utf-8", errors="ignore")
        tris = []
        verts: list[tuple[float, float, float]] = []
        for line in text.splitlines():
            parts = line.strip().split()
            if len(parts) >= 4 and parts[0].lower() == "vertex":
                try:
                    verts.append((float(parts[1]), float(parts[2]), float(parts[3])))
                except Exception:
                    continue
                if len(verts) == 3:
                    tris.append((verts[0], verts[1], verts[2]))
                    verts = []
        return tris
    n = struct.unpack_from("<I", data, 80)[0]
    if n <= 0 or 84 + n * 50 > len(data) + 50:
        return []
    tris = []
    off = 84
    for _ in range(n):
        if off + 50 > len(data):
            break
        v0 = struct.unpack_from("<fff", data, off + 12)
        v1 = struct.unpack_from("<fff", data, off + 24)
        v2 = struct.unpack_from("<fff", data, off + 36)
        tris.append((v0, v1, v2))
        off += 50
    return tris


def _recenter_tris_to_bed(
    tris: list[tuple[tuple[float, float, float], tuple[float, float, float], tuple[float, float, float]]],
) -> list[tuple[tuple[float, float, float], tuple[float, float, float], tuple[float, float, float]]]:
    """
    Luban / multipart chops often keep original assembly coordinates (far off the
    origin). Orbit recenters for display; Studio load_project does not — plate looks empty.
    Shift so the bbox sits on Z=0 and XY is centered on 0.
    """
    if not tris:
        return tris
    xs: list[float] = []
    ys: list[float] = []
    zs: list[float] = []
    for a, b, c in tris:
        for v in (a, b, c):
            xs.append(float(v[0]))
            ys.append(float(v[1]))
            zs.append(float(v[2]))
    min_x, max_x = min(xs), max(xs)
    min_y, max_y = min(ys), max(ys)
    min_z = min(zs)
    dx = -((min_x + max_x) / 2.0)
    dy = -((min_y + max_y) / 2.0)
    dz = -min_z
    if abs(dx) < 1e-6 and abs(dy) < 1e-6 and abs(dz) < 1e-6:
        return tris
    out = []
    for a, b, c in tris:
        out.append((
            (a[0] + dx, a[1] + dy, a[2] + dz),
            (b[0] + dx, b[1] + dy, b[2] + dz),
            (c[0] + dx, c[1] + dy, c[2] + dz),
        ))
    return out


# H2D printable bed — same as MakerDeck; used only to place the instance centre.
_BAMBU_BED_W = 350.0
_BAMBU_BED_D = 320.0
# 1×1 PNG — Studio plate tabs look for Metadata/plate_N.png alongside plate_N.json.
_MINIMAL_PLATE_PNG = bytes(
    [
        0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
        0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1F, 0x15, 0xC4,
        0x89, 0x00, 0x00, 0x00, 0x0A, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9C, 0x63, 0x00, 0x01, 0x00, 0x00,
        0x05, 0x00, 0x01, 0x0D, 0x0A, 0x2D, 0xB4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE,
        0x42, 0x60, 0x82,
    ]
)


def _fmt_mm(v: float) -> str:
    try:
        s = f"{float(v):.6f}".rstrip("0").rstrip(".")
    except Exception:
        return "0"
    if not s or s in ("-", "-0", "+"):
        return "0"
    return s


def _tris_to_3mf_bytes(
    tris: list[tuple[tuple[float, float, float], tuple[float, float, float], tuple[float, float, float]]],
    object_name: str = "model",
) -> bytes:
    """
    MakerDeck-style Bambu project 3MF for bambustudio://open?file=…

    Studio's URL-open always load_project()'s. A bare Core mesh (+ half-baked
    model_settings) downloads fine then shows an empty plate. Match the package
    MakerDeck already ships successfully: bed-centred build transform,
    model_settings without <part> for single objects, project_settings,
    plate_1.json + thumbnail stubs.
    """
    if not tris:
        raise ValueError("No triangles to pack into 3MF")

    # Local coords: XY centred on 0, Zmin=0 (Luban world-coords fix).
    tris = _recenter_tris_to_bed(tris)

    vert_index: dict[tuple[float, float, float], int] = {}
    verts: list[tuple[float, float, float]] = []
    tris_idx: list[tuple[int, int, int]] = []

    def vid(v: tuple[float, float, float]) -> int:
        key = (round(float(v[0]), 5), round(float(v[1]), 5), round(float(v[2]), 5))
        i = vert_index.get(key)
        if i is None:
            i = len(verts)
            vert_index[key] = i
            verts.append((float(v[0]), float(v[1]), float(v[2])))
        return i

    for a, b, c in tris:
        ia, ib, ic = vid(a), vid(b), vid(c)
        if ia != ib and ib != ic and ia != ic:
            tris_idx.append((ia, ib, ic))
    if not tris_idx:
        raise ValueError("No valid triangles after recenter")

    min_x = min(v[0] for v in verts)
    max_x = max(v[0] for v in verts)
    min_y = min(v[1] for v in verts)
    max_y = max(v[1] for v in verts)
    # Instance transform places local origin at bed centre (mesh already XY-centred).
    tx = _BAMBU_BED_W / 2.0
    ty = _BAMBU_BED_D / 2.0
    world_xf = f"1 0 0 0 1 0 0 0 1 {_fmt_mm(tx)} {_fmt_mm(ty)} 0"
    # plate_1.json bbox is plate-local (after transform).
    plate_min_x = min_x + tx
    plate_max_x = max_x + tx
    plate_min_y = min_y + ty
    plate_max_y = max_y + ty
    plate_w = max(0.001, plate_max_x - plate_min_x)
    plate_d = max(0.001, plate_max_y - plate_min_y)

    safe_name = "".join(ch if ch.isalnum() or ch in "-_." else "_" for ch in (object_name or "model"))[:80] or "model"
    xml_name = (
        safe_name.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )

    model_xml = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<model unit="millimeter" xml:lang="en-US" '
        'xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" '
        'xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06">\n'
        '  <metadata name="Application">PrintShelf</metadata>\n'
        f'  <metadata name="Title">{xml_name}</metadata>\n'
        "  <resources>\n"
        f'    <object id="1" type="model">\n'
        f'      <metadata name="Name">{xml_name}</metadata>\n'
        "      <metadata name=\"slic3rpe:extruder\">1</metadata>\n"
        "      <mesh>\n"
        "        <vertices>\n"
        + "".join(
            f'          <vertex x="{_fmt_mm(x)}" y="{_fmt_mm(y)}" z="{_fmt_mm(z)}" />\n'
            for x, y, z in verts
        )
        + "        </vertices>\n"
        "        <triangles>\n"
        + "".join(f'          <triangle v1="{a}" v2="{b}" v3="{c}" />\n' for a, b, c in tris_idx)
        + "        </triangles>\n"
        "      </mesh>\n"
        "    </object>\n"
        "  </resources>\n"
        "  <build>\n"
        f'    <item objectid="1" transform="{world_xf}" printable="1" auto_drop="1"/>\n'
        "  </build>\n"
        "</model>\n"
    )

    # Single-part: NO <part> tags (MakerDeck). Emitting <part id="1"> against a flat
    # root mesh made Studio load_project accept the file then leave the plate empty.
    model_settings = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        "<config>\n"
        '  <object id="1">\n'
        f'    <metadata key="name" value="{xml_name}"/>\n'
        '    <metadata key="extruder" value="1"/>\n'
        "  </object>\n"
        "  <plate>\n"
        '    <metadata key="plater_id" value="1"/>\n'
        '    <metadata key="plater_name" value=""/>\n'
        '    <metadata key="locked" value="false"/>\n'
        '    <metadata key="filament_map_mode" value="Auto For Flush"/>\n'
        '    <metadata key="thumbnail_file" value="Metadata/plate_1.png"/>\n'
        '    <metadata key="thumbnail_no_light_file" value="Metadata/plate_no_light_1.png"/>\n'
        '    <metadata key="top_file" value="Metadata/top_1.png"/>\n'
        '    <metadata key="pick_file" value="Metadata/pick_1.png"/>\n'
        '    <metadata key="pattern_bbox_file" value="Metadata/plate_1.json"/>\n'
        "    <model_instance>\n"
        '      <metadata key="object_id" value="1"/>\n'
        '      <metadata key="instance_id" value="0"/>\n'
        '      <metadata key="identify_id" value="1"/>\n'
        "    </model_instance>\n"
        "  </plate>\n"
        "  <assemble>\n"
        f'   <assemble_item object_id="1" instance_id="0" transform="{world_xf}" offset="0 0 0" />\n'
        "  </assemble>\n"
        "</config>\n"
    )

    # name must be the profile id — NOT the model filename (Studio quirk).
    project_settings = (
        "{\n"
        '  "from": "PrintShelf",\n'
        '  "name": "project_settings",\n'
        '  "version": "2.2.0",\n'
        f'  "printable_area": ["0x0", "{int(_BAMBU_BED_W)}x0", '
        f'"{int(_BAMBU_BED_W)}x{int(_BAMBU_BED_D)}", "0x{int(_BAMBU_BED_D)}"],\n'
        '  "printable_height": "325",\n'
        '  "filament_type": ["PLA"],\n'
        '  "filament_colour": ["#60B4EB"],\n'
        '  "filament_ids": ["0"],\n'
        '  "filament_settings_id": ["Generic PLA"],\n'
        '  "filament_vendor": ["Generic"],\n'
        '  "filament_diameter": ["1.75"],\n'
        '  "filament_density": ["1.24"],\n'
        '  "filament_map_mode": "Auto For Flush"\n'
        "}\n"
    )
    plate_json = (
        "{\n"
        '  "version": 2,\n'
        f'  "bbox_all": [{plate_min_x:.5f}, {plate_min_y:.5f}, {plate_max_x:.5f}, {plate_max_y:.5f}],\n'
        '  "bbox_objects": [{\n'
        '    "id": 1,\n'
        f'    "name": "{xml_name}",\n'
        f'    "bbox": [{plate_min_x:.5f}, {plate_min_y:.5f}, {plate_max_x:.5f}, {plate_max_y:.5f}],\n'
        f'    "area": {plate_w * plate_d:.5f},\n'
        '    "layer_height": 0.2\n'
        "  }],\n"
        '  "bed_type": "auto",\n'
        '  "filament_colors": [],\n'
        '  "filament_ids": [],\n'
        '  "first_extruder": 0,\n'
        '  "is_seq_print": false,\n'
        '  "nozzle_diameter": 0.4\n'
        "}\n"
    )
    content_types = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">\n'
        '  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>\n'
        '  <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>\n'
        '  <Default Extension="config" ContentType="application/octet-stream"/>\n'
        '  <Default Extension="json" ContentType="application/json"/>\n'
        '  <Default Extension="png" ContentType="image/png"/>\n'
        "</Types>\n"
    )
    root_rels = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n'
        '  <Relationship Target="/3D/3dmodel.model" Id="rel0" '
        'Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel" />\n'
        "</Relationships>\n"
    )

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        # Store mimetype uncompressed (OPC convention; MakerDeck does this too).
        zf.writestr(
            "mimetype",
            "application/vnd.ms-package.3dmanufacturing-3dmodel+xml",
            compress_type=zipfile.ZIP_STORED,
        )
        zf.writestr("[Content_Types].xml", content_types)
        zf.writestr("_rels/.rels", root_rels)
        zf.writestr("3D/3dmodel.model", model_xml)
        zf.writestr("Metadata/project_settings.config", project_settings)
        zf.writestr("Metadata/model_settings.config", model_settings)
        zf.writestr("Metadata/plate_1.json", plate_json)
        for name in (
            "Metadata/plate_1.png",
            "Metadata/plate_no_light_1.png",
            "Metadata/top_1.png",
            "Metadata/pick_1.png",
        ):
            zf.writestr(name, _MINIMAL_PLATE_PNG)
    return buf.getvalue()


def build_slicer_3mf(
    asset: dict[str, Any],
    entry: str | None = None,
) -> tuple[bytes, str]:
    """
    Bambu Studio's bambustudio://open?file=… downloader only accepts .3mf.
    Wrap STL/OBJ (and zip printables) into a minimal 3MF; pass through real 3MFs.
    """
    kind = asset.get("kind") or ""
    src = Path(asset["abs_path"])
    content_hash = asset.get("content_hash") or src.name
    base_name = Path(asset.get("file_name") or src.name).stem or "model"

    if entry:
        raw, inner_name = read_zip_entry_bytes(src, entry)
        ek = entry_kind(inner_name) or ""
        out_name = f"{Path(inner_name).stem or base_name}.3mf"
        cache = cached_slicer_3mf_path(content_hash, ek or "zip", entry)
        if cache.exists() and cache.stat().st_size > 64:
            return cache.read_bytes(), out_name
        if ek in ("3mf", "gcode.3mf"):
            cache.write_bytes(raw)
            return raw, out_name
        if ek == "stl":
            tris = _parse_binary_stl_tris(raw)
        elif ek == "obj":
            tmp = data_dir() / "previews" / f"_tmp_{cache.stem}.obj"
            tmp.write_bytes(raw)
            try:
                stl_blob = decimate_obj_to_stl(tmp, max_tris=5_000_000)
            finally:
                try:
                    tmp.unlink()
                except Exception:
                    pass
            if not stl_blob:
                raise ValueError("Could not read OBJ for slicer 3MF")
            tris = _parse_binary_stl_tris(stl_blob)
        else:
            raise ValueError("Zip entry is not a printable mesh")
        blob = _tris_to_3mf_bytes(tris, Path(inner_name).stem)
        cache.write_bytes(blob)
        return blob, out_name

    out_name = f"{base_name}.3mf"
    if kind in ("3mf", "gcode.3mf"):
        return src.read_bytes(), out_name

    cache = cached_slicer_3mf_path(content_hash, kind)
    if cache.exists() and cache.stat().st_mtime >= src.stat().st_mtime and cache.stat().st_size > 64:
        return cache.read_bytes(), out_name

    if kind == "stl":
        tris = _parse_binary_stl_tris(src.read_bytes())
    elif kind == "obj":
        stl_blob = decimate_obj_to_stl(src, max_tris=5_000_000)
        if not stl_blob:
            raise ValueError("Could not read OBJ for slicer 3MF")
        tris = _parse_binary_stl_tris(stl_blob)
    else:
        raise ValueError(f"Cannot build slicer 3MF for kind={kind}")
    blob = _tris_to_3mf_bytes(tris, base_name)
    cache.write_bytes(blob)
    return blob, out_name


def build_preview_stl(asset: dict[str, Any], max_tris: int = MAX_PREVIEW_TRIS) -> tuple[Path, bool]:
    """Return (path_to_stl, is_simplified)."""
    kind = asset.get("kind") or ""
    src = Path(asset["abs_path"])
    content_hash = asset.get("content_hash") or src.name
    cache = cached_preview_path(str(content_hash), kind, max_tris)

    if kind == "stl":
        size = src.stat().st_size
        data = src.read_bytes() if size <= MAX_DIRECT_BYTES else None
        if data is not None and looks_like_image_bytes(data[:16]):
            raise FileNotFoundError(
                "This file is an image renamed as .stl (Thingiverse card preview), not a mesh"
            )
        # Small binary STL: serve original when triangle count matches file size
        if data is not None and len(data) >= 84:
            head = data[:80].lstrip().lower()
            is_ascii = head.startswith(b"solid") and b"facet" in data[:8192].lower()
            if not is_ascii:
                n = struct.unpack_from("<I", data, 80)[0]
                if 0 < n <= max_tris and 84 + n * 50 <= len(data) + 50:
                    return src, False
            elif size <= MAX_DIRECT_BYTES:
                # Three.js STLLoader handles ASCII; serve as-is when small enough.
                return src, False
        if cache.exists() and cache.stat().st_mtime >= src.stat().st_mtime:
            return cache, True
        blob = decimate_binary_stl(src, max_tris=max_tris)
        if not blob:
            raise FileNotFoundError("Not a valid STL mesh (corrupt, empty, or unsupported)")
        cache.write_bytes(blob)
        return cache, True

    if kind == "obj":
        if cache.exists() and cache.stat().st_mtime >= src.stat().st_mtime:
            return cache, True
        blob = decimate_obj_to_stl(src, max_tris=max_tris)
        if not blob:
            raise FileNotFoundError("Could not build OBJ preview")
        cache.write_bytes(blob)
        return cache, True

    if kind in ("3mf", "gcode.3mf"):
        if cache.exists() and cache.stat().st_mtime >= src.stat().st_mtime:
            return cache, True
        tris = extract_3mf_triangles(src, max_tris=max_tris)
        if not tris:
            raise FileNotFoundError("No mesh found inside 3MF (settings/profile only?)")
        if len(tris) > max_tris:
            stride = max(1, (len(tris) + max_tris - 1) // max_tris)
            tris = tris[::stride][:max_tris]
        blob = _write_binary_stl(tris)
        cache.write_bytes(blob)
        return cache, True

    raise ValueError(f"Unsupported kind for 3D preview: {kind}")


def safe_zip_entry(name: str) -> str:
    n = (name or "").replace("\\", "/").lstrip("/")
    if not n or n.endswith("/") or ".." in n.split("/"):
        raise ValueError("Invalid zip entry path")
    return n


# Back-compat alias used by older call sites.
_safe_zip_entry = safe_zip_entry


def entry_kind(name: str) -> str | None:
    lower = name.lower()
    if lower.endswith(".gcode.3mf"):
        return "gcode.3mf"
    if lower.endswith(".3mf"):
        return "3mf"
    if lower.endswith(".stl"):
        return "stl"
    if lower.endswith(".obj"):
        return "obj"
    return None


_entry_kind = entry_kind


def resolve_zip_member(src: Path, entry: str) -> str:
    """Return the real ZipInfo filename for a logical entry path."""
    entry = safe_zip_entry(entry)
    with zipfile.ZipFile(src, "r") as zf:
        names = {n.replace("\\", "/"): n for n in zf.namelist()}
        real = names.get(entry)
        if real is None:
            lower_map = {k.lower(): v for k, v in names.items()}
            real = lower_map.get(entry.lower())
        if real is None:
            raise FileNotFoundError(f"Entry not found in zip: {entry}")
        return real


def read_zip_entry_bytes(src: Path, entry: str) -> tuple[bytes, str]:
    """Read bytes for a flat or nested (`outer.zip/inner.stl`) zip member."""
    from .parsers.ziparchive import split_nested_entry

    entry = safe_zip_entry(entry)
    nested, inner = split_nested_entry(entry)
    with zipfile.ZipFile(src, "r") as zf:
        names = {n.replace("\\", "/"): n for n in zf.namelist()}
        if nested:
            real_nested = names.get(nested)
            if real_nested is None:
                lower_map = {k.lower(): v for k, v in names.items()}
                real_nested = lower_map.get(nested.lower())
            if real_nested is None:
                raise FileNotFoundError(f"Nested zip not found: {nested}")
            raw_nested = zf.read(real_nested)
            with zipfile.ZipFile(io.BytesIO(raw_nested), "r") as inner_zf:
                inner_names = {n.replace("\\", "/"): n for n in inner_zf.namelist()}
                real = inner_names.get(inner)
                if real is None:
                    lower_map = {k.lower(): v for k, v in inner_names.items()}
                    real = lower_map.get(inner.lower())
                if real is None:
                    raise FileNotFoundError(f"Entry not found in nested zip: {inner}")
                return inner_zf.read(real), Path(inner).name
        real = names.get(entry)
        if real is None:
            lower_map = {k.lower(): v for k, v in names.items()}
            real = lower_map.get(entry.lower())
        if real is None:
            raise FileNotFoundError(f"Entry not found in zip: {entry}")
        return zf.read(real), Path(entry).name


def build_zip_entry_preview(
    asset: dict[str, Any],
    entry: str,
    max_tris: int = MAX_PREVIEW_TRIS,
) -> tuple[Path, bool]:
    """Extract one printable from a ZIP (or one level of nested ZIP) and build a preview STL."""
    if (asset.get("kind") or "") != "zip":
        raise ValueError("Not a zip asset")
    entry = safe_zip_entry(entry)
    from .parsers.ziparchive import split_nested_entry
    nested, inner = split_nested_entry(entry)
    mesh_name = inner if nested else entry
    ekind = entry_kind(mesh_name)
    if not ekind:
        raise ValueError("Zip entry is not a printable mesh (stl/obj/3mf)")

    src = Path(asset["abs_path"])
    content_hash = asset.get("content_hash") or src.name
    entry_key = hashlib.sha1(entry.encode("utf-8")).hexdigest()[:12]
    cache = cached_preview_path(str(content_hash), f"zip_{entry_key}_{ekind}", max_tris)
    if cache.exists() and cache.stat().st_mtime >= src.stat().st_mtime:
        return cache, True

    raw, file_name = read_zip_entry_bytes(src, entry)

    suffix = Path(mesh_name).suffix.lower() or ".bin"
    if mesh_name.lower().endswith(".gcode.3mf"):
        suffix = ".gcode.3mf"
    with tempfile.TemporaryDirectory(prefix="printshelf-zip-") as tmp:
        tmp_path = Path(tmp) / f"entry{suffix}"
        tmp_path.write_bytes(raw)
        fake = {
            "kind": ekind,
            "abs_path": str(tmp_path),
            "content_hash": f"{content_hash}_{entry_key}",
            "file_name": file_name,
        }
        # Build via temp file, then copy into stable cache key
        path, simplified = build_preview_stl(fake, max_tris=max_tris)
        data = path.read_bytes()
        cache.write_bytes(data)
        return cache, True
