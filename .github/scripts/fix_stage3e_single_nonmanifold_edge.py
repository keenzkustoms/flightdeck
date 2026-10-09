from pathlib import Path

p = Path('makerforge/meshprep.html')
s = p.read_text(encoding='utf-8')

marker = """function buildUnionOrder(posA,posB){
"""
helper = r'''function repairSingleNonManifoldEdge(input){
  const first=analyseSanitiserMesh(input,input.length/9);
  if(first.degenerateTriangles!==0||first.nonManifoldEdges!==1||first.openEdges!==0||first.shells!==1)return null;
  let minX=Infinity,minY=Infinity,minZ=Infinity,maxX=-Infinity,maxY=-Infinity,maxZ=-Infinity;
  for(let i=0;i<input.length;i+=3){const x=input[i],y=input[i+1],z=input[i+2];minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);minZ=Math.min(minZ,z);maxZ=Math.max(maxZ,z);}
  const eps=Math.max(Math.max(maxX-minX,maxY-minY,maxZ-minZ)*1e-5,1e-5);
  const vk=(x,y,z)=>`${Math.round(x/eps)},${Math.round(y/eps)},${Math.round(z/eps)}`;
  const edges=new Map();
  for(let fi=0;fi<input.length/9;fi++){
    const o=fi*9,ks=[vk(input[o],input[o+1],input[o+2]),vk(input[o+3],input[o+4],input[o+5]),vk(input[o+6],input[o+7],input[o+8])];
    for(let e=0;e<3;e++){const a=ks[e],b=ks[(e+1)%3];if(a===b)continue;const k=a<b?`${a}|${b}`:`${b}|${a}`;let rec=edges.get(k);if(!rec){rec=[];edges.set(k,rec);}rec.push(fi);}
  }
  const bad=[...edges.entries()].filter(([,faces])=>faces.length!==2);
  if(bad.length!==1||bad[0][1].length<3)return null;
  const incident=[...new Set(bad[0][1])];
  const winners=[];
  for(const removeFi of incident){
    const out=new Float32Array(input.length-9);let w=0;
    for(let fi=0;fi<input.length/9;fi++){if(fi===removeFi)continue;const o=fi*9;for(let k=0;k<9;k++)out[w++]=input[o+k];}
    const a=analyseSanitiserMesh(out,out.length/9);
    if(a.degenerateTriangles===0&&a.nonManifoldEdges===0&&a.openEdges===0&&a.shells===1)winners.push({positions:out,removedFace:removeFi,analysis:a});
  }
  return winners.length===1?winners[0]:null;
}

'''
if marker not in s:
    raise SystemExit('buildUnionOrder marker not found')
s = s.replace(marker, helper + marker, 1)

old = """        const cleaned=buildUnionOrder(left,right);\n        const localAfter=analyseSanitiserMesh(cleaned.positions,cleaned.positions.length/9);"""
new = """        let cleaned=buildUnionOrder(left,right);\n        let localAfter=analyseSanitiserMesh(cleaned.positions,cleaned.positions.length/9);\n        let edgeRepair=null;\n        if(localAfter.degenerateTriangles===0&&localAfter.nonManifoldEdges===1&&localAfter.openEdges===0&&localAfter.shells===1){\n          edgeRepair=repairSingleNonManifoldEdge(cleaned.positions);\n          if(edgeRepair){cleaned={...cleaned,positions:edgeRepair.positions};localAfter=edgeRepair.analysis;}\n        }"""
if old not in s:
    raise SystemExit('Stage 3E local analysis block not found')
s = s.replace(old, new, 1)

old2 = """        attempts.push({label,positions,nTri,after,localAfter,valid,removedDegenerate:cleaned.removedDegenerate,removedDuplicate:cleaned.removedDuplicate});"""
new2 = """        attempts.push({label,positions,nTri,after,localAfter,valid,edgeRepairRemovedFace:edgeRepair?.removedFace??null,removedDegenerate:cleaned.removedDegenerate,removedDuplicate:cleaned.removedDuplicate});"""
if old2 not in s:
    raise SystemExit('Stage 3E attempts push block not found')
s = s.replace(old2, new2, 1)

old3 = """order:best.label,removedDegenerate:best.removedDegenerate,removedDuplicate:best.removedDuplicate"""
new3 = """order:best.label,edgeRepairRemovedFace:best.edgeRepairRemovedFace,removedDegenerate:best.removedDegenerate,removedDuplicate:best.removedDuplicate"""
if old3 not in s:
    raise SystemExit('Stage 3E summary metadata block not found')
s = s.replace(old3, new3, 1)

old4 = """setStatus(`Stage 3E preview ready — ${best.label}, cleanup removed ${best.removedDegenerate} degenerate / ${best.removedDuplicate} duplicate faces. ACCEPT or REJECT."""
new4 = """setStatus(`Stage 3E preview ready — ${best.label}, cleanup removed ${best.removedDegenerate} degenerate / ${best.removedDuplicate} duplicate faces${best.edgeRepairRemovedFace!==null?' + 1 uniquely proven non-manifold incident face':''}. ACCEPT or REJECT."""
if old4 not in s:
    raise SystemExit('Stage 3E preview status block not found')
s = s.replace(old4, new4, 1)

p.write_text(s, encoding='utf-8')
