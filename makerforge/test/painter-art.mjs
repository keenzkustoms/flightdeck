/**
 * Painter SVG stamp — planar projection must paint the facing patch and skip the back.
 */
import { collectStampHits, collectStampLayerHits, makeStampFrame, mirrorStampFrameX, nearestSlot, parseHexColor, extractSvgFillHexes, stampSizeMm, knockOutPaperBackground, rasterHasAlpha, extractRasterPalette, isSvgArtFile, isRasterArtFile, buildStampSlabs, stampLayersFromTrace, buildStampSlabsFromMasks, scrubTraceMat, isTraceMatLayer, floodBorderBackground, clipLayersToInkIsland, punchExteriorPaper, sampleStampSurfaceLift } from "./_staged/painter-art.js";
import { export3MF, import3MF } from "../js/painter.js";

let failures = 0;
const results = [];

function check(name, cond, detail = "") {
  if (cond) results.push(`ok   ${name}`);
  else { results.push(`FAIL ${name}${detail ? " — " + detail : ""}`); failures++; }
}

// Two disjoint triangles on z=0, facing +Z — left patch vs right patch
const verts = new Float32Array([
  -8, -4, 0,  -2, -4, 0,  -5, 4, 0,
   2, -4, 0,   8, -4, 0,   5, 4, 0,
  -1, 0, 0,    9, -3, 0,   9, 3, 0,
]);
const faces = new Uint32Array([0, 1, 2, 3, 4, 5, 6, 7, 8]);

// 4×4 raster: left half red opaque, right half transparent
const imgW = 4, imgH = 4;
const pixels = new Uint8ClampedArray(imgW * imgH * 4);
for (let y = 0; y < imgH; y++) {
  for (let x = 0; x < imgW; x++) {
    const o = (y * imgW + x) * 4;
    if (x < 2) { pixels[o] = 200; pixels[o + 3] = 255; }
  }
}

const frame = makeStampFrame([0, 0, 0], [0, 0, 1], 0);
const hits = collectStampHits({
  verts, faces, nTri: 3,
  ...frame,
  widthMm: 20, heightMm: 20,
  pixels, imgW, imgH,
});

check("left triangle paints", hits.some((h) => h.face === 0), `hits=${hits.map((h) => h.face).join(",")}`);
check("right triangle skipped", !hits.some((h) => h.face === 1), `hits=${hits.map((h) => h.face).join(",")}`);
check("grazing vertex does not paint", !hits.some((h) => h.face === 2), `hits=${hits.map((h) => h.face).join(",")}`);
check("painted pixel is red", hits[0]?.r === 200, `r=${hits[0]?.r}`);

const back = makeStampFrame([0, 0, 0], [0, 0, -1], 0);
const backHits = collectStampHits({
  verts, faces, nTri: 2,
  ...back,
  widthMm: 20, heightMm: 20,
  pixels, imgW, imgH,
});
check("back-facing stamp paints nothing", backHits.length === 0, `n=${backHits.length}`);

const far = makeStampFrame([80, 0, 0], [0, 0, 1], 0);
const farHits = collectStampHits({
  verts, faces, nTri: 2,
  ...far,
  widthMm: 20, heightMm: 20,
  pixels, imgW, imgH,
});
check("stamp far from mesh paints nothing", farHits.length === 0, `n=${farHits.length}`);

const mir = mirrorStampFrameX(makeStampFrame([5, 0, 0], [0, 0, 1], 0), 0);
check("mirror X flips origin", Math.abs(mir.origin[0] - (-5)) < 1e-9, `ox=${mir.origin[0]}`);
check("mirror X flips right.x", mir.right[0] < 0);

const slot = nearestSlot([200, 0, 0], [[176, 176, 176], [12, 12, 12], [200, 0, 0]]);
check("nearest slot picks red", slot.slot === 2);

const fills = extractSvgFillHexes('<svg><path fill="#C20820"/><path fill="#131211"/></svg>');
check("extract two fills", fills.length === 2 && fills[0] === "#c20820", fills.join(","));

const size = stampSizeMm(40, 2);
check("aspect keeps height", Math.abs(size.heightMm - 20) < 1e-9, `h=${size.heightMm}`);

