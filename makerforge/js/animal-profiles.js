/**
 * Silhouette animal container profiles (experimental — b382).
 *
 * Each animal is a union of primitive shapes (discs, ellipses, triangles, rounded
 * boxes) rasterised to a mask; the boundary is extracted with the same maskToPolygons
 * the trace engine uses — one clean simple closed polygon for the standard
 * profile -> container pipeline.
 *
 * Front-facing HEAD silhouettes, distinguished by ear shape:
 *   cat   = tall pointed triangle ears
 *   bear  = small round ears
 *   bunny = long upright ears
 *   dog   = floppy ears down the sides + snout
 * Deliberately chunky so offsetProfileInward(outer, wall) never self-intersects.
 */
import { maskToPolygons, simplifyPolygon } from "./contour.js?v=241";

const GRID = 300;

function fillDisc(m, w, h, cx, cy, r) {
  const r2 = r * r;
  for (let y = Math.max(0, (cy - r) | 0); y < Math.min(h, Math.ceil(cy + r)); y++)
    for (let x = Math.max(0, (cx - r) | 0); x < Math.min(w, Math.ceil(cx + r)); x++) {
      const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
      if (dx * dx + dy * dy <= r2) m[y * w + x] = 1;
    }
}

function fillEllipse(m, w, h, cx, cy, rx, ry, rot = 0) {
  const cs = Math.cos(-rot), sn = Math.sin(-rot);
  const R = Math.max(rx, ry);
  for (let y = Math.max(0, (cy - R) | 0); y < Math.min(h, Math.ceil(cy + R)); y++)
    for (let x = Math.max(0, (cx - R) | 0); x < Math.min(w, Math.ceil(cx + R)); x++) {
      const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
      const u = (dx * cs - dy * sn) / rx, v = (dx * sn + dy * cs) / ry;
      if (u * u + v * v <= 1) m[y * w + x] = 1;
    }
}

function fillTri(m, w, h, ax, ay, bx, by, cx, cy) {
  const minX = Math.max(0, Math.floor(Math.min(ax, bx, cx)));
  const maxX = Math.min(w, Math.ceil(Math.max(ax, bx, cx)));
  const minY = Math.max(0, Math.floor(Math.min(ay, by, cy)));
  const maxY = Math.min(h, Math.ceil(Math.max(ay, by, cy)));
  const d = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
  if (Math.abs(d) < 1e-9) return;
  for (let y = minY; y < maxY; y++)
    for (let x = minX; x < maxX; x++) {
      const px = x + 0.5, py = y + 0.5;
      const a = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / d;
      const b = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / d;
      const c = 1 - a - b;
      if (a >= 0 && b >= 0 && c >= 0) m[y * w + x] = 1;
    }
}

// Recipes in pixel space (y-up handled at the end). S = grid size.
const ANIMALS = {
  cat: (m, S) => {
    // pointed ears (triangles) behind a round head + cheek flare
    fillTri(m, S, S, 0.20 * S, 0.55 * S, 0.44 * S, 0.60 * S, 0.26 * S, 0.95 * S); // L ear
    fillTri(m, S, S, 0.80 * S, 0.55 * S, 0.56 * S, 0.60 * S, 0.74 * S, 0.95 * S); // R ear
    fillDisc(m, S, S, 0.50 * S, 0.46 * S, 0.32 * S);                              // head
    fillEllipse(m, S, S, 0.50 * S, 0.30 * S, 0.34 * S, 0.24 * S);                 // cheeks/jaw
  },
  bear: (m, S) => {
    fillDisc(m, S, S, 0.31 * S, 0.80 * S, 0.13 * S); // round ear L
    fillDisc(m, S, S, 0.69 * S, 0.80 * S, 0.13 * S); // round ear R
    fillDisc(m, S, S, 0.50 * S, 0.50 * S, 0.36 * S); // big head
    fillEllipse(m, S, S, 0.50 * S, 0.34 * S, 0.20 * S, 0.15 * S); // muzzle
  },
  bunny: (m, S) => {
    fillEllipse(m, S, S, 0.39 * S, 0.76 * S, 0.11 * S, 0.22 * S, 0.10); // long ear L
    fillEllipse(m, S, S, 0.61 * S, 0.76 * S, 0.11 * S, 0.22 * S, -0.10); // long ear R
    fillDisc(m, S, S, 0.50 * S, 0.42 * S, 0.30 * S);   // head
    fillEllipse(m, S, S, 0.50 * S, 0.26 * S, 0.24 * S, 0.16 * S); // cheeks
  },
  dog: (m, S) => {
    // floppy ears hanging down the sides, round head, muzzle bump at the chin
    fillEllipse(m, S, S, 0.26 * S, 0.60 * S, 0.11 * S, 0.20 * S, 0.55);  // floppy ear L
    fillEllipse(m, S, S, 0.74 * S, 0.60 * S, 0.11 * S, 0.20 * S, -0.55); // floppy ear R
    fillDisc(m, S, S, 0.50 * S, 0.62 * S, 0.28 * S);              // head
    fillEllipse(m, S, S, 0.50 * S, 0.34 * S, 0.19 * S, 0.17 * S); // muzzle
  },
};

