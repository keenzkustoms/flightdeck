/**
 * Accent bands, emboss, honeycomb stamp, stackable hex grid, mesh merge.
 */

import { dilateMask, extrudeShapeGroup, extrudeShapeGroupBetween, filterDegenerateShapeGroups, groupPolygonsWithHoles, maskToPolygons, prepareShapeGroups, prepareSvgShapeGroups, prepareStrokePaths, previewMergeTraceShapeGroups, rasterizeShapeGroupsToMask, rasterizeStrokePathsToMask, simplifyPolygon, triangulateMappedCap, unionDenseEmbossShapeGroups, unionShapeGroupsToPrepared } from "./contour.js?v=241";
import { decorPlacementOffsets, decorArtRect, rotateFacePoint, rotateShapeGroup } from "./decor.js";
import {
  profileOutlineNormals,
  profileOutlineArcMetrics,
  resolveVaseTexture,
  vaseTextureDisplacement,
} from "./vase-textures.js";
import { sampleHoodieChestY, sampleHoodieBackY, HOODIE_ART_PROUD_MM } from "./hoodie-stubby.js?v=623";

export const EMBOSS_FONTS = [
  { id: "segoe-ui", label: "Segoe UI — Windows", family: '"Segoe UI Variable", "Segoe UI", system-ui, sans-serif', weight: 700 },
  { id: "bahnschrift", label: "Bahnschrift — Windows", family: 'Bahnschrift, "Segoe UI", sans-serif', weight: 600 },
  { id: "calibri", label: "Calibri — Office", family: 'Calibri, "Segoe UI", Candara, sans-serif', weight: 700 },
  { id: "candara", label: "Candara — Office", family: 'Candara, Calibri, sans-serif', weight: 700 },
  { id: "corbel", label: "Corbel — Office", family: 'Corbel, Calibri, sans-serif', weight: 700 },
  { id: "constantia", label: "Constantia — Office serif", family: "Constantia, Georgia, serif", weight: 700 },
  { id: "cambria", label: "Cambria — Office serif", family: "Cambria, Georgia, serif", weight: 700 },
  { id: "arial", label: "Arial — Windows sans", family: "Arial, Helvetica, sans-serif", weight: 700 },
  { id: "arial-black", label: "Arial Black — heavy", family: '"Arial Black", Arial, sans-serif', weight: 900 },
  { id: "tahoma", label: "Tahoma — Windows UI", family: 'Tahoma, "Segoe UI", sans-serif', weight: 400 },
  { id: "trebuchet", label: "Trebuchet MS — friendly", family: '"Trebuchet MS", Tahoma, sans-serif', weight: 400 },
  { id: "verdana", label: "Verdana — readable", family: "Verdana, Geneva, sans-serif", weight: 700 },
  { id: "segoe-print", label: "Segoe Print — casual", family: '"Segoe Print", "Segoe UI", cursive', weight: 400 },
  { id: "segoe-script", label: "Segoe Script — script", family: '"Segoe Script", "Segoe UI", cursive', weight: 400 },
  { id: "gabriola", label: "Gabriola — decorative", family: 'Gabriola, "Segoe UI", serif', weight: 400 },
  { id: "franklin", label: "Franklin Gothic — poster", family: '"Franklin Gothic Medium", Arial, sans-serif', weight: 500 },
  { id: "century-gothic", label: "Century Gothic — geometric", family: '"Century Gothic", Arial, sans-serif', weight: 700 },
  { id: "lucida-sans", label: "Lucida Sans — humanist", family: '"Lucida Sans Unicode", "Segoe UI", sans-serif', weight: 700 },
  { id: "palatino", label: "Palatino Linotype — book", family: '"Palatino Linotype", Georgia, serif', weight: 700 },
  { id: "book-antiqua", label: "Book Antiqua — classic", family: '"Book Antiqua", Palatino, serif', weight: 700 },
  { id: "garamond", label: "Garamond — elegant", family: 'Garamond, "Times New Roman", serif', weight: 700 },
  { id: "times", label: "Times New Roman — Office", family: '"Times New Roman", Times, serif', weight: 700 },
  { id: "georgia", label: "Georgia — serif", family: "Georgia, 'Times New Roman', serif", weight: 700 },
  { id: "sitka", label: "Sitka — reading", family: 'Sitka, Georgia, serif', weight: 700 },
  { id: "impact", label: "Impact — poster", family: 'Impact, "Arial Black", sans-serif', weight: 400 },
  { id: "haettenschweiler", label: "Haettenschweiler — narrow", family: "Haettenschweiler, Impact, sans-serif", weight: 400 },
  { id: "ms-sans", label: "Microsoft Sans Serif", family: '"Microsoft Sans Serif", Tahoma, sans-serif', weight: 400 },
  { id: "consolas", label: "Consolas — mono", family: 'Consolas, "Courier New", monospace', weight: 700 },
  { id: "courier", label: "Courier New — mono", family: '"Courier New", Courier, monospace', weight: 700 },
  { id: "lucida-console", label: "Lucida Console — mono", family: '"Lucida Console", Consolas, monospace', weight: 400 },
  { id: "inter", label: "Inter — clean sans", family: 'Inter, "Segoe UI", system-ui, sans-serif', weight: 700 },
  { id: "comic-sans", label: "Comic Sans MS — casual", family: '"Comic Sans MS", "Segoe Print", cursive', weight: 700 },
  { id: "ink-free", label: "Ink Free — handwritten", family: '"Ink Free", "Segoe Print", cursive', weight: 400 },
  { id: "ebrima", label: "Ebrima — humanist", family: 'Ebrima, "Segoe UI", sans-serif', weight: 700 },
  { id: "leelawadee", label: "Leelawadee UI — clean", family: '"Leelawadee UI", "Segoe UI", sans-serif', weight: 700 },
  { id: "nirmala", label: "Nirmala UI — light sans", family: '"Nirmala UI", "Segoe UI", sans-serif', weight: 700 },
  { id: "sylfaen", label: "Sylfaen — serif", family: 'Sylfaen, Georgia, serif', weight: 700 },
  { id: "rockwell", label: "Rockwell — slab", family: 'Rockwell, "Courier New", serif', weight: 700 },
  { id: "rockwell-condensed", label: "Rockwell Condensed — slab", family: '"Rockwell Condensed", Rockwell, serif', weight: 700 },
  { id: "bodoni", label: "Bodoni MT — fashion serif", family: '"Bodoni MT", "Times New Roman", serif', weight: 700 },
  { id: "bell-mt", label: "Bell MT — book serif", family: '"Bell MT", Georgia, serif', weight: 700 },
  { id: "perpetua", label: "Perpetua — refined serif", family: 'Perpetua, Georgia, serif', weight: 700 },
  { id: "baskerville", label: "Baskerville Old Face", family: '"Baskerville Old Face", Georgia, serif', weight: 700 },
  { id: "goudy", label: "Goudy Old Style — classic", family: '"Goudy Old Style", Georgia, serif', weight: 700 },
  { id: "copperplate", label: "Copperplate Gothic — engraved", family: '"Copperplate Gothic Bold", "Copperplate Gothic", serif', weight: 700 },
  { id: "elephant", label: "Elephant — heavy serif", family: 'Elephant, Georgia, serif', weight: 700 },
  { id: "bernard", label: "Bernard MT Condensed — bold", family: '"Bernard MT Condensed", Impact, serif', weight: 700 },
  { id: "cooper-black", label: "Cooper Black — chunky", family: '"Cooper Black", Georgia, serif', weight: 700 },
  { id: "britannic", label: "Britannic Bold — bold sans", family: '"Britannic Bold", "Arial Black", sans-serif', weight: 700 },
  { id: "berlin-sans", label: "Berlin Sans FB — geometric", family: '"Berlin Sans FB", "Century Gothic", sans-serif', weight: 700 },
  { id: "agency", label: "Agency FB — narrow sans", family: '"Agency FB", "Arial Narrow", sans-serif', weight: 700 },
  { id: "bauhaus", label: "Bauhaus 93 — retro", family: '"Bauhaus 93", "Century Gothic", sans-serif', weight: 400 },
  { id: "broadway", label: "Broadway — deco", family: 'Broadway, "Arial Black", serif', weight: 400 },
  { id: "stencil", label: "Stencil — military", family: 'Stencil, Impact, serif', weight: 700 },
  { id: "showcard", label: "Showcard Gothic — poster", family: '"Showcard Gothic", "Arial Black", sans-serif', weight: 400 },
  { id: "harrington", label: "Harrington — decorative", family: 'Harrington, Georgia, serif', weight: 400 },
  { id: "old-english", label: "Old English Text MT — blackletter", family: '"Old English Text MT", serif', weight: 400 },
  { id: "magneto", label: "Magneto — swashy", family: 'Magneto, "Segoe Script", cursive', weight: 700 },
  { id: "papyrus", label: "Papyrus — organic", family: 'Papyrus, "Segoe Print", fantasy', weight: 400 },
  { id: "brush-script", label: "Brush Script MT — script", family: '"Brush Script MT", "Segoe Script", cursive', weight: 400 },
  { id: "lucida-hand", label: "Lucida Handwriting — script", family: '"Lucida Handwriting", "Segoe Script", cursive', weight: 700 },
  { id: "monotype-corsiva", label: "Monotype Corsiva — calligraphy", family: '"Monotype Corsiva", "Segoe Script", cursive', weight: 400 },
  { id: "vivaldi", label: "Vivaldi — formal script", family: 'Vivaldi, "Segoe Script", cursive', weight: 400 },
  { id: "cascadia", label: "Cascadia Mono — code", family: '"Cascadia Mono", Consolas, monospace', weight: 700 },
  { id: "bebas", label: "Bebas Neue — label", family: '"Bebas Neue", Impact, sans-serif', weight: 400, google: "Bebas Neue" },
  { id: "anton", label: "Anton — display", family: 'Anton, Impact, sans-serif', weight: 400, google: "Anton" },
  { id: "oswald", label: "Oswald — condensed", family: 'Oswald, "Arial Narrow", sans-serif', weight: 700, google: "Oswald" },
  { id: "roboto", label: "Roboto — modern", family: "Roboto, Arial, sans-serif", weight: 700, google: "Roboto" },
  { id: "roboto-mono", label: "Roboto Mono — tech", family: '"Roboto Mono", "Courier New", monospace', weight: 700, google: "Roboto Mono" },
];

export function embossFontSpec(id) {
  return EMBOSS_FONTS.find((f) => f.id === id) || EMBOSS_FONTS[0];
}

/** Resolve CSS font-weight: "auto"/null → font default, else 100–900. */
export function resolveEmbossFontWeight(fontId, weightOverride) {
  const f = embossFontSpec(fontId);
  if (weightOverride == null || weightOverride === "" || weightOverride === "auto") {
    return f.weight || 700;
  }
  const n = Number(weightOverride);
  return Number.isFinite(n) ? clamp(Math.round(n), 100, 900) : (f.weight || 700);
}

export function embossFontStack(id, fontSizePx, weightOverride) {
  const f = embossFontSpec(id);
  const weight = resolveEmbossFontWeight(id, weightOverride);
  return `${weight} ${fontSizePx}px ${f.family}`;
}

/** Primary face only (no fallback stack) — used for Font Loading API checks/loads. */
function embossPrimaryFontFace(id, fontSizePx, weightOverride) {
  const f = embossFontSpec(id);
  if (!f.google) return embossFontStack(id, fontSizePx, weightOverride);
  const weight = resolveEmbossFontWeight(id, weightOverride);
  return `${weight} ${fontSizePx}px "${f.google}"`;
}

/**
 * Canvas stack: prefer the loaded Google face alone so Chrome doesn't mix
 * Oswald on some glyphs and Arial Narrow/Impact on others mid-string.
 */
function embossGenericFallback(f) {
  return (/serif/i.test(f.family) && !/sans[-\s]?serif/i.test(f.family)) ? "serif"
    : (/mono/i.test(f.family) ? "monospace" : "sans-serif");
}

function embossFontStackForCanvas(id, fontSizePx, text = "", weightOverride) {
  const f = embossFontSpec(id);
  const weight = resolveEmbossFontWeight(id, weightOverride);
  if (!f.google) return embossFontStack(id, fontSizePx, weightOverride);
  const generic = embossGenericFallback(f);
  // Only use the Google face if EVERY glyph in the label is loaded. document.fonts.check(font,
  // text) reports false while the face is only partially available — otherwise the browser
  // renders loaded glyphs (e.g. C, O) in the real font and missing ones (F, E) in a fallback at
  // a DIFFERENT size (the "CO bigger than FFEE" bug). If not fully ready, render every glyph in
  // one generic font so they're all consistent; the rebuild after load swaps in the real face.
  // Check FAMILY availability (no weight) — many Google faces don't ship the exact requested
  // weight, so a weight-specific check falsely fails and we'd lose the selected font entirely.
  const familyProbe = `${fontSizePx}px "${f.google}"`;
  const sample = String(text || "").replace(/\s+/g, "") || "AaGg";
  if (typeof document !== "undefined" && document.fonts?.check?.(familyProbe, sample)) {
    return `${weight} ${fontSizePx}px "${f.google}", ${generic}`;
  }
  return `${weight} ${fontSizePx}px ${generic}`;
}

export function embossFontReady(id, fontSizePx = 640) {
  const f = embossFontSpec(id);
  if (!f.google) return true;
  if (typeof document === "undefined" || !document.fonts?.check) return true;
  return document.fonts.check(embossPrimaryFontFace(id, fontSizePx));
}

const EMBOSS_FONT_LOAD_SIZES = [96, 640, 1280, 1792];
/** Label/sign text raster — higher = cleaner letter edges in the slicer (canvas-capped below). */
const LABEL_TEXT_FONT_PX = 1792;
const PREVIEW_TEXT_FONT_PX = 720;
/** Cap raster so long plaque lines stay under browser canvas limits. */
const TEXT_RASTER_MAX_EDGE = 6144;
/** Union re-raster ceiling for text (default contour maxDim 1024 was chewing letter curves). */
const TEXT_UNION_MAX_DIM = 2560;

/**
 * Load Google emboss faces at the sizes we actually raster at.
 * Pass sampleText so every glyph in the label is downloaded before preview rebuild.
 * Important: load `"Oswald"` alone — loading the fallback stack can resolve early
 * on Arial Narrow while Oswald is still missing (mixed CO vs FFEE).
 */
export async function ensureEmbossFontLoaded(id, sampleText = "") {
  if (typeof document === "undefined" || !document.fonts) return;
  const f = embossFontSpec(id);
  if (!f.google) return;
  const sample = String(sampleText || "")
    .replace(/\s+/g, "")
    || "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  try {
    await Promise.all(
      EMBOSS_FONT_LOAD_SIZES.map((size) =>
        document.fonts.load(embossPrimaryFontFace(id, size), sample)
      ),
    );
    if (document.fonts.ready) await document.fonts.ready;
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

/** Merge meshes with vertex snapping — welded dividers must share shell corner verts. */
export function mergeMeshesSnap(...parts) {
  const eps = 0.015;
  const positions = [];
  const indices = [];
  const table = new Map();

  function vertexIndex(x, y, z) {
    const k = `${Math.round(x / eps)}|${Math.round(y / eps)}|${Math.round(z / eps)}`;
    let idx = table.get(k);
    if (idx === undefined) {
      idx = positions.length / 3;
      positions.push(x, y, z);
      table.set(k, idx);
    }
    return idx;
  }

  for (const part of parts) {
    if (!part?.positions?.length || !part?.indices?.length) continue;
    const remap = new Array(part.positions.length / 3);
    for (let v = 0; v < part.positions.length; v += 3) {
      remap[v / 3] = vertexIndex(part.positions[v], part.positions[v + 1], part.positions[v + 2]);
    }
    for (let t = 0; t < part.indices.length; t++) {
      indices.push(remap[part.indices[t]]);
    }
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

function shapeGroupsBounds2d(groups) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const group of groups) {
    for (const ring of [group.outer, ...group.holes]) {
      for (const [x, y] of ring) {
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }
  if (!Number.isFinite(minX)) return null;
  return { minX, minY, maxX, maxY };
}

function scaleShapeGroupsToLocal(groups, minX, minY, stepMm) {
  const inv = 1 / stepMm;
  return groups.map((group) => ({
    outer: group.outer.map(([x, y]) => [(x - minX) * inv, (y - minY) * inv]),
    holes: group.holes.map((hole) => hole.map(([x, y]) => [(x - minX) * inv, (y - minY) * inv])),
  }));
}

/** Accent-style face decal — horizontal slabs hugging the wall (flat faces + wrap). */
function buildFaceDecalSlabMesh(frame, shapeGroups, opts = {}) {
  if (!shapeGroups?.length || !frame?.mapPoint) return null;
  if (!["front", "back", "left", "right", "wrap"].includes(frame.face)) return null;

  const stepMm = opts.stepMm ?? DECAL_LAYER_MM;
  const d0 = opts.d0 ?? ACCENT_SKIN_MM;
  const d1 = opts.d1 ?? (ACCENT_SKIN_MM + ACCENT_BAND_THICKNESS_MM);
  const bounds = shapeGroupsBounds2d(shapeGroups);
  if (!bounds) return null;

  const pad = stepMm;
  const grid = resolveSlabGrid(bounds, stepMm, pad);
  const effStep = grid.stepMm;
  const minX = bounds.minX - pad;
  const minY = bounds.minY - pad;
  const maxX = bounds.maxX + pad;
  const maxY = bounds.maxY + pad;
  const cols = grid.cols;
  const rows = grid.rows;

  const local = scaleShapeGroupsToLocal(shapeGroups, minX, minY, effStep);
  let mask = rasterizeShapeGroupsToMask(local, cols, rows);
  const dilatePasses = opts.dilatePasses ?? 1;
  if (dilatePasses > 0) mask = dilateMask(mask, cols, rows, dilatePasses);

  const positions = [];
  const indices = [];
  const w = (i, j, k) => [positions[i], positions[j], positions[k]];

  for (let row = 0; row < rows; row++) {
    const py0 = minY + row * effStep;
    const py1 = py0 + effStep;
    let col = 0;
    while (col < cols) {
      while (col < cols && !mask[row * cols + col]) col++;
      const start = col;
      while (col < cols && mask[row * cols + col]) col++;
      if (col <= start) continue;
      const px0 = minX + start * effStep;
      const px1 = minX + col * effStep;

      pushFaceSlabQuad(positions, indices, frame, px0, py0, px1, py1, d0, d1);
    }
  }

  return indices.length ? { positions, indices } : null;
}

function profileIsValid(profile) {
  return Array.isArray(profile) && profile.length >= 3;
}

/** Nudge accent sleeve outside the body shell — stops preview z-fight (negligible on print). */
const ACCENT_SKIN_MM = 0.12;
/** Radial depth of profile accent bands — visible in preview and slicer-safe for multi-material. */
const ACCENT_BAND_THICKNESS_MM = 0.45;
/** Layer-height slabs for face decals (same slice strategy as accent bands). */
const DECAL_LAYER_MM = 0.2;

function isHoodieArtParams(params) {
  return params?.shape === "stubbyHolder" || !!params?.__hoodieArtExport;
}

function hoodieGraphicParams(params) {
  if (!isHoodieArtParams(params)) return params;
  if ((params.embossFace || "front") === "front") return params;
  return { ...params, embossFace: "front" };
}

function majorityDownsampleMask(mask, srcW, srcH, dstW, dstH) {
  const out = new Uint8Array(dstW * dstH);
  if (!mask || !srcW || !srcH || !dstW || !dstH) return out;
  for (let y = 0; y < dstH; y++) {
    const y0 = Math.floor(y * srcH / dstH);
    const y1 = Math.max(y0 + 1, Math.ceil((y + 1) * srcH / dstH));
    for (let x = 0; x < dstW; x++) {
      const x0 = Math.floor(x * srcW / dstW);
      const x1 = Math.max(x0 + 1, Math.ceil((x + 1) * srcW / dstW));
      let on = 0, n = 0;
      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          n++;
          if (mask[sy * srcW + sx]) on++;
        }
      }
      out[y * dstW + x] = n && on * 2 >= n ? 1 : 0;
    }
  }
  return out;
}

function hoodieStampGrid(artW, artH, params) {
  // Bitmap logos need a grid that reflects the smallest printable feature, not
  // the source PNG's anti-aliased pixels.  Keep the fine grid for vector text
  // (for example the clean LITTLE 1959 back label), but simplify only the
  // coloured raster-art path before it becomes a watertight chest stamp.
  const rasterCleanup = !!params?.__hoodieRasterCleanup;
  let step = rasterCleanup ? 0.18 : (params?.__labelExportStandoff ? 0.06 : 0.07);
  let cols = Math.max(32, Math.round(artW / step));
  let rows = Math.max(32, Math.round(artH / step));
  const cap = rasterCleanup ? 300 : (params?.__labelExportStandoff ? 520 : 420);
  const maxStep = rasterCleanup ? 0.26 : 0.14;
  while (Math.max(cols, rows) > cap && step < maxStep) {
    step *= 1.1;
    cols = Math.max(32, Math.round(artW / step));
    rows = Math.max(32, Math.round(artH / step));
  }
  return { cols, rows };
}

/** Drop disconnected raster dust that cannot form a reliable 0.4 mm extrusion.
 * Eight-way connectivity preserves diagonal strokes and small enclosed details. */
function pruneHoodieRasterSpecks(mask, width, height, minCells = 5) {
  const out = mask instanceof Uint8Array ? mask.slice() : new Uint8Array(mask);
  const seen = new Uint8Array(out.length);
  const queue = new Int32Array(out.length);
  for (let start = 0; start < out.length; start++) {
    if (!out[start] || seen[start]) continue;
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    seen[start] = 1;
    while (head < tail) {
      const at = queue[head++];
      const x = at % width;
      const y = Math.floor(at / width);
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = x + dx;
          if (nx < 0 || nx >= width) continue;
          const next = ny * width + nx;
          if (!out[next] || seen[next]) continue;
          seen[next] = 1;
          queue[tail++] = next;
        }
      }
    }
    if (tail < minCells) {
      for (let i = 0; i < tail; i++) out[queue[i]] = 0;
    }
  }
  return out;
}

/** Painter-style shared-vertex shell on the draped chest — no layer-height scanlines. */
function buildHoodieFaceStampMesh(frame, mask, maskW, maskH, place, d0, d1, params) {
  if (!frame?.mapPoint || !mask?.length || maskW < 2 || maskH < 2) return null;
  const artW = place.artW;
  const artH = place.artHeight;
  if (!(artW > 0.5) || !(artH > 0.5)) return null;
  const { cols, rows } = hoodieStampGrid(artW, artH, params);
  let small = majorityDownsampleMask(mask, maskW, maskH, cols, rows);
  if (params?.__hoodieRasterCleanup) {
    // Heal one-cell cracks from PNG anti-aliasing, then remove little islands
    // that are smaller than a nozzle-width mark on the physical hoodie.
    small = closeBitmapMask(small, cols, rows, 1);
    small = pruneHoodieRasterSpecks(small, cols, rows);
  }
  small = resolveMaskDiagonalPinches(small, cols, rows);
  const cellU = artW / cols;
  const cellV = artH / rows;
  const thick = Math.max(0.16, d1 - d0);
  const xOff = place.xOff;
  const zOff = place.zOff;
  const rotation = params?.decorRotation ?? 0;
  const rotCx = xOff + artW / 2;
  const rotCy = zOff + artH / 2;
  const gw = cols + 1;
  const gh = rows + 1;
  const used = new Uint8Array(gw * gh);
  const onAt = (c, r) => c >= 0 && r >= 0 && c < cols && r < rows && small[r * cols + c];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!small[r * cols + c]) continue;
      used[r * gw + c] = 1;
      used[r * gw + c + 1] = 1;
      used[(r + 1) * gw + c] = 1;
      used[(r + 1) * gw + c + 1] = 1;
    }
  }
  const positions = [];
  const indices = [];
  const innerOf = new Int32Array(gw * gh);
  innerOf.fill(-1);
  const map = (c, r, offset) => {
    let ax = xOff + c * cellU;
    let ay = zOff + (rows - r) * cellV;
    if (rotation) {
      const p = rotateFacePoint(rotCx, rotCy, ax, ay, rotation);
      ax = p[0];
      ay = p[1];
    }
    return frame.mapPoint(ax, ay, offset);
  };
  for (let r = 0; r < gh; r++) {
    for (let c = 0; c < gw; c++) {
      const gi = r * gw + c;
      if (!used[gi]) continue;
      innerOf[gi] = positions.length / 3;
      const inn = map(c, r, d0);
      const out = map(c, r, d0 + thick);
      positions.push(inn[0], inn[1], inn[2], out[0], out[1], out[2]);
    }
  }
  const quad = (a, b, c, d) => {
    indices.push(a, b, c, a, c, d);
  };
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!small[r * cols + c]) continue;
      const i00 = innerOf[(r + 1) * gw + c];
      const i10 = innerOf[(r + 1) * gw + c + 1];
      const i11 = innerOf[r * gw + c + 1];
      const i01 = innerOf[r * gw + c];
      if (i00 < 0 || i10 < 0 || i11 < 0 || i01 < 0) continue;
      const o00 = i00 + 1, o10 = i10 + 1, o11 = i11 + 1, o01 = i01 + 1;
      quad(o00, o10, o11, o01);
      quad(i00, i01, i11, i10);
      if (!onAt(c, r + 1)) quad(i00, i10, o10, o00);
      if (!onAt(c, r - 1)) quad(i01, o01, o11, i11);
      if (!onAt(c - 1, r)) quad(i00, o00, o01, i01);
      if (!onAt(c + 1, r)) quad(i10, i11, o11, o10);
    }
  }
  return indices.length ? { positions, indices } : null;
}

/** Wrap preview art — raster slabs (no earcut on curved wall). */
const WRAP_DECAL_STEP_MM = 0.4;
const WRAP_DECAL_TARGET_COLS = 560;
const WRAP_DECAL_STEP_MIN_MM = 0.08;
const WRAP_DECAL_STEP_MAX_MM = 0.26;
/** Finer slabs for vector SVG on wrap — seam-unwrapped run shells (no earcut on curve). */
const WRAP_SVG_DECAL_TARGET_COLS = 1600;
const WRAP_SVG_DECAL_TARGET_COLS_PREVIEW = 380;
const WRAP_SVG_DECAL_STEP_MIN_MM = 0.03;
const WRAP_SVG_DECAL_STEP_MAX_MM = 0.075;
const WRAP_SVG_DECAL_STEP_MAX_MM_PREVIEW = 0.11;
const WRAP_SVG_MASK_MAX_CELLS = 3072;
const WRAP_SVG_PREVIEW_MAX_INDICES = 96000;
const WRAP_TRACE_PREVIEW_MAX_ROWS = 420;
const WRAP_ART_VERTICAL_GUTTER_MM = 1.4;

