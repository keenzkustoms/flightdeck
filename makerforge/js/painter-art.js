/**
 * STL Painter — artwork stamp.
 * Rasterize SVG/PNG, then build MakerDeck-style raised slabs on a click plane.
 */

export const ART_ALPHA_MIN = 160;
export const ART_MATCH_DIST2 = 40 * 40;
export const ART_MAX_RASTER = 768;
export const ART_COVERAGE_MIN = 0.5;
export const ART_PAPER_LUMA = 228;
/** Sit the logo on the hoodie, not through it. */
export const STAMP_SKIN_MM = 0.04;
/** Kept for older stamps; new logos sit on the surface as their own 3MF part. */
export const STAMP_EMBED_MM = 0;
export const STAMP_THICK_MM = 0.72;
/** Stack later colours (ink) further out so they don't occupy the same volume as the plate. */
export const STAMP_LAYER_MM = 0.22;

function hypot3(x, y, z) {
  return Math.hypot(x, y, z) || 1;
}

function normalize(v) {
  const L = hypot3(v[0], v[1], v[2]);
  return [v[0] / L, v[1] / L, v[2] / L];
}

function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

export function parseHexColor(hex) {
  const h = String(hex || "").trim();
  const m = h.match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) return null;
  let s = m[1];
  if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
  const n = parseInt(s, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex(r, g, b) {
  const byte = (v) => Math.max(0, Math.min(255, v | 0)).toString(16).padStart(2, "0");
  return `#${byte(r)}${byte(g)}${byte(b)}`;
}

function parseCssColor(raw) {
  const t = String(raw || "").trim().toLowerCase();
  if (!t || t === "none" || t === "transparent") return null;
  const hex = parseHexColor(t);
  if (hex) return hex;
  const rgb = t.match(/^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/);
  if (rgb) return [+rgb[1], +rgb[2], +rgb[3]];
  return null;
}

export function colorDist2(a, b) {
  const dr = a[0] - b[0], dg = a[1] - b[1], db = a[2] - b[2];
  return dr * dr + dg * dg + db * db;
}

export function nearestSlot(rgb, slotRgbs) {
  let best = 0, bestD = Infinity;
  for (let i = 0; i < slotRgbs.length; i++) {
    const d = colorDist2(rgb, slotRgbs[i]);
    if (d < bestD) { bestD = d; best = i; }
  }
  return { slot: best, dist2: bestD };
}

export function isSvgArtFile(file) {
  const name = String(file?.name || "").toLowerCase();
  const type = String(file?.type || "").toLowerCase();
  return name.endsWith(".svg") || type === "image/svg+xml";
}

export function isRasterArtFile(file) {
  const name = String(file?.name || "").toLowerCase();
  const type = String(file?.type || "").toLowerCase();
  return /\.(png|jpe?g|webp|gif)$/i.test(name) || /^image\/(png|jpeg|webp|gif)$/.test(type);
}

export function clonePixelData(imageData) {
  return {
    data: new Uint8ClampedArray(imageData.data),
    width: imageData.width,
    height: imageData.height,
  };
}

export function rasterHasAlpha(data, { alphaCut = 250 } = {}) {
  if (!data?.length) return false;
  let transparent = 0;
  const n = data.length / 4;
  for (let i = 3; i < data.length; i += 4) if (data[i] < alphaCut) transparent++;
  return transparent / n > 0.04;
}

/** Punch near-white paper out of JPGs / flattened PNGs. Mutates `data`. */
export function knockOutPaperBackground(data, { lumaMax = ART_PAPER_LUMA } = {}) {
  let n = 0;
  for (let i = 0; i < data.length; i += 4) {
    const luma = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
    if (luma >= lumaMax) {
      data[i + 3] = 0;
      n++;
    }
  }
  return n;
}

export function extractRasterPalette(data, { maxColors = 6, alphaMin = ART_ALPHA_MIN } = {}) {
  const counts = new Map();
  let opaque = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < alphaMin) continue;
    if (isPaperRgb(data[i], data[i + 1], data[i + 2])) continue;
    opaque++;
    const qr = Math.max(0, Math.min(255, (data[i] / 16 + 0.5 | 0) * 16));
    const qg = Math.max(0, Math.min(255, (data[i + 1] / 16 + 0.5 | 0) * 16));
    const qb = Math.max(0, Math.min(255, (data[i + 2] / 16 + 0.5 | 0) * 16));
    const hex = rgbToHex(qr, qg, qb);
    counts.set(hex, (counts.get(hex) || 0) + 1);
  }
  const min = Math.max(8, opaque * 0.008);
  return [...counts.entries()]
    .filter(([, n]) => n >= min)
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxColors)
    .map(([hex]) => hex);
}

