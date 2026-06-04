# Flightdeck — next session brief
_Last updated 4 June 2026 (Session 28.143 Standalone demo realism)_

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
