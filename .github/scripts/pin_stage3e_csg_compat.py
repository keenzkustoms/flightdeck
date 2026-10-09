from pathlib import Path

p = Path('makerforge/meshprep.html')
s = p.read_text(encoding='utf-8')
old = '"three-bvh-csg": "https://cdn.jsdelivr.net/npm/three-bvh-csg@0.0.18/build/index.module.js"'
new = '"three-bvh-csg": "https://cdn.jsdelivr.net/npm/three-bvh-csg@0.0.16/build/index.module.js"'
if old not in s:
    raise SystemExit('Stage 3E CSG import marker not found')
s = s.replace(old, new, 1)
p.write_text(s, encoding='utf-8')
