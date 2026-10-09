#!/bin/bash
# Build a Pi-local read-only library view of Cindy that omits Synology #recycle.
# Never writes to /mnt/cindy — only creates symlinks under $VIEW.
set -euo pipefail

VIEW="${CINDY_LIBRARY_VIEW:-/home/flightdeck/cindy-library-view}"
SRC="${CINDY_MOUNT:-/mnt/cindy}"

mkdir -p "$VIEW/CHECKED"
# Top-level shares as symlinks
ln -sfn "$SRC/MUSIC" "$VIEW/MUSIC"
ln -sfn "$SRC/JAMAL" "$VIEW/JAMAL"

# Refresh CHECKED children, skipping trash / system dirs
shopt -s nullglob
for entry in "$SRC/CHECKED"/* "$SRC/CHECKED"/.*; do
  base="$(basename "$entry")"
  case "$base" in
    .|..) continue ;;
    \#recycle|\$RECYCLE.BIN|@eaDir|System\ Volume\ Information|Thumbs.db) continue ;;
  esac
  # Only link real entries
  if [[ -e "$entry" || -L "$entry" ]]; then
    ln -sfn "$entry" "$VIEW/CHECKED/$base"
  fi
done

# Drop stale CHECKED symlinks whose targets vanished or were #recycle
for link in "$VIEW/CHECKED"/*; do
  [[ -L "$link" ]] || continue
  target="$(readlink -f "$link" 2>/dev/null || true)"
  base="$(basename "$link")"
  if [[ "$base" == "#recycle" ]]; then
    rm -f "$link"
    continue
  fi
  if [[ ! -e "$link" ]]; then
    rm -f "$link"
  fi
done

# Optional root ignore for anything that still sneaks in
cat > "$VIEW/.ndignore" <<'EOF'
\#recycle/
**/\#recycle/
$RECYCLE.BIN/
**/@eaDir/
EOF

echo "Cindy library view ready at $VIEW"
ls -la "$VIEW"
echo "CHECKED entries: $(ls -1 "$VIEW/CHECKED" | wc -l)"
