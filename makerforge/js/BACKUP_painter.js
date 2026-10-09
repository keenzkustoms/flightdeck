/**
 * MakerDeck STL Painter Engine — b623
 * Pure computation module: STL parsing, feature detection, 3MF export.
 */

/* ------------------------------------------------------------------ */
/*  STL Parsing                                                       */
/* ------------------------------------------------------------------ */

export function parseSTLBinary(buffer) {
  const dv = new DataView(buffer);
  const nTri = dv.getUint32(80, true);
  const vertices = new Float32Array(nTri * 9);
  const normals = new Float32Array(nTri * 3);
  let off = 84;
  for (let i = 0; i < nTri; i++) {
    normals[i * 3]     = dv.getFloat32(off, true);
    normals[i * 3 + 1] = dv.getFloat32(off + 4, true);
    normals[i * 3 + 2] = dv.getFloat32(off + 8, true);
    off += 12;
    for (let v = 0; v < 9; v++) {
      vertices[i * 9 + v] = dv.getFloat32(off, true);
      off += 4;
    }
    off += 2; // attribute byte count
  }
  return { vertices, normals, nTri };
}

/* ------------------------------------------------------------------ */
/*  Vertex Deduplication                                              */
/* ------------------------------------------------------------------ */

export function deduplicateVertices(vertices, nTri) {
  const EPS = 1e-6;
  const map = new Map();
  const faces = new Uint32Array(nTri * 3);
  const tempVerts = [];
  let nVerts = 0;

  function key(x, y, z) {
    const sx = (Math.round(x / EPS) * EPS).toFixed(5);
    const sy = (Math.round(y / EPS) * EPS).toFixed(5);
    const sz = (Math.round(z / EPS) * EPS).toFixed(5);
    return `${sx},${sy},${sz}`;
  }

  for (let i = 0; i < nTri; i++) {
    for (let v = 0; v < 3; v++) {
      const off = i * 9 + v * 3;
      const x = vertices[off], y = vertices[off + 1], z = vertices[off + 2];
      const k = key(x, y, z);
      let idx = map.get(k);
      if (idx === undefined) {
        idx = nVerts++;
        map.set(k, idx);
        tempVerts.push(x, y, z);
      }
      faces[i * 3 + v] = idx;
    }
  }

  const verts = new Float32Array(tempVerts);
  return { verts, faces, nVerts };
}

/**
 * One mid-point subdivision pass (each triangle → 4). Paint masks remap
 * so each child keeps its parent's colour. Soft-caps huge meshes.
 * @returns {{ verts, faces, nVerts, nTri, embossMask, debossMask, trimMask, facePaint }}
 */
export function upgradePaintResolution(verts, faces, nVerts, nTri, masks = {}, opts = {}) {
  const maxFaces = opts.maxFaces ?? 1_500_000;
  if (nTri * 4 > maxFaces) {
    throw new Error(`Resolution upgrade would exceed ${maxFaces.toLocaleString()} faces (now ${nTri.toLocaleString()})`);
  }

  const embossMask = masks.embossMask || new Uint8Array(nTri);
  const debossMask = masks.debossMask || new Uint8Array(nTri);
  const trimMask = masks.trimMask || new Uint8Array(nTri);
  const facePaint = masks.facePaint || masksToFacePaint(embossMask, debossMask, trimMask, nTri);

  const vertList = new Array(nVerts * 3);
  for (let i = 0; i < nVerts * 3; i++) vertList[i] = verts[i];
  let nextVi = nVerts;
  const midMap = new Map();

  function midpoint(a, b) {
    const key = a < b ? a + ':' + b : b + ':' + a;
    let m = midMap.get(key);
    if (m !== undefined) return m;
    m = nextVi++;
    midMap.set(key, m);
    vertList.push(
      (vertList[a * 3] + vertList[b * 3]) * 0.5,
      (vertList[a * 3 + 1] + vertList[b * 3 + 1]) * 0.5,
      (vertList[a * 3 + 2] + vertList[b * 3 + 2]) * 0.5
    );
    return m;
  }

  const newFaces = new Uint32Array(nTri * 4 * 3);
  const newEmboss = new Uint8Array(nTri * 4);
  const newDeboss = new Uint8Array(nTri * 4);
  const newTrim = new Uint8Array(nTri * 4);
  const newPaint = new Uint8Array(nTri * 4);
  let fi = 0;

  for (let i = 0; i < nTri; i++) {
    const a = faces[i * 3], b = faces[i * 3 + 1], c = faces[i * 3 + 2];
    const ab = midpoint(a, b);
    const bc = midpoint(b, c);
    const ca = midpoint(c, a);
    const children = [
      [a, ab, ca],
      [ab, b, bc],
      [ca, bc, c],
      [ab, bc, ca],
    ];
    for (const tri of children) {
      newFaces[fi * 3] = tri[0];
      newFaces[fi * 3 + 1] = tri[1];
      newFaces[fi * 3 + 2] = tri[2];
      newEmboss[fi] = embossMask[i];
      newDeboss[fi] = debossMask[i];
      newTrim[fi] = trimMask[i];
      newPaint[fi] = facePaint[i] || 0;
      fi++;
    }
  }

  return {
    verts: new Float32Array(vertList),
    faces: newFaces,
    nVerts: nextVi,
    nTri: fi,
    embossMask: newEmboss,
    debossMask: newDeboss,
    trimMask: newTrim,
    facePaint: newPaint,
  };
}

/* ------------------------------------------------------------------ */
/*  Face adjacency + morphological cleanup                            */
/* ------------------------------------------------------------------ */

function edgeKey(a, b) { return a < b ? `${a}-${b}` : `${b}-${a}`; }

export function buildFaceAdj(faces, nTri) {
  const edgeToFace = new Map();
  const faceAdj = new Array(nTri);
  for (let i = 0; i < nTri; i++) faceAdj[i] = [];

  for (let i = 0; i < nTri; i++) {
    const a = faces[i * 3], b = faces[i * 3 + 1], c = faces[i * 3 + 2];
    const edges = [edgeKey(a, b), edgeKey(b, c), edgeKey(a, c)];
    for (const ek of edges) {
      const prev = edgeToFace.get(ek);
      if (prev !== undefined) {
        faceAdj[prev].push(i);
        faceAdj[i].push(prev);
      }
      edgeToFace.set(ek, i);
    }
  }
  return faceAdj;
}

function morphDilate(mask, faceAdj, nTri, steps) {
  if (steps <= 0) return;
  let cur = mask.slice();
  for (let s = 0; s < steps; s++) {
    const next = cur.slice();
    for (let i = 0; i < nTri; i++) {
      if (cur[i]) continue;
      for (const nb of faceAdj[i]) {
        if (cur[nb]) { next[i] = 1; break; }
      }
    }
    cur = next;
  }
  mask.set(cur);
}

function morphErode(mask, faceAdj, nTri, steps) {
  if (steps <= 0) return;
  let cur = mask.slice();
  for (let s = 0; s < steps; s++) {
    const next = cur.slice();
    for (let i = 0; i < nTri; i++) {
      if (!cur[i]) continue;
      for (const nb of faceAdj[i]) {
        if (!cur[nb]) { next[i] = 0; break; }
      }
    }
    cur = next;
  }
  mask.set(cur);
}

/** Dilate then erode — bridge pinholes in thin ridges. */
export function morphClose(mask, faceAdj, nTri, steps) {
  morphDilate(mask, faceAdj, nTri, steps);
  morphErode(mask, faceAdj, nTri, steps);
}

/** Erode then dilate — strip speckles. */
export function morphOpen(mask, faceAdj, nTri, steps) {
  morphErode(mask, faceAdj, nTri, steps);
  morphDilate(mask, faceAdj, nTri, steps);
}

/** Current paint class of a face: 'body' | 'emboss' | 'deboss' | 'trim'. */
export function paintClassOf(i, embossMask, debossMask, trimMask) {
  if (embossMask && embossMask[i]) return 'emboss';
  if (debossMask && debossMask[i]) return 'deboss';
  if (trimMask && trimMask[i]) return 'trim';
  return 'body';
}

/** 0-based AMS slot index for a face (0 = Base / slot 1). */
export function paintSlotOf(i, facePaint) {
  return facePaint ? (facePaint[i] || 0) : 0;
}

/** Build facePaint (0..15) from legacy three-mask paint. */
export function masksToFacePaint(embossMask, debossMask, trimMask, nTri) {
  const fp = new Uint8Array(nTri);
  for (let i = 0; i < nTri; i++) {
    if (embossMask?.[i]) fp[i] = 1;
    else if (debossMask?.[i]) fp[i] = 2;
    else if (trimMask?.[i]) fp[i] = 3;
  }
  return fp;
}

