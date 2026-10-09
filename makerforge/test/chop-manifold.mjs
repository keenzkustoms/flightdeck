/**
 * Chop tool regression tests — plane-cutting must always yield watertight
 * pieces (0 open edges, 0 non-manifold edges) on both sides of a cut.
 * Backed by manifold-3d (see mesh-cut.js header for why). Run via ./run.sh.
 * Exit code 0 = all pass, 1 = a regression.
 */
import { sliceMeshByPlane, modularCut, parallelPlaneCut, computeDefaultFlexiPlanes, flexiCut, gridCut, radialCut, smoothMesh, splitIntoIslands, unionMeshes, subtractMesh, findLargestFlatFace, buildStampMesh, findFlatFaceGroups, findAdjacentPieces, planConnectorSites, buildConnectorMeshes, addConnectorsToPieces, computeBounds, meshThicknessAlong } from "./_staged/mesh-cut.js";
import { countOpenEdges, sanitizeMeshForStl } from "./_staged/stl.js";
import ManifoldModule from "manifold-3d";

let failures = 0;
const results = [];

function nonManifold(positions, indices, eps = 1e-4) {
  const map = new Map();
  const remap = [];
  for (let i = 0; i < positions.length / 3; i++) {
    const k = `${Math.round(positions[i * 3] / eps)}|${Math.round(positions[i * 3 + 1] / eps)}|${Math.round(positions[i * 3 + 2] / eps)}`;
    if (!map.has(k)) map.set(k, map.size);
    remap.push(map.get(k));
  }
  const ec = new Map();
  for (let t = 0; t < indices.length; t += 3) {
    const tri = [remap[indices[t]], remap[indices[t + 1]], remap[indices[t + 2]]];
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

function checkSide(name, side) {
  if (!side) { results.push(`FAIL ${name}: side missing`); failures++; return; }
  const open = side.openEdgeCount ?? countOpenEdges(side.positions, side.indices);
  const nm = nonManifold(side.positions, side.indices);
  const tris = side.indices.length / 3;
  const ok = open === 0 && nm === 0 && tris > 0;
  results.push(`${ok ? "PASS" : "FAIL"} ${name}: tris ${tris}, open ${open}, nonManifold ${nm}`);
  if (!ok) failures++;
}

// -- Test mesh builders ------------------------------------------------

/** Axis-aligned box, correctly wound, already watertight. */
function buildBox(cx, cy, cz, sx, sy, sz) {
  const hx = sx / 2, hy = sy / 2, hz = sz / 2;
  const positions = [
    cx - hx, cy - hy, cz - hz, // 0
    cx + hx, cy - hy, cz - hz, // 1
    cx + hx, cy + hy, cz - hz, // 2
    cx - hx, cy + hy, cz - hz, // 3
    cx - hx, cy - hy, cz + hz, // 4
    cx + hx, cy - hy, cz + hz, // 5
    cx + hx, cy + hy, cz + hz, // 6
    cx - hx, cy + hy, cz + hz, // 7
  ];
  const indices = [
    0, 3, 2, 0, 2, 1, // bottom (-z)
    4, 5, 6, 4, 6, 7, // top (+z)
    0, 1, 5, 0, 5, 4, // front (-y)
    2, 3, 7, 2, 7, 6, // back (+y)
    0, 4, 7, 0, 7, 3, // left (-x)
    1, 2, 6, 1, 6, 5, // right (+x)
  ];
  return { positions, indices };
}

let manifoldWasmPromise = null;
function getManifoldWasm() {
  if (!manifoldWasmPromise) manifoldWasmPromise = ManifoldModule().then((wasm) => { wasm.setup(); return wasm; });
  return manifoldWasmPromise;
}

/**
 * Same box as buildBox, but with each face subdivided into n^2 quads (2*n^2
 * triangles per face) instead of just 2. smoothMesh's tests need this rather
 * than the bare 12-triangle box: manifold-3d's smoothOut/refineToLength has
 * a real edge case on faces with only 2 triangles (confirmed via a
 * standalone diagnostic -- every "refined" vertex collapsed back onto the
 * original 8 corners, silently, with status() still reporting NoError) that
 * does not occur on faces with 3+ triangles (manifold-3d's own docs note
 * "flat faces of three or more triangles will always remain flat", implying
 * 2-triangle faces are a known special case) or on any real cut piece
 * (confirmed directly against a real exported 126-triangle piece: 100% of
 * refined vertices came out unique, zero collapse). Built via manifold-3d's
 * own `.refine()` for fixture generation only, not part of what's under test.
 */
async function buildDenseBox(cx, cy, cz, sx, sy, sz, n = 4) {
  const { Manifold, Mesh } = await getManifoldWasm();
  const box = buildBox(cx, cy, cz, sx, sy, sz);
  const manifold = new Manifold(new Mesh({
    numProp: 3,
    vertProperties: Float32Array.from(box.positions),
    triVerts: Uint32Array.from(box.indices),
  }));
  const dense = manifold.refine(n);
  const raw = dense.getMesh();
  const result = { positions: Array.from(raw.vertProperties), indices: Array.from(raw.triVerts) };
  manifold.delete();
  dense.delete();
  return result;
}

function mergeMeshes(meshes) {
  const positions = [];
  const indices = [];
  let base = 0;
  for (const m of meshes) {
    positions.push(...m.positions);
    for (const i of m.indices) indices.push(i + base);
    base += m.positions.length / 3;
  }
  return { positions, indices };
}

// -- Cases ---------------------------------------------------------------

{
  // Axis-aligned cut through the center of a single box.
  const box = buildBox(0, 0, 0, 10, 10, 10);
  const { above, below } = await sliceMeshByPlane(box, [0, 0, 0], [0, 0, 1]);
  checkSide("axis-aligned above", above);
  checkSide("axis-aligned below", below);
}

{
  // Angled cut (arbitrary normal) through the center of a single box.
  const box = buildBox(0, 0, 0, 10, 10, 10);
  const normal = [1, 1, 1];
  const { above, below } = await sliceMeshByPlane(box, [0, 0, 0], normal);
  checkSide("angled above", above);
  checkSide("angled below", below);
}

{
  // Cut plane passing exactly through one box vertex (non-axis-aligned normal
  // so it doesn't coincide with a whole face).
  const box = buildBox(0, 0, 0, 10, 10, 10);
  const vertex = [5, 5, -5]; // a corner of the box
  const normal = [1, 0.31, 0.17];
  const { above, below } = await sliceMeshByPlane(box, vertex, normal);
  checkSide("vertex-through above", above);
  checkSide("vertex-through below", below);
}

{
  // Two disjoint boxes cut by one plane -> each side is two disjoint watertight shells.
  const boxA = buildBox(-15, 0, 0, 10, 10, 10);
  const boxB = buildBox(15, 0, 0, 10, 10, 10);
  const dumbbell = mergeMeshes([boxA, boxB]);
  const { above, below } = await sliceMeshByPlane(dumbbell, [0, 0, 0], [0, 0, 1]);
  checkSide("multi-shell above", above);
  checkSide("multi-shell below", below);

  // splitIntoIslands should separate that bundled multi-shell result into
  // its two real, independent pieces -- the actual bug this exists to fix:
  // a single flat cut plane can produce a "half" that's naturally
  // disconnected (e.g. slicing between two legs), and Manifold has no
  // concept of that, so it silently ships as one bundled mesh otherwise.
  const islands = splitIntoIslands(above);
  results.push(`INFO splitIntoIslands multi-shell: ${islands.length} islands (expect 2)`);
  if (islands.length !== 2) { results.push("FAIL splitIntoIslands multi-shell: expected 2 islands"); failures++; }
  for (let i = 0; i < islands.length; i++) checkSide(`splitIntoIslands multi-shell island ${i}`, islands[i]);
  const totalTris = islands.reduce((sum, isl) => sum + isl.indices.length / 3, 0);
  if (totalTris !== above.indices.length / 3) { results.push(`FAIL splitIntoIslands multi-shell: island triangles ${totalTris} != original ${above.indices.length / 3}`); failures++; }
}

{
  // Already-connected single-piece mesh should come back as exactly one
  // island, unchanged -- splitIntoIslands must be a no-op for the common case.
  const box = buildBox(0, 0, 0, 10, 10, 10);
  const islands = splitIntoIslands(box);
  if (islands.length !== 1) { results.push(`FAIL splitIntoIslands single-piece: expected 1 island, got ${islands.length}`); failures++; }
  else checkSide("splitIntoIslands single-piece", islands[0]);
}

{
  // Chained cut: cut a box, then cut one of the resulting pieces again on a different axis.
  const box = buildBox(0, 0, 0, 10, 10, 10);
  const first = await sliceMeshByPlane(box, [0, 0, 0], [0, 0, 1]);
  checkSide("chained first-cut above", first.above);
  const second = await sliceMeshByPlane(first.above, [0, 0, 2], [1, 0, 0]);
  checkSide("chained second-cut above", second.above);
  checkSide("chained second-cut below", second.below);
}

{
  // The exact adversarial case that broke the old clipper: a perfectly
  // symmetric cube, cut through its own diagonals on 3 different axes in a
  // row (X, then Y, then Z). Used to leave 7-13 open edges per piece.
  const box = buildBox(0, 0, 0, 25, 25, 25);
  const c1 = await sliceMeshByPlane(box, [0, 0, 0], [1, 0, 0]);
  const c2 = await sliceMeshByPlane(c1.above, [0, 0, 0], [0, 1, 0]);
  const c3 = await sliceMeshByPlane(c2.above, [0, 0, 0], [0, 0, 1]);
  checkSide("triple-axis-corner above", c3.above);
  checkSide("triple-axis-corner below", c3.below);
}

{
  // Modular cut: oversized on Z only should keep bisecting along Z until every piece fits.
  const box = buildBox(0, 0, 0, 8, 8, 40);
  const { pieces, capped } = await modularCut(box, [10, 10, 10]);
  results.push(`INFO modular single-axis: ${pieces.length} pieces, capped ${capped}`);
  if (capped) { results.push("FAIL modular single-axis: hit piece cap unexpectedly"); failures++; }
  for (let i = 0; i < pieces.length; i++) checkSide(`modular single-axis piece ${i}`, pieces[i]);
  const allFit = pieces.every((p) => {
    let minZ = Infinity, maxZ = -Infinity;
    for (let i = 2; i < p.positions.length; i += 3) { minZ = Math.min(minZ, p.positions[i]); maxZ = Math.max(maxZ, p.positions[i]); }
    return maxZ - minZ <= 10 + 1e-6;
  });
  if (!allFit) { results.push("FAIL modular single-axis: a piece still exceeds bed Z"); failures++; }
}

{
  // Modular cut: oversized on all three axes -- this is the case that used
  // to fail on 42/64 pieces even with retry mitigations. Must now be clean.
  const box = buildBox(0, 0, 0, 25, 25, 25);
  const { pieces, capped } = await modularCut(box, [10, 10, 10]);
  results.push(`INFO modular multi-axis: ${pieces.length} pieces, capped ${capped}`);
  if (pieces.length <= 1) { results.push("FAIL modular multi-axis: expected multiple pieces"); failures++; }
  for (let i = 0; i < pieces.length; i++) checkSide(`modular multi-axis piece ${i}`, pieces[i]);
}

{
  // Modular cut: a piece that already fits the bed should be returned unchanged.
  const box = buildBox(0, 0, 0, 8, 8, 8);
  const { pieces } = await modularCut(box, [10, 10, 10]);
  if (pieces.length !== 1) { results.push(`FAIL modular already-fits: expected 1 piece, got ${pieces.length}`); failures++; }
  else checkSide("modular already-fits", pieces[0]);
}

{
  // Number-of-planes cut: 6 literal planes (matching LuBan's own field name and
  // multi-plane preview) should yield 7 pieces, not 6.
  const box = buildBox(0, 0, 0, 12, 12, 60);
  const pieces = await parallelPlaneCut(box, [0, 0, 0], [0, 0, 1], 6);
  results.push(`INFO parallel cut: ${pieces.length} pieces from 6 planes (expect 7)`);
  if (pieces.length !== 7) { results.push("FAIL parallel cut: expected 7 pieces from 6 planes"); failures++; }
  for (let i = 0; i < pieces.length; i++) checkSide(`parallel cut piece ${i}`, pieces[i]);
}

{
  // Number-of-planes cut with 1 plane should yield 2 pieces (an ordinary single cut).
  const box = buildBox(0, 0, 0, 10, 10, 10);
  const pieces = await parallelPlaneCut(box, [0, 0, 0], [0, 0, 1], 1);
  if (pieces.length !== 2) { results.push(`FAIL parallel cut planeCount=1: expected 2 pieces, got ${pieces.length}`); failures++; }
  else { checkSide("parallel cut planeCount=1 above", pieces[0]); checkSide("parallel cut planeCount=1 below", pieces[1]); }
}

{
  // Merge Selected's core case: re-union the two halves of an ordinary cut
  // back into one piece. Should come back watertight and match the
  // original box's volume/tri count closely (Manifold may retriangulate
  // the reunited coincident face slightly differently, so allow a little
  // slack rather than requiring an exact tri count match).
  const box = buildBox(0, 0, 0, 10, 10, 10);
  const { above, below } = await sliceMeshByPlane(box, [0, 0, 0], [0, 0, 1]);
  const merged = await unionMeshes([above, below]);
  checkSide("unionMeshes re-merged halves", merged);
  const origTris = box.indices.length / 3;
  const mergedTris = merged.indices.length / 3;
  results.push(`INFO unionMeshes re-merged halves: ${mergedTris} tris (original box had ${origTris})`);
  if (mergedTris < origTris * 0.5 || mergedTris > origTris * 3) {
    results.push(`FAIL unionMeshes re-merged halves: triangle count ${mergedTris} way off from original ${origTris}`);
    failures++;
  }
}

{
  // Genuinely disjoint pieces (never touching) should still union cleanly
  // into one watertight multi-shell mesh -- same shape splitIntoIslands
  // exists to reverse, but merging two truly separate pieces by hand is a
  // valid (if unusual) user action and must not throw.
  const boxA = buildBox(-15, 0, 0, 10, 10, 10);
  const boxB = buildBox(15, 0, 0, 10, 10, 10);
  const merged = await unionMeshes([boxA, boxB]);
  checkSide("unionMeshes disjoint pieces", merged);
  const islands = splitIntoIslands(merged);
  if (islands.length !== 2) { results.push(`FAIL unionMeshes disjoint pieces: expected 2 islands back out, got ${islands.length}`); failures++; }
}

{
  // findLargestFlatFace on a non-cube box should pick one of the two
  // largest (40x40) faces, not a side face -- and its footprint should
  // roughly match that face's real 40x40 extent.
  const box = buildBox(0, 0, 0, 40, 40, 10);
  const face = findLargestFlatFace(box);
  const width = face.uMax - face.uMin, height = face.vMax - face.vMin;
  const isTopOrBottom = Math.abs(Math.abs(face.normal[2]) - 1) < 1e-6;
  results.push(`INFO findLargestFlatFace: normal=[${face.normal.map(n => n.toFixed(2))}] footprint=${width.toFixed(1)}x${height.toFixed(1)} (expect top/bottom, ~40x40)`);
  if (!isTopOrBottom) { results.push("FAIL findLargestFlatFace: picked a side face instead of top/bottom"); failures++; }
  if (Math.abs(width - 40) > 0.01 || Math.abs(height - 40) > 0.01) {
    results.push("FAIL findLargestFlatFace: footprint doesn't match the real 40x40 face");
    failures++;
  }
}

{
  // Part-number pipeline end to end: engrave a simple raster (a hollow
  // square ring, so it's unambiguous whether it actually cut in rather
  // than e.g. silently no-op'ing) into a box's largest face -- union the
  // per-pixel boxes into one clean cutter solid, then subtract that from
  // the piece -- and confirm the result is watertight and has strictly
  // less volume than the untouched box (proof material was actually
  // removed, not just a watertight-but-unchanged passthrough).
  const box = buildBox(0, 0, 0, 40, 40, 10);
  const face = findLargestFlatFace(box);
  const gridW = 8, gridH = 8;
  const grid = new Array(gridW * gridH).fill(0);
  for (let row = 0; row < gridH; row++) {
    for (let col = 0; col < gridW; col++) {
      const onRing = row === 0 || row === gridH - 1 || col === 0 || col === gridW - 1;
      if (onRing) grid[row * gridW + col] = 1;
    }
  }
  const boxes = buildStampMesh(face, grid, gridW, gridH, 20, 20, [-2, 0.5]);
  results.push(`INFO part-number stamp: ${boxes.length} pixel boxes (expect ${gridW * 4 - 4} for an 8x8 ring)`);
  const stamp = await unionMeshes(boxes);
  checkSide("part-number stamp solid (unioned boxes)", stamp);
  const engraved = await subtractMesh(box, stamp);
  checkSide("part-number engrave result", engraved);
  const volOf = (m) => {
    let vol = 0;
    for (let t = 0; t < m.indices.length; t += 3) {
      const ia = m.indices[t] * 3, ib = m.indices[t + 1] * 3, ic = m.indices[t + 2] * 3;
      const ax = m.positions[ia], ay = m.positions[ia + 1], az = m.positions[ia + 2];
      const bx = m.positions[ib], by = m.positions[ib + 1], bz = m.positions[ib + 2];
      const cx = m.positions[ic], cy = m.positions[ic + 1], cz = m.positions[ic + 2];
      vol += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
    }
    return Math.abs(vol);
  };
  const boxVol = volOf(box), engravedVol = volOf(engraved);
  results.push(`INFO part-number engrave: box vol ${boxVol.toFixed(1)} -> engraved vol ${engravedVol.toFixed(1)}`);
  if (!(engravedVol < boxVol - 1)) { results.push("FAIL part-number engrave: no material was actually removed"); failures++; }
}

{
  // findFlatFaceGroups should find ALL of a box's 6 faces (above minArea),
  // not just the largest -- a piece can have a neighbor on more than one
  // face, which adjacency detection needs to check every candidate for.
  const box = buildBox(0, 0, 0, 20, 15, 10);
  const groups = findFlatFaceGroups(box, 25);
  results.push(`INFO findFlatFaceGroups: ${groups.length} groups on a plain box (expect 6)`);
  if (groups.length !== 6) { results.push(`FAIL findFlatFaceGroups: expected 6 faces, got ${groups.length}`); failures++; }
  const totalArea = groups.reduce((s, g) => s + g.area, 0);
  const expectedSurfaceArea = 2 * (20 * 15 + 20 * 10 + 15 * 10);
  if (Math.abs(totalArea - expectedSurfaceArea) > 0.1) {
    results.push(`FAIL findFlatFaceGroups: total area ${totalArea} != box surface area ${expectedSurfaceArea}`);
    failures++;
  }
}

{
  // The actual adjacency-detection case findAdjacentPieces exists for: cut
  // one box into two real halves (a genuine shared cut face, must be
  // detected), while two OTHER boxes that happen to share a coplanar
  // facing direction but sit far apart with a real gap between them (same
  // plane, no actual overlap) must NOT be flagged -- proves this isn't
  // just checking "same plane," it's checking real spatial overlap.
  const cutMe = buildBox(0, 0, 0, 10, 10, 10);
  const { above, below } = await sliceMeshByPlane(cutMe, [0, 0, 0], [0, 1, 0]);
  const farA = buildBox(0, 0, 0, 10, 10, 10);   // +X face at x=5
  const farB = buildBox(0, 30, 0, 10, 10, 10);  // also has a +X face at x=5, but 20mm away in Y -- no real overlap

  const pairs = findAdjacentPieces([
    { id: 'half-above', mesh: above },
    { id: 'half-below', mesh: below },
    { id: 'far-a', mesh: farA },
    { id: 'far-b', mesh: farB },
  ]);
  const halves = pairs.filter((p) => (p.pieceA === 'half-above' && p.pieceB === 'half-below') || (p.pieceA === 'half-below' && p.pieceB === 'half-above'));
  const farPair = pairs.filter((p) => (p.pieceA === 'far-a' && p.pieceB === 'far-b') || (p.pieceA === 'far-b' && p.pieceB === 'far-a'));
  results.push(`INFO findAdjacentPieces: ${pairs.length} total pairs found (expect 1: the real cut halves, not the far-apart coplanar boxes)`);
  if (halves.length !== 1) { results.push(`FAIL findAdjacentPieces: expected the real cut halves to be detected as adjacent, found ${halves.length} matches`); failures++; }
  if (farPair.length !== 0) { results.push(`FAIL findAdjacentPieces: far-apart-but-coplanar boxes were wrongly flagged as adjacent`); failures++; }

  // Partial/staggered overlap: coplanar opposite faces that only partially
  // overlap (centroids far apart) must still be detected — modular
  // staggered cuts look like this on a real model.
  // left:  occupies x=-20..0, y=-20..20  → +X face at x=0
  // right: occupies x=0..20,  y=-5..35   → -X face at x=0 (Y overlap -5..20)
  const left = buildBox(-10, 0, 0, 20, 40, 20);
  const rightPartial = buildBox(10, 15, 0, 20, 40, 20);
  const partialPairs = findAdjacentPieces([
    { id: 'left', mesh: left },
    { id: 'right', mesh: rightPartial },
  ], { minArea: 25 });
  const partialHit = partialPairs.filter((p) => (p.pieceA === 'left' && p.pieceB === 'right') || (p.pieceA === 'right' && p.pieceB === 'left'));
  results.push(`INFO findAdjacentPieces staggered: ${partialHit.length} pair(s) (expect 1)`);
  if (partialHit.length !== 1) {
    results.push(`FAIL findAdjacentPieces: staggered/partial overlap should be detected, got ${partialHit.length}`);
    failures++;
  }
}

{
  const box = buildBox(0, 0, 0, 60, 60, 30);
  const faces = findFlatFaceGroups(box, 5);
  const top = faces.find((f) => f.normal[2] > 0.9);
  const thick = top ? meshThicknessAlong(box, top) : NaN;
  results.push(`INFO meshThicknessAlong: ${thick.toFixed?.(1) ?? thick}mm on 30mm-tall box top (expect ~30)`);
  if (!(thick > 28 && thick < 32)) {
    results.push(`FAIL meshThicknessAlong: expected ~30mm, got ${thick}`);
    failures++;
  }
}

{
  // LuBan-style connectors: one sized peg/socket per shared face (not a
  // dense grid). Slice a box, place a single connector, verify volumes
  // move the right way and both sides stay watertight.
  const box = buildBox(0, 0, 0, 60, 60, 30);
  const { above, below } = await sliceMeshByPlane(box, [0, 0, 0], [1, 0, 0]);
  const pairs = findAdjacentPieces([{ id: 'A', mesh: above }, { id: 'B', mesh: below }], { minArea: 5 });
  if (pairs.length !== 1) {
    results.push(`FAIL connectors: expected 1 adjacent pair on a 2-piece box split, got ${pairs.length}`);
    failures++;
  } else {
    const { faceA, faceB } = pairs[0];
    const sites = planConnectorSites(faceA, faceB, { width: 20, maxSites: 1 });
    results.push(`INFO connectors: ${sites.length} LuBan-style site(s) on a 60x30 shared face`);
    if (sites.length !== 1) { results.push(`FAIL connectors: expected exactly 1 site (LuBan), got ${sites.length}`); failures++; }

    const volOf = (m) => {
      let v = 0;
      for (let t = 0; t < m.indices.length; t += 3) {
        const ia = m.indices[t] * 3, ib = m.indices[t + 1] * 3, ic = m.indices[t + 2] * 3;
        const ax = m.positions[ia], ay = m.positions[ia + 1], az = m.positions[ia + 2];
        const bx = m.positions[ib], by = m.positions[ib + 1], bz = m.positions[ib + 2];
        const cx = m.positions[ic], cy = m.positions[ic + 1], cz = m.positions[ic + 2];
        v += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
      }
      return Math.abs(v);
    };
    const volA0 = volOf(above), volB0 = volOf(below);
    const result = await addConnectorsToPieces(above, below, faceA, faceB, { width: 20, depth: 30, tolerance: 0.2, maxSites: 1 });
    checkSide("connectors meshA (pegs unioned)", result.meshA);
    checkSide("connectors meshB (sockets subtracted)", result.meshB);
    const volA1 = volOf(result.meshA), volB1 = volOf(result.meshB);
    results.push(`INFO connectors: volume A ${volA0.toFixed(1)} -> ${volA1.toFixed(1)}, volume B ${volB0.toFixed(1)} -> ${volB1.toFixed(1)}`);
    if (!(volA1 > volA0)) { results.push("FAIL connectors: meshA should gain volume from unioned pegs"); failures++; }
    if (!(volB1 < volB0)) { results.push("FAIL connectors: meshB should lose volume from subtracted sockets"); failures++; }
    if (result.count !== 1) { results.push(`FAIL connectors: expected count 1, got ${result.count}`); failures++; }
  }
}

{
  // Bigger face → bigger connector; smaller face → smaller (LuBan sizing rule).
  const bigFace = { normal: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0], origin: [0, 0, 0], uMin: -100, uMax: 100, vMin: -80, vMax: 80, uvTris: [[[-100, -80], [100, -80], [100, 80]], [[-100, -80], [100, 80], [-100, 80]]] };
  const smallFace = { normal: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0], origin: [0, 0, 0], uMin: -20, uMax: 20, vMin: -15, vMax: 15, uvTris: [[[-20, -15], [20, -15], [20, 15]], [[-20, -15], [20, 15], [-20, 15]]] };
  // Mirror chop.html connectorWidthForFace (40%→12% blend, 30mm cap).
  const sizeFor = (face) => {
    const minDim = Math.min(face.uMax - face.uMin, face.vMax - face.vMin);
    const t = Math.min(1, Math.max(0, (minDim - 40) / 200));
    const ratio = 0.40 * (1 - t) + 0.12 * t;
    return Math.max(5, Math.min(minDim * ratio, minDim - 4, 30));
  };
  const bigW = sizeFor(bigFace), smallW = sizeFor(smallFace);
  results.push(`INFO connector sizing: big face width≈${bigW.toFixed(1)}mm, small≈${smallW.toFixed(1)}mm`);
  if (!(bigW > smallW)) { results.push(`FAIL connector sizing: big face connector should be larger than small (${bigW} vs ${smallW})`); failures++; }
  if (bigW > 30.01) { results.push(`FAIL connector sizing: big face should hit 30mm cap, got ${bigW}`); failures++; }
  const bigSites = planConnectorSites(bigFace, { ...bigFace, normal: [0, 0, -1] }, { width: bigW, maxSites: 1 });
  const smallSites = planConnectorSites(smallFace, { ...smallFace, normal: [0, 0, -1] }, { width: smallW, maxSites: 1 });
  if (bigSites.length !== 1 || smallSites.length !== 1) {
    results.push(`FAIL connector sizing: expected 1 site each, got big=${bigSites.length} small=${smallSites.length}`);
    failures++;
  }
}

