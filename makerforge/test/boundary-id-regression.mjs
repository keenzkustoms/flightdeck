
const boundaryIdBySignature = new Map();
let nextBoundaryId = 1;

function boundarySignature(loop, modelMaxDim = 1) {
  const eps = Math.max(Math.abs(modelMaxDim) * 1e-7, 1e-7);
  const pointKey = p =>
    `${Math.round(p[0] / eps)},${Math.round(p[1] / eps)},${Math.round(p[2] / eps)}`;
  const segmentKeys = loop.segments.map(([a,b]) => {
    const ka = pointKey(a), kb = pointKey(b);
    return ka < kb ? `${ka}>${kb}` : `${kb}>${ka}`;
  }).sort();
  return [loop.topology, loop.edgeCount, ...segmentKeys].join('|');
}

function assign(loops, maxDim=120) {
  for (const loop of loops) {
    const sig = boundarySignature(loop, maxDim);
    if (!boundaryIdBySignature.has(sig)) boundaryIdBySignature.set(sig, nextBoundaryId++);
    loop.persistentId = boundaryIdBySignature.get(sig);
  }
}

const tri = x => ({
  topology:'CLOSED_LOOP',
  edgeCount:3,
  segments:[
    [[x,0,20],[x+20,0,20]],
    [[x+20,0,20],[x+20,40,20]],
    [[x+20,40,20],[x,0,20]],
  ],
});

const first=[tri(-60),tri(-20),tri(20)];
assign(first);
if (first.map(x=>x.persistentId).join(',') !== '1,2,3')
  throw new Error('Initial IDs are not 1,2,3');

const afterFirst=[tri(-20),tri(20)];
assign(afterFirst);
if (afterFirst.map(x=>x.persistentId).join(',') !== '2,3')
  throw new Error(`Expected surviving IDs 2,3; got ${afterFirst.map(x=>x.persistentId)}`);

const afterSecond=[tri(20)];
assign(afterSecond);
if (afterSecond[0].persistentId !== 3)
  throw new Error(`Expected surviving ID 3; got ${afterSecond[0].persistentId}`);

console.log('PASS persistent boundary identity');
console.log('initial: Boundary 1, Boundary 2, Boundary 3');
console.log('after repair 1: Boundary 2, Boundary 3');
console.log('after repair 2: Boundary 3');
