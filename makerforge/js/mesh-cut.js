/**
 * MakerDeck — plane-based mesh cutting, backed by manifold-3d.
 *
 * The previous implementation was a from-scratch triangle-clip + earcut-cap
 * algorithm (no CSG engine existed anywhere in this repo). It produced open
 * edges on complex or thin geometry — confirmed on both a synthetic
 * adversarial cube (bisected on 3 different axes) and a real 71k-triangle
 * model, where thin/densely-packed cross-sections left dozens of stray open
 * edges even though the source mesh was solid. manifold-3d
 * (github.com/elalish/manifold) is a battle-tested WASM geometry library
 * built specifically to guarantee manifold (watertight) output from
 * boolean/half-space operations, so every cut now goes through
 * Manifold.splitByPlane instead of hand-rolled clipping. Verified against
 * both failure cases above with zero open edges; see chop-manifold.mjs.
 */
import Module from "https://cdn.jsdelivr.net/npm/manifold-3d@3.5.1/manifold.js";
import { countOpenEdges } from "./stl.js?v=372";

let modulePromise = null;
function getManifoldModule() {
  if (!modulePromise) {
    modulePromise = Module().then((wasm) => {
      wasm.setup();
      return wasm;
    });
  }
  return modulePromise;
}

function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function normalize(v) {
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / len, v[1] / len, v[2] / len];
}

/** Möller–Trumbore; returns t along `dir` or null. */
function rayTriangleT(orig, dir, v0, v1, v2) {
  const eps = 1e-8;
  const e1 = sub(v1, v0), e2 = sub(v2, v0);
  const pvec = cross(dir, e2);
  const det = dot(e1, pvec);
  if (Math.abs(det) < eps) return null;
  const inv = 1 / det;
  const tvec = sub(orig, v0);
  const u = dot(tvec, pvec) * inv;
  if (u < 0 || u > 1) return null;
  const qvec = cross(tvec, e1);
  const v = dot(dir, qvec) * inv;
  if (v < 0 || u + v > 1) return null;
  const t = dot(e2, qvec) * inv;
  return t > eps ? t : null;
}

/**
 * Local wall thickness at a flat face: ray from just inside the face
 * along -normal until it exits the solid. Infinity if the ray misses
 * (open mesh / degenerate). Used to stop connector pegs punching through
 * thin shells.
 */
export function meshThicknessAlong(mesh, face, { inset = 0.05 } = {}) {
  const cu = (face.uMin + face.uMax) / 2;
  const cv = (face.vMin + face.vMax) / 2;
  const n = face.normal;
  const orig = [
    face.origin[0] + face.u[0] * cu + face.v[0] * cv - n[0] * inset,
    face.origin[1] + face.u[1] * cu + face.v[1] * cv - n[1] * inset,
    face.origin[2] + face.u[2] * cu + face.v[2] * cv - n[2] * inset,
  ];
  const dir = [-n[0], -n[1], -n[2]];
  const { positions, indices } = mesh;
  let best = Infinity;
  for (let t = 0; t < indices.length; t += 3) {
    const ia = indices[t] * 3, ib = indices[t + 1] * 3, ic = indices[t + 2] * 3;
    const hit = rayTriangleT(
      orig, dir,
      [positions[ia], positions[ia + 1], positions[ia + 2]],
      [positions[ib], positions[ib + 1], positions[ib + 2]],
      [positions[ic], positions[ic + 1], positions[ic + 2]],
    );
    if (hit != null && hit > inset && hit < best) best = hit;
  }
  return Number.isFinite(best) ? best + inset : Infinity;
}

export function computeBounds(positions) {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i], y = positions[i + 1], z = positions[i + 2];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  return {
    min: [minX, minY, minZ],
    max: [maxX, maxY, maxZ],
    size: [maxX - minX, maxY - minY, maxZ - minZ],
  };
}

function withOpenEdgeCount(m) {
  return m.openEdgeCount === undefined
    ? { ...m, openEdgeCount: countOpenEdges(m.positions, m.indices) }
    : m;
}

/** Build a manifold-3d Manifold from our {positions,indices} mesh, validating it. */
function toManifold(Manifold, MeshCtor, mesh) {
  const vertProperties = mesh.positions instanceof Float32Array ? mesh.positions : Float32Array.from(mesh.positions);
  const triVerts = mesh.indices instanceof Uint32Array ? mesh.indices : Uint32Array.from(mesh.indices);
  let manifold;
  try {
    manifold = new Manifold(new MeshCtor({ numProp: 3, vertProperties, triVerts }));
  } catch (e) {
    throw new Error(`Not a valid manifold mesh (${e.message || e}) — repair it in Mesh Prep first.`);
  }
  const status = manifold.status();
  if (status !== "NoError") {
    manifold.delete();
    throw new Error(`Not a valid manifold mesh (${status}) — repair it in Mesh Prep first.`);
  }
  return manifold;
}

/** Pull a manifold-3d Manifold back into our {positions,indices,openEdgeCount} shape. */
function fromManifold(manifold) {
  const raw = manifold.getMesh();
  const positions = Array.from(raw.vertProperties);
  const indices = Array.from(raw.triVerts);
  return { positions, indices, openEdgeCount: countOpenEdges(positions, indices) };
}

/**
 * Split `mesh` into its separate connected components (islands), if it has
 * more than one. A single flat cutting plane can produce a "half" that's
 * naturally disconnected for complex organic geometry (e.g. slicing
 * through the gap between two legs, or a strap sitting close against a
 * body) — Manifold.splitByPlane has no concept of this and just returns
 * everything on that side as one mesh, silently bundling a smaller
 * detached fragment in with a larger piece instead of surfacing it as its
 * own piece. Manifold's own output already has real shared-vertex
 * topology (that's what "manifold" means), so plain union-find over the
 * index graph is enough — no position-based re-welding needed. Returns
 * [mesh-with-openEdgeCount] unchanged (as a 1-element array) if already a
 * single connected piece.
 */
