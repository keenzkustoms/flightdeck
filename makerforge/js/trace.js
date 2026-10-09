/**

 * Bitmap → mask polygons for smooth emboss + preview rects.

 */



import {
  groupPolygonsWithHoles,
  maskToPolygons,
  polygonsToSvg,
  prepareContourRing,
  prepareShapeGroups,
  prepareStrokePaths,
  strokePathIsClosed,
  shapeGroupsToStrokePaths,
  strokePathsToSvg,
  previewMergeTraceShapeGroups,
  cleanTraceSilhouetteGroups,
  unionShapeGroupsToPrepared,
  rasterizeShapeGroupsToMask,
  filterDegenerateShapeGroups,
} from "./contour.js?v=241";

export { unionDenseEmbossShapeGroups } from "./contour.js?v=241";



const MAX_TRACE_PX = 2400;
/** Multi-colour logos need extra mask resolution — row shells show pixel stairs otherwise. */
const MULTI_COLOUR_MIN_MAX_PX = 1400;
/** Cap multi-colour mask work — full 2400px + morph ops freezes the tab. */
const MULTI_COLOUR_WORK_MAX_PX = 1600;
const SVG_RASTER_PX = 4096;
const MAX_COLOR_LAYERS = 10;
/** Practical AMS slot limit — heraldic PNGs otherwise split into 10+ anti-alias buckets. */
const MULTI_COLOUR_MAX_LAYERS = 6;
const MULTI_COLOUR_QUANT_STEP = 48;
const BLUR_SKIP_PIXELS = 1_800_000;
/** Above this pixel count, skip skeleton / full-res polygonise (freezes the tab). */
const TRACE_FAST_PIXELS = 900_000;
const TRACE_POLYGON_MAX_DIM = 1280;
const COMPLEX_RASTER_RUN_LIMIT = 9000;
const COMPLEX_RASTER_MAX_FACTOR = 4;

export const MAX_TRACE_RECTS = 50000;

export const MAX_TRACE_POLYGONS = 600;

const traceYield = () => new Promise((resolve) => setTimeout(resolve, 0));



function downsampleMask(mask, width, height) {

  const nw = Math.max(1, Math.floor(width / 2));

  const nh = Math.max(1, Math.floor(height / 2));

  const out = new Uint8Array(nw * nh);

  for (let y = 0; y < nh; y++) {

    for (let x = 0; x < nw; x++) {

      let on = 0;

      for (let dy = 0; dy < 2; dy++) {

        for (let dx = 0; dx < 2; dx++) {

          const sx = x * 2 + dx;

          const sy = y * 2 + dy;

          if (sx < width && sy < height && mask[sy * width + sx]) on = 1;

        }

      }

      out[y * nw + x] = on;

    }

  }

  return { mask: out, width: nw, height: nh };

}



function clamp(n, min, max) {

  return Math.min(max, Math.max(min, n));

}



function mergeRuns(runs) {

  runs.sort((a, b) => a.x - b.x || a.y - b.y);

  const merged = [];

  for (const r of runs) {

    const prev = merged[merged.length - 1];

    if (prev && prev.x === r.x && prev.w === r.w && prev.y + prev.h === r.y) {

      prev.h += 1;

    } else {

      merged.push({ x: r.x, y: r.y, w: r.w, h: r.h });

    }

  }

  return merged;

}



function maskToRuns(mask, width, height) {

  const runs = [];

  for (let y = 0; y < height; y++) {

    let start = -1;

    for (let x = 0; x <= width; x++) {

      const on = x < width && mask[y * width + x];

      if (on && start < 0) start = x;

      if (!on && start >= 0) {

        runs.push({ x: start, y, w: x - start, h: 1 });

        start = -1;

      }

    }

  }

  return mergeRuns(runs);

}



function cropMask(mask, width, height) {

  let minX = width;

  let minY = height;

  let maxX = -1;

  let maxY = -1;

  for (let y = 0; y < height; y++) {

    for (let x = 0; x < width; x++) {

      if (!mask[y * width + x]) continue;

      minX = Math.min(minX, x);

      minY = Math.min(minY, y);

      maxX = Math.max(maxX, x);

      maxY = Math.max(maxY, y);

    }

  }

  if (maxX < minX || maxY < minY) return null;

  const cw = maxX - minX + 1;

  const ch = maxY - minY + 1;

  const cropped = new Uint8Array(cw * ch);

  for (let y = 0; y < ch; y++) {

    for (let x = 0; x < cw; x++) {

      cropped[y * cw + x] = mask[(y + minY) * width + (x + minX)];

    }

  }

  return { mask: cropped, width: cw, height: ch, ox: minX, oy: minY };

}



function erodeMask(mask, width, height) {

  const out = new Uint8Array(width * height);

  for (let y = 0; y < height; y++) {

    for (let x = 0; x < width; x++) {

      if (!mask[y * width + x]) continue;

      let keep = true;

      for (let dy = -1; dy <= 1 && keep; dy++) {

        for (let dx = -1; dx <= 1 && keep; dx++) {

          const nx = x + dx;

          const ny = y + dy;

          if (nx < 0 || ny < 0 || nx >= width || ny >= height || !mask[ny * width + nx]) {

            keep = false;

          }

        }

      }

      out[y * width + x] = keep ? 1 : 0;

    }

  }

  return out;

}



function morphologicalSkeleton(mask, width, height) {
  if (width * height > TRACE_FAST_PIXELS) return new Uint8Array(width * height);
  const skel = new Uint8Array(width * height);
  let work = mask.slice();
  const maxIter = Math.min(64, Math.max(width, height));
  for (let guard = 0; guard < maxIter; guard++) {
    const eroded = erodeMask(work, width, height);
    let any = false;
    for (let i = 0; i < eroded.length; i++) {
      if (eroded[i]) {
        any = true;
        break;
      }
    }
    if (!any) break;
    const opened = dilateMask(eroded, width, height);
    for (let i = 0; i < work.length; i++) {
      if (work[i] && !opened[i]) skel[i] = 1;
    }
    work = eroded;
  }
  return skel;
}

function skeletonDegree(skel, width, height, x, y) {
  let d = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = x + dx;
      const ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < width && ny < height && skel[ny * width + nx]) d++;
    }
  }
  return d;
}

/** Walk 8-connected skeleton pixels into polylines (centerlines, not boundaries). */
function skeletonToPolylines(skel, width, height) {
  const used = new Uint8Array(width * height);
  const polylines = [];
  const nbrs = [
    [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1],
  ];

  function walkFrom(sx, sy) {
    const path = [[sx, sy]];
    used[sy * width + sx] = 1;
    let x = sx;
    let y = sy;
    let px = -1;
    let py = -1;
    while (true) {
      let next = null;
      for (const [dx, dy] of nbrs) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        if (!skel[ny * width + nx] || used[ny * width + nx]) continue;
        if (nx === px && ny === py) continue;
        next = [nx, ny];
        break;
      }
      if (!next) break;
      path.push(next);
      used[next[1] * width + next[0]] = 1;
      px = x;
      py = y;
      x = next[0];
      y = next[1];
      if (skeletonDegree(skel, width, height, x, y) > 2) break;
    }
    return path.length >= 2 ? path : null;
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (!skel[i] || used[i] || skeletonDegree(skel, width, height, x, y) !== 1) continue;
      const path = walkFrom(x, y);
      if (path) polylines.push(path);
    }
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (!skel[i] || used[i]) continue;
      const path = walkFrom(x, y);
      if (path) polylines.push(path);
    }
  }
  return polylines;
}

/** Outline = skeleton centerlines. Double-edge art returns too many paths → caller should fall back. */
function outlineCenterlinePaths(inkMask, width, height) {
  const cleaned = openMask(inkMask, width, height);
  const skel = morphologicalSkeleton(cleaned, width, height);
  return skeletonToPolylines(skel, width, height);
}

function polylineLength(path) {
  let len = 0;
  for (let i = 1; i < path.length; i++) {
    len += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
  }
  return len;
}

/** Detect skeleton ring garbage from double-edge / edge-detected raster art. */
function shouldFallbackOutline(rawPaths, strokePaths, tw) {
  if (!strokePaths.length) return true;
  if (strokePaths.length > 6) return true;

  let ringLike = 0;
  let totalLen = 0;
  for (const path of rawPaths) {
    const len = polylineLength(path);
    totalLen += len;
    const gap = Math.hypot(
      path[0][0] - path[path.length - 1][0],
      path[0][1] - path[path.length - 1][1],
    );
    if (len > 4 && gap < Math.max(4, len * 0.12)) ringLike++;
  }
  if (ringLike >= 2 && ringLike / rawPaths.length >= 0.2) return true;

  const avgLen = totalLen / rawPaths.length;
  if (rawPaths.length >= 3 && avgLen < tw * 0.045) return true;

  return false;
}

function ensurePrintableWidth(mask, width, height, targetMinPx) {
  let out = mask;
  const passes = Math.min(1, Math.max(0, Math.ceil(targetMinPx / 16) - 2));
  for (let i = 0; i < passes; i++) out = dilateMask(out, width, height);
  return out;
}

function traceQualityParams(tw, options = {}) {
  const smoothPasses = options.smoothPasses ?? 5;
  const simplifyTol = Math.max(0.1, tw / 1400);
  return { smoothPasses, simplifyTol, fbTol: Math.max(0.12, tw / 1200) };
}

function isBackgroundPixel(r, g, b, a, lum, threshold) {
  if (a < 16) return true;
  const bgCutoff = clamp(252 - threshold * 0.55, 170, 252);
  return lum < bgCutoff ? false : true;
}

function colorLogoPixelIsInk(r, g, b, a, threshold) {
  if (a < 16) return false;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const chroma = max - min;
  const lum = r * 0.299 + g * 0.587 + b * 0.114;
  const whiteLum = clamp(238 + (threshold - 128) * 0.04, 234, 246);
  const lowChroma = clamp(28 + (threshold - 128) * 0.04, 22, 34);
  if (lum >= whiteLum && chroma <= lowChroma) return false;
  if (lum >= 248 && chroma <= 48) return false;
  return chroma >= 18 || lum <= 215;
}

function sampleLogoBackground(data, width, height) {
  const samples = [];
  const add = (x, y) => {
    const px = clamp(Math.round(x), 0, width - 1);
    const py = clamp(Math.round(y), 0, height - 1);
    const i = (py * width + px) * 4;
    if (data[i + 3] < 16) return;
    samples.push([data[i], data[i + 1], data[i + 2]]);
  };
  const xs = [0, width * 0.04, width * 0.12, width * 0.5, width * 0.88, width * 0.96, width - 1];
  const ys = [0, height * 0.04, height * 0.12, height * 0.5, height * 0.88, height * 0.96, height - 1];
  for (const x of xs) {
    add(x, 0);
    add(x, height - 1);
  }
  for (const y of ys) {
    add(0, y);
    add(width - 1, y);
  }
  if (!samples.length) return null;
  samples.sort((a, b) => (a[0] + a[1] + a[2]) - (b[0] + b[1] + b[2]));
  const mid = samples[(samples.length / 2) | 0];
  const lum = mid[0] * 0.299 + mid[1] * 0.587 + mid[2] * 0.114;
  const chroma = Math.max(...mid) - Math.min(...mid);
  return { r: mid[0], g: mid[1], b: mid[2], lum, chroma };
}

function colorDistanceSq(r, g, b, bg) {
  const dr = r - bg.r;
  const dg = g - bg.g;
  const db = b - bg.b;
  return dr * dr + dg * dg + db * db;
}

