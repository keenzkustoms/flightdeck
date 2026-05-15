# Flightdeck — next session brief
_Last updated 16 May 2026_

## Current state

Tier 1 complete. Tier 2 complete (all 10 spec items + AMS display bonus). Two-column live layout added.
Service running at `http://flightdeck.local:8000` (or `192.168.4.127:8000`).

---

## What was built — Tier 1 (complete)

### Infrastructure
- FastAPI backend, SQLite, systemd service (`flightdeck.service`)
- `printers.yaml` config: model/custom names, icons, connection info, camera config
- `flightdeck.local` mDNS resolves correctly

### Printer integrations
- **Voron Greyhound Elite V2** — Moonraker polling, layer counts, toolhead position
- **Bambu X1C (Greyhound Ludicrous)** — bambulabs_api MQTT, subtask_name preferred over `plate_1.gcode`
- **Bambu H2D (BigBoy)** — same as X1C; both Bambus switched to **LAN mode** during Tier 2

### State machine
- States: `PRINTING` / `IDLE` / `PAUSED` / `FINISHED` / `ERROR` / `OFFLINE`
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
- Hover popover: live MJPEG or slicer thumbnail fallback + metadata
- Header: status pill + live indicator + clock; footer: host IP + printer counts

### Camera feeds (Tier 1.5)
- **Voron**: MJPEG direct from crowsnest — working
- **X1C**: ffmpeg RTSPS proxy port 322 → MJPEG — working
- **H2D**: RTSPS port 322 — **working** (switched to LAN mode during Tier 2; printers.yaml has `type: bambu_rtsp`)
- Popover: live feed for PRINTING/PAUSED/ERROR; static thumbnail for FINISHED (cooled); suppressed for IDLE/OFFLINE
- 2.5s fallback chain: live → static thumbnail → placeholder

---

## What was built — Tier 2 (complete)

All 10 steps from TIER2_SPEC.md shipped, plus two bonus items and one layout improvement.

### Navigation
- Top-level tab strip: per-printer tabs + All Cameras tab, client-side hash routing (`#/printer/{id}`, `#/cameras`)
- Per-printer sub-tabs: Live | History; instant client-side switch

### Live sub-tab
- **Camera hero** — fills left column at full viewport height; click → browser fullscreen
- **Two-column layout** _(beyond original spec)_ — camera left, controls+panels right sidebar (320px), no scrolling needed on desktop; stacks to single column on mobile (<900px)
- **Print controls** — Pause / Resume / Cancel / E-Stop; optimistic UI (loading state while waiting for WS confirmation); confirmation modals on Cancel and E-Stop
- **Temperature controls** — per-heater actual/target display; ± 5° nudge buttons; click target → inline number input; optimistic UI
- **Print details panel** — filename/subtask_name, progress bar, layer count, ETA; shows last print info when idle
- **Object exclusion panel** — renders for Moonraker printers when multi-object print active; confirmation modal before exclusion; disabled for Bambu (not supported)
- **AMS display panel** _(bonus, beyond original spec)_ — per-slot colour swatches, material type, active-slot indicator; Bambu Live tab only; hidden when no material loaded

### History sub-tab
- **Year heatmap** — Jan 1 → Dec 31 grid, Mon–Sun rows, variable week count; 4-tier green intensity (0=border outline, 1–2=25% green, 3–4=55% green, 5+=full green); future cells dimmed
- **Year navigation** — `‹ 2025 | 2026 | 2027 ›` above heatmap; persists selected year per printer
- **Summary line** — "47 prints · 168h · 4.2kg filament" (FINISHED only)
- **Day detail panel** — click a cell → list of that day's prints with time, duration, state badge
- **Print detail card** — click a print row → full detail (started/ended, duration, layers, filament, error message with red border); back button returns to day list instantly (cached)

### All Cameras view
- Grid of all live MJPEG feeds; tap tile → that printer's Live tab
- Partial update on WS tick — header badge/state updates without resetting the stream
- Offline camera shows placeholder, doesn't break grid

---

## Known issues

| Issue | Severity | Notes |
|---|---|---|
| **AMS HT label shows "AMS 129"** | Cosmetic | Bambu H2D reports AMS HT unit with ID 128 in MQTT; `unit.unit + 1` = 129. Needs special-case: if `unit.unit >= 128` → show "AMS HT" (or read vendor string). Fix pending. |
| Slow service shutdown | Low | uvicorn takes ~90s to stop (SIGKILL); Bambu MQTT disconnect hanging in lifespan teardown. Add timeout to `asyncio.to_thread(p.stop)`. |
| ffmpeg watchdog | Low | If RTSP connection goes stale, stream stops but ffmpeg doesn't auto-restart. Add watchdog in a future pass. |
| Git remote | Low | Still local-only, deliberately deferred. |
| UFW | Low | Installed but not enabled. |

---

## Today's priorities (in order)

### 1. Fix AMS HT label (quick — ~15 min)
In `_parse_ams()` in `bambu.py`, add special-case label for unit IDs ≥ 128.
Also propagate a `label` field from backend → frontend so the JS renders it rather than computing `unit + 1`.
Or: handle entirely in frontend — if `unit.unit === 128` → "AMS HT", else `"AMS " + (unit.unit + 1)`.

### ~~2. MMU display panel~~ ✅ Done

### ~~2. Tailscale~~ ✅ Done
Installed v1.96.4. Tailscale IP: `100.106.112.104`. Reachable at `http://100.106.112.104:8000` (and `http://flightdeck:8000` via MagicDNS). Account: kidabah@.

---

## Architecture decisions locked

- Python + FastAPI backend
- SQLite (not Postgres)
- Single-package project
- Host: Pi 5 + NVMe SSD (`flightdeck`, `192.168.4.127`)
- Vanilla JS frontend (no SPA framework)

## Host facts
- Hostname: `flightdeck`, IP: `192.168.4.127` (eero reserved)
- User: `flightdeck` (UID 1001, sudo, key-only SSH)
- OS: Debian 13 Trixie, kernel 6.12.75, aarch64, 4GB RAM, 476.9GB NVMe
- Python 3.13.5

## Printers
| ID | Model | Custom name | Connection | Camera |
|---|---|---|---|---|
| `greyhound` | Voron | Greyhound Elite V2 | Moonraker @ 192.168.4.215:7125 | MJPEG direct (crowsnest) |
| `x1c` | X1C | Greyhound Ludicrous | Bambu MQTT @ 192.168.4.43 — **LAN mode** | RTSP port 322 (ffmpeg) — working |
| `h2d` | H2D | BigBoy | Bambu MQTT @ 192.168.4.206 — **LAN mode** | RTSP port 322 (ffmpeg) — working |
