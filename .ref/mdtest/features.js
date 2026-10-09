/**
 * Accent bands, emboss, honeycomb stamp, stackable hex grid, mesh merge.
 */

import { extrudeShapeGroup, extrudeShapeGroupBetween, groupPolygonsWithHoles, maskToPolygons, prepareShapeGroups, prepareStrokePaths, simplifyPolygon, triangulateMappedCap } from "./contour.js";
import { decorPlacementOffsets, decorArtRect, rotateFacePoint, rotateShapeGroup } from "./decor.js";

export const EMBOSS_FONTS = [
  { id: "segoe-ui", label: "Segoe UI — Windows", family: '"Segoe UI Variable", "Segoe UI", system-ui, sans-serif', weight: 700 },
  { id: "calibri", label: "Calibri — Office", family: 'Calibri, "Segoe UI", Candara, sans-serif', weight: 700 },
  { id: "arial", label: "Arial — Windows sans", family: "Arial, Helvetica, sans-serif", weight: 700 },
  { id: "tahoma", label: "Tahoma — Windows UI", family: 'Tahoma, "Segoe UI", sans-serif', weight: 700 },
  { id: "verdana", label: "Verdana — readable", family: "Verdana, Geneva, sans-serif", weight: 700 },
  { id: "times", label: "Times New Roman — Office", family: '"Times New Roman", Times, serif', weight: 700 },
  { id: "georgia", label: "Georgia — serif", family: "Georgia, 'Times New Roman', serif", weight: 700 },
  { id: "cambria", label: "Cambria — Office serif", family: "Cambria, Georgia, serif", weight: 700 },
  { id: "impact", label: "Impact — poster", family: 'Impact, "Arial Black", sans-serif', weight: 400 },
  { id: "consolas", label: "Consolas — mono", family: 'Consolas, "Courier New", monospace', weight: 700 },
  { id: "courier", label: "Courier New — mono", family: '"Courier New", Courier, monospace', weight: 700 },
  { id: "inter", label: "Inter — clean sans", family: 'Inter, "Segoe UI", system-ui, sans-serif', weight: 700 },
  { id: "bebas", label: "Bebas Neue — label", family: '"Bebas Neue", Impact, sans-serif', weight: 400, google: "Bebas Neue" },
  { id: "anton", label: "Anton — display", family: 'Anton, Impact, sans-serif', weight: 400, google: "Anton" },
  { id: "oswald", label: "Oswald — condensed", family: 'Oswald, "Arial Narrow", sans-serif', weight: 700, google: "Oswald" },
  { id: "roboto", label: "Roboto — modern", family: "Roboto, Arial, sans-serif", weight: 700, google: "Roboto" },
  { id: "roboto-mono", label: "Roboto Mono — tech", family: '"Roboto Mono", "Courier New", monospace', weight: 700, google: "Roboto Mono" },
];

export function embossFontSpec(id) {
  return EMBOSS_FONTS.find((f) => f.id === id) || EMBOSS_FONTS[0];
}

export function embossFontStack(id, fontSizePx) {
  const f = embossFontSpec(id);
  return `${f.weight} ${fontSizePx}px ${f.family}`;
}

export async function ensureEmbossFontLoaded(id) {
  if (typeof document === "undefined" || !document.fonts) return;
  const f = embossFontSpec(id);
  if (!f.google) return;
  try {
    await document.fonts.load(embossFontStack(id, 96));
  } catch {
    /* fall back to system fonts */
  }
}

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

function vec3(x, y, z) {
  return [x, y, z];
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

export function mergeMeshes(...parts) {
  const positions = [];
  const indices = [];
  for (const part of parts) {
    if (!part?.positions?.length || !part?.indices?.length) continue;
    const offset = positions.length / 3;
    const partPos = part.positions;
    for (let i = 0; i < partPos.length; i++) positions.push(partPos[i]);
    for (const idx of part.indices) indices.push(idx + offset);
  }
  return { positions, indices };
}

export function rectFeatureBounds(meta) {
  const { inner, outer } = meta;
  return {
    ow2: outer.w / 2,
    od2: outer.d / 2,
    iw2: inner.w / 2,
    id2: inner.d / 2,
    outerW: outer.w,
    outerD: outer.d,
    innerW: inner.w,
    innerD: inner.d,
    totalH: outer.h,
    cavityH: inner.h,
    floor: outer.h - inner.h,
  };
}

function wallBand(outPos, outIdx, axis, wallCoord, t0, t1, z0, z1) {
  const a0 = axis === "y" ? vec3(t0, wallCoord, z0) : vec3(wallCoord, t0, z0);
  const a1 = axis === "y" ? vec3(t1, wallCoord, z0) : vec3(wallCoord, t1, z0);
  const a2 = axis === "y" ? vec3(t1, wallCoord, z1) : vec3(wallCoord, t1, z1);
  const a3 = axis === "y" ? vec3(t0, wallCoord, z1) : vec3(wallCoord, t0, z1);
  pushQuad(outPos, outIdx, a0, a1, a2, a3);
}

function profileIsValid(profile) {
  return Array.isArray(profile) && profile.length >= 3;
}

/** Nudge accent sleeve outside the body shell — stops preview z-fight (negligible on print). */
const ACCENT_SKIN_MM = 0.08;

function offsetProfileOutward(points, offset) {
  if (!offset || offset <= 0) return points;
  let cx = 0;
  let cy = 0;
  for (const [x, y] of points) {
    cx += x;
    cy += y;
  }
  cx /= points.length;
  cy /= points.length;
  return points.map(([x, y]) => {
    const dx = x - cx;
    const dy = y - cy;
    const len = Math.hypot(dx, dy) || 1;
    return [x + (dx / len) * offset, y + (dy / len) * offset];
  });
}

function frontProfileEdgeFilter(points, inset) {
  const maxY = Math.max(...points.map((p) => p[1]));
  const minX = Math.min(...points.map((p) => p[0]));
  const maxX = Math.max(...points.map((p) => p[0]));
  const x0 = minX + inset;
  const x1 = maxX - inset;
  const yTol = 0.35;
  return (a, b) => {
    const midX = (a[0] + b[0]) / 2;
    const midY = (a[1] + b[1]) / 2;
    return midY >= maxY - yTol && midX >= x0 && midX <= x1;
  };
}

export function buildAccentMesh(meta, params, outerProfile = null) {
  const face = params.accentFace || "rim";
  const b = rectFeatureBounds(meta);
  const bandH = Math.min(clamp(params.accentHeight ?? 4, 2, 80), b.totalH);
  const z1 = b.totalH;
  const z0 = z1 - bandH;
  const positions = [];
  const indices = [];
  const skin = ACCENT_SKIN_MM;
  const accentProfile = profileIsValid(outerProfile)
    ? offsetProfileOutward(outerProfile, skin)
    : null;

  if (accentProfile) {
    if (face === "rim") {
      extrudeWallsAlongZ(positions, indices, accentProfile, z0, z1);
    } else if (face === "front") {
      const inset = clamp(params.accentInset ?? 4, 2, Math.min(b.outerW, b.outerD) / 3);
      extrudeWallsAlongZ(positions, indices, accentProfile, z0, z1, frontProfileEdgeFilter(accentProfile, inset));
    } else if (face === "floor") {
      extrudeWallsAlongZ(positions, indices, accentProfile, 0, bandH);
    }
  } else if (face === "rim") {
    wallBand(positions, indices, "y", b.od2 + skin, -b.ow2 - skin, b.ow2 + skin, z0, z1);
    wallBand(positions, indices, "y", -b.od2 - skin, -b.ow2 - skin, b.ow2 + skin, z0, z1);
    wallBand(positions, indices, "x", b.ow2 + skin, -b.od2 - skin, b.od2 + skin, z0, z1);
    wallBand(positions, indices, "x", -b.ow2 - skin, -b.od2 - skin, b.od2 + skin, z0, z1);
  } else if (face === "front") {
    const inset = clamp(params.accentInset ?? 4, 2, Math.min(b.outerW, b.outerD) / 3);
    wallBand(positions, indices, "y", b.od2 + skin, -b.ow2 + inset, b.ow2 - inset, z0, z1);
  } else if (face === "floor") {
    wallBand(positions, indices, "y", b.od2 + skin, -b.ow2 - skin, b.ow2 + skin, 0, bandH);
    wallBand(positions, indices, "y", -b.od2 - skin, -b.ow2 - skin, b.ow2 + skin, 0, bandH);
    wallBand(positions, indices, "x", b.ow2 + skin, -b.od2 - skin, b.od2 + skin, 0, bandH);
    wallBand(positions, indices, "x", -b.ow2 - skin, -b.od2 - skin, b.od2 + skin, 0, bandH);
  }

  return { positions, indices };
}

function hexVerts(cx, cz, r) {
  const pts = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 6) + (i * Math.PI) / 3;
    pts.push([cx + r * Math.cos(a), cz + r * Math.sin(a)]);
  }
  return pts;
}

