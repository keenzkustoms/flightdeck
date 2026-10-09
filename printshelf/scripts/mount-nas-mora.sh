#!/bin/sh
# Mount Mora Synology User Homes / Kidabah → /mnt/nas-mora
# Creds: /home/flightdeck/.smbcredentials-mora  (username= / password=)
set -e
CRED=/home/flightdeck/.smbcredentials-mora
MNT=/mnt/nas-mora
MNT_HOMES=/mnt/nas-mora-homes
HOST=192.168.4.77
USER_DIR=Kidabah

if [ ! -f "$CRED" ]; then
  echo "missing credentials: $CRED (username=… / password=…)" >&2
  exit 1
fi

if grep -q " ${MNT} " /proc/mounts 2>/dev/null; then
  echo "already mounted: $MNT"
  ls "$MNT" | head -20
  exit 0
fi

docker run --rm --privileged --pid=host --network=host alpine:3.20 \
  nsenter -t 1 -m -u -i -n sh -c "
    set -e
    mkdir -p $MNT_HOMES $MNT
    # Mount Synology 'User Homes' share (SMB name may be homes or 'User Homes').
    if ! grep -q ' ${MNT_HOMES} ' /proc/mounts 2>/dev/null; then
      mount -t cifs '//$HOST/User Homes' $MNT_HOMES -o credentials=$CRED,uid=1004,gid=1004,forceuid,forcegid,iocharset=utf8,vers=3.0,sec=ntlmssp,file_mode=0755,dir_mode=0755,nounix,noserverino \
        || mount -t cifs //$HOST/homes $MNT_HOMES -o credentials=$CRED,uid=1004,gid=1004,forceuid,forcegid,iocharset=utf8,vers=3.0,sec=ntlmssp,file_mode=0755,dir_mode=0755,nounix,noserverino
    fi
    if [ ! -d $MNT_HOMES/$USER_DIR ]; then
      echo 'missing user dir: $MNT_HOMES/$USER_DIR' >&2
      ls $MNT_HOMES >&2 || true
      exit 1
    fi
    mount --bind $MNT_HOMES/$USER_DIR $MNT
    ls $MNT | head -20
  "

echo "mounted $MNT"
grep " ${MNT} " /proc/mounts
ls "$MNT" | head -20
