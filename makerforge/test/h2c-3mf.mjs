import assert from "node:assert/strict";
import { buildColoredProject3mf } from "../js/3mf.js";

function box(x0, y0, z0, x1, y1, z1) {
  return {
    positions: [
      x0, y0, z0, x1, y0, z0, x1, y1, z0, x0, y1, z0,
      x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1,
    ],
    indices: [
      0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6,
      0, 4, 5, 0, 5, 1, 3, 2, 6, 3, 6, 7,
      0, 3, 7, 0, 7, 4, 1, 5, 6, 1, 6, 2,
    ],
  };
}

function readStoredZip(bytes) {
  const files = new Map();
  const decoder = new TextDecoder();
  let offset = 0;
  while (offset + 30 <= bytes.length && new DataView(bytes.buffer, bytes.byteOffset + offset).getUint32(0, true) === 0x04034b50) {
    const view = new DataView(bytes.buffer, bytes.byteOffset + offset);
    const size = view.getUint32(18, true);
    const nameLength = view.getUint16(26, true);
    const extraLength = view.getUint16(28, true);
    const dataStart = offset + 30 + nameLength + extraLength;
    const name = decoder.decode(bytes.subarray(offset + 30, offset + 30 + nameLength));
    files.set(name, decoder.decode(bytes.subarray(dataStart, dataStart + size)));
    offset = dataStart + size;
  }
  return files;
}

const blob = buildColoredProject3mf([
  { name: "Body", mesh: box(-12, -10, 0, 12, 10, 20), color: "#F8FAFC", extruder: 1 },
  { name: "Art Red", mesh: box(-4, -10.04, 8, 1, -9.2, 15), color: "#C91D2E", extruder: 2 },
  { name: "Art Dark grey", mesh: box(1.1, -10.04, 8, 4, -9.2, 15), color: "#202124", extruder: 3 },
], "h2c-volume-regression", {
  splitVolumes: true,
  printer: {
    printer_model: "Bambu Lab H2C",
    printer_settings_id: "Bambu Lab H2C 0.4 nozzle",
    print_settings_id: "0.24mm Standard @BBL H2C",
    nozzleDiameter: 0.4,
    layerHeight: 0.24,
    bedWidth: 330,
    bedDepth: 320,
    amsHtLeft: true,
  },
});
const files = readStoredZip(new Uint8Array(await blob.arrayBuffer()));
const root = files.get("3D/3dmodel.model") || "";
const volumes = files.get("3D/Objects/object_1.model") || "";
const settings = files.get("Metadata/model_settings.config") || "";
const projectSettings = files.get("Metadata/project_settings.config") || "";
const project = JSON.parse(projectSettings);

assert.match(root, /<metadata name="MakerDeck-Export">H2C-validated-purge-matrix-b619<\/metadata>/);
assert.match(root, /<object id="4"[^>]*type="model">[\s\S]*<components>[\s\S]*objectid="1"[\s\S]*objectid="2"[\s\S]*objectid="3"/);
assert.match(root, /<build>[\s\S]*<item objectid="4"/);
assert.doesNotMatch(root, /<item objectid="[123]"/, "only the parent model may be a printable object");
assert.equal((volumes.match(/<object id="\d+"/g) || []).length, 3, "one Bambu volume per colour");
assert.match(volumes, /<metadata name="BambuStudio:3mfVersion">1<\/metadata>/);
assert.match(volumes, /slic3rpe:extruder">1<\/metadata>/);
assert.match(volumes, /slic3rpe:extruder">2<\/metadata>/);
assert.match(volumes, /slic3rpe:extruder">3<\/metadata>/);
assert.match(settings, /<part id="1" subtype="normal_part">[\s\S]*?<metadata key="extruder" value="1"\/>/);
assert.match(settings, /<part id="2" subtype="normal_part">[\s\S]*?<metadata key="extruder" value="2"\/>/);
assert.match(settings, /<part id="3" subtype="normal_part">[\s\S]*?<metadata key="extruder" value="3"\/>/);
assert.match(settings, /<object id="4">[\s\S]*?<metadata key="extruder" value="1"\/>/);
assert.match(settings, /key="filament_maps" value="1 2 2"/);
assert.match(settings, /key="filament_volume_maps" value="0 0 0"/);
assert.match(settings, /<assemble>[\s\S]*?<assemble_item object_id="4" instance_id="0"[\s\S]*?<assemble_item object_id="4" volume_id="0"[\s\S]*?<assemble_item object_id="4" volume_id="1"[\s\S]*?<assemble_item object_id="4" volume_id="2"/);
assert.match(projectSettings, /"filament_volume_map":\["0","0","0"\]/);
assert.match(projectSettings, /"extruder_ams_count":\["1#0\|4#1","1#1\|4#0"\]/);
assert.match(projectSettings, /"flush_into_infill":"0"/);
assert.match(projectSettings, /"printer_model":"Bambu Lab H2C"/);
assert.deepEqual(project.flush_multiplier, ["0.4", "0.4"], "both H2C nozzles need a purge multiplier");
assert.equal(project.flush_volumes_matrix.length, 18, "3 colour slots need a 3x3 matrix for each of 2 nozzles");
assert.deepEqual(project.flush_volumes_matrix.slice(0, 9), ["0", "280", "280", "280", "0", "280", "280", "280", "0"]);
assert.deepEqual(project.flush_volumes_matrix.slice(9), project.flush_volumes_matrix.slice(0, 9));
assert.equal(project.wipe_tower_x, "40");
assert.equal(project.wipe_tower_y, "220");
assert.ok(!volumes.includes("<component"), "colour volumes stay as meshes, not free-standing plate objects");

console.log("PASS h2c 3MF volume export: b619 purge matrix, plate-bound tower, 3 linked volumes, H2C left/right maps");