/** Extrude a closed polygon as walls only — no fan caps to origin. */
function extrudeWallsAlongY(outPos, outIdx, pts, y0, y1) {
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    pushQuad(outPos, outIdx,
      vec3(pts[i][0], y0, pts[i][1]), vec3(pts[j][0], y0, pts[j][1]),
      vec3(pts[j][0], y1, pts[j][1]), vec3(pts[i][0], y1, pts[i][1]));
  }
}

function extrudeWallsAlongZ(outPos, outIdx, pts, z0, z1, edgeFilter = null) {
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const a = pts[i];
    const b = pts[j];
    if (edgeFilter && !edgeFilter(a, b, i, j, pts)) continue;
    pushQuad(outPos, outIdx,
      vec3(a[0], a[1], z0), vec3(b[0], b[1], z0),
      vec3(b[0], b[1], z1), vec3(a[0], a[1], z1));
  }
}

function capRingXZ(outPos, outIdx, outer, inner, z, normalUp) {
  const n = outer.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const o0 = vec3(outer[i][0], outer[i][1], z);
    const o1 = vec3(outer[j][0], outer[j][1], z);
    const i0 = vec3(inner[i][0], inner[i][1], z);
    const i1 = vec3(inner[j][0], inner[j][1], z);
    if (normalUp) pushQuad(outPos, outIdx, o0, o1, i1, i0);
    else pushQuad(outPos, outIdx, o0, i0, i1, o1);
  }
}

function forEachHexGrid(w, h, cellR, fn) {
  const pitchX = cellR * Math.sqrt(3);
  const pitchY = cellR * 1.5;
  const rows = Math.max(1, Math.floor(h / pitchY));
  const cols = Math.max(1, Math.floor(w / pitchX));
  const x0 = -((cols - 1) * pitchX) / 2;
  const z0 = -((rows - 1) * pitchY) / 2;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const cx = x0 + col * pitchX + (row % 2 ? pitchX / 2 : 0);
      const cz = z0 + row * pitchY;
      fn(cx, cz);
    }
  }
}

/** Honeycomb ridge stamp on chosen face (default back wall). */
export function buildHoneycombStamp(meta, params) {
  const b = rectFeatureBounds(meta);
  const cellR = clamp(params.honeycombSize ?? 2.5, 1.2, 5);
  const depth = clamp(params.honeycombDepth ?? 0.6, 0.3, 1.5);
  const face = params.honeycombFace || "back";
  const margin = 8;
  const faceW = b.outerW - margin * 2;
  const faceH = b.totalH - margin * 2;
  const zMid = b.totalH * 0.5;
  const positions = [];
  const indices = [];

  forEachHexGrid(faceW, faceH, cellR, (cx, cz) => {
    const z = zMid + cz;
    const pts = hexVerts(cx, z, cellR * 0.85);
    if (face === "front") {
      extrudeWallsAlongY(positions, indices, pts, b.od2, b.od2 + depth);
    } else {
      extrudeWallsAlongY(positions, indices, pts, -b.od2 - depth, -b.od2);
    }
  });

  return { positions, indices };
}

/** Stackable: hex feet on bottom + matching pockets in top rim. */
export function buildStackableHex(meta, params) {
  const b = rectFeatureBounds(meta);
  const cellR = clamp(params.stackHexSize ?? 3, 2, 5);
  const footH = clamp(params.stackFootHeight ?? 1.6, 0.8, 3);
  const clearance = params.stackClearance ?? 0.35;
  const margin = Math.max(10, cellR * 3);
  const gridW = b.innerW - margin * 2;
  const gridD = b.innerD - margin * 2;
  if (gridW < cellR * 4 || gridD < cellR * 4) return null;

  const positions = [];
  const indices = [];
  const footR = cellR - clearance * 0.4;
  const pocketOuterR = cellR + clearance;
  const pocketInnerR = Math.max(footR - 0.2, cellR * 0.55);

  forEachHexGrid(gridW, gridD, cellR, (cx, cy) => {
    const pts = hexVerts(cx, cy, footR);
    extrudeWallsAlongZ(positions, indices, pts, -footH, 0);
    const bot = pts.map(([x, y]) => [x, y]);
    capRingXZ(positions, indices, bot, hexVerts(cx, cy, footR * 0.35), 0, false);
  });

  const zTop = b.totalH;
  const pocketD = footH + clearance;
  forEachHexGrid(gridW, gridD, cellR, (cx, cy) => {
    const outer = hexVerts(cx, cy, pocketOuterR);
    const inner = hexVerts(cx, cy, pocketInnerR);
    capRingXZ(positions, indices, outer, inner, zTop, true);
    extrudeWallsAlongZ(positions, indices, outer, zTop - pocketD, zTop);
    extrudeWallsAlongZ(positions, indices, inner, zTop - pocketD, zTop);
    capRingXZ(positions, indices, outer, inner, zTop - pocketD, false);
  });

  return { positions, indices };
}

/** Recessed hex pockets on the top face of a flat lid — mates with stackable feet on another box. */
export function appendStackableLidPockets(outPos, outIdx, meta, params, lidThickness) {
  const b = rectFeatureBounds(meta);
  const cellR = clamp(params.stackHexSize ?? 3, 2, 5);
  const footH = clamp(params.stackFootHeight ?? 1.6, 0.8, 3);
  const clearance = params.stackClearance ?? 0.35;
  const margin = Math.max(10, cellR * 3);
  const gridW = b.innerW - margin * 2;
  const gridD = b.innerD - margin * 2;
  if (gridW < cellR * 4 || gridD < cellR * 4) return;

  const footR = cellR - clearance * 0.4;
  const pocketOuterR = cellR + clearance;
  const pocketInnerR = Math.max(footR - 0.2, cellR * 0.55);
  const zTop = lidThickness;
  const pocketD = footH + clearance;

  forEachHexGrid(gridW, gridD, cellR, (cx, cy) => {
    const outer = hexVerts(cx, cy, pocketOuterR);
    const inner = hexVerts(cx, cy, pocketInnerR);
    capRingXZ(outPos, outIdx, outer, inner, zTop, true);
    extrudeWallsAlongZ(outPos, outIdx, outer, zTop - pocketD, zTop);
    extrudeWallsAlongZ(outPos, outIdx, inner, zTop - pocketD, zTop);
    capRingXZ(outPos, outIdx, outer, inner, zTop - pocketD, false);
  });
}

export function shapeSupportsInsert(shape) {
  return shape === "rect" || shape === "rounded" || shape === "pencilBox";
}

const INSERT_TOP_CLEAR_BUFFER = 0.5;

