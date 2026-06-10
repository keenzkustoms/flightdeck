## 2026-06-07 Session handoff

Latest GitHub/Pi state:
- Branch: main
- Latest commit: current HEAD after this handoff (`Soften camera feed status badges`)
- Pi repo: /home/flightdeck/flightdeck
- Data dir: /home/flightdeck/flightdeck-data
- App URL: https://flightdeck.tail7de73e.ts.net/
- Refresh cachebust currently: ?cachebust=446 / style.css?v=361

Recent work:
- Ported the useful Bambuddy slicer lesson into Flightdeck's Orca profile handoff. Bambuddy's resolver documents that missing profile JSON `type` fields (`machine`/`process`/`filament`) can make Orca/Bambu surface useless generic slice failures, so Flightdeck now normalises those fields for both sidecar-uploaded profiles and local CLI temp profile files before slicing. This keeps support/brim overrides intact while making profile payloads match the slicer's slot expectations. Bambuddy also confirmed loose STL/OBJ has no embedded settings fallback, so H2D loose-mesh slicing is now treated as sidecar-required instead of silently falling back to local Orca: the plan endpoint offers manual handoff/Open Orca when no sidecar API is configured, `/api/slicer/run` rejects immediately with a clear sidecar-required message, and the Windows worker no longer falls back to local Orca for H2D STL/OBJ after a sidecar 502.
  - Verification: `python -m py_compile app/main.py`, profile-type helper smoke test, `git diff --check`, exact Downloads skeleton STL still fails on H2D local CLI with the friendly sidecar-required message, and the same skeleton STL still slices successfully as X1C through local Orca. Backend restart required.
- Investigated live failure slicing `Working to the Bone - Office Skeleton.stl`. STL slicing itself works: the exact Downloads STL sliced successfully through local Orca as X1C and produced a 21 MB `.gcode.3mf`. The failure is specific to local Orca CLI + H2D loose STL profiles: H2D dies at the actual `--slice` step with only `Slic3r::CLI::run found error, exit`, while X1C succeeds. Flightdeck now turns that vague Orca line into a truthful error: local Orca can slice the STL for single-toolhead printers, but this Orca build rejects the H2D loose STL slice profile; use Open Orca or start the Orca slicer API sidecar for that H2D STL until a proper H2D CLI workaround is found. Backend restart required.
  - Verification: `python -m py_compile app/main.py`, local venv reproduction of the H2D skeleton failure now returns the new friendly message, and `git diff --check` passed.
- Slice Model now shows a practical first-pass preview after `Slice in Flightdeck` succeeds. `/api/slicer/run` returns a `preview_url` for generated `.gcode.3mf` outputs, backed by new `GET /api/files/source/preview`, which reads the embedded 3MF thumbnail/top preview from the Print Vault file. The ready panel now shows that thumbnail above `Queue sliced job` and `Check vault`, with a quiet `Preview unavailable` state if the slicer did not embed an image. Demo mode now exercises the same ready/preview path. Static cache bumped to `app.js?v=446`, `style.css?v=361`, and `demo-runtime.js?v=7`; backend restart required.
  - Verification: `python -m py_compile app/main.py`, `node --check app/static/app.js`, `node --check app/static/demo-runtime.js`, and `git diff --check` passed.
- Slice Model next-stage flow started. The slice dialog now selects a target printer first, then shows per-slice profile dropdown/search inputs for Printer/nozzle, Process/layer, and Filament/profile, followed by Plate type, Supports, and Brim. These profile choices default from the selected printer's saved slicer defaults but can be changed for the current slice only. `/api/slicer/plan` and `/api/slicer/run` now accept optional `printer_profile`, `process_profile`, and `filament_profile` overrides. After `Slice in Flightdeck` succeeds, the modal stays open and flips to a blue `Queue sliced job` action for the generated Print Vault output instead of closing/flashing the vault list. Static cache bumped to `app.js?v=445` and `style.css?v=360`; backend restart required.
  - Verification: `python -m py_compile app/main.py`, `node --check app/static/app.js`, and `git diff --check` passed.
- Slicer worker fallback fixed after live test showed `Slicer API unreachable: [WinError 10061]` when `orcaslicer_api_url` on port 3003 was configured but not running. The Windows worker on port 8000 was healthy and had Orca available, but `/api/slicer/worker/slice` tried the sidecar first and failed immediately. Worker slicing now catches sidecar/API 502 connection failures and falls back to local Orca with the same plate/support/brim options.
  - Verification: `python -m py_compile app/main.py`, `node --check app/static/app.js`, venv smoke test for support/brim override labels, and `git diff --check` passed. The Pi updater pulled `748ca9d` and reported `restart_required: true`. The Windows worker checkout at `C:\Users\Kidabah\flightdeck` was also fast-forwarded to `748ca9d`, duplicate uvicorn workers were stopped, and a fresh worker started on port 8000. `http://100.112.171.88:8000/api/slicer/worker/status` reports Orca available; `http://100.112.171.88:3003/health` still refuses connections, so worker local-Orca fallback is the active path until the sidecar API is started again.
- Slice Model now has Supports and Brim dropdowns alongside Plate type. Defaults are profile-safe (`Profile default`), with support overrides for off, normal auto, tree auto, and tree strong, plus brim overrides for no brim and outer brim. The selected options are shown in the slice handoff panel, sent through `/api/slicer/plan`, `/api/slicer/run`, and `/api/slicer/worker/slice`, and applied by patching the Orca process profile JSON before handing it to the sidecar API or local Orca worker. Static cache bumped to `app.js?v=444`; backend restart required.
  - Verification: `python -m py_compile app/main.py`, `node --check app/static/app.js`, `node --check app/static/demo-runtime.js`, venv smoke test for support/brim process-profile overrides, and `git diff --check` passed. Next useful slicer feature idea from the user: after `Slice in Flightdeck`, preview the actual sliced output on the build plate, including generated supports/brims/toolpaths, with rotate/zoom plus `Open in Orca`, `Send to printer`, and `Queue` actions. This should be built from the generated `.gcode.3mf`/G-code rather than the unsliced source model so supports/brims are real.
- Camera feed status badges were softened after live review. They now sit in the bottom-right like a TV-style watermark, with smaller type, lower opacity, a lighter translucent background, and a slightly stronger warning treatment only for stale/reconnecting states. Static cache bumped to `style.css?v=359`; frontend refresh only.
  - Verification: `node --check app/static/app.js` and `git diff --check` passed. Live browser reload confirmed `style.css?v=359`, bottom-right placement, 8.8px text, 0.58 opacity, and translucent background on Fleet Wall.
- Camera feeds now get a small status pill overlay so black/waiting feeds are less mysterious. Live/Print Watch/Fleet Wall camera images show `Opening stream`, `Stream live`, `Waiting for frame`, `Frame now`, `Refreshing frame`, `Frame stale`, or `Reconnecting` depending on browser image load/retry state. Fleet Wall still-refresh feeds report real frame age; continuous MJPEG streams report stream state because the browser image element does not expose every individual MJPEG frame. Static cache bumped to `app.js?v=443` and `style.css?v=358`; frontend refresh only.
  - Verification: `node --check app/static/app.js` and `git diff --check` passed. Live browser check on the Pi confirmed Fleet Wall served `app.js?v=443`/`style.css?v=358` and showed three camera images with `Frame now` status badges.
- The normal Add Printer picker no longer shows the Simulated option now that demo mode lives separately. Underlying simulated support remains for demo/dev fixtures, but user-facing setup offers Bambu, Voron/Klipper, Snapmaker, and Other Moonraker. The first-run Add Printer copy was updated accordingly.
  - Verification: `node --check app/static/app.js` and `git diff --check` passed. Live browser check confirmed only Bambu, Voron/Klipper, Snapmaker, and Other Moonraker are visible/options in Add Printer.
- Add Printer now shows printer type as compact icon cards instead of a plain protocol dropdown. Bambu, Voron/Klipper, Snapmaker, Other Moonraker, and Simulated each show the same printer-family icon language used elsewhere, while the native select remains in place behind the picker for accessibility/fallback. Static cache bumped to `app.js?v=442` and `style.css?v=357`; frontend refresh only.
  - Verification: `node --check app/static/app.js` and `git diff --check` passed. Live browser check on the Pi confirmed five icon buttons with SVGs, Bambu active by default, and `app.js?v=442` plus `style.css?v=357` served.
- Add Printer layout was compacted so setup fits much better on one screen. The form now uses a 3-column desktop grid, short field blocks for internal ID/name/host/access/serial/camera values, and the temperature presets sit alongside the main connection fields instead of as a full-width section. Mobile still stacks to one column. Static cache bumped to `app.js?v=441` and `style.css?v=356`; frontend refresh only.
  - Verification: `node --check app/static/app.js` and `git diff --check` passed. Browser check on live Settings > Printers showed a 3-column Add Printer form about 455px tall with temp presets alongside the connection fields.
- LAN Scan now tries Bambu SSDP discovery on UDP 2021 before falling back to the existing port 8883 probe. When a Bambu printer advertises itself, scan results include the printer serial, model, and device name, and clicking `Use` pre-fills the serial field. The access code still cannot be discovered safely; Bambu treats it as the local LAN password, so the operator still enters it from the printer screen. Static cache bumped to `app.js?v=440`; backend restart required for the SSDP scanner.
  - Verification: `python -m py_compile app/main.py`, `node --check app/static/app.js`, SSDP parser smoke test, and `git diff --check` passed.
- AMS/AMS-HT Trust Flightdeck command aligned with the Bambuddy/Bambu Studio protocol shape. Bambuddy confirms AMS-HT uses `ams_id >= 128` with local `tray_id=0`, so Flightdeck's HT slot mapping was basically right. The fix is the command shape and flow: `ams_filament_setting` now includes `slot_id`, `sequence_id`, and derived `setting_id` where possible, and explicit Trust Flightdeck sends the set command directly instead of clearing a mismatched slot, waiting, then setting it. This should stop HT stale profile writes from bouncing through a clear-first sequence while keeping normal AMS behaviour consistent. README acknowledgements now credit Bambuddy for open AMS/AMS-HT protocol validation. Backend restart required.
  - Verification: `python -m py_compile app/main.py app/printers/bambu.py`, `.venv\Scripts\python.exe` payload smoke test for HT normal/profile override commands, and `git diff --check` passed.
- Trust Flightdeck explicit AMS sync restored: the conservative AMS inventory changes made ordinary spool moves inventory-only, but the Doctor's `Trust Flightdeck` button still used the same move endpoint. When no profile override checkbox was enabled, the backend returned without `ams_sync`, so the button flashed and did not show `AMS profile sent`. `SpoolMove` now has `sync_ams`, and only the Trust Flightdeck button sends it. Normal assigning remains inventory-only; Trust Flightdeck is again an explicit write-to-Bambu action. Static cache bumped to `app.js?v=439`; backend restart required.
  - Verification: `python -m py_compile app/main.py`, `node --check app/static/app.js`, and `git diff --check` passed.
- AMS inventory auto-claim/write disabled: diagnostics after `445690f` showed the remaining mutation was `spool_auto_claimed` moving `#3` from Shelf #3 into `h2d:128` purely because Bambu's stale AMS HT report still said `Siddament ASA`, then later assigning `#89` wrote a profile again. `_reconcile_reported_loaded_slots` is now a no-op, so Bambu reports can suggest matches in the doctor but cannot move shelved inventory by themselves. `POST /api/spools/{id}/move` now updates Flightdeck inventory only; it writes to Bambu only when an explicit AMS profile override is supplied. `Trust Flightdeck` remains the deliberate write-to-Bambu path. Backend restart required.
  - Verification: `python -m py_compile app/main.py` and `git diff --check` passed.
- AMS same-slot move no-op fix: after disabling background replay, live diagnostics still showed `Spool #89 h2d:128 -> h2d:128` followed by `ams_slot_synced`, meaning the move endpoint wrote the AMS profile even when the spool was already assigned to that exact slot. `POST /api/spools/{id}/move` now only syncs to Bambu when the destination actually changes or an explicit AMS profile override is supplied, and `db.move_spool` no longer logs no-op moves as real moves. Backend restart required.
  - Verification: `python -m py_compile app/main.py app/db.py` and `git diff --check` passed.
- AMS HT auto-replay disabled: BigBoy HT showed why the background profile replay was dangerous. The decision log showed `h2d:128 spool #3 overwrote stale printer profile` and `ams_slot_synced` firing roughly every minute, which explains the user's report that a slot changed back by itself after being corrected. `_replay_assigned_bambu_profiles` is now a no-op; `Trust Flightdeck`/AMS Profile Doctor remains the deliberate operator-approved path for writing a profile back to Bambu, but the poll loop will not fight real spool swaps. Backend restart required.
  - Verification: `python -m py_compile app/main.py`, `node --check app/static/app.js`, and `git diff --check` passed.
- HT AMS stale-profile safety pass: BigBoy's AMS HT exposed a real-world mismatch where Bambu reported the old `Siddament ASA`/white profile while the physical truth was not that spool. Live AMS loadout and filament route now let `Review` win over `Feeding` when Flightdeck's assigned spool and the printer's slot report disagree, and the live filament route gets an amber warning treatment/title instead of visually presenting the stale report as a clean feed. Static cache bumped to `app.js?v=438` and `style.css?v=355`; frontend refresh only.
  - Verification: `node --check app/static/app.js` and `git diff --check` passed.
- Flight Tower first dispatch-board pass: the former right sidebar sections are promoted into a top `Dispatch Board` with `Run Now`, `Needs Action`, `Blocked`, `Dispatch Intel`, and `Fix It` panels. Printer lanes now sit below as supporting printer context in a responsive grid instead of competing with a sticky sidebar. Static cache bumped to `app.js?v=437` and `style.css?v=354`; frontend refresh only.
  - Verification: `node --check app/static/app.js` and `git diff --check` passed.
- Dashboard printer-first briefing boxes now keep the same printer order as the printer cards below, so each top box lines up with its matching printer card instead of resorting by severity. Static cache bumped to `app.js?v=436` and `style.css?v=353`; frontend refresh only.
  - Verification: `node --check app/static/app.js` and `git diff --check` passed.
- Dashboard Flight Briefing wrapper frame/padding was removed so the top printer handover boxes line up on the same columns and gaps as the printer cards below. Static cache bumped to `app.js?v=435` and `style.css?v=352`; frontend refresh only.
  - Verification: `node --check app/static/app.js` and `git diff --check` passed.
- Dashboard aesthetics pass: the Flight Briefing heading is now centred above the handover boxes, and those boxes use the same `320px` grid rhythm as the printer cards below. The dashboard no longer appends the Add Printer tile after the printer cards. The left sidebar Settings item now expands on hover/focus to show direct Setup, Printers, Hardware, Preferences, Appearance, Slicer, and Locations links. Static cache bumped to `app.js?v=434` and `style.css?v=351`; frontend refresh only.
  - Verification: `node --check app/static/app.js` and `git diff --check` passed.
- Dashboard printer-first briefing rows now use stable action titles like `Printer attention`, `Dispatch locked`, `Paused`, or `Offline`, with the specific reason in the detail line. This removes duplicate rows such as `1 failed print in 14d / 1 failed print in 14d`. Static cache bumped to `app.js?v=433` and `style.css?v=350`; frontend refresh only.
  - Verification: `node --check app/static/app.js` and `git diff --check` passed.
- Dashboard Flight Briefing is now printer-first instead of fault-type-first. The top handover renders compact boxes per printer, with that printer's dispatch locks, failed-print watch, active/paused print, low loaded spools, and AMS moisture watch signals grouped together. Attention printers sort first, clear printers stay as small stable cards, and the inner scroll area was removed so polling no longer jumps the briefing scrollbar back to the top. Static cache bumped to `app.js?v=432` and `style.css?v=349`; frontend refresh only.
  - Verification: `node --check app/static/app.js` and `git diff --check` passed.
- Dashboard Flight Briefing grouped cards now render every actionable row instead of hiding rows behind a non-clickable `+N more` note. Long groups use an internal scroll area, so all low spool/watch rows remain accessible without stretching the whole dashboard. Static cache bumped to `app.js?v=431` and `style.css?v=348`; frontend refresh only.
  - Verification: `node --check app/static/app.js` and `git diff --check` passed.
- Dashboard Flight Briefing now groups the operator handover instead of showing a flat run of warning tiles. It builds separate briefing cards for Printer attention, Dispatch locked, Spool watch, and In flight; each card shows the count, the top actionable rows, and a `+N more` note when the shop has more items than fit cleanly. Existing links/AMS slot warning buttons are preserved inside the grouped rows. Static cache bumped to `app.js?v=430` and `style.css?v=347`; frontend refresh only.
  - Verification: `node --check app/static/app.js` and `git diff --check` passed.
- LAN Scan results now support bulk add for safe candidates. Scan rows include checkboxes and an `Add selected` button; unconfigured Moonraker/Snapmaker U1 results can be selected and added in one pass through the existing printer config API. Bambu scan rows remain prefill-only because access code and serial are still required before adding. Static cache bumped to `app.js?v=429` and `style.css?v=346`; frontend refresh only.
  - Verification: `node --check app/static/app.js` and `git diff --check` passed.
- Add Printer now has a LAN Scan helper in Settings > Printers. The new backend `POST /api/config/printers/scan` scans the local IPv4 /24 by default, or a user-entered IPv4 CIDR up to /24, and returns likely printer candidates. It detects Moonraker/Snapmaker U1-style printers through the Moonraker API on port 7125 and flags Bambu-looking hosts when LAN MQTT port 8883 is open. The frontend shows confidence/reason/configured state and `Use` pre-fills the existing Add Printer form with host, model family, suggested ID/name, build volume, camera URL guesses, and connection type. Bambu results still require the operator to enter access code and serial. Static cache bumped to `app.js?v=428` and `style.css?v=345`.
  - Verification: `node --check app/static/app.js`, `python -m py_compile app/main.py`, and `git diff --check` passed. Venv TestClient smoke test `POST /api/config/printers/scan` with `127.0.0.0/30` returned 200 with `scanned=2`.
  - Deploy note: backend restart required after Pi pull for the new scan endpoint: `sudo systemctl restart flightdeck`.
- AMS Profile Doctor modal now fits within the viewport at normal 100% browser scale. The slot editor gets its own overlay class, the modal is capped to the viewport, the body scrolls internally, and the footer/Close action stays reachable instead of falling below the screen. Static cache bumped to `app.js?v=427` and `style.css?v=344`; frontend refresh only.
  - Verification: `node --check app/static/app.js` and `git diff --check` passed.
- Windows update-block recovery: the Windows checkout at `C:\Users\Kidabah\flightdeck` is now clean and current at `a047a5c`, and the uvicorn worker has been restarted on port 8000. Both `http://127.0.0.1:8000/api/update/status?check_remote=true` and `http://100.112.171.88:8000/api/update/status?check_remote=true` report `dirty=false`, `behind=false`, `commit=a047a5c`, `remote_commit=a047a5c`. If the Windows browser still shows `Blocked`/old commit, it is stale browser state rather than the backend checkout; hard refresh or reopen the Windows Flightdeck page.
  - Verification: Windows worker local profile sync returned `Orca Local` with 6,826 filament profiles, 290 Siddament filament profiles, 1,393 machine profiles, and 2,898 process profiles.
- Slicer profile sync can now relay local Orca profiles from the configured Windows worker. This fixes the live Pi case where the Pi cannot read `C:\Users\Kidabah\AppData\Roaming\OrcaSlicer`, so `Orca Local` was missing in both Slicer defaults and the AMS Profile Doctor even though the Windows Orca worker had Siddament profiles. `POST /api/slicer/profiles/sync` now scans local profiles on the server and, when `orcaslicer_worker_url` is set, also asks `{worker}/api/slicer/profiles/sync?include_worker=false` for its `Orca Local` vendor and stores that result in the Pi catalogue. Worker relay calls are non-recursive.
  - Windows worker unblock note: `C:\Users\Kidabah\flightdeck` was blocked by an accidental untracked `app/app/` folder. It was moved to `C:\Users\Kidabah\flightdeck-local-backups\untracked-app-app-20260609-235730`, then the Windows checkout pulled to `9dc96d9` and the uvicorn worker was restarted on port 8000. `http://127.0.0.1:8000/api/slicer/profiles/sync?include_worker=false` now returns `Orca Local` with 6,826 filament profiles and 290 Siddament profiles.
  - Verification: `_sync_worker_orca_profiles("http://100.112.171.88:8000")` returned `Orca Local` with 6,826 filament profiles and 290 Siddament profiles; `python -m py_compile app/main.py` and `git diff --check` passed.
  - Deploy note: backend restart required on the Pi after pull. Then run `Setup > Slicer > Sync profiles` on the live Pi; it should pull `Orca Local` from the Windows worker and make Siddament appear in both Slicer and AMS Doctor.
- Slicer/AMS profile picker usability was tightened after live Windows feedback. Printer Defaults now has explicit column labels (`Printer/nozzle`, `Process/layer`, `Filament/profile`) so Siddament filament profiles are searched in the right-hand filament field rather than the process field. The slicer profile dropdown now uses a fixed floating menu, opens upward when there is no room below, widens to at least 380px where possible, and shows a useful no-match message instead of collapsing into a tiny strip at the bottom of the page. Profile search now tolerates common Siddament typos/prefixes such as `sydd`, `syd`, `syddament`, and `sidament`; the same matching is used in the AMS Profile Doctor. `Orca Local` profile source pills are highlighted green. Static cache bumped to `app.js?v=426` and `style.css?v=343`.
  - Verification: `node --check app/static/app.js` and `git diff --check` passed. Browser verification was attempted, but the local dev server at `127.0.0.1:8766` was not running (`ERR_CONNECTION_REFUSED`).
  - Deploy note: frontend/static-only; hard refresh after update. For local Orca/Siddament profiles to appear, the backend from the previous commit still needs to be restarted and `Setup > Slicer > Sync profiles` run on the Windows instance that has the Orca AppData folder.
- Orca profile sync now imports local OrcaSlicer AppData/config profiles as an `Orca Local` profile vendor. The scanner recursively reads profile JSONs under the discovered Orca data/profile roots, including nested paths like `AppData/Roaming/OrcaSlicer/user/2780676685/filament/base` and `user_backup-*`, and sorts active user profiles ahead of backup folders. This makes local Siddament filament profiles show in Flightdeck profile pickers after `Setup > Slicer > Sync profiles`.
  - Slicing profile resolution now prefers stored `local_path` entries from the synced profile catalog, so selected local profiles are read directly instead of recursively scanning AppData during each slice. Direct resolution of `Siddament ABS CF Big Parts @Bambu Lab H2D 0.4 nozzle` took ~0.014s in the local smoke test.
  - Orca Cloud note: `https://cloud.orcaslicer.com/app/profiles` redirects to Orca Cloud login in the Codex in-app browser unless that browser session is authenticated. Keep using the local AppData scanner for now; a future cloud sync would need an authenticated/export/API path.
  - Verification: local scanner found 17,271 Orca JSON profiles, 6,826 filament profiles, and 290 Siddament filament profiles; TestClient `POST /api/slicer/profiles/sync` with local-only input returned 200 with `Orca Local`; `python -m py_compile app/main.py` passed with the usual Windows embedded-Python prefix warning.
  - Deploy note: backend restart required for local Orca profile sync/resolution.
- Filament catalogue sync now imports Siddament as a first-class source from the public Siddament Shopify product feed. The existing Add Spool `Sync` button now syncs Open Filament Database plus Siddament by default; `POST /api/filament/catalog/sync?source=siddament` can run just Siddament while testing. Siddament rows are stored under source `siddament` with brand `Siddament`, inferred material/subtype/colour, 1.75mm diameter, inferred filament weight/tare from product/variant/gross weight, and factual traceability in `traits` including SKU/barcode, price, availability, product URL, product type, tags, gross weight, and shop update time. Add Spool catalogue chips now include `Siddament`, and result cards show the catalogue source label. Static cache bumped to `app.js?v=425`.
  - Also fixed the catalogue insert SQL placeholder count in `replace_filament_catalog`; it had 16 placeholders for 15 columns and would break catalogue sync paths.
  - Verification: `python -m py_compile app/main.py app/db.py` passed with the usual Windows embedded-Python prefix warning; `node --check app/static/app.js` passed; local TestClient `POST /api/filament/catalog/sync?source=siddament` returned 200 and imported 1,259 Siddament rows; search for `siddament asa black` returned Siddament ASA rows with SKU/source URL traits. `peak green` is currently found from Open Filament Database/eSUN, not Siddament's current public product titles/tags.
  - Deploy note: backend restart required for the new sync source and DB insert fix; hard refresh browsers to pick up `app.js?v=425`.
- Add Printer naming labels were clarified after user feedback: the URL-safe machine key is now labelled `Internal ID (no spaces)`, while the user-facing spaced field is labelled `Printer Name (spaces ok)`. Validation now says `Printer name is required` instead of `Custom name is required`. Internal IDs were deliberately left unchanged because routes/API paths/spool locations depend on them staying URL-safe. Static cache bumped to `app.js?v=424`.
  - Verification: `node --check app/static/app.js` passed.
  - Deploy note: frontend/static-only; hard refresh browsers after update.
- Bambu add-printer model presets were expanded after review. The dropdown now includes `H2C`, `P2S`, and `X2D` alongside the existing H2/X1/P1/A1 models, with build-volume defaults for the future exclude-object/bed-map flow. Static cache bumped to `app.js?v=423`.
  - Verification: `node --check app/static/app.js` passed.
  - Deploy note: frontend/static-only; hard refresh browsers after update.
- Add Printer now starts with a real `Printer` family dropdown instead of exposing protocol as the first mental model. The first flow is `Bambu -> Model Name`, with model presets for Bambu, Voron/Klipper, Snapmaker, Other Moonraker, and a tucked-away Simulated option for demo/dev use. Model selection fills sensible protocol/icon/camera defaults while leaving `Custom Name` as the user's shop nickname.
  - Printer config now carries optional `build_volume: {x, y, z}` in mm and `printers.yaml.example` shows the new field. The add-printer model dropdown auto-fills editable Build Plate dimensions because exclude-object/bed-map logic will need real plate size later. Current defaults include common Bambu sizes such as H2D `350x320x325`, X/P/A-series `256x256x256`, A1 mini `180x180x180`, plus common Voron presets.
  - Verification: `node --check app/static/app.js` passed; `python -m py_compile app/printer_config.py app/main.py` passed with the usual Windows embedded-Python prefix warning; venv smoke test confirmed `PrinterEntry` preserves `build_volume`.
  - Deploy note: backend restart required for the new optional printer config field; hard refresh browsers to pick up `app.js?v=422` and `style.css?v=342`.
- Snapmaker U1 add-printer defaults were tidied. Selecting `Snapmaker U1` still sets the model to `Snapmaker U1`, but it no longer fills `Custom Name`; that field stays empty with a faded `Printer Beast` placeholder so the user enters their shop name. The form also clears the old auto-filled Snapmaker value when switching connection type/resetting/editing, so `Snapmaker U1` does not stick in the next add-printer form. Static cache bumped to `app.js?v=421`.
  - Verification: `node --check app/static/app.js` passed.
  - Deploy note: frontend/static-only; hard refresh browsers after update.
- FFmpeg is now treated as a tested camera-driver family instead of "whatever newest version happens to be installed". Setup Health now reports `FFmpeg camera driver` and marks Raspberry Pi OS/Debian apt FFmpeg 5.x plus Gyan Windows FFmpeg 8.x as tested; other major versions remain allowed but show as untested/warn for support diagnostics. Windows bootstrap/diagnostics and the Pi installer print the same compatibility message. `INSTALL.md` documents the tested lane so new users do not assume latest FFmpeg is always the safest camera choice.
  - Fleet Wall still-frame preloader no longer shows the large camera icon/`Waiting for next frame` placeholder before the first real snapshot arrives. It now uses a quiet blank dark frame and swaps to the camera when ready. Static cache bumped to `app.js?v=420`.
  - Verification: `node --check app/static/app.js` passed; `python -m py_compile app/main.py` passed with the usual Windows embedded-Python prefix warning; PowerShell AST parse passed for `scripts/windows/bootstrap-install.ps1` and `scripts/windows/diagnose-windows.ps1`; normalized `scripts/install-pi.sh` and the staged Git version passed `bash -n`.
  - Deploy note: backend restart required for the Setup Health FFmpeg check: run `sudo systemctl restart flightdeck` after the Pi pulls it. Hard refresh browsers to pick up `app.js?v=420`.
- Fleet Wall camera load now uses low-rate still snapshots instead of holding a live MJPEG stream open for every printer tile. This was a narrow port of the useful part of Steve/keenzkustoms' fork idea, not a full merge: Flightdeck now exposes `fleet_url`/`fleet_refresh_ms` camera metadata, adds `/api/camera/{printer_id}/snapshot`, and the Fleet Wall frontend staggers still-frame refreshes around every 3.5s. Live view, printer camera pages, and normal camera stream quality remain unchanged.
  - Bambu snapshot requests use a temporary counted `BambuCameraProxy.snapshot()` client so the shared ffmpeg worker still benefits from the existing idle shutdown/watchdog logic. Deliberately not ported from Steve's fork: the global Bambu proxy downgrade to 640px/2fps/q8, unrelated label-printer changes, or any broad branch merge.
  - GPU/FFmpeg note: browser/GPU acceleration can help display/decoding on Windows, but Flightdeck cannot reliably force camera feeds into AMD VRAM from the web app. Reducing the number of persistent live camera streams is the practical win. FFmpeg is installed through the platform package path (`apt` on Pi, `winget`/Gyan on Windows), so it may trail the newest upstream FFmpeg release; upgrading FFmpeg can be tested separately, but this change reduces Fleet Wall dependence on constant ffmpeg/live streams.
  - Verification: `node --check app/static/app.js` passed; `python -m py_compile app/main.py app/camera.py` and `.venv/Scripts/python.exe -m py_compile app/main.py app/camera.py` passed with the usual Windows embedded-Python prefix warning; `git diff --check` passed.
  - Deploy note: functional commit is `12b7ca5` (`Use still snapshots on Fleet Wall`). Backend restart required for the new snapshot endpoint and camera metadata: run `sudo systemctl restart flightdeck` after the Pi pulls it. Hard refresh browsers to pick up `app.js?v=419`.
- Support bundles now require context during early testing. The visible `Diagnostics only` fallback was removed from the modal, the copy now asks users to fill in as much information as possible, then click `Download zip`, attach it to an email, and send it to `flightdeck3dprinters@gmail.com`. Frontend and backend both require name, email, and problem/what happened before generating `/api/setup/logs/support`. The plain `/api/setup/logs/download` endpoint remains available for internal direct use, but it is no longer offered in the modal. Static cache bumped to `app.js?v=418`.
  - Journal log capture was improved: diagnostic bundles now append a clear remediation note when `journalctl` cannot read service logs, Setup Health includes an optional `Journal logs` check, and `scripts/install-systemd.sh` writes `SupplementaryGroups=systemd-journal adm` so freshly installed/refreshed systemd units can read journal output.
  - Verification: `node --check app/static/app.js` passed; `python -m py_compile app/main.py` and `.venv/Scripts/python.exe -m py_compile app/main.py` passed with the usual Windows embedded-Python prefix warning. Local smoke test confirmed missing name/email/problem is rejected with 422 and a filled support bundle still contains `support-request.txt`.
  - Deploy note: GitHub was pushed and the Pi repo fast-forwarded to commit `757834f` via `/api/update`; updater reported `restart_required: true`. Run `sudo systemctl restart flightdeck` for the backend changes. To fully apply the journal permission unit change on an existing Pi install, run `cd /home/flightdeck/flightdeck && ./scripts/install-systemd.sh` once, or apply `sudo usermod -aG systemd-journal flightdeck && sudo systemctl restart flightdeck`.
- Support bundle modal fallback wording was clarified: the left-side plain diagnostics path now says `Diagnostics only` instead of `Quick zip`, while the main support-notes path remains `Download zip`. Static cache bumped to `app.js?v=417`; frontend refresh only.
  - Verification: `node --check app/static/app.js` passed.
  - Deploy note: GitHub was pushed and the Pi repo fast-forwarded to commit `35e170b` via `/api/update`; updater reported `restart_required: true`, but this specific change is frontend/static-only, so a hard browser refresh should pick up `app.js?v=417`.
