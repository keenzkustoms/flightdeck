# Flightdeck — next session brief
_Last updated 23 May 2026 (session 2)_

## Current state

**Tier 1 complete. Tier 2 complete. Post-Tier-2 niceties complete.**
Service running at `http://flightdeck.local:8000` · `http://192.168.4.127:8000` · `http://100.106.112.104:8000` (Tailscale)

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
- Top-level tab strip: per-printer tabs + All Cameras tab, client-side hash routing (`#/printer/{id}`, `#/cameras`)
- Per-printer sub-tabs: Live | History; instant client-side switch

### Live sub-tab
- **Two-column layout** — camera left (fills full viewport height), controls+panels right sidebar (320px); stacks to single column on mobile (<900px)
- **Camera click-cycle** — desktop: normal → wide (sidebar hidden, blue outline affordance) → fullscreen → All Cameras view; mobile: tap → fullscreen → tap → normal; ESC returns to normal from any state
- **Print controls** — Pause / Resume / Cancel / E-Stop; optimistic UI; confirmation modals on Cancel and E-Stop
- **Temperature controls** — per-heater actual/target display; ±5° nudge buttons; click reading → numeric modal
- **Temperature modal** — numeric keypad with presets running vertically down the right side (Off / PLA / PETG / ASA / ABS per printer from printers.yaml), current→target display, hot-value warning (>280° hotend / >120° bed), range clamping with amber flash; physical keyboard on desktop (type numbers, Enter confirm, Escape cancel); compact left-anchored popup on mobile; floats over right panel on desktop so camera stays visible
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

### All Cameras view
- Grid of all live MJPEG feeds; tap tile → that printer's Live tab
- Partial update on WS tick — header badge/state updates without resetting the stream
- Offline camera shows placeholder, doesn't break grid

---

## Post-Tier-2 niceties (complete)

- **Browser tab title** — live state in tab: `67% · Greyhound Ludicrous`, `2 printing · Flightdeck`, `⚠ ERROR · Flightdeck`; resets to `Flightdeck` when idle
- **Toast notifications** — slide-in banner bottom-right on print FINISHED (green) or ERROR (red); auto-dismisses after 5s, click to dismiss early; stacks if multiple fire
- **Bell button** — 🔔 in header; disabled with tooltip on HTTP (notifications require HTTPS); activates if HTTPS is configured
- **ffmpeg watchdog** — two-layer: proc-exit auto-restart (3s delay, only while clients connected); staleness watchdog kills frozen-but-alive ffmpeg if no frames for 15s
- **ntfy.sh push notifications** — server-side transition detection; fires on print finished/error/paused even when browser is closed. Topic: `flightdeck-c1f2849dcb` (subscribe in ntfy app)

---

## Known issues

| Issue | Severity | Notes |
|---|---|---|
| Slow service shutdown | Done | 5s timeout on `asyncio.to_thread(p.stop)` in lifespan teardown — service now stops cleanly. |
| Browser notifications (HTTPS) | Low | Bell button visible but inert on HTTP. Tailscale free plan doesn't support TLS certs. ntfy.sh now handles push — browser notifs are a nice-to-have. |
| UFW | Done | Enabled; rules: ssh, 8000/tcp (flightdeck), tailscale0 interface. |
| Voron slicer thumbnail | Done | OrcaSlicer embeds 32×32 and 400×300. Was picking 32×32 due to 200px cap in `_pick_thumbnail`. Fixed to pick largest available — now shows 400×300. |
| Estop → firmware restart | Done | Full loop confirmed: idle → ESTOP badge on estop → firmware restart button → printer reinitialises → idle. |

---

## Fixed/shipped this session (23 May session 2)

**Failure snapshot on ERROR/ESTOP:**

1. **DB migration** — `prints` table gains two new columns: `snapshot_jpeg BLOB` (the raw JPEG bytes) and `snapshot_captured_at TIMESTAMP`. Migration runs safely on the existing DB at startup via `ALTER TABLE … ADD COLUMN` with exception swallowing.

2. **Frame capture** — `_grab_snapshot(printer_id)` in `main.py`: for Bambu, pulls `proxy._latest` (the most recently decoded JPEG already in memory from the RTSP stream); if the proxy was idle-stopped, tries starting it and waits up to 3s for a frame. For Moonraker (Voron), HTTP GETs the configured `snapshot_url` from `printers.yaml`.