function floodImageBackgroundExterior(data, width, height, bgTolSq) {
  const bg = sampleLogoBackground(data, width, height) || { r: 255, g: 255, b: 255 };
  const exterior = new Uint8Array(width * height);
  const stack = [];
  const isBgAt = (x, y) => {
    const i = (y * width + x) * 4;
    const a = data[i + 3];
    if (a < 16) return true;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    return colorDistanceSq(r, g, b, bg) <= bgTolSq;
  };
  const seed = (x, y) => {
    const idx = y * width + x;
    if (!isBgAt(x, y) || exterior[idx]) return;
    exterior[idx] = 1;
    stack.push(idx);
  };
  for (let x = 0; x < width; x++) {
    seed(x, 0);
    seed(x, height - 1);
  }
  for (let y = 0; y < height; y++) {
    seed(0, y);
    seed(width - 1, y);
  }
  while (stack.length) {
    const idx = stack.pop();
    const x = idx % width;
    const y = (idx / width) | 0;
    if (x > 0) {
      const n = idx - 1;
      if (!exterior[n] && isBgAt(x - 1, y)) { exterior[n] = 1; stack.push(n); }
    }
    if (x < width - 1) {
      const n = idx + 1;
      if (!exterior[n] && isBgAt(x + 1, y)) { exterior[n] = 1; stack.push(n); }
    }
    if (y > 0) {
      const n = idx - width;
      if (!exterior[n] && isBgAt(x, y - 1)) { exterior[n] = 1; stack.push(n); }
    }
    if (y < height - 1) {
      const n = idx + width;
      if (!exterior[n] && isBgAt(x, y + 1)) { exterior[n] = 1; stack.push(n); }
    }
  }
  return exterior;
}

function colorLogoMaskSeed(data, width, height, threshold, invert) {
  const bg = sampleLogoBackground(data, width, height);
  const bgIsDark = bg && bg.lum < 85 && bg.chroma < 42;
  const bgTol = bgIsDark
    ? clamp(34 + Math.max(0, threshold - 128) * 0.05, 24, 56)
    : clamp(16 + Math.max(0, 210 - threshold) * 0.06, 14, 38);
  const bgTolSq = bgTol * bgTol;
  const exterior = floodImageBackgroundExterior(data, width, height, bgTolSq);
  const darkLum = clamp(212 - threshold * 0.18, 168, 210);
  const minChroma = clamp(14 + (128 - threshold) * 0.03, 12, 20);

  const seed = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const i = idx * 4;
      const a = data[i + 3];
      if (a < 16) continue;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const lum = r * 0.299 + g * 0.587 + b * 0.114;
      const chroma = Math.max(r, g, b) - Math.min(r, g, b);
      let on = !exterior[idx]
        || lum <= darkLum
        || chroma >= minChroma
        || (!bgIsDark && colorLogoPixelIsInk(r, g, b, a, threshold));
      if (invert) on = !on;
      seed[idx] = on ? 1 : 0;
    }
  }
  return seed;
}

function colorLogoMask(data, width, height, threshold, invert, options = {}) {
  const seed = colorLogoMaskSeed(data, width, height, threshold, invert);
  if (options.light) return closeMask(seed, width, height, 1);

  const span = Math.min(width, height);
  // Solidify mascot interior: white horse stripes / shield fill inside closed outline.
  let m = seed;
  const mergePasses = clamp(Math.round(span / 180), 2, 6);
  for (let i = 0; i < mergePasses; i++) m = dilateMask(m, width, height);
  // Bridge arched title text (e.g. BRISBANE) down toward shield without full 8-neighbour spread.
  const vertPasses = clamp(Math.round(span / 220), 2, 5);
  for (let i = 0; i < vertPasses; i++) m = dilateMaskVertical(m, width, height, 2);
  const closeR = clamp(Math.round(span / 100), 3, 10);
  m = closeMask(m, width, height, closeR);
  m = fillInteriorEnclosedByOutline(m, width, height);
  m = unionMasks(m, seed, width, height);
  m = fillRowExtents(m, width, height);

  if (invert) {
    const inv = new Uint8Array(width * height);
    for (let i = 0; i < inv.length; i++) inv[i] = m[i] ? 0 : 1;
    m = inv;
  }
  return closeMask(m, width, height, 2);
}

function quantizeInkColor(r, g, b) {
  const step = 28;
  return `${Math.round(r / step) * step},${Math.round(g / step) * step},${Math.round(b / step) * step}`;
}

function quantizeInkColorMulti(r, g, b) {
  const step = MULTI_COLOUR_QUANT_STEP;
  return [
    Math.round(r / step) * step,
    Math.round(g / step) * step,
    Math.round(b / step) * step,
  ];
}

function rgbKey(rgb) {
  return rgb.join(",");
}

function countMultiColourInkBuckets(data, width, height, fgMask) {
  const buckets = new Map();
  const minPixels = Math.max(80, Math.round((width * height) / 14000));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (!fgMask[idx]) continue;
      const i = idx * 4;
      const key = rgbKey(quantizeInkColorMulti(data[i], data[i + 1], data[i + 2]));
      buckets.set(key, (buckets.get(key) || 0) + 1);
    }
  }
  return [...buckets.entries()].filter(([, n]) => n >= minPixels).length;
}

/** Dominant print colours — cap at MULTI_COLOUR_MAX_LAYERS for clean AMS meshes. */
function collectMultiColourPalette(data, width, height, fgMask, maxLayers = MULTI_COLOUR_MAX_LAYERS) {
  const buckets = new Map();
  const minPixels = Math.max(150, Math.round((width * height) / 9000));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (!fgMask[idx]) continue;
      const i = idx * 4;
      const key = rgbKey(quantizeInkColorMulti(data[i], data[i + 1], data[i + 2]));
      buckets.set(key, (buckets.get(key) || 0) + 1);
    }
  }
  const ranked = [...buckets.entries()]
    .filter(([, n]) => n >= minPixels)
    .sort((a, b) => b[1] - a[1]);
  if (ranked.length < 2) return null;
  return ranked.slice(0, maxLayers).map(([key]) => key.split(",").map(Number));
}

function paletteIsGreyscaleOnly(palette) {
  return palette?.length > 0 && palette.every(([r, g, b]) => Math.max(r, g, b) - Math.min(r, g, b) < 50);
}

/** Collapse anti-alias greys into exactly two AMS layers — black ink + white ink. */
function buildBinaryBlackWhiteLayerMasks(data, width, height, fgMask, threshold = 128) {
  const dark = new Uint8Array(width * height);
  const light = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (!fgMask[idx]) continue;
      const i = idx * 4;
      const lum = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
      if (lum < threshold) dark[idx] = 1;
      else light[idx] = 1;
    }
  }
  return [
    { rgb: [0, 0, 0], mask: dark },
    { rgb: [255, 255, 255], mask: light },
  ];
}

function layerRgb(layer) {
  if (layer.rgb?.length === 3) return layer.rgb;
  const hex = String(layer.hex || "").replace("#", "");
  if (hex.length < 6) return [128, 128, 128];
  return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
}

function layerIsGreyscale(layer) {
  const [r, g, b] = layerRgb(layer);
  return Math.max(r, g, b) - Math.min(r, g, b) < 50;
}

/** Merge stored greyscale AMS layers down to Black + White (export / library / old traces). */
export function collapseGreyscaleColorLayers(layers, width, height, { threshold = 128, force = false } = {}) {
  if (!layers?.length || layers.length <= 2) return layers;
  const expected = width * height;
  if (expected <= 0) return layers;
  const greyscaleOnly = force || layers.every(layerIsGreyscale);
  if (!greyscaleOnly) return layers;

  const dark = new Uint8Array(expected);
  const light = new Uint8Array(expected);
  for (const layer of layers) {
    if (!layer.mask?.length) continue;
    const m = layer.mask instanceof Uint8Array ? layer.mask : Uint8Array.from(layer.mask);
    const [r, g, b] = layerRgb(layer);
    const lum = r * 0.299 + g * 0.587 + b * 0.114;
    const target = lum < threshold ? dark : light;
    for (let i = 0; i < Math.min(m.length, expected); i++) {
      if (m[i]) target[i] = 1;
    }
  }

  const out = [];
  for (const [rgb, mask, label] of [[[0, 0, 0], dark, "Black"], [[255, 255, 255], light, "White"]]) {
    const fill = maskFillRatio(mask, width, height);
    if (fill < 0.004) continue;
    out.push({
      rgb,
      hex: rgbToHex(...rgb),
      label,
      mask,
      rects: maskToRuns(mask, width, height),
      maskFillPct: Math.round(fill * 100),
      shapeGroups: [],
    });
  }
  return out.length >= 2 ? out : layers;
}

/** Normalise multi-colour trace data — only collapse greys when Black+white mode is explicit. */
export function normalizeMultiColourTraceData(traceData, { threshold = 128, traceMode } = {}) {
  if (!traceData?.multiColour || !traceData.colorLayers?.length) return traceData;
  // Do NOT auto-merge greyscale multi-colour → B&W (that posterised coffee-bag line art).
  const force = traceMode === "black-white";
  if (!force) return traceData;
  const collapsed = collapseGreyscaleColorLayers(
    traceData.colorLayers,
    traceData.width,
    traceData.height,
    { threshold, force },
  );
  if (collapsed === traceData.colorLayers) return traceData;
  return {
    ...traceData,
    colorLayers: collapsed,
    colorLayerCount: collapsed.length,
    binaryBlackWhite: true,
    colourPaletteMerged: true,
    rawColourBucketCount: traceData.rawColourBucketCount ?? traceData.colorLayers.length,
  };
}

/** One mask per palette entry — each ink pixel assigned to nearest AMS colour (no overlap). */
function buildExclusiveMultiColourLayerMasks(data, width, height, fgMask, palette) {
  const masks = palette.map(() => new Uint8Array(width * height));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (!fgMask[idx]) continue;
      const i = idx * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      let best = 0;
      let bestD = Infinity;
      for (let p = 0; p < palette.length; p++) {
        const [pr, pg, pb] = palette[p];
        const d = (r - pr) ** 2 + (g - pg) ** 2 + (b - pb) ** 2;
        if (d < bestD) {
          bestD = d;
          best = p;
        }
      }
      masks[best][idx] = 1;
    }
  }
  return masks.map((mask, p) => ({
    rgb: palette[p],
    mask,
  }));
}

function collectInkColorLayers(data, width, height, threshold, invert, blur) {
  const buckets = new Map();
  const minPixels = Math.max(80, Math.round((width * height) / 25000));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const a = data[i + 3];
      const lum = blur ? blur[y * width + x] : r * 0.299 + g * 0.587 + b * 0.114;
      let bg = isBackgroundPixel(r, g, b, a, lum, threshold);
      if (invert) bg = !bg;
      if (bg) continue;
      const key = quantizeInkColor(r, g, b);
      buckets.set(key, (buckets.get(key) || 0) + 1);
    }
  }
  const layers = [...buckets.entries()]
    .filter(([, count]) => count >= minPixels)
    .sort((a, b) => b[1] - a[1]);
  return layers.length >= 2 ? layers.map(([key]) => key) : null;
}

function maskForInkColor(data, width, height, colorKey, threshold, invert, blur) {
  const [tr, tg, tb] = colorKey.split(",").map(Number);
  const tol = 40;
  const mask = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const a = data[i + 3];
      const lum = blur ? blur[y * width + x] : r * 0.299 + g * 0.587 + b * 0.114;
      let bg = isBackgroundPixel(r, g, b, a, lum, threshold);
      if (invert) bg = !bg;
      if (bg) continue;
      if (Math.abs(r - tr) <= tol && Math.abs(g - tg) <= tol && Math.abs(b - tb) <= tol) {
        mask[y * width + x] = 1;
      }
    }
  }
  return openMask(mask, width, height);
}

