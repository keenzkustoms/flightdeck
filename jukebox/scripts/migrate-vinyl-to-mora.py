#!/usr/bin/env python3
"""Migrate Cindy Vinyl + Navidrome from Pi → Mora volume2 SSD."""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

creds: dict[str, str] = {}
for line in Path("/home/flightdeck/.smbcredentials-mora").read_text().splitlines():
    if "=" in line:
        k, v = line.split("=", 1)
        creds[k.strip()] = v.strip()
password = creds["password"]
user = creds["username"]

JUKEBOX = Path("/home/flightdeck/flightdeck/jukebox")
pack = Path("/tmp/vinyl-mora-migrate.tgz")
stage = Path("/tmp/vinyl-mora-stage")


def run(cmd: list[str], timeout: int = 3600) -> None:
    print("+", " ".join(str(c) for c in cmd[:10]))
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    out = ((r.stdout or "") + (r.stderr or "")).replace(password, "***")
    if out.strip():
        print(out[-3000:])
    if r.returncode != 0:
        raise SystemExit(f"cmd failed rc={r.returncode}")


print("Staging…")
subprocess.run(["rm", "-rf", str(stage)], check=False)
stage.mkdir(parents=True)
for name in (
    "app",
    "static",
    "Dockerfile",
    "requirements.txt",
    "docker-compose.mora.yml",
    ".env",
):
    run(["cp", "-a", str(JUKEBOX / name), str(stage / name)])
run(
    [
        "cp",
        "-a",
        str(JUKEBOX / "scripts" / "build-mora-library-view.sh"),
        str(stage / "build-mora-library-view.sh"),
    ]
)
nd = stage / "navidrome-data"
nd.mkdir()
for name in ("navidrome.db", "navidrome.db-wal", "navidrome.db-shm"):
    src = Path("/home/flightdeck/cindy-navidrome/data") / name
    if src.exists():
        run(["cp", "-a", str(src), str(nd / name)])
run(["cp", "-a", "/home/flightdeck/cindy-vinyl-data", str(stage / "vinyl-data")])
print("Packing…")
run(["tar", "-czf", str(pack), "-C", str(stage), "."], timeout=1800)
print("Pack bytes", pack.stat().st_size)

pwfile = Path("/tmp/mora-ssh.pw")
pwfile.write_text(password)

root_install = Path("/tmp/mora-root-install.sh")
root_install.write_text(
    r"""#!/bin/sh
set -e
# Clean tiny /tmp from prior failed migrate
rm -rf /tmp/vinyl-migrate-unpack /tmp/vinyl-mora-migrate.tgz /tmp/amy* /tmp/mora-* /tmp/prep.sh 2>/dev/null || true
df -h /tmp /volume2
mkdir -p /volume2/cindy-vinyl/compose /volume2/cindy-vinyl/navidrome-data \
  /volume2/cindy-vinyl/vinyl-data /volume2/cindy-vinyl/library-view/CHECKED \
  /volume2/cindy-vinyl/_incoming /volume2/cindy-vinyl/_unpack
# Prefer pack already on volume2; else from home
if [ -f /volume1/home/Kidabah/vinyl-mora-migrate.tgz ]; then
  mv /volume1/home/Kidabah/vinyl-mora-migrate.tgz /volume2/cindy-vinyl/_incoming/pack.tgz
fi
if [ -f /volume2/cindy-vinyl/_incoming/pack.tgz ]; then
  :
elif [ -f /tmp/vinyl-mora-migrate.tgz ]; then
  mv /tmp/vinyl-mora-migrate.tgz /volume2/cindy-vinyl/_incoming/pack.tgz
else
  echo "pack missing" >&2
  exit 1
fi
rm -rf /volume2/cindy-vinyl/_unpack
mkdir -p /volume2/cindy-vinyl/_unpack
tar -xzf /volume2/cindy-vinyl/_incoming/pack.tgz -C /volume2/cindy-vinyl/_unpack
cp -a /volume2/cindy-vinyl/_unpack/app /volume2/cindy-vinyl/_unpack/static \
  /volume2/cindy-vinyl/_unpack/Dockerfile /volume2/cindy-vinyl/_unpack/requirements.txt \
  /volume2/cindy-vinyl/_unpack/docker-compose.mora.yml /volume2/cindy-vinyl/_unpack/.env \
  /volume2/cindy-vinyl/compose/
cp -a /volume2/cindy-vinyl/_unpack/build-mora-library-view.sh /volume2/cindy-vinyl/compose/
rm -rf /volume2/cindy-vinyl/navidrome-data/*
cp -a /volume2/cindy-vinyl/_unpack/navidrome-data/. /volume2/cindy-vinyl/navidrome-data/
rm -rf /volume2/cindy-vinyl/vinyl-data/*
cp -a /volume2/cindy-vinyl/_unpack/vinyl-data/. /volume2/cindy-vinyl/vinyl-data/
chown -R 1001:100 /volume2/cindy-vinyl
sed -i 's/\r$//' /volume2/cindy-vinyl/compose/build-mora-library-view.sh /volume2/cindy-vinyl/compose/docker-compose.mora.yml || true
chmod +x /volume2/cindy-vinyl/compose/build-mora-library-view.sh
CINDY_LIBRARY_VIEW=/volume2/cindy-vinyl/library-view \
  /bin/sh /volume2/cindy-vinyl/compose/build-mora-library-view.sh
cd /volume2/cindy-vinyl/compose
docker compose -f docker-compose.mora.yml up -d --build
docker ps --filter name=cindy
sleep 12
echo HEALTH:
curl -sS --max-time 20 http://127.0.0.1:4540/api/health || true
echo
echo RANDOM:
curl -sS --max-time 30 -w "\nHTTP %{http_code}\n" http://127.0.0.1:4540/api/random-album | head -c 600
echo
rm -rf /volume2/cindy-vinyl/_unpack /volume2/cindy-vinyl/_incoming
"""
)