export function splitIntoIslands(mesh) {
  const { positions, indices } = mesh;
  const numVerts = positions.length / 3;
  const numTri = indices.length / 3;
  const parent = new Int32Array(numVerts);
  for (let i = 0; i < numVerts; i++) parent[i] = i;
  const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  const union = (a, b) => { a = find(a); b = find(b); if (a !== b) parent[a] = b; };
  for (let t = 0; t < numTri; t++) {
    union(indices[t * 3], indices[t * 3 + 1]);
    union(indices[t * 3 + 1], indices[t * 3 + 2]);
  }
  const roots = new Set();
  for (let t = 0; t < numTri; t++) roots.add(find(indices[t * 3]));
  if (roots.size <= 1) return [{ positions, indices, openEdgeCount: countOpenEdges(positions, indices) }];

  const islands = [];
  for (const root of roots) {
    const vertMap = new Map();
    const newPositions = [];
    const newIndices = [];
    for (let t = 0; t < numTri; t++) {
      const v0 = indices[t * 3];
      if (find(v0) !== root) continue;
      for (let k = 0; k < 3; k++) {
        const v = indices[t * 3 + k];
        let idx = vertMap.get(v);
        if (idx === undefined) {
          idx = newPositions.length / 3;
          newPositions.push(positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2]);
          vertMap.set(v, idx);
        }
        newIndices.push(idx);
      }
    }
    islands.push({ positions: newPositions, indices: newIndices, openEdgeCount: countOpenEdges(newPositions, newIndices) });
  }
  islands.sort((a, b) => b.indices.length - a.indices.length); // largest first, cosmetic ordering
  return islands;
}

/**
 * Slice `mesh` by the plane through `planePoint` with unit `planeNormal`.
 * Returns { above, below }. `above`/`below` are each either a watertight
 * {positions,indices,openEdgeCount} piece or null if the plane didn't
 * intersect that side (e.g. the plane misses the mesh entirely).
 */
export async function sliceMeshByPlane(mesh, planePoint, planeNormal) {
  const { Manifold, Mesh } = await getManifoldModule();
  const normal = normalize(planeNormal);
  const offset = dot(normal, planePoint);
  const manifold = toManifold(Manifold, Mesh, mesh);
  let aboveM, belowM;
  try {
    [aboveM, belowM] = manifold.splitByPlane(normal, offset);
  } finally {
    manifold.delete();
  }
  const above = aboveM.numTri() > 0 ? fromManifold(aboveM) : null;
  const below = belowM.numTri() > 0 ? fromManifold(belowM) : null;
  aboveM.delete();
  belowM.delete();
  return { above, below };
}

/**
 * Boolean-union `meshes` into a single watertight piece — lets "Merge
 * Selected" recombine pieces the cutter split apart, e.g. undoing a cut
 * that landed somewhere undesirable (straight through an eye) rather than
 * having to redo the whole cut by hand. A real boolean rather than a plain
 * concatenation: two pieces that share an exact coincident cut face (the
 * common case — both came from the same split) weld cleanly into one solid
 * with the internal seam gone, not just two shells touching. Genuinely
 * disjoint inputs (not adjacent at all) still union fine — the result is
 * just their combined volume, same as the multi-shell case sliceMeshByPlane
 * already has to handle on either side of an ordinary cut.
 */
export async function unionMeshes(meshes) {
  const { Manifold, Mesh } = await getManifoldModule();
  let acc = null;
  try {
    for (const mesh of meshes) {
      const m = toManifold(Manifold, Mesh, mesh);
      if (acc) {
        const next = acc.add(m);
        acc.delete();
        m.delete();
        acc = next;
      } else {
        acc = m;
      }
    }
    return fromManifold(acc);
  } finally {
    if (acc) acc.delete();
  }
}

/** Boolean-subtract `cutter` from `base` -- `base` minus every bit of volume `cutter` occupies. Used to engrave a part number into a piece rather than raise it. */
export async function subtractMesh(base, cutter) {
  const { Manifold, Mesh } = await getManifoldModule();
  const baseM = toManifold(Manifold, Mesh, base);
  const cutterM = toManifold(Manifold, Mesh, cutter);
  try {
    const result = baseM.subtract(cutterM);
    try {
      return fromManifold(result);
    } finally {
      result.delete();
    }
  } finally {
    baseM.delete();
    cutterM.delete();
  }
}

/**
 * Find every contiguous flat region on `mesh` at or above `minArea` --
 * almost always a piece's cut faces (the flat cross-sections a plane cut
 * leaves behind). A piece can have more than one (e.g. a middle piece in a
 * row of three has a cut face on each side, connecting to a different
 * neighbor), which is why this exists as its own function rather than just
 * returning the single largest -- adjacency detection (findAdjacentPieces)
 * needs to check every candidate face on both pieces, not just each
 * piece's biggest one. Groups triangles first by (quantized) normal
 * direction, then by planar offset along that normal, so triangles that
 * merely face the same way but sit on different planes (e.g. two parallel
 * walls) don't get lumped together; sums each group's total triangle area.
 * Returns groups sorted largest-first; empty array for a degenerate/empty
 * mesh or one with nothing at or above minArea.
 *
 * Each returned frame: `normal` points outward from the solid; `u`/`v` are
 * an orthonormal in-plane basis; `origin` is a point on the plane; `uMin`/
 * `uMax`/`vMin`/`vMax` bound the flat region's actual footprint in that
 * (u,v) frame, for sizing/centering whatever gets placed on it; `uvTris` is
 * the group's own triangles projected into (u,v) -- `[[u0,v0],[u1,v1],
 * [u2,v2]], ...]` -- for callers (e.g. connector placement) that need to
 * know the region's real, possibly-irregular boundary rather than just its
 * bounding rectangle (a cut face from an organic model is rarely a clean
 * rectangle; the bounding box alone would place things past the edge).
 */