/** Coarsen row step uniformly so preview stays under triangle budget — never chop mid-art. */
function wrapSlabRowStepPx(maskH, stepPx, { maxRows = 2048, maxPreviewIndices = 0 } = {}) {
  let step = Math.max(1, stepPx || 1);
  if (maskH > maxRows * step) step = Math.max(step, Math.ceil(maskH / maxRows));
  if (maxPreviewIndices > 0) {
    const rowCap = Math.max(24, Math.floor(maxPreviewIndices / (3 * 36)));
    if (Math.ceil(maskH / step) > rowCap) step = Math.max(step, Math.ceil(maskH / rowCap));
  }
  return step;
}

function wrapSafeArtHeight(frame, requestedHeight) {
  const target = clamp(requestedHeight ?? 16, 6, 56);
  if (frame?.face !== "wrap") return target;
  const usable = Math.max(6, (frame.faceH ?? target) - WRAP_ART_VERTICAL_GUTTER_MM * 2);
  return Math.min(target, usable);
}

function wrapDecalStepMm(shapeGroups) {
  const bounds = shapeGroupsBounds2d(shapeGroups);
  if (!bounds) return WRAP_DECAL_STEP_MM;
  const span = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY, 1);
  return clamp(span / WRAP_DECAL_TARGET_COLS, WRAP_DECAL_STEP_MIN_MM, WRAP_DECAL_STEP_MAX_MM);
}

function wrapSvgDecalStepMm(shapeGroups) {
  const bounds = shapeGroupsBounds2d(shapeGroups);
  if (!bounds) return WRAP_SVG_DECAL_STEP_MIN_MM;
  const span = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY, 1);
  return clamp(span / WRAP_SVG_DECAL_TARGET_COLS, WRAP_SVG_DECAL_STEP_MIN_MM, WRAP_SVG_DECAL_STEP_MAX_MM);
}

function resolveSlabGrid(bounds, stepMm, pad, maxCells = 2048) {
  const w = Math.max(bounds.maxX - bounds.minX + pad * 2, stepMm);
  const h = Math.max(bounds.maxY - bounds.minY + pad * 2, stepMm);
  let step = stepMm;
  let cols = Math.max(1, Math.ceil(w / step));
  let rows = Math.max(1, Math.ceil(h / step));
  while (Math.max(cols, rows) > maxCells && step < 1.2) {
    step *= 1.2;
    cols = Math.max(1, Math.ceil(w / step));
    rows = Math.max(1, Math.ceil(h / step));
  }
  return { stepMm: step, cols, rows };
}

function pushFaceSlabQuad(positions, indices, frame, px0, py0, px1, py1, d0, d1) {
  const c00 = frame.mapPoint(px0, py0, d0);
  const c10 = frame.mapPoint(px1, py0, d0);
  const c11 = frame.mapPoint(px1, py1, d0);
  const c01 = frame.mapPoint(px0, py1, d0);
  const o00 = frame.mapPoint(px0, py0, d1);
  const o10 = frame.mapPoint(px1, py0, d1);
  const o11 = frame.mapPoint(px1, py1, d1);
  const o01 = frame.mapPoint(px0, py1, d1);
  pushQuad(positions, indices, vec3(...o00), vec3(...o10), vec3(...o11), vec3(...o01));
  pushQuad(positions, indices, vec3(...c00), vec3(...c01), vec3(...c11), vec3(...c10));
  pushQuad(positions, indices, vec3(...c00), vec3(...c10), vec3(...o10), vec3(...o00));
  pushQuad(positions, indices, vec3(...c01), vec3(...o01), vec3(...o11), vec3(...c11));
  pushQuad(positions, indices, vec3(...c00), vec3(...o00), vec3(...o01), vec3(...c01));
  pushQuad(positions, indices, vec3(...c10), vec3(...c11), vec3(...o11), vec3(...o10));
}

function bitmapWrapPlacement(frame, params, bitmap) {
  const artHCap = wrapSafeArtHeight(frame, params.embossTraceSize ?? 16);
  const maxW = Math.min(frame.faceW * 0.62, 56);
  const maskW = Math.max(1, Math.round(bitmap.width));
  const maskH = Math.max(1, Math.round(bitmap.height));
  const scale = Math.min(artHCap / maskH, maxW / maskW);
  if (!Number.isFinite(scale) || scale <= 0) return null;
  const artW = maskW * scale;
  const artHeight = maskH * scale;
  const { xOff, zOff } = decorPlacementOffsets(params, frame, artW, artHeight);
  return { maskW, maskH, scale, artW, artHeight, xOff, zOff };
}

function bandMaskFilled(mask, width, py0, py1, col) {
  for (let py = py0; py < py1; py++) {
    if (mask[py * width + col]) return true;
  }
  return false;
}

/** Radial shell for one mask run — outer skin + side walls; no horizontal caps between rows (z-fight). */
function pushWrapRunShell(outPos, outIdx, frame, px0, py0, px1, py1, d0, d1, { solid = false } = {}) {
  const o00 = vec3(...frame.mapPoint(px0, py0, d1));
  const o10 = vec3(...frame.mapPoint(px1, py0, d1));
  const o11 = vec3(...frame.mapPoint(px1, py1, d1));
  const o01 = vec3(...frame.mapPoint(px0, py1, d1));
  pushQuad(outPos, outIdx, o00, o10, o11, o01);
  if (!solid) return;
  const i00 = vec3(...frame.mapPoint(px0, py0, d0));
  const i10 = vec3(...frame.mapPoint(px1, py0, d0));
  const i11 = vec3(...frame.mapPoint(px1, py1, d0));
  const i01 = vec3(...frame.mapPoint(px0, py1, d0));
  pushQuad(outPos, outIdx, i00, i01, i11, i10);
  pushQuad(outPos, outIdx, i00, o00, o01, i01);
  pushQuad(outPos, outIdx, i10, i11, o11, o10);
}


function shouldUseWrapRunSlabs(bitmap) {
  if (bitmap.shapeGroups?.length && bitmap.shapeGroupsUnited) return false;
  if (!bitmap?.mask?.length) return true;
  if (bitmap.rasterSimplified) return false;
  if (bitmap.mode === "outline" && (bitmap.rects?.length ?? 0) > 3500) return false;
  return true;
}

function erodeBitmapMask(mask, width, height) {
  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (!mask[idx]) continue;
      let keep = 1;
      for (let dy = -1; dy <= 1 && keep; dy++) {
        for (let dx = -1; dx <= 1 && keep; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height || !mask[ny * width + nx]) keep = 0;
        }
      }
      out[idx] = keep;
    }
  }
  return out;
}

function closeBitmapMask(mask, width, height, passes = 1) {
  let out = mask instanceof Uint8Array ? mask.slice() : new Uint8Array(mask);
  for (let i = 0; i < passes; i++) out = dilateMask(out, width, height);
  for (let i = 0; i < passes; i++) out = erodeBitmapMask(out, width, height);
  return out;
}

function prepareComplexTraceMaskForContours(mask, width, height, bitmap) {
  if (!bitmap?.rasterSimplified) return mask;
  const passes = width >= 1400 ? 2 : 1;
  return closeBitmapMask(mask, width, height, passes);
}

/** Heavy wrap line art (block logos / dense text) — solid contour, not 1px row shells. */
function wrapLineArtNeedsSolidEmboss(bitmap) {
  const fill = bitmap.maskFillPct ?? 0;
  if (fill >= 28) return true;
  if (fill >= 22 && (bitmap.rectCount ?? 0) >= 5000) return true;
  return false;
}

function downsampleBitmapMask(mask, maskW, maskH, factor = 2) {
  if (factor <= 1) return { mask, maskW, maskH };
  const nw = Math.max(1, Math.floor(maskW / factor));
  const nh = Math.max(1, Math.floor(maskH / factor));
  const out = new Uint8Array(nw * nh);
  for (let y = 0; y < nh; y++) {
    const sy0 = Math.floor((y / nh) * maskH);
    const sy1 = Math.max(sy0 + 1, Math.floor(((y + 1) / nh) * maskH));
    for (let x = 0; x < nw; x++) {
      const sx0 = Math.floor((x / nw) * maskW);
      const sx1 = Math.max(sx0 + 1, Math.floor(((x + 1) / nw) * maskW));
      let on = 0;
      for (let sy = sy0; sy < sy1 && !on; sy++) {
        for (let sx = sx0; sx < sx1; sx++) {
          if (mask[sy * maskW + sx]) on = 1;
        }
      }
      if (on) out[y * nw + x] = 1;
    }
  }
  return { mask: out, maskW: nw, maskH: nh };
}

/** Light mask close for dense wrap line art — same row shells as coffee bag. */
function preprocessWrapDenseLineArtMask(bitmap, maskW, maskH) {
  let mask = bitmap.mask instanceof Uint8Array ? bitmap.mask.slice() : new Uint8Array(bitmap.mask);
  mask = closeBitmapMask(mask, maskW, maskH, 1);
  return { ...bitmap, mask: Array.from(mask) };
}

/** Split wide horizontal runs so quads hug the cylinder (full-width text rows). */
function pushWrapRunShellSpan(outPos, outIdx, frame, px0, px1, my0, my1, d0, d1, opts = {}) {
  const maxRunMm = opts.maxRunMm;
  if (frame.face !== "wrap" || !maxRunMm || maxRunMm <= 0) {
    pushWrapRunShell(outPos, outIdx, frame, px0, my0, px1, my1, d0, d1, opts);
    return;
  }
  let a = px0;
  let b = px1;
  if (b < a) [a, b] = [b, a];
  const span = b - a;
  if (span <= maxRunMm) {
    pushWrapRunShell(outPos, outIdx, frame, a, my0, b, my1, d0, d1, opts);
    return;
  }
  const n = Math.ceil(span / maxRunMm);
  for (let i = 0; i < n; i++) {
    const sx0 = a + (span * i) / n;
    const sx1 = a + (span * (i + 1)) / n;
    pushWrapRunShell(outPos, outIdx, frame, sx0, my0, sx1, my1, d0, d1, opts);
  }
}

/** Fill one cell of every 2×2 checkerboard so mask contours never pinch at a shared corner
 * (a pinch vertex extrudes into an edge shared by 4 walls — non-manifold in slicers). */
function resolveMaskDiagonalPinches(mask, width, height) {
  let out = mask;
  for (let pass = 0; pass < 4; pass++) {
    let fixed = 0;
    for (let y = 0; y < height - 1; y++) {
      for (let x = 0; x < width - 1; x++) {
        const a = out[y * width + x];
        const b = out[y * width + x + 1];
        const c = out[(y + 1) * width + x];
        const d = out[(y + 1) * width + x + 1];
        if ((a && d && !b && !c) || (b && c && !a && !d)) {
          if (out === mask) out = mask.slice();
          out[y * width + x] = 1;
          out[y * width + x + 1] = 1;
          fixed++;
        }
      }
    }
    if (!fixed) break;
  }
  return out;
}

/** Flat-face trace solid — voxel-lattice surface extraction, manifold by construction.
 * Replaces per-row run shells on flat faces: those tubes have no top/bottom caps, so a
 * line-art trace exports tens of thousands of open edges (Bambu "non-manifold edges" spam,
 * e.g. 90k on the coffee canister). Earcut on giant pixel-exact multi-hole contours is not
 * reliable either (b358-b362 shred history) — so no triangulation library at all:
 * caps are emitted per run, subdivided at the neighbouring rows' run breakpoints (kills
 * T-junctions), walls only where a filled cell borders an empty one, and every vertex is
 * shared through one lattice cache. Same voxel silhouette as the row shells, zero open edges. */
function buildFlatTraceSolidMesh(frame, mask, maskW, maskH, place, params, d0, d1, stepPx = 1) {
  const { scale, artW, artHeight, xOff, zOff } = place;
  // Row-band merge (same as the old run shells' stepPx) — keeps preview light and 3MF small.
  let bandBounds = null;
  let bandH = maskH;
  let m = mask;
  if (stepPx > 1) {
    bandH = Math.ceil(maskH / stepPx);
    bandBounds = new Array(bandH + 1);
    const merged = new Uint8Array(bandH * maskW);
    for (let b = 0; b < bandH; b++) {
      const y0 = b * stepPx;
      const y1 = Math.min(maskH, y0 + stepPx);
      bandBounds[b] = y0;
      for (let y = y0; y < y1; y++) {
        for (let x = 0; x < maskW; x++) {
          if (mask[y * maskW + x]) merged[b * maskW + x] = 1;
        }
      }
    }
    bandBounds[bandH] = maskH;
    m = merged;
  }
  m = resolveMaskDiagonalPinches(m, maskW, bandH);
  const rotation = params?.decorRotation ?? 0;
  const rotCx = xOff + artW / 2;
  const rotCy = zOff + artHeight / 2;
  const fx = (px) => xOff + px * scale;
  const fy = (p) => zOff + (maskH - (bandBounds ? bandBounds[p] : p)) * scale;

  const positions = [];
  const indices = [];
  const vcache = new Map();
  const vert = (x, p, z) => {
    const key = `${x}|${p}|${z}`;
    let idx = vcache.get(key);
    if (idx === undefined) {
      let ax = fx(x);
      let ay = fy(p);
      if (rotation) {
        const r = rotateFacePoint(rotCx, rotCy, ax, ay, rotation);
        ax = r[0];
        ay = r[1];
      }
      const w = frame.mapPoint(ax, ay, z);
      idx = positions.length / 3;
      positions.push(w[0], w[1], w[2]);
      vcache.set(key, idx);
    }
    return idx;
  };
  const tri = (a, b, c) => indices.push(a, b, c);
  const quad = (a, b, c, d) => { tri(a, b, c); tri(a, c, d); };

  // Runs per row + breakpoint (run endpoint) sets per row.
  const rows = [];
  const breaks = [];
  for (let y = 0; y < bandH; y++) {
    const runs = [];
    const bset = new Set();
    let x = 0;
    while (x < maskW) {
      while (x < maskW && !m[y * maskW + x]) x++;
      const s = x;
      while (x < maskW && m[y * maskW + x]) x++;
      if (x > s) {
        runs.push([s, x]);
        bset.add(s);
        bset.add(x);
      }
    }
    rows.push(runs);
    breaks.push(bset);
  }
  const chainXs = (x0, x1, nbrBreaks) => {
    const xs = [x0];
    if (nbrBreaks) {
      for (const b of nbrBreaks) if (b > x0 && b < x1) xs.push(b);
    }
    xs.push(x1);
    return xs.sort((a, b) => a - b);
  };
  // Merge-triangulate a cap between its north chain (boundary p) and south chain (boundary p+1).
  // ccw=true → counter-clockwise in (x, face-y) for the outward (d1) cap.
  const cap = (northXs, southXs, y, z, ccw) => {
    const N = northXs.map((x) => vert(x, y, z));
    const S = southXs.map((x) => vert(x, y + 1, z));
    let i = 0;
    let j = 0;
    while (i + 1 < N.length || j + 1 < S.length) {
      const nextN = i + 1 < N.length ? northXs[i + 1] : Infinity;
      const nextS = j + 1 < S.length ? southXs[j + 1] : Infinity;
      if (nextN <= nextS) {
        if (ccw) tri(S[j], N[i + 1], N[i]);
        else tri(S[j], N[i], N[i + 1]);
        i++;
      } else {
        if (ccw) tri(S[j + 1], N[i], S[j]);
        else tri(S[j + 1], S[j], N[i]);
        j++;
      }
    }
  };

  for (let y = 0; y < bandH; y++) {
    for (const [x0, x1] of rows[y]) {
      const northXs = chainXs(x0, x1, y > 0 ? breaks[y - 1] : null);
      const southXs = chainXs(x0, x1, y + 1 < bandH ? breaks[y + 1] : null);
      cap(northXs, southXs, y, d1, true);   // outer skin
      cap(northXs, southXs, y, d0, false);  // inner skin
      // Vertical end walls (left/right of run).
      quad(vert(x0, y + 1, d0), vert(x0, y + 1, d1), vert(x0, y, d1), vert(x0, y, d0));
      quad(vert(x1, y, d0), vert(x1, y, d1), vert(x1, y + 1, d1), vert(x1, y + 1, d0));
      // Horizontal boundary walls — only where the neighbouring row cell is empty.
      const wallRow = (p, nbrY, northSide) => {
        let a = x0;
        while (a < x1) {
          const nbrFilled = (x) => nbrY >= 0 && nbrY < bandH && m[nbrY * maskW + x] === 1;
          while (a < x1 && nbrFilled(a)) a++;
          const s = a;
          while (a < x1 && !nbrFilled(a)) a++;
          if (a <= s) continue;
          if (northSide) quad(vert(s, p, d0), vert(s, p, d1), vert(a, p, d1), vert(a, p, d0));
          else quad(vert(a, p, d0), vert(a, p, d1), vert(s, p, d1), vert(s, p, d0));
        }
      };
      wallRow(y, y - 1, true);
      wallRow(y + 1, y + 1, false);
    }
  }
  return indices.length ? { positions, indices } : null;
}

/** Flat-face solid from vector shape groups (face-mm coords) — rasterize + voxel surface.
 * Earcut letter/graphic solids leak open edges (glyph rings collapse under the 3MF weld,
 * earcut drops caps on awkward contours — Text shipped 3,264 non-manifold edges on b373).
 * 0.05 mm cells are invisible at a 0.42 mm nozzle; rows band-merge like the art layers. */
export function buildFlatShapeGroupsSolidMesh(frame, shapeGroups, d0, d1, params) {
  const bounds = shapeGroupsBounds2d(shapeGroups);
  if (!bounds || !frame?.mapPoint || frame.face === "wrap") return null;
  const spanX = Math.max(bounds.maxX - bounds.minX, 0.2);
  const spanY = Math.max(bounds.maxY - bounds.minY, 0.2);
  // Label/sign solids: finer voxels so light letter stems stay crisp at 0.4 mm nozzles.
  // Hoodie: rasterize fine, then Painter-style shared-vertex stamp (no 0.22 mm / layer bands).
  let stepMm = params?.__labelExportStandoff ? 0.035 : 0.05;
  if (isHoodieArtParams(params)) stepMm = params?.__labelExportStandoff ? 0.06 : 0.07;
  const maxDim = params?.__labelExportStandoff ? 2800 : 1600;
  if (spanX / stepMm > maxDim || spanY / stepMm > maxDim) {
    stepMm = Math.max(spanX, spanY) / maxDim;
  }
  const pad = stepMm * 2;
  const minX = bounds.minX - pad;
  const minY = bounds.minY - pad;
  const maskW = Math.max(4, Math.ceil((spanX + pad * 2) / stepMm));
  const maskH = Math.max(4, Math.ceil((spanY + pad * 2) / stepMm));
  const local = scaleShapeGroupsToLocal(shapeGroups, minX, minY, stepMm);
  const raster = rasterizeShapeGroupsToMask(local, maskW, maskH);
  if (!raster?.length) return null;
  // Builder draws row 0 at the TOP (face-y = zOff + maskH*scale) — flip rows so text isn't mirrored.
  const mask = new Uint8Array(maskW * maskH);
  for (let y = 0; y < maskH; y++) {
    mask.set(raster.subarray((maskH - 1 - y) * maskW, (maskH - y) * maskW), y * maskW);
  }
  const place = {
    scale: stepMm,
    xOff: minX,
    zOff: minY,
    artW: maskW * stepMm,
    artHeight: maskH * stepMm,
  };
  // Band rows to layer height on export (same as art); rotation already baked into the groups.
  const solidParams = params?.decorRotation ? { ...params, decorRotation: 0 } : params;
  if (isHoodieArtParams(params)) {
    return buildHoodieFaceStampMesh(frame, mask, maskW, maskH, place, d0, d1, solidParams);
  }
  const stepPx = params?.__labelExportStandoff ? Math.max(1, Math.round(DECAL_LAYER_MM / stepMm)) : 1;
  return buildFlatTraceSolidMesh(frame, mask, maskW, maskH, place, solidParams, d0, d1, stepPx);
}

/** Wrap trace from pixel mask — radial shells (no earcut slashes, no row-cap z-fight). */
function buildWrapTraceSlabMesh(frame, bitmap, params, shapeGroups, d0, d1, opts = {}) {
  const place = bitmapWrapPlacement(frame, params, bitmap);
  if (!place) return null;
  const { maskW, maskH, scale, artW, artHeight, xOff, zOff } = place;
  const hasMask = bitmap.mask?.length === maskW * maskH;
  if (!hasMask && !shapeGroups?.length) return null;
  const rotation = params.decorRotation ?? 0;
  let groups = shapeGroups;
  if (rotation && groups?.length) {
    groups = shapeGroups.map((g) => rotateShapeGroup(g, maskW / 2, maskH / 2, rotation));
  }
  let mask;
  if (hasMask) {
    mask = bitmap.mask instanceof Uint8Array ? bitmap.mask : new Uint8Array(bitmap.mask);
  } else {
    mask = rasterizeShapeGroupsToMask(groups, maskW, maskH);
  }
  const preview = svgIsPreview(params);
  const maxRows = preview ? WRAP_TRACE_PREVIEW_MAX_ROWS : 2048;
  let stepPx = 1;
  // Layer-height stepping is for flat face decals — on wrap trace it causes visible horizontal bands in slicers.
  if (params?.__labelExportStandoff && !opts.fineRows) {
    stepPx = Math.max(1, Math.round(DECAL_LAYER_MM / scale));
  }
  stepPx = wrapSlabRowStepPx(maskH, stepPx, {
    maxRows: opts.fineRows ? maskH : maxRows,
    maxPreviewIndices: opts.fineRows ? 0 : (preview ? WRAP_SVG_PREVIEW_MAX_INDICES : 0),
  });

  // Flat faces: closed voxel-surface solid — row shells are wrap-only. Their tubes have no
  // top/bottom caps, so flat line-art traces exported tens of thousands of open edges
  // (Bambu "non-manifold edges" spam — 90k on the coffee canister).
  if (frame.face !== "wrap") {
    // Rasterized groups were already rotated in px space — don't rotate twice.
    const solidParams = !hasMask && rotation ? { ...params, decorRotation: 0 } : params;
    if (isHoodieArtParams(params)) {
      const stamp = buildHoodieFaceStampMesh(frame, mask, maskW, maskH, place, d0, d1, solidParams);
      if (stamp) return stamp;
      const fine = buildFlatTraceSolidMesh(frame, mask, maskW, maskH, place, solidParams, d0, d1, 1);
      if (fine) return fine;
    }
    const solid = buildFlatTraceSolidMesh(frame, mask, maskW, maskH, place, solidParams, d0, d1, stepPx);
    if (solid) return solid;
  }

  const positions = [];
  const indices = [];
  const wrapSeam = frame.face === "wrap" && frame.faceW > 0;
  const anchorX = place.anchorX ?? xOff + artW / 2;
  const mapRunX = (px) => (wrapSeam ? unwrapWrapX(px, anchorX, frame.faceW) : px);
  const runOpts = {
    solid: true,
    maxRunMm: wrapSeam ? clamp(artW * (params?.__labelExportStandoff ? 0.18 : 0.12), 3.5, params?.__labelExportStandoff ? 14 : 8) : 0,
  };
  for (let row = 0; row < maskH; row += stepPx) {
    const py0 = row;
    const py1 = Math.min(maskH, row + stepPx);
    const my0 = zOff + (maskH - py1) * scale;
    const my1 = zOff + (maskH - py0) * scale;
    let col = 0;
    while (col < maskW) {
      while (col < maskW && !bandMaskFilled(mask, maskW, py0, py1, col)) col++;
      const start = col;
      while (col < maskW && bandMaskFilled(mask, maskW, py0, py1, col)) col++;
      if (col <= start) continue;
      const px0 = mapRunX(xOff + start * scale);
      const px1 = mapRunX(xOff + col * scale);
      pushWrapRunShellSpan(positions, indices, frame, px0, px1, my0, my1, d0, d1, runOpts);
    }
  }
  return indices.length ? { positions, indices } : null;
}

/** Wrap art slabs — pixel mask + seam-unwrapped runs (same strategy as traced bitmap). */
function buildWrapArtSlabMesh(frame, shapeGroups, d0, d1, opts = {}) {
  const bounds = shapeGroupsBounds2d(shapeGroups);
  if (!bounds || !frame?.mapPoint) return null;

  const spanX = Math.max(bounds.maxX - bounds.minX, 0.4);
  const spanY = Math.max(bounds.maxY - bounds.minY, 0.4);
  const targetCols = opts.targetCols ?? WRAP_SVG_DECAL_TARGET_COLS;
  const stepMin = opts.stepMin ?? WRAP_SVG_DECAL_STEP_MIN_MM;
  const stepMax = opts.stepMax ?? WRAP_SVG_DECAL_STEP_MAX_MM;
  let stepMm = opts.stepMm ?? clamp(spanX / targetCols, stepMin, stepMax);
  stepMm = clamp(stepMm, stepMin, stepMax);

  const pad = stepMm;
  const minX = bounds.minX - pad;
  const minY = bounds.minY - pad;
  let maskW = Math.max(8, Math.ceil((spanX + pad * 2) / stepMm));
  let maskH = Math.max(8, Math.ceil((spanY + pad * 2) / stepMm));
  const maxCells = opts.maxCells ?? WRAP_SVG_MASK_MAX_CELLS;
  while (Math.max(maskW, maskH) > maxCells && stepMm < 1.2) {
    stepMm *= 1.15;
    maskW = Math.max(8, Math.ceil((spanX + pad * 2) / stepMm));
    maskH = Math.max(8, Math.ceil((spanY + pad * 2) / stepMm));
  }

  const local = scaleShapeGroupsToLocal(shapeGroups, minX, minY, stepMm);
  let mask = rasterizeShapeGroupsToMask(local, maskW, maskH);
  const dilate = opts.dilatePasses ?? 1;
  if (dilate > 0) mask = dilateMask(mask, maskW, maskH, dilate);
  if (dilate > 0) mask = closeBitmapMask(mask, maskW, maskH, 1);

  const anchorX = (bounds.minX + bounds.maxX) / 2;
  const scale = stepMm;
  const xOff = minX;
  const maxRows = opts.maxRows ?? 2048;
  let stepPx = 1;
  if (maskH > maxRows) stepPx = Math.max(1, Math.ceil(maskH / maxRows));
  stepPx = wrapSlabRowStepPx(maskH, stepPx, {
    maxRows: opts.previewMaxRows ?? maxRows,
    maxPreviewIndices: opts.maxPreviewIndices ?? 0,
  });

  const positions = [];
  const indices = [];
  const exportSolid = opts.solid !== false;
  for (let row = 0; row < maskH; row += stepPx) {
    const py0 = row;
    const py1 = Math.min(maskH, row + stepPx);
    const my0 = minY + py0 * scale;
    const my1 = minY + py1 * scale;
    let col = 0;
    while (col < maskW) {
      while (col < maskW && !bandMaskFilled(mask, maskW, py0, py1, col)) col++;
      const start = col;
      while (col < maskW && bandMaskFilled(mask, maskW, py0, py1, col)) col++;
      if (col <= start) continue;
      const px0 = unwrapWrapX(xOff + start * scale, anchorX, frame.faceW);
      const px1 = unwrapWrapX(xOff + col * scale, anchorX, frame.faceW);
      pushWrapRunShell(positions, indices, frame, px0, my0, px1, my1, d0, d1, { solid: exportSolid });
    }
  }
  return indices.length ? { positions, indices } : null;
}

