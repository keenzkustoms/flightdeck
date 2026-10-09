/**
 * Flat sign plates (b383) — door/name plaques, desk plates, house numbers, hanging signs.
 *
 * A sign is a solid flat plate lying on the bed (z=0..thickness), text/art embossed on the
 * TOP face via the shared emboss engine. Mount cutouts (keyhole / screw / hanging holes) are
 * modelled as HOLES in the plate outline — no CSG needed: one extrudeShapeGroupBetween with
 * outer ring + hole rings gives a watertight solid. An optional raised border sits on top.
 */
import { extrudeShapeGroupBetween } from "./contour.js?v=241";

const TAU = Math.PI * 2;

function roundedRect(halfW, halfH, r, seg = 10) {
  r = Math.max(0, Math.min(r, halfW - 0.01, halfH - 0.01));
  if (r < 0.05) return [[-halfW, -halfH], [halfW, -halfH], [halfW, halfH], [-halfW, halfH]];
  const pts = [];
  const corners = [[halfW - r, -(halfH - r), -Math.PI / 2], [halfW - r, halfH - r, 0], [-(halfW - r), halfH - r, Math.PI / 2], [-(halfW - r), -(halfH - r), Math.PI]];
  for (const [cx, cy, a0] of corners)
    for (let i = 0; i <= seg; i++) { const a = a0 + (Math.PI / 2) * (i / seg); pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); }
  return pts;
}

/** Remove near-duplicate consecutive points + accidental closure dup (breaks wall extrusion). */
function cleanRing(pts, eps = 0.02) {
  const out = [];
  for (const pt of pts) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(pt[0] - last[0], pt[1] - last[1]) > eps) out.push([pt[0], pt[1]]);
  }
  while (out.length > 3 && Math.hypot(out[0][0] - out[out.length - 1][0], out[0][1] - out[out.length - 1][1]) <= eps) out.pop();
  return out;
}

/** Plate outline for a named shape, centred in a halfW x halfH box. Returns a clean CCW ring. */
function shapeOutline(shape, halfW, halfH, corner = 8) {
  let pts;
  if (shape === "rectangle") pts = roundedRect(halfW, halfH, 0);
  else if (shape === "pill") pts = roundedRect(halfW, halfH, Math.min(halfW, halfH));
  else if (shape === "oval") {
    pts = []; const n = 72;
    for (let i = 0; i < n; i++) { const a = (i / n) * TAU; pts.push([halfW * Math.cos(a), halfH * Math.sin(a)]); }
  } else if (shape === "hexagon") {
    const k = halfW * 0.5;
    pts = [[-halfW + k, -halfH], [halfW - k, -halfH], [halfW, 0], [halfW - k, halfH], [-halfW + k, halfH], [-halfW, 0]];
  } else if (shape === "arch") {
    // straight sides for the lower half, elliptical arch on top — always fits the box.
    const spring = 0;
    const ry = halfH - spring;
    pts = [[-halfW, -halfH], [halfW, -halfH], [halfW, spring]];
    const n = 44;
    for (let i = 0; i <= n; i++) { const a = 0 + Math.PI * (i / n); pts.push([halfW * Math.cos(a), spring + ry * Math.sin(a)]); }
    pts.push([-halfW, spring]);
  } else if (shape === "shield") {
    pts = [[-halfW, halfH], [halfW, halfH], [halfW, -halfH * 0.15]];
    const n = 22;
    for (let i = 1; i <= n; i++) { const t = i / n; const x = halfW * Math.cos(t * Math.PI / 2); const y = -halfH * 0.15 - (halfH * 0.85) * Math.sin(t * Math.PI / 2); pts.push([x, y]); }
    // now at bottom point (0,-halfH); go up the left side symmetric
    for (let i = 1; i <= n; i++) { const t = i / n; const x = -halfW * Math.sin(t * Math.PI / 2); const y = -halfH + (halfH * 0.85) * (1 - Math.cos(t * Math.PI / 2)); pts.push([x, y]); }
  } else if (shape === "banner") {
    const notch = halfW * 0.16;
    pts = [[-halfW, -halfH], [halfW, -halfH], [halfW - notch, 0], [halfW, halfH], [-halfW, halfH], [-halfW + notch, 0]];
  } else {
    pts = roundedRect(halfW, halfH, corner);
  }
  return cleanRing(pts);
}

function pointInPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
    if (((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}

/** Pull a mount-hole centre toward the plate centre until it (+margin ring) is inside the shape. */
function clampInside(cx, cy, outline, margin) {
  const ok = (x, y) => pointInPoly(x, y, outline)
    && pointInPoly(x + margin, y, outline) && pointInPoly(x - margin, y, outline)
    && pointInPoly(x, y + margin, outline) && pointInPoly(x, y - margin, outline);
  let x = cx, y = cy, f = 1;
  for (let i = 0; i < 30 && !ok(x, y); i++) { f *= 0.9; x = cx * f; y = cy * f; }
  return [x, y];
}

function circle(cx, cy, r, seg = 28) {
  const pts = [];
  for (let i = 0; i < seg; i++) { const a = (i / seg) * TAU; pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); }
  return pts;
}

/** Keyhole: big hole (screw head) with a narrower slot rising from it (screw shaft slides down). */
function keyholeHole(cx, cy, headR, slotW, slotLen, seg = 24) {
  const hw = slotW / 2;
  const pts = [];
  // start at slot bottom-left, up the left side, around the head, down the right side of slot
  // build as: head circle centred at (cx, cy) + rectangular slot going UP (+y) from head centre
  // Compose an explicit CCW outline.
  const headTop = cy + Math.sqrt(Math.max(0, headR * headR - hw * hw));
  const slotTopY = cy + slotLen;
  // left slot edge (from head tangent up)
  pts.push([cx - hw, headTop]);
  pts.push([cx - hw, slotTopY]);
  pts.push([cx + hw, slotTopY]);
  pts.push([cx + hw, headTop]);
  // head arc (from right tangent, clockwise around the bottom back to left tangent)
  const a0 = Math.atan2(headTop - cy, hw);       // right tangent angle
  const a1 = Math.atan2(headTop - cy, -hw);       // left tangent angle
  // go the long way round the bottom: from a0 decreasing through -pi/2 to a1-2pi
  const start = a0, end = a1 - TAU;
  for (let i = 0; i <= seg; i++) { const a = start + (end - start) * (i / seg); pts.push([cx + headR * Math.cos(a), cy + headR * Math.sin(a)]); }
  return pts;
}

function ensureCCW(ring) {
  let area = 0;
  for (let i = 0; i < ring.length; i++) { const j = (i + 1) % ring.length; area += ring[i][0] * ring[j][1] - ring[j][0] * ring[i][1]; }
  return area < 0 ? ring.slice().reverse() : ring;
}

/** Mount hole rings (in plate face coords, origin centre) for the chosen mount style. */
function mountHoles(type, W, H, opts = {}) {
  const holes = [];
  const margin = Math.min(W, H) * 0.12 + 4;
  const x = W / 2 - margin, y = H / 2 - margin;
  const outline = opts.outline;
  const fit = (cx, cy, r) => outline ? clampInside(cx, cy, outline, r + 1.5) : [cx, cy];
  if (type === "keyhole") {
    const headR = opts.headR ?? 4.2;
    for (const sx of [-x, x]) { const [hx, hy] = fit(sx, y - 3, headR + 7); holes.push(keyholeHole(hx, hy, headR, headR * 0.62, 7)); }
  } else if (type === "screw") {
    const r = opts.screwR ?? 2.2;
    for (const [sx, sy] of [[-x, y], [x, y], [-x, -y], [x, -y]]) { const [hx, hy] = fit(sx, sy, r); holes.push(circle(hx, hy, r)); }
  } else if (type === "hanging") {
    const r = opts.hangR ?? 3.0;
    for (const sx of [-x, x]) { const [hx, hy] = fit(sx, y, r); holes.push(circle(hx, hy, r)); }
  }
  return holes.map(ensureCCW);
}

/**
 * Build a watertight flat plate. Returns { positions, indices }.
 * W,H = plate size (mm), th = thickness, corner = corner radius, holes = array of hole rings.
 */
export function buildSignPlate(W, H, th, corner, holes = [], shape = "rounded") {
  const outer = ensureCCW(cleanRing(shapeOutline(shape, W / 2, H / 2, corner)));
  // holes must wind opposite to outer for earcut; ensureCCW made them CCW, reverse to CW
  const holeRings = holes.map((h) => h.slice().reverse());
  const group = { outer, holes: holeRings };
  const positions = [];
  const indices = [];
  const mapTop = (px, py) => [px, py, th];
  const mapBot = (px, py) => [px, py, 0];
  const flat = (w) => [w[0], w[1]];
  extrudeShapeGroupBetween(positions, indices, group, mapTop, mapBot, flat, "both", null);
  return { positions, indices };
}

/** Raised border frame — a closed rim slightly inset from the plate edge and embedded a
 * little into the plate top, so it unions cleanly (no coincident faces with the plate cap). */
export function buildSignBorder(W, H, th, corner, borderW, bh, shape = "rounded") {
  const inset = 1.2;           // gap from plate edge (avoids coplanar outer walls)
  const embed = 0.4;           // sink into the plate (avoids coplanar with the top cap)
  const oHalfW = W / 2 - inset, oHalfH = H / 2 - inset;
  const outer = ensureCCW(cleanRing(shapeOutline(shape, oHalfW, oHalfH, Math.max(0.5, corner - inset))));
  const inner = ensureCCW(cleanRing(shapeOutline(shape, oHalfW - borderW, oHalfH - borderW, Math.max(0.5, corner - inset - borderW))));
  const group = { outer, holes: [inner.slice().reverse()] };
  const positions = [];
  const indices = [];
  const mapTop = (px, py) => [px, py, th + bh];
  const mapBot = (px, py) => [px, py, th - embed];
  const flat = (w) => [w[0], w[1]];
  extrudeShapeGroupBetween(positions, indices, group, mapTop, mapBot, flat, "both", null);
  return { positions, indices };
}

/** Minimum floor left under a shelf press-fit pocket (mm). Never a through-hole. */
export const SIGN_SHELF_SLOT_BASE_MIN = 0.2;

/** Straight press-fit slot sizes for shelf ↔ back joint (mm). */
export function signShelfPressFitDims(backTh, shelfTh, opts = {}) {
  const thS = Math.max(1.5, shelfTh);
  const requestedSlot = Number(opts.slotDepth);
  const slotDepth = Number.isFinite(requestedSlot)
    ? Math.max(2.4, Math.min(12, requestedSlot))
    : Math.max(2.4, backTh + 0.45);
  const requestedBase = Number(opts.slotBase);
  // Base thickness under the pocket: 0.2 mm … shelf thickness (max = no slot / solid).
  const slotBase = Number.isFinite(requestedBase)
    ? Math.max(SIGN_SHELF_SLOT_BASE_MIN, Math.min(thS, requestedBase))
    : SIGN_SHELF_SLOT_BASE_MIN;
  return { edgeInset: 5, slotDepth, slotBase };
}

/** Extrude a YZ profile (and optional holes) along X. */
function extrudeYzAlongX(profileYz, x0, x1, holesYz = []) {
  const positions = [];
  const indices = [];
  const outer = ensureCCW(profileYz.map(([y, z]) => [y, z]));
  const holes = holesYz.map((h) => ensureCCW(h.map(([y, z]) => [y, z])).slice().reverse());
  const map0 = (y, z) => [x0, y, z];
  const map1 = (y, z) => [x1, y, z];
  extrudeShapeGroupBetween(
    positions, indices, { outer, holes },
    map1, map0, (w) => [w[1], w[2]], "both", null,
  );
  return { positions, indices };
}

/** Weld near-coincident verts after appending shelf connector parts (keeps export tidy). */
export function weldShelfMesh(mesh, eps = 0.04) {
  if (!mesh?.positions?.length || !mesh?.indices?.length) return mesh;
  const table = new Map();
  const outPos = [];
  const indexOf = (x, y, z) => {
    const k = `${Math.round(x / eps)}|${Math.round(y / eps)}|${Math.round(z / eps)}`;
    let idx = table.get(k);
    if (idx === undefined) {
      idx = outPos.length / 3;
      outPos.push(x, y, z);
      table.set(k, idx);
    }
    return idx;
  };
  const outIdx = [];
  const P = mesh.positions;
  const I = mesh.indices;
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t], b = I[t + 1], c = I[t + 2];
    const ia = indexOf(P[a * 3], P[a * 3 + 1], P[a * 3 + 2]);
    const ib = indexOf(P[b * 3], P[b * 3 + 1], P[b * 3 + 2]);
    const ic = indexOf(P[c * 3], P[c * 3 + 1], P[c * 3 + 2]);
    if (ia === ib || ib === ic || ia === ic) continue;
    outIdx.push(ia, ib, ic);
  }
  return { positions: outPos, indices: outIdx };
}

