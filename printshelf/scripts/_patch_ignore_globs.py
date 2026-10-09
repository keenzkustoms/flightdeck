#!/usr/bin/env python3
import json
from pathlib import Path

p = Path("/home/flightdeck/flightdeck/printshelf/config.json")
cfg = json.loads(p.read_text())
extra = [
    "**/American Truck Simulator/**",
    "**/Euro Truck Simulator*/**",
    "**/steam_profiles*/**",
    "**/*.bak/**",
    "**/AppData/**",
    "**/.cache/**",
    "**/Codex/**",
    "**/OrcaSlicer/**",
    "**/node_modules/**",
]
globs = list(cfg.get("ignore_globs") or [])
for g in extra:
    if g not in globs:
        globs.append(g)
cfg["ignore_globs"] = globs
p.write_text(json.dumps(cfg, indent=2) + "\n")
print("ok", len(globs))
