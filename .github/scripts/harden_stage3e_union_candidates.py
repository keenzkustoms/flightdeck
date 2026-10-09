from pathlib import Path

p = Path('makerforge/meshprep.html')
s = p.read_text(encoding='utf-8')
start = s.find('function buildUnionPreview(pairIndex){')
end = s.find('\n\nfunction showIntersectionInspector', start)
if start < 0 or end < 0:
    raise SystemExit('Stage 3E buildUnionPreview block not found')

replacement = r'''function sanitizeUnionPositions(input){
  if(!input?.length||input.length%9)throw new Error('Boolean union returned invalid triangle data');
  let minX=Infinity,minY=Infinity,minZ=Infinity,maxX=-Infinity,maxY=-Infinity,maxZ=-Infinity;
  for(let i=0;i<input.length;i+=3){const x=input[i],y=input[i+1],z=input[i+2];minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);minZ=Math.min(minZ,z);maxZ=Math.max(maxZ,z);}
  const maxDim=Math.max(maxX-minX,maxY-minY,maxZ-minZ,1);
  const keyEps=Math.max(maxDim*1e-8,1e-8);
  const areaEps=Math.max(maxDim*maxDim*1e-12,1e-14);
  const vk=(x,y,z)=>`${Math.round(x/keyEps)},${Math.round(y/keyEps)},${Math.round(z/keyEps)}`;
  const seen=new Set(),out=[];let removedDegenerate=0,removedDuplicate=0;
  for(let i=0;i<input.length;i+=9){
    const ax=input[i],ay=input[i+1],az=input[i+2],bx=input[i+3],by=input[i+4],bz=input[i+5],cx=input[i+6],cy=input[i+7],cz=input[i+8];
    const ux=bx-ax,uy=by-ay,uz=bz-az,vx=cx-ax,vy=cy-ay,vz=cz-az;
    const nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx;
    const twiceArea=Math.hypot(nx,ny,nz);
    const keys=[vk(ax,ay,az),vk(bx,by,bz),vk(cx,cy,cz)];
    if(keys[0]===keys[1]||keys[1]===keys[2]||keys[2]===keys[0]||twiceArea<=areaEps){removedDegenerate++;continue;}
    const faceKey=keys.slice().sort().join('|');
    if(seen.has(faceKey)){removedDuplicate++;continue;}
    seen.add(faceKey);
    for(let k=0;k<9;k++)out.push(input[i+k]);
  }
  return{positions:new Float32Array(out),removedDegenerate,removedDuplicate};
}

function buildUnionOrder(posA,posB){
  const ga=new THREE.BufferGeometry(),gb=new THREE.BufferGeometry();
  ga.setAttribute('position',new THREE.BufferAttribute(posA,3));
  gb.setAttribute('position',new THREE.BufferAttribute(posB,3));
  const a=new Brush(ga),b=new Brush(gb);a.updateMatrixWorld();b.updateMatrixWorld();
  const evaluator=new Evaluator();evaluator.attributes=['position'];evaluator.useGroups=false;
  let result=null;
  try{
    result=evaluator.evaluate(a,b,ADDITION);
    const raw=unionGeometryPositions(result.geometry);
    return sanitizeUnionPositions(raw);
  }finally{
    ga.dispose();gb.dispose();if(result?.geometry)result.geometry.dispose();
  }
}

function buildUnionPreview(pairIndex){
  const parsed=currentParsed||sourceParsed;if(!parsed)return;
  try{
    const before=analyseSanitiserMesh(parsed.positions,parsed.nTri),pair=before.intersections?.pairs?.[pairIndex];
    if(!pair||!pair.unionReady)throw new Error('Selected pair is no longer UNION READY');
    setStatus(`Stage 3E: building two guarded union candidates for Shell ${pair.shellA+1} / ${pair.shellB+1}...`);
    const map=buildUnionShellMap(parsed);
    if((map.counts[pair.shellA]||0)!==pair.shellAFaces||(map.counts[pair.shellB]||0)!==pair.shellBFaces)throw new Error('Shell identity changed');
    const posA=unionShellPositions(parsed,map,pair.shellA),posB=unionShellPositions(parsed,map,pair.shellB);
    const kept=[];for(let fi=0;fi<parsed.nTri;fi++){const sid=map.faceShellIds[fi];if(sid===pair.shellA||sid===pair.shellB)continue;const o=fi*9;for(let k=0;k<9;k++)kept.push(parsed.positions[o+k]);}
    const attempts=[];
    for(const [label,left,right] of [['A+B',posA,posB],['B+A',posB,posA]]){
      try{
        const cleaned=buildUnionOrder(left,right);
        const positions=new Float32Array(kept.length+cleaned.positions.length);positions.set(kept);positions.set(cleaned.positions,kept.length);
        const nTri=positions.length/9,after=analyseSanitiserMesh(positions,nTri);
        const valid=after.degenerateTriangles<=before.degenerateTriangles&&after.nonManifoldEdges<=before.nonManifoldEdges&&after.openEdges<=before.openEdges&&after.shells<before.shells;
        attempts.push({label,positions,nTri,after,valid,removedDegenerate:cleaned.removedDegenerate,removedDuplicate:cleaned.removedDuplicate});
      }catch(error){attempts.push({label,error});}
    }
    const viable=attempts.filter(x=>x.valid).sort((a,b)=>a.after.nonManifoldEdges-b.after.nonManifoldEdges||a.after.degenerateTriangles-b.after.degenerateTriangles||a.after.openEdges-b.after.openEdges||a.after.shells-b.after.shells||a.after.nTri-b.after.nTri);
    if(!viable.length){
      const detail=attempts.map(x=>x.error?`${x.label}: ${x.error.message||x.error}`:`${x.label}: ${x.after.degenerateTriangles} degenerate / ${x.after.nonManifoldEdges} non-manifold / ${x.after.openEdges} open / ${x.after.shells} shells (cleanup −${x.removedDegenerate} degenerate, −${x.removedDuplicate} duplicate)`).join('; ');
      throw new Error(`no safe union candidate after cleanup — ${detail}`);
    }
    const best=viable[0],after=best.after;
    unionCandidate={positions:best.positions,nTri:best.nTri,summary:{shellA:pair.shellA,shellB:pair.shellB,beforeFaces:before.nTri,afterFaces:after.nTri,beforeOpen:before.openEdges,afterOpen:after.openEdges,beforeShells:before.shells,afterShells:after.shells,order:best.label,removedDegenerate:best.removedDegenerate,removedDuplicate:best.removedDuplicate}};
    showMesh(best.positions);showIntersectionInspector(before);
    setStatus(`Stage 3E preview ready — ${best.label}, cleanup removed ${best.removedDegenerate} degenerate / ${best.removedDuplicate} duplicate faces. ACCEPT or REJECT. Shells ${before.shells.toLocaleString()} → ${after.shells.toLocaleString()}, open edges ${before.openEdges.toLocaleString()} → ${after.openEdges.toLocaleString()}`);
  }catch(err){
    console.error('Stage 3E union preview refused:',err);unionCandidate=null;const parsed=currentParsed||sourceParsed;if(parsed)showMesh(parsed.positions);setStatus(`Stage 3E union preview refused: ${err.message||err}`);
  }
}'''

s = s[:start] + replacement + s[end:]
p.write_text(s, encoding='utf-8')
