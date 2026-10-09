from __future__ import annotations

import base64
import re
from io import BytesIO
from pathlib import Path
from typing import Any

try:
    from PIL import Image, ImageDraw
except Exception:  # pragma: no cover
    Image = None
    ImageDraw = None

# Header + Prusa embedded thumbs live near the start; footer meta near the end.
_HEAD_BYTES = 256 * 1024
_TAIL_BYTES = 32 * 1024
_TOOLPATH_MAX_BYTES = 32 * 1024 * 1024
_TOOLPATH_MAX_SEGMENTS = 60000

_THUMB_BEGIN = re.compile(
    r";\s*thumbnail(?:_PNG)?\s+begin\s+(\d+)x(\d+)\s+(\d+)",
    re.IGNORECASE,
)
_THUMB_END = re.compile(r";\s*thumbnail(?:_PNG)?\s+end", re.IGNORECASE)
_MOVE_RE = re.compile(r"^(?:G0|G1)\s", re.IGNORECASE)
_WORD_RE = re.compile(r"([XYZE])\s*(-?(?:\d+(?:\.\d*)?|\.\d+))", re.IGNORECASE)


def _comment_value(line: str) -> str | None:
    s = line.strip()
    if not s.startswith(";"):
        return None
    return s[1:].strip()


def _parse_kv_comments(text: str) -> dict[str, str]:
    out: dict[str, str] = {}
    for raw in text.splitlines():
        body = _comment_value(raw)
        if not body or "=" not in body:
            continue
        key, _, val = body.partition("=")
        key = key.strip().lower()
        val = val.strip()
        if key and val:
            out[key] = val
    return out


def _extract_cura_headers(text: str) -> dict[str, Any]:
    meta: dict[str, Any] = {}
    bounds: dict[str, float] = {}
    for raw in text.splitlines():
        body = _comment_value(raw)
        if not body:
            continue
        upper = body.upper()
        if upper.startswith("FLAVOR:"):
            meta["flavor"] = body.split(":", 1)[1].strip()
        elif upper.startswith("TIME:"):
            try:
                secs = int(body.split(":", 1)[1].strip())
                meta["time_seconds"] = secs
                meta["print_time"] = _fmt_duration(secs)
            except ValueError:
                meta["print_time"] = body.split(":", 1)[1].strip()
        elif upper.startswith("FILAMENT USED:"):
            meta["filament_used"] = body.split(":", 1)[1].strip()
        elif upper.startswith("LAYER HEIGHT:"):
            meta["layer_height"] = body.split(":", 1)[1].strip()
        elif upper.startswith("LAYER_COUNT:"):
            try:
                meta["layer_count"] = int(body.split(":", 1)[1].strip())
            except ValueError:
                pass
        elif upper.startswith("GENERATED WITH"):
            meta["generator"] = body
        else:
            low = body.lower()
            for key in ("minx", "maxx", "miny", "maxy", "minz", "maxz"):
                if low.startswith(f"{key}:"):
                    try:
                        bounds[key] = float(body.split(":", 1)[1])
                    except ValueError:
                        pass
                    break
    if bounds:
        meta["bounds"] = bounds
    return meta


def _fmt_duration(secs: int) -> str:
    secs = max(0, int(secs))
    h, rem = divmod(secs, 3600)
    m, s = divmod(rem, 60)
    if h:
        return f"{h}h {m}m" if not s else f"{h}h {m}m {s}s"
    if m:
        return f"{m}m {s}s" if s else f"{m}m"
    return f"{s}s"


