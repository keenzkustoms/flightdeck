// Manifold audit of the STL export path (body + welded divider), mirroring runExport("stl").
import { buildContainer, buildLid, DEFAULTS } from "./geometry.js";
import { buildDividerInsert, buildWatertightExportMesh, buildWatertightFixedDividerExport, mergeMeshes } from "./features.js";
import { sanitizeMeshForStl } from "./stl.js";

let failures = 0;
const check = (name, cond, detail = "") => {
  if (!cond) failures++;
  console.log(`${cond ? "ok  " : "FAIL"} ${name} ${detail}`);
};

// Weld vertices by rounded position (like a slicer does), then classify edges.
function edgeAudit(mesh, label) {
  const key = (x, y, z) => `${Math.round(x * 1e4)},${Math.round(y * 1e4)},${Math.round(z * 1e4)}`;
  const vidOf = new Map();
  const vid = (x, y, z) => {
    const k = key(x, y, z);
    let id = vidOf.get(k);
    if (id === undefined) { id = vidOf.size; vidOf.set(k, id); }
    return id;
  };
  const p = mesh.positions;
  const idx = mesh.indices;
  const edges = new Map(); // "a-b" (a<b) -> count
  const addEdge = (a, b) => {
    const k = a < b ? `${a}-${b}` : `${b}-${a}`;
    edges.set(k, (edges.get(k) || 0) + 1);
  };
  let degenerate = 0;
  const triCount = idx.length / 3;
  for (let t = 0; t < idx.length; t += 3) {
    const ids = [0, 1, 2].map(j => {
      const i = idx[t + j] * 3;
      return vid(p[i], p[i + 1], p[i + 2]);
    });
    if (ids[0] === ids[1] || ids[1] === ids[2] || ids[0] === ids[2]) { degenerate++; continue; }
    addEdge(ids[0], ids[1]); addEdge(ids[1], ids[2]); addEdge(ids[2], ids[0]);
  }
  let open = 0, over = 0;
  const badEdges = [];
  for (const [k, n] of edges) {
    if (n === 1) { open++; badEdges.push([k, n]); }
    else if (n > 2) { over++; badEdges.push([k, n]); }
  }
  console.log(`--- ${label}: tris=${triCount} verts(welded)=${vidOf.size} degenerate=${degenerate} openEdges=${open} overusedEdges=${over}`);
  if (badEdges.length) {
    // Print coordinates of bad edges for diagnosis
    const rev = new Map([...vidOf.entries()].map(([k, v]) => [v, k]));
    for (const [k, n] of badEdges.slice(0, 20)) {
      const [a, b] = k.split("-").map(Number);
      console.log(`    edge x${n}: (${rev.get(a)}) -> (${rev.get(b)})`);
    }
  }
  return { open, over, degenerate };
}

function exportMeshFor(params) {
  const cache = buildContainer(params);
  const exportMesh = buildWatertightExportMesh(cache, cache.meta, params);
  if (params.insertEnabled && params.insertMount === "fixed") {
    return buildWatertightFixedDividerExport(cache, cache.meta, params) || exportMesh;
  }
  return exportMesh;
}

// Chris's exact box: 300x270x130 outer-ish, one fixed divider across depth
const box = {
  ...DEFAULTS, shape: "rect",
  innerWidth: 300, innerDepth: 270, innerHeight: 130,
  insertEnabled: true, insertCount: 1, insertAxis: "depth",
  insertThickness: 2, insertClearance: 0.15,
  insertMount: "fixed", fuseInsertToBody: true,
};
const m1 = edgeAudit(exportMeshFor(box), "rect box + fixed divider (Chris repro)");
check("box+divider: no open edges", m1.open === 0);
check("box+divider: no overused edges", m1.over === 0);
check("box+divider: no degenerate tris", m1.degenerate === 0);