3. **Transition hook** — `_check_transitions()` now fires `asyncio.create_task(_do_failure_snapshot(pid))` whenever a printer enters `error` or `estop` state. `_do_failure_snapshot` grabs the frame, looks up the most recently started print row for that printer, and stores the JPEG to DB.

4. **Snapshot endpoint** — `GET /api/printers/{printer_id}/prints/{print_id}/snapshot` returns the JPEG with a far-future cache header. `get_prints_for_day()` now includes `has_snapshot` boolean in each row.

5. **History detail UI** — When `has_snapshot` is true, the print detail card shows the frame above the error message, capped at 240px with `object-fit: cover` and a "Last frame before failure" caption.

---

## Fixed/shipped this session (23 May)

**Klipper error state, stale job data, and orphan row cleanup:**

1. **Klipper `error` state detected** — `/printer/info` previously only checked for `klippy_state == "shutdown"` (ESTOP). Now also maps `klippy_state == "error"` to `raw_state = "error"`, so a Klipper config error or failed init surfaces the ERROR badge instead of appearing idle. `state_message` is also extracted from `/printer/info` and used as the fallback `error_message` when `print_stats.message` is empty — wired into `PrinterState.error` when state is `error`. Error message text available for future UI display.

2. **Idle job nulling (Moonraker + Bambu)** — Both pollers now set `job = None` immediately after resolving state to `"idle"`. Moonraker/MQTT retain last-print data in their objects even after a print ends; previously this data could leak into the idle card as if a job were active. Null-guard ensures idle state never carries a stale job payload.

3. **FINISH + no job key → close open row** — Bambu poller: when the resolved state is `FINISHED` but `_current_job_key` is None (service restarted mid-print), the code now calls `db.close_open_prints(self.id, final_state="FINISHED")` immediately instead of leaving the row for the 24h stale-orphan sweep.

4. **Stale-row artefacts excluded from last print display** — `db.get_last_print()` now filters out rows where `error_message = 'Abandoned (stale open row)'` so startup cleanup artefacts don't surface as the "last print" on idle cards.

---

## Fixed/shipped this session (22 May)

**Parallel polling + last_seen persistence:**
1. **`_gather_all()` parallelised** — all printers now polled concurrently via `asyncio.gather`; first-page load time drops from sum-of-latencies to max-of-latencies.
2. **Moonraker double-fetch parallelised** — objects query and `/printer/info` now fire concurrently instead of sequentially, halving round-trips per poll cycle.
3. **`last_seen` persisted to SQLite** — `printer_state` table now stores `last_seen`; offline cards show "Last connected HH:MM" after a service restart instead of "Never connected".
4. **Label rename** — frontend "Last seen" → "Last connected" on offline cards.

**Stale open print rows (history showing "running" for idle printers):**
5. **Root cause** — on service restart `_current_job_key` resets to None; if the printer lands IDLE with the MQTT dump cleared, `_make_job_key` fell back to a timestamp key, so `on_print_ended` targeted the wrong row and the real open row survived indefinitely.
6. **Fix** — IDLE branch now calls `db.close_open_prints()` (targets `WHERE printer_id = ? AND final_state IS NULL`) when `_current_job_key` is None, instead of guessing via `_make_job_key`. Two stale rows (H2D row 67, X1C row 68) closed directly in DB.

---

## Fixed/shipped this session (17 May — logo & stale state)

**Logo, favicon, and stale Bambu state fixes:**
1. **Logo lockup** — inline SVG icon (30px) + FLIGHT/DECK CSS gradient wordmark in header; SVG favicon + 180×180 apple-touch-icon added.
2. **H2D stuck on "complete" after restart** — `finished_at` TTL was anchored to service restart time, not actual `ended_at` from DB; fixed to read real timestamp.
3. **X1C stuck on "error" after restart** — stale `FAILED` state with an already-closed DB job now resolves to idle instead of persisting.

---

## Fixed/shipped this session (17 May — estop & MQTT)