{
  // A shared face too narrow for even one connector footprint (with margin)
  // should plan zero sites, not throw or silently place an overlapping one.
  const faceA = { normal: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0], origin: [0, 0, 0], uMin: -2, uMax: 2, vMin: -20, vMax: 20, uvTris: [[[-2, -20], [2, -20], [2, 20]], [[-2, -20], [2, 20], [-2, 20]]] };
  const faceB = { normal: [0, 0, -1], u: [1, 0, 0], v: [0, 1, 0], origin: [0, 0, 0], uMin: -2, uMax: 2, vMin: -20, vMax: 20, uvTris: faceA.uvTris };
  const narrowSites = planConnectorSites(faceA, faceB, { width: 7.5 });
  results.push(`INFO connectors: ${narrowSites.length} sites planned on a 4mm-wide sliver (expect 0 -- narrower than one 7.5mm connector)`);
  if (narrowSites.length !== 0) { results.push(`FAIL connectors: sliver face should plan 0 sites, got ${narrowSites.length}`); failures++; }
}

{
  // Number-of-planes cut with 0 planes should be a no-op (single unchanged piece).
  const box = buildBox(0, 0, 0, 10, 10, 10);
  const pieces = await parallelPlaneCut(box, [0, 0, 0], [0, 0, 1], 0);
  if (pieces.length !== 1) { results.push(`FAIL parallel cut planeCount=0: expected 1 piece, got ${pieces.length}`); failures++; }
  else checkSide("parallel cut planeCount=0", pieces[0]);
}