/**
 * No added connector on the back part. The back sign's own lower edge presses
 * into the shelf slot, which avoids strip artifacts on the sign export.
 */
export function buildSignShelfFemaleReceiver(backW, shelfW, backTh, shelfTh, dims = null) {
  return { positions: [], indices: [] };
}

/** Shelf deck outline in XY — rounded front corners, square rear for the press-fit slot. */
function shelfDeckOutlineXy(halfW, yFront, yRear, cornerR) {
  const maxR = Math.max(0, Math.min(halfW - 0.4, (yRear - yFront) * 0.45 - 0.2));
  const r = Math.min(Math.max(0, cornerR), maxR);
  if (r < 0.08) {
    return ensureCCW([[-halfW, yFront], [halfW, yFront], [halfW, yRear], [-halfW, yRear]]);
  }
  const pts = [];
  const seg = 10;
  for (let i = 0; i <= seg; i++) {
    const a = Math.PI + (Math.PI / 2) * (i / seg);
    pts.push([-halfW + r + r * Math.cos(a), yFront + r + r * Math.sin(a)]);
  }
  for (let i = 0; i <= seg; i++) {
    const a = -Math.PI / 2 + (Math.PI / 2) * (i / seg);
    pts.push([halfW - r + r * Math.cos(a), yFront + r + r * Math.sin(a)]);
  }
  pts.push([halfW, yRear], [-halfW, yRear]);
  return ensureCCW(cleanRing(pts));
}

