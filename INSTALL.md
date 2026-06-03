# Flightdeck Install Guide

This is the simple first-install path for testers running Flightdeck on a Raspberry Pi.

Flightdeck is still early software. Start on your LAN, keep printer credentials private, and use Tailscale or another private VPN for remote access instead of exposing it directly to the public internet.

## What You Need

- Raspberry Pi 5 recommended, 8 GB or better preferred for several camera feeds.
- Raspberry Pi OS 64-bit.
- Bambu printers in LAN mode, if you use Bambu machines.
- Moonraker reachable on the network, if you use Voron/Klipper machines.
- Optional hardware: Dymo USB scale and Brother QL-700 label printer.
- Optional remote access: Tailscale.

## 1. Install System Packages

SSH into the Pi, then run:

```bash
sudo apt update
sudo apt install -y git python3 python3-venv python3-pip ffmpeg curl
```

## 2. Clone Flightdeck

```bash
cd ~
git clone https://github.com/Kidabah/flightdeck.git
cd flightdeck
```

## 3. Run the Installer

```bash
./scripts/install.sh
```

This creates the Python environment and prepares the default data folder:

```text
~/flightdeck-data
```

Your live data lives there, not inside the repo. That keeps clean installs and GitHub updates from overwriting your printers, history, spools, uploads, or print vault.

## 4. Configure Printers

Edit the generated printer config:

```bash
nano ~/flightdeck-data/printers.yaml
```

Use `printers.yaml.example` in the repo as a guide.

For Bambu printers, you generally need:

- LAN IP address
- serial number
- access code
- MQTT/camera details

For Voron/Klipper printers, you generally need:

- Moonraker URL
- camera URL, if available

## 5. Run Flightdeck Once

```bash
FLIGHTDECK_DATA_DIR=~/flightdeck-data .venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Open this in a browser:

```text
http://<your-pi-ip>:8000
```

Press `Ctrl+C` in the terminal when you are ready to install it as a service.

## 6. Install the Service

```bash
./scripts/install-systemd.sh
```

Then check it:

```bash
systemctl status flightdeck.service
```

## Useful Commands

Restart Flightdeck safely:

```bash
sudo ./scripts/safe-restart-flightdeck.sh
```

View logs:

```bash
journalctl -u flightdeck.service -n 100 --no-pager
```

Clear camera workers without restarting the whole app:

```bash
./scripts/clear-camera-workers.sh
```

Check USB scale and label printer detection:

```bash
lsusb
```

## Optional: Tailscale

Tailscale is the recommended way to access Flightdeck away from home without opening public ports.

Install it on the Pi, join your tailnet, then access Flightdeck through the Pi's Tailscale IP or MagicDNS name.

Do not port-forward Flightdeck to the public internet while it is still in early testing.

## Optional: Scale and Label Printer

Flightdeck can work without the scale or label printer.

If they are connected but unavailable, confirm they appear in `lsusb`, then check the Hardware tab in Flightdeck.

Common supported hardware:

- Dymo USB scale
- Brother QL-700 using DK-22212 continuous labels

## Updating Flightdeck

From the repo folder:

```bash
cd ~/flightdeck
git pull
./scripts/install.sh
sudo ./scripts/safe-restart-flightdeck.sh
```

Because your data lives in `~/flightdeck-data`, updating the app should not wipe your printer history, spools, uploads, or print vault.