- Setup `Download logs` now opens a support-bundle form before downloading the zip. The form captures optional name/email plus problem, expected outcome, and notes, then POSTs to `/api/setup/logs/support`; the generated `flightdeck-support-*.zip` includes both `support-request.txt` and `support-request.json` alongside the existing redacted diagnostics. The old `/api/setup/logs/download` quick zip remains available from inside the modal. Demo mode stubs both log endpoints, and static cache bumped to `app.js?v=416` / `style.css?v=341`; backend restart required for the new POST endpoint.
  - Verification: `node --check app/static/app.js` passed; `python -m py_compile app/main.py` and `.venv/Scripts/python.exe -m py_compile app/main.py` passed with the usual Windows embedded-Python prefix warning. Local venv smoke test generated a support zip containing `support-request.txt` and `support-request.json`. Local browser smoke test on `http://127.0.0.1:8766/#/settings/setup` opened the support modal and submitted the form; the in-app browser cannot save downloads but the modal closed and showed the success toast after the POST.
  - Deploy note: GitHub was pushed and the Pi repo fast-forwarded to commit `c667373` via `/api/update`; updater reported `restart_required: true`, so run `sudo systemctl restart flightdeck` before testing the support-bundle form on the live Pi.
- Setup now has a `Download logs` support button in Version & Updates. It downloads a generated diagnostic zip from `/api/setup/logs/download` containing setup health, instance/version metadata, redacted settings/config/environment, recent decisions/notifications, recent local log tails, git status/log, ffmpeg/python info, and systemd/journal/process details where available. Secret-like keys are redacted and log/config files are capped to recent tails. Static cache bumped to `app.js?v=415` and `style.css?v=340`; backend restart required for the new endpoint.
  - Verification: `node --check app/static/app.js` passed; `python -m py_compile app/main.py` and `.venv/Scripts/python.exe -m py_compile app/main.py` passed with the usual Windows embedded-Python prefix warning. Local venv smoke test generated a diagnostic zip containing setup health, redacted settings, recent decisions, recent notifications, redacted printer config, logs, and command outputs.
  - Deploy note: GitHub was pushed and the Pi repo fast-forwarded to commit `e402e3e` via `/api/update`; updater reported `restart_required: true`, so run `sudo systemctl restart flightdeck` before testing the download button.
- Added Flightdeck Ko-fi support wiring for `https://ko-fi.com/flightdeck3dprinters`: GitHub funding metadata in `.github/FUNDING.yml`, a restrained README support section, and Ko-fi CTAs on the GitHub Pages site. This is docs/static site only; no app restart required.
  - Deploy note: GitHub was pushed and the Pi repo fast-forwarded to commit `4ce6b5c` via `/api/update`. Updater reported `restart_required: true`, but this change is README/docs/funding metadata only; no Flightdeck service restart is needed for it.
- AMS Profile Doctor and Slicer settings now use Flightdeck custom profile pickers instead of browser datalist dropdowns. The AMS slot profile override shows a search field with a scrollable Bambuddy-style filament profile list, selected state, material tag, and keeps profile override opt-in. The Slicer defaults printer/process/filament inputs use the same search-and-select popup while preserving the existing Orca profile filtering and defaults save endpoint. Static cache bumped to `app.js?v=414` and `style.css?v=339`; frontend refresh required.
  - Deploy note: GitHub was pushed and the Pi repo fast-forwarded to commit `5663161` via `/api/update`. Updater reported `restart_required: true`, but this change is frontend/static-only; hard refresh the browser to pick up `app.js?v=414` and `style.css?v=339`.
- AMS slot picker now treats Flightdeck assignments in a live-empty printer slot as movable stale-location candidates. If a spool still says it is in H2D AMS 1 S2 but the printer reports that slot empty, it appears in another slot doctor's picker as an `Empty source slot` option and moving it relocates the same physical spool instead of blocking it as already assigned. Static cache bumped to `app.js?v=413`; frontend refresh required.
  - Deploy note: GitHub was pushed and the Pi repo fast-forwarded to commit `5d5f242` via `/api/update`. Updater reported `restart_required: true`, but this change is frontend/static-only; hard refresh the browser to pick up `app.js?v=413`.
- AMS Profile Doctor now has an explicit Bambu slot profile override panel for the assigned spool. The spool remains the Flightdeck identity; by default Trust Flightdeck still uses the existing spool-to-AMS mapping, including custom aliases like Siddament ASA. If the operator ticks/edits the override panel, Trust Flightdeck sends the chosen profile name, material, colour, temperature range, and generic Bambu family tray ID to the AMS slot. This mirrors the useful part of Bambuddy's Configure AMS Slot flow without making slicer sync silently become spool identity. Static cache bumped to `app.js?v=412` and `style.css?v=338`; backend restart required because `/api/spools/{id}/move` now accepts the optional `ams_profile` payload and the Bambu MQTT sender accepts an override.
  - Verification: `node --check app/static/app.js` passed; `python -m py_compile app/main.py app/printers/bambu.py` passed with the usual Windows embedded-Python prefix warning. Local server on `localhost:8765` served `app.js?v=412` and `style.css?v=338`, but the demo runtime stayed on `Connecting...`, so live Pi UI verification is still needed after deploy/restart.
  - Deploy note: GitHub was pushed and the Pi repo fast-forwarded to commit `ef07507` via `/api/update`; updater reported `restart_required: true`, so run `sudo systemctl restart flightdeck` before testing the new AMS profile override.
- AMS Profile Doctor now also treats Bambu slots that report `Loaded` but have blank material/colour/profile as low-confidence. Live watch of H2D AMS 1 S1 showed stale red -> Peak Green after Trust Flightdeck -> empty -> Flightdeck auto-returned #76 -> Bambu reinserted as loaded with blank metadata. The Doctor should no longer invent a best match such as Black ABS from an unknown loaded slot; pick the physical shelf spool and Flightdeck will overwrite the AMS profile. Static cache bumped to `app.js?v=411` and `style.css?v=337`; frontend refresh only.
  - Deploy note: GitHub was pushed and the Pi repo pulled commit `f47a256` via `/api/update`. Updater reported `restart_required: true`, but this is frontend/static-only; refresh the browser to pick up `app.js?v=411`.
- AMS Profile Doctor now treats unassigned Bambu slots with generic profiles (`Generic PLA`/`GFL99`) as low-confidence because the printer can retain stale AMS colour/profile memory after a physical spool change. It no longer promotes a "best stored match" or Suggested badges from stale generic colour; it shows a warning to choose the physical shelf spool, and assignment still overwrites the AMS slot profile. Static cache bumped to `app.js?v=410` and `style.css?v=336`; frontend refresh only.
  - Deploy note: GitHub was pushed and the Pi repo pulled commit `4d45176` via `/api/update`. The updater reported `restart_required: true`, but the code change is frontend/static-only; refresh the browser to pick up `app.js?v=410`.
- AMS slot doctor can now automate shelf-to-occupied-slot swaps. The picker sends an intentional `replace_existing` move: if the target AMS slot already has a Flightdeck spool, the backend returns that old spool to its home shelf, assigns the chosen shelf spool into the slot, then pushes the existing Trust Flightdeck/Bambu AMS profile sync. Static cache bumped to `app.js?v=409` and `style.css?v=335`; backend restart required.
  - Deploy note: GitHub was pushed and the Pi repo pulled commit `57f22f2` via `/api/update`; updater reported `restart_required: true`, so run `sudo systemctl restart flightdeck` before testing the automated swap path.
- AMS slot shelf assignment picker has been tightened for the "add spool from shelf to AMS slot" flow. Slot editor now shows shelf-aware filter chips (`All`, live-report `Matches`, and top storage locations), row badges for suggested/home-shelf spools, clearer shelf counts, and keeps the existing backend move/home-shelf memory plus Bambu AMS profile sync untouched. Static cache bumped to `app.js?v=408` and `style.css?v=334`; frontend refresh only.
  - Deploy note: GitHub was pushed and the Pi repo pulled commit `8b0391f` via `/api/update`. The updater reported `restart_required: true` even though the code change is static/frontend-only, so a browser refresh should pick it up; a service restart is only needed if the running app does not serve the new cache-busted static files.
- Snapmaker U1 setup camera defaults were corrected after live UI review: choosing Snapmaker U1 now replaces the old generic Moonraker `/webcam/?action=stream|snapshot` defaults with U1-style `/webcam/stream.mjpg` and `/webcam/snapshot.jpg` paths, and the placeholders match those paths.
- Ported Steve/keenzkustoms' Snapmaker U1 ecosystem support from his fork as a narrow Flightdeck-main change. Flightdeck now accepts `connection.type: snapmaker_u1`, polls U1 as a Moonraker-family printer with four independent toolheads (`T0`-`T3`), shows a Snapmaker U1 toolhead loadout/selected-tool route on Live, exposes Snapmaker U1 in printer setup with default MJPEG/snapshot paths, and documents the config shape in `printers.yaml.example`. Deliberately not ported from Steve's fork yet: adaptive snapshot/WebRTC camera experiments or broad polling/camera changes.
  - Deploy note: GitHub was pushed and the Pi repo pulled the change via `/api/update` to commit `731562f`, but the updater reported `restart_required: true`. SSH restart from this Windows session still failed with public-key auth, so the running Pi backend needs a Flightdeck service restart before the new `snapmaker_u1` config parser is active.
- Fleet Wall Medium now uses a compact AMS feed-route strip instead of the full AMS bay visual. It reuses the Live-page route truth, shows active/ready filament paths to Left/Right nozzle or toolhead, and falls back to loaded spool chips when nothing is actively feeding.
- Setup updater now has explicit visual states: Update changes colour/text for available, checking, updating, blocked, and updated states, and the update message becomes a coloured status box so Windows users can see when local changes or a failed pull block the update.
- Windows/web Setup update button now remains clickable when the checkout has local changes, so clicking Update surfaces the backend blocker message instead of feeling like a dead button. Check GitHub also explains that local changes must be committed, stashed, or removed before updating.
- Bambu camera proxy startup race fixed: Live/Print Wall camera streams now count the browser as a client before ffmpeg starts, and the watchdog restarts a missing worker while clients are still watching. This targets the recurring H2D black camera panel where AMS/MQTT kept updating but the MJPEG stream opened with no frames.
- H2D/other Bambu Print Bay loading is hardened: Bambu SD/FTP file listing now has a short timeout and a brief successful-target cache so the Print Bay can show vault/reprint content instead of sitting on `Loading Print Bay...` when the printer file store is slow.
- Live rail fan controls now match the preheat rail width: each fan channel uses a full-width slider row with the label/percent above it, so the controls no longer look squeezed beside the camera.
- Fixed the first-pass live-control rail camera collapse: `.live-main-deck` now has a viewport-based minimum height so the camera hero cannot compute to 0px high beside the new rail.
- Live printer controls now sit in a vertical left-side rail beside the camera instead of spanning across the top. The printer/status/transport header stays above the camera, while preheat, fan, jog, home, and Klipper controls move into `#detail-live-ops` inside `.live-control-rail`.
- Camera wide mode hides the new live-control rail and live strip so the camera can expand cleanly; mobile stacks the rail above the camera.
- Fleet Wall `XS` headers now use a two-row compact layout so printer identity and warning chips do not crowd each other. Names truncate cleanly, icons are smaller, and warning chips move under the printer name instead of fighting for the same row.
- Restored Fleet Wall `Small` as its own mode. `XS` is now the extra-small camera-wall-sized mode with fixed non-stretching `18rem` columns so three printers do not expand to Medium-sized cards.
- Camera Wall has been removed from command search and the top nav. Legacy `#/cameras` URLs now route back to Fleet Wall.
- Fleet Wall `XS` keeps normal live camera URLs, hides body panels, and uses compact 16:10 camera tiles.
- The active camera release endpoint/ffmpeg kill attempt was removed because it could race shared Bambu streams and make the wall black again. Camera pages are back to clearing `<img>` sources only, leaving the existing proxy idle cleanup to handle workers.
- Fleet Wall now has an `XS` mode that keeps the normal live camera URLs but strips the body panels down to a compact camera-first wall, closer to the original camera view.
- Reverted the Fleet Wall live-camera cap / `profile=fleet&fps=2` attempt because it made the live Fleet Wall camera areas black on the real 3-printer Pi view. Do not reapply that approach as-is; next camera-load attempt should preserve normal Fleet Wall stream URLs and first verify actual image rendering on the live Pi.
- Windows uninstall is now a root `Uninstall-Flightdeck-Windows.cmd` plus hardened `scripts/windows/uninstall-windows.ps1`. It stops Flightdeck tray/backend processes for this checkout, removes Desktop and Startup shortcuts, keeps `%LOCALAPPDATA%\Flightdeck` by default, and only deletes restored data when `-RemoveData` is passed.
- Windows installer can now import an existing Flightdeck backup archive via `-DataArchive`. The bootstrap passes the archive through, the install script extracts the standard `flightdeck-data` backup shape into `%LOCALAPPDATA%\Flightdeck`, and it creates a `restore-safety-*` copy first if Windows already has data.
- Fresh all-data Pi backup for Windows install: `/home/flightdeck/windows-install-backups/flightdeck-backup-20260608-182118.tar.gz` (37 MB, SHA256 `5ff17fa0819f54d4d4588253e7ea4a254a067e0a66336c7fe584df001d240c49`). It was also pushed to the private backup repo.
- Live Ops jog controls now allow paused printers, which is needed for recovery cases like the H2D reporting `paused` with a Bambu alarm. Jog still stays disabled for active printing, finished, offline, error, and estop states.
- Bambu XYZ jog is now wired through the installed Bambu package's validated `gcode_line` route (`G91`, bounded `G1 X/Y/Z`, `G90`). The Live Ops jog pad enables for idle/safe Bambu printers instead of showing "Jog unavailable"; Bambu Home All still uses the existing `home_printer()` path.
- Klipper/Moonraker printers have a compact XYZ jog pad in Live Ops. X/Y jogs are 10mm steps, Z jogs are 1mm steps, XY home sits in the pad centre, and backend `/api/printers/{id}/jog` keeps X/Y capped at 50mm and Z capped at 10mm.
- Windows desktop installer shortcuts now use a packaged `app/static/flightdeck.ico` file for the Flightdeck icon. Both fresh installs and the standalone desktop-shortcut helper prefer the `.ico` and fall back to the PNG if it is missing.
- Flightdeck shortcut icons are now explicit in the live app, demo app, and GitHub Pages site. The app pages link the SVG plus PNG favicon fallback, and `docs/assets/flightdeck-icon-192.png` gives the GitHub Pages page a PNG shortcut icon fallback.
- Bambu skip-object maps now use the 3MF `Metadata/top_N.png` top-down plate image as the visual background when available, while Print Details keeps using the normal `Metadata/plate_N.png` preview thumbnail. This should keep the current Bambuddy-style ID coordinate mapping but make the tags line up against a true top-down bed image instead of the angled preview.
- Bambu skip-object ID pins now use the same source as Bambuddy: `slice_info.config` provides the skip ID/name and `Metadata/plate_N.json` provides that object's bbox center by name. This fixes cases like Can Opener where G-code object-label IDs made `701` appear on the wrong thumbnail footprint.
- Camera stream caching/stale-connection handling has been tightened. `/api/camera/*` responses now send stronger no-store/no-buffer headers, and the frontend quietly refreshes visible live camera `<img>` streams after 2 minutes or when the browser tab becomes visible again.
- Bambu skip-object maps now use the active 3MF/print thumbnail as the visible plate preview behind the Bambuddy-style object IDs. The old top-down diagnostic grid/exploded shape view is no longer the primary visual; transparent hit regions and the ID/name skip list still use the original Bambu object IDs.
- Bambu skip-object map bounds now preserve the 3MF plate/preview bounds when available instead of replacing them with the tight recovered G-code object bounds. This avoids the skip-object map appearing exploded compared with the print-detail/top-preview layout.
- Bambu skip-object maps now follow the Bambuddy-style ID workflow: a clean positional map with small red object markers, blue ID dots, active count, and a compact ID/name skip list. The raw G-code extrusion path is no longer shown as the main object shape.
- The vertical Bambu skip-object `Front` marker now sits just outside the map area on the far right.
- The Bambu top-down skip-object `Front` marker is now vertical and sits on the far right-hand side of the map.
- Bambu top-down skip-object maps now show a small `Front` marker at the right-hand centre of the map. It is a visual-only overlay and does not affect red regions, object outlines, or skip IDs.
- Bambu top-down skip-object maps now apply mirror flags plus `map_coordinate_rotation=-90` through coordinate math, so the whole red overlay and SVG footprint layout rotates left together. On the X1C 6-object map, skipped object `#96` now lands where `#115` was previously.
- Bambu top-down skip-object maps now expose `map_mirror_y=true` and `map_mirror_x=false`; this keeps the skipped X1C object `#96` in the top-right corner while preserving raw Bambu object IDs for skip commands.
- Bambu top-down skip maps now draw a footprint shape for each object instead of only a generic rectangle. The parser sends a simplified convex footprint plus extrusion strokes from object-labelled gcode; X1C's 6-Benchy print parsed with 14-point footprints and 29 strokes for each skip ID.
- Bambu skip-object maps now render as a Mainsail-style top-down bed map instead of using the angled Bambu plate thumbnail. The parser now recovers per-object top-down bboxes from `Metadata/plate_*.gcode` object-label extrusion moves, which fixes repeated-copy jobs like the X1C 6-Benchy print where `plate_1.json` only exposed one combined bbox.
- Bambu/H2D camera proxy no longer restarts ffmpeg just because frames are byte-identical for 8 seconds; that false-positive could make the Live view appear frozen during quiet parts of a print. It still restarts when no frames arrive, the initial frame never appears, or the 15-minute H2D RTSP session lifetime is reached.
- H2D/AMS HT loaded filament now keeps a visible route to `Right nozzle` even when the HT slot is parked/idle; idle routes show `Ready` instead of pretending filament is actively fed. Demo AMS HT spool data now uses canonical slot `128` instead of legacy `512`.
- Queue STEP slice dialogs now hide `Slice in Flightdeck` and explain the Orca GUI handoff because the Orca background CLI/API rejects STEP imports (`Unknown file format... must have .stl, .obj, .amf`). STEP items still provide Download/Open Orca/Copy output/Check vault actions.
- Slicer API runs no longer require Orca installed on the Pi just to load profile JSON. If local Orca profile files are unavailable, Flightdeck fetches the selected profile JSONs from the synced Orca profile catalog paths.
- Queue/API slicing now falls back to the configured Slicer API URL when the configured Worker URL is unreachable. Live diagnosis showed `orcaslicer_worker_url=http://100.112.171.88:8000` timing out while `orcaslicer_api_url=http://100.112.171.88:3003` was healthy.
- Queued `.step` / `.stp` source-model items now show a `Slice` button that opens the existing slicer dialog for that queue item and target printer.
- Printer queues now accept `.step` and `.stp` uploads as source-model cue items. They appear in the queue with a STEP marker, but queue preflight blocks dispatch until the model is sliced into a printer-ready job.
- Bambu per-object thumbnail slices currently use `transform: rotate(25deg)` on `.obj-map-image-piece` as the latest visual trial. This rotates only the white object slices, not the red overlay.
- Bambu/Klipper live fan controls no longer show Off/50/100 preset buttons; each fan now uses one 10%-step percentage slider with a visible percent readout and red/green off/on styling.
- Previous Bambu per-object thumbnail slice trial used `transform: rotate(10deg)` on `.obj-map-image-piece`.
- Bambu skip-object maps now support `map_image_mode=per_object`, which slices the thumbnail by each object's bbox and renders that image piece inside its own locked red overlay box. This keeps the red boxes as source of truth and avoids moving the whole bed thumbnail as one layer.
- Bambu skip-object thumbnail offsets are now both `0` so the thumbnail sits flat under the locked red overlay. Current trial is red overlay locked, thumbnail angle `45deg`, `x=0%`, `y=0%`.
- Reverted the Bambu/H2D plate underlay because it made the skip-object map worse. Current map is back to the previous best: locked red overlay, thumbnail image `45deg`, `x=5%`, `y=-92%`.
- Bambu skip-object thumbnail layer now supports image-only X/Y offsets; current H2D trial keeps the red overlay locked and moves the rotated thumbnail by `x=5%`, `y=-92%` to bring the star down inside `#439` and move the spoon shapes left into `#148/#463`.
- Bambu skip-object red overlay remains locked unrotated/axis-aligned. The thumbnail image is now on a separate layer underneath and currently rotates 45 degrees to try to bring the left spoon/keeper shape into the `#148` box without moving the red boxes.
- Bambu skip-object map rotation is now locked at `0` so the red overlay stays axis-aligned like the user's second reference image: `#148/#463` vertical on the left, `#417` bottom-left, and `#439` across the right. Do not rotate or move the red overlay in future thumbnail alignment work.
- Restored the Bambu skip-object overlay to the user-approved 45-degree shared thumbnail/box rotation and removed the separate image-layer experiment again. The red overlay should match the screenshot target with `#148/#463` left, `#417` bottom-left, and `#439` right.
- Reverted the image-only rotation trial because it made the H2D skip-object map worse; Flightdeck is back to the better 45-degree shared thumbnail/box rotation.
- Bambu skip-object map display rotation is currently set to 45 degrees clockwise as a user-requested visual check after the full 90-degree version looked too far.
- Bambu skip-object maps now render the thumbnail/object overlay as a 90-degree clockwise display rotation while preserving the underlying skip IDs. This is to match the H2D touchscreen orientation from the user's photo.
- Bambu/H2D skip-object maps now fall back to matching plate-layout boxes by object name and occurrence when Bambu's plate JSON uses different internal IDs from the MQTT skip IDs, and the Y axis is flipped to match the Bambu screen/thumbnail orientation. BigBoy's current small front `Spool Holder` cylinder is object `#417`.
- AMS slot indexing now uses one canonical rule across backend/frontend: regular AMS slots stay `unit*4+slot`, AMS HT uses Bambu tray ids `128+slot`, with legacy `512` accepted during transition.
- Generic Bambu AMS/AMS HT reports now only auto-claim the exact recently remembered spool for that slot; if that spool is unavailable, Flightdeck leaves the slot for manual confirmation instead of grabbing a similar spool.
- Bambu printer-side/operator Stop now records as `CANCELLED` when the printer reports `FAILED` with no alarm/error code, instead of polluting reliability stats as `ERROR`.
- Print Watch focus now preserves the active camera image while refreshing status/HUD text, preventing the double flash when the same printer stays selected.
- Printer health now excludes prints marked no-stats/Flightdeck testing from 14d failure totals, early-failure counts, cancelled totals, and success-rate math.
- Fleet Wall added with Small/Medium/Large modes.
- Fleet Wall now uses Live-view style AMS visuals.
- Fleet Wall warnings compacted.
- Fleet Wall camera tile opens the printer Live view.
- Fleet Wall camera fullscreen exits back to Fleet Wall when opened from Fleet Wall.
- Cameras is now Print Watch with a rotating large focus feed that pins on attention.
- Live camera zoom cycle stays on Live view instead of jumping to Cameras.
- Themes, sidebar text colour, and wider adjustable sidebar are in.
- Printer nav uses shop name first, model second.
- Print disabled state shows as On hold.
- Orca/browser/worker slicer settings and tests are in.
- Bambu/Klipper live controls expanded.
- Stock-in sheet/QR workflow started.
- Bambu skip-object UI now thumbnail-first with list removed/reduced.
- Sim printer stale notifications cleaned up.

Likely next items:
- If the rotated Bambu object map looks correct on the X1C/H2D, keep `map_mirror_y=true` plus `map_coordinate_rotation=-90`; if the target changes, adjust only the display transform flags without changing the object parser or skip IDs.
- Keep polishing Fleet Wall layout and AMS sizing.
- Recheck BigBoy AMS HT assignment after any physical spool moves; HT should now show as slot `128` rather than legacy `512`.
- Recheck Fleet Wall click/zoom behaviour after real use.
- Continue slicer/API integration and profile filtering.
- Continue stock-in QR/label workflow.
- Make Windows installer/update flow smoother.

## What was changed - Session 28.257 (Bambu skip-object map mirror - 8 June)
- Bambu object maps now send `map_mirror_x=true` for the top-down skip-object view.
- The frontend mirrors object overlay coordinates and SVG footprint outlines from that flag, so the red hit regions and white object shapes move together visually.
- Raw Bambu object IDs are unchanged; skip commands still send the original printer/MQTT object IDs.
- Static cache bumped to `app.js?v=384` and `style.css?v=313`; backend restart and frontend refresh required.

## What was changed - Session 28.258 (Bambu skip-object top-right orientation - 8 June)
- Switched the Bambu top-down skip-object map from X mirror to Y mirror: `map_mirror_x=false`, `map_mirror_y=true`.
- This orientation puts the skipped X1C object `#96` in the top-right corner while keeping the same object outlines and raw skip IDs.
- Backend restart required; static cache remains `app.js?v=384` and `style.css?v=313`.

## What was changed - Session 28.259 (Bambu skip-object left rotation - 8 June)
- Added `map_coordinate_rotation=-90` for Bambu top-down object maps.
- Frontend map rendering now applies mirror/rotation transforms to the actual object coordinates and SVG footprint points, so the red regions and white outlines rotate together as one layout.
- Coordinate check against live X1C data puts skipped `#96` at `left=0.00%, top=0.00%`, matching the previous `#115` corner.
- Static cache bumped to `app.js?v=385` and `style.css?v=314`; backend restart and frontend refresh required.

## What was changed - Session 28.260 (Bambu skip-object front marker - 8 June)
- Added a small `Front` marker at the right-hand centre of Bambu top-down skip-object maps.
- The marker is visual only, rendered above the map with `pointer-events: none`, and does not affect object regions, outlines, or skip commands.
- Static cache bumped to `app.js?v=386` and `style.css?v=315`; frontend refresh required.

## What was changed - Session 28.261 (Bambu vertical front marker - 8 June)
- Changed the Bambu top-down skip-object `Front` marker to vertical text on the far right-hand side.
- Static cache bumped to `style.css?v=316`; frontend refresh required.

## What was changed - Session 28.262 (Bambu front marker outside map - 8 June)
- Moved the vertical Bambu top-down skip-object `Front` marker just outside the map area on the far right.
- Static cache bumped to `style.css?v=317`; frontend refresh required.

## What was changed - Session 28.263 (Bambuddy-style skip-object map - 8 June)
- Reworked the Bambu skip-object map presentation to match Bambuddy's simpler operator workflow.
- The visible map now uses compact red object markers with blue ID dots and an active count, while the raw G-code extrusion path is no longer shown as the main visual shape.
- Added a compact object ID/name list below the map; map regions and list rows still send the original Bambu skip IDs.
- Static cache bumped to `app.js?v=387` and `style.css?v=318`; frontend refresh required.

## What was fixed - Session 28.264 (Bambu skip-object plate bounds - 8 June)
- Fixed the skip-object map looking exploded compared with the print-detail preview.
- The parser now preserves 3MF plate/preview bounds when they exist and only falls back to tight G-code object bounds when no plate bounds are available.
- Clarified the Bambu object detail text: skip state comes from MQTT, object positions come from 3MF metadata.
- Static cache bumped to `app.js?v=388`; backend restart and frontend refresh required.

## What was changed - Session 28.265 (Bambuddy plate preview for skip objects - 8 June)
- Replaced the visible Bambu top-down skip-object grid/exploded marker presentation with a Bambuddy-style plate preview: the active 3MF thumbnail is now shown under compact red object pins with blue ID badges.
- The transparent clickable red-box/hit regions are still generated from the preserved 3MF plate bounds and still send the raw Bambu object IDs; the ID/name list remains available below the map.
- The map badge now reports mapped pins when the skip list has objects without plate bboxes, so list-only IDs do not make the plate count look wrong.
- List-only Bambu IDs without bed bboxes no longer render as loose buttons on top of the plate preview; they remain available in the ID/name list.
- Removed the previous `transform: rotate(25deg)` thumbnail-slice visual trial from `.obj-map-image-piece`.
- Static cache bumped to `app.js?v=391` and `style.css?v=321`; frontend refresh required.

## What was changed - Session 28.266 (Camera stale stream cleanup - 8 June)
- Strengthened `/api/camera/*` stream headers to `no-store, no-cache, must-revalidate, max-age=0` with `Pragma`, `Expires`, and `X-Accel-Buffering: no`.
- Added a frontend stale-connection refresh for visible camera images: each visible stream gets a fresh timestamped URL after 2 minutes, and all visible streams refresh when the browser tab becomes visible again.
- This targets browser/MJPEG stale connections without changing the configured camera frame rates: Bambu remains 5 fps via ffmpeg; Voron/Greyhound remains pass-through from Crowsnest.
- Static cache bumped to `app.js?v=392`; backend restart and frontend refresh required.

## What was fixed - Session 28.267 (Bambu skip-object ID pin mapping - 8 June)
- Fixed Bambu skip-object IDs being attached to the wrong visual footprint on plates where G-code object-label IDs do not match the `slice_info.config` object order.
- The backend now matches each `slice_info.config` skip ID/name to the center of the same object name in `Metadata/plate_N.json`, following Bambuddy's source-of-truth approach.
- The frontend now prefers those plate JSON `x/y` centers for Bambu top-down pin and click-target placement, falling back to bboxes only when no point exists.
- Verified against the active Can Opener H2D plate: `701` now maps to the upper-left hook area instead of the lower-left footprint.
- Static cache bumped to `app.js?v=393`; backend restart and frontend refresh required.

## What was fixed - Session 28.268 (Bambu skip-object top image - 8 June)
- Bambu 3MF parsing now keeps `Metadata/top_N.png` alongside the normal plate preview.
- `/api/printers/{id}/thumbnail?view=top` serves that top-down image for Bambu printers when available, falling back to the normal thumbnail behavior otherwise.
- The skip-object map now uses the top-down image URL for top-down object maps, while Print Details and other thumbnail uses remain on the regular angled `plate_N.png` preview.
- Static cache bumped to `app.js?v=394`; backend restart and frontend refresh required.

## What was changed - Session 28.269 (Flightdeck shortcut icon - 8 June)
- Added explicit `shortcut icon` and PNG favicon fallback links to the live app and demo HTML heads.
- Added `docs/assets/flightdeck-icon-192.png` and linked it from the GitHub Pages `docs/index.html` page so the GitHub-hosted project page has the Flightdeck shortcut icon fallback as well as the SVG icon.
- No backend restart required; frontend/page refresh enough.

## What was changed - Session 28.270 (Windows installer icon - 8 June)
- Added packaged `app/static/flightdeck.ico` generated from the existing Flightdeck app icon.
- Windows install and desktop shortcut scripts now use the `.ico` for Desktop/Startup shortcut icons, with the existing PNG as fallback.
- README/INSTALL now describe the Windows shortcuts as Flightdeck-branded.
- No backend restart required.

## What was added - Session 28.271 (Klipper XYZ jog controls - 8 June)
- Added `/api/printers/{id}/jog` for Klipper/Moonraker printers with bounded X/Y/Z relative motion.
- Live Ops now shows a compact XYZ jog pad: X/Y use 10mm steps, Z uses 1mm steps, and the centre button homes XY.
- Existing `/jog-z` remains available for compatibility.
- Bambu pages show the jog pad as unavailable and still expose Home All separately; no Bambu axis jog is enabled until the MQTT/control path is proven safe.
- Static cache bumped to `app.js?v=395` and `style.css?v=322`; backend restart and frontend refresh required.

## What was fixed - Session 28.272 (Bambu XYZ jog controls - 8 June)
- Enabled the same bounded XYZ jog endpoint for Bambu printers using the Bambu package's validated `Printer.gcode()` / MQTT `gcode_line` path.
- Bambu Live Ops jog buttons now enable when the printer is in a safe idle state; printing, paused, error, finished, offline, and estop states still disable jog.
- Static cache bumped to `app.js?v=396`; backend restart and frontend refresh required.

## What was fixed - Session 28.273 (Paused printer jog enablement - 8 June)
- Live Ops jog controls now remain enabled for paused printers so recovery/clearance moves are possible.
- Jog is still disabled during active printing, finished, offline, error, and estop states.
- Static cache bumped to `app.js?v=397`; frontend refresh required.

