import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const sources = [
  "C:/Users/Kidabah/Desktop/H2D_USB/mazbox_1h18m.gcode.3mf",
  "C:/Users/Kidabah/flightdeck/.ref/chris-box.3mf",
  "C:/Users/Kidabah/flightdeck/makerforge/samples/chris-box-repaired.3mf",
];

function listZip(buf) {
  const entries = {};
  let pos = 0;
  while (pos + 30 <= buf.length) {
    if (buf.readUInt32LE(pos) !== 0x04034b50) break;
    const nameLen = buf.readUInt16LE(pos + 26);
    const extraLen = buf.readUInt16LE(pos + 28);
    const compSize = buf.readUInt32LE(pos + 18);
    const name = buf.slice(pos + 30, pos + 30 + nameLen).toString("utf8");
    const dataStart = pos + 30 + nameLen + extraLen;
    entries[name] = buf.slice(dataStart, dataStart + compSize);
    pos = dataStart + compSize;
  }
  return entries;
}

const report = {};
for (const path of sources) {
  try {
    const buf = readFileSync(path);
    const entries = listZip(buf);
    const names = Object.keys(entries).sort();
    const cfg = entries["Metadata/model_settings.config"]?.toString("utf8") ?? null;
    const model = entries["3D/3dmodel.model"]?.toString("utf8") ?? null;
    const plates = cfg ? (cfg.match(/<plate>/g) || []).length : 0;
    const buildItems = model ? (model.match(/<item /g) || []).length : 0;
    const transforms = model ? [...model.matchAll(/transform="([^"]+)"/g)].map((m) => m[1]) : [];
    report[path] = { bytes: buf.length, fileCount: names.length, plates, buildItems, transforms, names };
  } catch (e) {
    report[path] = { error: String(e) };
  }
}

writeFileSync(".ref/extract-3mf-report.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
