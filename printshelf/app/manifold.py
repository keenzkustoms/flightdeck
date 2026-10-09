"""MakerDeck-style manifold check + sanitize for PrintShelf slicer handoff.

Port of makerforge/js/stl.js countOpenEdges / sanitizeMeshForStl:
weld → drop dup/degenerate/coplanar tris → peel non-manifold faces.
Does not overwrite NAS originals — callers write repaired bytes to cache/temp.
"""
from __future__ import annotations

import math
from typing import Any

Tri = tuple[tuple[float, float, float], tuple[float, float, float], tuple[float, float, float]]
Vec3 = tuple[float, float, float]


def _edge_key(a: int, b: int) -> tuple[int, int]:
    return (a, b) if a < b else (b, a)


def _tri_area(positions: list[float], ia: int, ib: int, ic: int) -> float:
    ax, ay, az = positions[ia * 3], positions[ia * 3 + 1], positions[ia * 3 + 2]
    bx, by, bz = positions[ib * 3], positions[ib * 3 + 1], positions[ib * 3 + 2]
    cx, cy, cz = positions[ic * 3], positions[ic * 3 + 1], positions[ic * 3 + 2]
    ux, uy, uz = bx - ax, by - ay, bz - az
    vx, vy, vz = cx - ax, cy - ay, cz - az
    nx = uy * vz - uz * vy
    ny = uz * vx - ux * vz
    nz = ux * vy - uy * vx
    return 0.5 * math.hypot(nx, ny, nz)


def count_open_edges_indexed(positions: list[float], indices: list[int]) -> int:
    edge_faces: dict[tuple[int, int], list[int]] = {}
    for t in range(0, len(indices), 3):
        tri = (indices[t], indices[t + 1], indices[t + 2])
        fi = t // 3
        for k in range(3):
            key = _edge_key(tri[k], tri[(k + 1) % 3])
            edge_faces.setdefault(key, []).append(fi)
    return sum(1 for faces in edge_faces.values() if len(faces) == 1)


def count_open_edges(tris: list[Tri], weld_eps: float = 0.05) -> int:
    """Count boundary edges after a light weld (matches MakerDeck indexing)."""
    if not tris:
        return 0
    welded = _weld_tris(tris, weld_eps)
    return count_open_edges_indexed(welded["positions"], welded["indices"])


def _weld_tris(tris: list[Tri], eps: float = 0.05) -> dict[str, Any]:
    table: dict[tuple[int, int, int], int] = {}
    out_pos: list[float] = []
    out_idx: list[int] = []

    def index_of(v: Vec3) -> int:
        x, y, z = float(v[0]), float(v[1]), float(v[2])
        key = (round(x / eps), round(y / eps), round(z / eps))
        idx = table.get(key)
        if idx is None:
            idx = len(out_pos) // 3
            out_pos.extend((x, y, z))
            table[key] = idx
        return idx

    for a, b, c in tris:
        out_idx.extend((index_of(a), index_of(b), index_of(c)))
    return {"positions": out_pos, "indices": out_idx}


def _remove_duplicate_triangles(indices: list[int]) -> list[int]:
    seen: set[tuple[int, int, int]] = set()
    out: list[int] = []
    for t in range(0, len(indices), 3):
        ia, ib, ic = indices[t], indices[t + 1], indices[t + 2]
        key = tuple(sorted((ia, ib, ic)))
        if key in seen:
            continue
        seen.add(key)  # type: ignore[arg-type]
        out.extend((ia, ib, ic))
    return out


def _remove_degenerate_triangles(positions: list[float], indices: list[int]) -> list[int]:
    out: list[int] = []
    vert_count = len(positions) // 3
    for t in range(0, len(indices), 3):
        ia, ib, ic = indices[t], indices[t + 1], indices[t + 2]
        if ia < 0 or ib < 0 or ic < 0 or ia >= vert_count or ib >= vert_count or ic >= vert_count:
            continue
        if ia == ib or ib == ic or ia == ic:
            continue
        if _tri_area(positions, ia, ib, ic) < 1e-8:
            continue
        coords = [
            positions[ia * 3], positions[ia * 3 + 1], positions[ia * 3 + 2],
            positions[ib * 3], positions[ib * 3 + 1], positions[ib * 3 + 2],
            positions[ic * 3], positions[ic * 3 + 1], positions[ic * 3 + 2],
        ]
        if not all(math.isfinite(c) for c in coords):
            continue
        out.extend((ia, ib, ic))
    return out