/** Extra radial push when a band is marked "on top" over another. */
const ACCENT_LAYER_BUMP_MM = 0.22;

function ensureProfileCCW(points) {
  if (polygonSignedArea2(points) < 0) return points.slice().reverse();
  return points;
}

function offsetProfileInward(points, offset) {
  if (!offset || offset <= 0) return points;
  return offsetProfileEdgeJoin(points, -offset);
}

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

function polygonSignedArea2(pts) {
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    area += pts[i][0] * pts[j][1] - pts[j][0] * pts[i][1];
  }
  return area / 2;
}

/** Offset a closed profile along exterior vertex normals — correct on concave outlines (star, heart). */
function offsetProfileByNormals(points, offset) {
  if (!offset || offset <= 0 || points.length < 3) return points;
  return offsetProfileEdgeJoin(points, offset);
}

function lineLineIntersect(a0, a1, b0, b1) {
  const dax = a1[0] - a0[0];
  const day = a1[1] - a0[1];
  const dbx = b1[0] - b0[0];
  const dby = b1[1] - b0[1];
  const denom = dax * dby - day * dbx;
  if (Math.abs(denom) < 1e-12) return null;
  const t = ((b0[0] - a0[0]) * dby - (b0[1] - a0[1]) * dbx) / denom;
  return [a0[0] + dax * t, a0[1] + day * t];
}

/**
 * Robust outward offset — intersects parallel offset edges (fixes heart cleft /
 * star notches where vertex-normal miters fold through the wall).
 */
function offsetProfileEdgeJoin(points, offset) {
  const ccw = polygonSignedArea2(points) > 0;
  const sign = ccw ? 1 : -1;
  const n = points.length;
  const edges = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const dx = points[j][0] - points[i][0];
    const dy = points[j][1] - points[i][1];
    const len = Math.hypot(dx, dy) || 1;
    const nx = sign * (dy / len);
    const ny = sign * (-dx / len);
    edges.push({
      p0: [points[i][0] + nx * offset, points[i][1] + ny * offset],
      p1: [points[j][0] + nx * offset, points[j][1] + ny * offset],
      nx,
      ny,
    });
  }
  const out = [];
  const maxSpike = offset * 2.8;
  for (let i = 0; i < n; i++) {
    const prev = edges[(i - 1 + n) % n];
    const curr = edges[i];
    const currPt = points[i];
    let pt = lineLineIntersect(prev.p0, prev.p1, curr.p0, curr.p1);
    if (!pt) {
      pt = [currPt[0] + curr.nx * offset, currPt[1] + curr.ny * offset];
    } else if (Math.hypot(pt[0] - currPt[0], pt[1] - currPt[1]) > maxSpike) {
      pt = [(prev.p1[0] + curr.p0[0]) / 2, (prev.p1[1] + curr.p0[1]) / 2];
    }
    out.push(pt);
  }
  return out;
}

function isProfileConcaveVertex(points, i) {
  const n = points.length;
  const ccw = polygonSignedArea2(points) > 0;
  const prev = points[(i - 1 + n) % n];
  const curr = points[i];
  const next = points[(i + 1) % n];
  const e0x = curr[0] - prev[0];
  const e0y = curr[1] - prev[1];
  const e1x = next[0] - curr[0];
  const e1y = next[1] - curr[1];
  const cross = e0x * e1y - e0y * e1x;
  const len = Math.hypot(e0x, e0y) * Math.hypot(e1x, e1y);
  if (len < 1e-9) return false;
  const sinHalf = cross / len;
  return ccw ? sinHalf < -0.12 : sinHalf > 0.12;
}

function pointInProfile(pt, poly) {
  let inside = false;
  const n = poly.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = poly[i][0];
    const yi = poly[i][1];
    const xj = poly[j][0];
    const yj = poly[j][1];
    const hit = (yi > pt[1]) !== (yj > pt[1])
      && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi + 1e-12) + xi;
    if (hit) inside = !inside;
  }
  return inside;
}

const PROFILE_ACCENT_EDGE_MIN = 0.25;

/** 0 where offset folds inside the wall or at reflex corners — smooth taper between. */
function profileAccentPinchWeights(profile, outerRaw) {
  const n = profile.length;
  let w = new Array(n).fill(1);
  for (let i = 0; i < n; i++) {
    if (pointInProfile(outerRaw[i], profile) || isProfileConcaveVertex(profile, i)) w[i] = 0;
  }
  for (let pass = 0; pass < 8; pass++) {
    const next = w.slice();
    for (let i = 0; i < n; i++) {
      if (w[i] <= 0) continue;
      const wl = w[(i - 1 + n) % n];
      const wr = w[(i + 1) % n];
      const neighbor = Math.min(wl, wr);
      if (neighbor < w[i]) next[i] = Math.max(neighbor, w[i] - 0.09);
    }
    w = next;
  }
  return w;
}

function pinchProfileAccentOuter(profile, outer, weights) {
  for (let i = 0; i < profile.length; i++) {
    const t = weights[i];
    outer[i][0] = profile[i][0] + (outer[i][0] - profile[i][0]) * t;
    outer[i][1] = profile[i][1] + (outer[i][1] - profile[i][1]) * t;
  }
}

function profileAccentWallWidth(inner, outer, i) {
  return Math.hypot(outer[i][0] - inner[i][0], outer[i][1] - inner[i][1]);
}

function profileAccentEdgeOk(profile, inner, outer, weights, i, j) {
  if (Math.min(weights[i], weights[j]) < PROFILE_ACCENT_EDGE_MIN) return false;
  if (pointInProfile(outer[i], profile) || pointInProfile(outer[j], profile)) return false;
  if (profileAccentWallWidth(inner, outer, i) < 0.05 && profileAccentWallWidth(inner, outer, j) < 0.05) return false;
  return true;
}

function extrudeProfileAnnulusWalls(outPos, outIdx, profile, inner, outer, weights, z0, z1) {
  const ccw = polygonSignedArea2(inner) > 0;
  const n = inner.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    if (!profileAccentEdgeOk(profile, inner, outer, weights, i, j)) continue;
    const o0 = vec3(outer[i][0], outer[i][1], z0);
    const o1 = vec3(outer[j][0], outer[j][1], z0);
    const o2 = vec3(outer[j][0], outer[j][1], z1);
    const o3 = vec3(outer[i][0], outer[i][1], z1);
    const i0 = vec3(inner[i][0], inner[i][1], z0);
    const i1 = vec3(inner[j][0], inner[j][1], z0);
    const i2 = vec3(inner[j][0], inner[j][1], z1);
    const i3 = vec3(inner[i][0], inner[i][1], z1);
    if (ccw) {
      pushQuad(outPos, outIdx, o0, o1, o2, o3);
      pushQuad(outPos, outIdx, i1, i0, i3, i2);
    } else {
      pushQuad(outPos, outIdx, o0, o3, o2, o1);
      pushQuad(outPos, outIdx, i1, i2, i3, i0);
    }
  }
}

function capProfileAccentRing(outPos, outIdx, profile, outer, inner, weights, z, normalUp) {
  const ccw = polygonSignedArea2(inner) > 0;
  const n = inner.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    if (!profileAccentEdgeOk(profile, inner, outer, weights, i, j)) continue;
    const o0 = vec3(outer[i][0], outer[i][1], z);
    const o1 = vec3(outer[j][0], outer[j][1], z);
    const i0 = vec3(inner[i][0], inner[i][1], z);
    const i1 = vec3(inner[j][0], inner[j][1], z);
    if (ccw) {
      if (normalUp) pushQuad(outPos, outIdx, o0, o1, i1, i0);
      else pushQuad(outPos, outIdx, o0, i0, i1, o1);
    } else if (normalUp) {
      pushQuad(outPos, outIdx, o0, i0, i1, o1);
    } else {
      pushQuad(outPos, outIdx, o0, o1, i1, i0);
    }
  }
}

function profileAccentOffset(points) {
  return offsetProfileByNormals(ensureProfileCCW(points), ACCENT_SKIN_MM);
}

/**
 * Continuous accent sleeve — outer ring offset then pinched where the offset
 * folds inside the profile (heart cleft) so the band fades instead of bleeding.
 */
function buildProfileAccentSleeve(outerProfile, z0, z1, onTop = false) {
  const profile = ensureProfileCCW(outerProfile);
  const positions = [];
  const indices = [];
  // Welded flush band: the ring is EMBEDDED into the wall (inner offset inward by the band
  // thickness, overlapping the solid body) and protrudes only ACCENT_SKIN_MM (~0.12mm), which
  // is within slip-lid clearance — so it fuses to the container and the lid still fits. (Was a
  // proud sleeve standing 0.57mm off the wall, which blocked the lid.)
  const proud = ACCENT_SKIN_MM + (onTop ? ACCENT_LAYER_BUMP_MM : 0);
  const inner = offsetProfileEdgeJoin(profile, -ACCENT_BAND_THICKNESS_MM);
  const outer = offsetProfileEdgeJoin(profile, proud);
  const weights = profileAccentPinchWeights(profile, outer);
  pinchProfileAccentOuter(profile, outer, weights);
  extrudeProfileAnnulusWalls(positions, indices, profile, inner, outer, weights, z0, z1);
  capProfileAccentRing(positions, indices, profile, outer, inner, weights, z0, false);
  capProfileAccentRing(positions, indices, profile, outer, inner, weights, z1, true);
  return { positions, indices };
}

function profileBandZRange(face, bandH, totalH, accentPos) {
  if (face === "front") {
    const pos = accentPos != null ? clamp(accentPos, 0, 100) / 100 : 0.85;
    const z0 = (totalH - bandH) * pos;
    return { z0, z1: z0 + bandH };
  }
  const pos = face === "floor"
    ? 0
    : accentPos != null
      ? clamp(accentPos, 0, 100) / 100
      : 1;
  const z0 = (totalH - bandH) * pos;
  return { z0, z1: z0 + bandH };
}

function frontProfileEdgeFilter(points, inset) {
  const frontY = Math.min(...points.map((p) => p[1]));
  const minX = Math.min(...points.map((p) => p[0]));
  const maxX = Math.max(...points.map((p) => p[0]));
  const x0 = minX + inset;
  const x1 = maxX - inset;
  const yTol = 0.35;
  return (a, b) => {
    const midX = (a[0] + b[0]) / 2;
    const midY = (a[1] + b[1]) / 2;
    return midY <= frontY + yTol && midX >= x0 && midX <= x1;
  };
}

export function buildAccentMesh(meta, params, outerProfile = null) {
  const face = params.accentFace || "rim";
  const b = rectFeatureBounds(meta);
  const bandH = Math.min(clamp(params.accentHeight ?? 4, 2, 80), b.totalH);
  const positions = [];
  const indices = [];
  const skin = ACCENT_SKIN_MM + (params.accentOnTop ? ACCENT_LAYER_BUMP_MM : 0);
  const accentProfile = profileIsValid(outerProfile)
    ? profileAccentOffset(outerProfile)
    : null;

  if (profileIsValid(outerProfile)) {
    const { z0, z1 } = profileBandZRange(face, bandH, b.totalH, params.accentPos);
    if (face === "front") {
      const inset = clamp(params.accentInset ?? 4, 2, Math.min(b.outerW, b.outerD) / 3);
      extrudeWallsAlongZ(positions, indices, accentProfile, z0, z1, frontProfileEdgeFilter(accentProfile, inset));
    } else {
      return buildProfileAccentSleeve(outerProfile, z0, z1, !!params.accentOnTop);
    }
  } else if (face === "rim") {
    const z1 = b.totalH;
    const z0 = z1 - bandH;
    wallBand(positions, indices, "y", b.od2 + skin, -b.ow2 - skin, b.ow2 + skin, z0, z1);
    wallBand(positions, indices, "y", -b.od2 - skin, -b.ow2 - skin, b.ow2 + skin, z0, z1);
    wallBand(positions, indices, "x", b.ow2 + skin, -b.od2 - skin, b.od2 + skin, z0, z1);
    wallBand(positions, indices, "x", -b.ow2 - skin, -b.od2 - skin, b.od2 + skin, z0, z1);
  } else if (face === "front") {
    const { z0, z1 } = profileBandZRange(face, bandH, b.totalH, params.accentPos);
    const inset = clamp(params.accentInset ?? 4, 2, Math.min(b.outerW, b.outerD) / 3);
    wallBand(positions, indices, "y", -b.od2 - skin, -b.ow2 + inset, b.ow2 - inset, z0, z1);
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
  const ccw = polygonSignedArea2(pts) > 0;
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const a = pts[i];
    const b = pts[j];
    if (edgeFilter && !edgeFilter(a, b, i, j, pts)) continue;
    const p0 = vec3(a[0], a[1], z0);
    const p1 = vec3(b[0], b[1], z0);
    const p2 = vec3(b[0], b[1], z1);
    const p3 = vec3(a[0], a[1], z1);
    if (ccw) pushQuad(outPos, outIdx, p0, p1, p2, p3);
    else pushQuad(outPos, outIdx, p0, p3, p2, p1);
  }
}

function capRingXZ(outPos, outIdx, outer, inner, z, normalUp) {
  const innerRing = radialMatchInner(outer, inner);
  const n = outer.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const o0 = vec3(outer[i][0], outer[i][1], z);
    const o1 = vec3(outer[j][0], outer[j][1], z);
    const i0 = vec3(innerRing[i][0], innerRing[i][1], z);
    const i1 = vec3(innerRing[j][0], innerRing[j][1], z);
    if (normalUp) pushQuad(outPos, outIdx, o0, o1, i1, i0);
    else pushQuad(outPos, outIdx, o0, i0, i1, o1);
  }
}

function profileCentroid(points) {
  let cx = 0;
  let cy = 0;
  for (const [x, y] of points) {
    cx += x;
    cy += y;
  }
  const n = points.length || 1;
  return [cx / n, cy / n];
}

function rayProfileHit(points, cx, cy, dx, dy) {
  let bestT = Infinity;
  let best = null;
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const x1 = points[i][0];
    const y1 = points[i][1];
    const x2 = points[j][0];
    const y2 = points[j][1];
    const sx = x2 - x1;
    const sy = y2 - y1;
    const denom = dx * sy - dy * sx;
    if (Math.abs(denom) < 1e-12) continue;
    const t = ((x1 - cx) * sy - (y1 - cy) * sx) / denom;
    const s = ((x1 - cx) * dy - (y1 - cy) * dx) / denom;
    if (t > 1e-9 && s >= -1e-9 && s <= 1 + 1e-9 && t < bestT) {
      bestT = t;
      best = [cx + dx * t, cy + dy * t];
    }
  }
  return best;
}

function radialMatchInner(outer, inner) {
  const [cx, cy] = profileCentroid(outer);
  return outer.map(([ox, oy]) => {
    const ang = Math.atan2(oy - cy, ox - cx);
    const dx = Math.cos(ang);
    const dy = Math.sin(ang);
    return rayProfileHit(inner, cx, cy, dx, dy) ?? [ox, oy];
  });
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

function profileMaxRadius(profile) {
  let maxR = 0;
  for (const [x, y] of profile) maxR = Math.max(maxR, Math.hypot(x, y));
  return maxR;
}

function scaleProfileXY(profile, factor) {
  if (!factor || Math.abs(factor - 1) < 1e-6) return profile;
  return profile.map(([x, y]) => [x * factor, y * factor]);
}

function flatLidGasketProfiles(boxOuter, params) {
  if (!params?.lidGasketEnabled || !profileIsValid(boxOuter)) return null;
  const gasketWidth = clamp(params.lidGasketWidth ?? 2, 1.2, 4);
  const gasketDepth = clamp(params.lidGasketDepth ?? 1.2, 0.6, 2.5);
  const wall = params.wall ?? params.lidWall ?? 2.4;
  const gasketInset = clamp(params.lidGasketInset ?? wall * 0.85, 1.5, 14);
  const outerR = profileMaxRadius(boxOuter);
  const inset = Math.min(gasketInset, Math.max(1.5, outerR - gasketWidth - 1.5));
  const outerGroove = offsetProfileInward(boxOuter, Math.max(0.5, inset - gasketWidth / 2));
  const innerGroove = offsetProfileInward(boxOuter, inset + gasketWidth / 2);
  if (!profileIsValid(innerGroove) || profileMaxRadius(innerGroove) < 2) return null;
  return { outerGroove, innerGroove, gasketDepth, gasketWidth };
}

/** Underside annular groove on flat lids — seats a printed TPU ring or cord. */
export function appendFlatLidGasketGroove(outPos, outIdx, boxOuter, params) {
  const groove = flatLidGasketProfiles(boxOuter, params);
  if (!groove) return;
  const { outerGroove, innerGroove, gasketDepth } = groove;
  const z0 = 0;
  const z1 = gasketDepth;
  // Radial-match ONCE and reuse: capRingXZ resamples the inner ring internally, so raw
  // innerGroove wall verts never welded against the cap verts (2×112 open edges on lids).
  const innerRing = radialMatchInner(outerGroove, innerGroove);
  capRingXZ(outPos, outIdx, outerGroove, innerRing, z0, false);
  extrudeWallsAlongZ(outPos, outIdx, outerGroove, z0, z1);
  extrudeWallsAlongZ(outPos, outIdx, innerRing, z0, z1);
  capRingXZ(outPos, outIdx, outerGroove, innerRing, z1, true);
}

/** Printable TPU washer — mates with {@link appendFlatLidGasketGroove}. */
export function buildFlatLidGasketRing(boxOuter, params) {
  const groove = flatLidGasketProfiles(boxOuter, params);
  if (!groove) return null;
  const { outerGroove, innerGroove, gasketDepth } = groove;
  const fit = 0.12;
  const outerRing = offsetProfileInward(outerGroove, fit);
  const innerRing = offsetProfileOutward(innerGroove, fit);
  if (!profileIsValid(outerRing) || !profileIsValid(innerRing)) return null;
  const ringHeight = gasketDepth * 0.88;
  const positions = [];
  const indices = [];
  capRingXZ(positions, indices, outerRing, innerRing, 0, false);
  extrudeWallsAlongZ(positions, indices, outerRing, 0, ringHeight);
  extrudeWallsAlongZ(positions, indices, innerRing, 0, ringHeight);
  capRingXZ(positions, indices, outerRing, innerRing, ringHeight, true);
  return { positions, indices, ringHeight };
}

/** Fixed stack positioning lip — 1 mm fence at lid outer edge (anti-slide only). */
export const STACK_LIP_MM = 1;

/**
 * Stack flat lid — solid top + thin positioning lip at the outer edge.
 * Stops the next canister sliding sideways; no groove or nest pocket.
 */
export function appendNestStackLidRim(outPos, outIdx, boxOuter, params, lidThickness) {
  const outerR = profileMaxRadius(boxOuter);
  if (outerR < 8) return;

  const rimWidth = STACK_LIP_MM;
  const rimHeight = STACK_LIP_MM;
  // Closed annular ring, radial-matched once (caps + walls share the same inner ring so they
  // weld), inset 0.1mm and embedded 0.5mm into the lid so it unions with the lid top with no
  // coincident faces (the old open rim leaked ~168 edges and Bambu "repaired" it).
  const rimOuter = offsetProfileInward(boxOuter, 0.1);
  const rimInner = radialMatchInner(rimOuter, offsetProfileInward(boxOuter, rimWidth));
  if (!profileIsValid(rimInner)) return;

  const zBot = lidThickness - 0.5;
  const zLip = lidThickness + rimHeight;

  capRingXZ(outPos, outIdx, rimOuter, rimInner, zBot, false);
  capRingXZ(outPos, outIdx, rimOuter, rimInner, zLip, true);
  extrudeWallsAlongZ(outPos, outIdx, rimOuter, zBot, zLip);
  extrudeWallsAlongZ(outPos, outIdx, rimInner, zBot, zLip);
}

/** @deprecated Groove removed — solid lip only. Kept for API compat; no-op. */
export function appendNestLidPrintSupports() {}

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
  return shape === "rect" || shape === "rounded" || shape === "pencilBox" || shape === "canisterSquare" || shape === "canisterSquareSet";
}

/** Thin food-contact cup — separate print, slips inside decorative outer shell. */
export function shapeSupportsLiner(shape) {
  return shape === "canisterSquare" || shape === "canisterSquareSet"
    || shape === "canisterJar" || shape === "canisterStack";
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
  const z1 = fuseToBody
    ? b.floor + b.cavityH
    : b.floor + b.cavityH - topClear - bodyGap;
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

function wallSegments(span0, span1, gaps) {
  const segs = [];
  let t = span0;
  const sorted = (gaps || []).slice().sort((a, b) => a[0] - b[0]);
  for (const [g0, g1] of sorted) {
    if (g0 > t + 0.02) segs.push([t, g0]);
    t = Math.max(t, g1);
  }
  if (span1 > t + 0.02) segs.push([t, span1]);
  return segs;
}

function fixedDividerFloorStripBoxes(meta, params) {
  const b = rectFeatureBounds(meta);
  const panels = dividerPanelBoxes(meta, params);
  if (!panels?.length || !params?.fuseInsertToBody) return [];
  const pad = 0.08;
  return panels.map((panel) => ({
    x0: panel.x0 - pad, x1: panel.x1 + pad,
    y0: panel.y0 - pad, y1: panel.y1 + pad,
    z0: b.floor - pad, z1: b.floor + pad,
  }));
}

/** Shared vertex pool — every corner appears once in the export mesh. */
class WeldPool {
  constructor(eps = 0.01) {
    this.eps = eps;
    this.positions = [];
    this.indices = [];
    this.table = new Map();
  }

  v(x, y, z) {
    const k = `${Math.round(x / this.eps)}|${Math.round(y / this.eps)}|${Math.round(z / this.eps)}`;
    let i = this.table.get(k);
    if (i === undefined) {
      i = this.positions.length / 3;
      this.positions.push(x, y, z);
      this.table.set(k, i);
    }
    return i;
  }

  tri(a, b, c) {
    this.indices.push(this.v(a[0], a[1], a[2]), this.v(b[0], b[1], b[2]), this.v(c[0], c[1], c[2]));
  }

  quad(a, b, c, d) {
    this.tri(a, b, c);
    this.tri(a, c, d);
  }

  mesh() {
    return { positions: this.positions, indices: this.indices };
  }
}

function isSharpRectProfile(meta, params) {
  return (meta.shape === "rect" || meta.shape === "rounded")
    && (params.cornerRadius || 0) <= 0.5
    && (params.vertexFillet || 0) <= 0.5;
}

function uniqSortedCuts(vals) {
  return [...new Set(vals.map((v) => Math.round(v * 1000) / 1000))].sort((a, b) => a - b);
}

/**
 * Divider faces for rounded fallback — bay faces + top only (no end caps / bottom).
 * End caps caused n=3 T-junctions with gapped inner walls.
 */
function buildDividerPanelFaces(meta, params) {
  const panels = dividerPanelBoxes(meta, params);
  if (!panels?.length) return null;
  const axis = params.insertAxis === "depth" ? "depth" : "length";
  const pool = new WeldPool();
  for (const panel of panels) {
    const { x0, x1, y0, y1, z0, z1 } = panel;
    if (axis === "depth") {
      pool.quad([x0, y0, z0], [x0, y0, z1], [x1, y0, z1], [x1, y0, z0]);
      pool.quad([x1, y1, z0], [x1, y1, z1], [x0, y1, z1], [x0, y1, z0]);
      pool.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]);
    } else {
      pool.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]);
      pool.quad([x1, y1, z0], [x1, y1, z1], [x1, y0, z1], [x1, y0, z0]);
      pool.quad([x0, y0, z1], [x0, y1, z1], [x1, y1, z1], [x1, y0, z1]);
    }
  }
  return pool.mesh();
}

/**
 * Sharp rect + welded divider(s) — true 2-manifold open-top shell.
 * Split rim / outer walls at divider stations so every edge has exactly 2 faces.
 * Divider = bay faces + top only (no end caps / bottom — those caused n=3 edges).
 */
