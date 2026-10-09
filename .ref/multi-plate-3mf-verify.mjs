/**
 * Validates MakerDeck multi-plate 3MF exports against Bambu plate-grid rules.
 * Golden reference: Bambu PartPlate.cpp (reload_all_objects bbox intersection)
 * + H2D printable_area 350×320 from Chris repaired 3MF (.ref/repaired-unzip/).
 *
 * Run: node .ref/multi-plate-3mf-verify.mjs
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import {
  buildMultiPlateColoredProject3mf,
  BAMBU_BED_WIDTH_MM,
  BAMBU_BED_DEPTH_MM,
  plateGridOffset,
  plateStrideMm,
} from "../makerforge/js/3mf.js";

const GOLDEN_PATH = ".ref/golden-two-plate.3mf";

const boxMesh = {
  positions: [0, 0, 0, 100, 0, 0, 0, 100, 0, 0, 0, 50],
  indices: [0, 1, 2, 0, 2, 3],
};
const lidMesh = {
  positions: [0, 0, 0, 80, 0, 0, 0, 80, 0, 0, 0, 10],
  indices: [0, 1, 2, 0, 2, 3],
};

function listZipNames(buffer) {
  const names = [];
  let pos = 0;
  while (pos + 30 <= buffer.length) {
    if (buffer.readUInt32LE(pos) !== 0x04034b50) break;
    const nameLen = buffer.readUInt16LE(pos + 26);
    const extraLen = buffer.readUInt16LE(pos + 28);
    const compSize = buffer.readUInt32LE(pos + 18);
    names.push(buffer.slice(pos + 30, pos + 30 + nameLen).toString("utf8"));
    pos += 30 + nameLen + extraLen + compSize;
  }
  return names;
}

function readZipEntry(buffer, entryName) {
  let pos = 0;
  while (pos + 30 <= buffer.length) {
    if (buffer.readUInt32LE(pos) !== 0x04034b50) break;
    const nameLen = buffer.readUInt16LE(pos + 26);
    const extraLen = buffer.readUInt16LE(pos + 28);
    const compSize = buffer.readUInt32LE(pos + 18);
    const name = buffer.slice(pos + 30, pos + 30 + nameLen).toString("utf8");
    const dataStart = pos + 30 + nameLen + extraLen;
    if (name === entryName) return buffer.slice(dataStart, dataStart + compSize).toString("utf8");
    pos = dataStart + compSize;
  }
  return null;
}

function transformValues(transformAttr) {
  if (!transformAttr) return [];
  return transformAttr.trim().split(/\s+/).map(Number);
}

function plateObjectId(plateXml) {
  const inst = plateXml.match(/<model_instance>([\s\S]*?)<\/model_instance>/);
  if (!inst) return null;
  return inst[1].match(/object_id" value="(\d+)"/)?.[1] ?? null;
}

function parseExport(buffer) {
  const text = buffer.toString("latin1");
  const cfgStart = text.indexOf("<config>");
  const cfg = cfgStart >= 0 ? text.slice(cfgStart, text.indexOf("</config>", cfgStart) + 9) : "";
  const modelStart = text.indexOf("<model ");
  const model = modelStart >= 0 ? text.slice(modelStart, text.indexOf("</model>", modelStart) + 8) : "";
  const plateBlocks = [...cfg.matchAll(/<plate>([\s\S]*?)<\/plate>/g)].map((m) => m[1]);
  const buildItems = [...model.matchAll(/<item[^>]*objectid="(\d+)"[^>]*transform="([^"]+)"/g)];
  return {
    zipFiles: listZipNames(buffer),
    cfg,
    model,
    plateBlocks,
    buildItems,
    buildTransforms: buildItems.map((m) => m[2]),
    buildObjectIds: buildItems.map((m) => m[1]),
    assembleTransforms: [...cfg.matchAll(/assemble_item[^>]*transform="([^"]+)"/g)].map((m) => m[1]),
    projectSettings: JSON.parse(readZipEntry(buffer, "Metadata/project_settings.config") || "{}"),
    plate1Json: JSON.parse(readZipEntry(buffer, "Metadata/plate_1.json") || "null"),
    plate2Json: JSON.parse(readZipEntry(buffer, "Metadata/plate_2.json") || "null"),
  };
}

/** Mirror PartPlate::intersect_instance — axis-aligned plate box vs instance bbox. */
function plateBoxForIndex(plateIndex) {
  const grid = plateGridOffset(plateIndex + 1);
  return {
    minX: grid.x,
    minY: grid.y,
    maxX: grid.x + BAMBU_BED_WIDTH_MM,
    maxY: grid.y + BAMBU_BED_DEPTH_MM,
  };
}

