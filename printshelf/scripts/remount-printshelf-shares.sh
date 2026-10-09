#!/bin/sh
# Remount PrintShelf + Cindy music shares after reboot (when creds exist).
set -eu

/home/flightdeck/bin/mount-kidabah-pc.sh || true
if [ -x /home/flightdeck/bin/mount-koko-kidabah.sh ]; then
  /home/flightdeck/bin/mount-koko-kidabah.sh || true
fi
if [ -x /home/flightdeck/bin/mount-nas-mora.sh ]; then
  /home/flightdeck/bin/mount-nas-mora.sh || true
fi

# Cindy is different: Navidrome must never be allowed to rebuild/scan against
# an unmounted /mnt/cindy, otherwise the Pi-local library view becomes a forest
# of dangling symlinks and Cindy Vinyl appears to have zero albums.
if [ -x /home/flightdeck/bin/mount-cindy.sh ]; then
  /home/flightdeck/bin/mount-cindy.sh || true
fi

if ! mountpoint -q /mnt/cindy; then
  echo "ERROR: /mnt/cindy is not mounted; refusing to rebuild Cindy library view." >&2
  exit 1
fi

# Refresh Pi-local Cindy view (excludes #recycle) only after the real share exists.
if [ -x /home/flightdeck/flightdeck/jukebox/scripts/build-cindy-library-view.sh ]; then
  /home/flightdeck/flightdeck/jukebox/scripts/build-cindy-library-view.sh
fi
