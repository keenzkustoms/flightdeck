# Flightdeck Raspberry Pi Install

Flightdeck beta is easiest to test on a Raspberry Pi 5 running Raspberry Pi OS 64-bit or a similar Debian-based host.

## Recommended Hardware

| Host | Fit |
| --- | --- |
| Pi 5 4 GB | Small Bambu installs and light camera use |
| Pi 5 8 GB | Recommended default |
| Pi 5 16 GB | Larger rooms, more cameras, and heavier testing |
| Pi 4 4 GB | Light testing only; expect less camera headroom |

Use wired Ethernet if possible. Camera streams and printer state are much calmer on a stable network.

## Before You Start

You need:

- Raspberry Pi OS 64-bit.
- Network access to the printer.
- For Bambu printers: printer IP, serial number, and access code.
- Optional: Tailscale for remote access.
- Optional: Dymo USB scale and Brother QL-700 label printer.

Do not port-forward Flightdeck to the public internet. Use LAN or Tailscale.

## 1. Install Flightdeck

SSH into the Pi and run:

```bash
curl -fsSL https://raw.githubusercontent.com/Kidabah/flightdeck/main/scripts/install-pi.sh | bash
```

The installer:

- Installs system packages.
- Clones or updates Flightdeck.
- Creates the Python virtual environment.
- Creates the data directory.
- Creates the SQLite database.
- Installs the systemd service.
- Prints the URL to open in your browser.

Default live data path:

```text
~/flightdeck-data
```

That folder holds printer config, database, uploads, and the Print Vault. It is intentionally outside the git checkout.

## 2. Add Printers

Open Flightdeck in your browser.

Go to:

```text
System -> Settings -> Printers
```

For a Bambu printer you usually need:

- Printer IP address.
- Printer serial number.
- LAN access code.
- Camera/MQTT reachable on the same network.

Add one printer first. Confirm it shows live state before adding the rest.

## 3. Add Spools

Go to:

```text
Spools
```

Recommended first pass:

1. Add shelf/storage locations.
2. Add one or two real spools.
3. Assign the loaded spool to the matching AMS/AMS HT slot.
4. Run a small test print.
5. Check Print History and spool deduction.

## 4. Optional Remote Access With Tailscale

Install Tailscale on the Pi, join your tailnet, then expose Flightdeck privately:

```bash
tailscale serve --bg http://127.0.0.1:8000
```

Use the printed Tailscale URL from your phone or another machine on your tailnet.

## Useful Commands

Restart safely:

```bash
cd ~/flightdeck
sudo ./scripts/safe-restart-flightdeck.sh
```

View logs:

```bash
journalctl -u flightdeck.service -n 100 --no-pager
```

Clear camera workers:

```bash
cd ~/flightdeck
./scripts/clear-camera-workers.sh
```

Update:

```bash
cd ~/flightdeck
git pull
./scripts/install.sh
sudo ./scripts/safe-restart-flightdeck.sh
```

## First Test Checklist

- Setup Health shows the backend is healthy.
- Printer appears online.
- Camera loads.
- AMS/AMS HT slots show expected filament.
- A spool is assigned to the physical slot.
- A small Bambu print can be queued or reprinted.
- Print History records the job.
- Spool deduction is correct or can be corrected.

If a step fails, see [Troubleshooting](TROUBLESHOOTING.md).