async function prepareShapeGroupsAsync(groups, simplifyTol, smoothPasses) {
  const holePasses = smoothPasses >= 2 ? Math.max(1, smoothPasses - 1) : 0;
  const out = [];
  for (let i = 0; i < groups.length; i++) {
    if (i % 3 === 0) await traceYield();
    const { outer, holes } = groups[i];
    out.push({
      outer: prepareContourRing(outer, simplifyTol, true, smoothPasses),
      holes: holes.map((hole) => prepareContourRing(hole, simplifyTol * 0.5, holePasses > 0, holePasses)),
    });
  }
  return out;
}

async function traceColorLayerGroupsAsync(data, width, height, tw, th, ox, oy, threshold, invert, blur, options, quality) {
  const colorLayers = collectInkColorLayers(data, width, height, threshold, invert, blur);
  if (!colorLayers || colorLayers.length < 2) return null;

  const allGroups = [];
  const combined = new Uint8Array(tw * th);
  for (const colorKey of colorLayers.slice(0, MAX_COLOR_LAYERS)) {
    await traceYield();
    let layerMask = maskForInkColor(data, width, height, colorKey, threshold, invert, blur);
    if (options.strengthen) layerMask = closeMask(layerMask, width, height);
    const layerCrop = cropMask(layerMask, width, height);
    if (!layerCrop) continue;
    const lm = layerCrop.mask;
    const lw = layerCrop.width;
    const lh = layerCrop.height;
    for (let y = 0; y < lh; y++) {
      for (let x = 0; x < lw; x++) {
        if (!lm[y * lw + x]) continue;
        const gx = layerCrop.ox - ox + x;
        const gy = layerCrop.oy - oy + y;
        if (gx >= 0 && gy >= 0 && gx < tw && gy < th) combined[gy * tw + gx] = 1;
      }
    }
    const polys = maskToPolygons(lm, lw, lh);
    let groups = await prepareShapeGroupsAsync(groupPolygonsWithHoles(polys), quality.simplifyTol, quality.smoothPasses);
    const ds = downsampleUntilComplexity(lm, lw, lh, groups, 1, quality.simplifyTol, quality.smoothPasses);
    groups = ds.groups.map(({ outer, holes }) => ({
      outer: outer.map(([px, py]) => [px + layerCrop.ox - ox, py + layerCrop.oy - oy]),
      holes: holes.map((hole) => hole.map(([px, py]) => [px + layerCrop.ox - ox, py + layerCrop.oy - oy])),
    }));
    allGroups.push(...groups);
    if (allGroups.length > 40) return null;
  }
  if (allGroups.length < 2) return null;
  // Multi-layer traces on heraldic art explode into hundreds of islands — use single silhouette instead.
  if (allGroups.length > 40) return null;
  return { shapeGroups: allGroups, combined, colorLayerCount: Math.min(colorLayers.length, MAX_COLOR_LAYERS) };
}

function maskFillRatio(mask, width, height) {
  let ink = 0;
  for (let i = 0; i < width * height; i++) if (mask[i]) ink++;
  return ink / Math.max(1, width * height);
}

function maskEdgeInkRatio(mask, width, height) {
  if (width < 2 || height < 2) return 0;
  let edge = 0;
  let ink = 0;
  for (let x = 0; x < width; x++) {
    if (mask[x]) ink++;
    edge++;
    const b = (height - 1) * width + x;
    if (mask[b]) ink++;
    edge++;
  }
  for (let y = 1; y < height - 1; y++) {
    if (mask[y * width]) ink++;
    edge++;
    if (mask[y * width + width - 1]) ink++;
    edge++;
  }
  return ink / Math.max(1, edge);
}

function invertMask(mask, width, height) {
  const out = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) out[i] = mask[i] ? 0 : 1;
  return out;
}

/** Heraldic PNGs with dark borders often binarize as frame=ink — flip when fill is implausibly high. */
function autoCorrectSilhouettePolarity(mask, width, height) {
  const fill = maskFillRatio(mask, width, height);
  const edgeInk = maskEdgeInkRatio(mask, width, height);
  if (fill <= 0.4 && edgeInk <= 0.68) return mask;
  const inv = invertMask(mask, width, height);
  const invFill = maskFillRatio(inv, width, height);
  if (invFill >= 0.008 && invFill <= 0.42 && invFill < fill) return inv;
  return mask;
}

/** Outline-mode ink crop — tight line art for double-edge heraldic fallback (not silhouette bg flood). */
function outlineInkCrop(data, fullW, fullH, threshold, invert, blur) {
  let ink = binarizeImageData(data, fullW, fullH, threshold, invert, "outline", blur);
  ink = openMask(ink, fullW, fullH);
  return cropMask(ink, fullW, fullH);
}

/** Silhouette binarize + polarity fix — solid fill inside art (reverse of thin outline extract). */
function silhouetteInkCrop(data, fullW, fullH, threshold, invert, blur) {
  let ink = binarizeImageData(data, fullW, fullH, threshold, invert, "silhouette", blur);
  ink = autoCorrectSilhouettePolarity(ink, fullW, fullH);
  return cropMask(ink, fullW, fullH);
}

/** Minimum ink coverage for a pre-filled silhouette (below = line art needing interior fill). */
const SOLID_SILHOUETTE_MIN_FILL = 0.14;

function isSolidSilhouetteMask(mask, width, height) {
  const fill = maskFillRatio(mask, width, height);
  if (fill < SOLID_SILHOUETTE_MIN_FILL || fill > 0.55) return false;
  return !maskNeedsDoubleEdgeSolidify(mask, width, height);
}

function finishOutlineFallbackSilhouette(data, fullW, fullH, threshold, invert, blur, width, height, extra = {}) {
  const silCropped = silhouetteInkCrop(data, fullW, fullH, threshold, invert, blur);
  if (!silCropped) {
    return {
      rects: [], width: 0, height: 0, svg: "", rectCount: 0, simplified: false, simplifyFactor: 1,
    };
  }
  const { mask: workMask, width: tw, height: th, ox, oy } = silCropped;
  const quality = traceQualityParams(tw, extra);
  const solidSilhouetteFill = isSolidSilhouetteMask(workMask, tw, th);
  return finishSilhouetteTrace(workMask, tw, th, ox, oy, [], 1, width, height, {
    outlineFallback: true,
    solidSilhouetteFill,
    simplifyTol: quality.fbTol,
    smoothPasses: quality.smoothPasses,
    ...extra,
  });
}

function compactTraceMask(workMask, shapeGroups) {
  if (workMask?.length) return workMask.slice();
  if (shapeGroups?.length) return [];
  return [];
}

function downsampleMaskCoverage(mask, width, height, minOn = 2) {
  const nw = Math.max(1, Math.floor(width / 2));
  const nh = Math.max(1, Math.floor(height / 2));
  const out = new Uint8Array(nw * nh);
  for (let y = 0; y < nh; y++) {
    for (let x = 0; x < nw; x++) {
      let count = 0;
      for (let dy = 0; dy < 2; dy++) {
        for (let dx = 0; dx < 2; dx++) {
          const sx = x * 2 + dx;
          const sy = y * 2 + dy;
          if (sx < width && sy < height && mask[sy * width + sx]) count++;
        }
      }
      out[y * nw + x] = count >= minOn ? 1 : 0;
    }
  }
  return { mask: out, width: nw, height: nh };
}

function unionMasks(a, b, width, height) {
  const len = width * height;
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    out[i] = a[i] || b[i] ? 1 : 0;
  }
  return out;
}

/** Flood-fill connected components in a binary mask. */
function findMaskComponents(mask, width, height) {
  const labels = new Int32Array(width * height);
  const comps = [];
  let nextLabel = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const start = y * width + x;
      if (!mask[start] || labels[start]) continue;
      nextLabel += 1;
      const comp = { label: nextLabel, area: 0, sumX: 0, sumY: 0 };
      const stack = [start];
      labels[start] = nextLabel;
      while (stack.length) {
        const idx = stack.pop();
        comp.area += 1;
        const px = idx % width;
        const py = (idx / width) | 0;
        comp.sumX += px;
        comp.sumY += py;
        if (px > 0) {
          const n = idx - 1;
          if (mask[n] && !labels[n]) { labels[n] = nextLabel; stack.push(n); }
        }
        if (px < width - 1) {
          const n = idx + 1;
          if (mask[n] && !labels[n]) { labels[n] = nextLabel; stack.push(n); }
        }
        if (py > 0) {
          const n = idx - width;
          if (mask[n] && !labels[n]) { labels[n] = nextLabel; stack.push(n); }
        }
        if (py < height - 1) {
          const n = idx + width;
          if (mask[n] && !labels[n]) { labels[n] = nextLabel; stack.push(n); }
        }
      }
      comps.push(comp);
    }
  }
  return { labels, comps };
}

/** Drop threshold-noise islands and thin spikes before polygonise. */
function pruneSilhouetteMask(mask, width, height, options = {}) {
  let m = autoCorrectSilhouettePolarity(mask, width, height);
  const { labels, comps } = findMaskComponents(m, width, height);
  if (!comps.length) return m;
  if (comps.length === 1) return options.skipOpen ? m : openMask(m, width, height);
  comps.sort((a, b) => b.area - a.area);
  const main = comps[0];
  const mainCx = main.sumX / main.area;
  const mainCy = main.sumY / main.area;
  const span = Math.max(width, height);
  const minRatio = options.minIslandRatio ?? (options.keepLogoSatellites ? 0.015 : 0.1);
  const maxDist = options.maxIslandDist ?? (options.keepLogoSatellites ? span * 0.48 : span * 0.4);
  const out = new Uint8Array(width * height);
  for (const comp of comps) {
    const cx = comp.sumX / comp.area;
    const cy = comp.sumY / comp.area;
    const dist = Math.hypot(cx - mainCx, cy - mainCy);
    const keep = comp === main
      || (comp.area >= main.area * minRatio && dist < maxDist);
    if (!keep) continue;
    for (let i = 0; i < labels.length; i++) {
      if (labels[i] === comp.label) out[i] = 1;
    }
  }
  return out.some((v) => v) ? out : m;
}

function silhouetteGroupsFromMask(mask, tw, th, simplifyTol, smoothPasses) {
  const polys = maskToPolygons(mask, tw, th);
  const raw = groupPolygonsWithHoles(polys);
  if (!raw.length) return [];
  const seed = raw.map(({ outer, holes }) => ({ outer, holes: holes || [] }));
  const merged = unionShapeGroupsToPrepared(seed, tw, th, simplifyTol, smoothPasses, 2, 768);
  const groups = merged.length
    ? merged
    : prepareShapeGroups(seed, simplifyTol, smoothPasses);
  return filterDegenerateShapeGroups(groups, tw, th);
}

function dilateRow1D(row, width, radius) {
  const out = new Uint8Array(width);
  for (let x = 0; x < width; x++) {
    let on = 0;
    for (let dx = -radius; dx <= radius && !on; dx++) {
      const nx = x + dx;
      if (nx >= 0 && nx < width && row[nx]) on = 1;
    }
    out[x] = on;
  }
  return out;
}

