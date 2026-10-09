/**
 * Quick check: shelf Back + Shelf parts must be 0 open edges after prepareMeshFor3mf.
 */
import { buildContainer, TEMORA_VET_SIGN_PRESET } from "./_staged/geometry.js";
import { prepareMeshFor3mf, countOpenEdges } from "./_staged/stl.js";

function openOf(mesh) {
  const cleaned = prepareMeshFor3mf(mesh);
  if (!cleaned) return { open: -1, tris: 0 };
  return {
    open: cleaned.openEdgeCount ?? countOpenEdges(cleaned.positions, cleaned.indices),
    tris: cleaned.indices.length / 3,
  };
}

const params = {
  ...TEMORA_VET_SIGN_PRESET,
  shape: "sign",
  signType: "shelf",
  embossText: "",
  embossTraceEnabled: false,
  _artPreviewDraft: true,
};

const built = buildContainer(params);
const back = built?.boxShell || built?.shellMesh;
const shelf = built?.shelfMesh;

const backR = openOf(back);
const shelfR = openOf(shelf);

console.log(`Back:  open=${backR.open} tris=${backR.tris}`);
console.log(`Shelf: open=${shelfR.open} tris=${shelfR.tris}`);

const femaleOnly = (await import("./_staged/signs.js")).buildSignShelfFemaleReceiver(180, 180, 4, 4);
const femaleR = openOf(femaleOnly);
console.log(`Female alone: open=${femaleR.open} tris=${femaleR.tris}`);

if (backR.open !== 0 || shelfR.open !== 0 || femaleR.open !== 0) {
  console.error("FAIL: open edges remain");
  process.exit(1);
}
console.log("PASS");