check("svg file detect", isSvgArtFile({ name: "logo.SVG", type: "" }));
check("png file detect", isRasterArtFile({ name: "nrl.png", type: "image/png" }));
check("jpg file detect", isRasterArtFile({ name: "panthers.jpg", type: "image/jpeg" }));
check("stl is not art", !isRasterArtFile({ name: "hoodie.stl", type: "" }) && !isSvgArtFile({ name: "hoodie.stl", type: "" }));

const paper = new Uint8ClampedArray(8);
paper[0] = 255; paper[1] = 255; paper[2] = 255; paper[3] = 255;
paper[4] = 192; paper[5] = 0; paper[6] = 0; paper[7] = 255;
check("jpg has no alpha", !rasterHasAlpha(paper));
knockOutPaperBackground(paper);
check("knockout clears white", paper[3] === 0, `a=${paper[3]}`);
check("knockout keeps red", paper[7] === 255 && paper[4] === 192, `r=${paper[4]} a=${paper[7]}`);

const pal = new Uint8ClampedArray(16 * 4);
for (let i = 0; i < 12; i++) { pal[i * 4] = 192; pal[i * 4 + 3] = 255; }
for (let i = 12; i < 16; i++) pal[i * 4 + 3] = 0;
const hexes = extractRasterPalette(pal, { maxColors: 3, alphaMin: 48 });
check("palette from opaque red", hexes[0] === "#c00000", hexes.join(","));

const slabPix = new Uint8ClampedArray(8 * 8 * 4);
for (let y = 0; y < 8; y++) {
  for (let x = 0; x < 8; x++) {
    const o = (y * 8 + x) * 4;
    if (x < 4) { slabPix[o] = 20; slabPix[o + 3] = 255; }
  }
}
const slab = buildStampSlabs({
  pixels: slabPix, imgW: 8, imgH: 8,
  origin: [0, 0, 0], right: [1, 0, 0], up: [0, 1, 0], normal: [0, 0, 1],
  widthMm: 20, heightMm: 20, stepMm: 5, singleSlot: 2,
});
check("slab builds triangles", slab.indices.length >= 12, `n=${slab.indices.length}`);
check("slab slot is 2", slab.faceSlots.every((s) => s === 2));
const solidMask = new Uint8Array(64);
solidMask.fill(1);
const solid = buildStampSlabsFromMasks({
  layers: [{ mask: solidMask, slot: 1 }], imgW: 8, imgH: 8,
  origin: [0, 0, 0], right: [1, 0, 0], up: [0, 1, 0], normal: [0, 0, 1],
  widthMm: 16, heightMm: 16, stepMm: 2,
});
const solidTris = solid.indices.length / 3;
const solidVerts = solid.positions.length / 3;
check("shared stamp reuses verts", solidVerts / solidTris < 0.58, `v=${solidVerts} t=${solidTris}`);
check("shared stamp still has a closed shell", solidTris >= 96 && solidVerts >= 16, `t=${solidTris}`);
let maxX = -Infinity;
for (let i = 0; i < slab.positions.length; i += 3) maxX = Math.max(maxX, slab.positions[i]);
check("slab stays on left half", maxX <= 0.05, `maxX=${maxX}`);

const redMask = new Uint8Array(16);
const blackMask = new Uint8Array(16);
for (let i = 0; i < 8; i++) redMask[i] = 1;
for (let i = 8; i < 16; i++) blackMask[i] = 1;
const traced = stampLayersFromTrace({
  width: 4, height: 4,
  colorLayers: [
    { rgb: [200, 0, 0], mask: redMask },
    { rgb: [10, 10, 10], mask: blackMask },
  ],
}, { slotForRgb: (rgb) => nearestSlot(rgb, [[176, 176, 176], [12, 12, 12], [200, 0, 0]]).slot });
check("trace layers keep two colours", traced.layers.length === 2, `n=${traced.layers.length}`);
check("trace red maps to slot 2", traced.layers[0].slot === 2, `slot=${traced.layers[0].slot}`);
check("trace black maps to slot 1", traced.layers[1].slot === 1, `slot=${traced.layers[1].slot}`);
const fromMasks = buildStampSlabsFromMasks({
  layers: traced.layers, imgW: 4, imgH: 4,
  origin: [0, 0, 0], right: [1, 0, 0], up: [0, 1, 0], normal: [0, 0, 1],
  widthMm: 20, heightMm: 20, stepMm: 5,
});
check("multi-colour slabs build", fromMasks.indices.length >= 24, `n=${fromMasks.indices.length}`);
check("multi-colour uses both slots", new Set(fromMasks.faceSlots).size === 2, [...new Set(fromMasks.faceSlots)].join(","));
const sil = stampLayersFromTrace({ width: 4, height: 4, silhouetteMask: redMask }, { singleSlot: 3 });
check("active slot uses silhouette", sil.layers.length === 1 && sil.layers[0].slot === 3);

