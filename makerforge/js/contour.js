/**
 * Binary mask → boundary polygons → extruded emboss mesh.
 */

import earcut from "https://esm.sh/earcut@2.2.4";

function perpDist(point, lineStart, lineEnd) {
  const dx = lineEnd[0] - lineStart[0];
  const dy = lineEnd[1] - lineStart[1];
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-12) return Math.hypot(point[0] - lineStart[0], point[1] - lineStart[1]);
  const t = ((point[0] - lineStart[0]) * dx + (point[1] - lineStart[1]) * dy) / len2;
  const px = lineStart[0] + t * dx;
  const py = lineStart[1] + t * dy;
  return Math.hypot(point[0] - px, point[1] - py);
}

export function simplifyPolygon(points, tolerance = 1.25) {
  if (points.length <= 3) return points.slice();
  const closed = points[0][0] === points[points.length - 1][0] && points[0][1] === points[points.length - 1][1];
  const ring = closed ? points.slice(0, -1) : points.slice();
  if (ring.length < 3) return points.slice();

  const keep = new Uint8Array(ring.length);
  keep[0] = 1;
  keep[ring.length - 1] = 1;

  const stack = [[0, ring.length - 1]];
  while (stack.length) {
    const [start, end] = stack.pop();
    if (end <= start + 1) continue;
    let maxDist = 0;
    let idx = -1;
    for (let i = start + 1; i < end; i++) {
      const d = perpDist(ring[i], ring[start], ring[end]);
      if (d > maxDist) {
        maxDist = d;
        idx = i;
      }
    }
    if (maxDist > tolerance && idx >= 0) {
      keep[idx] = 1;
      stack.push([start, idx], [idx, end]);
    }
  }

  const out = ring.filter((_, i) => keep[i]);
  if (out.length < 3) return points.slice();
  out.push(out[0]);
  return out;
}

export function strokePathIsClosed(path, eps = 0.05) {
  if (!path || path.length < 4) return false;
  const [x0, y0] = path[0];
  const [x1, y1] = path[path.length - 1];
  return Math.hypot(x0 - x1, y0 - y1) < eps;
}

/** Round pixel-staircase contours into smoother curves. Open polylines are not wrapped. */
export function chaikinSmooth(points, iterations = 2) {
  if (points.length < 4) return points.slice();
  const closed = strokePathIsClosed(points);
  let pts = closed ? points.slice(0, -1) : points.slice();
  for (let iter = 0; iter < iterations; iter++) {
    const next = [];
    const segCount = closed ? pts.length : pts.length - 1;
    for (let i = 0; i < segCount; i++) {
      const p0 = pts[i];
      const p1 = pts[closed ? (i + 1) % pts.length : i + 1];
      next.push(
        [0.75 * p0[0] + 0.25 * p1[0], 0.75 * p0[1] + 0.25 * p1[1]],
        [0.25 * p0[0] + 0.75 * p1[0], 0.25 * p0[1] + 0.75 * p1[1]],
      );
    }
    pts = next;
    if (pts.length > 1200) break;
  }
  if (!closed) return pts;
  pts.push(pts[0]);
  return pts;
}

/** Simplify pixel stairs, then round corners for print-friendly curves.
 * `smoothPasses` controls Chaikin iterations (1 = light, 2 = medium, 3 = extra smooth).
 */
export function prepareContourRing(poly, simplifyTol = 1, round = true, smoothPasses = 1) {
  let light = simplifyPolygon(poly, simplifyTol);
  if (light.length > 500) light = simplifyPolygon(light, simplifyTol * 1.6);
  if (light.length > 350) light = simplifyPolygon(light, simplifyTol * 2.2);
  const passes = Math.max(0, Math.min(6, smoothPasses));
  if (!round || passes === 0) return light;
  const budgetPts = light.length > 400 ? Math.min(passes, 4) : passes;
  const smooth = chaikinSmooth(light, budgetPts);
  const budget = budgetPts >= 5 ? 1800 : budgetPts >= 4 ? 1400 : budgetPts >= 3 ? 900 : budgetPts >= 2 ? 560 : 320;
  if (smooth.length > budget) return simplifyPolygon(smooth, simplifyTol * 0.22);
  return smooth;
}

