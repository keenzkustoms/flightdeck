/**
 * Vase / plant pot generator.
 * Builds a lofted revolve mesh with configurable profile, drainage hole and optional saucer.
 * Returns { positions, indices } in mm, Z-up, centered on XY, base at z=0.
 */

import earcut from "https://esm.sh/earcut@2.2.4";
import {
  resolveVaseTexture,
  surfaceRing,
  vaseTextureTessellation,
} from "./vase-textures.js";

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
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

function ringXY(radius, segments) {
  const pts = [];
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    pts.push([radius * Math.cos(a), radius * Math.sin(a)]);
  }
  return pts;
}

/**
 * @deprecated use surfaceRing from vase-textures.js
 */
function flutedRing(radius, segments, flutes, depth, phase) {
  return surfaceRing(
    radius,
    segments,
    0,
    { count: flutes, depth },
    { style: "none" },
    phase,
  );
}

/** Smoothstep 0→1 between edges. */
function smoothstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / Math.max(1e-9, edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Vase profile presets — return list of [t, radiusScale] where t is 0..1 bottom→top. */
const PROFILES = {
  cylinder: [[0, 1], [1, 1]],
  tapered: [[0, 1], [1, 1.18]],
  potted: [[0, 0.86], [1, 1]],
  urn: [[0, 0.9], [0.15, 1.02], [0.35, 1.16], [0.55, 1.14], [0.75, 0.95], [1, 0.86]],
  amphora: [[0, 0.75], [0.15, 0.88], [0.35, 1.05], [0.55, 1.06], [0.75, 0.9], [0.9, 0.78], [1, 0.82]],
  goblet: [[0, 1.0], [0.14, 0.58], [0.34, 0.52], [0.55, 0.78], [0.8, 0.98], [1, 1.06]],
  hourglass: [[0, 1.02], [0.5, 0.58], [1, 1.02]],
  bud: [[0, 0.72], [0.22, 1.04], [0.45, 0.85], [0.7, 0.46], [0.88, 0.4], [1, 0.5]],
  bowl: [[0, 0.55], [0.35, 0.92], [0.7, 1.08], [1, 1.16]],
};

export const VASE_STYLES = [
  { id: "cylinder", label: "Cylinder pot", drainageDefault: true },
  { id: "tapered", label: "Tapered pot (wider top)", drainageDefault: true },
  { id: "potted", label: "Herbal pot (narrow top)", drainageDefault: true },
  { id: "bowl", label: "Bowl planter (low + wide)", drainageDefault: true },
  { id: "urn", label: "Urn (belly)", drainageDefault: false },
  { id: "amphora", label: "Amphora (long belly)", drainageDefault: false },
  { id: "goblet", label: "Goblet (stem + cup)", drainageDefault: false },
  { id: "hourglass", label: "Hourglass (pinched waist)", drainageDefault: false },
  { id: "bud", label: "Bud vase (narrow neck)", drainageDefault: false },
];

/**
 * Monotone cubic (Fritsch-Carlson) interpolation through profile control
 * points — smooth bellies and necks with no overshoot, so radii never go
 * negative or wobble past the control values. Linear data stays linear.
 */
function monotoneSampler(points) {
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const n = xs.length;
  if (n === 1) return () => ys[0];
  const dx = [];
  const slope = [];
  for (let i = 0; i < n - 1; i++) {
    dx.push(xs[i + 1] - xs[i] || 1e-9);
    slope.push((ys[i + 1] - ys[i]) / (dx[i] || 1e-9));
  }
  const m = new Array(n);
  m[0] = slope[0];
  m[n - 1] = slope[n - 2];
  for (let i = 1; i < n - 1; i++) {
    if (slope[i - 1] * slope[i] <= 0) {
      m[i] = 0;
    } else {
      const w1 = 2 * dx[i] + dx[i - 1];
      const w2 = dx[i] + 2 * dx[i - 1];
      m[i] = (w1 + w2) / (w1 / slope[i - 1] + w2 / slope[i]);
    }
  }
  return (t) => {
    if (t <= xs[0]) return ys[0];
    if (t >= xs[n - 1]) return ys[n - 1];
    let i = 0;
    while (i < n - 2 && t > xs[i + 1]) i++;
    const h = dx[i];
    const s = (t - xs[i]) / h;
    const s2 = s * s;
    const s3 = s2 * s;
    return (
      (2 * s3 - 3 * s2 + 1) * ys[i] +
      (s3 - 2 * s2 + s) * h * m[i] +
      (-2 * s3 + 3 * s2) * ys[i + 1] +
      (s3 - s2) * h * m[i + 1]
    );
  };
}

const _samplerCache = new Map();

function profileSampler(styleId) {
  let fn = _samplerCache.get(styleId);
  if (!fn) {
    fn = monotoneSampler(PROFILES[styleId] || PROFILES.cylinder);
    _samplerCache.set(styleId, fn);
  }
  return fn;
}

function sampleProfile(styleId, layers) {
  const at = profileSampler(styleId);
  const out = new Array(layers);
  for (let i = 0; i < layers; i++) out[i] = at(i / (layers - 1));
  return out;
}

/** Earcut cap — avoids center-fan triangulation spokes visible in preview. */
function capProfileSolid(outPos, outIdx, ring, z, up) {
  let clean = ring;
  if (
    clean.length > 1 &&
    clean[0][0] === clean[clean.length - 1][0] &&
    clean[0][1] === clean[clean.length - 1][1]
  ) {
    clean = clean.slice(0, -1);
  }
  if (clean.length < 3) return;
  const base = outPos.length / 3;
  for (const [x, y] of clean) outPos.push(x, y, z);
  const tri = earcut(clean.flat());
  if (!tri.length) {
    for (let i = 1; i < clean.length - 1; i++) {
      if (up) outIdx.push(base, base + i, base + i + 1);
      else outIdx.push(base, base + i + 1, base + i);
    }
    return;
  }
  for (let i = 0; i < tri.length; i += 3) {
    const a = base + tri[i];
    const b = base + tri[i + 1];
    const c = base + tri[i + 2];
    if (up) outIdx.push(a, b, c);
    else outIdx.push(a, c, b);
  }
}

/** @deprecated use capProfileSolid */
function capSolid(outPos, outIdx, ring, z, up) {
  capProfileSolid(outPos, outIdx, ring, z, up);
}

/** Ring-shaped cap (annulus) between outer and inner ring at same z. */
function capAnnulus(outPos, outIdx, outer, inner, z, up) {
  const n = outer.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const o0 = [outer[i][0], outer[i][1], z];
    const o1 = [outer[j][0], outer[j][1], z];
    const i0 = [inner[i][0], inner[i][1], z];
    const i1 = [inner[j][0], inner[j][1], z];
    if (up) pushQuad(outPos, outIdx, o0, o1, i1, i0);
    else pushQuad(outPos, outIdx, o0, i0, i1, o1);
  }
}

