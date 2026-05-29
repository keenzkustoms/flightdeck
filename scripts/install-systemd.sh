#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
SERVICE_NAME="${SERVICE_NAME:-flightdeck.service}"
SERVICE_USER="${FLIGHTDECK_USER:-$(id -un)}"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}"
TMP_FILE="$(mktemp)"

cat > "${TMP_FILE}" <<EOF
[Unit]
Description=Flightdeck
After=network.target

[Service]
User=${SERVICE_USER}
WorkingDirectory=${APP_DIR}
EnvironmentFile=-${APP_DIR}/.env
ExecStart=${APP_DIR}/.venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

echo "Installing ${SERVICE_NAME}"
echo "App dir: ${APP_DIR}"
echo "User:    ${SERVICE_USER}"

sudo install -m 0644 "${TMP_FILE}" "${SERVICE_FILE}"
rm -f "${TMP_FILE}"

sudo systemctl daemon-reload
sudo systemctl enable --now "${SERVICE_NAME}"
sudo systemctl status "${SERVICE_NAME}" --no-pager --lines=20
