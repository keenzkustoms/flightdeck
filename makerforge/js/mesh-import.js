/**
 * MakerDeck — mesh import (STL + OBJ → indexed {positions, indices})
 */
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { weldMeshVertices } from './stl.js?v=372';

function isLikelyBinarySTL(buffer) {
  if (buffer.byteLength < 84) return false;
  const dv = new DataView(buffer);
  const nTri = dv.getUint32(80, true);
  return 84 + nTri * 50 === buffer.byteLength;
}

function parseSTLBinaryPositions(buffer) {
  const dv = new DataView(buffer);
  const nTri = dv.getUint32(80, true);
  const positions = new Float32Array(nTri * 9);
  let off = 84;
  for (let i = 0; i < nTri; i++) {
    off += 12; // skip stored facet normal, we recompute on export
    for (let v = 0; v < 9; v++) {
      positions[i * 9 + v] = dv.getFloat32(off, true);
      off += 4;
    }
    off += 2; // attribute byte count
  }
  return positions;
}

function parseSTLAsciiPositions(text) {
  const verts = [];
  const re = /vertex\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)/g;
  let m;
  while ((m = re.exec(text))) {
    verts.push(parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3]));
  }
  const usable = Math.floor(verts.length / 9) * 9;
  return new Float32Array(verts.slice(0, usable));
}

/**
 * Weld epsilon scaled to the model's own size. weldMeshVertices' 0.008
 * default assumes millimeter-scale coordinates (fine for most STL exports),
 * but source files can arrive in any raw unit — e.g. a Blender OBJ export
 * with coordinates spanning ~0-1 before the user applies a real-world
 * scale. A fixed 0.008 there is ~1% of the whole model's size and silently
 * collapses distinct nearby vertices into one, destroying most of the
 * mesh's actual detail (a real case: a 2M-triangle scan welded down to
 * 21k vertices, 47x fewer than it should have — invisible under smooth
 * shading in this app's own viewer, but glaringly faceted once sliced,
 * since slicers render flat per-facet).
 */
export function weldEpsFor(flatPositions) {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < flatPositions.length; i += 3) {
    const x = flatPositions[i], y = flatPositions[i + 1], z = flatPositions[i + 2];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  const diagonal = Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) || 1;
  return diagonal * 1e-5;
}

/** Weld an unindexed flat triangle soup into the repo's {positions,indices} shape. */
function toIndexedMesh(flatPositions) {
  const nVerts = flatPositions.length / 3;
  const naiveIndices = new Array(nVerts);
  for (let i = 0; i < nVerts; i++) naiveIndices[i] = i;
  const welded = weldMeshVertices(Array.from(flatPositions), naiveIndices, weldEpsFor(flatPositions));
  return { positions: welded.positions, indices: welded.indices };
}

export function loadSTL(buffer) {
  const flat = isLikelyBinarySTL(buffer)
    ? parseSTLBinaryPositions(buffer)
    : parseSTLAsciiPositions(new TextDecoder().decode(buffer));
  if (!flat.length) throw new Error('No triangles found in STL file');
  return toIndexedMesh(flat);
}

function appendTypedArray(dest, arr) {
  for (let i = 0; i < arr.length; i++) dest.push(arr[i]);
}

export function loadOBJ(text) {
  const group = new OBJLoader().parse(text);
  const flat = [];
  group.traverse((child) => {
    if (!child.isMesh) return;
    const geom = child.geometry;
    const posAttr = geom.getAttribute('position');
    if (!posAttr) return;
    if (geom.index) {
      const idx = geom.index.array;
      for (let i = 0; i < idx.length; i++) {
        const vi = idx[i] * 3;
        flat.push(posAttr.array[vi], posAttr.array[vi + 1], posAttr.array[vi + 2]);
      }
    } else {
      appendTypedArray(flat, posAttr.array);
    }
  });
  if (!flat.length) throw new Error('No triangles found in OBJ file');
  return toIndexedMesh(new Float32Array(flat));
}

export async function loadMeshFromFile(file) {
  const name = file.name.toLowerCase();
  if (name.endsWith('.obj')) return loadOBJ(await file.text());
  if (name.endsWith('.stl')) return loadSTL(await file.arrayBuffer());
  throw new Error('Unsupported file type — use .stl or .obj');
}
