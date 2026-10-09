/**
 * MakerForge Sanitiser Core 0.1 — reconstructed Stage 2A core (v3)
 *
 * Recovery basis:
 *   - surviving Stage 1 v2 core
 *   - surviving Stage 2A Boundary Inspector consumer
 *   - SESSION_NEXT_codex.md Stage 2A contract/calibration
 *
 * Stage 2A is diagnostic only. It does not modify geometry.
 */

function buildBoundaryDiagnostics(edgeMap, vertexPositions, modelMaxDim, faceShellIds, shellFaceCounts) {
  const openEdges = [];

  for (const edge of edgeMap.values()) {
    if (edge.count === 1) openEdges.push(edge);
  }

  if (!openEdges.length) return [];

  const vertexEdges = new Map();

  const addVertexEdge = (vertexId, edgeIndex) => {
    if (!vertexEdges.has(vertexId)) vertexEdges.set(vertexId, []);
    vertexEdges.get(vertexId).push(edgeIndex);
  };

  openEdges.forEach((edge, edgeIndex) => {
    addVertexEdge(edge.a, edgeIndex);
    addVertexEdge(edge.b, edgeIndex);
  });

  const visited = new Uint8Array(openEdges.length);
  const boundaryLoops = [];

  for (let start = 0; start < openEdges.length; start++) {
    if (visited[start]) continue;

    const stack = [start];
    const componentEdges = [];
    const componentVertices = new Set();
    const degree = new Map();
    visited[start] = 1;

    while (stack.length) {
      const edgeIndex = stack.pop();
      const edge = openEdges[edgeIndex];
      componentEdges.push(edge);
      componentVertices.add(edge.a);
      componentVertices.add(edge.b);
      degree.set(edge.a, (degree.get(edge.a) || 0) + 1);
      degree.set(edge.b, (degree.get(edge.b) || 0) + 1);

      for (const vertexId of [edge.a, edge.b]) {
        for (const neighbour of vertexEdges.get(vertexId) || []) {
          if (!visited[neighbour]) {
            visited[neighbour] = 1;
            stack.push(neighbour);
          }
        }
      }
    }

    const vertexIds = [...componentVertices];
    const points = vertexIds.map(vertexId => vertexPositions[vertexId]);
    const closed =
      componentEdges.length >= 3 &&
      vertexIds.every(vertexId => degree.get(vertexId) === 2);
    const complex = !closed;

    const supportingFaces = new Set();
    for (const edge of componentEdges) {
      for (const faceId of edge.faces || []) supportingFaces.add(faceId);
    }

    const supportShellIds = new Set();
    for (const faceId of supportingFaces) {
      const shellId = faceShellIds?.[faceId];
      if (Number.isInteger(shellId) && shellId >= 0) supportShellIds.add(shellId);
    }

    const supportingFaceCount = supportingFaces.size;
    const supportShellCount = supportShellIds.size;
    const supportShellFaceCount = supportShellCount === 1
      ? (shellFaceCounts?.[[...supportShellIds][0]] || 0)
      : 0;

    // A simple perimeter is not automatically a hole. An isolated triangle,
    // sheet patch or tiny standalone shell can also present as a closed 3/4-edge
    // boundary. Capping those only hides the warning and creates zero-thickness
    // geometry. Require every boundary edge to be backed by a distinct source
    // face, all from one surrounding shell, and require that shell to contain
    // additional geometry beyond the immediate support faces.
    const simpleCapShape = closed && (componentEdges.length === 3 || componentEdges.length === 4);
    const enoughDistinctSupport = supportingFaceCount >= componentEdges.length;
    const oneSupportShell = supportShellCount === 1;
    const shellHasContext = supportShellFaceCount > supportingFaceCount;
    const repairEligible = simpleCapShape && enoughDistinctSupport && oneSupportShell && shellHasContext;

    let repairBlockReason = '';
    if (simpleCapShape && !repairEligible) {
      if (!enoughDistinctSupport) {
        repairBlockReason = 'Boundary belongs to an isolated/sheet-like fragment; capping would create zero-thickness geometry.';
      } else if (!oneSupportShell) {
        repairBlockReason = 'Boundary is supported by multiple shells; shell joining is outside safe Stage 2 scope.';
      } else if (!shellHasContext) {
        repairBlockReason = 'Boundary is the outer perimeter of its support shell, not a proven hole.';
      }
    }

    let perimeter = 0;
    const segments = componentEdges.map(edge => {
      const a = vertexPositions[edge.a];
      const b = vertexPositions[edge.b];
      perimeter += Math.hypot(
        a[0] - b[0],
        a[1] - b[1],
        a[2] - b[2]
      );
      return [[...a], [...b]];
    });

    const centroid = [0, 0, 0];
    for (const point of points) {
      centroid[0] += point[0];
      centroid[1] += point[1];
      centroid[2] += point[2];
    }
    const centroidDivisor = Math.max(points.length, 1);
    centroid[0] /= centroidDivisor;
    centroid[1] /= centroidDivisor;
    centroid[2] /= centroidDivisor;

    // Exact boundary diameter. Stage 2A is diagnostic and intentionally
    // prioritises an explainable measurement over repair-oriented heuristics.
    let maxSpan = 0;
    for (let i = 0; i < points.length; i++) {
      for (let j = i + 1; j < points.length; j++) {
        maxSpan = Math.max(
          maxSpan,
          Math.hypot(
            points[i][0] - points[j][0],
            points[i][1] - points[j][1],
            points[i][2] - points[j][2]
          )
        );
      }
    }

    // The original v3 thresholds were not recovered. These conservative,
    // diagnostic-only thresholds satisfy the documented categories without
    // authorising any repair. Large or ambiguous openings remain review-only.
    const spanRatio = maxSpan / Math.max(modelMaxDim, 1e-9);
    let classification;
    let recommendation;

    if (complex) {
      classification = 'COMPLEX';
      recommendation =
        'Branched or non-loop boundary — manual inspection only; never auto-fill.';
    } else if (
      maxSpan <= 2 &&
      perimeter <= 8 &&
      spanRatio <= 0.05
    ) {
      classification = 'SMALL';
      recommendation =
        'Small closed boundary — inspect before considering any later repair.';
    } else if (
      maxSpan <= 10 &&
      perimeter <= 40 &&
      spanRatio <= 0.25
    ) {
      classification = 'REVIEW';
      recommendation =
        'Closed boundary needs review; it may be intentional geometry.';
    } else {
      classification = 'MAJOR';
      recommendation =
        'Large opening — treat as intentional until reviewed.';
    }

    boundaryLoops.push({
      edgeCount: componentEdges.length,
      perimeter,
      maxSpan,
      centroid,
      segments,
      closed,
      complex,
      topology: closed ? 'CLOSED_LOOP' : 'BRANCHED_OR_OPEN',
      classification,
      recommendation: repairBlockReason || recommendation,
      supportingFaceCount,
      supportShellCount,
      supportShellFaceCount,
      supportShellIds: [...supportShellIds],
      repairEligible,
      repairBlockReason,
      originalClassification: classification,
    });
  }

  return boundaryLoops;
}

