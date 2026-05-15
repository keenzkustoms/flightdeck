# Tier 2 polish — Temperature input modal

## Context

The current temperature controls on the per-printer Live tab use only `[- +]` nudge buttons at 5°C per click. This works for fine adjustments but is unusable for big jumps — setting hotend from 26°C (off) to 220°C (PLA) requires ~39 taps. Real-world use needs direct numeric entry.

This spec adds a modal input pattern modelled on KlipperScreen's approach: tap the temperature value → modal opens with numeric keypad, material presets, and confirm/cancel. The existing `[- +]` nudge buttons stay for fine adjustments.

## Interaction model

```
Current state:                       After clicking temp value:
                                     
HOTEND   220° /220°  [-][+]          ┌──────────────────────────────┐
BED       65° /65°   [-][+]          │  HOTEND                  ✕   │
CHAMBER   31°                        │                              │
                                     │  Current 220°  →  Target ___ │
                                     │                              │
                                     │  [Off] [PLA] [PETG] [ASA]    │
                                     │                              │
                                     │  ┌───┬───┬───┐               │
                                     │  │ 1 │ 2 │ 3 │               │
                                     │  ├───┼───┼───┤               │
                                     │  │ 4 │ 5 │ 6 │               │
                                     │  ├───┼───┼───┤               │
                                     │  │ 7 │ 8 │ 9 │               │
                                     │  ├───┼───┼───┤               │
                                     │  │ ⌫ │ 0 │ ✓ │               │
                                     │  └───┴───┴───┘               │
                                     │                              │
                                     │  Range: 0–300°C              │
                                     └──────────────────────────────┘
```

Each click of `[- +]` still nudges by 5°C without opening the modal. Modal is for direct entry and preset selection.

## Modal behaviour

### Opening
- Click the **temperature value text** (e.g. "220°") on any heater row
- Click target on `[- +]` buttons does NOT open the modal — they nudge in place
- Modal title shows the heater name (HOTEND / BED / CHAMBER) and a close button (✕)
- Modal opens centered on desktop, full-width with rounded top corners on mobile (bottom-sheet pattern)

### Display area
- Top of modal: `Current XX°  →  Target ___` 
- Left side: live current temperature, updates as the heater changes
- Right side: the target value being composed by user input. Starts blank/showing the existing target, fills as user types

### Preset row
Material presets render as a horizontal row of buttons. Each preset:
- Has a label and an implicit value
- Tapping fills the target field with that value (does not auto-confirm — user still hits ✓)
- "Off" is always present, always sets target to 0
- Other presets come from `printers.yaml` (see Config schema below)

Layout: horizontal row, scroll horizontally on mobile if needed. Max 6 visible presets to avoid clutter; more = scroll.

### Numeric keypad
3×4 grid:
```
1 2 3
4 5 6
7 8 9
⌫ 0 ✓
```

- Numbers append to the target field
- `⌫` (backspace) removes the rightmost digit
- `✓` (confirm) sends the value and closes modal
- All buttons sized for thumb tap on mobile (≥48×48px)
- Numbers should be large, legible — these are physical-touch-sized buttons

### Validation
- Range info below keypad: `Range: 0–300°C` (use actual min/max from printer config)
- If user types a value above max, clamp to max and briefly highlight the field in amber
- If user types a value below 0 (impossible with no minus key, but safety check), clamp to 0
- Soft warning for unusually high values: if value > 280°C for hotend or > 120°C for bed, show a small "That's hot — confirm?" prompt under the keypad before allowing confirm. Don't block, just slow down.

### Confirming
- Tap ✓ → send temperature command, optimistically update target in UI (`220°` becomes the target shown), close modal
- Backend sends to printer (Klipper `SET_HEATER_TEMPERATURE` or Bambu equivalent)
- Actual confirmation comes through normal telemetry stream — when printer reports new target, UI is already showing it; no extra state needed

### Cancelling
- Tap ✕ → close modal, no change
- Tap outside modal (backdrop) → close, no change
- Press Escape → close, no change
- All cancel paths: existing target unchanged