function buildSharpWeldedBoxExport(meta, params) {
  const panels = dividerPanelBoxes(meta, params);
  if (!panels?.length) return null;
  const b = rectFeatureBounds(meta);
  const { ow2, od2, iw2, id2 } = b;
  const z0 = 0;
  const zF = b.floor;
  const zT = b.totalH;
  const axis = params.insertAxis === "depth" ? "depth" : "length";
  const pool = new WeldPool();
  const sorted = panels.slice().sort((a, c) => (axis === "depth" ? a.y0 - c.y0 : a.x0 - c.x0));

  if (axis === "depth") {
    const yGaps = sorted.map((p) => [p.y0, p.y1]);
    const wallSegs = wallSegments(-id2, id2, yGaps);
    const yCuts = uniqSortedCuts([-od2, -id2, ...sorted.flatMap((p) => [p.y0, p.y1]), id2, od2]);

    for (let i = 0; i < yCuts.length - 1; i++) {
      const ya = yCuts[i];
      const yb = yCuts[i + 1];
      if (yb - ya < 0.02) continue;
      pool.quad([-ow2, ya, z0], [ow2, ya, z0], [ow2, yb, z0], [-ow2, yb, z0]);
    }

    pool.quad([-ow2, -od2, z0], [-ow2, -od2, zT], [ow2, -od2, zT], [ow2, -od2, z0]);
    pool.quad([ow2, od2, z0], [ow2, od2, zT], [-ow2, od2, zT], [-ow2, od2, z0]);

    for (let i = 0; i < yCuts.length - 1; i++) {
      const ya = yCuts[i];
      const yb = yCuts[i + 1];
      if (yb - ya < 0.02) continue;
      pool.quad([ow2, ya, z0], [ow2, ya, zT], [ow2, yb, zT], [ow2, yb, z0]);
      pool.quad([-ow2, yb, z0], [-ow2, yb, zT], [-ow2, ya, zT], [-ow2, ya, z0]);
    }

    pool.quad([-ow2, -od2, zT], [ow2, -od2, zT], [iw2, -id2, zT], [-iw2, -id2, zT]);
    pool.quad([ow2, od2, zT], [-ow2, od2, zT], [-iw2, id2, zT], [iw2, id2, zT]);
    pool.tri([ow2, -od2, zT], [ow2, -id2, zT], [iw2, -id2, zT]);
    pool.tri([ow2, od2, zT], [iw2, id2, zT], [ow2, id2, zT]);
    pool.tri([-ow2, -od2, zT], [-iw2, -id2, zT], [-ow2, -id2, zT]);
    pool.tri([-ow2, od2, zT], [-ow2, id2, zT], [-iw2, id2, zT]);

    const rimInner = uniqSortedCuts([-id2, ...sorted.flatMap((p) => [p.y0, p.y1]), id2]);
    for (let i = 0; i < rimInner.length - 1; i++) {
      const ya = rimInner[i];
      const yb = rimInner[i + 1];
      if (yb - ya < 0.02) continue;
      pool.quad([ow2, ya, zT], [ow2, yb, zT], [iw2, yb, zT], [iw2, ya, zT]);
      pool.quad([-ow2, yb, zT], [-ow2, ya, zT], [-iw2, ya, zT], [-iw2, yb, zT]);
    }

    for (const [ya, yb] of wallSegs) {
      pool.quad([-iw2, ya, zF], [-iw2, ya, zT], [-iw2, yb, zT], [-iw2, yb, zF]);
      pool.quad([iw2, yb, zF], [iw2, yb, zT], [iw2, ya, zT], [iw2, ya, zF]);
    }
    pool.quad([iw2, -id2, zF], [iw2, -id2, zT], [-iw2, -id2, zT], [-iw2, -id2, zF]);
    pool.quad([-iw2, id2, zF], [-iw2, id2, zT], [iw2, id2, zT], [iw2, id2, zF]);

    let yCursor = -id2;
    for (const panel of sorted) {
      if (panel.y0 > yCursor + 0.02) {
        pool.quad([-iw2, yCursor, zF], [iw2, yCursor, zF], [iw2, panel.y0, zF], [-iw2, panel.y0, zF]);
      }
      pool.quad([-iw2, panel.y0, zF], [-iw2, panel.y0, zT], [iw2, panel.y0, zT], [iw2, panel.y0, zF]);
      pool.quad([iw2, panel.y1, zF], [iw2, panel.y1, zT], [-iw2, panel.y1, zT], [-iw2, panel.y1, zF]);
      pool.quad([-iw2, panel.y0, zT], [iw2, panel.y0, zT], [iw2, panel.y1, zT], [-iw2, panel.y1, zT]);
      yCursor = panel.y1;
    }
    if (id2 > yCursor + 0.02) {
      pool.quad([-iw2, yCursor, zF], [iw2, yCursor, zF], [iw2, id2, zF], [-iw2, id2, zF]);
    }
  } else {
    const xGaps = sorted.map((p) => [p.x0, p.x1]);
    const wallSegs = wallSegments(-iw2, iw2, xGaps);
    const xCuts = uniqSortedCuts([-ow2, -iw2, ...sorted.flatMap((p) => [p.x0, p.x1]), iw2, ow2]);
    const ySideCuts = uniqSortedCuts([-od2, -id2, id2, od2]);

    for (let i = 0; i < xCuts.length - 1; i++) {
      const xa = xCuts[i];
      const xb = xCuts[i + 1];
      if (xb - xa < 0.02) continue;
      for (let j = 0; j < ySideCuts.length - 1; j++) {
        const ya = ySideCuts[j];
        const yb = ySideCuts[j + 1];
        if (yb - ya < 0.02) continue;
        pool.quad([xa, ya, z0], [xb, ya, z0], [xb, yb, z0], [xa, yb, z0]);
      }
    }

    for (let j = 0; j < ySideCuts.length - 1; j++) {
      const ya = ySideCuts[j];
      const yb = ySideCuts[j + 1];
      if (yb - ya < 0.02) continue;
      pool.quad([-ow2, ya, z0], [-ow2, ya, zT], [-ow2, yb, zT], [-ow2, yb, z0]);
      pool.quad([ow2, yb, z0], [ow2, yb, zT], [ow2, ya, zT], [ow2, ya, z0]);
    }

    for (let i = 0; i < xCuts.length - 1; i++) {
      const xa = xCuts[i];
      const xb = xCuts[i + 1];
      if (xb - xa < 0.02) continue;
      pool.quad([xa, -od2, z0], [xb, -od2, z0], [xb, -od2, zT], [xa, -od2, zT]);
      pool.quad([xb, od2, z0], [xa, od2, z0], [xa, od2, zT], [xb, od2, zT]);
    }

    // Left / right flanges only over cavity span (ears cover corners)
    pool.quad([-ow2, -id2, zT], [-ow2, id2, zT], [-iw2, id2, zT], [-iw2, -id2, zT]);
    pool.quad([ow2, -id2, zT], [iw2, -id2, zT], [iw2, id2, zT], [ow2, id2, zT]);

    pool.tri([-ow2, -od2, zT], [-iw2, -id2, zT], [-ow2, -id2, zT]);
    pool.tri([-ow2, od2, zT], [-ow2, id2, zT], [-iw2, id2, zT]);
    pool.tri([ow2, -od2, zT], [ow2, -id2, zT], [iw2, -id2, zT]);
    pool.tri([ow2, od2, zT], [iw2, id2, zT], [ow2, id2, zT]);

    // Corner flange tris (outer front/back to inner) — complete the rim at ±ow2 ends
    pool.tri([-ow2, -od2, zT], [-iw2, -od2, zT], [-iw2, -id2, zT]);
    pool.tri([ow2, -od2, zT], [iw2, -id2, zT], [iw2, -od2, zT]);
    pool.tri([-ow2, od2, zT], [-iw2, id2, zT], [-iw2, od2, zT]);
    pool.tri([ow2, od2, zT], [iw2, od2, zT], [iw2, id2, zT]);

    const rimInner = uniqSortedCuts([-iw2, ...sorted.flatMap((p) => [p.x0, p.x1]), iw2]);
    for (let i = 0; i < rimInner.length - 1; i++) {
      const xa = rimInner[i];
      const xb = rimInner[i + 1];
      if (xb - xa < 0.02) continue;
      pool.quad([xa, -od2, zT], [xb, -od2, zT], [xb, -id2, zT], [xa, -id2, zT]);
      pool.quad([xb, od2, zT], [xa, od2, zT], [xa, id2, zT], [xb, id2, zT]);
    }

    pool.quad([-iw2, -id2, zF], [-iw2, -id2, zT], [-iw2, id2, zT], [-iw2, id2, zF]);
    pool.quad([iw2, id2, zF], [iw2, id2, zT], [iw2, -id2, zT], [iw2, -id2, zF]);
    for (const [xa, xb] of wallSegs) {
      pool.quad([xa, -id2, zF], [xa, -id2, zT], [xb, -id2, zT], [xb, -id2, zF]);
      pool.quad([xb, id2, zF], [xb, id2, zT], [xa, id2, zT], [xa, id2, zF]);
    }

    let xCursor = -iw2;
    for (const panel of sorted) {
      if (panel.x0 > xCursor + 0.02) {
        pool.quad([xCursor, -id2, zF], [panel.x0, -id2, zF], [panel.x0, id2, zF], [xCursor, id2, zF]);
      }
      pool.quad([panel.x0, -id2, zF], [panel.x0, -id2, zT], [panel.x0, id2, zT], [panel.x0, id2, zF]);
      pool.quad([panel.x1, id2, zF], [panel.x1, id2, zT], [panel.x1, -id2, zT], [panel.x1, -id2, zF]);
      pool.quad([panel.x0, -id2, zT], [panel.x1, -id2, zT], [panel.x1, id2, zT], [panel.x0, id2, zT]);
      xCursor = panel.x1;
    }
    if (iw2 > xCursor + 0.02) {
      pool.quad([xCursor, -id2, zF], [iw2, -id2, zF], [iw2, id2, zF], [xCursor, id2, zF]);
    }
  }

  return pool.mesh();
}

/** Fixed divider export — sharp boxes rebuilt watertight; rounded shells floor-strip + panel faces. */
export function buildWatertightFixedDividerExport(bodyMesh, meta, params) {
  if (!params?.fuseInsertToBody) return null;
  const panels = dividerPanelBoxes(meta, params);
  if (!panels?.length) return null;

  if (isSharpRectProfile(meta, params)) {
    return buildSharpWeldedBoxExport(meta, params);
  }

  const shell = bodyMesh?.shellMesh || bodyMesh;
  const dividerFaces = buildDividerPanelFaces(meta, params);
  if (!shell?.indices?.length) return dividerFaces;

  const floorZones = fixedDividerFloorStripBoxes(meta, params);
  const positions = shell.positions.slice();
  const cleanIdx = [];
  for (let t = 0; t < shell.indices.length; t += 3) {
    const ia = shell.indices[t];
    const ib = shell.indices[t + 1];
    const ic = shell.indices[t + 2];
    if (floorZones.some((box) => triFullyInsideBox(shell.positions, ia, ib, ic, box))) continue;
    cleanIdx.push(ia, ib, ic);
  }
  return mergeMeshesSnap({ positions, indices: cleanIdx }, dividerFaces);
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

/** Max lines for flat/vertical emboss — was 4 and clipped stacked "COFFEE". */
const MAX_EMBOSS_TEXT_LINES = 16;

/** Stack one character per line for vertical text path. */
function verticalStackText(text) {
  const raw = String(text || "");
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  // Already stacked (mostly single glyphs) — keep as entered.
  if (lines.length >= 2 && lines.every((l) => [...l].length <= 2)) {
    return lines.slice(0, MAX_EMBOSS_TEXT_LINES).join("\n");
  }
  const chars = [...raw.replace(/\s+/g, "")].filter(Boolean);
  if (!chars.length) return "";
  return chars.slice(0, MAX_EMBOSS_TEXT_LINES).join("\n");
}

/** Normalise emboss text for the active layout (vertical stacks letters). */
function embossTextForLayout(text, layout) {
  if ((layout || "flat") === "vertical") return verticalStackText(text);
  return String(text || "");
}

/**
 * Resolve per-line height (mm) list for flat emboss, or null when uniform sizing applies.
 * Arc/vertical callers should pass null.
 */
function resolveLineHeightsMm(text, params, fallbackMm) {
  const lines = String(text || "")
    .split(/\r?\n/)
    .slice(0, MAX_EMBOSS_TEXT_LINES);
  if (!lines.length) return null;
  const raw = Array.isArray(params?.embossTextLines) ? params.embossTextLines : null;
  if (!raw?.length) return null;
  const fb = Number(fallbackMm);
  const def = Number.isFinite(fb) && fb > 0 ? fb : 7;
  const heights = lines.map((_, i) => {
    const h = Number(raw[i]?.heightMm);
    return Number.isFinite(h) && h > 0 ? h : def;
  });
  const minH = Math.min(...heights);
  const maxH = Math.max(...heights);
  // Uniform sizes → keep legacy “whole block = embossHeight” scaling.
  if (maxH - minH < 0.05) return null;
  return heights;
}

/** Width of a line with letter-spacing multiplier (1 = natural). */
function measureSpacedLineWidth(ctx, line, letterSpacing) {
  const s = String(line || "");
  if (!s) return 0;
  const spacing = clamp(letterSpacing ?? 1, 0.7, 1.8);
  if (Math.abs(spacing - 1) < 0.01) return ctx.measureText(s).width;
  const chars = [...s];
  let w = 0;
  for (let i = 0; i < chars.length; i++) {
    const cw = ctx.measureText(chars[i]).width;
    w += i < chars.length - 1 ? cw * spacing : cw;
  }
  return w;
}

/** Draw a line left-to-right with letter spacing; `x` is the left edge. */
function fillSpacedLine(ctx, line, x, y, letterSpacing) {
  const s = String(line || "");
  if (!s) return;
  const spacing = clamp(letterSpacing ?? 1, 0.7, 1.8);
  ctx.textAlign = "left";
  if (Math.abs(spacing - 1) < 0.01) {
    ctx.fillText(s, x, y);
    return;
  }
  const chars = [...s];
  let cx = x;
  for (let i = 0; i < chars.length; i++) {
    ctx.fillText(chars[i], cx, y);
    cx += ctx.measureText(chars[i]).width * spacing;
  }
}

/** Rasterise label text to a high-res alpha mask (stencil contours, not pixel blocks). */
function rasterTextMask(text, fontId, fontSizePx = 640, align = "left", lineHeightsMm = null, options = {}) {
  if (typeof document === "undefined") return null;
  const lines = String(text || "")
    .split(/\r?\n/)
    .slice(0, MAX_EMBOSS_TEXT_LINES)
    .map((l) => l.trimEnd());
  if (!lines.some((l) => l.trim())) return null;

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  const letterSpacing = clamp(options.letterSpacing ?? 1, 0.7, 1.8);
  const lineHeightFactor = clamp(options.lineSpacing ?? 1.12, 0.8, 2.2);
  const fontWeight = options.fontWeight;
  const padFactor = 0.22;

  const usePerLine = Array.isArray(lineHeightsMm) && lineHeightsMm.length >= lines.length;
  let sizePxList;
  if (usePerLine) {
    const heights = lines.map((_, i) => {
      const h = Number(lineHeightsMm[i]);
      return Number.isFinite(h) && h > 0 ? h : 7;
    });
    const refMm = Math.max(...heights, 1e-6);
    sizePxList = heights.map((h) => Math.max(24, fontSizePx * (h / refMm)));
  } else {
    sizePxList = lines.map(() => fontSizePx);
  }

  // Tall / wide plaques can exceed browser canvas limits — shrink uniformly so
  // every line stays on-canvas with the same face proportions.
  let estHeight = 0;
  for (let i = 0; i < lines.length; i++) {
    const sz = sizePxList[i];
    estHeight += i === 0 ? sz : sz * lineHeightFactor;
  }
  estHeight += padFactor * 2 * Math.max(...sizePxList);
  let maxLineWProbe = 0;
  for (let i = 0; i < lines.length; i++) {
    ctx.font = embossFontStackForCanvas(fontId, sizePxList[i], lines[i] || "Hg", fontWeight);
    maxLineWProbe = Math.max(maxLineWProbe, measureSpacedLineWidth(ctx, lines[i], letterSpacing));
  }
  const estWidth = maxLineWProbe + padFactor * 2 * Math.max(...sizePxList);
  const shrink = Math.min(
    1,
    TEXT_RASTER_MAX_EDGE / Math.max(estHeight, 1),
    TEXT_RASTER_MAX_EDGE / Math.max(estWidth, 1),
  );
  if (shrink < 1) {
    sizePxList = sizePxList.map((sz) => Math.max(40, Math.floor(sz * shrink)));
  }

  const maxSizePx = Math.max(...sizePxList);
  const pad = Math.ceil(maxSizePx * padFactor);
  let maxLineW = 0;
  const fonts = sizePxList.map((sz, i) => embossFontStackForCanvas(fontId, sz, lines[i] || "Hg", fontWeight));
  for (let i = 0; i < lines.length; i++) {
    ctx.font = fonts[i];
    maxLineW = Math.max(maxLineW, measureSpacedLineWidth(ctx, lines[i], letterSpacing));
  }

  const baselines = [];
  let yCursor = pad;
  for (let i = 0; i < lines.length; i++) {
    const sz = sizePxList[i];
    baselines.push(yCursor + sz * 0.85);
    yCursor += i === 0 ? sz : sz * lineHeightFactor;
  }
  const width = Math.ceil(maxLineW + pad * 2);
  const height = Math.ceil(yCursor + pad);
  canvas.width = width;
  canvas.height = height;
  ctx.fillStyle = "#000";
  ctx.textBaseline = "alphabetic";
  const textAlign = align === "center" ? "center" : align === "right" ? "right" : "left";
  for (let i = 0; i < lines.length; i++) {
    ctx.font = fonts[i];
    const lineW = measureSpacedLineWidth(ctx, lines[i], letterSpacing);
    let x = pad;
    if (textAlign === "center") x = (width - lineW) / 2;
    else if (textAlign === "right") x = width - pad - lineW;
    fillSpacedLine(ctx, lines[i], x, baselines[i], letterSpacing);
  }
  const data = ctx.getImageData(0, 0, width, height).data;
  const mask = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) {
    if (data[i * 4 + 3] > 64) mask[i] = 1;
  }
  return { mask, width, height, lineSpacing: lineHeightFactor };
}

/** Rasterise one line of text along a circular arc (for logo plaques). */
function rasterArcTextMask(text, fontId, fontSizePx = 640, options = {}) {
  if (typeof document === "undefined") return null;
  const line = String(text || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l) || "";
  if (!line) return null;

  const chars = [...line];
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  const font = embossFontStackForCanvas(fontId, fontSizePx, line, options.fontWeight);
  ctx.font = font;

  const letterSpacing = clamp(options.spacing ?? 1.1, 0.55, 2.2);
  const charWidths = chars.map((c) => ctx.measureText(c).width);
  const totalWidth = charWidths.reduce((a, b) => a + b, 0) * letterSpacing;
  const sweepDeg = clamp(options.sweepDeg ?? 220, 35, 360);
  const sweepRad = (sweepDeg * Math.PI) / 180;
  const side = options.side === "down" ? "down" : "up";
  const sweepDir = side === "down" ? -1 : 1;
  const radiusPx = Math.max(
    fontSizePx * 0.85,
    options.radiusPx ?? (totalWidth / sweepRad) * 1.05,
  );
  const pad = Math.ceil(fontSizePx * 0.4);
  const size = Math.ceil((radiusPx + fontSizePx) * 2 + pad * 2);

  canvas.width = size;
  canvas.height = size;
  const ocx = size / 2;
  const ocy = size / 2;

  const defaultStart = side === "down" ? 180 : -90;
  const startAngle = ((options.startDeg ?? defaultStart) * Math.PI) / 180;
  const rotSign = side === "down" ? -1 : 1;

  ctx.font = font;
  ctx.fillStyle = "#000";
  ctx.textBaseline = "middle";
  ctx.textAlign = "center";

  let totalDist = 0;
  for (let i = 0; i < chars.length; i++) {
    totalDist += charWidths[i] * letterSpacing;
  }
  const letterSpanRad = totalDist / radiusPx;
  const angleOffset = Math.max(0, (sweepRad - letterSpanRad) / 2);

  let dist = 0;
  for (let i = 0; i < chars.length; i++) {
    const w = charWidths[i] * letterSpacing;
    const along = angleOffset + (dist + w / 2) / radiusPx;
    const angle = startAngle + sweepDir * along;
    const x = ocx + Math.cos(angle) * radiusPx;
    const y = ocy + Math.sin(angle) * radiusPx;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle + rotSign * (Math.PI / 2));
    ctx.fillText(chars[i], 0, 0);
    ctx.restore();
    dist += w;
  }

  const data = ctx.getImageData(0, 0, size, size).data;
  const mask = new Uint8Array(size * size);
  for (let i = 0; i < size * size; i++) {
    if (data[i * 4 + 3] > 64) mask[i] = 1;
  }
  return { mask, width: size, height: size, arcCenterPx: [ocx, ocy], radiusPx };
}

/** Horizontal banner bow for cylinder wrap — upright letters, arch in height (not plaque circle). */
function rasterWrapBannerTextMask(text, fontId, fontSizePx = 640, options = {}) {
  if (typeof document === "undefined") return null;
  const line = String(text || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l) || "";
  if (!line) return null;

  const chars = [...line];
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  const font = embossFontStackForCanvas(fontId, fontSizePx, line, options.fontWeight);
  ctx.font = font;

  const letterSpacing = clamp(options.spacing ?? 1, 0.7, 1.8);
  const charWidths = chars.map((c) => ctx.measureText(c).width);
  const totalW = charWidths.reduce((a, b) => a + b, 0) * letterSpacing;
  const side = options.side === "down" ? "down" : "up";
  const curve = clamp(options.curveAmount ?? 60, 0, 100) / 100;
  const bowPx = fontSizePx * (0.1 + curve * 0.38);
  const padX = Math.ceil(fontSizePx * 0.35);
  const padY = Math.ceil(fontSizePx * 0.4 + bowPx);

  canvas.width = Math.max(8, Math.ceil(totalW + padX * 2));
  canvas.height = Math.max(8, Math.ceil(fontSizePx * 1.35 + bowPx * 2 + padY));

  ctx.font = font;
  ctx.fillStyle = "#000";
  ctx.textBaseline = "middle";
  ctx.textAlign = "center";

  const midX = totalW / 2;
  let x = padX;
  const baseY = side === "down"
    ? padY + fontSizePx * 0.52
    : canvas.height - padY - fontSizePx * 0.52;

  for (let i = 0; i < chars.length; i++) {
    const w = charWidths[i] * letterSpacing;
    const cx = x + w / 2;
    const t = midX > 0 ? (cx - padX - midX) / midX : 0;
    const parab = Math.max(0, 1 - t * t);
    const y = side === "down"
      ? baseY + parab * bowPx
      : baseY - parab * bowPx;
    ctx.fillText(chars[i], cx, y);
    x += w;
  }

  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  const mask = new Uint8Array(canvas.width * canvas.height);
  for (let i = 0; i < canvas.width * canvas.height; i++) {
    if (data[i * 4 + 3] > 64) mask[i] = 1;
  }
  return { mask, width: canvas.width, height: canvas.height };
}

function estimateGraphicArtSizeMm(frame, meta, params) {
  const traceData = params.embossTraceRects;
  const hasTrace =
    params.embossTraceEnabled &&
    traceData?.width &&
    traceData?.height;
  if (hasTrace) {
    const artH = wrapSafeArtHeight(frame, params.embossTraceSize ?? 16);
    const maxW = Math.min(frame.faceW * 0.62, 56);
    const scale = Math.min(artH / traceData.height, maxW / traceData.width);
    if (!Number.isFinite(scale) || scale <= 0) return null;
    return { artW: traceData.width * scale, artH: traceData.height * scale };
  }
  if (params.embossSvgEnabled && params.embossSvgText?.trim()) {
    const parsed = parseSvgPaths(params.embossSvgText);
    const layout = computeSvgArtLayout(parsed, meta, params);
    if (layout) return { artW: layout.artW, artH: layout.artH };
  }
  return null;
}

/** Active graphic band on a face — used to park arc text above/below the logo on wrap. */
function graphicArtAnchor(frame, meta, params) {
  const graphic = estimateGraphicArtSizeMm(frame, meta, params);
  if (!graphic) return null;
  const { xOff, zOff } = decorPlacementOffsets(params, frame, graphic.artW, graphic.artH, "graphic");
  return {
    cx: xOff + graphic.artW / 2,
    cy: zOff + graphic.artH / 2,
    top: zOff + graphic.artH,
    bottom: zOff,
    artW: graphic.artW,
    artH: graphic.artH,
  };
}

/** Arc radius slider limits for a face (mm). 0 = auto. */
export function arcRadiusLimits(meta, face, params = null) {
  const frame = getEmbossFaceFrame(meta, face || "front", params);
  const minDim = Math.min(frame.faceW, frame.faceH);
  const maxDim = Math.max(frame.faceW, frame.faceH);
  return {
    min: 0,
    max: Math.max(140, Math.round(maxDim * 1.15)),
    maxAuto: Math.max(60, minDim * 0.88),
  };
}

function autoArcRadiusMm(frame, meta, params, labelH) {
  const limits = arcRadiusLimits(meta, frame.face, params);
  const minDim = Math.min(frame.faceW, frame.faceH);
  let radius = minDim * 0.48;
  const graphic = estimateGraphicArtSizeMm(frame, meta, params);
  if (graphic) {
    const g = Math.max(graphic.artW, graphic.artH);
    radius = Math.max(radius, g * 0.88 + labelH * 0.75);
    if (frame.face === "wrap") {
      radius = Math.max(radius, graphic.artW * 1.35 + labelH * 1.1);
    }
  }
  return clamp(radius, 18, limits.maxAuto);
}

/** Curve slider 0–100 → radius mm (Word-style “how bent”). */
export function resolveArcRadiusMm(frame, meta, params, labelH) {
  const limits = arcRadiusLimits(meta, frame.face, params);
  if (params.embossArcRadius > 0) {
    return clamp(params.embossArcRadius, 15, limits.max);
  }
  const auto = autoArcRadiusMm(frame, meta, params, labelH);
  const curve = clamp(params.embossArcCurve ?? 60, 0, 100);
  const scale = 0.48 + (curve / 100) * 1.05;
  return clamp(auto * scale, 15, limits.max);
}

/** Face-local bounds after mapping arc raster pixels to mm. */
function arcGlyphFaceBounds(canvasXOff, canvasZOff, glyph, scale, maskH) {
  const left = canvasXOff + glyph.left * scale;
  const right = canvasXOff + (glyph.right + 1) * scale;
  const bottom = canvasZOff + (maskH - glyph.bottom - 1) * scale;
  const top = canvasZOff + (maskH - glyph.top) * scale;
  return { canvasXOff, canvasZOff, left, right, bottom, top };
}

function shiftArcGlyphBounds(bounds, dx, dz) {
  return {
    canvasXOff: bounds.canvasXOff + dx,
    canvasZOff: bounds.canvasZOff + dz,
    left: bounds.left + dx,
    right: bounds.right + dx,
    bottom: bounds.bottom + dz,
    top: bounds.top + dz,
  };
}