function analyseShellIntersections(positions, nTri, faceShellIds, shellFaceCounts, modelMaxDim, avgEdge) {
  const shellCount = shellFaceCounts?.length || 0;
  if (!nTri || shellCount < 2) return { shellAabbPairs:0, intersectingShellPairs:0, triangleIntersections:0, testedTrianglePairs:0, truncated:false, pairs:[] };

  const triBounds = new Array(nTri);
  const shellBounds = Array.from({length:shellCount},()=>({min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity]}));
  for (let fi=0; fi<nTri; fi++) {
    const o=fi*9;
    const ax=positions[o],ay=positions[o+1],az=positions[o+2],bx=positions[o+3],by=positions[o+4],bz=positions[o+5],cx=positions[o+6],cy=positions[o+7],cz=positions[o+8];
    const min=[Math.min(ax,bx,cx),Math.min(ay,by,cy),Math.min(az,bz,cz)], max=[Math.max(ax,bx,cx),Math.max(ay,by,cy),Math.max(az,bz,cz)];
    triBounds[fi]={min,max};
    const sb=shellBounds[faceShellIds[fi]];
    for(let d=0;d<3;d++){sb.min[d]=Math.min(sb.min[d],min[d]);sb.max[d]=Math.max(sb.max[d],max[d]);}
  }
  const overlap=(a,b,e=0)=>a.min[0]<=b.max[0]+e&&a.max[0]+e>=b.min[0]&&a.min[1]<=b.max[1]+e&&a.max[1]+e>=b.min[1]&&a.min[2]<=b.max[2]+e&&a.max[2]+e>=b.min[2];
  const aabbEps=Math.max(modelMaxDim*1e-8,1e-7), shellCandidates=[];
  for(let a=0;a<shellCount;a++) for(let b=a+1;b<shellCount;b++) if(shellFaceCounts[a]&&shellFaceCounts[b]&&overlap(shellBounds[a],shellBounds[b],aabbEps)) shellCandidates.push([a,b]);
  if(!shellCandidates.length) return { shellAabbPairs:0, intersectingShellPairs:0, triangleIntersections:0, testedTrianglePairs:0, truncated:false, pairs:[] };

  const candidateSet=new Set(shellCandidates.map(([a,b])=>`${a}|${b}`));
  const cellSize=Math.max(avgEdge*3,modelMaxDim/40,0.5), grid=new Map(), maxCells=125;
  const gk=(x,y,z)=>`${x},${y},${z}`;
  for(let fi=0;fi<nTri;fi++){
    const b=triBounds[fi],x0=Math.floor(b.min[0]/cellSize),x1=Math.floor(b.max[0]/cellSize),y0=Math.floor(b.min[1]/cellSize),y1=Math.floor(b.max[1]/cellSize),z0=Math.floor(b.min[2]/cellSize),z1=Math.floor(b.max[2]/cellSize);
    if((x1-x0+1)*(y1-y0+1)*(z1-z0+1)>maxCells) continue;
    for(let x=x0;x<=x1;x++)for(let y=y0;y<=y1;y++)for(let z=z0;z<=z1;z++){const k=gk(x,y,z);if(!grid.has(k))grid.set(k,[]);grid.get(k).push(fi);}
  }
  const sub=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]],cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
  const point=(fi,v)=>{const o=fi*9+v*3;return[positions[o],positions[o+1],positions[o+2]]};
  function segTri(p0,p1,t0,t1,t2){const dir=sub(p1,p0),e1=sub(t1,t0),e2=sub(t2,t0),h=cross(dir,e2),det=dot(e1,h),eps=Math.max(modelMaxDim*1e-10,1e-9);if(Math.abs(det)<eps)return false;const inv=1/det,s=sub(p0,t0),u=inv*dot(s,h);if(u<-eps||u>1+eps)return false;const q=cross(s,e1),v=inv*dot(dir,q);if(v<-eps||u+v>1+eps)return false;const t=inv*dot(e2,q);return t>eps&&t<1-eps;}
  function triHit(a,b){if(!overlap(triBounds[a],triBounds[b],aabbEps))return false;const A=[point(a,0),point(a,1),point(a,2)],B=[point(b,0),point(b,1),point(b,2)];for(let i=0;i<3;i++)if(segTri(A[i],A[(i+1)%3],B[0],B[1],B[2]))return true;for(let i=0;i<3;i++)if(segTri(B[i],B[(i+1)%3],A[0],A[1],A[2]))return true;return false;}

  const seen=new Set(),hits=new Map();let testedTrianglePairs=0,triangleIntersections=0,truncated=false;const maxTests=350000,maxHits=20000;
  outer:for(const faces of grid.values())for(let i=0;i<faces.length;i++)for(let j=i+1;j<faces.length;j++){
    const a=faces[i],b=faces[j],sa=faceShellIds[a],sb=faceShellIds[b];if(sa===sb)continue;const lo=Math.min(sa,sb),hi=Math.max(sa,sb),sp=`${lo}|${hi}`;if(!candidateSet.has(sp))continue;const tp=a<b?`${a}|${b}`:`${b}|${a}`;if(seen.has(tp))continue;seen.add(tp);testedTrianglePairs++;
    if(triHit(a,b)){triangleIntersections++;hits.set(sp,(hits.get(sp)||0)+1);if(triangleIntersections>=maxHits){truncated=true;break outer;}}
    if(testedTrianglePairs>=maxTests){truncated=true;break outer;}
  }
  const pairs=[...hits.entries()].map(([k,n])=>{
    const[a,b]=k.split('|').map(Number);
    const shellAFaces=shellFaceCounts[a]||0, shellBFaces=shellFaceCounts[b]||0;
    const smallerFaces=Math.min(shellAFaces,shellBFaces);
    const largerFaces=Math.max(shellAFaces,shellBFaces);
    const crossingDensity=n/Math.max(1,smallerFaces);
    let overlapType='CROSSING SHELLS';
    let severity='REVIEW';
    let reason='Two substantial shells have proven triangle crossings.';
    let recommendation='Inspect the intersecting shells before any union, trim, or cap operation.';
    if(smallerFaces<=4){
      overlapType='STRAY FRAGMENT CONTACT';
      severity='FRAGMENT';
      reason='One intersecting shell is only a few faces, consistent with a stray export fragment or sliver.';
      recommendation='Verify the tiny shell is unwanted before removing it.';
    }else if(n>=500 || crossingDensity>=0.35){
      overlapType='DEEP OVERLAP';
      severity='HIGH';
      reason='The pair has dense proven cross-shell intersections, consistent with strongly overlapping exported objects.';
      recommendation='Resolve this pair before boundary repair; likely candidates are boolean union or internal-face trimming after review.';
    }else if(n<=3 && smallerFaces<=32){
      overlapType='LOCAL CONTACT';
      severity='LOW';
      reason='Only a few crossings are proven and one shell is relatively small.';
      recommendation='Inspect locally; this may be a small accidental collision or intended contact.';
    }
    return{shellA:a,shellB:b,intersections:n,shellAFaces,shellBFaces,smallerFaces,largerFaces,crossingDensity,overlapType,severity,reason,recommendation};
  }).sort((a,b)=>b.intersections-a.intersections);
  const intersectingShellIds = [...new Set(pairs.flatMap(pair => [pair.shellA, pair.shellB]))].sort((a,b)=>a-b);
  const typeCounts = pairs.reduce((acc,pair)=>{acc[pair.overlapType]=(acc[pair.overlapType]||0)+1;return acc;},{});
  return {shellAabbPairs:shellCandidates.length,intersectingShellPairs:pairs.length,triangleIntersections,testedTrianglePairs,truncated,intersectingShellIds,typeCounts,pairs:pairs.slice(0,100)};
}