/** Sync legacy masks from facePaint (slots 2–4 only). */
export function facePaintToMasks(facePaint, nTri) {
  const embossMask = new Uint8Array(nTri);
  const debossMask = new Uint8Array(nTri);
  const trimMask = new Uint8Array(nTri);
  for (let i = 0; i < nTri; i++) {
    const s = facePaint?.[i] || 0;
    if (s === 1) embossMask[i] = 1;
    else if (s === 2) debossMask[i] = 1;
    else if (s === 3) trimMask[i] = 1;
  }
  return { embossMask, debossMask, trimMask };
}

/**
 * Flood fill connected faces that share the seed's AMS slot (facePaint).
 * @returns {number[]} face indices
 */
export function floodFillSameSlot(seed, facePaint, nTri, faceAdj, opts = {}) {
  const region = opts.region || null;
  if (seed < 0 || seed >= nTri) return [];
  if (region && !region[seed]) return [];
  const match = facePaint?.[seed] || 0;
  const out = [];
  const visited = new Uint8Array(nTri);
  const queue = [seed];
  visited[seed] = 1;
  while (queue.length) {
    const fi = queue.pop();
    out.push(fi);
    for (const nb of faceAdj[fi]) {
      if (visited[nb]) continue;
      if (region && !region[nb]) continue;
      if ((facePaint?.[nb] || 0) !== match) continue;
      visited[nb] = 1;
      queue.push(nb);
    }
  }
  return out;
}

/**
 * Flood-fill connected faces that share the seed's paint class.
 * Optional `region` mask limits the fill (box-select then flood).
 * Pass `trimMask` in opts for AMS slot 4.
 * @returns {number[]} face indices
 */
export function floodFillFaces(seed, embossMask, debossMask, nTri, faceAdj, opts = {}) {
  const region = opts.region || null;
  const trimMask = opts.trimMask || null;
  if (seed < 0 || seed >= nTri) return [];
  if (region && !region[seed]) return [];
  const matchClass = paintClassOf(seed, embossMask, debossMask, trimMask);
  const out = [];
  const visited = new Uint8Array(nTri);
  const queue = [seed];
  visited[seed] = 1;
  while (queue.length) {
    const fi = queue.pop();
    out.push(fi);
    for (const nb of faceAdj[fi]) {
      if (visited[nb]) continue;
      if (region && !region[nb]) continue;
      if (paintClassOf(nb, embossMask, debossMask, trimMask) !== matchClass) continue;
      visited[nb] = 1;
      queue.push(nb);
    }
  }
  return out;
}

function faceNormalCentroid(verts, faces, fi) {
  const a = faces[fi * 3], b = faces[fi * 3 + 1], c = faces[fi * 3 + 2];
  const ax = verts[a * 3], ay = verts[a * 3 + 1], az = verts[a * 3 + 2];
  const bx = verts[b * 3], by = verts[b * 3 + 1], bz = verts[b * 3 + 2];
  const cx = verts[c * 3], cy = verts[c * 3 + 1], cz = verts[c * 3 + 2];
  const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
  const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
  let nx = e1y * e2z - e1z * e2y;
  let ny = e1z * e2x - e1x * e2z;
  let nz = e1x * e2y - e1y * e2x;
  const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
  if (len > 1e-12) { nx /= len; ny /= len; nz /= len; }
  return {
    nx, ny, nz,
    cx: (ax + bx + cx) / 3,
    cy: (ay + by + cy) / 3,
    cz: (az + bz + cz) / 3,
  };
}

/** Stamp buffer so brush dabs don't allocate/clear a full nTri mask every stroke. */
let _brushSeen = null;
let _brushStamp = 0;

/**
 * Brush / spray dab: faces near hit within `radius` mm, front-facing vs seed.
 * `density` < 1 scatters like spray (distance-weighted random keep).
 * @returns {number[]} face indices
 */
export function brushDabFaces(seed, hitPoint, verts, faces, nTri, faceAdj, opts = {}) {
  const radius = Math.max(0.1, opts.radius ?? 2.5);
  const maxAngleDeg = Math.max(5, Math.min(120, opts.maxAngleDeg ?? 80));
  const density = Math.max(0.05, Math.min(1, opts.density ?? 1));
  const rng = typeof opts.rng === 'function' ? opts.rng : Math.random;
  const canUseFace = typeof opts.canUseFace === 'function' ? opts.canUseFace : null;
  if (seed < 0 || seed >= nTri) return [];
  if (canUseFace && !canUseFace(seed)) return [];

  if (!_brushSeen || _brushSeen.length < nTri) _brushSeen = new Uint32Array(nTri);
  _brushStamp = (_brushStamp + 1) >>> 0;
  if (_brushStamp === 0) { _brushSeen.fill(0); _brushStamp = 1; }
  const stamp = _brushStamp;

  const cosThr = Math.cos((maxAngleDeg * Math.PI) / 180);
  const seedGeo = faceNormalCentroid(verts, faces, seed);
  const hx = hitPoint.x ?? hitPoint[0];
  const hy = hitPoint.y ?? hitPoint[1];
  const hz = hitPoint.z ?? hitPoint[2];
  const r2 = radius * radius;

  const out = [];
  const queue = [seed];
  _brushSeen[seed] = stamp;

  while (queue.length) {
    const fi = queue.pop();
    if (canUseFace && !canUseFace(fi)) continue;
    const g = faceNormalCentroid(verts, faces, fi);
    const dx = g.cx - hx, dy = g.cy - hy, dz = g.cz - hz;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 > r2) continue;
    const dot = g.nx * seedGeo.nx + g.ny * seedGeo.ny + g.nz * seedGeo.nz;
    if (dot < cosThr) continue;

    let keep = true;
    if (density < 1 && fi !== seed) {
      const t = Math.sqrt(d2) / radius;
      keep = rng() < density * (1 - t * 0.85);
    }
    if (keep) out.push(fi);

    for (const nb of faceAdj[fi]) {
      if (_brushSeen[nb] === stamp) continue;
      if (canUseFace && !canUseFace(nb)) continue;
      _brushSeen[nb] = stamp;
      queue.push(nb);
    }
  }
  return out;
}

/**
 * Orca-style smart fill.
 *
 * Classic (wrap=false): faces within Euclidean `radius` mm of the hit whose
 * normals stay within `maxAngleDeg` of the *seed* normal — paints the facing
 * patch, not nearby pillars through open air.
 *
 * Wrap (wrap=true): walks face-to-face around posts/awnings using *surface*
 * path distance + local neighbour normals (never air-jumps across gaps).
 *
 * `samePaintOnly` stops at colour boundaries. `canUseFace` is a hard mask
 * (hidden faces are skipped and never used as bridges).
 * @returns {number[]} face indices
 */
export function smartFillFaces(seed, hitPoint, verts, faces, nTri, embossMask, debossMask, faceAdj, opts = {}) {
  const radius = Math.max(0.1, opts.radius ?? 8);
  const maxAngleDeg = Math.max(1, Math.min(140, opts.maxAngleDeg ?? 40));
  const samePaintOnly = opts.samePaintOnly !== false;
  const wrapEdges = opts.localNormals === true;
  const trimMask = opts.trimMask || null;
  const facePaint = opts.facePaint || null;
  const canUseFace = typeof opts.canUseFace === 'function' ? opts.canUseFace : null;
  if (seed < 0 || seed >= nTri) return [];
  if (canUseFace && !canUseFace(seed)) return [];

  const cosThr = Math.cos((maxAngleDeg * Math.PI) / 180);
  const seedGeo = faceNormalCentroid(verts, faces, seed);
  const matchSlot = facePaint ? (facePaint[seed] || 0) : null;
  const matchClass = matchSlot == null ? paintClassOf(seed, embossMask, debossMask, trimMask) : null;
  const hx = hitPoint.x ?? hitPoint[0];
  const hy = hitPoint.y ?? hitPoint[1];
  const hz = hitPoint.z ?? hitPoint[2];
  const r2 = radius * radius;

  const matchesPaint = (fi) => {
    if (samePaintOnly) {
      if (facePaint) return (facePaint[fi] || 0) === matchSlot;
      return paintClassOf(fi, embossMask, debossMask, trimMask) === matchClass;
    }
    return true;
  };

  const out = [];
  const queued = new Uint8Array(nTri);
  const queue = [seed];
  queued[seed] = 1;

  // Wrap mode: geodesic path length along the mesh (mm). Classic: unused.
  const pathDist = wrapEdges ? new Float32Array(nTri) : null;
  if (pathDist) {
    pathDist.fill(Infinity);
    pathDist[seed] = 0;
  }

  while (queue.length) {
    const fi = queue.pop();
    if (canUseFace && !canUseFace(fi)) continue;
    if (!matchesPaint(fi)) continue;

    const g = faceNormalCentroid(verts, faces, fi);

    if (wrapEdges) {
      if (pathDist[fi] > radius) continue;
    } else {
      const dx = g.cx - hx, dy = g.cy - hy, dz = g.cz - hz;
      if (dx * dx + dy * dy + dz * dz > r2) continue;
      const dot = g.nx * seedGeo.nx + g.ny * seedGeo.ny + g.nz * seedGeo.nz;
      if (dot < cosThr) continue;
    }

    out.push(fi);

    for (const nb of faceAdj[fi]) {
      if (queued[nb]) continue;
      if (canUseFace && !canUseFace(nb)) continue;
      if (!matchesPaint(nb)) continue;

      if (wrapEdges) {
        const ng = faceNormalCentroid(verts, faces, nb);
        const localDot = ng.nx * g.nx + ng.ny * g.ny + ng.nz * g.nz;
        if (localDot < cosThr) continue;
        const step = Math.hypot(ng.cx - g.cx, ng.cy - g.cy, ng.cz - g.cz);
        const nd = pathDist[fi] + step;
        if (nd > radius) continue;
        pathDist[nb] = nd;
      }
      queued[nb] = 1;
      queue.push(nb);
    }
  }
  return out;
}