export const ANIMAL_NAMES = Object.keys(ANIMALS);

/** Erode a binary mask by k px (chebyshev): a cell survives only if its k-neighbourhood is full. */
function erodeMask(mask, w, h, k) {
  let cur = mask;
  for (let pass = 0; pass < k; pass++) {
    const out = new Uint8Array(w * h);
    for (let y = 1; y < h - 1; y++)
      for (let x = 1; x < w - 1; x++) {
        if (cur[y * w + x] && cur[y * w + x - 1] && cur[y * w + x + 1] &&
            cur[(y - 1) * w + x] && cur[(y + 1) * w + x]) out[y * w + x] = 1;
      }
    cur = out;
  }
  return cur;
}

/** Build the recipe mask, flipped so ears point up. */
function animalMask(name) {
  const recipe = ANIMALS[name] || ANIMALS.cat;
  const raw = new Uint8Array(GRID * GRID);
  recipe(raw, GRID);
  const mask = new Uint8Array(GRID * GRID);
  for (let y = 0; y < GRID; y++)
    for (let x = 0; x < GRID; x++) mask[(GRID - 1 - y) * GRID + x] = raw[y * GRID + x];
  return mask;
}

/** Largest boundary loop of a mask -> simplified polygon in mask px space (image coords). */
function maskBoundary(mask, tol = 1.0) {
  const loops = maskToPolygons(mask, GRID, GRID);
  if (!loops.length) return null;
  let best = loops[0];
  for (const l of loops) if (l.length > best.length) best = l;
  let poly = simplifyPolygon(best, tol);
  if (poly.length > 3 && poly[0][0] === poly[poly.length - 1][0] && poly[0][1] === poly[poly.length - 1][1]) poly = poly.slice(0, -1);
  return poly.length >= 3 ? poly : null;
}

function scaleToMm(poly, sx, sy, cx, cy) {
  const pts = poly.map(([x, y]) => [(x - cx) * sx, -(y - cy) * sy]);
  let area = 0;
  for (let i = 0; i < pts.length; i++) { const j = (i + 1) % pts.length; area += pts[i][0] * pts[j][1] - pts[j][0] * pts[i][1]; }
  if (area < 0) pts.reverse();
  return pts;
}

/** Preview outline only (mm), for thumbnails / editors. */
export function animalProfile(name, targetW = 120, targetD = null) {
  const poly = maskBoundary(animalMask(name));
  if (!poly) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of poly) { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); }
  const spanX = maxX - minX || 1, spanY = maxY - minY || 1;
  const sx = targetW / spanX, sy = targetD != null ? targetD / spanY : sx;
  return scaleToMm(poly, sx, sy, (minX + maxX) / 2, (minY + maxY) / 2);
}

/**
 * Outer + inner wall profiles (mm) for a container. Inner is the boundary of the mask
 * ERODED by the wall thickness — guaranteed simple and strictly inside the outer, so the
 * shell is watertight even where offsetProfileInward would self-intersect (sharp ear valleys).
 */
export function animalProfilePair(name, outerW, outerD, wallMm) {
  const full = animalMask(name);
  const outerPoly = maskBoundary(full);
  if (!outerPoly) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of outerPoly) { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); }
  const spanX = maxX - minX || 1, spanY = maxY - minY || 1;
  const sx = outerW / spanX, sy = (outerD != null ? outerD / spanY : sx);
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  const kx = Math.max(1, Math.round(wallMm / sx)); // erosion px along x
  const eroded = erodeMask(full, GRID, GRID, kx);
  const innerPoly = maskBoundary(eroded);
  if (!innerPoly) return null;
  return {
    outer: scaleToMm(outerPoly, sx, sy, cx, cy),
    inner: scaleToMm(innerPoly, sx, sy, cx, cy),
  };
}
