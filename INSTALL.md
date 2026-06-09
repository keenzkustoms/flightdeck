# Flightdeck Install Guide

Flightdeck install, easy as 1-2-3:

1. **Install Flightdeck**
2. **Add printers**
3. **Add spools**

That is the normal path. Optional hardware such as scales and label printers can be checked afterwards from the Flightdeck settings screen.

Flightdeck is still early software. Start on your LAN, keep printer credentials private, and use Tailscale or another private VPN for remote access instead of exposing it directly to the public internet.

## What You Need

- Raspberry Pi OS 64-bit.
- Bambu printers in LAN mode, if you use Bambu machines.
- Moonraker reachable on the network, if you use Voron/Klipper machines.
- Optional hardware: Dymo USB scale and Brother QL-700 or AusPrint Pro label printer.
- Optional remote access: Tailscale.

## Raspberry Pi Sizing

These are practical starting points, not hard limits. Camera feeds, browser tabs, and Bambu RTSP workers are usually what decide how much headroom you need.

| Host | Best fit |
| --- | --- |
| Pi 5 4 GB | Small installs, up to about 5 printers, lighter camera use |
| Pi 5 8 GB | Recommended default for more than 5 printers or several live camera feeds |
| Pi 5 16 GB | Bigger rooms, more than 10 printers, heavy camera use, demo/testing headroom |
| Pi 4 4 GB | Light installs should run, but expect less camera headroom; Pi 5 is the main recommendation |

## Easy As 1-2-3

For a first install, use this path:

1. **Install** Flightdeck on the Pi using the command below.
2. **Add printers** in **System -> Settings -> Printers**.
3. **Add spools** in **Spools**, then add shelves, scale, and label printer if you have them.

After that, open **System -> Demo Mode** for a guided tour, or open `/demo` for the standalone interactive demo. Then use **System -> Settings -> Setup** to confirm the install health checks.

Keep destructive actions such as cancel, E-stop, SD cleanup, delete, and archive for a deliberate test pass.

## 1. Install Flightdeck

SSH into the Pi, then run this one command:

```bash
curl -fsSL https://raw.githubusercontent.com/Kidabah/flightdeck/main/scripts/install-pi.sh | bash
```

When it finishes, open the URL printed by the installer.

## Windows Tray Install

Flightdeck can also run on Windows as a quiet per-user tray app. It starts at login, keeps the backend hidden in the notification area, and opens the dashboard from the tray menu.

Requirements:

- Windows 10 or 11.
- A downloaded copy of this repository, or a Git clone.

Easy install:

1. Download or clone Flightdeck.
2. Open the Flightdeck folder.
3. Double-click `Install-Flightdeck-Windows.cmd`.

The bootstrap checks for Python, Git, and ffmpeg. If any are missing and `winget` is available, it asks Windows to install them. ffmpeg is required for Bambu live camera streams. If Windows SmartScreen warns because the installer is not digitally signed yet, choose **More info -> Run anyway**.

PowerShell install, if you prefer running it manually:

```powershell
.\scripts\windows\bootstrap-install.ps1
```

Install with an existing Flightdeck data backup:

```powershell
.\scripts\windows\bootstrap-install.ps1 -DataArchive "C:\Users\you\Downloads\flightdeck-backup-YYYYmmdd-HHMMSS.tar.gz"
```

To make that archive from the Pi with printer history, spools, uploads, and the print vault included:

```bash
cd /home/flightdeck/flightdeck
INCLUDE_PRINT_LIBRARY=1 ./scripts/backup-flightdeck-data.sh
```

The restore writes into `%LOCALAPPDATA%\Flightdeck` and creates a `restore-safety-YYYYmmdd-HHMMSS` folder first if Windows already has Flightdeck data there.

The installer creates:

```text
%LOCALAPPDATA%\Flightdeck
%LOCALAPPDATA%\Flightdeck\uploads
%LOCALAPPDATA%\Flightdeck\print_library
%LOCALAPPDATA%\Flightdeck\logs
```

It also creates Flightdeck-branded Desktop and Startup shortcuts, using `pythonw.exe` so no terminal window stays open. After login, Flightdeck appears in the Windows hidden icons / notification area. The tray menu can open the dashboard, update from GitHub, restart Flightdeck, and open logs.

Start it immediately without logging out:

```powershell
& ".\.venv\Scripts\pythonw.exe" ".\scripts\windows\flightdeck-tray.py"
```

Then open:

```text
http://127.0.0.1:8000
```

To remove the Startup shortcut:

```powershell
.\scripts\windows\uninstall-windows.ps1 -KeepData
```

## Manual Install

Use this only if you want to run each step yourself.

### Install System Packages

SSH into the Pi, then run:

```bash
sudo apt update
sudo apt install -y git python3 python3-venv python3-pip ffmpeg curl
```

### Clone Flightdeck

```bash
cd ~
git clone https://github.com/Kidabah/flightdeck.git
cd flightdeck
```

### Run the Installer

```bash
./scripts/install.sh
```

This creates the Python environment and prepares the default data folder:

```text
~/flightdeck-data
```

Your live data lives there, not inside the repo. That keeps clean installs and GitHub updates from overwriting your printers, history, spools, uploads, or print vault.

## 2. Add Printers

For normal installs, add printers from inside Flightdeck:

1. Open Flightdeck in your browser.
2. Go to **System -> Settings -> Printers**.
3. Click **Add printer**.
4. Choose the printer type and enter the connection details.

For Bambu printers, you generally need:

- LAN IP address
- serial number
- access code
- MQTT/camera details

For Voron/Klipper printers, you generally need:

- Moonraker URL
- camera URL, if available

Advanced/manual option: Flightdeck still stores printer config in:

```text
~/flightdeck-data/printers.yaml
```

You can edit that file directly for migrations, backups, or bulk setup. Use `printers.yaml.example` in the repo as a guide.

## 3. Add Spools

Open **Spools** in Flightdeck, then add your filament rolls.

For the best first pass:

1. Add shelf locations.
2. Add each spool with material, brand, colour, label weight, and remaining weight.
3. Use the optional scale to verify weight if connected.
4. Use the optional label printer to print spool labels if connected.

## Run Flightdeck Once Manually

```bash
FLIGHTDECK_DATA_DIR=~/flightdeck-data .venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Open this in a browser:

```text
http://<your-pi-ip>:8000
```

Press `Ctrl+C` in the terminal when you are ready to install it as a service.

## Install the Service Manually

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
- AusPrint Pro 300DPI direct thermal label printer on Windows

For AusPrint Pro, install the Windows printer driver first, then set these environment values before starting Flightdeck:

```powershell
FLIGHTDECK_LABEL_PRINTER_MODEL=ausprint_pro
FLIGHTDECK_LABEL_PRINTER_NAME=AusPrint
```

Use the exact Windows printer queue name, or a unique part of it, for `FLIGHTDECK_LABEL_PRINTER_NAME`.

## Updating Flightdeck

From the repo folder:

```bash
cd ~/flightdeck
git pull
./scripts/install.sh
sudo ./scripts/safe-restart-flightdeck.sh
```

Because your data lives in `~/flightdeck-data`, updating the app should not wipe your printer history, spools, uploads, or print vault.
