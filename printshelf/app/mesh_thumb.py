from __future__ import annotations

import math
from array import array
from io import BytesIO
from typing import Optional, Sequence

try:
    from PIL import Image, ImageDraw, ImageFilter
except Exception:  # pragma: no cover
    Image = None
    ImageDraw = None
    ImageFilter = None


Vec3 = tuple[float, float, float]
Tri = tuple[Vec3, Vec3, Vec3]


def sample_stride(n: int, max_tris: int = 2_500_000) -> int:
    """Only thin out absurdly huge meshes. Stride on scans = fuzzy holes."""
    if n <= max_tris:
        return 1
    return max(1, (n + max_tris - 1) // max_tris)


def _sub(a: Vec3, b: Vec3) -> Vec3:
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def _cross(a: Vec3, b: Vec3) -> Vec3:
    return (
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    )


def _dot(a: Vec3, b: Vec3) -> float:
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def _norm(a: Vec3) -> Vec3:
    length = math.sqrt(_dot(a, a)) or 1.0
    return (a[0] / length, a[1] / length, a[2] / length)


def render_triangles_png(
    triangles: Sequence[Tri],
    *,
    size: int = 320,
    fill=(96, 180, 235),  # MakerDeck sky blue
    bg=(10, 18, 32),
) -> Optional[bytes]:
    """Solid shaded orthographic preview with z-buffer, multi-light, AA."""
    if Image is None or not triangles:
        return None

    min_v = [1e30, 1e30, 1e30]
    max_v = [-1e30, -1e30, -1e30]
    for a, b, c in triangles:
        for p in (a, b, c):
            for i in range(3):
                min_v[i] = min(min_v[i], p[i])
                max_v[i] = max(max_v[i], p[i])
    center = (
        (min_v[0] + max_v[0]) * 0.5,
        (min_v[1] + max_v[1]) * 0.5,
        (min_v[2] + max_v[2]) * 0.5,
    )
    extent = max(max_v[0] - min_v[0], max_v[1] - min_v[1], max_v[2] - min_v[2], 1e-6)

    # Slightly flatter, more "product shot" angle
    yaw = math.radians(38)
    pitch = math.radians(-26)
    cy, sy = math.cos(yaw), math.sin(yaw)
    cp, sp = math.cos(pitch), math.sin(pitch)

    def transform(p: Vec3) -> Vec3:
        # Most print/OBJ meshes are Z-up. Map to Y-up view space so models
        # aren't lying on their side / standing on their heads.
        x = (p[0] - center[0]) / extent
        y = (p[1] - center[1]) / extent
        z = (p[2] - center[2]) / extent
        x, y, z = x, z, -y
        x1 = x * cy + z * sy
        z1 = -x * sy + z * cy
        y2 = y * cp - z1 * sp
        z2 = y * sp + z1 * cp
        return (x1, y2, z2)

    # Key + fill + cool rim — keeps undersides readable
    key = _norm((0.45, 0.9, 0.35))
    fill_l = _norm((-0.65, 0.25, 0.55))
    rim = _norm((-0.2, 0.15, -0.95))

    n_tris = len(triangles)
    # Supersample when affordable; huge scans stay 1× but keep every face.
    ss = 2 if n_tris <= 250_000 else 1
    rs = size * ss
    scale = rs * 0.90
    zbuf = array("f", [1e30]) * (rs * rs)
    bg_px = bytes((bg[0], bg[1], bg[2]))
    pixels = bytearray(bg_px * (rs * rs))
    ox = rs * 0.5
    # Lift model a touch so a soft ground shadow fits underneath
    oy = rs * 0.52

    for a0, b0, c0 in triangles:
        a = transform(a0)
        b = transform(b0)
        c = transform(c0)
        n = _norm(_cross(_sub(b, a), _sub(c, a)))

        ax, ay = ox + a[0] * scale, oy - a[1] * scale
        bx, by = ox + b[0] * scale, oy - b[1] * scale
        cx, cy_s = ox + c[0] * scale, oy - c[1] * scale
        az, bz, cz = -a[2], -b[2], -c[2]

        area = (bx - ax) * (cy_s - ay) - (by - ay) * (cx - ax)
        if abs(area) < 1e-6:
            continue
        if area < 0:
            bx, by, bz, cx, cy_s, cz = cx, cy_s, cz, bx, by, bz
            area = -area
        if n[2] < 0:
            n = (-n[0], -n[1], -n[2])

        ndl_key = max(0.0, _dot(n, key))
        ndl_fill = max(0.0, _dot(n, fill_l))
        ndl_rim = max(0.0, _dot(n, rim)) ** 2
        # Hemisphere-ish ambient from upward normal
        hemi = 0.18 + 0.22 * max(0.0, n[1] * 0.5 + 0.5)
        shade = hemi + 0.62 * ndl_key + 0.28 * ndl_fill + 0.16 * ndl_rim
        shade = max(0.12, min(1.15, shade))
        # Gentle Fresnel lift on silhouette
        fres = (1.0 - max(0.0, n[2])) ** 2
        shade = min(1.2, shade + 0.08 * fres)

        cr = min(255, int(fill[0] * shade))
        cg = min(255, int(fill[1] * shade))
        cb = min(255, int(fill[2] * shade + 18 * (1.0 - min(1.0, shade))))

        inv_area = 1.0 / area
        min_x = max(0, int(math.floor(min(ax, bx, cx))))
        max_x = min(rs - 1, int(math.ceil(max(ax, bx, cx))))
        min_y = max(0, int(math.floor(min(ay, by, cy_s))))
        max_y = min(rs - 1, int(math.ceil(max(ay, by, cy_s))))

        for y in range(min_y, max_y + 1):
            py = y + 0.5
            row = y * rs
            for x in range(min_x, max_x + 1):
                px = x + 0.5
                w0 = ((bx - px) * (cy_s - py) - (by - py) * (cx - px)) * inv_area
                w1 = ((cx - px) * (ay - py) - (cy_s - py) * (ax - px)) * inv_area
                w2 = 1.0 - w0 - w1
                if w0 < 0.0 or w1 < 0.0 or w2 < 0.0:
                    continue
                depth = w0 * az + w1 * bz + w2 * cz
                idx = row + x
                if depth >= zbuf[idx]:
                    continue
                zbuf[idx] = depth
                pi = idx * 3
                pixels[pi] = cr
                pixels[pi + 1] = cg
                pixels[pi + 2] = cb

    resample = getattr(getattr(Image, "Resampling", Image), "LANCZOS", Image.LANCZOS)
    im = Image.frombytes("RGB", (rs, rs), bytes(pixels))

    # Soft ground shadow under the object (composited behind)
    if ImageDraw is not None:
        shadow = Image.new("RGBA", (rs, rs), (0, 0, 0, 0))
        sd = ImageDraw.Draw(shadow)
        # Ellipse near bottom of content
        sd.ellipse(
            (int(rs * 0.22), int(rs * 0.72), int(rs * 0.78), int(rs * 0.88)),
            fill=(0, 0, 0, 70),
        )
        if ImageFilter is not None:
            shadow = shadow.filter(ImageFilter.GaussianBlur(radius=max(2, rs // 40)))
        base = Image.new("RGBA", (rs, rs), (*bg, 255))
        base = Image.alpha_composite(base, shadow)
        base = Image.alpha_composite(base, im.convert("RGBA"))
        im = base.convert("RGB")

    if ss > 1:
        im = im.resize((size, size), resample)
    elif im.size[0] != size:
        im = im.resize((size, size), resample)

    buf = BytesIO()
    im.save(buf, format="PNG", optimize=True)
    return buf.getvalue()