/** Loft between two rings of same length at different z values. */
function loftBetween(outPos, outIdx, ringA, ringB, zA, zB, outward) {
  const n = ringA.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const a0 = [ringA[i][0], ringA[i][1], zA];
    const a1 = [ringA[j][0], ringA[j][1], zA];
    const b1 = [ringB[j][0], ringB[j][1], zB];
    const b0 = [ringB[i][0], ringB[i][1], zB];
    if (outward) pushQuad(outPos, outIdx, a0, a1, b1, b0);
    else pushQuad(outPos, outIdx, a0, b0, b1, a1);
  }
}

/** Scaled ring at radius = baseRadius * scaleFactor. */
function scaledRing(baseRing, factor) {
  return baseRing.map(([x, y]) => [x * factor, y * factor]);
}

/**
 * Resolve the shared outer-surface parameters (profile sampler, flute fade,
 * twist phase, tessellation) used by both the vase body and the accent band.
 */
function vaseSurface(params) {
  const style = params.vaseStyle || "cylinder";
  const diameter = clamp(params.vaseDiameter ?? 80, 30, 260);
  const height = clamp(params.vaseHeight ?? 100, 20, 320);
  const floor = clamp(params.vaseFloor ?? 2.4, 1.4, 6);
  const wall = clamp(params.vaseWall ?? 1.6, 1.0, 4);

  const flutes = clamp(Math.round(params.vaseFlutes ?? 0), 0, 36);
  const fluteDepth = flutes ? clamp(params.vaseFluteDepth ?? 2, 0, Math.min(8, diameter * 0.12)) : 0;
  const twistDeg = clamp(params.vaseTwist ?? 0, -360, 360);
  const twistRad = (twistDeg * Math.PI) / 180;

  // Rim finish: square (flat annulus), bevel (45° chamfer), round (bullnose
  // half-circle across the wall) or rolled (outward flare + bullnose).
  // rimDrop = how far below the total height the straight wall stops.
  const rimStyle = ["bevel", "round", "rolled"].includes(params.vaseRim) ? params.vaseRim : "square";
  const rimDrop = rimStyle === "square" ? 0 : rimStyle === "bevel" ? Math.min(wall * 0.45, 1.5) : wall / 2;
  const lipR = rimStyle === "rolled" ? clamp(diameter * 0.045, 2.2, 6) : 0;
  const lipLen = lipR * 2.4;

  // Flutes and twist need finer tessellation to stay smooth.
  let segments = clamp(Math.round(params.vaseSegments ?? 72), 24, 128);
  if (flutes && fluteDepth > 0.01) segments = clamp(Math.max(segments, flutes * 10), 24, 240);
  let layers = clamp(Math.round(params.vaseLayers ?? 24), 6, 96);
  if (Math.abs(twistDeg) > 1) layers = clamp(Math.max(layers, Math.ceil(Math.abs(twistDeg) / 4)), 6, 160);
  if (lipR) layers = clamp(Math.max(layers, Math.ceil(height / 2.5)), 6, 160);

  const textureSpec = resolveVaseTexture(params, { height, floor, diameter });
  ({ segments, layers } = vaseTextureTessellation(textureSpec, diameter, height, segments, layers));

  const baseR = diameter / 2;
  const sampler = profileSampler(style);

  // Flutes fade in above the floor so the base perimeter stays circular
  // (better bed adhesion, clean bottom cap) and reach full depth ~8mm up.
  const fluteDepthAt = (z) => fluteDepth * smoothstep(0, Math.max(floor + 1, 8), z);
  const phaseAtZ = (z) => twistRad * (z / height);
  const outerRadiusAt = (z) =>
    baseR * sampler(clamp(z / height, 0, 1)) +
    (lipR ? lipR * smoothstep(height - lipLen, height, clamp(z, 0, height)) : 0);
  const fluteSpecAt = (z) => ({ count: flutes, depth: fluteDepthAt(z) });
  const outerRingAt = (z, radialOffset = 0) =>
    surfaceRing(
      outerRadiusAt(z) + radialOffset,
      segments,
      z,
      fluteSpecAt(z),
      textureSpec,
      phaseAtZ(z),
    );

  return {
    style, diameter, height, floor, wall, flutes, fluteDepth, twistRad,
    segments, layers, baseR, rimStyle, rimDrop, lipR, textureSpec,
    fluteDepthAt, phaseAtZ, outerRadiusAt, outerRingAt, fluteSpecAt,
  };
}

