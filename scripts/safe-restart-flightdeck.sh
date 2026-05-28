#!/usr/bin/env bash
set -euo pipefail

SERVICE="${SERVICE:-flightdeck.service}"
APP_DIR="${APP_DIR:-/home/flightdeck/flightdeck}"
STOP_TIMEOUT="${STOP_TIMEOUT:-20}"
START_TIMEOUT="${START_TIMEOUT:-30}"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-45}"

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run with sudo: sudo $0" >&2
  exit 1
fi

echo "== Flightdeck safe restart =="
echo "Service: ${SERVICE}"
echo "App dir:  ${APP_DIR}"

echo
echo "Stopping service..."
if ! timeout "${STOP_TIMEOUT}" systemctl stop "${SERVICE}"; then
  echo "Stop did not complete within ${STOP_TIMEOUT}s; cleaning leftover processes."
fi

collect_leftovers() {
  local pids=()
  while IFS= read -r pid; do
    [[ -n "${pid}" ]] && pids+=("${pid}")
  done < <(pgrep -f "${APP_DIR}/.venv/bin/uvicorn app.main:app" || true)
  while IFS= read -r pid; do
    [[ -n "${pid}" ]] && pids+=("${pid}")
  done < <(pgrep -f "ffmpeg .*streaming/live" || true)
  printf '%s\n' "${pids[@]}" | awk 'NF && !seen[$0]++'
}

mapfile -t leftovers < <(collect_leftovers)
if ((${#leftovers[@]})); then
  echo
  echo "Leftover Flightdeck processes:"
  ps -o pid,ppid,etime,cmd -p "$(IFS=,; echo "${leftovers[*]}")" || true

  echo
  echo "Asking leftovers to exit..."
  kill "${leftovers[@]}" 2>/dev/null || true
  sleep 3

  mapfile -t leftovers < <(collect_leftovers)
  if ((${#leftovers[@]})); then
    echo "Forcing remaining leftovers to exit..."
    ps -o pid,ppid,etime,cmd -p "$(IFS=,; echo "${leftovers[*]}")" || true
    kill -9 "${leftovers[@]}" 2>/dev/null || true
  fi
else
  echo "No leftover uvicorn/ffmpeg processes found."
fi

echo
echo "Starting service..."
systemctl start "${SERVICE}"

echo "Waiting for active state..."
deadline=$((SECONDS + START_TIMEOUT))
until systemctl is-active --quiet "${SERVICE}"; do
  if ((SECONDS >= deadline)); then
    echo "Service did not become active within ${START_TIMEOUT}s." >&2
    systemctl status "${SERVICE}" --no-pager || true
    exit 1
  fi
  sleep 1
done

echo
echo "Service is active."
systemctl status "${SERVICE}" --no-pager --lines=8

echo
echo "Local health check:"
deadline=$((SECONDS + HEALTH_TIMEOUT))
while true; do
  if curl -fsS --max-time 5 http://127.0.0.1:8000/api/printers >/tmp/flightdeck-printers.json; then
    python3 - <<'PY'
import json
from pathlib import Path

data = json.loads(Path("/tmp/flightdeck-printers.json").read_text())
for p in data:
    name = p.get("model_name") or p.get("id")
    state = p.get("state")
    bits = [f"{name}: {state}"]
    for unit in p.get("ams") or []:
        if unit.get("humidity") is not None:
            bits.append(f"{unit.get('label', 'AMS')} {unit['humidity']}% RH")
    print(" | ".join(bits))
PY
    break
  fi

  if ((SECONDS >= deadline)); then
    echo "Flightdeck started, but /api/printers did not respond within ${HEALTH_TIMEOUT}s." >&2
    systemctl status "${SERVICE}" --no-pager --lines=20 || true
    exit 1
  fi

  sleep 2
done

echo
echo "Done."
