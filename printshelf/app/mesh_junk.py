from __future__ import annotations

from pathlib import Path

# Thingiverse (and similar) drop PNG/JPEG card previews with mesh extensions.
_PREVIEW_NAME_PREFIXES = (
    "card_preview_",
    "tiny_preview_",
    "tinycard_preview_",
    "large_preview_",
    "large_display_",
    "small_display_",
    "small_thumb_",
    "tiny_thumb_",
)

_IMAGE_MAGICS = (
    b"\x89PNG\r\n\x1a\n",
    b"\xff\xd8\xff",  # JPEG
    b"GIF87a",
    b"GIF89a",
    b"RIFF",  # WEBP (also AVI — still not an STL)
)


def looks_like_image_bytes(head: bytes) -> bool:
    if not head:
        return False
    for mag in _IMAGE_MAGICS:
        if head.startswith(mag):
            return True
    return False


def is_thingiverse_preview_name(name: str) -> bool:
    lower = (name or "").lower()
    return any(lower.startswith(p) for p in _PREVIEW_NAME_PREFIXES)


def is_fake_mesh_file(path: Path) -> bool:
    """True for AppleDouble / temp noise, or image bytes pretending to be STL/OBJ."""
    name = path.name.lower()
    if name.startswith("._"):
        return True
    if name.endswith("_temp.obj") or name == "temp.obj":
        return True
    if is_thingiverse_preview_name(name) and name.endswith((".stl", ".obj", ".3mf")):
        return True
    if not name.endswith((".stl", ".obj")):
        return False
    try:
        with path.open("rb") as f:
            head = f.read(16)
    except OSError:
        return False
    return looks_like_image_bytes(head)


def describe_fake_mesh(path: Path) -> str | None:
    name = path.name.lower()
    if is_thingiverse_preview_name(name):
        return "Thingiverse-style preview image (not a mesh)"
    try:
        with path.open("rb") as f:
            head = f.read(16)
    except OSError:
        return None
    if head.startswith(b"\x89PNG"):
        return "PNG image with a mesh extension"
    if head.startswith(b"\xff\xd8\xff"):
        return "JPEG image with a mesh extension"
    if head.startswith(b"GIF8"):
        return "GIF image with a mesh extension"
    if head.startswith(b"RIFF"):
        return "RIFF/WebP image with a mesh extension"
    return None