## What was added - Session 28.274 (Windows install with data archive - 8 June)
- Added `-DataArchive` support to `scripts/windows/bootstrap-install.ps1` and `scripts/windows/install-windows.ps1`.
- `Install-Flightdeck-Windows.cmd` now passes command-line arguments through to the bootstrap, so a data archive path can be supplied from the root installer too.
- The Windows install restores the normal Pi backup archive layout into `%LOCALAPPDATA%\Flightdeck` and creates a `restore-safety-*` copy first when existing Windows data is present.
- README/INSTALL now document making a Pi backup with `INCLUDE_PRINT_LIBRARY=1` and passing it to the Windows installer.
- Created current all-data Pi archive for Windows install: `/home/flightdeck/windows-install-backups/flightdeck-backup-20260608-182118.tar.gz`; SHA256 `5ff17fa0819f54d4d4588253e7ea4a254a067e0a66336c7fe584df001d240c49`.
- No backend restart required for installer-only changes.

## What was added - Session 28.275 (Windows uninstall helper - 8 June)
- Added root `Uninstall-Flightdeck-Windows.cmd`.
- Hardened `scripts/windows/uninstall-windows.ps1` to stop Flightdeck tray/backend processes for the checkout and remove both Desktop and Startup shortcuts.
- Windows uninstall keeps `%LOCALAPPDATA%\Flightdeck` by default; pass `-RemoveData` to delete restored data/history/uploads/print vault, and `-RemoveVenv` to remove the repo virtual environment.
- README/INSTALL now document uninstall commands.
- No backend restart required for installer-only changes.

## What was fixed - Session 28.241 (AMS HT slot canonicalization - 7 June)
- Regular AMS slots continue to use `unit*4 + slot` indexes.
- AMS HT slots now consistently use Bambu global tray ids (`128 + slot`) across live parsing, snapshots, backend reconciliation, frontend labels, slot editor, and spool assignment UI.
- Legacy `512` slot ids are still accepted when syncing to Bambu and when reading recent slot memory during transition; existing Pi `h2d:512` spool rows are normalized to `h2d:128`.
- Bumped static cache to `app.js?v=366`; backend restart and frontend refresh required.

## What was fixed - Session 28.242 (Bambu skip-object map fallback - 7 June)
- H2D/Bambu skip-object metadata can expose MQTT skip IDs in `slice_info.config` while the plate layout JSON uses different internal object IDs.
- The 3MF parser now still uses exact ID matches when available, but falls back to matching object-layout boxes by basename and occurrence order.
- Verified against BigBoy's active `Filament Keeper v1_ASA_3h12m` 3MF: object IDs `148`, `463`, `417`, and `439` now include bed bounding boxes for the clickable skip-object map.
- Backend restart required.

## What was fixed - Session 28.243 (Bambu skip-object map Y axis - 7 June)
- Bambu plate layout boxes are now flipped vertically into the thumbnail/screen orientation before Flightdeck renders the skip-object map.
- This keeps the left/right positions unchanged while moving the front/bottom parts to the bottom of Flightdeck's map.
- Verified against BigBoy's current job: small front `Spool Holder v3.step` object `#417` now maps near the bottom/front instead of the top.
- Backend restart required.

## What was changed - Session 28.244 (Bambu skip-object map display rotation - 7 June)
- Bambu object maps now send `map_rotation=90`, and the frontend rotates the thumbnail plus hit regions clockwise as a display transform.
- ID labels are counter-rotated so they remain readable.
- Static cache bumped to `app.js?v=367` and `style.css?v=296`; backend restart and frontend refresh required.

## What was changed - Session 28.245 (Bambu skip-object 45-degree preview - 7 June)
- Bambu object maps now send `map_rotation=45` for a user-requested visual check between the unrotated/flipped map and the full 90-degree clockwise screen orientation.
- Frontend object maps now use CSS rotation variables, so the thumbnail/hit regions and counter-rotated labels can support non-90-degree rotations.
- Static cache bumped to `app.js?v=368` and `style.css?v=297`; backend restart and frontend refresh required.

## What was reverted - Session 28.246 (Bambu skip-object image-only rotation - 7 June)
- Reverted the separate background-image rotation layer.
- The image-only trial kept red boxes at 45 degrees and rotated the thumbnail to 90 degrees underneath, but visually made the map worse.
- Current live target is back to the shared 45-degree thumbnail/box rotation from Session 28.245.
- Static cache remains `app.js?v=368` and `style.css?v=297`; backend restart and frontend refresh required.

## What was restored - Session 28.247 (Bambu skip-object overlay target - 7 June)
- Restored the user-approved shared 45-degree thumbnail/box rotation after the separate image-layer approach moved the red overlay away from the desired screenshot target.
- The red overlay target is `#148/#463` on the left, `#417` bottom-left, and `#439` on the right.
- Static cache bumped to `app.js?v=370` and `style.css?v=299`; backend restart and frontend refresh required.

## What was locked - Session 28.248 (Bambu skip-object red overlay position - 7 June)
- The red object overlay is now locked unrotated/axis-aligned to match the user's second reference image.
- H2D/Bambu maps now report `map_rotation=0`; existing object coordinates from the parsed 3MF remain unchanged.
- Treat the red overlay as source of truth: `#148/#463` vertical on the left, `#417` bottom-left, `#439` across the right.
- Future visual alignment should not move/rotate these red boxes.
- Backend restart required.

## What was changed - Session 28.249 (Bambu skip-object thumbnail-only rotation - 7 June)
- Reintroduced separate thumbnail and overlay layers, with the red overlay locked unrotated and axis-aligned.
- H2D/Bambu maps now report `map_rotation=0` and `map_image_rotation=45`.
- The frontend applies `map_image_rotation` only to the thumbnail layer underneath the red boxes.
- The red boxes must remain untouched: only image rotation/scale/translation should change from here.
- Static cache bumped to `app.js?v=371` and `style.css?v=300`; backend restart and frontend refresh required.

## What was changed - Session 28.250 (Bambu skip-object thumbnail upward offset - 7 June)
- Added `map_image_offset_x` / `map_image_offset_y` support for Bambu object maps.
- Current H2D trial values: `map_rotation=0`, `map_image_rotation=45`, `map_image_offset_x=5`, `map_image_offset_y=-92`.
- This moves only the thumbnail layer upward so the star shape moves toward the centre of the locked `#439` red overlay.
- Red boxes remain locked and must not be moved.
- Static cache bumped to `app.js?v=372` and `style.css?v=301`; backend restart and frontend refresh required.

## What was reverted - Session 28.251 (Bambu skip-object plate underlay - 8 June)
- Reverted the Bambu/H2D-style plate underlay because it made the object map worse.
- Current live target is back to the previous best state: locked red overlay, thumbnail `45deg`, `map_image_offset_x=5`, `map_image_offset_y=-92`.
- Static cache bumped to `app.js?v=374` and `style.css?v=303`; frontend refresh required.

## What was changed - Session 28.252 (Bambu skip-object offset reset - 8 June)
- Reset H2D thumbnail offsets to `map_image_offset_x=0`, `map_image_offset_y=0`.
- Current trial values: `map_rotation=0`, `map_image_rotation=45`, no image offset.
- This removes image translation so rotation can be judged without making the thumbnail appear to float off the bed.
- Backend restart required.

## What was added - Session 28.253 (Bambu skip-object per-object thumbnail slices - 8 June)
- Added `map_image_mode=per_object` for Bambu skip maps.
- The frontend now slices the plate thumbnail using each object's bbox and renders each slice inside that object's locked red overlay box.
- This treats each red box as the object's home instead of moving the entire bed thumbnail as a single layer.
- Current H2D values: `map_rotation=0`, `map_image_rotation=0`, offsets `0,0`, `map_image_mode=per_object`.
- Static cache bumped to `app.js?v=375` and `style.css?v=304`; backend restart and frontend refresh required.

## What was changed - Session 28.254 (Bambu skip-object slice rotation trial - 8 June)
- Added `transform: rotate(10deg)` to `.obj-map-image-piece`.
- This rotates each white thumbnail slice independently inside its locked red box.
- Red overlay boxes remain untouched.
- Static cache bumped to `style.css?v=305`; frontend refresh required.

## What was fixed - Session 28.240 (Generic AMS auto-claim guard - 7 June)
- Generic Bambu AMS reports now only auto-claim the exact recent spool remembered for that slot.
- If the remembered spool is unavailable, Flightdeck no longer grabs another matching generic colour/material spool from storage.
- This prevents BigBoy/AMS HT generic ABS black reports from stealing a different black ABS spool after the original remembered spool was moved elsewhere.
- Backend restart required.

## What was fixed - Session 28.239 (Bambu operator cancel stats - 7 June)
- Bambu printer-side/operator Stop now maps code-free `FAILED` reports to `CANCELLED`.
- Alarm-coded Bambu failures still record as `ERROR`, so real failures such as AMS mapping errors remain visible.
- Existing H2D generic `Print failed` rows from this session were corrected on the Pi from `ERROR` to `CANCELLED`.
- Backend restart required.

## What was fixed - Session 28.238 (Print Watch focus flash - 7 June)
- Print Watch no longer rebuilds the focused camera image when the selected printer/camera is unchanged.
- The focus header, pin state, status chip, HUD copy, progress bar, and temperature chips still refresh in place.
- Bumped static cache to `app.js?v=365`; frontend refresh required.

## What was fixed - Session 28.237 (No-stats printer health - 7 June)
- Printer health now follows Print Memory's trusted-stats rule: prints with `exclude_from_stats` set are ignored for 14d health totals, early-failure counts, cancelled counts, and success-rate warnings.
- This fixes H2D staying in attention because Flightdeck testing/no-stats failures were still counted as `4 failed prints in 14d`.
- Backend restart required.

## What was fixed - Session 28.236 (Fleet Wall AMS demo polish - 7 June)
- Fleet Wall AMS visuals now use mode-specific sizing variables and wrap within the card instead of forcing a clipped horizontal AMS strip.
- Feed indicators are no longer hidden by the Fleet Wall AMS wrapper's vertical clipping.
- Standalone `/demo` now includes the missing Fleet Wall view container, so the demo Fleet Wall nav item renders instead of hitting a null view.
- Fleet Wall camera feed clicks now open Live as `#/printer/{id}?from=fleet`; fullscreen camera close uses that origin marker to return to Fleet Wall, while direct Live-page fullscreen still shrinks back to Live.
- Fleet Wall now renders immediately and hydrates camera feeds as their URLs resolve, avoiding one slow camera lookup blocking the whole wall.
- `Cameras` has been renamed to `Print Watch` in navigation and command search while keeping `#/cameras` compatible.
- Print Watch has a large rotating focus camera, pins to the first printer needing attention, and resumes cycling once attention clears.
- Print Watch no longer auto-pins just because a printer is intentionally on hold; the `Pinned` chip is now a manual pin/unpin control, and unpinning an auto-pinned feed pauses auto-pin until attention clears.
- Camera URL fetches are shared across Fleet Wall/Print Watch and camera retry handlers are attached once per image.
- Demo shell now loads current `app.js?v=366`; main and demo shells load `style.css?v=295`.
- Static-only change; frontend refresh required.


# Flightdeck — next session brief
_Last updated 7 June 2026 (Session 28.235 Bambu FTP error hints)_

## What was improved - Session 28.235 (Bambu FTP error hints - 7 June)
- Bambu FTPS upload failures now raise operator-facing messages instead of raw FTP codes.
- The `426 partial file` case now points operators at USB/SD storage being missing, unformatted, full, or otherwise rejected by the printer.
- Backend restart required.

## What was added - Session 28.234 (Slicer connection diagnostics - 7 June)
- Added `POST /api/slicer/check` so Flightdeck can test Browser Orca, Slicer API, and Worker URLs from the host running Flightdeck.
- Settings -> Slicer now has `Test Browser Orca`, `Test API`, and `Test Worker` buttons with inline reachability feedback.
- Demo mode now stubs the slicer check endpoint.
- Bumped static cache to `app.js?v=339` and `style.css?v=277`; backend restart required.

## What was improved - Session 28.233 (Setup backup check - 7 June)
- Setup Health now has an explicit optional `Backup tools` check for the backup/restore scripts.
- Print Vault readiness and Backup readiness are no longer conflated in the first-run summary.
- Backend restart required.

## What was improved - Session 28.232 (Printer config startup guard - 7 June)
- Flightdeck now starts with an empty fleet if `printers.yaml` is missing or empty, which helps fresh Windows/Pi installs reach the Add Printer screen.
- Duplicate printer IDs in `printers.yaml` now fail validation with a clear `Duplicate printer id` message instead of producing confusing runtime behavior.
- Backend restart required.

## What was added - Session 28.231 (Health endpoint alias - 7 June)
- Added conventional `/health` alongside the existing `/healthz` endpoint.
- Health response now includes the Flightdeck version plus websocket/broadcast status for simple external monitors.
- Backend restart required.

## What was hardened - Session 28.230 (Upload size guardrails - 7 June)
- Added shared backend size/read helpers for files entering Flightdeck.
- Print Vault uploads, Queue uploads, Orca relay uploads, Slicer worker source files, custom slicer profile uploads, and sliced outputs now return clear `413` errors when too large instead of failing later in odd ways.
- Print/model file limit defaults to 2048 MB and can be changed with `FLIGHTDECK_MAX_PRINT_FILE_MB`.
- Custom slicer profile import limit defaults to 64 MB and can be changed with `FLIGHTDECK_MAX_PROFILE_UPLOAD_MB`.
- Backend restart required.

## What was hardened - Session 28.229 (File path safety hardening - 7 June)
- Added shared backend helpers for safe basename normalization and safe path joins under trusted directories.
- Routed Print Vault reads/writes, library upload/copy destinations, slicer output checks, slicer output writes, queue upload staging, and relay filenames through the shared helpers.
- Normal filenames still work, but path-like or unsafe filenames are flattened/sanitized instead of being treated as filesystem paths.
- Backend restart required.

## What was fixed - Session 28.228 (AMS RHS rail padding - 7 June)
- Nudged AMS dryer/status side-rail content to align visually within the dark RHS panel.
- Bumped static cache to `style.css?v=276`; frontend refresh required.

## What was fixed - Session 28.227 (AMS HT scale correction - 7 June)
- Reduced AMS HT reel bay to match normal AMS slot visual scale more closely.
- Gave the AMS HT RHS rail more width so its status text sits further right.
- Bumped static cache to `style.css?v=275`; frontend refresh required.

## What was fixed - Session 28.226 (AMS side rail header anchor - 7 June)
- AMS side rail now aligns from the top label (`4 slot loadout` / `High-temp bay`) instead of centering the entire control stack.
- Drying state/time/stop controls remain centered under the side-rail label.
- Bumped static cache to `style.css?v=274`; frontend refresh required.

## What was fixed - Session 28.225 (AMS side rail centering - 7 June)
- Centered AMS dryer/status side-rail contents horizontally and vertically in the RHS column.
- Bumped static cache to `style.css?v=273`; frontend refresh required.

## What was changed - Session 28.224 (AMS dryer side rails - 7 June)
- Reworked AMS live loadout cards into a left visual area and a right dryer/status rail.
- AMS 1 is wider so the four spool slots keep their spacing while dryer controls sit to the RHS.
- AMS HT uses the same side-rail pattern, keeping the reel visual separate from dryer information.
- Removed dryer status/time from the cramped title metadata line.
- Bumped static cache to `app.js?v=338` and `style.css?v=272`; frontend refresh required.

## What was fixed - Session 28.223 (AMS dry countdown chip - 7 June)
- Removed the drying countdown from the AMS metadata sentence so it no longer truncates words.
- Added the remaining drying time as a compact chip beside the Dry/Stop control.
- Bumped static cache to `app.js?v=337` and `style.css?v=271`; frontend refresh required.

## What was fixed - Session 28.222 (AMS header wrap fix - 7 June)
- AMS loadout metadata now stays on one clipped line instead of wrapping a final word onto its own row.
- Header text area now owns remaining width while the action buttons keep their fixed space.
- Bumped static cache to `style.css?v=270`; frontend refresh required.

## What was fixed - Session 28.221 (AMS slot centering - 7 June)
- Centered normal AMS slot groups inside their loadout bay.
- Kept AMS HT’s single spool bay left-aligned inside its side-rail layout.
- Bumped static cache to `style.css?v=269`; frontend refresh required.

## What was improved - Session 28.220 (AMS loadout alignment - 7 June)
- Normal AMS headers now reserve a consistent header band so their slot row starts cleanly.
- AMS HT spool bay is offset by the same header band, aligning the HT reel with AMS 1 slot visuals.
- AMS 1 header text/actions now align from the top instead of drifting around the center line.
- Bumped static cache to `style.css?v=268`; frontend refresh required.

## What was improved - Session 28.219 (AMS HT side rail layout - 7 June)
- AMS HT live loadout now moves bay/status/dry information into a side rail beside the spool.
- AMS HT spool visual keeps the same slot size language as normal AMS slots instead of being squeezed by stacked text.
- Normal multi-slot AMS layout remains unchanged.
- Bumped static cache to `app.js?v=336` and `style.css?v=267`; frontend refresh required.

## What was changed - Session 28.218 (Object panel list removal - 7 June)
- Removed the duplicate long object row list from the live Objects panel.
- The panel now keeps the thumbnail/map plus compact ID selector, with the enlarged selector handling detailed selection.
- Removed stale object-list CSS from the frontend.
- Bumped static cache to `app.js?v=335` and `style.css?v=266`; frontend refresh required.

## What was added - Session 28.217 (Enlarged object selector - 7 June)
- Clicking the object thumbnail now opens a larger skip-object selector modal.
- Jobs with real object geometry can be selected from the enlarged bed map.
- Jobs without object geometry show a larger preview plus a clear printer-object-ID selector, so operators can match the ID shown on the printer screen.
- Shared the same exclusion confirmation flow between the list, inline map, and enlarged selector.
- Bumped static cache to `app.js?v=334` and `style.css?v=265`; frontend refresh required.

## What was improved - Session 28.216 (Object ID selector honesty - 7 June)
- Object exclusion no longer draws approximate ID buttons over the thumbnail when the 3MF lacks object geometry.
- No-geometry Bambu jobs now show the thumbnail as a preview and a separate `Printer object IDs` selector.
- Helper text now states that there are no bed positions in the 3MF and the operator must match the ID shown on the printer screen.
- Bumped static cache to `app.js?v=333` and `style.css?v=264`; frontend refresh required.

## What was fixed - Session 28.215 (Object panel empty state - 7 June)
- Object exclusion panel now shows an explicit no-metadata note instead of going blank when a Bambu print has no usable object metadata.
- Object map thumbnails no longer get a timestamp cache-buster on every refresh, preventing live-panel flashing.
- Object panel refresh now only rewrites the DOM when the rendered content actually changes.
- Bumped static cache to `app.js?v=332` and `style.css?v=263`; frontend refresh required.

## What was improved - Session 28.214 (Object exclude map simplification - 7 June)
- Simplified the object exclusion map after the first readability pass became too busy.
- Approximate object map markers now show only the slicer/printer ID over the thumbnail; labels stay in the list below.
- Added map-specific button styling so the generic red Exclude button style does not bleed into plate markers.
- Bumped static cache to `app.js?v=331` and `style.css?v=262`; frontend refresh required.

## What was improved - Session 28.213 (Object exclude ID readability - 7 June)
- Object exclusion maps now keep the plate thumbnail clearer and put the slicer/printer object ID in a larger, brighter overlay.
- Approximate Bambu/Orca object selectors now show the object label under the large ID where available.
- Object list rows now show the ID as a visible pill instead of tiny muted metadata.
- The helper text explains that Bambu/Orca object IDs can be high and should be matched to the printer screen.
- Bumped static cache to `app.js?v=330` and `style.css?v=261`; frontend refresh required.

## What was improved - Session 28.212 (Exclude object map fallback - 7 June)
- Bambu/Klipper Objects panel now presents no-geometry object IDs as an approximate plate selector instead of a loose chip pile.
- Exact object geometry still wins when the active 3MF exposes object bounding boxes.
- The approximate selector is labelled honestly and reminds operators to match the object ID shown on the printer screen.
- Exclude confirmation now includes the object label/ID and warns that Flightdeck cannot un-skip the object mid-print.
- Bumped static cache to `app.js?v=329` and `style.css?v=260`; frontend refresh required.

## What was added - Session 28.211 (Stock-in edit and clear - 7 June)
- Pending incoming stock rolls can now be edited before they become real spool records.
- Pending incoming stock rolls can be cleared/cancelled with a reason for damaged stock, wrong details, or bad scans.
- Received incoming rolls are locked from stock-in edits; use the normal spool edit path after receipt.
- Stock In list rows and on-screen sheets now show `Edit`, `Clear`, and `Receive` actions for pending rolls.
- Cleared rows remain visible as cancelled with their reason, so the receiving sheet still explains what happened.
- Bumped static cache to `app.js?v=326` and `style.css?v=256`; backend restart required for new edit/clear endpoints.

## What was added - Session 28.210 (On-screen stock-in sheets - 7 June)
- Stock In orders now have separate `Open sheet` and `Print / PDF` actions.
- Creating a receiving sheet opens an in-app sheet viewer instead of immediately launching print.
- The sheet viewer shows QR rows with roll number, colour swatch/name, weight, shelf, pending/received state, and receive links.
- The sheet viewer has `Print / Save PDF`, which uses the browser print dialog so operators can print paper or save as PDF.
- Bumped static cache to `app.js?v=325` and `style.css?v=255`; frontend refresh required.

## What was added - Session 28.209 (Mixed stock-in receiving sheets - 7 June)
- Stock In receiving sheets now support multiple roll-type lines in one batch.
- Each line carries its own quantity, material, brand, subtype/type, colour name/hex, label weight, tare, shelf, and notes.
- Added quick colour chips to the Stock In line editor for common colours.
- Bumped static cache to `app.js?v=324` and `style.css?v=254`; frontend refresh required.

## What was added - Session 28.208 (Stock-in QR receiving - 7 June)
- Added a Spools -> `Stock In` view for incoming filament receiving.
- Operators can create a receiving sheet from supplier/order, quantity, material, brand, subtype/type, colour name/hex, label weight, tare, shelf, and notes.
- Flightdeck creates pending incoming-roll tokens and prints a receiving sheet with QR codes.
- Scanning a receiving QR opens the pending roll, then `Receive and number spool` creates the real spool record, assigns the next spool number, and optionally prints the permanent spool label.
- Added backend stock-in tables/endpoints plus QR PNG generation:
  - `GET/POST /api/stock-in/orders`
  - `GET /api/stock-in/rolls/{token}`
  - `GET /api/stock-in/rolls/{token}/qr.png`
  - `POST /api/stock-in/rolls/{token}/receive`
- Bumped static cache to `app.js?v=323` and `style.css?v=253`; backend restart required.

## What was fixed - Session 28.207 (Printer Print Bay scroll fix - 7 June)
- Corrected the per-printer Print Bay scroll container so `.printer-bay-body` scrolls directly inside the printer detail flex layout.
- Removed the nested shell scroll attempt that could still be clipped by the parent view.
- Bumped static cache to `style.css?v=252`; frontend refresh only.

## What was fixed - Session 28.206 (Printer Print Bay scroll - 7 June)
- Per-printer Print Bay pages now keep their content inside a scrollable bay shell, so tall BigBoy/H2D storage and vault lists do not push the page layout out of view.
- Printer-local and vault file lists are capped a little lower inside the bay to keep the printer sub-tabs/header usable.
- Bumped static cache to `style.css?v=251`; frontend refresh only.

## What was added - Session 28.205 (Bambu live controls - 7 June)
- Bambu live pages now report separate fan speeds for Part, Aux, and Chamber fans.
- Added Bambu Part/Aux/Chamber fan controls with Off/50/100 buttons and fine sliders.
- Added guarded Bambu `Home All` on the live page using the existing confirmation prompt.
- The shared fan endpoint now accepts a `channel` (`part`, `aux`, or `chamber`) and routes commands to Moonraker or Bambu as appropriate.
- Bumped static cache to `app.js?v=322` and `style.css?v=250`; backend restart required.

## What was added - Session 28.204 (Klipper live control polish - 7 June)
- Added a fine fan slider beside the Moonraker/Klipper fan quick buttons; the command is sent when the slider change is committed.
- Added guarded homing buttons on Moonraker/Klipper live pages: `XY`, `Z`, and `All`.
- Homing opens a confirmation prompt and is disabled during printing, paused, finished, offline, error, and estop states.
- Added `POST /api/printers/{printer_id}/home` for Moonraker homing commands.
- Bumped static cache to `app.js?v=321` and `style.css?v=249`; backend restart required.

## What was added - Session 28.203 (Klipper live controls - 7 June)
- Added Moonraker/Klipper live fan controls on the printer live page: Off, 50%, and 100%.
- Added small Bed/Z jog controls on Moonraker/Klipper live pages: `Z -1` and `Z +1`.
- Live Moonraker status now includes reported part-cooling fan speed and toolhead position so the controls show current fan/Z context.
- Fan commands are blocked for offline/error/estop states; Z jog is additionally disabled during printing, paused, finished, error, estop, and offline states.
- Backend endpoints added: `POST /api/printers/{printer_id}/fan` and `POST /api/printers/{printer_id}/jog-z`.
- Bumped static cache to `app.js?v=320` and `style.css?v=248`; backend restart required.

## What was added - Session 28.199 (Windows bootstrap installer - 6 June)
- Added `Install-Flightdeck-Windows.cmd` at the repo root as the double-click Windows installer entry point.
- Added `scripts/windows/bootstrap-install.ps1` to unblock downloaded files, check Python/Git, install missing dependencies through `winget` when available, run the real installer, and start the tray app.
- Updated `install-windows.ps1` so the bootstrap can pass a discovered Python command such as `py -3`.
- Updated README and INSTALL with the double-click Windows install flow.

## What was added - Session 28.198 (Live AMS visual loadout - 6 June)
- Real Bambu live pages now use the graphical AMS loadout deck from the demo instead of the compact AMS pill rows.
- AMS slot editing still works by clicking a visual slot card.
- AMS drying controls were preserved inside the new visual AMS header.
- Bumped static cache to `app.js?v=301` and `style.css?v=237`; frontend refresh required.

## What was added - Session 28.197 (Colour name aliases - 6 June)
- Colour name entry now includes browser autocomplete suggestions for common colour names.
- Typing short aliases like `mag`, `blu`, `gre`, `sil`, or `rainbow` applies the matching colour name and swatch.
- Magenta maps to the existing pink/magenta swatch so Bambu-style `Magenta` labels can be corrected quickly when OCR misses the tiny colour text.
- Bumped static cache to `app.js?v=300` and `style.css?v=236`; frontend refresh required.

## What was added - Session 28.196 (Spool scan label swatch colour - 6 June)
- Spool OCR now falls back to photo colour detection when label text finds material/subtype but misses the colour name.
- The detector looks for a saturated swatch near white label pixels, aimed at Bambu-style coloured label dots.
- Colour detection only runs when OCR has not already applied a colour, keeping operator-entered colour choices intact.
- Bumped static cache to `app.js?v=299` and `style.css?v=235`; frontend refresh required.

## What was fixed - Session 28.195 (Spool OCR conservative apply - 6 June)
- OCR no longer creates or selects an `Unknown` brand when the label text is noisy.
- The scan result message now shows only the fields Flightdeck actually applied instead of raw OCR gibberish.
- Material-only OCR keeps the brand blank for operator confirmation unless the label confidently names a brand.
- Bumped static cache to `app.js?v=298` and `style.css?v=234`; frontend refresh required.

## What was added - Session 28.194 (Spool scan OCR stage 2 - 6 June)
- Spool scan now has a `Read label` step using browser-side OCR loaded on demand.
- OCR text is parsed into editable spool suggestions for common brand, material, subtype, and colour names.
- Camera/photo scans now attempt barcode first, then fall back to OCR when no barcode is detected.
- On phone-width layouts, the scan panel starts collapsed with an `Open` button so the Add Spool form stays usable.
- Bumped static cache to `app.js?v=297` and `style.css?v=233`; frontend refresh required.

## What was added - Session 28.193 (Spool scan stage 1 - 6 June)
- Add Spool now has a `Spool scan` panel inside the filament catalogue area.
- Stage 1 supports browser camera capture plus a photo-upload fallback for filament labels/boxes.
- Chromium barcode detection is used when available; detected barcodes populate the catalogue search and keep the final spool form editable before saving.
- Camera streams are stopped when the spool modal closes or saves, so the browser does not leave the camera session running.
- Bumped static cache to `app.js?v=296` and `style.css?v=232`; frontend refresh required.

## What was added - Session 28.192 (Dashboard add-printer CTA - 6 June)
- Dashboard now shows a first-run `Add Printer` panel when there are no configured printers.
- Dashboard printer cards now end with a dashed `+ Add Printer` card that links straight to Settings -> Printers.
- The add-printer card reminds operators to edit existing printers when only an IP changes, preserving printer history and metrics.
- Bumped static cache to `app.js?v=295` and `style.css?v=230`; frontend refresh required.

## What was added - Session 28.191 (Printer edit in settings - 6 June)
- Added a Settings -> Printers `Edit` action so connection details can change without changing the printer ID.
- Editing locks the printer ID field to preserve print history, metrics, maintenance, spool links, and queue identity.
- Added `PUT /api/config/printers/{printer_id}` to update runtime printer connections and persist the edited config.
- Bumped static cache to `app.js?v=294` and `style.css?v=229`; backend restart required for the edit endpoint.

## What was added - Session 28.190 (Windows tray install - 6 June)
- Added a per-user Windows install path with `scripts/windows/install-windows.ps1`.
- Added `scripts/windows/flightdeck-tray.py`, a `pythonw.exe` tray launcher that starts Uvicorn hidden, shows Flightdeck in the notification area, and provides Open Dashboard, Restart, Open Logs, Stop, and Exit actions.
- Windows live data defaults to `%LOCALAPPDATA%\Flightdeck`, with uploads, print vault, and logs kept outside the git checkout.
- Added `requirements-windows.txt` for the tray dependency and `scripts/windows/uninstall-windows.ps1` for removing the Startup shortcut/data.
- Setup Health now treats `FLIGHTDECK_RUNTIME=windows` / `Windows tray` as a managed runtime instead of expecting systemd.
- Updated README and INSTALL with the Windows tray install flow.
- Fixed the Windows shortcut creation path so PowerShell passes a plain string working directory to the `.lnk` writer.

## What was fixed - Session 28.189 (OrcaSlicer launcher guard - 6 June)
- Settings -> Slicer no longer opens a guessed `:3011` URL when no Orca Docker URL has been configured.
- The Orca launcher now stays disabled with `Set URL first` until the NAS/PC sidecar is actually running and its URL is saved.
- Bumped static cache to `app.js?v=293` and `style.css?v=228`; frontend refresh required.

## What was added - Session 28.188 (OrcaSlicer Docker sidecar - 6 June)
- Added an OrcaSlicer sidecar service to `docker-compose.nas.yml` using `lscr.io/linuxserver/orcaslicer:latest`.
- The sidecar publishes Orca on host HTTPS port `3011`, persists config in `/volume2/flightdeck-orcaslicer`, and mounts the Flightdeck print vault at `/prints`.
- Added `.env.nas.example` for Orca web UI auth and UID/GID settings.
- Settings -> Slicer now includes an `OrcaSlicer Docker` launcher and configurable Docker URL.
- Bumped static cache to `app.js?v=292` and `style.css?v=227`; backend restart required for the new default setting.

## What was updated - Session 28.187 (Dashboard lockout visibility - 6 June)
- Dashboard now treats printers with `Print enabled` unticked as attention items instead of ordinary idle printers.
- Printer cards show an amber `Dispatch locked` strip with the saved downtime reason, so H2D-style lockouts are visible from the fleet overview.
- Flight Briefing, Needs Attention, the top status warning, and Flight Tower all use the saved lockout note when explaining why the printer is down.
- Flight Tower dispatch scoring blocks locked printers from being recommended until the operator ticks `Print enabled` again.
- Bumped static cache to `app.js?v=291` and `style.css?v=226`; frontend refresh required.

## What was added - Session 28.186 (Bambu object map - 6 June)
- Bambu 3MF parsing now tries to pull object bounding boxes from `Metadata/plate_N.json` alongside the object IDs/names from `slice_info.config`.
- The live Objects panel now includes a Bambu-style plate map: tap an object overlay when geometry is available, or use large object-ID chips when the 3MF does not expose positions.
- The map uses the active plate thumbnail as visual context and keeps the same guarded exclude confirmation flow.
- Bumped static cache to `app.js?v=290` and `style.css?v=225`; backend restart required.

