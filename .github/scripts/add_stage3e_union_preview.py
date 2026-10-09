from pathlib import Path

p=Path('makerforge/meshprep.html')
s=p.read_text(encoding='utf-8')

s=s.replace('"three/addons/": "https://cdn.jsdelivr.net/npm/three@0.164.1/examples/jsm/"','"three/addons/": "https://cdn.jsdelivr.net/npm/three@0.164.1/examples/jsm/",\n    "three-mesh-bvh": "https://cdn.jsdelivr.net/npm/three-mesh-bvh@0.9.7/build/index.module.js",\n    "three-bvh-csg": "https://cdn.jsdelivr.net/npm/three-bvh-csg@0.0.18/build/index.module.js"')

s=s.replace("import { OrbitControls } from 'three/addons/controls/OrbitControls.js';", "import { OrbitControls } from 'three/addons/controls/OrbitControls.js';\nimport { Brush, Evaluator, ADDITION } from 'three-bvh-csg';")

s=s.replace('.stage3d-prep b{color:#6ee7b7}.stage3d-prep.blocked{border-color:rgba(251,191,36,.42);background:rgba(251,191,36,.045)}.stage3d-prep.blocked b{color:#fbbf24}.stage3d-prep .btn{width:100%;margin-top:7px;font-size:10px;padding:6px}', '.stage3d-prep b{color:#6ee7b7}.stage3d-prep.blocked{border-color:rgba(251,191,36,.42);background:rgba(251,191,36,.045)}.stage3d-prep.blocked b{color:#fbbf24}.stage3d-prep .btn{width:100%;margin-top:7px;font-size:10px;padding:6px}\n.union-preview{margin-top:7px;border:1px solid rgba(96,165,250,.5);border-radius:6px;padding:7px;background:rgba(59,130,246,.07);font-size:10px;line-height:1.4;color:var(--muted)}.union-preview b{color:#93c5fd}.union-preview.good{border-color:rgba(52,211,153,.55);background:rgba(52,211,153,.06)}.union-preview.good b{color:#86efac}.union-preview.bad{border-color:rgba(248,113,113,.55);background:rgba(248,113,113,.06)}.union-preview.bad b{color:#fca5a5}.union-preview-actions{display:flex;gap:6px;margin-top:7px}.union-preview-actions .btn{flex:1;font-size:10px;padding:6px}')

s=s.replace("let boundaryRepairLastResult = null;", "let boundaryRepairLastResult = null;\nlet unionCandidate = null;")

