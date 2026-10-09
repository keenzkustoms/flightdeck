from pathlib import Path

p = Path('makerforge/meshprep.html')
s = p.read_text(encoding='utf-8')
old = "const evaluator=new Evaluator();evaluator.useGroups=false;evaluator.useCDTClipping=true;"
new = "const evaluator=new Evaluator();evaluator.attributes=['position'];evaluator.useGroups=false;evaluator.useCDTClipping=true;"
if old not in s:
    raise SystemExit('Stage 3E evaluator marker not found')
s = s.replace(old, new, 1)
p.write_text(s, encoding='utf-8')