## What was updated - Session 28.185 (Unified object exclusion - 6 June)
- Bambu object skipping now presents like the Klipper exclude-object flow: one live Objects panel, object status, and a clear Exclude action per object.
- Backend object metadata now identifies whether the printer uses Klipper `EXCLUDE_OBJECT` or Bambu `skip_objects`, while the UI keeps the operator experience consistent.
- Object exclusions are logged for both Klipper and Bambu, and failed commands now show a useful toast instead of silently doing nothing.
- Bumped static cache to `app.js?v=289` and `style.css?v=224`; backend restart required.

## What was added - Session 28.184 (Simulated camera feeds - 6 June)
- Simulated printers now expose a generated camera endpoint through the normal printer camera API.
- The synthetic feed renders an animated printer scene with state, job name, progress, temperatures, material, and a belt-bed treatment for the IdeaFormer IR3 V2 simulator.
- No extra camera workers or image libraries are required; the feed is a lightweight SVG served from Flightdeck.

## What was added - Session 28.183 (Printer lockout reasons - 6 June)
- Unticking a printer's `Print enabled` checkbox now opens a reason note prompt.
- Disabled printers stay visible, but Queue/relay dispatch blocks include the saved reason so operators know why the printer is out of service.
- Live printer headers show an amber `Dispatch locked` note while the printer is disabled; ticking the printer back on clears the active lockout note.
- Bumped static cache to `app.js?v=288` and `style.css?v=223`; backend restart required for the new note field.