{
  // startAtPlane: a disconnected low-lying feature (like a tail dipping to
  // the same height as the paws) shouldn't get split apart from the paws
  // in the first slice -- it should come out as one unsplit piece below
  // the chosen start plane, with only the main body above divided further.
  const paws = buildBox(0, 0, 1.5, 4, 4, 3);   // Z 0..3
  const tail = buildBox(10, 0, 1, 3, 3, 2);    // Z 0..2, disconnected in X from paws
  const body = buildBox(0, 0, 12.5, 6, 6, 15); // Z 5..20, well above both
  const dog = mergeMeshes([paws, tail, body]);

  const withoutStart = await parallelPlaneCut(dog, [0, 0, 0], [0, 0, 1], 4);
  results.push(`INFO startAtPlane=false: ${withoutStart.length} pieces (expect 5)`);
  for (let i = 0; i < withoutStart.length; i++) checkSide(`no-start piece ${i}`, withoutStart[i]);

  const withStart = await parallelPlaneCut(dog, [0, 0, 4], [0, 0, 1], 4, { startAtPlane: true });
  results.push(`INFO startAtPlane=true: ${withStart.length} pieces (expect 6: 1 unsplit low piece + 5 from the body)`);
  if (withStart.length !== 6) { results.push("FAIL startAtPlane: expected 6 pieces (1 low + 5 body)"); failures++; }
  for (let i = 0; i < withStart.length; i++) checkSide(`startAtPlane piece ${i}`, withStart[i]);
  // The first piece (paws+tail, both disconnected shells) should be far
  // smaller in Z extent than any of the body slices above it.
  const lowPieceZSize = (() => {
    const p = withStart[0];
    let minZ = Infinity, maxZ = -Infinity;
    for (let i = 2; i < p.positions.length; i += 3) { minZ = Math.min(minZ, p.positions[i]); maxZ = Math.max(maxZ, p.positions[i]); }
    return maxZ - minZ;
  })();
  if (!(lowPieceZSize <= 3 + 1e-6)) { results.push(`FAIL startAtPlane: low piece Z extent ${lowPieceZSize} should be <= 3 (paws+tail height)`); failures++; }
}

