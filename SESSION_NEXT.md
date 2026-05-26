# Flightdeck — next session brief
_Last updated 26 May 2026 (post-session 20, spool traceability + details button polish)_

## Current state

**Tier 1 complete. Tier 2 complete. Post-Tier-2 niceties complete. Spool inventory + Print queue + queue refinements + Maintenance schedule + Queue preflight + Spool traceability shipped.**

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

## Known issues

- Service restart pending for Sessions 18/19/20 until user runs `sudo systemctl restart flightdeck.service`.
- Non-fatal `spool_deducted` decision-log SQLite lock can occur during spool deduction; trace data still writes.

---

## Next session priorities

### Closing fixes (shipped same session)
- **Bambu filament metadata**: `get_preview()` now called proactively on first poll of any new print (same trigger as AMS snapshot). One-shot FTP call per job; cached on `subtask_name`. Ensures `filament_weight_g` and `material` are always populated for spool deduction, even when nobody views the detail page.
- **Spool snapshot overwrite on restart**: `write_slot_snapshot` now uses `WHERE ams_slot_snapshot IS NULL`. Post-restart the snapshot condition re-fires (in-memory state resets), but the original DB row is preserved. Spool deduction uses correct print-start slot assignments regardless of restarts.

---

### Hardware integration (when Dymo M10 scale + Brother QL-700 arrive) — hardware not yet received
- USB scale: read weight directly into Add Spool / re-weigh flows
- Brother QL-700: 40×30mm thermal labels with colour swatch + material + brand + spool # + QR code linking to spool detail
- Spec drafted: see `scale_label_integration_spec.md`
- Devices independently usable; either can be present without the other
- Pre-flight: udev rules + plugdev group + smoke test before any feature code
- Library choice: `luxardolabs/brother_ql` fork (Python 3.13+ compatible); `pyusb` for scale
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
- Recent commits: spool inventory (session 14), per-printer identity colours + duplicate detection (session 15), print queue subsystem (session 16), queue refinements + format additions (session 17), maintenance schedule (session 18), queue preflight (session 19), spool traceability (session 20)

---

## Project context (for new Claude Code sessions)

If you're picking this up cold without prior conversation memory, here's the shape:

Flightdeck is a unified dashboard for a 3-printer mixed-fleet 3D print farm (Voron + 2 Bambus). It started as a Tier 1 monitor and grew into a full management surface — monitoring, control, history, spool inventory, print queue — with relay-based dispatch for Voron and direct Bambu integration via bambulabs_api MQTT.

The user (Kidabah) is technically experienced — runs the hardware hands-on, debugs at the protocol level (RTSP, MQTT field decoding, USB HID), and provides high-quality bug reports based on real use. Communication style: direct, brief, expects the same back. Owns the engineering decisions; uses Claude Code as a strong collaborator who can push back. Frequent screenshot evidence; values verification over assumption.

Workflow pattern: feature is specced, scope-pushback exchange happens, implementation in one or two sessions, real-use testing surfaces small bugs, fixes within the same day. Decision log + SESSION_NEXT discipline maintained throughout.

Important: when scope of a feature gets pushed back during specification (e.g. "let's defer X to a later session"), respect the decision. Don't accumulate scope under "while I'm here." Sessions stay focused.

The user values being treated as a collaborator, not a junior. Push back when something seems wrong; ask before making assumptions; explain trade-offs honestly. The decision log + SESSION_NEXT discipline isn't bureaucracy — it's how the project keeps state across multi-session work without burning context on re-discovery.