export function prepareShapeGroups(groups, simplifyTol = 1, smoothPasses = 1) {
  const holePasses = smoothPasses >= 2 ? Math.max(1, smoothPasses - 1) : 0;
  return groups.map(({ outer, holes }) => ({
    outer: prepareContourRing(outer, simplifyTol, true, smoothPasses),
    holes: holes.map((hole) => prepareContourRing(hole, simplifyTol * 0.5, holePasses > 0, holePasses)),
  }));
}

/** Native SVG vectors — keep curve detail; avoid trace-style pixel stair smoothing. */
function prepareSvgContourRing(poly, simplifyTol, smoothPasses = 1) {
  let light = simplifyPolygon(poly, simplifyTol);
  if (light.length > 2800) light = simplifyPolygon(light, simplifyTol * 1.35);
  const passes = Math.max(0, Math.min(3, smoothPasses));
  if (passes === 0) return light;
  const smooth = chaikinSmooth(light, passes);
  const budget = passes >= 2 ? 3600 : 2800;
  if (smooth.length > budget) return simplifyPolygon(smooth, simplifyTol * 0.12);
  return smooth;
}

export function prepareSvgShapeGroups(groups, simplifyTol, smoothPasses = 1) {
  const holePasses = smoothPasses >= 2 ? Math.max(1, smoothPasses - 1) : 0;
  return groups.map(({ outer, holes }) => ({
    outer: prepareSvgContourRing(outer, simplifyTol, smoothPasses),
    holes: holes.map((hole) => prepareSvgContourRing(hole, simplifyTol * 0.45, holePasses)),
  }));
}

function ringArea(ring) {
  let area = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    area += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  }
  return area / 2;
}

function ringCentroid(ring) {
  const pts = ring.slice(0, -1);
  let x = 0;
  let y = 0;
  for (const p of pts) {
    x += p[0];
    y += p[1];
  }
  return [x / pts.length, y / pts.length];
}

function pointInRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 2; i < ring.length - 1; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const hit = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-12) + xi;
    if (hit) inside = !inside;
  }
  return inside;
}

/** Group boundary loops into outers with nested holes (donut-safe). */
export function groupPolygonsWithHoles(polygons) {
  const loops = polygons
    .filter((p) => p.length >= 4)
    .map((ring) => ({
      ring,
      area: Math.abs(ringArea(ring)),
      center: ringCentroid(ring),
    }))
    .sort((a, b) => b.area - a.area);

  const used = new Uint8Array(loops.length);
  const groups = [];

  for (let i = 0; i < loops.length; i++) {
    if (used[i]) continue;
    const outer = loops[i];
    used[i] = 1;
    const holes = [];

    for (let j = i + 1; j < loops.length; j++) {
      if (used[j]) continue;
      const candidate = loops[j];
      if (!pointInRing(candidate.center[0], candidate.center[1], outer.ring)) continue;

      const nestedInHole = holes.some((hole) => pointInRing(candidate.center[0], candidate.center[1], hole));
      if (nestedInHole) continue;

      holes.push(candidate.ring);
      used[j] = 1;
    }

    groups.push({ outer: outer.ring, holes });
  }

  return groups;
}