function insertLidType(lidType) {
  if (lidType === "flat") return "flat";
  if (lidType === "plug") return "plug";
  return "slip";
}

/** Depth inside the cavity consumed by inset plug skirt or flat-cap lip (mm). */
export function lidCavityIntrusion(params) {
  if (!params?.lidEnabled) return 0;
  const lidType = insertLidType(params.lidType);
  if (lidType === "plug") return clamp(params.lidSkirt ?? 10, 4, 30);
  if (lidType === "flat") return clamp(params.lidLipDepth ?? 0, 0, 12);
  return 0;
}

/** Top clearance for dividers — auto-matches lid intrusion unless user overrides. */
export function effectiveInsertTopClearance(params) {
  const manual = clamp(params?.insertTopClearance ?? 0.6, 0, 40);
  if (params?.insertTopClearanceAuto === false) return manual;
  const intrusion = lidCavityIntrusion(params);
  if (intrusion <= 0) return manual;
  return Math.max(manual, intrusion + INSERT_TOP_CLEAR_BUFFER);
}

/** Panel boxes for vertical dividers (length / depth axis). */
function dividerPanelBoxes(meta, params) {
  const b = rectFeatureBounds(meta);
  const axis = params.insertAxis === "depth" ? "depth" : params.insertAxis === "height" ? "height" : "length";
  const count = clamp(Math.round(params.insertCount ?? 1), 1, 4);
  const thickness = clamp(params.insertThickness ?? 2.4, 1.2, 5);
  const clearance = clamp(params.insertClearance ?? 0.35, 0.1, 1.2);
  const topClear = effectiveInsertTopClearance(params);
  const fuseToBody = !!params.fuseInsertToBody;
  const bodyGap = fuseToBody ? 0 : (params.insertBodyGap ?? 0.12);
  const mount = params.insertMount === "slot" && axis === "height" ? "slot" : "snap";
  const wallClear = fuseToBody ? 0 : clearance + bodyGap;

  const spanW = b.innerW - wallClear * 2;
  const spanD = b.innerD - wallClear * 2;
  if (spanW < 8 || spanD < 8) return null;

  const halfT = thickness / 2;
  const boxes = [];

  if (axis === "height") {
    const spanH = b.cavityH - wallClear * 2 - topClear;
    if (spanH < 4) return null;
    const zBase = b.floor + wallClear;
    const slotDepth = clamp(params.insertSlotDepth ?? 2, 1, 4);
    const shelfW = mount === "slot" ? Math.max(8, b.innerW - slotDepth * 2 - bodyGap * 2) : spanW;
    const shelfD = spanD;
    for (let i = 1; i <= count; i++) {
      const t = i / (count + 1);
      const z = zBase + t * spanH;
      boxes.push({
        x0: -shelfW / 2, x1: shelfW / 2,
        y0: -shelfD / 2, y1: shelfD / 2,
        z0: z - halfT, z1: z + halfT,
      });
    }
    return boxes;
  }

  const weld = 0;
  const z0 = fuseToBody ? b.floor : b.floor + bodyGap;
  const z1 = b.floor + b.cavityH - topClear - (fuseToBody ? 0 : bodyGap);
  if (z1 - z0 < 4) return null;

  for (let i = 1; i <= count; i++) {
    const t = i / (count + 1);
    if (axis === "length") {
      const x = -spanW / 2 + t * spanW;
      boxes.push({
        x0: x - halfT, x1: x + halfT,
        y0: -spanD / 2 - weld, y1: spanD / 2 + weld,
        z0, z1,
      });
    } else {
      const y = -spanD / 2 + t * spanD;
      boxes.push({
        x0: -spanW / 2 - weld, x1: spanW / 2 + weld,
        y0: y - halfT, y1: y + halfT,
        z0, z1,
      });
    }
  }
  return boxes;
}

function triFullyInsideBox(positions, ia, ib, ic, box) {
  for (const v of [ia, ib, ic]) {
    const x = positions[v * 3];
    const y = positions[v * 3 + 1];
    const z = positions[v * 3 + 2];
    if (x < box.x0 || x > box.x1 || y < box.y0 || y > box.y1 || z < box.z0 || z > box.z1) return false;
  }
  return true;
}

function fixedDividerStripBoxes(meta, params) {
  const b = rectFeatureBounds(meta);
  const panels = dividerPanelBoxes(meta, params);
  if (!panels?.length || !params?.fuseInsertToBody) return [];
  const pad = 0.08;
  const zones = [];
  for (const panel of panels) {
    zones.push({
      x0: panel.x0 - pad, x1: panel.x1 + pad,
      y0: panel.y0 - pad, y1: panel.y1 + pad,
      z0: b.floor - pad, z1: b.floor + pad,
    });
  }
  return zones;
}

/** Fixed divider export — strip duplicate floor tris, merge solid panel. */
export function buildWatertightFixedDividerExport(bodyMesh, meta, params) {
  if (!params?.fuseInsertToBody) return null;
  const panels = dividerPanelBoxes(meta, params);
  if (!panels?.length) return null;
  const insert = buildDividerInsert(meta, params);
  if (!insert?.indices?.length) return null;

  const shell = bodyMesh?.shellMesh || bodyMesh;
  if (!shell?.indices?.length) return insert;

  const stripZones = fixedDividerStripBoxes(meta, params);
  const positions = shell.positions.slice();
  const cleanIdx = [];
  for (let t = 0; t < shell.indices.length; t += 3) {
    const ia = shell.indices[t];
    const ib = shell.indices[t + 1];
    const ic = shell.indices[t + 2];
    if (stripZones.some((box) => triFullyInsideBox(shell.positions, ia, ib, ic, box))) continue;
    cleanIdx.push(ia, ib, ic);
  }
  return mergeMeshes({ positions, indices: cleanIdx }, insert);
}

/** Removable flat divider panels — separate print part(s), splits cavity into equal bays. */
export function buildDividerInsert(meta, params) {
  const boxes = dividerPanelBoxes(meta, params);
  if (!boxes?.length) return null;
  const positions = [];
  const indices = [];
  for (const box of boxes) {
    appendBox(positions, indices, box.x0, box.y0, box.z0, box.x1, box.y1, box.z1);
  }
  return { positions, indices };
}

function appendBox(outPos, outIdx, x0, y0, z0, x1, y1, z1) {
  const pts = [
    [x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0],
    [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1],
  ];
  const faces = [
    [0, 1, 2, 3], [4, 5, 6, 7], [0, 1, 5, 4], [2, 3, 7, 6], [1, 2, 6, 5], [3, 0, 4, 7],
  ];
  for (const f of faces) pushQuad(outPos, outIdx, pts[f[0]], pts[f[1]], pts[f[2]], pts[f[3]]);
}

/** Rasterise label text to a high-res alpha mask (stencil contours, not pixel blocks). */
function rasterTextMask(text, fontId, fontSizePx = 640, align = "left") {
  if (typeof document === "undefined") return null;
  const lines = String(text || "")
    .split(/\r?\n/)
    .slice(0, 4)
    .map((l) => l.trimEnd());
  if (!lines.some((l) => l.trim())) return null;

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  const font = embossFontStack(fontId, fontSizePx);
  ctx.font = font;
  const pad = Math.ceil(fontSizePx * 0.22);
  let maxLineW = 0;
  for (const line of lines) {
    maxLineW = Math.max(maxLineW, ctx.measureText(line).width);
  }
  const lineHeight = fontSizePx * 1.12;
  const width = Math.ceil(maxLineW + pad * 2);
  const height = Math.ceil(pad * 2 + (lines.length - 1) * lineHeight + fontSizePx);
  canvas.width = width;
  canvas.height = height;
  ctx.font = font;
  ctx.fillStyle = "#000";
  ctx.textBaseline = "alphabetic";
  const textAlign = align === "center" ? "center" : align === "right" ? "right" : "left";
  ctx.textAlign = textAlign;
  for (let i = 0; i < lines.length; i++) {
    const y = pad + fontSizePx * 0.85 + i * lineHeight;
    let x = pad;
    if (textAlign === "center") x = width / 2;
    else if (textAlign === "right") x = width - pad;
    ctx.fillText(lines[i], x, y);
  }
  const data = ctx.getImageData(0, 0, width, height).data;
  const mask = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) {
    if (data[i * 4 + 3] > 64) mask[i] = 1;
  }
  return { mask, width, height };
}