export function findFlatFaceGroups(mesh, minArea = 0) {
  const { positions, indices } = mesh;
  const numTri = indices.length / 3;
  if (numTri === 0) return [];
  const eps = 1e-4;
  const groups = new Map();
  for (let t = 0; t < numTri; t++) {
    const ia = indices[t * 3], ib = indices[t * 3 + 1], ic = indices[t * 3 + 2];
    const a = [positions[ia * 3], positions[ia * 3 + 1], positions[ia * 3 + 2]];
    const b = [positions[ib * 3], positions[ib * 3 + 1], positions[ib * 3 + 2]];
    const c = [positions[ic * 3], positions[ic * 3 + 1], positions[ic * 3 + 2]];
    const n = cross(sub(b, a), sub(c, a));
    const len = Math.hypot(...n);
    if (len < 1e-12) continue; // degenerate triangle
    const area = len / 2;
    const normal = [n[0] / len, n[1] / len, n[2] / len];
    const offset = dot(normal, a);
    const key = `${Math.round(normal[0] / eps)},${Math.round(normal[1] / eps)},${Math.round(normal[2] / eps)}|${Math.round(offset / eps)}`;
    let g = groups.get(key);
    if (!g) { g = { normal, offset, area: 0, tris: [] }; groups.set(key, g); }
    g.area += area;
    g.tris.push(t);
  }

  const frames = [];
  for (const g of groups.values()) {
    if (g.area < minArea) continue;
    const normal = g.normal;
    const ref = Math.abs(normal[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    const u = normalize(cross(ref, normal));
    const v = cross(normal, u);
    const origin = [normal[0] * g.offset, normal[1] * g.offset, normal[2] * g.offset];

    let uMin = Infinity, uMax = -Infinity, vMin = Infinity, vMax = -Infinity;
    const uvTris = [];
    for (const t of g.tris) {
      const tri = [];
      for (let k = 0; k < 3; k++) {
        const vi = indices[t * 3 + k];
        const p = sub([positions[vi * 3], positions[vi * 3 + 1], positions[vi * 3 + 2]], origin);
        const pu = dot(p, u), pv = dot(p, v);
        if (pu < uMin) uMin = pu; if (pu > uMax) uMax = pu;
        if (pv < vMin) vMin = pv; if (pv > vMax) vMax = pv;
        tri.push([pu, pv]);
      }
      uvTris.push(tri);
    }
    frames.push({ normal, u, v, origin, uMin, uMax, vMin, vMax, area: g.area, uvTris });
  }
  frames.sort((a, b) => b.area - a.area);
  return frames;
}

/** The single largest flat region on `mesh` (see findFlatFaceGroups) -- null if the mesh has no faces at all. */
export function findLargestFlatFace(mesh) {
  return findFlatFaceGroups(mesh)[0] ?? null;
}

/**
 * Find pairs of pieces that share a real cut face -- opposite-facing
 * normals, coincident plane, and overlapping footprints in that plane.
 * Overlap is an AABB check in faceA's (u,v) frame (not just centroid
 * proximity) so staggered modular cuts still match when only part of
 * each face touches. `minArea` (mm^2) filters noise / micro contacts.
 */
export function findAdjacentPieces(pieces, { minArea = 25 } = {}) {
  const withFaces = pieces.map((p) => ({ id: p.id, faces: findFlatFaceGroups(p.mesh, minArea) }));
  const results = [];
  for (let i = 0; i < withFaces.length; i++) {
    for (let j = i + 1; j < withFaces.length; j++) {
      for (const faceA of withFaces[i].faces) {
        for (const faceB of withFaces[j].faces) {
          // ~8° of opposite-normal slop — organic cuts / float noise after smooth
          if (dot(faceA.normal, faceB.normal) > -0.99) continue;
          const planeGap = Math.abs(dot(faceA.normal, sub(faceB.origin, faceA.origin)));
          if (planeGap > 1.0) continue;

          // Project faceB's UV bbox into faceA's frame and require real overlap
          const cornersB = [
            [faceB.uMin, faceB.vMin], [faceB.uMax, faceB.vMin],
            [faceB.uMax, faceB.vMax], [faceB.uMin, faceB.vMax],
          ];
          let bu0 = Infinity, bu1 = -Infinity, bv0 = Infinity, bv1 = -Infinity;
          for (const [bu, bv] of cornersB) {
            const world = [
              faceB.origin[0] + faceB.u[0] * bu + faceB.v[0] * bv,
              faceB.origin[1] + faceB.u[1] * bu + faceB.v[1] * bv,
              faceB.origin[2] + faceB.u[2] * bu + faceB.v[2] * bv,
            ];
            const rel = sub(world, faceA.origin);
            const u = dot(rel, faceA.u), v = dot(rel, faceA.v);
            if (u < bu0) bu0 = u; if (u > bu1) bu1 = u;
            if (v < bv0) bv0 = v; if (v > bv1) bv1 = v;
          }
          const ou = Math.min(faceA.uMax, bu1) - Math.max(faceA.uMin, bu0);
          const ov = Math.min(faceA.vMax, bv1) - Math.max(faceA.vMin, bv0);
          if (ou <= 0 || ov <= 0) continue;
          const overlapArea = ou * ov;
          if (overlapArea < minArea) continue;

          results.push({
            pieceA: withFaces[i].id,
            pieceB: withFaces[j].id,
            faceA,
            faceB,
            area: Math.min(faceA.area, faceB.area, overlapArea),
          });
        }
      }
    }
  }
  return results;
}

/**
 * Build one small watertight box mesh per "on" pixel of a plain on/off
 * raster (e.g. a rasterized digit bitmap), placed on `face` (a frame from
 * findLargestFlatFace) and centered in its (u,v) footprint. `depthRange`
 * is [innerDepth, outerDepth] measured along `face.normal` from the face
 * plane -- for engraving, make innerDepth negative (into the solid) and
 * outerDepth slightly positive (pokes just past the surface, so the
 * subtract fully severs the surface skin rather than leaving a degenerate
 * coincident face). Each pixel box is deliberately oversized by `overlap`
 * beyond one pixel's pitch so adjacent "on" pixels' boxes overlap
 * slightly, guaranteeing a contiguous shape with no micro-gaps once
 * unioned. Returns an ARRAY of individual {positions,indices} box meshes,
 * not one combined mesh -- manifold-3d requires a valid (non-self-
 * intersecting) manifold as input to any boolean, and overlapping boxes
 * concatenated as raw triangle soup are not one; union them with
 * unionMeshes() first (they're deliberately small/cheap per-box) before
 * using the result as a subtractMesh/unionMeshes cutter.
 */
export function buildStampMesh(face, grid, gridW, gridH, targetWidth, targetHeight, depthRange, overlap = 1.2, { centerU, centerV } = {}) {
  const pitchU = targetWidth / gridW;
  const pitchV = targetHeight / gridH;
  const cu0 = centerU ?? (face.uMin + face.uMax) / 2;
  const cv0 = centerV ?? (face.vMin + face.vMax) / 2;
  const [innerDepth, outerDepth] = depthRange;
  const buildBox = (u0, u1, v0, v1) => {
    const positions = [];
    const corners = [
      [u0, v0, innerDepth], [u1, v0, innerDepth], [u1, v1, innerDepth], [u0, v1, innerDepth],
      [u0, v0, outerDepth], [u1, v0, outerDepth], [u1, v1, outerDepth], [u0, v1, outerDepth],
    ];
    for (const [cu, cv, cd] of corners) {
      positions.push(
        face.origin[0] + face.u[0] * cu + face.v[0] * cv + face.normal[0] * cd,
        face.origin[1] + face.u[1] * cu + face.v[1] * cv + face.normal[1] * cd,
        face.origin[2] + face.u[2] * cu + face.v[2] * cv + face.normal[2] * cd,
      );
    }
    const indices = [
      0, 3, 2, 0, 2, 1, // inner (-depth)
      4, 5, 6, 4, 6, 7, // outer (+depth)
      0, 1, 5, 0, 5, 4,
      2, 3, 7, 2, 7, 6,
      0, 4, 7, 0, 7, 3,
      1, 2, 6, 1, 6, 5,
    ];
    return { positions, indices };
  };
  const boxes = [];
  for (let row = 0; row < gridH; row++) {
    for (let col = 0; col < gridW; col++) {
      if (!grid[row * gridW + col]) continue;
      const cu = (col + 0.5) * pitchU - targetWidth / 2 + cu0;
      const cv = (gridH - 1 - row + 0.5) * pitchV - targetHeight / 2 + cv0; // raster row 0 = top = +v
      const hw = (pitchU * overlap) / 2, hv = (pitchV * overlap) / 2;
      boxes.push(buildBox(cu - hw, cu + hw, cv - hv, cv + hv));
    }
  }
  return boxes;
}

/** True if (px,py) falls inside `tri` ([[u0,v0],[u1,v1],[u2,v2]]), boundary inclusive. */
function pointInTriangle(px, py, tri) {
  const [[ax, ay], [bx, by], [cx, cy]] = tri;
  const d1 = (px - bx) * (ay - by) - (ax - bx) * (py - by);
  const d2 = (px - cx) * (by - cy) - (bx - cx) * (py - cy);
  const d3 = (px - ax) * (cy - ay) - (cx - ax) * (py - ay);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
}

/** True if (px,py) falls inside the union of `uvTris` -- a face's real, possibly-irregular footprint. */
function pointInUvTris(px, py, uvTris) {
  for (const tri of uvTris) {
    if (pointInTriangle(px, py, tri)) return true;
  }
  return false;
}

/**
 * Build one tapered (frustum) box, extruded along `face.normal` from `d0`
 * to `d1` with independent half-widths `w0`/`w1` at each end -- a straight
 * prism when w0 === w1, a peg/socket taper otherwise. Shares buildStampMesh's
 * 8-corner box topology; `d0`/`d1` and `w0`/`w1` are deliberately free-signed
 * (negative depth = into the solid) so the same helper builds both an
 * outward-protruding peg and an inward-cut socket cavity.
 */
function buildFrustumBox(face, cu, cv, w0, d0, w1, d1) {
  // The box's 8-corner winding below assumes d0 < d1 (corners 0-3 are the
  // "near" end, 4-7 the "far" end, wound for an outward normal in that
  // order) -- callers may legitimately pass either order (e.g. a socket
  // cavity's cutting direction runs opposite its taper direction), so swap
  // ends here rather than at every call site. Building an inside-out box
  // silently corrupts the boolean that consumes it: manifold-3d treats
  // winding as the solid/void boundary, so a flipped cutter in subtract()
  // effectively adds volume instead of removing it.
  if (d0 > d1) { [w0, d0, w1, d1] = [w1, d1, w0, d0]; }
  const positions = [];
  const corners = [
    [cu - w0, cv - w0, d0], [cu + w0, cv - w0, d0], [cu + w0, cv + w0, d0], [cu - w0, cv + w0, d0],
    [cu - w1, cv - w1, d1], [cu + w1, cv - w1, d1], [cu + w1, cv + w1, d1], [cu - w1, cv + w1, d1],
  ];
  for (const [pu, pv, pd] of corners) {
    positions.push(
      face.origin[0] + face.u[0] * pu + face.v[0] * pv + face.normal[0] * pd,
      face.origin[1] + face.u[1] * pu + face.v[1] * pv + face.normal[1] * pd,
      face.origin[2] + face.u[2] * pu + face.v[2] * pv + face.normal[2] * pd,
    );
  }
  const indices = [
    0, 3, 2, 0, 2, 1,
    4, 5, 6, 4, 6, 7,
    0, 1, 5, 0, 5, 4,
    2, 3, 7, 2, 7, 6,
    0, 4, 7, 0, 7, 3,
    1, 2, 6, 1, 6, 5,
  ];
  return { positions, indices };
}

/** True if a square footprint of half-width `half` centered at (cu,cv) fits inside `face`. */
function connectorFootprintFits(face, cu, cv, half) {
  const corners = [[cu, cv], [cu - half, cv - half], [cu + half, cv - half], [cu + half, cv + half], [cu - half, cv + half]];
  return corners.every(([pu, pv]) => pointInUvTris(pu, pv, face.uvTris));
}

/** Project faceA's (cu,cv) into faceB's local (u,v) frame. */
function projectSiteToFaceB(faceA, faceB, cu, cv) {
  const world = [
    faceA.origin[0] + faceA.u[0] * cu + faceA.v[0] * cv,
    faceA.origin[1] + faceA.u[1] * cu + faceA.v[1] * cv,
    faceA.origin[2] + faceA.u[2] * cu + faceA.v[2] * cv,
  ];
  const rel = sub(world, faceB.origin);
  return { cuB: dot(rel, faceB.u), cvB: dot(rel, faceB.v) };
}

/**
 * LuBan-style: one peg/socket per shared interface, centred on the overlap.
 * Shrinks width until the footprint fits both organic cut faces (or returns []).
 * Returns `{ sites, width }` — `width` is the fitted size actually used.
 */
export function planSingleConnectorSite(faceA, faceB, { width, margin, minWidth = 5 } = {}) {
  let w = width;
  const cu0 = (faceA.uMin + faceA.uMax) / 2;
  const cv0 = (faceA.vMin + faceA.vMax) / 2;
  while (w >= minWidth) {
    const half = margin ?? w / 2;
    if (connectorFootprintFits(faceA, cu0, cv0, half)) {
      const { cuB, cvB } = projectSiteToFaceB(faceA, faceB, cu0, cv0);
      if (connectorFootprintFits(faceB, cuB, cvB, half)) {
        return { sites: [{ cuA: cu0, cvA: cv0, cuB, cvB }], width: w };
      }
    }
    w *= 0.9;
  }
  return { sites: [], width: 0 };
}

/**
 * Lay out connector sites across the shared interface between `faceA` and
 * `faceB`. Default (maxSites === 1) is LuBan-style: a single centred peg.
 * Pass maxSites > 1 (or omit with an explicit pitch) for a dense grid —
 * kept for tests / experimental multi-peg layouts.
 *
 * Returns `[{cuA, cvA, cuB, cvB}, ...]` — each site's position in both
 * face frames (projected, since u/v axes are built independently).
 */
export function planConnectorSites(faceA, faceB, { width = 7.5, pitch, margin, maxSites } = {}) {
  if (maxSites === 1) {
    return planSingleConnectorSite(faceA, faceB, { width, margin }).sites;
  }
  const p = pitch ?? width * 1.6;
  const half = (margin ?? width / 2);
  const uSpan = faceA.uMax - faceA.uMin;
  const vSpan = faceA.vMax - faceA.vMin;
  const cols = Math.max(1, Math.floor(uSpan / p) + 1);
  const rows = Math.max(1, Math.floor(vSpan / p) + 1);
  const startU = faceA.uMin + (uSpan - (cols - 1) * p) / 2;
  const startV = faceA.vMin + (vSpan - (rows - 1) * p) / 2;

  const sites = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cu = startU + c * p;
      const cv = startV + r * p;
      if (!connectorFootprintFits(faceA, cu, cv, half)) continue;
      const { cuB, cvB } = projectSiteToFaceB(faceA, faceB, cu, cv);
      if (!connectorFootprintFits(faceB, cuB, cvB, half)) continue;
      sites.push({ cuA: cu, cvA: cv, cuB, cvB });
      if (maxSites != null && sites.length >= maxSites) return sites;
    }
  }
  return sites;
}

