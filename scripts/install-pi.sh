#!/usr/bin/env bash
set -euo pipefail

REPO_URL="${FLIGHTDECK_REPO_URL:-https://github.com/Kidabah/flightdeck.git}"
APP_DIR="${FLIGHTDECK_APP_DIR:-${HOME}/flightdeck}"
DATA_DIR="${FLIGHTDECK_DATA_DIR:-${HOME}/flightdeck-data}"
PYTHON="${PYTHON:-python3}"

echo "== Flightdeck install: easy as 1-2-3 =="
echo "1. Install Flightdeck"
echo "2. Add printers"
echo "3. Add spools"
echo
echo "App dir:  ${APP_DIR}"
echo "Data dir: ${DATA_DIR}"

if ! command -v sudo >/dev/null 2>&1; then
  echo "This installer expects sudo to be available on Raspberry Pi OS." >&2
  exit 1
fi

echo
echo "Installing system packages..."
sudo apt update
sudo apt install -y git python3 python3-venv python3-pip ffmpeg curl
if command -v ffmpeg >/dev/null 2>&1; then
  FFMPEG_VERSION="$(ffmpeg -version 2>/dev/null | head -n 1 || true)"
  FFMPEG_TESTED_RE='ffmpeg version (5|6|7|8)(\.|[[:space:]]|-)'
  echo "ffmpeg ready: ${FFMPEG_VERSION}"
  if [[ "${FFMPEG_VERSION}" =~ ${FFMPEG_TESTED_RE} ]]; then
    echo "ffmpeg compatibility: tested Flightdeck camera driver family"
  else
    echo "ffmpeg compatibility: untested FFmpeg major version for Flightdeck camera proxy"
    echo "Flightdeck is tested with Raspberry Pi OS/Debian apt FFmpeg 5.x and Gyan Windows FFmpeg 8.x."
  fi
fi

echo
if [[ -d "${APP_DIR}/.git" ]]; then
  echo "Updating existing Flightdeck checkout..."
  git -C "${APP_DIR}" pull --ff-only
else
  echo "Cloning Flightdeck..."
  git clone "${REPO_URL}" "${APP_DIR}"
fi

cd "${APP_DIR}"

echo
echo "Installing Flightdeck app..."
FLIGHTDECK_DATA_DIR="${DATA_DIR}" PYTHON="${PYTHON}" ./scripts/install.sh

echo
echo "Installing and starting Flightdeck service..."
FLIGHTDECK_DATA_DIR="${DATA_DIR}" ./scripts/install-systemd.sh

HOST_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"

cat <<EOF

Flightdeck is installed.

Open:
  http://${HOST_IP:-<your-pi-ip>}:8000

Easy as 1-2-3:
  1. Install: done.
  2. Add printers: System -> Settings -> Printers.
  3. Add spools: Spools.

Optional extras:
  - System -> Settings -> Hardware: check scale and label printer.
  - System -> Demo Mode: take the guided first-look tour.
  - System -> Settings -> Setup: confirm install health.

Useful commands:
  sudo ${APP_DIR}/scripts/safe-restart-flightdeck.sh
  journalctl -u flightdeck.service -n 100 --no-pager
EOF