const grey = new Uint8Array(8 * 8);
const crest = new Uint8Array(8 * 8);
for (let y = 0; y < 8; y++) {
  for (let x = 0; x < 8; x++) {
    const i = y * 8 + x;
    if (x === 0 || y === 0 || x === 7 || y === 7) grey[i] = 1;
    else if (x >= 2 && x <= 5 && y >= 2 && y <= 5) crest[i] = 1;
  }
}
check("grey ring is a mat", isTraceMatLayer(grey, 8, 8, [150, 150, 150]));
check("inner crest is not a mat", !isTraceMatLayer(crest, 8, 8, [245, 245, 245]));
const scrubbed = scrubTraceMat({
  width: 8, height: 8,
  colorLayers: [
    { rgb: [150, 150, 150], hex: "#969696", label: "Dark grey", mask: grey },
    { rgb: [200, 0, 0], hex: "#c80000", label: "Red", mask: crest },
  ],
  silhouetteMask: Uint8Array.from(grey, (v, i) => v || crest[i]),
});
check("scrub drops grey mat", scrubbed.colorLayers.length === 1 && scrubbed.colorLayers[0].label === "Red");
check("scrub keeps inner crest", [...crest].every((v, i) => !v || scrubbed.silhouetteMask[i]));
check("scrub punches grey from silhouette", [...grey].every((v, i) => !v || !scrubbed.silhouetteMask[i]));
const noGrey = stampLayersFromTrace({
  width: 8, height: 8,
  colorLayers: [
    { rgb: [150, 150, 150], mask: grey },
    { rgb: [200, 0, 0], mask: crest },
  ],
}, { slotForRgb: (rgb) => nearestSlot(rgb, [[176, 176, 176], [12, 12, 12], [200, 0, 0]]).slot });
check("stamp skips grey mat layer", noGrey.layers.length === 1 && noGrey.layers[0].slot === 2);

const halo = new Uint8Array(8 * 8);
const core = new Uint8Array(8 * 8);
for (let y = 0; y < 8; y++) {
  for (let x = 0; x < 8; x++) {
    const i = y * 8 + x;
    if (x >= 1 && x <= 6 && y >= 1 && y <= 6 && (x === 1 || x === 6 || y === 1 || y === 6)) halo[i] = 1;
    else if (x >= 3 && x <= 4 && y >= 3 && y <= 4) core[i] = 1;
  }
}
const haloScrub = scrubTraceMat({
  width: 8, height: 8,
  colorLayers: [
    { rgb: [160, 160, 160], hex: "#a0a0a0", label: "Grey", mask: halo },
    { rgb: [200, 0, 0], hex: "#c80000", label: "Red", mask: core },
  ],
});
check("halo grey does not need to touch crop", !haloScrub.colorLayers.some((l) => l.label === "Grey"));
check("halo scrub keeps red core", haloScrub.colorLayers.some((l) => l.label === "Red"));

const whiteFill = new Uint8Array(8 * 8);
for (let y = 2; y <= 5; y++) for (let x = 2; x <= 5; x++) whiteFill[y * 8 + x] = 1;
const keepWhite = scrubTraceMat({
  width: 8, height: 8,
  colorLayers: [
    { rgb: [150, 150, 150], mask: grey, label: "Dark grey" },
    { rgb: [240, 240, 240], mask: whiteFill, label: "White" },
    { rgb: [200, 0, 0], mask: crest, label: "Red" },
  ],
});
check("interior white stays", keepWhite.colorLayers.some((l) => l.label === "White"));
check("outer grey still drops next to white", !keepWhite.colorLayers.some((l) => l.label === "Dark grey"));

