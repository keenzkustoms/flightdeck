/**
 * Binary STL writer from indexed mesh { positions, indices }.
 */

/**
 * Weld epsilon scaled to a mesh's own bounding-box diagonal, instead of a
 * fixed absolute value. A fixed epsilon implicitly assumes millimeter-scale
 * coordinates; for a small cut piece (or any source model in smaller raw
 * units, e.g. a Blender export before real-world scaling) it can be a large
 * fraction of the mesh's own size and catastrophically over-merge vertices
 * — confirmed on a real case where sanitizeMeshForStl's old fixed 0.05
 * collapsed a clean 1542-triangle piece down to 44 triangles on export,
 * because 0.05 was 23% of that piece's diagonal. See also mesh-import.js's
 * weldEpsFor, which fixed the same class of bug at load time.
 */
function weldEpsForMesh(positions) {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i], y = positions[i + 1], z = positions[i + 2];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  const diagonal = Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) || 1;
  return diagonal * 1e-5;
}

function facetNormal(a, b, c) {
  const ux = b[0] - a[0];
  const uy = b[1] - a[1];
  const uz = b[2] - a[2];
  const vx = c[0] - a[0];
  const vy = c[1] - a[1];
  const vz = c[2] - a[2];
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  const len = Math.hypot(nx, ny, nz) || 1;
  return [nx / len, ny / len, nz / len];
}

function writeFloatLE(view, offset, value) {
  view.setFloat32(offset, value, true);
}

function triArea2(a, b, c) {
  const ux = b[0] - a[0];
  const uy = b[1] - a[1];
  const uz = b[2] - a[2];
  const vx = c[0] - a[0];
  const vy = c[1] - a[1];
  const vz = c[2] - a[2];
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  return Math.hypot(nx, ny, nz);
}

function triArea(positions, ia, ib, ic) {
  return triArea2(
    [positions[ia * 3], positions[ia * 3 + 1], positions[ia * 3 + 2]],
    [positions[ib * 3], positions[ib * 3 + 1], positions[ib * 3 + 2]],
    [positions[ic * 3], positions[ic * 3 + 1], positions[ic * 3 + 2]],
  );
}

function edgeKey(a, b) {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/** Tally edges with 1 face (open/boundary) vs 3+ faces (Bambu "non-manifold edges"). */
function tallyEdgeUse(positions, indices) {
  const counts = new Map();
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t];
    const b = indices[t + 1];
    const c = indices[t + 2];
    const bump = (i, j) => {
      const key = edgeKey(i, j);
      counts.set(key, (counts.get(key) || 0) + 1);
    };
    bump(a, b);
    bump(b, c);
    bump(c, a);
  }
  let open = 0;
  let over = 0;
  for (const n of counts.values()) {
    if (n === 1) open += 1;
    else if (n > 2) over += 1;
  }
  return { open, over };
}

/** Count boundary edges (each should be 0 for a closed manifold mesh). */
export function countOpenEdges(positions, indices) {
  return tallyEdgeUse(positions, indices).open;
}

/** Count edges shared by 3+ faces — Bambu's "non-manifold edges" warning. */
export function countNonManifoldEdges(positions, indices) {
  return tallyEdgeUse(positions, indices).over;
}

/** Drop bad tris, weld verts, peel non-manifold faces, and verify the shell is closed. */
export function sanitizeMeshForStl(mesh, { strict = true, repair = true } = {}) {
  const positions = mesh?.positions;
  const indices = mesh?.indices;
  if (!positions?.length || !indices?.length) return null;

  // Skip weld/repair only when the shell is actually manifold: 0 open
  // edges AND 0 edges with 3+ faces. A closed hoodie STL can have 0 holes
  // and still trip Bambu ("24 non-manifold edges") — those used to skip
  // this pipeline and ship raw.
  const before = tallyEdgeUse(positions, indices);
  if (before.open === 0 && before.over === 0) {
    return { positions, indices, openEdgeCount: 0, nonManifoldEdgeCount: 0 };
  }

  let welded = weldMeshVertices(positions, indices, weldEpsForMesh(positions));
  let idx = removeDuplicateTriangles(welded.indices);
  idx = removeDegenerateTriangles(welded.positions, idx);
  idx = removeDuplicateCoplanarTriangles(welded.positions, idx);
  if (repair) idx = repairNonManifoldFaces(welded.positions, idx, 12);

  if (!idx.length) return null;

  const after = tallyEdgeUse(welded.positions, idx);
  if (strict && (after.open > 0 || after.over > 0)) {
    console.warn(`MakerDeck export: ${after.open} open / ${after.over} non-manifold edge(s) remain after sanitize — mesh may need repair in slicer`);
  }

  return { positions: welded.positions, indices: idx, openEdgeCount: after.open, nonManifoldEdgeCount: after.over };
}