/** @deprecated bounds helper — prefer rasterTextMask dimensions. */
function rasterTextRects(text, fontId, fontSizePx = 96) {
  const raster = rasterTextMask(text, fontId, fontSizePx);
  if (!raster) return null;
  return { rects: [{ x: 0, y: 0, w: raster.width, h: raster.height }], width: raster.width, height: raster.height };
}

/** Tight pixel bounds of ink in a text mask. */
function glyphBoundsFromMask(mask, maskW, maskH) {
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (let py = 0; py < maskH; py++) {
    for (let px = 0; px < maskW; px++) {
      if (!mask[py * maskW + px]) continue;
      left = Math.min(left, px);
      right = Math.max(right, px);
      top = Math.min(top, py);
      bottom = Math.max(bottom, py);
    }
  }
  if (!Number.isFinite(left)) return null;
  return {
    left,
    top,
    right,
    bottom,
    width: right - left + 1,
    height: bottom - top + 1,
  };
}

/** Size limits for embossed text on a face (mm). */
export function textEmbossSizeLimits(meta, face, params = null) {
  const frame = getEmbossFaceFrame(meta, face || "front", params);
  return {
    min: 3,
    max: Math.min(48, Math.max(20, Math.round(frame.faceH * 0.48 * 2) / 2)),
    maxWidthMm: Math.max(20, frame.faceW * 0.88),
  };
}

/** True when text has at least one non-empty line. */
function textHasInk(text) {
  return String(text || "")
    .split(/\r?\n/)
    .some((l) => l.trim());
}

/** Shared text layout — keeps 3D mesh and selection handles aligned. */
function computeTextArtLayout(meta, params) {
  const text = String(params.embossText || "");
  if (!textHasInk(text)) return null;
  const frame = getEmbossFaceFrame(meta, params.embossFace || "front", params);
  const limits = textEmbossSizeLimits(meta, frame.face, params);
  const labelH = clamp(params.embossHeight ?? 7, limits.min, limits.max);
  const raster = rasterTextMask(text, params.embossFont || "inter", 640, params.embossTextAlign || "left");
  if (!raster?.mask?.length) return null;

  const { mask, width: maskW, height: maskH } = raster;
  const glyph = glyphBoundsFromMask(mask, maskW, maskH);
  if (!glyph) return null;

  const scale = Math.min(labelH / glyph.height, limits.maxWidthMm / glyph.width);
  if (!Number.isFinite(scale) || scale <= 0) return null;

  const artW = glyph.width * scale;
  const artH = glyph.height * scale;
  const { xOff, zOff } = decorPlacementOffsets(params, frame, artW, artH);
  const left = xOff;
  const right = xOff + artW;
  const bottom = zOff;
  const top = zOff + artH;
  const cx = xOff + artW / 2;
  const cy = zOff + artH / 2;
  const canvasXOff = xOff - glyph.left * scale;
  const canvasZOff = zOff - (maskH - glyph.bottom) * scale;

  return {
    frame,
    raster,
    scale,
    xOff: canvasXOff,
    zOff: canvasZOff,
    artW,
    artH,
    maskW,
    maskH,
    left,
    right,
    bottom,
    top,
    cx,
    cy,
    rotation: params.decorRotation ?? 0,
    glyphHeightMm: artH,
  };
}

function flatCoordForFrame(frame, w) {
  if (frame.horizontal) return [w[0], w[1]];
  if (frame.face === "left" || frame.face === "right") return [w[1], w[2]];
  return [w[0], w[2]];
}

function collectTextEmbossShapeGroups(meta, params) {
  const layout = computeTextArtLayout(meta, params);
  if (!layout) return null;

  const { frame, raster, scale, xOff, zOff, maskW, maskH, cx, cy, rotation } = layout;
  const simplifyTol = Math.max(0.1, maskW / 1400);
  const glyphMm = layout.glyphHeightMm ?? 7;
  const smoothPasses = glyphMm <= 8 ? 4 : glyphMm <= 14 ? 3 : 2;
  const shapeGroups = prepareShapeGroups(
    groupPolygonsWithHoles(maskToPolygons(raster.mask, maskW, maskH)),
    simplifyTol,
    smoothPasses,
  );

  const remapped = shapeGroups.map((group) => ({
    outer: group.outer.map(([px, py]) => [xOff + px * scale, zOff + (maskH - py) * scale]),
    holes: group.holes.map((h) => h.map(([px, py]) => [xOff + px * scale, zOff + (maskH - py) * scale])),
  }));

  return {
    frame,
    shapeGroups: remapped.map((g) => rotateShapeGroup(g, cx, cy, rotation)),
    depth: clamp(params.embossDepth ?? 0.7, 0.3, 2),
  };
}

function exteriorFacePlane(frame, meta) {
  const b = rectFeatureBounds(meta);
  const eps = 0.06;
  switch (frame.face) {
    case "front":
      return { onPlane: (w) => Math.abs(w[1] + b.od2) <= eps, normal: [0, -1, 0], to2D: (w) => [w[0], w[2]] };
    case "back":
      return { onPlane: (w) => Math.abs(w[1] - b.od2) <= eps, normal: [0, 1, 0], to2D: (w) => [w[0], w[2]] };
    case "right":
      return { onPlane: (w) => Math.abs(w[0] - b.ow2) <= eps, normal: [1, 0, 0], to2D: (w) => [w[1], w[2]] };
    case "left":
      return { onPlane: (w) => Math.abs(w[0] + b.ow2) <= eps, normal: [-1, 0, 0], to2D: (w) => [w[1], w[2]] };
    case "top":
      return { onPlane: (w) => Math.abs(w[2] - b.totalH) <= eps, normal: [0, 0, 1], to2D: (w) => [w[0], w[1]] };
    default:
      return null;
  }
}

function meshTriNormal(positions, ia, ib, ic) {
  const ax = positions[ia * 3];
  const ay = positions[ia * 3 + 1];
  const az = positions[ia * 3 + 2];
  const bx = positions[ib * 3];
  const by = positions[ib * 3 + 1];
  const bz = positions[ib * 3 + 2];
  const cx = positions[ic * 3];
  const cy = positions[ic * 3 + 1];
  const cz = positions[ic * 3 + 2];
  const ux = bx - ax;
  const uy = by - ay;
  const uz = bz - az;
  const vx = cx - ax;
  const vy = cy - ay;
  const vz = cz - az;
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  const len = Math.hypot(nx, ny, nz) || 1;
  return [nx / len, ny / len, nz / len];
}

function triOnExteriorFace(positions, ia, ib, ic, spec) {
  const a = [positions[ia * 3], positions[ia * 3 + 1], positions[ia * 3 + 2]];
  const b = [positions[ib * 3], positions[ib * 3 + 1], positions[ib * 3 + 2]];
  const c = [positions[ic * 3], positions[ic * 3 + 1], positions[ic * 3 + 2]];
  if (!spec.onPlane(a) || !spec.onPlane(b) || !spec.onPlane(c)) return false;
  const n = meshTriNormal(positions, ia, ib, ic);
  return n[0] * spec.normal[0] + n[1] * spec.normal[1] + n[2] * spec.normal[2] > 0.5;
}

