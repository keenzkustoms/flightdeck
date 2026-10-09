import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  analyseSanitiserMesh,
  repairSanitiserMeshStage1,
} from "../js/sanitiser-core.js";

const A = [0, 0, 0];
const B = [40, 0, 0];
const C = [20, 34.64101, 0];
const D = [20, 11.547, 32.65986];
const triangle = (a, b, c) => [...a, ...b, ...c];
const near = (actual, expected, tolerance = 1e-4) => {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${actual} is not within ${tolerance} of ${expected}`
  );
};

// Surviving Stage 1 calibration: a closed tetrahedron plus two duplicate /
// reversed faces and one zero-area triangle.
const stage1Broken = new Float32Array([
  ...triangle(A, C, B),
  ...triangle(A, B, D),
  ...triangle(B, C, D),
  ...triangle(C, A, D),
  ...triangle(A, B, D),
  ...triangle(D, B, A),
  ...triangle([5, 5, 5], [10, 10, 10], [15, 15, 15]),
]);

const before = analyseSanitiserMesh(stage1Broken, 7);
assert.equal(before.duplicateTriangles, 2);
assert.equal(before.degenerateTriangles, 1);

const repaired = repairSanitiserMeshStage1(stage1Broken, 7);
assert.equal(repaired.beforeFaces, 7);
assert.equal(repaired.afterFaces, 4);
assert.equal(repaired.removedDuplicates, 2);
assert.equal(repaired.removedDegenerate, 1);

const after = analyseSanitiserMesh(repaired.positions, repaired.nTri);
assert.equal(after.openEdges, 0);
assert.equal(after.nonManifoldEdges, 0);
assert.equal(after.degenerateTriangles, 0);
assert.equal(after.duplicateTriangles, 0);
assert.equal(after.shells, 1);
assert.equal(after.watertight, true);
assert.deepEqual(after.boundaryLoops, []);

// Stage 2A calibration STL geometry: tetrahedron with the ABC face missing.
const stage2Open = new Float32Array([
  ...triangle(A, B, D),
  ...triangle(B, C, D),
  ...triangle(C, A, D),
]);
const sourceBytes = Buffer.from(
  stage2Open.buffer,
  stage2Open.byteOffset,
  stage2Open.byteLength
);
const sourceCopy = Buffer.from(sourceBytes);
const stage2 = analyseSanitiserMesh(stage2Open, 3);

assert.deepEqual(sourceBytes, sourceCopy, "Stage 2A must not modify geometry");
assert.equal(stage2.nTri, 3);
assert.equal(stage2.openEdges, 3);
assert.equal(stage2.nonManifoldEdges, 0);
assert.equal(stage2.degenerateTriangles, 0);
assert.equal(stage2.shells, 1);
assert.equal(stage2.watertight, false);
assert.equal(stage2.boundaryLoops.length, 1);

const boundary = stage2.boundaryLoops[0];
assert.equal(boundary.classification, "MAJOR");
assert.equal(boundary.edgeCount, 3);
assert.equal(boundary.closed, true);
assert.equal(boundary.complex, false);
assert.equal(boundary.topology, "CLOSED_LOOP");
assert.equal(boundary.segments.length, 3);
near(boundary.maxSpan, 40);
near(boundary.perimeter, 120, 1e-3);

const highlightedVertices = new Set();
for (const [a, b] of boundary.segments) {
  near(a[2], 0);
  near(b[2], 0);
  highlightedVertices.add(a.map(value => value.toFixed(4)).join(","));
  highlightedVertices.add(b.map(value => value.toFixed(4)).join(","));
}
assert.equal(highlightedVertices.size, 3);

for (const property of [
  "segments",
  "centroid",
  "edgeCount",
  "maxSpan",
  "perimeter",
  "classification",
  "recommendation",
]) {
  assert.ok(property in boundary, `Boundary Inspector property missing: ${property}`);
}

// A branched/non-loop boundary is diagnostic-only COMPLEX.
const complex = analyseSanitiserMesh(new Float32Array([
  0, 0, 0, 1, 0, 0, 0, 1, 0,
  0, 0, 0, -1, 0, 0, 0, -1, 0,
]), 2);
assert.equal(complex.boundaryLoops.length, 1);
assert.equal(complex.boundaryLoops[0].classification, "COMPLEX");
assert.equal(complex.boundaryLoops[0].closed, false);

const meshPrepHtml = await readFile(
  new URL("../meshprep.html", import.meta.url),
  "utf8"
);
assert.match(meshPrepHtml, /sanitiser-core\.js\?v=5/);
assert.match(meshPrepHtml, /BOUNDARY INSPECTOR/);
assert.match(meshPrepHtml, /boundary-bing">BING!/);
assert.match(meshPrepHtml, /Stage 2A is diagnostic only/);

console.log("PASS Stage 1: 7 -> 4 faces; duplicate/reversed + degenerate removal only");
console.log("PASS Stage 2A: source geometry unchanged");
console.log("PASS calibration: 3 faces, 3 open edges, 1 shell, watertight NO");
console.log("PASS Boundary 1: MAJOR, 3 edges, 40.0 mm span, 120.0 mm perimeter");
console.log("PASS highlight contract: exact three-edge missing-face loop");
console.log("PASS complex boundary classification and recovered UI contract");