/** Trace outer boundaries of filled cells as closed corner loops. */
export function maskToPolygons(mask, width, height) {
  const edgeSet = new Set();
  const edgeKey = (x1, y1, x2, y2) => `${x1},${y1},${x2},${y2}`;
  const addEdge = (x1, y1, x2, y2) => edgeSet.add(edgeKey(x1, y1, x2, y2));

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!mask[y * width + x]) continue;
      if (x === 0 || !mask[y * width + x - 1]) addEdge(x, y + 1, x, y);
      if (x === width - 1 || !mask[y * width + x + 1]) addEdge(x + 1, y, x + 1, y + 1);
      if (y === 0 || !mask[(y - 1) * width + x]) addEdge(x, y, x + 1, y);
      if (y === height - 1 || !mask[(y + 1) * width + x]) addEdge(x + 1, y + 1, x, y + 1);
    }
  }

  const nextFrom = new Map();
  for (const e of edgeSet) {
    const [x1, y1, x2, y2] = e.split(",").map(Number);
    const from = `${x1},${y1}`;
    const list = nextFrom.get(from) || [];
    list.push([x2, y2, e]);
    nextFrom.set(from, list);
  }

  const polygons = [];
  while (edgeSet.size) {
    const first = edgeSet.values().next().value;
    edgeSet.delete(first);
    const [sx, sy, cx, cy] = first.split(",").map(Number);
    const loop = [[sx, sy]];
    let px = cx;
    let py = cy;
    let guard = 0;
    while (guard++ < width * height * 8) {
      loop.push([px, py]);
      if (px === sx && py === sy) break;
      const from = `${px},${py}`;
      const outs = nextFrom.get(from);
      if (!outs?.length) break;
      const pick = outs.find(([, , key]) => edgeSet.has(key)) || outs[0];
      const [nx, ny, key] = pick;
      edgeSet.delete(key);
      const remain = outs.filter((item) => item[2] !== key);
      if (remain.length) nextFrom.set(from, remain);
      else nextFrom.delete(from);
      px = nx;
      py = ny;
    }
    if (loop.length >= 4) polygons.push(loop);
  }

  return polygons;
}

/** Expand a binary mask by one 3×3 neighbourhood per pass. */
export function dilateMask(mask, width, height, passes = 1) {
  let work = mask instanceof Uint8Array ? mask : new Uint8Array(mask);
  for (let pass = 0; pass < passes; pass++) {
    const out = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let on = 0;
        for (let dy = -1; dy <= 1 && !on; dy++) {
          for (let dx = -1; dx <= 1 && !on; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx >= 0 && ny >= 0 && nx < width && ny < height && work[ny * width + nx]) on = 1;
          }
        }
        out[y * width + x] = on;
      }
    }
    work = out;
  }
  return work;
}

function pointInShapeGroup(x, y, group) {
  if (!pointInRing(x, y, group.outer)) return false;
  for (const hole of group.holes) {
    if (hole.length >= 3 && pointInRing(x, y, hole)) return false;
  }
  return true;
}

function ringPointsForRaster(ring) {
  if (!ring?.length) return [];
  const closed =
    ring.length > 1 &&
    ring[0][0] === ring[ring.length - 1][0] &&
    ring[0][1] === ring[ring.length - 1][1];
  return closed ? ring.slice(0, -1) : ring.slice();
}

function scaleShapeGroups(groups, scale) {
  if (!scale || scale === 1) return groups;
  return groups.map((group) => ({
    outer: group.outer.map(([x, y]) => [x * scale, y * scale]),
    holes: group.holes.map((hole) => hole.map(([x, y]) => [x * scale, y * scale])),
  }));
}

/** Flatten outer + hole groups into one ink mask (even-odd). Uses canvas — not O(pixels×groups). */
export function rasterizeShapeGroupsToMask(groups, width, height) {
  const mask = new Uint8Array(width * height);
  if (!groups?.length || width <= 0 || height <= 0) return mask;

  if (typeof document !== "undefined") {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (ctx) {
      ctx.fillStyle = "#000";
      for (const { outer, holes } of groups) {
        ctx.beginPath();
        const addRing = (ring) => {
          const pts = ringPointsForRaster(ring);
          if (pts.length < 3) return;
          ctx.moveTo(pts[0][0], pts[0][1]);
          for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
          ctx.closePath();
        };
        addRing(outer);
        for (const hole of holes) addRing(hole);
        ctx.fill("evenodd");
      }
      const data = ctx.getImageData(0, 0, width, height).data;
      for (let i = 0; i < width * height; i++) {
        if (data[i * 4 + 3] > 64) mask[i] = 1;
      }
      return mask;
    }
  }

  // Tiny masks only — full-res CPU fallback freezes the browser on traced art.
  if (width * height > 256 * 256) return mask;
  for (let y = 0; y < height; y++) {
    const py = y + 0.5;
    for (let x = 0; x < width; x++) {
      const px = x + 0.5;
      for (const group of groups) {
        if (pointInShapeGroup(px, py, group)) {
          mask[y * width + x] = 1;
          break;
        }
      }
    }
  }
  return mask;
}

