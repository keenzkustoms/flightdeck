# Amy (workshop)

Voice + notes galaxy for Chris's Flightdeck bench. Brain: **GPT-5.6 Luna**.

## Desktop app (Windows)

Local-brain wrap (same UI + Hands). Pi browser Amy stays available.

```powershell
cd amy\desktop
.\start-amy-desktop.ps1
```

Config lands in `%APPDATA%\Amy\config.json`. Build a portable folder with `.\build-windows.ps1` → `dist\Amy\Amy.exe`.

See [desktop/README.md](desktop/README.md).

## Hosting

Runs on the Flightdeck Pi (`amy/` folder in repo, user systemd unit `amy.service`). Port **4700**.

**Use HTTPS for the mic:**

https://flightdeck.tail7de73e.ts.net:4700

## Voice: ElevenLabs Laura

Amy speaks as **Laura** (`FGY2WhTYpPnrIDTdsKH5`) when an ElevenLabs key is set.

1. Create a key: https://elevenlabs.io/app/settings/api-keys
2. On the Pi: `ELEVENLABS_API_KEY='…' python3 amy/deploy/set-elevenlabs-key.py`
3. `systemctl --user restart amy`

Without that key she falls back to browser TTS.

## Drop coin in the slot (OpenAI prepaid credits)

1. Open **[Billing](https://platform.openai.com/settings/organization/billing/)**
2. Click **Add payment method** if needed, then **Add to credit balance** / **Buy credits**
3. Start with **$10–20** — plenty for Amy + light coding on Luna
4. Ignore ChatGPT Plus / team plan noise — Amy needs **API credits**, not a ChatGPT subscription

API keys: https://platform.openai.com/api-keys

## Setup

1. Copy `config.example.json` → `config.json` (model is already `gpt-5.6-luna`)
2. Paste key, or run `python3 deploy/set-openai-key.py`
3. `python3 build.py`
4. `systemctl --user restart amy`
5. Open the HTTPS URL — click once to unlock speech, then talk or type

## Files + internet

- Drag files onto the dock (or **FILE** / 📎) — text, code, logs, gcode, images
- Ask her to look something up online — she can search the web and open URLs

- "Run a calibration on BigBoy"
- "What's BigBoy doing?"
- "Pause X1C" / "Resume Big Girl"

Printer aliases: BigBoy→`h2d`, Big Girl→`o1c2`, X1C→`x1c`, Greyhound/Voron→`greyhound`.

## Preflight

```bash
python3 preflight.py
```
