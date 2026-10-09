# Cindy Vinyl

Vinyl hi-fi web player for the Cindy NAS music library (CHECKED + MUSIC + JAMAL).

## Host (Mora)

Runs on **Mora** (`192.168.4.77` / Tailscale `flightdeck-nas`), not the Flightdeck Pi.

- Music: Mora mounts `/volume2/cindy-vinyl/mounts/{Cindy,Checked,Jamal}` → Cindy (`192.168.4.53`)
- App + Navidrome DB: SSD **volume2** at `/volume2/cindy-vinyl/`
- Compose: `/volume2/cindy-vinyl/compose/docker-compose.mora.yml`

```bash
# On Mora (as root / sudo)
cd /volume2/cindy-vinyl/compose
docker compose -f docker-compose.mora.yml up -d --build
# Rebuild library view after share remount:
/bin/sh mount-cindy-on-mora.sh   # when Cindy NAS is online
CINDY_LIBRARY_VIEW=/volume2/cindy-vinyl/library-view \
  /bin/sh build-mora-library-view.sh
```

### Open the app
- **Home LAN:** `http://192.168.4.77:4541`
- **Tailscale:** `http://flightdeck-nas:4541` (or `http://100.115.102.18:4541`)
- Optional HTTPS via Tailscale serve on Mora:  
  `sudo tailscale serve --bg --https=4540 http://127.0.0.1:4540`

## Windows install (wife / home PCs)

On the PC (same Wi‑Fi/LAN), double‑click:

`jukebox/scripts/Install-CindyVinyl.bat`

That puts **Cindy Vinyl** on the Desktop and Start Menu. On this PC it opens the Vinyl window (`jukebox/desktop/launch.py`). Other PCs without that launcher still get an Edge/Chrome app window.

Or from PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File jukebox\scripts\Install-CindyVinyl.ps1
```

Away from home (Tailscale on that PC):

```powershell
powershell -ExecutionPolicy Bypass -File jukebox\scripts\Install-CindyVinyl.ps1 -Url "http://100.115.102.18:4541"
```

## Stack
- **Navidrome** indexes & streams (`:4533` on Mora) — DB on volume2; never writes tags/files on Cindy
- **cindy-vinyl** FastAPI UI + Subsonic proxy (`:4540` / `:4541`)
- Library view on volume2 skips Synology `#recycle`
- Folder-pack merge in the vinyl proxy: VA weekly drops with per-track tags become one sleeve

## Migrate / re-sync from Pi (ops)

From the Flightdeck Pi (with Mora SSH + sudo working for `Kidabah`):

```bash
python3 /home/flightdeck/flightdeck/jukebox/scripts/migrate-vinyl-to-mora.py
```

Pi `cindy-vinyl` / `cindy-navidrome` should stay **stopped** (`restart=no`) after cutover.