/**
 * Build peg/socket geometry for one shared interface. Default is one
 * LuBan-style centred connector (maxSites: 1), sized by `width` (shrunk
 * to fit if the organic cut face is irregular). Pegs on faceA, sockets on
 * faceB with print clearance via `tolerance`.
 *
 * Each peg/socket is its own small box mesh — union with unionMeshes()
 * before boolean ops (manifold-3d needs non-self-intersecting input).
 */
export function buildConnectorMeshes(faceA, faceB, opts = {}) {
  const { width = 7.5, depth = 11, taper = 0.15, tolerance = 0.2, pitch, margin, maxSites = 1 } = opts;
  let sites;
  let usedWidth = width;
  if (maxSites === 1) {
    const planned = planSingleConnectorSite(faceA, faceB, { width, margin });
    sites = planned.sites;
    usedWidth = planned.width || width;
  } else {
    sites = planConnectorSites(faceA, faceB, { width, pitch, margin, maxSites });
  }
  const baseHalf = usedWidth / 2;
  const tipHalf = baseHalf * (1 - taper);
  const usedDepth = depth * (usedWidth / width);
  const pegs = sites.map((s) => buildFrustumBox(faceA, s.cuA, s.cvA, baseHalf, 0, tipHalf, usedDepth));
  const sockets = sites.map((s) => buildFrustumBox(faceB, s.cuB, s.cvB, baseHalf + tolerance, 0.5, tipHalf + tolerance, -(usedDepth + 0.5)));
  return { sites, pegs, sockets, width: usedWidth };
}