/** Merge dense trace islands into one solid silhouette (closes layer-gap slivers). */
export function unionDenseEmbossShapeGroups(sourceGroups, maskW, maskH, {
  simplifyTol = 1,
  smoothPasses = 1,
  islandThreshold = 8,
} = {}) {
  if (!sourceGroups?.length || sourceGroups.length <= islandThreshold) {
    return { groups: sourceGroups, united: false };
  }
  const dilate = sourceGroups.length > 120
    ? 7
    : sourceGroups.length > 30
      ? 6
      : 5;
  const united = unionShapeGroupsToPrepared(sourceGroups, maskW, maskH, simplifyTol, smoothPasses, dilate);
  const groups = united.length ? united : sourceGroups;
  return { groups, united: !!united.length };
}

/** Fast low-res merge for live preview — one extrude instead of hundreds. */
export function previewMergeTraceShapeGroups(sourceGroups, maskW, maskH) {
  if (!sourceGroups?.length || sourceGroups.length <= 1) return sourceGroups;
  const simplifyTol = Math.max(0.22, maskW / 1800);
  const merged = unionShapeGroupsToPrepared(sourceGroups, maskW, maskH, simplifyTol, 0, 4, 256);
  return merged.length ? merged : sourceGroups;
}

/** Re-rasterize silhouette — drops spike wedges polygonise can bake into one outer ring. */
export function cleanTraceSilhouetteGroups(groups, maskW, maskH) {
  if (!groups?.length) return groups;
  const simplifyTol = Math.max(0.18, maskW / 2000);
  const cleaned = unionShapeGroupsToPrepared(groups, maskW, maskH, simplifyTol, 1, 2, 384);
  return cleaned.length ? cleaned : groups;
}

function ringSignedArea(ring) {
  let a = 0;
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const [x0, y0] = ring[i];
    const [x1, y1] = ring[(i + 1) % n];
    a += x0 * y1 - x1 * y0;
  }
  return a * 0.5;
}

/** Drop spike/trapezoid polygons from downscaled polygonise (blue wedge in trace preview). */
export function filterDegenerateShapeGroups(groups, maskW, maskH) {
  if (!groups?.length) return groups;
  const canvasArea = Math.max(1, maskW * maskH);
  const filtered = groups.filter((g) => {
    const outer = g.outer;
    if (!outer?.length || outer.length < 4) return false;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const [x, y] of outer) {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
    const bw = maxX - minX;
    const bh = maxY - minY;
    const bboxArea = bw * bh;
    const area = Math.abs(ringSignedArea(outer));
    if (area < 2) return false;
    if (bw > maskW * 0.28 && outer.length <= 7 && area < bboxArea * 0.2) return false;
    if (bboxArea > canvasArea * 0.2 && area < bboxArea * 0.08) return false;
    return true;
  });
  return filtered.length ? filtered : groups;
}

/** Union many trace polygons into one printable silhouette (avoids adjacent solid slivers). */
export function unionShapeGroupsToPrepared(groups, width, height, simplifyTol = 1, smoothPasses = 1, dilatePasses = 2, maxDim = 1024) {
  if (!groups?.length || width <= 0 || height <= 0) return [];
  const rasterScale = Math.min(1, maxDim / Math.max(width, height));
  const w = Math.max(1, Math.round(width * rasterScale));
  const h = Math.max(1, Math.round(height * rasterScale));
  const scaledGroups = scaleShapeGroups(groups, rasterScale);
  const tol = rasterScale < 1 ? simplifyTol * Math.max(0.35, rasterScale) : simplifyTol;
  let mask = rasterizeShapeGroupsToMask(scaledGroups, w, h);
  if (dilatePasses > 0) mask = dilateMask(mask, w, h, dilatePasses);
  const polys = maskToPolygons(mask, w, h);
  let prepared = prepareShapeGroups(groupPolygonsWithHoles(polys), tol, smoothPasses);
  // Polygonise runs in the downscaled raster — map back to caller pixel space.
  if (rasterScale < 1) {
    const inv = 1 / rasterScale;
    prepared = prepared.map((group) => ({
      outer: group.outer.map(([x, y]) => [x * inv, y * inv]),
      holes: group.holes.map((hole) => hole.map(([x, y]) => [x * inv, y * inv])),
    }));
  }
  return prepared;
}