function removeExteriorWallTriangles(mesh, frame, meta) {
  const spec = exteriorFacePlane(frame, meta);
  if (!spec) return mesh;
  const positions = mesh.positions;
  const indices = mesh.indices;
  const cleanIdx = [];
  for (let t = 0; t < indices.length; t += 3) {
    const ia = indices[t];
    const ib = indices[t + 1];
    const ic = indices[t + 2];
    if (triOnExteriorFace(positions, ia, ib, ic, spec)) continue;
    cleanIdx.push(ia, ib, ic);
  }
  return { positions: positions.slice(), indices: cleanIdx };
}

function pointInRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function pointInShapeGroup(px, py, group) {
  if (!pointInRing(px, py, group.outer)) return false;
  for (const hole of group.holes) {
    if (hole.length >= 3 && pointInRing(px, py, hole)) return false;
  }
  return true;
}

function removeWallTrisUnderEmboss(mesh, frame, meta, shapeGroups) {
  const spec = exteriorFacePlane(frame, meta);
  if (!spec || !shapeGroups?.length) return mesh;
  const positions = mesh.positions;
  const cleanIdx = [];
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const ia = mesh.indices[t];
    const ib = mesh.indices[t + 1];
    const ic = mesh.indices[t + 2];
    if (triOnExteriorFace(positions, ia, ib, ic, spec)) {
      const cx = (positions[ia * 3] + positions[ib * 3] + positions[ic * 3]) / 3;
      const cy = (positions[ia * 3 + 1] + positions[ib * 3 + 1] + positions[ic * 3 + 1]) / 3;
      const cz = (positions[ia * 3 + 2] + positions[ib * 3 + 2] + positions[ic * 3 + 2]) / 3;
      const [px, py] = spec.to2D([cx, cy, cz]);
      let underInk = false;
      for (const group of shapeGroups) {
        if (pointInShapeGroup(px, py, group)) {
          underInk = true;
          break;
        }
      }
      if (underInk) continue;
    }
    cleanIdx.push(ia, ib, ic);
  }
  return { positions: positions.slice(), indices: cleanIdx };
}

function appendMesh(positions, indices, mesh) {
  if (!mesh?.positions?.length || !mesh?.indices?.length) return;
  const base = positions.length / 3;
  for (let i = 0; i < mesh.positions.length; i++) positions.push(mesh.positions[i]);
  for (const idx of mesh.indices) indices.push(idx + base);
}

/** Watertight side-face text for STL export — preview still uses fast merge. */
function buildWatertightTextEmbossExport(shellMesh, meta, params) {
  const collected = collectTextEmbossShapeGroups(meta, params);
  if (!collected?.shapeGroups?.length) return null;

  const { frame, shapeGroups, depth } = collected;
  const positions = [];
  const indices = [];
  const stripped = removeExteriorWallTriangles(shellMesh, frame, meta);
  appendMesh(positions, indices, stripped);

  const fw = frame.faceW;
  const fh = frame.faceH;
  const outerRect = [[-fw / 2, 0], [fw / 2, 0], [fw / 2, fh], [-fw / 2, fh]];
  const mapBot = (px, py) => frame.mapPoint(px, py, 0);
  const mapTop = (px, py) => frame.mapPoint(px, py, depth);
  const flatCoord = (w) => flatCoordForFrame(frame, w);

  triangulateMappedCap(positions, indices, mapBot, flatCoord, outerRect, [], true);

  for (const group of shapeGroups) {
    extrudeShapeGroupBetween(positions, indices, group, mapTop, mapBot, flatCoord, "both");
  }

  return removeWallTrisUnderEmboss({ positions, indices }, frame, meta, shapeGroups);
}

/** Closed letter solids for separate-colour export (no wall interaction). */
export function buildTextLabelExportMesh(meta, params) {
  const collected = collectTextEmbossShapeGroups(meta, params);
  if (!collected?.shapeGroups?.length) return null;

  const { frame, shapeGroups, depth } = collected;
  const positions = [];
  const indices = [];
  const mapBot = (px, py) => frame.mapPoint(px, py, 0);
  const mapTop = (px, py) => frame.mapPoint(px, py, depth);
  const flatCoord = (w) => flatCoordForFrame(frame, w);

  for (const group of shapeGroups) {
    extrudeShapeGroupBetween(positions, indices, group, mapTop, mapBot, flatCoord, "both");
  }
  return positions.length ? { positions, indices } : null;
}

export function buildWatertightExportMesh(bodyMesh, meta, params) {
  if (!bodyMesh || params.embossDeboss) return bodyMesh;
  const face = params.embossFace || "front";
  if (face === "lid" || params.joinerEnabled) return bodyMesh;

  const shell = bodyMesh.shellMesh || bodyMesh;
  if (params.embossText?.trim() && !params.embossSvgEnabled) {
    return buildWatertightTextEmbossExport(shell, meta, params) || bodyMesh;
  }
  return bodyMesh;
}

/** Embossed label text — smooth stencil silhouettes (one solid per letter). */
export function buildEmbossText(meta, params) {
  const collected = collectTextEmbossShapeGroups(meta, params);
  if (!collected) return null;

  const { d0, d1 } = labelOffsets(params);
  const positions = [];
  const indices = [];
  const flatCoord = (w) => flatCoordForFrame(collected.frame, w);
  const mapTop = (px, py) => collected.frame.mapPoint(px, py, d1);
  const mapBot = (px, py) => collected.frame.mapPoint(px, py, d0);

  for (const group of collected.shapeGroups) {
    extrudeShapeGroupBetween(positions, indices, group, mapTop, mapBot, flatCoord, "top");
  }
  return positions.length ? { positions, indices } : null;
}

/** Solid silhouette / traced bitmap emboss on chosen face. */
export function buildEmbossBitmap(meta, params, bitmap) {
  if (!bitmap?.width || !bitmap.height) return null;
  const artH = clamp(params.embossTraceSize ?? 16, 6, 40);
  const frame = getEmbossFaceFrame(meta, params.embossFace || "front", params);
  const maxW = Math.min(frame.faceW * 0.62, 56);
  const scale = Math.min(artH / bitmap.height, maxW / bitmap.width);
  if (!Number.isFinite(scale) || scale <= 0) return null;

  const artWidth = bitmap.width * scale;
  const { xOff, zOff } = decorPlacementOffsets(params, frame, artWidth, artH);
  const rotCx = xOff + artWidth / 2;
  const rotCy = zOff + artH / 2;
  const rotation = params.decorRotation ?? 0;
  const { d0, d1 } = labelOffsets(params);
  const positions = [];
  const indices = [];
  const maskW = Math.round(bitmap.width);
  const maskH = Math.round(bitmap.height);
  if (maskW <= 0 || maskH <= 0) return null;

  const isOutline = bitmap.mode === "outline";

  if (isOutline && bitmap.strokePaths?.length) {
    const smoothPasses = artH <= 12 ? 5 : artH <= 20 ? 4 : 3;
    const simplifyTol = Math.max(0.22, maskW / 520);
    const paths = prepareStrokePaths(bitmap.strokePaths, simplifyTol, smoothPasses);
    const strokePx = bitmap.strokeWidth ?? Math.max(1.35, maskW / 88);
    const lineWidth = clamp(scale * strokePx, 0.45, 1.5);
    const mapPt = (px, py) => rotateFacePoint(rotCx, rotCy, xOff + px * scale, zOff + (maskH - py) * scale, rotation);
    extrudeStrokePathList(positions, indices, frame, paths, mapPt, lineWidth, d0, d1);
    if (positions.length) return { positions, indices };
  }

  if (bitmap.shapeGroups?.length) {
    for (const group of bitmap.shapeGroups) {
      const remapped = {
        outer: group.outer.map(([px, py]) => [xOff + px * scale, zOff + (maskH - py) * scale]),
        holes: group.holes.map((h) => h.map(([px, py]) => [xOff + px * scale, zOff + (maskH - py) * scale])),
      };
      extrudeGroupOnFace(positions, indices, frame, rotateShapeGroup(remapped, rotCx, rotCy, rotation), d0, d1);
    }
    return positions.length ? { positions, indices } : null;
  }

  let mask = null;
  if (bitmap.mask?.length === maskW * maskH) {
    mask = bitmap.mask instanceof Uint8Array ? bitmap.mask : new Uint8Array(bitmap.mask);
  } else if (bitmap.rects?.length) {
    mask = new Uint8Array(maskW * maskH);
    for (const r of bitmap.rects) {
      const x0 = clamp(Math.floor(r.x), 0, maskW);
      const x1 = clamp(Math.ceil(r.x + r.w), 0, maskW);
      const yStart = clamp(Math.floor(r.y), 0, maskH);
      const yEnd = clamp(Math.ceil(r.y + r.h), 0, maskH);
      for (let py = yStart; py < yEnd; py++) {
        for (let px = x0; px < x1; px++) mask[py * maskW + px] = 1;
      }
    }
  } else {
    return null;
  }

  const hiRes = maskW >= 1800;
  const smoothPasses = hiRes ? 5 : artH <= 12 ? 4 : artH <= 20 ? 3 : 2;
  const simplifyTol = hiRes ? Math.max(0.1, maskW / 1400) : Math.max(0.28, maskW / 480);
  const shapeGroups = prepareShapeGroups(
    groupPolygonsWithHoles(maskToPolygons(mask, maskW, maskH)),
    simplifyTol,
    smoothPasses,
  );

  for (const group of shapeGroups) {
    const remapped = {
      outer: group.outer.map(([px, py]) => [xOff + px * scale, zOff + (maskH - py) * scale]),
      holes: group.holes.map((h) => h.map(([px, py]) => [xOff + px * scale, zOff + (maskH - py) * scale])),
    };
    extrudeGroupOnFace(positions, indices, frame, rotateShapeGroup(remapped, rotCx, rotCy, rotation), d0, d1);
  }

  return positions.length ? { positions, indices } : null;
}