function erodeRow1D(row, width, radius) {
  const out = new Uint8Array(width);
  for (let x = 0; x < width; x++) {
    let keep = 1;
    for (let dx = -radius; dx <= radius && keep; dx++) {
      const nx = x + dx;
      if (nx < 0 || nx >= width || !row[nx]) keep = 0;
    }
    out[x] = keep;
  }
  return out;
}

/** 1D morphological close along each scanline — bridges wide double-edge gaps before vertical close. */
function closeMaskHorizontal(mask, width, height, radius = 1) {
  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const base = y * width;
    const row = mask.subarray(base, base + width);
    let m = row;
    for (let i = 0; i < radius; i++) m = dilateRow1D(m, width, 1);
    for (let i = 0; i < radius; i++) m = erodeRow1D(m, width, 1);
    out.set(m, base);
  }
  return out;
}

/** Bridge small horizontal gaps between ink runs on one scanline (double-edge pairs on a row). */
function bridgeRowGapsInMask(mask, width, height, maxGap) {
  const out = mask.slice();
  for (let y = 0; y < height; y++) {
    const base = y * width;
    const runs = [];
    let x = 0;
    while (x < width) {
      while (x < width && !mask[base + x]) x++;
      if (x >= width) break;
      const start = x;
      while (x < width && mask[base + x]) x++;
      runs.push([start, x]);
    }
    for (let i = 0; i < runs.length - 1; i++) {
      const gapStart = runs[i][1];
      const gapEnd = runs[i + 1][0];
      if (gapEnd - gapStart <= maxGap) {
        for (let g = gapStart; g < gapEnd; g++) out[base + g] = 1;
      }
    }
  }
  return out;
}

/** Mark empty pixels reachable from the image border (outline ink is a wall). */
function floodExteriorEmpty(mask, width, height) {
  const exterior = new Uint8Array(width * height);
  const stack = [];
  const seed = (x, y) => {
    const idx = y * width + x;
    if (mask[idx] || exterior[idx]) return;
    exterior[idx] = 1;
    stack.push(idx);
  };
  for (let x = 0; x < width; x++) {
    seed(x, 0);
    seed(x, height - 1);
  }
  for (let y = 0; y < height; y++) {
    seed(0, y);
    seed(width - 1, y);
  }
  while (stack.length) {
    const idx = stack.pop();
    const x = idx % width;
    const y = (idx / width) | 0;
    if (x > 0) {
      const n = idx - 1;
      if (!mask[n] && !exterior[n]) { exterior[n] = 1; stack.push(n); }
    }
    if (x < width - 1) {
      const n = idx + 1;
      if (!mask[n] && !exterior[n]) { exterior[n] = 1; stack.push(n); }
    }
    if (y > 0) {
      const n = idx - width;
      if (!mask[n] && !exterior[n]) { exterior[n] = 1; stack.push(n); }
    }
    if (y < height - 1) {
      const n = idx + width;
      if (!mask[n] && !exterior[n]) { exterior[n] = 1; stack.push(n); }
    }
  }
  return exterior;
}

/** Flood exterior, then fill enclosed interior — solid silhouette from closed outline. */
function fillInteriorEnclosedByOutline(boundaryMask, width, height) {
  const exterior = floodExteriorEmpty(boundaryMask, width, height);
  const out = boundaryMask.slice();
  for (let i = 0; i < out.length; i++) {
    if (!boundaryMask[i] && !exterior[i]) out[i] = 1;
  }
  return out;
}

/** Detect thin double-edge line art that still has horizontal band gaps after binarize. */
function maskNeedsDoubleEdgeSolidify(mask, width, height) {
  const fill = maskFillRatio(mask, width, height);
  if (fill > 0.38 || fill < 0.003) return false;
  let bandRows = 0;
  for (let y = 1; y < height - 1; y++) {
    const row = y * width;
    let rowInk = 0;
    for (let x = 0; x < width; x++) if (mask[row + x]) rowInk++;
    if (rowInk / width > 0.04) continue;
    let above = 0;
    let below = 0;
    for (let x = 0; x < width; x++) {
      if (mask[row - width + x]) above++;
      if (mask[row + width + x]) below++;
    }
    if (above / width > 0.02 && below / width > 0.02) bandRows++;
  }
  return bandRows >= Math.max(6, Math.round(height * 0.006));
}

/** Per scanline: fill between leftmost and rightmost ink (closes interior for side-view line art). */
function fillRowExtents(mask, width, height) {
  const out = mask.slice();
  for (let y = 0; y < height; y++) {
    const row = y * width;
    let minX = width;
    let maxX = -1;
    for (let x = 0; x < width; x++) {
      if (!mask[row + x]) continue;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
    }
    if (maxX > minX) {
      for (let x = minX; x <= maxX; x++) out[row + x] = 1;
    }
  }
  return out;
}

/** Fill empty rows sandwiched between rows that have ink (bridge horizontal band gaps). */
function fillSandwichedEmptyRows(mask, width, height, neighborSpan = 2) {
  const out = mask.slice();
  for (let y = 1; y < height - 1; y++) {
    const row = y * width;
    let rowInk = 0;
    for (let x = 0; x < width; x++) if (mask[row + x]) rowInk++;
    if (rowInk > 0) continue;
    let above = 0;
    let below = 0;
    for (let d = 1; d <= neighborSpan; d++) {
      if (y - d >= 0) {
        const r = (y - d) * width;
        for (let x = 0; x < width; x++) if (mask[r + x]) above++;
      }
      if (y + d < height) {
        const r = (y + d) * width;
        for (let x = 0; x < width; x++) if (mask[r + x]) below++;
      }
    }
    if (above < width * 0.006 || below < width * 0.006) continue;
    let minX = width;
    let maxX = -1;
    for (let d = 1; d <= neighborSpan; d++) {
      for (const yy of [y - d, y + d]) {
        if (yy < 0 || yy >= height) continue;
        const r = yy * width;
        for (let x = 0; x < width; x++) {
          if (!mask[r + x]) continue;
          minX = Math.min(minX, x);
          maxX = Math.max(maxX, x);
        }
      }
    }
    if (maxX > minX) {
      for (let x = minX; x <= maxX; x++) out[row + x] = 1;
    }
  }
  return out;
}

/** Line art (double-edge) → solid fill: row extent + sandwich + interior hole plug. */
function lineArtMaskToSolidFill(mask, width, height) {
  const span = Math.min(width, height);
  const startFill = maskFillRatio(mask, width, height);
  if (isSolidSilhouetteMask(mask, width, height)) return mask;

  const mergePasses = clamp(Math.round(span / 200), 2, 10);
  let m = mask;
  for (let i = 0; i < mergePasses; i++) m = dilateMask(m, width, height);

  for (let pass = 0; pass < 6; pass++) {
    m = fillRowExtents(m, width, height);
    m = bridgeRowGapsInMask(m, width, height, clamp(Math.round(span / 18), 24, 140));
    m = fillSandwichedEmptyRows(m, width, height, 3);
  }

  const closeR = clamp(Math.round(span / 70), 4, 24);
  m = closeMask(m, width, height, closeR);
  // Plug triangular wedges / interior holes (forehead voids between double-edge pairs).
  m = fillInteriorEnclosedByOutline(m, width, height);
  m = fillRowExtents(m, width, height);

  let fill = maskFillRatio(m, width, height);
  if (fill >= SOLID_SILHOUETTE_MIN_FILL) return m;

  const polys = maskToPolygons(closeMask(m, width, height, closeR + 4), width, height);
  const grouped = groupPolygonsWithHoles(polys);
  if (grouped.length) {
    const solid = rasterizeShapeGroupsToMask([{ outer: grouped[0].outer, holes: grouped[0].holes || [] }], width, height);
    fill = maskFillRatio(solid, width, height);
    if (fill >= SOLID_SILHOUETTE_MIN_FILL) return solid;
    if (fill > maskFillRatio(m, width, height)) m = solid;
  }

  const flooded = fillInteriorEnclosedByOutline(closeMask(dilateMask(m, width, height), width, height, 6), width, height);
  if (maskFillRatio(flooded, width, height) > maskFillRatio(m, width, height)) return flooded;
  return m;
}

function finishSilhouetteTrace(workMask, tw, th, ox, oy, shapeGroups, simplifyFactor, width, height, extra = {}) {
  const simplifyTol = extra.simplifyTol ?? Math.max(0.18, tw / 2000);
  const smoothPasses = extra.smoothPasses ?? 1;
  const needsSolidify = !extra.solidSilhouetteFill
    && (
      !!extra.outlineFallback
      || maskNeedsDoubleEdgeSolidify(workMask, tw, th)
      || maskFillRatio(workMask, tw, th) < SOLID_SILHOUETTE_MIN_FILL
    );
  let inkMask = workMask;
  if (needsSolidify) inkMask = lineArtMaskToSolidFill(workMask, tw, th);
  const span = Math.max(tw, th);
  let silhouetteMask = pruneSilhouetteMask(inkMask, tw, th, {
    skipOpen: needsSolidify || !!extra.solidSilhouetteFill,
    keepLogoSatellites: !!extra.colorLogo || !!extra.solidSilhouetteFill,
    minIslandRatio: extra.solidSilhouetteFill ? 0.004 : undefined,
    maxIslandDist: extra.solidSilhouetteFill ? span * 0.62 : undefined,
  });
  if (needsSolidify) {
    silhouetteMask = unionMasks(silhouetteMask, workMask, tw, th);
  }
  let groups = silhouetteGroupsFromMask(silhouetteMask, tw, th, simplifyTol, smoothPasses);
  if (!groups.length && shapeGroups?.length) {
    groups = filterDegenerateShapeGroups(shapeGroups, tw, th);
    const cleaned = cleanTraceSilhouetteGroups(groups, tw, th);
    if (cleaned.length) groups = cleaned;
  }
  if (groups.length > 1) {
    const merged = extra.solidSilhouetteFill
      ? unionShapeGroupsToPrepared(groups, tw, th, Math.max(0.06, tw / 3200), 1, 3, 768)
      : previewMergeTraceShapeGroups(groups, tw, th);
    if (merged.length) groups = merged;
  }
  const shapeGroupsUnited = true;
  const previewShapeGroups = groups;
  const rects = maskToRuns(silhouetteMask, tw, th);
  const svg = polygonsToSvg(groups, tw, th);
  const maskFillPct = Math.round(maskFillRatio(silhouetteMask, tw, th) * 100);
  const islandCount = findMaskComponents(silhouetteMask, tw, th).comps.length;
  return {
    rects,
    mask: compactTraceMask(silhouetteMask, groups),
    silhouetteMask,
    maskFillPct,
    islandCount,
    polygons: [],
    shapeGroups: groups,
    shapeGroupsUnited,
    previewShapeGroups,
    strokePaths: [],
    width: tw,
    height: th,
    cropOx: ox,
    cropOy: oy,
    svg,
    rectCount: rects.length,
    polygonCount: groups.length,
    simplified: simplifyFactor > 1,
    simplifyFactor,
    tooComplex: groups.length > MAX_TRACE_POLYGONS,
    mode: "silhouette",
    tracePx: `${width}×${height}`,
    ...extra,
  };
}

function simplifyComplexRasterInkMask(mask, width, height, simplifyFactor) {
  let inkMask = mask instanceof Uint8Array ? mask.slice() : new Uint8Array(mask);
  let tw = width;
  let th = height;
  let factor = simplifyFactor || 1;
  let rects = maskToRuns(inkMask, tw, th);
  let simplified = false;
  while (rects.length > COMPLEX_RASTER_RUN_LIMIT && factor < COMPLEX_RASTER_MAX_FACTOR) {
    const ds = downsampleMaskCoverage(inkMask, tw, th, 2);
    inkMask = ds.mask;
    tw = ds.width;
    th = ds.height;
    factor *= 2;
    rects = maskToRuns(inkMask, tw, th);
    simplified = true;
  }
  return { inkMask, tw, th, factor, rects, simplified, rawRunCount: rects.length };
}