def _extract_prusa_thumb(text: str) -> bytes | None:
    """Pick the largest PNG thumbnail embedded in PrusaSlicer-style comments."""
    best: tuple[int, bytes] | None = None
    lines = text.splitlines()
    i = 0
    while i < len(lines):
        m = _THUMB_BEGIN.search(lines[i])
        if not m:
            i += 1
            continue
        w, h, declared = int(m.group(1)), int(m.group(2)), int(m.group(3))
        i += 1
        chunks: list[str] = []
        while i < len(lines):
            if _THUMB_END.search(lines[i]):
                break
            body = _comment_value(lines[i]) or ""
            chunks.append(body.replace(" ", ""))
            i += 1
        b64 = "".join(chunks)
        try:
            raw = base64.b64decode(b64, validate=False)
        except Exception:
            i += 1
            continue
        if not raw.startswith(b"\x89PNG"):
            i += 1
            continue
        area = w * h
        if best is None or area > best[0]:
            best = (area, raw)
        _ = declared
        i += 1
    return best[1] if best else None


def _apply_prusa_footer(meta: dict[str, Any], kv: dict[str, str]) -> None:
    if "estimated printing time (normal mode)" in kv:
        meta["print_time"] = kv["estimated printing time (normal mode)"]
    elif "estimated printing time" in kv:
        meta["print_time"] = kv["estimated printing time"]
    if "filament used [g]" in kv:
        meta["filament_used_g"] = kv["filament used [g]"]
    if "filament used [mm]" in kv:
        meta["filament_used_mm"] = kv["filament used [mm]"]
    if "filament used [cm3]" in kv:
        meta["filament_used_cm3"] = kv["filament used [cm3]"]
    if "total filament used [g]" in kv:
        meta["filament_used_g"] = kv["total filament used [g]"]
    if "printer_model" in kv:
        meta["printer_model"] = kv["printer_model"]
    if "layer_height" in kv:
        meta["layer_height"] = kv["layer_height"]
    if "generated by" in kv:
        meta["generator"] = kv["generated by"]
    for k, v in kv.items():
        if k.startswith("generated by"):
            meta["generator"] = f"{k} = {v}" if v else k
            break


def _render_toolpath_preview(path: Path) -> bytes | None:
    """Render a compact top-down preview from extrusion moves.

    This is deliberately bounded for NAS files. It reads at most 32 MiB and
    keeps at most 60k extrusion segments, enough for a recognisable card image
    without turning thumbnail rebuilding into a full G-code visualiser.
    """
    if Image is None or ImageDraw is None:
        return None

    x = y = z = e = 0.0
    absolute_xyz = True
    absolute_e = True
    segments: list[tuple[float, float, float, float, float]] = []
    read_bytes = 0

    try:
        with path.open("r", encoding="utf-8", errors="ignore") as fh:
            for raw in fh:
                read_bytes += len(raw.encode("utf-8", errors="ignore"))
                if read_bytes > _TOOLPATH_MAX_BYTES or len(segments) >= _TOOLPATH_MAX_SEGMENTS:
                    break
                line = raw.split(";", 1)[0].strip()
                if not line:
                    continue
                upper = line.upper()
                if upper == "G90":
                    absolute_xyz = True
                    continue
                if upper == "G91":
                    absolute_xyz = False
                    continue
                if upper == "M82":
                    absolute_e = True
                    continue
                if upper == "M83":
                    absolute_e = False
                    continue
                if upper.startswith("G92"):
                    vals = {k.upper(): float(v) for k, v in _WORD_RE.findall(line)}
                    if "X" in vals:
                        x = vals["X"]
                    if "Y" in vals:
                        y = vals["Y"]
                    if "Z" in vals:
                        z = vals["Z"]
                    if "E" in vals:
                        e = vals["E"]
                    continue
                if not _MOVE_RE.match(line):
                    continue

                vals = {k.upper(): float(v) for k, v in _WORD_RE.findall(line)}
                nx = vals.get("X", x)
                ny = vals.get("Y", y)
                nz = vals.get("Z", z)
                ne = vals.get("E", e)
                if not absolute_xyz:
                    nx = x + vals.get("X", 0.0)
                    ny = y + vals.get("Y", 0.0)
                    nz = z + vals.get("Z", 0.0)
                if not absolute_e:
                    ne = e + vals.get("E", 0.0)

                extruding = ("E" in vals) and (ne > e + 1e-7)
                moved_xy = abs(nx - x) > 1e-7 or abs(ny - y) > 1e-7
                if extruding and moved_xy:
                    segments.append((x, y, nx, ny, nz))

                x, y, z, e = nx, ny, nz, ne
    except Exception:
        return None

    if len(segments) < 3:
        return None

    xs = [p for seg in segments for p in (seg[0], seg[2])]
    ys = [p for seg in segments for p in (seg[1], seg[3])]
    min_x, max_x = min(xs), max(xs)
    min_y, max_y = min(ys), max(ys)
    span_x = max(max_x - min_x, 0.001)
    span_y = max(max_y - min_y, 0.001)

    size = 320
    margin = 24
    usable = size - margin * 2
    scale = min(usable / span_x, usable / span_y)
    draw_w = span_x * scale
    draw_h = span_y * scale
    off_x = (size - draw_w) / 2.0
    off_y = (size - draw_h) / 2.0

    im = Image.new("RGBA", (size, size), (11, 18, 30, 255))
    draw = ImageDraw.Draw(im)

    z_vals = [s[4] for s in segments]
    z_min, z_max = min(z_vals), max(z_vals)
    z_span = max(z_max - z_min, 0.001)
    line_width = 2 if len(segments) < 15000 else 1

    for x1, y1, x2, y2, sz in segments:
        t = (sz - z_min) / z_span
        shade = int(145 + 90 * t)
        color = (60, min(220, shade), 248, 210)
        px1 = off_x + (x1 - min_x) * scale
        py1 = size - (off_y + (y1 - min_y) * scale)
        px2 = off_x + (x2 - min_x) * scale
        py2 = size - (off_y + (y2 - min_y) * scale)
        draw.line((px1, py1, px2, py2), fill=color, width=line_width)

    out = BytesIO()
    im.save(out, format="PNG", optimize=True)
    return out.getvalue()


