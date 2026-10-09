#!/bin/sh
# Mount Synology Koko share //192.168.4.34/kidabah → /mnt/koko-kidabah
set -e
CRED=/home/flightdeck/.smbcredentials-koko
MNT=/mnt/koko-kidabah
HOST=192.168.4.34
SHARE=kidabah

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
    mkdir -p $MNT
    mount -t cifs //$HOST/$SHARE $MNT -o credentials=$CRED,uid=1004,gid=1004,forceuid,forcegid,iocharset=utf8,vers=3.0,sec=ntlmssp,file_mode=0755,dir_mode=0755,nounix,noserverino \
      || mount -t cifs //$HOST/$SHARE $MNT -o credentials=$CRED,uid=1004,gid=1004,forceuid,forcegid,iocharset=utf8,vers=2.1,sec=ntlmssp,file_mode=0755,dir_mode=0755,nounix,noserverino
    ls $MNT | head -20
  "

echo "mounted $MNT"
grep " ${MNT} " /proc/mounts
