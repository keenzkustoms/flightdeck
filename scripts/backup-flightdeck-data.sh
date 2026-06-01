#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
BACKUP_REPO_URL="${BACKUP_REPO_URL:-https://github.com/Kidabah/flightdeck-backup-private.git}"
BACKUP_REPO_DIR="${BACKUP_REPO_DIR:-${HOME}/flightdeck-backup-private}"
BACKUP_STAGING_DIR="${BACKUP_STAGING_DIR:-}"
INCLUDE_PRINT_LIBRARY="${INCLUDE_PRINT_LIBRARY:-0}"
PUSH_BACKUP="${PUSH_BACKUP:-1}"

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
DB_PATH="${FLIGHTDECK_DB_PATH:-$(read_env FLIGHTDECK_DB_PATH "${DATA_DIR}/flightdeck.db")}"
PRINTERS_CONFIG="${FLIGHTDECK_PRINTERS_CONFIG:-$(read_env FLIGHTDECK_PRINTERS_CONFIG "${DATA_DIR}/printers.yaml")}"
UPLOADS_DIR="${FLIGHTDECK_UPLOADS_DIR:-$(read_env FLIGHTDECK_UPLOADS_DIR "${DATA_DIR}/uploads")}"
PRINT_LIBRARY="${FLIGHTDECK_PRINT_LIBRARY:-$(read_env FLIGHTDECK_PRINT_LIBRARY "${DATA_DIR}/print_library")}"

timestamp="$(date +%Y%m%d-%H%M%S)"
backup_name="flightdeck-backup-${timestamp}"
work_dir="$(mktemp -d)"
stage="${work_dir}/${backup_name}"

cleanup() {
  rm -rf "${work_dir}"
}
trap cleanup EXIT

copy_if_exists() {
  local src="$1"
  local dst="$2"
  if [[ ! -e "${src}" ]]; then
    return
  fi
  mkdir -p "$(dirname "${dst}")"
  cp -a "${src}" "${dst}"
}

echo "== Flightdeck data backup =="
echo "App dir:      ${APP_DIR}"
echo "Data dir:     ${DATA_DIR}"
echo "Backup repo:  ${BACKUP_REPO_DIR}"
if [[ -n "${BACKUP_STAGING_DIR}" ]]; then
  echo "Staging dir:  ${BACKUP_STAGING_DIR}"
fi
echo "Print vault:  ${PRINT_LIBRARY} (include=${INCLUDE_PRINT_LIBRARY})"

mkdir -p "${stage}/flightdeck-data" "${stage}/app"

if [[ -f "${DB_PATH}" ]]; then
  echo "Backing up SQLite database..."
  python3 - "${DB_PATH}" "${stage}/flightdeck-data/flightdeck.db" <<'PY'
import sqlite3
import sys

src, dst = sys.argv[1], sys.argv[2]
with sqlite3.connect(src) as source:
    with sqlite3.connect(dst) as target:
        source.backup(target)
PY
fi

copy_if_exists "${PRINTERS_CONFIG}" "${stage}/flightdeck-data/printers.yaml"
copy_if_exists "${UPLOADS_DIR}" "${stage}/flightdeck-data/uploads"
copy_if_exists "${DATA_DIR}/settings" "${stage}/flightdeck-data/settings"
copy_if_exists "${DATA_DIR}/backup_metadata.json" "${stage}/flightdeck-data/backup_metadata.json"
copy_if_exists "${DATA_DIR}/spools.db" "${stage}/flightdeck-data/spools.db"
copy_if_exists "${APP_DIR}/settings" "${stage}/app/settings"
copy_if_exists "${APP_DIR}/backup_metadata.json" "${stage}/app/backup_metadata.json"

if [[ "${INCLUDE_PRINT_LIBRARY}" == "1" ]]; then
  copy_if_exists "${PRINT_LIBRARY}" "${stage}/flightdeck-data/print_library"
else
  mkdir -p "${stage}/flightdeck-data/print_library"
  cat > "${stage}/flightdeck-data/print_library/README.txt" <<'TXT'
Print vault intentionally omitted.
Run with INCLUDE_PRINT_LIBRARY=1 to include print_library in the backup archive.
TXT
fi

cat > "${stage}/MANIFEST.txt" <<TXT
Flightdeck backup
Created: ${timestamp}
Host: $(hostname)
App dir: ${APP_DIR}
Data dir: ${DATA_DIR}
Database: ${DB_PATH}
Printer config: ${PRINTERS_CONFIG}
Uploads: ${UPLOADS_DIR}
Print library included: ${INCLUDE_PRINT_LIBRARY}

Excluded by design:
- .env and secrets
- SSH keys
- virtual environments and caches
- generated camera/transcode temp files
TXT

if [[ ! -d "${BACKUP_REPO_DIR}/.git" ]]; then
  echo "Cloning private backup repo..."
  git clone "${BACKUP_REPO_URL}" "${BACKUP_REPO_DIR}"
fi

if ! git -C "${BACKUP_REPO_DIR}" config user.email >/dev/null; then
  git -C "${BACKUP_REPO_DIR}" config user.email "flightdeck-backup@local"
fi
if ! git -C "${BACKUP_REPO_DIR}" config user.name >/dev/null; then
  git -C "${BACKUP_REPO_DIR}" config user.name "Flightdeck Backup"
fi

mkdir -p "${BACKUP_REPO_DIR}/backups"
archive="${BACKUP_REPO_DIR}/backups/${backup_name}.tar.gz"
tar -czf "${archive}" -C "${work_dir}" "${backup_name}"
(cd "$(dirname "${archive}")" && sha256sum "$(basename "${archive}")") > "${archive}.sha256"

if [[ ! -f "${BACKUP_REPO_DIR}/README.md" ]]; then
  cat > "${BACKUP_REPO_DIR}/README.md" <<'TXT'
# Flightdeck Backup Private

Private recovery archives for Flightdeck live data.

These backups intentionally exclude `.env`, SSH keys, Python virtual environments, and generated caches.
TXT
fi

git -C "${BACKUP_REPO_DIR}" add README.md backups
if git -C "${BACKUP_REPO_DIR}" diff --cached --quiet; then
  echo "No backup changes to commit."
else
  git -C "${BACKUP_REPO_DIR}" commit -m "Flightdeck backup ${timestamp}"
fi

if [[ "${PUSH_BACKUP}" == "1" ]]; then
  git -C "${BACKUP_REPO_DIR}" push origin HEAD
fi

if [[ -n "${BACKUP_STAGING_DIR}" ]]; then
  mkdir -p "${BACKUP_STAGING_DIR}"
  cp -a "${archive}" "${archive}.sha256" "${BACKUP_STAGING_DIR}/"
fi

echo
echo "Backup complete:"
echo "  ${archive}"
if [[ -n "${BACKUP_STAGING_DIR}" ]]; then
  echo "  ${BACKUP_STAGING_DIR}/$(basename "${archive}")"
fi
echo
echo "Restore with:"
echo "  ./scripts/restore-flightdeck-data.sh ${archive}"
