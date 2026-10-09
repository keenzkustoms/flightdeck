/**
 * Panthers hoodie stubby — 150 mm tall, 65 mm well.
 * Loaded as a solid mesh (not the parametric can cup).
 */
import { weldMeshVertices } from "./stl.js?v=589";

export const HOODIE_STUBBY_STL_URL = "models/hoodie-stubby.stl?v=578";
export const HOODIE_WELL_MM = 65;
export const HOODIE_FLOOR_MM = 5;
/** Same skin as STL Painter — a decal, not a brick. */
export const HOODIE_ART_PROUD_MM = 0.04;

let cache = null;
let loadPromise = null;

function parseBinaryStlPositions(buffer) {
  const dv = new DataView(buffer);
  const nTri = dv.getUint32(80, true);
  if (84 + nTri * 50 !== buffer.byteLength) {
    throw new Error("Hoodie STL is not a valid binary STL");
  }
  const positions = new Float32Array(nTri * 9);
  let off = 84;
  for (let i = 0; i < nTri; i++) {
    off += 12;
    for (let v = 0; v < 9; v++, off += 4) positions[i * 9 + v] = dv.getFloat32(off, true);
    off += 2;
  }
  return positions;
}

function meshBounds(positions) {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i], y = positions[i + 1], z = positions[i + 2];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  return { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] };
}

function sitOnBedCentered(positions) {
  const b = meshBounds(positions);
  const cx = (b.min[0] + b.max[0]) / 2;
  const cy = (b.min[1] + b.max[1]) / 2;
  const cz = b.min[2];
  for (let i = 0; i < positions.length; i += 3) {
    positions[i] -= cx;
    positions[i + 1] -= cy;
    positions[i + 2] -= cz;
  }
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

function chestBandYs(positions, wantFront) {
  const ys = [];
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i], y = positions[i + 1], z = positions[i + 2];
    if (z >= 58 && z <= 102 && Math.abs(x) < 28 && (wantFront ? y < 0 : y > 0)) ys.push(y);
  }
  if (!ys.length) return null;
  ys.sort((a, b) => a - b);
  return wantFront ? ys[Math.floor(ys.length * 0.12)] : ys[Math.floor(ys.length * 0.88)];
}

function chestFrontY(positions) {
  return chestBandYs(positions, true);
}

function buildSurfaceHeightfield(positions, indices, side) {
  const front = side === "front";
  const xMin = -52, xMax = 52, zMin = 8, zMax = 148;
  const nx = 96, nz = 128;
  const empty = front ? Infinity : -Infinity;
  const best = new Float32Array(nx * nz);
  best.fill(empty);
  const bandY = chestBandYs(positions, front);
  const wellR = HOODIE_WELL_MM / 2;
  const yCut = front
    ? (Number.isFinite(bandY) ? bandY + 8 : 0)
    : wellR + 3;
  const splat = (x, y, z) => {
    if (front ? !(y < yCut) : !(y > yCut)) return;
    const ix = Math.round((x - xMin) / (xMax - xMin) * (nx - 1));
    const iz = Math.round((z - zMin) / (zMax - zMin) * (nz - 1));
    if (ix < 0 || iz < 0 || ix >= nx || iz >= nz) return;
    const k = iz * nx + ix;
    if (front ? y < best[k] : y > best[k]) best[k] = y;
  };
  if (indices?.length) {
    for (let t = 0; t < indices.length; t += 3) {
      const ia = indices[t] * 3, ib = indices[t + 1] * 3, ic = indices[t + 2] * 3;
      const ax = positions[ia], ay = positions[ia + 1], az = positions[ia + 2];
      const bx = positions[ib], by = positions[ib + 1], bz = positions[ib + 2];
      const cx = positions[ic], cy = positions[ic + 1], cz = positions[ic + 2];
      const e1x = bx - ax, e1z = bz - az;
      const e2x = cx - ax, e2z = cz - az;
      const ny = e1z * e2x - e1x * e2z;
      if (front) {
        if (!(ny < 0)) continue;
      } else {
        if (!(ny > 0)) continue;
        if ((ay + by + cy) / 3 <= yCut) continue;
      }
      splat(ax, ay, az);
      splat(bx, by, bz);
      splat(cx, cy, cz);
    }
  } else {
    for (let i = 0; i < positions.length; i += 3) splat(positions[i], positions[i + 1], positions[i + 2]);
  }
  const isFilled = (v) => Number.isFinite(v) && v !== empty;
  for (let pass = 0; pass < 16; pass++) {
    let filledAny = false;
    for (let iz = 0; iz < nz; iz++) {
      for (let ix = 0; ix < nx; ix++) {
        const k = iz * nx + ix;
        if (isFilled(best[k])) continue;
        let acc = 0, n = 0;
        for (let dz = -1; dz <= 1; dz++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dz) continue;
            const jx = ix + dx, jz = iz + dz;
            if (jx < 0 || jz < 0 || jx >= nx || jz >= nz) continue;
            const v = best[jz * nx + jx];
            if (isFilled(v)) {
              acc += v;
              n++;
            }
          }
        }
        if (n) {
          best[k] = acc / n;
          filledAny = true;
        }
      }
    }
    if (!filledAny) break;
  }
  // Same pocket-close blur as the chest so back text is the same class of stamp.
  for (let pass = 0; pass < 5; pass++) {
      const next = new Float32Array(best);
      for (let iz = 0; iz < nz; iz++) {
        for (let ix = 0; ix < nx; ix++) {
          let acc = 0, n = 0;
          for (let dz = -1; dz <= 1; dz++) {
            for (let dx = -1; dx <= 1; dx++) {
              const jx = ix + dx, jz = iz + dz;
              if (jx < 0 || jz < 0 || jx >= nx || jz >= nz) continue;
              const v = best[jz * nx + jx];
              if (!isFilled(v)) continue;
              acc += v;
              n++;
            }
          }
          if (n) next[iz * nx + ix] = acc / n;
        }
      }
      best.set(next);
    }
  return { y: best, xMin, xMax, zMin, zMax, nx, nz, side, ySkin: bandY };
}