/**
 * Add one LuBan-style Plug connector to an adjacent piece pair -- unions
 * the peg onto `meshA`, subtracts the matching (oversized-for-tolerance)
 * socket from `meshB`. `faceA`/`faceB` come from a findAdjacentPieces
 * result. Returns the two new meshes plus `count` (0 or 1 -- 0 when the
 * shared face is too small/narrow for even one connector footprint).
 */
export async function addConnectorsToPieces(meshA, meshB, faceA, faceB, opts = {}) {
  const { sites, pegs, sockets } = buildConnectorMeshes(faceA, faceB, opts);
  if (sites.length === 0) return { meshA, meshB, count: 0, pegSolid: null, socketSolid: null };
  const pegSolid = await unionMeshes(pegs);
  const socketSolid = await unionMeshes(sockets);
  const newMeshA = await unionMeshes([meshA, pegSolid]);
  const newMeshB = await subtractMesh(meshB, socketSolid);
  return { meshA: newMeshA, meshB: newMeshB, count: sites.length, pegSolid, socketSolid };
}

/**
 * Round off the low-poly "faceted" look a small cut piece can have once
 * scaled up in a slicer. Real cause: a source scan's triangle budget is
 * fixed and gets divided by surface area across however many pieces a cut
 * produces, so a small piece can end up with very few triangles for its
 * physical size — each one highly visible once magnified, even though the
 * mesh itself is perfectly watertight (confirmed on a real 27-piece cut:
 * every piece 0 open/non-manifold edges, this is a resolution problem, not
 * a correctness one). Uses manifold-3d's own smoothing pipeline rather
 * than a hand-rolled subdivision — `smoothOut` auto-detects which edges
 * are real corners (kept sharp) vs. genuinely curved surface (smoothed to
 * G1 continuity), critically leaving flat faces of 3+ triangles — e.g. the
 * planar cross-section every planar cut produces — untouched, then
 * `refineToLength` subdivides until triangles are below `targetLength`,
 * moving new vertices onto the interpolated smooth surface rather than
 * just flat-splitting.
 *
 * `targetLength` is not required — computed automatically as this piece's
 * own bounding-box diagonal / 80, clamped to [0.1, 3]. That means it's a
 * near no-op on the large pieces from an original dense scan (already
 * finer than that), and meaningfully refines the tiny sparse ones without
 * needing per-piece tuning — same "scale-relative, not a fixed constant"
 * approach as the weld epsilon fixes elsewhere in this pipeline.
 */
