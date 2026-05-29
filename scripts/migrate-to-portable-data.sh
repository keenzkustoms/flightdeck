#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
DATA_DIR="${FLIGHTDECK_DATA_DIR:-${HOME}/flightdeck-data}"
OLD_PRINT_LIBRARY="${OLD_PRINT_LIBRARY:-/home/flightdeck/print_library}"

echo "== Flightdeck portable data migration =="
echo "App dir:  ${APP_DIR}"
echo "Data dir: ${DATA_DIR}"
echo
echo "Stop Flightdeck first:"
echo "  sudo systemctl stop flightdeck.service"
echo
read -r -p "Continue migration now? Type MIGRATE: " answer
if [[ "${answer}" != "MIGRATE" ]]; then
  echo "Cancelled."
  exit 1
fi

mkdir -p "${DATA_DIR}/uploads" "${DATA_DIR}/print_library"

move_if_present() {
  local src="$1"
  local dst="$2"
  if [[ ! -e "${src}" ]]; then
    return
  fi
  if [[ -e "${dst}" ]]; then
    echo "Keeping existing ${dst}; leaving ${src} in place."
    return
  fi
  mv "${src}" "${dst}"
  echo "Moved ${src} -> ${dst}"
}

move_if_present "${APP_DIR}/flightdeck.db" "${DATA_DIR}/flightdeck.db"
move_if_present "${APP_DIR}/printers.yaml" "${DATA_DIR}/printers.yaml"
move_if_present "${APP_DIR}/uploads" "${DATA_DIR}/uploads"

if [[ -d "${OLD_PRINT_LIBRARY}" && "${OLD_PRINT_LIBRARY}" != "${DATA_DIR}/print_library" ]]; then
  if [[ -d "${DATA_DIR}/print_library" && -n "$(find "${DATA_DIR}/print_library" -mindepth 1 -maxdepth 1 2>/dev/null)" ]]; then
    echo "Keeping existing ${DATA_DIR}/print_library; leaving ${OLD_PRINT_LIBRARY} in place."
  else
    rm -rf "${DATA_DIR}/print_library"
    mv "${OLD_PRINT_LIBRARY}" "${DATA_DIR}/print_library"
    echo "Moved ${OLD_PRINT_LIBRARY} -> ${DATA_DIR}/print_library"
  fi
fi

if [[ ! -f "${APP_DIR}/.env" ]]; then
  cp "${APP_DIR}/.env.example" "${APP_DIR}/.env"
fi

if grep -q '^FLIGHTDECK_DATA_DIR=' "${APP_DIR}/.env"; then
  sed -i "s#^FLIGHTDECK_DATA_DIR=.*#FLIGHTDECK_DATA_DIR=${DATA_DIR}#" "${APP_DIR}/.env"
else
  printf '\nFLIGHTDECK_DATA_DIR=%s\n' "${DATA_DIR}" >> "${APP_DIR}/.env"
fi

echo
echo "Migration complete."
echo "Update systemd service if needed:"
echo "  ${APP_DIR}/scripts/install-systemd.sh"
