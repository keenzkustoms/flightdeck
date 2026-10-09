# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller spec for Amy desktop (one-folder)."""
from pathlib import Path

from PyInstaller.utils.hooks import collect_data_files, collect_dynamic_libs

SPECDIR = Path(SPECPATH).resolve()
AMY = SPECDIR.parent
DESKTOP = SPECDIR

datas = [
    (str(AMY / "viewer"), "amy/viewer"),
    (str(AMY / "notes"), "amy/notes"),
    (str(AMY / "amy-hands"), "amy/amy-hands"),
    (str(AMY / "config.example.json"), "amy"),
    (str(AMY / "build.py"), "amy"),
    (str(AMY / "server.py"), "amy"),
    (str(AMY / "preflight.py"), "amy"),
    (str(DESKTOP / "paths.py"), "amy/desktop"),
]

graph = AMY / "viewer" / "graph-data.js"
if graph.exists():
    datas.append((str(graph), "amy/viewer"))
index = AMY / "notes-index.json"
if index.exists():
    datas.append((str(index), "amy"))

datas += collect_data_files("webview")
binaries = collect_dynamic_libs("webview")

hiddenimports = [
    "webview",
    "webview.platforms.edgechromium",
    "clr",
    "clr_loader",
    "pythonnet",
    "bottle",
    "proxy_tools",
]

a = Analysis(
    [str(DESKTOP / "launch.py")],
    pathex=[str(AMY), str(DESKTOP)],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[str(DESKTOP / "pyi_rth_amy.py")],
    excludes=[],
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="Amy",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=False,
    disable_windowed_traceback=False,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=False,
    name="Amy",
)