function buildStage3CShellIds(positions, nTri) {
  let minX=Infinity,minY=Infinity,minZ=Infinity,maxX=-Infinity,maxY=-Infinity,maxZ=-Infinity;
  for(let i=0;i<nTri;i++){
    const o=i*9;
    for(let v=0;v<3;v++){
      const p=o+v*3,x=positions[p],y=positions[p+1],z=positions[p+2];
      minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);minZ=Math.min(minZ,z);maxZ=Math.max(maxZ,z);
    }
  }
  const maxDim=Math.max(maxX-minX,maxY-minY,maxZ-minZ,1e-9);
  const eps=Math.max(maxDim*1e-7,1e-7);
  const key=(x,y,z)=>`${Math.round(x/eps)},${Math.round(y/eps)},${Math.round(z/eps)}`;
  const vertexMap=new Map(), faceVerts=new Array(nTri), vertexFaces=[];
  for(let fi=0;fi<nTri;fi++){
    const o=fi*9, ids=[];
    for(let v=0;v<3;v++){
      const p=o+v*3,k=key(positions[p],positions[p+1],positions[p+2]);
      if(!vertexMap.has(k)){const id=vertexMap.size;vertexMap.set(k,id);vertexFaces[id]=[];}
      const id=vertexMap.get(k);ids.push(id);vertexFaces[id].push(fi);
    }
    faceVerts[fi]=ids;
  }
  const visited=new Uint8Array(nTri), faceShellIds=new Int32Array(nTri);faceShellIds.fill(-1);
  const shellFaceCounts=[];let shells=0;
  for(let start=0;start<nTri;start++){
    if(visited[start])continue;
    const sid=shells++,stack=[start];visited[start]=1;faceShellIds[start]=sid;let count=0;
    while(stack.length){
      const fi=stack.pop();count++;
      for(const vi of faceVerts[fi])for(const nb of vertexFaces[vi])if(!visited[nb]){visited[nb]=1;faceShellIds[nb]=sid;stack.push(nb);}
    }
    shellFaceCounts[sid]=count;
  }
  return {faceShellIds,shellFaceCounts};
}


function stage3DShellProfile(positions, nTri, shellId) {
  const { faceShellIds, shellFaceCounts } = buildStage3CShellIds(positions, nTri);
  if (!Number.isInteger(shellId) || shellId < 0 || !shellFaceCounts[shellId]) {
    throw new Error('Stage 3D shell identity is no longer valid.');
  }

  let minX=Infinity,minY=Infinity,minZ=Infinity,maxX=-Infinity,maxY=-Infinity,maxZ=-Infinity;
  for (let fi=0; fi<nTri; fi++) {
    if (faceShellIds[fi] !== shellId) continue;
    const o=fi*9;
    for (let v=0;v<3;v++) {
      const p=o+v*3,x=positions[p],y=positions[p+1],z=positions[p+2];
      minX=Math.min(minX,x);maxX=Math.max(maxX,x);
      minY=Math.min(minY,y);maxY=Math.max(maxY,y);
      minZ=Math.min(minZ,z);maxZ=Math.max(maxZ,z);
    }
  }
  const maxDim=Math.max(maxX-minX,maxY-minY,maxZ-minZ,1e-9);
  const eps=Math.max(maxDim*1e-7,1e-7);
  const key=(x,y,z)=>`${Math.round(x/eps)},${Math.round(y/eps)},${Math.round(z/eps)}`;
  const vertexMap=new Map(), vertexPositions=[];
  const edgeMap=new Map();
  const vertexId=(x,y,z)=>{
    const k=key(x,y,z);
    if(!vertexMap.has(k)){const id=vertexMap.size;vertexMap.set(k,id);vertexPositions[id]=[x,y,z];}
    return vertexMap.get(k);
  };

  for(let fi=0;fi<nTri;fi++){
    if(faceShellIds[fi]!==shellId)continue;
    const o=fi*9;
    const ids=[
      vertexId(positions[o],positions[o+1],positions[o+2]),
      vertexId(positions[o+3],positions[o+4],positions[o+5]),
      vertexId(positions[o+6],positions[o+7],positions[o+8])
    ];
    for(let e=0;e<3;e++){
      const from=ids[e],to=ids[(e+1)%3];
      if(from===to)continue;
      const k=from<to?`${from}|${to}`:`${to}|${from}`;
      const ex=edgeMap.get(k);
      if(ex){ex.count++;ex.faces.push(fi);}
      else edgeMap.set(k,{count:1,a:Math.min(from,to),b:Math.max(from,to),from,to,faces:[fi]});
    }
  }

  const open=[...edgeMap.values()].filter(e=>e.count===1);
  const nonManifoldEdges=[...edgeMap.values()].filter(e=>e.count>2).length;
  const vertexEdges=new Map();
  const add=(v,i)=>{if(!vertexEdges.has(v))vertexEdges.set(v,[]);vertexEdges.get(v).push(i);};
  open.forEach((e,i)=>{add(e.a,i);add(e.b,i);});
  const visited=new Uint8Array(open.length), loops=[];

  const quadSafe = pts => {
    const sub=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]];
    const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
    const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
    const n=cross(sub(pts[1],pts[0]),sub(pts[2],pts[0]));
    const nl=Math.hypot(...n);
    if(nl<=eps*eps)return false;
    const nn=n.map(v=>v/nl), tol=Math.max(maxDim*1e-5,1e-5);
    if(Math.abs(dot(sub(pts[3],pts[0]),nn))>tol)return false;
    const drop=Math.abs(nn[0])>Math.abs(nn[1])?(Math.abs(nn[0])>Math.abs(nn[2])?0:2):(Math.abs(nn[1])>Math.abs(nn[2])?1:2);
    const p2=pts.map(p=>drop===0?[p[1],p[2]]:drop===1?[p[0],p[2]]:[p[0],p[1]]);
    let sign=0;
    for(let i=0;i<4;i++){
      const a=p2[i],b=p2[(i+1)%4],c=p2[(i+2)%4];
      const z=(b[0]-a[0])*(c[1]-b[1])-(b[1]-a[1])*(c[0]-b[0]);
      if(Math.abs(z)<=eps*eps)return false;
      const sgn=Math.sign(z);if(!sign)sign=sgn;else if(sgn!==sign)return false;
    }
    return true;
  };

  for(let start=0;start<open.length;start++){
    if(visited[start])continue;
    const stack=[start], comp=[], degree=new Map();visited[start]=1;
    while(stack.length){
      const i=stack.pop(),e=open[i];comp.push(e);
      degree.set(e.a,(degree.get(e.a)||0)+1);degree.set(e.b,(degree.get(e.b)||0)+1);
      for(const v of [e.a,e.b])for(const nb of vertexEdges.get(v)||[])if(!visited[nb]){visited[nb]=1;stack.push(nb);}
    }
    const verts=[...new Set(comp.flatMap(e=>[e.a,e.b]))];
    const closed=comp.length>=3&&verts.every(v=>degree.get(v)===2);
    let cycleIds=[], repairable=false, reason='Boundary is not a simple closed 3/4-edge loop.';
    if(closed&&(comp.length===3||comp.length===4)){
      const byFrom=new Map();let directed=true;
      for(const e of comp){if(byFrom.has(e.from)){directed=false;break;}byFrom.set(e.from,e);}
      if(directed){
        const first=comp[0];cycleIds=[first.from,first.to];
        let cur=first.to;
        for(let guard=0;guard<comp.length-2;guard++){
          const next=byFrom.get(cur);if(!next){directed=false;break;}cycleIds.push(next.to);cur=next.to;
        }
        const last=byFrom.get(cur);
        if(!last||last.to!==first.from||new Set(cycleIds).size!==comp.length)directed=false;
      }
      if(directed){
        const pts=cycleIds.map(id=>vertexPositions[id]);
        if(comp.length===3){
          const a=pts[0],b=pts[1],c=pts[2];
          const area2=Math.hypot((b[1]-a[1])*(c[2]-a[2])-(b[2]-a[2])*(c[1]-a[1]),(b[2]-a[2])*(c[0]-a[0])-(b[0]-a[0])*(c[2]-a[2]),(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]));
          repairable=area2>eps*eps*2; reason=repairable?'Simple triangular shell opening.':'Triangular opening is degenerate.';
        } else {
          repairable=quadSafe(pts); reason=repairable?'Planar convex quadrilateral shell opening.':'Quad opening failed planarity/convexity safety checks.';
        }
      } else reason='Boundary winding is inconsistent.';
    }
    loops.push({edgeCount:comp.length,closed,repairable,reason,cyclePoints:cycleIds.map(id=>vertexPositions[id])});
  }

  const repairableLoops=loops.filter(l=>l.repairable);
  const repairableEdges=repairableLoops.reduce((sum,l)=>sum+l.edgeCount,0);
  const blockedOpenings=loops.filter(l=>!l.repairable).length;
  const canPrepare=nonManifoldEdges===0&&open.length>0&&repairableEdges===open.length&&blockedOpenings===0;
  return {shellId,faces:shellFaceCounts[shellId],openEdges:open.length,nonManifoldEdges,openings:loops.length,repairableOpenings:repairableLoops.length,repairableEdges,blockedOpenings,canPrepare,loops};
}