export function extractSvgFillHexes(svgText) {
  const out = [];
  const seen = new Set();
  const add = (raw) => {
    const rgb = parseCssColor(raw);
    if (!rgb) return;
    const hex = rgbToHex(rgb[0], rgb[1], rgb[2]);
    if (seen.has(hex)) return;
    seen.add(hex);
    out.push(hex);
  };
  const src = String(svgText || "");
  for (const m of src.matchAll(/fill\s*=\s*["']\s*([^"']+)["']/gi)) add(m[1]);
  for (const m of src.matchAll(/fill\s*:\s*([^;"']+)/gi)) add(m[1]);
  return out;
}

export function parseSvgViewBox(svgText) {
  const src = String(svgText || "");
  const m = src.match(/viewBox\s*=\s*["']\s*([-\d.eE]+)\s+([-\d.eE]+)\s+([-\d.eE]+)\s+([-\d.eE]+)/i);
  if (m) return { x: +m[1], y: +m[2], w: +m[3], h: +m[4] };
  const wm = src.match(/\bwidth\s*=\s*["']\s*([\d.]+)/i);
  const hm = src.match(/\bheight\s*=\s*["']\s*([\d.]+)/i);
  return { x: 0, y: 0, w: +(wm?.[1] || 100), h: +(hm?.[1] || 100) };
}

/** Drop full-canvas background rects so logos don't stamp a white plate. */
export function prepareSvgStripBg(svgText) {
  if (!svgText?.trim() || typeof DOMParser === "undefined") return svgText;
  const doc = new DOMParser().parseFromString(svgText, "image/svg+xml");
  const svg = doc.documentElement;
  if (!svg || svg.nodeName.toLowerCase() === "parsererror") return svgText;
  const vb = parseSvgViewBox(svgText);
  const viewArea = Math.max(1, vb.w * vb.h);
  for (const el of [...svg.querySelectorAll("rect")]) {
    const x = parseFloat(el.getAttribute("x") || "0");
    const y = parseFloat(el.getAttribute("y") || "0");
    const w = parseFloat(el.getAttribute("width") || "0");
    const h = parseFloat(el.getAttribute("height") || "0");
    if (w * h > viewArea * 0.88 && Math.abs(x - vb.x) < vb.w * 0.05 && Math.abs(y - vb.y) < vb.h * 0.05) {
      el.remove();
    }
  }
  return new XMLSerializer().serializeToString(svg);
}

export function ensureSvgSized(svgText) {
  const textIn = String(svgText || "").trim();
  if (!/<svg[\s>]/i.test(textIn)) throw new Error("Not an SVG file");
  const viewBox = parseSvgViewBox(textIn);
  const aspect = viewBox.w / Math.max(viewBox.h, 1e-6);
  let text = textIn;
  if (!/\swidth\s*=/i.test(text)) {
    text = text.replace(/<svg\b/i, `<svg width="${viewBox.w}"`);
  }
  if (!/\sheight\s*=/i.test(text)) {
    text = text.replace(/<svg\b/i, `<svg height="${viewBox.h}"`);
  }
  return { text, viewBox, aspect };
}

export async function rasterizeSvgText(svgText, maxDim = ART_MAX_RASTER) {
  if (typeof Image === "undefined" || typeof document === "undefined") {
    throw new Error("SVG rasterize needs a browser");
  }
  const stripped = prepareSvgStripBg(svgText);
  const { text, viewBox, aspect } = ensureSvgSized(stripped);
  const w = aspect >= 1 ? maxDim : Math.max(32, Math.round(maxDim * aspect));
  const h = aspect >= 1 ? Math.max(32, Math.round(maxDim / aspect)) : maxDim;
  return new Promise((resolve, reject) => {
    const blob = new Blob([text], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        ctx.clearRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        const imageData = ctx.getImageData(0, 0, w, h);
        URL.revokeObjectURL(url);
        resolve({ imageData, width: w, height: h, aspect, canvas, viewBox });
      } catch (err) {
        URL.revokeObjectURL(url);
        reject(err);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not read SVG"));
    };
    img.src = url;
  });
}

function canvasFromImage(img, maxDim) {
  const iw = img.naturalWidth || img.width || 1;
  const ih = img.naturalHeight || img.height || 1;
  const aspect = iw / Math.max(ih, 1e-6);
  const w = aspect >= 1 ? maxDim : Math.max(32, Math.round(maxDim * aspect));
  const h = aspect >= 1 ? Math.max(32, Math.round(maxDim / aspect)) : maxDim;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  const imageData = ctx.getImageData(0, 0, w, h);
  return { imageData, width: w, height: h, aspect, canvas, viewBox: null };
}

export async function rasterizeImageFile(file, maxDim = ART_MAX_RASTER) {
  if (typeof Image === "undefined" || typeof document === "undefined") {
    throw new Error("Image rasterize needs a browser");
  }
  const url = URL.createObjectURL(file);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      try {
        const result = canvasFromImage(img, maxDim);
        URL.revokeObjectURL(url);
        resolve(result);
      } catch (err) {
        URL.revokeObjectURL(url);
        reject(err);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not read image"));
    };
    img.src = url;
  });
}

/** Tangent frame at a hit: right / up / normal, with in-plane rotation. */
export function makeStampFrame(origin, normal, rotationDeg = 0) {
  const n = normalize(normal);
  const upGuess = Math.abs(n[2]) < 0.9 ? [0, 0, 1] : [0, 1, 0];
  let right = cross(upGuess, n);
  if (hypot3(right[0], right[1], right[2]) < 1e-6) right = [1, 0, 0];
  right = normalize(right);
  let up = normalize(cross(n, right));
  const rad = (rotationDeg || 0) * Math.PI / 180;
  const c = Math.cos(rad), s = Math.sin(rad);
  const rightR = [
    right[0] * c + up[0] * s,
    right[1] * c + up[1] * s,
    right[2] * c + up[2] * s,
  ];
  const upR = [
    -right[0] * s + up[0] * c,
    -right[1] * s + up[1] * c,
    -right[2] * s + up[2] * c,
  ];
  return {
    origin: [origin[0], origin[1], origin[2]],
    normal: n,
    right: normalize(rightR),
    up: normalize(upR),
  };
}

export function mirrorStampFrameX(frame, centerX = 0) {
  return {
    origin: [2 * centerX - frame.origin[0], frame.origin[1], frame.origin[2]],
    right: [-frame.right[0], frame.right[1], frame.right[2]],
    up: [-frame.up[0], frame.up[1], frame.up[2]],
    normal: [-frame.normal[0], frame.normal[1], frame.normal[2]],
  };
}

function sampleStamp(pixels, imgW, imgH, u, v, widthMm, heightMm, alphaMin) {
  const halfW = widthMm / 2, halfH = heightMm / 2;
  if (u < -halfW || u > halfW || v < -halfH || v > halfH) return null;
  const px = ((u + halfW) / widthMm) * (imgW - 1);
  const py = (1 - (v + halfH) / heightMm) * (imgH - 1);
  const ix = Math.max(0, Math.min(imgW - 1, (px + 0.5) | 0));
  const iy = Math.max(0, Math.min(imgH - 1, (py + 0.5) | 0));
  const o = (iy * imgW + ix) * 4;
  const a = pixels[o + 3];
  if (a < alphaMin) return null;
  return [pixels[o], pixels[o + 1], pixels[o + 2], a];
}

export function rgbLuma(r, g, b) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function isPaperRgb(r, g, b, lumaMax = ART_PAPER_LUMA) {
  return rgbLuma(r, g, b) >= lumaMax;
}

function stampGeomLoop(verts, faces, nTri, origin, right, up, normal, widthMm, heightMm, maxAngleDot, maxBehindMm, maxFrontMm, onFace) {
  const ox = origin[0], oy = origin[1], oz = origin[2];
  const rx = right[0], ry = right[1], rz = right[2];
  const ux = up[0], uy = up[1], uz = up[2];
  const nx = normal[0], ny = normal[1], nz = normal[2];
  const halfW = widthMm / 2, halfH = heightMm / 2;
  const project = (x, y, z) => {
    const dx = x - ox, dy = y - oy, dz = z - oz;
    return [dx * rx + dy * ry + dz * rz, dx * ux + dy * uy + dz * uz, dx * nx + dy * ny + dz * nz];
  };

  for (let i = 0; i < nTri; i++) {
    const i0 = faces[i * 3], i1 = faces[i * 3 + 1], i2 = faces[i * 3 + 2];
    const ax = verts[i0 * 3], ay = verts[i0 * 3 + 1], az = verts[i0 * 3 + 2];
    const bx = verts[i1 * 3], by = verts[i1 * 3 + 1], bz = verts[i1 * 3 + 2];
    const cx = verts[i2 * 3], cy = verts[i2 * 3 + 1], cz = verts[i2 * 3 + 2];
    const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
    const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
    let fnx = e1y * e2z - e1z * e2y;
    let fny = e1z * e2x - e1x * e2z;
    let fnz = e1x * e2y - e1y * e2x;
    const fl = hypot3(fnx, fny, fnz);
    fnx /= fl; fny /= fl; fnz /= fl;
    if (fnx * nx + fny * ny + fnz * nz < maxAngleDot) continue;

    const mx = (ax + bx + cx) / 3, my = (ay + by + cy) / 3, mz = (az + bz + cz) / 3;
    const pc = project(mx, my, mz);
    if (pc[2] < -maxBehindMm || pc[2] > maxFrontMm) continue;
    if (Math.abs(pc[0]) > halfW || Math.abs(pc[1]) > halfH) continue;

    const pa = project(ax, ay, az);
    const pb = project(bx, by, bz);
    const pcc = project(cx, cy, cz);
    const mab = [(pa[0] + pb[0]) * 0.5, (pa[1] + pb[1]) * 0.5];
    const mbc = [(pb[0] + pcc[0]) * 0.5, (pb[1] + pcc[1]) * 0.5];
    const mca = [(pcc[0] + pa[0]) * 0.5, (pcc[1] + pa[1]) * 0.5];
    onFace(i, [pc, pa, pb, pcc, mab, mbc, mca]);
  }
}

/**
 * Faces whose centroid sits in the stamp rectangle — used to wipe a previous shattered stamp.
 */
export function collectStampRectFaces({
  verts, faces, nTri, origin, right, up, normal, widthMm, heightMm,
  maxAngleDot = Math.cos(70 * Math.PI / 180),
  maxBehindMm = 18,
  maxFrontMm = 14,
}) {
  const rect = [];
  if (!verts || !faces || !nTri || widthMm <= 0 || heightMm <= 0) return rect;
  stampGeomLoop(verts, faces, nTri, origin, right, up, normal, widthMm, heightMm, maxAngleDot, maxBehindMm, maxFrontMm, (i) => {
    rect.push(i);
  });
  return rect;
}

function stampUvToPixel(u, v, widthMm, heightMm, imgW, imgH) {
  const halfW = widthMm / 2, halfH = heightMm / 2;
  if (u < -halfW || u > halfW || v < -halfH || v > halfH) return -1;
  const px = ((u + halfW) / widthMm) * (imgW - 1);
  const py = (1 - (v + halfH) / heightMm) * (imgH - 1);
  const ix = Math.max(0, Math.min(imgW - 1, (px + 0.5) | 0));
  const iy = Math.max(0, Math.min(imgH - 1, (py + 0.5) | 0));
  return iy * imgW + ix;
}

/**
 * Colour the hoodie triangles under the logo (including the white plate).
 * Bambu slices this paint_color even if the raised shell is too thin.
 */
export function collectStampLayerHits({
  verts, faces, nTri, origin, right, up, normal, widthMm, heightMm,
  layers, imgW, imgH,
  coverageMin = ART_COVERAGE_MIN,
  maxAngleDot = Math.cos(70 * Math.PI / 180),
  maxBehindMm = 18,
  maxFrontMm = 14,
}) {
  const hits = [];
  if (!verts || !faces || !nTri || !layers?.length || !imgW || !imgH) return hits;
  stampGeomLoop(verts, faces, nTri, origin, right, up, normal, widthMm, heightMm, maxAngleDot, maxBehindMm, maxFrontMm, (i, pts) => {
    const counts = new Uint32Array(layers.length);
    let samples = 0;
    for (const p of pts) {
      const idx = stampUvToPixel(p[0], p[1], widthMm, heightMm, imgW, imgH);
      if (idx < 0) continue;
      samples++;
      for (let li = 0; li < layers.length; li++) {
        if (layers[li]?.mask?.[idx]) counts[li]++;
      }
    }
    if (!samples) return;
    let best = -1, bestN = 0;
    for (let li = 0; li < layers.length; li++) {
      if (counts[li] >= samples * coverageMin && counts[li] >= bestN) {
        best = li;
        bestN = counts[li];
      }
    }
    if (best < 0) return;
    hits.push({ face: i, slot: layers[best].slot ?? 0 });
  });
  return hits;
}

const LIFT_EMPTY = -1e9;

function fillLiftHoles(lift, gw, gh) {
  for (let pass = 0; pass < 12; pass++) {
    let filled = 0;
    const next = lift.slice();
    for (let y = 0; y < gh; y++) {
      for (let x = 0; x < gw; x++) {
        const i = y * gw + x;
        if (lift[i] > LIFT_EMPTY + 1) continue;
        let s = 0, n = 0;
        if (x && lift[i - 1] > LIFT_EMPTY + 1) { s += lift[i - 1]; n++; }
        if (x + 1 < gw && lift[i + 1] > LIFT_EMPTY + 1) { s += lift[i + 1]; n++; }
        if (y && lift[i - gw] > LIFT_EMPTY + 1) { s += lift[i - gw]; n++; }
        if (y + 1 < gh && lift[i + gw] > LIFT_EMPTY + 1) { s += lift[i + gw]; n++; }
        if (!n) continue;
        next[i] = s / n;
        filled++;
      }
    }
    lift.set(next);
    if (!filled) break;
  }
}

/**
 * Height of the model along the stamp normal, at each slab-grid corner.
 * Positive is toward the camera; a curved chest falls negative at the edges.
 *
 * Importers and the Painter's bed-orientation transform can legitimately
 * reverse a mesh's winding.  Height sampling is geometric rather than a
 * shading operation, so accept either winding here and retain the front-most
 * nearby surface.  Requiring only a positive normal dot made those meshes
 * fall back to a flat decal, which can cut through a curved chest.
 */
export function sampleStampSurfaceLift({
  verts, faces, nTri,
  origin, right, up, normal,
  widthMm, heightMm, cols, rows,
  maxAngleDot = Math.cos(75 * Math.PI / 180),
  maxBehindMm = 22,
  maxFrontMm = 16,
}) {
  const gw = cols + 1, gh = rows + 1;
  const lift = new Float32Array(gw * gh);
  lift.fill(LIFT_EMPTY);
  if (!verts || !faces || !nTri || widthMm <= 0 || heightMm <= 0 || cols < 1 || rows < 1) {
    lift.fill(0);
    return lift;
  }
  const ox = origin[0], oy = origin[1], oz = origin[2];
  const rx = right[0], ry = right[1], rz = right[2];
  const ux = up[0], uy = up[1], uz = up[2];
  const nx = normal[0], ny = normal[1], nz = normal[2];
  const halfW = widthMm / 2, halfH = heightMm / 2;
  const project = (x, y, z) => {
    const dx = x - ox, dy = y - oy, dz = z - oz;
    return [dx * rx + dy * ry + dz * rz, dx * ux + dy * uy + dz * uz, dx * nx + dy * ny + dz * nz];
  };

  for (let i = 0; i < nTri; i++) {
    const i0 = faces[i * 3], i1 = faces[i * 3 + 1], i2 = faces[i * 3 + 2];
    const ax = verts[i0 * 3], ay = verts[i0 * 3 + 1], az = verts[i0 * 3 + 2];
    const bx = verts[i1 * 3], by = verts[i1 * 3 + 1], bz = verts[i1 * 3 + 2];
    const cx = verts[i2 * 3], cy = verts[i2 * 3 + 1], cz = verts[i2 * 3 + 2];
    const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
    const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
    let fnx = e1y * e2z - e1z * e2y;
    let fny = e1z * e2x - e1x * e2z;
    let fnz = e1x * e2y - e1y * e2x;
    const fl = hypot3(fnx, fny, fnz);
    if (fl < 1e-10) continue;
    fnx /= fl; fny /= fl; fnz /= fl;
    if (Math.abs(fnx * nx + fny * ny + fnz * nz) < maxAngleDot) continue;

    const pa = project(ax, ay, az);
    const pb = project(bx, by, bz);
    const pc = project(cx, cy, cz);
    const midU = (pa[0] + pb[0] + pc[0]) / 3;
    const midV = (pa[1] + pb[1] + pc[1]) / 3;
    const midD = (pa[2] + pb[2] + pc[2]) / 3;
    if (midD < -maxBehindMm || midD > maxFrontMm) continue;
    if (Math.abs(midU) > halfW + 2 || Math.abs(midV) > halfH + 2) continue;

    const u0 = pa[0], v0 = pa[1], d0 = pa[2];
    const u1 = pb[0], v1 = pb[1], d1 = pb[2];
    const u2 = pc[0], v2 = pc[1], d2 = pc[2];
    const denom = (u1 - u0) * (v2 - v0) - (u2 - u0) * (v1 - v0);
    if (Math.abs(denom) < 1e-12) continue;

    const xs = [(u0 + halfW) / widthMm * cols, (u1 + halfW) / widthMm * cols, (u2 + halfW) / widthMm * cols];
    const ys = [(halfH - v0) / heightMm * rows, (halfH - v1) / heightMm * rows, (halfH - v2) / heightMm * rows];
    const gx0 = Math.max(0, Math.floor(Math.min(xs[0], xs[1], xs[2])));
    const gx1 = Math.min(cols, Math.ceil(Math.max(xs[0], xs[1], xs[2])));
    const gy0 = Math.max(0, Math.floor(Math.min(ys[0], ys[1], ys[2])));
    const gy1 = Math.min(rows, Math.ceil(Math.max(ys[0], ys[1], ys[2])));

    for (let gy = gy0; gy <= gy1; gy++) {
      for (let gx = gx0; gx <= gx1; gx++) {
        const u = -halfW + (gx / cols) * widthMm;
        const v = halfH - (gy / rows) * heightMm;
        const w1 = ((u - u0) * (v2 - v0) - (u2 - u0) * (v - v0)) / denom;
        const w2 = ((u1 - u0) * (v - v0) - (u - u0) * (v1 - v0)) / denom;
        const w0 = 1 - w1 - w2;
        if (w0 < -1e-4 || w1 < -1e-4 || w2 < -1e-4) continue;
        const d = w0 * d0 + w1 * d1 + w2 * d2;
        if (d < -maxBehindMm || d > maxFrontMm) continue;
        const idx = gy * gw + gx;
        if (d > lift[idx]) lift[idx] = d;
      }
    }
  }
  fillLiftHoles(lift, gw, gh);
  let sum = 0, known = 0;
  for (let i = 0; i < lift.length; i++) {
    if (lift[i] > LIFT_EMPTY + 1) { sum += lift[i]; known++; }
  }
  const fallback = known ? sum / known : 0;
  for (let i = 0; i < lift.length; i++) if (lift[i] <= LIFT_EMPTY + 1) lift[i] = fallback;
  return lift;
}

/**
 * Project a raster stamp onto mesh faces. Returns { face, r, g, b } hits.
 * A face paints only when most sample points land on solid logo pixels — a single
 * grazing vertex must not colour the whole triangle.
 */
export function collectStampHits({
  verts,
  faces,
  nTri,
  origin,
  right,
  up,
  normal,
  widthMm,
  heightMm,
  pixels,
  imgW,
  imgH,
  alphaMin = ART_ALPHA_MIN,
  coverageMin = ART_COVERAGE_MIN,
  maxAngleDot = Math.cos(70 * Math.PI / 180),
  maxBehindMm = 18,
  maxFrontMm = 14,
}) {
  const hits = [];
  if (!verts || !faces || !pixels || !nTri || widthMm <= 0 || heightMm <= 0) return hits;

  stampGeomLoop(verts, faces, nTri, origin, right, up, normal, widthMm, heightMm, maxAngleDot, maxBehindMm, maxFrontMm, (i, pts) => {
    let opaque = 0;
    let best = null;
    for (const p of pts) {
      const samp = sampleStamp(pixels, imgW, imgH, p[0], p[1], widthMm, heightMm, alphaMin);
      if (!samp) continue;
      if (isPaperRgb(samp[0], samp[1], samp[2])) continue;
      opaque++;
      if (!best || samp[3] > best[3]) best = samp;
    }
    if (!best || opaque / pts.length < coverageMin) return;
    hits.push({ face: i, r: best[0], g: best[1], b: best[2] });
  });
  return hits;
}

export function stampSizeMm(widthMm, aspect) {
  const w = Math.max(4, widthMm);
  const a = aspect > 0 ? aspect : 1;
  return { widthMm: w, heightMm: w / a };
}

export function opaqueLogoMask(pixels, imgW, imgH, { alphaMin = ART_ALPHA_MIN } = {}) {
  const mask = new Uint8Array(imgW * imgH);
  if (!pixels) return mask;
  for (let i = 0; i < imgW * imgH; i++) {
    const o = i * 4;
    if (pixels[o + 3] < alphaMin) continue;
    if (isPaperRgb(pixels[o], pixels[o + 1], pixels[o + 2])) continue;
    mask[i] = 1;
  }
  return mask;
}

export function classifyRasterToMasks(pixels, imgW, imgH, paletteRgbs, { alphaMin = ART_ALPHA_MIN } = {}) {
  const layers = paletteRgbs.map(() => new Uint8Array(imgW * imgH));
  if (!pixels || !imgW || !paletteRgbs?.length) return layers;
  for (let i = 0; i < imgW * imgH; i++) {
    const o = i * 4;
    if (pixels[o + 3] < alphaMin) continue;
    if (isPaperRgb(pixels[o], pixels[o + 1], pixels[o + 2])) continue;
    const found = nearestSlot([pixels[o], pixels[o + 1], pixels[o + 2]], paletteRgbs);
    if (found.dist2 > ART_MATCH_DIST2) continue;
    layers[found.slot][i] = 1;
  }
  return layers;
}

export function downsampleMask(mask, srcW, srcH, dstW, dstH) {
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

export function stampStepMm(widthMm, heightMm) {
  const span = Math.max(widthMm, heightMm, 1);
  // ~0.2 mm is plenty for a 0.4 mm nozzle. Finer grids explode face count
  // and the 3MF exporter dies, leaving a 0-byte file.
  return Math.min(0.28, Math.max(0.18, span / 200));
}

export function resolveTraceInkMask(result) {
  if (result?.silhouetteMask?.length) return result.silhouetteMask;
  if (result?.mask?.length) return result.mask;
  return null;
}

export function maskBorderTouchRatio(mask, w, h) {
  if (!mask || !w || !h) return 0;
  let border = 0, on = 0;
  for (let x = 0; x < w; x++) {
    border += 2;
    if (mask[x]) on++;
    if (mask[(h - 1) * w + x]) on++;
  }
  for (let y = 1; y < h - 1; y++) {
    border += 2;
    if (mask[y * w]) on++;
    if (mask[y * w + w - 1]) on++;
  }
  return border ? on / border : 0;
}

export function rgbChromaLum(r, g, b) {
  const chroma = Math.max(r, g, b) - Math.min(r, g, b);
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
  return { chroma, lum };
}

export function isInkRgb(r, g, b) {
  const { chroma, lum } = rgbChromaLum(r, g, b);
  if (lum > 200) return false;
  return lum < 60 || chroma >= 32;
}

export function isLogoWhiteRgb(r, g, b) {
  const { chroma, lum } = rgbChromaLum(r, g, b);
  return chroma <= 55 && lum > 210;
}

/** Mid-grey paper / silver mat — not black, not crest white. */
export function isMatGreyRgb(r, g, b) {
  const { chroma, lum } = rgbChromaLum(r, g, b);
  return chroma <= 55 && lum >= 55 && lum <= 232;
}

export function maskInteriorOnRatio(mask, w, h) {
  if (!mask || w < 3 || h < 3) return 0;
  let n = 0, on = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      n++;
      if (mask[y * w + x]) on++;
    }
  }
  return n ? on / n : 0;
}

/** Grey/white paper mat that hugs the crop — not interior white/red/black logo fills. */
export function isTraceMatLayer(mask, w, h, rgb) {
  if (!mask || mask.length !== w * h) return false;
  const [r, g, b] = rgb || [128, 128, 128];
  if (isInkRgb(r, g, b)) return false;
  if (isMatGreyRgb(r, g, b)) return true;
  const border = maskBorderTouchRatio(mask, w, h);
  const inner = maskInteriorOnRatio(mask, w, h);
  return isLogoWhiteRgb(r, g, b) && border >= 0.10 && inner < 0.18;
}

function dilateMask4(mask, w, h, passes = 1) {
  let cur = mask;
  for (let p = 0; p < passes; p++) {
    const next = new Uint8Array(cur);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (cur[y * w + x]) continue;
        if ((x && cur[y * w + x - 1])
          || (x + 1 < w && cur[y * w + x + 1])
          || (y && cur[(y - 1) * w + x])
          || (y + 1 < h && cur[(y + 1) * w + x])) {
          next[y * w + x] = 1;
        }
      }
    }
    cur = next;
  }
  return cur;
}

function erodeMask4(mask, w, h, passes = 1) {
  let cur = mask;
  for (let p = 0; p < passes; p++) {
    const next = new Uint8Array(cur.length);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!cur[y * w + x]) continue;
        if ((x === 0 || !cur[y * w + x - 1])
          || (x + 1 === w || !cur[y * w + x + 1])
          || (y === 0 || !cur[(y - 1) * w + x])
          || (y + 1 === h || !cur[(y + 1) * w + x])) continue;
        next[y * w + x] = 1;
      }
    }
    cur = next;
  }
  return cur;
}

function openMask4(mask, w, h, passes = 1) {
  if (passes <= 0) return mask;
  return dilateMask4(erodeMask4(mask, w, h, passes), w, h, passes);
}

function floodFromBorder(passable, w, h) {
  const seen = new Uint8Array(w * h);
  const stack = [];
  const seed = (i) => {
    if (!passable[i] || seen[i]) return;
    seen[i] = 1;
    stack.push(i);
  };
  for (let x = 0; x < w; x++) {
    seed(x);
    seed((h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    seed(y * w);
    seed(y * w + w - 1);
  }
  while (stack.length) {
    const i = stack.pop();
    const x = i % w;
    const y = (i / w) | 0;
    if (x) seed(i - 1);
    if (x + 1 < w) seed(i + 1);
    if (y) seed(i - w);
    if (y + 1 < h) seed(i + w);
  }
  return seen;
}

function unionLayerMask(layers, w, h, pred) {
  const out = new Uint8Array(w * h);
  for (const layer of layers) {
    const [r, g, b] = layer.rgb || [0, 0, 0];
    if (!pred(r, g, b) || !layer.mask) continue;
    for (let i = 0; i < out.length; i++) if (layer.mask[i]) out[i] = 1;
  }
  return out;
}

/**
 * Drop the grey halo, keep the white logo plate. Grey/empty floods in from the
 * crop edge and stops at white or red/black. Paper layers then get a 1px open
 * so anti-alias saw-teeth on the plate edge don't become grey geometry.
 */
export function punchExteriorPaper(layers, w, h) {
  if (!layers?.length || !w || !h) return layers || [];
  const kept = [];
  for (const layer of layers) {
    if (!layer?.mask || layer.mask.length !== w * h) continue;
    const [r, g, b] = layer.rgb || [0, 0, 0];
    if (isMatGreyRgb(r, g, b) || isTraceMatLayer(layer.mask, w, h, [r, g, b])) continue;
    kept.push(layer);
  }
  const ink = unionLayerMask(kept, w, h, isInkRgb);
  const white = unionLayerMask(kept, w, h, isLogoWhiteRgb);
  const wall = dilateMask4(ink, w, h, Math.min(w, h) >= 64 ? 2 : 1);
  const passable = new Uint8Array(w * h);
  for (let i = 0; i < passable.length; i++) {
    passable[i] = (!wall[i] && !white[i]) ? 1 : 0;
  }
  const exterior = floodFromBorder(passable, w, h);
  const out = [];
  for (const layer of kept) {
    const [r, g, b] = layer.rgb || [0, 0, 0];
    let mask = new Uint8Array(layer.mask);
    let on = 0;
    for (let i = 0; i < mask.length; i++) {
      if (exterior[i]) mask[i] = 0;
      if (mask[i]) on++;
    }
    if (on < 2) continue;
    if (!isInkRgb(r, g, b)) {
      mask = openMask4(mask, w, h, Math.min(w, h) >= 64 ? 2 : 1);
      on = 0;
      for (let i = 0; i < mask.length; i++) if (mask[i]) on++;
      if (on < 2) continue;
    }
    out.push({ ...layer, mask });
  }
  return out;
}

function punchMasks(mask, punches) {
  if (!mask || !punches?.length) return mask;
  const out = new Uint8Array(mask);
  for (const punch of punches) {
    if (!punch || punch.length !== out.length) continue;
    for (let i = 0; i < out.length; i++) if (punch[i]) out[i] = 0;
  }
  return out;
}

function unionMasks(masks, len) {
  const out = new Uint8Array(len);
  for (const mask of masks) {
    if (!mask || mask.length !== len) continue;
    for (let i = 0; i < len; i++) if (mask[i]) out[i] = 1;
  }
  return out;
}

function cropMask2d(src, srcW, srcH, ox, oy, w, h) {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const sy = oy + y;
    if (sy < 0 || sy >= srcH) continue;
    for (let x = 0; x < w; x++) {
      const sx = ox + x;
      if (sx < 0 || sx >= srcW) continue;
      out[y * w + x] = src[sy * srcW + sx];
    }
  }
  return out;
}

/** Flood from the PNG border through paper grey/white — MakerDeck's mat knockout. */
export function floodBorderBackground(pixels, w, h, { tol = 52 } = {}) {
  const exterior = new Uint8Array(w * h);
  if (!pixels || !w || !h) return exterior;
  const samples = [];
  const add = (x, y) => {
    const px = Math.max(0, Math.min(w - 1, x | 0));
    const py = Math.max(0, Math.min(h - 1, y | 0));
    const i = (py * w + px) * 4;
    if (pixels[i + 3] < 16) return;
    samples.push([pixels[i], pixels[i + 1], pixels[i + 2]]);
  };
  const stepX = Math.max(1, (w / 24) | 0);
  const stepY = Math.max(1, (h / 24) | 0);
  for (let x = 0; x < w; x += stepX) { add(x, 0); add(x, h - 1); }
  for (let y = 0; y < h; y += stepY) { add(0, y); add(w - 1, y); }
  add(0, 0); add(w - 1, 0); add(0, h - 1); add(w - 1, h - 1);
  if (!samples.length) return exterior;
  samples.sort((a, b) => (a[0] + a[1] + a[2]) - (b[0] + b[1] + b[2]));
  const mid = samples[(samples.length / 2) | 0];
  const bgLum = 0.299 * mid[0] + 0.587 * mid[1] + 0.114 * mid[2];
  const tolSq = tol * tol;
  const isBg = (x, y) => {
    const i = (y * w + x) * 4;
    if (pixels[i + 3] < 40) return true;
    const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
    const chroma = Math.max(r, g, b) - Math.min(r, g, b);
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    if (lum < 50 && bgLum > 90) return false;
    if (chroma >= 36 && Math.abs(lum - bgLum) > 28) return false;
    const dr = r - mid[0], dg = g - mid[1], db = b - mid[2];
    if (dr * dr + dg * dg + db * db <= tolSq) return true;
    return chroma <= 42 && Math.abs(lum - bgLum) <= 58;
  };
  const stack = [];
  const seed = (x, y) => {
    const idx = y * w + x;
    if (exterior[idx] || !isBg(x, y)) return;
    exterior[idx] = 1;
    stack.push(idx);
  };
  for (let x = 0; x < w; x++) { seed(x, 0); seed(x, h - 1); }
  for (let y = 0; y < h; y++) { seed(0, y); seed(w - 1, y); }
  while (stack.length) {
    const idx = stack.pop();
    const x = idx % w;
    const y = (idx / w) | 0;
    if (x) seed(x - 1, y);
    if (x + 1 < w) seed(x + 1, y);
    if (y) seed(x, y - 1);
    if (y + 1 < h) seed(x, y + 1);
  }
  const grow = Math.min(w, h) >= 64 ? 2 : 0;
  return grow ? dilateMask4(exterior, w, h, grow) : exterior;
}

function punchMaskBits(mask, punch) {
  if (!mask || !punch || mask.length !== punch.length) return mask;
  const out = new Uint8Array(mask);
  for (let i = 0; i < out.length; i++) if (punch[i]) out[i] = 0;
  return out;
}

/** Border-connected mid-grey / clear pixels — the jagged halo, not crest white. */
export function floodMatGreyFromBorder(pixels, w, h) {
  const passable = new Uint8Array(w * h);
  if (!pixels || !w || !h) return passable;
  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    if (pixels[o + 3] < 40 || isMatGreyRgb(pixels[o], pixels[o + 1], pixels[o + 2])) {
      passable[i] = 1;
    }
  }
  return floodFromBorder(passable, w, h);
}

/**
 * Keep the white logo plate + red/black ink. Drop grey halo layers and
 * border-connected grey, then strip 1px saw-teeth on paper fills.
 */
export function clipLayersToInkIsland(layers, w, h) {
  return punchExteriorPaper(layers, w, h);
}

/** Drop the grey bounding-mat / halo around a team logo. */
export function scrubTraceMat(result, source = null) {
  if (!result) return result;
  const imgW = result.width | 0;
  const imgH = result.height | 0;
  let layers = (result.colorLayers || []).map((layer) => ({ ...layer }));
  const hadColor = layers.length > 0;
  if (!layers.length && !resolveTraceInkMask(result)) return result;

  if (source?.pixels && source.srcW && source.srcH && imgW && imgH) {
    const extFull = floodMatGreyFromBorder(source.pixels, source.srcW, source.srcH);
    const ox = result.cropOx || 0;
    const oy = result.cropOy || 0;
    const ext = (ox === 0 && oy === 0 && imgW === source.srcW && imgH === source.srcH)
      ? extFull
      : cropMask2d(extFull, source.srcW, source.srcH, ox, oy, imgW, imgH);
    const next = [];
    for (const layer of layers) {
      if (!layer?.mask || layer.mask.length !== imgW * imgH) continue;
      const mask = punchMaskBits(layer.mask, ext);
      let on = 0;
      for (let i = 0; i < mask.length; i++) if (mask[i]) on++;
      if (on < 2) continue;
      next.push({ ...layer, mask });
    }
    layers = next;
  }

  if (layers.length) {
    layers = punchExteriorPaper(layers, imgW, imgH);
  }
  const sil = layers.length
    ? unionMasks(layers.map((l) => l.mask), imgW * imgH)
    : (hadColor ? new Uint8Array(imgW * imgH) : resolveTraceInkMask(result));
  return {
    ...result,
    colorLayers: layers,
    colorLayerCount: layers.length,
    silhouetteMask: sil,
    mask: sil,
  };
}

/** MakerDeck trace result → per-slot ink masks (background already knocked out). */
export function stampLayersFromTrace(result, { singleSlot = null, slotForRgb, pixels, srcW, srcH } = {}) {
  const cleaned = scrubTraceMat(result, pixels ? { pixels, srcW, srcH } : null);
  const imgW = cleaned?.width | 0;
  const imgH = cleaned?.height | 0;
  if (!imgW || !imgH) return { imgW, imgH, layers: [] };
  const expect = imgW * imgH;
  if (singleSlot != null) {
    const mask = resolveTraceInkMask(cleaned);
    if (!mask || mask.length !== expect) return { imgW, imgH, layers: [] };
    return { imgW, imgH, layers: [{ mask, slot: singleSlot }] };
  }
  if (cleaned.colorLayers?.length) {
    const layers = [];
    for (const layer of cleaned.colorLayers) {
      if (!layer?.mask || layer.mask.length !== expect) continue;
      const rgb = layer.rgb || [0, 0, 0];
      layers.push({ mask: layer.mask, slot: slotForRgb ? slotForRgb(rgb) : 0 });
    }
    if (layers.length) return { imgW, imgH, layers };
  }
  if ((result.colorLayers || []).length) return { imgW, imgH, layers: [] };
  const mask = resolveTraceInkMask(cleaned);
  if (!mask || mask.length !== expect) return { imgW, imgH, layers: [] };
  return { imgW, imgH, layers: [{ mask, slot: 0 }] };
}

function maskOnCount(mask) {
  if (!mask) return 0;
  let n = 0;
  for (let i = 0; i < mask.length; i++) if (mask[i]) n++;
  return n;
}

export function buildStampSlabsFromMasks({
  layers, imgW, imgH,
  origin, right, up, normal, widthMm, heightMm,
  d0 = STAMP_SKIN_MM, d1 = STAMP_SKIN_MM + STAMP_THICK_MM, stepMm = null,
  verts = null, faces = null, nTri = 0,
}) {
  const positions = [];
  const indices = [];
  const faceSlots = [];
  if (!layers?.length || widthMm <= 0 || heightMm <= 0 || !imgW || !imgH) {
    return { positions, indices, faceSlots };
  }
  let step = stepMm ?? stampStepMm(widthMm, heightMm);
  let cols = Math.max(24, Math.round(widthMm / step));
  let rows = Math.max(24, Math.round(heightMm / step));
  while (Math.max(cols, rows) > 220 && step < 0.45) {
    step *= 1.15;
    cols = Math.max(24, Math.round(widthMm / step));
    rows = Math.max(24, Math.round(heightMm / step));
  }
  const cellU = widthMm / cols;
  const cellV = heightMm / rows;
  const thick = Math.max(0.16, d1 - d0);
  const gw = cols + 1;
  const lift = (verts && faces && nTri)
    ? sampleStampSurfaceLift({
      verts, faces, nTri, origin, right, up, normal, widthMm, heightMm, cols, rows,
    })
    : null;
  const ordered = layers
    .filter((layer) => layer?.mask)
    .slice()
    .sort((a, b) => maskOnCount(b.mask) - maskOnCount(a.mask));
  ordered.forEach((layer, li) => {
    const slot = layer.slot ?? 0;
    const mask = downsampleMask(layer.mask, imgW, imgH, cols, rows);
    const layerLift = li * STAMP_LAYER_MM;
    const innerAt = (c, r) => (lift ? lift[r * gw + c] : 0) + d0 + layerLift;
    appendStampHeightfield(
      positions, indices, faceSlots,
      mask, cols, rows, cellU, cellV, widthMm, heightMm,
      origin, right, up, normal, innerAt, thick, slot,
    );
  });
  return { positions, indices, faceSlots };
}

function mapStampPoint(origin, right, up, normal, u, v, d) {
  return [
    origin[0] + right[0] * u + up[0] * v + normal[0] * d,
    origin[1] + right[1] * u + up[1] * v + normal[1] * d,
    origin[2] + right[2] * u + up[2] * v + normal[2] * d,
  ];
}

function pushIndexedQuad(indices, faceSlots, a, b, c, d, slot) {
  indices.push(a, b, c, a, c, d);
  faceSlots.push(slot, slot);
}

/** Shared-vertex heightfield — one shell per colour, not a prism per cell. */
function appendStampHeightfield(
  positions, indices, faceSlots,
  mask, cols, rows, cellU, cellV, widthMm, heightMm,
  origin, right, up, normal, innerAt, thick, slot,
) {
  const gw = cols + 1;
  const gh = rows + 1;
  const used = new Uint8Array(gw * gh);
  const onAt = (c, r) => c >= 0 && r >= 0 && c < cols && r < rows && mask[r * cols + c];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!mask[r * cols + c]) continue;
      used[r * gw + c] = 1;
      used[r * gw + c + 1] = 1;
      used[(r + 1) * gw + c] = 1;
      used[(r + 1) * gw + c + 1] = 1;
    }
  }
  const innerOf = new Int32Array(gw * gh);
  innerOf.fill(-1);
  for (let r = 0; r < gh; r++) {
    for (let c = 0; c < gw; c++) {
      const gi = r * gw + c;
      if (!used[gi]) continue;
      const u = -widthMm / 2 + c * cellU;
      const v = heightMm / 2 - r * cellV;
      const d = innerAt(c, r);
      innerOf[gi] = positions.length / 3;
      const inn = mapStampPoint(origin, right, up, normal, u, v, d);
      const out = mapStampPoint(origin, right, up, normal, u, v, d + thick);
      positions.push(inn[0], inn[1], inn[2], out[0], out[1], out[2]);
    }
  }
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!mask[r * cols + c]) continue;
      const i00 = innerOf[(r + 1) * gw + c];
      const i10 = innerOf[(r + 1) * gw + c + 1];
      const i11 = innerOf[r * gw + c + 1];
      const i01 = innerOf[r * gw + c];
      const o00 = i00 + 1, o10 = i10 + 1, o11 = i11 + 1, o01 = i01 + 1;
      pushIndexedQuad(indices, faceSlots, o00, o10, o11, o01, slot);
      pushIndexedQuad(indices, faceSlots, i00, i01, i11, i10, slot);
      if (!onAt(c, r + 1)) pushIndexedQuad(indices, faceSlots, i00, i10, o10, o00, slot);
      if (!onAt(c, r - 1)) pushIndexedQuad(indices, faceSlots, i01, o01, o11, i11, slot);
      if (!onAt(c - 1, r)) pushIndexedQuad(indices, faceSlots, i00, o00, o01, i01, slot);
      if (!onAt(c + 1, r)) pushIndexedQuad(indices, faceSlots, i10, i11, o11, o10, slot);
    }
  }
}

/**
 * MakerDeck-style face slabs from a logo raster, in the stamp tangent frame.
 */
export function buildStampSlabs({
  pixels, imgW, imgH, paletteRgbs = [], slotIndexes,
  origin, right, up, normal, widthMm, heightMm,
  d0 = STAMP_SKIN_MM, d1 = STAMP_SKIN_MM + STAMP_THICK_MM, stepMm = 0.12, singleSlot = null,
}) {
  if (!pixels || widthMm <= 0 || heightMm <= 0) return { positions: [], indices: [], faceSlots: [] };
  if (singleSlot == null && !paletteRgbs.length) return { positions: [], indices: [], faceSlots: [] };
  const masks = singleSlot != null
    ? [opaqueLogoMask(pixels, imgW, imgH)]
    : classifyRasterToMasks(pixels, imgW, imgH, paletteRgbs);
  const slots = singleSlot != null ? [singleSlot] : (slotIndexes || masks.map((_, i) => i));
  return buildStampSlabsFromMasks({
    layers: masks.map((mask, i) => ({ mask, slot: slots[i] ?? i })),
    imgW, imgH, origin, right, up, normal, widthMm, heightMm, d0, d1, stepMm,
  });
}


