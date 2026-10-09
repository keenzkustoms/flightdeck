import {
  analyseSanitiserMesh,
  repairSanitiserBoundaryStage2C,
} from '../js/sanitiser-core.js';

const A=[-20,-15,0], B=[20,-15,0], C=[20,15,0], D=[-20,15,0];
const E=[-20,-15,20], F=[20,-15,20], G=[20,15,20], H=[-20,15,20];

const faces = [
  [A,D,C],[A,C,B],
  [A,B,F],[A,F,E],
  [B,C,G],[B,G,F],
  [C,D,H],[C,H,G],
  [D,A,E],[D,E,H],
];

const positions = new Float32Array(faces.flat(2));
const before = analyseSanitiserMesh(positions, faces.length);

if (before.openEdges !== 4) throw new Error(`Expected 4 open edges, got ${before.openEdges}`);
if (before.boundaryLoops.length !== 1) throw new Error(`Expected 1 boundary, got ${before.boundaryLoops.length}`);
if (before.boundaryLoops[0].edgeCount !== 4) throw new Error('Expected a four-edge boundary');
if (before.watertight) throw new Error('Calibration mesh must begin non-watertight');

const repaired = repairSanitiserBoundaryStage2C(
  positions,
  faces.length,
  before.boundaryLoops[0]
);

const after = analyseSanitiserMesh(repaired.positions, repaired.nTri);

if (repaired.addedFaces !== 2) throw new Error(`Expected 2 added faces, got ${repaired.addedFaces}`);
if (repaired.nTri !== 12) throw new Error(`Expected 12 faces, got ${repaired.nTri}`);
if (after.openEdges !== 0) throw new Error(`Expected 0 open edges, got ${after.openEdges}`);
if (after.boundaryLoops.length !== 0) throw new Error(`Expected 0 boundaries, got ${after.boundaryLoops.length}`);
if (!after.watertight) throw new Error('Expected repaired box to be watertight');
if (after.nonManifoldEdges !== 0) throw new Error(`Expected 0 non-manifold edges, got ${after.nonManifoldEdges}`);

const source = repaired.positions.slice(0, positions.length);
for (let i=0;i<positions.length;i++) {
  if (source[i] !== positions[i]) throw new Error(`Source coordinate changed at ${i}`);
}

const concave = {
  closed:true, complex:false, topology:'CLOSED_LOOP', edgeCount:4,
  segments:[
    [[0,0,0],[20,0,0]],
    [[20,0,0],[8,5,0]],
    [[8,5,0],[0,20,0]],
    [[0,20,0],[0,0,0]],
  ]
};

let refusedConcave = false;
try {
  repairSanitiserBoundaryStage2C(positions, faces.length, concave);
} catch {
  refusedConcave = true;
}
if (!refusedConcave) throw new Error('Expected concave/stale quad to be refused');

const expectRefusal = (name, operation) => {
  try {
    operation();
  } catch {
    console.log(`PASS refused ${name}`);
    return;
  }

  throw new Error(`Expected Stage 2C to refuse ${name}`);
};

const openFan = (boundaryPoints, apex = [0, 0, 30]) => {
  const fanFaces = boundaryPoints.map((point, index) => [
    point,
    boundaryPoints[(index + 1) % boundaryPoints.length],
    apex,
  ]);
  const fanPositions = new Float32Array(fanFaces.flat(2));
  const analysis = analyseSanitiserMesh(fanPositions, fanFaces.length);

  if (analysis.boundaryLoops.length !== 1) {
    throw new Error('Refusal calibration must contain exactly one boundary');
  }

  return { positions: fanPositions, nTri: fanFaces.length, boundary: analysis.boundaryLoops[0] };
};

const concaveMesh = openFan([
  [0, 0, 0],
  [20, 0, 0],
  [8, 5, 0],
  [0, 20, 0],
]);
expectRefusal('concave four-edge boundary', () =>
  repairSanitiserBoundaryStage2C(
    concaveMesh.positions,
    concaveMesh.nTri,
    concaveMesh.boundary
  )
);

const nonPlanarMesh = openFan([
  [-20, -15, 0],
  [20, -15, 0],
  [20, 15, 2],
  [-20, 15, 0],
]);
expectRefusal('non-planar four-edge boundary', () =>
  repairSanitiserBoundaryStage2C(
    nonPlanarMesh.positions,
    nonPlanarMesh.nTri,
    nonPlanarMesh.boundary
  )
);

const pentagonMesh = openFan([
  [0, -20, 0],
  [19, -6, 0],
  [12, 16, 0],
  [-12, 16, 0],
  [-19, -6, 0],
]);
expectRefusal('five-edge polygonal boundary', () =>
  repairSanitiserBoundaryStage2C(
    pentagonMesh.positions,
    pentagonMesh.nTri,
    pentagonMesh.boundary
  )
);

const complexPositions = new Float32Array([
  0, 0, 0, 1, 0, 0, 0, 1, 0,
  0, 0, 0, -1, 0, 0, 0, -1, 0,
]);
const complex = analyseSanitiserMesh(complexPositions, 2);
expectRefusal('complex/branched boundary', () =>
  repairSanitiserBoundaryStage2C(
    complexPositions,
    2,
    complex.boundaryLoops[0]
  )
);

expectRefusal('missing boundary selection', () =>
  repairSanitiserBoundaryStage2C(positions, faces.length, null)
);

console.log('PASS Stage 2C planar convex quad repair');
console.log('faces: 10 -> 12');
console.log('open edges: 4 -> 0');
console.log('boundary groups: 1 -> 0');
console.log('watertight: NO -> YES');
console.log('non-manifold edges: 0 -> 0');
console.log('existing source coordinates: unchanged');
