#!/bin/sh
# Build Mora-local library view for Navidrome (excludes #recycle).
# Music lives on Mora's Cindy/Checked/Jamal remote shares under /share/.
set -e

VIEW="${CINDY_LIBRARY_VIEW:-/volume2/cindy-vinyl/library-view}"
# Live music is the Synology /share mounts. The volume2 mount folders can exist and be empty.
CINDY="${CINDY_SHARE:-/share/Cindy}"
CHECKED="${CHECKED_SHARE:-/share/Checked}"
JAMAL="${JAMAL_SHARE:-/share/Jamal}"

mkdir -p "$VIEW/CHECKED"
ln -sfn "$CINDY" "$VIEW/MUSIC"
ln -sfn "$JAMAL" "$VIEW/JAMAL"

# Refresh CHECKED children, skipping trash / system dirs
for entry in "$CHECKED"/* "$CHECKED"/.* ; do
  [ -e "$entry" ] || [ -L "$entry" ] || continue
  base=$(basename "$entry")
  case "$base" in
    .|..) continue ;;
    \#recycle|\$RECYCLE.BIN|@eaDir|Thumbs.db) continue ;;
    "System Volume Information") continue ;;
  esac
  ln -sfn "$entry" "$VIEW/CHECKED/$base"
done

# Drop stale CHECKED symlinks
for link in "$VIEW/CHECKED"/* ; do
  [ -L "$link" ] || continue
  base=$(basename "$link")
  if [ "$base" = "#recycle" ]; then
    rm -f "$link"
    continue
  fi
  if [ ! -e "$link" ]; then
    rm -f "$link"
  fi
done

cat > "$VIEW/.ndignore" <<'EOF'
\#recycle/
**/\#recycle/
$RECYCLE.BIN/
**/@eaDir/
EOF

echo "Cindy library view ready at $VIEW"
ls -la "$VIEW"
echo "CHECKED entries: $(ls -1 "$VIEW/CHECKED" | wc -l)"