/** Pin arc ink above/below a wrap graphic — centre on logo, not arc circle origin. */
function anchorWrapArcToGraphic(bounds, anchor, params, labelH) {
  const gap = Math.max(1.2, labelH * 0.1);
  const glyphCx = (bounds.left + bounds.right) / 2;
  const dx = anchor.cx + (params.textOffsetX ?? 0) - glyphCx;
  const side = params.embossArcSide === "down" ? "down" : "up";
  const oy = params.textOffsetY ?? 0;
  const dz = side === "down"
    ? anchor.bottom - gap + oy - bounds.top
    : anchor.top + gap + oy - bounds.bottom;
  const shifted = shiftArcGlyphBounds(bounds, dx, dz);
  return {
    ...shifted,
    cx: anchor.cx + (params.textOffsetX ?? 0),
    cy: (shifted.bottom + shifted.top) / 2,
  };
}

/** Flat text band on a face — same placement as non-arc layout (respects move sliders). */
function computeFlatTextBand(meta, params, frame, labelH, fontId, fontSizePx) {
  const text = String(params.embossText || "");
  const raster = rasterTextMask(text, fontId, fontSizePx, params.embossTextAlign || "left");
  if (!raster?.mask?.length) return null;
  const { width: maskW, height: maskH } = raster;
  const glyph = glyphBoundsFromMask(raster.mask, maskW, maskH);
  if (!glyph) return null;
  const limits = textEmbossSizeLimits(meta, frame.face, params);
  const scale = Math.min(labelH / glyph.height, limits.maxWidthMm / glyph.width);
  if (!Number.isFinite(scale) || scale <= 0) return null;
  const artW = glyph.width * scale;
  const artH = glyph.height * scale;
  const { xOff, zOff } = decorPlacementOffsets(params, frame, artW, artH, "text");
  return {
    cx: xOff + artW / 2,
    cy: zOff + artH / 2,
    top: zOff + artH,
    bottom: zOff,
    artW,
    artH,
  };
}

/** Where wrap text should sit — move sliders, or stacked above/below the traced graphic. */
function resolveWrapTextBand(params, flatBand, anchor, labelH, artHOverride = null) {
  if (!flatBand) return null;
  const ox = params.textOffsetX ?? 0;
  const oy = params.textOffsetY ?? 0;
  if (Math.abs(ox) > 0.05 || Math.abs(oy) > 0.05) return flatBand;
  if (!anchor) return flatBand;
  const arcMode = (params.embossTextLayout || "flat") === "arc";
  const side = arcMode && params.embossArcSide === "down" ? "down" : "up";
  const gap = Math.max(1.2, labelH * 0.1);
  const bandH = artHOverride ?? flatBand.artH;
  const bottom = side === "down"
    ? anchor.bottom - gap - bandH
    : anchor.top + gap;
  const top = bottom + bandH;
  return {
    cx: flatBand.cx,
    cy: (top + bottom) / 2,
    top,
    bottom,
    artW: flatBand.artW,
    artH: bandH,
  };
}

function alignBoundsToWrapBand(bounds, band) {
  const glyphCx = (bounds.left + bounds.right) / 2;
  const glyphCy = (bounds.bottom + bounds.top) / 2;
  const dx = band.cx - glyphCx;
  const dy = band.cy - glyphCy;
  const shifted = shiftArcGlyphBounds(bounds, dx, dy);
  return { ...shifted, cx: band.cx, cy: band.cy };
}

function applyWrapTextBandToFaceRect(band, glyph, scale, maskH, artW, artH) {
  const left = band.cx - artW / 2;
  const right = band.cx + artW / 2;
  const bottom = band.bottom;
  const top = band.top;
  return {
    left,
    right,
    bottom,
    top,
    cx: band.cx,
    cy: band.cy,
    canvasXOff: left - glyph.left * scale,
    canvasZOff: bottom - (maskH - glyph.bottom - 1) * scale,
  };
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
  const vertical = (params?.embossTextLayout || "flat") === "vertical";
  // Vertical stacks can fill almost the whole face; flat/arc get a generous mid-face cap.
  const frac = vertical ? 0.98 : 0.72;
  const hardCap = vertical ? 220 : 100;
  return {
    min: 3,
    max: Math.min(hardCap, Math.max(24, Math.round(frame.faceH * frac * 2) / 2)),
    maxWidthMm: Math.max(20, frame.faceW * (vertical ? 0.7 : 0.92)),
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
  const layout = params.embossTextLayout || "flat";
  const text = embossTextForLayout(params.embossText || "", layout);
  if (!textHasInk(text)) return null;
  const frame = getEmbossFaceFrame(meta, params.embossFace || "front", params);
  const limits = textEmbossSizeLimits(meta, frame.face, params);
  const labelH = clamp(params.embossHeight ?? 7, limits.min, limits.max);
  const arcMode = layout === "arc";
  const fontId = params.embossFont || "bebas";
  const fontSizePx = isLabelExport(params) ? LABEL_TEXT_FONT_PX : PREVIEW_TEXT_FONT_PX;
  const wrapArc = arcMode && frame.face === "wrap";
  const align = layout === "vertical"
    ? "center"
    : (params.embossTextAlign || "left");

  let raster;
  const fontWeight = params.embossFontWeight ?? "auto";
  if (wrapArc) {
    raster = rasterWrapBannerTextMask(text, fontId, fontSizePx, {
      side: params.embossArcSide === "down" ? "down" : "up",
      curveAmount: params.embossArcCurve ?? 60,
      spacing: params.embossArcSpacing ?? 1,
      fontWeight,
    });
  } else if (arcMode) {
    // Flat/plate faces want a shallow ARCH, not the 220° cylinder wrap (that curls the
    // whole word into a circle). Drive the sweep from Curve amount; let the radius follow
    // the sweep so the arch spans a predictable, gentle angle regardless of word width.
    const curve = clamp(params.embossArcCurve ?? 60, 0, 100);
    const flatSweep = clamp(12 + curve * 0.9, 12, 120);
    const userSweep = params.embossArcSweep;
    const opts = {
      sweepDeg: (userSweep && userSweep < 200) ? userSweep : flatSweep,
      startDeg: params.embossArcStartDeg ?? -90,
      spacing: params.embossArcSpacing ?? 1,
      side: params.embossArcSide === "down" ? "down" : "up",
      fontWeight,
    };
    if (params.embossArcRadius > 0) {
      const radiusMm = resolveArcRadiusMm(frame, meta, params, labelH);
      opts.radiusPx = (radiusMm / labelH) * fontSizePx;
    }
    raster = rasterArcTextMask(text, fontId, fontSizePx, opts);
  } else {
    const lineHeightsMm = layout === "flat" ? resolveLineHeightsMm(text, params, labelH) : null;
    const lineSpacing = clamp(params.embossLineSpacing ?? 1.12, 0.85, 2.2);
    const letterSpacing = clamp(params.embossLetterSpacing ?? 1, 0.7, 2.2);
    raster = rasterTextMask(text, fontId, fontSizePx, align, lineHeightsMm, {
      lineSpacing,
      letterSpacing,
      fontWeight,
    });
    // Headless export validation intentionally runs without browser fonts.
    // Keep its documented no-font path nullable so callers can skip text
    // instead of crashing before they inspect the empty raster.
    if (raster && lineHeightsMm) raster._lineHeightsMm = lineHeightsMm;
    if (raster) raster._lineSpacing = lineSpacing;
  }
  if (!raster?.mask?.length) return null;

  const { mask, width: maskW, height: maskH } = raster;
  const glyph = glyphBoundsFromMask(mask, maskW, maskH);
  if (!glyph) return null;

  let scale;
  if (layout === "vertical" && params.textUniformSize) {
    // Per-LETTER sizing: every letter is the same height regardless of word length, so a
    // matched set (COFFEE / SUGAR / MILO) has identical text — shorter words just take less
    // vertical space. `labelH` is the per-letter height; total stack = labelH x letters,
    // capped to the face so the longest word can't overflow.
    const lineCount = Math.max(1, text.split(/\r?\n/).filter((l) => l.trim()).length);
    const targetH = Math.min(labelH * lineCount, frame.faceH * 0.96);
    scale = Math.min(targetH / glyph.height, limits.maxWidthMm / glyph.width);
  } else if (layout === "flat" && Array.isArray(raster._lineHeightsMm) && raster._lineHeightsMm.length) {
    // Per-line mm sizes: block height ≈ sum of line heights (with leading).
    const heights = raster._lineHeightsMm;
    const splitLines = String(text || "").split(/\r?\n/).slice(0, MAX_EMBOSS_TEXT_LINES);
    const lh = clamp(raster._lineSpacing ?? params.embossLineSpacing ?? 1.12, 0.85, 2.2);
    let targetH = 0;
    for (let i = 0; i < splitLines.length; i++) {
      const h = clamp(Number(heights[i]) || labelH, limits.min, limits.max);
      targetH += i === 0 ? h : h * lh;
    }
    if (targetH <= 0) targetH = labelH;
    targetH = Math.min(targetH, frame.faceH * 0.96);
    scale = Math.min(targetH / glyph.height, limits.maxWidthMm / glyph.width);
  } else {
    scale = Math.min(labelH / glyph.height, limits.maxWidthMm / glyph.width);
  }
  if (!Number.isFinite(scale) || scale <= 0) return null;

  const artW = glyph.width * scale;
  const artH = glyph.height * scale;

  let left;
  let right;
  let bottom;
  let top;
  let cx;
  let cy;
  let canvasXOff;
  let canvasZOff;
  let rotation;

  if (arcMode && raster.arcCenterPx && !wrapArc) {
    const [acxPx, acyPx] = raster.arcCenterPx;
    const faceCy = frame.horizontal ? 0 : frame.centerZ;
    const targetCx = params.textOffsetX ?? 0;
    const targetCy = faceCy + (params.textOffsetY ?? 0);
    const bounds = arcGlyphFaceBounds(
      targetCx - acxPx * scale,
      targetCy - (maskH - acyPx) * scale,
      glyph,
      scale,
      maskH,
    );
    canvasXOff = bounds.canvasXOff;
    canvasZOff = bounds.canvasZOff;
    left = bounds.left;
    right = bounds.right;
    bottom = bounds.bottom;
    top = bounds.top;
    cx = targetCx;
    cy = targetCy;
    rotation = params.embossArcTilt ?? 0;
  } else {
    const { xOff, zOff } = decorPlacementOffsets(params, frame, artW, artH, "text");
    left = xOff;
    right = xOff + artW;
    bottom = zOff;
    top = zOff + artH;
    cx = xOff + artW / 2;
    cy = zOff + artH / 2;
    canvasXOff = xOff - glyph.left * scale;
    canvasZOff = zOff - (maskH - glyph.bottom) * scale;
    rotation = params.textRotation ?? 0;
  }

  if (frame.face === "wrap") {
    const flatBand = {
      cx,
      cy,
      top,
      bottom,
      artW,
      artH,
    };
    const anchor = graphicArtAnchor(frame, meta, params);
    const band = resolveWrapTextBand(params, flatBand, anchor, labelH, artH);
    if (band) {
      const face = applyWrapTextBandToFaceRect(band, glyph, scale, maskH, artW, artH);
      left = face.left;
      right = face.right;
      bottom = face.bottom;
      top = face.top;
      cx = face.cx;
      cy = face.cy;
      canvasXOff = face.canvasXOff;
      canvasZOff = face.canvasZOff;
    }
  }

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
    rotation,
    glyphHeightMm: artH,
    arcMode,
    glyphLeft: glyph.left,
    glyphBottom: glyph.bottom,
  };
}

function flatCoordForFrame(frame, w) {
  if (frame.face === "wrap") return [w[0], w[1]];
  if (frame.horizontal) return [w[0], w[1]];
  if (frame.face === "left" || frame.face === "right") return [w[1], w[2]];
  return [w[0], w[2]];
}

function profilePointAtArc(outer, normals, arcLen) {
  const n = outer.length;
  const perim = profileOutlineArcMetrics(outer).perimeter;
  const t = ((arcLen % perim) + perim) % perim;
  let acc = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ax = outer[i][0];
    const ay = outer[i][1];
    const bx = outer[j][0];
    const by = outer[j][1];
    const segLen = Math.hypot(bx - ax, by - ay);
    if (acc + segLen >= t - 1e-9 || i === n - 1) {
      const u = segLen > 1e-9 ? (t - acc) / segLen : 0;
      const x = ax + (bx - ax) * u;
      const y = ay + (by - ay) * u;
      const nx = normals[i][0] + (normals[j][0] - normals[i][0]) * u;
      const ny = normals[i][1] + (normals[j][1] - normals[i][1]) * u;
      const nlen = Math.hypot(nx, ny) || 1;
      return { x, y, nx: nx / nlen, ny: ny / nlen };
    }
    acc += segLen;
  }
  return { x: outer[0][0], y: outer[0][1], nx: normals[0][0], ny: normals[0][1] };
}

/** Arc length to the profile point facing the default camera (-Y). */
function profileArcFrontOffset(outer) {
  let bestY = Infinity;
  let bestArc = 0;
  let acc = 0;
  const n = outer.length;
  for (let i = 0; i < n; i++) {
    const y = outer[i][1];
    if (y < bestY) {
      bestY = y;
      bestArc = acc;
    }
    const j = (i + 1) % n;
    acc += Math.hypot(outer[j][0] - outer[i][0], outer[j][1] - outer[i][1]);
  }
  return bestArc;
}

function unwrapWrapX(x, anchor, perim) {
  let dx = x - anchor;
  dx -= perim * Math.round(dx / perim);
  return anchor + dx;
}

/** Keep wall-wrap polygons near their anchor so edges don't chord across the seam. */
function normalizeWrapShapeGroups(shapeGroups, perim, anchorX) {
  if (!shapeGroups?.length || !Number.isFinite(perim) || perim <= 0) return shapeGroups;
  const mapPt = ([x, y]) => [unwrapWrapX(x, anchorX, perim), y];
  return shapeGroups.map((group) => ({
    outer: group.outer.map(mapPt),
    holes: group.holes.map((hole) => hole.map(mapPt)),
  }));
}

function wrapFlatFromArt() {
  return (px, py) => [px, py];
}

function wrapExtrudeCaps(frame, caps) {
  return frame.face === "wrap" ? { caps, flatFromArt: wrapFlatFromArt() } : { caps };
}

/** Wall-wrap frame — art maps around the outer profile (arc length × height).
 * When surface texture is on, offsets ride the same displacement as the body wall
 * so emboss/decals are not shredded by ripple peaks punching through flat art. */
export function getProfileWrapFaceFrame(outerProfile, meta, params = null) {
  const outer = outerProfile.map((p) => [p[0], p[1]]);
  const normals = profileOutlineNormals(outer);
  const metrics = profileOutlineArcMetrics(outer);
  const totalH = meta.outer?.h ?? meta.totalH ?? 40;
  const floor = meta.outer?.h != null && meta.inner?.h != null
    ? meta.outer.h - meta.inner.h
    : (meta.floor ?? 0);
  const arcOrigin = profileArcFrontOffset(outer);
  const textureSpec = resolveVaseTexture(params || {}, {
    height: totalH,
    floor,
    diameter: metrics.effectiveDiameter,
  });
  const textured = textureSpec && textureSpec.style !== "none" && textureSpec.depth > 0;
  const texSpec = textured
    ? { ...textureSpec, height: totalH, floor, diameter: metrics.effectiveDiameter }
    : null;

  return {
    face: "wrap",
    faceW: metrics.perimeter,
    faceH: totalH,
    centerZ: totalH * 0.5,
    horizontal: false,
    arcOrigin,
    textured: !!textured,
    mapPoint: (px, py, offset) => {
      const arcLen = px + arcOrigin;
      const pt = profilePointAtArc(outer, normals, arcLen);
      const z = clamp(py, 0, totalH);
      let surfaceDr = 0;
      if (texSpec) {
        const perim = metrics.perimeter || 1;
        const t = ((arcLen % perim) + perim) % perim;
        const angle = (t / perim) * Math.PI * 2 - Math.PI;
        surfaceDr = vaseTextureDisplacement(angle, z, texSpec);
      }
      const r = surfaceDr + offset;
      return [pt.x + pt.nx * r, pt.y + pt.ny * r, z];
    },
  };
}

function isLabelExport(params) {
  return !!params?.__labelExportStandoff
    || params?.__embossMode === "deboss-inlay"
    || params?.__embossMode === "deboss-cutter";
}

/** Full-resolution wrap row shells — export/AMS only; preview uses WRAP_TRACE_PREVIEW_MAX_ROWS. */
function wrapSlabUseFineRows(params) {
  return isLabelExport(params);
}

function labelMaskSimplifyTol(maskW, params) {
  if (isLabelExport(params)) return Math.max(0.015, maskW / 12000);
  return Math.max(0.1, maskW / 1400);
}

function labelSmoothPasses(sizeMm, params, { hiRes = false } = {}) {
  if (isLabelExport(params)) return 1;
  if (hiRes) return 5;
  if (sizeMm <= 8) return 4;
  if (sizeMm <= 14) return 3;
  if (sizeMm <= 20) return 3;
  return 2;
}

function finishExportShapeGroups(groups, params) {
  if (!groups?.length || !isLabelExport(params)) return groups;
  return groups;
}

/** Solid filled regions from outline strokes — avoids dashed quad segments in export. */
function shapeGroupsFromStrokePathsForExport(paths, maskW, maskH, strokePx, artH, params) {
  const smoothPasses = labelSmoothPasses(artH, params);
  const simplifyTol = Math.max(0.03, maskW / 6000);
  const prepared = prepareStrokePaths(paths, simplifyTol, smoothPasses);
  const exportStrokePx = strokePx * 1.85;
  let mask = rasterizeStrokePathsToMask(prepared, maskW, maskH, exportStrokePx);
  mask = dilateMask(mask, maskW, maskH, 3);
  return prepareShapeGroups(
    groupPolygonsWithHoles(maskToPolygons(mask, maskW, maskH)),
    simplifyTol,
    0,
  );
}

/** How much to morph text masks for label/sign export.
 * Old path dilated ×4 (then union dilated ×2–4 again) — Light looked like Black blobs. */
function textExportMorphPasses(params) {
  const weight = resolveEmbossFontWeight(params?.embossFont || "bebas", params?.embossFontWeight);
  // close = dilate+erode (seal AA pinholes, keep stroke width). Never heavy-dilate letters.
  if (weight <= 350) return { close: 1, dilate: 0, erode: 1 };
  if (weight <= 700) return { close: 1, dilate: 0, erode: 0 };
  return { close: 1, dilate: 1, erode: 0 };
}

function prepareTextExportMask(mask, maskW, maskH, params) {
  if (!isLabelExport(params)) return mask;
  let out = mask instanceof Uint8Array ? mask.slice() : new Uint8Array(mask);
  const morph = textExportMorphPasses(params);
  if (morph.close > 0) out = closeBitmapMask(out, maskW, maskH, morph.close);
  if (morph.dilate > 0) out = dilateMask(out, maskW, maskH, morph.dilate);
  for (let i = 0; i < morph.erode; i++) out = erodeBitmapMask(out, maskW, maskH);
  return out;
}

/** Wrap text row shells — face-space origin (left/bottom) so move sliders actually shift the mesh. */
function buildWrapTextMaskSlabMesh(frame, mask, maskW, maskH, scale, faceLeft, faceBottom, glyphLeft, glyphBottom, anchorX, artW, d0, d1, opts = {}) {
  const maxRows = opts.fineRows ? maskH : 2048;
  let stepPx = 1;
  stepPx = wrapSlabRowStepPx(maskH, stepPx, { maxRows, maxPreviewIndices: 0 });
  const positions = [];
  const indices = [];
  const wrapSeam = frame.face === "wrap" && frame.faceW > 0;
  const mapX = (col) => {
    const px = faceLeft + (col - glyphLeft) * scale;
    return wrapSeam ? unwrapWrapX(px, anchorX, frame.faceW) : px;
  };
  const mapZ = (py) => faceBottom + (glyphBottom - py) * scale;
  const runOpts = {
    solid: true,
    maxRunMm: wrapSeam ? clamp(artW * 0.12, 3.5, 8) : 0,
  };
  for (let row = 0; row < maskH; row += stepPx) {
    const py0 = row;
    const py1 = Math.min(maskH, row + stepPx);
    const my0 = mapZ(py1);
    const my1 = mapZ(py0);
    let col = 0;
    while (col < maskW) {
      while (col < maskW && !bandMaskFilled(mask, maskW, py0, py1, col)) col++;
      const start = col;
      while (col < maskW && bandMaskFilled(mask, maskW, py0, py1, col)) col++;
      if (col <= start) continue;
      pushWrapRunShellSpan(positions, indices, frame, mapX(start), mapX(col), my0, my1, d0, d1, runOpts);
    }
  }
  return indices.length ? { positions, indices } : null;
}

/** Wrap arc/flat text via row shells — same seam anchor as traced graphics. */
function buildWrapTextSlabFromLayout(layout, params, d0, d1) {
  const {
    frame, raster, scale, left, bottom, cx, maskW, maskH, glyphLeft, glyphBottom,
  } = layout;
  const textMask = prepareTextExportMask(raster.mask, maskW, maskH, params);
  const artW = Math.max(0.4, layout.right - layout.left);
  return buildWrapTextMaskSlabMesh(
    frame,
    textMask,
    maskW,
    maskH,
    scale,
    left,
    bottom,
    glyphLeft ?? 0,
    glyphBottom ?? maskH - 1,
    cx,
    artW,
    d0,
    d1,
    { fineRows: wrapSlabUseFineRows(params) },
  );
}

function collectTextEmbossShapeGroups(meta, params, layoutIn = null) {
  const layout = layoutIn ?? computeTextArtLayout(meta, params);
  if (!layout) return null;

  const { frame, raster, scale, xOff, zOff, maskW, maskH, cx, cy, rotation } = layout;
  const simplifyTol = labelMaskSimplifyTol(maskW, params);
  const glyphMm = layout.glyphHeightMm ?? 7;
  const smoothPasses = isLabelExport(params) ? 0 : labelSmoothPasses(glyphMm, params);
  const textMask = prepareTextExportMask(raster.mask, maskW, maskH, params);
  let shapeGroups;
  if (isLabelExport(params)) {
    const rawGroups = groupPolygonsWithHoles(maskToPolygons(textMask, maskW, maskH));
    // Arc letters are spaced on a curve — union would merge/warp them.
    if (layout.arcMode) {
      shapeGroups = prepareShapeGroups(rawGroups, simplifyTol, 0);
    } else {
      // dilatePasses must stay 0 — even 2–4 merges neighbouring letters and fills counters.
      // Raise maxDim so letter curves aren't crushed through a 1024 re-raster.
      const united = unionShapeGroupsToPrepared(
        rawGroups, maskW, maskH, simplifyTol, 0, 0, TEXT_UNION_MAX_DIM,
      );
      shapeGroups = united.length ? united : prepareShapeGroups(rawGroups, simplifyTol, 0);
    }
  } else {
    shapeGroups = prepareShapeGroups(
      groupPolygonsWithHoles(maskToPolygons(textMask, maskW, maskH)),
      simplifyTol,
      smoothPasses,
    );
  }

  const remapped = shapeGroups.map((group) => ({
    outer: group.outer.map(([px, py]) => [xOff + px * scale, zOff + (maskH - py) * scale]),
    holes: group.holes.map((h) => h.map(([px, py]) => [xOff + px * scale, zOff + (maskH - py) * scale])),
  }));

  let shaped = remapped.map((g) => rotateShapeGroup(g, cx, cy, rotation));
  if (frame.face === "wrap") {
    const wrapAnchor = cx ?? frame.faceW / 2;
    shaped = normalizeWrapShapeGroups(shaped, frame.faceW, wrapAnchor);
  }
  shaped = finishExportShapeGroups(shaped, params);

  return {
    frame,
    shapeGroups: shaped,
    depth: clamp(params.embossDepth ?? 0.7, 0.3, 4),
  };
}

function inflateShapeGroups(shapeGroups, padMm = 0.25) {
  if (!padMm || !shapeGroups?.length) return shapeGroups;
  return shapeGroups.map((group) => ({
    outer: inflateRing(group.outer, padMm),
    holes: group.holes.map((hole) => inflateRing(hole, -padMm)),
  }));
}

function inflateRing(ring, pad) {
  if (!ring?.length || !pad) return ring;
  const pts = ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]
    ? ring.slice(0, -1)
    : ring.slice();
  let cx = 0;
  let cy = 0;
  for (const [x, y] of pts) {
    cx += x;
    cy += y;
  }
  cx /= pts.length;
  cy /= pts.length;
  const out = pts.map(([x, y]) => {
    const dx = x - cx;
    const dy = y - cy;
    const len = Math.hypot(dx, dy) || 1;
    return [x + (dx / len) * pad, y + (dy / len) * pad];
  });
  if (out.length) out.push(out[0]);
  return out;
}

/** Pre-unioned at trace time, or fast cached preview merge — never sync full union on slider rebuilds. */
function unionDenseTraceShapeGroups(sourceGroups, maskW, maskH, artH, params, bitmap) {
  if (bitmap?.shapeGroupsUnited) return sourceGroups;
  if (!sourceGroups?.length || sourceGroups.length <= 1) return sourceGroups;
  if (isLabelExport(params)) {
    const simplifyTol = Math.max(0.06, maskW / 4000);
    const { groups } = unionDenseEmbossShapeGroups(sourceGroups, maskW, maskH, { simplifyTol, smoothPasses: 1 });
    return groups;
  }
  if (bitmap?.previewShapeGroups?.length) return bitmap.previewShapeGroups;
  const merged = previewMergeTraceShapeGroups(sourceGroups, maskW, maskH);
  if (bitmap && merged !== sourceGroups) bitmap.previewShapeGroups = merged;
  return merged;
}

