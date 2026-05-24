# Flightdeck — next session brief
_Last updated 24 May 2026 (session 13)_

## Current state

**Tier 1 complete. Tier 2 complete. Post-Tier-2 niceties complete.**
Service running at `http://flightdeck.local:8000` · `http://192.168.4.127:8000` · **`https://flightdeck.tail7de73e.ts.net`** (Tailscale Serve — HTTPS)

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

## Fixed/shipped this session (23 May session 8)

**H2D dual-nozzle display fixes:**

1. **Nozzle order** — Left nozzle now appears before Right in both the card and detail panel, matching the physical hotend layout. Fixed by sorting `Object.entries(p.temps)` using a `_TEMP_SORT` priority map (`hotend_l: 0, hotend_r: 1, hotend: 2, bed: 3, chamber: 4`) in both `renderCard` and `_detailTempsPanel`.

2. **Temperature colour coding** — All actual-temperature readings are now coloured by value via a `_tempClass(actual)` helper: `≥ 180°C → red (var(--error))`, `60–179°C → blue (#60a5fa)`, `< 60°C → white (default)`. Applies globally — card temp strip, detail panel ctrl rows (hotend/bed) and non-ctrl rows (nozzles, chamber). Both CSS classes (`.temp-hot`, `.temp-warm`) added to style.css.

---

## Fixed/shipped this session (23 May session 7)

**Decision log — per-print structured audit trail:**

1. **`decisions` table** — new SQLite table (`id`, `print_id`, `printer_id`, `event`, `detail`, `logged_at`). `print_id` is a nullable FK to `prints.id`; NULL is used for printer-level events that genuinely can't be tied to a single row.

2. **`log_decision()` / `get_decisions()`** — fire-and-forget append (never raises) and simple SELECT by print_id, in `db.py`.

3. **`on_print_started` now returns `(print_id, is_reattach)`** — `rowcount > 0` → fresh insert, return `lastrowid`; `rowcount == 0` → conflict (row already exists), query for its id. Callers store `print_id` in `self._current_print_id` (Bambu) / `_active_print_id[id]` (Moonraker) and log `job_started` or `job_reattached` accordingly.

4. **`on_print_finished` / `on_print_ended` / `close_open_prints` return print_id(s)** — SELECT id before UPDATE so callers get the row id without a second round-trip. `close_open_prints` returns `list[int]` (was `int`).

5. **Decisions logged throughout lifecycle:**
   - `job_started` / `job_reattached` — Bambu + Moonraker
   - `calibration_captured` — both, with human-readable duration (e.g. `7h 48m`)
   - `cancel_resolved` — user-initiated cancel confirmed
   - `connection_lost` — IDLE/standby without cancel request
   - `error_resolved` — FAILED or Klipper error, with error message
   - `job_cleanup` — orphan rows closed at FINISH/IDLE with no tracked key
   - `orphan_closed` — >24h stale row swept at startup
   - `failure_snapshot_saved` / `failure_snapshot_unavailable` — from `main.py`

6. **`_error_print_id` threaded from printer modules through fetch helpers** — `p._error_print_id` (Bambu) and `moonraker._error_print_id.get(id)` are injected as `"_error_print_id"` into the status dicts returned by `_fetch_bambu` / `_fetch_moonraker`. `_do_failure_snapshot` now takes `print_id: Optional[int]` explicitly instead of calling `get_most_recent_print_id`. `_check_transitions` passes `p.get("_error_print_id")` on error transitions.

7. **`GET /api/printers/{printer_id}/prints/{print_id}/decisions`** — new endpoint, returns list of `{id, event, detail, logged_at}`.

8. **History detail UI** — decision trail `<details>/<summary>` section below the print stats. Lazy-fetches on first open; subsequent opens serve cached DOM. Rendered as a 3-column grid: timestamp | event | detail. Empty state shows "No decisions recorded."

---

## Fixed/shipped this session (23 May session 6)

**ntfy Title headers crashing on emoji (notifications still not delivered):**