export function analyseSanitiserIntersectionStage3D(positions, nTri, pair) {
  if(!positions||!nTri||!pair)throw new Error('Stage 3D requires the current mesh and a shell pair.');
  const shellA=stage3DShellProfile(positions,nTri,pair.shellA);
  const shellB=stage3DShellProfile(positions,nTri,pair.shellB);
  const alreadyReady=shellA.openEdges===0&&shellB.openEdges===0&&shellA.nonManifoldEdges===0&&shellB.nonManifoldEdges===0;
  const canPrepare=!alreadyReady&&
    shellA.nonManifoldEdges===0&&shellB.nonManifoldEdges===0&&
    (shellA.openEdges===0||shellA.canPrepare)&&
    (shellB.openEdges===0||shellB.canPrepare);
  return {shellA,shellB,alreadyReady,canPrepare,repairableOpenings:shellA.repairableOpenings+shellB.repairableOpenings,repairableEdges:shellA.repairableEdges+shellB.repairableEdges};
}

export function repairSanitiserIntersectionStage3D(positions, nTri, pair) {
  const pre=analyseSanitiserIntersectionStage3D(positions,nTri,pair);
  if(pre.alreadyReady)throw new Error('Stage 3D is not required; both shells are already closed solids.');
  if(!pre.canPrepare)throw new Error('Stage 3D refused: one or more shell openings are ambiguous or non-manifold.');
  const caps=[];
  for(const profile of [pre.shellA,pre.shellB]){
    for(const loop of profile.loops){
      if(!loop.repairable)continue;
      const p=loop.cyclePoints;
      if(loop.edgeCount===3)caps.push([...p[0],...p[2],...p[1]]);
      else if(loop.edgeCount===4){caps.push([...p[0],...p[2],...p[1]]);caps.push([...p[0],...p[3],...p[2]]);}
    }
  }
  if(!caps.length)throw new Error('Stage 3D found no safe shell openings to close.');
  const repaired=new Float32Array(positions.length+caps.length*9);repaired.set(positions,0);
  let w=positions.length;for(const cap of caps)for(const v of cap)repaired[w++]=v;
  return {positions:repaired,nTri:nTri+caps.length,addedFaces:caps.length,repairedOpenEdges:pre.repairableEdges,repairedOpenings:pre.repairableOpenings,preflight:pre};
}

export function repairSanitiserIntersectionStage3C(positions, nTri, pair) {
  if(!positions || !nTri || !pair) throw new Error('Stage 3C requires a current mesh and selected shell pair.');
  if(pair.overlapType !== 'STRAY FRAGMENT CONTACT') throw new Error('Stage 3C currently repairs only proven stray-fragment contacts. Deep overlaps require the union stage.');
  const aFaces=Number(pair.shellAFaces)||0,bFaces=Number(pair.shellBFaces)||0;
  const smallerFaces=Math.min(aFaces,bFaces);
  if(smallerFaces<1 || smallerFaces>4) throw new Error('Stage 3C fragment safety gate refused this shell size.');
  if(aFaces===bFaces) throw new Error('Stage 3C cannot safely choose which equal-sized shell is stray.');
  const removeShellId=aFaces<bFaces ? pair.shellA : pair.shellB;
  const {faceShellIds,shellFaceCounts}=buildStage3CShellIds(positions,nTri);
  const actualCount=shellFaceCounts[removeShellId]||0;
  if(actualCount!==smallerFaces || actualCount>4) throw new Error('Stage 3C shell identity changed; original mesh preserved.');
  const kept=[];let removedFaces=0;
  for(let fi=0;fi<nTri;fi++){
    if(faceShellIds[fi]===removeShellId){removedFaces++;continue;}
    const o=fi*9;for(let k=0;k<9;k++)kept.push(positions[o+k]);
  }
  if(removedFaces!==actualCount) throw new Error('Stage 3C removal count mismatch; original mesh preserved.');
  return {positions:new Float32Array(kept),nTri:nTri-removedFaces,removedFaces,removedShellId:removeShellId};
}

/**
 * Stage 3C batch repair for proven tiny stray-fragment shells.
 * Shell membership is frozen from one analysis snapshot so shell renumbering
 * cannot make a later removal target the wrong component.
 */
export function repairSanitiserIntersectionStage3CBatch(positions, nTri, pairs) {
  if(!positions || !nTri || !Array.isArray(pairs)) throw new Error('Stage 3C batch repair requires a current mesh and intersection pairs.');
  const {faceShellIds,shellFaceCounts}=buildStage3CShellIds(positions,nTri);
  const removeShellIds=new Set();
  for(const pair of pairs){
    if(!pair || pair.overlapType !== 'STRAY FRAGMENT CONTACT') continue;
    const aFaces=Number(pair.shellAFaces)||0,bFaces=Number(pair.shellBFaces)||0;
    if(aFaces===bFaces) continue;
    const smallerFaces=Math.min(aFaces,bFaces);
    if(smallerFaces<1 || smallerFaces>4) continue;
    const shellId=aFaces<bFaces ? pair.shellA : pair.shellB;
    const actualCount=shellFaceCounts[shellId]||0;
    if(actualCount!==smallerFaces || actualCount>4) continue;
    removeShellIds.add(shellId);
  }
  if(!removeShellIds.size) throw new Error('No uniquely proven safe stray-fragment shells are available for batch removal.');
  const kept=[];let removedFaces=0;
  for(let fi=0;fi<nTri;fi++){
    if(removeShellIds.has(faceShellIds[fi])){removedFaces++;continue;}
    const o=fi*9;for(let k=0;k<9;k++)kept.push(positions[o+k]);
  }
  const expectedFaces=[...removeShellIds].reduce((sum,sid)=>sum+(shellFaceCounts[sid]||0),0);
  if(removedFaces!==expectedFaces) throw new Error('Stage 3C batch removal count mismatch; original mesh preserved.');
  return {positions:new Float32Array(kept),nTri:nTri-removedFaces,removedFaces,removedShells:removeShellIds.size,removedShellIds:[...removeShellIds]};
}

