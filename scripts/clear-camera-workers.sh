#!/usr/bin/env bash
set -euo pipefail

APP_USER="${FLIGHTDECK_USER:-$(id -un)}"
PATTERN="ffmpeg .*streaming/live"

echo "== Flightdeck camera worker reset =="
echo "User: ${APP_USER}"

if ! pgrep -u "${APP_USER}" -af "${PATTERN}" >/tmp/flightdeck-camera-workers.$$ 2>/dev/null; then
  echo "No Bambu camera ffmpeg workers found."
  rm -f /tmp/flightdeck-camera-workers.$$
  exit 0
fi

echo
echo "Workers before reset:"
cat /tmp/flightdeck-camera-workers.$$
rm -f /tmp/flightdeck-camera-workers.$$

echo
echo "Stopping camera workers..."
pkill -u "${APP_USER}" -f "${PATTERN}" || true
sleep 1

remaining="$(pgrep -u "${APP_USER}" -af "${PATTERN}" || true)"
if [ -n "${remaining}" ]; then
  echo "Forcing remaining workers..."
  pkill -9 -u "${APP_USER}" -f "${PATTERN}" || true
  sleep 1
fi

count="$(pgrep -u "${APP_USER}" -af "${PATTERN}" | wc -l || true)"
echo "Workers after reset: ${count}"
echo "Flightdeck will start a fresh camera worker next time a live feed is opened."