def parse_gcode(path: Path) -> dict[str, Any]:
    size = path.stat().st_size
    with path.open("rb") as f:
        head = f.read(_HEAD_BYTES)
        tail = b""
        if size > _HEAD_BYTES:
            f.seek(max(0, size - _TAIL_BYTES))
            tail = f.read(_TAIL_BYTES)

    head_text = head.decode("utf-8", errors="ignore")
    tail_text = tail.decode("utf-8", errors="ignore") if tail else ""

    meta: dict[str, Any] = {"extension": path.suffix.lower()}
    for raw in head_text.splitlines()[:40]:
        body = _comment_value(raw) or ""
        low = body.lower()
        if "prusaslicer" in low or "prusa slicer" in low:
            meta["generator"] = body if body.lower().startswith("generated") else "PrusaSlicer"
            break
        if "cura" in low and "generated" in low:
            meta["generator"] = body
            break
        if low.startswith("generated with cura"):
            meta["generator"] = body
            break

    meta.update(_extract_cura_headers(head_text))
    kv = _parse_kv_comments(head_text + "\n" + tail_text)
    _apply_prusa_footer(meta, kv)

    for raw in head_text.splitlines()[:8]:
        body = _comment_value(raw) or ""
        if body.lower().startswith("generated by"):
            meta.setdefault("generator", body)
            break

    thumb = _extract_prusa_thumb(head_text)
    if thumb:
        meta["preview_source"] = "embedded"
    else:
        thumb = _render_toolpath_preview(path)
        if thumb:
            meta["preview_source"] = "toolpath"

    bbox = None
    bounds = meta.get("bounds")
    if isinstance(bounds, dict) and {"minx", "maxx", "miny", "maxy"}.issubset(bounds):
        bbox = {
            "min": [bounds.get("minx"), bounds.get("miny"), bounds.get("minz", 0)],
            "max": [bounds.get("maxx"), bounds.get("maxy"), bounds.get("maxz", 0)],
        }

    return {
        "kind": "gcode",
        "meta": meta,
        "bbox": bbox,
        "sidecars": [],
        "is_sliced": True,
        "thumb_bytes": thumb,
        "triangle_count": None,
        "has_textures": False,
    }