export function analyseSanitiserMesh(positions, nTri) {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

  let surfaceArea = 0;
  let degenerateTriangles = 0;
  let duplicateTriangles = 0;
  let edgeSum = 0;
  let edgeCount = 0;

  const edgeMap = new Map();
  const vertexMap = new Map();
  const vertexPositions = [];
  const faceVerts = new Array(nTri);
  const faceKeyMap = new Map();

  const rawVertexKey = (x, y, z, eps) =>
    `${Math.round(x / eps)},${Math.round(y / eps)},${Math.round(z / eps)}`;

  // First pass: bounds
  for (let i = 0; i < nTri; i++) {
    const o = i * 9;

    for (let v = 0; v < 3; v++) {
      const p = o + v * 3;
      const x = positions[p];
      const y = positions[p + 1];
      const z = positions[p + 2];

      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }
  }

  const sizeX = maxX - minX;
  const sizeY = maxY - minY;
  const sizeZ = maxZ - minZ;
  const maxDim = Math.max(sizeX, sizeY, sizeZ);
  const eps = Math.max(maxDim * 1e-7, 1e-7);

  // Second pass: triangle metrics + topology
  for (let i = 0; i < nTri; i++) {
    const o = i * 9;

    const pts = [
      [positions[o], positions[o + 1], positions[o + 2]],
      [positions[o + 3], positions[o + 4], positions[o + 5]],
      [positions[o + 6], positions[o + 7], positions[o + 8]],
    ];

    const ux = pts[1][0] - pts[0][0];
    const uy = pts[1][1] - pts[0][1];
    const uz = pts[1][2] - pts[0][2];

    const vx = pts[2][0] - pts[0][0];
    const vy = pts[2][1] - pts[0][1];
    const vz = pts[2][2] - pts[0][2];

    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;

    const area2 = Math.hypot(nx, ny, nz);
    const area = area2 * 0.5;

    if (area <= eps * eps) {
      degenerateTriangles++;
    } else {
      surfaceArea += area;
    }

    const keys = pts.map(([x, y, z]) => {
      const key = rawVertexKey(x, y, z, eps);
      if (!vertexMap.has(key)) {
        const vertexId = vertexMap.size;
        vertexMap.set(key, vertexId);
        vertexPositions[vertexId] = [x, y, z];
      }
      return vertexMap.get(key);
    });

    faceVerts[i] = keys;

    // Canonical face identity ignores winding, so an exact duplicate and
    // the same triangle with reversed winding are both counted safely.
    // Degenerate faces are tracked separately and are not double-counted here.
    if (area > eps * eps) {
      const faceKey = [...keys].sort((a, b) => a - b).join('|');
      if (faceKeyMap.has(faceKey)) duplicateTriangles++;
      else faceKeyMap.set(faceKey, i);
    }

    for (let e = 0; e < 3; e++) {
      const a = pts[e];
      const b = pts[(e + 1) % 3];

      edgeSum += Math.hypot(
        a[0] - b[0],
        a[1] - b[1],
        a[2] - b[2]
      );
      edgeCount++;

      const ia = keys[e];
      const ib = keys[(e + 1) % 3];
      if (ia === ib) continue;

      const edgeKey = ia < ib ? `${ia}|${ib}` : `${ib}|${ia}`;
      const existing = edgeMap.get(edgeKey);
      if (existing) {
        existing.count++;
        existing.faces.push(i);
      } else {
        edgeMap.set(edgeKey, { count: 1, a: ia, b: ib, faces: [i] });
      }
    }
  }

  let openEdges = 0;
  let nonManifoldEdges = 0;

  for (const edge of edgeMap.values()) {
    if (edge.count === 1) openEdges++;
    else if (edge.count > 2) nonManifoldEdges++;
  }

  // Connected shells/components
  const vertexFaces = Array.from(
    { length: vertexMap.size },
    () => []
  );

  for (let fi = 0; fi < nTri; fi++) {
    for (const vi of faceVerts[fi]) {
      vertexFaces[vi].push(fi);
    }
  }

  const visited = new Uint8Array(nTri);
  const faceShellIds = new Int32Array(nTri);
  faceShellIds.fill(-1);
  const shellFaceCounts = [];
  let shells = 0;

  for (let start = 0; start < nTri; start++) {
    if (visited[start]) continue;

    const shellId = shells++;
    let shellFaceCount = 0;
    const stack = [start];
    visited[start] = 1;
    faceShellIds[start] = shellId;

    while (stack.length) {
      const fi = stack.pop();
      shellFaceCount++;

      for (const vi of faceVerts[fi]) {
        for (const nb of vertexFaces[vi]) {
          if (!visited[nb]) {
            visited[nb] = 1;
            faceShellIds[nb] = shellId;
            stack.push(nb);
          }
        }
      }
    }

    shellFaceCounts[shellId] = shellFaceCount;
  }

  const watertight =
    openEdges === 0 &&
    nonManifoldEdges === 0 &&
    degenerateTriangles === 0;

  const avgEdge = edgeSum / Math.max(edgeCount, 1);

  // ------------------------------------------------------------
  // Base / bed-contact analysis
  // ------------------------------------------------------------

  const baseTolerance = Math.max(sizeZ * 0.001, 0.05);
  const normalThreshold = 0.985;

  let baseArea = 0;
  let baseTriangles = 0;

  let baseMinX = Infinity;
  let baseMinY = Infinity;
  let baseMaxX = -Infinity;
  let baseMaxY = -Infinity;

  for (let i = 0; i < nTri; i++) {
    const o = i * 9;

    const ax = positions[o];
    const ay = positions[o + 1];
    const az = positions[o + 2];

    const bx = positions[o + 3];
    const by = positions[o + 4];
    const bz = positions[o + 5];

    const cx = positions[o + 6];
    const cy = positions[o + 7];
    const cz = positions[o + 8];

    const triMinZ = Math.min(az, bz, cz);
    const triMaxZ = Math.max(az, bz, cz);

    if (triMinZ > minZ + baseTolerance) continue;
    if (triMaxZ > minZ + baseTolerance) continue;

    const ux = bx - ax;
    const uy = by - ay;
    const uz = bz - az;

    const vx = cx - ax;
    const vy = cy - ay;
    const vz = cz - az;

    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;

    const normalLength = Math.hypot(nx, ny, nz);
    if (normalLength <= 1e-12) continue;

    const absNormalZ = Math.abs(nz / normalLength);

    if (absNormalZ < normalThreshold) continue;

    const projectedArea = Math.abs(nz) * 0.5;

    if (projectedArea <= 0) continue;

    baseArea += projectedArea;
    baseTriangles++;

    baseMinX = Math.min(baseMinX, ax, bx, cx);
    baseMaxX = Math.max(baseMaxX, ax, bx, cx);
    baseMinY = Math.min(baseMinY, ay, by, cy);
    baseMaxY = Math.max(baseMaxY, ay, by, cy);
  }

  const baseWidth =
    baseTriangles > 0 ? baseMaxX - baseMinX : 0;

  const baseDepth =
    baseTriangles > 0 ? baseMaxY - baseMinY : 0;

  const footprintArea = Math.max(sizeX * sizeY, 1e-9);

  const baseCoverage = baseArea / footprintArea;

  let baseRating = 'POOR';

  if (baseCoverage >= 0.50) {
    baseRating = 'EXCELLENT';
  } else if (baseCoverage >= 0.25) {
    baseRating = 'GOOD';
  } else if (baseCoverage >= 0.08) {
    baseRating = 'MARGINAL';
  }

  // ------------------------------------------------------------
  // Scale sanity
  // ------------------------------------------------------------

  const largestDimension = Math.max(sizeX, sizeY, sizeZ);
  const smallestDimension = Math.min(sizeX, sizeY, sizeZ);

  let scaleStatus = 'OK';
  let scaleReason = '';
  let scaleSuspicious = false;

  if (largestDimension < 5) {
    scaleStatus = 'REVIEW';
    scaleSuspicious = true;
    scaleReason =
      'Model dimensions are unusually small and may need scaling.';
  }

  const scale = {
    suspicious: scaleSuspicious,
    status: scaleStatus,
    reason: scaleReason,
    sizeX,
    sizeY,
    sizeZ,
    largestDimension,
    smallestDimension
  };

  const boundaryLoops = buildBoundaryDiagnostics(
    edgeMap,
    vertexPositions,
    maxDim,
    faceShellIds,
    shellFaceCounts
  );

  const intersections = analyseShellIntersections(
    positions, nTri, faceShellIds, shellFaceCounts, maxDim, avgEdge
  );

  // Stage 3C union preflight is deliberately shell-local. A whole STL may have
  // thousands of open edges while a particular intersecting pair is still made
  // from two valid closed solids. Count topology defects for each connected shell
  // so boolean-union eligibility is based on the actual pair, not the whole file.
  const shellTopology = Array.from({ length: shells }, () => ({ openEdges: 0, nonManifoldEdges: 0 }));
  for (const edge of edgeMap.values()) {
    if (!edge.faces?.length) continue;
    if (edge.count === 1) {
      const sid = faceShellIds[edge.faces[0]];
      if (sid >= 0 && shellTopology[sid]) shellTopology[sid].openEdges++;
    } else if (edge.count > 2) {
      const touched = new Set(edge.faces.map(fi => faceShellIds[fi]).filter(sid => sid >= 0));
      for (const sid of touched) if (shellTopology[sid]) shellTopology[sid].nonManifoldEdges++;
    }
  }
  for (const pair of intersections.pairs || []) {
    const ta = shellTopology[pair.shellA] || { openEdges: 0, nonManifoldEdges: 0 };
    const tb = shellTopology[pair.shellB] || { openEdges: 0, nonManifoldEdges: 0 };
    pair.shellAOpenEdges = ta.openEdges;
    pair.shellBOpenEdges = tb.openEdges;
    pair.shellANonManifoldEdges = ta.nonManifoldEdges;
    pair.shellBNonManifoldEdges = tb.nonManifoldEdges;
    pair.unionReady =
      pair.overlapType !== 'STRAY FRAGMENT CONTACT' &&
      pair.shellAFaces >= 4 && pair.shellBFaces >= 4 &&
      ta.openEdges === 0 && tb.openEdges === 0 &&
      ta.nonManifoldEdges === 0 && tb.nonManifoldEdges === 0;
    pair.unionBlockReason = pair.unionReady ? '' : (
      pair.overlapType === 'STRAY FRAGMENT CONTACT'
        ? 'Tiny fragment contacts use the safe fragment-removal path instead of boolean union.'
        : `Shell ${pair.shellA + 1}: ${ta.openEdges} open / ${ta.nonManifoldEdges} non-manifold edges; ` +
          `Shell ${pair.shellB + 1}: ${tb.openEdges} open / ${tb.nonManifoldEdges} non-manifold edges.`
    );
  }

  // Stage 3A evidence feeds back into Stage 2A diagnosis, but never into
  // repair authorisation. The repairEligible flag remains the only cap gate.
  const intersectingShellIds = new Set(intersections.intersectingShellIds || []);
  for (const loop of boundaryLoops) {
    const supportIds = loop.supportShellIds || [];
    const touchesProvenIntersection = supportIds.some(id => intersectingShellIds.has(id));

    if (loop.complex || loop.topology !== 'CLOSED_LOOP') {
      loop.classification = 'COMPLEX';
      loop.recommendation = 'Boundary is branched or open-chain topology; manual inspection only.';
      continue;
    }

    if (touchesProvenIntersection) {
      loop.classification = 'INTERSECTING SHELL';
      loop.recommendation = 'This boundary belongs to a shell with proven cross-shell triangle intersections. Resolve the shell overlap before attempting a cap.';
      continue;
    }

    if (loop.repairEligible === true) {
      loop.classification = 'HOLE';
      loop.recommendation = loop.edgeCount === 3
        ? 'Proven simple triangular hole with surrounding-shell support; Stage 2B cap is permitted.'
        : 'Proven simple planar-cap candidate with surrounding-shell support; Stage 2C performs final planarity/convexity checks.';
      continue;
    }

    loop.classification = 'SHELL OPENING';
    loop.recommendation = loop.repairBlockReason ||
      'Closed boundary is not proven to be a hole. Treat it as an open shell perimeter until reviewed.';
  }

  return {
    nTri,
    uniqueVertices: vertexMap.size,

    sizeX,
    sizeY,
    sizeZ,
    maxDim,

    surfaceArea,
    avgEdge,

    openEdges,
    nonManifoldEdges,
    degenerateTriangles,
    duplicateTriangles,
    shells,
    watertight,
    scale,
    boundaryLoops,
    intersections,

    base: {
      detected: baseTriangles > 0,
      area: baseArea,
      triangles: baseTriangles,
      width: baseWidth,
      depth: baseDepth,
      coverage: baseCoverage,
      rating: baseRating,
      tolerance: baseTolerance,
    },

    bounds: {
      min: [minX, minY, minZ],
      max: [maxX, maxY, maxZ],
    },
  };
}

