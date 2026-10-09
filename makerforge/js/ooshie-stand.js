/**
 * Ooshies display stand — multi-tier peg rack kit.
 *
 * Sized from a reference STL scaled so pegs = Ø6.5 mm → ~218 × 93 × 244 mm.
 * Visual target: photo of the blue dual-tone stand (deep base tongue, tall side
 * pills, stepped top, 5 pegs/shelf).
 *
 * Join: shelf end tabs press into rectangular slots in the side panels
 * (~0.25 mm fit). Seat shelves in one side, then press the other side on.
 *
 * Assembled pose: Z-up, centered on X, rear at +Y. Export = flat kit parts.
 */
import { extrudeShapeGroupBetween } from "./contour.js?v=241";

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

function cleanRing(pts, eps = 0.02) {
  const out = [];
  for (const pt of pts) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(pt[0] - last[0], pt[1] - last[1]) > eps) out.push([pt[0], pt[1]]);
  }
  while (
    out.length > 3
    && Math.hypot(out[0][0] - out[out.length - 1][0], out[0][1] - out[out.length - 1][1]) <= eps
  ) {
    out.pop();
  }
  return out;
}

function ringArea(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    a += pts[i][0] * pts[j][1] - pts[j][0] * pts[i][1];
  }
  return a * 0.5;
}

function ensureCCW(pts) {
  const ring = cleanRing(pts);
  return ringArea(ring) < 0 ? ring.slice().reverse() : ring;
}

function pushTri(outPos, outIdx, a, b, c) {
  const base = outPos.length / 3;
  outPos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
  outIdx.push(base, base + 1, base + 2);
}

function pushQuad(outPos, outIdx, a, b, c, d) {
  pushTri(outPos, outIdx, a, b, c);
  pushTri(outPos, outIdx, a, c, d);
}

function appendSolidBox(outPos, outIdx, x0, y0, z0, x1, y1, z1) {
  const xmin = Math.min(x0, x1);
  const xmax = Math.max(x0, x1);
  const ymin = Math.min(y0, y1);
  const ymax = Math.max(y0, y1);
  const zmin = Math.min(z0, z1);
  const zmax = Math.max(z0, z1);
  const c = [
    [xmin, ymin, zmin], [xmax, ymin, zmin], [xmax, ymax, zmin], [xmin, ymax, zmin],
    [xmin, ymin, zmax], [xmax, ymin, zmax], [xmax, ymax, zmax], [xmin, ymax, zmax],
  ];
  pushQuad(outPos, outIdx, c[0], c[2], c[1], c[3]);
  pushQuad(outPos, outIdx, c[4], c[5], c[6], c[7]);
  pushQuad(outPos, outIdx, c[0], c[1], c[5], c[4]);
  pushQuad(outPos, outIdx, c[3], c[7], c[6], c[2]);
  pushQuad(outPos, outIdx, c[0], c[4], c[7], c[3]);
  pushQuad(outPos, outIdx, c[1], c[2], c[6], c[5]);
}

function appendPeg(outPos, outIdx, cx, cy, z0, radius, height, seg = 22) {
  const z1 = z0 + height;
  const bot = [];
  const top = [];
  for (let i = 0; i < seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    const x = cx + radius * Math.cos(a);
    const y = cy + radius * Math.sin(a);
    bot.push([x, y, z0]);
    top.push([x, y, z1]);
  }
  for (let i = 0; i < seg; i++) {
    const j = (i + 1) % seg;
    pushQuad(outPos, outIdx, bot[i], bot[j], top[j], top[i]);
  }
  for (let i = 1; i < seg - 1; i++) {
    pushTri(outPos, outIdx, bot[0], bot[i + 1], bot[i]);
    pushTri(outPos, outIdx, top[0], top[i], top[i + 1]);
  }
}

function translateMesh(mesh, dx, dy, dz) {
  const P = mesh.positions;
  for (let i = 0; i < P.length; i += 3) {
    P[i] += dx;
    P[i + 1] += dy;
    P[i + 2] += dz;
  }
  return mesh;
}

function appendMesh(dst, src) {
  const base = dst.positions.length / 3;
  dst.positions.push(...src.positions);
  for (const i of src.indices) dst.indices.push(base + i);
}

function cloneMesh(mesh) {
  return { positions: mesh.positions.slice(), indices: mesh.indices.slice() };
}

