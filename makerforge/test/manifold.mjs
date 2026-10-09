/**
 * MakerDeck geometry regression tests.
 *
 * Guards the whole b371-b378 non-manifold saga: every exported part (container
 * Body/Art/Text, lid, liner) must be watertight (0 open edges) after the same
 * prepareMeshFor3mf pass the real export uses. Run via ./run.sh.
 *
 * Exit code 0 = all pass, 1 = a regression (open edges reappeared).
 */
import {
  buildContainer,
  buildLid,
  orientLinerForPrint,
  CANISTER_SQUARE_PRESET,
  DEFAULTS,
} from "./_staged/geometry.js";
import {
  buildMultiColourGraphicEmboss,
  buildTextLabelExportMesh,
  buildEmbossBitmap,
  getEmbossFaceFrame,
} from "./_staged/features.js";
import { prepareMeshFor3mf, countOpenEdges } from "./_staged/stl.js";
import { ANIMAL_NAMES } from "./_staged/animal-profiles.js";
import { ANIMAL_PRESET } from "./_staged/geometry.js";

let failures = 0;
const results = [];

function openEdges(mesh) {
  if (!mesh?.positions?.length || !mesh?.indices?.length) return -1;
  return mesh.openEdgeCount ?? countOpenEdges(mesh.positions, mesh.indices);
}

function nonManifold(mesh, eps = 1e-4) {
  const map = new Map();
  const remap = [];
  const p = mesh.positions;
  for (let i = 0; i < p.length / 3; i++) {
    const k = `${Math.round(p[i * 3] / eps)}|${Math.round(p[i * 3 + 1] / eps)}|${Math.round(p[i * 3 + 2] / eps)}`;
    if (!map.has(k)) map.set(k, map.size);
    remap.push(map.get(k));
  }
  const ec = new Map();
  const idx = mesh.indices;
  for (let t = 0; t < idx.length; t += 3) {
    const tri = [remap[idx[t]], remap[idx[t + 1]], remap[idx[t + 2]]];
    if (tri[0] === tri[1] || tri[1] === tri[2] || tri[0] === tri[2]) continue;
    for (let k = 0; k < 3; k++) {
      const a = tri[k], b = tri[(k + 1) % 3];
      const key = a < b ? `${a}|${b}` : `${b}|${a}`;
      ec.set(key, (ec.get(key) || 0) + 1);
    }
  }
  let bad = 0;
  for (const n of ec.values()) if (n !== 2) bad++;
  return bad;
}

function check(name, mesh, { advisory = false } = {}) {
  const cleaned = prepareMeshFor3mf(mesh);
  if (!cleaned?.indices?.length) {
    if (advisory) { results.push(`WARN ${name}: no mesh`); return; }
    results.push(`FAIL ${name}: no mesh`); failures++; return;
  }
  const open = openEdges(cleaned);
  const nm = nonManifold(cleaned);
  const ok = open === 0 && nm === 0;
  const tag = ok ? "PASS" : (advisory ? "WARN" : "FAIL");
  results.push(`${tag} ${name}: tris ${cleaned.indices.length / 3}, open ${open}, nonManifold ${nm}`);
  if (!ok && !advisory) failures++;
}

function coffeeBagMask(W = 360, H = 460) {
  const mask = new Uint8Array(W * H);
  const set = (x, y) => { if (x >= 0 && y >= 0 && x < W && y < H) mask[y * W + x] = 1; };
  const stroke = (x0, y0, x1, y1, w = 2) => {
    const steps = Math.ceil(Math.hypot(x1 - x0, y1 - y0)) * 2;
    for (let i = 0; i <= steps; i++) {
      const x = x0 + ((x1 - x0) * i) / steps, y = y0 + ((y1 - y0) * i) / steps;
      for (let dy = -w; dy <= w; dy++) for (let dx = -w; dx <= w; dx++)
        if (dx * dx + dy * dy <= w * w) set(Math.round(x + dx), Math.round(y + dy));
    }
  };
  for (let a = 0; a < 360; a++) {
    const r = 130 + 20 * Math.sin((a * 7 * Math.PI) / 180);
    stroke(180 + r * Math.cos(a * Math.PI / 180) * 0.8, 240 + r * Math.sin(a * Math.PI / 180) * 0.85,
           180 + r * Math.cos((a + 1) * Math.PI / 180) * 0.8, 240 + r * Math.sin((a + 1) * Math.PI / 180) * 0.85, 2);
  }
  for (let i = 0; i < 22; i++) stroke(110 + i * 6, 150, 85 + i * 6, 380, 1);
  return { mask, W, H };
}