wrap = Path("/tmp/mora-remote-install.sh")
wrap.write_text(
    """#!/bin/sh
set -e
PW=$(cat /volume1/home/Kidabah/amy.pw)
printf '%s\\n' "$PW" | sudo -S -p '' /bin/sh /volume1/home/Kidabah/mora-root-install.sh
rm -f /volume1/home/Kidabah/amy.pw
"""
)

# Upload everything via Kidabah home (has space on volume1), then sudo install.
inner = f"""
set -e
apk add --no-cache openssh-client sshpass >/dev/null
export SSHPASS=$(cat /pw)
OPTS='-o StrictHostKeyChecking=no -o PreferredAuthentications=password -o PubkeyAuthentication=no -o ConnectTimeout=30'
echo Uploading to Kidabah home on Mora...
sshpass -e scp $OPTS /pw {user}@192.168.4.77:/volume1/home/Kidabah/amy.pw
sshpass -e scp $OPTS /rootinst.sh {user}@192.168.4.77:/volume1/home/Kidabah/mora-root-install.sh
sshpass -e scp $OPTS /wrap.sh {user}@192.168.4.77:/volume1/home/Kidabah/mora-remote-install.sh
sshpass -e scp $OPTS /pack.tgz {user}@192.168.4.77:/volume1/home/Kidabah/vinyl-mora-migrate.tgz
echo Installing on Mora...
sshpass -e ssh $OPTS {user}@192.168.4.77 /bin/sh /volume1/home/Kidabah/mora-remote-install.sh
"""

try:
    r = subprocess.run(
        [
            "docker",
            "run",
            "--rm",
            "--network=host",
            "-v",
            f"{pwfile}:/pw:ro",
            "-v",
            f"{pack}:/pack.tgz:ro",
            "-v",
            f"{root_install}:/rootinst.sh:ro",
            "-v",
            f"{wrap}:/wrap.sh:ro",
            "alpine:3.20",
            "sh",
            "-c",
            inner,
        ],
        capture_output=True,
        text=True,
        timeout=3600,
    )
finally:
    for p in (pwfile, pack, root_install, wrap):
        p.unlink(missing_ok=True)
    subprocess.run(["rm", "-rf", str(stage)], check=False)

print(((r.stdout or "") + (r.stderr or "")).replace(password, "***")[-12000:])
sys.exit(r.returncode)