export async function smoothMesh(mesh, { targetLength, minSharpAngle = 52.5, minSmoothness = 0 } = {}) {
  const { Manifold, Mesh } = await getManifoldModule();
  const b = computeBounds(mesh.positions);
  const diagonal = Math.hypot(...b.size) || 1;
  const length = targetLength ?? Math.min(3, Math.max(0.1, diagonal / 80));
  let manifold = toManifold(Manifold, Mesh, mesh);
  // manifold-3d's smoothOut has a real edge case on meshes with very few
  // triangles per flat face (confirmed directly: a bare 12-triangle box, 2
  // triangles/face, silently collapses every refined vertex back onto the
  // original 8 corners -- status() still reports NoError throughout, so
  // this can't be caught any other way than knowing to avoid it). Sparse
  // input is exactly what this feature targets (small under-triangulated
  // pieces), so pre-refine first to guarantee every face has enough
  // triangles to dodge it; skip for anything already dense enough that
  // it's very unlikely to be a simple few-triangle shape, so an
  // already-detailed piece doesn't get its triangle count needlessly
  // multiplied before refineToLength even runs.
  if (manifold.numTri() < 2000) {
    const denser = manifold.refine(4);
    manifold.delete();
    manifold = denser;
  }
  let smoothed, refined;
  try {
    smoothed = manifold.smoothOut(minSharpAngle, minSmoothness);
    refined = smoothed.refineToLength(length);
  } finally {
    manifold.delete();
  }
  if (refined.numTri() > 2_000_000) {
    smoothed.delete();
    refined.delete();
    throw new Error(`Smoothing would produce ${refined.numTri()} triangles — aborted to avoid freezing the browser.`);
  }
  const result = fromManifold(refined);
  smoothed.delete();
  refined.delete();
  return result;
}

/**
 * Compute `planeCount` default evenly-spaced planes across `mesh`'s full
 * extent along `normal`, anchored at `planePoint`. Returns
 * [{t, point, normal}] ordered low-to-high, where `t` is signed distance
 * from `planePoint` along `normal` — the same coordinate space `flexiCut`
 * sorts by. This is LuBan's Flexi cut starting point: build the default
 * list here, optionally move any individual plane's `t`/`point`, then cut
 * with `flexiCut`. Planar cut (`parallelPlaneCut`) is just this with zero
 * overrides, so fixing bugs here fixes both.
 */
export function computeDefaultFlexiPlanes(mesh, planePoint, planeNormal, planeCount) {
  const normal = normalize(planeNormal);
  const { min, max } = computeBounds(mesh.positions);
  const corners = [];
  for (const x of [min[0], max[0]]) for (const y of [min[1], max[1]]) for (const z of [min[2], max[2]]) corners.push([x, y, z]);
  const projections = corners.map((c) => dot(sub(c, planePoint), normal));
  const tMin = Math.min(...projections);
  const tMax = Math.max(...projections);
  const planes = [];
  for (let i = 1; i <= planeCount; i++) {
    const t = tMin + ((tMax - tMin) * i) / (planeCount + 1);
    planes.push({ t, tMin, tMax, normal, point: [planePoint[0] + normal[0] * t, planePoint[1] + normal[1] * t, planePoint[2] + normal[2] * t] });
  }
  return planes;
}

/**
 * LuBan-style "Flexi cut": sequentially slice `mesh` through an explicit
 * list of `{point, normal, t}` planes (each independently positioned/
 * oriented — unlike parallelPlaneCut's shared normal), always processed
 * low-to-high by `t` regardless of the order given, since the sequential
 * peel-off algorithm below needs ascending order to behave predictably.
 *
 * Each step peels off the "below" side as a finished piece and keeps
 * "above" as the remainder for the next plane. Returns an array of
 * {positions,indices,openEdgeCount} pieces, ordered low-to-high.
 */
export async function flexiCut(mesh, planes) {
  const sorted = [...planes].sort((a, b) => (a.t ?? 0) - (b.t ?? 0));
  const pieces = [];
  let remaining = mesh;
  for (const { point, normal } of sorted) {
    if (!remaining) break;
    const cut = await sliceMeshByPlane(remaining, point, normal);
    if (!cut.below && !cut.above) continue; // plane missed this remainder — try the next one
    if (cut.below) pieces.push(cut.below);
    remaining = cut.above;
  }
  if (remaining) pieces.push(withOpenEdgeCount(remaining));
  return pieces;
}