const SVG_NS = "http://www.w3.org/2000/svg";

function splitPathSubpaths(d) {
  const trimmed = String(d || "").trim();
  if (!trimmed) return [];
  const parts = trimmed.match(/[Mm][^Mm]*/g);
  return parts?.length ? parts : [trimmed];
}

function dedupePolylinePoints(points, eps = 0.08) {
  if (points.length < 2) return points;
  const out = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const prev = out[out.length - 1];
    const p = points[i];
    if (Math.hypot(p[0] - prev[0], p[1] - prev[1]) >= eps) out.push(p);
  }
  return out;
}

function sampleSvgPathElement(pathEl, maxPoints = 900) {
  const len = pathEl.getTotalLength();
  if (!Number.isFinite(len) || len < 0.02) return [];
  const count = Math.min(maxPoints, Math.max(24, Math.ceil(len / 0.28)));
  const step = len / count;
  const pts = [];
  for (let i = 0; i <= count; i++) {
    const pt = pathEl.getPointAtLength(Math.min(i * step, len));
    pts.push([pt.x, pt.y]);
  }
  return dedupePolylinePoints(pts);
}

function parseSvgViewBox(svg) {
  const vb = svg.getAttribute("viewBox")?.trim().split(/[\s,]+/).map(Number);
  if (vb?.length === 4 && vb.every(Number.isFinite)) return vb;
  const w = parseFloat(String(svg.getAttribute("width") || "").replace(/[^\d.]/g, "")) || 100;
  const h = parseFloat(String(svg.getAttribute("height") || "").replace(/[^\d.]/g, "")) || 100;
  return [0, 0, w, h];
}

function readSvgStrokeWidth(pathEl, svg) {
  const raw = pathEl?.getAttribute("stroke-width") ?? svg?.getAttribute("stroke-width") ?? "1.5";
  const n = parseFloat(String(raw).replace(/[^\d.]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : 1.5;
}

function polylineFromElement(el) {
  if (el.tagName === "polyline" || el.tagName === "polygon") {
    const nums = (el.getAttribute("points") || "").trim().split(/[\s,]+/).map(Number);
    const pts = [];
    for (let i = 0; i + 1 < nums.length; i += 2) {
      if (Number.isFinite(nums[i]) && Number.isFinite(nums[i + 1])) pts.push([nums[i], nums[i + 1]]);
    }
    if (el.tagName === "polygon" && pts.length >= 3) pts.push([pts[0][0], pts[0][1]]);
    return dedupePolylinePoints(pts);
  }
  if (el.tagName === "line") {
    const x1 = parseFloat(el.getAttribute("x1") || "0");
    const y1 = parseFloat(el.getAttribute("y1") || "0");
    const x2 = parseFloat(el.getAttribute("x2") || "0");
    const y2 = parseFloat(el.getAttribute("y2") || "0");
    return [[x1, y1], [x2, y2]];
  }
  if (el.tagName === "rect") {
    const x = parseFloat(el.getAttribute("x") || "0");
    const y = parseFloat(el.getAttribute("y") || "0");
    const w = parseFloat(el.getAttribute("width") || "0");
    const h = parseFloat(el.getAttribute("height") || "0");
    return [[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]];
  }
  if (el.tagName === "circle") {
    const cx = parseFloat(el.getAttribute("cx") || "0");
    const cy = parseFloat(el.getAttribute("cy") || "0");
    const r = parseFloat(el.getAttribute("r") || "0");
    const pts = [];
    const n = 48;
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI * 2;
      pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
    }
    return pts;
  }
  if (el.tagName === "ellipse") {
    const cx = parseFloat(el.getAttribute("cx") || "0");
    const cy = parseFloat(el.getAttribute("cy") || "0");
    const rx = parseFloat(el.getAttribute("rx") || "0");
    const ry = parseFloat(el.getAttribute("ry") || "0");
    const pts = [];
    const n = 48;
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI * 2;
      pts.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]);
    }
    return pts;
  }
  return [];
}

/** Sample SVG geometry into polylines (handles curves via native path length). */
export function parseSvgPaths(svgText) {
  if (typeof DOMParser === "undefined" || typeof document === "undefined") return [];
  const doc = new DOMParser().parseFromString(svgText, "image/svg+xml");
  const svg = doc.documentElement;
  if (!svg || svg.nodeName.toLowerCase() === "parsererror") return [];

  const viewBox = parseSvgViewBox(svg);
  const scratch = document.createElementNS(SVG_NS, "svg");
  scratch.setAttribute("xmlns", SVG_NS);
  scratch.setAttribute("viewBox", svg.getAttribute("viewBox") || `${viewBox[0]} ${viewBox[1]} ${viewBox[2]} ${viewBox[3]}`);
  scratch.setAttribute("width", String(viewBox[2]));
  scratch.setAttribute("height", String(viewBox[3]));
  scratch.style.cssText = "position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden";
  document.body.appendChild(scratch);

  const polylines = [];
  let strokeWidth = readSvgStrokeWidth(null, svg);

  try {
    for (const pathEl of doc.querySelectorAll("path")) {
      strokeWidth = Math.max(strokeWidth, readSvgStrokeWidth(pathEl, svg));
      const d = pathEl.getAttribute("d");
      if (!d) continue;
      for (const sub of splitPathSubpaths(d)) {
        const p = document.createElementNS(SVG_NS, "path");
        p.setAttribute("d", sub);
        scratch.appendChild(p);
        const sampled = sampleSvgPathElement(p);
        scratch.removeChild(p);
        if (sampled.length >= 2) polylines.push(sampled);
      }
    }
    for (const el of doc.querySelectorAll("polyline, polygon, line, rect, circle, ellipse")) {
      strokeWidth = Math.max(strokeWidth, readSvgStrokeWidth(el, svg));
      const pts = polylineFromElement(el);
      if (pts.length >= 2) polylines.push(pts);
    }
  } finally {
    scratch.remove();
  }

  return { polylines, viewBox, strokeWidth };
}