function bboxFromMesh(mesh, transform) {
  const tv = transformValues(transform);
  const tx = tv[9] ?? 0;
  const ty = tv[10] ?? 0;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < mesh.positions.length; i += 3) {
    const x = mesh.positions[i] + tx;
    const y = mesh.positions[i + 1] + ty;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

function intersects(a, b) {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}

function assignPlatesByIntersection(meshes, transforms) {
  const plate0 = plateBoxForIndex(0);
  const plate1 = plateBoxForIndex(1);
  const assignments = [];
  for (let i = 0; i < meshes.length; i++) {
    const bbox = bboxFromMesh(meshes[i], transforms[i]);
    const on0 = intersects(bbox, plate0);
    const on1 = intersects(bbox, plate1);
    let plate = -1;
    if (on0 && !on1) plate = 0;
    else if (on1 && !on0) plate = 1;
    else if (on0 && on1) plate = 0; // first match wins in Bambu reload_all_objects
    assignments.push({ plate, bbox, on0, on1 });
  }
  return assignments;
}

function audit(label, data) {
  let failures = 0;
  const check = (name, cond) => {
    if (!cond) failures++;
    console.log(`${cond ? "ok  " : "FAIL"} [${label}] ${name}`);
  };

  const stride = plateStrideMm();
  const grid2 = plateGridOffset(2);
  const t0 = transformValues(data.buildTransforms[0]);
  const t1 = transformValues(data.buildTransforms[1]);

  check("Metadata/plate_1.json present", data.zipFiles.includes("Metadata/plate_1.json"));
  check("Metadata/plate_2.json present", data.zipFiles.includes("Metadata/plate_2.json"));
  check("two plater_id entries", (data.cfg.match(/plater_id" value="/g) || []).length === 2);
  check("two model_instance blocks", (data.cfg.match(/<model_instance>/g) || []).length === 2);
  check("assemble section present", data.cfg.includes("<assemble>"));
  check("build transforms are 12-value matrices", data.buildTransforms.every((t) => transformValues(t).length === 12));
  check("plate 1 model_instance ≠ plate 2", plateObjectId(data.plateBlocks[0]) !== plateObjectId(data.plateBlocks[1]));
  check("project_settings H2D printable_area", data.projectSettings.printable_area?.includes(`${BAMBU_BED_WIDTH_MM}x${BAMBU_BED_DEPTH_MM}`));
  check("plate 1 X inside plate-0 bed (< bed width)", t0[9] < BAMBU_BED_WIDTH_MM);
  check("plate 2 X outside plate-0 bed (≥ stride)", t1[9] >= stride.x - 5);
  check("plate 2 X includes grid offset", t1[9] >= grid2.x - 1);
  check("plate_2.json bbox plate-local (maxX ≤ bed)", data.plate2Json?.bbox_all?.[2] <= BAMBU_BED_WIDTH_MM + 1);
  check("plate_2.json bbox not world-grid (maxX < stride)", data.plate2Json?.bbox_all?.[2] < stride.x);

  const sim = assignPlatesByIntersection([boxMesh, lidMesh], data.buildTransforms);
  check("sim: container on plate 0 only", sim[0].plate === 0 && !sim[0].on1);
  check("sim: lid on plate 1 only", sim[1].plate === 1 && !sim[1].on0);

  console.log(`  build tx: plate1=${t0[9].toFixed(1)} plate2=${t1[9].toFixed(1)} (stride=${stride.x.toFixed(1)})`);
  console.log(`  sim plates: container→${sim[0].plate} lid→${sim[1].plate}`);
  return failures;
}

// --- MakerDeck export under test ---
const blob = buildMultiPlateColoredProject3mf(
  [
    { plateId: 1, plateName: "Container", name: "verify-box", parts: [{ name: "Body", mesh: boxMesh, color: "#38bdf8", extruder: 1 }] },
    { plateId: 2, plateName: "Lid", name: "verify-box lid", parts: [{ name: "Lid", mesh: lidMesh, color: "#ff0000", extruder: 2 }] },
  ],
  "verify-box",
);
const makerBuf = Buffer.from(await blob.arrayBuffer());
writeFileSync(".ref/multi-plate-test.3mf", makerBuf);
const maker = parseExport(makerBuf);

let failures = audit("maker", maker);

// --- Optional golden diff (Bambu-exported 2-plate reference) ---
if (existsSync(GOLDEN_PATH)) {
  const golden = parseExport(readFileSync(GOLDEN_PATH));
  failures += audit("golden", golden);

  const diff = [];
  const makerNames = new Set(maker.zipFiles);
  const goldenNames = new Set(golden.zipFiles);
  for (const n of goldenNames) {
    if (!makerNames.has(n)) diff.push(`missing in maker: ${n}`);
  }
  for (const n of makerNames) {
    if (!goldenNames.has(n)) diff.push(`extra in maker: ${n}`);
  }
  if (diff.length) {
    failures++;
    console.log("FAIL [diff] zip entry mismatches vs golden:");
    diff.slice(0, 12).forEach((line) => console.log(`  ${line}`));
  } else {
    console.log("ok   [diff] zip entry names match golden");
  }
} else {
  console.log(`note  golden reference not found at ${GOLDEN_PATH} — drop a Bambu 2-plate export there to enable diff`);
}

console.log(failures ? `${failures} FAILURES` : "ALL OK — multi-plate Bambu H2D grid layout");
process.exit(failures ? 1 : 0);