{
  // computeDefaultFlexiPlanes + flexiCut with zero overrides must exactly
  // match parallelPlaneCut's own piece boundaries (same underlying code
  // path -- this is the whole point of the refactor: Planar cut IS Flexi
  // cut with no overrides).
  const box = buildBox(0, 0, 0, 12, 12, 60);
  const viaParallel = await parallelPlaneCut(box, [0, 0, 0], [0, 0, 1], 5);
  const defaults = computeDefaultFlexiPlanes(box, [0, 0, 0], [0, 0, 1], 5);
  const viaFlexi = await flexiCut(box, defaults);
  const zBounds = (p) => {
    let minZ = Infinity, maxZ = -Infinity;
    for (let i = 2; i < p.positions.length; i += 3) { minZ = Math.min(minZ, p.positions[i]); maxZ = Math.max(maxZ, p.positions[i]); }
    return [minZ, maxZ];
  };
  const match = viaParallel.length === viaFlexi.length
    && viaParallel.every((p, i) => { const [a1, a2] = zBounds(p), [b1, b2] = zBounds(viaFlexi[i]); return Math.abs(a1 - b1) < 1e-6 && Math.abs(a2 - b2) < 1e-6; });
  results.push(`${match ? "PASS" : "FAIL"} flexiCut with no overrides matches parallelPlaneCut: ${viaParallel.length} vs ${viaFlexi.length} pieces`);
  if (!match) failures++;
  for (let i = 0; i < viaFlexi.length; i++) checkSide(`flexi-no-override piece ${i}`, viaFlexi[i]);
}

