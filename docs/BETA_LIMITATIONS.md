# Flightdeck Beta Limitations

Flightdeck is beta software from a real workshop. It is useful now, but it is not finished.

## Current Beta Promise

The current beta is Bambu-first.

Best-tested paths:

- Bambu X1C.
- Bambu H2D.
- AMS and AMS HT workflows.
- Spool assignment and filament deduction.
- Queue/reprint flows.
- Live camera monitoring.
- Print history and correction.
- Raspberry Pi host.

## Not Yet A Promise

These areas may exist, but should be treated as experimental or less proven:

- Voron/Klipper polish.
- Snapmaker and other non-Bambu ecosystems.
- Large commercial farms.
- Public internet hosting.
- Fully unattended slicing and dispatch.
- H2C multi-tool workflows until real hardware testing is complete.
- Perfect automatic deduction when prints are sent directly from slicer without Flightdeck metadata.

## Safety Notes

- Keep destructive actions deliberate: cancel, E-stop, delete, archive, SD cleanup, and format actions.
- Confirm printer and filament state at the machine before starting important prints.
- Use Tailscale or LAN, not public port forwarding.
- Back up before major upgrades.

## Data Accuracy

Spool tracking is only as good as the physical assignment.

For best results:

- Assign every loaded spool to the correct AMS slot.
- Scan QR labels when moving spools.
- Correct tare/empty spool weights when a spool is actually empty.
- Use History correction if a print was sent directly from slicer and metadata was missing.

## Reporting Issues

Good reports include:

- Printer model.
- Flightdeck version.
- Pi/Windows host details.
- What screen/action was used.
- What you expected.
- What happened.
- Diagnostic zip from Setup.
- Screenshot if it helps.