/** Rounded rect in XY, CCW. */
function roundedRectXy(x0, y0, x1, y1, r, seg = 8) {
  const xmin = Math.min(x0, x1);
  const xmax = Math.max(x0, x1);
  const ymin = Math.min(y0, y1);
  const ymax = Math.max(y0, y1);
  const rr = Math.max(0, Math.min(r, (xmax - xmin) * 0.45, (ymax - ymin) * 0.45));
  if (rr < 0.05) return ensureCCW([[xmin, ymin], [xmax, ymin], [xmax, ymax], [xmin, ymax]]);
  const pts = [];
  const corners = [
    [xmax - rr, ymin + rr, -Math.PI / 2],
    [xmax - rr, ymax - rr, 0],
    [xmin + rr, ymax - rr, Math.PI / 2],
    [xmin + rr, ymin + rr, Math.PI],
  ];
  for (const [cx, cy, a0] of corners) {
    for (let i = 0; i <= seg; i++) {
      const a = a0 + (Math.PI / 2) * (i / seg);
      pts.push([cx + rr * Math.cos(a), cy + rr * Math.sin(a)]);
    }
  }
  return ensureCCW(pts);
}

/** Extrude an XY outline from z0→z1. */
function extrudeXy(outPos, outIdx, outer, holes, z0, z1) {
  const group = {
    outer: ensureCCW(outer),
    holes: (holes || []).map((h) => ensureCCW(h).slice().reverse()),
  };
  const mapTop = (x, y) => [x, y, z1];
  const mapBot = (x, y) => [x, y, z0];
  extrudeShapeGroupBetween(outPos, outIdx, group, mapTop, mapBot, (w) => [w[0], w[1]], "both", null);
}

/**
 * Reference (peg Ø6.5 mm scale): ~218 W × 93 D × 244 H.
 * Clearance ~28 mm matches that height with 7 upper shelves; raise for 45–50 mm figures.
 */
export const OOSHIE_DEFAULTS = {
  ooshiePegDia: 6.5,
  ooshiePegHeight: 10,
  ooshiePegsPerShelf: 5,
  ooshiePitch: 41,
  ooshieUpperShelves: 7,
  ooshieShelfThick: 5,
  ooshieShelfDepth: 30,
  ooshieClearance: 28,
  ooshieSideThick: 5.5,
  ooshieFitClearance: 0.25,
  ooshieSideMargin: 22,
  ooshieBaseExtraDepth: 63,
  ooshieBaseFrontPegs: 3,
  ooshieCornerR: 4,
  ooshieCutouts: true,
  ooshieTabInset: 2,
};

export function resolveOoshieDims(params = {}) {
  const pegDia = clamp(Number(params.ooshiePegDia) || OOSHIE_DEFAULTS.ooshiePegDia, 3, 12);
  const pegH = clamp(Number(params.ooshiePegHeight) || OOSHIE_DEFAULTS.ooshiePegHeight, 4, 20);
  const pegs = clamp(Math.round(Number(params.ooshiePegsPerShelf) || OOSHIE_DEFAULTS.ooshiePegsPerShelf), 2, 10);
  const pitch = clamp(Number(params.ooshiePitch) || OOSHIE_DEFAULTS.ooshiePitch, pegDia + 4, 60);
  const upper = clamp(Math.round(Number(params.ooshieUpperShelves) || OOSHIE_DEFAULTS.ooshieUpperShelves), 1, 10);
  const shelfT = clamp(Number(params.ooshieShelfThick) || OOSHIE_DEFAULTS.ooshieShelfThick, 2.4, 10);
  const shelfD = clamp(Number(params.ooshieShelfDepth) || OOSHIE_DEFAULTS.ooshieShelfDepth, pegDia + 6, 50);
  const clear = clamp(Number(params.ooshieClearance) || OOSHIE_DEFAULTS.ooshieClearance, 22, 80);
  const sideT = clamp(Number(params.ooshieSideThick) || OOSHIE_DEFAULTS.ooshieSideThick, 2.4, 12);
  const fit = clamp(Number(params.ooshieFitClearance) || OOSHIE_DEFAULTS.ooshieFitClearance, 0.1, 0.6);
  const margin = clamp(Number(params.ooshieSideMargin) || OOSHIE_DEFAULTS.ooshieSideMargin, pegDia, 40);
  const baseExtra = clamp(Number(params.ooshieBaseExtraDepth) || OOSHIE_DEFAULTS.ooshieBaseExtraDepth, 10, 90);
  const baseFrontPegs = clamp(Math.round(Number(params.ooshieBaseFrontPegs) || OOSHIE_DEFAULTS.ooshieBaseFrontPegs), 0, 5);
  const cornerR = clamp(Number(params.ooshieCornerR) || OOSHIE_DEFAULTS.ooshieCornerR, 0, 14);
  const cutouts = params.ooshieCutouts !== false;
  const tabInset = clamp(Number(params.ooshieTabInset) || OOSHIE_DEFAULTS.ooshieTabInset, 0.4, 6);

  const shelfW = (pegs - 1) * pitch + 2 * margin;
  const tabLen = Math.max(2.4, sideT - 0.4);
  const tabDepth = Math.max(pegDia + 3, shelfD - 2 * tabInset);
  const slotH = shelfT + 2 * fit;
  const slotD = tabDepth + 2 * fit;

  const shelfCount = upper + 1;
  const shelfZs = [];
  let z = 0;
  for (let i = 0; i < shelfCount; i++) {
    shelfZs.push(z);
    z += shelfT + clear;
  }
  const totalH = shelfZs[shelfZs.length - 1] + shelfT + pegH + 3;
  const baseDepth = shelfD + baseExtra;
  const sideDepth = baseDepth;
  const overallW = shelfW + 2 * sideT;
  // Rear face of the stand (all shelves align here)
  const yRear = sideDepth / 2;

  return {
    pegDia,
    pegR: pegDia / 2,
    pegH,
    pegs,
    pitch,
    upper,
    shelfT,
    shelfD,
    clear,
    sideT,
    fit,
    margin,
    baseExtra,
    baseFrontPegs,
    cornerR,
    cutouts,
    tabInset,
    shelfW,
    tabLen,
    tabDepth,
    slotH,
    slotD,
    shelfCount,
    shelfZs,
    totalH,
    baseDepth,
    sideDepth,
    overallW,
    yRear,
  };
}