1. **Root cause** — ntfy Title strings contained non-ASCII emoji (`⏸`, `✓`, `⚠`). HTTP headers must be ASCII; httpx raised `'ascii' codec can't encode character '⏸'` before the request was sent. Confirmed in journalctl: transition detected, ntfy send attempted, immediate failure. Tags already render emoji on the ntfy app side.

2. **Fix** — Removed emoji from all four Title strings: `"Print paused ⏸"` → `"Print paused"`, `"Print complete ✓"` → `"Print complete"`, `"Print error ⚠"` → `"Print error"`, `"Print cancelled"` unchanged. Commit: `beb68eb`.

3. **Confirmed working** — paused H2D during live print; journalctl showed `state transition h2d: printing → paused` → `ntfy sending` → `ntfy sent OK (HTTP 200)`; notification received on phone.

---

## Fixed/shipped this session (23 May session 5)

**ntfy notifications not firing (root cause found and fixed):**

1. **Root cause** — `asyncio.gather(*tasks)` in `_gather_all()` had no `return_exceptions=True`. Any single printer fetch error (e.g. Moonraker offline/unreachable) caused the entire gather to raise, which was then silently swallowed by `except Exception: pass` in `_broadcast_loop`. `_check_transitions()` never ran — for any printer — whenever any other printer was unhealthy. This explained why Bambu print events produced zero notifications: the Moonraker printer timing out would kill all transition detection.

2. **Fix** — Added `return_exceptions=True` to `asyncio.gather` in `_gather_all`. Per-printer failures are now logged as `WARNING` and the rest of the list continues to be processed. Commit: `9ec64a3`.

3. **Logging fixed** — `app.*` loggers were silently filtered at WARNING level (Python root logger default; uvicorn's `--log-level info` only affects uvicorn's own loggers). Fixed by attaching a StreamHandler directly to the `app` logger at INFO level with `propagate=False`. Now `INFO:app.main: state transition h2d: printing → finished` appears in journalctl.

4. **Additional hardening in `main.py`:**
   - `_check_transitions` logs every state change: `INFO:app.main: state transition {id}: {prev} → {curr}`
   - `_send_ntfy` logs before sending and on success/failure (shows HTTP status code)
   - `_broadcast_loop` now logs exceptions instead of silently ignoring them
   - Added `printing → idle` notification path (covers user-cancelled prints)
   - `--log-level info` added to uvicorn ExecStart in `flightdeck.service`

**H2D dual-nozzle temperatures:**

5. **New `_read_dual_nozzle_temps()` helper in `bambu.py`** — for H2D only: reads `device.extruder.info[]` array from the MQTT dump. Extruder 0 (Right) uses packed encoding `(actual<<16)|target`; extruder 1 (Left) is plain int when `temp>>16==0`. Returns `{hotend_l, hotend_r}` TempReadings; falls back to single `hotend` for all other models. `status()` updated to use dual readings when available.

6. **Frontend (`app.js`)** — added `hotend_l`/`hotend_r` labels (`Left`/`Right`) to both the card-view `TEMP_LABELS` map and the detail-panel `_TEMP_LABELS` map. Temperature edit controls remain gated to `hotend` and `bed` only.

**Camera watchdog gap (stale reconnect):**

7. **Bug** — after ffmpeg was killed and restarted, `_last_frame_at` reset to `0.0`. The watchdog's stale-frame branch checked `now - _last_frame_at > _STALE_TIMEOUT`, which was always False when `_last_frame_at == 0.0`. A stuck-reconnecting ffmpeg could sit indefinitely with no frames and no watchdog kill.

8. **Fix** — Added `_started_at` timestamp (set on each `_start()` call) and `_INITIAL_TIMEOUT = 10s`. Watchdog now has two paths: if `_last_frame_at == 0.0` it checks elapsed time since `_started_at` and kills after 10s; otherwise it uses the existing stale-frame check (tightened from 15s to 8s). Watchdog poll interval tightened from 10s to 5s.

**MJPEG quality:**

9. **ffmpeg `-q:v` lowered from 5 → 2** — noticeably sharper MJPEG output on both Bambu camera feeds.

---

## Fixed/shipped this session (23 May session 4)

**Cancel vs error distinction in print history:**