const srcW = 8, srcH = 8;
const srcPix = new Uint8ClampedArray(srcW * srcH * 4);
for (let y = 0; y < srcH; y++) {
  for (let x = 0; x < srcW; x++) {
    const o = (y * srcW + x) * 4;
    srcPix[o + 3] = 255;
    if (x >= 2 && x <= 5 && y >= 2 && y <= 5) {
      srcPix[o] = 250; srcPix[o + 1] = 250; srcPix[o + 2] = 250;
    } else {
      srcPix[o] = 150; srcPix[o + 1] = 150; srcPix[o + 2] = 150;
    }
    if (x >= 3 && x <= 4 && y >= 3 && y <= 4) {
      srcPix[o] = 200; srcPix[o + 1] = 0; srcPix[o + 2] = 0;
    }
  }
}
const ext = floodBorderBackground(srcPix, srcW, srcH);
check("source flood marks grey border", ext[0] === 1 && ext[7] === 1);
check("source flood keeps white field", ext[2 * 8 + 2] === 0);
check("source flood keeps red core", ext[3 * 8 + 3] === 0);
const fromSrc = scrubTraceMat({
  width: 8, height: 8, cropOx: 0, cropOy: 0,
  colorLayers: [
    { rgb: [150, 150, 150], label: "Dark grey", mask: grey },
    { rgb: [240, 240, 240], label: "White", mask: whiteFill },
    { rgb: [200, 0, 0], label: "Red", mask: crest },
  ],
}, { pixels: srcPix, srcW, srcH });
check("source scrub drops grey", !fromSrc.colorLayers.some((l) => l.label === "Dark grey"));
check("source scrub keeps white+red", fromSrc.colorLayers.some((l) => l.label === "White") && fromSrc.colorLayers.some((l) => l.label === "Red"));

const clipped = clipLayersToInkIsland([
  { rgb: [150, 150, 150], label: "Dark grey", mask: grey },
  { rgb: [240, 240, 240], label: "White", mask: whiteFill },
  { rgb: [200, 0, 0], label: "Red", mask: crest },
], 8, 8);
check("ink-island drops outer grey", !clipped.some((l) => l.label === "Dark grey"));
check("ink-island keeps crest white", clipped.some((l) => l.label === "White"));
check("ink-island keeps red", clipped.some((l) => l.label === "Red"));

const plate = new Uint8Array(8 * 8);
plate.fill(1);
const plateScrub = punchExteriorPaper([
  { rgb: [245, 245, 245], label: "White", mask: plate },
  { rgb: [200, 0, 0], label: "Red", mask: core },
], 8, 8);
check("white backing plate is kept", plateScrub.some((l) => l.label === "White") && plateScrub.find((l) => l.label === "White").mask[3 * 8 + 3] === 1);
check("white backing still covers the field", plateScrub.find((l) => l.label === "White").mask[1 * 8 + 1] === 1);

const spiked = new Uint8Array(8 * 8);
for (let y = 2; y <= 5; y++) for (let x = 2; x <= 5; x++) spiked[y * 8 + x] = 1;
spiked[4] = 1;
const spikeScrub = punchExteriorPaper([
  { rgb: [240, 240, 240], label: "White", mask: spiked },
  { rgb: [200, 0, 0], label: "Red", mask: crest },
], 8, 8);
check("white crop spike is stripped", spikeScrub.find((l) => l.label === "White") && spikeScrub.find((l) => l.label === "White").mask[4] === 0);
check("white plate body survives open", spikeScrub.find((l) => l.label === "White").mask[3 * 8 + 3] === 1);

const pale = new Uint8Array(8 * 8);
pale.fill(1);
const paleScrub = punchExteriorPaper([
  { rgb: [220, 220, 220], label: "Pale grey", mask: pale },
  { rgb: [200, 0, 0], label: "Red", mask: crest },
], 8, 8);
check("pale grey fringe layer drops", !paleScrub.some((l) => l.label === "Pale grey"));