function buildChestHeightfield(positions, indices) {
  return buildSurfaceHeightfield(positions, indices, "front");
}

function finiteFieldY(v, empty) {
  return Number.isFinite(v) && v !== empty ? v : null;
}

function sampleSurfaceY(field, x, z) {
  if (!field) return null;
  const { y, xMin, xMax, zMin, zMax, nx, nz } = field;
  const empty = field.side === "back" ? -Infinity : Infinity;
  const pick = field.side === "back" ? Math.max : Math.min;
  const fx = (x - xMin) / (xMax - xMin) * (nx - 1);
  const fz = (z - zMin) / (zMax - zMin) * (nz - 1);
  if (fx < 0 || fz < 0 || fx > nx - 1 || fz > nz - 1) return null;
  const x0 = Math.floor(fx), z0 = Math.floor(fz);
  const x1 = Math.min(nx - 1, x0 + 1), z1 = Math.min(nz - 1, z0 + 1);
  const tx = fx - x0, tz = fz - z0;
  const v00 = finiteFieldY(y[z0 * nx + x0], empty);
  const v10 = finiteFieldY(y[z0 * nx + x1], empty);
  const v01 = finiteFieldY(y[z1 * nx + x0], empty);
  const v11 = finiteFieldY(y[z1 * nx + x1], empty);
  const vals = [v00, v10, v01, v11];
  if (vals.some((v) => v == null)) {
    const ok = vals.filter((v) => v != null);
    return ok.length ? pick(...ok) : null;
  }
  const v0 = v00 * (1 - tx) + v10 * tx;
  const v1 = v01 * (1 - tx) + v11 * tx;
  return v0 * (1 - tz) + v1 * tz;
}

export function sampleHoodieChestY(field, x, z) {
  return sampleSurfaceY(field, x, z);
}

export function sampleHoodieBackY(field, x, z) {
  return sampleSurfaceY(field, x, z);
}

function metaFromMesh(positions) {
  const b = meshBounds(positions);
  const w = b.max[0] - b.min[0];
  const d = b.max[1] - b.min[1];
  const h = b.max[2] - b.min[2];
  const innerH = Math.max(5, h - HOODIE_FLOOR_MM);
  const cavityMl = (Math.PI * (HOODIE_WELL_MM / 2) ** 2 * innerH) / 1000;
  const outerMl = (w * d * h) / 1000;
  const materialMl = Math.max(0, outerMl - cavityMl);
  const chestY = chestFrontY(positions);
  const backY = chestBandYs(positions, false);
  return {
    shape: "stubbyHolder",
    inner: { w: HOODIE_WELL_MM, d: HOODIE_WELL_MM, h: round1(innerH) },
    outer: { w: round1(w), d: round1(d), h: round1(h) },
    cavityMl: round1(cavityMl),
    materialMl: round1(materialMl),
    estGrams: round1(materialMl * 1.24),
    styleLabel: "Hoodie container",
    chestY: chestY == null ? undefined : round1(chestY),
    backY: backY == null ? undefined : round1(backY),
  };
}

function meshFromStlBuffer(buffer) {
  const flat = parseBinaryStlPositions(buffer);
  const nVerts = flat.length / 3;
  const naive = new Array(nVerts);
  for (let i = 0; i < nVerts; i++) naive[i] = i;
  const diagonal = (() => {
    const b = meshBounds(flat);
    return Math.hypot(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]) || 1;
  })();
  const welded = weldMeshVertices(Array.from(flat), naive, diagonal * 1e-5);
  const positions = welded.positions instanceof Float32Array
    ? welded.positions
    : Float32Array.from(welded.positions);
  const indices = welded.indices instanceof Uint32Array
    ? welded.indices
    : Uint32Array.from(welded.indices);
  sitOnBedCentered(positions);
  return {
    positions,
    indices,
    meta: metaFromMesh(positions),
    chestField: buildChestHeightfield(positions, indices),
    backField: buildSurfaceHeightfield(positions, indices, "back"),
  };
}

export function getHoodieStubbyCache() {
  return cache;
}

export async function ensureHoodieStubbyMesh() {
  if (cache?.mesh?.positions?.length) return cache;
  if (!loadPromise) {
    loadPromise = (async () => {
      const res = await fetch(HOODIE_STUBBY_STL_URL, { cache: "no-store" });
      if (!res.ok) throw new Error(`Could not load hoodie container (${res.status})`);
      const buffer = await res.arrayBuffer();
      const loaded = meshFromStlBuffer(buffer);
      cache = {
        mesh: { positions: loaded.positions, indices: loaded.indices },
        meta: loaded.meta,
        chestField: loaded.chestField,
        backField: loaded.backField,
      };
      return cache;
    })();
  }
  try {
    return await loadPromise;
  } catch (err) {
    loadPromise = null;
    throw err;
  }
}
