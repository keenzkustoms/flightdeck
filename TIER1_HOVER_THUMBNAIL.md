# Tier 1 — Hover thumbnail spec

## Context

Tier 1 dashboard cards show printer status at a glance. Each printing card should reveal a print preview thumbnail on hover, but the thumbnail must not occupy permanent real estate (preserves glance hierarchy and keeps card heights uniform between idle and active states).

This component will later be reused/upgraded for Tier 2 live camera feeds, so design the API to accept either a static image URL or a live stream URL.

## Behaviour

### Trigger
- **Desktop:** hover with 200ms intent delay (avoid accidental triggers when mousing across cards). Dismiss on `mouseleave` with no delay.
- **Mobile/touch:** long-press (~400ms) to reveal. Tap remains reserved for Tier 2 drill-in navigation. Dismiss on tap-outside or release.
- **Keyboard:** card is focusable (`tabindex="0"`); space or enter while focused toggles the popover. Escape dismisses.

### Position
Floating popover anchored to the card, positioned above by default with a small caret pointing down at the card. Flip below if there's not enough room above (use floating-ui or popper.js — don't hand-roll the collision detection).

No layout shift on the underlying cards.

### Visual
- Thumbnail dimensions: ~180px square (Bambu thumbnails are typically 200x200, Moonraker is configurable, 200x200 is the common default — render at intrinsic size up to 200px max).
- Popover background: `var(--color-background-primary)` with 0.5px border, `--border-radius-lg`, subtle shadow ok here (it's a transient overlay, not a base surface).
- Content stack inside popover:
  1. Thumbnail image (top)
  2. Filename, full and untruncated, monospace
  3. Two-column metadata row: estimated total time, layer height
  4. Filament weight estimate
- If no thumbnail available (rare — slicer didn't embed one): show a placeholder icon and metadata only. Don't suppress the popover; the metadata is still useful.

### Idle cards
No hover popover on idle cards. The idle card already shows last-print summary inline; a popover there would be redundant and would invite hovering when there's no useful info to surface.

## Component API

Design as a reusable `<PrintPreview>` component. Props:

```python
# Pydantic model for the API response that backs the component
class PrintPreview(BaseModel):
    image_url: str | None        # static thumbnail URL OR live stream URL
    image_type: Literal["static", "mjpeg", "webrtc"]  # tells frontend how to render
    filename: str
    estimated_total_seconds: int | None
    elapsed_seconds: int | None
    layer_height_mm: float | None
    filament_weight_g: float | None
    filament_type: str | None    # "PLA", "PETG-HF", etc
```

For Tier 1, backend returns `image_type="static"` with the slicer thumbnail URL. For Tier 2 upgrade, switch to `image_type="mjpeg"` with the camera stream URL. Frontend component branches on `image_type` to either render `<img>` or set up the MJPEG/WebRTC handler. Same component, same hover behaviour, different source.

## Data sources by printer

### Voron Greyhound (Moonraker)
- Endpoint: `GET /server/files/thumbnails?filename={gcode_filename}`
- Returns list of thumbnail sizes embedded in the gcode (slicer-dependent — OrcaSlicer/SuperSlicer embed 32x32, 200x200, and sometimes 400x300).
- Pick the largest that's ≤200px on the long edge.
- Cache by gcode filename + mtime. Invalidate when a new print starts.

### Bambu X1C and H2D (MQTT)
- Bambu publishes `print.gcode_file` in MQTT `pushing.pushall` events.
- The 3MF file at `/timelapse/thumbnail.png` or `/Metadata/plate_N.png` on the printer's local FTP/SFTP holds the slicer preview. Use `bambulabs-api` — it exposes a `get_print_thumbnail()` helper that handles the FTP fetch.
- Cache by job hash (use the `task_id` from MQTT, not the filename — Bambu reuses `plate_1.gcode` constantly).

## Implementation notes

- Build the popover component first with a placeholder image, wire it to hover/long-press/keyboard, then plumb data sources. Don't conflate UI and data fetching in the first pass.
- Use `hover-intent` (200ms debounce) — `npm i @use-it/event-listener` or just write a small custom hook. Don't use raw `onMouseEnter` without a delay; it'll feel twitchy.
- Pre-fetch thumbnails on print-start MQTT/websocket event, not on hover. Hover should hit a warm cache.
- Cache TTL: until next print start. Print thumbnails don't change mid-print.
- For Tier 2 live camera upgrade later: Greyhound C270 will likely stream via `crowsnest` or `mjpg-streamer` on the Pi running Klipper (the CB2, not the flightdeck Pi). Endpoint pattern: `http://greyhound-host:8080/?action=stream`. Bambu cameras require the printer's access code and serial — `bambulabs-api` wraps this.

## Idle-card copy fix

The current mockup says "Toolhead: parked" for the Voron idle state. Voron Greyhound is **homed**, not parked — change to "homed" or show the actual coordinates. "Parked" implies a defined park position (e.g., back-left over the purge bucket); "homed" just means endstops triggered and position is known. The distinction matters for "is the next macro safe to run."

Suggested copy:
```
Toolhead    homed · X175 Y175 Z10
```
or simply:
```
Toolhead    homed
```
depending on whether the position itself is useful at a glance.