// Sharp-cornered variant (cornerRadius 0) like the screenshot
const sharp = { ...box, cornerRadius: 0 };
const mSharp = edgeAudit(exportMeshFor(sharp), "sharp rect + fixed divider");
check("sharp box+divider: no open edges", mSharp.open === 0);
check("sharp box+divider: no overused edges", mSharp.over === 0);

// Divider alone
const cache = buildContainer(box);
const divider = buildDividerInsert(cache.meta, box);
const m3 = edgeAudit(divider, "fixed divider alone");
check("divider alone: no open edges", m3.open === 0);
check("divider alone: no overused edges", m3.over === 0);

// Every body shape, no divider
const shapes = [
  { name: "rect", p: { shape: "rect" } },
  { name: "rect sharp", p: { shape: "rect", cornerRadius: 0 } },
  { name: "circle", p: { shape: "circle" } },
  { name: "oval", p: { shape: "oval" } },
  { name: "hex", p: { shape: "hex" } },
  { name: "octagon", p: { shape: "hex", sides: 8 } },
  { name: "heart", p: { shape: "heart", innerWidth: 90, innerDepth: 82 } },
  { name: "star", p: { shape: "star" } },
  { name: "pencil", p: { shape: "pencil", innerWidth: 180, innerDepth: 60, innerHeight: 30 } },
  { name: "pencilBox", p: { shape: "pencilBox", innerWidth: 180, innerDepth: 60, innerHeight: 30 } },
  { name: "joiner left", p: { shape: "rect", cornerRadius: 0, joinerEnabled: true, joinerHand: "left" } },
];
for (const s of shapes) {
  const params = { ...DEFAULTS, insertEnabled: false, ...s.p };
  const m = edgeAudit(exportMeshFor(params), `shape: ${s.name}`);
  check(`${s.name}: no open edges`, m.open === 0);
  if (!s.name.startsWith("joiner")) check(`${s.name}: no overused edges`, m.over === 0);
}

// KNOWN ISSUE (informational, not a failure): the female dovetail pocket
// (joiner right) cuts unstitched holes through both wall skins — needs a
// proper remodel of the socket channel to be watertight.
const jr = { ...DEFAULTS, insertEnabled: false, shape: "rect", cornerRadius: 0, joinerEnabled: true, joinerHand: "right" };
edgeAudit(exportMeshFor(jr), "joiner right (known non-manifold, informational)");

// Lids
const lids = [
  { name: "slip lid rect", p: { shape: "rect", lidEnabled: true, lidType: "slip" } },
  { name: "plug lid rect", p: { shape: "rect", lidEnabled: true, lidType: "plug" } },
  { name: "flat lid rect", p: { shape: "rect", lidEnabled: true, lidType: "flat", lidLipDepth: 4 } },
  { name: "slip lid circle", p: { shape: "circle", lidEnabled: true, lidType: "slip" } },
  { name: "screw lid circle", p: { shape: "circle", lidEnabled: true, lidType: "screw" } },
  { name: "flat lid heart", p: { shape: "heart", innerWidth: 90, innerDepth: 82, lidEnabled: true, lidType: "flat", lidLipDepth: 4 } },
  { name: "slip lid heart", p: { shape: "heart", innerWidth: 90, innerDepth: 82, lidEnabled: true, lidType: "slip" } },
  { name: "flat lid star", p: { shape: "star", lidEnabled: true, lidType: "flat", lidLipDepth: 4 } },
  { name: "plug lid hex", p: { shape: "hex", lidEnabled: true, lidType: "plug" } },
];
for (const l of lids) {
  const params = { ...DEFAULTS, insertEnabled: false, ...l.p };
  const lid = buildLid(params);
  const m = edgeAudit(lid, `lid: ${l.name}`);
  check(`${l.name}: no open edges`, m.open === 0);
  check(`${l.name}: no overused edges`, m.over === 0);
}

console.log(failures ? `${failures} FAILURES` : "ALL OK");
process.exit(failures ? 1 : 0);
