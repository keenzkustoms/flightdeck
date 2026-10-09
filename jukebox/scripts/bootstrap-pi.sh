#!/bin/bash
# Bootstrap Cindy Vinyl on the Pi (mounts + Navidrome + UI).
set -euo pipefail
ROOT=/home/flightdeck/flightdeck
BIN=/home/flightdeck/bin
DATA=/home/flightdeck/cindy-navidrome
ENVF="$ROOT/jukebox/.env"

cd "$ROOT"
git pull --ff-only

install -m 755 printshelf/scripts/mount-cindy.sh "$BIN/mount-cindy.sh"
install -m 755 printshelf/scripts/remount-printshelf-shares.sh "$BIN/remount-printshelf-shares.sh"
sed -i 's/\r$//' "$BIN/mount-cindy.sh" "$BIN/remount-printshelf-shares.sh" || true

echo "=== mount cindy ==="
bash "$BIN/mount-cindy.sh"

mkdir -p "$DATA/data"
chmod 700 "$DATA"

if [ ! -f "$ENVF" ]; then
  PASS=$(openssl rand -base64 18 | tr -d '/+=' | head -c 20)
  umask 077
  cat > "$ENVF" <<EOF
JUKEBOX_USER=jukebox
JUKEBOX_PASSWORD=$PASS
EOF
  echo "wrote $ENVF (password not printed)"
else
  echo "using existing $ENVF"
  # shellcheck disable=SC1090
  set -a
  # shellcheck disable=SC1091
  source "$ENVF"
  set +a
fi

# shellcheck disable=SC1090
set -a
# shellcheck disable=SC1091
source "$ENVF"
set +a

cd "$ROOT/jukebox"
docker compose pull navidrome || true
docker compose up -d --build

echo "=== wait for navidrome ==="
for i in $(seq 1 40); do
  if curl -sf "http://127.0.0.1:4533/ping" >/dev/null 2>&1; then
    echo "navidrome up"
    break
  fi
  sleep 2
done

# Create first admin if none exist yet
CREATE=$(curl -sS -o /tmp/nd-create.json -w "%{http_code}" -X POST "http://127.0.0.1:4533/auth/createAdmin" \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"${JUKEBOX_USER}\",\"password\":\"${JUKEBOX_PASSWORD}\"}" || true)
echo "createAdmin HTTP $CREATE"
cat /tmp/nd-create.json 2>/dev/null || true
echo

echo "=== vinyl health ==="
sleep 3
curl -sS --max-time 10 "http://127.0.0.1:4540/api/health" || true
echo
docker compose ps
echo "Open: http://$(tailscale ip -4 2>/dev/null | head -1):4540  or  http://flightdeck.tail7de73e.ts.net:4540"