{
  // flexiCut with one plane manually moved: the piece boundary on either
  // side of the moved plane should shift accordingly, and everything must
  // still come out watertight regardless of plane order given (out-of-order
  // input must still sort correctly before cutting).
  const box = buildBox(0, 0, 0, 12, 12, 60); // Z -30..30
  const defaults = computeDefaultFlexiPlanes(box, [0, 0, 0], [0, 0, 1], 3); // 3 planes -> 4 pieces, evenly at Z -15,0,15
  // Move the middle plane (index 1, t=0) way up to t=20, and deliberately
  // pass the planes out of order to prove sorting works.
  const moved = defaults.map((d, i) => (i === 1 ? { ...d, t: 20, point: [0, 0, 20] } : d));
  const shuffled = [moved[2], moved[0], moved[1]];
  const pieces = await flexiCut(box, shuffled);
  results.push(`INFO flexi moved-plane: ${pieces.length} pieces (expect 4)`);
  if (pieces.length !== 4) { results.push("FAIL flexi moved-plane: expected 4 pieces"); failures++; }
  for (let i = 0; i < pieces.length; i++) checkSide(`flexi-moved piece ${i}`, pieces[i]);
  // Pieces should come out ordered low-to-high in Z regardless of input order.
  const zMids = pieces.map((p) => { const [a, b] = (() => { let mn=Infinity, mx=-Infinity; for (let i=2;i<p.positions.length;i+=3){mn=Math.min(mn,p.positions[i]);mx=Math.max(mx,p.positions[i]);} return [mn,mx]; })(); return (a + b) / 2; });
  const sorted = zMids.every((z, i) => i === 0 || z >= zMids[i - 1] - 1e-6);
  if (!sorted) { results.push(`FAIL flexi moved-plane: pieces not in ascending Z order: ${zMids}`); failures++; }
}