let minZ = Infinity, maxZ = -Infinity;
for (let i = 2; i < slab.positions.length; i += 3) {
  minZ = Math.min(minZ, slab.positions[i]);
  maxZ = Math.max(maxZ, slab.positions[i]);
}
check("slab sits on top of the plane", minZ > 0.01, `minZ=${minZ}`);
check("slab still stands proud", maxZ > 0.5, `maxZ=${maxZ}`);

const liftVerts = new Float32Array([-12, -12, 2, 12, -12, 2, 0, 12, 2]);
const liftFaces = new Uint32Array([0, 1, 2]);
const lift = sampleStampSurfaceLift({
  verts: liftVerts, faces: liftFaces, nTri: 1,
  origin: [0, 0, 0], right: [1, 0, 0], up: [0, 1, 0], normal: [0, 0, 1],
  widthMm: 20, heightMm: 20, cols: 8, rows: 8,
});
check("surface lift reads hoodie height", lift[4 * 9 + 4] > 1.5 && lift[4 * 9 + 4] < 2.5, `d=${lift[4 * 9 + 4]}`);
const lifted = buildStampSlabsFromMasks({
  layers: [{ mask: redMask, slot: 1 }], imgW: 4, imgH: 4,
  origin: [0, 0, 0], right: [1, 0, 0], up: [0, 1, 0], normal: [0, 0, 1],
  widthMm: 20, heightMm: 20, stepMm: 5,
  verts: liftVerts, faces: liftFaces, nTri: 1,
});
let minLiftZ = Infinity, maxLiftZ = -Infinity;
for (let i = 2; i < lifted.positions.length; i += 3) {
  minLiftZ = Math.min(minLiftZ, lifted.positions[i]);
  maxLiftZ = Math.max(maxLiftZ, lifted.positions[i]);
}
check("lifted slab sits on the hoodie", minLiftZ > 2, `minZ=${minLiftZ}`);
check("lifted slab stands proud of the hoodie", maxLiftZ > 2.5, `maxZ=${maxLiftZ}`);

// Imported STLs and the Painter's auto-orientation can reverse face winding.
// The surface is still the same physical chest; a logo must not fall back to
// the tangent plane and cut into it merely because the triangle is reversed.
const reversedLiftFaces = new Uint32Array([0, 2, 1]);
const reversedLift = sampleStampSurfaceLift({
  verts: liftVerts, faces: reversedLiftFaces, nTri: 1,
  origin: [0, 0, 0], right: [1, 0, 0], up: [0, 1, 0], normal: [0, 0, 1],
  widthMm: 20, heightMm: 20, cols: 8, rows: 8,
});
check("surface lift ignores reversed STL winding", reversedLift[4 * 9 + 4] > 1.5 && reversedLift[4 * 9 + 4] < 2.5, `d=${reversedLift[4 * 9 + 4]}`);
const reversedLifted = buildStampSlabsFromMasks({
  layers: [{ mask: redMask, slot: 1 }], imgW: 4, imgH: 4,
  origin: [0, 0, 0], right: [1, 0, 0], up: [0, 1, 0], normal: [0, 0, 1],
  widthMm: 20, heightMm: 20, stepMm: 5,
  verts: liftVerts, faces: reversedLiftFaces, nTri: 1,
});
let minReversedLiftZ = Infinity;
for (let i = 2; i < reversedLifted.positions.length; i += 3) minReversedLiftZ = Math.min(minReversedLiftZ, reversedLifted.positions[i]);
check("reversed-winding slab stays outside the hoodie", minReversedLiftZ > 2, `minZ=${minReversedLiftZ}`);