/** Rasterise stroke centerlines into a solid binary mask (filled pens). */
export function rasterizeStrokePathsToMask(paths, width, height, strokeWidthPx = 2) {
  const mask = new Uint8Array(width * height);
  const radius = Math.max(1, strokeWidthPx * 0.5);
  const r2 = radius * radius;

  const stampDisc = (cx, cy) => {
    const ix0 = Math.max(0, Math.floor(cx - radius));
    const ix1 = Math.min(width - 1, Math.ceil(cx + radius));
    const iy0 = Math.max(0, Math.floor(cy - radius));
    const iy1 = Math.min(height - 1, Math.ceil(cy + radius));
    for (let py = iy0; py <= iy1; py++) {
      for (let px = ix0; px <= ix1; px++) {
        const dx = px - cx;
        const dy = py - cy;
        if (dx * dx + dy * dy <= r2) mask[py * width + px] = 1;
      }
    }
  };

  for (const path of paths) {
    if (!path || path.length < 2) continue;
    for (let i = 0; i < path.length - 1; i++) {
      const [x0, y0] = path[i];
      const [x1, y1] = path[i + 1];
      const dist = Math.hypot(x1 - x0, y1 - y0);
      const steps = Math.max(1, Math.ceil(dist));
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        stampDisc(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t);
      }
    }
  }
  return mask;
}

export function polygonsToSvg(groups, width, height) {
  if (!groups.length) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}"></svg>`;
  }
  const d = groups
    .map(({ outer, holes }) => {
      const parts = [outer, ...holes].map((poly) => {
        const pts = poly.map(([x, y]) => `${x.toFixed(2)} ${y.toFixed(2)}`).join(" L ");
        return `M ${pts} Z`;
      });
      return parts.join(" ");
    })
    .join(" ");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}"><path fill="#000" fill-rule="evenodd" d="${d}"/></svg>`;
}

/** Collect outer + hole perimeters as separate closed stroke loops. */
export function shapeGroupsToStrokePaths(groups) {
  const paths = [];
  for (const { outer, holes } of groups) {
    if (outer?.length >= 4) paths.push(outer);
    for (const hole of holes) {
      if (hole?.length >= 4) paths.push(hole);
    }
  }
  return paths;
}

/** Smooth boundary loops for line-art emboss / SVG export. */
export function prepareStrokePaths(paths, simplifyTol = 1, smoothPasses = 2) {
  const passes = Math.max(1, Math.min(6, smoothPasses));
  return paths.map((path) => prepareContourRing(path, simplifyTol, true, passes));
}

/** Stroke-based SVG (line art) matching professional trace converters. */
export function strokePathsToSvg(paths, width, height, strokeWidth = 1.5) {
  if (!paths.length) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}"></svg>`;
  }
  const d = paths
    .map((poly) => {
      const pts = poly.map(([x, y]) => `${x.toFixed(2)} ${y.toFixed(2)}`).join(" L ");
      const closed = strokePathIsClosed(poly, Math.max(1.5, strokeWidth * 0.5));
      return closed ? `M ${pts} Z` : `M ${pts}`;
    })
    .join(" ");
  const sw = strokeWidth.toFixed(2);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" fill="none" stroke="#000" stroke-width="${sw}" stroke-linejoin="round" stroke-linecap="round"><path d="${d}"/></svg>`;
}

function pushTri(outIdx, a, b, c) {
  outIdx.push(a, b, c);
}

function pushQuad(outIdx, a, b, c, d) {
  pushTri(outIdx, a, b, c);
  pushTri(outIdx, a, c, d);
}

function ringPoints(ring) {
  return ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]
    ? ring.slice(0, -1)
    : ring.slice();
}

/** Extrude one shape (outer + holes) as a single solid slab along Y (legacy front-face path). */
export function extrudeShapeGroup(outPos, outIdx, group, y0, y1, mapPoint) {
  const mapTop = (px, py) => {
    const w = mapPoint(px, py);
    return [w[0], y1, w[2]];
  };
  const mapBot = (px, py) => {
    const w = mapPoint(px, py);
    return [w[0], y0, w[2]];
  };
  extrudeShapeGroupBetween(outPos, outIdx, group, mapTop, mapBot, (w) => [w[0], w[2]]);
}