{
  // Grid cut: 2 X-planes x 1 Y-plane x 0 Z-planes should yield a 3x2x1
  // waffle of 6 pieces, all watertight, since it's built from the same
  // parallelPlaneCut primitive as Straight cut just applied per axis in sequence.
  const box = buildBox(0, 0, 0, 30, 20, 10);
  const cells = await gridCut(box, 2, 1, 0);
  results.push(`INFO grid cut: ${cells.length} pieces from 2x1x0 divisions (expect 6)`);
  if (cells.length !== 6) { results.push("FAIL grid cut: expected 6 pieces (3 x 2 x 1)"); failures++; }
  for (let i = 0; i < cells.length; i++) checkSide(`grid cut piece ${i}`, cells[i]);
}

{
  // Grid cut with divisions on all three axes -- this is the real LuBan
  // behavior (a reference screenshot showed "Number of sections in X, Y, Z"
  // = 2, 2, 3 cutting all three axes simultaneously, not just X/Y). 1 X x
  // 1 Y x 2 Z divisions should yield a 2x2x3 waffle of 12 pieces.
  const box = buildBox(0, 0, 0, 12, 12, 60);
  const cells = await gridCut(box, 1, 1, 2);
  results.push(`INFO grid cut 3-axis: ${cells.length} pieces from 1x1x2 divisions (expect 12)`);
  if (cells.length !== 12) { results.push("FAIL grid cut 3-axis: expected 12 pieces (2 x 2 x 3)"); failures++; }
  for (let i = 0; i < cells.length; i++) checkSide(`grid 3-axis piece ${i}`, cells[i]);
}

{
  // Grid cut with 0 divisions on all three axes must be a no-op (single unchanged piece).
  const box = buildBox(0, 0, 0, 10, 10, 10);
  const cells = await gridCut(box, 0, 0, 0);
  if (cells.length !== 1) { results.push(`FAIL grid cut 0x0x0: expected 1 piece, got ${cells.length}`); failures++; }
  else checkSide("grid cut 0x0x0", cells[0]);
}

{
  // Grid cut with divisions on only one axis must match a plain Straight
  // cut along that axis (the other axes' splits are simply skipped).
  const box = buildBox(0, 0, 0, 12, 12, 60);
  const viaGrid = await gridCut(box, 0, 4, 0);
  const viaStraight = await parallelPlaneCut(box, [0, 0, 0], [0, 1, 0], 4);
  const match = viaGrid.length === viaStraight.length && viaGrid.length === 5;
  results.push(`${match ? "PASS" : "FAIL"} grid cut single-axis matches Straight cut: ${viaGrid.length} vs ${viaStraight.length} pieces`);
  if (!match) failures++;
  for (let i = 0; i < viaGrid.length; i++) checkSide(`grid single-axis piece ${i}`, viaGrid[i]);
}