/**
 * Find the rough paint edge band between emboss (paintMask) and body.
 * Seeds = faces that touch the opposite colour; then grow `width` rings
 * into body (default) so you can fill the jagged red fringe with black.
 *
 * @param {Uint8Array} paintMask  emboss (or deboss) paint map
 * @param {Uint32Array} faces
 * @param {number} nTri
 * @param {{ width?: number, growInto?: 'body'|'paint'|'both', region?: Uint8Array|null, faceAdj?: any[] }} opts
 * @returns {Uint8Array} highlight mask (1 = selected edge band)
 */
export function findPaintBoundary(paintMask, faces, nTri, opts = {}) {
  const {
    width = 2,
    growInto = 'body',
    region = null,
    faceAdj: faceAdjIn = null,
  } = opts;
  const faceAdj = faceAdjIn || buildFaceAdj(faces, nTri);
  const inRegion = (i) => !region || region[i];

  const band = new Uint8Array(nTri);
  for (let i = 0; i < nTri; i++) {
    if (!inRegion(i)) continue;
    const painted = paintMask[i] ? 1 : 0;
    for (const nb of faceAdj[i]) {
      if ((paintMask[nb] ? 1 : 0) !== painted) {
        band[i] = 1;
        break;
      }
    }
  }

  // Grow outward; default grows into body so Fill Emboss thickens the web edge.
  let cur = band;
  const steps = Math.max(0, width | 0);
  for (let s = 0; s < steps; s++) {
    const next = cur.slice();
    for (let i = 0; i < nTri; i++) {
      if (cur[i]) continue;
      if (region && !region[i]) continue;
      if (growInto === 'body' && paintMask[i]) continue;
      if (growInto === 'paint' && !paintMask[i]) continue;
      for (const nb of faceAdj[i]) {
        if (cur[nb]) { next[i] = 1; break; }
      }
    }
    cur = next;
  }
  return cur;
}

/** Neighbour majority vote — cleans stair-step / speckled boundaries. */
export function majorityFilter(mask, faceAdj, nTri, passes = 1) {
  if (passes <= 0) return;
  for (let p = 0; p < passes; p++) {
    const next = mask.slice();
    for (let i = 0; i < nTri; i++) {
      let on = mask[i] ? 1 : 0;
      let total = 1;
      for (const nb of faceAdj[i]) {
        total++;
        if (mask[nb]) on++;
      }
      next[i] = on * 2 >= total ? 1 : 0;
    }
    mask.set(next);
  }
}

function smoothFaceScores(scores, faceAdj, nTri, passes) {
  if (passes <= 0) return scores;
  let cur = scores;
  for (let p = 0; p < passes; p++) {
    const next = new Float32Array(nTri);
    for (let i = 0; i < nTri; i++) {
      let s = cur[i];
      let n = 1;
      for (const nb of faceAdj[i]) {
        s += cur[nb];
        n++;
      }
      next[i] = s / n;
    }
    cur = next;
  }
  return cur;
}

function growByHysteresis(scores, nTri, faceAdj, highThr, lowThr, positive) {
  const mask = new Uint8Array(nTri);
  const queue = [];
  for (let i = 0; i < nTri; i++) {
    const ok = positive ? scores[i] >= highThr : scores[i] <= -highThr;
    if (ok) {
      mask[i] = 1;
      queue.push(i);
    }
  }
  while (queue.length) {
    const fi = queue.pop();
    for (const nb of faceAdj[fi]) {
      if (mask[nb]) continue;
      const ok = positive ? scores[nb] >= lowThr : scores[nb] <= -lowThr;
      if (ok) {
        mask[nb] = 1;
        queue.push(nb);
      }
    }
  }
  return mask;
}

function percentileCut(sortedAsc, keepTopFraction) {
  if (!sortedAsc.length) return Infinity;
  const keep = Math.min(0.95, Math.max(0.05, keepTopFraction));
  const idx = Math.floor((1 - keep) * (sortedAsc.length - 1));
  return sortedAsc[idx];
}

/* ------------------------------------------------------------------ */
/*  Feature Detection — Laplacian Smoothing Method                    */
/* ------------------------------------------------------------------ */