def _remove_duplicate_coplanar_triangles(positions: list[float], indices: list[int]) -> list[int]:
    seen: set[str] = set()
    out: list[int] = []
    for t in range(0, len(indices), 3):
        ia, ib, ic = indices[t], indices[t + 1], indices[t + 2]
        ax, ay, az = positions[ia * 3], positions[ia * 3 + 1], positions[ia * 3 + 2]
        bx, by, bz = positions[ib * 3], positions[ib * 3 + 1], positions[ib * 3 + 2]
        cx, cy, cz = positions[ic * 3], positions[ic * 3 + 1], positions[ic * 3 + 2]
        nx = (by - ay) * (cz - az) - (bz - az) * (cy - ay)
        ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az)
        nz = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)
        length = math.hypot(nx, ny, nz) or 1.0
        nx /= length
        ny /= length
        nz /= length
        d = nx * ax + ny * ay + nz * az
        if nx < -0.001 or (abs(nx) <= 0.001 and ny < -0.001) or (abs(nx) <= 0.001 and abs(ny) <= 0.001 and nz < 0):
            nx, ny, nz = -nx, -ny, -nz
        verts = "|".join(str(v) for v in sorted((ia, ib, ic)))
        key = f"{round(nx * 500)}|{round(ny * 500)}|{round(nz * 500)}|{round(d * 40)}|{verts}"
        if key in seen:
            continue
        seen.add(key)
        out.extend((ia, ib, ic))
    return out


def _repair_non_manifold_faces(positions: list[float], indices: list[int], max_passes: int = 12) -> list[int]:
    tris: list[list[int] | None] = []
    for t in range(0, len(indices), 3):
        tris.append([indices[t], indices[t + 1], indices[t + 2]])

    for _ in range(max_passes):
        edge_faces: dict[tuple[int, int], list[int]] = {}
        for fi, tri in enumerate(tris):
            if not tri:
                continue
            a, b, c = tri
            for key in (_edge_key(a, b), _edge_key(b, c), _edge_key(c, a)):
                edge_faces.setdefault(key, []).append(fi)

        removed = False
        for faces in edge_faces.values():
            if not faces or len(faces) <= 2:
                continue
            worst = -1
            worst_area = float("inf")
            for fi in faces:
                tri = tris[fi]
                if not tri:
                    continue
                a, b, c = tri
                area = _tri_area(positions, a, b, c)
                if area < worst_area:
                    worst_area = area
                    worst = fi
            if worst < 0:
                continue
            tris[worst] = None
            removed = True
        if not removed:
            break
        tris = [t for t in tris if t]

    out: list[int] = []
    for tri in tris:
        if not tri:
            continue
        out.extend(tri)
    return out


def _indexed_to_tris(positions: list[float], indices: list[int]) -> list[Tri]:
    out: list[Tri] = []
    for t in range(0, len(indices), 3):
        ia, ib, ic = indices[t], indices[t + 1], indices[t + 2]
        a = (positions[ia * 3], positions[ia * 3 + 1], positions[ia * 3 + 2])
        b = (positions[ib * 3], positions[ib * 3 + 1], positions[ib * 3 + 2])
        c = (positions[ic * 3], positions[ic * 3 + 1], positions[ic * 3 + 2])
        out.append((a, b, c))
    return out


def _open_boundary_edges(indices: list[int]) -> list[tuple[int, int]]:
    """Directed open edges (a→b) as oriented by the single adjacent triangle."""
    edge_faces: dict[tuple[int, int], list[tuple[int, int]]] = {}
    for t in range(0, len(indices), 3):
        tri = (indices[t], indices[t + 1], indices[t + 2])
        for k in range(3):
            a, b = tri[k], tri[(k + 1) % 3]
            key = _edge_key(a, b)
            edge_faces.setdefault(key, []).append((a, b))
    opens: list[tuple[int, int]] = []
    for faces in edge_faces.values():
        if len(faces) == 1:
            opens.append(faces[0])
    return opens


