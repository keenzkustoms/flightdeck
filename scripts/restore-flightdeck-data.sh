#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 /path/to/flightdeck-backup-YYYYmmdd-HHMMSS.tar.gz" >&2
  exit 1
fi

ARCHIVE="$1"
APP_DIR="${APP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"

read_env() {
  local key="$1"
  local fallback="$2"
  local value=""
  if [[ -f "${APP_DIR}/.env" ]]; then
    value="$(grep -E "^${key}=" "${APP_DIR}/.env" | tail -1 | cut -d= -f2- || true)"
  fi
  value="${value%\"}"
  value="${value#\"}"
  value="${value%\'}"
  value="${value#\'}"
  value="${value/#\~/${HOME}}"
  printf '%s' "${value:-${fallback}}"
}

DATA_DIR="${FLIGHTDECK_DATA_DIR:-$(read_env FLIGHTDECK_DATA_DIR "${HOME}/flightdeck-data")}"
SAFETY_DIR="${DATA_DIR}/restore-safety-$(date +%Y%m%d-%H%M%S)"
work_dir="$(mktemp -d)"

cleanup() {
  rm -rf "${work_dir}"
}
trap cleanup EXIT

if [[ ! -f "${ARCHIVE}" ]]; then
  echo "Backup archive not found: ${ARCHIVE}" >&2
  exit 1
fi

echo "== Flightdeck data restore =="
echo "Archive:  ${ARCHIVE}"
echo "App dir:  ${APP_DIR}"
echo "Data dir: ${DATA_DIR}"
echo
echo "Stop Flightdeck before restoring:"
echo "  sudo systemctl stop flightdeck.service"
echo
read -r -p "Type RESTORE to overwrite live Flightdeck data: " answer
if [[ "${answer}" != "RESTORE" ]]; then
  echo "Cancelled."
  exit 1
fi

mkdir -p "${DATA_DIR}" "${SAFETY_DIR}"

echo "Creating safety copy of current live data..."
for item in flightdeck.db printers.yaml uploads settings backup_metadata.json spools.db print_library; do
  if [[ -e "${DATA_DIR}/${item}" ]]; then
    cp -a "${DATA_DIR}/${item}" "${SAFETY_DIR}/"
  fi
done

tar -xzf "${ARCHIVE}" -C "${work_dir}"
backup_root="$(find "${work_dir}" -mindepth 1 -maxdepth 1 -type d | head -1)"
if [[ -z "${backup_root}" || ! -d "${backup_root}/flightdeck-data" ]]; then
  echo "Archive does not look like a Flightdeck backup." >&2
  exit 1
fi

echo "Restoring data files..."
for item in flightdeck.db printers.yaml uploads settings backup_metadata.json spools.db print_library; do
  if [[ -e "${backup_root}/flightdeck-data/${item}" ]]; then
    rm -rf "${DATA_DIR:?}/${item}"
    cp -a "${backup_root}/flightdeck-data/${item}" "${DATA_DIR}/"
  fi
done

if [[ -d "${backup_root}/app/settings" ]]; then
  rm -rf "${APP_DIR}/settings"
  cp -a "${backup_root}/app/settings" "${APP_DIR}/settings"
fi

echo
echo "Restore complete."
echo "Safety copy:"
echo "  ${SAFETY_DIR}"
echo
echo "Start Flightdeck again:"
echo "  sudo systemctl start flightdeck.service"
echo "or:"
echo "  sudo ./scripts/safe-restart-flightdeck.sh"