/**
 * Shelf deck with a rear press-fit pocket (print pose: deck on z=0).
 * The slot is 5mm in from each side and 5mm forward from the back edge so the
 * back sign's lower edge can press in. Slot base is always ≥ 0.2 mm (never a
 * through-hole); base ≥ shelf thickness means solid / no slot.
 */
export function buildSignShelfWithMale(shelfW, shelfLen, shelfTh, backTh, cornerR = 0, dims = null) {
  const d = dims || signShelfPressFitDims(backTh, shelfTh);
  const yPlate = -backTh / 2;
  const len = Math.max(12, shelfLen);
  const yRear = yPlate;
  const yDeckFront = yRear - len;
  const halfW = Math.max(10, shelfW) / 2;
  const thS = Math.max(1.5, shelfTh);
  const outer = shelfDeckOutlineXy(halfW, yDeckFront, yRear, cornerR);
  const slotBase = Math.max(
    SIGN_SHELF_SLOT_BASE_MIN,
    Math.min(thS, Number.isFinite(d.slotBase) ? d.slotBase : SIGN_SHELF_SLOT_BASE_MIN),
  );
  const noSlot = slotBase >= thS - 0.01;
  const positions = [];
  const indices = [];
  const mapTop = (px, py) => [px, py, thS];
  const mapBot = (px, py) => [px, py, 0];
  if (noSlot) {
    extrudeShapeGroupBetween(
      positions, indices, { outer, holes: [] },
      mapTop, mapBot, (w) => [w[0], w[1]], "both", null,
    );
    return weldShelfMesh({ positions, indices }, 0.04);
  }
  const slotHalfW = Math.max(4, halfW - d.edgeInset);
  const slotRear = yRear - d.edgeInset;
  const slotFront = Math.max(yDeckFront + 2, slotRear - d.slotDepth);
  const slotHole = ensureCCW(cleanRing([
    [-slotHalfW, slotFront],
    [slotHalfW, slotFront],
    [slotHalfW, slotRear],
    [-slotHalfW, slotRear],
  ])).reverse();
  // Through cut, then plug the bottom so the pocket always keeps a floor.
  extrudeShapeGroupBetween(
    positions, indices, { outer, holes: [slotHole] },
    mapTop, mapBot, (w) => [w[0], w[1]], "both", null,
  );
  const slotFloor = ensureCCW(cleanRing([
    [-slotHalfW, slotFront],
    [slotHalfW, slotFront],
    [slotHalfW, slotRear],
    [-slotHalfW, slotRear],
  ]));
  const mapFloorTop = (px, py) => [px, py, slotBase];
  extrudeShapeGroupBetween(
    positions, indices, { outer: slotFloor, holes: [] },
    mapFloorTop, mapBot, (w) => [w[0], w[1]], "both", null,
  );
  return weldShelfMesh({ positions, indices }, 0.04);
}

