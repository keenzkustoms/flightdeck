#!/bin/sh
# Mount Cindy NAS music shares on Mora for Navidrome (Cindy/Checked/Jamal).
# Creds: /volume2/cindy-vinyl/.smbcredentials-cindy  (username= / password=)
# Or pass CRED= path. Host defaults to 192.168.4.53 (Cindy).
set -e

HOST="${CINDY_SMB_HOST:-192.168.4.53}"
BASE="${CINDY_MORA_MOUNTS:-/volume2/cindy-vinyl/mounts}"
CRED="${CRED:-/volume2/cindy-vinyl/.smbcredentials-cindy}"

if [ ! -f "$CRED" ]; then
  echo "missing credentials: $CRED (username=… / password=…)" >&2
  exit 1
fi

# shellcheck disable=SC1090
. "$CRED"

mount_one() {
  share="$1"
  dest="$2"
  if grep -q " ${dest} " /proc/mounts 2>/dev/null; then
    echo "already mounted: $dest"
    ls "$dest" | head -5
    return 0
  fi
  mkdir -p "$dest"
  opts="username=${username},password=${password},uid=1001,gid=100,iocharset=utf8,vers=3.0,sec=ntlmssp,file_mode=0755,dir_mode=0755,nounix,noserverino,ro,soft,echo_interval=15"
  mount -t cifs "//${HOST}/${share}" "$dest" -o "$opts" \
    || mount -t cifs "//${HOST}/${share}" "$dest" -o "${opts},vers=2.1"
  echo "OK $share -> $dest"
  ls "$dest" | head -5
}

for pair in "MUSIC:Cindy" "CHECKED:Checked" "JAMAL:Jamal"; do
  share=${pair%%:*}
  name=${pair##*:}
  mount_one "$share" "$BASE/$name"
done

echo "=== cindy mounts on Mora ==="
mount | grep "${BASE}/" || true