function collectBitmapGraphicShapeGroups(meta, params, bitmap) {
  params = hoodieGraphicParams(params);
  if (!bitmap?.width || !bitmap.height) return null;
  const frame = getEmbossFaceFrame(meta, params.embossFace || "front", params);
  const artH = wrapSafeArtHeight(frame, params.embossTraceSize ?? 16);
  const maxW = Math.min(frame.faceW * 0.62, 56);
  const scale = Math.min(artH / bitmap.height, maxW / bitmap.width);
  if (!Number.isFinite(scale) || scale <= 0) return null;

  const artWidth = bitmap.width * scale;
  const artHeight = bitmap.height * scale;
  const { xOff, zOff } = decorPlacementOffsets(params, frame, artWidth, artHeight);
  const rotCx = xOff + artWidth / 2;
  const rotCy = zOff + artHeight / 2;
  const rotation = params.decorRotation ?? 0;
  const maskW = Math.round(bitmap.width);
  const maskH = Math.round(bitmap.height);
  if (maskW <= 0 || maskH <= 0) return null;

  const mapFaceGroup = (group) => {
    const remapped = {
      outer: group.outer.map(([px, py]) => [xOff + px * scale, zOff + (maskH - py) * scale]),
      holes: group.holes.map((h) => h.map(([px, py]) => [xOff + px * scale, zOff + (maskH - py) * scale])),
    };
    let shaped = rotateShapeGroup(remapped, rotCx, rotCy, rotation);
    if (frame.face === "wrap") shaped = normalizeWrapShapeGroups([shaped], frame.faceW, rotCx)[0];
    return shaped;
  };

  const groups = [];
  if (bitmap.shapeGroups?.length) {
    const sourceGroups = unionDenseTraceShapeGroups(bitmap.shapeGroups, maskW, maskH, artH, params, bitmap);
    for (const group of sourceGroups) groups.push(mapFaceGroup(group));
  } else if (bitmap.mask?.length === maskW * maskH) {
    const mask = bitmap.mask instanceof Uint8Array ? bitmap.mask : new Uint8Array(bitmap.mask);
    const hiRes = maskW >= 1800;
    const smoothPasses = labelSmoothPasses(artH, params, { hiRes });
    const simplifyTol = isLabelExport(params)
      ? Math.max(0.06, maskW / 4000)
      : hiRes ? Math.max(0.1, maskW / 1400) : Math.max(0.28, maskW / 480);
    const shapeGroups = prepareShapeGroups(
      groupPolygonsWithHoles(maskToPolygons(mask, maskW, maskH)),
      simplifyTol,
      smoothPasses,
    );
    for (const group of shapeGroups) groups.push(mapFaceGroup(group));
  } else if (bitmap.strokePaths?.length) {
    const strokePx = bitmap.strokeWidth ?? Math.max(1.35, maskW / 88);
    if (isLabelExport(params)) {
      let shapeGroups = shapeGroupsFromStrokePathsForExport(
        bitmap.strokePaths,
        maskW,
        maskH,
        strokePx,
        artH,
        params,
      );
      if (shapeGroups.length > 1) {
        const simplifyTol = Math.max(0.06, maskW / 4000);
        const united = unionShapeGroupsToPrepared(
          shapeGroups,
          maskW,
          maskH,
          simplifyTol,
          1,
          4,
        );
        if (united.length) shapeGroups = united;
      }
      for (const group of shapeGroups) groups.push(mapFaceGroup(group));
    } else {
      const smoothPasses = labelSmoothPasses(artH, params);
      const simplifyTol = Math.max(0.22, maskW / 520);
      const paths = prepareStrokePaths(bitmap.strokePaths, simplifyTol, smoothPasses);
      const halfW = clamp(scale * strokePx * 0.55, 0.35, 2.2);
      const mapPt = (px, py) => rotateFacePoint(rotCx, rotCy, xOff + px * scale, zOff + (maskH - py) * scale, rotation);
      for (const path of paths) {
        if (path.length < 2) continue;
        for (let i = 0; i < path.length - 1; i++) {
          const [x0, y0] = mapPt(path[i][0], path[i][1]);
          const [x1, y1] = mapPt(path[i + 1][0], path[i + 1][1]);
          const dx = x1 - x0;
          const dy = y1 - y0;
          const len = Math.hypot(dx, dy) || 1;
          const nx = (-dy / len) * halfW;
          const ny = (dx / len) * halfW;
          groups.push({
            outer: [
              [x0 + nx, y0 + ny],
              [x1 + nx, y1 + ny],
              [x1 - nx, y1 - ny],
              [x0 - nx, y0 - ny],
              [x0 + nx, y0 + ny],
            ],
            holes: [],
          });
        }
      }
    }
  }

  return groups.length ? { frame, shapeGroups: finishExportShapeGroups(groups, params) } : null;
}

function collectSvgGraphicShapeGroups(meta, params, svgText) {
  params = hoodieGraphicParams(params);
  const parsed = parseSvgPaths(svgText);
  const layout = computeSvgArtLayout(parsed, meta, params);
  if (!layout) return null;

  const { frame, sw, sh, artH, scale } = layout;
  const strokePaths = parsed.strokePaths || [];
  const fillRings = parsed.fillRings || [];
  const fillRingItems = parsed.fillRingItems || fillRings.map((ring) => ({ ring, fill: "#000000" }));
  const groups = [];

  if (fillRingItems.length) {
    const shapeGroups = svgPrepareFillShapeGroups(fillRingItems, parsed.viewBox, sw, sh, artH, params);
    for (const group of shapeGroups) {
      const remapped = {
        outer: group.outer.map(([x, y]) => mapSvgArtPoint(layout, x, y)),
        holes: group.holes.map((h) => h.map(([x, y]) => mapSvgArtPoint(layout, x, y))),
      };
      let shaped = remapped;
      if (frame.face === "wrap") shaped = normalizeWrapShapeGroups([remapped], frame.faceW, layout.rotCx)[0];
      groups.push(shaped);
    }
  }

  if (strokePaths.length) {
    const svgStroke = parsed.strokeWidth ?? 1.5;
    const maskW = Math.max(1, Math.round(sw));
    const maskH = Math.max(1, Math.round(sh));
    if (isLabelExport(params)) {
      const shapeGroups = shapeGroupsFromStrokePathsForExport(
        strokePaths,
        maskW,
        maskH,
        svgStroke,
        artH,
        params,
      );
      for (const group of shapeGroups) {
        const remapped = {
          outer: group.outer.map(([x, y]) => mapSvgArtPoint(layout, x, y)),
          holes: group.holes.map((h) => h.map(([x, y]) => mapSvgArtPoint(layout, x, y))),
        };
        let shaped = remapped;
        if (frame.face === "wrap") shaped = normalizeWrapShapeGroups([remapped], frame.faceW, layout.rotCx)[0];
        groups.push(shaped);
      }
    } else {
      const halfW = clamp(scale * svgStroke * 0.55, 0.35, 2.2);
      const smoothPasses = labelSmoothPasses(artH, params);
      const simplifyTol = Math.max(0.18, Math.max(sw, sh) / 520);
      const closedPaths = strokePaths.map((line) => {
        if (line.length < 2) return line;
        const a = line[0];
        const b = line[line.length - 1];
        if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.5) return line;
        return [...line, a];
      });
      const paths = prepareStrokePaths(closedPaths, simplifyTol, smoothPasses);
      for (const path of paths) {
        if (path.length < 2) continue;
        for (let i = 0; i < path.length - 1; i++) {
          const [x0, y0] = mapSvgArtPoint(layout, path[i][0], path[i][1]);
          const [x1, y1] = mapSvgArtPoint(layout, path[i + 1][0], path[i + 1][1]);
          const dx = x1 - x0;
          const dy = y1 - y0;
          const len = Math.hypot(dx, dy) || 1;
          const nx = (-dy / len) * halfW;
          const ny = (dx / len) * halfW;
          groups.push({
            outer: [
              [x0 + nx, y0 + ny],
              [x1 + nx, y1 + ny],
              [x1 - nx, y1 - ny],
              [x0 - nx, y0 - ny],
              [x0 + nx, y0 + ny],
            ],
            holes: [],
          });
        }
      }
    }
  }

  return groups.length ? { frame, shapeGroups: finishExportShapeGroups(groups, params) } : null;
}

function collectGraphicEmbossShapeGroups(meta, params, svgText = "") {
  const traceData = params.embossTraceRects;
  const hasTrace =
    params.embossTraceEnabled &&
    (traceData?.shapeGroups?.length ||
      traceData?.strokePaths?.length ||
      traceData?.mask?.length ||
      traceData?.rects?.length);
  const hasSvg = params.embossSvgEnabled && !!svgText?.trim() && !hasTrace;
  if (hasTrace) return collectBitmapGraphicShapeGroups(meta, params, traceData);
  if (hasSvg) return collectSvgGraphicShapeGroups(meta, params, svgText);
  return null;
}

/** Combined text + graphic ink footprint on the label face (for export wall pockets). */
export function collectLabelEmbossShapeGroups(meta, params, svgText = "") {
  const groups = [];
  let frame = null;
  const textCol = collectTextEmbossShapeGroups(meta, params);
  if (textCol) {
    frame = textCol.frame;
    groups.push(...textCol.shapeGroups);
  }
  const graphicCol = collectGraphicEmbossShapeGroups(meta, params, svgText);
  if (graphicCol) {
    frame = frame || graphicCol.frame;
    if (graphicCol.frame?.face !== frame?.face) return textCol || graphicCol;
    groups.push(...graphicCol.shapeGroups);
  }
  if (!groups.length || !frame) return null;
  return { frame, shapeGroups: groups };
}

/** Cut wall pockets under separate-colour art so the slicer keeps the rest of the face. */
export function punchBodyShellForLabelExport(shellMesh, meta, params, svgText = "") {
  if (!shellMesh?.indices?.length) return shellMesh;
  const face = params.embossFace || "front";
  if (face === "lid" || face === "wrap" || params.embossDeboss) return shellMesh;
  const collected = collectLabelEmbossShapeGroups(meta, params, svgText);
  if (!collected?.shapeGroups?.length) return shellMesh;
  const inflated = inflateShapeGroups(collected.shapeGroups, 0.3);
  return removeWallTrisUnderEmboss(
    { positions: shellMesh.positions.slice(), indices: shellMesh.indices.slice() },
    collected.frame,
    meta,
    inflated,
  );
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
    case "bottom":
      return { onPlane: (w) => Math.abs(w[2]) <= eps, normal: [0, 0, -1], to2D: (w) => [w[0], w[1]] };
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
    const { caps, flatFromArt } = wrapExtrudeCaps(frame, "both");
    extrudeShapeGroupBetween(positions, indices, group, mapTop, mapBot, flatCoord, caps, flatFromArt);
  }

  return removeWallTrisUnderEmboss({ positions, indices }, frame, meta, shapeGroups);
}

/** Closed letter solids for separate-colour export (no wall interaction). */
export function buildTextLabelExportMesh(meta, params) {
  const p = { ...params, __labelExportKind: "text" };
  const layout = computeTextArtLayout(meta, p);
  if (!layout) return null;

  const { d0, d1 } = labelOffsets(p);

  if (layout.frame.face === "wrap") {
    const slab = buildWrapTextSlabFromLayout(layout, p, d0, d1);
    if (slab?.indices?.length) return slab;
    return null;
  }

  const collected = collectTextEmbossShapeGroups(meta, p, layout);
  if (!collected?.shapeGroups?.length) return null;

  const { frame, shapeGroups } = collected;
  // Export: watertight voxel letters — earcut vector solids ship open edges (b373 Text bug).
  if (isLabelExport(p)) {
    const solid = buildFlatShapeGroupsSolidMesh(frame, shapeGroups, d0, d1, p);
    if (solid?.indices?.length) return solid;
  }
  const positions = [];
  const indices = [];
  // Flat faces: vector letter solids (preview only — export uses the voxel solid above).
  extrudeGroupsOnFace(positions, indices, frame, shapeGroups, d0, d1, p);
  return positions.length ? { positions, indices } : null;
}

function fitMultiColourLayerMask(layer, maskW, maskH, params) {
  let mask = layer.mask instanceof Uint8Array ? layer.mask.slice() : Uint8Array.from(layer.mask || []);
  let w = maskW;
  let h = maskH;
  const maxCells = isLabelExport(params) ? MULTI_COLOUR_EXPORT_MAX_CELLS : MULTI_COLOUR_PREVIEW_MAX_CELLS;
  if (w * h > maxCells) {
    const ds = downsampleEmbossMaskToFit(mask, w, h, maxCells);
    mask = ds.mask;
    w = ds.maskW;
    h = ds.maskH;
  }
  return { mask, maskW: w, maskH: h };
}

function layerToEmbossBitmap(traceData, layer, params = null) {
  const mask = layer.mask instanceof Uint8Array ? layer.mask : Uint8Array.from(layer.mask || []);
  // Always rebuild at mesh time — trace-time groups are too tight; cached dilate bleeds into neighbours.
  const shapeGroups = multiColourLayerShapeGroups(
    mask,
    traceData.width,
    traceData.height,
    params || { __embossMode: "emboss" },
  );
  return {
    mask,
    silhouetteMask: mask,
    rects: layer.rects?.map((r) => ({ ...r })) || [],
    width: traceData.width,
    height: traceData.height,
    mode: "silhouette",
    maskFillPct: layer.maskFillPct,
    outlineRaster: false,
    multiColourContour: true,
    shapeGroups: shapeGroups || [],
  };
}

function multiColourLayerShapeGroups(mask, maskW, maskH, params) {
  if (!mask?.length || maskW <= 0 || maskH <= 0) return [];
  const isExport = isLabelExport(params);
  const simplifyTol = isExport
    ? Math.max(0.22, maskW / 680)
    : Math.max(0.14, maskW / 1100);
  const smoothPasses = isExport ? 4 : 5;
  const maxDim = isExport ? 640 : 896;
  const raw = groupPolygonsWithHoles(maskToPolygons(mask, maskW, maskH));
  if (!raw.length) return [];
  const seed = raw.map(({ outer, holes }) => ({ outer, holes: holes || [] }));
  // dilatePasses=0 — exclusive AMS layers; outward dilate caused z-fighting / hairy seams at colour edges.
  let groups = unionShapeGroupsToPrepared(seed, maskW, maskH, simplifyTol, smoothPasses, 0, maxDim);
  if (!groups.length) {
    groups = prepareShapeGroups(seed, simplifyTol, smoothPasses);
  }
  groups = filterDegenerateShapeGroups(groups, maskW, maskH);
  return finishExportShapeGroups(groups, params);
}

function multiColourExportDilatedMask(mask, maskW, maskH, frame, artH) {
  let out = mask instanceof Uint8Array ? mask.slice() : Uint8Array.from(mask || []);
  const maxW = Math.min(frame.faceW * 0.62, 56);
  const scale = Math.min(artH / maskH, maxW / maskW);
  // Line-art ink is ~1 px wide — below 0.4 mm nozzle unless widened for export.
  const minStrokePx = Math.max(2, Math.ceil(0.52 / Math.max(scale, 0.008)));
  if (minStrokePx > 1) out = dilateMask(out, maskW, maskH, minStrokePx);
  return closeBitmapMask(out, maskW, maskH, 1);
}

/** Per AMS colour layer — golden ink-mask emboss (buildEmbossBitmap) on wrap and flat. */
function buildMultiColourLayerEmboss(meta, params, traceData, layer) {
  const { mask, maskW, maskH } = fitMultiColourLayerMask(layer, traceData.width, traceData.height, params);
  const outlineRaster = !!(traceData.outlineRaster || layer.outlineRaster);
  const bitmapOpts = {
    mask,
    width: maskW,
    height: maskH,
    mode: traceData.mode || layer.mode || "silhouette",
    outlineRaster,
    colorLogo: !!(traceData.colorLogo || layer.colorLogo),
    maskFillPct: layer.maskFillPct ?? traceData.maskFillPct,
  };

  // Same path as coffee-bag / dragons preview — dilated vectors & accent slabs shredded line art.
  // Hoodie logos originate as PNG masks, unlike its vector back text.  Mark just
  // those bitmap layers for print-safe resampling in buildHoodieFaceStampMesh.
  const artParams = isHoodieArtParams(params)
    ? { ...params, __hoodieRasterCleanup: true }
    : params;
  return buildEmbossBitmap(meta, artParams, ensureEmbossBitmapMask(bitmapOpts));
}

function hexLuma(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
  if (!m) return 128;
  const v = parseInt(m[1], 16);
  return 0.299 * ((v >> 16) & 255) + 0.587 * ((v >> 8) & 255) + 0.114 * (v & 255);
}

/** 2-layer export: close hairline cracks in the LIGHT layer (anti-alias pixels claimed by
 * neither colour leave sub-nozzle body-colour slivers between dark strokes — the stripy
 * coffee sack). Light mask gets morphological close, then dark ink is subtracted back. */
function fillLightLayerGapsForExport(traceData, params) {
  if (!isLabelExport(params)) return traceData;
  const layers = traceData.colorLayers;
  if (layers?.length !== 2) return traceData;
  const w = traceData.width;
  const h = traceData.height;
  if (!(layers[0].mask?.length === w * h && layers[1].mask?.length === w * h)) return traceData;
  const darkFirst = hexLuma(layers[0].hex) <= hexLuma(layers[1].hex);
  const dark = layers[darkFirst ? 0 : 1];
  const light = layers[darkFirst ? 1 : 0];
  const darkMask = dark.mask instanceof Uint8Array ? dark.mask : Uint8Array.from(dark.mask);
  let lightMask = light.mask instanceof Uint8Array ? light.mask.slice() : Uint8Array.from(light.mask);
  lightMask = closeBitmapMask(lightMask, w, h, 2);
  for (let i = 0; i < lightMask.length; i++) if (darkMask[i]) lightMask[i] = 0;
  const patched = { ...light, mask: lightMask };
  return { ...traceData, colorLayers: darkFirst ? [dark, patched] : [patched, dark] };
}

/** Per-colour wrap/front emboss meshes for multi-colour logo traces. */
export function buildMultiColourGraphicEmboss(meta, params, traceData) {
  params = hoodieGraphicParams(params);
  if (!traceData?.multiColour || !traceData.colorLayers?.length) return null;
  traceData = fillLightLayerGapsForExport(traceData, params);
  const parts = [];
  for (const layer of traceData.colorLayers) {
    if (!layer.mask?.length && !layer.shapeGroups?.length) continue;
    const mesh = buildMultiColourLayerEmboss(meta, params, traceData, layer);
    if (mesh?.indices?.length) {
      parts.push({
        mesh,
        color: layer.hex,
        name: `Art ${layer.label || layer.hex}`,
        label: layer.label,
      });
    }
  }
  return parts.length ? parts : null;
}

/** Closed graphic solids for separate-colour export (trace/SVG — not thin stroke quads). */
export function buildGraphicLabelExportMesh(meta, params, svgText = "") {
  const p = { ...params, __labelExportKind: "art" };
  const traceData = p.embossTraceRects;
  const hasTrace =
    p.embossTraceEnabled &&
    (traceData?.multiColour && traceData.colorLayers?.length
      || traceData?.shapeGroups?.length
      || traceData?.strokePaths?.length
      || traceData?.mask?.length
      || traceData?.rects?.length
      || traceData?.silhouetteMask?.length);
  if (hasTrace && traceData?.multiColour && traceData.colorLayers?.length) {
    const colourParts = buildMultiColourGraphicEmboss(meta, p, traceData);
    if (colourParts?.length === 1) return colourParts[0].mesh;
    if (colourParts?.length > 1) return mergeMeshes(...colourParts.map((cp) => cp.mesh));
  }
  // Trace export must match preview — ink-mask row shells, not shapeGroup earcut / coarse decals.
  if (hasTrace && !traceData?.multiColour) {
    const mesh = buildEmbossBitmap(meta, p, traceData);
    if (mesh?.indices?.length) return mesh;
  }

  const collected = collectGraphicEmbossShapeGroups(meta, p, svgText);
  if (!collected?.shapeGroups?.length) return null;

  if (isLabelExport(p)) {
    const { d0, d1 } = labelOffsets(p);
    const slab = buildFaceDecalSlabMesh(collected.frame, collected.shapeGroups, { d0, d1 });
    if (slab?.indices?.length) return slab;
  }

  const { frame, shapeGroups } = collected;
  const { d0, d1 } = labelOffsets(p);
  const positions = [];
  const indices = [];
  extrudeGroupsOnFace(positions, indices, frame, shapeGroups, d0, d1, p);
  return positions.length ? { positions, indices } : null;
}

function appendColoredMeshPart(positions, indices, triangleExtruders, mesh, extruder) {
  if (!mesh?.indices?.length) return;
  const vBase = positions.length / 3;
  for (let i = 0; i < mesh.positions.length; i++) positions.push(mesh.positions[i]);
  for (let t = 0; t < mesh.indices.length; t += 3) {
    indices.push(mesh.indices[t] + vBase, mesh.indices[t + 1] + vBase, mesh.indices[t + 2] + vBase);
    triangleExtruders.push(extruder);
  }
}

/** One AMS object — body wall intact, art/text painted per triangle (legacy; prefer separate parts). */
export function buildMergedAmsExportMesh(shellMesh, meta, params, svgText = "", { includeArt = true, includeText = true } = {}) {
  if (!shellMesh?.indices?.length) return null;
  const exportParams = { ...params, __labelExportMerged: true };
  const positions = [];
  const indices = [];
  const triangleExtruders = [];

  appendColoredMeshPart(positions, indices, triangleExtruders, shellMesh, 1);
  let extruder = 2;
  if (includeArt) {
    const artMesh = buildLabelGraphicEmboss(meta, exportParams, svgText, "emboss");
    appendColoredMeshPart(positions, indices, triangleExtruders, artMesh, extruder);
    extruder += 1;
  }
  if (includeText) {
    const textMesh = buildTextLabelExportMesh(meta, exportParams);
    appendColoredMeshPart(positions, indices, triangleExtruders, textMesh, extruder);
  }

  return indices.length ? { positions, indices, triangleExtruders } : null;
}

export function buildWatertightExportMesh(bodyMesh, meta, params) {
  if (!bodyMesh || params.embossDeboss) return bodyMesh;
  const face = params.embossFace || "front";
  if (face === "lid" || face === "wrap" || params.joinerEnabled) return bodyMesh;

  const shell = bodyMesh.shellMesh || bodyMesh;
  if (params.embossText?.trim() && !params.embossDeboss) {
    return buildWatertightTextEmbossExport(shell, meta, params) || bodyMesh;
  }
  return bodyMesh;
}

const WATERMARK_DEPTH = 0.6;

function textMaskToShapeGroups(text, fontId, labelHMm, xOff, zOff) {
  const raster = rasterTextMask(text, fontId, 640, "left");
  if (!raster?.mask?.length) return [];
  const { mask, width: maskW, height: maskH } = raster;
  const glyph = glyphBoundsFromMask(mask, maskW, maskH);
  if (!glyph) return [];
  const scale = labelHMm / glyph.height;
  if (!Number.isFinite(scale) || scale <= 0) return [];
  const canvasXOff = xOff - glyph.left * scale;
  const canvasZOff = zOff - (maskH - glyph.bottom) * scale;
  const simplifyTol = Math.max(0.08, maskW / 1600);
  const smoothPasses = labelHMm <= 4 ? 3 : 2;
  const shapeGroups = prepareShapeGroups(
    groupPolygonsWithHoles(maskToPolygons(mask, maskW, maskH)),
    simplifyTol,
    smoothPasses,
  );
  return shapeGroups.map((group) => ({
    outer: group.outer.map(([px, py]) => [canvasXOff + px * scale, canvasZOff + (maskH - py) * scale]),
    holes: group.holes.map((h) => h.map(([px, py]) => [canvasXOff + px * scale, canvasZOff + (maskH - py) * scale])),
  }));
}

function monogramShapeGroups(frame) {
  const inset = 6;
  const monoH = 7;
  const xOff = -frame.faceW / 2 + inset;
  const zOff = -frame.faceH / 2 + inset;
  const raster = rasterTextMask("MD", "impact", 320, "left");
  if (!raster?.mask?.length) return [];
  const { mask, width: maskW, height: maskH } = raster;
  const glyph = glyphBoundsFromMask(mask, maskW, maskH);
  if (!glyph) return [];
  const scale = monoH / glyph.height;
  const canvasXOff = xOff - glyph.left * scale;
  const canvasZOff = zOff - (maskH - glyph.bottom) * scale;
  const shapeGroups = prepareShapeGroups(
    groupPolygonsWithHoles(maskToPolygons(mask, maskW, maskH)),
    Math.max(0.1, maskW / 1400),
    2,
  );
  return shapeGroups.map((group) => ({
    outer: group.outer.map(([px, py]) => [canvasXOff + px * scale, canvasZOff + (maskH - py) * scale]),
    holes: group.holes.map((h) => h.map(([px, py]) => [canvasXOff + px * scale, canvasZOff + (maskH - py) * scale])),
  }));
}

function collectWatermarkShapeGroups(meta, stamp) {
  const frame = getEmbossFaceFrame(meta, "bottom", null);
  const inset = 6;
  const monoH = 7;
  const labelH = 3.2;
  const monoGroups = monogramShapeGroups(frame);
  let monoW = monoH * 1.35;
  if (monoGroups.length) {
    let minX = Infinity;
    let maxX = -Infinity;
    for (const group of monoGroups) {
      for (const [px] of group.outer) {
        minX = Math.min(minX, px);
        maxX = Math.max(maxX, px);
      }
    }
    if (Number.isFinite(minX)) monoW = maxX - minX;
  }
  const line = `MakerDeck · ${stamp.dateStr} · #${String(stamp.serial).padStart(4, "0")}`;
  const textX = -frame.faceW / 2 + inset + monoW + 2.5;
  const textZ = -frame.faceH / 2 + inset + (monoH - labelH) * 0.35;
  const textGroups = textMaskToShapeGroups(line, "consolas", labelH, textX, textZ);
  const shapeGroups = [...monoGroups, ...textGroups];
  if (!shapeGroups.length) return null;
  return { frame, shapeGroups, depth: WATERMARK_DEPTH };
}

function buildWatertightBottomDebossExport(shellMesh, meta, shapeGroups, depth = WATERMARK_DEPTH) {
  const frame = getEmbossFaceFrame(meta, "bottom", null);
  const positions = [];
  const indices = [];
  const stripped = removeExteriorWallTriangles(shellMesh, frame, meta);
  appendMesh(positions, indices, stripped);

  const fw = frame.faceW;
  const fh = frame.faceH;
  const outerRect = [[-fw / 2, -fh / 2], [fw / 2, -fh / 2], [fw / 2, fh / 2], [-fw / 2, fh / 2]];
  const mapSurf = (px, py) => frame.mapPoint(px, py, 0);
  const mapDeep = (px, py) => frame.mapPoint(px, py, -depth);
  const flatCoord = (w) => flatCoordForFrame(frame, w);

  triangulateMappedCap(positions, indices, mapSurf, flatCoord, outerRect, [], true);

  for (const group of shapeGroups) {
    extrudeShapeGroupBetween(positions, indices, group, mapSurf, mapDeep, flatCoord, "both");
  }

  return removeWallTrisUnderEmboss({ positions, indices }, frame, meta, shapeGroups);
}

