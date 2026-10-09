const GRAPH = {
  "nodes": [
    {
      "id": 0,
      "label": "ams filament",
      "group": "workshop",
      "path": "workshop/ams-filament.md",
      "excerpt": "# AMS and filament Bambu printers use AMS / AMS HT loadouts tracked live in Flightdeck. Spool homes live in the six-drawer storage system (#1–#162). SUNLU dryer is a temporary current location that preserves home."
    },
    {
      "id": 1,
      "label": "amy desktop",
      "group": "workshop",
      "path": "workshop/amy-desktop.md",
      "excerpt": "# Amy desktop (Windows wrap) Runs local Amy brain + Hands in a WebView2 window. Pi HTTPS Amy is unchanged. ```powershell cd amy\\desktop .\\start-amy-desktop.ps1 ``` First run: `%APPDATA%\\Amy\\config.json` — paste OpenAI / ElevenLabs keys; set `flightdeck_base_url` to the Pi Tailscale Flightdeck URL. Tabs: load unpacked `amy/amy-hands/chrome-extension`."
    },
    {
      "id": 2,
      "label": "amy files",
      "group": "workshop",
      "path": "workshop/amy-files.md",
      "excerpt": "# Dropping files on Amy Chris can drag files onto Amy's dock (or hit **FILE** / 📎). She reads: - Text / code / logs / gcode / markdown / json / csv / svg - Images (vision) Max **4 files**, **8MB** each. Binary blobs she can't preview are still saved under `amy/uploads/`. Ask her about the drop, or just hit ASK with files attached."
    },
    {
      "id": 3,
      "label": "amy internet",
      "group": "workshop",
      "path": "workshop/amy-internet.md",
      "excerpt": "# Amy internet access Amy can search the live web (`web_search`) and open specific links (`fetch_url`) when workshop notes aren't enough — docs, prices, current info, etc. She still prefers Flightdeck notes for printer/bench facts. Searches use DuckDuckGo (no extra API key)."
    },
    {
      "id": 4,
      "label": "amy prompts",
      "group": "workshop",
      "path": "workshop/amy-prompts.md",
      "excerpt": "# Amy smart prompts (cheat sheet) Talk to Amy in normal English — this list is just reminders of what she can do. Chris = you; Amy = your PC mate (casual by default). Deeper Flightdeck coding stays with Cursor when needed. ## Personality modes - Default: **normal / casual** — talks like a person, no printer banter - “**3D print mode**” / “print mode” / “workshop mode” — workshop Amy (Flightdeck, printers, notes) - “**Normal mode**” / “casual mode” — back to chill chat ## Time & weather - “What time is it?” / “What’s the date?” - “What’s the weather like in Temora?” / “Weather in Sydney” - Default place if you just say “weather” → Temora (NSW) ## Talk & listen (desktop app) - “Hey Amy…” / ju…"
    },
    {
      "id": 5,
      "label": "amy sleep",
      "group": "workshop",
      "path": "workshop/amy-sleep.md",
      "excerpt": "# Amy sleep + idle After ~3 minutes quiet she **yawns** (real WAV) and nudges you that she’s getting sleepy. After ~6 minutes she enters **sleep** — circle goes dark, then she **snores** (looping WAV). Or tuck her in anytime: **bedtime** / **goodnight** / **night night** / **go to sleep** → she says goodnight, yawns, and sleeps. Wake her with **wake up Amy**, **hey Amy**, click her face, or MIC/ASK. Rib the snoring (stays asleep, snore stops): **you sound like a bear**, **stop snoring**, **quiet**, **shh**, etc. Ask her to **whistle** or **sing** anytime (voice or type) and she plays a real whistle melody (`viewer/sounds/amy-whistle.wav`). SFX lives in `amy/viewer/sounds/`: - `amy-whistl…"
    },
    {
      "id": 6,
      "label": "amy voice",
      "group": "workshop",
      "path": "workshop/amy-voice.md",
      "excerpt": "# Amy finish window The microphone finish window is **1400 milliseconds** (`FINISH_MS`). Speech recognition finalizes phrases on pause; Amy buffers and only sends after a true end-of-thought pause. **Interrupt while she's talking** (mic on, or hit **STOP**): say **stop**, **wait**, **hang on**, **hold on**, **quiet**, or **enough** — she cuts Laura off and keeps listening. Typing stop also works. **Mute** is the MIC/MUTE toggle — that turns the mic off entirely. Tune FINISH_MS after a day of real use — too low cuts you off, too high feels sluggish."
    },
    {
      "id": 7,
      "label": "big girl h2c",
      "group": "workshop",
      "path": "workshop/big-girl-h2c.md",
      "excerpt": "# Big Girl (H2C) Big Girl is the Bambu Lab H2C. Flightdeck id: `o1c2`. Usually mid-bench under the X1C. Amy nicknames: Big Girl, H2C."
    },
    {
      "id": 8,
      "label": "bigboy h2d",
      "group": "workshop",
      "path": "workshop/bigboy-h2d.md",
      "excerpt": "# BigBoy (H2D) BigBoy is the Bambu Lab H2D on Chris's bench. Flightdeck id: `h2d`. Amy can calibrate BigBoy when idle: bed leveling, vibration, motor noise, and nozzle offset."
    },
    {
      "id": 9,
      "label": "flightdeck overview",
      "group": "workshop",
      "path": "workshop/flightdeck-overview.md",
      "excerpt": "# Flightdeck overview Flightdeck is Chris's workshop control plane on a Raspberry Pi: live Bambu / Voron status, AMS loadout, queue, spool inventory, cameras, Brother QL-700 labels, Dymo scale weigh-ins, MakerDeck / PrintShelf links, and Tailscale remote access. Amy talks to Flightdeck over HTTP (`flightdeck_base_url` in config). Amy never speaks MQTT to printers directly — Flightdeck owns printer control. Useful spoken asks: - Run a calibration on BigBoy - What's Big Girl doing? - Status of the printers - Pause X1C / resume BigBoy Notes in this galaxy are the second brain; Flightdeck tools are the hands."
    },
    {
      "id": 10,
      "label": "greyhound voron",
      "group": "workshop",
      "path": "workshop/greyhound-voron.md",
      "excerpt": "# Greyhound Voron Greyhound is the Voron 2.4 350. Flightdeck id: `greyhound`. Klipper-based; calibration tools differ from Bambu. Amy status still reports state via Flightdeck."
    },
    {
      "id": 11,
      "label": "makerdeck printshelf",
      "group": "workshop",
      "path": "workshop/makerdeck-printshelf.md",
      "excerpt": "# MakerDeck and PrintShelf MakerDeck builds parametric models (hoodie containers, plaques, painter). PrintShelf indexes STLs/3MFs across NAS mounts for browsing and queueing to Bambu printers through Flightdeck."
    },
    {
      "id": 12,
      "label": "printers and nicknames",
      "group": "workshop",
      "path": "workshop/printers-and-nicknames.md",
      "excerpt": "# Flightdeck printers (bench nicknames) Chris's bench order (top → bottom): X1C → H2C Big Girl → H2D BigBoy → Voron Greyhound. | Spoken name | Flightdeck id | Model | |---|---|---| | X1C | x1c | Bambu X1C | | Big Girl / H2C | o1c2 | Bambu H2C | | BigBoy / H2D | h2d | Bambu H2D | | Greyhound / Voron | greyhound | Voron 2.4 350 | Amy calibration calls `POST /api/printers/{id}/calibration` on Flightdeck when the printer is idle, ready, standby, or finished. Default calibration steps: bed leveling, vibration, motor noise. H2 printers also get nozzle offset. High-temp bed is off by default."
    },
    {
      "id": 13,
      "label": "ql700 labels",
      "group": "workshop",
      "path": "workshop/ql700-labels.md",
      "excerpt": "# Brother QL-700 labels Flightdeck prints spool labels on a Brother QL-700 with DK-22212 62 mm continuous tape. Ask Flightdeck for Label on a spool card. Compact rack labels exist for cupboard strips; full spool labels carry the big spool number, material, colour, location, and QR."
    },
    {
      "id": 14,
      "label": "spool drawers",
      "group": "workshop",
      "path": "workshop/spool-drawers.md",
      "excerpt": "# Spool storage drawers Flightdeck uses six physical drawers for filament homes: - Drawers **D1–D6** - Three rows per drawer **R1–R3** - Nine positions per row - Global spool positions **#1–#162** A spool's **home** is the numbered drawer slot matching its spool number (spool #42 → `D? R? #42`). Home stays reserved while the spool is loaded in a printer or visiting the SUNLU dryer. **Fast assign** on the Spools page places leftover legacy-shelf spools into empty drawer homes. Undo is available for the last Fast Assign batch. Labels print on the Brother QL-700 (DK-22212 62 mm continuous) from Flightdeck."
    },
    {
      "id": 15,
      "label": "tailscale access",
      "group": "workshop",
      "path": "workshop/tailscale-access.md",
      "excerpt": "# Tailscale access Flightdeck and Amy are reached over Tailscale. Amy listens on port 4700 on the Flightdeck Pi. Flightdeck itself is proxied on HTTPS via Tailscale Serve. Prefer the HTTPS Amy URL for the mic — Chrome treats plain HTTP as speakers-only."
    },
    {
      "id": 16,
      "label": "x1c",
      "group": "workshop",
      "path": "workshop/x1c.md",
      "excerpt": "# X1C The Bambu X1 Carbon sits at the top of the bench. Flightdeck id: `x1c`. Good for everyday PLA/PETG work. Amy understands “X1C” and “X1”."
    }
  ],
  "links": []
};