/**
 * Rim finish sweep from the outer wall top over to the inner wall top.
 * Profile points are [s, z] where s lerps per-vertex from the outer ring (0)
 * to the inner ring (1), so flutes and twist carry through the rim.
 */
function rimSweep(outPos, outIdx, ringO, ringI, zRim, style, wall, height) {
  const prof = [];
  if (style === "bevel") {
    const c = height - zRim;
    const sC = Math.min(0.45, c / wall);
    prof.push([0, zRim], [sC, height], [1 - sC, height], [1, zRim]);
  } else {
    // Bullnose: half-circle of radius wall/2 spanning the wall thickness.
    const rr = height - zRim;
    const N = 10;
    for (let i = 0; i <= N; i++) {
      const a = Math.PI - (i / N) * Math.PI;
      prof.push([0.5 + 0.5 * Math.cos(a), zRim + rr * Math.sin(a)]);
    }
  }
  const ringAt = (s) => ringO.map((p, k) => [p[0] + (ringI[k][0] - p[0]) * s, p[1] + (ringI[k][1] - p[1]) * s]);
  let prev = null;
  let prevZ = 0;
  for (const [s, z] of prof) {
    const ring = ringAt(s);
    if (prev) loftBetween(outPos, outIdx, prev, ring, prevZ, z, true);
    prev = ring;
    prevZ = z;
  }
}