function finishRasterInkTrace(workMask, tw, th, ox, oy, simplifyFactor, width, height, extra = {}) {
  const cleaned = simplifyComplexRasterInkMask(workMask, tw, th, simplifyFactor);
  const inkMask = cleaned.inkMask;
  tw = cleaned.tw;
  th = cleaned.th;
  simplifyFactor = cleaned.factor;
  const rects = maskToRuns(inkMask, tw, th);
  const maskFillPct = Math.round(maskFillRatio(inkMask, tw, th) * 100);
  return {
    rects,
    mask: compactTraceMask(inkMask, []),
    silhouetteMask: inkMask,
    maskFillPct,
    polygons: [],
    shapeGroups: [],
    shapeGroupsUnited: false,
    previewShapeGroups: [],
    strokePaths: [],
    width: tw,
    height: th,
    cropOx: ox,
    cropOy: oy,
    svg: "",
    rectCount: rects.length,
    polygonCount: 0,
    simplified: simplifyFactor > 1,
    simplifyFactor,
    tooComplex: false,
    mode: "outline",
    outlineRaster: true,
    rasterSimplified: cleaned.simplified,
    tracePx: `${width}×${height}`,
    ...extra,
  };
}

function rgbToHex(r, g, b) {
  const c = (n) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

function colourLayerLabel(r, g, b) {
  const lum = r * 0.299 + g * 0.587 + b * 0.114;
  const chroma = Math.max(r, g, b) - Math.min(r, g, b);
  if (lum > 215 && chroma < 55) return "White";
  if (lum < 48 && chroma < 40) return "Black";
  if (r > g + 28 && r > b + 28) return "Red";
  if (r > 150 && g > 70 && b < 90 && r >= g) return "Orange";
  if (b > r + 24 && b > g + 12) return "Blue";
  if (g > r + 20 && g > b + 10) return "Green";
  if (chroma < 35) return lum > 128 ? "Grey" : "Dark grey";
  return "Colour";
}

/** Quantize ink inside colour-logo foreground — skips stripe/background noise. */
function collectForegroundColorLayers(data, width, height, threshold, invert, blur) {
  const fg = colorLogoMask(data, width, height, threshold, invert);
  const buckets = new Map();
  const minPixels = Math.max(48, Math.round((width * height) / 32000));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (!fg[idx]) continue;
      const i = idx * 4;
      const key = quantizeInkColor(data[i], data[i + 1], data[i + 2]);
      buckets.set(key, (buckets.get(key) || 0) + 1);
    }
  }
  const layers = [...buckets.entries()]
    .filter(([, count]) => count >= minPixels)
    .sort((a, b) => b[1] - a[1]);
  return layers.length >= 2 ? layers.map(([key]) => key) : null;
}

function maskForColourKeyInForeground(data, width, height, colorKey, fgMask, threshold, invert, blur) {
  const mask = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (!fgMask[idx]) continue;
      const i = idx * 4;
      const key = quantizeInkColor(data[i], data[i + 1], data[i + 2]);
      if (key === colorKey) mask[idx] = 1;
    }
  }
  // Horizontal close only — full open/close erodes thin crest edges into pixel stairs.
  return closeMaskHorizontal(mask, width, height, 1);
}

function extractAlignedCropMask(fullMask, fullW, fullH, tw, th, ox, oy) {
  const out = new Uint8Array(tw * th);
  for (let y = 0; y < th; y++) {
    for (let x = 0; x < tw; x++) {
      const fx = ox + x;
      const fy = oy + y;
      if (fx >= 0 && fy >= 0 && fx < fullW && fy < fullH && fullMask[fy * fullW + fx]) {
        out[y * tw + x] = 1;
      }
    }
  }
  return out;
}

function resizeMaskNearest(mask, w, h, outW, outH) {
  if (w === outW && h === outH) return mask;
  const out = new Uint8Array(outW * outH);
  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      const sx = Math.min(w - 1, (x * w / outW) | 0);
      const sy = Math.min(h - 1, (y * h / outH) | 0);
      if (mask[sy * w + sx]) out[y * outW + x] = 1;
    }
  }
  return out;
}

function normalizeMultiColourToSource(layers, previewMask, tw, th, ox, oy, traceScale) {
  if (Math.abs(traceScale - 1) < 0.01) {
    return { layers, mask: previewMask, width: tw, height: th, cropOx: ox, cropOy: oy };
  }
  const outW = Math.max(1, Math.round(tw / traceScale));
  const outH = Math.max(1, Math.round(th / traceScale));
  const outOx = Math.round(ox / traceScale);
  const outOy = Math.round(oy / traceScale);
  const scaledMask = resizeMaskNearest(previewMask, tw, th, outW, outH);
  const scaledLayers = layers.map((layer) => {
    const mask = resizeMaskNearest(layer.mask, tw, th, outW, outH);
    return {
      ...layer,
      mask,
      rects: maskToRuns(mask, outW, outH),
      maskFillPct: Math.round(maskFillRatio(mask, outW, outH) * 100),
    };
  });
  return { layers: scaledLayers, mask: scaledMask, width: outW, height: outH, cropOx: outOx, cropOy: outOy };
}

function capCanvasMaxPx(source, maxPx) {
  const longest = Math.max(source.width, source.height);
  if (longest <= maxPx) return source;
  return scaleCanvasToMaxPx(source, maxPx);
}

function multiColourPreviewMask(colorLayers, tw, th) {
  const combined = new Uint8Array(tw * th);
  for (const layer of colorLayers) {
    if (!layer.mask?.length) continue;
    for (let i = 0; i < combined.length; i++) if (layer.mask[i]) combined[i] = 1;
  }
  return combined.some((v) => v) ? combined : null;
}

/** Multi-colour logo trace — one ink mask per detected filament colour. */
export async function traceMultiColourCanvasAsync(canvas, options = {}) {
  await traceYield();
  const sourceW = canvas.width;
  const sourceH = canvas.height;
  canvas = capCanvasMaxPx(canvas, MULTI_COLOUR_WORK_MAX_PX);
  canvas = upscaleCanvasMinMaxPx(canvas, MULTI_COLOUR_MIN_MAX_PX);
  const traceScale = canvas.width / sourceW;
  const threshold = clamp(options.threshold ?? 128, 1, 254);
  const invert = !!options.invert;
  const ctx = canvas.getContext("2d");
  const { width, height } = canvas;
  const { data } = ctx.getImageData(0, 0, width, height);
  const blur = blurAlphaMask(data, width, height);
  const bg = sampleLogoBackground(data, width, height);
  const bgIsDark = bg && bg.lum < 85 && bg.chroma < 42;
  const effectiveInvert = invert || bgIsDark;
  const fgMask = colorLogoMask(data, width, height, threshold, effectiveInvert, { light: true });
  const forceBinary = options.mode === "black-white";
  const rawBucketCount = countMultiColourInkBuckets(data, width, height, fgMask);
  let palette = collectMultiColourPalette(data, width, height, fgMask, MULTI_COLOUR_MAX_LAYERS);
  if (!palette) {
    const colorKeys = collectInkColorLayers(data, width, height, threshold, effectiveInvert, blur);
    if (colorKeys?.length >= 2) {
      palette = colorKeys.slice(0, MULTI_COLOUR_MAX_LAYERS).map((key) => key.split(",").map(Number));
    }
  }
  if (!forceBinary && (!palette || palette.length < 2)) {
    return {
      rects: [],
      width: 0,
      height: 0,
      svg: "",
      rectCount: 0,
      simplified: false,
      simplifyFactor: 1,
      tooComplex: false,
      mode: "multi-colour",
      multiColour: true,
      colorLayers: [],
    };
  }

  const combined = fgMask.slice();
  const useBinary = forceBinary || (paletteIsGreyscaleOnly(palette) && palette.length > 2);
  const layerMasks = useBinary
    ? buildBinaryBlackWhiteLayerMasks(data, width, height, fgMask, threshold)
    : buildExclusiveMultiColourLayerMasks(data, width, height, fgMask, palette);
  for (const { mask } of layerMasks) {
    for (let i = 0; i < combined.length; i++) if (mask[i]) combined[i] = 1;
  }

  const cropped = cropMask(combined, width, height);
  if (!cropped) {
    return {
      rects: [],
      width: 0,
      height: 0,
      svg: "",
      rectCount: 0,
      simplified: false,
      simplifyFactor: 1,
      tooComplex: false,
      mode: "multi-colour",
      multiColour: true,
      colorLayers: [],
    };
  }

  const { width: tw, height: th, ox, oy } = cropped;
  const colorLayers = [];
  const usedLabels = new Map();
  for (const { rgb, mask } of layerMasks) {
    await traceYield();
    const cropMaskLayer = extractAlignedCropMask(mask, width, height, tw, th, ox, oy);
    const fill = maskFillRatio(cropMaskLayer, tw, th);
    if (fill < 0.004) continue;
    const [r, g, b] = rgb;
    let label = useBinary ? (r + g + b < threshold * 2 ? "Black" : "White") : colourLayerLabel(r, g, b);
    const n = (usedLabels.get(label) || 0) + 1;
    usedLabels.set(label, n);
    if (!useBinary && n > 1) label = `${label} ${n}`;
    colorLayers.push({
      rgb: [r, g, b],
      hex: rgbToHex(r, g, b),
      label,
      mask: cropMaskLayer,
      rects: maskToRuns(cropMaskLayer, tw, th),
      maskFillPct: Math.round(fill * 100),
      shapeGroups: [],
    });
  }

  const trimmedLayers = colorLayers.filter((layer) => maskFillRatio(layer.mask, tw, th) >= 0.004);
  const previewMask = multiColourPreviewMask(trimmedLayers, tw, th)
    || extractAlignedCropMask(combined, width, height, tw, th, ox, oy);
  const normalized = normalizeMultiColourToSource(
    trimmedLayers,
    previewMask,
    tw,
    th,
    ox,
    oy,
    traceScale,
  );

  if (normalized.layers.length < 2) {
    return {
      rects: [],
      width: normalized.width,
      height: normalized.height,
      cropOx: normalized.cropOx,
      cropOy: normalized.cropOy,
      svg: "",
      rectCount: 0,
      simplified: false,
      simplifyFactor: 1,
      tooComplex: false,
      mode: "multi-colour",
      multiColour: true,
      colorLayers: [],
      needsFallback: true,
      silhouetteMask: normalized.mask,
      mask: normalized.mask,
      tracePx: `${sourceW}×${sourceH}`,
    };
  }

  return {
    rects: [],
    mask: normalized.mask,
    silhouetteMask: normalized.mask,
    polygons: [],
    shapeGroups: [],
    strokePaths: [],
    width: normalized.width,
    height: normalized.height,
    cropOx: normalized.cropOx,
    cropOy: normalized.cropOy,
    svg: "",
    rectCount: 0,
    polygonCount: normalized.layers.length,
    islandCount: normalized.layers.length,
    simplified: false,
    simplifyFactor: 1,
    tooComplex: normalized.layers.length > MULTI_COLOUR_MAX_LAYERS,
    mode: forceBinary ? "black-white" : "multi-colour",
    multiColour: true,
    colorLayers: normalized.layers,
    colorLayerCount: normalized.layers.length,
    rawColourBucketCount: rawBucketCount,
    colourPaletteMerged: useBinary || rawBucketCount > trimmedLayers.length,
    binaryBlackWhite: useBinary,
    tracePx: `${sourceW}×${sourceH}`,
    traceWorkPx: `${width}×${height}`,
  };
}

