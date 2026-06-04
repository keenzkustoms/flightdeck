#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
DATA_DIR="${FLIGHTDECK_DATA_DIR:-${HOME}/flightdeck-data}"
PYTHON="${PYTHON:-python3}"

echo "== Flightdeck install =="
echo "App dir:  ${APP_DIR}"
echo "Data dir: ${DATA_DIR}"

cd "${APP_DIR}"

mkdir -p "${DATA_DIR}/uploads" "${DATA_DIR}/print_library"

if [[ ! -f ".env" ]]; then
  cp ".env.example" ".env"
  if grep -q '^FLIGHTDECK_DATA_DIR=' ".env"; then
    sed -i "s#^FLIGHTDECK_DATA_DIR=.*#FLIGHTDECK_DATA_DIR=${DATA_DIR}#" ".env"
  else
    printf '\nFLIGHTDECK_DATA_DIR=%s\n' "${DATA_DIR}" >> ".env"
  fi
  echo "Created .env"
else
  echo ".env already exists; leaving it untouched."
fi

if [[ ! -f "${DATA_DIR}/printers.yaml" ]]; then
  cp "printers.yaml.example" "${DATA_DIR}/printers.yaml"
  echo "Created ${DATA_DIR}/printers.yaml"
else
  echo "Printer config already exists; leaving it untouched."
fi

if [[ ! -d ".venv" ]]; then
  "${PYTHON}" -m venv .venv
fi

.venv/bin/python -m pip install --upgrade pip
.venv/bin/python -m pip install -r requirements.txt

FLIGHTDECK_DATA_DIR="${DATA_DIR}" .venv/bin/python - <<'PY'
from app import db
db.init()
print(f"Database ready: {db.DB_PATH}")
print(f"Uploads ready:  {db.UPLOADS_DIR}")
PY

cat <<EOF

Install complete.

Next steps:
  1. Install: done.
  2. Add printers in Flightdeck:
     System -> Settings -> Printers
  3. Add spools in Flightdeck:
     Spools

Advanced printer config file:
  ${DATA_DIR}/printers.yaml

Run locally:
  cd ${APP_DIR}
  FLIGHTDECK_DATA_DIR=${DATA_DIR} .venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000

To install systemd service:
  ${APP_DIR}/scripts/install-systemd.sh
EOF
