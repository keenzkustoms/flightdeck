# flightdeck (Keenz Kustoms fork)

<!-- Loaded every session in this project. Keep under 60 lines. -->

## What it is
Steve's fork of Kidabah/flightdeck: a self-hosted dashboard for a mixed 3D-printer farm (Bambu H2D/P1S/X1C,
Snapmaker U1, FLSUN S1 and other Klipper/Moonraker machines) with spool tracking, a Dymo scale and a label
printer. Runs on this Windows PC as a tray app; upstream targets a Raspberry Pi.

## Stack
- Python 3.13, FastAPI + uvicorn, SQLite (`flightdeck.db`), plain JS/CSS front end in `app/static/`.
- Hardware: Bambu via `bambulabs_api`, Klipper via Moonraker HTTP, Dymo scale over HID (`hidapi` on Windows),
  labels via Brother QL-700 or AusPrint Pro (Windows printer queue, see `INSTALL.md`).
- Remotes: `origin` = keenzkustoms/flightdeck (this fork), `upstream` = Kidabah/flightdeck.

## Commands (run these, do not guess)
- Setup: `python -m venv .venv && .venv\Scripts\pip install -r requirements-windows.txt`
- Check / test: `.venv\Scripts\python -m unittest discover -s tests` (Python); the `tests/*.test.mjs` files
  need Node, which is not installed on this PC. Compile check: `.venv\Scripts\python -m py_compile app\main.py`.
- Run (dev): `.venv\Scripts\python -m uvicorn app.main:app --host 127.0.0.1 --port 8000`
- Run (installed): `Install-Flightdeck-Windows.cmd` once, then it lives in the tray; data in `%LOCALAPPDATA%\Flightdeck`.
- Config: `.env` (copy `.env.example`) and `printers.yaml` in the data dir (copy `printers.yaml.example`).

## Project rules
- Keep this fork's additions small and separable from upstream: Windows label/scale backends, camera
  `rotation`, `adaptive`/`webrtc` camera types, stale-instead-of-offline telemetry. Prefer env vars and
  `printers.yaml` over hardcoded printer ids.
- Syncing with upstream: `git fetch upstream && git merge upstream/main` on a branch; upstream rewrites
  `app/main.py` and `app/static/app.js` heavily, so resolve by taking upstream and re-applying this fork's
  pieces (they are listed in `PLAN.md`).
- `printers.yaml`, `.env`, `flightdeck.db` hold printer access codes and shop data: never commit them.
- Use `PLAN.md` for risky, architectural or cross-subsystem work; a MICRO PATCH uses the request itself.
- Big binaries (STL, 3MF, firmware) stay outside git.