def _walk_boundary_loops(opens: list[tuple[int, int]]) -> list[list[int]]:
    """Follow directed open edges into closed loops (and leftover paths)."""
    nxt: dict[int, list[int]] = {}
    for a, b in opens:
        nxt.setdefault(a, []).append(b)

    used: set[tuple[int, int]] = set()
    loops: list[list[int]] = []

    for start_a, start_b in opens:
        if (start_a, start_b) in used:
            continue
        loop = [start_a]
        cur_a, cur_b = start_a, start_b
        used.add((cur_a, cur_b))
        while cur_b != start_a:
            loop.append(cur_b)
            cands = [x for x in nxt.get(cur_b, []) if (cur_b, x) not in used]
            if not cands:
                break
            nxt_b = cands[0]
            used.add((cur_b, nxt_b))
            cur_a, cur_b = cur_b, nxt_b
        else:
            loops.append(loop)
            continue
        # Incomplete path — still record if it has enough verts to consider later.
        if len(loop) >= 3:
            loops.append(loop)
    return loops


def _fill_small_holes(positions: list[float], indices: list[int], max_loop_verts: int = 12) -> list[int]:
    """
    Cap small open-edge loops with triangles.

    Part_37-style Luban chops often leave dozens of tiny 3-edge pinholes;
    filling those closes the mesh without a full remesh.
    """
    opens = _open_boundary_edges(indices)
    if not opens:
        return indices

    loops = _walk_boundary_loops(opens)
    out = list(indices)
    added = 0

    for loop in loops:
        n = len(loop)
        if n < 3 or n > max_loop_verts:
            continue
        # Fan from first vertex. Loop verts are already in boundary order
        # matching directed open edges (hole winding). Cap uses same order
        # so the new faces oppose the hole.
        for i in range(1, n - 1):
            ia, ib, ic = loop[0], loop[i], loop[i + 1]
            if ia == ib or ib == ic or ia == ic:
                continue
            if _tri_area(positions, ia, ib, ic) < 1e-10:
                continue
            out.extend((ia, ib, ic))
            added += 1

    if added:
        # One more peel pass in case caps created overused edges.
        out = _repair_non_manifold_faces(positions, out, 4)
    return out


def sanitize_tris(
    tris: list[Tri],
    *,
    repair: bool = True,
    weld_eps: float = 0.05,
) -> tuple[list[Tri], int, int]:
    """
    MakerDeck sanitizeMeshForStl equivalent + small-hole fill.

    Returns (sanitized_tris, open_edges_before, open_edges_after).
    before is counted on lightly welded input; after on fully sanitized mesh.
    """
    if not tris:
        return [], 0, 0

    before = count_open_edges(tris, weld_eps=weld_eps)
    welded = _weld_tris(tris, weld_eps)
    positions: list[float] = welded["positions"]
    idx: list[int] = welded["indices"]
    idx = _remove_duplicate_triangles(idx)
    idx = _remove_degenerate_triangles(positions, idx)
    idx = _remove_duplicate_coplanar_triangles(positions, idx)
    if repair:
        idx = _repair_non_manifold_faces(positions, idx, 12)
        idx = _fill_small_holes(positions, idx, max_loop_verts=12)
    if not idx:
        return [], before, before

    after = count_open_edges_indexed(positions, idx)
    return _indexed_to_tris(positions, idx), before, after


def prepare_mesh_for_slicer(tris: list[Tri]) -> dict[str, Any]:
    """
    Check open edges; sanitize + fill small holes when needed.

    Returns dict with:
      tris, before, after, repaired (bool)

    Keeps the original mesh if sanitize does not reduce open edges.
    """
    if not tris:
        return {"tris": [], "before": 0, "after": 0, "repaired": False}

    before = count_open_edges(tris)
    if before == 0:
        return {"tris": tris, "before": 0, "after": 0, "repaired": False}

    cleaned, _, after = sanitize_tris(tris, repair=True)
    if not cleaned or after > before:
        return {"tris": tris, "before": before, "after": before, "repaired": False}
    return {
        "tris": cleaned,
        "before": before,
        "after": after,
        "repaired": after < before,
    }