/**
 * LuBan-style "Number of planes" cut (Planar cut): lay `planeCount`
 * evenly-spaced parallel planes (all sharing `normal`) across the full
 * extent of `mesh` along that normal, splitting it into up to
 * planeCount+1 pieces in one pass. `planeCount` is a literal plane count
 * (matching LuBan's own field of the same name and its multi-plane
 * preview) — 10 planes -> up to 11 pieces, not 10. Just
 * computeDefaultFlexiPlanes + flexiCut with no overrides; see those for
 * the actual cutting logic.
 *
 * By default the span always covers the piece's full extent (tMin to
 * tMax). Pass `startAtPlane: true` to instead treat `planePoint` itself as
 * where the evenly-spaced span begins: everything on the near side of
 * that plane is peeled off once, unsplit, as its own piece (so nothing is
 * lost), and only the far side gets divided into planeCount+1 pieces.
 * Useful when the model's bounding box includes a disconnected low-lying
 * feature (e.g. a tail dipping to the same height as the paws) that would
 * otherwise land in the very first slice.
 */
export async function parallelPlaneCut(mesh, planePoint, planeNormal, planeCount, { startAtPlane = false } = {}) {
  if (planeCount <= 0) return [withOpenEdgeCount(mesh)];
  const normal = normalize(planeNormal);

  const pieces = [];
  let workingMesh = mesh;
  if (startAtPlane) {
    const cut0 = await sliceMeshByPlane(mesh, planePoint, normal);
    if (cut0.below) pieces.push(cut0.below);
    if (!cut0.above) return pieces.length ? pieces : [withOpenEdgeCount(mesh)];
    workingMesh = cut0.above;
  }

  const planes = computeDefaultFlexiPlanes(workingMesh, planePoint, normal, planeCount);
  const rest = await flexiCut(workingMesh, planes);
  return [...pieces, ...rest];
}

/** The Y-normal plane list gridCut would use for one X-strip, optionally shifted by half the Y pitch (LuBan's "Staggered cut pattern" — alternating rows offset sideways, like a running-bond brick course, so a straight-through seam doesn't run the full length of the model). Shifting a uniform set of `count` planes by pitch/2 always stays strictly inside (tMin,tMax) — the two end cells simply come out half- and one-and-a-half-pitch wide instead of uniform, exactly like the cut/full bricks at the end of a real staggered course; no wraparound or plane-count change needed. */
function buildStaggeredYPlanes(piece, count, shift) {
  const base = computeDefaultFlexiPlanes(piece, [0, 0, 0], [0, 1, 0], count);
  if (!shift || base.length === 0) return base;
  const { tMin, tMax, normal } = base[0];
  const halfPitch = (tMax - tMin) / (count + 1) / 2;
  return base.map((p) => {
    const t = p.t + halfPitch;
    return { t, tMin, tMax, normal, point: [normal[0] * t, normal[1] * t, normal[2] * t] };
  });
}

/**
 * LuBan-style "Grid cut": divides `mesh` into a waffle-like 3D grid of
 * (xCount+1) x (yCount+1) x (zCount+1) pieces by laying evenly-spaced
 * planes across all three axes independently (LuBan's own "Number of
 * sections in X, Y, Z" — confirmed via reference screenshot showing all
 * three axes cut simultaneously, not just X/Y). Built from the same
 * `parallelPlaneCut` primitive as Straight cut, applied axis by axis to
 * every piece from the previous axis, so it inherits the same watertight
 * guarantees. A count of 0 on any axis skips that axis's split entirely
 * (e.g. xCount=2, yCount=0, zCount=0 behaves like a plain Straight cut
 * along X). Order of pieces is X-major, then Y, then Z within each cell.
 *
 * `staggered` (LuBan's own "Staggered cut pattern" checkbox) offsets the Y
 * cut positions by half a pitch for every other X-strip, matching the
 * reference screenshot's top-down running-bond look — only demonstrated
 * there for the X/Y pair, so Z cuts stay uniform regardless (no reference
 * to confirm a 3-axis convention against, and Z-staggering is rarely
 * wanted for print-bed splitting anyway). No-op unless both xCount and
 * yCount are set — staggering needs alternating rows to offset between.
 */
export async function gridCut(mesh, xCount, yCount, zCount, { staggered = false } = {}) {
  const splitAxis = async (pieces, count, normal) => {
    if (count <= 0) return pieces;
    const out = [];
    for (const piece of pieces) out.push(...(await parallelPlaneCut(piece, [0, 0, 0], normal, count)));
    return out;
  };
  let cells = [withOpenEdgeCount(mesh)];
  cells = await splitAxis(cells, xCount, [1, 0, 0]);
  if (staggered && xCount > 0 && yCount > 0) {
    const out = [];
    for (let i = 0; i < cells.length; i++) {
      out.push(...(await flexiCut(cells[i], buildStaggeredYPlanes(cells[i], yCount, i % 2 === 1))));
    }
    cells = out;
  } else {
    cells = await splitAxis(cells, yCount, [0, 1, 0]);
  }
  cells = await splitAxis(cells, zCount, [0, 0, 1]);
  return cells;
}

/**
 * LuBan-style "Radial cut": partitions `mesh` into `count` pie-slice wedges
 * around `axis` ('x'/'y'/'z'), like slicing a cake through its center --
 * evenly spaced by `360/count` degrees starting at `startAngleDeg`, with
 * the rotation center offset from the piece's own bounding-box center by
 * `centerOffset` (a `[u,v]` pair, each in [-1,1], scaled by that in-plane
 * axis's own half-extent -- LuBan's "Center X/Y [-1,1]" fields).
 *
 * Needs no new CSG primitive: every wedge boundary is a full plane
 * containing the rotation axis, which `sliceMeshByPlane` already handles
 * for an arbitrary normal. A single such plane only ever bisects space at
 * 180° increments (the plane extends infinitely both directions through
 * the axis), so a wedge narrower than 180° -- the normal case for
 * count>=3 -- needs the INTERSECTION of two half-space cuts: split by the
 * wedge's leading-edge plane and keep the "above" half (spanning the next
 * 180°), then split that half by the trailing-edge plane and keep
 * "below" -- the two constraints together narrow it down to exactly the
 * angular span between the two edges. Each wedge is computed fresh from
 * the original `mesh` (not a sequential peel like flexiCut/gridCut use)
 * since wedges aren't nested along one axis, they all meet at the shared
 * rotation axis. count===2 is the one case where a single plane already
 * gives the full answer (both halves in one cut, no intersection needed).
 * count<=1 is a no-op (nothing to slice into).
 *
 * The two in-plane axes for a given rotation axis follow the standard
 * right-hand cyclic convention (x->y->z->x): rotating around Z sweeps
 * from +X toward +Y as the angle increases, around X sweeps +Y toward
 * +Z, around Y sweeps +Z toward +X -- not verified against a LuBan
 * reference for axes other than Z, since no screenshot of Direction=X/Y
 * was available to confirm its exact Center-field axis order; Z matches
 * the reference screenshot's own top-down view.
 */