**Estop / firmware restart flow (Voron):**
1. **ESTOP state detection** — Moonraker returns `print_stats.state = "standby"` even when Klipper is in shutdown. Added a `/printer/info` check on every Moonraker poll; if `klippy_state == "shutdown"` the printer transitions to a new `estop` state.
2. **Firmware Restart button** — amber button appears in the destructive controls section when printer is in `estop` or `error` state; Moonraker only (gated by `p.kind === 'moonraker'`). Requires confirm dialog. Sends `POST /printer/firmware_restart` to Moonraker.
3. **ESTOP card body** — card shows "Emergency stop active — firmware restart required" in muted red when in estop state; badge shows ESTOP in red.
4. **Offline card already correct** — "All connection attempts failed" text was already replaced with "Last seen HH:MM" in a prior session; confirmed no regression.

**Bambu MQTT sequence_id fix (uncommitted from prior session):**
5. **Commands silently dropped on firmware ≥ 1.08** — Bambu firmware requires a `sequence_id` field in every MQTT command payload; base class didn't inject it. Added `_SequencedMQTTClient` subclass that intercepts `__publish_command` via name-mangling MRO and injects an incrementing `sequence_id`.

---

## Fixed/shipped this session (16 May morning)

**ntfy push notifications:**
1. **Notifications not firing** — `_check_transitions()` was inside the `if not _ws_clients: continue` guard, so it only ran when a browser tab was open. Moved above the guard; printers are now polled every 5s regardless of browser state.
2. **Wrong notification format** — backend was posting JSON body (`json=` in httpx); ntfy.sh treated the whole JSON object as the message text. Fixed to use plain text body + `Title`/`Tags`/`Priority` headers.

**Mobile camera popover bug:**
3. **Popover appearing on detail view after navigating from dashboard** — clicking a card quickly (before the 200ms hover delay expired) left `hoverTimer` running. `hidePreview()` didn't clear it, so `showPreview` fired 200ms later on a hidden card. Fixed by cancelling both `hoverTimer` and `longPressTimer` in `hidePreview()`.
   - Not reproducible from All Cameras view (no hover timers on camera tiles) — which is exactly what was reported.

**H2D preview / thumbnail:**
4. **H2D FTP is empty** — H2D stores no `.gcode.3mf` files in its FTP root (unlike X1C which stores them in `/`). Preview endpoint was returning 404. Now falls back to camera stream when no FTP thumbnail is available.
5. **FTP failure caching** — `BambuPrinter.get_preview()` was not caching failed FTP lookups, causing a new FTP connection attempt on every thumbnail request. Added `_BAMBU_PREVIEW_FAILED` sentinel so failures are cached per-job.

**Replaced hover popover with inline thumbnail:**
6. **Removed entire popover system** — `showPreview`, `hidePreview`, `reposition`, floating-ui CDN import, all hover/long-press timer logic, all popover CSS. Dashboard cards now just navigate on tap.
7. **Slicer thumbnail in Print Details panel** — shown above the File row; hidden via `onerror` if unavailable. Tap to collapse to a `▸ preview` strip; tap again to expand. Collapse state is preserved across WS tick re-renders.

---

## Next session priorities

1. **Tier 3** — TBD (suggestions: OrcaSlicer upload, filament tracking, multi-user, HTTPS via mkcert)

---

## Architecture decisions locked

- Python + FastAPI backend
- SQLite (not Postgres)
- Single-package project
- Host: Pi 5 + NVMe SSD (`flightdeck`, `192.168.4.127`)
- Vanilla JS frontend (no SPA framework)

## Host facts
- Hostname: `flightdeck`, IP: `192.168.4.127` (eero reserved), Tailscale: `100.106.112.104`
- Tailscale MagicDNS: `http://flightdeck:8000` — account: kidabah@ (free plan, no HTTPS certs)
- User: `flightdeck` (UID 1001, sudo, key-only SSH)
- OS: Debian 13 Trixie, kernel 6.12.75, aarch64, 4GB RAM, 476.9GB NVMe
- Python 3.13.5

## Printers
| ID | Model | Custom name | Connection | Camera |
|---|---|---|---|---|
| `greyhound` | Voron | Greyhound Elite V2 | Moonraker @ 192.168.4.215:7125 | MJPEG direct (crowsnest) |
| `x1c` | X1C | Greyhound Ludicrous | Bambu MQTT @ 192.168.4.43 — LAN mode | RTSP port 322 (ffmpeg) — working |
| `h2d` | H2D | BigBoy | Bambu MQTT @ 192.168.4.206 — LAN mode | RTSP port 322 (ffmpeg) — working |