function pegXs(d) {
  const xs = [];
  const start = -((d.pegs - 1) * d.pitch) / 2;
  for (let i = 0; i < d.pegs; i++) xs.push(start + i * d.pitch);
  return xs;
}

/**
 * Shelf / base. Rear-aligned to yRear so upper shelves sit over the back of the
 * deep base (photo: shallow shelves, base tongue sticks forward).
 */
function buildShelfMesh(d, { z, depth, isBase }) {
  const positions = [];
  const indices = [];
  const halfW = d.shelfW / 2;
  const yRear = d.yRear;
  const yFront = yRear - depth;
  const z1 = z + d.shelfT;
  const r = Math.min(d.cornerR, depth * 0.35, halfW * 0.2);

  if (isBase) {
    // Main deck + front tongue (rounded) like the photo
    const tongueW = Math.min(d.shelfW * 0.55, d.pitch * 2.4 + d.pegDia * 2);
    const tongueHalf = tongueW / 2;
    const tongueDepth = Math.min(d.baseExtra * 0.72, depth * 0.45);
    const yTongue = yFront;
    const yMainFront = yFront + tongueDepth;

    // Rear main rectangle (full width)
    extrudeXy(
      positions,
      indices,
      roundedRectXy(-halfW, yMainFront, halfW, yRear, r),
      [],
      z,
      z1,
    );
    // Front tongue, centered
    extrudeXy(
      positions,
      indices,
      roundedRectXy(-tongueHalf, yTongue, tongueHalf, yMainFront + 0.4, Math.min(r + 2, tongueDepth * 0.45)),
      [],
      z,
      z1,
    );
  } else {
    extrudeXy(
      positions,
      indices,
      roundedRectXy(-halfW, yFront, halfW, yRear, r),
      [],
      z,
      z1,
    );
  }

  // End tabs — centered on the upper-shelf depth band (same Y for all levels)
  const tabYMid = yRear - d.shelfD / 2;
  const tabHalfD = d.tabDepth / 2;
  const tabY0 = tabYMid - tabHalfD;
  const tabY1 = tabYMid + tabHalfD;
  const tabZ0 = z + d.fit;
  const tabZ1 = z1 - d.fit;
  appendSolidBox(positions, indices, -halfW - d.tabLen, tabY0, tabZ0, -halfW, tabY1, tabZ1);
  appendSolidBox(positions, indices, halfW, tabY0, tabZ0, halfW + d.tabLen, tabY1, tabZ1);

  // Pegs — main row along shelf centreline
  const xs = pegXs(d);
  const pegY = tabYMid;
  for (const x of xs) {
    appendPeg(positions, indices, x, pegY, z1, d.pegR * 0.98, d.pegH);
  }
  if (isBase && d.baseFrontPegs > 0) {
    const frontY = yFront + Math.max(d.pegDia * 1.1, d.baseExtra * 0.28);
    if (d.baseFrontPegs === 1) {
      appendPeg(positions, indices, 0, frontY, z1, d.pegR * 0.98, d.pegH);
    } else {
      const span = Math.min(d.pitch * (d.baseFrontPegs - 1), d.shelfW * 0.4);
      const x0 = -span / 2;
      for (let i = 0; i < d.baseFrontPegs; i++) {
        const x = x0 + (span * i) / Math.max(1, d.baseFrontPegs - 1);
        appendPeg(positions, indices, x, frontY, z1, d.pegR * 0.98, d.pegH);
      }
    }
  }

  return { positions, indices };
}