### Preset tap behaviour
- Tap "PLA" preset → target field shows "220" (does not confirm yet)
- User can then tap ✓ to commit, or tap another preset to override, or tap numbers to edit
- This is deliberate — prevents accidental "tapped wrong material" mistakes

## Config schema (`printers.yaml` additions)

Per-printer temperature presets:

```yaml
printers:
  - id: greyhound
    # ... existing fields ...
    temperature_presets:
      hotend:
        - { label: "PLA", value: 220 }
        - { label: "PETG", value: 245 }
        - { label: "ASA", value: 255 }
        - { label: "ABS", value: 250 }
      bed:
        - { label: "PLA", value: 65 }
        - { label: "PETG", value: 80 }
        - { label: "ASA", value: 110 }
        - { label: "ABS", value: 100 }
      # chamber omitted — most printers don't have controlled chamber temp
      # add if relevant per printer
```

Notes:
- "Off" preset (value 0) is implicit, always rendered first, not configured
- If `temperature_presets` is missing for a printer or heater, only "Off" preset shows
- Order in config = display order in the modal
- No upper limit on number of presets defined, but UI shows max 6 before scroll

## Min/max ranges

Pull from printer config at startup and cache:

- **Klipper (Moonraker):** query `printer.objects.query={"configfile": null}` and read `extruder.max_temp`, `heater_bed.max_temp`. Defaults if missing: hotend 300, bed 130.
- **Bambu:** check what `bambulabs-api` exposes for max temps; if nothing available, hardcode safe defaults (hotend 300, bed 110 for non-HT, 130 for HT-capable beds).

Display range string in modal: `Range: 0–{max}°C`.

## Desktop vs mobile

### Desktop
- Modal centered, ~400px wide, fixed height
- Numeric keypad rendered but optional — user can also type directly into the target field with their physical keyboard (Enter = confirm, Escape = cancel)
- Preset buttons in single horizontal row

### Mobile
- Modal slides up from bottom as a sheet (full screen width, top-rounded corners)
- Numeric keypad is the primary input — large tap targets
- Preset row scrolls horizontally if many presets defined
- Numeric input field large enough to read at arm's length

The same component handles both; CSS media queries adapt the layout.

## State management

- Modal state lives in the per-printer Live tab component
- One modal can be open at a time per page (close other before opening another, or just allow one)
- Optimistic UI update: when user confirms, immediately update displayed target to the new value. The websocket telemetry will confirm it shortly. No spinner needed.

## Out of scope

- **Macros / preheat sequences** (e.g. "Preheat for PETG" that sets multiple heaters at once). Could be added later; not v1.
- **Cool-down all** button. Could be added as a small affordance next to the temp panel. Not in this spec.
- **Per-material chamber temps**. Most workshop printers don't have controlled chambers; defer.
- **Temperature graph / history overlay in modal**. Maybe useful but not minimum-viable.
- **Saved custom presets via UI**. User can edit `printers.yaml` to add new presets; no in-UI preset editor needed.

## Implementation order

1. Build the modal component visually first (static, hardcoded values, no wiring)
2. Wire `[- +]` buttons to continue working as-is (no changes needed)
3. Wire click-on-temp-value to open the modal pre-populated with current target
4. Wire numeric keypad to update the target-being-composed
5. Wire preset buttons (initially hardcoded, then pulled from `printers.yaml`)
6. Wire confirm → send command via existing temperature-set path (already exists for `[- +]`)
7. Add config schema to `printers.yaml` for the three printers
8. Add min/max range fetching and validation
9. Soft warning for unusually high values
10. Test on mobile viewport / actual phone

Show me the modal visually after step 1 — want to eyeball the layout and proportions on both desktop and mobile before wiring behaviour.

## Design principles to honour

- **Don't replace the existing `[- +]` nudges** — they're useful for fine adjustments
- **Presets are optional shortcuts**, not the primary input — numeric entry is the fallback that always works
- **Optimistic UI updates** — don't make user wait for printer confirmation
- **Tap-outside / Escape always cancel** — never commit on accident
- **Mobile-first sizing** for the keypad even on desktop — it's a touchable interface either way
