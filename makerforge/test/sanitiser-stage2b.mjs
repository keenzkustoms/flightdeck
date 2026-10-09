import {
  analyseSanitiserMesh,
  repairSanitiserBoundaryStage2B,
} from '../js/sanitiser-core.js';

const v0 = [0, 0, 0];
const v1 = [40, 0, 0];
const v2 = [20, 34.641016, 0];
const v3 = [20, 11.547005, 32.659863];

// Tetrahedron missing base face v0-v2-v1.
const faces = [
  [v0, v1, v3],
  [v1, v2, v3],
  [v2, v0, v3],
];

const positions = new Float32Array(faces.flat(2));
const originalPositions = new Float32Array(positions);
const before = analyseSanitiserMesh(positions, 3);

if (before.openEdges !== 3) throw new Error(`Expected 3 open edges, got ${before.openEdges}`);
if (before.boundaryLoops.length !== 1) throw new Error(`Expected 1 boundary, got ${before.boundaryLoops.length}`);
if (before.watertight) throw new Error('Calibration mesh must begin non-watertight');

const repaired = repairSanitiserBoundaryStage2B(
  positions,
  3,
  before.boundaryLoops[0]
);

const after = analyseSanitiserMesh(repaired.positions, repaired.nTri);

if (repaired.nTri !== 4) throw new Error(`Expected 4 faces, got ${repaired.nTri}`);
if (after.openEdges !== 0) throw new Error(`Expected 0 open edges, got ${after.openEdges}`);
if (after.boundaryLoops.length !== 0) throw new Error(`Expected 0 boundaries, got ${after.boundaryLoops.length}`);
if (!after.watertight) throw new Error('Expected repaired tetrahedron to be watertight');
if (after.nonManifoldEdges !== 0) throw new Error(`Expected 0 non-manifold edges, got ${after.nonManifoldEdges}`);
if (repaired.addedFaces !== 1) throw new Error(`Expected exactly 1 added face, got ${repaired.addedFaces}`);
if (repaired.positions.length !== positions.length + 9) throw new Error('Repair must append exactly one triangle');

for (let i = 0; i < originalPositions.length; i++) {
  if (repaired.positions[i] !== originalPositions[i]) {
    throw new Error(`Existing source coordinate changed at index ${i}`);
  }
}

const expectRefusal = (name, operation) => {
  try {
    operation();
  } catch {
    console.log(`PASS refused ${name}`);
    return;
  }

  throw new Error(`Expected Stage 2B to refuse ${name}`);
};

// Branched/non-loop topology remains diagnostic-only.
const complexPositions = new Float32Array([
  0, 0, 0, 1, 0, 0, 0, 1, 0,
  0, 0, 0, -1, 0, 0, 0, -1, 0,
]);
const complex = analyseSanitiserMesh(complexPositions, 2);
if (complex.boundaryLoops[0]?.classification !== 'COMPLEX') {
  throw new Error('Expected branched calibration boundary to be COMPLEX');
}
expectRefusal('complex/branched boundary', () =>
  repairSanitiserBoundaryStage2B(
    complexPositions,
    2,
    complex.boundaryLoops[0]
  )
);

// A simple closed four-edge opening remains outside this first repair gate.
const q0 = [-20, -20, 0];
const q1 = [20, -20, 0];
const q2 = [20, 20, 0];
const q3 = [-20, 20, 0];
const qa = [0, 0, 30];
const quadFaces = [
  [q0, q1, qa],
  [q1, q2, qa],
  [q2, q3, qa],
  [q3, q0, qa],
];
const quadPositions = new Float32Array(quadFaces.flat(2));
const quad = analyseSanitiserMesh(quadPositions, 4);
if (quad.boundaryLoops[0]?.edgeCount !== 4 || !quad.boundaryLoops[0]?.closed) {
  throw new Error('Expected a simple closed four-edge calibration boundary');
}
expectRefusal('larger polygonal boundary', () =>
  repairSanitiserBoundaryStage2B(
    quadPositions,
    4,
    quad.boundaryLoops[0]
  )
);

expectRefusal('missing boundary selection', () =>
  repairSanitiserBoundaryStage2B(positions, 3, null)
);

console.log('PASS Stage 2B triangular boundary repair');
console.log('faces: 3 -> 4');
console.log('open edges: 3 -> 0');
console.log('boundary groups: 1 -> 0');
console.log('watertight: NO -> YES');
console.log('non-manifold edges: 0 -> 0');
console.log('existing source coordinates: unchanged');