marker="function showIntersectionInspector(san) {"
helper=r'''
function buildLocalShellMap(parsed) {
  const { positions, nTri } = parsed;
  let minX=Infinity,minY=Infinity,minZ=Infinity,maxX=-Infinity,maxY=-Infinity,maxZ=-Infinity;
  for(let i=0;i<positions.length;i+=3){const x=positions[i],y=positions[i+1],z=positions[i+2];minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);minZ=Math.min(minZ,z);maxZ=Math.max(maxZ,z);}
  const eps=Math.max(Math.max(maxX-minX,maxY-minY,maxZ-minZ)*1e-7,1e-7);
  const key=(x,y,z)=>`${Math.round(x/eps)},${Math.round(y/eps)},${Math.round(z/eps)}`;
  const vm=new Map(), fv=new Array(nTri), vf=[];
  for(let fi=0;fi<nTri;fi++){const ids=[];const o=fi*9;for(let v=0;v<3;v++){const q=o+v*3,k=key(positions[q],positions[q+1],positions[q+2]);if(!vm.has(k)){const id=vm.size;vm.set(k,id);vf[id]=[];}const id=vm.get(k);ids.push(id);vf[id].push(fi);}fv[fi]=ids;}
  const visited=new Uint8Array(nTri), faceShellIds=new Int32Array(nTri);faceShellIds.fill(-1);const counts=[];let sid=0;
  for(let start=0;start<nTri;start++){if(visited[start])continue;const id=sid++,stack=[start];visited[start]=1;faceShellIds[start]=id;let c=0;while(stack.length){const fi=stack.pop();c++;for(const vi of fv[fi])for(const nb of vf[vi])if(!visited[nb]){visited[nb]=1;faceShellIds[nb]=id;stack.push(nb);}}counts[id]=c;}
  return { faceShellIds, counts };
}

function positionsForShell(parsed, faceShellIds, shellId) {
  const out=[];
  for(let fi=0;fi<parsed.nTri;fi++) if(faceShellIds[fi]===shellId){const o=fi*9;for(let k=0;k<9;k++)out.push(parsed.positions[o+k]);}
  return new Float32Array(out);
}

function geometryPositions(geometry) {
  const g=geometry.index ? geometry.toNonIndexed() : geometry.clone();
  const a=g.getAttribute('position');
  if(!a) throw new Error('Boolean union returned no position geometry');
  const out=new Float32Array(a.array.length); out.set(a.array); g.dispose(); return out;
}

function clearUnionCandidate(showOriginal=true) {
  unionCandidate=null;
  if(showOriginal){const parsed=currentParsed||sourceParsed;if(parsed)showMesh(parsed.positions);}
}

function acceptUnionCandidate() {
  if(!unionCandidate) return;
  currentParsed={positions:unionCandidate.positions,nTri:unionCandidate.nTri};
  sourceParsed=cloneParsed(currentParsed);
  const summary=unionCandidate.summary;
  unionCandidate=null;
  repairDismissed=false; scaleReference=null;
  updateAnalysis(sourceName,currentParsed);
  setStatus(`Stage 3E union accepted — shells ${summary.shellA+1}/${summary.shellB+1}, faces ${summary.beforeFaces.toLocaleString()} → ${summary.afterFaces.toLocaleString()}, open edges ${summary.beforeOpen.toLocaleString()} → ${summary.afterOpen.toLocaleString()}`);
}

function rejectUnionCandidate() {
  clearUnionCandidate(true);
  const parsed=currentParsed||sourceParsed;if(parsed)updateAnalysis(sourceName,parsed);
  setStatus('Stage 3E union preview rejected — original prepared mesh restored');
}

function buildUnionPreview(pairIndex) {
  const parsed=currentParsed||sourceParsed;if(!parsed)return;
  try {
    const before=analyseSanitiserMesh(parsed.positions,parsed.nTri);
    const pair=before.intersections?.pairs?.[pairIndex];
    if(!pair || !pair.unionReady) throw new Error('Selected pair is no longer UNION READY');
    setStatus(`Stage 3E: building boolean union preview for Shell ${pair.shellA+1} / ${pair.shellB+1}...`);
    const map=buildLocalShellMap(parsed);
    if((map.counts[pair.shellA]||0)!==pair.shellAFaces || (map.counts[pair.shellB]||0)!==pair.shellBFaces) throw new Error('Shell identity changed; preview refused');
    const pa=positionsForShell(parsed,map.faceShellIds,pair.shellA), pb=positionsForShell(parsed,map.faceShellIds,pair.shellB);
    const ga=new THREE.BufferGeometry();ga.setAttribute('position',new THREE.BufferAttribute(pa,3));
    const gb=new THREE.BufferGeometry();gb.setAttribute('position',new THREE.BufferAttribute(pb,3));
    const ba=new Brush(ga), bb=new Brush(gb);ba.updateMatrixWorld();bb.updateMatrixWorld();
    const evaluator=new Evaluator();evaluator.useGroups=false;evaluator.useCDTClipping=true;
    const result=evaluator.evaluate(ba,bb,ADDITION);const unionPos=geometryPositions(result.geometry);
    ga.dispose();gb.dispose();result.geometry.dispose();
    if(!unionPos.length || unionPos.length%9) throw new Error('Boolean union returned invalid triangle data');
    const kept=[];for(let fi=0;fi<parsed.nTri;fi++){const sid=map.faceShellIds[fi];if(sid===pair.shellA||sid===pair.shellB)continue;const o=fi*9;for(let k=0;k<9;k++)kept.push(parsed.positions[o+k]);}
    const positions=new Float32Array(kept.length+unionPos.length);positions.set(kept,0);positions.set(unionPos,kept.length);const nTri=positions.length/9;
    const after=analyseSanitiserMesh(positions,nTri);
    if(after.degenerateTriangles>before.degenerateTriangles) throw new Error('candidate introduced degenerate faces');
    if(after.nonManifoldEdges>before.nonManifoldEdges) throw new Error('candidate increased non-manifold edges');
    if(after.openEdges>before.openEdges) throw new Error('candidate increased open edges');
    if(after.shells>=before.shells) throw new Error('candidate did not merge the two source shells');
    const targetStillCrossing=(after.intersections?.pairs||[]).some(p=>p.overlapType==='DEEP OVERLAP'&&p.intersections>=pair.intersections*0.5);
    if(targetStillCrossing && !after.intersections?.truncated) throw new Error('candidate still contains a comparable deep overlap');
    unionCandidate={positions,nTri,summary:{shellA:pair.shellA,shellB:pair.shellB,beforeFaces:before.nTri,afterFaces:after.nTri,beforeOpen:before.openEdges,afterOpen:after.openEdges,beforeShells:before.shells,afterShells:after.shells,beforeNon:before.nonManifoldEdges,afterNon:after.nonManifoldEdges}};
    showMesh(positions);
    showIntersectionInspector(before);
    setStatus(`Stage 3E preview ready — ACCEPT or REJECT. Shells ${before.shells.toLocaleString()} → ${after.shells.toLocaleString()}, open edges ${before.openEdges.toLocaleString()} → ${after.openEdges.toLocaleString()}`);
  } catch(err){console.error('Stage 3E union preview refused:',err);clearUnionCandidate(true);setStatus(`Stage 3E union preview refused: ${err.message||err}`);}
}

'''
if helper not in s:
    s=s.replace(marker,helper+marker)