export function detectFeatures(verts, faces, nVerts, nTri, opts = {}) {
  const {
    iterations = 60,
    weight = 0.5,
    threshold = 0.35,
    mode = 'both', // 'emboss', 'deboss', 'both'
    adaptive = true,
    absFloor = 0.05,
    ridgeTop = true,
    morphCloseSteps = 0,
    morphOpenSteps = 0,
    scoreSmoothPasses = 2,
    hysteresis = 0.55, // lowThr = highThr * hysteresis; 1 = off
    majorityPasses = 1,
  } = opts;

  // 1. Build adjacency
  const adjOffsets = new Uint32Array(nVerts + 1);
  const edgeSet = new Array(nVerts);
  for (let i = 0; i < nVerts; i++) edgeSet[i] = new Set();
  for (let i = 0; i < nTri; i++) {
    const a = faces[i * 3], b = faces[i * 3 + 1], c = faces[i * 3 + 2];
    edgeSet[a].add(b); edgeSet[a].add(c);
    edgeSet[b].add(a); edgeSet[b].add(c);
    edgeSet[c].add(a); edgeSet[c].add(b);
  }
  let totalAdj = 0;
  for (let i = 0; i < nVerts; i++) {
    adjOffsets[i] = totalAdj;
    totalAdj += edgeSet[i].size;
  }
  adjOffsets[nVerts] = totalAdj;
  const adjList = new Uint32Array(totalAdj);
  for (let i = 0; i < nVerts; i++) {
    let off = adjOffsets[i];
    for (const nb of edgeSet[i]) adjList[off++] = nb;
  }

  // 2. Compute vertex normals (area-weighted)
  const vertNormals = new Float32Array(nVerts * 3);
  for (let i = 0; i < nTri; i++) {
    const a = faces[i * 3], b = faces[i * 3 + 1], c = faces[i * 3 + 2];
    const ax = verts[a * 3], ay = verts[a * 3 + 1], az = verts[a * 3 + 2];
    const bx = verts[b * 3], by = verts[b * 3 + 1], bz = verts[b * 3 + 2];
    const cx = verts[c * 3], cy = verts[c * 3 + 1], cz = verts[c * 3 + 2];
    const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
    const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
    const nx = e1y * e2z - e1z * e2y;
    const ny = e1z * e2x - e1x * e2z;
    const nz = e1x * e2y - e1y * e2x;
    vertNormals[a * 3] += nx; vertNormals[a * 3 + 1] += ny; vertNormals[a * 3 + 2] += nz;
    vertNormals[b * 3] += nx; vertNormals[b * 3 + 1] += ny; vertNormals[b * 3 + 2] += nz;
    vertNormals[c * 3] += nx; vertNormals[c * 3 + 1] += ny; vertNormals[c * 3 + 2] += nz;
  }
  for (let i = 0; i < nVerts; i++) {
    const off = i * 3;
    const len = Math.sqrt(vertNormals[off] ** 2 + vertNormals[off + 1] ** 2 + vertNormals[off + 2] ** 2);
    if (len > 1e-10) {
      vertNormals[off] /= len;
      vertNormals[off + 1] /= len;
      vertNormals[off + 2] /= len;
    }
  }

  // 3. Laplacian smoothing
  let smooth = new Float32Array(verts);
  let tmp = new Float32Array(nVerts * 3);
  for (let iter = 0; iter < iterations; iter++) {
    for (let i = 0; i < nVerts; i++) {
      const start = adjOffsets[i], end = adjOffsets[i + 1];
      const count = end - start;
      if (count === 0) {
        tmp[i * 3] = smooth[i * 3];
        tmp[i * 3 + 1] = smooth[i * 3 + 1];
        tmp[i * 3 + 2] = smooth[i * 3 + 2];
        continue;
      }
      let sx = 0, sy = 0, sz = 0;
      for (let j = start; j < end; j++) {
        const nb = adjList[j];
        sx += smooth[nb * 3];
        sy += smooth[nb * 3 + 1];
        sz += smooth[nb * 3 + 2];
      }
      sx /= count; sy /= count; sz /= count;
      tmp[i * 3]     = weight * smooth[i * 3]     + (1 - weight) * sx;
      tmp[i * 3 + 1] = weight * smooth[i * 3 + 1] + (1 - weight) * sy;
      tmp[i * 3 + 2] = weight * smooth[i * 3 + 2] + (1 - weight) * sz;
    }
    [smooth, tmp] = [tmp, smooth];
  }

  // 4. Signed displacement per vertex + raw offset vectors
  const displacement = new Float32Array(nVerts);
  const offsetX = new Float32Array(nVerts);
  const offsetY = new Float32Array(nVerts);
  const offsetZ = new Float32Array(nVerts);
  for (let i = 0; i < nVerts; i++) {
    const dx = verts[i * 3]     - smooth[i * 3];
    const dy = verts[i * 3 + 1] - smooth[i * 3 + 1];
    const dz = verts[i * 3 + 2] - smooth[i * 3 + 2];
    offsetX[i] = dx; offsetY[i] = dy; offsetZ[i] = dz;
    displacement[i] = dx * vertNormals[i * 3] + dy * vertNormals[i * 3 + 1] + dz * vertNormals[i * 3 + 2];
  }

  // 5. Per-face scores (displacement × ridge-top alignment)
  const embossScores = new Float32Array(nTri);
  const debossScores = new Float32Array(nTri);
  const wantEmboss = mode === 'emboss' || mode === 'both';
  const wantDeboss = mode === 'deboss' || mode === 'both';

  for (let i = 0; i < nTri; i++) {
    const a = faces[i * 3], b = faces[i * 3 + 1], c = faces[i * 3 + 2];
    const ax = verts[a * 3], ay = verts[a * 3 + 1], az = verts[a * 3 + 2];
    const bx = verts[b * 3], by = verts[b * 3 + 1], bz = verts[b * 3 + 2];
    const cx = verts[c * 3], cy = verts[c * 3 + 1], cz = verts[c * 3 + 2];
    const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
    const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
    let fnx = e1y * e2z - e1z * e2y;
    let fny = e1z * e2x - e1x * e2z;
    let fnz = e1x * e2y - e1y * e2x;
    const flen = Math.sqrt(fnx * fnx + fny * fny + fnz * fnz);
    if (flen > 1e-12) { fnx /= flen; fny /= flen; fnz /= flen; }

    const avg = (displacement[a] + displacement[b] + displacement[c]) / 3;
    let align = 1;
    if (ridgeTop) {
      let ox = (offsetX[a] + offsetX[b] + offsetX[c]) / 3;
      let oy = (offsetY[a] + offsetY[b] + offsetY[c]) / 3;
      let oz = (offsetZ[a] + offsetZ[b] + offsetZ[c]) / 3;
      const olen = Math.sqrt(ox * ox + oy * oy + oz * oz);
      if (olen > 1e-10) {
        ox /= olen; oy /= olen; oz /= olen;
        // Signed alignment: ridge caps face along the offset; side walls do not.
        const dot = fnx * ox + fny * oy + fnz * oz;
        align = 0.12 + 0.88 * Math.max(0, dot);
      } else {
        align = 0.12;
      }
    }
    embossScores[i] = avg > 0 ? avg * align : avg;
    debossScores[i] = avg < 0 ? avg * align : avg;
  }

  // Need face adjacency for score smooth / hysteresis / morph / majority
  const needAdj = scoreSmoothPasses > 0 || hysteresis < 0.999
    || morphCloseSteps > 0 || morphOpenSteps > 0 || majorityPasses > 0;
  const faceAdj = needAdj ? buildFaceAdj(faces, nTri) : null;

  let embossScoresUse = embossScores;
  let debossScoresUse = debossScores;
  if (faceAdj && scoreSmoothPasses > 0) {
    if (wantEmboss) embossScoresUse = smoothFaceScores(embossScores, faceAdj, nTri, scoreSmoothPasses);
    if (wantDeboss) debossScoresUse = smoothFaceScores(debossScores, faceAdj, nTri, scoreSmoothPasses);
  }

  // 6. Resolve thresholds (adaptive percentile or absolute mm)
  let embossThr = threshold;
  let debossThr = threshold;
  if (adaptive) {
    const keepTop = Math.min(0.95, Math.max(0.05, threshold > 1 ? 0.95 : threshold));
    if (wantEmboss) {
      const pos = [];
      for (let i = 0; i < nTri; i++) {
        if (embossScoresUse[i] > absFloor) pos.push(embossScoresUse[i]);
      }
      pos.sort((x, y) => x - y);
      embossThr = Math.max(absFloor, percentileCut(pos, keepTop));
    }
    if (wantDeboss) {
      const neg = [];
      for (let i = 0; i < nTri; i++) {
        if (debossScoresUse[i] < -absFloor) neg.push(-debossScoresUse[i]);
      }
      neg.sort((x, y) => x - y);
      debossThr = Math.max(absFloor, percentileCut(neg, keepTop));
    }
  } else {
    embossThr = Math.max(absFloor, threshold);
    debossThr = Math.max(absFloor, threshold);
  }

  // 7. Classify (hysteresis grow when enabled — smoother region edges)
  let embossMask = new Uint8Array(nTri);
  let debossMask = new Uint8Array(nTri);
  const useHyst = faceAdj && hysteresis > 0 && hysteresis < 0.999;

  if (wantEmboss) {
    if (useHyst) {
      const low = embossThr * hysteresis;
      embossMask = growByHysteresis(embossScoresUse, nTri, faceAdj, embossThr, low, true);
    } else {
      for (let i = 0; i < nTri; i++) {
        if (embossScoresUse[i] >= embossThr) embossMask[i] = 1;
      }
    }
  }
  if (wantDeboss) {
    if (useHyst) {
      const low = debossThr * hysteresis;
      debossMask = growByHysteresis(debossScoresUse, nTri, faceAdj, debossThr, low, false);
    } else {
      for (let i = 0; i < nTri; i++) {
        if (debossScoresUse[i] <= -debossThr) debossMask[i] = 1;
      }
    }
  }

  // 8. Morph + majority cleanup
  if (faceAdj) {
    if (wantEmboss) {
      morphClose(embossMask, faceAdj, nTri, morphCloseSteps);
      morphOpen(embossMask, faceAdj, nTri, morphOpenSteps);
      majorityFilter(embossMask, faceAdj, nTri, majorityPasses);
    }
    if (wantDeboss) {
      morphClose(debossMask, faceAdj, nTri, morphCloseSteps);
      morphOpen(debossMask, faceAdj, nTri, morphOpenSteps);
      majorityFilter(debossMask, faceAdj, nTri, majorityPasses);
    }
  }

  let embossCount = 0, debossCount = 0;
  for (let i = 0; i < nTri; i++) {
    if (embossMask[i]) embossCount++;
    if (debossMask[i]) debossCount++;
  }

  return {
    embossMask,
    debossMask,
    embossCount,
    debossCount,
    embossThr,
    debossThr,
  };
}

/* ------------------------------------------------------------------ */
/*  Cluster Cleaning — BFS Connected Components                       */
/* ------------------------------------------------------------------ */

export function cleanClusters(mask, faces, nTri, verts, minArea, faceAdjIn) {
  const faceAdj = faceAdjIn || buildFaceAdj(faces, nTri);

  function triArea(fi) {
    const a = faces[fi * 3], b = faces[fi * 3 + 1], c = faces[fi * 3 + 2];
    const ax = verts[a * 3], ay = verts[a * 3 + 1], az = verts[a * 3 + 2];
    const bx = verts[b * 3], by = verts[b * 3 + 1], bz = verts[b * 3 + 2];
    const cx = verts[c * 3], cy = verts[c * 3 + 1], cz = verts[c * 3 + 2];
    const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
    const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
    const crx = e1y * e2z - e1z * e2y;
    const cry = e1z * e2x - e1x * e2z;
    const crz = e1x * e2y - e1y * e2x;
    return 0.5 * Math.sqrt(crx * crx + cry * cry + crz * crz);
  }

  const visited = new Uint8Array(nTri);
  let removed = 0;

  for (let i = 0; i < nTri; i++) {
    if (!mask[i] || visited[i]) continue;
    const cluster = [];
    const queue = [i];
    visited[i] = 1;
    let area = 0;
    while (queue.length > 0) {
      const fi = queue.pop();
      cluster.push(fi);
      area += triArea(fi);
      for (const nb of faceAdj[fi]) {
        if (!visited[nb] && mask[nb]) {
          visited[nb] = 1;
          queue.push(nb);
        }
      }
    }
    if (area < minArea) {
      for (const fi of cluster) {
        mask[fi] = 0;
        removed++;
      }
    }
  }
  return removed;
}

/* ------------------------------------------------------------------ */
/*  Minimal Store-Only ZIP Creator                                    */
/* ------------------------------------------------------------------ */