/** Single-pass colour-logo trace — for SVG raster import (skip slow auto triple-trace). */
export async function traceSvgLogoCanvasAsync(canvas, options = {}) {
  return traceColorLogoCanvasAsync(canvas, options);
}

async function traceColorLogoCanvasAsync(canvas, options = {}) {
  await traceYield();
  const threshold = clamp(options.threshold ?? 128, 1, 254);
  const invert = !!options.invert;
  const ctx = canvas.getContext("2d");
  const { width, height } = canvas;
  const { data } = ctx.getImageData(0, 0, width, height);
  const mask = colorLogoMask(data, width, height, threshold, invert);
  const cropped = cropMask(mask, width, height);
  if (!cropped) {
    return { rects: [], width: 0, height: 0, svg: "", rectCount: 0, simplified: false, simplifyFactor: 1, tooComplex: false };
  }
  const { mask: workMask, width: tw, height: th, ox, oy } = cropped;
  const quality = traceQualityParams(tw, { ...options, smoothPasses: 4 });
  const result = finishSilhouetteTrace(workMask, tw, th, ox, oy, [], 1, width, height, {
    mode: "silhouette",
    colorLogo: true,
    solidSilhouetteFill: true,
    simplifyTol: Math.max(0.12, quality.simplifyTol),
    smoothPasses: 3,
  });
  result.tracePx = `${width}×${height}`;
  return result;
}

function traceAutoScore(result) {
  if (!result || result.tooComplex) return -1e9;
  const fill = (result.maskFillPct ?? 0) / 100;
  const islands = result.islandCount ?? result.polygonCount ?? 0;
  let score = 0;
  if (fill < 0.006 || fill > 0.72) score -= 220;
  if (fill >= 0.02 && fill <= 0.46) score += 80;
  if (fill >= 0.05 && fill <= 0.38) score += 45;
  if (result.mode === "silhouette" && !result.colorLogo) {
    score += 30;
    score -= Math.max(0, (result.polygonCount ?? 0) - 24) * 0.8;
    if ((result.polygonCount ?? 0) <= 12) score += 20;
  }
  if (result.colorLogo) {
    score += 120;
    if (fill >= 0.08 && fill <= 0.55) score += 70;
    else if (fill >= 0.02 && fill <= 0.62) score += 45;
    if (islands >= 2 && islands <= 32) score += 40;
    if ((result.polygonCount ?? 0) <= 28) score += 18;
    score -= Math.max(0, (result.polygonCount ?? 0) - 36) * 0.35;
  }
  if (result.mode === "outline") {
    score += 20;
    if (result.outlineRaster) {
      score += 40;
      const fill = (result.maskFillPct ?? 0) / 100;
      if (fill >= 0.06 && fill <= 0.42) score += 70;
      if ((result.rectCount ?? 0) > 60) score += 35;
    }
    if (result.rasterSimplified) score += 8;
    const runs = result.rectCount ?? 0;
    if (runs > 12000) score -= (runs - 12000) / 120;
    if (runs > 24000) score -= 120;
    if ((result.strokePaths?.length ?? 0) && result.outlineFallback === false) score += 18;
  }
  if (result.colorLayers >= 2) score += 20;
  return score;
}

function traceLooksLikeLineArt(result) {
  if (!result || result.tooComplex) return false;
  const fill = (result.maskFillPct ?? 0) / 100;
  if (result.outlineRaster && (result.rectCount ?? 0) > 40 && fill >= 0.04 && fill <= 0.45) return true;
  if (result.mode === "outline" && (result.strokePaths?.length ?? 0) > 6 && fill <= 0.4) return true;
  return false;
}

function wrapOutlineTraceUsable(result) {
  if (!result?.outlineRaster || result.tooComplex) return false;
  if (traceLooksLikeLineArt(result)) return true;
  const fill = (result.maskFillPct ?? 0) / 100;
  const runs = result.rectCount ?? 0;
  // Megapixel outline fast-path bins the whole crop (lum<threshold) — not line art.
  return runs > 40 && fill >= 0.04 && fill <= 0.45;
}

function wrapSilhouetteTraceUsable(result) {
  if (!result || result.tooComplex) return false;
  const fill = (result.maskFillPct ?? 0) / 100;
  return fill >= 0.04 && fill <= 0.50;
}

function chooseAutoTraceResult(outlineResult, silhouetteResult, colorLogoResult = null, options = {}) {
  if (options.preferWrapLineArt) {
    if (wrapOutlineTraceUsable(outlineResult)) {
      return {
        ...outlineResult,
        autoTrace: true,
        autoPickedMode: "outline",
        autoScores: {
          outline: Math.round(traceAutoScore(outlineResult)),
          silhouette: Math.round(traceAutoScore(silhouetteResult)),
          colorLogo: colorLogoResult ? Math.round(traceAutoScore(colorLogoResult)) : -1e9,
        },
      };
    }
    if (wrapSilhouetteTraceUsable(silhouetteResult)) {
      return {
        ...silhouetteResult,
        autoTrace: true,
        autoPickedMode: "silhouette",
        autoScores: {
          outline: Math.round(traceAutoScore(outlineResult)),
          silhouette: Math.round(traceAutoScore(silhouetteResult)),
          colorLogo: colorLogoResult ? Math.round(traceAutoScore(colorLogoResult)) : -1e9,
        },
      };
    }
  }
  if (options.preferWrapLineArt && traceLooksLikeLineArt(outlineResult)) {
    return {
      ...outlineResult,
      autoTrace: true,
      autoPickedMode: "outline",
      autoScores: {
        outline: Math.round(traceAutoScore(outlineResult)),
        silhouette: Math.round(traceAutoScore(silhouetteResult)),
        colorLogo: colorLogoResult ? Math.round(traceAutoScore(colorLogoResult)) : -1e9,
      },
    };
  }
  if (traceLooksLikeLineArt(outlineResult)) {
    return {
      ...outlineResult,
      autoTrace: true,
      autoPickedMode: "outline",
      autoScores: {
        outline: Math.round(traceAutoScore(outlineResult)),
        silhouette: Math.round(traceAutoScore(silhouetteResult)),
        colorLogo: colorLogoResult ? Math.round(traceAutoScore(colorLogoResult)) : -1e9,
      },
    };
  }
  const outlineScore = traceAutoScore(outlineResult);
  const silhouetteScore = traceAutoScore(silhouetteResult);
  const colorLogoScore = colorLogoResult ? traceAutoScore(colorLogoResult) : -1e9;
  let picked = outlineScore >= silhouetteScore ? outlineResult : silhouetteResult;
  const bestScore = Math.max(outlineScore, silhouetteScore);
  if (colorLogoResult && !traceLooksLikeLineArt(outlineResult)) {
    const colorFill = (colorLogoResult.maskFillPct ?? 0) / 100;
    const colorIslands = colorLogoResult.islandCount ?? colorLogoResult.polygonCount ?? 0;
    const silIslands = silhouetteResult?.islandCount ?? silhouetteResult?.polygonCount ?? 0;
    const silFill = (silhouetteResult?.maskFillPct ?? 0) / 100;
    const competitive = colorLogoScore >= bestScore - 25;
    const meaningfulFill = colorFill >= 0.08;
    const moreDetail = colorIslands > silIslands
      || colorFill > silFill * 1.12
      || (colorIslands >= 2 && silIslands <= 1);
    const wrapBlocksColourLogo = options.preferWrapLineArt
      && outlineResult?.outlineRaster
      && (outlineResult.rectCount ?? 0) > 20;
    if (
      !wrapBlocksColourLogo
      && (
        colorLogoScore >= bestScore
        || (meaningfulFill && competitive && moreDetail)
        || (colorFill >= 0.1 && competitive)
      )
    ) {
      picked = colorLogoResult;
    }
  }
  return {
    ...picked,
    autoTrace: true,
    autoPickedMode: picked?.colorLogo ? "color-logo" : (picked?.mode || "silhouette"),
    autoScores: {
      outline: Math.round(outlineScore),
      silhouette: Math.round(silhouetteScore),
      colorLogo: Math.round(colorLogoScore),
    },
  };
}

function downsampleUntilComplexity(workMask, tw, th, shapeGroups, simplifyFactor, simplifyTol, smoothPasses) {
  let mask = workMask;
  let w = tw;
  let h = th;
  let factor = simplifyFactor;
  let groups = shapeGroups;
  let tol = simplifyTol;
  let passes = smoothPasses;
  while (groups.length > MAX_TRACE_POLYGONS && factor < 8) {
    const ds = downsampleMask(mask, w, h);
    mask = ds.mask;
    w = ds.width;
    h = ds.height;
    factor *= 2;
    tol *= 1.08;
    passes = Math.max(3, passes - 1);
    const polygons = maskToPolygons(mask, w, h);
    groups = prepareShapeGroups(groupPolygonsWithHoles(polygons), tol, passes);
  }
  return { mask, w, h, factor, groups, tol, passes };
}

function downsampleMaskToTracePoly(mask, width, height) {
  let m = mask;
  let w = width;
  let h = height;
  let factor = 1;
  while (w * h > TRACE_FAST_PIXELS || Math.max(w, h) > TRACE_POLYGON_MAX_DIM) {
    const ds = downsampleMask(m, w, h);
    m = ds.mask;
    w = ds.width;
    h = ds.height;
    factor *= 2;
    if (factor > 32) break;
  }
  return { mask: m, width: w, height: h, factor };
}

function scaleShapeGroupsUp(groups, factor) {
  if (factor <= 1) return groups;
  return groups.map((g) => ({
    outer: g.outer.map(([x, y]) => [x * factor, y * factor]),
    holes: g.holes.map((h) => h.map(([x, y]) => [x * factor, y * factor])),
  }));
}

/** Polygonise at reduced resolution then scale back — keeps trace responsive on heraldic PNGs. */
async function polygonizeMaskGroups(workMask, tw, th, simplifyTol, smoothPasses) {
  await traceYield();
  const scaled = downsampleMaskToTracePoly(workMask, tw, th);
  await traceYield();
  const polys = maskToPolygons(scaled.mask, scaled.width, scaled.height);
  const passes = scaled.factor > 2 ? 1 : Math.min(2, smoothPasses);
  const tol = simplifyTol * Math.max(1, scaled.factor * 0.45);
  let groups = await prepareShapeGroupsAsync(groupPolygonsWithHoles(polys), tol, passes);
  if (scaled.factor > 1) groups = scaleShapeGroupsUp(groups, scaled.factor);
  return { groups, factor: scaled.factor };
}



function blurAlphaMask(data, width, height) {
  if (width * height > BLUR_SKIP_PIXELS) return null;
  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0;
      let count = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const i = (ny * width + nx) * 4;
          sum += data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
          count++;
        }
      }
      out[y * width + x] = sum / count;
    }
  }
  return out;
}



function binarizeImageData(data, width, height, threshold, invert, mode = "silhouette", blur = null) {

  const mask = new Uint8Array(width * height);

  for (let y = 0; y < height; y++) {

    for (let x = 0; x < width; x++) {

      const i = (y * width + x) * 4;

      const a = data[i + 3];

      const lum = blur ? blur[y * width + x] : data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;

      let on;

      if (mode === "silhouette") {

        const bgCutoff = clamp(252 - threshold * 0.55, 170, 252);

        on = a > 16 && lum < bgCutoff;

      } else {

        const inkCutoff = clamp(threshold, 40, 220);

        on = a > 16 && lum < inkCutoff;

      }

      if (invert) on = !on;

      mask[y * width + x] = on ? 1 : 0;

    }

  }

  return mask;

}



