/**
 * Insert shelf dados — slide-in grooves on left/right walls (horizontal shelves).
 * Small body gap keeps Bambu from reporting Insert ↔ Body gcode conflicts.
 */

import { rectFeatureBounds, effectiveInsertTopClearance } from "./features.js?v=529";

export const INSERT_BODY_GAP = 0.12;

const WALL_EPS = 0.1;

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

function stitchSlices(outPos, outIdx, ring0, ring1) {
  const n = ring0.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    pushQuad(outPos, outIdx, ring0[i], ring0[j], ring1[j], ring1[i]);
  }
}

/** Shared shelf Z positions for horizontal (height-axis) dividers. */
export function computeHorizontalShelfLayout(meta, params) {
  const b = rectFeatureBounds(meta);
  const count = clamp(Math.round(params.insertCount ?? 1), 1, 4);
  const thickness = clamp(params.insertThickness ?? 2.4, 1.2, 5);
  const clearance = clamp(params.insertClearance ?? 0.35, 0.1, 1.2);
  const topClear = effectiveInsertTopClearance(params);
  const bodyGap = INSERT_BODY_GAP;
  const spanH = b.cavityH - (clearance + bodyGap) * 2 - topClear;
  if (spanH < 4) return null;
  const zBase = b.floor + clearance + bodyGap;
  const halfT = thickness / 2;
  const shelves = [];
  for (let i = 1; i <= count; i++) {
    const t = i / (count + 1);
    shelves.push({ z: zBase + t * spanH, halfT });
  }
  const wallClear = clearance + bodyGap;
  const spanD = b.innerD - wallClear * 2;
  const slotDepth = clamp(params.insertSlotDepth ?? 2, 1, 4);
  const shelfW = Math.max(8, b.innerW - slotDepth * 2 - bodyGap * 2);
  return { shelves, halfT, spanD, shelfW, wallClear, bodyGap, slotDepth };
}

function shelfGrooveSlice(signX, y, iw2, grooveDepth, zTop, zBot) {
  const xOuter = signX * (iw2 - WALL_EPS);
  const xInner = signX * (iw2 - grooveDepth);
  return [
    vec3(xOuter, y, zTop),
    vec3(xOuter, y, zBot),
    vec3(xInner, y, zBot),
    vec3(xInner, y, zTop),
  ];
}

/** Dados on left/right walls for each horizontal shelf — open toward front (−Y). */
export function appendInsertShelfSlotsToBody(outPos, outIdx, meta, params) {
  const layout = computeHorizontalShelfLayout(meta, params);
  if (!layout) return;
  const { shelves, slotDepth } = layout;
  const iw2 = meta.inner.w / 2;
  const id2 = meta.inner.d / 2;
  const margin = 2;
  const entryRamp = clamp(params.insertSlotRamp ?? 8, 4, 16);
  const yBack = id2 - margin;
  const yOpen = -id2 + margin;

  for (const { z, halfT } of shelves) {
    const zTop = z + halfT + INSERT_BODY_GAP;
    const zBot = z - halfT - INSERT_BODY_GAP;

    function extrudeWallGroove(signX) {
      const steps = Math.max(3, Math.round(entryRamp / 2));
      for (let i = 0; i < steps; i++) {
        const t0 = i / steps;
        const t1 = (i + 1) / steps;
        const y0 = yOpen + t0 * entryRamp;
        const y1 = yOpen + t1 * entryRamp;
        if (y0 > yBack) continue;
        stitchSlices(
          outPos,
          outIdx,
          shelfGrooveSlice(signX, Math.min(y0, yBack), iw2, slotDepth, zTop, zBot),
          shelfGrooveSlice(signX, Math.min(y1, yBack), iw2, slotDepth, zTop, zBot),
        );
      }
      const yMain0 = Math.min(yOpen + entryRamp, yBack);
      if (yMain0 < yBack) {
        stitchSlices(
          outPos,
          outIdx,
          shelfGrooveSlice(signX, yMain0, iw2, slotDepth, zTop, zBot),
          shelfGrooveSlice(signX, yBack, iw2, slotDepth, zTop, zBot),
        );
      }
    }

    extrudeWallGroove(-1);
    extrudeWallGroove(1);
  }
}