/** Cap a 3-edge hole left when peel drops one triangle. Opposite winding to the open rim. */
function fillTriangularBoundaryHoles(positions, indices) {
  const use = new Map();
  const dir = new Map();
  for (let t = 0; t < indices.length; t += 3) {
    const tri = [indices[t], indices[t + 1], indices[t + 2]];
    for (let k = 0; k < 3; k++) {
      const a = tri[k];
      const b = tri[(k + 1) % 3];
      const key = edgeKey(a, b);
      use.set(key, (use.get(key) || 0) + 1);
      if (!dir.has(key)) dir.set(key, [a, b]);
    }
  }
  const opens = [];
  for (const [key, n] of use) {
    if (n === 1) opens.push(dir.get(key));
  }
  if (opens.length !== 3) return indices;
  const verts = new Set();
  for (const [a, b] of opens) {
    verts.add(a);
    verts.add(b);
  }
  if (verts.size !== 3) return indices;
  const [a, b] = opens[0];
  let x = -1;
  for (const v of verts) {
    if (v !== a && v !== b) x = v;
  }
  if (x < 0 || triArea(positions, a, x, b) < 1e-12) return indices;
  const out = indices.slice();
  out.push(a, x, b);
  return out;
}

/** Light 3MF clean: weld open shells; peel 3+ face edges on otherwise-closed meshes.
 * Stack feet with holes still skip peel (open-edge weld only) so profile shells stay intact. */
export function prepareMeshFor3mf(mesh) {
  const positions = mesh?.positions;
  const indices = mesh?.indices;
  if (!positions?.length || !indices?.length) return null;

  const before = tallyEdgeUse(positions, indices);
  if (before.open === 0 && before.over === 0) {
    const out = { positions, indices, openEdgeCount: 0, nonManifoldEdgeCount: 0 };
    if (mesh.triangleExtruders?.length === indices.length / 3) out.triangleExtruders = mesh.triangleExtruders;
    return out;
  }

  let pos = positions;
  let idx = indices;
  let changed = false;

  // Duplicate faces after weld look like 3+ edge-use. Peeling those first
  // punches a hole (hoodie Body: 24 over → 3 open). Strip dups before peel.
  idx = removeDuplicateTriangles(idx);
  idx = removeCollapsedTriangles(pos, idx);
  changed = true;
  let mid = tallyEdgeUse(pos, idx);
  if (mid.open === 0 && mid.over === 0) {
    return { positions: pos, indices: idx, openEdgeCount: 0, nonManifoldEdgeCount: 0 };
  }

  // Closed but non-manifold (hoodie STL, stamp pinches): peel extra faces, no spatial weld.
  if (mid.over > 0) {
    idx = repairNonManifoldFaces(pos, idx, 12);
    idx = removeDuplicateTriangles(idx);
    idx = removeCollapsedTriangles(pos, idx);
    mid = tallyEdgeUse(pos, idx);
  }

  if (mid.open > 0) {
    const welded = weldMeshVertices(pos, idx, weldEpsForMesh(pos));
    pos = welded.positions;
    idx = removeDuplicateTriangles(welded.indices);
    // Topology-safe only: drop collapsed/invalid tris, KEEP thin slivers — deleting a
    // positive-area sliver from a closed mesh tears an open edge (Text lost 340 edges
    // this way: 0.04 weld merged dense glyph points, then area cull removed the tris).
    idx = removeCollapsedTriangles(pos, idx);
    mid = tallyEdgeUse(pos, idx);
    if (mid.over > 0) {
      idx = repairNonManifoldFaces(pos, idx, 12);
      idx = removeDuplicateTriangles(idx);
      idx = removeCollapsedTriangles(pos, idx);
      mid = tallyEdgeUse(pos, idx);
    }
  }

  if (mid.open === 3) {
    idx = fillTriangularBoundaryHoles(pos, idx);
  }

  if (!idx.length) return null;

  const after = tallyEdgeUse(pos, idx);
  const out = { positions: pos, indices: idx, openEdgeCount: after.open, nonManifoldEdgeCount: after.over };
  if (!changed && mesh.triangleExtruders?.length === idx.length / 3) {
    out.triangleExtruders = mesh.triangleExtruders;
  }
  return out;
}

function removeCollapsedTriangles(positions, indices) {
  const out = [];
  const vertCount = positions.length / 3;
  for (let t = 0; t < indices.length; t += 3) {
    const ia = indices[t];
    const ib = indices[t + 1];
    const ic = indices[t + 2];
    if (ia < 0 || ib < 0 || ic < 0 || ia >= vertCount || ib >= vertCount || ic >= vertCount) continue;
    if (ia === ib || ib === ic || ia === ic) continue;
    const coords = [ia, ib, ic].flatMap((v) => [positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2]]);
    if (!coords.every(Number.isFinite)) continue;
    out.push(ia, ib, ic);
  }
  return out;
}