/** Rotate a flat plate (XY face, +Z thickness) into print-upright back: height → Z, thickness → Y. */
export function uprightFlatSignMesh(mesh, H, th) {
  if (!mesh?.positions) return mesh;
  const P = mesh.positions;
  for (let i = 0; i < P.length; i += 3) {
    const x = P[i];
    const y = P[i + 1];
    const z = P[i + 2];
    P[i] = x;
    P[i + 1] = th / 2 - z;
    P[i + 2] = y + H / 2;
  }
  return mesh;
}

/** Inverse of uprightFlatSignMesh — lay upright back flat for face-up printing. */
export function flattenUprightSignMesh(mesh, H, th) {
  if (!mesh?.positions) return mesh;
  const P = mesh.positions;
  for (let i = 0; i < P.length; i += 3) {
    const x = P[i];
    const y = P[i + 1];
    const z = P[i + 2];
    P[i] = x;
    P[i + 1] = z - H / 2;
    P[i + 2] = th / 2 - y;
  }
  return mesh;
}

/** Two tapered ground spikes hanging from the plate bottom (garden stake sign). One extrusion
 * each, embedded a few mm into the plate so it unions cleanly. Returns merged { positions, indices }. */
export function buildGardenStakes(W, H, th, opts = {}) {
  const length = opts.length ?? 70;
  const topW = opts.topW ?? 9;
  const embed = 6;
  const topY = -H / 2 + embed;
  const positions = [];
  const indices = [];
  const flat = (w) => [w[0], w[1]];
  const mapTop = (px, py) => [px, py, th];
  const mapBot = (px, py) => [px, py, 0];
  for (const cx of [-W * 0.26, W * 0.26]) {
    const hw = topW / 2;
    const shoulderY = topY - length * 0.55;
    const pointY = topY - length;
    const outline = ensureCCW([
      [cx - hw, topY], [cx + hw, topY], [cx + hw, shoulderY], [cx, pointY], [cx - hw, shoulderY],
    ]);
    extrudeShapeGroupBetween(positions, indices, { outer: outline, holes: [] }, mapTop, mapBot, flat, "both", null);
  }
  return { positions, indices };
}

export { mountHoles, roundedRect, keyholeHole, shapeOutline };