{
  // Staggered Grid cut (LuBan's "Staggered cut pattern"): the Y split
  // position should shift by half the Y pitch between alternating X-strips
  // -- a 40x40x10 box with 1 X-plane + 1 Y-plane, staggered, should NOT
  // produce 4 identical quadrants like the plain grid does; the second
  // X-strip's Y split should land at Y=+10 (half of the 20-unit pitch)
  // instead of Y=0, so its two Y-pieces come out 30/10 split instead of
  // 20/20. Piece count and watertightness must be unaffected -- staggering
  // only repositions existing cut planes, never adds or removes one.
  const box = buildBox(0, 0, 0, 40, 40, 10);
  const plain = await gridCut(box, 1, 1, 0);
  const staggered = await gridCut(box, 1, 1, 0, { staggered: true });
  results.push(`INFO staggered grid: ${staggered.length} pieces (expect 4, same as plain grid's ${plain.length})`);
  if (staggered.length !== 4 || plain.length !== 4) { results.push("FAIL staggered grid: expected 4 pieces from 1x1x0 divisions either way"); failures++; }
  for (let i = 0; i < staggered.length; i++) checkSide(`staggered grid piece ${i}`, staggered[i]);

  const ySizeOf = (m) => computeBounds(m.positions).size[1];
  const plainStrip0YSizes = [ySizeOf(plain[0]), ySizeOf(plain[1])].sort((a, b) => a - b);
  const staggeredStrip1YSizes = [ySizeOf(staggered[2]), ySizeOf(staggered[3])].sort((a, b) => a - b);
  results.push(`INFO staggered grid: plain X-strip0 Y-sizes ${plainStrip0YSizes.map((v) => v.toFixed(1))} (expect ~20/20), staggered X-strip1 Y-sizes ${staggeredStrip1YSizes.map((v) => v.toFixed(1))} (expect ~10/30 -- shifted by half pitch)`);
  const isEven = Math.abs(plainStrip0YSizes[0] - plainStrip0YSizes[1]) < 0.5;
  const isShifted = Math.abs(staggeredStrip1YSizes[0] - 10) < 0.5 && Math.abs(staggeredStrip1YSizes[1] - 30) < 0.5;
  if (!isEven) { results.push("FAIL staggered grid: plain (unstaggered) X-strip0 should split Y evenly"); failures++; }
  if (!isShifted) { results.push("FAIL staggered grid: staggered X-strip1 should split Y at +10 (10/30), not evenly"); failures++; }
}

{
  // staggered:true must be a no-op when there's nothing to alternate
  // against (only one axis has divisions) -- must match the plain grid
  // exactly, not throw or silently do something unexpected.
  const box = buildBox(0, 0, 0, 20, 20, 20);
  const plain = await gridCut(box, 0, 3, 0);
  const staggered = await gridCut(box, 0, 3, 0, { staggered: true });
  const match = plain.length === staggered.length && plain.length === 4;
  results.push(`${match ? "PASS" : "FAIL"} staggered grid no-op with only one active axis: ${plain.length} vs ${staggered.length} pieces`);
  if (!match) failures++;
}

{
  // Radial cut (LuBan's pie-slice partition around an axis): a box square
  // in cross-section, cut into 4 wedges around Z centered on its own axis,
  // must produce exactly 4 equal watertight quarters -- the cleanest
  // possible correctness check, since a centered square's quadrants are
  // provably equal by symmetry, not just "roughly equal."
  const volOf = (m) => {
    let v = 0;
    for (let t = 0; t < m.indices.length; t += 3) {
      const ia = m.indices[t] * 3, ib = m.indices[t + 1] * 3, ic = m.indices[t + 2] * 3;
      const ax = m.positions[ia], ay = m.positions[ia + 1], az = m.positions[ia + 2];
      const bx = m.positions[ib], by = m.positions[ib + 1], bz = m.positions[ib + 2];
      const cx = m.positions[ic], cy = m.positions[ic + 1], cz = m.positions[ic + 2];
      v += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
    }
    return Math.abs(v);
  };
  const box = buildBox(0, 0, 0, 40, 40, 20);
  const totalVol = volOf(box);

  const quad = await radialCut(box, { axis: 'z', count: 4 });
  results.push(`INFO radial cut: ${quad.length} wedges from count=4 (expect 4)`);
  if (quad.length !== 4) { results.push("FAIL radial cut: expected 4 wedges"); failures++; }
  for (let i = 0; i < quad.length; i++) checkSide(`radial quad piece ${i}`, quad[i]);
  const quadVols = quad.map(volOf);
  const allEqual = quadVols.every((v) => Math.abs(v - totalVol / 4) < 0.5);
  results.push(`INFO radial cut: quadrant volumes ${quadVols.map((v) => v.toFixed(1))} (expect all ~${(totalVol / 4).toFixed(1)})`);
  if (!allEqual) { results.push("FAIL radial cut: centered quadrants of a square cross-section should be exactly equal"); failures++; }

  // count<=1 must be a no-op -- nothing to slice into.
  const noop0 = await radialCut(box, { axis: 'z', count: 0 });
  const noop1 = await radialCut(box, { axis: 'z', count: 1 });
  if (noop0.length !== 1 || noop1.length !== 1) { results.push("FAIL radial cut: count<=1 should return the mesh unchanged as 1 piece"); failures++; }

  // count=2 uses the single-plane fast path -- must still conserve volume and stay watertight.
  const halves = await radialCut(box, { axis: 'z', count: 2 });
  const halvesVolSum = halves.reduce((s, w) => s + volOf(w), 0);
  results.push(`INFO radial cut: count=2 -> ${halves.length} pieces, volume sum ${halvesVolSum.toFixed(1)} (expect ${totalVol.toFixed(1)})`);
  if (halves.length !== 2 || Math.abs(halvesVolSum - totalVol) > 0.5) { failures++; results.push("FAIL radial cut: count=2 should give 2 watertight halves conserving total volume"); }
  for (let i = 0; i < halves.length; i++) checkSide(`radial half piece ${i}`, halves[i]);

  // An odd count (3), a different rotation axis (X), and an off-center
  // rotation axis must all still conserve total volume and stay
  // watertight -- these don't have a clean equal-split symmetry to check
  // against like the centered 4-quadrant case above, so volume
  // conservation is the correctness signal.
  const three = await radialCut(box, { axis: 'z', count: 3 });
  const threeVolSum = three.reduce((s, w) => s + volOf(w), 0);
  results.push(`INFO radial cut: count=3 -> ${three.length} wedges, volume sum ${threeVolSum.toFixed(1)} (expect ${totalVol.toFixed(1)})`);
  if (three.length !== 3 || Math.abs(threeVolSum - totalVol) > 0.5) { failures++; results.push("FAIL radial cut: count=3 should give 3 watertight wedges conserving total volume"); }
  for (let i = 0; i < three.length; i++) checkSide(`radial odd-count piece ${i}`, three[i]);

  const aroundX = await radialCut(box, { axis: 'x', count: 4 });
  const aroundXVolSum = aroundX.reduce((s, w) => s + volOf(w), 0);
  if (aroundX.length !== 4 || Math.abs(aroundXVolSum - totalVol) > 0.5) { failures++; results.push("FAIL radial cut: rotation around X should also give 4 watertight wedges conserving total volume"); }
  for (let i = 0; i < aroundX.length; i++) checkSide(`radial around-X piece ${i}`, aroundX[i]);

  const offCenter = await radialCut(box, { axis: 'z', count: 4, centerOffset: [0.5, 0] });
  const offCenterVolSum = offCenter.reduce((s, w) => s + volOf(w), 0);
  const offCenterUnequal = Math.max(...offCenter.map(volOf)) - Math.min(...offCenter.map(volOf)) > 1;
  results.push(`INFO radial cut: off-center count=4 volumes ${offCenter.map((w) => volOf(w).toFixed(1))} (expect unequal, still summing to ${totalVol.toFixed(1)})`);
  if (offCenter.length !== 4 || Math.abs(offCenterVolSum - totalVol) > 0.5 || !offCenterUnequal) {
    failures++;
    results.push("FAIL radial cut: off-center rotation axis should skew wedge sizes while still conserving total volume");
  }
  for (let i = 0; i < offCenter.length; i++) checkSide(`radial off-center piece ${i}`, offCenter[i]);
}