function removeDegenerateTriangles(positions, indices) {
  const out = [];
  for (let t = 0; t < indices.length; t += 3) {
    const ia = indices[t];
    const ib = indices[t + 1];
    const ic = indices[t + 2];
    const vertCount = positions.length / 3;
    if (ia < 0 || ib < 0 || ic < 0 || ia >= vertCount || ib >= vertCount || ic >= vertCount) continue;
    if (ia === ib || ib === ic || ia === ic) continue;
    if (triArea(positions, ia, ib, ic) < 1e-8) continue;
    const coords = [ia, ib, ic].flatMap((v) => [positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2]]);
    if (!coords.every(Number.isFinite)) continue;
    out.push(ia, ib, ic);
  }
  return out;
}

function removeDuplicateCoplanarTriangles(positions, indices) {
  const seen = new Set();
  const out = [];
  for (let t = 0; t < indices.length; t += 3) {
    const ia = indices[t];
    const ib = indices[t + 1];
    const ic = indices[t + 2];
    const ax = positions[ia * 3], ay = positions[ia * 3 + 1], az = positions[ia * 3 + 2];
    const bx = positions[ib * 3], by = positions[ib * 3 + 1], bz = positions[ib * 3 + 2];
    const cx = positions[ic * 3], cy = positions[ic * 3 + 1], cz = positions[ic * 3 + 2];
    let nx = (by - ay) * (cz - az) - (bz - az) * (cy - ay);
    let ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
    let nz = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;
    const d = nx * ax + ny * ay + nz * az;
    if (nx < -0.001 || (Math.abs(nx) <= 0.001 && ny < -0.001) || (Math.abs(nx) <= 0.001 && Math.abs(ny) <= 0.001 && nz < 0)) {
      nx = -nx; ny = -ny; nz = -nz;
    }
    const verts = [ia, ib, ic].sort((a, b) => a - b).join("|");
    const key = `${Math.round(nx * 500)}|${Math.round(ny * 500)}|${Math.round(nz * 500)}|${Math.round(d * 40)}|${verts}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(ia, ib, ic);
  }
  return out;
}

function repairNonManifoldFaces(positions, indices, maxPasses = 4) {
  let tris = [];
  for (let t = 0; t < indices.length; t += 3) {
    tris.push([indices[t], indices[t + 1], indices[t + 2]]);
  }

  for (let pass = 0; pass < maxPasses; pass++) {
    const edgeFaces = new Map();
    for (let fi = 0; fi < tris.length; fi++) {
      const tri = tris[fi];
      if (!tri) continue;
      const [a, b, c] = tri;
      edgeFaces.set(edgeKey(a, b), [...(edgeFaces.get(edgeKey(a, b)) || []), fi]);
      edgeFaces.set(edgeKey(b, c), [...(edgeFaces.get(edgeKey(b, c)) || []), fi]);
      edgeFaces.set(edgeKey(c, a), [...(edgeFaces.get(edgeKey(c, a)) || []), fi]);
    }

    let removed = false;
    for (const faces of edgeFaces.values()) {
      if (!faces?.length || faces.length <= 2) continue;
      let worst = -1;
      let worstArea = Infinity;
      for (const fi of faces) {
        const tri = tris[fi];
        if (!tri) continue;
        const [a, b, c] = tri;
        const area = triArea(positions, a, b, c);
        if (area < worstArea) {
          worstArea = area;
          worst = fi;
        }
      }
      if (worst < 0) continue;
      tris[worst] = null;
      removed = true;
    }
    if (!removed) break;
    tris = tris.filter(Boolean);
  }

  const out = [];
  for (const tri of tris) {
    if (!tri) continue;
    const [a, b, c] = tri;
    out.push(a, b, c);
  }
  return out;
}

export function weldMeshVertices(positions, indices, eps = 0.008) {
  const table = new Map();
  const outPos = [];

  function indexOf(x, y, z) {
    const k = `${Math.round(x / eps)}|${Math.round(y / eps)}|${Math.round(z / eps)}`;
    let idx = table.get(k);
    if (idx === undefined) {
      idx = outPos.length / 3;
      outPos.push(x, y, z);
      table.set(k, idx);
    }
    return idx;
  }

  const outIdx = [];
  for (let t = 0; t < indices.length; t += 3) {
    const ia = indices[t];
    const ib = indices[t + 1];
    const ic = indices[t + 2];
    outIdx.push(
      indexOf(positions[ia * 3], positions[ia * 3 + 1], positions[ia * 3 + 2]),
      indexOf(positions[ib * 3], positions[ib * 3 + 1], positions[ib * 3 + 2]),
      indexOf(positions[ic * 3], positions[ic * 3 + 1], positions[ic * 3 + 2]),
    );
  }
  return { positions: outPos, indices: outIdx };
}

function removeDuplicateTriangles(indices) {
  const seen = new Set();
  const out = [];
  for (let t = 0; t < indices.length; t += 3) {
    const tri = [indices[t], indices[t + 1], indices[t + 2]].sort((a, b) => a - b).join("|");
    if (seen.has(tri)) continue;
    seen.add(tri);
    out.push(indices[t], indices[t + 1], indices[t + 2]);
  }
  return out;
}

export function meshToStl(mesh, name = "makerdeck") {
  const clean = sanitizeMeshForStl(mesh);
  if (!clean) throw new Error("No valid triangles to export");

  const triCount = clean.indices.length / 3;
  const buffer = new ArrayBuffer(84 + triCount * 50);
  const view = new DataView(buffer);
  const header = new TextEncoder().encode(name.slice(0, 80));
  new Uint8Array(buffer, 0, 80).set(header);
  view.setUint32(80, triCount, true);

  let offset = 84;
  const pos = clean.positions;
  for (let t = 0; t < clean.indices.length; t += 3) {
    const ia = clean.indices[t] * 3;
    const ib = clean.indices[t + 1] * 3;
    const ic = clean.indices[t + 2] * 3;
    const a = [pos[ia], pos[ia + 1], pos[ia + 2]];
    const b = [pos[ib], pos[ib + 1], pos[ib + 2]];
    const c = [pos[ic], pos[ic + 1], pos[ic + 2]];
    const n = facetNormal(a, b, c);
    writeFloatLE(view, offset, n[0]);
    writeFloatLE(view, offset + 4, n[1]);
    writeFloatLE(view, offset + 8, n[2]);
    writeFloatLE(view, offset + 12, a[0]);
    writeFloatLE(view, offset + 16, a[1]);
    writeFloatLE(view, offset + 20, a[2]);
    writeFloatLE(view, offset + 24, b[0]);
    writeFloatLE(view, offset + 28, b[1]);
    writeFloatLE(view, offset + 32, b[2]);
    writeFloatLE(view, offset + 36, c[0]);
    writeFloatLE(view, offset + 40, c[1]);
    writeFloatLE(view, offset + 44, c[2]);
    view.setUint16(offset + 48, 0, true);
    offset += 50;
  }
  return new Blob([buffer], { type: "application/sla" });
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function filenameFor(meta, part = "body") {
  let name = `${baseModelName(meta)}.stl`;
  if (part && part !== "body") name = name.replace(/\.stl$/, `-${part}.stl`);
  if (meta.joinerHand) {
    name = name.replace(/\.stl$/, `-link-${meta.joinerHand}.stl`);
  }
  return name;
}

/** Round to 0.1mm and drop float noise (93.39999999999999 → 93.4, 80 → 80). */
function fmtMm(n) {
  const r = Math.round((Number(n) || 0) * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

/** Shared base name (no extension) for STL / 3MF downloads. */
export function baseModelName(meta) {
  if (meta?.shape === "vase") {
    const style = meta.style || "vase";
    return `${style}-${fmtMm(meta.outer?.w ?? 0)}x${fmtMm(meta.outer?.h ?? 0)}mm`;
  }
  if (!meta?.inner) return "makerdeck";
  const w = fmtMm(meta.inner.w);
  const d = fmtMm(meta.inner.d);
  const h = fmtMm(meta.inner.h);
  if (meta.shape === "circle") return `circle-${w}x${h}mm`;
  if (meta.shape === "stubbyHolder") return `hoodie-container-${w}x${h}mm`;
  if (meta.shape === "oval") return `oval-${w}x${d}x${h}mm`;
  if (meta.shape === "pencil") return `pencil-${w}x${d}x${h}mm`;
  if (meta.shape === "pencilBox") return `pencil-box-${w}x${d}x${h}mm`;
  if (meta.shape === "teardrop") return `teardrop-${w}x${d}x${h}mm`;
  if (meta.shape === "star") return `star${meta.starPoints || 5}-${w}x${h}mm`;
  if (meta.shape === "heart") return `heart-${w}x${d}x${h}mm`;
  if (meta.shape === "hex") return `hex-${w}x${h}mm`;
  if (meta.shape === "polygon") return `poly${meta.sides}-${w}x${h}mm`;
  if (meta.shape === "rounded") return `round-${w}x${d}x${h}mm`;
  return `box-${w}x${d}x${h}mm`;
}
