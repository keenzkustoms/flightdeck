# PrintShelf

Private, self-hosted printable-file inventory. **Index in place** — files stay on local disks / NAS. No cloud upload, no marketplace.

## What it does (v1)

- Watch local + NAS folders
- Index `.stl`, `.3mf`, `.gcode.3mf`, `.obj`, `.zip` (lists contents + printables inside; no extract)
- Orbit preview for STL / OBJ / 3MF (mesh extracted from 3MF when possible); mesh thumbs for 3MF when bake is missing/dark
- Extract print details from 3MF (plates, filaments, thumbs)
- Associate OBJ `.mtl` + texture maps
- Browse / filter / detail UI

## Run (dev)

```bash
cd printshelf
python -m venv .venv   # or use the Flightdeck venv
pip install -r requirements.txt
cp config.example.json config.json   # edit watched_folders paths
python -m uvicorn app.main:app --host 127.0.0.1 --port 8100
```

Open http://127.0.0.1:8100 → **Folders** → add paths → **Rescan**.

## Pi service

```bash
cd /home/flightdeck/flightdeck
git pull
.venv/bin/pip install -r printshelf/requirements.txt
# first install: unit file + NOPASSWD systemctl rules (docker/root helper)
sh printshelf/install-pi-unit.sh
cp -n printshelf/config.example.json printshelf/config.json   # edit watched_folders
sudo systemctl daemon-reload
sudo systemctl enable --now printshelf.service
```

Browse (HTTPS via Tailscale Serve): `https://flightdeck.tail7de73e.ts.net:8100`

The service listens on `127.0.0.1:8100` only. Tailscale Serve owns public `:8100` and proxies to it (same pattern as Flightdeck on `:443` → `:8000`).

### Install as an app (PWA, same as Flightdeck)

PrintShelf ships a web app manifest + minimal service worker (no offline cache). Chrome/Edge need **HTTPS** to Install.

On the Pi (once; persists with Tailscale Serve):

```bash
tailscale serve --bg --https=8100 http://127.0.0.1:8100
```

Then open:

`https://flightdeck.tail7de73e.ts.net:8100`

→ browser menu → **Install PrintShelf** / **Install this site as an app**.

Optional Windows Desktop shortcut (app-mode window):

```powershell
powershell -ExecutionPolicy Bypass -File printshelf\scripts\create-desktop-shortcut.ps1
```

UI: **Folders** → add local/NAS paths → **Rescan**.

Config: `printshelf/config.json` (not committed). Data/DB/thumbs: `printshelf/data/`.
Restart: `sudo systemctl restart printshelf.service`

## Phase 2 (later)

Printables / Tripo / other online libraries as read-only indexes.
