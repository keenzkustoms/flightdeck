from pathlib import Path

p = Path('makerforge/meshprep.html')
s = p.read_text(encoding='utf-8')

old = "function unionGeometryPositions(g){const ng=g.index?g.toNonIndexed():g.clone(),a=ng.getAttribute('position');if(!a)throw new Error('Boolean union returned no position data');const out=new Float32Array(a.array.length);out.set(a.array);ng.dispose();return out;}"
new = "function unionGeometryPositions(g){if(!g)throw new Error('Boolean union returned no geometry');const ng=g.index?g.toNonIndexed():g.clone(),a=ng.getAttribute('position');if(!a||!Number.isFinite(a.count)||a.count<3)throw new Error('Boolean union returned no position data');if(a.count%3!==0)throw new Error('Boolean union returned non-triangular position data');const out=new Float32Array(a.count*3);for(let i=0;i<a.count;i++){const o=i*3;out[o]=a.getX(i);out[o+1]=a.getY(i);out[o+2]=a.getZ(i);}ng.dispose();return out;}"

if old not in s:
    raise SystemExit('Stage 3E geometry extractor not found')

s = s.replace(old, new, 1)
p.write_text(s, encoding='utf-8')
