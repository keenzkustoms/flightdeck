# Amy desktop (Windows wrap)

Runs local Amy brain + Hands in a WebView2 window. Pi HTTPS Amy is unchanged.

```powershell
cd amy\desktop
.\start-amy-desktop.ps1
```

First run: `%APPDATA%\Amy\config.json` — paste OpenAI / ElevenLabs keys; set `flightdeck_base_url` to the Pi Tailscale Flightdeck URL.

Tabs: load unpacked `amy/amy-hands/chrome-extension`.