1. **Root cause** — Bambu's `GcodeState.IDLE` is used for both user-initiated cancel and unexpected printer drop. Both were recorded as `final_state="ERROR"` with `"Connection lost mid-print"`, making every cancel look like a failure.

2. **Fix (bambu.py)** — Added `_cancel_requested` flag (default `False`). `cancel()` and `estop()` set it before sending the stop command. In `_resolve_state`, the `GcodeState.IDLE` handler now checks the flag: if set → `CANCELLED` (no error message); if not set → `ERROR` / `"Connection lost mid-print"`. Flag is cleared on all IDLE exit paths including the `_seen_finish_this_session` fast-path. FAILED state error messages improved: `"Bambu error: {err_code}"` or `"Print failed"` instead of `"Unknown error"`. Commit: `c55d737`.

3. **Fix (moonraker.py)** — Klipper error messages now prefixed with `"Klipper error: "` for clarity. Moonraker's `cancelled` GcodeState was already recording `CANCELLED` correctly — no change needed there.

4. **DB fixup** — Print row 71 (`Roll-Up_Storage_Box_plate_1`, 13:43 cancel) corrected directly from `ERROR` → `CANCELLED`.

**Error message taxonomy going forward:**
- User cancel / E-Stop → `CANCELLED`, no error message
- Bambu firmware failure → `ERROR` / `"Bambu error: {code}"` or `"Print failed"`
- Connection lost mid-print → `ERROR` / `"Connection lost mid-print"`
- Klipper error → `ERROR` / `"Klipper error: {message}"`

---

## Fixed/shipped this session (23 May session 3)

**H2D chamber temperature bogus reading (4,259,904°C):**

1. **Root cause** — The H2D encodes temperatures in `device.ctc.info.temp` as a packed int: `(actual_celsius << 16) | target_celsius`. The bambulabs_api library (shared by X1C and H2D) just casts the raw value to `float()`, which works for X1C (plain int, e.g. 27) but returns 4,259,904 for the H2D (e.g. `(65 << 16) | 65 = 4,259,905`). Neither printer sends the top-level `chamber_temper` field — both fall through to the `device.ctc.info.temp` path. X1C bed/nozzle are unaffected (those come from `bed_temper`/`nozzle_temper` plain floats).

2. **Fix** — New `_read_chamber_temp(mqtt_dump, model_name)` helper in `app/printers/bambu.py`. For `model_name == "H2D"` applies `value >> 16` to extract actual °C; for X1C uses value directly. Also clamps values >150°C to `None` (omits the row from display) as a defensive catch-all against future encoding surprises. Single `mqtt_dump()` call per poll cycle shared between chamber temp and AMS parsing. Commit: `5692d90`.

**H2D camera investigation (apparent frozen frame):**

- Confirmed RTSP stream on port 322 is live and connected — long-running ffmpeg (PID started at 13:26) has `ESTAB` TCP connection to H2D:322 with active data in receive buffer.
- What appeared to be a "frozen snapshot" was the live camera showing the static build plate between failed prints — scene genuinely unchanged, not a software bug.
- Noted a stale `CLOSE-WAIT` socket on port 6000 (H2D binary camera protocol from an old probe) — harmless, clears on service restart.

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

## Fixed/shipped this session (24 May session 9)

**Server-side settings:**

1. **`settings` table** — new SQLite table (`key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TIMESTAMP`). `GET /api/settings` returns all keys as a flat object. `PUT /api/settings/{key}` upserts a single key. On first load, any existing localStorage keys (`accent`, `theme`, `temp_unit`, `time_format`) are migrated to the server and cleared.

2. **Temperature unit** — `temp_unit` setting (`C` / `F`). All temperature displays convert via `_toDisplayTemp()` / `_fromDisplayTemp()`. Temp modal accepts input in display unit and converts to Celsius before MQTT command. `_tempUnitLabel()` used everywhere.

3. **Time format** — `time_format` setting (`24h` / `12h`). `_clockOpts()` helper returns correct `Intl.DateTimeFormat` options based on setting. Affects header clock and all history timestamps.

**OrcaSlicer relay:**

