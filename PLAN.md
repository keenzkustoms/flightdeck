# PLAN - flightdeck (Keenz Kustoms fork)

## Next step
Merge branch `keenz-merge-upstream` into `main` on the fork (PR open), then fill `printers.yaml` with the
real shop printers and run `Install-Flightdeck-Windows.cmd` on KeenzPC.

## Goal
Upstream Flightdeck (Kidabah) plus this fork's Windows and shop-floor additions, running on the Keenz
Kustoms print room PC with every printer, the scale and the AusPrint Pro label printer live.

## This fork's pieces (re-apply these after any upstream merge)
- `app/label_printer.py`: `FLIGHTDECK_LABEL_PRINTER_MODEL` (`brother_ql` | `ausprint_pro`) and
  `FLIGHTDECK_LABEL_PRINTER_NAME`; Windows printing through the printer queue; compact QL-700 62mm layout.
- `app/scale.py`: Dymo scale over HID on Windows (`hidapi` in `requirements-windows.txt`).
- `app/printer_config.py` + `app/main.py`: camera `rotation`, `adaptive` (snapshot polling at a
  print-state-dependent rate) and `webrtc` camera types; stale-instead-of-offline telemetry with timeouts
  around Moonraker/Bambu fetches; cache primed at startup so a dead printer never blocks the UI.
- `app/printers/moonraker.py`: `trust_env=False` on every HTTP client (ignore Windows proxy settings);
  exclude-object polygon geometry.
- `app/camera.py`: `FLIGHTDECK_BAMBU_STREAM_WIDTH/FPS/QUALITY` env overrides (defaults match upstream).
- `app/static/app.js` + `style.css`: `data-camera-rotation` on every camera image.
- Docs: `INSTALL.md` Windows hardware section, `.env.example`, `printers.yaml.example`.
- NOT ported (upstream rewrote the object map): the fork's polygon-shape overlay and object-chip layout in
  `app.js`/`style.css` (fork commits 98eafa90, 86e60589). Backend geometry is still returned.

## Steps
- [x] [default] Merge `upstream/main` (2,252 commits) into the fork on `keenz-merge-upstream`; take upstream
  for the 9 conflicted files and re-apply the pieces above - check: 15 Python tests pass, app boots, label
  printer status finds the AUSPRINT-PRO queue, adaptive camera streams.
- [ ] [fast] Write `printers.yaml` for the shop (H2D, P1S, X1C access codes + serials, Snapmaker U1, FLSUN S1
  with `camera.type: adaptive` and `rotation: 90`) in `%LOCALAPPDATA%\Flightdeck` - check: every printer
  shows live on the Fleet Wall.
- [ ] [fast] `.env`: `FLIGHTDECK_LABEL_PRINTER_MODEL=ausprint_pro`, `FLIGHTDECK_LABEL_PRINTER_NAME=AUSPRINT`,
  and the lower `FLIGHTDECK_BAMBU_STREAM_*` values if the PC struggles with several camera feeds - check:
  Setup -> Hardware shows the label printer detected; print one test label.
- [ ] [default] Install Node 22 (`winget install OpenJS.NodeJS.LTS`) so the six `tests/*.test.mjs` run here.
- [ ] [review] Offer the Windows label/scale backends to upstream as a PR once they have run in the shop
  for a couple of weeks.

## Notes and decisions
- 2026-10-09: upstream absorbed the fork's Snapmaker U1 support on 2026-06-09, so that part merged clean.
- `core.autocrlf` is off for this repo; upstream stores `app/main.py` and `style.css` with CRLF and
  `app.js`/`index.html` mixed. Patch those files byte-exact (no newline translation) or the diff explodes.