function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function createZip(files) {
  const enc = new TextEncoder();
  const entries = files.map(f => ({
    name: enc.encode(f.name),
    data: f.data instanceof Uint8Array ? f.data : enc.encode(f.data)
  }));

  let localSize = 0;
  for (const e of entries) localSize += 30 + e.name.length + e.data.length;
  let centralSize = 0;
  for (const e of entries) centralSize += 46 + e.name.length;
  const totalSize = localSize + centralSize + 22;

  const buf = new Uint8Array(totalSize);
  const dv = new DataView(buf.buffer);
  let localOff = 0;
  const offsets = [];

  for (const e of entries) {
    offsets.push(localOff);
    const crc = crc32(e.data);
    dv.setUint32(localOff, 0x04034b50, true); localOff += 4;
    dv.setUint16(localOff, 20, true); localOff += 2;
    dv.setUint16(localOff, 0, true); localOff += 2;
    dv.setUint16(localOff, 0, true); localOff += 2;
    dv.setUint16(localOff, 0, true); localOff += 2;
    dv.setUint16(localOff, 0x0021, true); localOff += 2;
    dv.setUint32(localOff, crc, true); localOff += 4;
    dv.setUint32(localOff, e.data.length, true); localOff += 4;
    dv.setUint32(localOff, e.data.length, true); localOff += 4;
    dv.setUint16(localOff, e.name.length, true); localOff += 2;
    dv.setUint16(localOff, 0, true); localOff += 2;
    buf.set(e.name, localOff); localOff += e.name.length;
    buf.set(e.data, localOff); localOff += e.data.length;
  }

  const centralStart = localOff;
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const crc = crc32(e.data);
    dv.setUint32(localOff, 0x02014b50, true); localOff += 4;
    dv.setUint16(localOff, 20, true); localOff += 2;
    dv.setUint16(localOff, 20, true); localOff += 2;
    dv.setUint16(localOff, 0, true); localOff += 2;
    dv.setUint16(localOff, 0, true); localOff += 2;
    dv.setUint16(localOff, 0, true); localOff += 2;
    dv.setUint16(localOff, 0x0021, true); localOff += 2;
    dv.setUint32(localOff, crc, true); localOff += 4;
    dv.setUint32(localOff, e.data.length, true); localOff += 4;
    dv.setUint32(localOff, e.data.length, true); localOff += 4;
    dv.setUint16(localOff, e.name.length, true); localOff += 2;
    dv.setUint16(localOff, 0, true); localOff += 2;
    dv.setUint16(localOff, 0, true); localOff += 2;
    dv.setUint16(localOff, 0, true); localOff += 2;
    dv.setUint16(localOff, 0, true); localOff += 2;
    dv.setUint32(localOff, 0, true); localOff += 4;
    dv.setUint32(localOff, offsets[i], true); localOff += 4;
    buf.set(e.name, localOff); localOff += e.name.length;
  }
  const centralEnd = localOff;

  dv.setUint32(localOff, 0x06054b50, true); localOff += 4;
  dv.setUint16(localOff, 0, true); localOff += 2;
  dv.setUint16(localOff, 0, true); localOff += 2;
  dv.setUint16(localOff, entries.length, true); localOff += 2;
  dv.setUint16(localOff, entries.length, true); localOff += 2;
  dv.setUint32(localOff, centralEnd - centralStart, true); localOff += 4;
  dv.setUint32(localOff, centralStart, true); localOff += 4;
  dv.setUint16(localOff, 0, true); localOff += 2;

  return buf;
}

/* ------------------------------------------------------------------ */
/*  3MF Export (OrcaSlicer / BambuStudio Compatible)                  */
/* ------------------------------------------------------------------ */

/**
 * Bambu/Orca per-triangle paint_color codes (same table as makerforge/js/3mf.js).
 * Index 0 = AMS slot 1 (Base). Export omits attribute for slot 1; others use these codes.
 * Supports up to 16 filaments (multi-AMS).
 */
export const PAINT_COLOR_CODES = [
  '4', '8', '0C', '1C', '2C', '3C', '4C', '5C',
  '6C', '7C', '8C', '9C', 'AC', 'BC', 'CC', 'DC',
];
export const MAX_PAINT_SLOTS = PAINT_COLOR_CODES.length;
export const EXPORT_MAX_FACES = 1_800_000;

function fmtCoord(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return '0';
  return String(Math.round(x * 1e4) / 1e4);
}

function meshXmlChunk(verts, faces, paint, face0, faceCount, vert0, vertCount) {
  const vLines = new Array(vertCount);
  for (let i = 0; i < vertCount; i++) {
    const vi = vert0 + i;
    vLines[i] = `        <vertex x="${fmtCoord(verts[vi * 3])}" y="${fmtCoord(verts[vi * 3 + 1])}" z="${fmtCoord(verts[vi * 3 + 2])}" />`;
  }
  const tLines = new Array(faceCount);
  for (let i = 0; i < faceCount; i++) {
    const fi = face0 + i;
    const v1 = faces[fi * 3] - vert0;
    const v2 = faces[fi * 3 + 1] - vert0;
    const v3 = faces[fi * 3 + 2] - vert0;
    const slot = paint[fi] || 0;
    const attrs = (slot > 0 && slot < PAINT_COLOR_CODES.length)
      ? ` paint_color="${PAINT_COLOR_CODES[slot]}"`
      : '';
    tLines[i] = `        <triangle v1="${v1}" v2="${v2}" v3="${v3}"${attrs} />`;
  }
  return {
    vertices: vLines.join('\n') + '\n',
    triangles: tLines.join('\n') + '\n',
  };
}

function objectModelFile(vertices, triangles, objectId = 1) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US"
  xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"
  xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06"
  xmlns:b="http://schemas.bambulab.com/package/2021">
  <resources>
    <object id="${objectId}" type="model">
      <mesh>
        <vertices>
${vertices}        </vertices>
        <triangles>
${triangles}        </triangles>
      </mesh>
    </object>
  </resources>
  <build>
    <item objectid="${objectId}" />
  </build>