export async function radialCut(mesh, { axis = 'z', count, startAngleDeg = 0, centerOffset = [0, 0] } = {}) {
  if (!count || count <= 1) return [withOpenEdgeCount(mesh)];
  const b = computeBounds(mesh.positions);
  const axisIdx = { x: 0, y: 1, z: 2 }[axis];
  const uIdx = (axisIdx + 1) % 3;
  const vIdx = (axisIdx + 2) % 3;
  const bcenter = [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2];
  const center = bcenter.slice();
  center[uIdx] = bcenter[uIdx] + centerOffset[0] * (b.size[uIdx] / 2);
  center[vIdx] = bcenter[vIdx] + centerOffset[1] * (b.size[vIdx] / 2);

  const normalAt = (deg) => {
    const rad = (deg * Math.PI) / 180;
    const n = [0, 0, 0];
    n[uIdx] = -Math.sin(rad);
    n[vIdx] = Math.cos(rad);
    return n;
  };
  const angleStep = 360 / count;

  if (count === 2) {
    const { above, below } = await sliceMeshByPlane(mesh, center, normalAt(startAngleDeg));
    return [above, below].filter(Boolean);
  }

  const wedges = [];
  for (let i = 0; i < count; i++) {
    const thetaA = startAngleDeg + i * angleStep;
    const thetaB = startAngleDeg + (i + 1) * angleStep;
    const cutA = await sliceMeshByPlane(mesh, center, normalAt(thetaA));
    if (!cutA.above) continue;
    const cutB = await sliceMeshByPlane(cutA.above, center, normalAt(thetaB));
    if (cutB.below) wedges.push(cutB.below);
  }
  return wedges;
}

/**
 * Auto-fit-to-bed cutting (LuBan's "Modular cut"): recursively bisect
 * `mesh` along whichever axis exceeds `bedSize`, at the midpoint of its
 * current bounds, until every resulting piece fits — no manual plane
 * placement per piece. Each bisection roughly halves the piece's size on
 * the cut axis, so this converges without needing a depth limit, though
 * `maxPieces` still caps runaway cases (e.g. a bed dimension of 0).
 *
 * A raw midpoint split can land squarely on a thin protruding feature
 * (e.g. a toe sticking out from a paw) — and since each recursive halving
 * re-centers on whatever's left, that same thin feature can get sliced
 * through several times in a row before the surrounding chunk finally
 * shrinks below bed size, stranding it as multiple paper-thin slivers
 * instead of one sensible piece. To avoid that, each split first tries the
 * midpoint, and if either resulting half comes out pathologically thin
 * relative to the piece being split, nearby offsets are tried instead,
 * keeping whichever avoids stranding a sliver. The midpoint is always the
 * fallback if no offset does better, so this still terminates exactly as
 * before.
 *
 * Returns { pieces, capped }. `pieces` are watertight
 * {positions,indices,openEdgeCount} meshes. If a plane fails to intersect a
 * still-oversized piece (degenerate geometry), that piece is kept as-is
 * rather than dropped. `capped` is true if maxPieces was hit before every
 * piece fit.
 */
export async function modularCut(mesh, bedSize, { maxPieces = 128, minPieceFraction = 0.15 } = {}) {
  const eps = 1e-6;
  const SPLIT_FRACTIONS = [0.5, 0.4, 0.6, 0.3, 0.7, 0.2, 0.8];
  const queue = [mesh];
  const pieces = [];
  let capped = false;

  while (queue.length) {
    if (pieces.length + queue.length >= maxPieces) { capped = true; break; }
    const m = queue.pop();
    const b = computeBounds(m.positions);
    let axis = -1, worst = eps;
    for (let i = 0; i < 3; i++) {
      const over = b.size[i] - bedSize[i];
      if (over > worst) { worst = over; axis = i; }
    }
    if (axis === -1) { pieces.push(withOpenEdgeCount(m)); continue; }

    const parentDiagonal = Math.hypot(...b.size);
    const minDiagonal = parentDiagonal * minPieceFraction;
    const normal = [0, 0, 0];
    normal[axis] = 1;

    let fallback = null;
    let chosen = null;
    for (const frac of SPLIT_FRACTIONS) {
      const point = [
        axis === 0 ? b.min[0] + b.size[0] * frac : (b.min[0] + b.max[0]) / 2,
        axis === 1 ? b.min[1] + b.size[1] * frac : (b.min[1] + b.max[1]) / 2,
        axis === 2 ? b.min[2] + b.size[2] * frac : (b.min[2] + b.max[2]) / 2,
      ];
      const cut = await sliceMeshByPlane(m, point, normal);
      if (!cut.above || !cut.below) continue;
      if (frac === 0.5) fallback = cut;
      const da = Math.hypot(...computeBounds(cut.above.positions).size);
      const db = Math.hypot(...computeBounds(cut.below.positions).size);
      if (Math.min(da, db) >= minDiagonal) { chosen = cut; break; }
    }
    const result = chosen || fallback;
    if (!result) { pieces.push(withOpenEdgeCount(m)); continue; }
    queue.push(result.above, result.below);
  }
  if (capped) {
    for (const m of queue) pieces.push(withOpenEdgeCount(m));
  }
  return { pieces, capped };
}
