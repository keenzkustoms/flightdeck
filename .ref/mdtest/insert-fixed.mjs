import { buildContainer, DEFAULTS } from "./geometry.js";
import { buildDividerInsert } from "./features.js";

let failures = 0;
const check = (name, cond, detail = "") => {
  if (!cond) failures++;
  console.log(`${cond ? "ok  " : "FAIL"} ${name} ${detail}`);
};

function bounds(mesh) {
  const b = { minX: 1e9, maxX: -1e9, minY: 1e9, maxY: -1e9, minZ: 1e9, maxZ: -1e9 };
  for (let i = 0; i < mesh.positions.length; i += 3) {
    b.minX = Math.min(b.minX, mesh.positions[i]); b.maxX = Math.max(b.maxX, mesh.positions[i]);
    b.minY = Math.min(b.minY, mesh.positions[i + 1]); b.maxY = Math.max(b.maxY, mesh.positions[i + 1]);
    b.minZ = Math.min(b.minZ, mesh.positions[i + 2]); b.maxZ = Math.max(b.maxZ, mesh.positions[i + 2]);
  }
  return b;
}

const base = {
  ...DEFAULTS, shape: "rect", innerWidth: 80, innerDepth: 60, innerHeight: 40,
  insertEnabled: true, insertCount: 1, insertAxis: "depth", insertThickness: 2, insertClearance: 0.15,
};

const cache = buildContainer(base);
const meta = cache.meta;

// Snap fit: panel floats inside cavity with clearance on all sides
const snap = buildDividerInsert(meta, { ...base, insertMount: "snap", fuseInsertToBody: false });
const sb = bounds(snap);
check("snap: clear of walls", sb.maxX < meta.inner.w / 2 - 0.2, `maxX=${sb.maxX.toFixed(2)} innerHalf=${(meta.inner.w / 2).toFixed(2)}`);
check("snap: floats above floor", sb.minZ > 2.0, `minZ=${sb.minZ.toFixed(2)}`);

// Fixed (welded): panel flush with inner walls and floor — merged into body for export
const fixed = buildDividerInsert(meta, { ...base, insertMount: "fixed", fuseInsertToBody: true });
const fb = bounds(fixed);
check("fixed: spans inner width", fb.maxX >= meta.inner.w / 2 - 0.01 && fb.minX <= -meta.inner.w / 2 + 0.01, `maxX=${fb.maxX.toFixed(2)} innerHalf=${(meta.inner.w / 2).toFixed(2)}`);
check("fixed: sits on floor", Math.abs(fb.minZ - (meta.outer.h - meta.inner.h)) < 0.05, `minZ=${fb.minZ.toFixed(2)} floor=${(meta.outer.h - meta.inner.h).toFixed(2)}`);
check("fixed: below cavity top", fb.maxZ <= meta.outer.h, `maxZ=${fb.maxZ.toFixed(2)} outerH=${meta.outer.h}`);

// Length axis too
const fixedL = buildDividerInsert(meta, { ...base, insertAxis: "length", insertMount: "fixed", fuseInsertToBody: true });
const fl = bounds(fixedL);
check("fixed length axis: spans inner depth", fl.maxY >= meta.inner.d / 2 - 0.01, `maxY=${fl.maxY.toFixed(2)} innerHalf=${(meta.inner.d / 2).toFixed(2)}`);

console.log(failures ? `${failures} FAILURES` : "ALL OK");
process.exit(failures ? 1 : 0);
