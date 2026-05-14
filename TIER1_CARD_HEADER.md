# Tier 1 — Card header finesse (UPDATED)

> **Supersedes the previous `TIER1_CARD_HEADER.md`.** The name hierarchy has been flipped — model leads, custom name is the subtitle. Use this version, not the previous one.

## Context

Refines the card header to lead with **model name** (short, uniform across cards) and support with **custom user-given name** (personality, identity). Adds a monochrome brand logo icon. Pulls printer labelling out of code and into a config file so it's user-controllable.

The hierarchy choice is deliberate: model names are short and uniform-length (Voron / X1C / H2D) which makes the dashboard scan faster at a glance. Custom names give each printer a recognisable identity in the subtitle without crowding the headline.

## What changes

Replace the current single-line printer name in each card header with this structure:

```
[icon]  Model name              [status pill]
        Custom name
```

- **Icon** (~22px square, monochrome at `--color-text-secondary`): brand logo, stroke/fill rendered in `currentColor`. Lives left of the text block.
- **Model name** (15px, weight 500): short identifier — "Voron", "X1C", "H2D". Leads the card.
- **Custom name** (11px, `--color-text-tertiary`, ~3px below model): user-given identity. The thing you actually call the printer.

The icon, model name, and custom name all come from a config file. Code shouldn't hardcode any printer-specific labels.

## Confirmed printer setup

For reference, the three printers being configured:

| Model | Custom name | Notes |
|---|---|---|
| Voron | Greyhound Elite V2 | Cartographer probe, MMU (Happy Hare), Moonraker host |
| X1C | Greyhound Ludicrous | Bambu Lab X1 Carbon, V9 toolhead |
| H2D | BigBoy | Bambu Lab H2D, IDEX |

Two printers share "Greyhound" in the custom name — this is intentional, not a typo.

## Config file

Create `~/flightdeck/printers.yaml` as the single source of truth for printer metadata. Backend loads it at startup; if changed, requires a service restart (acceptable for v1 — no hot-reload yet).

Schema:

```yaml
printers:
  - id: greyhound                                    # internal identifier, stable across renames
    model_name: "Voron"                              # leads the card header
    custom_name: "Greyhound Elite V2"                # subtitle line
    icon: "voron"                                    # icon key, see icon set below
    connection:
      type: "moonraker"
      host: "192.168.x.x"                            # Greyhound CB2 host
      port: 7125

  - id: x1c
    model_name: "X1C"
    custom_name: "Greyhound Ludicrous"
    icon: "bambu"
    connection:
      type: "bambu"
      serial: "..."                                  # from Bambu Handy
      access_code: "..."                             # 8-digit code from printer screen
      host: "192.168.x.x"                            # LAN-only mode

  - id: h2d
    model_name: "H2D"
    custom_name: "BigBoy"
    icon: "bambu"
    connection:
      type: "bambu"
      serial: "..."
      access_code: "..."
      host: "192.168.x.x"
```

The `id` field is the stable identifier — use it as the SQLite primary key, websocket topic suffix, and URL slug in Tier 2 (`/printer/greyhound`, `/printer/x1c`, `/printer/h2d`). Never derive these from display name fields; users will rename printers.

## Icon set

Monochrome brand logos rendered as inline SVG, 22×22 viewBox, stroke/fill in `currentColor` so they pick up `--color-text-secondary` from the parent. No brand colours — see "design rationale" below.

| Icon key | Glyph | Use for |
|---|---|---|
| `voron` | Hexagon outline with two angled slash marks centred | Any Voron-style printer |
| `bambu` | Wireframe printer cube (box with diagonal lines indicating depth) | Any Bambu Lab printer |
| `generic` | Plain printer outline | Fallback for unknown icon keys |

Icon SVG paths (approximate, refine to taste):

```jsx
// Voron — hexagon with two slashes
<svg viewBox="0 0 24 24">
  <polygon points="12,2 21,7 21,17 12,22 3,17 3,7"
           fill="none" stroke="currentColor" strokeWidth="1.5" />
  <path d="M8 8 L7 16 L10 16 L11 8 Z" fill="currentColor" />
  <path d="M14 8 L13 16 L16 16 L17 8 Z" fill="currentColor" />
</svg>

// Bambu — wireframe printer outline
<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
     strokeWidth="1.6" strokeLinejoin="round">
  <path d="M5 3 L19 3 L19 19 L5 19 Z" />
  <path d="M5 3 L12 8 L19 3" />
  <path d="M12 8 L12 19" />
</svg>
```

If `icon` in the config refers to an unknown key, fall back to `generic` silently. Don't crash on missing icons.

Future: when adding new printer brands, add new icon keys to the enum and corresponding SVGs to the icon component. Don't try to auto-fetch logos from anywhere — keep the icon set deliberate and curated.

## Design rationale (do not undo without discussion)

**Why monochrome instead of brand colours:** the dashboard's load-bearing colour signal is the status pill (green = idle/finished, blue = printing, amber = warning, red = error/offline). Brand-coloured logos compete with this for attention and create visual ambiguity ("is this red because there's a problem, or because Voron's logo is red?"). Brand colour can appear on Tier 2 drill-in pages where each printer has dedicated space and the status read is no longer the primary concern.

**Why model leads, custom name subtitles:** short uniform top lines (3–5 chars) make the dashboard scan faster left-to-right. Custom names add personality without crowding the headline. This is a reversal from an earlier discussion — the prior direction (custom name leading) was the right instinct for a personal workshop but created uneven, hard-to-scan card headers in practice.

## Layout details

- Icon vertically aligned to the top of the model name text (top margin ~1px to optically centre with cap height)
- Gap between icon and text block: 10px
- Status pill stays right-aligned, same styling as the rest of the polish spec
- Connection-health dot (from `TIER1_POLISH.md` §2) goes **between the icon and the model name** in the same row: `[brand icon] [tiny health dot] Model Name`. ~6px gap on either side of the dot.

Alternative placement if the row feels cramped: position the health dot as a small status badge in the bottom-right corner of the icon's bounding box, like an app-icon notification dot. Pick whichever reads cleaner once it's rendered.

## Migration path

1. Create `~/flightdeck/printers.yaml` with the three printers above. Fill in the connection placeholders before testing.
2. Add a `load_printers_config()` function in the backend that parses YAML and validates against a Pydantic model.
3. Replace any hardcoded printer list in the backend with the config-loaded list.
4. Update the frontend card component to consume `model_name`, `custom_name`, and `icon` props from the API.
5. Backend `/api/printers` endpoint returns the full list including metadata, not just IDs.

This config file is intended to grow — settings like custom park positions, preferred filaments per slot, photo-capture intervals, alert thresholds — all belong in here too. Design the Pydantic model with room to expand (use `Optional` fields liberally, prefer flat structure over deep nesting where possible).

## Out of scope

- Reordering printers in the dashboard (config order is display order for v1)
- Web UI for editing the config file (edit the file directly for now)
- Per-printer custom colour accents on Tier 1 (resist this — kills the glance hierarchy)
- Hot-reload of config changes (restart the service for v1)
- Auto-fetching brand logos from the web (curated icon set only)