/** Build the vase mesh. */
export function buildVase(params) {
  const drainage = !!params.vaseDrainage;
  const surf = vaseSurface(params);
  const { height, floor, wall, flutes, segments, layers } = surf;

  const layerZ = (i) => (i / (layers - 1)) * height;

  // Inner radius = outer radius - wall thickness (radial offset).
  // Inner surface follows the same flute wave so wall thickness stays
  // constant — required for spiral/vase-mode printing.
  const innerRingAt = (z) => {
    const innerR = Math.max(2, surf.outerRadiusAt(z) - wall);
    const innerDepth = Math.min(surf.fluteDepthAt(z), Math.max(0, (innerR - 2) * 2));
    return surfaceRing(
      innerR,
      segments,
      z,
      { count: flutes, depth: innerDepth },
      surf.textureSpec,
      surf.phaseAtZ(z),
    );
  };

  const positions = [];
  const indices = [];

  const zFloor = floor;
  // Straight walls stop at zRim; the rim finish sweep covers the rest.
  const zRim = height - surf.rimDrop;

  // Outer skin
  let prevO = surf.outerRingAt(0);
  let prevOz = 0;
  for (let i = 1; i < layers; i++) {
    const z = Math.min(layerZ(i), zRim);
    if (z <= prevOz + 0.001) continue;
    const ring = surf.outerRingAt(z);
    loftBetween(positions, indices, prevO, ring, prevOz, z, true);
    prevO = ring;
    prevOz = z;
  }
  if (prevOz < zRim - 0.001) {
    const ring = surf.outerRingAt(zRim);
    loftBetween(positions, indices, prevO, ring, prevOz, zRim, true);
    prevO = ring;
  }

  const ringAtFloor = innerRingAt(zFloor);

  // Inner skin from zFloor up to zRim
  let prevRing = ringAtFloor;
  let prevZ = zFloor;
  for (let i = 0; i < layers; i++) {
    const z = Math.min(layerZ(i), zRim);
    if (z <= prevZ + 0.001) continue;
    const ring = innerRingAt(z);
    loftBetween(positions, indices, prevRing, ring, prevZ, z, false);
    prevRing = ring;
    prevZ = z;
  }
  if (prevZ < zRim - 0.001) {
    const ring = innerRingAt(zRim);
    loftBetween(positions, indices, prevRing, ring, prevZ, zRim, false);
    prevRing = ring;
  }

  const bottomRing = surf.outerRingAt(0);

  // Bottom cap (outside, facing down) — with optional drainage hole
  if (drainage) {
    const rawR = clamp(params.vaseDrainageSize ?? 8, 3, Math.max(4, surf.diameter * 0.35));
    const drainR = Math.min(rawR, surf.outerRadiusAt(0) - wall - 2);
    if (drainR >= 3) {
      // Match outer segment count so capAnnulus / loftBetween line up.
      const drain = ringXY(drainR, segments);
      capAnnulus(positions, indices, bottomRing, drain, 0, false);
      // Drainage bore walls (through floor)
      loftBetween(positions, indices, drain, drain, 0, zFloor, false);
      // Inner floor cap (annulus around drain hole)
      capAnnulus(positions, indices, ringAtFloor, drain, zFloor, true);
    } else {
      capSolid(positions, indices, bottomRing, 0, false);
      capSolid(positions, indices, ringAtFloor, zFloor, true);
    }
  } else {
    capSolid(positions, indices, bottomRing, 0, false);
    capSolid(positions, indices, ringAtFloor, zFloor, true);
  }

  // Rim: flat annulus (square) or a bevel / bullnose sweep to the top.
  if (surf.rimStyle === "square") {
    capAnnulus(positions, indices, prevO, prevRing, zRim, true);
  } else {
    rimSweep(positions, indices, prevO, prevRing, zRim, surf.rimStyle, wall, height);
  }

  return { positions, indices };
}

export function buildVaseSaucer(params) {
  const diameter = clamp(params.vaseDiameter ?? 80, 30, 260);
  const segments = clamp(Math.round(params.vaseSegments ?? 72), 24, 128);
  const outerR = diameter / 2 + 8;
  const innerR = outerR - 3;
  const rimH = 6;
  const floorH = 2.4;
  const outer = ringXY(outerR, segments);
  const inner = ringXY(innerR, segments);
  const bottomFloor = ringXY(outerR - 0.5, segments);
  const positions = [];
  const indices = [];

  capSolid(positions, indices, bottomFloor, 0, false);
  loftBetween(positions, indices, bottomFloor, outer, 0, floorH, true);
  capAnnulus(positions, indices, outer, inner, floorH, false);
  loftBetween(positions, indices, outer, outer, floorH, floorH + rimH, true);
  loftBetween(positions, indices, inner, inner, floorH, floorH + rimH, false);
  capAnnulus(positions, indices, outer, inner, floorH + rimH, true);
  // Inner floor to hold water
  capSolid(positions, indices, inner, floorH, true);

  return { positions, indices };
}

