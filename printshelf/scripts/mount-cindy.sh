#!/bin/sh
# Mount Cindy NAS music shares → /mnt/cindy/{MUSIC,CHECKED,JAMAL}
# Creds: /home/flightdeck/.smbcredentials-cindy  (username= / password=)
set -e
CRED=/home/flightdeck/.smbcredentials-cindy
HOST=192.168.4.53
BASE=/mnt/cindy

if [ ! -f "$CRED" ]; then
  echo "missing credentials: $CRED (username=… / password=…)" >&2
  exit 1
fi

mount_one() {
  share="$1"
  mnt="$BASE/$share"
  if grep -q " ${mnt} " /proc/mounts 2>/dev/null; then
    echo "already mounted: $mnt"
    return 0
  fi
  docker run --rm --privileged --pid=host --network=host alpine:3.20 \
    nsenter -t 1 -m -u -i -n sh -c "
      mkdir -p $mnt
      mount -t cifs //$HOST/$share $mnt -o credentials=$CRED,uid=1004,gid=1004,forceuid,forcegid,iocharset=utf8,vers=3.0,sec=ntlmssp,file_mode=0755,dir_mode=0755,nounix,noserverino,ro \
        || mount -t cifs //$HOST/$share $mnt -o credentials=$CRED,uid=1004,gid=1004,forceuid,forcegid,iocharset=utf8,vers=2.1,sec=ntlmssp,file_mode=0755,dir_mode=0755,nounix,noserverino,ro
      echo OK $share
      ls $mnt | head -8
    "
}

mkdir -p "$BASE" 2>/dev/null || docker run --rm --privileged --pid=host --network=host alpine:3.20 \
  nsenter -t 1 -m -u -i -n sh -c "mkdir -p $BASE"

for share in MUSIC CHECKED JAMAL; do
  mount_one "$share" || {
    echo "FAILED mounting $share" >&2
    exit 1
  }
done

echo "=== cindy mounts ==="
mount | grep "/mnt/cindy/" || true
for share in MUSIC CHECKED JAMAL; do
  echo "-- $share --"
  ls "$BASE/$share" 2>/dev/null | head -5 || echo "(empty/unreadable)"
done