</model>`;
}

function stampRangeIsSeparate(faces, nTri, nVerts, stampTri0, stampVert0) {
  if (!(stampTri0 > 0 && stampTri0 < nTri && stampVert0 > 0 && stampVert0 < nVerts)) return false;
  for (let i = 0; i < stampTri0; i++) {
    if (faces[i * 3] >= stampVert0 || faces[i * 3 + 1] >= stampVert0 || faces[i * 3 + 2] >= stampVert0) return false;
  }
  for (let i = stampTri0; i < nTri; i++) {
    if (faces[i * 3] < stampVert0 || faces[i * 3 + 1] < stampVert0 || faces[i * 3 + 2] < stampVert0) return false;
  }
  return true;
}

/** paint_color string → 0-based slot index */
const PAINT_CODE_TO_SLOT = (() => {
  const m = Object.create(null);
  for (let i = 0; i < PAINT_COLOR_CODES.length; i++) {
    m[PAINT_COLOR_CODES[i]] = i;
    m[PAINT_COLOR_CODES[i].toLowerCase()] = i;
  }
  return m;
})();


/* ------------------------------------------------------------------ */
/*  ZIP Reader (for 3MF import)                                       */
/* ------------------------------------------------------------------ */

/**
 * Parse ZIP central directory and extract entries.
 * Handles both stored (method 0) and deflated (method 8) via DecompressionStream.
 */
async function unzipEntries(buffer) {
  const u8 = new Uint8Array(buffer);
  const dv = new DataView(buffer);

  // Find End-of-Central-Directory (scan backwards)
  let eocdOff = -1;
  for (let i = u8.length - 22; i >= 0; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocdOff = i; break; }
  }
  if (eocdOff < 0) throw new Error('Not a valid ZIP file');

  const cdCount = dv.getUint16(eocdOff + 10, true);
  let cdOff = dv.getUint32(eocdOff + 16, true);

  const entries = [];
  for (let i = 0; i < cdCount; i++) {
    if (dv.getUint32(cdOff, true) !== 0x02014b50) break;
    const method = dv.getUint16(cdOff + 10, true);
    const compSize = dv.getUint32(cdOff + 20, true);
    const uncompSize = dv.getUint32(cdOff + 24, true);
    const nameLen = dv.getUint16(cdOff + 28, true);
    const extraLen = dv.getUint16(cdOff + 30, true);
    const commentLen = dv.getUint16(cdOff + 32, true);
    const localOff = dv.getUint32(cdOff + 42, true);
    const name = new TextDecoder().decode(u8.slice(cdOff + 46, cdOff + 46 + nameLen));

    // Local header → skip to data
    const lnameLen = dv.getUint16(localOff + 26, true);
    const lextraLen = dv.getUint16(localOff + 28, true);
    const dataOff = localOff + 30 + lnameLen + lextraLen;
    const raw = u8.slice(dataOff, dataOff + compSize);

    let data;
    if (method === 0) {
      data = raw;
    } else if (method === 8) {
      // Deflate → use browser DecompressionStream
      const ds = new DecompressionStream('deflate-raw');
      const writer = ds.writable.getWriter();
      const reader = ds.readable.getReader();
      writer.write(raw); writer.close();
      const chunks = [];
      while (true) { const { done, value } = await reader.read(); if (done) break; chunks.push(value); }
      const total = chunks.reduce((s, c) => s + c.length, 0);
      data = new Uint8Array(total);
      let p = 0; for (const c of chunks) { data.set(c, p); p += c.length; }
    } else {
      data = raw; // Unsupported method — try raw
    }

    entries.push({ name, data });
    cdOff += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/* ------------------------------------------------------------------ */
/*  3MF Import                                                        */
/* ------------------------------------------------------------------ */

/** Map a paint_color attribute value to 0-based AMS slot (0 = base / unpainted). */
function paintColorToSlot(pc) {
  if (!pc) return 0;
  let slot = PAINT_CODE_TO_SLOT[pc];
  if (slot != null) return slot;
  // Long subdivision strings: highest recognisable code wins
  for (let s = PAINT_COLOR_CODES.length - 1; s >= 1; s--) {
    if (pc.includes(PAINT_COLOR_CODES[s])) return s;
  }
  return 0;
}

/**
 * Parse object mesh XML without DOMParser — 50–90MB Painter exports OOM/crash
 * DOMParser in Chromium and silently drop paint.
 */
function parseObjectModelXml(xml) {
  // Count vertices first for typed arrays
  const vertRe = /<vertex\b[^>]*\bx="([^"]+)"[^>]*\by="([^"]+)"[^>]*\bz="([^"]+)"/g;
  const vertMatches = [];
  let vm;
  while ((vm = vertRe.exec(xml))) vertMatches.push(vm);
  // Alternate attribute order (y/x/z etc.) — rare, fall back via loose scan
  if (!vertMatches.length) {
    const loose = /<vertex\b([^>]*)\/?>/g;
    let lm;
    while ((lm = loose.exec(xml))) {
      const a = lm[1];
      const x = a.match(/\bx="([^"]+)"/);
      const y = a.match(/\by="([^"]+)"/);
      const z = a.match(/\bz="([^"]+)"/);
      if (x && y && z) vertMatches.push([null, x[1], y[1], z[1]]);
    }
  }
  const nVerts = vertMatches.length;
  const verts = new Float32Array(nVerts * 3);
  for (let i = 0; i < nVerts; i++) {
    verts[i * 3] = parseFloat(vertMatches[i][1]);
    verts[i * 3 + 1] = parseFloat(vertMatches[i][2]);
    verts[i * 3 + 2] = parseFloat(vertMatches[i][3]);
  }

  const triRe = /<triangle\b([^>]*)\/?>/g;
  const triAttrs = [];
  let tm;
  while ((tm = triRe.exec(xml))) triAttrs.push(tm[1]);
  const nTri = triAttrs.length;
  const faces = new Uint32Array(nTri * 3);
  const facePaint = new Uint8Array(nTri);
  let painted = 0;
  for (let i = 0; i < nTri; i++) {
    const a = triAttrs[i];
    const v1 = a.match(/\bv1="(\d+)"/);
    const v2 = a.match(/\bv2="(\d+)"/);
    const v3 = a.match(/\bv3="(\d+)"/);
    faces[i * 3] = v1 ? parseInt(v1[1], 10) : 0;
    faces[i * 3 + 1] = v2 ? parseInt(v2[1], 10) : 0;
    faces[i * 3 + 2] = v3 ? parseInt(v3[1], 10) : 0;
    const pcm = a.match(/\bpaint_color="([^"]+)"/);
    const slot = paintColorToSlot(pcm ? pcm[1] : null);
    if (slot > 0) {
      facePaint[i] = slot;
      painted++;
    }
  }
  return { verts, faces, nVerts, nTri, facePaint, painted };
}

function parse3MFTransform(raw) {
  if (!raw) return null;
  const n = String(raw).trim().split(/\s+/).map(Number);
  if (n.length !== 12 || n.some(v => !Number.isFinite(v))) return null;
  return n;
}

function getAttrValue(xml, name) {
  const m = xml.match(new RegExp(`\\b${name}="([^"]+)"`));
  return m ? m[1] : '';
}

function norm3mfPath(path) {
  return `/${String(path || '').replace(/^\/+/, '')}`.toLowerCase();
}

