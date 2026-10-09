# Amy smart prompts (cheat sheet)

Talk to Amy in normal English — this list is just reminders of what she can do. Chris = you; Amy = your PC mate (casual by default). Deeper Flightdeck coding stays with Cursor when needed.

## Personality modes
- Default: **normal / casual** — talks like a person, no printer banter
- “**3D print mode**” / “print mode” / “workshop mode” — workshop Amy (Flightdeck, printers, notes)
- “**Normal mode**” / “casual mode” — back to chill chat

## Time & weather
- “What time is it?” / “What’s the date?”
- “What’s the weather like in Temora?” / “Weather in Sydney”
- Default place if you just say “weather” → Temora (NSW)

## Talk & listen (desktop app)

- “Hey Amy…” / just talk after enabling the mic
- **STOP** button, or say **stop** / **wait** / **hang on** while she talks
- **TALK** (glowing) = ears open; **QUIET** (dim) = soft quiet — say **talk** / **don’t talk**
- Soft quiet keeps Whisper armed so voice “talk” works
- Bare **“quiet”** / **“stop”** while she speaks = barge-in (stops talking), not permanent quiet
- Bare **“mute”** (no “yourself/mic”) ducks **Spotify**, not Amy’s ears
- Old synonyms: mute yourself / unmute / stop listening / listen again
- **“Go small”** / **FOCUS** — compact face + chat; mic stays on. **“Go big”** / **go large** to expand
- **Always on top** until you say **minimise** (then **come back**)
- Your words show in the Talk box; her reply is in the answer bubble
- If Spotify is loud, Whisper can invent Korean/gibberish — she’ll ignore that; pause music or mute her mic first
- **“Whistle”** / **“sing”** — real whistle melody
- **“Bedtime”** / **“goodnight”** / **“night night”** — yawn + sleep + snore loop (wake with **wake up Amy**; rib with **you sound like a bear** / **stop snoring** to hush)

## Phone
- Open Amy in Safari/Chrome via Tailscale HTTPS (`flightdeck…:4700`) — chat + mic work on a narrow layout
- Desktop framed Amy + Amy Hands (open folders / Spotify / tabs) stay on the PC

## See

- **EYES** — share your screen so she can look at it
- **WATCH** — webcam so she can see you
- **HOLO** — not built yet (desk hologram idea)

## PC navigator (Amy Hands — keep Hands running on the PC)

### Apps
- “**Open**” or “**Launch**” plus an app name — opens that app and brings its window to the front. Same for every app on her list, including Flightdeck, MeshFinder, and Cindy Vinyl.
- “**Add Sample to your allow list**” — she finds that app on the PC and saves the path. Say “then launch it” if you want it opened too. “Add Sample to your allow list” on its own just adds it.
- “Open MeshFinder” — her own window (the library on the Pi)
- “Open Flightdeck” — her own window (the dashboard on the Pi)
- “Open Spotify and play”
- “Pause” / “next track” / “previous track”
- “Turn it down” / “louder” / “mute” (ducks **Spotify** first, not Amy’s voice)
- “System volume down” if you really want master volume
- “Minimise Spotify” / “minimise all windows” / “restore Spotify”
- “Close Discord”
- “Add Discord to the allow list” (also knows: steam, vlc, firefox, obs, whatsapp)
- “What’s on your allow list?”

### Files & folders
- “Open C:” / “Open my Downloads” / “Open that folder on my desktop”
- When she opens Explorer she **drops always-on-top** so the folder isn’t hiding behind her — say **come back** to float again
- “Open that file” (after a search hit — give the path if needed)
- “Make a folder called Invoices on my Desktop”
- “Copy that file to Downloads” / “Move it to Documents”
- “Delete that folder” → she asks first; say **yes delete** / **approve**
- “Open my email” → **Thunderbird** (Chris’s mail)
- “Empty spam” → needs **yes empty spam**; opens Thunderbird so you can Empty Junk

### Chrome tabs (extension loaded)
- “List my Chrome tabs”
- “Switch to the Flightdeck tab”
- “Open https://… in Chrome”

## Workshop / Flightdeck

- “**Check if spool 14 is in AMS 1 slot 2 on BigBoy**” — also “where is spool 14” and “what’s in AMS 1 slot 2 on BigBoy”. She reads Flightdeck. She does not move the spool.
- “**Put spool 12 in BigBoy’s AMS HT**” — also “spool 12, AMS HT slot 2 on Big Girl”, “move spool 12 to the X1C AMS slot 1”. She looks the spool up and loads that slot. She does not start a print. If you leave the slot number off an AMS HT, she uses the HT bay.
- “**Reprint pla box on BigBoy**” — also “print pla box again”, “send pla box to BigBoy”, “run pla box on BigBoy”, “start pla box on BigBoy”, “fire pla box on BigBoy”, or “kick off pla box on BigBoy”. She finds the file and starts it. “Queue”, “que”, “add”, “put”, or “line up” the same file only waits. Two matches, she asks which one. Pause, stop, and “start the print” with no file name stay as printer controls.
- “**Open the downloads folder**” — or “open folder Projects”, or a full path. Any folder you name. She opens it so you can paste a file. She does not send it to a printer.
- “**Open the queue**” — switches the Flightdeck window to that page. Same for Spools, Fleet Wall, Flight Tower, Projects, a printer (“open BigBoy”), and the other sidebar pages. She does not start a print from that.
- “**Pause the print on Big Girl**” — same for BigBoy, the X1C, Greyhound, or any printer you name. Resume and stop work the same way. She does not start a print from that.
- “**Amy can you deploy pi**”, “deploy to the pi”, or “deploy pi again”. She pulls Flightdeck on the Pi and restarts it.
- Ask about printers, AMS, MakerDeck, PrintShelf, notes in her galaxy
- Drop files on her dock for a look
- “Remember that …” to save a note

## Music library (Cindy Vinyl — not Spotify Hands)

- Random album / library stuff lives on **Cindy Vinyl**, not the Spotify allowlist
- Spotify Hands = play/pause/next/volume on the PC app

## Quick tips

- Headphones help if music is loud and you still want her to hear you
- Say **pause** before a long command if the room is noisy
- Hands must be running on the PC (`start-amy-hands.ps1`); Chrome extension for tabs
- If a new app isn’t known, ask her to **add it to the allow list**