4. **Moonraker-compatible endpoints** at `/relay/{printer_id}/…`:
   - `GET  /relay/{printer_id}/printer/info` — version handshake
   - `POST /relay/{printer_id}/server/files/upload` — receives multipart file from OrcaSlicer
   - `POST /relay/{printer_id}/printer/print/start` — issues print start command

5. **Scope** — relay works for Voron/Greyhound (Moonraker) only. OrcaSlicer hard-codes Bambu LAN protocol for Bambu profiles and doesn't allow custom hostname; Bambu interception deferred.

6. **`app/relay.py`** — new ~200-line module handling both Bambu FTPS+MQTT and Moonraker upload paths. `_pending` dict bridges the two-step upload-then-start flow (5-min TTL). Bambu FTPS retries once on failure. Slicer version parsed from `; generated by X Y.Y.Y` gcode comment and stored as `slicer_detected_version` setting. Decision log events: `relay_upload`, `relay_print_start`, `relay_upload_retry`, `relay_upload_failed`, `relay_start_failed`.

7. **Bambu `seed_preview()`** — `BambuPrinter.seed_preview(subtask_name, preview)` sets `_preview_cache` directly at upload time, closing the H2D thumbnail gap for relay-initiated prints (H2D has no FTP root files, so without seeding the thumbnail would 404 until the next poll cycle).

**Slicer settings page:**

8. **Slicer category in Settings** — data-driven 2×2 card grid. `_SLICER_DEFINITIONS` array with `id`, `badge`, `badgeType`, `color`, `description`, `pros` for OrcaSlicer, Bambu Studio, PrusaSlicer, SuperSlicer. Click a card → PUT `preferred_slicer` to settings table.

9. **Passive version detection** — relay uploads check `; generated by X Y.Y.Y` in the first 4KB of gcode. Detected version stored as `slicer_detected_version`. The matching slicer card shows "detected 2.3.0" (or whatever build). Updates automatically on next relay upload.

10. **Card styling** — brand-colour top accent strip per card (`border-top: 3px solid {color}`); card name in brand colour; card background `#1d1d2e` (clearly lighter than `--bg`); description/pros text `#94a3b8` for readability.

---

## Fixed/shipped this session (24 May session 10)

**Tailscale Serve — HTTPS:**

1. `tailscale set --operator=flightdeck` to grant non-root serve access.
2. `tailscale serve --bg http://localhost:8000` — persistent config, survives reboots. Tailscale manages the cert automatically.
3. HTTPS URL: `https://flightdeck.tail7de73e.ts.net` — available on all devices with Tailscale.

**Browser bell notifications:**

4. **Dedup rule** — ntfy always fires server-side (no change). Browser notification fires only when `document.visibilityState === 'hidden'` (tab open but in background/minimised). Toast fires only when `visibilityState === 'visible'` (user looking at the dashboard — no popup needed). "Tab fully focused" case stays quiet.
5. **`paused` transition added** — `printing → paused` now fires a toast (when visible) and browser notification (when hidden), matching ntfy behaviour.
6. **Bug fix** — previous code had `if (Notification.permission !== 'granted') return` before the forEach, which silently suppressed toasts when permission wasn't granted. Fixed by separating the toast path (always) from the Notification path (permission + hidden guard).
7. **`notif-unavailable` class** — replaces old `notif-off` for the HTTPS-not-available case; opacity 0.15 + `cursor: not-allowed`. `notif-off` now specifically means browser-denied.
8. **Bell button tooltip** — granted: "Browser notifications on — fires when tab is in background"; denied: "Notifications blocked — check browser site settings"; default: "Enable browser notifications".

## Fixed/shipped this session (24 May session 11)

**PWA install:**

1. **`manifest.json`** — `display: standalone`, `theme_color: #0a0a0f`, `background_color: #0a0a0f`, start_url `/`. App opens without browser chrome — its own window/space on every platform.
2. **Icons** — 192×192 and 512×512 PNGs generated from `flightdeck-icon.svg` via `cairosvg`. Plus SVG at `sizes: any` for browsers that support it. Existing `apple-touch-icon.png` covers iOS.
3. **Service worker (`sw.js`)** — minimal: `install → skipWaiting`, `activate → clients.claim()`. No fetch handler / no caching — dashboard requires a live Pi connection. Just enough to satisfy PWA installability criteria.
4. **`<link rel="manifest">` + `<meta name="theme-color">`** added to `index.html`.
5. **SW registration** in `app.js` at startup (feature-detected, silent on failure).