function find3MFImportTransforms(entries, modelPath) {
  const main = entries.find(e => /(^|\/)3dmodel\.model$/i.test(e.name) && !/objects?\//i.test(e.name));
  if (!main) return [];
  const xml = new TextDecoder().decode(main.data);
  const wantedPath = norm3mfPath(modelPath);
  const transforms = [];

  let buildObjectId = null;
  const objectRe = /<object\b([^>]*)>([\s\S]*?)<\/object>/gi;
  let om;
  while ((om = objectRe.exec(xml))) {
    const objectAttrs = om[1];
    const objectBody = om[2] || '';
    const objectId = getAttrValue(objectAttrs, 'id');
    const objectPath = getAttrValue(objectAttrs, 'p:path') || getAttrValue(objectAttrs, 'path');
    const objectTransform = parse3MFTransform(getAttrValue(objectAttrs, 'transform') || getAttrValue(objectAttrs, 'p:transform'));
    if (objectPath && norm3mfPath(objectPath) === wantedPath) {
      buildObjectId = objectId;
      if (objectTransform) transforms.push(objectTransform);
      break;
    }
    const compRe = /<component\b([^>]*)\/?>/gi;
    let cm;
    while ((cm = compRe.exec(objectBody))) {
      const compAttrs = cm[1];
      const compPath = getAttrValue(compAttrs, 'p:path') || getAttrValue(compAttrs, 'path');
      if (compPath && norm3mfPath(compPath) === wantedPath) {
        buildObjectId = objectId;
        const compTransform = parse3MFTransform(getAttrValue(compAttrs, 'transform') || getAttrValue(compAttrs, 'p:transform'));
        if (compTransform) transforms.push(compTransform);
        break;
      }
    }
    if (buildObjectId) break;
  }

  if (buildObjectId) {
    const itemRe = /<item\b([^>]*)\/?>/gi;
    let im;
    while ((im = itemRe.exec(xml))) {
      const attrs = im[1];
      if (getAttrValue(attrs, 'objectid') !== buildObjectId) continue;
      const itemTransform = parse3MFTransform(getAttrValue(attrs, 'transform') || getAttrValue(attrs, 'p:transform'));
      if (itemTransform) transforms.push(itemTransform);
      break;
    }
  }

  return transforms;
}

function apply3MFTransformToVerts(verts, nVerts, t) {
  for (let i = 0; i < nVerts; i++) {
    const off = i * 3;
    const x = verts[off], y = verts[off + 1], z = verts[off + 2];
    verts[off] = x * t[0] + y * t[3] + z * t[6] + t[9];
    verts[off + 1] = x * t[1] + y * t[4] + z * t[7] + t[10];
    verts[off + 2] = x * t[2] + y * t[5] + z * t[8] + t[11];
  }
}

/**
 * Parse a 3MF file (ZIP) and extract geometry + paint state.
 * @returns {{ verts, faces, nVerts, nTri, embossMask, debossMask, trimMask, facePaint, colors, painted, stampTri0, stampVert0 }}
 */
export async function import3MF(buffer) {
  if (!buffer || buffer.byteLength < 30) {
    throw new Error('3MF is empty (0 bytes). The last export crashed before writing — reload the STL and export again.');
  }
  const entries = await unzipEntries(buffer);

  // Prefer Objects/* mesh (where Painter/Bambu store paint). Fall back to any .model with triangles.
  const modelCandidates = entries.filter(e => e.name.endsWith('.model'));
  let modelEntry = modelCandidates.find(e =>
    e.name.includes('Objects/') || e.name.includes('objects/'));
  if (!modelEntry) {
    modelEntry = modelCandidates
      .map(e => ({ e, score: (e.data.length || 0) }))
      .sort((a, b) => b.score - a.score)[0]?.e;
  }
  if (!modelEntry) throw new Error('No object model found in 3MF');

  const objectEntries = modelCandidates
    .filter(e => /objects\//i.test(e.name))
    .sort((a, b) => a.name.localeCompare(b.name, 'en'));
  const toParse = objectEntries.length ? objectEntries : (modelEntry ? [modelEntry] : []);
  if (!toParse.length) throw new Error('No object model found in 3MF');

  const parts = [];
  let painted = 0;
  let transformsApplied = 0;
  for (const entry of toParse) {
    const xml = new TextDecoder().decode(entry.data);
    const parsed = parseObjectModelXml(xml);
    if (!parsed.nTri) continue;
    const transforms = find3MFImportTransforms(entries, entry.name);
    for (const t of transforms) apply3MFTransformToVerts(parsed.verts, parsed.nVerts, t);
    transformsApplied += transforms.length;
    painted += parsed.painted;
    parts.push({ ...parsed, entryName: entry.name });
  }
  if (!parts.length) throw new Error('3MF model has no triangles');

  let nVerts = 0, nTri = 0;
  for (const p of parts) { nVerts += p.nVerts; nTri += p.nTri; }
  const verts = new Float32Array(nVerts * 3);
  const faces = new Uint32Array(nTri * 3);
  const facePaint = new Uint8Array(nTri);
  let vo = 0, fo = 0;
  let stampTri0 = null, stampVert0 = null;
  for (const p of parts) {
    // Painter exports the raised artwork as object_2. Keep the split on
    // import so paint tools cannot repaint a logo when a project is reopened.
    if (stampTri0 == null && /objects\/object_2\.model$/i.test(p.entryName || '')) {
      stampTri0 = fo;
      stampVert0 = vo;
    }
    verts.set(p.verts, vo * 3);
    for (let i = 0; i < p.nTri; i++) {
      faces[(fo + i) * 3] = p.faces[i * 3] + vo;
      faces[(fo + i) * 3 + 1] = p.faces[i * 3 + 1] + vo;
      faces[(fo + i) * 3 + 2] = p.faces[i * 3 + 2] + vo;
      facePaint[fo + i] = p.facePaint[i];
    }
    vo += p.nVerts;
    fo += p.nTri;
  }
  const { embossMask, debossMask, trimMask } = facePaintToMasks(facePaint, nTri);

  // Try to read filament colours from project_settings.config
  let colors = null;
  const settingsEntry = entries.find(e => e.name.includes('project_settings'));
  if (settingsEntry) {
    try {
      const json = JSON.parse(new TextDecoder().decode(settingsEntry.data));
      if (json.filament_colour?.length) {
        colors = json.filament_colour.slice(0, MAX_PAINT_SLOTS).map(normalizeFilamentHex);
      }
    } catch { /* not JSON or missing */ }
  }

  return { verts, faces, nVerts, nTri, embossMask, debossMask, trimMask, facePaint, colors, painted, transformsApplied, stampTri0, stampVert0 };
}

function normalizeFilamentHex(c) {
  let h = String(c || '#888888').trim().toUpperCase();
  if (!h.startsWith('#')) h = `#${h}`;
  if (h.length === 9) return h.slice(0, 7); // drop alpha — Bambu project files use #RRGGBB
  if (h.length === 4) {
    // #RGB → #RRGGBB
    h = `#${h[1]}${h[1]}${h[2]}${h[2]}${h[3]}${h[3]}`;
  }
  if (!/^#[0-9A-F]{6}$/.test(h)) return '#888888';
  return h;
}

/**
 * Export painted mesh as Bambu/Orca 3MF.
 * Slim project_settings only — a full Studio settings dump breaks Orca
 * (unknown keys / invalid ranges). Orca keeps filament_colour from this shape;
 * Studio may still replace colours if AMS Sync overwrites the project.
 */
export function export3MF(verts, faces, nVerts, nTri, embossMask, debossMask, options = {}) {
  const {
    bodyColor = '#BBBBBB',
    embossColor = '#FF6600',
    debossColor = '#0066FF',
    trimColor = '#1E40AF',
    trimMask = null,
    facePaint = null,
    slotColors = null,
    slotCount = 4,
    filamentType = null,
    filamentSettingsId = null,
    filamentProfile = 'Generic PLA',
    printerModel = 'Bambu Lab X1 Carbon',
    projectName = 'painted_object',
    stampTri0 = null,
    stampVert0 = null,
  } = options;

  const nSlots = Math.max(1, Math.min(MAX_PAINT_SLOTS, slotCount | 0));
  const paint = facePaint || masksToFacePaint(embossMask, debossMask, trimMask, nTri);
  const colorsArr = (slotColors && slotColors.length
    ? slotColors.slice(0, nSlots)
    : [bodyColor, embossColor, debossColor, trimColor].slice(0, nSlots)
  ).map(normalizeFilamentHex);
  while (colorsArr.length < nSlots) colorsArr.push('#888888');

  const filTypes = Array.from({ length: nSlots }, (_, i) =>
    (filamentType && filamentType[i]) || filamentType?.[0] || 'PLA');
  const filVendors = Array.from({ length: nSlots }, () =>
    /^bambu/i.test(filamentProfile) ? 'Bambu Lab' : 'Generic');
  const filIds = Array.from({ length: nSlots }, () => 'GFL99');
  const filDiameter = Array.from({ length: nSlots }, () => '1.75');
  const filDensity = Array.from({ length: nSlots }, () => '1.24');

  if (nTri > EXPORT_MAX_FACES) {
    throw new Error(`Too many faces to export (${nTri.toLocaleString()}). Reload the STL and stamp the logo again.`);
  }

  const splitStamp = stampRangeIsSeparate(faces, nTri, nVerts, stampTri0, stampVert0);
  const bodyMesh = splitStamp
    ? meshXmlChunk(verts, faces, paint, 0, stampTri0, 0, stampVert0)
    : meshXmlChunk(verts, faces, paint, 0, nTri, 0, nVerts);
  const stampMesh = splitStamp
    ? meshXmlChunk(verts, faces, paint, stampTri0, nTri - stampTri0, stampVert0, nVerts - stampVert0)
    : null;

  const safeName = String(projectName || 'painted_object').replace(/[<>&"']/g, '');
  // Bambu's production extension needs a distinct resource ID inside each
  // external model. Reusing the parent object ID here creates a recursive
  // component reference, which Studio imports as an invalid, zero-volume part.
  const objectModel = objectModelFile(bodyMesh.vertices, bodyMesh.triangles, 2);
  const stampObjectModel = stampMesh ? objectModelFile(stampMesh.vertices, stampMesh.triangles, 4) : null;

  const mainModel = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US"
  xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"
  xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06">
  <metadata name="Application">MakerDeck STL Painter</metadata>
  <metadata name="Title">${safeName}</metadata>
  <resources>
    <object id="1" type="model">
      <components>
        <component objectid="2" p:path="/3D/Objects/object_1.model" />
      </components>
    </object>${splitStamp ? `
    <object id="3" type="model">
      <components>
        <component objectid="4" p:path="/3D/Objects/object_2.model" />
      </components>
    </object>` : ''}
  </resources>
  <build>
    <item objectid="1" />${splitStamp ? `
    <item objectid="3" />` : ''}
  </build>
</model>`;

  // octet-stream for .config — printticket MIME caused Bambu to ignore filament_colour
  const contentTypes = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
  <Default Extension="config" ContentType="application/octet-stream"/>
</Types>`;

  const rels = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel" />
</Relationships>`;

  const modelRels = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Target="/3D/Objects/object_1.model" Id="rel1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel" />${splitStamp ? `
  <Relationship Target="/3D/Objects/object_2.model" Id="rel2" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel" />` : ''}
</Relationships>`;

  const modelSettings = `<?xml version="1.0" encoding="UTF-8"?>
<config>
  <object id="1">
    <metadata key="name" value="${safeName}" />
    <metadata key="extruder" value="1" />
  </object>${splitStamp ? `
  <object id="3">
    <metadata key="name" value="${safeName}_logo" />
    <metadata key="extruder" value="1" />
  </object>` : ''}
  <plate>
    <metadata key="plater_id" value="1" />
    <metadata key="plater_name" value="" />
    <metadata key="locked" value="false" />
    <metadata key="filament_map_mode" value="Auto For Flush" />
    <model_instance>
      <metadata key="object_id" value="1" />
      <metadata key="instance_id" value="0" />
      <metadata key="identify_id" value="0" />
    </model_instance>${splitStamp ? `
    <model_instance>
      <metadata key="object_id" value="3" />
      <metadata key="instance_id" value="0" />
      <metadata key="identify_id" value="1" />
    </model_instance>` : ''}
  </plate>
</config>`;

  // Deliberately use only the Bambu-safe colour fields. Printer/profile fields
  // are coupled to the source printer and make Studio reject an otherwise valid
  // painter project when it is opened against a different machine.
  const projectSettings = JSON.stringify({
    from: 'MakerDeck',
    name: 'project_settings',
    version: '2.2.0',
    filament_type: filTypes,
    filament_colour: colorsArr,
    filament_ids: filIds,
    filament_vendor: filVendors,
    filament_diameter: filDiameter,
    filament_density: filDensity,
  }, null, 2);

  const zipFiles = [
    { name: 'mimetype', data: 'application/vnd.ms-package.3dmanufacturing-3dmodel+xml' },
    { name: '[Content_Types].xml', data: contentTypes },
    { name: '_rels/.rels', data: rels },
    { name: '3D/3dmodel.model', data: mainModel },
    { name: '3D/_rels/3dmodel.model.rels', data: modelRels },
    { name: '3D/Objects/object_1.model', data: objectModel },
    ...(stampObjectModel ? [{ name: '3D/Objects/object_2.model', data: stampObjectModel }] : []),
    { name: 'Metadata/model_settings.config', data: modelSettings },
    { name: 'Metadata/project_settings.config', data: projectSettings }
  ];

  const enc = new TextEncoder();
  const prepared = zipFiles.map(f => ({
    name: f.name,
    data: typeof f.data === 'string' ? enc.encode(f.data) : f.data
  }));

  return createZip(prepared);
}

/* ------------------------------------------------------------------ */
/*  Mesh Islands (connected components)                               */
/* ------------------------------------------------------------------ */

/**
 * Find disconnected mesh islands via DFS on face adjacency.
 * @returns {Array<{id:number, faces:Uint32Array, faceCount:number, bbox:{min:[x,y,z], max:[x,y,z], size:[x,y,z]}}>}
 */
export function findMeshIslands(faces, nTri, faceAdj, verts) {
  const visited = new Uint8Array(nTri);
  const islands = [];

  for (let seed = 0; seed < nTri; seed++) {
    if (visited[seed]) continue;
    const stack = [seed];
    const bucket = [];
    visited[seed] = 1;

    while (stack.length) {
      const f = stack.pop();
      bucket.push(f);
      const nb = faceAdj[f];
      if (nb) for (const n of nb) {
        if (!visited[n]) { visited[n] = 1; stack.push(n); }
      }
    }

    // Bounding box of this island
    let mnX = Infinity, mnY = Infinity, mnZ = Infinity;
    let mxX = -Infinity, mxY = -Infinity, mxZ = -Infinity;
    for (const fi of bucket) {
      for (let k = 0; k < 3; k++) {
        const vi = faces[fi * 3 + k];
        const x = verts[vi * 3], y = verts[vi * 3 + 1], z = verts[vi * 3 + 2];
        if (x < mnX) mnX = x; if (x > mxX) mxX = x;
        if (y < mnY) mnY = y; if (y > mxY) mxY = y;
        if (z < mnZ) mnZ = z; if (z > mxZ) mxZ = z;
      }
    }

    islands.push({
      id: islands.length,
      faces: new Uint32Array(bucket),
      faceCount: bucket.length,
      bbox: {
        min: [mnX, mnY, mnZ],
        max: [mxX, mxY, mxZ],
        size: [mxX - mnX, mxY - mnY, mxZ - mnZ],
      },
    });
  }

  islands.sort((a, b) => b.faceCount - a.faceCount);
  islands.forEach((isl, i) => isl.id = i);
  return islands;
}

/**
 * Build per-face → island-id lookup.  arr[faceIdx] = islandId.
 */
export function buildIslandMap(islands, nTri) {
  const map = new Uint32Array(nTri);
  for (const isl of islands) for (const f of isl.faces) map[f] = isl.id;
  return map;
}

/**
 * Flood fill from seed to all connected faces sharing the same paint class.
 */
export function floodFillSameClass(seed, embossMask, debossMask, trimMask, nTri, faceAdj) {
  const cls = paintClassOf(seed, embossMask, debossMask, trimMask);
  const visited = new Uint8Array(nTri);
  const result = [];
  const stack = [seed];
  visited[seed] = 1;

  while (stack.length) {
    const f = stack.pop();
    result.push(f);
    const nb = faceAdj[f];
    if (nb) for (const n of nb) {
      if (!visited[n] && paintClassOf(n, embossMask, debossMask, trimMask) === cls) {
        visited[n] = 1;
        stack.push(n);
      }
    }
  }
  return result;
}

/**
 * Select all faces belonging to the same island as the seed face.
 */
export function selectIsland(seedFace, islandMap, islands) {
  const islandId = islandMap[seedFace];
  const island = islands.find(isl => isl.id === islandId);
  return island ? Array.from(island.faces) : [seedFace];
}

/* ================================================================== */
/*  SYMMETRY MAP                                                      */
/* ================================================================== */

/**
 * Build a mirror map across the X axis (X=centerX).
 * For each face, find the face whose centroid is closest to the
 * reflected centroid. Returns Int32Array where map[i] = mirror face index
 * or -1 if no suitable mirror found within tolerance.
 */
export function buildSymmetryMap(verts, faces, nTri) {
  // Compute centroids and face normals
  const cx = new Float32Array(nTri);
  const cy = new Float32Array(nTri);
  const cz = new Float32Array(nTri);
  const nx = new Float32Array(nTri);
  const ny = new Float32Array(nTri);
  const nz = new Float32Array(nTri);
  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;

  for (let i = 0; i < nTri; i++) {
    let sx = 0, sy = 0, sz = 0;
    const v0 = faces[i*3], v1 = faces[i*3+1], v2 = faces[i*3+2];
    const ax = verts[v0*3], ay = verts[v0*3+1], az = verts[v0*3+2];
    const bx = verts[v1*3], by = verts[v1*3+1], bz = verts[v1*3+2];
    const dx = verts[v2*3], dy = verts[v2*3+1], dz = verts[v2*3+2];
    cx[i] = (ax+bx+dx)/3; cy[i] = (ay+by+dy)/3; cz[i] = (az+bz+dz)/3;
    // Cross product for normal
    const e1x=bx-ax, e1y=by-ay, e1z=bz-az;
    const e2x=dx-ax, e2y=dy-ay, e2z=dz-az;
    nx[i] = e1y*e2z - e1z*e2y;
    ny[i] = e1z*e2x - e1x*e2z;
    nz[i] = e1x*e2y - e1y*e2x;
    const len = Math.sqrt(nx[i]**2 + ny[i]**2 + nz[i]**2) || 1;
    nx[i] /= len; ny[i] /= len; nz[i] /= len;
    if (cx[i] < minX) minX = cx[i]; if (cx[i] > maxX) maxX = cx[i];
    if (cy[i] < minY) minY = cy[i]; if (cy[i] > maxY) maxY = cy[i];
    if (cz[i] < minZ) minZ = cz[i]; if (cz[i] > maxZ) maxZ = cz[i];
  }

  // Auto-detect best symmetry axis: try X, Y, Z — pick axis with most reciprocal matches
  const extents = [maxX-minX, maxY-minY, maxZ-minZ];
  const diag = Math.sqrt(extents[0]**2 + extents[1]**2 + extents[2]**2);
  const tolerance = diag * 0.005; // 0.5% of bounding diagonal
  const tolSq = tolerance * tolerance;
  const normalThresh = 0.85; // cos(~30 deg)

  function tryAxis(axis) {
    const ca = axis===0 ? cx : axis===1 ? cy : cz;
    const na = axis===0 ? nx : axis===1 ? ny : nz;
    const minA = axis===0 ? minX : axis===1 ? minY : minZ;
    const maxA = axis===0 ? maxX : axis===1 ? maxY : maxZ;
    const center = (minA + maxA) / 2;
    const cellSize = tolerance * 2;

    const grid = new Map();
    function key(a, b, c) {
      return `${Math.floor(a/cellSize)},${Math.floor(b/cellSize)},${Math.floor(c/cellSize)}`;
    }
    for (let i = 0; i < nTri; i++) {
      const k = key(cx[i], cy[i], cz[i]);
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push(i);
    }

    const map = new Int32Array(nTri).fill(-1);
    let matches = 0;
    for (let i = 0; i < nTri; i++) {
      // Mirror centroid across the axis
      const mcx = axis===0 ? 2*center-cx[i] : cx[i];
      const mcy = axis===1 ? 2*center-cy[i] : cy[i];
      const mcz = axis===2 ? 2*center-cz[i] : cz[i];
      // Mirrored normal: flip the axis component
      const mnx = axis===0 ? -nx[i] : nx[i];
      const mny = axis===1 ? -ny[i] : ny[i];
      const mnz = axis===2 ? -nz[i] : nz[i];

      let bestDist = tolSq;
      let bestJ = -1;
      const gx = Math.floor(mcx/cellSize), gy = Math.floor(mcy/cellSize), gz = Math.floor(mcz/cellSize);
      for (let ddx = -1; ddx <= 1; ddx++) {
        for (let ddy = -1; ddy <= 1; ddy++) {
          for (let ddz = -1; ddz <= 1; ddz++) {
            const k = `${gx+ddx},${gy+ddy},${gz+ddz}`;
            const bucket = grid.get(k);
            if (!bucket) continue;
            for (const j of bucket) {
              // Check normal similarity (mirrored)
              const dot = nx[j]*mnx + ny[j]*mny + nz[j]*mnz;
              if (dot < normalThresh) continue;
              const d = (cx[j]-mcx)**2 + (cy[j]-mcy)**2 + (cz[j]-mcz)**2;
              if (d < bestDist) { bestDist = d; bestJ = j; }
            }
          }
        }
      }
      if (bestJ >= 0) { map[i] = bestJ; matches++; }
    }
    return { map, center, matches };
  }

  // Try all 3 axes, pick the one with most matches
  const results = [tryAxis(0), tryAxis(1), tryAxis(2)];
  let bestAxis = 0;
  if (results[1].matches > results[bestAxis].matches) bestAxis = 1;
  if (results[2].matches > results[bestAxis].matches) bestAxis = 2;

  const axisNames = ['X', 'Y', 'Z'];
  return {
    map: results[bestAxis].map,
    centerX: results[bestAxis].center,
    axis: axisNames[bestAxis],
    matched: results[bestAxis].matches,
    total: nTri
  };
}
