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

> **Status:** active homelab project. The default install keeps runtime data outside the git checkout so updates can be pulled cleanly.

### Prerequisites

- Raspberry Pi 5 (or equivalent Linux host) with at least 4 GB RAM
- Debian 13 (Trixie) or similar
- Python 3.13+
- Network reachability to all printers

### Setup

```bash
# Clone
git clone https://github.com/Kidabah/flightdeck.git
cd flightdeck

# Creates .venv, .env, the data directory, SQLite DB, uploads, and print library.
./scripts/install.sh
```

By default the installer stores live data in `~/flightdeck-data`:

- `flightdeck.db`
- `printers.yaml`
- `uploads/`
- `print_library/`

That keeps your printer config, queue/history database, uploaded files, and SD/library cache out of git. A fresh clone starts clean, and an existing install can pull updates without overwriting real data.

Run manually:

```bash
FLIGHTDECK_DATA_DIR=~/flightdeck-data .venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Install or update the systemd service for this checkout:

```bash
./scripts/install-systemd.sh
```

The dashboard will be available locally at `http://127.0.0.1:8000`.

For remote access, prefer Tailscale Serve:

```bash
tailscale serve --bg http://127.0.0.1:8000
```

This keeps Flightdeck off the raw LAN interface while exposing it over your tailnet HTTPS URL.

### Configuration

Printers are declared in the data directory's `printers.yaml`. The installer creates it from `printers.yaml.example` if it does not already exist.

```bash
$EDITOR ~/flightdeck-data/printers.yaml
```

Runtime paths can be overridden in `.env`:

```env
FLIGHTDECK_DATA_DIR=/home/flightdeck/flightdeck-data
# FLIGHTDECK_DB_PATH=/home/flightdeck/flightdeck-data/flightdeck.db
# FLIGHTDECK_UPLOADS_DIR=/home/flightdeck/flightdeck-data/uploads
# FLIGHTDECK_PRINTERS_CONFIG=/home/flightdeck/flightdeck-data/printers.yaml
# FLIGHTDECK_PRINT_LIBRARY=/home/flightdeck/flightdeck-data/print_library
```

### Migrating an Existing Pi Install

The portable migration script moves the live DB, printer config, uploads, and print library into `~/flightdeck-data`, then updates `.env`.

```bash
sudo systemctl stop flightdeck.service
./scripts/migrate-to-portable-data.sh
./scripts/install-systemd.sh
```

The script asks you to type `MIGRATE` before it moves anything.

---

## Usage

Once running, open the dashboard in any browser on the local network. Printers should auto-connect and start streaming state within a few seconds. If one's offline, it'll show as unreachable rather than blocking the rest of the view.

There's no user account system — Flightdeck assumes you trust everyone on your LAN. If that's not true for your network, put it behind Tailscale or an authenticating reverse proxy.

---

## Flight Manual

### H2D Dual-Nozzle Colour Prints

For Bambu H2D jobs that use both nozzles, confirm the slicer has built the nozzle mapping before sending the job.

1. In Flightdeck, open the AMS slot and use **Trust Flightdeck** if the AMS profile/vendor/colour does not match the physical spool.
2. In OrcaSlicer or Bambu Studio, sync filament from the AMS.
3. Assign the model parts to the intended filament colours.
4. Use **Regroup and slice** if the send dialog shows the wrong nozzle grouping.
5. Confirm the send dialog shows the intended split, for example left nozzle using filament `1` and right nozzle using filament `5`.
6. Send the job once the filament/nozzle grouping matches the physical AMS setup.

If the slicer model has no geometry assigned to a colour, the send dialog may leave that nozzle blank even when Flightdeck and the AMS are correct.

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