needle="""      el.appendChild(preflight);\n    }\n    if (p.overlapType === 'STRAY FRAGMENT CONTACT') {"""
repl="""      el.appendChild(preflight);\n      if (p.unionReady) {\n        const unionBox=document.createElement('div'); unionBox.className='union-preview';\n        if (unionCandidate && unionCandidate.summary.shellA===p.shellA && unionCandidate.summary.shellB===p.shellB) {\n          const u=unionCandidate.summary; unionBox.classList.add('good');\n          unionBox.innerHTML=`<b>UNION PREVIEW READY</b> · Faces ${u.beforeFaces.toLocaleString()} → ${u.afterFaces.toLocaleString()} · shells ${u.beforeShells.toLocaleString()} → ${u.afterShells.toLocaleString()} · open edges ${u.beforeOpen.toLocaleString()} → ${u.afterOpen.toLocaleString()}`;\n          const a=document.createElement('div');a.className='union-preview-actions';\n          const ok=document.createElement('button');ok.className='btn';ok.type='button';ok.textContent='ACCEPT UNION';ok.addEventListener('click',acceptUnionCandidate);\n          const no=document.createElement('button');no.className='btn';no.type='button';no.textContent='REJECT';no.addEventListener('click',rejectUnionCandidate);a.append(ok,no);unionBox.appendChild(a);\n        } else {\n          unionBox.innerHTML='<b>TRANSACTIONAL UNION</b> · Build a candidate from only these two closed shells. The working mesh remains untouched until you accept it.';\n          const b=document.createElement('button');b.className='btn';b.type='button';b.textContent='BUILD UNION PREVIEW';b.style.width='100%';b.style.marginTop='7px';b.addEventListener('click',()=>buildUnionPreview(pairIndex));unionBox.appendChild(b);\n        }\n        el.appendChild(unionBox);\n      }\n    }\n    if (p.overlapType === 'STRAY FRAGMENT CONTACT') {"""
if needle not in s: raise SystemExit('intersection insertion point not found')
s=s.replace(needle,repl,1)

s=s.replace("import { analyseSanitiserMesh,", "import { analyseSanitiserMesh,")
# cache bust core/nav and page-visible imports
s=s.replace("./js/sanitiser-core.js?v=13", "./js/sanitiser-core.js?v=14")
s=s.replace("./js/sanitiser-core.js?v=14", "./js/sanitiser-core.js?v=15") if "./js/sanitiser-core.js?v=14" in s and "Stage 3E" not in s else s

p.write_text(s,encoding='utf-8')
