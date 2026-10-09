# Flightdeck printers (bench nicknames)

Chris's bench order (top → bottom): X1C → H2C Big Girl → H2D BigBoy → Voron Greyhound.

| Spoken name | Flightdeck id | Model |
|---|---|---|
| X1C | x1c | Bambu X1C |
| Big Girl / H2C | o1c2 | Bambu H2C |
| BigBoy / H2D | h2d | Bambu H2D |
| Greyhound / Voron | greyhound | Voron 2.4 350 |

Amy calibration calls `POST /api/printers/{id}/calibration` on Flightdeck when the printer is idle, ready, standby, or finished.

Default calibration steps: bed leveling, vibration, motor noise. H2 printers also get nozzle offset. High-temp bed is off by default.