/** Shallow bottom deboss — MD monogram + date/serial on the exterior underside. */
export function applyExportWatermark(mesh, meta, params, stamp) {
  if (!mesh || params.watermarkEnabled === false || !stamp) return mesh;
  if (meta.shape === "stubbyHolder") return mesh;
  if (!shapeSupportsDecor(meta.shape)) return mesh;
  const collected = collectWatermarkShapeGroups(meta, stamp);
  if (!collected?.shapeGroups?.length) return mesh;
  const shell = mesh.shellMesh || mesh;
  return buildWatertightBottomDebossExport(shell, meta, collected.shapeGroups, collected.depth) || mesh;
}

/** Preview-only groove mesh for the underside watermark (no shell surgery). */
export function buildWatermarkPreviewMesh(meta, stamp) {
  if (!stamp || meta.shape === "stubbyHolder" || !shapeSupportsDecor(meta.shape)) return null;
  const collected = collectWatermarkShapeGroups(meta, stamp);
  if (!collected?.shapeGroups?.length) return null;
  const { frame, shapeGroups, depth } = collected;
  const positions = [];
  const indices = [];
  const mapSurf = (px, py) => frame.mapPoint(px, py, 0);
  const mapDeep = (px, py) => frame.mapPoint(px, py, -depth);
  const flatCoord = (w) => flatCoordForFrame(frame, w);
  for (const group of shapeGroups) {
    extrudeShapeGroupBetween(positions, indices, group, mapSurf, mapDeep, flatCoord, "both");
  }
  return positions.length ? { positions, indices } : null;
}

/** Embossed label text — smooth stencil silhouettes (one solid per letter). */
export function buildEmbossText(meta, params) {
  const layout = computeTextArtLayout(meta, params);
  if (!layout) return null;

  const { d0, d1 } = labelOffsets(params);

  // Wrap — row shells (same golden path as traced graphics). Vector extrude folds arc text to the wrong side.
  if (layout.frame.face === "wrap") {
    const slab = buildWrapTextSlabFromLayout(layout, params, d0, d1);
    if (slab?.indices?.length) return slab;
    return null;
  }

  const collected = collectTextEmbossShapeGroups(meta, params, layout);
  if (!collected) return null;

  if (isHoodieArtParams(params) || isLabelExport(params)) {
    const solid = buildFlatShapeGroupsSolidMesh(collected.frame, collected.shapeGroups, d0, d1, params);
    if (solid?.indices?.length) return solid;
  }

  const positions = [];
  const indices = [];
  const flatCoord = (w) => flatCoordForFrame(collected.frame, w);
  const mapTop = (px, py) => collected.frame.mapPoint(px, py, d1);
  const mapBot = (px, py) => collected.frame.mapPoint(px, py, d0);

  for (const group of collected.shapeGroups) {
    const { caps, flatFromArt } = wrapExtrudeCaps(collected.frame, "top");
    extrudeShapeGroupBetween(positions, indices, group, mapTop, mapBot, flatCoord, caps, flatFromArt);
  }
  return positions.length ? { positions, indices } : null;
}

/** Solid silhouette / traced bitmap emboss on chosen face. */
/** Solid emboss mask — prefer pixel mask; rebuild from rects if session omitted large mask blob. */
function copyEmbossMaskBytes(src) {
  if (!src?.length) return null;
  return src instanceof Uint8Array ? src.slice() : Uint8Array.from(src);
}

function maskFromEmbossRects(rects, maskW, maskH) {
  if (!rects?.length || !maskW || !maskH) return null;
  const mask = new Uint8Array(maskW * maskH);
  for (const r of rects) {
    const x0 = clamp(Math.floor(r.x), 0, maskW);
    const x1 = clamp(Math.ceil(r.x + r.w), 0, maskW);
    const y0 = clamp(Math.floor(r.y), 0, maskH);
    const y1 = clamp(Math.ceil(r.y + r.h), 0, maskH);
    for (let py = y0; py < y1; py++) {
      for (let px = x0; px < x1; px++) mask[py * maskW + px] = 1;
    }
  }
  return mask;
}

function ensureEmbossBitmapMask(bitmap) {
  const maskW = Math.round(bitmap?.width || 0);
  const maskH = Math.round(bitmap?.height || 0);
  if (!maskW || !maskH || !bitmap) return bitmap;
  const expected = maskW * maskH;
  const existing = copyEmbossMaskBytes(bitmap.mask);
  if (existing?.length === expected) return { ...bitmap, mask: existing };
  const sil = copyEmbossMaskBytes(bitmap.silhouetteMask);
  if (sil?.length === expected) return { ...bitmap, mask: sil };
  const fromRects = maskFromEmbossRects(bitmap.rects, maskW, maskH);
  if (fromRects?.length === expected) return { ...bitmap, mask: fromRects };
  if (bitmap.shapeGroups?.length) {
    const mask = rasterizeShapeGroupsToMask(bitmap.shapeGroups, maskW, maskH);
    if (mask?.length === expected) return { ...bitmap, mask: mask instanceof Uint8Array ? mask : Uint8Array.from(mask) };
  }
  return bitmap;
}

const WRAP_EMBOSS_MASK_MAX_CELLS = 1_200_000;
const WRAP_EMBOSS_MASK_MAX_CELLS_EXPORT = 4_000_000;
/** Multi-colour contour preview — full-res trace masks are megapixel; downscale before polygonise. */
const MULTI_COLOUR_PREVIEW_MAX_CELLS = 450_000;
/** Multi-colour 3MF export — one downsample pass keeps wrap row shells printable without megapixel XML. */
const MULTI_COLOUR_EXPORT_MAX_CELLS = 520_000;

function downsampleEmbossMaskToFit(mask, maskW, maskH, maxCells = WRAP_EMBOSS_MASK_MAX_CELLS) {
  let m = mask instanceof Uint8Array ? mask : Uint8Array.from(mask);
  let w = maskW;
  let h = maskH;
  while (w * h > maxCells && Math.max(w, h) > 96) {
    const ds = downsampleBitmapMask(m, w, h, 2);
    m = ds.mask;
    w = ds.maskW;
    h = ds.maskH;
  }
  return { mask: m, maskW: w, maskH: h };
}

/** Cooler wrap golden path — any trace with an ink mask uses row shells (not earcut silhouettes). */
function buildWrapGoldenSlabEmboss(frame, bitmap, params, maskW, maskH, d0, d1) {
  if (frame.face !== "wrap") return null;
  const b = ensureEmbossBitmapMask(bitmap);
  const expected = maskW * maskH;
  if (b?.mask?.length !== expected) return null;
  let slabW = maskW;
  let slabH = maskH;
  let slabMask = b.mask instanceof Uint8Array ? b.mask : Uint8Array.from(b.mask);
  const maxCells = params?.__multiColourAmsExport
    ? MULTI_COLOUR_EXPORT_MAX_CELLS
    : (params?.__labelExportStandoff ? WRAP_EMBOSS_MASK_MAX_CELLS_EXPORT : WRAP_EMBOSS_MASK_MAX_CELLS);
  if (expected > maxCells) {
    const ds = downsampleEmbossMaskToFit(slabMask, slabW, slabH, maxCells);
    slabMask = ds.mask;
    slabW = ds.maskW;
    slabH = ds.maskH;
  }
  let slabBitmap = { ...b, mask: slabMask, width: slabW, height: slabH };
  let onPx = 0;
  for (let i = 0; i < slabMask.length; i++) if (slabMask[i]) onPx++;
  const slabFill = slabMask.length ? onPx / slabMask.length : 0;
  // Outline fast-path on megapixel art floods the crop — embosses a solid slab, not the logo.
  if (b.outlineRaster && slabFill > 0.52 && !b.colorLogo) return null;
  // Only close for heavy block fills — dense heraldic line art (Tigers ~7k runs) erodes into horizontal strips.
  const needsClose = !!b.outlineRaster && (b.colorLogo || wrapLineArtNeedsSolidEmboss(b));
  if (needsClose) slabBitmap = preprocessWrapDenseLineArtMask(slabBitmap, slabW, slabH);
  return buildWrapTraceSlabMesh(frame, slabBitmap, params, [], d0, d1, {
    fineRows: wrapSlabUseFineRows(params),
  });
}

export function buildEmbossBitmap(meta, params, bitmap) {
  params = hoodieGraphicParams(params);
  bitmap = ensureEmbossBitmapMask(bitmap);
  if (!bitmap?.width || !bitmap.height) return null;
  const frame = getEmbossFaceFrame(meta, params.embossFace || "front", params);
  const artH = wrapSafeArtHeight(frame, params.embossTraceSize ?? 16);
  const maxW = Math.min(frame.faceW * 0.62, 56);
  const scale = Math.min(artH / bitmap.height, maxW / bitmap.width);
  if (!Number.isFinite(scale) || scale <= 0) return null;

  const artWidth = bitmap.width * scale;
  const artHeight = bitmap.height * scale;
  const { xOff, zOff } = decorPlacementOffsets(params, frame, artWidth, artHeight);
  const rotCx = xOff + artWidth / 2;
  const rotCy = zOff + artHeight / 2;
  const rotation = params.decorRotation ?? 0;
  const { d0, d1 } = labelOffsets(params);
  const positions = [];
  const indices = [];
  const maskW = Math.round(bitmap.width);
  const maskH = Math.round(bitmap.height);
  if (maskW <= 0 || maskH <= 0) return null;

  const isOutline = bitmap.mode === "outline";
  const denseTrace = (bitmap.shapeGroups?.length ?? 0) > 8;

  // Wrap — always ink-mask row shells (coffee-bag path); never earcut united silhouettes.
  if (frame.face === "wrap") {
    const wrapSlab = buildWrapGoldenSlabEmboss(frame, bitmap, params, maskW, maskH, d0, d1);
    if (wrapSlab?.indices?.length) return wrapSlab;
    return null;
  }

  // Flat faces: any ink/silhouette mask (line art, solid trace, multi-colour AMS layer)
  // → closed voxel-surface solid. The vector earcut route silently drops caps on big
  // pixel contours (Art Black/White exported thousands of open edges — b358/b371 history).
  // Multi-colour traces carry mode "multi-colour"/"black-white" (not "silhouette") — match
  // ANY mask except explicit outline-stroke mode, or B&W AMS layers regress to earcut (b372 bug).
  const flatMaskSolid = bitmap.mask?.length === maskW * maskH && bitmap.mode !== "outline";
  if (flatMaskSolid) {
    const slab = buildWrapTraceSlabMesh(frame, bitmap, params, [], d0, d1, {});
    if (slab?.indices?.length) return slab;
  }

  // Outline stroke extrusion is per-segment — freezes wrap preview on heraldic traces. Prefer merged solids.
  if (isOutline && bitmap.strokePaths?.length && !denseTrace && bitmap.strokePaths.length <= 12) {
    const smoothPasses = artH <= 12 ? 5 : artH <= 20 ? 4 : 3;
    const simplifyTol = Math.max(0.22, maskW / 520);
    const paths = prepareStrokePaths(bitmap.strokePaths, simplifyTol, smoothPasses);
    const strokePx = bitmap.strokeWidth ?? Math.max(1.35, maskW / 88);
    const lineWidth = clamp(scale * strokePx, 0.45, 1.5);
    const mapPt = (px, py) => rotateFacePoint(rotCx, rotCy, xOff + px * scale, zOff + (maskH - py) * scale, rotation);
    extrudeStrokePathList(positions, indices, frame, paths, mapPt, lineWidth, d0, d1);
    if (positions.length) return { positions, indices };
  }

  if (bitmap.shapeGroups?.length || bitmap.mask?.length) {
    const sourceGroups = bitmap.shapeGroups?.length
      ? unionDenseTraceShapeGroups(bitmap.shapeGroups, maskW, maskH, artH, params, bitmap)
      : [];
    if (sourceGroups.length) {
      const faceGroups = remappedBitmapFaceGroups(bitmap, frame, params, sourceGroups, maskW, maskH, artH);
      extrudeGroupsOnFace(positions, indices, frame, faceGroups, d0, d1, params);
      return positions.length ? { positions, indices } : null;
    }
    if (frame.face === "wrap" && shouldUseWrapRunSlabs(bitmap)) {
      const slab = buildWrapTraceSlabMesh(frame, bitmap, params, sourceGroups, d0, d1);
      if (slab?.indices?.length) return slab;
    }
    if (frame.face === "wrap" && bitmap.mask?.length === maskW * maskH) {
      const slab = buildWrapTraceSlabMesh(frame, bitmap, params, [], d0, d1);
      if (slab?.indices?.length) return slab;
    }
  }

  let mask = null;
  if (bitmap.mask?.length === maskW * maskH) {
    mask = bitmap.mask instanceof Uint8Array ? bitmap.mask : new Uint8Array(bitmap.mask);
    mask = prepareComplexTraceMaskForContours(mask, maskW, maskH, bitmap);
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

  const faceGroups = remappedBitmapFaceGroups(bitmap, frame, params, shapeGroups, maskW, maskH, artH);
  extrudeGroupsOnFace(positions, indices, frame, faceGroups, d0, d1, params);

  return positions.length ? { positions, indices } : null;
}

const SVG_NS = "http://www.w3.org/2000/svg";
/** Native SVG path sampling — balanced for speed + curve fidelity on flat faces. */
const SVG_PATH_SAMPLE_SPACING = 0.1;
const SVG_PATH_MAX_POINTS = 1600;
const SVG_PATH_MAX_POINTS_PREVIEW = 880;
const SVG_PATH_DEDUPE_EPS = 0.04;
/** Raster silhouette cap for SVG prep (speed — avoids megapixel unions). */
const SVG_SILHOUETTE_MAX_DIM = 1280;
const SVG_SILHOUETTE_MAX_DIM_PREVIEW = 768;
const WRAP_SVG_MASK_MAX_CELLS_PREVIEW = 640;

function svgIsPreview(params) {
  return !params?.__labelExportStandoff;
}

function svgPathMaxPoints(params) {
  return svgIsPreview(params) ? SVG_PATH_MAX_POINTS_PREVIEW : SVG_PATH_MAX_POINTS;
}

function svgSilhouetteMaxDim(params) {
  return svgIsPreview(params) ? SVG_SILHOUETTE_MAX_DIM_PREVIEW : SVG_SILHOUETTE_MAX_DIM;
}

function svgWrapMaskMaxCells(params, isSvg) {
  if (!isSvg) return 2048;
  return svgIsPreview(params) ? WRAP_SVG_MASK_MAX_CELLS_PREVIEW : WRAP_SVG_MASK_MAX_CELLS;
}

function svgVectorSimplifyTol(sw, sh) {
  return Math.max(0.08, Math.max(sw, sh) / 1100);
}

function svgVectorSmoothPasses(artH) {
  return artH <= 14 ? 1 : 0;
}

function svgUsesVectorExtrude(params) {
  return !!(params?.embossSvgEnabled && !params?.embossTraceEnabled);
}

function svgRingBBox(ring) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of ring) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return { minX, minY, maxX, maxY, area: Math.max(0, maxX - minX) * Math.max(0, maxY - minY) };
}

function svgRingAbsArea(ring) {
  if (!ring || ring.length < 3) return 0;
  let area = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    area += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  }
  return Math.abs(area / 2);
}

/** Drop full-canvas background rects and speck noise from auto-traced SVG exports. */
function filterSvgBackgroundRings(fillRingItems, viewBox) {
  const [, , vw, vh] = viewBox || [0, 0, 100, 100];
  const viewArea = Math.max(1, vw * vh);
  return fillRingItems.filter(({ ring }) => {
    if (!ring || ring.length < 4) return false;
    const bbox = svgRingBBox(ring);
    if (bbox.area > viewArea * 0.9) return false;
    if (bbox.area < viewArea * 0.00004) return false;
    const ink = svgRingAbsArea(ring);
    if (ink < viewArea * 0.00002) return false;
    return true;
  });
}

/** Dual-layer traced SVGs — union all non-background ink (overlaps collapse to silhouette). */
function pickPrimarySvgFillRings(fillRingItems, viewBox) {
  const filtered = filterSvgBackgroundRings(fillRingItems, viewBox);
  if (!filtered.length) return [];
  return filtered.map((item) => item.ring);
}

function svgSampleIsFillRing(sampled, subD, viewBox) {
  if (!sampled || sampled.length < 3) return false;
  const xs = sampled.map((p) => p[0]);
  const ys = sampled.map((p) => p[1]);
  const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), 1);
  const eps = Math.max(0.25, span * 0.004);
  const [x0, y0] = sampled[0];
  const [x1, y1] = sampled[sampled.length - 1];
  if (Math.hypot(x0 - x1, y0 - y1) < eps) return true;
  return /[zZ]\s*$/.test(String(subD || "").trim());
}

function svgInkIslandGroups(rings) {
  return rings.map((ring) => ({ outer: ring, holes: [] }));
}

function svgPrepareFillShapeGroups(fillRingItems, viewBox, sw, sh, artH, params) {
  const rings = pickPrimarySvgFillRings(fillRingItems, viewBox);
  if (!rings.length) return [];

  const maskW = Math.max(8, Math.round(sw));
  const maskH = Math.max(8, Math.round(sh));
  const simplifyTol = svgVectorSimplifyTol(sw, sh);
  const smoothPasses = svgVectorSmoothPasses(artH);
  const maxDim = svgSilhouetteMaxDim(params);
  const rasterScale = Math.min(1, maxDim / Math.max(maskW, maskH));
  const w = Math.max(8, Math.round(maskW * rasterScale));
  const h = Math.max(8, Math.round(maskH * rasterScale));
  const inv = 1 / rasterScale;
  const dilate = rings.length > 6 ? 3 : 2;

  const scaledIslands = rings.map((ring) => ({
    outer: ring.map(([x, y]) => [x * rasterScale, y * rasterScale]),
    holes: [],
  }));

  let mask = rasterizeShapeGroupsToMask(scaledIslands, w, h);
  mask = dilateMask(mask, w, h, dilate);
  mask = closeBitmapMask(mask, w, h, 1);

  const polys = maskToPolygons(mask, w, h);
  if (polys.length) {
    const grouped = groupPolygonsWithHoles(
      polys.map((poly) => poly.map(([x, y]) => [x * inv, y * inv])),
    );
    let best = null;
    for (const group of grouped) {
      const area = svgRingAbsArea(group.outer);
      if (!best || area > best.area) best = { outer: group.outer, area };
    }
    if (best?.outer?.length >= 4) {
      const solid = prepareSvgShapeGroups([{ outer: best.outer, holes: [] }], simplifyTol, smoothPasses);
      if (solid.length) return solid;
    }
  }

  const islandGroups = svgInkIslandGroups(rings);
  let groups = unionShapeGroupsToPrepared(
    islandGroups,
    maskW,
    maskH,
    simplifyTol,
    smoothPasses,
    dilate,
    maxDim,
  );
  groups = filterDegenerateShapeGroups(groups, maskW, maskH);
  return groups.length ? groups.map((g) => ({ outer: g.outer, holes: [] })) : islandGroups;
}

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

function ctmPreservesSvgUserSpace(ctm) {
  if (!ctm) return false;
  const scale = Math.hypot(ctm.a, ctm.b);
  return scale >= 0.25;
}

function transformSvgPoint(ctm, x, y) {
  if (!ctm) return [x, y];
  return [
    ctm.a * x + ctm.c * y + ctm.e,
    ctm.b * x + ctm.d * y + ctm.f,
  ];
}

function sampleSvgPathElementRaw(pathEl, maxPoints = SVG_PATH_MAX_POINTS) {
  const len = pathEl.getTotalLength();
  if (!Number.isFinite(len) || len < 0.02) return [];
  const count = Math.min(maxPoints, Math.max(32, Math.ceil(len / SVG_PATH_SAMPLE_SPACING)));
  const pts = [];
  for (let i = 0; i <= count; i++) {
    const pt = pathEl.getPointAtLength(Math.min((i / count) * len, len));
    pts.push([pt.x, pt.y]);
  }
  return dedupePolylinePoints(pts, SVG_PATH_DEDUPE_EPS);
}

function sampleSvgPathElementWithCtm(pathEl, maxPoints = SVG_PATH_MAX_POINTS) {
  const ctm = pathEl.getCTM?.() || null;
  const useCtm = ctmPreservesSvgUserSpace(ctm);
  const len = pathEl.getTotalLength();
  if (!Number.isFinite(len) || len < 0.02) return [];
  const count = Math.min(maxPoints, Math.max(32, Math.ceil(len / SVG_PATH_SAMPLE_SPACING)));
  const pts = [];
  for (let i = 0; i <= count; i++) {
    const pt = pathEl.getPointAtLength(Math.min((i / count) * len, len));
    pts.push(useCtm ? transformSvgPoint(ctm, pt.x, pt.y) : [pt.x, pt.y]);
  }
  return dedupePolylinePoints(pts, SVG_PATH_DEDUPE_EPS);
}

function polylineFromElementWithCtm(el) {
  const raw = polylineFromElement(el);
  const ctm = el.getCTM?.() || null;
  if (!ctmPreservesSvgUserSpace(ctm)) return raw;
  return raw.map(([x, y]) => transformSvgPoint(ctm, x, y));
}

function svgEffectivePresentation(el, attr, root) {
  let node = el;
  while (node && node.nodeType === 1) {
    const val = node.getAttribute?.(attr);
    if (val != null && String(val).trim() !== "") return String(val).trim();
    if (node === root) break;
    node = node.parentNode;
  }
  return null;
}

/** Resolve fill/stroke intent — honours inherited SVG presentation attributes. */
function svgElementPaintMode(el, root) {
  const fill = svgEffectivePresentation(el, "fill", root);
  const stroke = svgEffectivePresentation(el, "stroke", root);
  const hasFill = fill != null ? fill !== "none" : true;
  const hasStroke = stroke != null && stroke !== "none";
  if (hasFill && hasStroke) return "both";
  if (hasFill) return "fill";
  if (hasStroke) return "stroke";
  return "none";
}

function closeSvgRing(points) {
  if (points.length < 3) return points;
  const [x0, y0] = points[0];
  const [x1, y1] = points[points.length - 1];
  if (Math.hypot(x0 - x1, y0 - y1) < 0.05) return points;
  return [...points, [x0, y0]];
}

function routeSvgSample(points, mode, strokePaths, fillRingItems, fillColor = "#000", viewBox = null) {
  if (!points || points.length < 2) return;
  const closed = pathIsExplicitlyClosed(points)
    || (viewBox && svgSampleIsFillRing(points, "", viewBox));
  if (mode === "fill") {
    if (closed && points.length >= 3) fillRingItems.push({ ring: closeSvgRing(points), fill: fillColor });
    else strokePaths.push(points);
    return;
  }
  if (mode === "stroke") {
    strokePaths.push(points);
    return;
  }
  if (mode === "both") {
    if (closed && points.length >= 3) fillRingItems.push({ ring: closeSvgRing(points), fill: fillColor });
    else strokePaths.push(points);
  }
}