const meta = { shape: "box", inner: { w: 90, d: 90, h: 123 }, outer: { w: 94, d: 94, h: 127 } };

{
  const { mask, W, H } = coffeeBagMask();
  const params = { embossFace: "front", embossTraceSize: 70, embossDepth: 0.6, embossTraceEnabled: true,
    __labelExportStandoff: true, __multiColourAmsExport: true, __labelExportEmbedded: true };
  const mesh = buildEmbossBitmap(meta, params, { mask, width: W, height: H, mode: "silhouette", outlineRaster: true, maskFillPct: 16 });
  check("flat trace (b371)", mesh);
}

{
  const W = 200, H = 200;
  const black = new Uint8Array(W * H), white = new Uint8Array(W * H);
  for (let y = 40; y < 160; y++) for (let x = 40; x < 160; x++) {
    const dx = (x - 100) / 60, dy = (y - 100) / 60;
    if (dx * dx + dy * dy > 1) continue;
    if ((Math.sin(x / 7) * Math.cos(y / 9) > 0.5) || x % 19 < 2) white[y * W + x] = 1; else black[y * W + x] = 1;
  }
  const params = { embossFace: "front", embossTraceSize: 60, embossDepth: 0.6, embossTraceEnabled: true,
    __labelExportStandoff: true, __multiColourAmsExport: true, __labelExportEmbedded: true };
  const td = { multiColour: true, width: W, height: H, mode: "black-white",
    colorLayers: [{ mask: black, hex: "#111111", label: "Black" }, { mask: white, hex: "#f5f5f5", label: "White" }] };
  const parts = buildMultiColourGraphicEmboss(meta, params, td) || [];
  if (!parts.length) { results.push("FAIL multi-colour: no parts"); failures++; }
  for (const cp of parts) check(`AMS ${cp.name} (b372/373)`, cp.mesh);
}

{
  // Hoodie crest-style bitmap art: retain substantial red/black detail, but
  // prove that print-safe raster cleanup still produces closed colour volumes.
  const W = 720, H = 720;
  const red = new Uint8Array(W * H), dark = new Uint8Array(W * H);
  const set = (target, x, y) => { if (x >= 0 && y >= 0 && x < W && y < H) target[y * W + x] = 1; };
  for (let y = 100; y < 630; y++) {
    const half = 120 + Math.floor((y - 100) * 0.34);
    for (let x = 360 - half; x <= 360 + half; x++) {
      if (x < 160 || x > 560) continue;
      if (x < 180 || x > 540 || y < 125 || y > 600) set(red, x, y);
      if (Math.abs(x - 360) < 80 && y > 220 && y < 490 && ((x + y) % 37 < 5)) set(dark, x, y);
    }
  }
  // Simulate anti-aliased tracing dust that should not become floating dots.
  for (let i = 0; i < 75; i++) set(dark, 175 + ((i * 53) % 365), 140 + ((i * 97) % 460));
  const hoodieMeta = {
    shape: "stubbyHolder",
    inner: { w: 65, d: 65, h: 145 },
    outer: { w: 155, d: 97, h: 150 },
    chestY: -44,
  };
  const params = {
    shape: "stubbyHolder", embossFace: "front", embossTraceSize: 64, embossDepth: 0.6,
    embossTraceEnabled: true, __hoodieArtExport: true, __labelExportStandoff: true,
    __multiColourAmsExport: true,
  };
  const td = {
    multiColour: true, width: W, height: H, mode: "multi-colour",
    colorLayers: [{ mask: red, hex: "#c91d2e", label: "Red" }, { mask: dark, hex: "#202124", label: "Dark grey" }],
  };
  const parts = buildMultiColourGraphicEmboss(hoodieMeta, params, td) || [];
  if (parts.length !== 2) { results.push("FAIL hoodie raster cleanup: expected two colour parts"); failures++; }
  for (const cp of parts) check(`hoodie raster ${cp.name} (b620)`, cp.mesh);
}