## What was fixed - Session 28.181 (Multi-colour spool deduction fix - 5 June)
- Fixed the Bambu multi-colour spool deduction path so it builds the persisted AMS slot snapshot before matching slicer colour/material usage to loaded spools.
- Root cause for the finished H2D Macaw print not deducting filament: Flightdeck had captured the correct print-start slots (#48 red, #76 green, #61 blue), but the multi-colour attribution branch referenced `slot_snapshot` before it existed and exited before writing `spool_usage`.
- Repaired H2D print #121 from scale readings: #48 red 348g -> 220g, #76 green 378g -> 304g, and #61 blue corrected upward from 38g -> 64g because its captured start value was bad tare/inventory data.
- Marked 85.31g as unallocated against the slicer total rather than charging it to the wrong roll; likely purge/waste, scale variance, or prior inventory drift.
- Corrected known bad tares after repair: Bambu Lab #61 from 230g -> 256g, eSun #76 from 140g -> 224g. Inkstation #48 remains at 128g until a trusted tare is provided.
- Improved Add/Edit Spool save failures so slot conflicts and server errors show a useful message instead of changing the submit button to plain `Error`.
- Fixed new spool creation after the multi-colour fields changed the spool insert shape: the insert listed 16 columns but still had only 15 placeholders, causing Add Spool to fail with a generic server error.
- Tightened AMS auto-claim/Profile Doctor matching so printer-reported Generic PLA no longer silently matches composite/specialty rolls such as PLA CF; added recent printer-slot memory from print-start AMS snapshots so the known prior roll (#48 PLA Silk Red) wins the H2D AMS 1 S1 auto-claim.
- Fixed Bambu multi-plate preview metadata so active jobs such as `/data/Metadata/plate_6.gcode` use `Metadata/plate_6.png` and the matching slice-info plate instead of always showing plate 1.
- Added explicit AMS profile sync feedback when moving or adding a spool into a Bambu AMS slot: Flightdeck now reports whether the printer confirmed the profile push.
- Bumped static cache to `app.js?v=260`; backend restart required for the structured add-spool conflict response, stricter AMS auto-claim rules, active Bambu plate metadata, and add/move AMS sync feedback.

## What was fixed - Session 28.180 (Finished job live-detail cleanup - 5 June)
- Live printer header, camera HUD, print details panel, dashboard active rows, and Flight Tower active-job labels now only treat jobs as active while printer state is `printing` or `paused`.
- Finished Bambu printers can still report a retained 100% job payload, but Flightdeck no longer shows it as an active Print Details card with stale thumbnail/detail context.
- Bumped static cache to `app.js?v=257`; frontend-only refresh required.

## What was fixed - Session 28.179 (Print Memory passport detail fix - 5 June)
- Fixed Print Memory passport detail rendering when another hidden printer-history detail container already exists on the page.
- Print Memory now renders into its own explicit detail target instead of relying on a duplicate `history-day-detail` id lookup.
- Bumped static cache to `app.js?v=256`; frontend-only refresh required.

## What was fixed - Session 28.178 (Stale nav progress badge fix - 5 June)
- Sidebar/top printer progress badges now only render for active `printing` or `paused` states.
- Finished/idle printers no longer show stale job progress such as H2D `91%` after a completed print.
- Bumped static cache to `app.js?v=255`; frontend-only refresh required.

## What was built - Session 28.177 (DYMO GPIO keep-awake hook - 5 June)
- Confirmed plain USB keep-awake pings do not stop the DYMO M10 from sleeping; USB stays present but weight reports stop.
- Added an optional GPIO units-button pulse path, enabled by `FLIGHTDECK_SCALE_UNITS_GPIO=<BCM pin>`, to support the Adafruit-style hardware mod.
- `/api/scale/status` and `/api/scale/keep-awake` now report the keep-awake method (`usb` or `gpioN`) and configured GPIO pin.
- Backend restart required after setting or changing GPIO env vars.

## What was built - Session 28.176 (DYMO scale keep-awake - 5 June)
- Added a background DYMO M10 scale keep-awake loop that pings the USB HID endpoint every 120 seconds by default.
- Added `POST /api/scale/keep-awake` for an immediate manual ping and extended `/api/scale/status` with keep-awake state.
- Kept this USB-only and non-blocking; a true units-button toggle still requires the DYMO hardware GPIO/button mod.
- Backend restart required.

## What was polished - Session 28.175 (Spool group card header polish - 5 June)
- Shortened grouped spool card header badges from `2 rolls · latest #...` to `2 rolls`, keeping full roll detail in the tooltip and chips below.
- Adjusted spool card header layout so colour names get first priority and avoid awkward word wrapping on narrow cards.
- Bumped static cache to `style.css?v=197`; frontend-only refresh required.

## What was built - Session 28.174 (Multi-colour spool selection - 5 June)
- Added persisted secondary and tertiary spool colour fields (`color_hex_2`, `color_hex_3`) so Dual, Gradient, Tri-colour, and Mixed schemes can represent the actual filament colours.
- The Add/Edit Spool modal now reveals second/third colour pickers only when the selected colour scheme needs them.
- Spool cards, cabinet/table swatches, live chips, detail bands, location rows, and draft previews render saved multi-colour schemes from the extra colour fields.
- Bumped static cache to `app.js?v=254`; backend restart required.

## What was built - Session 28.173 (Spool colour schemes - 5 June)
- Added spool `color_scheme` metadata with Add/Edit support for Solid, Dual, Tri-colour, Rainbow, Gradient, and Mixed.
- Spool cards, cabinet/table swatches, live loaded spool chips, location rows, detail headers, and the draft preview now render split/gradient/rainbow backgrounds from the saved scheme.
- Bumped static cache to `app.js?v=253`; backend restart required.

## What was built - Session 28.172 (Brand tare estimates - 5 June)
- Added a curated brand-level empty-spool/tare estimate table to the Add/Edit Spool modal, seeded from the operator-provided list plus public FilamIQ and Empty Spool Weight Catalog references.
- Saved material/brand tare values and catalogue-specific tare values still override the estimates; manual edits mark the field as `manual tare`.
- New material/brand rows created from the spool form persist the best available tare estimate.
- Bumped static cache to `app.js?v=252`; no backend restart required.

## What was polished - Session 28.171 (Auto-move visibility - 5 June)
- Made AMS auto-claim/auto-return decision trails easier to trust: future log rows include shelf/slot wording, and spool activity rows show clear badges such as `Matched automatically`, `Unique stored spool`, and `Home shelf return`.
- Bumped static cache to `app.js?v=251` and `style.css?v=196`; backend restart required.

## What was polished - Session 28.170 (Spool edit ID visibility - 5 June)
- Added the spool ID to the Add/Edit Spool modal title and draft preview so it is clear which spool is being edited.
- Bumped static cache to `app.js?v=250` and `style.css?v=195`; no backend restart required.

## What was fixed - Session 28.169 (Print Memory tag length - 5 June)
- Raised Print Memory custom tag storage from 40 to 96 characters and added a matching browser input limit so long tags are not silently cut off after save.
- Bumped static cache to `app.js?v=249`; backend restart required.

## What was built - Session 28.168 (AMS auto-load reconciliation - 5 June)
- Tightened the existing AMS auto-claim path so printer-reported slots can infer material from profile names such as `Generic PLA` when the direct material field is missing.
- The auto-load path remains conservative: only a unique high-confidence stored spool match is moved into the printer/slot; ambiguous or low-score candidates are ignored for manual review.
- Backend restart required.

## Next up - Tomorrow morning
- Validate auto-load reconciliation for spools physically inserted into a printer AMS/MMU.
- Desired behaviour: when a printer reports a newly loaded AMS slot, Flightdeck should find a high-confidence matching stored spool, move it from storage into the selected printer/slot, and keep its home shelf memory for return.
- Confidence rules should start conservative: auto-move only obvious unique matches, prompt/flag possible matches when colour/material/brand are ambiguous, and never guess between near-identical spools.
- Validate against the overnight H2D print: final state, spool deduction, AMS generic-profile tolerance, notifications, and Print Memory scoring/exclusion.

## What was fixed - Session 28.166 (Spool detail breadcrumb - 5 June)
- Fixed the Spool detail page breadcrumb so `Spools` returns to the current inventory route (`#/spools`) instead of the old Settings route.
- Bumped static cache to `app.js?v=248`; no backend restart required.

## What was fixed - Session 28.165 (Generic AMS profile tolerance - 5 June)
- Fixed AMS/Profile Doctor mismatch logic so printer-reported generic profiles such as `Generic PLA` do not count as a mismatch when Flightdeck has a trusted, material/colour-compatible branded spool such as eSun PLA+ Peak Green.
- Applied the same tolerance to backend queue/preflight mismatch checks so generic printer profile names do not block a job after the operator trusts Flightdeck.
- Bumped static cache to `app.js?v=247`; backend restart required.

## What was built - Session 28.164 (Print Memory scorecard - 5 June)
- Added the Stage 3 Print Memory score layer with `/api/print-memory-score`.
- Reliability score counts trusted real attempts only: `FINISHED` vs `ERROR`/`ESTOP`; `CANCELLED` is visible but neutral, and `exclude_from_stats` rows are ignored.
- Print Memory now shows a compact score panel with fleet score, trusted attempt count, excluded count, per-printer scores, ETA error where available, and top material score chips.
- The score panel follows the Memory `days` filter while remaining independent of state/tag/search filters so browsing does not distort reliability.
- Bumped static cache to `app.js?v=246` and `style.css?v=194`; backend restart required.

## What was built - Session 28.163 (Print Memory tags - 4 June)
- Added Stage 2 Print Memory operator metadata: per-print tags and an `Exclude from reliability stats` flag.
- Print Memory rows now show tag/no-stats pills, and the filter toolbar includes a tag filter.
- Print passports now include a Memory Tags section with preset tags (`Flightdeck testing`, `Calibration`, `Prototype`, `Customer job`, `Maintenance`, `First layer`), custom comma-separated tags, and the stats-exclusion toggle.
- Added `PATCH /api/print-memory/{print_id}` plus SQLite migrations for `prints.tags` and `prints.exclude_from_stats`.
- Escaped print note display while touching the shared history/passport detail renderer.
- Bumped static cache to `app.js?v=245` and `style.css?v=193`; backend restart required.

## What was fixed - Session 28.162 (Print Memory render guard - 4 June)
- Stopped Print Memory from rerendering on every fleet refresh while the route and filters are unchanged.
- This removes the visible flashing/flicker while staying on `#/memory` or filtered memory routes.
- Bumped static cache to `app.js?v=244`; no backend restart required.

## What was built - Session 28.161 (Print Memory v1 - 4 June)
- Added a fleet-level Print Memory page under Operations as the first cross-printer print passport surface.
- Added `/api/print-memory` and `/api/print-memory/{print_id}` endpoints over existing history, notes, snapshots, spool usage, and estimate/actual print data.
- Print Memory starts as a searchable/filterable fleet list with clickable rows that open a print passport detail.
- Bumped static cache to `app.js?v=243` and `style.css?v=192`; backend restart required.

## What was polished - Session 28.160 (Sidebar printer picker - 4 June)
- Changed the left sidebar printer section into a compact printer picker instead of expanding every printer into Live/Print Bay/History/Failures/Maintenance links.
- Printer rows now show a status dot, printer label, and active-print progress where available.
- The selected printer stays highlighted across all top printer sub-tabs; task navigation remains in the existing horizontal printer tab bar.
- Bumped static cache to `app.js?v=242` and `style.css?v=191`.

## What was polished - Session 28.159 (Simulator notification polish - 4 June)
- Simulated printer state-change notifications now stay inside Flightdeck with a `SIM` title prefix.
- External ntfy alerts are skipped for simulated printer complete/error/paused/cancelled transitions so phone alerts remain reserved for real hardware.
- Real printer notification behaviour is unchanged.

## What was built - Session 28.158 (Compatibility simulator - 4 June)
- Added a `simulated` printer connection type with PrusaLink, RepRapFirmware, and OctoPrint profiles plus idle/printing/paused/error/mixed scenarios.
- Simulated printers now flow through the normal printer gather/websocket/status card path with synthetic temps, jobs, care items, idle info, and preview thumbnails.
- Settings can add/remove simulated printers without editing YAML.
- Hardware controls, temperature commands, and queue uploads intentionally reject simulated printers for now so the simulator cannot masquerade as real hardware.
- Bumped static cache to `app.js?v=241`; backend restart required.

## What was built - Session 28.157 (History heatmap ranges - 4 June)
- Added a compact History heatmap range selector with Week, Month, and Year views.
- Kept Year as the default existing daily heatmap; Week and Month summarize from the same per-day history calendar data.
- Weekly/monthly summary tiles open the busiest day in that range so the existing day/detail drill-in remains the only print detail surface.
- Bumped static cache versions to `app.js?v=240` and `style.css?v=190`.

## What was reverted - Session 28.156 (History gallery removed - 4 June)
- Removed the History thumbnail gallery after live review; the History tab is back to year nav, heatmap, and day/detail drill-in only.
- Removed the `/api/printers/{printer_id}/history/gallery` endpoint and gallery-only frontend/CSS.
- Bumped static cache versions to `app.js?v=239` and `style.css?v=189`.
- Keep future history work focused on the existing heatmap/day/detail surface unless the gallery is explicitly re-requested.

## What was built - Session 28.155 (History thumbnail gallery - 4 June)
- Added a per-printer History gallery endpoint, `/api/printers/{printer_id}/history/gallery`, returning recent print rows for the selected year.
- Added a `Recent print snapshots` gallery below the History heatmap, using captured print snapshots when available and compact state tiles otherwise.
- Gallery cards open the existing History print detail below the gallery, preserving notes, spool usage, and decision trail as the single detail surface.
- Restored the original gallery-first layout after the above-gallery detail treatment felt too jumpy in use.
- Bumped static cache versions to `app.js?v=238` and `style.css?v=188`.
- Verified live H2D gallery data: 36 items with 13 snapshots; gallery card click opened `can_openerV2` detail with notes and decision trail visible.

## What was fixed - Session 28.154 (Bambu Print Bay scoped file loading - 4 June)
- Diagnosed X1C/H2D Print Bay slowness to printer-specific bay tabs fetching the full fleet `/api/files` payload.
- Confirmed Bambu FTPS SD listings were fast (~0.17s each); the delay was the offline Voron/Moonraker file source taking about 3s inside the fleet endpoint.
- Added optional `printer_id` scoping to `/api/files` so printer-specific Print Bay tabs fetch only the relevant printer storage plus Print Vault.
- Updated printer Print Bay UI to call `/api/files?printer_id={id}` and bumped the app cache to `app.js?v=233`.
- Parallelized fleet file source reads and tightened Moonraker file-list connect timeout so Global Print Bay is less affected by an offline Voron.
- Verified live timings: X1C scoped `/api/files` ~0.16-0.18s, H2D scoped ~0.16-0.19s, global `/api/files` ~1.01s instead of ~3.4s.

## What was polished - Session 28.153 (Decision trail repeat folding - 4 June)
- Collapsed exact repeated print decision trail rows into one API row with `repeat_count`, preserving first/last timestamps so restart/poll noise remains auditable without dominating History.
- Updated the History decision trail UI to show compact repeat chips such as `x11` and the last repeat time.
- Escaped decision event/detail text while touching the renderer.
- Bumped static cache versions to `app.js?v=232` and `style.css?v=185`.
- Verified live Voron print `#94` (`Cube_ABS_1h14m.gcode`) now returns 6 decision rows instead of the long repeated trail: `calibration_captured x12`, `job_reattached x11`, `spool_missing x11`, plus the real start/cancel rows.

## What was fixed - Session 28.152 (Flight Tower printer snapshot cache - 4 June)
- Diagnosed Flight Tower sluggishness to `/api/printers`, which was taking about 3.1s because every request forced a fresh hardware gather even though the background broadcast loop already polls printers every 5s.
- Added a recent printer snapshot cache for `/api/printers` so normal UI reads return the latest known state instantly when it is fresh, while still falling back to a live gather if the cache is empty/stale.
- Added a gather lock so overlapping printer polls do not stack up and make the Pi work harder than needed.
- Backend restart required before this takes effect.

## What was fixed - Session 28.151 (Spool activity exact match fix - 4 June)
- Fixed spool detail activity rows so `Spool #1` no longer also matches `Spool #17`, `Spool #18`, `Spool #19`, etc.
- The AMS / Shelf Activity panel now filters decision rows by exact spool number before returning them to the UI.

## What was polished - Session 28.150 (Spool card detail navigation - 4 June)
- Made single-spool cards in Cards view open the spool detail page when the non-control card surface is clicked.
- Kept Label/Edit/Actions buttons and multiple-roll chip links independent so operators do not accidentally leave the page while using controls.
- Added a subtle hover cue to clickable spool cards.
- Bumped static cache versions to `app.js?v=231` and `style.css?v=184`; no service restart is needed for this static-only pass.

## What was polished - Session 28.149 (Add spool catalogue flow polish - 4 June)
- Added a live spool draft preview inside the Add/Edit Spool modal so catalogue selections, colour, location, and weight are visible before saving.
- Split the modal form into clearer identity, weight, and location sections so adding a spool feels guided without becoming a wizard.
- Reworded catalogue confirmation copy to say the match has been applied and remains editable before save.
- Added a late mobile override for the modal so the new preview and section layout stack cleanly on narrow screens.
- Bumped static cache versions to `app.js?v=230` and `style.css?v=183`; no service restart is needed for this static-only pass.

## What was polished - Session 28.148 (Spool header/search layout polish - 4 June)
- Rebalanced the Spools page after the toolbar merge: the top row now keeps `Spool Inventory`, a long search box, and `+ Add Spool`.
- Moved Cards/Table/Cabinet/Filament catalogue plus quick filters and material/brand selectors below Spool Intelligence so the page reads as overview first, controls second, spools third.
- Kept the previous Spools flash fix in place.
- Bumped static cache versions to `app.js?v=229` and `style.css?v=182`; no service restart is needed for this static-only pass.

## What was polished - Session 28.147 (Spool toolbar merge + flash fix - 4 June)
- Merged the Spools view buttons, quick filter chips, material/brand filters, search box, and Add Spool button into one desktop toolbar above the Spool Intelligence/catalogue area.
- Kept the toolbar responsive so it can wrap on narrow screens without breaking the spool card/cabinet layout.
- Fixed the Spools flashing regression by only doing a full Spools rerender when entering Spools or when the Spools hash/sub-view changes, rather than on every app refresh pass.
- Updated Spools view buttons to keep the hash in step with Cards/Table/Cabinet/Filament catalogue without forcing an unnecessary full repaint.
- Bumped static cache versions to `app.js?v=228` and `style.css?v=181`; no service restart is needed for this static-only pass.

## What was polished - Session 28.146 (Spool catalogue toolbar tidy - 4 June)
- Removed the duplicate blue `Filament catalogue` link from the Spool Intelligence panel so the spool screen has one clean top control row.
- Renamed the top spool view control from `Catalogue` to `Filament catalogue`, keeping it alongside Cards/Table/Cabinet, filters, search, and Add Spool.
- Fixed same-page spool catalogue navigation so links to `#/spools?view=catalogue` rerender the Spools surface even when the user is already on the Spools screen.
- Bumped the app static cache to `app.js?v=227`; no service restart is needed for this static-only pass.

## What was polished - Session 28.145 (Telemetry filament trend polish - 4 June)
- Confirmed live filament telemetry is already recording deductions: `/api/filament/summary` reports 110.4 g total usage, split across ASA and PLA, all currently in one month.
- Updated the Telemetry filament trend panel so early single-month history explains itself instead of looking empty or broken.
- Added gram labels to month bars so the user can see actual usage even before multiple months build a visible trend shape.
- Bumped static cache versions to `app.js?v=226` and `style.css?v=180`; no service restart is needed for this static-only pass.

## What was polished - Session 28.144 (Demo breadcrumb docs - 4 June)
- Updated the install guide so new testers know they can open either **System -> Demo Mode** or the standalone `/demo` page before touching live printer controls.
- Updated the public website tester path to mention the standalone `/demo` page alongside Demo Mode, Setup Health, and the first-printer walkthrough.

## What was polished - Session 28.143 (Standalone demo realism - 4 June)
- Cut a real Voron camera frame from the all-cameras screenshot and added it as `app/static/demo-assets/voron-camera.png`.
- Wired the standalone demo camera data so H2D, X1C, and Voron all show real Flightdeck-style camera imagery instead of the generated blue placeholder.
- Changed the demo Voron state back to an online/idle cross-ecosystem example so the demo fleet better shows Bambu + Voron together.
- Updated demo host/camera-worker telemetry so the Telemetry page has believable demo data instead of looking empty.
- Routed demo printer/queue preview media to the real can-opener preview asset and bumped demo/static cache versions to `demo-runtime.js?v=4` and `app.js?v=225`.

## What was polished - Session 28.142 (Easy install + public repo cleanup - 4 June)
- Reworded the install path around the public promise: Flightdeck install is easy as 1-2-3: install, add printers, add spools.
- Added practical Pi sizing guidance: Pi 5 4 GB for small fleets, Pi 5 8 GB as the recommended default beyond 5 printers, Pi 5 16 GB for 10+ printers/camera-heavy rooms, and Pi 4 as a light-install fallback rather than the main target.
- Added a one-command Raspberry Pi installer entry point, `scripts/install-pi.sh`, so layman installs can start with a single copy/paste command.
- Updated README and GitHub Pages install wording so the public page, repo, and install guide all lead with UI setup instead of YAML editing.
- Removed tracked legacy profile backup artifacts from the public repo and ignored `kprofiles/` so clean clones do not expose private/old profile exports.
- Renamed the default MQTT topic prefix in tracked app settings from the old external-project value to `flightdeck`.

## What was polished - Session 28.141 (Tester path polish - 4 June)
- Tightened the public GitHub Pages landing page so the primary action opens the plain-English install guide, with a secondary GitHub link and contact CTA.
- Added a `Tester path` section to the public page explaining the safe first-run flow: Demo Mode, Setup Health, one printer, then read-only screens before queue/hardware actions.
- Added the same first-tester checklist to `INSTALL.md` so a layman install has a clear route through Demo Mode, Setup Health, printer setup, and cautious control testing.
- Added a `First Tester Path` section to the in-app Flight Manual so the live app, install docs, and public website all tell the same story.
- Bumped the app static cache to `app.js?v=224`; no service restart is needed for this static/manual/docs pass.

## What was polished - Session 28.140 (Setup readiness + spool return polish - 4 June)
- Expanded Setup Health into a first-run readiness summary covering fleet config, data path, camera workers, optional scale/QL-700, access URL, and backup/vault status.
- Wired Setup Health to the same live printer, scale, and label-printer status used elsewhere so the ready summary reflects the actual bench.
- Added clearer "ready for real use / preflight checks needed" wording so missing optional hardware does not look like a blocked install.
- Added home-shelf memory guidance to spool detail pages and AMS Profile Doctor, making auto-return/default return behaviour visible at the point of use.
- Updated the Flight Manual with the spool return/RFID auto-claim workflow.
- Bumped static cache versions to `app.js?v=223` and `style.css?v=179`; no service restart is needed for this static-only pass.

## What was polished - Session 28.139 (Warning target + manual polish - 3 June)
- Kept warning rows visually clean while preserving click-through guidance: dashboard briefing rows and Needs Attention rows now carry the same target metadata/title text as the top warning pill.
- Added a `Warnings And Attention` section to the Flight Manual explaining the orange/red pill, Flight Briefing rows, AMS Profile Doctor targets, Clear skies, and failed-vs-cancelled handling.
- Bumped the static cache to `app.js?v=222`; no service restart is needed for this static-only pass.

## What was fixed - Session 28.138 (Dashboard briefing mobile polish - 3 June)
- Tightened the new `Flight Briefing` dashboard panel on narrow/mobile widths so briefing rows stack cleanly instead of pushing the action label off-screen.
- Moved the responsive briefing rules after the base briefing styles so the mobile layout actually wins in the final cascade.
- Bumped static cache versions to `app.js?v=221` and `style.css?v=178`.

## What was polished - Session 28.137 (Dashboard flight briefing - 3 June)
- Added a `Flight Briefing` handover panel at the top of the dashboard so the first view now summarises what needs operator eyes before the printer cards.
- The briefing uses existing Flightdeck state only: printer faults/offline/paused states, actionable health warnings, AMS profile warnings, active prints, and loaded low-spool risk.
- Briefing rows link directly to the relevant printer, spool, Flight Tower, or exact AMS slot/Profile Doctor when Flightdeck knows the warning source.
- Added a calm `Clear skies` state when there are no active warnings or loaded spool risks.
- Bumped static cache versions to `app.js?v=220` and `style.css?v=177`.

## What was polished - Session 28.136 (Spool activity trace polish - 3 June)
- Extended `/api/spools/{id}/trace` so spool detail pages include matching spool activity from the Flightdeck decision log.
- Added an `AMS / Shelf Activity` timeline to spool detail pages showing moves, auto-returns, auto-claims, printer-trust updates, and warning events for that spool.
- Styled the activity timeline with clear event labels and colour-coded dots so a spool's shelf/AMS story is readable without digging through logs.
- Bumped static cache versions to `app.js?v=219` and `style.css?v=176`.

## What was polished - Session 28.135 (AMS spool doctor polish - 3 June)
- Reworked the AMS slot modal so it clearly separates the printer's reported slot state from Flightdeck's assigned spool.
- Added a best stored-spool suggestion card above the search list, using the same assignment path as the normal spool picker.
- Split current-slot actions into everyday controls (`Details`, `Load/Unload`, `Label`, `Weigh`) and correction controls (`Trust Flightdeck`, `Trust Printer`, `Return spool`) so mismatch repair is easier for a layman to follow.
- Widened the modal and added responsive layouts so the Profile Doctor stays readable on desktop and mobile.
- Bumped static cache versions to `app.js?v=218` and `style.css?v=175`.

## What was fixed - Session 28.134 (Bambu RFID spool auto-claim - 3 June)
- Added Bambu reported-loaded slot reconciliation so if the printer reports an RFID/profile-family spool in an empty Flightdeck AMS slot, Flightdeck can auto-claim the matching shelved spool.
- The auto-claim scorer prefers confident material/profile-family matches, Bambu Lab + subtype matches such as `PLA Basic`, close colour, and enough remaining weight, so old near-empty catalogue ghosts do not win just because their colour is exact.
- Repaired the current H2D AMS 1 S3 case by moving spool `#71` from Shelf #1 into the reported printer slot while leaving old spool `#28` shelved.
- Kept the warning pill behaviour unchanged: the current top warning is valid when Voron is offline and real failed-print count warnings exist.

## What was fixed - Session 28.133 (AMS ghost-spool cleanup + clickable warnings - 3 June)
- Added Bambu empty-slot reconciliation so if the printer reports an AMS/HT slot empty, Flightdeck automatically returns any stale assigned spool to its home shelf, falling back to the first active shelf if the spool predates home-shelf memory.
- Repaired the current ghost assignment by returning spool `#28` from H2D AMS 1 S3 to Shelf #1; the actual loaded state should remain `#3` in AMS1 S1, `#31` in AMS1 S2, and `#2` in AMS HT.
- Made AMS mismatch warnings click-through controls: dashboard attention rows, Flight Tower warning chips, and the top warning pill can now open the exact AMS slot/Profile Doctor when Flightdeck knows the warning source.
- The header warning pill now counts actionable health/AMS warnings, not just paused/offline printer states.
- Bumped static cache versions to `app.js?v=217` and `style.css?v=174`.

## What was fixed - Session 28.132 (H2D AMS-test cancellations repaired - 3 June)
- Reclassified the known H2D AMS mismatch test stops from `ERROR` to `CANCELLED` so they no longer cry wolf on the dashboard.
- Added an audit note before each repair so the original printer error text is still traceable in the decision trail.
- Tightened Bambu cancel handling so a user-requested cancel that lands in Bambu's retained `FAILED` state resolves as `CANCELLED`, not a reliability failure.
- Repaired the one X1C history row that explicitly said it was cancelled, while leaving real/suspicious X1C error-code rows visible for review.

## What was fixed - Session 28.131 (Operator cancels separated from failures - 3 June)
- Stopped operator-cancelled prints from counting as reliability failures or dashboard Needs Attention causes.
- Kept `CANCELLED` prints visible in normal history, while Failure Review now focuses on real failure states (`ERROR` / `ESTOP`).
- Added a separate cancelled-print counter in usage summaries so cancellations remain reportable without skewing failure metrics.
- Changed health wording from "failed/cancelled" to "failed" so printer cards read honestly.

## What was built - Session 28.130 (Spool home shelf memory + installer guide - 3 June)
- Added spool home-shelf memory with `home_storage_location_id`, so a spool loaded from a shelf can automatically return to that shelf when cleared from an AMS/MMU slot.
- Updated spool moves so manually returning a spool to a different shelf teaches Flightdeck the new home location.
- Updated the AMS slot modal to default to `Return home (Shelf #x)` while still allowing an explicit shelf override.
- Added a plain-English `INSTALL.md` for Raspberry Pi testers and linked it from the README.
- Bumped the app cache to `app.js?v=215` so the AMS modal update is picked up immediately.

## What was polished - Session 28.129 (Public website fleet screenshot polish - 3 June)
- Expanded the public website fleet camera screenshot into a full-width showcase so Voron, X1C, and H2D all remain visible.
- Changed the fleet camera image rendering from cropped cover mode to contained display for the cross-ecosystem screenshot.
- Updated the caption to call out the live cross-ecosystem view.

## What was polished - Session 28.128 (Public website positioning polish - 2 June)
- Added the Flightdeck logo mark above the hero title on the public website.
- Reworded the public website positioning from "built for the room" into clearer mixed-fleet printer-room language.
- Changed the status band to say Flightdeck is tested and proven on Bambu + Voron.
- Added mobile-ready positioning for phone/tablet checks away from the desk.
- Added a real all-three-camera screenshot with Voron, X1C, and H2D online.
- Added a tester callout for other printer ecosystems such as Prusa, Qidi, Creality, and RatRig.

## What was built - Session 28.127 (Public website first pass - 2 June)
- Added a GitHub Pages-ready public website under `docs/`.
- Built a Flightdeck-branded landing page with real screenshots for the live printer screen, camera wall, spool inventory, and print details.
- Added public positioning for Flightdeck as a self-hosted, LAN-first mixed Bambu/Voron/Klipper fleet dashboard.
- Included GitHub, install, roadmap, and `flightdeck3dprinters@gmail.com` contact calls to action.
- Added `docs/.nojekyll` and a README pointer so GitHub Pages can serve the site from `/docs` on `main`.

## What was fixed - Session 28.126 (Demo authenticity pass - 2 June)
- Replaced the generated demo print thumbnail with a real can-opener preview capture for H2D.
- Set the demo H2D job to 0% / layer 0 of 530 with the authentic 4h25/4h26 ETA treatment so Print Details matches the real first-pass job screen.
- Expanded the demo print-object list to the seven can-opener STL objects shown in the real UI.
- Removed the generated Greyhound camera placeholder by putting the demo Voron into the native Flightdeck offline state.
- Added a demo fetch fallback and corrected demo failure/usage payload shapes so Telemetry renders in demo mode.
- Bumped demo app cache loading to `app.js?v=214` so demo media changes are picked up immediately.

## What was polished - Session 28.125 (Demo camera captures - 2 June)
- Added real H2D and X1C camera captures as static demo assets so `/demo` looks like the actual Flightdeck live surfaces without starting camera workers.
- Demo camera endpoints now return those static captures for H2D and X1C, with the generated placeholder kept as a fallback for future demo printers.
- Set the demo H2D state to paused so the live page showcases Flightdeck's guarded pause/resume/cancel controls and alert surface.
- Kept the Voron offline state rendered by Flightdeck UI rather than embedding an offline screenshot inside the feed.
- Bumped the demo runtime cache version to `demo-runtime.js?v=2`.

## What was rebuilt - Session 28.124 (True Flightdeck demo mode - 2 June)
- Replaced the first-pass standalone promo demo with the real Flightdeck interface served in demo mode.
- `/demo` now loads the normal Flightdeck shell and `app.js` with a demo runtime that mocks API and WebSocket data.
- Demo controls simulate command feedback locally and do not call live printer, scale, label, camera, queue, or file endpoints.
- Demo media uses generated Flightdeck preview/camera placeholders so no camera workers or printer media routes are started.
- Bumped static cache versions to `app.js?v=213` and `style.css?v=173`.

## What was built - Session 28.123 (Standalone demo mode - 2 June)
- Added a standalone `/demo` page for prospects/testers to try Flightdeck without connecting to live printer APIs.
- Built the standalone demo with simulated fleet cards, live printer controls, filament route, spools, Print Bay, maintenance, alerts, and activity log.
- Demo commands now respond locally with simulated feedback while real printer commands stay disabled.
- Added README notes explaining when to use `/demo` versus the in-app Flightdeck walkthrough.

## What was polished - Session 28.122 (Manual demo shortcut - 2 June)
- Added a direct Demo Mode button to the Flight Manual hero so testers can jump from the handbook into the guided walkthrough.
- Bumped static cache versions to `app.js?v=212` and `style.css?v=172`.

## What was documented - Session 28.121 (Demo docs - 2 June)
- Added a README Demo Mode section under Flight Manual.
- Documented the recommended demo flow: Dashboard, Flight Tower, Live printer, Spools, Global Print Bay, then Maintenance.
- Added a short reminder to avoid destructive controls during casual walkthroughs.

## What was built - Session 28.120 (Demo fleet cards - 2 June)
- Added Live Fleet Picks to Demo Mode so each configured printer has a compact state card with Live, Bay, and Failures shortcuts.
- Demo Mode now surfaces attention context such as offline/fault state, recent failures, and loaded spool count before opening a printer page.
- Expanded demo readiness metrics with an Attention tile and bumped static cache to `app.js?v=211` and `style.css?v=171`.

## What was built - Session 28.119 (Demo Mode first pass - 2 June)
- Added a dedicated System > Demo Mode page for a safe first-look Flightdeck walkthrough.
- Demo Mode now shows live demo readiness across fleet count, host/runtime, setup health, and camera-worker state.
- Added a guided tour path covering Dashboard, Flight Tower, Live Printer, Spools, Global Print Bay, and Maintenance.
- Added demo talk-track notes and a "Do Not Demo First" guardrail list to keep walkthroughs focused and low-risk.
- Added Demo Mode to the sidebar and command palette, with static cache bumped to `app.js?v=210` and `style.css?v=170`.

## What was fixed - Session 28.118 (Flight Manual render guard - 2 June)
- Stopped the Flight Manual from rebuilding on every printer refresh tick, which was causing the page to flash while live updates arrived.
- Bumped the static cache version so browsers pick up the guarded manual route immediately.

## What was built - Session 28.117 (Flight Manual first pass - 2 June)
- Added a first-class Flight Manual page under System for demo readiness, daily flow, Bambu multi-colour rules, spool/label notes, recovery steps, maintenance notes, and tester guidance.
- Added live demo-readiness checks on the manual page using setup health, instance health, printer count, memory, disk, and camera worker status.
- Added Flight Manual to the sidebar and command palette so it is easy to find during testing.

## What was built - Session 28.116 (System health telemetry - 1 June)
- Expanded `/api/instance` with host load, memory, and data-disk usage so Flightdeck can surface Pi/NAS pressure without another diagnostic tool.
- Added a Telemetry “System Health” panel for runtime host, CPU load, RAM, data disk, and Bambu camera worker count.
- Kept camera-worker state visible in Telemetry as an early warning if live feeds ever start overworking the Pi again.

## What was built - Session 28.115 (Camera worker guardrails - 1 June)
- Added camera worker diagnostics to `/api/instance` and Settings > Setup health so runaway Bambu `ffmpeg` workers are visible before they overload the Pi.
- Added `scripts/clear-camera-workers.sh` to reset only Bambu camera transcoders without restarting Flightdeck.
- Documented the camera-only recovery script in the README.

## What was built - Session 28.114 (Runtime footer label - 1 June)
- Added `/api/instance` so Flightdeck reports its local address, runtime, and detected hardware label.
- Dashboard footer now shows the detected host, e.g. `flightdeck · 192.168.4.127 · running on Pi 5 8GB`, instead of a hardcoded Pi IP.
- Raspberry Pi installs auto-detect model and memory from `/proc/device-tree/model` and `/proc/meminfo`; NAS/Docker installs can override the label with `FLIGHTDECK_INSTANCE_NAME`.
- Documented optional `.env` overrides for footer address and instance label.
- Added a camera proxy start lock so multiple browser image requests cannot race and spawn duplicate Bambu `ffmpeg` workers.
- Reduced proxied Bambu camera output to a Pi-friendlier stream size and frame rate to keep the live UI from overwhelming the 4GB Pi.

## What was built - Session 28.113 (NAS USB hardware passthrough - 1 June)
- Added `usbutils` to the NAS Docker image so hardware detection can run `lsusb` inside the container.
- Passed `/dev/bus/usb` and `/dev/hidraw0` through the NAS compose file for the Brother QL-700 and Dymo scale.
- Documented NAS Docker hardware passthrough for optional scale and label-printer support.

## What was built - Session 28.112 (NAS Docker service health polish - 1 June)
- Made the setup health check Docker-aware so NAS/Portainer installs no longer show a missing `systemctl` warning.
- Added NAS compose environment labels for `FLIGHTDECK_RUNTIME`, `FLIGHTDECK_SERVICE_MANAGER`, and `FLIGHTDECK_INSTANCE_NAME`.
- Docker installs now report the service as Docker / Portainer managed while Pi installs keep the normal systemd check.
- Docker-managed service health now shows as a green OK state instead of optional.

## What was built - Session 28.111 (NAS staging restore prep - 1 June)
- Moved the NAS Docker preview host port to `8010` so it does not collide with Portainer/ASUSTOR services already listening on `8000`.
- Documented the NAS preview URL/port expectation before the first Portainer stack test.
- Staged the latest Pi backup archive for restore into `/volume2/flightdeck-data` on the ASUSTOR NAS.

## What was built - Session 28.110 (NAS Docker staging - 1 June)
- Added a NAS-ready `Dockerfile` for running Flightdeck in a Python 3.13 container with FFmpeg and USB support libraries available.
- Added `.dockerignore` so live databases, secrets, print vaults, backups, caches, and virtual environments are not copied into Docker builds.
- Added `docker-compose.nas.yml` mapping the ASUSTOR SSD paths: `/volume2/flightdeck-data`, `/volume3/flightdeck-vault`, and `/volume3/flightdeck-backups`.
- Documented the NAS/Portainer preview deployment while keeping the Pi as the live host until the container is tested.

## What was built - Session 28.109 (Backup and restore foundation - 1 June)
- Added `scripts/backup-flightdeck-data.sh` for private recovery archives of Flightdeck live data.
- Added `scripts/restore-flightdeck-data.sh` with a typed confirmation and automatic safety copy before overwriting live data.
- Documented the private GitHub backup repo workflow and optional NAS staging copy for `/volume3/flightdeck-backups/pi-imports`.
- The default backup excludes `.env`, SSH keys, caches, and the large print vault unless `INCLUDE_PRINT_LIBRARY=1` is set.
- Adjusted backup checksum files to use relative archive names so NAS-staged copies can be verified in place.

## What was built - Session 28.108 (Security cameras removed - 1 June)
- Removed the experimental Security Cameras watchtower screen to reduce Pi memory and camera-stream load.
- Kept the normal Cameras page in place for manual monitoring.
- Removed the route, navigation entry, view container, renderer, and security-camera CSS.
- Static cache-bust bumped to `app.js?v=205` and `style.css?v=166`.

## What was built - Session 28.107 (Security camera rollback - 1 June)
- Reverted the anti-flash render guard because it caused black camera screens in live use.
- Restored the Security Cameras page to the first-pass watchtower behavior while we design a safer no-flash implementation.
- Static cache-bust bumped to `app.js?v=204`.

## What was built - Session 28.105 (Security Cameras first pass - 1 June)
- Added a dedicated Operations > Security Cameras screen with a rotating spotlight that cycles printer feeds every 5 seconds.
- Added alert-lock behavior so printer faults, emergency stops, and faulted pauses pin the spotlight to the affected printer.
- Added camera thumbnails, status context, offline cards, and a zoom toggle for closer inspection.
- Static cache-bust bumped to `app.js?v=202` and `style.css?v=165`.

## What was built - Session 28.104 (Camera nav convenience - 1 June)
- Moved the printer camera wall up directly under Dashboard in the left navigation for faster daily access.
- Kept Operations focused on queue and global print bay work, leaving room for a future separate Security Cameras screen.
- Static cache-bust bumped to `app.js?v=201`.

## What was built - Session 28.103 (Faster Bambu offline timeout - 1 June)
- Reduced Bambu MQTT stale detection from 150 seconds to 45 seconds so powered-off printers leave `IDLE` faster while still avoiding brief LAN/MQTT flaps.

## What was built - Session 28.102 (Camera tile live refresh fix - 1 June)
- Fixed the All Cameras refresh path so tile bodies update when printers move between offline and online, not just the header badge.
- Split camera tile feed rendering into a reusable helper and reattached retry handlers after feed swaps.
- Fixed a duplicate camera endpoint JSON read and bumped `app.js?v=200`.

## What was built - Session 28.101 (Camera offline tile polish - 1 June)
- Reused the Live page signal-lost treatment in the All Cameras view.
- Offline and unconfigured camera tiles now show the radar card, status badge, and last-contact/context text instead of plain black placeholders.
- Static cache-bust bumped to `app.js?v=199` and `style.css?v=164`.

## What was built - Session 28.100 (Bambu offline init fix - 1 June)
- Initialised the Bambu connector's cached last-seen timestamp before first contact.
- Fixed powered-off Bambu printers briefly rendering as `ERROR` after restart instead of the intended `OFFLINE` state.

## What was built - Session 28.99 (Offline state consistency polish - 1 June)
- Added Bambu MQTT staleness detection so retained printer payloads do not keep powered-off printers showing as `idle`.
- Dashboard and All Cameras now inherit the backend `offline` state once Bambu printers stop sending fresh reports.
- Kept the Session 28.98 Environment fallback polish in place for offline/non-reporting printers.

## What was built - Session 28.98 (Live loaded spool fallback polish - 1 June)
- Replaced the old skinny loaded-spool fallback chips with proper loaded rows for printers without live AMS/MMU data.
- Offline Voron now keeps the newer Environment panel language with swatch, material/brand, spool number, slot, grams, and percent meter.
- Static cache-bust bumped to `app.js?v=198` and `style.css?v=163`.

## What was built - Session 28.97 (Live offline hero restore - 1 June)
- Replaced the plain black live-feed offline placeholder with a polished signal-lost card.
- Live camera hero now swaps between stream and offline/no-feed states cleanly when printer state changes.
- Static cache-bust bumped to `app.js?v=197` and `style.css?v=162`.

## What was built - Session 28.96 (Operations nav restore - 1 June)
- Restored `Cameras` and `Queue` under the Operations section after the printer-scoped navigation pass.
- Static cache-bust bumped to `app.js?v=196`.

## What was built - Session 28.95 (Printer failure scroll pane - 1 June)
- Gave each printer `Failures` tab the same fixed-context/scrolling-results behaviour as the spool swatch view.
- The failure header, filters, and stat cards stay visible while the failure row list scrolls underneath.
- Static cache-bust bumped to `style.css?v=161`.

## What was built - Session 28.94 (Printer scoped Print Bay and failures - 1 June)
- Reworked the left navigation into printer groups so each machine owns its own `Live`, `Print Bay`, `History`, `Failures`, and `Maintenance` pages.
- Added printer-specific Print Bay tabs for machine-local files, recent work, and vault-compatible candidates while keeping the Print Vault inside the global Print Bay.
- Moved failure review into each printer page so timing buckets, material, spool attribution, snapshots, and failure rows are scoped per machine.
- Removed the combined `Failures` item from the primary nav and renamed the fleet file area to `Global Print Bay`.
- Static cache-bust bumped to `app.js?v=195` and `style.css?v=159`.

## What was built - Session 28.93 (Maintenance service cockpit - 31 May)

The printer Maintenance tab now reads more like a service cockpit than a plain task list.

### Frontend
- Added a top cockpit panel with printer-reported care count, scheduled due count, manual task count, next service, and last completed service.
- Collapsed the add-task form behind an "Add service task" drawer so the service status is the first thing you see.
- Kept Bambu MQTT care and manual schedules visually separate.
- Static cache-bust bumped to `app.js?v=194` and `style.css?v=158`.

### Verification
- `node --check app/static/app.js`
- `git diff --check`

## What was built - Session 28.92 (Printer usage telemetry - 31 May)

Telemetry now includes per-printer historical print counters.

### Backend
- Added `/api/printers/usage` with all-time Flightdeck print counts, finished counts, failure counts, print hours, and filament grams by printer.
- Corrected Bambu MQTT care label `ls` to "Lubricate lead screws"; `lr` remains "Lubricate linear rails".

### Frontend
- Telemetry Printer Balance rows now show per-printer print count and recorded print hours.
- Static cache-bust bumped to `app.js?v=193`.

### Verification
- `python -m py_compile app/db.py app/main.py app/printers/bambu.py`
- `node --check app/static/app.js`
- `git diff --check`

## What was built - Session 28.91 (Bambu MQTT maintenance automation - 31 May)

Flightdeck now reads Bambu MQTT care advisories into the printer Maintenance tab using its own maintenance model.

### Backend
- Bambu status parses MQTT `print.care` into live maintenance advisories.
- Printer status includes a `maintenance` telemetry list for due care codes.

### Frontend
- Maintenance tabs show an Auto maintenance panel above manual operator tasks.
- Bumped static cache-bust to `app.js?v=192` and `style.css?v=157`.

### Verification
- `python -m py_compile app/models.py app/printers/bambu.py`
- `node --check app/static/app.js`
- `git diff --check`

## What was built - Session 28.90 (Camera sim route fix - 31 May)

Flightdeck's 30-camera simulator link now opens the camera wall correctly.

### Frontend
- Router now recognises `#/cameras?sim=30`, not only plain `#/cameras`.
- The Flight Tower `View 30 cameras` link can now switch to the simulated camera wall instead of only changing the hash.
- Static cache-bust bumped to `app.js?v=188`.

### Verification
- `node --check app/static/app.js`
- `git diff --check`

## What was built - Session 28.89 (H2D route cooling guard - 31 May)

Flightdeck now avoids showing a false H2D AMS HT route while a nozzle is only cooling down after unload.

### Frontend
- H2D route inference now treats a nozzle as route-active from target temperature immediately.
- Actual nozzle heat only counts as route-active while the printer has an active thermal context, such as a print/job, pause, loading, preparing, or busy state.
- When H2D is idle and both AMS slots report inactive, the Live filament route stays hidden even if a nozzle is still hot from the previous unload/print.
- Static cache-bust bumped to `app.js?v=187`.

### Verification
- `node --check app/static/app.js`
- `git diff --check`

## What was built - Session 28.88 (H2D filament route nozzle inference - 31 May)

Flightdeck's Live filament route now handles the H2D's dual-nozzle/AMS HT reporting more accurately.

### Frontend
- Added H2D-specific route inference for the Live filament route.
- When the right nozzle is hot/working and AMS HT is loaded, Flightdeck now routes AMS HT to `Right nozzle` even if Bambu's generic `active` flag still points at AMS 1.
- Normal AMS routes label as `Left nozzle` on H2D.
- Active/fed highlighting in the loaded AMS row uses the same inferred route signal as the route graphic.
- Static cache-bust bumped to `app.js?v=186`.

### Verification
- `node --check app/static/app.js`
- `git diff --check`

## What was built - Session 28.87 (Live filament route polish - 31 May)

The Live AMS route graphic now reads more like an active feed indicator.

### Frontend
- Active/fed AMS slot swatches now get a subtle green active ring and dot.
- Filament route source node now includes a compact `Fed now` state badge.
- The route line now has a quiet animated flow treatment so live filament movement is easier to spot without crowding the camera.
- Static cache-bust bumped to `style.css?v=155` and `app.js?v=185`.

### Verification
- `node --check app/static/app.js`
- `git diff --check`

## What was built - Session 28.86 (Live AMS-to-toolhead route graphic - 31 May)

Flightdeck now shows the currently fed AMS filament path on the printer Live tab.

### Frontend
- Added a compact `Filament route` strip inside the Live `Environment` panel.
- The route uses the printer's live `active` AMS slot signal and draws the slot colour toward the toolhead/nozzle area.
- Clicking the source node opens the same AMS Profile Doctor for that slot.
- Parked/non-active AMS rolls remain in the normal `Loaded` rows so Flightdeck does not overclaim which spool is actually feeding.
- Static cache-bust bumped to `style.css?v=154` and `app.js?v=184`.

### Verification
- `node --check app/static/app.js`
- `git diff --check`

## What was built - Session 28.85 (Bambu queued plate display fallback - 30 May)

Flightdeck now keeps queued Bambu 3MF job names/previews visible when firmware reports only an internal plate file.

### Backend
- Added an active queue job lookup.
- Bambu live status now resolves `/data/Metadata/plate_1.gcode` back to the active queue filename when the printer does not report a subtask name.
- Bambu preview/object lookup now uses that active queue filename as the cache key, so queued multi-object 3MF previews and object exclusion can stay available.

### Verification
- `python3 -m py_compile app/db.py app/printers/bambu.py`
- `git diff --check`

## What was built - Session 28.84 (Bambu queue AMS mapping - 30 May)

Flightdeck queue starts now use the same Bambu AMS mapping logic as relay starts.

### Backend
- Bambu queue/file starts now parse the uploaded 3MF preview metadata and derive AMS tray mapping before starting the print.
- Queue starts now send the derived `ams_mapping` through Flightdeck's BambuStudio-style `ams_mapping2` command path.
- Added `queue_bambu_mapping` decision logging so future multi-colour failures show exactly which tray IDs Flightdeck sent.
- Seeded the print preview cache from queue uploads so live/history previews stay in sync with the queued file.

### Verification
- `python3 -m py_compile app/printers/bambu.py`
- `git diff --check`

## What was built - Session 28.83 (Bambu AMS mapping2 start command - 30 May)

Flightdeck now sends BambuStudio-style AMS mapping details when starting Bambu relay prints.

### Backend
- Overrode the Bambu 3MF start command in Flightdeck's sequenced MQTT client so it sends both legacy `ams_mapping` and detailed `ams_mapping2`.
- Converted external/unknown slots to Bambu's expected detailed mapping format instead of leaving unsupported values in the flat map.
- Corrected relay-start mapping for AMS HT: Flightdeck now sends Bambu-native AMS HT tray IDs like `128`, not internal UI slot IDs like `512`.
- Relay mapping notes now log the Bambu tray ID that was sent.

### Verification
- `python3 -m py_compile app/relay.py app/printers/bambu.py`
- `git diff --check`

## What was built - Session 28.82 (AMS drying power warning - 30 May)

Flightdeck now warns before starting AMS drying while the printer is active.

### Frontend
- AMS drying dialog shows an amber warning when the printer is printing/loading/paused: drying may need a separate AMS power supply for reliable drying.
- The warning is advisory and does not block the command.
- Static cache-bust bumped to `style.css?v=151` and `app.js?v=173`.

### Verification
- `node --check app/static/app.js`
- `git diff --check`

## What was built - Session 28.81 (Bambu AMS mapping start command - 30 May)

Flightdeck now derives Bambu AMS mapping for relay-started multicolour jobs instead of always sending slot `[0]`.

### Backend
- Relay upload now stores parsed 3MF filament colour metadata in the pending Bambu upload record.
- Added a flattened live AMS slot reader to `BambuPrinter`.
- Bambu print start now builds `ams_mapping` by matching 3MF material/colour requirements to the printer's currently reported AMS slots.
- Start decisions now log the mapping used and the material/colour-to-slot matches.
- If metadata or live AMS slots are unavailable, Flightdeck falls back to slot `[0]` and records why in the decision log.

### Verification
- `python3 -m py_compile app/relay.py app/printers/bambu.py`
- `git diff --check`

## What was built - Session 28.80 (Bambu pause alarm reasons - 30 May)

Flightdeck now surfaces the real Bambu AMS pause alarm instead of only saying a print paused.

### Backend
- Added Bambu MQTT alarm decoding from `err`, `err2.err_code`, `print_error`, `ap_err`, `fail_reason`, and related fields.
- Added a friendly decoder for `1E07008012` / `0700-8012`: `Failed to get AMS mapping table; please select "Resume" to retry.`
- Bambu paused/error printer status now carries the decoded alarm in `error`.
- Print paused/error notifications now include the decoded printer reason.
- If the paused print later becomes a failed print, the decoded reason is saved into print history as the failure message.

### Frontend
- Dashboard issue text and live-screen warning chips now show the decoded paused reason when present.
- Static cache-bust bumped to `app.js?v=172`.

### Verification
- `python3 -m py_compile app/printers/bambu.py app/main.py`
- `node --check app/static/app.js`
- `git diff --check`

## What was built - Session 28.79 (Print Vault copy polish - 30 May)

Print Bay copy-to-vault now keeps the archive area in view.

### Frontend
- Print Vault open/closed state is preserved during File Desk refreshes.
- Copy-to-vault forces Print Vault open after a successful archive so the copied file stays visible.
- File Desk refresh cache is invalidated after copy-to-vault so new vault state is fetched immediately.
- Static cache-bust bumped to `app.js?v=171`.

### Verification
- `node --check app/static/app.js`
- `git diff --check`

## Current state

**Tier 1 complete. Tier 2 complete. Post-Tier-2 niceties complete. Spool inventory + Print queue + queue refinements + Maintenance schedule + Queue preflight + Spool traceability + Failure review + Printer health score + Scale/label hardware integration + dashboard command overview shipped.**

Service running at:
- `http://flightdeck.local:8000`
- `http://192.168.4.127:8000`
- **`https://flightdeck.tail7de73e.ts.net`** (Tailscale Serve — HTTPS, used for PWA / notifications)

---

## What was built — Session 28.78 (Print Vault archive indicators — 30 May)

Print Bay now recognises files that are already backed up into Print Vault.

### Backend
- Added archive-key matching between printer storage files and Print Vault files.
- Printer bay file rows now include `in_vault` and `vault_path` when the file appears to already exist in the vault.

### Frontend
- Printer bay rows show a green `Vaulted` chip for files already backed up.
- Printer bay source strips show how many visible files are vaulted.
- Bulk copy action now reads `Copy to Vault`.
- Copy success and replace prompts now use Print Vault wording.
- Static cache-bust bumped to `style.css?v=150` and `app.js?v=170`.

### Verification
- `python3 -m py_compile app/main.py`
- `node --check app/static/app.js`
- `git diff --check`

---

## What was built — Session 28.77 (Configurable Print Vault — 30 May)

Print Vault can now be pointed at a Pi, USB, or HDD-backed archive path from Flightdeck preferences.

### Backend
- Added `print_vault_path` setting support.
- Print Bay resolves the vault path at request time, so path changes do not require a service restart after the backend update is running.
- Validates the vault path is a writable directory before saving.
- Setup Health now reports `Print Vault` using the configured runtime path.

### Frontend
- Added `Print Vault` path field under `Settings -> Preferences / System`.
- Saving a vault path shows success/failure feedback.
- Static cache-bust bumped to `style.css?v=149` and `app.js?v=169`.

### Verification
- `python3 -m py_compile app/main.py app/db.py`
- `node --check app/static/app.js`
- `git diff --check`

---

## What was built — Session 28.76 (Print Vault split — 30 May)

Print Bay now separates active printer storage from the backup/archive library.

### Frontend
- The Pi print library now reads as `Print Vault`, suitable for Pi/USB/HDD-backed file storage.
- Printer storage is presented first as `Printer Bays / Active storage`.
- The vault is moved into its own collapsible panel so Print Bay has more room for live printer file lanes.
- Overview wording changed from `Pi library` to `vault files`.
- Static cache-bust bumped to `style.css?v=148` and `app.js?v=168`.

### Note
- The existing `FLIGHTDECK_PRINT_LIBRARY` path can be pointed at a mounted USB/HDD location when you want the vault on external storage.

### Verification
- `node --check app/static/app.js`
- `git diff --check`

---

## What was built — Session 28.75 (Spool picker visibility — 30 May)

Spool cards and Add Spool previous-colour picks now make newly-added duplicate rolls easier to find.

### Frontend
- Add Spool `Previously used` colour picks are no longer capped at six results.
- Previous picks now render as a scrollable paint-chart list with spool numbers.
- Previous picks are sorted newest-first so fresh rolls/colours appear immediately.
- Spool card search now matches spool numbers, hex colours, subtype, notes, storage location, and loaded printer ids.
- Grouped duplicate cards now sort by latest roll id and show `latest #...` in the card badge.
- Static cache-bust bumped to `style.css?v=147` and `app.js?v=167`.

### Data note
- Spool #64 exists and is grouped with matching `White / PLA+ / 3DFillies` rolls.
- Spool #5 does not exist in the database; the id was skipped by SQLite during an earlier failed/conflicting insert.

### Verification
- `node --check app/static/app.js`
- `git diff --check`

---

## What was built — Session 28.74 (Print Bay density pass — 30 May)

Print Bay now uses the available screen space more like a dispatch board.

### Frontend
- Widened the Print Bay canvas for large desktop displays.
- Compacted the hero, overview counters, and Reprint Bay cards.
- Source panels now flow into more across-the-page lanes instead of being locked to two wide stacks.
- File rows are tighter, with shorter spacing and a viewport-aware scroll inside each source lane.
- Static cache-bust bumped to `style.css?v=146`.

### Verification
- `git diff --check`

---

## What was built — Session 28.73 (Reprint Bay run memory — 30 May)

Reprint Bay cards now expose lightweight run-memory chips so the strip reads as dispatch context rather than a plain history list.

### Frontend
- Each Reprint Bay card now shows up to three memory chips:
  - last run completed/cancelled/failed
  - source match location or source file missing
  - model grams when known
- Source match chip distinguishes same-printer source vs another source panel.
- Static cache-bust bumped to `style.css?v=145` and `app.js?v=166`.

### Verification
- `node --check app/static/app.js`

---

## What was built — Session 28.72 (Reprint Bay first pass — 30 May)

Print Bay now has its first history-aware Reprint Bay strip.

### Backend
- Added `db.get_recent_reprints(limit)` for recent completed/cancelled/error print records.
- Added `GET /api/files/reprints?limit=12`, enriched with printer model/custom names.

### Frontend
- Print Bay now fetches recent print history alongside file sources.
- Added `Reprint Bay / Recent work` cards above the source panels.
- Reprint cards show:
  - job name
  - outcome badge
  - printer
  - duration
  - material/grams when known
  - failure snapshot when available
- Reprint cards search current Print Bay sources for a matching file; if found, they expose a direct `Queue` action.
- If no source file exists, the card is marked history-only.
- Static cache-bust bumped to `style.css?v=144` and `app.js?v=165`.

### Verification
- `python3 -m py_compile app/db.py app/main.py`
- `node --check app/static/app.js`

---

## What was built — Session 28.71 (Print Bay first pass — 30 May)

The old Files surface has been renamed and reshaped into the first pass of Print Bay.

### Frontend
- Navigation now calls the page `Print Bay` instead of `Files`.
- Page heading changed to `Print Bay / Run-ready library`.
- Added overview counters for:
  - ready to launch
  - Pi library files
  - printer storage files
  - total printable files
- Source panels now show operational summary chips: ready count, compatible printer count, and total size.
- Replaced the cramped file table with launch rows:
  - checkbox
  - file type/name/path
  - size/modified metadata
  - compatible printer chips
  - visible `Queue` action at the right edge
- Bulk copy/delete flows remain intact.
- Static cache-bust bumped to `style.css?v=143` and `app.js?v=164`.

### Verification
- `node --check app/static/app.js`

---

## What was built — Session 28.70 (Live environment compact pass — 30 May)

The Live tab Environment panel was tightened so it no longer creates a large empty temperature column under the camera.

### Frontend
- Environment now uses one compact header row containing the title and temperature chips.
- Loaded AMS rows now run full-width underneath the header.
- AMS rows were changed to compact two-column instrument rows: metadata/dry control on the left, slot swatches on the right.
- Dry buttons and AMS slot swatches were slightly reduced so the panel supports the camera-first layout.
- Static cache-bust bumped to `style.css?v=142` and `app.js?v=163`.

### Verification
- `node --check app/static/app.js`

---

## What was built — Session 28.69 (Pause/resume control polish — 30 May)

Live printer controls now use one state-aware Pause/Resume button instead of separate buttons.

### Frontend
- Transport deck shows `Pause` while printing and `Resume` while paused.
- Pause and resume now both ask for confirmation before sending the command.
- Older detail control renderer was kept in sync for any fallback surfaces.
- Static cache-bust bumped to `app.js?v=162`.

### Backend
- Bambu `pause()` and `resume()` now raise an error if the MQTT command is not accepted instead of silently returning success.

### Verification
- `python3 -m py_compile app/printers/bambu.py app/printers/bambu_ftp.py app/main.py`
- `node --check app/static/app.js`

---

## What was built — Session 28.68 (Bambu object skip metadata — 30 May)

Flightdeck now reads Bambu object/part candidates from the active 3MF metadata instead of waiting for live MQTT `s_obj` to populate.

### Backend
- `BambuPreview` now carries parsed objects from `Metadata/slice_info.config`.
- Bambu `/api/printers/{id}/objects` returns parsed object IDs/names for multi-object plates.
- Bambu `/api/printers/{id}/exclude-object` sends the MQTT `skip_objects` command with the selected object ID.

### Frontend
- Existing Print Objects panel now passes Bambu object IDs through the checkbox flow.
- Static cache-bust bumped to `app.js?v=161`.

### Verification
- Parsed the active H2D 3MF and confirmed twelve object IDs from `slice_info.config`.
- `python3 -m py_compile app/printers/bambu.py app/printers/bambu_ftp.py app/main.py`

---

## What was built — Session 28.67 (Bambu stale fault clear — 30 May)

Flightdeck now releases stale Bambu fault state after the printer has already recorded the failed job and no longer reports an active error code.

### Backend
- Bambu printer adapter now tracks when an in-session error was first seen.
- If Bambu keeps reporting `FAILED` for an already-closed print but `print_error` is clear, Flightdeck logs `error_cleared` and returns the printer to `idle` after a short grace period.
- Queue preflight still blocks real active `error` states, but no longer stays blocked on a retained Bambu failure from a physically cleared printer.

### Verification
- `python3 -m py_compile app/printers/bambu.py`

---

## What was built — Session 28.66 (Live environment band — 30 May)

The Live tab now uses the space under the camera as one coherent Environment band instead of separate half-empty cards.

### Frontend
- Combined `Temperatures` and `Loaded` into a single `Environment` panel.
- Environment panel uses a compact two-column layout:
  - temperatures on the left
  - AMS/loaded feeder rows on the right
- RHS remains available for Print Details and object exclusion during multi-part prints.
- Mobile/narrow layout stacks the same sections cleanly.
- Static cache-bust bumped:
  - `style.css?v=141`
  - `app.js?v=160`

### Verification
- JavaScript syntax check: `node --check app/static/app.js`
- Whitespace check: `git diff --check`
- Browser check on `#/printer/h2d` confirmed one Environment panel with temperature and loaded sections.

---

## What was built — Session 28.65 (Live transport controls — 29 May)

The Live tab print controls were moved into the cockpit header as a compact transport deck.

### Frontend
- Replaced the large RHS command card with header-level transport controls.
- Controls now sit in line with the `Now printing` status:
  - Pause
  - Resume/play
  - Cancel/stop
  - E-stop
  - compact Light control
- The transport buttons keep the existing command handlers and confirmation flow.
- Static cache-bust bumped:
  - `style.css?v=140`
  - `app.js?v=159`

---

## What was built — Session 28.64 (Live compact light control — 29 May)

Live screen command panel polish.

### Frontend
- Replaced the large glowing `BAMBU` light toggle with a compact bulb-style `Light` control.
- The control still reflects on/off state visually and uses the existing click handler.
- Static cache-bust bumped:
  - `style.css?v=139`
  - `app.js?v=158`

---

## What was built — Session 28.63 (Live feed hero tightening — 29 May)

The Live tab layout was tightened so the camera feed stays the visual hero.

### Frontend
- Reduced Live page spacing around the camera.
- Made the cockpit header more compact.
- Slimmed signal chips, camera HUD, temperature chips, Loaded cards, and AMS rows.
- Reduced RHS panel spacing and detail panel padding.
- Kept AMS Dry/slot controls compact after the alignment pass.
- Static cache-bust bumped:
  - `style.css?v=138`
  - `app.js?v=157`

---

## What was built — Session 28.62 (Live AMS row alignment — 29 May)

Small Live screen polish for the AMS rows.

### Frontend
- Aligned AMS colour slot rows with the Dry control so each feeder row reads as one clean block.
- Reduced the Dry button footprint so the swatches stay visually dominant.
- Capped live AMS slot width so single-slot HT rows stay swatch-sized instead of stretching into a full bar.
- Static cache-bust bumped:
  - `style.css?v=137`
  - `app.js?v=156`

---

## What was built — Session 28.61 (Live AMS loaded rows — 29 May)

The Live tab `Loaded` cockpit block now mirrors the actual feeder layout for AMS printers.

### Frontend
- Bambu AMS printers now show loaded filament as feeder rows:
  - `AMS 1` row with RH/temp/dry status and colour slots
  - `AMS HT` row with RH/temp/dry status and colour slot
- Slot swatches keep the same click-to-edit behaviour as the existing AMS panel.
- Dry controls are available directly from the cockpit Loaded block.
- Non-AMS printers still fall back to loaded spool chips.
- Removed the duplicate RHS AMS card from Live so AMS state lives in one place.
- Static cache-bust bumped:
  - `style.css?v=136`
  - `app.js?v=155`

### Verification
- JavaScript syntax check: `node --check app/static/app.js`
- Whitespace check: `git diff --check`
- Browser check on `#/printer/h2d` confirmed two live AMS rows, five slot buttons, two Dry controls, and no duplicate RHS AMS card.

---

## What was built — Session 28.60 (Live idle HUD cleanup — 29 May)

Small Live screen polish after real visual review.

### Frontend
- Camera HUD now hides when there is no active job, avoiding duplicated idle/status text already shown in the cockpit header.
- Camera HUD still appears for active jobs with job name, progress, ETA, and key temperatures.
- Static cache-bust bumped:
  - `style.css?v=135`
  - `app.js?v=154`

### Verification
- JavaScript syntax check: `node --check app/static/app.js`

---

## What was built — Session 28.59 (Live screen signal pass — 29 May)

The printer Live tab got a second cockpit polish pass focused on surfacing useful signals without duplicating panels.

### Frontend
- Added a live signal row in the printer cockpit header:
  - clear state shows `Clear skies`
  - faults, paused/offline state, reliability notes, low loaded spools, and AMS mismatches surface as chips
- Styled signal chips with calm/blue, warning/amber, and danger/red treatments.
- Wrapped the Live command controls in a clearer `Command` card.
- Kept temperatures in the cockpit strip and removed the duplicate RHS Live temperature card.
- Static cache-bust bumped:
  - `style.css?v=134`
  - `app.js?v=153`

### Verification
- JavaScript syntax check: `node --check app/static/app.js`
- Whitespace check: `git diff --check`

---

## What was built — Session 28.58 (Live screen cockpit pass — 29 May)

The printer Live tab now has a stronger operator cockpit layout.

### Frontend
- Added a live command header above the camera with:
  - printer/model identity
  - shop name
  - current job or status summary
  - state badge
- Added a camera HUD overlay with:
  - active job/status
  - progress bar when printing
  - compact temperature chips
- Added a live strip under the camera with:
  - temperature chips
  - loaded Flightdeck spool chips with remaining grams
  - low/warn colour treatment for low loaded spools
- Live refreshes update the header, HUD, and strip without rebuilding the whole camera stream.
- Mobile layout stacks the new cockpit blocks cleanly.
- Static cache-bust bumped:
  - `style.css?v=133`
  - `app.js?v=152`

### Verification
- JavaScript syntax check: `node --check app/static/app.js`
- Whitespace check: `git diff --check`
- Browser check on `#/printer/h2d` confirmed the live header, camera HUD, live strip, and detail panels render.

---

## What was built — Session 28.57 (Command palette result grouping — 29 May)

The command palette now groups spool-specific matches so searches like `spool 31`, `label 31`, or `weight spool 31` show one tidy spool result instead of scattering Open, Edit, and Actions through the general list.

### Frontend
- Command items now support optional grouping metadata:
  - `cluster`
  - `clusterLabel`
  - `clusterMeta`
  - `actionLabel`
- Spool command results share a spool cluster and render as one grouped card when multiple actions match.
- Grouped spool results expose quick action buttons:
  - `Open`
  - `Edit`
  - `Actions`
- Added compact grouped-result styling for desktop and mobile.
- Static cache-bust bumped:
  - `style.css?v=132`
  - `app.js?v=151`

### Verification
- JavaScript syntax check: `node --check app/static/app.js`

---

## What was built — Session 28.41 (AMS active-slot deduction hardening — 28 May)

Real print testing on H2D exposed a restart-sensitive spool deduction bug: a single-colour Bambu print could deduct evenly from every assigned AMS/HT slot if Flightdeck restarted between print start and print finish.

### Fix
- Bambu AMS print-start snapshots now persist the active `tray_now` slot in two ways:
  - per-slot `"active": true` on the slot that the printer reports as feeding
  - snapshot `__meta__.active_slot` when Flightdeck captured the active slot in memory
- `db.deduct_spool_usage()` now recovers the active slot from persisted snapshot metadata when its in-memory `active_slot` argument is missing.
- If metadata is missing but exactly one snapshot slot is marked active, deduction uses that slot instead of splitting grams across all loaded spools.

### Behaviour
- Future Bambu spool deductions survive a service restart between print start and print finish.
- If Flightdeck truly cannot identify an active slot, it keeps the existing conservative equal-split fallback rather than guessing.

### Verification
- Python compile: `python -m py_compile app/db.py app/printers/bambu.py`

---

## What was built — Session 28.42 (Notification stale-error guard — 28 May)

Real ntfy testing showed a false pairing: H2D finished a print and X1C sent a `Print error` notification at nearly the same time, even though X1C had no active print row.

### Fix
- Backend ntfy now only sends `Print error` when:
  - the printer was previously `printing`, or
  - the error state has an attached `_error_print_id`.
- Failure snapshots and queue failure cancellation use the same guard, avoiding `failure_snapshot_unavailable` rows for stale Bambu error states with no print row.
- Browser notifications/toasts now use the same stale-error guard.
- Static cache-bust bumped to `v=97`.

### Behaviour
- A stale Bambu `FAILED` state no longer produces a fresh print-error notification when there was no current print.
- Real print failures still notify when the printer transitions from `printing` to `error`.

---

## What was built — Session 28.43 (Safe restart health wait — 28 May)

Real restart testing showed `scripts/safe-restart-flightdeck.sh` can correctly start `flightdeck.service`, but still fail its local health check because `/api/printers` may need more than the old 5s curl window while Bambu MQTT/camera startup settles.

### Fix
- Added `HEALTH_TIMEOUT`, defaulting to 45 seconds.
- Health check now retries `/api/printers` every 2 seconds until it responds or the deadline expires.
- On timeout, the script prints a fuller `systemctl status` block before exiting.

### Behaviour
- Safe restart no longer reports a false failure just because the app was active before the API had finished warming.
- Existing overrides remain available:
  - `STOP_TIMEOUT=...`
  - `START_TIMEOUT=...`
  - `HEALTH_TIMEOUT=...`

---

## What was built — Session 28.44 (Spool usage reconciliation — 28 May)

Real H2D testing showed the slicer filament estimate can be much lower than the actual physical spool loss because purge/prime/waste comes off the same spool.

### Backend
- Bambu AMS print-start snapshots now store `remaining_g_at_start` for each assigned Flightdeck spool.
- Finished-print spool usage entries now include:
  - `remaining_before_g`
  - `remaining_after_g`
  - `remaining_start_g` when captured
- Added `POST /api/prints/{print_id}/spool_usage/{spool_id}/reconcile`.
- Reconcile updates the spool's actual remaining grams, annotates the print usage with `actual_grams` and `waste_grams`, and logs `spool_reconciled` to the decision trail.
- Reconcile can optionally mark one spool as the only spool actually used, removing other usage rows and restoring their wrongly deducted grams.
- Moved spool deduction decision logging outside the write transaction to stop the non-fatal SQLite lock warning during `spool_deducted` logging.

### UI
- History print detail spool usage rows now show a `Reconcile` action.
- Reconcile prompts for the actual remaining grams after a re-weigh.
- If a print predates start-weight capture, Reconcile can also accept a one-off starting gram value.
- If a print has multiple recorded usage rows, Reconcile asks whether the selected spool was the only actual spool used.
- If actual usage exceeds slicer-recorded model grams, the row shows model grams plus purge/waste grams.
- Static cache-bust bumped to `app.js?v=98` and `style.css?v=86`.

---

## What was built — Session 28.45 (Smart weigh-in trial — 29 May)

First pass at making reconciliation useful without turning it into operator homework.

### Behaviour
- History print detail now marks spool usage rows with `Weigh-in suggested` only when the row looks worth checking:
  - multiple spools were recorded for one print
  - the spool is below the low-stock threshold, capped at 20%
  - the spool is near empty
  - the deduction is large relative to remaining stock
- Suggested rows get a subtle amber treatment and the action reads `Weigh`.
- Normal low-risk rows still show the quieter `Reconcile` action and do not nag.

### Cache
- Static cache-bust bumped to `app.js?v=99` and `style.css?v=87`.

---

## What was built — Session 28.46 (Reconciled usage state — 29 May)

- History spool usage rows that already have `actual_grams` now show a quiet green `Reconciled` state instead of continuing to show the `Reconcile` button.
- Static cache-bust bumped to `app.js?v=100` and `style.css?v=88`.

---

## What was built — Session 28.47 (Dashboard badge drill-downs — 29 May)

- Dashboard `Needs attention` badges now link to Failure Review filtered to that printer instead of leaving the operator on a Live screen with no visible explanation.
- Dashboard `Low filament` badges now link to Spools filtered to low loaded spools for that printer.
- Card click handling now ignores nested links/buttons, so badge drill-downs work without triggering the card's Live navigation.
- Failure Review and Spools pages now read simple hash query filters such as `#/failures?printer=h2d` and `#/spools?filter=low&printer=h2d`.
- Static cache-bust bumped to `app.js?v=101` and `style.css?v=89`.

---

## What was built — Session 28.48 (Demote dashboard low-stock badge — 29 May)

- Removed the top-level dashboard `Low filament` badge because it was a raw inventory condition, not necessarily a print-impacting problem.
- Loaded spool percentages still show low/amber/red inside each printer card.
- Queue preflight and Mission Control continue to be the surfaces for actual print-impacting stock risk such as `Loaded filament short` or `Low filament margin`.
- Static cache-bust bumped to `app.js?v=102`.

---

## What was built — Session 28.49 (Demote historical health alarm — 29 May)

- Dashboard historical health signals now show as `Reliability` instead of `Needs attention`.
- Historical failure/cancel/success-rate reasons still link to Failure Review and still appear as a small card note.
- The dashboard `Needs attention` panel now only includes current printer states or actionable health items such as maintenance due / failed queue jobs.
- The former `Health` KPI is now `Review`, so it counts historical review signals without implying an active fault.
- Static cache-bust bumped to `app.js?v=103` and `style.css?v=90`.

---

## What was built — Tier 1 (complete)

### Infrastructure
- FastAPI backend, SQLite, systemd service (`flightdeck.service`)
- `printers.yaml` config: model/custom names, icons, connection info, camera config, temperature presets
- `flightdeck.local` mDNS resolves correctly

### Printer integrations
- **Voron Greyhound Elite V2** — Moonraker polling, layer counts, toolhead position
- **Bambu X1C (Greyhound Ludicrous)** — bambulabs_api MQTT, subtask_name preferred over `plate_1.gcode`
- **Bambu H2D (BigBoy)** — same as X1C; both Bambus on **LAN mode**

### State machine
- States: `PRINTING` / `IDLE` / `PAUSED` / `FINISHED` / `ERROR` / `OFFLINE` / `ESTOP`
- FINISHED persists 30 min post-completion, survives restart via SQLite hydration
- Connection health dots (green/amber/red) per card

### Print history (SQLite `prints` table)
- UPSERT on `(printer_id, job_key)` — idempotent through reconnect storms
- Three lifecycle hooks: `on_print_started`, `on_print_finished`, `on_print_ended`
- Stale orphan cleanup on startup (prints open >24h closed as ERROR)
- "Last print" idle-card row: `Xh Ym`, `cancelled at N%`, `failed at N%`

### UI (Tier 1)
- Card header: brand icon + connection dot + model name + custom name + state badge
- Printing cards: progress bar, layer counter, ETA, filename (subtask_name preferred for Bambu)
- Finished cards: print complete summary + cooling indicator if hotend >50°C
- Idle cards: last print info rows
- Header: status pill + live indicator + clock; footer: host IP + printer counts

### Camera feeds (Tier 1.5)
- **Voron**: MJPEG direct from crowsnest — working
- **X1C**: ffmpeg RTSPS proxy port 322 → MJPEG — working
- **H2D**: RTSPS port 322 — working (LAN mode; printers.yaml `type: bambu_rtsp`)
- 2.5s fallback chain: live → static thumbnail → placeholder

---

## What was built — Tier 2 (complete)

All 10 steps from TIER2_SPEC.md shipped, plus four bonus items.

### Navigation
- Top-level tab strip: per-printer tabs + All Cameras + Queue + Settings, client-side hash routing (`#/printer/{id}`, `#/cameras`, `#/queue`, `#/settings`)
- Per-printer sub-tabs: Live | History; instant client-side switch

### Live sub-tab
- **Two-column layout** — camera left (fills full viewport height), controls+panels right sidebar (320px); stacks to single column on mobile (<900px)
- **Camera click-cycle** — desktop: normal → wide (sidebar hidden, blue outline affordance) → fullscreen → All Cameras view; mobile: tap → fullscreen → tap → normal; ESC returns to normal from any state
- **Print controls** — Pause / Resume / Cancel / E-Stop; optimistic UI; confirmation modals on Cancel and E-Stop
- **Temperature controls** — per-heater actual/target display; ±5° nudge buttons; click reading → numeric modal
- **Temperature modal** — numeric keypad with presets running vertically down the right side, current→target display, hot-value warning (>280° hotend / >120° bed), range clamping with amber flash
- **Temperature display colour-coding** — LEFT/RIGHT/BED/CHAMBER values coloured by safety: red (>200°), blue (at-target / warm-controlled), white (cold/ambient). H2D dual-nozzle display split correctly.
- **Print details panel** — filename/subtask_name, progress bar, layer count, ETA; shows last print info when idle
- **Object exclusion panel** — renders for Moonraker printers when multi-object print active; confirmation modal before exclusion; disabled for Bambu
- **AMS display panel** — per-slot colour swatches, material type, active-slot indicator; Bambu Live tab only; AMS HT unit (ID 128) labelled correctly
- **MMU display panel** — Happy Hare gate state for Voron via `mmu` Moonraker object; gate colours, material, active gate indicator

### History sub-tab
- **Year heatmap** — Jan 1 → Dec 31 grid, Mon–Sun rows; 4-tier green intensity; future cells dimmed
- **Year navigation** — `‹ prev | year | next ›` above heatmap; persists selected year per printer
- **Summary line** — "47 prints · 168h · 4.2kg filament" (FINISHED only)
- **Day detail panel** — click a cell → list of that day's prints with time, duration, state badge
- **Print detail card** — click a print row → full detail (started/ended, duration, layers, filament, error); back button returns to day list instantly (cached)
- **Failure snapshot display** — for prints with snapshot_paths set, embed the captured image inline labelled "Last frame before failure"

### All Cameras view
- Grid of all live MJPEG feeds; tap tile → that printer's Live tab
- Partial update on WS tick — header badge/state updates without resetting the stream
- Offline camera shows placeholder, doesn't break grid

---

## Post-Tier-2 niceties (complete)

- **Browser tab title** — live state in tab: `67% · Greyhound Ludicrous`, `2 printing · Flightdeck`, `⚠ ERROR · Flightdeck`
- **Toast notifications** — slide-in bottom-right on finished/error/paused; auto-dismisses, stacks
- **Bell button** — 🔔 in header; native browser Notification API when HTTPS + permission granted
- **ffmpeg watchdog** — three layers: proc-exit auto-restart, staleness watchdog (8s no-frames), max-session-life cap (15 min, recycles ffmpeg to dodge H2D firmware freeze bug)
- **ntfy.sh push notifications** — server-side transition detection; topic: `flightdeck-c1f2849dcb`
- **Failure snapshot capture** — ERROR/ESTOP/CANCELLED transitions trigger frame grab; stored to `~/flightdeck/snapshots/{printer_id}/{print_id}_{ts}.jpg`
- **Decision log** — `decisions` table (columns: id, print_id, printer_id, event, detail, logged_at) captures state transitions, snapshot captures, calibration captures, reattachments, cancel-vs-error resolutions, relay uploads, spool operations
- **Server-side settings** — `settings` table holds theme, accent colour, temperature unit, time format, preferred slicer, low-stock threshold, queue settings, view-mode preferences. Replaces browser localStorage; syncs across all clients.
- **Slicer settings page** — "Preferred Slicer" picker with cards for OrcaSlicer / Bambu Studio / PrusaSlicer / SuperSlicer; coloured borders + badges per slicer; passive version detection from gcode header at relay upload time
- **OrcaSlicer relay (Voron only)** — Moonraker-shaped endpoints `/api/server/files/upload` + `/api/printer/print/start` per-printer; OrcaSlicer hard-codes Bambu LAN protocol so Bambu relay is not feasible
- **Tailscale Serve HTTPS** — `tailscale serve --bg http://localhost:8000` exposes Flightdeck on `https://flightdeck.tail7de73e.ts.net`. HTTPS Certificates enabled in tailnet admin DNS settings. Required for PWA install + browser notifications.
- **PWA install** — `manifest.json` + minimal service worker (no caching, just installability). Phone home-screen / desktop app install works.
- **Filament tracking** — `material_costs` table (multi-brand per material), cost-per-gram editor with brand support, per-print filament_grams capture, monthly bar chart
- **ETA calibration** — captures slicer estimated_duration_seconds at print start. Computes per-printer ratio after 5+ FINISHED prints. Sample bounded to last 50.
- **Per-printer identity colours on Live tab** — Voron red, X1C green, H2D amber. Coloured name banner + side-strip + sub-tab underline.

---

## What was built — Session 14 (Spool Inventory — 25 May)

Major new subsystem. Real physical filament spool tracking, separate from the cost-catalogue layer.

### Schema
- New `spools` table: `material`, `brand`, `subtype`, `color_hex`, `color_name`, `label_weight_g` (REAL), `remaining_g` (REAL), `location_printer_id`, `location_slot`, `notes`, `added_at`, `archived_at`
- `UNIQUE(location_printer_id, location_slot)` — one spool per loaded slot. SQLite NULL != NULL semantics let multiple storage spools coexist.
- `prints.spool_usage` TEXT — JSON `[{spool_id, grams, slot}]` per finished print
- `prints.ams_slot_snapshot` TEXT — JSON snapshot of slot→material/brand/colour at print start (DB-persisted, survives restart)

### Slot capture at print start (prerequisite work)
- **Bambu (`bambu.py`)**: `_snapshot_ams_slots()` reads `print.ams.ams[].tray[]` at first poll where state=printing AND print_id changes. Idempotent guard via `_ams_slot_snapshot_print_id`. Skips empty slots.
- **Moonraker (`moonraker.py`)**: `_snapshot_mmu_gates()` runs at `on_print_started` if `mmu.enabled`. Skips status=0. Non-MMU Voron untouched.

### Auto-deduction at print end
- On FINISHED state: look up `ams_slot_snapshot`; for each populated slot, find assigned spool at (printer_id, slot); deduct grams from `spools.remaining_g` (clamped to 0)
- Cancelled / errored prints do NOT deduct
- Decision-log events: `spool_deducted` / `spool_overdrawn` / `spool_missing` / `spool_no_deduction_cancelled`

### API endpoints
- `GET/POST/PUT/DELETE /api/spools` + `/archive`, `/restore`, `/reset_weight`, `/move`
- `GET /api/spools/summary` — total weight, count, in-printer, low-stock, by-material
- `GET /api/spools/by-printer/{id}` — slot-keyed dict

### UI — Spools settings tab
- **Summary strip** — 5 stat tiles: Total Inventory, Total Consumed, By Material, In Printer, Low Stock (threshold editable inline, default 20%)
- **Filter chips** — Active/Archived/All/Loaded/Storage/Low Stock + Material/Brand dropdowns + search
- **View toggle** — `[Cards] [Table]`, choice persisted in settings table
- **Card view** — coloured header band using `color_hex` with luminance-aware text contrast; colour name centred; spool # badge; material+subtype/brand/location-pin; progress bar colour-coded (green ≥50%, amber 20-50%, red <20%); action icons
- **Table view** — sortable columns; location text per-printer-type ("Greyhound Elite V2 S1" / "BigBoy AMS HT" / "Greyhound Ludicrous AMS 2 · S1")

### UI — Add Spool modal
- Material + Brand dropdowns with inline "+ Add new" expand flows
- Subtype freeform with autocomplete
- 12 common-colour swatches + hex input + colour-name field
- Label weight (default 1000g) + Remaining weight (defaults to label)
- Location: radio (In storage / Loaded on); cascading printer + slot dropdowns
- Notes freeform
- Validation: slot uniqueness with swap-suggestion

### Post-launch bug fixes (real-use testing — same day)
- Catalogue multi-brand persistence required restart to take effect first time (transient bug, not reproducible)
- Luminance threshold tightened for medium-grey backgrounds

---

## What was built — Session 15 (Polish — 25 May)

- **Per-printer identity colours on Live tab** — Voron red, X1C green, H2D amber. Coloured name banner + side-strip + sub-tab underline. Mutually distinguishable across the room.
- **Duplicate-printer detection on add** — confirmation dialog when new printer's connection details match an existing entry. Three actions: Cancel / View existing / Continue anyway (red destructive styling). Names the existing printer in the message.
- **Notification dedup logic** — ntfy fires server-side always. Browser notification fires only when `document.visibilityState === 'hidden'`. Toast only when visible.
- **Bell button states** — granted/denied/default with appropriate tooltips. `notif-unavailable` class for HTTPS-not-available.

---

## What was built — Session 16 (Print Queue — 26 May)

Per-printer print queue with file upload, drag-reorder, auto-dispatch on print completion, and failed-job rotation.

### Backend
- New `queue_items` table (printer_id, file_path, file_name, file_metadata JSON, status, position, created_at, started_at, completed_at)
- Statuses: `PENDING`, `PRINTING`, `COMPLETED`, `FAILED`
- File upload accepts:
  - Moonraker (Voron): `.gcode`
  - Bambu (X1C/H2D): `.3mf`, `.gcode.3mf`
- Metadata extraction at upload: material, weight, duration, thumbnail (from existing relay pipeline)

### Auto-dispatch
- On FINISHED transition: check for next PENDING item on that printer; dispatch via relay (Voron) or Bambu MQTT print-start
- **Failed jobs moved to end of queue, not skipped or kept blocking** — next PENDING moves up to ready position; failed stays visible at bottom with FAILED status

### Survival
- Queue state persisted to DB; survives service restart cleanly (tested)
- In-flight print at restart resumes queue context

### UI — Queue tab
- Per-printer sections (header: printer name + connection type badge MOONRAKER/BAMBU)
- Drag-drop or click-to-browse upload zone per section with file-format hint
- Queue items show: thumbnail, filename, material/weight/duration metadata, status badge, action buttons (up/down/play/cancel)
- Empty state: "No jobs queued"

### Tested behaviours
- Auto-dispatch on FINISHED ✅
- Failed job moves to end ✅
- Queue survives restart ✅
- OrcaSlicer-from-Voron workflow (same source mesh, switch printer in Orca to slice for Voron, dispatch via queue) ✅

### Note: obsoletes virtual-printer test mechanism
Earlier add/remove stress testing used virtual printer instances pointing at real printer IPs. The print queue + duplicate-detection dialog now cover that use case directly. Virtual printer testing not needed going forward.

---

## What was built — Session 17 (Queue refinements + format additions — 26 May)

### Queue format additions
- Moonraker now accepts `.gcode.gz` (compressed gcode) and `.ufp` (Cura format) in addition to `.gcode`
- Multi-part extension detection fixed (`.gcode.gz` was previously misread as `.gz`)
- Upload zone hint text updated per printer kind

### Queue refinements (all 5 shipped)
1. **Live updates** — `_detectTransitions` triggers `renderQueueView()` on any printer state change; queue page reflects auto-advance in real time without manual refresh
2. **Queue badge** — nav tab shows `Queue (3)` pending count; updated on every WS tick via lightweight `GET /api/queue/summary` endpoint
3. **Retry failed jobs** — purple ↺ button on failed/cancelled jobs; `POST /api/queue/{id}/retry` resets status to pending without re-upload
4. **Bulk clear** — "Clear done" button in section header (visible only when completed jobs exist); `DELETE /api/queue/completed?printer_id=x` deletes DB rows and files on disk
5. **Duration summary** — "3 pending · ~4h 20m" in each section header, summed from `estimated_seconds` on pending jobs

---

## What was built — Session 18 (Maintenance schedule — 26 May)

Printer-specific maintenance scheduling was added as a third per-printer sub-tab after Live and History.

### Backend
- New `maintenance_items` table: `printer_id`, `title`, `notes`, `due_at`, `interval_days`, `interval_prints`, `interval_hours`, `last_completed_at`, timestamps, `archived_at`
- API endpoints:
  - `GET/POST /api/printers/{printer_id}/maintenance`
  - `PUT /api/printers/{printer_id}/maintenance/{item_id}`
  - `POST /api/printers/{printer_id}/maintenance/{item_id}/complete`
  - `DELETE /api/printers/{printer_id}/maintenance/{item_id}` (archives)
- Due status is computed server-side from due date, elapsed days, completed print count, and completed print hours since last completion / creation.
- Completing a repeating day-based task rolls `due_at` forward; one-off date tasks clear `due_at`.
- Decision log events: `maintenance_added`, `maintenance_completed`, `maintenance_archived`

### UI
- New per-printer `Maintenance` sub-tab: `#/printer/{id}/maintenance`
- Add/edit form supports task title, notes, due date, repeat by days, repeat by prints, repeat by print hours
- Task cards show Due/OK badge, schedule progress summary, notes, Done/Edit/Del controls
- Archive confirmation uses existing confirmation modal
- CSS added for responsive maintenance form/cards; cache-bust bumped to static `v=29`

### Verification
- Python compile: `python -m py_compile app/db.py app/main.py`
- FastAPI import smoke: `import app.main`
- JS syntax: `node --check app/static/app.js` via `nvm`
- Maintenance DB smoke test against temporary SQLite DB
- Service restart still needs interactive sudo from user after deploy

---

## What was built — Session 19 (Queue preflight — 26 May)

Preflight readiness checks were added to the print queue. The goal is to prevent dispatch when Flightdeck already knows a job is unsafe or unready, without mutating the queue item into a failed state.

### Backend
- Queue jobs now receive computed `preflight` data from `GET /api/queue` for pending jobs.
- Preflight states: `ready`, `warning`, `waiting`, `blocked`.
- `can_start` is true for ready/warning jobs and false for waiting/blocked jobs.
- Checks include:
  - Printer telemetry available
  - Printer state is idle/finished before dispatch
  - Printer not offline/error/estop
  - No due maintenance items for that printer
  - Loaded spool inventory exists when filament metadata is known
  - Loaded spool material matches job material when metadata is known
  - Loaded spool remaining grams cover job filament grams when metadata is known
  - Low filament margin warning when remaining grams are under 115% of required grams
- Auto-dispatch checks preflight before starting the next pending job. Blocked jobs remain pending at the front of the queue instead of being marked failed or skipped.
- Manual "send now" checks preflight and returns HTTP 409 with preflight details when blocked.
- Decision log event: `queue_preflight_blocked`

### UI
- Queue cards now show a preflight badge beside the queue status badge.
- Preflight issue text is shown inline under the job metadata.
- Send-now button is disabled when preflight `can_start` is false.
- Static cache-bust bumped to `v=30`.

### Verification
- Python compile: `python -m py_compile app/db.py app/main.py`
- FastAPI import smoke: `import app.main`
- JS syntax: `node --check app/static/app.js` via `nvm`
- Preflight DB smoke test against temporary SQLite DB:
  - ready PLA job with matching loaded spool
  - material mismatch blocks
  - overdue maintenance blocks
- Service restart still needs interactive sudo from user after deploy

---

## What was built — Session 20 (Spool traceability — 26 May)

Spool-to-print traceability was added so physical filament inventory can be inspected from both directions. This sets up the future Brother label / QR workflow cleanly: `#/spool/{id}` is now a real detail destination.

### Backend
- New `GET /api/spools/{spool_id}/trace` endpoint.
- New `db.get_spool_trace(spool_id)` helper returns:
  - spool identity and current location
  - `usage_count`
  - `usage_total_g`
  - per-print usage rows derived from `prints.spool_usage`
- `get_prints_for_day()` now includes decoded `spool_usage` JSON for history print detail views.

### UI
- New route: `#/spool/{id}`
- New spool detail page:
  - colour band, spool #, material/subtype, brand, location
  - remaining weight and progress bar
  - consumed/traced stats
  - notes
  - print usage list with print name, printer, date, slot, grams, final state
- Spool inventory card/table rows now include a Details link.
- Print history detail now shows a Spool usage block when a print has `spool_usage`, linking each spool to its detail page.
- Static cache-bust bumped to `v=31`.

### Verification
- Python compile: `python -m py_compile app/db.py app/main.py`
- FastAPI import smoke: `import app.main`
- JS syntax: `node --check app/static/app.js` via `nvm`
- Spool trace DB smoke test against temporary SQLite DB:
  - create spool
  - create finished print
  - write slot snapshot
  - deduct usage
  - verify spool trace lists the print
  - verify history day print includes decoded `spool_usage`
- Service restart still needs interactive sudo from user after deploy

### Follow-up note
- Smoke testing surfaced an existing non-fatal SQLite lock warning in `log_decision()` during spool deduction (`spool_deducted` logging inside a write transaction). Spool deduction and `prints.spool_usage` still write correctly. Consider tidying decision logging around spool deduction in a small future cleanup.

### UI polish follow-up
- Spool inventory `Details` links now use the same lighter pill treatment as the `Edit` button, with cache-bust bumped to `v=32`.

---

## What was built — Session 21 (Failure review — 26 May)

Evidence-based failure review was added as a top-level operational view. It reports observed patterns without claiming causality.

### Backend
- New `GET /api/failures?days=N` endpoint.
- New `db.get_failure_review(days)` helper returns:
  - recent `ERROR`, `CANCELLED`, `ESTOP` prints
  - decoded `spool_usage`
  - snapshot availability
  - progress percent where layer counts exist
  - timing bucket: first 10m / first 25% / mid-print / late print / unknown
  - summary buckets by printer, material, final state, timing, and spool
- Query window is clamped to 1-365 days and returns up to 200 recent rows.

### UI
- New top-level `Failures` tab: `#/failures`
- Failure Review page:
  - 30/90/180/365 day selector
  - filters for printer, state, material
  - summary cards for observed patterns
  - recent failure/cancel list with snapshot thumbnail when available
  - print name, printer, timestamp, material, timing bucket, progress, spool links, error text
- Static cache-bust bumped to `v=33`.

### Verification
- Python compile: `python -m py_compile app/db.py app/main.py`
- FastAPI import smoke: `import app.main`
- JS syntax: `node --check app/static/app.js` via `nvm`
- Failure review DB smoke test against temporary SQLite DB:
  - create failed print
  - verify row appears
  - verify progress/timing bucket
  - verify printer/material summaries
- Service restart still needs interactive sudo from user after deploy

### UI polish follow-up
- `By Timing` card renamed to `Failure Timing`.
- Empty `By Spool` summary card is hidden until spool-linked failures exist.
- Failure rows now include a subtle `History` link back to the printer history surface.
- Failure stat grid now auto-fits, so three-card and four-card states both fill the row cleanly.
- Static cache-bust bumped to `v=34`.

### Flicker fix
- Failure Review no longer re-renders on every websocket/dashboard tick while already active, preventing the brief `Loading...` flash.
- Static cache-bust bumped to `v=35`.

---

## What was built — Session 22 (Printer health score — 26 May)

Compact, explainable printer health was added to the main dashboard cards.

### Backend
- New `db.get_printer_health(printer_id)` helper computes:
  - status: `healthy`, `watch`, `attention`
  - label: `Healthy`, `Watch`, `Needs attention`
  - 14-day print count
  - 14-day failure/cancel count
  - 14-day early failure count
  - 14-day success rate when enough data exists
  - reason list
- Health reasons currently include:
  - due maintenance
  - recent failed/cancelled/estop prints
  - early failures
  - failed queue jobs
  - low recent success rate
- Health data is attached to `/api/printers` websocket/API payloads for each printer.

### UI
- Dashboard printer cards now show a health badge beside the existing state badge.
- Badge states:
  - Healthy: green
  - Watch: amber
  - Needs attention: red
- First health reason is shown as a compact muted line on the card.
- Full reason list is available in the badge tooltip.
- Static cache-bust bumped to `v=36`.

### Verification
- Python compile: `python -m py_compile app/db.py app/main.py`
- FastAPI import smoke: `import app.main`
- JS syntax: `node --check app/static/app.js` via `nvm`
- Printer health DB smoke test against temporary SQLite DB:
  - empty printer reports healthy
  - three recent early failures report attention
- Service restart still needs interactive sudo from user after deploy

---

## What was built — Session 23 (Scale + label hardware integration — 27 May)

First real hardware pass for the Dymo M10 scale and Brother QL-700 label printer.

### Backend
- Added `app/scale.py` for Dymo M10 reads via Linux HID device paths (`/dev/usb/hiddev0`, `/dev/hidraw*`), with stable-read sampling.
- Added `app/label_printer.py` for Brother QL-700 status detection, 40x30 label rendering, optional QR code generation, and USB print dispatch through `brother_ql`.
- New API endpoints:
  - `GET /api/scale/status`
  - `GET /api/scale/read`
  - `GET /api/label_printer/status`
  - `POST /api/label_printer/print/{spool_id}`
  - `POST /api/label_printer/test`
  - `POST /api/spools/{spool_id}/correct_weight`
- Added `empty_spool_weight_g` to spool and material cost records.
- Added decision log events for `scale_read`, `scale_unavailable`, `spool_weight_corrected`, `label_printed`, `label_print_failed`, and `label_printer_unavailable`.
- Added optional auto-label setting: `label_auto_print`.

### UI
- New Settings → Hardware tab with live status cards for:
  - Dymo M10 scale
  - Brother QL-700 label printer
- Hardware tab can read the scale and print a test label.
- Spool inventory cards/tables now include:
  - `Label` button to print a spool label
  - `Weigh` button to correct remaining grams from the scale
- Add/Edit Spool modal now includes:
  - `Empty spool` tare weight
  - `Weigh` button that reads scale grams and subtracts the tare
- Static cache-bust bumped to `v=37`.

### Dependencies
- Added to `requirements.txt`:
  - `pyusb==1.3.1`
  - `qrcode[pil]==8.2`
  - `brother-ql==0.9.4`

### Hardware setup notes
- Brother was previously detected as `04f9:2049` (Editor Lite mass-storage mode). Printing requires printer mode, expected `04f9:2042`.
- Scale was not visible during the first preflight; verify USB, udev rules, and permissions after plugging it in.
- Service restart still needs interactive sudo from user after deploy.

### Session 23.1 refinement
- Label renderer switched from fixed `40x30` to DK-22212 / 62mm continuous roll support.
- Brother print conversion now uses label type `62`.
- Spool label render size is now 696x520 px, roughly a compact 62mm x 44mm cut on the continuous roll.
- Hardware tab reports DK-22212 readiness when the printer is available.
- Scale read failures now tell the operator to wake the scale and retry when the Dymo is asleep/not detected.
- Static cache-bust bumped to `v=38`.

### Session 23.2 hardware detection note
- Real scale identified on the Pi as `0922:8009 Dymo-CoStar Corp. S250 Digital Postal Scale` / `DYMO M25 25 lb`.
- Scale detector now accepts both `0922:8004` and `0922:8009`.
- Current Pi permissions showed `/dev/hidraw0` and `/dev/usb/hiddev0` as `root:root` `0600`; user still needs udev rule / plugdev setup for service access.
- Brother still reports as `04f9:2049` Editor Lite mass-storage mode; printing requires switching it to printer mode.

### Session 23.3 spool inventory layout polish
- Settings layout widened from 1140px to a viewport-aware 1480px max and side-nav footprint tightened.
- Spool card grid now uses wider responsive cards (`minmax(320px, 1fr)`) instead of forcing three narrow columns.
- Spool card action rows wrap cleanly instead of crowding.
- Spool table padding/action spacing tightened to reduce horizontal scrolling.
- Static cache-bust bumped to `v=39`.

### Session 23.4 Brother USB permission detection
- Brother QL-700 now correctly detected in printer mode as `04f9:2042`.
- Actual print failed with `[Errno 13] Access denied (insufficient permissions)`.
- Device node observed as `/dev/bus/usb/003/004` owned by `root:lp` with `0664`; `flightdeck` was not in `lp`.
- Label printer status now checks USB node read/write access and reports permission denied instead of showing READY when print access will fail.
- Print errors now give an operator-facing permission hint.

### Session 23.5 tare defaults + label text layout
- Settings > Filament catalogue now exposes `Tare g` per material/brand.
- Add/Edit Spool now auto-fills `Empty spool` from the selected material/brand tare default for new spools.
- Existing per-spool tare overrides are preserved when editing.
- Scale-backed weigh flow continues to calculate remaining filament as gross scale weight minus tare.
- DK-22212 label layout no longer prints a heavy colour swatch; it uses material/subtype, brand, colour name, spool number, QR, label weight, and date as text.
- Label render height reduced from 520px to 430px to waste less continuous tape.
- Static cache-bust bumped to `v=40`.

### Session 23.6 compact spool cards + colour hex on labels
- Spool cards changed to a denser preview layout:
  - grid minimum width reduced from 320px to 260px
  - card header height reduced from 60px to 42px
  - card padding/type/actions tightened
  - primary actions ordered as Details / Label / Weigh / Edit, with utility icon actions pushed right
- Printed labels now include the colour hex code beside the colour name.
- Static cache-bust bumped to `v=41`.

### Session 23.7 card action polish
- Spool card utility icon actions are now compact text buttons (`Copy`, `Reset`, `Archive`, `Delete`) matching the rest of the card action language.
- Utility actions remain visually secondary; delete is styled as a muted danger action.
- Static cache-bust bumped to `v=42`.

### Session 23.8 table action + density polish
- Spool table actions now use the same compact text button language as card actions.
- Spool summary cards, filter spacing, and table row padding tightened slightly.
- Static cache-bust bumped to `v=43`.

### Session 24 navigation refactor
- Primary app navigation moved from the crowded top tab strip to a persistent left sidebar.
- Sidebar groups:
  - Dashboard
  - Printers
  - Operations: Cameras, Queue, Failures, Spools
  - System: Settings
- Printer-specific Live / History / Maintenance tabs remain horizontal inside each printer page.
- Settings categories now render as horizontal section tabs inside Settings instead of another left rail.
- Added deep links for Settings categories, including `#/settings/spools`; `#/spools` routes directly to the Spools settings category.
- Mobile keeps the primary nav as a horizontal scroll strip.
- Static cache-bust bumped to `v=44`.

### Session 24.1 sidebar heading polish
- Sidebar section headings now use a soft blue accent (`#7aa2d8`) instead of muted grey.
- Added subtle divider lines above sidebar sections to improve scan structure.
- Static cache-bust bumped to `v=45`.

### Session 25 dashboard command overview
- Dashboard now opens with a compact fleet overview strip before the printer cards.
- Added live KPI tiles for total printers, printing, paused, faults, health warnings, and offline printers.
- Added a "Needs attention" panel that links directly to affected printer pages.
- Dashboard printer cards now sort by urgency first: E-stop/error, health attention, paused/watch, printing, offline, finished, idle.
- Static cache-bust bumped to `v=46`.

### Session 25.1 dashboard density polish
- Dashboard KPI tiles were shortened and capped to compact widths so the top overview stops dominating the page.
- Printer card status badges now wrap and use slightly tighter sizing, preventing `Idle` from clipping when health and filament badges are also shown.
- Static cache-bust bumped to `v=47`.

### Session 25.2 stats page + real spool locations
- Dashboard is printer-first again: fleet KPI/attention overview moved to a dedicated `#/stats` page and sidebar item.
- Printer card health lines remain underneath the related printer, keeping attention information beside the affected machine.
- Added backend `spool_locations` storage model and `storage_location_id` on spools.
- Added `/api/spool-locations` endpoints for list/create/update/archive.
- Added Settings > Locations screen for defining real storage locations such as shelves, dry boxes, tubs, or bays.
- Spool add/edit now lets a spool be stored at one of those named locations or loaded on a printer slot.
- Spool cards, table rows, and detail text now show the named storage location instead of generic `Storage`.
- Static cache-bust bumped to `v=48`.

### Session 25.3 spool label hex/location polish
- Spool labels now print the colour hex code on its own dedicated line so it cannot be crowded out by longer colour names.
- Spool labels now include `Loc: <storage location>` only when the spool is stored, not when it is loaded on a printer.
- Spool API records now include `storage_location_name` for label rendering and UI display.

### Session 25.4 spool label location reliability
- Label renderer now computes a dedicated storage-location line and treats blank printer IDs as stored spools.
- Location text is drawn larger and higher on the label so it is more visible on DK-22212 prints.
- Location fallback now accepts either `storage_location_name`, `storage_location`, or `Storage`.

### Session 25.5 spool label location placement
- Stored-spool location moved to the top-right of the label above the QR code.
- Printer-loaded spools still omit location text entirely.

### Session 26 location overview
- Settings > Locations now includes a physical overview grouped by storage location.
- Each location card shows spool count, remaining kg, notes, and the spools currently stored there.
- Stored spool rows show colour, material/subtype, brand, spool ID, remaining grams, and quick actions for Details, Label, and Edit.
- Added an Unassigned Storage card for stored spools without a named location.
- Static cache-bust bumped to `v=49`.

### Session 27 interactive AMS/MMU slots
- AMS and MMU slots/gates on printer Live pages are now clickable slot editors.
- Slot editor shows the current Flightdeck spool assignment, with quick Details, Label, Weigh, and Clear slot actions.
- Stored spools can be assigned directly into the clicked printer slot/gate from the slot editor.
- Assigned slots show the mapped spool ID under the slot and receive a subtle green mapped ring.
- Empty AMS/MMU slots remain visible and clickable so spools can be assigned before the printer reports filament.
- Static cache-bust bumped to `v=50`.

### Session 27.1 AMS/MMU mismatch warnings
- AMS/MMU slots now show an amber warning marker when the printer-reported filament and Flightdeck assignment disagree.
- Warnings cover unassigned printer-loaded filament, assigned spool while printer reports empty, material mismatch, and large colour mismatch.
- Slot editor now shows the printer-reported slot state and a plain-text warning when a mismatch is detected.
- Static cache-bust bumped to `v=51`.

### Session 27.2 slot editor picker polish
- Slot editor now uses a searchable stored-spool picker instead of a long plain dropdown.
- Stored spool choices show colour, material/subtype, brand, spool ID, remaining weight, percent, and storage location.
- Clearing a slot now lets the user choose the storage location to return the spool to.
- Static cache-bust bumped to `v=52`.

### Session 27.3 spool colour paint chart
- Spool modal fixed colour swatches now render as a bounded paint-chart grid instead of a long wrapping toolbar.
- Swatches use square paint chips with stable sizing and vertical scrolling when needed.
- Previously-used colour picks now render as a compact paint chart sorted by spool number and include the spool ID.
- Static cache-bust bumped to `v=53`.

### Session 27.4 spool inventory paint chart
- Main Spools `Cards` view now behaves like a compact paint chart instead of large inventory cards.
- Colour tile cards are smaller, colour-led, and ordered by spool number.
- Card metadata and actions were tightened to fit many more spools on screen while preserving Info, Label, Weigh, Edit, Copy, Reset, Archive, and Delete.
- Static cache-bust bumped to `v=54`.

### Session 27.5 spool action columns
- Added a `Columns` menu to the Spools header so card quick actions can be toggled on/off per browser.
- Spool cards now keep selected quick actions visible and move the full action list into a compact `Actions` dropdown on each card.
- Paint-chart cards were tightened again so more colour tiles fit per row while still keeping all functions available.
- Static cache-bust bumped to `v=55`.

### Session 27.6 spool menu clipping fix
- Fixed the Spools `Columns` dropdown being painted underneath the spool cards.
- Settings content now allows Spools dropdown overlays to render above the page content.
- Static cache-bust bumped to `v=56`.

### Session 27.7 previous colour pills
- Reverted the Add/Edit Spool modal `Previously used` colour picks back to the compact pill buttons.
- Main Spools card paint-chart view was left unchanged.
- Static cache-bust bumped to `v=57`.

### Session 27.8 columns menu spacing
- Spools now adds temporary vertical space below the header while the `Columns` menu is open.
- This keeps the summary/cards from sitting underneath the open columns checklist.
- Static cache-bust bumped to `v=58`.

### Session 28.1 spool intelligence panel
- Added `/api/spools/intelligence`, aggregating recent spool deductions, unattributed finished prints, loaded low-stock risk, overdraw events, and most-used spools.
- Spools page now has a `Spool Intelligence` panel showing the last 30 days of auto-deduct tracking and recent usage.
- This surfaces the existing print-finish deduction engine instead of leaving `spool_usage` hidden in history/detail views.
- Static cache-bust bumped to `v=59`.

### Session 28.2 simplified spool card actions
- Removed the Spools `Columns` button and per-browser quick-action chooser.
- Spool cards now always show only `Label`, `Edit`, and `Actions` on the card footer.
- The `Actions` dropdown still exposes the full function set: Info, Label, Weigh, Edit, Copy, Reset, Archive, and Delete.
- Removed the temporary spacing behavior that existed only for the old `Columns` menu.
- Static cache-bust bumped to `v=60`.

### Session 28.3 fixed spool cockpit
- Spools page now keeps the inventory controls, intelligence panel, summary cards, and filter chips fixed while the card/table list scrolls underneath.
- Both Cards and Table views use the same dedicated `#spool-list` scroll region.
- Table headers now stay visible inside the scrolling list.
- Static cache-bust bumped to `v=61`.

### Session 28.4 H2D camera + Spools top-level
- Spools moved out of Settings into its own top-level `#/spools` view; Settings no longer shows a Spools subtab.
- Old `#/settings/spools` routes now land on the top-level Spools view.
- Bambu RTSP camera proxy now transcodes a lighter 1280px-wide MJPEG stream at 8fps/q5 with low-latency ffmpeg flags to help H2D start reliably in-browser.
- Frontend camera images now use cache-busted stream URLs and retry failed image loads.
- Static cache-bust bumped to `v=62`.

### Session 28.5 Spools nav cleanup
- Standalone Spools view now strips any leftover Settings subnav from the Spools container.
- Added a defensive CSS guard so Settings tabs cannot show inside `#view-spools`.
- Static cache-bust bumped to `v=63`.

### Session 28.6 live light controls
- Live printer detail controls now include light buttons.
- Bambu printers expose `Light On` / `Light Off` via the installed Bambu MQTT API.
- Greyhound Voron exposes `Bars On` / `Bars Off` through Moonraker gcode macros (`STATUS_IDLE` / `STATUS_SLEEP`).
- Light commands are allowed whenever the printer is not offline and clear their pending UI state quickly after the request succeeds.
- Static cache-bust bumped to `v=64`.

### Session 28.7 Bambu light command fix
- Bambu light control no longer uses the library's generic `system.led_mode` command.
- X1C/H2D light buttons now publish Bambu `print.command=ledctrl` with `led_node=chamber_light` and `led_mode=on/off`.
- Static cache-bust bumped to `v=65`.

### Session 28.8 Bambu light badge
- Printer status now includes Bambu chamber light state from `lights_report`.
- Bambu model text glows when `light_state` is `on` and dims when `off`/`unknown`.
- Light button clicks apply an optimistic glow/dim immediately, then settle to the reported MQTT state.
- Static cache-bust bumped to `v=66`.

### Session 28.9 Bambu word toggle
- Removed separate `Light On` / `Light Off` buttons from Bambu live controls.
- Added a single glowing `Bambu` word control; clicking it toggles the chamber light on/off.
- Bambu model labels remain clickable light toggles and stop dashboard/camera tile navigation when clicked directly.
- Static cache-bust bumped to `v=67`.

### Session 28.10 Bambu camera/light recovery
- Bambu RTSP watchdog now detects byte-identical frozen frames, not just missing frames, and recycles ffmpeg after 8 seconds of frozen output.
- Bambu light control now publishes `system.command=ledctrl` with `led_node=chamber_light` and timing fields, matching known Bambu MQTT light commands.
- This fixes the case where Flightdeck returned `200 OK` but H2D/X1C ignored the previous `print.command=ledctrl` payload.

### Session 28.11 printer label cleanup
- Sidebar printer links now use machine model names (`Voron`, `X1C`, `H2D`) instead of shop/custom names.
- Queue printer group labels now use the same machine names.
- Shop/custom names remain unchanged as secondary labels on cards/detail/camera surfaces.
- Static cache-bust bumped to `v=68`.

### Session 28.12 H2D paired light control
- H2D light on/off now publishes the same MQTT command to `chamber_light`, `chamber_light2`, and `work_light` so both light bars move together.
- Bambu light state now reads all reported light modes and treats the printer as lit if any known channel is on.
- Removed the duplicate Bambu light click path on the printer detail view so one click sends one toggle command.
- Static cache-bust bumped to `v=69`.

### Session 28.13 shelf location cleanup
- Removed the generic seeded `Storage` location and kept the default physical shelf locations (`Shelf #1`, `Shelf #2`, `Shelf #3`).
- Startup migration moves any spools still assigned to `Storage` onto `Shelf #1` before archiving the generic location.
- Location fallback labels now read `Unassigned` instead of `Storage`.
- The Locations settings content and each shelf's spool list are scrollable so long shelf lists remain reachable.
- Static cache-bust bumped to `v=70`.

### Session 28.14 AMS slot metadata sync
- Assigning a Flightdeck spool to a Bambu AMS slot now best-effort syncs the printer's own AMS metadata using Bambu `ams_filament_setting`.
- Moving a spool away from a Bambu AMS slot now best-effort clears that printer slot's filament metadata.
- Generic Flightdeck materials are mapped to Bambu-compatible material families (`PLA`, `ASA`, `ABS`, `PETG`, `TPU`, etc.) before publishing.
- The spool modal keeps the friendly `Storage:` label, while the Locations overview stays shelf-only.
- Static cache-bust bumped to `v=71`.

### Session 28.15 AMS drying control
- AMS units now expose humidity, temperature, drying countdown, and drying capability when reported by Bambu MQTT.
- Heated AMS units such as AMS HT can be started/stopped from the live AMS panel using Bambu `ams_filament_drying`.
- Default manual dry cycle is conservative: 45°C for 12 hours, no tray rotation; Stop sends Bambu's drying-off payload.
- Static cache-bust bumped to `v=72`.

### Session 28.16 AMS drying presets
- Raw H2D MQTT inspection showed `humidity_raw` is the actual RH value and `humidity` is Bambu's level indicator.
- AMS parsing now uses `humidity_raw` for `% RH` and keeps Bambu's level separately as `humidity_level`.
- Drying payload now includes Bambu's reported setting fields: `dry_filament`, `dry_temperature`, and `dry_duration`.
- Drying now opens a Flightdeck dialog with filament presets (`PLA`, `PETG`, `ABS`, `ASA`, `TPU`, `PA`, `PC`), temperature, duration, and rotate option.
- Static cache-bust bumped to `v=73`.

### Session 28.17 AMS drying screen polish
- Reworked the AMS drying dialog into a richer Flightdeck control surface with AMS/printer subtitle, RH/temp/state chips, preset selector, sliders, rotate toggle, and stronger Start/Stop actions.
- Temperature and duration controls now use range sliders with live readouts and preset-driven defaults.
- Static cache-bust bumped to `v=74`.

### Session 28.18 safe restart helper
- Added `scripts/safe-restart-flightdeck.sh` for restarts that hang on lingering Bambu RTSP `ffmpeg` or Flightdeck `uvicorn` processes.
- Helper stops `flightdeck.service` with a timeout, terminates only Flightdeck-owned leftovers, starts the service, and prints a compact `/api/printers` health check.
- README now documents `sudo ./scripts/safe-restart-flightdeck.sh`.

### Session 28.19 Mission Control v1
- Added a new top-level `Mission Control` navigation screen (`#/mission`).
- Mission Control combines printer state, queue jobs, spool inventory, health reasons, and maintenance data into a fleet forecast view.
- Added fleet KPIs for pending jobs, blocked jobs, caution jobs, and queued time forecast.
- Added per-printer mission lanes with current action, queue timeline blocks, loaded spool pills, and operator signals.
- Added a right-side Next Dispatch panel that ranks upcoming queued/blocked work.
- Static cache-bust bumped to `v=75`.

### Session 28.20 Mission Control anti-flicker
- Fixed Mission Control flashing by keeping the rendered screen visible while refresh data loads.
- Added an in-flight render guard so websocket ticks cannot stack overlapping Mission Control refreshes.
- Mission Control now only swaps DOM markup when the generated view actually changes.
- Static cache-bust bumped to `v=76`.

### Session 28.21 Mission Control fleet scaling
- Fixed Mission Control queue detail overflow by constraining long queue blocks and filenames inside their lane.
- Added automatic dense fleet mode for Mission Control once the printer count reaches 8+ printers.
- Dense mode changes lanes into a multi-column fleet board and limits visible queue blocks per printer with a `+N more` queue link.
- Static cache-bust bumped to `v=77`.

### Session 28.22 AMS drying polish/fix
- Changed AMS drying MQTT command payload to the lean firmware-compatible `ams_filament_drying` shape.
- Capped AMS 2 Pro drying temperature at 65°C while keeping AMS HT up to 85°C.
- Changed AMS drying UI accents from orange to Flightdeck blue.
- Tightened AMS slot sizing and spacing so four-slot AMS rows fit in the live sidebar without wrapping.
- Static cache-bust bumped to `v=78`.

### Session 28.23 AMS drying diagnostics
- Matched Flightdeck's AMS drying payload to the observed Bambu MQTT wire shape, including `filament` and `close_power_conflict`.
- Parsed Bambu `dry_sf_reason`, `dry_status`, and `dry_sub_status` from raw AMS MQTT.
- Added backend guardrails so blocked drying starts return a useful 409 error instead of silently doing nothing.
- Added AMS drying modal warning text for known block reasons such as filament sitting at the AMS outlet.
- Static cache-bust bumped to `v=79`.

### Session 28.24 Mission Control dispatch board
- Added Mission Control status filters for All, Ready, Printing, Needs attention, and Blocked printers.
- Split the side panel into `Dispatch Ready` and `Blocked` queue lists so startable work and queue issues are separated.
- Added a 30-printer simulation toggle on Mission Control to stress-test dense fleet layout without changing real printer config.
- Added lane bucket styling and empty-filter states for the dispatch board.
- Static cache-bust bumped to `v=80`.

### Session 28.25 Simulated camera wall
- Added a `View 30 cameras` link when Mission Control's 30-printer simulation is active.
- Added `#/cameras?sim=30`, which renders thirty simulated camera tiles using the existing real camera sources instead of opening thirty unique feeds.
- Simulated camera tiles are clearly labelled and use a denser grid for wall-scale layout testing.
- Static cache-bust bumped to `v=81`.

### Session 28.26 Dispatch intelligence v1
- Added advisory Dispatch Intel to Mission Control's side panel.
- Dispatch Intel scores queued pending jobs against each real printer by availability, loaded matching material, stock level, health, maintenance, and current queue target.
- Recommendations are read-only and do not move, start, or retarget queue jobs.
- Static cache-bust bumped to `v=82`.

### Session 28.27 Dispatch material rescue
- Dispatch Intel now explains material rescue paths for pending jobs.
- It distinguishes ready-now loaded filament, same-printer slot selection, shelf/storage spool loading, and no-single-spool-enough cases.
- Rescue hints include spool number, material/brand, remaining grams, and storage/slot location.
- Static cache-bust bumped to `v=83`.

### Session 28.28 Mission Control sidebar compacting
- Tightened Mission Control right-panel job cards to reduce overflow.
- Added clamping/ellipsis for long Dispatch Intel filenames and recommendation text.
- Gave the sidebar a responsive width clamp while keeping the main printer lanes flexible.
- Static cache-bust bumped to `v=84`.

### Session 28.29 Queue colour-aware dispatch
- Added `filament_colors` metadata to queued jobs and 3MF parsing.
- Queue preflight now treats slicer filament colours as a constraint when colour metadata is present.
- Mission Control Dispatch Intel now displays required colours and only suggests loaded/shelf spools whose colours match within tolerance.
- Existing queued 3MF files can be backfilled from their saved upload files.
- Static cache-bust bumped to `v=85`.

### Session 28.30 Multi-colour dispatch coverage
- Backfilled existing queued 3MF files so the current queue now exposes slicer colour metadata through `/api/queue`.
- Tightened Mission Control Dispatch Intel so multi-colour jobs require coverage for every required colour, not just one matching colour.
- Dispatch rescue hints now pick per-colour spool coverage before suggesting loaded, same-printer, shelf, or mixed stock paths.
- Printer recommendation scoring now treats partial colour coverage as a weaker match instead of calling it fully ready.
- Static cache-bust bumped to `v=86`.

### Session 28.31 Queue preflight colour coverage
- Queue preflight now groups slicer filament colour metadata by required colour and grams.
- Multi-colour queued jobs now check each loaded colour independently instead of summing all matching-material loaded spools.
- Preflight block messages now identify the short colour directly, e.g. `Loaded colour coverage short: #FFFFFF 118g/280g`.
- Restarted `flightdeck.service`; API health is OK after startup.

### Session 28.32 Friendly colour names
- Preflight colour shortfall messages now display nearest plain colour names such as `White 118g/280g` instead of raw hex values.
- Mission Control Dispatch Intel now shows required colour names like `White / Brown` instead of `#FFFFFF / #7C4B00`.
- Colour matching still uses hex distance tolerance under the hood so near-white/off-white slicer values can match a white spool.
- Static cache-bust bumped to `v=87`.

### Session 28.33 Brand-aware colour coverage
- Queue preflight colour shortfall messages now include matching loaded inventory brands, e.g. `White (3DFillies) 118g/280g`.
- If no loaded spool matches the required colour/material, preflight says `White (no loaded spool) 0g/280g`.
- Mission Control missing-colour rescue text now includes candidate brand and grams where possible.
- Static cache-bust bumped to `v=88`.

### Session 28.34 Dispatch Intel duplicate grouping
- Mission Control Dispatch Intel now groups duplicate pending jobs by filename, material, grams, and required colours.
- Duplicate queue copies are shown as one advisory row with a `N queue copies` note instead of repeated recommendations.
- Recommendation change detection now treats any duplicate target as already represented, avoiding noisy `Recommend H2D` wording for a copy already queued to H2D.
- Static cache-bust bumped to `v=89`.

### Session 28.35 Queue Fix It panel
- Added a Mission Control `Fix It` panel between `Blocked` and `Dispatch Intel`.
- Fix It groups duplicate blocked queue jobs and translates preflight failures into physical next actions.
- Colour-aware steps can suggest loading a specific shelf spool, adding/loading a missing colour, or checking a short loaded colour/brand.
- Duplicate queue copies use the best matching target printer for advice, so H2D-targetable copies get H2D-focused steps.
- Static cache-bust bumped to `v=90`.

### Session 28.36 Filament catalogue import
- Added local SQLite `filament_catalog` cache for brand/material/product/colour/hex/weight/tare data.
- Added Open Filament Database sync/search endpoints:
  - `POST /api/filament/catalog/sync`
  - `GET /api/filament/catalog/search`
  - `GET /api/filament/catalog/status`
- Add Spool modal now has a Catalogue search field and Sync button.
- Selecting a catalogue result fills material, brand, subtype/product, colour name, hex, label weight, and tare if known.
- Static cache-bust bumped to `v=91`.
- Fixed catalogue sync fetch headers/fallback mirror and timestamp handling.
- Sync verified on the Pi: imported 18k+ usable 1.75mm catalogue rows; `bambu white pla` returns Bambu Lab results.
- Catalogue search ordering now prioritises everyday materials for broad brand searches, so `bambu` shows PLA before ABS.
- Add Spool catalogue search now asks for 30 results instead of 12.
- Add Spool catalogue results panel is taller and includes a hint when broad searches return many matches.
- Static cache-bust bumped to `v=93`.

### Session 28.37 Catalogue-first spool modal
- Reworked Add Spool into a wider two-column modal.
- Left column is now a pinned catalogue browser with large searchable result cards.
- Right column is the spool confirmation/edit panel for material, brand, colour, weight, tare, location, and notes.
- Selecting a catalogue entry now shows a selected-source card while filling the spool fields.
- Mobile/narrow screens fall back to the stacked single-column flow.
- Static cache-bust bumped to `v=94`.

### Session 28.38 Catalogue picker polish
- Added quick catalogue chips for common materials and brands: PLA, PLA+, PETG, ASA, ABS, TPU, Bambu, 3DFillies, Polymaker.
- Catalogue selected-source card now shows `Open Filament Database · editable defaults` so imported values are clearly defaults.
- If the catalogue entry has no tare, Add Spool now falls back to the saved brand/material tare from Filament settings when available.
- Static cache-bust bumped to `v=95`.

### Session 28.39 Active AMS slot preflight guard
- Added a hard queue preflight guard for single-colour Bambu jobs when the printer-reported active AMS slot does not match the queued job's required material/colour.
- This catches cases where Flightdeck inventory says the right colour exists somewhere, but the printer is actually using another active tray.
- Example intended block: `Active AMS slot mismatch: printer is using AMS 1 slot 1 (Black PLA), expected Yellow PLA`.
- Deploy copied `app/main.py`, but service restart is pending because sudo requested a password. Run `sudo systemctl restart flightdeck.service`.

### Session 28.40 Catalogue chip cleanup
- Removed the `3DFillies` quick chip from the Add Spool catalogue picker because that brand is no longer in current use.
- Existing 3DFillies spool/history data is untouched.
- Static cache-bust bumped to `v=96`.

---

## Known issues

- Service restart pending for Sessions 18/19/20/21/22/23 until user runs `sudo systemctl restart flightdeck.service`.
- Hardware setup still needs real-device confirmation after deploy:
  - Brother QL-700 must be switched out of Editor Lite mass-storage mode before printing (`lsusb` should show `04f9:2042`, not `04f9:2049`).
  - Dymo M10 scale was not detected in the last preflight; plug/wake it and apply udev rules if `/dev/hidraw*` or `/dev/usb/hiddev*` is inaccessible.

---

## Next session priorities

### Latest dashboard attention cleanup
- Dashboard card health badges now only appear for actionable items, not ordinary failure-history review.
- Historical failure/success-rate context is shown as a quiet `Reliability` line that links to Failure Review.
- Mission Control no longer buckets printers into `Needs attention` or penalises dispatch score purely because of reliability history or low loaded-spool percentage.
- Mission Control attention is now reserved for current faults, paused/offline states, overdue maintenance, and failed queue jobs.
- Static cache-bust bumped to `style.css?v=91` and `app.js?v=104`.

### Mission Control Action Inbox
- Added an `Action Inbox` at the top of the Mission Control right panel, above the supporting legend/note.
- Inbox entries are derived from live printer state, maintenance due, failed queue jobs, blocked preflight, and queue cautions.
- Empty state now reads `Clear deck` so the panel still confirms there is nothing active to do.
- Static cache-bust bumped to `style.css?v=92` and `app.js?v=105`.

### Stats page upgrade
- Reworked Stats from a plain dashboard KPI repeat into a fleet telemetry page.
- Added operator pulse, fleet/material/inventory/reliability KPI cards, filament trend chart, material and inventory bar panels, spool tracking panel, most-used spools, and printer balance table.
- Stats uses existing endpoints only: `/api/filament/summary`, `/api/spools/summary`, `/api/spools`, `/api/spools/intelligence`, `/api/failures`, and `/api/queue`.
- Static cache-bust bumped to `style.css?v=93` and `app.js?v=106`.

### Stats AMS humidity
- Added AMS RH to the Stats KPI strip with average RH, max RH, and sensor count.
- Added an `AMS Humidity` panel showing each AMS/HT humidity and temperature reading by printer.
- RH status colours are currently green under 35%, amber from 35%, and red from 45%.
- Static cache-bust bumped to `style.css?v=94` and `app.js?v=107`.

### Stats renamed to Telemetry
- Sidebar label changed from `Stats` to `Telemetry`.
- Page eyebrow/loading/error copy changed to telemetry language.
- Route remains `#/stats` for compatibility with existing links and browser history.
- Static cache-bust bumped to `app.js?v=108` only.

### Telemetry drill-downs
- `#/stats` now accepts query params without dropping back to the dashboard.
- Telemetry printer KPI links to `#/stats?focus=printers`, highlighting Printer Balance.
- AMS RH KPI and AMS Humidity panel link to `#/stats?focus=rh`, which opens a Humidity Detail drill-down.
- Humidity Detail shows the highest RH bay first with a dry/watch/ok recommendation and the full AMS RH list underneath.
- Static cache-bust bumped to `style.css?v=95` and `app.js?v=109`.

### Moisture Watch
- Added a current-conditions Moisture Watch classifier using AMS RH telemetry.
- Status thresholds match RH colours: stable under 35%, watch from 35%, drying suggested from 45%.
- Telemetry RH detail now separates Moisture Watch recommendations from raw sensor readings.
- Mission Control Action Inbox now surfaces amber/red Moisture Watch items as operator actions linking to `#/stats?focus=rh`.
- Static cache-bust bumped to `style.css?v=96` and `app.js?v=110`.

### Moisture Watch persistence
- Moisture Watch now keeps a lightweight browser-side timer per AMS bay so alerts include how long the RH condition has persisted; it uses local storage with an in-memory fallback for embedded browsers.
- Telemetry still shows current watch/dry conditions immediately, but Mission Control only raises operator actions after persistence thresholds: watch for 15m, dry for 5m.
- Non-persistent RH rows show "Tracking before Mission Control alert" to make the quiet period visible.
- Static cache-bust bumped to `style.css?v=97` and `app.js?v=111`.

### Spool edit clear fix
- Fixed `PUT /api/spools/{id}` so explicitly cleared optional fields, such as subtype, are written as `NULL` instead of being ignored.
- This fixes the edit form reverting a removed subtype back to the old value.

### Flight Tower rename
- Renamed the visible `Mission Control` screen/nav wording to `Flight Tower`.
- Internal route remains `#/mission` for compatibility.
- Static cache-bust bumped to `app.js?v=112`.

### Spool confidence
- Added a backend confidence signal for spool remaining weights using entry age, print deductions, scale reconciles, tare presence, low-stock state, and overdraw history.
- Spool cards and table now show `Verified`, `Estimated`, or `Needs weigh-in` with a score tooltip.
- Spool detail now includes a Weight Confidence panel with short reasons.
- Static cache-bust bumped to `style.css?v=98` and `app.js?v=113`.

### Filament cabinet view
- Added a third Spools view mode: `Cabinet`.
- Cabinet groups stored spools by configured shelf/location and sorts tiles by spool number like a paint chart.
- Each shelf lane scrolls independently and shows colour, spool number, material, brand, remaining grams, plus quick Label/Edit actions.
- Loaded printer spools appear in a separate Loaded lane when included by filters.
- Static cache-bust bumped to `style.css?v=99` and `app.js?v=114`.

### File Desk v1
- Added a new `Files` navigation screen for a read-only file desk.
- Pi print library defaults to `/home/flightdeck/print_library`.
- `GET /api/files` lists the Pi library, Voron Moonraker gcodes, and Bambu SD cards through existing LAN/FTPS details.
- Bambu targets expose `format_sd` capability metadata but no destructive format action is wired yet.
- Static cache-bust bumped to `style.css?v=100` and `app.js?v=115`.

### File Desk anti-flicker
- File Desk now keeps the previous rendered screen visible during refresh.
- Added an in-flight render guard so websocket/router refreshes cannot stack overlapping File Desk fetches.
- DOM is only swapped when the generated File Desk HTML actually changes.
- Static cache-bust bumped to `app.js?v=116`.

### File Desk queue action
- Added `POST /api/files/queue` to copy a File Desk item into the normal Flightdeck queue storage and create a pending queue job.
- Supports Pi library, Bambu SD files via FTPS, and Voron Moonraker files.
- Queue action only appears for compatible target types: `.3mf/.gcode.3mf` to Bambu, `.gcode/.gcode.gz/.ufp` to Moonraker.
- File Desk rows now have a `Queue` action that prompts for the compatible target printer and then jumps to Queue.
- Static cache-bust bumped to `style.css?v=101` and `app.js?v=117`.

### File Desk queue picker polish
- Replaced the native browser `prompt()`/`alert()` queue flow with an in-app Flightdeck modal picker.
- Moved the `Queue` action into the filename cell so it is visible without horizontal scrolling.
- Removed the separate Path/Actions columns; the path now sits under the filename in muted text.
- Queue cancel/close no longer leaves stale `Queued`/clicked button state behind when returning to Files.
- Static cache-bust bumped to `style.css?v=102` and `app.js?v=118`.

### File Desk and Queue native dialog cleanup
- File Desk now hides non-printable rows, so Bambu utility folders such as `ipcam`, `timelapse`, and `System Volume Information` no longer appear as printable items even when the SD card reports them as files.
- Queue job removal now uses the in-app Flightdeck confirmation modal instead of the browser `confirm()` dialog.
- Queue action failures now use Flightdeck toast errors instead of browser alerts.
- Static cache-bust bumped to `app.js?v=119`.

### File Desk Bambu SD cleanout
- Added guarded Bambu-only SD cleanout from File Desk.
- Backend endpoint: `POST /api/files/bambu/{printer_id}/clear`.
- The action requires typed `CLEAR`, refuses to run while the printer is printing/paused, and deletes printable `.3mf` jobs from the SD root while leaving utility folders alone.
- UI exposes `Clear SD prints` only on Bambu File Desk targets, with an in-app confirmation dialog and toast result.
- Static cache-bust bumped to `style.css?v=103` and `app.js?v=120`.

### File Desk copy and delete actions
- Added `Copy` row action for pulling Bambu SD or Voron Moonraker files into the Pi Library.
- Backend endpoint: `POST /api/files/library/copy`; duplicate filenames are kept by adding a numeric suffix.
- Added guarded `Delete` row action for Pi Library, Bambu SD, and Moonraker files.
- Backend endpoint: `DELETE /api/files`; requires typed `DELETE` and only permits supported printable file types.
- File Desk rows now show `Queue`, `Copy` (when not already in library), and `Delete` grouped beside the filename.
- Static cache-bust bumped to `style.css?v=104` and `app.js?v=121`.

### File Desk bulk selection
- Reworked File Desk file actions around checkbox selection.
- Each target now has select-all plus per-file checkboxes.
- Row actions are quieter: `Queue` stays inline, while `Copy selected` and `Delete selected` live in a per-target bulk toolbar.
- Bulk copy runs selected files sequentially into Pi Library.
- Bulk delete requires typed `DELETE` and shows the selected filenames before removing them.
- Static cache-bust bumped to `style.css?v=105` and `app.js?v=122`.

### File Desk copy replace prompt
- Copy-to-library now detects filename conflicts instead of silently creating numbered duplicates.
- `POST /api/files/library/copy` returns `409` with conflict metadata when a matching Pi Library filename already exists.
- The bulk copy UI now asks whether to `Replace` or `Skip` each conflicting file and continues through the selected set.
- Static cache-bust bumped to `style.css?v=106` and `app.js?v=123`.

### File Desk command refresh polish
- File Desk commands no longer clear the render cache before refreshing.
- Copy, delete, clear-SD, and queue actions now keep the current File Desk visible while the refresh runs.
- The DOM only swaps when the actual file-list HTML changes, removing the brief loading/blank flash after commands.
- Static cache-bust bumped to `app.js?v=124`.

### Portable runtime data paths
- Added `app/paths.py` as the single runtime path resolver.
- Flightdeck now reads `.env` early and supports `FLIGHTDECK_DATA_DIR` plus explicit overrides for DB, uploads, printer config, and print library paths.
- Current Pi behavior is preserved until migration: repo-local `flightdeck.db`, repo-local `uploads/`, repo-local `printers.yaml`, and `/home/flightdeck/print_library`.
- Clean installs can keep live data outside git in `~/flightdeck-data`.
- Added `printers.yaml.example`, `flightdeck.service.example`, `scripts/install.sh`, `scripts/install-systemd.sh`, and `scripts/migrate-to-portable-data.sh`.
- Updated README install/migration notes.
- `printers.yaml` should be untracked from git so real printer IPs, access codes, and serials never ship in a clean clone.

### Settings preferences
- Added server-side default settings so fresh installs have sensible values before any UI changes.
- Added `Settings > Preferences` for system base URL, spool thresholds, default label weight, printed label fields, and queue colour matching posture.
- Label QR codes now use `system_base_url` instead of a hard-coded Tailscale URL.
- Label field toggles can hide colour, brand, or storage location on future spool labels.
- Add Spool now uses `default_label_weight_g`.
- Queue preflight colour mismatches respect `queue_strict_colour`: strict blocks, advisory warns.
- Static cache-bust bumped to `app.js?v=125`.

### Setup health
- Added `GET /api/setup/health` to audit the running install.
- Checks app checkout, data directory, SQLite DB, uploads, print library, printer config, base URL, ntfy, Dymo scale, QL-700, and systemd service status.
- Added `Settings > Setup` as the first settings tab with required/optional readiness summary and runtime path readout.
- Static cache-bust bumped to `style.css?v=107` and `app.js?v=126`.

### Notification centre
- Added persistent `notifications` table plus APIs to list, mark read, clear one, and clear all.
- Print complete, error, paused, and cancelled transitions now create in-app notifications while keeping ntfy/browser notifications.
- Header bell now opens a notification centre with unread count, recent events, click-through links, and clear actions.
- Browser notification permission can be enabled from inside the notification centre.
- Static cache-bust bumped to `style.css?v=108` and `app.js?v=127`.

### Radar header control
- Replaced the generic notification bell with a compact `RADAR` control and CSS radar mark.
- Notification centre behavior and unread badge are unchanged.
- Static cache-bust bumped to `style.css?v=109` and `app.js?v=128`.

### Browser dialog cleanup
- Replaced remaining native browser `alert` / `prompt` / `confirm` calls with Flightdeck-styled confirm/input modals and toasts.
- Covered spool reconcile, spool archive/reset/delete, weigh flows, label printing failures, AMS drying failures, filament catalogue sync/delete failures, and scale read failures.
- Hardware and catalogue failures now also write RADAR notification entries from the backend.
- Static cache-bust bumped to `style.css?v=110` and `app.js?v=129`.

### Grouped spool cards
- Card view now groups duplicate physical rolls that share material, subtype, brand, colour name/hex, and label weight.
- Each physical roll keeps its own spool number, detail page, label, edit, weigh, copy, reset, archive, and delete actions.
- Group cards show roll chips, combined remaining grams, combined label weight, location summary, and per-roll rows.
- Table and cabinet views still show individual rolls.
- Static cache-bust bumped to `style.css?v=111` and `app.js?v=130`.

### Grouped card polish
- Moved per-roll controls inside a compact expandable `Rolls` drawer on grouped cards.
- The default grouped card now reads like a paint-chart tile: colour, material, roll chips, combined remaining stock, and one compact drawer for individual actions.
- Static cache-bust bumped to `style.css?v=112` and `app.js?v=131`.

### App shell cache guard
- Static files and the root app shell now send `Cache-Control: no-store` so UI updates do not get stuck behind an old browser module.
- This requires a backend restart because it changes FastAPI static serving.

### Grouped spool compact pass
- Grouped cards now use the same grid footprint as normal spool cards instead of spanning two columns.
- Reduced visible grouped-card metadata and kept individual roll actions behind the `Rolls` drawer.
- Raised RADAR notification panel above the Spools toolbar/filter layer.
- Static cache-bust bumped to `style.css?v=113` and `app.js?v=132`.

### Grouped roll drawer polish
- Open grouped-card drawers now render as compact per-roll rows: spool number, grams, location, and one Actions menu.
- Removed always-visible Label/Edit buttons from each roll row to keep 3+ roll stacks readable.
- Static cache-bust bumped to `style.css?v=114` and `app.js?v=133`.

### Grouped drawer overflow fix
- Removed nested Actions dropdowns from grouped-card roll drawers because they could overlap neighbouring spool cards.
- Each roll row now exposes compact inline Label, Edit, and Info actions with no flyout.
- Static cache-bust bumped to `style.css?v=115` and `app.js?v=134`.

### Multiples spool filter
- Added a `Multiples` chip above the spool colour chart.
- The chip filters the current spool list down to duplicate physical rolls sharing the same material, subtype, brand, colour, and label weight.
- Static cache-bust bumped to `style.css?v=116` and `app.js?v=135`.

### Spool action row tidy
- Normal spool cards now use a fixed three-slot `Label / Edit / Actions` layout so buttons stay aligned across cards.
- Grouped drawer rows use the same three-slot alignment for `Label / Edit / Info`.
- Static cache-bust bumped to `style.css?v=117` and `app.js?v=136`.

### Spool card breathing room
- Increased colour-chart card minimum width slightly so `Actions` fits cleanly.
- Grouped drawer rows now use one compact `Manage` button per physical roll, opening a centred spool action picker.
- Static cache-bust bumped to `style.css?v=118` and `app.js?v=137`.

### Spool action clipping fix
- Increased the colour-chart card minimum width again for the real Spools viewport.
- Reduced action-button horizontal padding so `Label / Edit / Actions` fits without clipping.
- Static cache-bust bumped to `style.css?v=119` and `app.js?v=138`.

### Header status polish
- Centred the Flightdeck wordmark in the top header.
- Upsized the centred Flightdeck logo/wordmark so it anchors the header visually.
- Moved aggregate system state to the left side of the header.
- Renamed the old `RADAR` notification button to `Alerts`.
- Moved the clock into the left-hand system status cluster for better header balance.
- Swapped `Alerts` before the live radar so its dropdown opens inward instead of clipping off-screen.
- Made the alerts dropdown viewport-fixed so it cannot clip off the right edge on narrow windows.
- Added a deliberate mobile header stack: logo row, status row, then Alerts/Live row.
- Replaced the small live dot with a larger animated radar sweep for live/reconnect state.
- Static cache-bust bumped to `style.css?v=127` and `app.js?v=144`.

### Command palette
- Added a global command palette opened with `Ctrl/Cmd+K`.
- Palette supports searchable navigation for Dashboard, Flight Tower, Telemetry, Cameras, Queue, Files, Failures, Spools, and Settings.
- Added printer commands for live, history, and maintenance subtabs.
- Added spool commands for opening individual active spools, low-stock/loaded filters, cabinet view, and Add Spool.
- Palette supports keyboard operation: arrows to move, Enter to run, Escape to close.
- Empty palette now keeps the core navigation order before search ranking kicks in.
- Static cache-bust bumped to `style.css?v=128` and `app.js?v=146`.

### Spools catalogue workflow
- Add/Edit Spool modal now keeps the catalogue pane in its own scrollable column so the form/actions remain reachable.
- Moved filament catalogue management into Spools as a `Catalogue` view alongside Cards/Table/Cabinet.
- Moved the catalogue `Add material type` form to the top of the Catalogue view and made it sticky while the catalogue list scrolls below.
- Removed Filament from the Settings side navigation; legacy `#/settings/filament` redirects into `#/spools?view=catalogue`.
- Updated filament stats/catalogue links and command palette entry to point at the Spools catalogue view.
- Static cache-bust bumped to `style.css?v=130` and `app.js?v=148`.

### Command palette action polish
- Added printer `lights` commands that jump straight to the live controls for that printer.
- Added spool edit commands for each active spool.
- Added spool action commands for label/weigh/copy/reset/archive flows without firing hardware directly.
- Added a compact `Command Ctrl K` header button so the command palette is discoverable without knowing the shortcut.
- Static cache-bust bumped to `style.css?v=131` and `app.js?v=150`.

### Closing fixes (shipped same session)
- **Bambu filament metadata**: `get_preview()` now called proactively on first poll of any new print (same trigger as AMS snapshot). One-shot FTP call per job; cached on `subtask_name`. Ensures `filament_weight_g` and `material` are always populated for spool deduction, even when nobody views the detail page.
- **Spool snapshot overwrite on restart**: `write_slot_snapshot` now uses `WHERE ams_slot_snapshot IS NULL`. Post-restart the snapshot condition re-fires (in-memory state resets), but the original DB row is preserved. Spool deduction uses correct print-start slot assignments regardless of restarts.

---

### Hardware integration follow-up
- Physical device validation now remains:
  - disable Brother Editor Lite mode and confirm `lsusb` shows printer mode
  - plug/wake Dymo M10 and confirm readable HID node
  - install new requirements and restart service
- Once both devices are confirmed live, print a real spool label and do one scale-backed spool correction.
- QR codes via `qrcode[pil]` → `https://flightdeck.tail7de73e.ts.net/#/spool/{id}`

### Other queued ideas (not yet scoped)
- Print annotations (notes column on prints, "Add note" link in finish toast and history detail)
- Thumbnail gallery view of past prints
- ETA accuracy report (scatter chart per printer)

---

### Bambu AMS profile aliases
- Added a first-pass Bambu AMS profile alias table in `app/printers/bambu.py`.
- Confirmed custom profile `P461bccf` is treated as **Siddament ASA** with ASA temp/profile metadata.
- AMS parsing and print-start snapshots now fall back to alias brand/profile names when Bambu MQTT leaves `tray_sub_brands` / `tray_id_name` blank.
- Assigning a Flightdeck Siddament ASA spool to a Bambu AMS slot now sends `P461bccf` instead of generic ASA, so Flightdeck can preserve the user-created Bambu profile where possible.
- Built-in aliases also cover common Generic/Bambu PLA/ASA/PETG/TPU IDs for clearer future display.
- Frontend AMS tooltips now show the richer reported profile name/brand from Bambu (`Siddament ASA`, `Generic ASA`, etc.) instead of only the raw material.
- Static cache-bust bumped to `app.js?v=174`.

---

### Multi-filament spool deduction fix
- Fixed Bambu/H2D spool deduction so completed multi-filament jobs use the sliced 3MF per-colour `used_g` rows before falling back to the active AMS slot.
- This prevents H2D dual-nozzle jobs from charging the entire print weight to the first active slot.
- Repaired completed print `#118` (`can_openerV2`) from one usage row to two:
  - Spool `#3` / AMS 1 S1 / white: `68.38g`
  - Spool `#2` / AMS HT / red: `28.89g`
- Updated spool balances from the print-start snapshot:
  - Spool `#3`: `604.0g -> 535.62g`
  - Spool `#2`: `324.0g -> 295.11g`
- Weigh-in hints no longer trigger just because a print has multiple usage rows when the deduction was repaired or matched from sliced per-filament usage.

---

### Spool detail flashing fix
- Fixed spool detail page flashing by preventing printer polling from re-running `renderSpoolDetail()` for the same spool every tick.
- Spool detail now renders on navigation or when switching to a different spool, but background printer polling no longer replaces the page with `Loading...`.
- Static cache-bust bumped to `app.js?v=175`.

---

### AMS Profile Doctor first pass
- Extended the AMS slot modal into a lightweight Profile Doctor.
- Slot modal now shows a `Matched`, `Review`, `Empty`, or `Unassigned` status comparing Flightdeck assignment against the printer-reported AMS material/profile/colour.
- Added `Trust Flightdeck` action to re-push the assigned spool profile/colour to the printer AMS slot.
- Stored spool picker now ranks likely matches first and marks close material/colour matches as `Suggested`.
- Static cache-bust bumped to `style.css?v=152` and `app.js?v=176`.

### Actionable AMS mismatch badges
- Live printer warning chips now name the exact mismatched AMS slot instead of only showing a generic mismatch count when there is one mismatch.
- Clicking the mismatch chip opens that slot directly in the AMS Profile Doctor.
- Multi-mismatch chips still summarise the count, include all slot details in the tooltip, and open the first mismatched slot for fast triage.
- Static cache-bust bumped to `style.css?v=153` and `app.js?v=177`.

### Flight Tower AMS mismatch awareness
- Flight Tower printer lanes now include AMS mismatch signals from the same Profile Doctor truth layer.
- A printer with a mismatch now falls into `Needs attention` instead of looking ready/idle.
- Mission lane mismatch chips include the detailed mismatch reason in the tooltip.
- `Idle and available` is suppressed when another warning/fault signal is present, avoiding mixed messages.
- Static cache-bust bumped to `app.js?v=178`.

### Queue preflight AMS mismatch guard
- Queue preflight now compares Flightdeck spool assignments against printer-reported AMS slots.
- If a mismatch affects the queued job's required material/colour, the job is blocked before dispatch with a specific AMS slot reason.
- Unrelated AMS mismatches remain visible in Live/Flight Tower but do not block unrelated queue jobs.

### AMS Profile Doctor Trust Printer action
- Added the opposite repair path to `Trust Flightdeck`.
- `Trust Printer` updates the already-assigned Flightdeck spool from the live AMS report (material, colour, colour name, and brand when reported).
- If the printer reports the slot empty, `Trust Printer` clears that Flightdeck spool back to the selected storage location.
- Static cache-bust bumped to `app.js?v=179`.

### AMS profile/vendor mismatch tightening
- Profile Doctor no longer treats matching material/colour as fully matched when the Bambu-reported profile/vendor differs from Flightdeck.
- Non-generic brand/profile differences now show `Brand mismatch` or `Profile mismatch`.
- Generic printer profiles against a specific Flightdeck brand now show `Profile review`, which is useful for cases where Flightdeck knows the spool better than the AMS.
- Backend queue/Flight Tower mismatch checks use the same profile/vendor rules.
- Static cache-bust bumped to `app.js?v=180`.

### Richer Bambu AMS slot sync payload
- `Trust Flightdeck` now sends Flightdeck's own AMS filament payload instead of the bambulabs_api minimal helper.
- Payload still sends the required Bambu fields (`tray_info_idx`, colour, nozzle temperatures, and material type), but now also includes `tray_sub_brands` and `tray_id_name` when Flightdeck knows them.
- This is intended to help the printer touchscreen/UI show the same profile/vendor that Flightdeck and MQTT are already using.
- Empty-slot clears also send blank profile/vendor display fields.

### Flight Manual H2D dual-nozzle note
- Added a `Flight Manual` section to README.
- Documented the H2D dual-nozzle colour-print workflow learned during testing:
  - Trust Flightdeck when the physical spool/profile is correct.
  - Sync filament from AMS in the slicer.
  - Assign model colours.
  - Use Regroup and slice if the send dialog maps everything to one nozzle.
  - Confirm left/right nozzle grouping before sending.
- Captured the key gotcha: if the model has no geometry assigned to a colour, the slicer may leave that nozzle blank even when Flightdeck and the AMS are correct.

### AMS slot unload action
- Added a Bambu AMS unload command path from Flightdeck.
- Backend now exposes `POST /api/printers/{printer_id}/ams/unload`, calling Bambu's `unload_filament_spool()` and logging an `ams_unload_requested` decision.
- AMS Profile Doctor now shows `Unload AMS slot` when the printer reports filament loaded in the clicked slot.
- The action asks for confirmation and sends the printer unload/retract command without changing Flightdeck inventory; inventory still changes only after the printer reports empty or the operator clears/moves the spool.
- Static cache-bust bumped to `app.js?v=181`.

### AMS slot load action
- Added the matching Bambu AMS load command path.
- Backend now exposes `POST /api/printers/{printer_id}/ams/load`, calling Bambu's `load_filament_spool()` and logging an `ams_load_requested` decision.
- AMS Profile Doctor now shows `Load AMS slot` when the printer reports filament in the clicked slot.
- Like unload, this is a physical printer command only; it does not mutate Flightdeck spool inventory.
- Static cache-bust bumped to `app.js?v=182`.

### AMS load/unload active-slot refinement
- Tightened the AMS Profile Doctor actions so parked loaded slots show `Load AMS slot`, while the currently active/fed slot shows `Unload AMS slot`.
- Load now targets the clicked AMS tray instead of relying on Bambu's generic load helper.
- Load/unload commands now choose a safer temperature from the clicked slot's material instead of always using the library default.
- This should make AMS 2 slot 2 style cases clearer: load the parked slot first, then unload once it becomes active.
- Static cache-bust bumped to `app.js?v=183`.

### BambuStudio-shaped AMS load/unload commands
- Updated Flightdeck's Bambu AMS load/unload MQTT payloads to match captured Bambu command traffic more closely.
- Load now sends `ams_id`, `slot_id`, `target`, and `curr_temp/tar_temp=-1`.
- Unload now sends `slot_id=255` and `target=255`, with source `ams_id` derived from the clicked/active slot.
- This replaces the older bambulabs_api helper shape that was accepted by MQTT but ignored by the H2D AMS state machine.

### Voron live camera proxy
- Fixed the Voron/Greyhound Elite V2 live feed path for HTTPS/Tailscale use.
- `mjpeg_direct` cameras now advertise a same-origin Flightdeck proxy URL (`/api/camera/{printer_id}/stream`) instead of returning the printer's raw HTTP MJPEG URL to the browser.
- Added direct MJPEG proxy streaming for Moonraker/Crowsnest cameras while preserving the upstream content type and no-cache headers.
- Updated the live printer config model name from `Voron` to `Voron 2.4 350`; the shop name remains `Greyhound Elite V2`.

### Localhost-only service hardening
- Reviewed a third-party fail-open auth advisory against Flightdeck's own authentication and error handling.
- Flightdeck does not currently have a comparable auth gate that can fail open, but it was still listening on `0.0.0.0:8000`, which exposed the raw HTTP app to the LAN.
- Changed the shipped systemd service and install docs to bind Uvicorn to `127.0.0.1:8000` by default.
- Tailscale Serve remains the intended remote doorway: `tailscale serve --bg http://127.0.0.1:8000`.

### Voron live page first polish
- Started giving the Voron/Greyhound Elite V2 live page its own treatment instead of letting it feel like a Bambu page without AMS.
- Added a Moonraker/MMU environment row with gate cards, active/buffered/empty states, slot editing hooks, and mismatch highlighting.
- Added a Voron filament-route strip from the active MMU gate to the toolhead, matching the visual language of the Bambu AMS-to-nozzle route.
- Removed the duplicate legacy MMU panel from the live page so the new Environment panel is the single source of truth.
- Static cache-bust bumped to `app.js?v=189` and `style.css?v=156`.

### Voron VVD filament path accuracy
- Captured live Happy Hare/VVD MMU state showing the difference between selected/gear-buffered filament and filament loaded all the way to the extruder/nozzle.
- Moonraker status now passes through VVD fields including `filament`, `filament_pos`, `operation`, `action`, and `sensors`.
- Voron route UI now labels the active path as `Pre-gate`, `Gear / buffer`, or `Toolhead` depending on reported VVD sensors instead of assuming the active gate is already at the nozzle.
- Static cache-bust bumped to `app.js?v=190`.
- Updated Voron/VVD operator labels from `G1/G2/G3/G4` to `T0/T1/T2/T3`, matching the Vivid/Happy Hare tool-position naming where the selector moves to the tool position.
- Static cache-bust bumped to `app.js?v=191`.

### Bambu RFID AMS profile matching
- Investigated H2D AMS slot re-load where Bambu RFID filament reported `A00-P6 · PLA Basic` and Flightdeck showed a false profile mismatch against the assigned spool.
- Confirmed the live printer was reading the RFID slot correctly and Flightdeck had already moved spool `#28` into `AMS 1 · S3`; the mismatch was caused by comparing Bambu profile codes as if they were human-readable filament names.
- Added Bambu profile-code tolerance so codes such as `A00-P6` do not trigger a profile mismatch once material and colour already match.
- Added profile-family matching so Bambu RFID names such as `PLA Basic` can match spools stored as `Bambu Lab / Basic / PLA`.
- Mirrored the same Bambu RFID tolerance in the frontend AMS slot tooltip/Profile Doctor path, which had its own profile mismatch logic.
- Bumped the app cache to `app.js?v=216` so browsers pick up the frontend AMS matching fix.

### Public contact address
- Corrected the public landing-page contact address to `flightdeck3dprinters@gmail.com`.

---

## Architecture decisions locked

- Python + FastAPI backend
- SQLite (not Postgres)
- Single-package project
- Host: Pi 5 + NVMe SSD (`flightdeck`, `192.168.4.127`)
- Vanilla JS frontend (no SPA framework)
- Local-first / no cloud (Tailscale used for tailnet-only remote access)

## Host facts
- Hostname: `flightdeck`, IP: `192.168.4.127` (eero reserved)
- Tailscale: `100.106.112.104`, MagicDNS hostname `flightdeck.tail7de73e.ts.net`, HTTPS certs enabled
- User: `flightdeck` (UID 1001, sudo, key-only SSH, in `systemd-journal` group)
- OS: Debian 13 Trixie, kernel 6.12.75, aarch64, 4GB RAM, 476.9GB NVMe
- Python 3.13.5
- Node 24.15.0 (nvm), npm 11.12.1

## Printers
| ID | Model | Custom name | Brand colour | Connection | Camera |
|---|---|---|---|---|---|
| `greyhound` | Voron | Greyhound Elite V2 | Red | Moonraker @ 192.168.4.215:7125 | MJPEG direct (crowsnest) |
| `x1c` | X1C | Greyhound Ludicrous | Green | Bambu MQTT @ 192.168.4.43 — LAN mode | RTSP port 322 (ffmpeg) |
| `h2d` | H2D | BigBoy | Amber | Bambu MQTT @ 192.168.4.206 — LAN mode | RTSP port 322 (ffmpeg) — 15min session recycle for firmware freeze workaround (commit ea20293) |

## Repository
- https://github.com/Kidabah/flightdeck (private)
- Recent commits: spool inventory (session 14), per-printer identity colours + duplicate detection (session 15), print queue subsystem (session 16), queue refinements + format additions (session 17), maintenance schedule (session 18), queue preflight (session 19), spool traceability (session 20), failure review (session 21), printer health score (session 22), scale + label hardware integration (session 23)

---

## Project context (for new Claude Code sessions)

If you're picking this up cold without prior conversation memory, here's the shape:

Flightdeck is a unified dashboard for a 3-printer mixed-fleet 3D print farm (Voron + 2 Bambus). It started as a Tier 1 monitor and grew into a full management surface — monitoring, control, history, spool inventory, print queue — with relay-based dispatch for Voron and direct Bambu integration via bambulabs_api MQTT.

The user (Kidabah) is technically experienced — runs the hardware hands-on, debugs at the protocol level (RTSP, MQTT field decoding, USB HID), and provides high-quality bug reports based on real use. Communication style: direct, brief, expects the same back. Owns the engineering decisions; uses Claude Code as a strong collaborator who can push back. Frequent screenshot evidence; values verification over assumption.

Workflow pattern: feature is specced, scope-pushback exchange happens, implementation in one or two sessions, real-use testing surfaces small bugs, fixes within the same day. Decision log + SESSION_NEXT discipline maintained throughout.

Important: when scope of a feature gets pushed back during specification (e.g. "let's defer X to a later session"), respect the decision. Don't accumulate scope under "while I'm here." Sessions stay focused.

The user values being treated as a collaborator, not a junior. Push back when something seems wrong; ask before making assumptions; explain trade-offs honestly. The decision log + SESSION_NEXT discipline isn't bureaucracy — it's how the project keeps state across multi-session work without burning context on re-discovery.
