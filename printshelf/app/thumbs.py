from __future__ import annotations

import hashlib
from pathlib import Path
from typing import Optional

try:
    from PIL import Image, ImageDraw, ImageFont
except Exception:  # pragma: no cover
    Image = None
    ImageDraw = None
    ImageFont = None

SHARED_ZIP_THUMB = "_shared_zip2.png"


def thumb_suffix(kind: str) -> str:
    if kind == "stl":
        return "stl6"  # MakerDeck blue mesh fill
    if kind == "obj":
        return "obj5"
    if kind in ("3mf", "gcode.3mf"):
        return "3mf3"
    if kind == "gcode":
        return "gcode2"  # embedded image or top-down extrusion toolpath
    if kind == "zip":
        return "zip3"
    if kind == "jpg":
        return "jpg2"
    if kind == "jpeg":
        return "jpeg2"
    if kind == "png":
        return "png2"
    if kind == "gif":
        return "gif2"
    if kind == "webp":
        return "webp2"
    if kind == "bmp":
        return "bmp2"
    return kind or "file"


def thumb_filename(content_hash: str, kind: str) -> str:
    # Version suffixes bust caches when preview quality improves.
    return f"{content_hash[:16]}_{thumb_suffix(kind)}.png"


def resolve_thumb_name(
    thumbs_dir: Path,
    *,
    thumb_path: str | None,
    content_hash: str | None,
    kind: str | None,
) -> str | None:
    """Return an on-disk thumb filename, or None if nothing usable exists."""
    thumbs_dir = Path(thumbs_dir)
    if thumb_path:
        p = thumbs_dir / thumb_path
        if p.is_file() and p.stat().st_size > 0:
            return thumb_path
    if content_hash and kind:
        # Prefer current naming, then a few legacy names.
        candidates = [
            thumb_filename(content_hash, kind),
            f"{content_hash[:16]}_{kind}.png",
            f"{content_hash[:16]}_stl.png",
            f"{content_hash[:16]}_stl4.png",
            f"{content_hash[:16]}_stl5.png",
            f"{content_hash[:16]}_obj.png",
            f"{content_hash[:16]}_obj2.png",
            f"{content_hash[:16]}_obj3.png",
            f"{content_hash[:16]}_obj4.png",
            f"{content_hash[:16]}_3mf.png",
            f"{content_hash[:16]}_3mf2.png",
            f"{content_hash[:16]}_gcode1.png",
        ]
        seen: set[str] = set()
        for name in candidates:
            if name in seen:
                continue
            seen.add(name)
            p = thumbs_dir / name
            if p.is_file() and p.stat().st_size > 0:
                return name
    if kind == "zip":
        shared = thumbs_dir / SHARED_ZIP_THUMB
        if shared.is_file() and shared.stat().st_size > 0:
            return SHARED_ZIP_THUMB
    return None


def save_thumb_bytes(thumbs_dir: Path, content_hash: str, kind: str, data: bytes) -> Optional[str]:
    if not data:
        return None
    thumbs_dir.mkdir(parents=True, exist_ok=True)
    name = thumb_filename(content_hash, kind)
    out = thumbs_dir / name
    # Prefer Pillow resize; fall back to writing the raw image bytes.
    if Image is not None:
        try:
            from io import BytesIO
            im = Image.open(BytesIO(data))
            im = im.convert("RGBA")
            im.thumbnail((320, 320))
            im.save(out, format="PNG")
            return name
        except Exception:
            pass
    try:
        out.write_bytes(data)
        return name
    except Exception:
        return None


def ensure_shared_zip_thumb(thumbs_dir: Path) -> Optional[str]:
    """One MakerDeck-blue ZIP icon used by every zip card."""
    if Image is None or ImageDraw is None:
        return None
    thumbs_dir.mkdir(parents=True, exist_ok=True)
    out = thumbs_dir / SHARED_ZIP_THUMB
    if out.is_file() and out.stat().st_size > 800:
        return SHARED_ZIP_THUMB

    im = Image.new("RGBA", (320, 320), (10, 18, 32, 255))
    draw = ImageDraw.Draw(im)
    # Soft panel
    draw.rounded_rectangle((28, 28, 292, 292), radius=36, fill=(16, 28, 45, 255))
    # Archive body
    draw.rounded_rectangle((96, 56, 224, 264), radius=18, fill=(16, 28, 45, 255), outline=(56, 189, 248, 255), width=4)
    # Zipper teeth
    for y in range(64, 220, 28):
        draw.rounded_rectangle((148, y, 172, y + 14), radius=3, fill=(125, 211, 252, 255))
    # Pull tab
    draw.ellipse((146, 210, 174, 238), fill=(2, 132, 199, 255), outline=(125, 211, 252, 255), width=3)
    draw.rounded_rectangle((154, 232, 166, 252), radius=3, fill=(56, 189, 248, 255))
    # Label
    try:
        font = ImageFont.truetype("DejaVuSans-Bold.ttf", 28)
    except Exception:
        font = ImageFont.load_default()
    label = "ZIP"
    try:
        bbox = draw.textbbox((0, 0), label, font=font)
        tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    except Exception:
        tw, th = 40, 14
    draw.text(((320 - tw) / 2, 268), label, fill=(224, 242, 254, 255), font=font)
    im.save(out, format="PNG", optimize=True)
    return SHARED_ZIP_THUMB


def make_placeholder_thumb(thumbs_dir: Path, content_hash: str, kind: str, label: str) -> Optional[str]:
    if kind == "zip":
        return ensure_shared_zip_thumb(thumbs_dir)
    if Image is None or ImageDraw is None:
        return None
    thumbs_dir.mkdir(parents=True, exist_ok=True)
    name = thumb_filename(content_hash, kind)
    out = thumbs_dir / name
    if out.exists():
        return name
    # deterministic colour from hash
    h = hashlib.md5(content_hash.encode("utf-8")).hexdigest()
    r, g, b = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
    im = Image.new("RGBA", (320, 320), (20, 28, 40, 255))
    draw = ImageDraw.Draw(im)
    draw.rounded_rectangle((24, 24, 296, 296), radius=28, fill=(r // 3 + 40, g // 3 + 50, b // 3 + 60, 255))
    draw.text((40, 140), (label or kind).upper()[:12], fill=(240, 245, 255, 255))
    im.save(out, format="PNG")
    return name