function pathIsExplicitlyClosed(path) {
  if (!path || path.length < 4) return false;
  const dx = path[0][0] - path[path.length - 1][0];
  const dy = path[0][1] - path[path.length - 1][1];
  return Math.hypot(dx, dy) < 0.05;
}

function extrudeStrokePathList(positions, indices, frame, paths, mapPt, lineWidthMm, d0, d1) {
  const half = lineWidthMm / 2;
  for (const path of paths) {
    if (!path?.length) continue;
    const closed = pathIsExplicitlyClosed(path);
    const pts = closed ? ringPointsLocal(path) : path;
    const segCount = closed ? pts.length : pts.length - 1;
    if (segCount < 1) continue;
    for (let i = 0; i < segCount; i++) {
      const j = closed ? (i + 1) % pts.length : i + 1;
      const [x0, y0] = mapPt(pts[i][0], pts[i][1]);
      const [x1, y1] = mapPt(pts[j][0], pts[j][1]);
      extrudeStrokeSegmentOnFace(positions, indices, frame, x0, y0, x1, y1, half, d0, d1);
    }
  }
}

export function buildEmbossSvg(meta, params, svgText) {
  const parsed = parseSvgPaths(svgText);
  const polylines = parsed.polylines || (Array.isArray(parsed) ? parsed : []);
  if (!polylines.length) return null;

  const frame = getEmbossFaceFrame(meta, params.embossFace || "front", params);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const line of polylines) {
    for (const [x, y] of line) {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  if (!Number.isFinite(minX)) return null;

  const sw = maxX - minX || parsed.viewBox?.[2] || 1;
  const sh = maxY - minY || parsed.viewBox?.[3] || 1;
  const artH = clamp(params.embossTraceSize ?? params.embossHeight ?? 16, 6, 40);
  const maxW = Math.min(frame.faceW * 0.62, 56);
  const scale = Math.min(artH / sh, maxW / sw);
  if (!Number.isFinite(scale) || scale <= 0) return null;

  const cx = (minX + maxX) / 2;
  const artW = sw * scale;
  const { xOff, zOff } = decorPlacementOffsets(params, frame, artW, artH);
  const rotCx = xOff + artW / 2;
  const rotCy = zOff + artH / 2;
  const rotation = params.decorRotation ?? 0;
  const svgStroke = parsed.strokeWidth ?? 1.5;
  const lineWidth = clamp(scale * svgStroke, 0.45, 1.5);
  const smoothPasses = artH <= 12 ? 4 : artH <= 20 ? 3 : 2;
  const simplifyTol = Math.max(0.18, Math.max(sw, sh) / 520);
  const closedPaths = polylines.map((line) => {
    if (line.length >= 3) {
      const [x0, y0] = line[0];
      const [x1, y1] = line[line.length - 1];
      if (Math.hypot(x0 - x1, y0 - y1) < Math.max(0.35, Math.max(sw, sh) * 0.004)) {
        return [...line, line[0]];
      }
    }
    return line;
  });
  const strokePaths = prepareStrokePaths(closedPaths, simplifyTol, smoothPasses);
  const { d0, d1 } = labelOffsets(params);
  const positions = [];
  const indices = [];
  const mapPt = (x, y) => rotateFacePoint(
    rotCx,
    rotCy,
    (x - cx) * scale + xOff + artW / 2,
    zOff + (maxY - y) * scale,
    rotation,
  );

  extrudeStrokePathList(positions, indices, frame, strokePaths, mapPt, lineWidth, d0, d1);
  return positions.length ? { positions, indices } : null;
}

export function resolveJoinerDims(params, outerW, outerD) {
  const span = Math.max(outerW, outerD);
  const auto = params.joinerAutoScale !== false;
  const scale = auto ? clamp(span / 94, 0.55, 2.2) : 1;
  const width = clamp((params.joinerWidth ?? 9) * scale, 4, 28);
  const neck = clamp(Math.min((params.joinerNeck ?? 6) * scale, width - 1.5), 2.5, width - 1);
  const protrusion = clamp((params.joinerProtrusion ?? 4) * scale, 1.8, 12);
  return {
    hand: params.joinerHand === "right" ? "right" : "left",
    width,
    neck,
    protrusion,
    clearance: params.joinerClearance ?? 0.3,
    wall: params.wall,
    scale: round1(scale),
  };
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

export function shapeSupportsDecor(shape) {
  return shape === "rect" || shape === "rounded" || shape === "pencil" || shape === "pencilBox";
}

/** Face frame for placing emboss on any of the four side walls.
 * Returns an object with faceW / faceH (usable dimensions in mm) and a
 * mapPoint(px, py, offset) helper that projects a 2D art-space point (px, py)
 * onto the target face at a distance `offset` from the outer surface
 * (positive = outward, negative = inward for deboss).
 */
export function getEmbossFaceFrame(meta, face, params = null) {
  const b = rectFeatureBounds(meta);
  const useFace = ["front", "back", "left", "right", "top", "lid"].includes(face) ? face : "front";

  if (useFace === "top") {
    return {
      face: "top",
      faceW: b.outerW,
      faceH: b.outerD,
      centerZ: b.totalH * 0.5,
      horizontal: true,
      mapPoint: (px, py, offset) => [px, py, b.totalH + offset],
    };
  }

  if (useFace === "lid") {
    const lidType = params?.lidType ?? "slip";
    const skirtDepth = lidType === "screw"
      ? clamp(params?.lidSkirt ?? 10, 6, 30)
      : clamp(params?.lidSkirt ?? 10, 4, 30);
    const lidThickness = clamp(params?.lidThickness ?? 2.4, 1.2, 8);
    const zTop = lidType === "flat" ? lidThickness : skirtDepth + lidThickness;
    return {
      face: "lid",
      faceW: b.outerW,
      faceH: b.outerD,
      centerZ: 0,
      horizontal: true,
      centerX: 0,
      mapPoint: (px, py, offset) => [px, py, zTop + offset],
    };
  }

  // Convention: default preview camera looks at -Y face → that's the user's "front".
  if (useFace === "front" || useFace === "back") {
    const yOut = useFace === "front" ? -b.od2 : b.od2;
    const yDir = useFace === "front" ? -1 : 1;
    // For "front" (world -Y) text is not mirrored — reads normally.
    // For "back" (world +Y) mirror X so text reads correctly when viewed from +Y.
    const mirror = useFace === "back";
    return {
      face: useFace,
      faceW: b.outerW,
      faceH: b.totalH,
      centerZ: b.totalH * 0.72,
      mapPoint: (px, py, offset) => {
        const y = yOut + yDir * offset;
        const x = mirror ? -px : px;
        return [x, y, py];
      },
    };
  }
  // Right = world +X face (visible in default preview orbit); Left = world -X face.
  const xOut = useFace === "right" ? b.ow2 : -b.ow2;
  const xDir = useFace === "right" ? 1 : -1;
  // Left face: viewer looks from -X toward +X → mirror so text reads L-to-R correctly.
  const mirror = useFace === "left";
  return {
    face: useFace,
    faceW: b.outerD,
    faceH: b.totalH,
    centerZ: b.totalH * 0.72,
    mapPoint: (px, py, offset) => {
      const x = xOut + xDir * offset;
      const y = mirror ? -px : px;
      return [x, y, py];
    },
  };
}

/** Extrude a raster-space rectangle onto a face frame between offsets [d0, d1].
 * (px range is [xLeft, xRight], py range is [zBottom, zTop] in art space.)
 */
function boxOnFace(outPos, outIdx, frame, xLeft, xRight, zBottom, zTop, d0, d1) {
  const p000 = frame.mapPoint(xLeft, zBottom, d0);
  const p100 = frame.mapPoint(xRight, zBottom, d0);
  const p110 = frame.mapPoint(xRight, zTop, d0);
  const p010 = frame.mapPoint(xLeft, zTop, d0);
  const p001 = frame.mapPoint(xLeft, zBottom, d1);
  const p101 = frame.mapPoint(xRight, zBottom, d1);
  const p111 = frame.mapPoint(xRight, zTop, d1);
  const p011 = frame.mapPoint(xLeft, zTop, d1);
  const winding = d1 > d0;
  const face = (a, b, c, d) => winding
    ? pushQuad(outPos, outIdx, a, b, c, d)
    : pushQuad(outPos, outIdx, a, d, c, b);
  face(p000, p100, p110, p010);
  face(p001, p011, p111, p101);
  face(p000, p001, p101, p100);
  face(p010, p110, p111, p011);
  face(p000, p010, p011, p001);
  face(p100, p101, p111, p110);
}

/** Extrude a thick line segment on a face (for outline / stroke emboss). */
function extrudeStrokeSegmentOnFace(outPos, outIdx, frame, x0, y0, x1, y1, half, d0, d1) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return;
  const nx = (-dy / len) * half;
  const ny = (dx / len) * half;
  const winding = d1 > d0;
  const face = (a, b, c, d) => winding
    ? pushQuad(outPos, outIdx, a, b, c, d)
    : pushQuad(outPos, outIdx, a, d, c, b);
  const p000 = frame.mapPoint(x0 - nx, y0 - ny, d0);
  const p100 = frame.mapPoint(x1 - nx, y1 - ny, d0);
  const p110 = frame.mapPoint(x1 + nx, y1 + ny, d0);
  const p010 = frame.mapPoint(x0 + nx, y0 + ny, d0);
  const p001 = frame.mapPoint(x0 - nx, y0 - ny, d1);
  const p101 = frame.mapPoint(x1 - nx, y1 - ny, d1);
  const p111 = frame.mapPoint(x1 + nx, y1 + ny, d1);
  const p011 = frame.mapPoint(x0 + nx, y0 + ny, d1);
  face(p000, p100, p110, p010);
  face(p001, p011, p111, p101);
  face(p000, p001, p101, p100);
  face(p010, p110, p111, p011);
}

function ringPointsLocal(ring) {
  return ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]
    ? ring.slice(0, -1)
    : ring.slice();
}