/**
 * Stage 1 safe repair.
 *
 * Removes only objectively invalid/redundant triangles:
 *   - zero/near-zero area triangles
 *   - duplicate triangles, including reversed winding
 *
 * Surviving triangle coordinates are copied unchanged.
 *
 * No welding, hole filling, shell joining, normal re-orientation,
 * or topology reconstruction is performed.
 */
export function repairSanitiserMeshStage1(positions, nTri) {
  if (!positions || !Number.isFinite(nTri) || nTri < 0) {
    throw new Error('Invalid mesh supplied to Stage 1 repair.');
  }

  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

  for (let i = 0; i < nTri; i++) {
    const o = i * 9;

    for (let v = 0; v < 3; v++) {
      const p = o + v * 3;

      const x = positions[p];
      const y = positions[p + 1];
      const z = positions[p + 2];

      if (x < minX) minX = x;
      if (x > maxX) maxX = x;

      if (y < minY) minY = y;
      if (y > maxY) maxY = y;

      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }
  }

  const sizeX = Number.isFinite(minX) ? maxX - minX : 0;
  const sizeY = Number.isFinite(minY) ? maxY - minY : 0;
  const sizeZ = Number.isFinite(minZ) ? maxZ - minZ : 0;

  const maxDim = Math.max(sizeX, sizeY, sizeZ, 0);
  const eps = Math.max(maxDim * 1e-7, 1e-7);

  const vertexIds = new Map();
  const keptFaceKeys = new Set();

  let nextVertexId = 0;
  let removedDegenerate = 0;
  let removedDuplicates = 0;

  const kept = [];

  const vertexId = (x, y, z) => {
    const key =
      `${Math.round(x / eps)},` +
      `${Math.round(y / eps)},` +
      `${Math.round(z / eps)}`;

    if (!vertexIds.has(key)) {
      vertexIds.set(key, nextVertexId++);
    }

    return vertexIds.get(key);
  };

  for (let i = 0; i < nTri; i++) {
    const o = i * 9;

    const ax = positions[o];
    const ay = positions[o + 1];
    const az = positions[o + 2];

    const bx = positions[o + 3];
    const by = positions[o + 4];
    const bz = positions[o + 5];

    const cx = positions[o + 6];
    const cy = positions[o + 7];
    const cz = positions[o + 8];

    const ux = bx - ax;
    const uy = by - ay;
    const uz = bz - az;

    const vx = cx - ax;
    const vy = cy - ay;
    const vz = cz - az;

    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;

    const area = Math.hypot(nx, ny, nz) * 0.5;

    if (area <= eps * eps) {
      removedDegenerate++;
      continue;
    }

    const ids = [
      vertexId(ax, ay, az),
      vertexId(bx, by, bz),
      vertexId(cx, cy, cz),
    ].sort((a, b) => a - b);

    const faceKey = ids.join('|');

    if (keptFaceKeys.has(faceKey)) {
      removedDuplicates++;
      continue;
    }

    keptFaceKeys.add(faceKey);

    for (let v = 0; v < 9; v++) {
      kept.push(positions[o + v]);
    }
  }

  return {
    positions: new Float32Array(kept),
    nTri: kept.length / 9,

    beforeFaces: nTri,
    afterFaces: kept.length / 9,

    removedDegenerate,
    removedDuplicates,

    removedTotal:
      removedDegenerate +
      removedDuplicates,
  };
}

function boundaryRepairSignature(boundary, eps) {
  const pointKey = point =>
    `${Math.round(point[0] / eps)},${Math.round(point[1] / eps)},${Math.round(point[2] / eps)}`;
  const segments = (boundary?.segments || []).map(([a, b]) => {
    const ka = pointKey(a);
    const kb = pointKey(b);
    return ka < kb ? `${ka}>${kb}` : `${kb}>${ka}`;
  }).sort();
  return `${boundary?.edgeCount || 0}|${segments.join('|')}`;
}

