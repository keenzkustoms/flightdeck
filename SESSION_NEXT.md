# Flightdeck — next session brief
_Last updated 15 May 2026 (night)_

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
- **H2D**: RTSPS port 322 — working (LAN mode; printers.yaml `type: bambu_rtsp`)
- Popover: live feed for PRINTING/PAUSED/ERROR; static thumbnail for FINISHED; suppressed for IDLE/OFFLINE
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

---

## Known issues

| Issue | Severity | Notes |
|---|---|---|
| Slow service shutdown | Done | 5s timeout on `asyncio.to_thread(p.stop)` in lifespan teardown — service now stops cleanly. |
| Browser notifications (HTTPS) | Low | Bell button visible but inert on HTTP. Tailscale free plan doesn't support TLS certs. ntfy.sh now handles push — browser notifs are a nice-to-have. |
| UFW | Done | Enabled; rules: ssh, 8000/tcp (flightdeck), tailscale0 interface. |

---

## Fixed/shipped this session (15 May night)

**Mobile camera/popover bugs** (real-device QA):
1. **MJPEG stream leak** — navigating away on mobile left the camera `<img>` connection open, exhausting the browser's connection pool and killing subsequent feeds. Fixed by explicitly clearing `img.src` (and marking `data-stopped`) in the router, plus restoring the stream on return to the same printer.
2. **Stuck preview popover** — browser back button bypasses click handlers so `hidePreview()` was never called, leaving the hover popover floating over the detail view. Fixed by calling `hidePreview()` at the top of every `router()` invocation.
3. **Async race in showPreview** — if a long-press triggered a preview fetch and the user navigated before it completed, the fetch resolved *after* `hidePreview()` and put the popover back up (~5s visible until next WS tick called `router()`). Fixed with a stale-check guard `if (activeCard !== card) return` after the fetch.

**Infrastructure:**
- GitHub remote created — https://github.com/Kidabah/flightdeck
- UFW enabled — rules: ssh, 8000/tcp, tailscale0
- Slow shutdown fixed — 5s timeout on Bambu MQTT stop
- **ntfy.sh push notifications** — server-side transition detection; fires on print finished/error/paused even when browser is closed. Topic: `flightdeck-c1f2849dcb` (subscribe in ntfy app)

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