Install: open `https://flightdeck.tail7de73e.ts.net` → Chrome: install icon in address bar / Android: Add to Home Screen / iOS Safari: Share → Add to Home Screen.

## Fixed/shipped this session (24 May session 12)

**Filament tracking:**

1. **`prints.filament_grams` + `prints.material`** — columns already existed in schema; added migration stmts so existing DBs get them safely.
2. **Data wired at print end:**
   - Bambu: reads `filament_weight_g` / `filament_type` from `_preview_cache` (seeded by relay upload at `bambu_upload` time, or from FTP fetch) when `GcodeState.FINISH` fires.
   - Moonraker: captures `filament_weight_total` from the existing slicer metadata fetch (already happening for ETA calibration); stored in `_filament_grams[printer_id]` and consumed at `raw == "complete"`.
3. **`material_costs` table** — `material TEXT PRIMARY KEY, cost_per_gram REAL, updated_at TEXT`. Populated via `GET/PUT /api/filament/costs/{material}`.
4. **`get_filament_summary(printer_id=None)`** — returns `total_grams`, `total_cost`, `by_material` (with per-material cost), `by_month` (last 12), `by_printer`.
5. **`GET /api/filament/summary`** and **`GET /api/filament/summary/{printer_id}`** endpoints.
6. **Filament settings tab** — cost-per-gram editor for PLA/PETG/ABS/ASA/TPU (+ any materials seen in DB); usage totals (weight + est. cost); material breakdown table; monthly bar chart. Data accumulates from completed prints going forward; historical rows stay NULL.

**Note:** Bambu direct prints (not via relay) only get filament data if `get_preview()` was called during the print (i.e. the detail view was open). Relay prints always have it. Moonraker always has it via metadata API.

## Fixed/shipped this session (24 May session 13)

**H2D frozen camera — root cause found and fixed:**

- **Symptom**: H2D camera feed frozen in app; RHS panel updating every 10s (WS alive), camera static.
- **Investigation**: `md5sum` of two proxy grabs 3s apart → identical hashes. Direct ffmpeg grabs from RTSP 3s apart → different hashes. Confirmed: RTSP source is live, proxy `_latest` is stuck.
- **Root cause**: H2D firmware bug — long-lived RTSP sessions silently freeze. The printer keeps the TCP connection alive and continues sending the same frame indefinitely. Existing `_STALE_TIMEOUT` (8s without a frame) doesn't catch this because frames do arrive, just always the same one.
- **Fix** (`camera.py`): Added `_MAX_SESSION_LIFE = 900` (15 min). Watchdog now recycles the ffmpeg process after 15 minutes regardless of frame health, establishing a fresh RTSP connection. Brief ~3s hiccup on recycle; no manual intervention needed.
- **Confirmed**: `kill -9` on the 90-min-old ffmpeg → new process started → proxy immediately returned differing hashes.
- **Note**: X1C does not exhibit this behaviour; only H2D has been observed to freeze long-lived sessions.

## Next session priorities

1. **Print annotations** — `notes` column on prints table; "Add note" link in finish toast and history detail. 30 min, high value.
2. **Per-spool tracking** — Define spools (material, brand, colour, starting weight, printer/slot), auto-deduct per print, low-stock badge on printer card. Natural extension of filament catalogue.
3. **Thumbnail gallery** — Grid view of past prints: thumbnails, state badge, printer, material, duration. Filter by printer or material. Mostly frontend — thumbnails already stored for relay prints.
4. **Maintenance scheduler** — Per-printer items (e.g. "clean nozzle every 50 prints"). Track last completed. Due badge on printer card. Small self-contained DB table + UI.
5. **ETA accuracy report** — Surface the estimated vs actual duration data already being collected. Per-printer stat + scatter chart. One DB query, mostly frontend.

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
