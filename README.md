# Flightdeck

> A unified status, control, and telemetry dashboard for a mixed-fleet 3D printer farm.

![Status](https://img.shields.io/badge/status-early%20development-orange)
![Python](https://img.shields.io/badge/python-3.13-blue)
![License](https://img.shields.io/badge/license-MIT-green)

Flightdeck is a self-hosted dashboard that brings disparate 3D printers — Klipper-based Vorons and Bambu Lab machines — under a single pane of glass. Instead of bouncing between Mainsail, Bambu Studio, and the printers' touchscreens, Flightdeck aggregates live status, exposes safe controls, and (eventually) presents a true "cockpit" view of the farm.

It's built primarily for my own bench (one Voron Greyhound Elite V2, a Bambu H2D, and a Bambu X1C), but the architecture is generic enough that anyone running a similar mixed fleet should be able to adapt it.

---

## Safe Restart

If `systemctl restart flightdeck.service` hangs because old Bambu camera `ffmpeg` or `uvicorn` processes do not exit cleanly, use:

```bash
sudo ./scripts/safe-restart-flightdeck.sh
```

The helper stops the service, cleans only Flightdeck-owned leftover `uvicorn` and Bambu RTSP `ffmpeg` processes, starts the service again, and prints a compact `/api/printers` health check.

---

## Why

Running multiple printers across ecosystems means juggling:

- **Klipper/Moonraker** for the Voron — rich API, fully open, but only knows about itself
- **Bambu's MQTT + cloud bridge** for the H2D and X1C — proprietary, less hackable, different paradigm entirely
- **OrcaSlicer / Bambu Studio** for slicing and (sometimes) monitoring
- Five web UIs, three apps, and a lot of context-switching

Flightdeck collapses that into one interface, owned by me, running on my network.

---

## Features

> Flightdeck is built in three tiers. Tier 1 is in active development; Tiers 2 and 3 describe the full vision.

### Tier 1 — Status Dashboard *(in development)*

- Live status from all printers in a single view
- Temperatures (hotend, bed, chamber where available)
- Print progress with time elapsed / time remaining
- Current file, layer, and toolhead position
- Webcam thumbnails / live streams
- MMU state for the Voron (gate, filament loaded, swap progress)
- Per-printer connection health and last-seen timestamps

### Tier 2 — Controls *(planned)*

- Start / pause / resume / cancel prints
- Pre-heat profiles and idle/sleep state machine
- Emergency stop with confirmation
- Filament load / unload / swap on the MMU
- Macro execution (PRINT_START, CUT_FILAMENT, calibration routines)
- Bed mesh visualisation and recalibration triggers
- AMS / external spool management for the Bambu side

### Tier 3 — Cockpit *(aspirational)*

- Cross-printer queue and scheduling
- Per-spool filament inventory with weight tracking
- Print history with searchable metadata (filament, profile, outcome)
- Failure detection and alerting (FlowGuard integration, Lidar errors, thermal anomalies)
- Energy monitoring per print
- Klipper input shaper / pressure advance history per machine
- A genuinely useful mobile view

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Flightdeck (Pi 5)                        │
│                                                             │
│  ┌─────────────┐    ┌──────────────┐    ┌───────────────┐   │
│  │   FastAPI   │◄──►│   SQLite     │◄──►│  WebSocket    │   │
│  │   backend   │    │   (state +   │    │   broadcast   │   │
│  │             │    │    history)  │    │   to clients  │   │
│  └──────┬──────┘    └──────────────┘    └───────┬───────┘   │
│         │                                       │           │
│  ┌──────▼──────────────────────────────┐  ┌─────▼────────┐  │
│  │      Printer adapters               │  │   Frontend   │  │
│  │  ┌───────────┐  ┌────────────────┐  │  │   (React)    │  │
│  │  │ Moonraker │  │ bambulabs-api  │  │  │              │  │
│  │  │  (Voron)  │  │  (MQTT, H2D +  │  │  └──────────────┘  │
│  │  │           │  │      X1C)      │  │                    │
│  │  └─────┬─────┘  └────────┬───────┘  │                    │
│  └────────┼─────────────────┼──────────┘                    │
└───────────┼─────────────────┼──────────────────────────────-┘
            │                 │
       ┌────▼────┐       ┌────▼──────────┐
       │  Voron  │       │  Bambu H2D /  │
       │  CB2    │       │     X1C       │
       └─────────┘       └───────────────┘
```

### Stack

- **Backend:** Python 3.13 + FastAPI, async throughout
- **Storage:** SQLite (local, no Postgres dependency — this is a homelab tool)
- **Realtime:** WebSockets for push updates to the frontend
- **Bambu integration:** [`bambulabs-api`](https://github.com/mchrisgm/bambulabs_api) over MQTT
- **Klipper integration:** Moonraker JSON-RPC over WebSocket
- **Frontend:** React (Node 24 via nvm)
- **Host:** Raspberry Pi 5 with NVMe SSD, Debian 13 Trixie

### Design decisions

- **Pi 5, not the Voron's CB2.** Flightdeck runs on its own host so a dashboard bug or restart can never take down a printer mid-job. The Voron's CB2 stays dedicated to Klipper.
- **SQLite over Postgres.** Single-host, single-user, low write volume. The operational overhead of Postgres isn't worth it here.
- **FastAPI over Node.** A Replit prototype was built in TypeScript/Node/Express/Drizzle/Postgres and lives in the repo for reference, but the production path is Python — better fit for the Klipper/printer-tooling ecosystem the rest of the bench already runs on.
- **Local-first, no cloud.** No accounts, no telemetry leaving the network. Bambu's MQTT bridge is the only thing that touches the internet, and only because the X1C requires it.

---

## Installation

> **Status:** Tier 1 scaffolding in progress. Expect breakage.

### Prerequisites

- Raspberry Pi 5 (or equivalent Linux host) with at least 4 GB RAM
- Debian 13 (Trixie) or similar
- Python 3.13+
- Node 24+ (recommended via `nvm`)
- Network reachability to all printers

### Setup

```bash
# Clone
git clone https://github.com/YOUR_USER/flightdeck.git
cd flightdeck

# Backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# Frontend
cd frontend
npm install
npm run build
cd ..

# Configure
cp config/flightdeck.example.toml config/flightdeck.toml
$EDITOR config/flightdeck.toml   # add printer IPs, MQTT credentials, etc.

# Run
python -m flightdeck
```

The dashboard will be available at `http://<host>:8000`.

### Configuration

Printers are declared in `config/flightdeck.toml`:

```toml
[[printers]]
name = "Greyhound Elite V2"
kind = "klipper"
moonraker_url = "http://192.168.4.42:7125"

[[printers]]
name = "Bambu H2D"
kind = "bambu"
ip = "192.168.4.50"
serial = "XXXXXXXXXXXXX"
access_code = "XXXXXXXX"
```

Sensitive values can live in environment variables and be referenced with `${VAR}` syntax.

---

## Usage

Once running, open the dashboard in any browser on the local network. Printers should auto-connect and start streaming state within a few seconds. If one's offline, it'll show as unreachable rather than blocking the rest of the view.

There's no user account system — Flightdeck assumes you trust everyone on your LAN. If that's not true for your network, put it behind Tailscale or an authenticating reverse proxy.

---

## Roadmap

- [x] Pi 5 host commissioned, SSH-hardened, NVMe-backed
- [ ] FastAPI scaffolding + SQLite schema
- [ ] Moonraker adapter (Voron)
- [ ] bambulabs-api adapter (H2D, X1C)
- [ ] WebSocket fan-out
- [ ] Tier 1 frontend
- [ ] Tier 2 controls (start/pause/cancel, macros, MMU)
- [ ] Tier 3 cockpit (queue, history, inventory)

---

## Acknowledgements

- The Voron, Klipper, and Moonraker communities for keeping the open ecosystem alive.
- [`bambulabs-api`](https://github.com/mchrisgm/bambulabs_api) for making the Bambu side hackable at all.
- Julian Schill's [`klipper_led_effect`](https://github.com/julianschill/klipper_led_effect) — not part of Flightdeck, but it's the reason my Voron's LEDs aren't a perpetual source of suffering.
- igiannakas, for Cartographer/Happy Hare wisdom passed along at exactly the right moments.

---

## License

MIT — see [LICENSE](LICENSE).
