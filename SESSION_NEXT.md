# Flightdeck — next session brief
_Last updated 15 May 2026_

## Current state

Tier 1 is complete and live. All three printers reporting real telemetry.
Service running at `http://flightdeck.local:8000` (or `192.168.4.127:8000`).

## What was built (Tier 1 — fully complete)

### Infrastructure
- FastAPI backend, SQLite, systemd service (`flightdeck.service`)
- `printers.yaml` config: model/custom names, icons, connection info, camera config
- `flightdeck.local` mDNS resolves correctly

### Printer integrations
- **Voron Greyhound Elite V2** — Moonraker polling, layer counts, toolhead position, MMU/Happy Hare gate status
- **Bambu X1C (Greyhound Ludicrous)** — bambulabs_api MQTT, subtask_name preferred over `plate_1.gcode`
- **Bambu H2D (BigBoy)** — same as X1C

### State machine
- States: `PRINTING` / `IDLE` / `PAUSED` / `FINISHED` / `ERROR` / `OFFLINE`
- FINISHED persists 30 min post-completion, survives service restart via SQLite hydration
- Connection health dots (green/amber/red) per card

### Print history (SQLite `prints` table)
- UPSERT on `(printer_id, job_key)` — idempotent through reconnect storms
- Three lifecycle hooks: `on_print_started`, `on_print_finished`, `on_print_ended`
- Stale orphan cleanup on startup (prints open >24h closed as ERROR)
- "Last print" idle-card row: `Xh Ym`, `cancelled at N%`, `failed at N%`

### UI
- Card header: brand icon + connection dot + model name + custom name + state badge
- Printing cards: progress bar, layer counter, ETA, filename (subtask_name preferred for Bambu)
- Finished cards: print complete summary + cooling indicator if hotend >50°C
- Idle cards: Last print / Toolhead position / MMU gate status rows
- Hover popover: live MJPEG stream or slicer thumbnail fallback or placeholder + metadata
- Header: status pill (all nominal / N warnings / N faults) + live indicator + clock
- Footer: host IP + printer counts
- Mobile-responsive layout verified

### Camera feeds (Tier 1.5)
- **Voron**: MJPEG direct from crowsnest (`/webcam/?action=stream`) — working
- **X1C**: ffmpeg RTSPS proxy on port 322 → MJPEG — working
- **H2D**: port 322 not available; port 6000 binary protocol requires LAN mode — **parked**
- Popover: live feed for PRINTING/PAUSED/ERROR; static thumbnail for FINISHED (cooled); suppressed for IDLE/OFFLINE
- 2.5s fallback chain: live → static thumbnail → placeholder + metadata
- Frame deduplication: stream only sends when frame changes (prevents stale-frame loop)

## Known issues / deferred

- **H2D camera**: port 6000 auth rejected in Bambu network mode. Needs LAN mode enabled on the printer to work.
- **Slow service shutdown**: uvicorn takes ~90s to stop (hits systemd SIGKILL). Bambu MQTT disconnect hanging in lifespan teardown. Fix: add timeout to `asyncio.to_thread(p.stop)`.
- **ffmpeg watchdog**: if RTSP connection goes stale, stream stops sending (fixed) but doesn't auto-restart ffmpeg. Could add a watchdog in a future pass.
- **Git remote**: still local-only, deliberately deferred.
- **UFW**: installed but not enabled.

## Slicer / printer notes

- Bambu printers sliced with a fork of OrcaSlicer (not Bambu Studio)
- Bambu printers in **Bambu network mode** (cloud), NOT LAN-only mode
- **FlowGuard threshold raised to 80** in Happy Hare config on Voron
- Voron Greyhound Elite V2 had a print running at end of this session

## Next session priorities (in order)

### 1. Infrastructure hardening
- **Tailscale** — install and auth; dashboard accessible remotely without exposing port 8000
- **systemd lifespan fix** — timeout on MQTT disconnect; clean shutdown in <5s
- **Bambu network mode audit** — confirm what bambulabs_api controls work in cloud mode vs LAN mode; specifically whether pause/cancel/start require LAN mode

### 2. Tier 2 — Print controls + AMS
- Start / pause / cancel / resume for Moonraker and Bambu
- AMS data: per-slot filament type, colour, remaining % — via API and on card
- Write the Tier 2 spec before implementing

## Architecture decisions locked (not for renegotiation)
- Python + FastAPI backend
- SQLite (not Postgres)
- Single-package project
- Host: Pi 5 + NVMe SSD (`flightdeck`, `192.168.4.127`)
- Tier-by-tier build
- Vanilla JS frontend (no SPA framework)
- Reference prototype at `/home/cb2/flightdeck-replit-archive/Printer-Hub/` on Voron CB2 — reference only

## Host facts
- Hostname: `flightdeck`, IP: `192.168.4.127` (eero reserved)
- User: `flightdeck` (UID 1001, sudo, key-only SSH)
- OS: Debian 13 Trixie, kernel 6.12.75, aarch64, 4GB RAM, 476.9GB NVMe
- Python 3.13.5, Node 24.15.0 (nvm)
- GUI stack installed but lightdm disabled; cloud-init disabled and masked

## Printers
| ID | Model | Custom name | Connection | Camera |
|---|---|---|---|---|
| `greyhound` | Voron | Greyhound Elite V2 | Moonraker @ 192.168.4.215:7125 | MJPEG direct (crowsnest) |
| `x1c` | X1C | Greyhound Ludicrous | Bambu MQTT @ 192.168.4.43 | RTSP port 322 (ffmpeg) |
| `h2d` | H2D | BigBoy | Bambu MQTT @ 192.168.4.206 | Not implemented (LAN mode required) |