function sampleSvgPathElement(pathEl, maxPoints = SVG_PATH_MAX_POINTS) {
  return sampleSvgPathElementRaw(pathEl, maxPoints);
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

/** Sample SVG geometry — transform-aware, split into stroke paths and filled rings. */
export function parseSvgPaths(svgText, opts = {}) {
  const pathMaxPoints = opts.maxPoints ?? SVG_PATH_MAX_POINTS;
  if (typeof DOMParser === "undefined" || typeof document === "undefined") {
    return { polylines: [], strokePaths: [], fillRings: [], viewBox: [0, 0, 100, 100], strokeWidth: 1.5 };
  }
  const doc = new DOMParser().parseFromString(svgText, "image/svg+xml");
  const svg = doc.documentElement;
  if (!svg || svg.nodeName.toLowerCase() === "parsererror") {
    return { polylines: [], strokePaths: [], fillRings: [], viewBox: [0, 0, 100, 100], strokeWidth: 1.5 };
  }

  const viewBox = parseSvgViewBox(svg);
  const scratch = document.createElementNS(SVG_NS, "svg");
  scratch.setAttribute("xmlns", SVG_NS);
  scratch.setAttribute(
    "viewBox",
    svg.getAttribute("viewBox") || `${viewBox[0]} ${viewBox[1]} ${viewBox[2]} ${viewBox[3]}`,
  );
  scratch.setAttribute("width", String(viewBox[2]));
  scratch.setAttribute("height", String(viewBox[3]));
  scratch.style.cssText = `position:absolute;left:-9999px;top:0;visibility:hidden;overflow:hidden;width:${viewBox[2]}px;height:${viewBox[3]}px`;
  for (const child of [...svg.childNodes]) {
    if (child.nodeType !== 1) continue;
    if (child.tagName?.toLowerCase() === "defs") continue;
    scratch.appendChild(document.importNode(child, true));
  }
  document.body.appendChild(scratch);

  const strokePaths = [];
  const fillRingItems = [];
  let strokeWidth = readSvgStrokeWidth(null, svg);

  try {
    for (const pathEl of scratch.querySelectorAll("path")) {
      if (pathEl.closest("defs")) continue;
      const mode = svgElementPaintMode(pathEl, svg);
      if (mode === "none") continue;
      strokeWidth = Math.max(strokeWidth, readSvgStrokeWidth(pathEl, svg));
      const fillColor = svgEffectivePresentation(pathEl, "fill", svg) || "#000000";
      const d = pathEl.getAttribute("d");
      if (!d) continue;
      const parent = pathEl.parentNode || scratch;
      const subRings = [];
      for (const sub of splitPathSubpaths(d)) {
        const temp = document.createElementNS(SVG_NS, "path");
        temp.setAttribute("d", sub);
        parent.insertBefore(temp, pathEl);
        const sampled = sampleSvgPathElementRaw(temp, pathMaxPoints);
        temp.remove();
        if (!sampled || sampled.length < 2) continue;
        if ((mode === "fill" || mode === "both") && svgSampleIsFillRing(sampled, sub, viewBox)) {
          subRings.push(closeSvgRing(sampled));
        } else {
          routeSvgSample(sampled, mode, strokePaths, fillRingItems, fillColor, viewBox);
        }
      }
      if (subRings.length === 1) {
        fillRingItems.push({ ring: subRings[0], fill: fillColor });
      } else if (subRings.length > 1) {
        for (const ring of subRings) fillRingItems.push({ ring, fill: fillColor });
      }
    }
    for (const el of scratch.querySelectorAll("polyline, polygon, line, rect, circle, ellipse")) {
      if (el.closest("defs")) continue;
      const mode = svgElementPaintMode(el, svg);
      if (mode === "none") continue;
      strokeWidth = Math.max(strokeWidth, readSvgStrokeWidth(el, svg));
      const fillColor = svgEffectivePresentation(el, "fill", svg) || "#000000";
      const sampled = polylineFromElement(el);
      routeSvgSample(sampled, mode, strokePaths, fillRingItems, fillColor, viewBox);
    }
  } finally {
    scratch.remove();
  }

  const fillRings = fillRingItems.map((item) => item.ring);
  const polylines = [...strokePaths, ...fillRings];
  return { polylines, strokePaths, fillRings, fillRingItems, viewBox, strokeWidth };
}

export function parsedSvgHasFill(svgText) {
  const parsed = parseSvgPaths(svgText);
  return (parsed.fillRings?.length || 0) > 0;
}

/** Strip full-canvas background rects from auto-traced SVG exports (e.g. broncs.svg). */
export function prepareSvgForImport(svgText) {
  if (!svgText?.trim() || typeof DOMParser === "undefined") return svgText;
  const doc = new DOMParser().parseFromString(svgText, "image/svg+xml");
  const svg = doc.documentElement;
  if (!svg || svg.nodeName.toLowerCase() === "parsererror") return svgText;
  const viewBox = parseSvgViewBox(svg);
  const viewArea = Math.max(1, viewBox[2] * viewBox[3]);

  for (const pathEl of svg.querySelectorAll("path")) {
    const d = pathEl.getAttribute("d");
    if (!d) continue;
    const kept = [];
    for (const sub of splitPathSubpaths(d)) {
      const nums = sub.match(/-?\d*\.?\d+/g)?.map(Number) || [];
      if (nums.length < 8) {
        kept.push(sub);
        continue;
      }
      const xs = [];
      const ys = [];
      for (let i = 0; i + 1 < nums.length; i += 2) {
        xs.push(nums[i]);
        ys.push(nums[i + 1]);
      }
      if (!xs.length) {
        kept.push(sub);
        continue;
      }
      const bbox = {
        minX: Math.min(...xs),
        maxX: Math.max(...xs),
        minY: Math.min(...ys),
        maxY: Math.max(...ys),
      };
      const area = (bbox.maxX - bbox.minX) * (bbox.maxY - bbox.minY);
      if (area > viewArea * 0.88) continue;
      kept.push(sub);
    }
    if (!kept.length) {
      pathEl.remove();
    } else if (kept.length === 1 && kept[0] !== d.trim()) {
      pathEl.setAttribute("d", kept[0]);
    } else if (kept.length > 1) {
      pathEl.setAttribute("d", kept.join(" "));
    }
  }

  return new XMLSerializer().serializeToString(svg);
}

/** Auto-traced team logos (dual ink layers) — vector parse freezes; use raster silhouette. */
export function svgPrefersRasterSilhouette(svgText) {
  if (!svgText?.trim()) return false;
  const fills = new Set();
  for (const m of svgText.matchAll(/fill\s*=\s*["']([^"']+)["']/gi)) {
    const c = m[1].trim().toLowerCase();
    if (c && c !== "none") fills.add(c);
  }
  const paths = (svgText.match(/<path\b/gi) || []).length;
  return fills.size >= 2 || paths >= 6 || svgText.length > 48000;
}

/** True when vector SVG parsing yields emboss geometry for the current shape/face. */
export function svgEmbossProducesMesh(meta, params, svgText) {
  if (!meta || !svgText?.trim()) return false;
  const parsed = parseSvgPaths(svgText);
  const fillItems = parsed.fillRingItems || [];
  if (fillItems.length) {
    return pickPrimarySvgFillRings(fillItems, parsed.viewBox).length > 0;
  }
  return (parsed.strokePaths?.length || 0) > 0;
}

function pathIsExplicitlyClosed(path) {
  if (!path || path.length < 3) return false;
  const dx = path[0][0] - path[path.length - 1][0];
  const dy = path[0][1] - path[path.length - 1][1];
  const xs = path.map((p) => p[0]);
  const ys = path.map((p) => p[1]);
  const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), 1);
  return Math.hypot(dx, dy) < Math.max(0.25, span * 0.004);
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

function computeSvgArtLayout(parsed, meta, params) {
  const strokePaths = parsed.strokePaths || [];
  const fillItems = parsed.fillRingItems || (parsed.fillRings || []).map((ring) => ({ ring, fill: "#000000" }));
  const inkRings = pickPrimarySvgFillRings(fillItems, parsed.viewBox);
  const polylines = inkRings.length
    ? [...strokePaths, ...inkRings]
    : (parsed.polylines || [...strokePaths, ...(parsed.fillRings || [])]);
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
  const artH = wrapSafeArtHeight(frame, params.embossTraceSize ?? params.embossHeight ?? 16);
  const wrap = frame.face === "wrap";
  const maxW = wrap ? Math.min(frame.faceW * 0.55, 72) : Math.min(frame.faceW * 0.62, 56);
  const scale = Math.min(artH / sh, maxW / sw);
  if (!Number.isFinite(scale) || scale <= 0) return null;

  const cx = (minX + maxX) / 2;
  const artW = sw * scale;
  const artHeight = sh * scale;
  const { xOff, zOff } = decorPlacementOffsets(params, frame, artW, artHeight);
  const rotCx = xOff + artW / 2;
  const rotCy = zOff + artHeight / 2;
  return {
    frame,
    scale,
    cx,
    minX,
    minY,
    maxX,
    maxY,
    sw,
    sh,
    artW,
    artH: artHeight,
    xOff,
    zOff,
    rotCx,
    rotCy,
    rotation: params.decorRotation ?? 0,
  };
}

function mapSvgArtPoint(layout, x, y) {
  const { rotCx, rotCy, cx, maxY, scale, xOff, artW, zOff, rotation } = layout;
  return rotateFacePoint(
    rotCx,
    rotCy,
    (x - cx) * scale + xOff + artW / 2,
    zOff + (maxY - y) * scale,
    rotation,
  );
}

function extrudeSvgFillRings(outPos, outIdx, fillRingItems, layout, params, viewBox) {
  if (!fillRingItems?.length) return;
  const { frame, rotCx, sw, sh, artH } = layout;
  const { d0, d1 } = labelOffsets(params);
  const shapeGroups = svgPrepareFillShapeGroups(fillRingItems, viewBox, sw, sh, artH, params);
  if (!shapeGroups.length) return;
  let faceGroups = shapeGroups.map((group) => ({
    outer: group.outer.map(([x, y]) => mapSvgArtPoint(layout, x, y)),
    holes: group.holes.map((h) => h.map(([x, y]) => mapSvgArtPoint(layout, x, y))),
  }));
  if (frame.face === "wrap") {
    faceGroups = normalizeWrapShapeGroups(faceGroups, frame.faceW, rotCx);
  }
  if (faceGroups.length) {
    extrudeGroupsOnFace(outPos, outIdx, frame, faceGroups, d0, d1, params);
  }
}

export function buildEmbossSvg(meta, params, svgText) {
  params = hoodieGraphicParams(params);
  const parsed = parseSvgPaths(svgText, { maxPoints: svgPathMaxPoints(params) });
  const layout = computeSvgArtLayout(parsed, meta, params);
  if (!layout) return null;

  const strokePaths = parsed.strokePaths || [];
  const fillRingItems = parsed.fillRingItems || (parsed.fillRings || []).map((ring) => ({ ring, fill: "#000000" }));
  const { frame, sw, sh, artH, scale } = layout;
  const { d0, d1 } = labelOffsets(params);
  const positions = [];
  const indices = [];

  extrudeSvgFillRings(positions, indices, fillRingItems, layout, params, parsed.viewBox);

  if (!positions.length && strokePaths.length) {
    const svgStroke = parsed.strokeWidth ?? 1.5;
    const lineWidth = clamp(scale * svgStroke, 0.45, 1.5);
    const smoothPasses = svgVectorSmoothPasses(artH);
    const simplifyTol = Math.max(0.06, Math.max(sw, sh) / 1800);
    const closedPaths = strokePaths.map((line) => {
      if (line.length >= 3) {
        const [x0, y0] = line[0];
        const [x1, y1] = line[line.length - 1];
        if (Math.hypot(x0 - x1, y0 - y1) < Math.max(0.35, Math.max(sw, sh) * 0.004)) {
          return [...line, line[0]];
        }
      }
      return line;
    });
    const prepared = prepareStrokePaths(closedPaths, simplifyTol, smoothPasses);
    const mapPt = (x, y) => mapSvgArtPoint(layout, x, y);
    extrudeStrokePathList(positions, indices, frame, prepared, mapPt, lineWidth, d0, d1);
  }

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
  return shape === "rect" || shape === "rounded" || shape === "pencil" || shape === "pencilBox" || shape === "canisterSquare" || shape === "canisterSquareSet" || shape === "animal" || shape === "sign" || shape === "stubbyHolder";
}

/** Parametric wall relief on curved profile containers (pots, tubes). */
export function shapeSupportsProfileTexture(shape) {
  return (
    shape === "teardrop"
    || shape === "heart"
    || shape === "star"
    || shape === "circle"
    || shape === "oval"
    || shape === "rect"
    || shape === "rounded"
    || shape === "pencil"
    || shape === "pencilBox"
    || shape === "canisterSquare"
    || shape === "canisterSquareSet"
    || shape === "canisterJar"
    || shape === "canisterStack"
  );
}

/** SVG / trace / text art on profile wall wrap. */
export function shapeSupportsProfileArt(shape) {
  return (
    shape === "teardrop"
    || shape === "heart"
    || shape === "star"
    || shape === "circle"
    || shape === "oval"
    || shape === "canisterJar"
    || shape === "canisterStack"
  );
}

export function shapeSupportsArt(shape) {
  return shapeSupportsDecor(shape) || shapeSupportsProfileArt(shape);
}

/** Accent bands wrap the outer wall profile — all container shapes except open specials. */
export function shapeSupportsAccent(shape) {
  return (
    shape === "vase"
    || shape === "rect"
    || shape === "rounded"
    || shape === "pencil"
    || shape === "pencilBox"
    || shape === "canisterSquare"
    || shape === "canisterSquareSet"
    || shape === "canisterJar"
    || shape === "circle"
    || shape === "oval"
    || shape === "hex"
    || shape === "polygon"
    || shape === "teardrop"
    || shape === "star"
    || shape === "heart"
  );
}

/** Front-panel-only accent band — flat box faces only. */
export function shapeSupportsAccentFrontFace(shape) {
  return shape === "rect" || shape === "rounded" || shape === "pencil" || shape === "pencilBox" || shape === "canisterSquare" || shape === "canisterSquareSet" || shape === "animal" || shape === "sign";
}

/** Face frame for placing emboss on any of the four side walls.
 * Returns an object with faceW / faceH (usable dimensions in mm) and a
 * mapPoint(px, py, offset) helper that projects a 2D art-space point (px, py)
 * onto the target face at a distance `offset` from the outer surface
 * (positive = outward, negative = inward for deboss).
 */
export function getEmbossFaceFrame(meta, face, params = null) {
  const useFace = ["front", "back", "left", "right", "top", "lid", "bottom", "wrap"].includes(face) ? face : "front";
  if (useFace === "wrap" && meta.outerProfile?.length >= 3) {
    return getProfileWrapFaceFrame(meta.outerProfile, meta, params);
  }

  const b = rectFeatureBounds(meta);

  if (useFace === "bottom") {
    return {
      face: "bottom",
      faceW: b.outerW,
      faceH: b.outerD,
      centerZ: 0,
      horizontal: true,
      // Exterior bottom at z=0; inward deboss = +Z (offset negative).
      mapPoint: (px, py, offset) => [px, py, -offset],
    };
  }

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
    const yDir = useFace === "front" ? -1 : 1;
    // For "front" (world -Y) text is not mirrored — reads normally.
    // For "back" (world +Y) mirror X so text reads correctly when viewed from +Y.
    const mirror = useFace === "back";
    const chest = meta.shape === "stubbyHolder";
    const chestY = Number(meta.chestY);
    const backY = Number(meta.backY);
    const yOut = chest
      ? (useFace === "front"
        ? (Number.isFinite(chestY) ? chestY : -b.od2)
        : (Number.isFinite(backY) ? backY : b.od2))
      : (useFace === "front" ? -b.od2 : b.od2);
    const centerZ = chest
      ? (useFace === "back" ? b.totalH * 0.62 : b.totalH * 0.50)
      : b.totalH * 0.72;
    return {
      face: useFace,
      faceW: chest ? Math.min(b.outerW, 90) : b.outerW,
      faceH: b.totalH,
      centerZ,
      mapPoint: (px, py, offset) => {
        const x = mirror ? -px : px;
        let yBase = yOut;
        if (chest && useFace === "front" && meta.chestField) {
          const sampled = sampleHoodieChestY(meta.chestField, x, py);
          if (Number.isFinite(sampled)) yBase = sampled;
        } else if (chest && useFace === "back" && meta.backField) {
          const sampled = sampleHoodieBackY(meta.backField, x, py);
          if (Number.isFinite(sampled)) yBase = sampled;
        }
        const y = yBase + yDir * offset;
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

/** Extrude remapped art groups — wrap uses direct extrude for simple solids, slabs for complex art. */
function extrudeGroupsOnFace(outPos, outIdx, frame, faceGroups, d0, d1, params = null) {
  if (frame.face === "wrap" && faceGroups.length) {
    const simpleSolid = faceGroups.length === 1 && !(faceGroups[0].holes?.length);
    if (simpleSolid) {
      extrudeGroupOnFace(outPos, outIdx, frame, faceGroups[0], d0, d1, params);
      return;
    }
    const isSvg = svgUsesVectorExtrude(params);
    const stepMm = params?.__labelExportStandoff
      ? DECAL_LAYER_MM
      : isSvg
        ? wrapSvgDecalStepMm(faceGroups)
        : wrapDecalStepMm(faceGroups);
    const preview = svgIsPreview(params);
    const slab = buildWrapArtSlabMesh(frame, faceGroups, d0, d1, {
      params,
      stepMm,
      targetCols: isSvg ? (preview ? WRAP_SVG_DECAL_TARGET_COLS_PREVIEW : WRAP_SVG_DECAL_TARGET_COLS) : WRAP_DECAL_TARGET_COLS,
      stepMin: isSvg ? WRAP_SVG_DECAL_STEP_MIN_MM : WRAP_DECAL_STEP_MIN_MM,
      stepMax: isSvg ? (preview ? WRAP_SVG_DECAL_STEP_MAX_MM_PREVIEW : WRAP_SVG_DECAL_STEP_MAX_MM) : WRAP_DECAL_STEP_MAX_MM,
      maxCells: svgWrapMaskMaxCells(params, isSvg),
      previewMaxRows: preview ? WRAP_TRACE_PREVIEW_MAX_ROWS : 2048,
      maxPreviewIndices: preview ? WRAP_SVG_PREVIEW_MAX_INDICES : 0,
      dilatePasses: 1,
      solid: true,
    });
    if (slab?.indices?.length) {
      const base = outPos.length / 3;
      for (let i = 0; i < slab.positions.length; i++) outPos.push(slab.positions[i]);
      for (let i = 0; i < slab.indices.length; i++) outIdx.push(slab.indices[i] + base);
      return;
    }
    return;
  }
  for (const group of faceGroups) {
    extrudeGroupOnFace(outPos, outIdx, frame, group, d0, d1, params);
  }
}

function remappedBitmapFaceGroups(bitmap, frame, params, sourceGroups, maskW, maskH, artH) {
  const maxW = Math.min(frame.faceW * 0.62, 56);
  const safeArtH = wrapSafeArtHeight(frame, artH);
  const scale = Math.min(safeArtH / bitmap.height, maxW / bitmap.width);
  const artWidth = bitmap.width * scale;
  const artHeight = bitmap.height * scale;
  const { xOff, zOff } = decorPlacementOffsets(params, frame, artWidth, artHeight);
  const rotCx = xOff + artWidth / 2;
  const rotCy = zOff + artHeight / 2;
  const rotation = params.decorRotation ?? 0;
  const faceGroups = [];
  for (const group of sourceGroups) {
    const remapped = {
      outer: group.outer.map(([px, py]) => [xOff + px * scale, zOff + (maskH - py) * scale]),
      holes: group.holes.map((h) => h.map(([px, py]) => [xOff + px * scale, zOff + (maskH - py) * scale])),
    };
    faceGroups.push(rotateShapeGroup(remapped, rotCx, rotCy, rotation));
  }
  if (frame.face === "wrap") return normalizeWrapShapeGroups(faceGroups, frame.faceW, rotCx);
  return faceGroups;
}

function ringPointsLocal(ring) {
  return ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]
    ? ring.slice(0, -1)
    : ring.slice();
}

/** Extrude a shape group (outer ring + holes) onto a face at offsets [d0, d1]. */
function extrudeGroupOnFace(outPos, outIdx, frame, group, d0, d1, params = null) {
  const mapTop = (px, py) => frame.mapPoint(px, py, d1);
  const mapBot = (px, py) => frame.mapPoint(px, py, d0);
  const flatCoord = (w) => flatCoordForFrame(frame, w);
  const capMode = params ? embossExportCaps(params, d0) : (d0 < 0 ? "both" : "top");
  const { caps, flatFromArt } = wrapExtrudeCaps(frame, capMode);
  extrudeShapeGroupBetween(outPos, outIdx, group, mapTop, mapBot, flatCoord, caps, flatFromArt);
}

function exportEmbossDepth(params) {
  let depth = clamp(params.embossDepth ?? 0.7, 0.3, 4);
  if (!params?.__labelExportStandoff) return depth;
  // Slicer-facing AMS label solids need enough real cap height to print cleanly.
  const minMm = params.__labelExportKind === "text" ? 0.8 : 0.8;
  const maxMm = params.__labelExportKind === "text" ? 1.6 : 2.0;
  depth = clamp(depth, minMm, maxMm);
  return Math.max(minMm, Math.round(depth / 0.2) * 0.2);
}

function embossExportCaps(params, d0) {
  if (params?.__labelExportStandoff) {
    const depth = exportEmbossDepth(params);
    // Separate AMS colour solids need closed shells — top-only caps leave open edges (slicer static).
    if (params.__multiColourAmsExport) return "both";
    if (params.__labelExportEmbedded && depth <= 0.48) return "top";
    return "both";
  }
  return d0 < 0 ? "both" : "top";
}

function labelOffsets(params) {
  const depth = exportEmbossDepth(params);
  if (params.__embossMode === "deboss-inlay") {
    // Printable colour body: fill the pocket from its floor to the original outside surface.
    return { d0: -depth, d1: 0, depth, deboss: true };
  }
  if (params.__embossMode === "deboss-cutter") {
    // Boolean cutter reaches slightly beyond both ends for a clean subtraction.
    return { d0: -depth - 0.05, d1: 0.4, depth, deboss: true };
  }
  if (params.__hoodieArtExport) {
    // Sit on the fabric like preview — do not sink into the hoodie. Embedding
    // plus CSG cut a jagged panther pocket into Body and printed rough.
    const proud = 0.84;
    const skin = HOODIE_ART_PROUD_MM;
    return { d0: skin, d1: skin + proud, depth: proud, deboss: false };
  }
  if (params.shape === "stubbyHolder") {
    const proud = 0.5;
    const skin = HOODIE_ART_PROUD_MM;
    return { d0: skin, d1: skin + proud, depth: proud, deboss: false };
  }
  // Raised emboss: flush in preview; export embeds into wall pockets (no air gap).
  let standoff = 0;
  if (!params.__labelExportEmbedded) {
    standoff = params.__labelExportStandoff ? 0.2 : 0;
    if ((params.embossFace || "front") === "wrap" && !params.__labelExportStandoff) {
      standoff = 0.22;
    }
    if (params.__labelExportStandoff && params.vaseTextureEnabled) {
      const texDepth = clamp(params.vaseTextureDepth ?? 1.2, 0.2, 3);
      standoff = Math.max(standoff, 0.35 + texDepth * 0.15);
    }
  } else if (params.__multiColourAmsExport) {
    // Slight embed INTO the wall — the parts are watertight since b374, so intersecting
    // the body is safe (no coplanar z-fight) and it kills Bambu's "floating regions"
    // warning + first-layer adhesion gaps that shredded thin art. (Was +0.1 proud.)
    standoff = -0.06;
  }
  // Preview floor — very shallow emboss z-fights the wall and reads as white seams.
  const useDepth = params.__labelExportStandoff ? depth : Math.max(depth, 0.35);
  return { d0: standoff, d1: standoff + useDepth, depth: useDepth, deboss: false };
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
  const hasText = textHasInk(params.embossText);
  const hasSvg = params.embossSvgEnabled && !!params.embossSvgText?.trim();

  let textRect = null;
  if (hasText) {
    const layout = computeTextArtLayout(meta, params);
    if (layout) {
      textRect = {
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
  }

  let svgRect = null;
  if (hasSvg) {
    const parsed = parseSvgPaths(params.embossSvgText);
    const strokePaths = parsed.strokePaths || [];
    const fillRings = parsed.fillRings || [];
    const polylines = parsed.polylines || [...strokePaths, ...fillRings];
    if (polylines.length) {
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
      if (Number.isFinite(minX)) {
        const sw = maxX - minX || parsed.viewBox?.[2] || 1;
        const sh = maxY - minY || parsed.viewBox?.[3] || 1;
        const artH = wrapSafeArtHeight(frame, params.embossTraceSize ?? params.embossHeight ?? 16);
        const wrap = frame.face === "wrap";
        const maxW = wrap ? Math.min(frame.faceW * 0.55, 72) : Math.min(frame.faceW * 0.62, 56);
        const scale = Math.min(artH / sh, maxW / sw);
        if (Number.isFinite(scale) && scale > 0) {
          const artW = sw * scale;
          const artHeight = sh * scale;
          const { xOff, zOff } = decorPlacementOffsets(params, frame, artW, artHeight);
          svgRect = {
            frame,
            kind: "svg",
            rotation: params.decorRotation ?? 0,
            ...decorArtRect(frame, xOff, zOff, artW, artHeight),
          };
        }
      }
    }
  }

  if (textRect && svgRect) {
    return {
      frame,
      kind: "combo",
      rotation: textRect.rotation,
      left: Math.min(textRect.left, svgRect.left),
      right: Math.max(textRect.right, svgRect.right),
      bottom: Math.min(textRect.bottom, svgRect.bottom),
      top: Math.max(textRect.top, svgRect.top),
      cx: (textRect.cx + svgRect.cx) / 2,
      cy: (textRect.cy + svgRect.cy) / 2,
      artW: Math.max(textRect.right, svgRect.right) - Math.min(textRect.left, svgRect.left),
      artH: Math.max(textRect.top, svgRect.top) - Math.min(textRect.bottom, svgRect.bottom),
    };
  }
  if (textRect) return textRect;
  if (svgRect) return svgRect;

  if (hasTrace && traceData?.width && traceData?.height) {
    const artH = wrapSafeArtHeight(frame, params.embossTraceSize ?? 16);
    const maxW = Math.min(frame.faceW * 0.62, 56);
    const scale = Math.min(artH / traceData.height, maxW / traceData.width);
    if (!Number.isFinite(scale) || scale <= 0) return null;
    const artW = traceData.width * scale;
    const artHeight = traceData.height * scale;
    const { xOff, zOff } = decorPlacementOffsets(params, frame, artW, artHeight);
    return { frame, kind: "trace", rotation: params.decorRotation ?? 0, ...decorArtRect(frame, xOff, zOff, artW, artHeight) };
  }

  return null;
}

function labelEmbossParts(meta, params, svgText = "", mode = "emboss") {
  const p = { ...params, __embossMode: mode };
  const traceData = p.embossTraceRects;
  const hasTrace =
    p.embossTraceEnabled &&
    ((traceData?.multiColour && traceData.colorLayers?.length)
      || traceData?.shapeGroups?.length
      || traceData?.strokePaths?.length
      || traceData?.mask?.length
      || traceData?.rects?.length
      || traceData?.silhouetteMask?.length);
  const hasText = textHasInk(p.embossText);
  const hasSvg = p.embossSvgEnabled && !!svgText?.trim() && !hasTrace;

  let text = null;
  let graphic = null;
  let graphicColourParts = null;
  if (hasText) text = buildEmbossText(meta, p);
  if (hasSvg) graphic = buildEmbossSvg(meta, p, svgText);
  if (hasTrace && traceData?.multiColour && traceData.colorLayers?.length) {
    graphicColourParts = buildMultiColourGraphicEmboss(meta, p, traceData);
    if (graphicColourParts?.length) {
      graphic = mergeMeshes(...graphicColourParts.map((cp) => cp.mesh));
    }
  } else if (hasTrace) {
    graphic = buildEmbossBitmap(meta, p, traceData);
  }
  return { text, graphic, graphicColourParts };
}

/** Text and graphic meshes separately (for preview colours and export). */
export function buildLabelEmbossParts(meta, params, svgText = "", mode = "emboss") {
  return labelEmbossParts(meta, params, svgText, mode);
}

/** Graphic-only label (SVG/trace) — for body export when text is a separate colour. */
export function buildLabelGraphicEmboss(meta, params, svgText = "", mode = "emboss") {
  const p = hoodieGraphicParams({ ...params, embossText: "", __embossMode: mode });
  if (isLabelExport(p)) return buildGraphicLabelExportMesh(meta, p, svgText);
  return labelEmbossParts(meta, p, svgText, mode).graphic;
}

export function buildLabelEmboss(meta, params, svgText = "", mode = "emboss") {
  const { text, graphic } = labelEmbossParts(meta, params, svgText, mode);
  const parts = [text, graphic].filter(Boolean);
  return parts.length ? mergeMeshes(...parts) : null;
}

export function applyBodyDecorations(bodyMesh, meta, params) {
  const parts = [bodyMesh];
  if (params.honeycombEnabled) {
    const honey = buildHoneycombStamp(meta, params);
    if (honey) parts.push(honey);
  }
  if (params.stackableEnabled && (params.stackStyle || "hex") !== "nest") {
    const stack = buildStackableHex(meta, params);
    if (stack) parts.push(stack);
  }
  return mergeMeshes(...parts);
}
