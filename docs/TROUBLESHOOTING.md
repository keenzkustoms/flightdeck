# Flightdeck Troubleshooting

Start with the simplest checks:

1. Refresh the browser.
2. Open `System -> Settings -> Setup`.
3. Check printer state and slicer health.
4. Use safe restart if the backend is stuck.

## Service Does Not Respond

On the Pi:

```bash
cd ~/flightdeck
sudo ./scripts/safe-restart-flightdeck.sh
```

Check logs:

```bash
journalctl -u flightdeck.service -n 100 --no-pager
```

## Camera Feed Freezes

Clear camera workers first:

```bash
cd ~/flightdeck
./scripts/clear-camera-workers.sh
```

If the whole app is also sluggish:

```bash
sudo ./scripts/safe-restart-flightdeck.sh
```

Bambu camera streams depend on the printer RTSP stream, ffmpeg, and network stability. A frozen camera does not always mean the printer connection is dead.

## Bambu Printer Offline

Check:

- Printer is powered on.
- Printer IP has not changed.
- LAN mode/access code details are correct.
- Pi can reach the printer on the network.
- The printer is not asleep or rebooting.

If only Flightdeck is wrong, restart Flightdeck. If Bambu Handy/Bambu Studio also cannot see the printer, fix the printer/network first.

## AMS/AMS HT Spool Looks Wrong

Use the AMS slot/profile doctor before changing inventory.

Common cases:

- Printer reports generic/old filament profile.
- Physical spool was changed but Flightdeck assignment was not updated.
- Staff loaded filament without assigning the spool.
- H2D/H2C nozzle path does not match slicer assignment.

Flightdeck is designed to let the operator deliberately trust either the printer report or Flightdeck's stored spool truth.

## Queue Says Failed Then Starts Printing

This usually means Flightdeck detected stale active queue state and reconciled it after the printer reported live progress.

If the printer is physically printing, trust the live printer state. Use Flight Tower and Print History to confirm whether the queue row was restored.

## Filament Did Not Deduct

Open the print in History and check the decision trail.

Likely causes:

- No spool was assigned to the loaded slot.
- The job was sent directly from slicer and Flightdeck did not receive filament metadata.
- The print used a manually loaded external spool.
- The print was cancelled before a usable deduction point.

Use History correction/reconcile tools to assign the spool and grams after the print.

## Browser Slicer Opens Empty

See [Windows slicer worker and browser slicers](WINDOWS_SLICER_WORKER.md).

Short version:

- The browser tab can open even when model injection fails.
- Check `System -> Settings -> Slicer -> Check all`.
- Restart Docker Desktop or run the Windows slicer helper.

## Update Did Not Show In Browser

Flightdeck uses cache-busted static files. If the Pi has pulled the latest code but the browser still looks old:

- Hard refresh the browser.
- On mobile, close/reopen the tab.
- Confirm the footer/setup version if needed.

## Get A Diagnostic Bundle

Use:

```text
System -> Settings -> Setup -> Download diagnostics
```

Attach that zip when reporting an issue. It is much more useful than a screenshot alone.