function openMask(mask, width, height) {
  const eroded = erodeMask(mask, width, height);
  return dilateMask(eroded, width, height);
}

function closeMask(mask, width, height, radius = 1) {
  let m = mask;
  for (let i = 0; i < radius; i++) m = dilateMask(m, width, height);
  for (let i = 0; i < radius; i++) m = erodeMask(m, width, height);
  return m;
}



function dilateMask(mask, width, height) {

  const out = new Uint8Array(width * height);

  for (let y = 0; y < height; y++) {

    for (let x = 0; x < width; x++) {

      let on = 0;

      for (let dy = -1; dy <= 1 && !on; dy++) {

        for (let dx = -1; dx <= 1 && !on; dx++) {

          const nx = x + dx;

          const ny = y + dy;

          if (nx >= 0 && ny >= 0 && nx < width && ny < height && mask[ny * width + nx]) on = 1;

        }

      }

      out[y * width + x] = on;

    }

  }

  return out;

}

/** Vertical-only dilate — connects arched crest text to shield without widening horizontally. */
function dilateMaskVertical(mask, width, height, radius = 1) {
  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let on = 0;
      for (let dy = -radius; dy <= radius && !on; dy++) {
        const ny = y + dy;
        if (ny >= 0 && ny < height && mask[ny * width + x]) on = 1;
      }
      out[y * width + x] = on;
    }
  }
  return out;
}



function scaleCanvasToMaxPx(source, maxPx) {
  const w = source.width;
  const h = source.height;
  if (w <= 0 || h <= 0) return source;
  const scale = maxPx / Math.max(w, h);
  const tw = Math.max(1, Math.round(w * scale));
  const th = Math.max(1, Math.round(h * scale));
  const canvas = document.createElement("canvas");
  canvas.width = tw;
  canvas.height = th;
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, 0, 0, tw, th);
  return canvas;
}

function upscaleCanvasMinMaxPx(source, minMaxPx) {
  const w = source.width;
  const h = source.height;
  if (w <= 0 || h <= 0) return source;
  const longest = Math.max(w, h);
  if (longest >= minMaxPx || longest * 2 > MAX_TRACE_PX) return source;
  const scale = Math.min(2, minMaxPx / longest);
  const tw = Math.max(1, Math.round(w * scale));
  const th = Math.max(1, Math.round(h * scale));
  const canvas = document.createElement("canvas");
  canvas.width = tw;
  canvas.height = th;
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, 0, 0, tw, th);
  return canvas;
}

/** Direct silhouette from pre-flattened SVG canvas — skip threshold re-binarize. */
export async function traceFlattenedSvgCanvasAsync(canvas, options = {}) {
  await traceYield();
  const ctx = canvas.getContext("2d");
  const { width, height } = canvas;
  const { data } = ctx.getImageData(0, 0, width, height);
  let mask = new Uint8Array(width * height);
  for (let i = 0; i < data.length; i += 4) {
    mask[i / 4] = data[i] < 140 ? 1 : 0;
  }
  const span = Math.max(width, height);
  const closeR = clamp(Math.round(span / 110), 3, 9);
  mask = closeMask(mask, width, height, closeR);
  const vertPasses = clamp(Math.round(span / 200), 2, 5);
  for (let i = 0; i < vertPasses; i++) mask = dilateMaskVertical(mask, width, height, 2);
  mask = fillInteriorEnclosedByOutline(mask, width, height);
  mask = fillRowExtents(mask, width, height);
  mask = closeMask(mask, width, height, 2);

  const cropped = cropMask(mask, width, height);
  if (!cropped) {
    return { rects: [], width: 0, height: 0, svg: "", rectCount: 0, simplified: false, simplifyFactor: 1, tooComplex: false };
  }
  const { mask: workMask, width: tw, height: th, ox, oy } = cropped;
  return finishSilhouetteTrace(workMask, tw, th, ox, oy, [], 1, width, height, {
    mode: "silhouette",
    solidSilhouetteFill: true,
    simplifyTol: Math.max(0.06, tw / 3200),
    smoothPasses: 1,
  });
}

/** Collapse any non-white SVG ink (dark + light layers) to a black silhouette on white. */
export function flattenCanvasToInkSilhouette(canvas) {
  const ctx = canvas.getContext("2d");
  const { width, height } = canvas;
  const { data } = ctx.getImageData(0, 0, width, height);
  const out = ctx.createImageData(width, height);
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3];
    const dr = 255 - data[i];
    const dg = 255 - data[i + 1];
    const db = 255 - data[i + 2];
    const ink = a > 16 && dr + dg + db > 36;
    const v = ink ? 0 : 255;
    out.data[i] = v;
    out.data[i + 1] = v;
    out.data[i + 2] = v;
    out.data[i + 3] = 255;
  }
  ctx.putImageData(out, 0, 0);
  return canvas;
}

/** Ensure SVG has explicit dimensions, then rasterize for reliable tracing. */
export function rasterizeSvgToCanvas(svgText, maxPx = SVG_RASTER_PX) {
  return new Promise((resolve, reject) => {
    if (!svgText?.trim()) {
      reject(new Error("Empty SVG"));
      return;
    }
    let serialized = svgText;
    if (typeof DOMParser !== "undefined") {
      const doc = new DOMParser().parseFromString(svgText, "image/svg+xml");
      const svg = doc.documentElement;
      if (svg && svg.nodeName.toLowerCase() !== "parsererror") {
        const vb = svg.getAttribute("viewBox")?.trim().split(/[\s,]+/).map(Number);
        if (!svg.getAttribute("width") && vb?.length === 4) {
          svg.setAttribute("width", String(vb[2]));
          svg.setAttribute("height", String(vb[3]));
        }
        serialized = new XMLSerializer().serializeToString(svg);
      }
    }
    const blob = new Blob([serialized], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      const iw = img.naturalWidth || img.width || maxPx;
      const ih = img.naturalHeight || img.height || maxPx;
      const targetScale = maxPx / Math.max(iw, ih);
      const ss = 2;
      const hiW = Math.max(1, Math.round(iw * targetScale * ss));
      const hiH = Math.max(1, Math.round(ih * targetScale * ss));
      const hiCanvas = document.createElement("canvas");
      hiCanvas.width = hiW;
      hiCanvas.height = hiH;
      const hiCtx = hiCanvas.getContext("2d");
      hiCtx.fillStyle = "#ffffff";
      hiCtx.fillRect(0, 0, hiW, hiH);
      hiCtx.imageSmoothingEnabled = true;
      hiCtx.imageSmoothingQuality = "high";
      hiCtx.drawImage(img, 0, 0, hiW, hiH);
      URL.revokeObjectURL(url);
      resolve(scaleCanvasToMaxPx(hiCanvas, maxPx));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not rasterize SVG"));
    };
    img.src = url;
  });
}

/** SVG imports always use silhouette — outline on edge-detected art creates ring garbage. */
export function detectSvgTraceMode() {
  return "silhouette";
}



/** Load a data URL (e.g. saved session JPEG) into a trace canvas. */

export function loadImageFromDataUrl(dataUrl) {
  return new Promise((resolve, reject) => {
    if (!dataUrl) {
      reject(new Error("No image data"));
      return;
    }
    const img = new Image();
    img.onload = () => {
      const scaled = scaleCanvasToMaxPx(img, MAX_TRACE_PX);
      resolve({
        canvas: scaled,
        width: scaled.width,
        height: scaled.height,
        previewUrl: scaled.toDataURL("image/png"),
      });
    };
    img.onerror = () => reject(new Error("Could not load saved image"));
    img.src = dataUrl;
  });
}

/** Load PNG / JPG / WEBP into a canvas. */

export function loadImageFromFile(file) {

  return new Promise((resolve, reject) => {

    if (!file || !/^image\/(png|jpe?g|webp|gif)$/i.test(file.type)) {

      reject(new Error("Use PNG, JPG, or WEBP"));

      return;

    }

    const url = URL.createObjectURL(file);

    const img = new Image();

    img.onload = () => {

      const scaled = scaleCanvasToMaxPx(img, MAX_TRACE_PX);

      URL.revokeObjectURL(url);

      resolve({

        canvas: scaled,

        width: scaled.width,

        height: scaled.height,

        previewUrl: scaled.toDataURL("image/png"),

      });

    };

    img.onerror = () => {

      URL.revokeObjectURL(url);

      reject(new Error("Could not load image"));

    };

    img.src = url;

  });

}



/**

 * Trace a prepared canvas to merged rects + SVG.

 * @param {HTMLCanvasElement} canvas

 * @param {{ threshold?: number, invert?: boolean, mode?: 'silhouette'|'outline' }} options

 */

