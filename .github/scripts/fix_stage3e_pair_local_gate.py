from pathlib import Path
p=Path('makerforge/meshprep.html')
s=p.read_text(encoding='utf-8')
old="""        const positions=new Float32Array(kept.length+cleaned.positions.length);positions.set(kept);positions.set(cleaned.positions,kept.length);\n        const nTri=positions.length/9,after=analyseSanitiserMesh(positions,nTri);\n        const valid=after.degenerateTriangles<=before.degenerateTriangles&&after.nonManifoldEdges<=before.nonManifoldEdges&&after.openEdges<=before.openEdges&&after.shells<before.shells;\n        attempts.push({label,positions,nTri,after,valid,removedDegenerate:cleaned.removedDegenerate,removedDuplicate:cleaned.removedDuplicate});"""
new="""        const localAfter=analyseSanitiserMesh(cleaned.positions,cleaned.positions.length/9);\n        const localValid=localAfter.degenerateTriangles===0&&localAfter.nonManifoldEdges===0&&localAfter.openEdges===0&&localAfter.shells===1;\n        const positions=new Float32Array(kept.length+cleaned.positions.length);positions.set(kept);positions.set(cleaned.positions,kept.length);\n        const nTri=positions.length/9,after=analyseSanitiserMesh(positions,nTri);\n        const expectedShellDelta=before.shells-1;\n        const valid=localValid&&after.degenerateTriangles<=before.degenerateTriangles&&after.nonManifoldEdges<=before.nonManifoldEdges&&after.shells<=expectedShellDelta;\n        attempts.push({label,positions,nTri,after,localAfter,valid,removedDegenerate:cleaned.removedDegenerate,removedDuplicate:cleaned.removedDuplicate});"""
if old not in s:
    raise SystemExit('Stage 3E attempt block not found')
s=s.replace(old,new,1)
old2="""      const detail=attempts.map(x=>x.error?`${x.label}: ${x.error.message||x.error}`:`${x.label}: ${x.after.degenerateTriangles} degenerate / ${x.after.nonManifoldEdges} non-manifold / ${x.after.openEdges} open / ${x.after.shells} shells (cleanup −${x.removedDegenerate} degenerate, −${x.removedDuplicate} duplicate)`).join('; ');"""
new2="""      const detail=attempts.map(x=>x.error?`${x.label}: ${x.error.message||x.error}`:`${x.label}: local ${x.localAfter.degenerateTriangles} degenerate / ${x.localAfter.nonManifoldEdges} non-manifold / ${x.localAfter.openEdges} open / ${x.localAfter.shells} shells; global ${x.after.degenerateTriangles} degenerate / ${x.after.nonManifoldEdges} non-manifold / ${x.after.openEdges} open / ${x.after.shells} shells (cleanup −${x.removedDegenerate} degenerate, −${x.removedDuplicate} duplicate)`).join('; ');"""
if old2 not in s:
    raise SystemExit('Stage 3E detail block not found')
s=s.replace(old2,new2,1)
old3="""    const best=viable[0],after=best.after;\n    unionCandidate={positions:best.positions,nTri:best.nTri,summary:{shellA:pair.shellA,shellB:pair.shellB,beforeFaces:before.nTri,afterFaces:after.nTri,beforeOpen:before.openEdges,afterOpen:after.openEdges,beforeShells:before.shells,afterShells:after.shells,order:best.label,removedDegenerate:best.removedDegenerate,removedDuplicate:best.removedDuplicate}};"""
new3="""    const best=viable[0],after=best.after;\n    unionCandidate={positions:best.positions,nTri:best.nTri,summary:{shellA:pair.shellA,shellB:pair.shellB,beforeFaces:before.nTri,afterFaces:after.nTri,beforeOpen:before.openEdges,afterOpen:after.openEdges,beforeShells:before.shells,afterShells:after.shells,localOpen:best.localAfter.openEdges,localNonManifold:best.localAfter.nonManifoldEdges,localDegenerate:best.localAfter.degenerateTriangles,localShells:best.localAfter.shells,order:best.label,removedDegenerate:best.removedDegenerate,removedDuplicate:best.removedDuplicate}};"""
if old3 not in s:
    raise SystemExit('Stage 3E summary block not found')
s=s.replace(old3,new3,1)
p.write_text(s,encoding='utf-8')
