import { parseOBJ, deduplicateVertices } from '../js/painter.js';

const obj = `# cube
v 0 0 0
v 1 0 0
v 1 1 0
v 0 1 0
v 0 0 1
v 1 0 1
v 1 1 1
v 0 1 1
f 1 2 3 4
f 5 8 7 6
f 1 5 6 2
f 2 6 7 3
f 3 7 8 4
f 5 1 4 8
f 1//1 2/2/2 3
`;

const { vertices, normals, nTri } = parseOBJ(obj);
const d = deduplicateVertices(vertices, nTri);
if (nTri !== 13) throw new Error(`expected 13 tris, got ${nTri}`);
if (d.nVerts !== 8) throw new Error(`expected 8 verts, got ${d.nVerts}`);
if (!Number.isFinite(normals[0])) throw new Error('bad normal');
console.log('parseOBJ ok', { nTri, nVerts: d.nVerts });
