#!/bin/bash
set -euo pipefail
cd /home/flightdeck/flightdeck
git pull --ff-only
sed -i 's/\r$//' jukebox/scripts/build-cindy-library-view.sh || true
chmod +x jukebox/scripts/build-cindy-library-view.sh
bash jukebox/scripts/build-cindy-library-view.sh
cd jukebox
docker compose up -d --build
sleep 4
curl -fsS "http://127.0.0.1:4540/api/health" || true
echo
docker exec cindy-vinyl python - <<'PY'
import hashlib, os, random, urllib.parse, urllib.request
base = os.environ.get("NAVIDROME_URL", "http://navidrome:4533").rstrip("/")
user = os.environ["JUKEBOX_USER"]
password = os.environ["JUKEBOX_PASSWORD"]
salt = str(random.randint(100000, 999999))
token = hashlib.md5(f"{password}{salt}".encode()).hexdigest()
qs = urllib.parse.urlencode({
    "u": user, "t": token, "s": salt, "v": "1.16.1", "c": "cindy-vinyl",
    "f": "json", "fullScan": "true",
})
url = f"{base}/rest/startScan.view?{qs}"
try:
    raw = urllib.request.urlopen(url, timeout=30).read().decode()
    print("startScan:", raw[:400])
except Exception as e:
    print("startScan failed:", e)
PY
echo "--- music roots in container ---"
docker exec cindy-navidrome ls -la /music
echo "--- CHECKED has #recycle? ---"
docker exec cindy-navidrome sh -c 'ls /music/CHECKED | head -20; ls /music/CHECKED | grep -c recycle || true'
echo "--- vinyl newest sample ---"
curl -fsS "http://127.0.0.1:4540/api/albums?type=newest&size=3" | head -c 900
echo