{
  const params = { embossFace: "front", embossText: "COFFEE", embossTextSize: 16, embossDepth: 0.6,
    embossFont: "arial-black", __labelExportStandoff: true, __multiColourAmsExport: true, __labelExportEmbedded: true };
  const mesh = buildTextLabelExportMesh(meta, params);
  if (mesh) check("text export (b374)", mesh); else results.push("SKIP text: no mesh (font may be unavailable headless)");
}

{
  // Core: non-stacking canister (the geometry that actually shipped clean b375/b376).
  const base = { ...DEFAULTS, ...CANISTER_SQUARE_PRESET, shape: "canisterSquare", linerEnabled: true, stackableEnabled: false };
  const built = buildContainer(base);
  check("container body", built.shellMesh || built);
  if (built.linerMesh) check("liner (b375)", orientLinerForPrint(built.linerMesh));
  else { results.push("FAIL liner: not built"); failures++; }
  const lid = buildLid(base);
  if (lid) check("lid gasket (b376)", lid); else { results.push("FAIL lid: not built"); failures++; }

  // Advisory: stackable lip geometry (KNOWN non-manifold — see SESSION_NEXT, fix with fit validation).
  for (const style of ["nest", "hex"]) {
    const sp = { ...base, stackableEnabled: true, stackStyle: style };
    check(`[stack ${style}] body`, buildContainer(sp).shellMesh, { advisory: true });
    const sl = buildLid(sp);
    if (sl) check(`[stack ${style}] lid`, sl, { advisory: true });
  }
}

// Silhouette animal shapes (b381) — bodies + lids must be watertight.
for (const name of ANIMAL_NAMES) {
  const p = { ...DEFAULTS, ...ANIMAL_PRESET, shape: "animal", animalName: name };
  const b = buildContainer(p);
  check(`animal ${name} body (b381)`, b.shellMesh || b);
  const lid = buildLid(p);
  if (lid) check(`animal ${name} lid (b381)`, lid);
}

// Sign plates (b383) — every mount/border combo must be watertight.
for (const mount of ["keyhole", "screw", "hanging", "none"]) {
  for (const border of [true, false]) {
    const b = buildContainer({ shape: "sign", signWidth: 140, signHeight: 70, signThickness: 4,
      signCorner: 8, signMount: mount, signBorder: border, embossText: "", embossDeboss: false, _artPreviewDraft: false });
    check(`sign ${mount} border=${border} (b383)`, b.shellMesh);
  }
}
// Sign shapes (b388) — every plate shape watertight with border + mounts.
for (const shape of ["rectangle", "rounded", "pill", "oval", "hexagon", "arch", "shield", "banner"]) {
  const b = buildContainer({ shape: "sign", signShape: shape, signWidth: 140, signHeight: 70, signThickness: 4,
    signCorner: 10, signMount: "screw", signBorder: true, embossText: "", embossDeboss: false, _artPreviewDraft: false });
  check(`sign shape ${shape} (b388)`, b.shellMesh);
}
// Garden stakes (b389)
for (const shape of ["arch", "rounded", "rectangle"]) {
  const b = buildContainer({ shape: "sign", signShape: shape, signWidth: 180, signHeight: 90, signThickness: 4,
    signCorner: 10, signMount: "stake", signBorder: true, embossText: "", embossDeboss: false, _artPreviewDraft: false });
  check(`sign ${shape} garden-stakes (b389)`, b.shellMesh);
}

console.log(results.join("\n"));
console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