{
  // Export sanitize must not damage an already-watertight piece. Regression
  // for a real bug: sanitizeMeshForStl's fixed weld epsilon (0.05) was ~23%
  // of a small cut piece's own size (raw sub-1-unit source coordinates,
  // before the user applied a real-world scale) and collapsed 1542 tris
  // down to 44 on export. A scale-relative epsilon alone wasn't enough —
  // re-running the old repair pipeline on already-clean manifold-3d output
  // still introduced 3-72 open edges per piece that weren't there going
  // in, so sanitizeMeshForStl must skip weld+repair entirely when the
  // input already has 0 open edges.
  const tinyBox = buildBox(0, 0, 0, 0.05, 0.05, 0.05); // sub-1-unit scale, like the real case
  const { above } = await sliceMeshByPlane(tinyBox, [0, 0, 0], [0.4, 0.3, 1]);
  const before = above.indices.length / 3;
  const sanitized = sanitizeMeshForStl(above);
  const after = sanitized.indices.length / 3;
  results.push(`INFO export-sanitize tiny piece: ${before} tris before, ${after} after, open ${sanitized.openEdgeCount}`);
  if (after !== before || sanitized.openEdgeCount !== 0) {
    results.push(`FAIL export-sanitize tiny piece: expected ${before} tris / 0 open, got ${after} tris / ${sanitized.openEdgeCount} open`);
    failures++;
  }
}

{
  // sanitizeMeshForStl must still repair genuinely broken (unwelded, duplicated) input.
  const positions = [
    0, 0, 0, 1, 0, 0, 0, 1, 0,
    1, 0, 0, 1, 1, 0, 0, 1, 0,
    1, 0, 0, 1, 1, 0, 0, 1, 0, // duplicate of the triangle above
  ];
  const indices = [0, 1, 2, 3, 4, 5, 6, 7, 8];
  const sanitized = sanitizeMeshForStl({ positions, indices });
  const ok = sanitized.positions.length / 3 === 4 && sanitized.indices.length / 3 === 2;
  results.push(`${ok ? "PASS" : "FAIL"} export-sanitize repairs broken input: verts ${sanitized.positions.length / 3}, tris ${sanitized.indices.length / 3}`);
  if (!ok) failures++;
}

{
  // A non-manifold input (a single dangling triangle, not a closed shell)
  // should be rejected with a clear error rather than silently mis-cut.
  const dangling = { positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], indices: [0, 1, 2] };
  try {
    await sliceMeshByPlane(dangling, [0.3, 0.3, 0], [1, 0, 0]);
    results.push("FAIL non-manifold-input: expected sliceMeshByPlane to throw");
    failures++;
  } catch (e) {
    results.push(`PASS non-manifold-input: threw as expected (${e.message})`);
  }
}

{
  // smoothMesh must genuinely increase resolution on a coarse mesh, while staying watertight.
  const box = await buildDenseBox(0, 0, 0, 20, 20, 20); // 192 triangles
  const smoothed = await smoothMesh(box);
  const before = box.indices.length / 3, after = smoothed.indices.length / 3;
  results.push(`INFO smoothMesh triangle count: ${before} -> ${after}`);
  if (after <= before) { results.push("FAIL smoothMesh: expected more triangles after refining a coarse box"); failures++; }
  checkSide("smoothMesh coarse box", smoothed);
}

{
  // The whole point of using manifold-3d's smoothOut (flat faces of 3+
  // triangles always stay flat) is that it's safe to run on a real cut
  // piece without bulging the flat cut cross-section into a curve. Cut a
  // box near its base, smooth the result, and confirm the flat cap stays
  // flat instead of drifting off z=3.
  const box = await buildDenseBox(0, 0, 0, 30, 30, 30); // z in [-15, 15]
  const { below } = await sliceMeshByPlane(box, [0, 0, 3], [0, 0, 1]);
  const smoothed = await smoothMesh(below);
  checkSide("smoothMesh flat-cap piece", smoothed);
  let maxZ = -Infinity;
  for (let i = 2; i < smoothed.positions.length; i += 3) maxZ = Math.max(maxZ, smoothed.positions[i]);
  results.push(`INFO smoothMesh flat cap max Z: ${maxZ} (expect ~3)`);
  if (Math.abs(maxZ - 3) > 0.01) { results.push(`FAIL smoothMesh: flat cut face should stay flat at z=3, got maxZ=${maxZ}`); failures++; }
}

for (const r of results) console.log(r);
console.log(failures === 0 ? `\nAll checks passed (${results.length}).` : `\n${failures} FAILURE(S).`);
process.exit(failures === 0 ? 0 : 1);
