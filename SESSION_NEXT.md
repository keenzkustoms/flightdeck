# Flightdeck — next session brief
_Created 13 May 2026 at handoff from web chat to Claude Code_

## Where we are
Pi 5 fully commissioned as Flightdeck host. Today's session took it from
"running the retired Flsun's Klipper stack" to "clean Debian 13 Trixie
ready for Flightdeck."

## Host facts
- Hostname: `flightdeck`
- User: `flightdeck` (UID 1001, sudo, key-only SSH)
- IP: `192.168.4.127` (reserved on eero by MAC)
- OS: Debian 13 Trixie, kernel 6.12.75, aarch64
- Python: 3.13.5
- Node: 24.15.0 via nvm, npm 11.12.1
- Storage: 476.9GB NVMe (nvme0n1), 438GB free
- RAM: 4GB

## What's installed
- python3-venv, python3-pip, python3-dev, build-essential
- sqlite3 (CLI), git, tmux, htop, curl, ufw
- nvm + Node 24 + Claude Code

## What's NOT done
- Project scaffold (do this next): ~/flightdeck/ tree, venv, FastAPI hello-world, systemd service
- Git remote (deliberately deferred — local-only init for now)
- UFW configured but not enabled
- Tier 1 design

## Project decisions (from previous sessions, not for renegotiation)
- Python + FastAPI backend (not Node, not Flask)
- SQLite (not Postgres)
- Single-package project (not monorepo)
- Host: this Pi 5 + its SSD (not the Voron's CB2)
- Tier-by-tier build: Tier 1 status → Tier 2 controls → Tier 3 cockpit
- Frontend: lean toward HTMX or vanilla JS, no heavy SPA framework (final
  decision when we get there)
- Replit prototype at /home/cb2/flightdeck-replit-archive/Printer-Hub/ on the
  Voron's CB2 — reference only, NOT a starting point

## Printers to integrate
- Voron Greyhound Elite V2: Moonraker on the CB2 (separate Pi-like board)
- Bambu Lab X1C: bambulabs-api over MQTT, LAN-only mode
- Bambu Lab H2D: same approach as X1C

## Hardware quirks worth remembering
- Pi 5 is 4GB. Be deliberate about in-memory caches.
- Cloud-init was the source of mysterious hostname reverts on this Pi —
  disabled and masked. If hostname ever flips again, check cloud-init first.
- GUI stack (labwc/lightdm/X11/GNOME bits) is installed but lightdm is
  disabled. We didn't strip it; the dependency cascade is gnarly.

## First actions for the next session
1. Scaffold the project tree under ~/flightdeck/
2. Set up Python venv at ~/flightdeck/.venv/
3. Install FastAPI + uvicorn
4. Write app/main.py with a /healthz endpoint
5. systemd unit to keep it running
6. Initial git commit
7. Then start Tier 1 design proper

## Bambu connection info to gather BEFORE Tier 1 Bambu work
For each Bambu (X1C, H2D):
- IP on LAN
- Access code (printer display → Settings → WLAN)
- Serial number (bottom of printer)
- LAN-only mode enabled (Settings → General → LAN Only Mode → ON)
