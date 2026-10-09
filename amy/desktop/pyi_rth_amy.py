# Runtime hook: point AMY_ROOT at the bundled amy folder before launch imports paths.
import os
import sys
from pathlib import Path

meipass = getattr(sys, "_MEIPASS", None)
if meipass:
    bundled = Path(meipass) / "amy"
    if bundled.exists():
        os.environ.setdefault("AMY_ROOT", str(bundled))
    else:
        os.environ.setdefault("AMY_ROOT", str(meipass))