/**
 * Stage 2B selected-boundary repair, first conservative release.
 *
 * Repairs ONLY a simple closed triangular boundary (3 open edges / 3 vertices).
 * The selected loop must come from analyseSanitiserMesh(...).boundaryLoops.
 *
 * Safety rules:
 * - no branched/complex boundaries
 * - no polygon triangulation yet
 * - no welding
 * - no shell joining
 * - no vertex movement
 * - existing source triangles are copied byte-for-byte as Float32 coordinates
 *
 * The replacement triangle is wound opposite to the directed open-edge loop,
 * so each repaired boundary edge is paired with the existing adjacent face.
 */
export function repairSanitiserBoundaryStage2B(positions, nTri, boundary) {
  if (!positions || !Number.isFinite(nTri) || nTri < 0) {
    throw new Error('Invalid mesh supplied to Stage 2B repair.');
  }

  if (!boundary) {
    throw new Error('Select a boundary before repairing.');
  }

  if (!boundary.closed || boundary.complex || boundary.topology !== 'CLOSED_LOOP') {
    throw new Error('Stage 2B will not repair complex or open-chain boundaries.');
  }

  if (boundary.edgeCount !== 3 || !Array.isArray(boundary.segments) || boundary.segments.length !== 3) {
    throw new Error('Stage 2B currently repairs only simple three-edge boundaries.');
  }

  const freshStage2B = analyseSanitiserMesh(positions, nTri);
  const stage2BEps = Math.max((freshStage2B.maxDim || 0) * 1e-7, 1e-7);
  const stage2BSig = boundaryRepairSignature(boundary, stage2BEps);
  const stage2BFreshBoundary = freshStage2B.boundaryLoops.find(
    loop => boundaryRepairSignature(loop, stage2BEps) === stage2BSig
  );
  if (!stage2BFreshBoundary) {
    throw new Error('Selected boundary no longer matches the current mesh.');
  }
  if (!stage2BFreshBoundary.repairEligible) {
    throw new Error(stage2BFreshBoundary.repairBlockReason || 'Stage 2B support-context safety check refused this cap.');
  }

  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

  for (let i = 0; i < nTri * 9; i += 3) {
    const x = positions[i], y = positions[i + 1], z = positions[i + 2];
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
  }

  const maxDim = Math.max(maxX - minX, maxY - minY, maxZ - minZ, 0);
  const eps = Math.max(maxDim * 1e-7, 1e-7);

  const vertexMap = new Map();
  const vertexPositions = [];
  const edgeMap = new Map();

  const vertexKey = (x, y, z) =>
    `${Math.round(x / eps)},${Math.round(y / eps)},${Math.round(z / eps)}`;

  const vertexId = (x, y, z) => {
    const key = vertexKey(x, y, z);
    if (!vertexMap.has(key)) {
      const id = vertexMap.size;
      vertexMap.set(key, id);
      vertexPositions[id] = [x, y, z];
    }
    return vertexMap.get(key);
  };

  for (let fi = 0; fi < nTri; fi++) {
    const o = fi * 9;
    const ids = [
      vertexId(positions[o], positions[o + 1], positions[o + 2]),
      vertexId(positions[o + 3], positions[o + 4], positions[o + 5]),
      vertexId(positions[o + 6], positions[o + 7], positions[o + 8]),
    ];

    for (let e = 0; e < 3; e++) {
      const from = ids[e];
      const to = ids[(e + 1) % 3];
      if (from === to) continue;

      const key = from < to ? `${from}|${to}` : `${to}|${from}`;
      const entry = edgeMap.get(key);

      if (entry) {
        entry.count++;
      } else {
        edgeMap.set(key, {
          count: 1,
          a: Math.min(from, to),
          b: Math.max(from, to),
          from,
          to,
        });
      }
    }
  }

  // Resolve the selected boundary coordinates back to this mesh's canonical IDs.
  const selectedIds = new Set();

  for (const segment of boundary.segments) {
    if (!Array.isArray(segment) || segment.length !== 2) {
      throw new Error('Selected boundary contains invalid segment data.');
    }

    for (const point of segment) {
      const id = vertexMap.get(vertexKey(point[0], point[1], point[2]));
      if (id == null) {
        throw new Error('Selected boundary no longer matches the current mesh.');
      }
      selectedIds.add(id);
    }
  }

  if (selectedIds.size !== 3) {
    throw new Error('Stage 2B selected boundary is not a three-vertex loop.');
  }

  const selectedOpenEdges = [];

  for (const edge of edgeMap.values()) {
    if (
      edge.count === 1 &&
      selectedIds.has(edge.from) &&
      selectedIds.has(edge.to)
    ) {
      selectedOpenEdges.push(edge);
    }
  }

  if (selectedOpenEdges.length !== 3) {
    throw new Error('Selected boundary changed; expected exactly three open edges.');
  }

  // Existing consistently-oriented manifold faces direct the three boundary
  // edges around the hole as a cycle. Follow that cycle, then reverse it for
  // the replacement face so every shared edge gets opposite direction.
  const byFrom = new Map();

  for (const edge of selectedOpenEdges) {
    if (byFrom.has(edge.from)) {
      throw new Error('Boundary winding is ambiguous; repair refused.');
    }
    byFrom.set(edge.from, edge);
  }

  const first = selectedOpenEdges[0];
  const second = byFrom.get(first.to);
  const third = second ? byFrom.get(second.to) : null;

  if (
    !second ||
    !third ||
    third.to !== first.from ||
    new Set([first.from, first.to, second.to]).size !== 3
  ) {
    throw new Error('Boundary winding is inconsistent; repair refused.');
  }

  const cycle = [first.from, first.to, second.to];
  const capIds = [cycle[0], cycle[2], cycle[1]];
  const cap = capIds.map(id => vertexPositions[id]);

  const ux = cap[1][0] - cap[0][0];
  const uy = cap[1][1] - cap[0][1];
  const uz = cap[1][2] - cap[0][2];
  const vx = cap[2][0] - cap[0][0];
  const vy = cap[2][1] - cap[0][1];
  const vz = cap[2][2] - cap[0][2];
  const area2 = Math.hypot(
    uy * vz - uz * vy,
    uz * vx - ux * vz,
    ux * vy - uy * vx
  );

  if (area2 <= eps * eps * 2) {
    throw new Error('Replacement face would be degenerate; repair refused.');
  }

  const repaired = new Float32Array(positions.length + 9);
  repaired.set(positions, 0);

  let w = positions.length;
  for (const point of cap) {
    repaired[w++] = point[0];
    repaired[w++] = point[1];
    repaired[w++] = point[2];
  }

  return {
    positions: repaired,
    nTri: nTri + 1,
    beforeFaces: nTri,
    afterFaces: nTri + 1,
    addedFaces: 1,
    repairedBoundaryEdges: 3,
    method: 'TRIANGULAR_BOUNDARY_CAP',
  };
}

/**
 * Stage 2C selected-boundary repair, first conservative quad release.
 *
 * Repairs ONLY a simple, closed, planar, convex four-edge boundary.
 * The selected loop must come from analyseSanitiserMesh(...).boundaryLoops.
 *
 * Safety rules:
 * - no branched/complex boundaries
 * - exactly 4 open edges / 4 vertices
 * - boundary must be planar within a tight tolerance
 * - boundary must be convex
 * - no welding
 * - no shell joining
 * - no vertex movement
 * - existing source triangles are copied unchanged
 *
 * The quad is triangulated across the shorter valid diagonal. The cap winding
 * is opposite to the existing directed open-edge cycle so each boundary edge
 * pairs with the adjacent source face.
 */
