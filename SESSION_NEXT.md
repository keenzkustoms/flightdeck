# Flightdeck — next session brief
_Last updated 28 May 2026 (Session 28.15 AMS drying control)_

## Current state

**Tier 1 complete. Tier 2 complete. Post-Tier-2 niceties complete. Spool inventory + Print queue + queue refinements + Maintenance schedule + Queue preflight + Spool traceability + Failure review + Printer health score + Scale/label hardware integration + dashboard command overview shipped.**

Service running at:
- `http://flightdeck.local:8000`
- `http://192.168.4.127:8000`
- **`https://flightdeck.tail7de73e.ts.net`** (Tailscale Serve — HTTPS, used for PWA / notifications)

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

---

## Known issues

- Service restart pending for Sessions 18/19/20/21/22/23 until user runs `sudo systemctl restart flightdeck.service`.
- Hardware setup still needs real-device confirmation after deploy:
  - Brother QL-700 must be switched out of Editor Lite mass-storage mode before printing (`lsusb` should show `04f9:2042`, not `04f9:2049`).
  - Dymo M10 scale was not detected in the last preflight; plug/wake it and apply udev rules if `/dev/hidraw*` or `/dev/usb/hiddev*` is inaccessible.
- Non-fatal `spool_deducted` decision-log SQLite lock can occur during spool deduction; trace data still writes.

---

## Next session priorities

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