/** Extrude a shape group (outer ring + holes) onto a face at offsets [d0, d1]. */
function extrudeGroupOnFace(outPos, outIdx, frame, group, d0, d1) {
  const mapTop = (px, py) => frame.mapPoint(px, py, d1);
  const mapBot = (px, py) => frame.mapPoint(px, py, d0);
  const flatCoord = frame.horizontal
    ? (w) => [w[0], w[1]]
    : frame.face === "left" || frame.face === "right"
      ? (w) => [w[1], w[2]]
      : (w) => [w[0], w[2]];
  extrudeShapeGroupBetween(outPos, outIdx, group, mapTop, mapBot, flatCoord, d0 < 0 ? "both" : "top");
}

function labelOffsets(params) {
  const depth = clamp(params.embossDepth ?? 0.7, 0.3, 2);
  if (params.__embossMode === "deboss-cutter") {
    // Slicer-facing cutter STL: pokes 0.4mm past the surface and sinks (depth + 0.05)mm inward
    // so the boolean subtract is clean at the outer skin.
    return { d0: -depth - 0.05, d1: 0.4, depth, deboss: true };
  }
  // Raised emboss: flush with outer wall, top cap + side walls only (wall is the floor).
  return { d0: 0, d1: depth, depth, deboss: false };
}

/** Measure active art on a face for preview handles (null if none). */
export function measureDecorArt(meta, params) {
  const frame = getEmbossFaceFrame(meta, params.embossFace || "front", params);
  const traceData = params.embossTraceRects;
  const hasTrace =
    params.embossTraceEnabled &&
    (traceData?.shapeGroups?.length ||
      traceData?.strokePaths?.length ||
      traceData?.mask?.length ||
      traceData?.rects?.length);
  const hasText = !!params.embossText?.trim() && !params.embossSvgEnabled;

  if (hasText) {
    const layout = computeTextArtLayout(meta, params);
    if (!layout) return null;
    return {
      frame: layout.frame,
      kind: "text",
      rotation: layout.rotation,
      left: layout.left,
      right: layout.right,
      bottom: layout.bottom,
      top: layout.top,
      cx: layout.cx,
      cy: layout.cy,
      artW: layout.right - layout.left,
      artH: layout.top - layout.bottom,
    };
  }

  if (hasTrace && traceData?.width && traceData?.height) {
    const artH = clamp(params.embossTraceSize ?? 16, 6, 40);
    const maxW = Math.min(frame.faceW * 0.62, 56);
    const scale = Math.min(artH / traceData.height, maxW / traceData.width);
    if (!Number.isFinite(scale) || scale <= 0) return null;
    const artW = traceData.width * scale;
    const { xOff, zOff } = decorPlacementOffsets(params, frame, artW, artH);
    return { frame, kind: "trace", rotation: params.decorRotation ?? 0, ...decorArtRect(frame, xOff, zOff, artW, artH) };
  }

  if (params.embossSvgEnabled && params.embossSvgText?.trim()) {
    const parsed = parseSvgPaths(params.embossSvgText);
    const polylines = parsed.polylines || (Array.isArray(parsed) ? parsed : []);
    if (!polylines.length) return null;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const line of polylines) {
      for (const [x, y] of line) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
    if (!Number.isFinite(minX)) return null;
    const sw = maxX - minX || parsed.viewBox?.[2] || 1;
    const sh = maxY - minY || parsed.viewBox?.[3] || 1;
    const artH = clamp(params.embossTraceSize ?? params.embossHeight ?? 16, 6, 40);
    const maxW = Math.min(frame.faceW * 0.62, 56);
    const scale = Math.min(artH / sh, maxW / sw);
    if (!Number.isFinite(scale) || scale <= 0) return null;
    const artW = sw * scale;
    const { xOff, zOff } = decorPlacementOffsets(params, frame, artW, artH);
    return { frame, kind: "svg", rotation: params.decorRotation ?? 0, ...decorArtRect(frame, xOff, zOff, artW, artH) };
  }

  return null;
}

export function buildLabelEmboss(meta, params, svgText = "", mode = "emboss") {
  const p = { ...params, __embossMode: mode };
  const traceData = p.embossTraceRects;
  const hasTrace =
    p.embossTraceEnabled &&
    (traceData?.shapeGroups?.length ||
      traceData?.strokePaths?.length ||
      traceData?.mask?.length ||
      traceData?.rects?.length);
  const hasText = !!p.embossText?.trim();

  // Label text wins over stale trace/SVG geometry on the box.
  if (hasText && !p.embossSvgEnabled) {
    return buildEmbossText(meta, p);
  }
  if (hasTrace) {
    return buildEmbossBitmap(meta, p, p.embossTraceRects);
  }
  if (p.embossSvgEnabled && svgText?.trim()) {
    return buildEmbossSvg(meta, p, svgText);
  }
  return null;
}

export function applyBodyDecorations(bodyMesh, meta, params) {
  const parts = [bodyMesh];
  if (params.honeycombEnabled) {
    const honey = buildHoneycombStamp(meta, params);
    if (honey) parts.push(honey);
  }
  if (params.stackableEnabled) {
    const stack = buildStackableHex(meta, params);
    if (stack) parts.push(stack);
  }
  return mergeMeshes(...parts);
}