const plateMask = new Uint8Array(16);
const inkMask = new Uint8Array(16);
plateMask.fill(1);
inkMask[5] = 1; inkMask[6] = 1;
const stacked = buildStampSlabsFromMasks({
  layers: [{ mask: plateMask, slot: 0 }, { mask: inkMask, slot: 2 }],
  imgW: 4, imgH: 4,
  origin: [0, 0, 0], right: [1, 0, 0], up: [0, 1, 0], normal: [0, 0, 1],
  widthMm: 20, heightMm: 20, stepMm: 5,
});
let plateMax = -Infinity, inkMax = -Infinity;
for (let t = 0; t < stacked.faceSlots.length; t++) {
  const a = stacked.indices[t * 3], b = stacked.indices[t * 3 + 1], c = stacked.indices[t * 3 + 2];
  const z = Math.max(stacked.positions[a * 3 + 2], stacked.positions[b * 3 + 2], stacked.positions[c * 3 + 2]);
  if (stacked.faceSlots[t] === 2) inkMax = Math.max(inkMax, z);
  else plateMax = Math.max(plateMax, z);
}
check("ink layer sits above the plate", inkMax > plateMax + 0.1, `ink=${inkMax} plate=${plateMax}`);

const fullMask = new Uint8Array(16);
fullMask.fill(1);
const layerHits = collectStampLayerHits({
  verts, faces, nTri: 2,
  origin: [0, 0, 0], right: [1, 0, 0], up: [0, 1, 0], normal: [0, 0, 1],
  widthMm: 20, heightMm: 20,
  layers: [{ mask: fullMask, slot: 2 }], imgW: 4, imgH: 4,
});
check("layer hits paint the facing patch", layerHits.some((h) => h.face === 0 && h.slot === 2), JSON.stringify(layerHits));

const zip = export3MF(
  new Float32Array([0, 0, 0, 10, 0, 0, 0, 10, 0]),
  new Uint32Array([0, 1, 2]),
  3, 1,
  new Uint8Array([0]), new Uint8Array([0]),
  { projectName: 'empty-guard', slotCount: 1, slotColors: ['#888888'] },
);
check("export writes a real zip", zip && zip.byteLength > 200 && zip[0] === 0x50 && zip[1] === 0x4b, `n=${zip?.byteLength}`);
const imported = await import3MF(zip.buffer);
check("round-trip 3MF has the triangle", imported.nTri === 1 && imported.nVerts === 3, `t=${imported.nTri}`);
try {
  await import3MF(new ArrayBuffer(0));
  check("empty 3MF is rejected", false);
} catch (err) {
  check("empty 3MF is rejected", /empty/i.test(err.message), err.message);
}

const splitZip = export3MF(
  new Float32Array([0, 0, 0, 10, 0, 0, 0, 10, 0, 0, 0, 1, 10, 0, 1, 0, 10, 1]),
  new Uint32Array([0, 1, 2, 3, 4, 5]),
  6, 2,
  new Uint8Array([0, 0]), new Uint8Array([0, 0]),
  {
    projectName: 'split-logo',
    slotCount: 2,
    slotColors: ['#888888', '#ff0000'],
    facePaint: new Uint8Array([0, 1]),
    stampTri0: 1,
    stampVert0: 3,
  },
);
const splitText = new TextDecoder().decode(splitZip);
check("export splits stamp to object_2", splitText.includes('object_2.model'));
check("split export uses non-recursive body component IDs", splitText.includes('<component objectid="2" p:path="/3D/Objects/object_1.model" />'));
check("split export uses non-recursive logo component IDs", splitText.includes('<component objectid="4" p:path="/3D/Objects/object_2.model" />'));
check("split export maps the logo plate instance to its outer object", splitText.includes('<metadata key="object_id" value="3" />'));
check("split export includes the standard 3MF mimetype", splitText.includes('application/vnd.ms-package.3dmanufacturing-3dmodel+xml'));
check("project config stays printer-neutral", !splitText.includes('"printer_model"') && !splitText.includes('"filament_settings_id"'));
const splitImported = await import3MF(splitZip.buffer);
check("import merges hoodie and logo", splitImported.nTri === 2 && splitImported.nVerts === 6, `t=${splitImported.nTri} v=${splitImported.nVerts}`);
check("import keeps logo paint", splitImported.facePaint[1] === 1, `p=${splitImported.facePaint[1]}`);
check("import keeps the artwork boundary locked", splitImported.stampTri0 === 1 && splitImported.stampVert0 === 3, `t=${splitImported.stampTri0} v=${splitImported.stampVert0}`);

for (const line of results) console.log(line);
if (failures) {
  console.error(`\n${failures} painter-art check(s) failed`);
  process.exit(1);
}
console.log("\nAll painter-art checks passed");