export async function traceCanvasAsync(canvas, options = {}) {

  await traceYield();

  const threshold = clamp(options.threshold ?? 128, 1, 254);

  const invert = !!options.invert;

  if (options.mode === "auto") {
    const colorLogoResult = await traceColorLogoCanvasAsync(canvas, options);
    await traceYield();
    const outlineResult = await traceCanvasAsync(canvas, {
      ...options,
      mode: "outline",
      colorSeparation: false,
    });
    await traceYield();
    const silhouetteResult = await traceCanvasAsync(canvas, {
      ...options,
      mode: "silhouette",
      strengthen: true,
    });
    return chooseAutoTraceResult(outlineResult, silhouetteResult, colorLogoResult, {
      preferWrapLineArt: !!options.preferWrapLineArt,
    });
  }

  if (options.mode === "black-white") {
    return traceMultiColourCanvasAsync(canvas, { ...options, mode: "black-white" });
  }

  if (options.mode === "multi-colour" && !options._multiColourFallback) {
    const mc = await traceMultiColourCanvasAsync(canvas, options);
    if (mc.colorLayers?.length >= 2 && !mc.tooComplex && !mc.needsFallback) return mc;
    await traceYield();
    const fallback = await traceCanvasAsync(canvas, {
      ...options,
      mode: "silhouette",
      strengthen: true,
      _multiColourFallback: true,
    });
    if (fallback?.silhouetteMask?.length || fallback?.mask?.length) return fallback;
    if (mc.silhouetteMask?.length) {
      return {
        ...fallback,
        width: mc.width || fallback.width,
        height: mc.height || fallback.height,
        cropOx: mc.cropOx ?? fallback.cropOx,
        cropOy: mc.cropOy ?? fallback.cropOy,
        silhouetteMask: mc.silhouetteMask,
        mask: mc.mask || mc.silhouetteMask,
        mode: "silhouette",
        multiColour: false,
        multiColourFallback: true,
      };
    }
    return fallback;
  }

  const mode = options.mode === "outline" ? "outline" : "silhouette";



  const ctx = canvas.getContext("2d");

  const { width, height } = canvas;

  const { data } = ctx.getImageData(0, 0, width, height);

  const blur = blurAlphaMask(data, width, height);

  await traceYield();

  let ink = binarizeImageData(data, width, height, threshold, invert, mode === "outline" ? "outline" : "silhouette", blur);
  let mask = mode === "outline" ? ink : openMask(ink, width, height);
  if (mode === "silhouette") {
    if (options.strengthen) {
      mask = closeMask(mask, width, height);
    }
    if (options.printableWidth !== false) {
      const minFeaturePx = Math.max(4, Math.round(height / 200));
      mask = ensurePrintableWidth(mask, width, height, minFeaturePx);
    }
  }



  const cropped = cropMask(mask, width, height);

  if (!cropped) {

    return { rects: [], width: 0, height: 0, svg: "", rectCount: 0, simplified: false, simplifyFactor: 1 };

  }



  let { mask: workMask, width: tw, height: th, ox, oy } = cropped;

  let simplifyFactor = 1;

  let rects = maskToRuns(workMask, tw, th);

  const quality = traceQualityParams(tw, options);

  await traceYield();

  // Outline mode should produce stroke paths — colour layers run only on silhouette / fallback.
  if (options.colorSeparation !== false && mode !== "outline") {
    const colorTrace = await traceColorLayerGroupsAsync(data, width, height, tw, th, ox, oy, threshold, invert, blur, options, quality);
    if (colorTrace) {
      let shapeGroups = colorTrace.shapeGroups;
      let combined = colorTrace.combined;
      let sf = simplifyFactor;
      if (shapeGroups.length > MAX_TRACE_POLYGONS) {
        const ds = downsampleUntilComplexity(combined, tw, th, shapeGroups, sf, quality.simplifyTol, quality.smoothPasses);
        combined = ds.mask;
        tw = ds.w;
        th = ds.h;
        sf = ds.factor;
        shapeGroups = ds.groups;
      }
      return finishSilhouetteTrace(combined, tw, th, ox, oy, shapeGroups, sf, width, height, {
        colorLayers: colorTrace.colorLayerCount,
        simplifyTol: quality.simplifyTol,
        smoothPasses: quality.smoothPasses,
      });
    }
  }

  if (mode === "outline") {
    const simplifyTol = quality.simplifyTol;
    const smoothPasses = quality.smoothPasses;

    // Skeleton on multi-megapixel masks runs thousands of erode passes — skip straight to silhouette.
    if (tw * th > TRACE_FAST_PIXELS) {
      return finishRasterInkTrace(workMask, tw, th, ox, oy, simplifyFactor, width, height, {
        outlineFallback: true,
      });
    }

    let rawPaths = outlineCenterlinePaths(workMask, tw, th);
    let strokePaths = prepareStrokePaths(rawPaths, simplifyTol, smoothPasses);

    // Edge-detected / double-line art produces dozens of ring centerlines — use silhouette instead.
    const outlineFallback = shouldFallbackOutline(rawPaths, strokePaths, tw);
    if (outlineFallback) {
      return finishRasterInkTrace(workMask, tw, th, ox, oy, simplifyFactor, width, height, {
        outlineFallback: true,
        simplifyTol: quality.simplifyTol,
        smoothPasses: quality.smoothPasses,
      });
    }

    while (strokePaths.length > MAX_TRACE_POLYGONS && simplifyFactor < 16) {
      const ds = downsampleMask(workMask, tw, th);
      workMask = ds.mask;
      tw = ds.width;
      th = ds.height;
      simplifyFactor *= 2;
      rects = maskToRuns(workMask, tw, th);
      rawPaths = outlineCenterlinePaths(workMask, tw, th);
      strokePaths = prepareStrokePaths(rawPaths, simplifyTol * 1.1, Math.max(3, smoothPasses - 1));
    }

    const strokeWidth = Math.max(2.2, tw / 72);
    const svg = strokePathsToSvg(strokePaths, tw, th, strokeWidth);

    return {
      rects,
      mask: compactTraceMask(workMask, []),
      polygons: [],
      shapeGroups: [],
      strokePaths,
      strokeWidth,
      width: tw,
      height: th,
      cropOx: ox,
      cropOy: oy,
      svg,
      rectCount: rects.length,
      polygonCount: strokePaths.length,
      simplified: simplifyFactor > 1,
      simplifyFactor,
      tooComplex: strokePaths.length > MAX_TRACE_POLYGONS,
      mode: "outline",
      outlineFallback: false,
    };
  }

  await traceYield();
  let { groups: shapeGroups, factor: polyFactor } = await polygonizeMaskGroups(
    workMask, tw, th, quality.simplifyTol, quality.smoothPasses,
  );

  const ds = downsampleUntilComplexity(workMask, tw, th, shapeGroups, simplifyFactor * polyFactor, quality.simplifyTol, quality.smoothPasses);
  workMask = ds.mask;
  tw = ds.w;
  th = ds.h;
  simplifyFactor = ds.factor;
  shapeGroups = ds.groups;

  return finishSilhouetteTrace(workMask, tw, th, ox, oy, shapeGroups, simplifyFactor, width, height, {
    mode,
    simplifyTol: quality.simplifyTol,
    smoothPasses: quality.smoothPasses,
  });

}

/** @deprecated Use traceCanvasAsync — kept as alias for imports. */
export const traceCanvas = traceCanvasAsync;

function resolveTracePreviewMask(traceResult) {
  const tw = traceResult.width || 1;
  const th = traceResult.height || 1;
  const need = tw * th;
  if (traceResult.silhouetteMask?.length === need) return traceResult.silhouetteMask;
  if (traceResult.mask?.length === need) return traceResult.mask;
  return null;
}

function drawTraceInkMaskOverlay(ctx, pad, ox, oy, mask, tw, th, factor, rgba = [56, 189, 248, 140]) {
  const MAX_PREVIEW_PX = 512 * 512;
  let drawMask = mask;
  let drawW = tw;
  let drawH = th;
  let drawFactor = factor;
  if (tw * th > MAX_PREVIEW_PX) {
    let m = mask;
    let w = tw;
    let h = th;
    while (w * h > MAX_PREVIEW_PX) {
      const ds = downsampleMask(m, w, h);
      m = ds.mask;
      w = ds.width;
      h = ds.height;
    }
    drawMask = m;
    drawW = w;
    drawH = h;
    drawFactor = factor * (tw / drawW);
  }
  const preview = document.createElement("canvas");
  preview.width = drawW;
  preview.height = drawH;
  const pctx = preview.getContext("2d");
  if (!pctx) return false;
  const img = pctx.createImageData(drawW, drawH);
  for (let i = 0; i < drawW * drawH; i++) {
    const on = drawMask[i];
    const j = i * 4;
    img.data[j] = rgba[0];
    img.data[j + 1] = rgba[1];
    img.data[j + 2] = rgba[2];
    img.data[j + 3] = on ? rgba[3] : 0;
  }
  pctx.putImageData(img, 0, 0);
  ctx.drawImage(preview, pad + ox, pad + oy, drawW * drawFactor, drawH * drawFactor);
  return true;
}

function hexToRgba(hex, alpha = 180) {
  const h = (hex || "#000000").replace("#", "");
  if (h.length < 6) return [56, 189, 248, alpha];
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return [r, g, b, alpha];
}

function drawTraceInkRunOverlay(ctx, pad, ox, oy, rects, factor) {
  if (!rects?.length) return false;
  ctx.fillStyle = "rgba(56, 189, 248, 0.55)";
  for (const r of rects) {
    const w = Math.max(factor, r.w * factor);
    const h = Math.max(factor, r.h * factor);
    ctx.fillRect(pad + ox + r.x * factor, pad + oy + r.y * factor, w, h);
  }
  return true;
}

/** Render trace preview onto a canvas (source image + cyan ink overlay).
 * GOLDEN (b284): raster ink mask BEFORE stroke paths — see GOLDEN_BASELINE.md */
export function drawTracePreview(previewCanvas, sourceCanvas, traceResult) {

  const ctx = previewCanvas.getContext("2d");

  const pad = 8;

  const sw = sourceCanvas.width;

  const sh = sourceCanvas.height;

  previewCanvas.width = sw + pad * 2;

  previewCanvas.height = sh + pad * 2;



  ctx.fillStyle = "#0f172a";

  ctx.fillRect(0, 0, previewCanvas.width, previewCanvas.height);

  ctx.globalAlpha = 0.28;
  ctx.drawImage(sourceCanvas, pad, pad);
  ctx.globalAlpha = 1;



  const factor = traceResult.simplifyFactor || 1;
  const ox = traceResult.cropOx ?? 0;
  const oy = traceResult.cropOy ?? 0;
  const tw = traceResult.width || 1;
  const th = traceResult.height || 1;

  if (traceResult.multiColour && traceResult.colorLayers?.length) {
    const combined = multiColourPreviewMask(traceResult.colorLayers, tw, th);
    if (combined) {
      ctx.fillStyle = "rgba(56, 189, 248, 0.55)";
      drawTraceInkMaskOverlay(ctx, pad, ox, oy, combined, tw, th, factor);
      return;
    }
  }

  // Raster ink mask — line art (outlineRaster) + silhouettes: full cyan fill on every ink pixel.
  const inkMask = resolveTracePreviewMask(traceResult);
  if (inkMask) {
    ctx.fillStyle = "rgba(56, 189, 248, 0.55)";
    if (drawTraceInkMaskOverlay(ctx, pad, ox, oy, inkMask, tw, th, factor)) return;
  }
  if (traceResult.outlineRaster && traceResult.rects?.length) {
    if (drawTraceInkRunOverlay(ctx, pad, ox, oy, traceResult.rects, factor)) return;
  }

  if (traceResult.mode === "outline" && traceResult.strokePaths?.length && !traceResult.outlineRaster) {
    ctx.strokeStyle = "rgba(56, 189, 248, 0.95)";
    ctx.lineWidth = Math.max(1.5, (traceResult.width || 100) / 70);
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    for (const path of traceResult.strokePaths) {
      ctx.beginPath();
      for (let i = 0; i < path.length; i++) {
        const px = pad + ox + path[i][0] * factor;
        const py = pad + oy + path[i][1] * factor;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      if (strokePathIsClosed(path, Math.max(1.5, (traceResult.width || 100) / 400))) ctx.closePath();
      ctx.stroke();
    }
    return;
  }

  ctx.fillStyle = "rgba(56, 189, 248, 0.55)";

  const groups = traceResult.shapeGroups?.length ? traceResult.shapeGroups : null;

  if (groups?.length > 48) {
    const mask = rasterizeShapeGroupsToMask(groups, tw, th);
    if (drawTraceInkMaskOverlay(ctx, pad, ox, oy, mask, tw, th, factor)) return;
  }

  if (groups?.length) {

    for (const group of groups) {

      ctx.beginPath();

      for (let i = 0; i < group.outer.length; i++) {

        const px = pad + ox + group.outer[i][0] * factor;

        const py = pad + oy + group.outer[i][1] * factor;

        if (i === 0) ctx.moveTo(px, py);

        else ctx.lineTo(px, py);

      }

      for (const hole of group.holes) {

        for (let i = 0; i < hole.length; i++) {

          const px = pad + ox + hole[i][0] * factor;

          const py = pad + oy + hole[i][1] * factor;

          if (i === 0) ctx.moveTo(px, py);

          else ctx.lineTo(px, py);

        }

      }

      ctx.closePath();

      ctx.fill("evenodd");

    }

    return;

  }

  if (traceResult.polygons?.length) {

    for (const poly of traceResult.polygons) {

      ctx.beginPath();

      for (let i = 0; i < poly.length; i++) {

        const px = pad + ox + poly[i][0] * factor;

        const py = pad + oy + poly[i][1] * factor;

        if (i === 0) ctx.moveTo(px, py);

        else ctx.lineTo(px, py);

      }

      ctx.closePath();

      ctx.fill();

    }

    return;

  }

  if (!traceResult?.rects?.length) return;

  for (const r of traceResult.rects) {

    ctx.fillRect(pad + ox + r.x * factor, pad + oy + r.y * factor, r.w * factor, r.h * factor);

  }

}