export function vaseMeta(params) {
  const style = params.vaseStyle || "cylinder";
  const diameter = clamp(params.vaseDiameter ?? 80, 30, 260);
  const height = clamp(params.vaseHeight ?? 100, 20, 320);
  const wall = clamp(params.vaseWall ?? 1.6, 1.0, 4);
  const floor = clamp(params.vaseFloor ?? 2.4, 1.4, 6);
  const styleLabel = VASE_STYLES.find((s) => s.id === style)?.label || style;

  const profile = sampleProfile(style, 24);
  const outerR = diameter / 2;
  // Approximate volume by summing frustum slices
  let outerVol = 0;
  let cavityVol = 0;
  for (let i = 0; i < profile.length - 1; i++) {
    const r0 = outerR * profile[i];
    const r1 = outerR * profile[i + 1];
    const dz = (height / (profile.length - 1));
    outerVol += (Math.PI * dz / 3) * (r0 * r0 + r0 * r1 + r1 * r1);
    const ir0 = Math.max(0, r0 - wall);
    const ir1 = Math.max(0, r1 - wall);
    const zBottom = i * dz;
    if (zBottom >= floor) {
      cavityVol += (Math.PI * dz / 3) * (ir0 * ir0 + ir0 * ir1 + ir1 * ir1);
    }
  }
  const materialMl = Math.max(0, (outerVol - cavityVol) / 1000);
  const cavityMl = cavityVol / 1000;

  const flutes = Math.round(params.vaseFlutes ?? 0);
  const fluteDepth = flutes ? clamp(params.vaseFluteDepth ?? 2, 0, Math.min(8, diameter * 0.12)) : 0;
  const textureSpec = resolveVaseTexture(params, { height, floor, diameter });
  const texturePad = textureSpec.style !== "none" ? textureSpec.depth * 0.55 : 0;
  const lipR = params.vaseRim === "rolled" ? clamp(diameter * 0.045, 2.2, 6) : 0;
  const maxR = outerR * Math.max(...profile) + fluteDepth / 2 + texturePad + lipR;
  const outerW = Math.round(maxR * 2 * 10) / 10;
  return {
    shape: "vase",
    styleLabel,
    style,
    inner: { w: outerW - Math.round(wall * 2 * 10) / 10, d: outerW - Math.round(wall * 2 * 10) / 10, h: Math.round((height - floor) * 10) / 10 },
    outer: { w: outerW, d: outerW, h: Math.round(height * 10) / 10 },
    cavityMl: Math.round(cavityMl * 10) / 10,
    materialMl: Math.round(materialMl * 10) / 10,
    estGrams: Math.round(materialMl * 1.24 * 10) / 10,
  };
}

/**
 * Accent colour band hugging the vase outer surface. Follows the profile
 * curve, flutes and twist.
 *
 * Band placement: params.accentPos (0-100, bottom→top) slides the band along
 * the wall; legacy accentFace "floor"/"rim" maps to 0/100.
 *
 * To avoid z-fighting with the body, band slices reuse the body's exact layer
 * rings (the body wall is piecewise-linear between layers, so sampling the
 * smooth analytic surface would cut in and out of it). Rings between layers
 * are per-vertex lerps of the body rings, then pushed radially outward.
 */
