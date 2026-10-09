# Flightdeck overview

Flightdeck is Chris's workshop control plane on a Raspberry Pi: live Bambu / Voron status, AMS loadout, queue, spool inventory, cameras, Brother QL-700 labels, Dymo scale weigh-ins, MakerDeck / PrintShelf links, and Tailscale remote access.

Amy talks to Flightdeck over HTTP (`flightdeck_base_url` in config). Amy never speaks MQTT to printers directly — Flightdeck owns printer control.

Useful spoken asks:

- Run a calibration on BigBoy
- What's Big Girl doing?
- Status of the printers
- Pause X1C / resume BigBoy

Notes in this galaxy are the second brain; Flightdeck tools are the hands.