/** Triangulate a planar region (outer ring + optional holes) on a mapped 3D surface. */
export function triangulateMappedCap(outPos, outIdx, mapPoint, flatCoord, outerRing, holeRings, outward = true) {
  const outerPts = ringPoints(outerRing);
  if (outerPts.length < 3) return;

  const flat = [];
  const world = [];
  const holeIndices = [];

  for (const p of outerPts) {
    const w = mapPoint(p[0], p[1]);
    world.push(w);
    flat.push(...flatCoord(w));
  }
  holeIndices.push(outerPts.length);

  for (const hole of holeRings) {
    const hp = ringPoints(hole);
    if (hp.length < 3) continue;
    holeIndices.push(holeIndices[holeIndices.length - 1] + hp.length);
    for (const p of hp) {
      const w = mapPoint(p[0], p[1]);
      world.push(w);
      flat.push(...flatCoord(w));
    }
  }

  const tri = earcut(flat, holeIndices.length > 1 ? holeIndices.slice(0, -1) : null);
  if (!tri.length) return;

  const base = outPos.length / 3;
  for (const w of world) outPos.push(w[0], w[1], w[2]);

  for (let i = 0; i < tri.length; i += 3) {
    const a = base + tri[i];
    const b = base + tri[i + 1];
    const c = base + tri[i + 2];
    if (outward) pushTri(outIdx, a, b, c);
    else pushTri(outIdx, a, c, b);
  }
}

/** Extrude one shape (outer + holes) between two full 3D surface mappers.
 * `flatCoord(w)` projects a world point to 2D for earcut cap triangulation.
 * Pass `flatFromArt(px, py)` when world XY is not planar (profile wall wrap).
 * `caps`: "both" (default), "top", "bottom", or "none" — omit caps for manifold shell joins. */
export function extrudeShapeGroupBetween(outPos, outIdx, group, mapTop, mapBot, flatCoord, caps = "both", flatFromArt = null) {
  const outerPts = ringPoints(group.outer);
  if (outerPts.length < 3) return;

  const holeRings = group.holes.map(ringPoints).filter((h) => h.length >= 3);
  const flat = [];
  const topWorld = [];
  const botWorld = [];
  const holeIndices = [];

  const pushFlat = (p, w) => {
    flat.push(...(flatFromArt ? flatFromArt(p[0], p[1]) : flatCoord(w)));
  };

  for (const p of outerPts) {
    topWorld.push(mapTop(p[0], p[1]));
    botWorld.push(mapBot(p[0], p[1]));
    pushFlat(p, topWorld[topWorld.length - 1]);
  }
  holeIndices.push(outerPts.length);

  for (const hole of holeRings) {
    holeIndices.push(holeIndices[holeIndices.length - 1] + hole.length);
    for (const p of hole) {
      topWorld.push(mapTop(p[0], p[1]));
      botWorld.push(mapBot(p[0], p[1]));
      pushFlat(p, topWorld[topWorld.length - 1]);
    }
  }

  const tri = earcut(flat, holeIndices.length > 1 ? holeIndices.slice(0, -1) : null);
  if (!tri.length) return;

  const topBase = outPos.length / 3;
  for (const w of topWorld) outPos.push(w[0], w[1], w[2]);
  const botBase = outPos.length / 3;
  for (const w of botWorld) outPos.push(w[0], w[1], w[2]);

  if (caps === "both" || caps === "top") {
    for (let i = 0; i < tri.length; i += 3) {
      pushTri(outIdx, topBase + tri[i], topBase + tri[i + 1], topBase + tri[i + 2]);
    }
  }
  if (caps === "both" || caps === "bottom") {
    for (let i = 0; i < tri.length; i += 3) {
      pushTri(outIdx, botBase + tri[i + 2], botBase + tri[i + 1], botBase + tri[i]);
    }
  }

  let vertOffset = 0;
  const wallRings = [outerPts, ...holeRings];
  for (const ring of wallRings) {
    const n = ring.length;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      pushQuad(outIdx, botBase + vertOffset + i, botBase + vertOffset + j, topBase + vertOffset + j, topBase + vertOffset + i);
    }
    vertOffset += n;
  }
}