/** Vertical stadium hole in YZ ([y,z]). */
function pillHoleYz(cy, cz, ry, rz, seg = 18) {
  const pts = [];
  const straight = Math.max(0, rz - ry);
  for (let i = 0; i <= seg; i++) {
    const a = -Math.PI / 2 + Math.PI * (i / seg);
    pts.push([cy + ry * Math.cos(a), cz - straight + ry * Math.sin(a)]);
  }
  for (let i = 0; i <= seg; i++) {
    const a = Math.PI / 2 + Math.PI * (i / seg);
    pts.push([cy + ry * Math.cos(a), cz + straight + ry * Math.sin(a)]);
  }
  return pts;
}

/**
 * Side panel: thickness along +X, plate in YZ.
 * Big vertical pill cutouts + stepped top like the photo.
 */
function buildSidePanelLocal(d) {
  const positions = [];
  const indices = [];
  const yFront = -d.sideDepth / 2;
  const yBack = d.sideDepth / 2;
  const zTop = d.totalH;
  const step = Math.min(10, d.sideDepth * 0.14);
  const corner = Math.min(6, d.sideDepth * 0.08);

  // Outer with rounded bottom corners + stepped top (front lower)
  const outer = [];
  // bottom-front → up front → step → back → down → bottom-back → round to front
  outer.push([yFront + corner, 0]);
  outer.push([yFront, corner]);
  outer.push([yFront, zTop - step * 0.15]);
  outer.push([yFront + step * 0.35, zTop]);
  outer.push([yFront + step, zTop]);
  outer.push([yFront + step, zTop - step * 0.55]);
  outer.push([yBack - corner, zTop - step * 0.55]);
  outer.push([yBack, zTop - step * 0.55 - corner]);
  outer.push([yBack, corner]);
  outer.push([yBack - corner, 0]);

  const holes = [];
  // Tab slots — Y centred on upper-shelf band
  const tabYMid = d.yRear - d.shelfD / 2;
  const slotHalfD = d.slotD / 2;
  for (let i = 0; i < d.shelfCount; i++) {
    const z0 = d.shelfZs[i] + d.fit;
    const z1 = z0 + d.slotH;
    const y0 = tabYMid - slotHalfD;
    const y1 = tabYMid + slotHalfD;
    if (y1 <= y0 + 3 || z1 <= z0 + 2) continue;
    holes.push(ensureCCW([
      [y0, z0],
      [y1, z0],
      [y1, z1],
      [y0, z1],
    ]).slice().reverse());
  }

  if (d.cutouts) {
    // 3 tall pills stacked in the front-middle of the side (photo)
    const pillRy = Math.min(11, d.sideDepth * 0.16);
    const pillRz = Math.min(36, (zTop - 24) / 3.6);
    const cy = yFront + d.sideDepth * 0.38;
    const gap = pillRz * 2 + 8;
    const z0 = 16 + pillRz;
    for (let k = 0; k < 3; k++) {
      const cz = z0 + k * gap;
      if (cz + pillRz > zTop - 14) break;
      holes.push(ensureCCW(pillHoleYz(cy, cz, pillRy, pillRz)).slice().reverse());
    }
  }

  const group = { outer: ensureCCW(outer), holes };
  extrudeShapeGroupBetween(
    positions,
    indices,
    group,
    (y, z) => [d.sideT, y, z],
    (y, z) => [0, y, z],
    (w) => [w[1], w[2]],
    "both",
    null,
  );
  return { positions, indices };
}