export function repairSanitiserBoundaryStage2C(positions, nTri, boundary) {
  if (!positions || !Number.isFinite(nTri) || nTri < 0) {
    throw new Error('Invalid mesh supplied to Stage 2C repair.');
  }

  if (!boundary) {
    throw new Error('Select a boundary before repairing.');
  }

  if (!boundary.closed || boundary.complex || boundary.topology !== 'CLOSED_LOOP') {
    throw new Error('Stage 2C will not repair complex or open-chain boundaries.');
  }

  if (
    boundary.edgeCount !== 4 ||
    !Array.isArray(boundary.segments) ||
    boundary.segments.length !== 4
  ) {
    throw new Error('Stage 2C currently repairs only simple four-edge boundaries.');
  }

  const freshStage2C = analyseSanitiserMesh(positions, nTri);
  const stage2CEps = Math.max((freshStage2C.maxDim || 0) * 1e-7, 1e-7);
  const stage2CSig = boundaryRepairSignature(boundary, stage2CEps);
  const stage2CFreshBoundary = freshStage2C.boundaryLoops.find(
    loop => boundaryRepairSignature(loop, stage2CEps) === stage2CSig
  );
  if (!stage2CFreshBoundary) {
    throw new Error('Selected boundary no longer matches the current mesh.');
  }
  if (!stage2CFreshBoundary.repairEligible) {
    throw new Error(stage2CFreshBoundary.repairBlockReason || 'Stage 2C support-context safety check refused this cap.');
  }

  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

  for (let i = 0; i < nTri * 9; i += 3) {
    const x = positions[i], y = positions[i + 1], z = positions[i + 2];
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
  }

  const maxDim = Math.max(maxX - minX, maxY - minY, maxZ - minZ, 0);
  const eps = Math.max(maxDim * 1e-7, 1e-7);

  const vertexMap = new Map();
  const vertexPositions = [];
  const edgeMap = new Map();

  const vertexKey = (x, y, z) =>
    `${Math.round(x / eps)},${Math.round(y / eps)},${Math.round(z / eps)}`;

  const vertexId = (x, y, z) => {
    const key = vertexKey(x, y, z);
    if (!vertexMap.has(key)) {
      const id = vertexMap.size;
      vertexMap.set(key, id);
      vertexPositions[id] = [x, y, z];
    }
    return vertexMap.get(key);
  };

  for (let fi = 0; fi < nTri; fi++) {
    const o = fi * 9;
    const ids = [
      vertexId(positions[o], positions[o + 1], positions[o + 2]),
      vertexId(positions[o + 3], positions[o + 4], positions[o + 5]),
      vertexId(positions[o + 6], positions[o + 7], positions[o + 8]),
    ];

    for (let e = 0; e < 3; e++) {
      const from = ids[e];
      const to = ids[(e + 1) % 3];
      if (from === to) continue;

      const key = from < to ? `${from}|${to}` : `${to}|${from}`;
      const entry = edgeMap.get(key);

      if (entry) {
        entry.count++;
      } else {
        edgeMap.set(key, {
          count: 1,
          a: Math.min(from, to),
          b: Math.max(from, to),
          from,
          to,
        });
      }
    }
  }

  const selectedIds = new Set();

  for (const segment of boundary.segments) {
    if (!Array.isArray(segment) || segment.length !== 2) {
      throw new Error('Selected boundary contains invalid segment data.');
    }

    for (const point of segment) {
      const id = vertexMap.get(vertexKey(point[0], point[1], point[2]));
      if (id == null) {
        throw new Error('Selected boundary no longer matches the current mesh.');
      }
      selectedIds.add(id);
    }
  }

  if (selectedIds.size !== 4) {
    throw new Error('Stage 2C selected boundary is not a four-vertex loop.');
  }

  const selectedOpenEdges = [];

  for (const edge of edgeMap.values()) {
    if (
      edge.count === 1 &&
      selectedIds.has(edge.from) &&
      selectedIds.has(edge.to)
    ) {
      selectedOpenEdges.push(edge);
    }
  }

  if (selectedOpenEdges.length !== 4) {
    throw new Error('Selected boundary changed; expected exactly four open edges.');
  }

  // Follow the directed boundary cycle from the existing adjacent faces.
  const byFrom = new Map();

  for (const edge of selectedOpenEdges) {
    if (byFrom.has(edge.from)) {
      throw new Error('Boundary winding is ambiguous; repair refused.');
    }
    byFrom.set(edge.from, edge);
  }

  const first = selectedOpenEdges[0];
  const cycle = [first.from];
  let current = first;

  for (let step = 0; step < 4; step++) {
    cycle.push(current.to);
    current = byFrom.get(current.to);
    if (step < 3 && !current) {
      throw new Error('Boundary winding is inconsistent; repair refused.');
    }
  }

  if (
    cycle.length !== 5 ||
    cycle[4] !== cycle[0] ||
    new Set(cycle.slice(0, 4)).size !== 4
  ) {
    throw new Error('Boundary winding is inconsistent; repair refused.');
  }

  // Reverse the open-edge cycle to produce cap winding.
  const capIds = [cycle[0], cycle[3], cycle[2], cycle[1]];
  const p = capIds.map(id => vertexPositions[id]);

  const sub = (a, b) => [a[0]-b[0], a[1]-b[1], a[2]-b[2]];
  const cross = (a, b) => [
    a[1]*b[2]-a[2]*b[1],
    a[2]*b[0]-a[0]*b[2],
    a[0]*b[1]-a[1]*b[0],
  ];
  const dot = (a, b) => a[0]*b[0] + a[1]*b[1] + a[2]*b[2];
  const length = a => Math.hypot(a[0], a[1], a[2]);

  const e01 = sub(p[1], p[0]);
  const e02 = sub(p[2], p[0]);
  const planeNormal = cross(e01, e02);
  const normalLen = length(planeNormal);

  if (normalLen <= eps * eps * 2) {
    throw new Error('Quad boundary is degenerate; repair refused.');
  }

  const unitNormal = planeNormal.map(v => v / normalLen);
  const boundarySpan = Math.max(
    ...p.flatMap((a, i) =>
      p.slice(i + 1).map(b => length(sub(a, b)))
    ),
    1
  );

  // Planarity: fourth point must lie very close to the plane of the first 3.
  const planeDistance = Math.abs(dot(sub(p[3], p[0]), unitNormal));
  const planarityTolerance = Math.max(eps * 20, boundarySpan * 1e-4);

  if (planeDistance > planarityTolerance) {
    throw new Error('Quad boundary is not planar enough for safe Stage 2C repair.');
  }

  // Convexity: each successive corner must turn consistently around the plane.
  const turns = [];
  for (let i = 0; i < 4; i++) {
    const prev = p[(i + 3) % 4];
    const here = p[i];
    const next = p[(i + 1) % 4];
    const a = sub(here, prev);
    const b = sub(next, here);
    turns.push(dot(cross(a, b), unitNormal));
  }

  const turnTol = Math.max(eps * eps * 4, boundarySpan * boundarySpan * 1e-10);
  const positive = turns.every(v => v > turnTol);
  const negative = turns.every(v => v < -turnTol);

  if (!positive && !negative) {
    throw new Error('Quad boundary is concave or ambiguous; repair refused.');
  }

  const d02 = length(sub(p[2], p[0]));
  const d13 = length(sub(p[3], p[1]));

  const triangles =
    d02 <= d13
      ? [[p[0], p[1], p[2]], [p[0], p[2], p[3]]]
      : [[p[1], p[2], p[3]], [p[1], p[3], p[0]]];

  for (const tri of triangles) {
    const area2 = length(cross(sub(tri[1], tri[0]), sub(tri[2], tri[0])));
    if (area2 <= eps * eps * 2) {
      throw new Error('Quad triangulation would create a degenerate face; repair refused.');
    }
  }

  const repaired = new Float32Array(positions.length + 18);
  repaired.set(positions, 0);

  let w = positions.length;
  for (const tri of triangles) {
    for (const point of tri) {
      repaired[w++] = point[0];
      repaired[w++] = point[1];
      repaired[w++] = point[2];
    }
  }

  return {
    positions: repaired,
    nTri: nTri + 2,
    beforeFaces: nTri,
    afterFaces: nTri + 2,
    addedFaces: 2,
    repairedBoundaryEdges: 4,
    method: 'PLANAR_CONVEX_QUAD_CAP',
    diagonal: d02 <= d13 ? '0-2' : '1-3',
  };
}