export function buildVaseAccentMesh(params) {
  const surf = vaseSurface(params);
  const skin = 0.12;
  const solid = !!params.accentSolid;
  const { height, segments, layers } = surf;
  // Keep the band on the straight wall, below any rim finish sweep.
  const zLimit = height - surf.rimDrop;
  const bandH = Math.min(clamp(params.accentHeight ?? 4, 2, 80), zLimit);
  let pos;
  if (params.accentPos != null) {
    pos = clamp(params.accentPos, 0, 100) / 100;
  } else {
    pos = params.accentFace === "floor" ? 0 : 1;
  }
  const z0 = (zLimit - bandH) * pos;
  const z1 = z0 + bandH;

  // Wavy edge: the whole ribbon shifts up/down sinusoidally around the
  // circumference (both edges in phase, so band height stays constant).
  const wavy = params.accentEdge === "wave";
  const waveAmp = wavy ? clamp(params.accentWaveAmp ?? 3, 0.5, 10) : 0;
  const waveCount = wavy ? clamp(Math.round(params.accentWaveCount ?? 6), 2, 16) : 0;
  const rotRad = ((params.accentRotation ?? 0) * Math.PI) / 180;
  const waveAt = (k) => (wavy ? waveAmp * Math.sin(waveCount * ((k / segments) * Math.PI * 2) + rotRad) : 0);

  // Body outer rings — identical construction to buildVase (outerRingAt
  // includes the rolled-lip flare, so the band tracks it too).
  const layerZ = (i) => (i / (layers - 1)) * height;
  const bodyRing = (i) => surf.outerRingAt(Math.min(layerZ(i), zLimit));
  const ringCache = new Map();
  const bodyRingCached = (i) => {
    let r = ringCache.get(i);
    if (!r) {
      r = bodyRing(i);
      ringCache.set(i, r);
    }
    return r;
  };
  // A radial offset shrinks (measured normal to the wall) where the profile
  // leans — e.g. a goblet's base flare — so scale offsets by the wall slope
  // to keep a constant true distance from the leaning wall.
  const slopeFactorAt = (z) => {
    const zc = clamp(z, 0.5, height - 0.5);
    const slope = Math.abs(surf.outerRadiusAt(zc + 0.5) - surf.outerRadiusAt(zc - 0.5));
    return Math.min(4, Math.hypot(1, slope));
  };
  const skinAt = (z) => Math.min(0.5, skin * slopeFactorAt(z));

  // Twist + flutes make the body's wall quads non-planar, so its triangles
  // bulge outside the ruled (vertex-lerped) surface by up to half the gap
  // between the quad's two diagonals. Both the body and the band can deviate
  // that much, so pad by the full diagonal gap for the straddled layer.
  const sagCache = new Map();
  const sagAt = (i) => {
    let v = sagCache.get(i);
    if (v == null) {
      const A = bodyRingCached(i);
      const B = bodyRingCached(i + 1);
      v = 0;
      for (let k = 0; k < segments; k++) {
        const k2 = (k + 1) % segments;
        const dx = (A[k][0] + B[k2][0] - A[k2][0] - B[k][0]) / 2;
        const dy = (A[k][1] + B[k2][1] - A[k2][1] - B[k][1]) / 2;
        const d = Math.hypot(dx, dy);
        if (d > v) v = d;
      }
      sagCache.set(i, v);
    }
    return v;
  };

  // Body wall point at height z and (possibly fractional) column kf —
  // bilinear on the straddling body layer rings, which stays within the
  // sag pad of the wall triangulation, then pushed radially out.
  // Layer z positions clamp at zLimit (matching the body's rim-clamped
  // lofts), so interpolation uses the actual span, not the uniform spacing.
  const zOfLayer = (i) => Math.min(layerZ(i), zLimit);
  const wallPointAt = (z, kf, radialOffset) => {
    const zc = clamp(z, 0, zLimit);
    const fi = (zc / height) * (layers - 1);
    const i = clamp(Math.floor(fi), 0, layers - 2);
    const zA = zOfLayer(i);
    const zB = zOfLayer(i + 1);
    const t = zB - zA > 1e-9 ? clamp((zc - zA) / (zB - zA), 0, 1) : 0;
    const k = Math.floor(kf) % segments;
    const k2 = (k + 1) % segments;
    const u = kf - Math.floor(kf);
    const A = bodyRingCached(i);
    const B = bodyRingCached(i + 1);
    const ax = A[k][0] + (A[k2][0] - A[k][0]) * u;
    const ay = A[k][1] + (A[k2][1] - A[k][1]) * u;
    const bx = B[k][0] + (B[k2][0] - B[k][0]) * u;
    const by = B[k][1] + (B[k2][1] - B[k][1]) * u;
    const x = ax + (bx - ax) * t;
    const y = ay + (by - ay) * t;
    const r = Math.hypot(x, y) || 1;
    const s = Math.max(0.05, (r + radialOffset(zc, i)) / r);
    return [x * s, y * s, zc];
  };
  const wallPointOut = (z, kf) => wallPointAt(z, kf, (zc, i) => skinAt(zc) + sagAt(i));

  // Slice fractions: band edges, every body layer inside the band, plus
  // dense subdivisions when wavy — the wave crosses body layer kinks
  // diagonally, so short chords are needed to keep the ribbon outside.
  const fs = new Set([0, 1]);
  for (let i = 0; i < layers; i++) {
    const z = layerZ(i);
    if (z > z0 + 0.001 && z < z1 - 0.001) fs.add((z - z0) / bandH);
  }
  const extra = wavy ? Math.max(16, Math.ceil(bandH / 0.5)) : 0;
  for (let i = 1; i < extra; i++) fs.add(i / extra);
  const fracs = [...fs].sort((a, b) => a - b);

  // Steep waves shift z by several mm between adjacent columns, so their
  // horizontal chords would cut across body layer kinks. Subdivide columns
  // until each step's wave delta is small enough to hug the wall.
  const maxWaveStep = wavy ? (waveAmp * waveCount * Math.PI * 2) / segments : 0;
  const sub = Math.max(1, Math.ceil(maxWaveStep / 0.5));
  const cols = segments * sub;
  const waveAtCol = (c) => (wavy ? waveAmp * Math.sin(waveCount * ((c / cols) * Math.PI * 2) + rotRad) : 0);

  // Build slices as 3D rings (per-vertex z includes the wave offset).
  const makeSlices = (radialOffset) =>
    fracs.map((f) =>
      Array.from({ length: cols }, (_, c) => wallPointAt(z0 + bandH * f + waveAtCol(c), c / sub, radialOffset)),
    );
  const layerBump = params.accentOnTop ? 0.22 : 0;
  const outerSlices = makeSlices((zc, i) => skinAt(zc) + sagAt(i) + layerBump);

  const positions = [];
  const indices = [];
  const loftSlices = (slices, outward) => {
    for (let s = 0; s < slices.length - 1; s++) {
      const cur = slices[s];
      const nxt = slices[s + 1];
      for (let c = 0; c < cols; c++) {
        const c2 = (c + 1) % cols;
        if (outward) pushQuad(positions, indices, cur[c], cur[c2], nxt[c2], nxt[c]);
        else pushQuad(positions, indices, cur[c], nxt[c], nxt[c2], cur[c2]);
      }
    }
  };
  loftSlices(outerSlices, true);

  if (!solid) return { positions, indices };

  // Solid band for slicing/printing: the zero-thickness preview skin can't
  // be printed (empty first layer / floating shell in Bambu). The solid's
  // inner surface bites into the body wall so the slicer sees firm overlap,
  // and the top/bottom edges are capped, giving a watertight ring.
  const wall = surf.wall;
  const bite = Math.max(0.3, Math.min(wall - 0.4, 1.0));
  const innerSlices = makeSlices(() => -bite);
  loftSlices(innerSlices, false);
  const capEdge = (out, inn, up) => {
    for (let c = 0; c < cols; c++) {
      const c2 = (c + 1) % cols;
      if (up) pushQuad(positions, indices, out[c], out[c2], inn[c2], inn[c]);
      else pushQuad(positions, indices, out[c], inn[c], inn[c2], out[c2]);
    }
  };
  capEdge(outerSlices[0], innerSlices[0], false);
  capEdge(outerSlices[outerSlices.length - 1], innerSlices[innerSlices.length - 1], true);

  return { positions, indices };
}

export { VASE_TEXTURE_STYLES } from "./vase-textures.js";

export const VASE_DEFAULTS = {
  vaseStyle: "cylinder",
  vaseDiameter: 80,
  vaseHeight: 110,
  vaseWall: 1.6,
  vaseFloor: 2.4,
  vaseDrainage: true,
  vaseDrainageSize: 8,
  vaseSaucerEnabled: false,
  vaseSegments: 72,
  vaseLayers: 24,
  vaseFlutes: 0,
  vaseFluteDepth: 2,
  vaseTwist: 0,
  vaseRim: "square",
  vaseTextureEnabled: false,
  vaseTextureStyle: "ripple",
  vaseTextureDepth: 1.2,
  vaseTextureScale: 14,
  vaseTextureBandLo: 8,
  vaseTextureBandHi: 94,
};