function buildAssembled(d) {
  const positions = [];
  const indices = [];
  const halfW = d.shelfW / 2;

  for (let i = 0; i < d.shelfCount; i++) {
    const isBase = i === 0;
    const depth = isBase ? d.baseDepth : d.shelfD;
    appendMesh({ positions, indices }, buildShelfMesh(d, { z: d.shelfZs[i], depth, isBase }));
  }

  const left = buildSidePanelLocal(d);
  translateMesh(left, -halfW - d.sideT, 0, 0);
  appendMesh({ positions, indices }, left);

  const right = buildSidePanelLocal(d);
  const RP = right.positions;
  for (let i = 0; i < RP.length; i += 3) RP[i] = d.sideT - RP[i];
  translateMesh(right, halfW, 0, 0);
  appendMesh({ positions, indices }, right);

  return { positions, indices };
}

function flattenSideForPrint(sideMesh) {
  const m = cloneMesh(sideMesh);
  const P = m.positions;
  for (let i = 0; i < P.length; i += 3) {
    const x = P[i];
    const y = P[i + 1];
    const z = P[i + 2];
    P[i] = y;
    P[i + 1] = z;
    P[i + 2] = x;
  }
  let zmin = Infinity;
  let xmin = Infinity;
  let xmax = -Infinity;
  let ymin = Infinity;
  let ymax = -Infinity;
  for (let i = 0; i < P.length; i += 3) {
    xmin = Math.min(xmin, P[i]);
    xmax = Math.max(xmax, P[i]);
    ymin = Math.min(ymin, P[i + 1]);
    ymax = Math.max(ymax, P[i + 1]);
    zmin = Math.min(zmin, P[i + 2]);
  }
  const cx = (xmin + xmax) / 2;
  const cy = (ymin + ymax) / 2;
  for (let i = 0; i < P.length; i += 3) {
    P[i] -= cx;
    P[i + 1] -= cy;
    P[i + 2] -= zmin;
  }
  return m;
}

function flattenShelfForPrint(shelfMesh) {
  const m = cloneMesh(shelfMesh);
  const P = m.positions;
  let zmin = Infinity;
  let xmin = Infinity;
  let xmax = -Infinity;
  let ymin = Infinity;
  let ymax = -Infinity;
  for (let i = 0; i < P.length; i += 3) {
    xmin = Math.min(xmin, P[i]);
    xmax = Math.max(xmax, P[i]);
    ymin = Math.min(ymin, P[i + 1]);
    ymax = Math.max(ymax, P[i + 1]);
    zmin = Math.min(zmin, P[i + 2]);
  }
  const cx = (xmin + xmax) / 2;
  const cy = (ymin + ymax) / 2;
  for (let i = 0; i < P.length; i += 3) {
    P[i] -= cx;
    P[i + 1] -= cy;
    P[i + 2] -= zmin;
  }
  return m;
}

export function ooshieMeta(params) {
  const d = resolveOoshieDims(params);
  return {
    shape: "ooshieStand",
    outer: { w: d.overallW, d: d.baseDepth, h: d.totalH },
    inner: { w: d.shelfW, d: d.shelfD, h: d.totalH },
    dims: d,
    label: "Ooshies stand",
  };
}

export function buildOoshieStand(params = {}) {
  const d = resolveOoshieDims(params);
  const assembled = buildAssembled(d);

  const parts = [];
  const leftLocal = buildSidePanelLocal(d);
  parts.push({ name: "Side L", mesh: flattenSideForPrint(leftLocal), role: "side" });
  const rightLocal = buildSidePanelLocal(d);
  const RP = rightLocal.positions;
  for (let i = 0; i < RP.length; i += 3) RP[i] = d.sideT - RP[i];
  parts.push({ name: "Side R", mesh: flattenSideForPrint(rightLocal), role: "side" });

  for (let i = 0; i < d.shelfCount; i++) {
    const isBase = i === 0;
    const depth = isBase ? d.baseDepth : d.shelfD;
    const shelf = buildShelfMesh(d, { z: 0, depth, isBase });
    parts.push({
      name: isBase ? "Base shelf" : `Shelf ${i}`,
      mesh: flattenShelfForPrint(shelf),
      role: isBase ? "base" : "shelf",
    });
  }

  return {
    positions: assembled.positions,
    indices: assembled.indices,
    shellMesh: assembled,
    meta: ooshieMeta(params),
    totalH: d.totalH,
    ooshieParts: parts,
    insertMesh: null,
    labelMesh: null,
    debossCutterMesh: null,
  };
}
