# Tier 2 — Per-printer detail, all-cameras view, and history

## Context

Tier 1 dashboard is mature: real telemetry from all three printers (Voron via Moonraker, Bambus via MQTT), state machine handling all transitions, print history persisting to SQLite, hover popovers with live camera feeds, mobile-responsive layout.

Tier 2 is where Flightdeck stops being a *monitoring dashboard* and becomes a *workshop control surface*. The goal is twofold:

1. **Per-printer drill-in** — when you click a card on Tier 1, you go to a dedicated page for that printer with the controls and detail you'd reach for in an actual interaction session.
2. **The unique-to-Flightdeck features** — capabilities that genuinely couldn't be done in Mainsail or Bambu Handy because they're per-printer tools, but become possible when you unify across an entire workshop.

Two such cross-cutting features land in Tier 2:
- **All Cameras view** — one screen, all live feeds, at-a-glance visual check across the whole workshop
- **Cross-printer object exclusion** — same UI, same workflow, regardless of whether the underlying printer is Klipper or Bambu

This spec covers all of the above. It is deliberately scoped: many tempting features have been deferred to `TIER2_BACKLOG.md`.

---

## Precondition: Bambu Network mode audit

**Do this before any other Tier 2 work.** Current Bambu integration assumed LAN-only mode in earlier specs; in reality the printers are connected via Bambu Network through Orca. Tier 2 sends commands (Pause / Resume / Cancel / set temps / exclude objects) which behave differently depending on the connection mode.

Audit:
1. What MQTT broker/endpoint is the backend currently connecting to for each Bambu? (`mqtts://<printer_ip>:8883` = LAN mode; `mqtt-us.bambulab.com` or regional equivalent = cloud mode.)
2. What credentials are being used — printer access code + serial (LAN mode), or Bambu account credentials (cloud mode)?
3. For each command we plan to send (pause, resume, stop, set temp, skip objects), document the MQTT topic + payload structure for the *active* connection mode.
4. Test one harmless command (e.g. set a target temperature to its current value, effectively a no-op) end-to-end and confirm the printer responds.

Once we know what mode we're operating in and confirm command-sending works at all, proceed.

---

## Top-level navigation

Tabs at the top of the page, replacing the current single-page header. Tabs flow left-to-right:

```
[FLIGHTDECK]   [Voron] [X1C] [H2D] [All Cameras]      [Status pill] [Live] [Clock]
```

- Printer tabs come from `printers.yaml` order
- "All Cameras" sits as the rightmost tab — the meta view
- Active tab highlighted with the existing accent treatment (subtle underline or background tint, use the `--color-text-info` palette)
- Mobile: tabs scroll horizontally if they overflow

Tab switching is client-side routing — no full page reload, no flash of empty content. Use the existing websocket data stream; switching tabs is purely a view change.

**The Tier 1 dashboard** (overview cards) lives at `/` and is reached by — actually, this is a design question. Two options:

**A.** Add a "Dashboard" tab at the leftmost position. Tabs become: `[Dashboard] [Voron] [X1C] [H2D] [All Cameras]`.

**B.** Clicking the FLIGHTDECK wordmark in the top-left always returns to the dashboard, no dedicated tab.

I lean toward B — keeps the tab strip focused on the per-printer / all-cameras navigation, makes the wordmark a navigation affordance. But A is more discoverable. Pick whichever feels right when implementing.

---

## Per-printer detail page (`/printer/{id}`)

The drill-in destination from any Tier 1 card. Has **two sub-tabs**: **Live** and **History**.

### Sub-tab navigation

Below the top-level tabs, inside the printer's page:

```
[Live*] [History]
```

Active sub-tab highlighted. Switching is again client-side, instant.

### Live sub-tab

Layout, top to bottom:

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│                    LIVE CAMERA (hero)                       │
│                                                             │
└─────────────────────────────────────────────────────────────┘

[Pause]   [Resume]   [Cancel]              [Emergency Stop]

PRINT DETAILS                    TEMPERATURES
filename: presser-foot-box.3mf   Hotend  220° / 220°  [- +]
Layer 47/119 · 58s/layer         Bed      65° /  65°  [- +]
Started 19:14 · ETA 1h 38m       Chamber  31°       (no target)
Material: PLA · 78g / ~140g

OBJECTS (only renders when multi-part)
  ☐ Tray_Lid_01    printing
  ☐ Tray_Lid_02    printing
  ☑ Tray_Lid_03    EXCLUDED (failed)
  ☐ Tray_Lid_04    printing
  ☐ Tray_Lid_05    printing
```

#### Live camera (hero)

Full-width on the page, 16:9 aspect ratio. Uses the same per-printer camera pipeline already built — direct MJPEG for the Voron, RTSP proxy for the Bambus.

This is the high-resolution version of the camera; the hover popover from Tier 1 used the same source at smaller display size. Same underlying stream, different rendering size.

Click camera → fullscreen view (browser fullscreen API). Useful for prolonged watching.

#### Control buttons

Five buttons in two visual groups:

- **Primary group (left):** Pause, Resume, Cancel — the day-to-day controls
- **Destructive (right):** Emergency Stop — visually separated, red accent

Each button:
- Tap target ≥ 44×44px (mobile usability)
- Disabled state when the action isn't applicable (e.g. "Pause" is disabled when state is `IDLE`, "Resume" only enabled when `PAUSED`)
- Optimistic UI update on tap — button shows loading state, then settles when state-change confirmation arrives via the websocket
- Confirmation modal on **Cancel** and **Emergency Stop** only. Single tap on Pause/Resume — no friction for the high-frequency safe actions.

**Context-dependent fifth action** (mentioned in earlier discussion) is omitted from v1. The five-button concept simplifies to four buttons (Pause / Resume / Cancel / E-Stop) plus the inline temp controls. The "Clear plate" affordance for Bambus when FINISHED can live in a follow-up if it proves needed.

Confirmation modal copy:
- Cancel: "Cancel the print? This will stop the print immediately and discard progress."
- E-Stop: "Emergency stop? The printer will halt all motion and require a manual reset to continue."

Modals dismiss on tap-outside or explicit Cancel button.

#### Temperature display + controls

For each heater (hotend, bed, chamber if present):
- Current temp, large
- Target temp, smaller, after a slash
- `[- +]` controls to nudge target by 5°C per tap
- Long-press for keyboard input (mobile: opens a number pad; desktop: editable inline)
- Setting target to 0 = heater off

Backend translates these to printer commands:
- Voron: `SET_HEATER_TEMPERATURE HEATER=extruder TARGET=220`
- Bambu: MQTT command to set target temp (specific topic/payload depends on Network mode audit)

#### Print details panel

When state is `PRINTING`, `PAUSED`, or `FINISHED` (within 30-min window):

- Filename (or `subtask_name` if Bambu, per existing preference logic)
- Layer X / Y, with rolling-average layer time
- Start time, ETA
- Material name + filament used so far / estimated total

When state is `IDLE` or `OFFLINE`: show last print summary (same as Tier 1 idle-card info).

#### Object exclusion panel

Only renders when the current print has more than one named object.

Data source:
- **Klipper:** `printer.objects.query={"exclude_object": null}` returns `objects`, `current_object`, `excluded_objects`
- **Bambu:** equivalent data via MQTT (specific field depends on Network mode audit)

UI: list of objects, each row showing:
- Checkbox (unchecked = currently printing; checked = excluded)
- Object name (raw from gcode, no transformation)
- State: `printing`, `current` (highlighted), `completed`, or `excluded`

Toggling a checkbox to "excluded":
1. Confirmation modal: "Exclude *{object_name}*? This part will stop printing and cannot be re-included without restarting the print."
2. On confirm, send `EXCLUDE_OBJECT NAME={name}` (Klipper) or Bambu equivalent
3. Row updates to show excluded state

Cannot un-exclude mid-print. The modal copy makes this explicit.

**Recommendation flagged in the panel header:** if the print is currently `PRINTING`, a small note: *"Pause the print first if you need time to identify the failed part."* Excluding while running is supported but a momentary pause makes it less stressful.

### History sub-tab

Year-at-a-glance heatmap of this printer's print history, plus a day-detail panel when a cell is clicked.

#### Layout

```
2026                                          [< 2025]  [2026*]  [2027 >]

47 prints · 168 hours · 4.2kg filament

   Mon ▢▢▢▢▢▢▢ ▢▢▢▢▢▢▢ ▢▢▢▢▢▢▢ ▢▢▢▢▢▢▢...
   Tue ▢▢▢▢▢▢▢ ▢▢▣▢▢▢▢ ▢▢▢▢▢▢▢ ▢▢▢▣▢▢▢
   Wed ▢▢▢▣▢▢▢ ▢▣▣▢▢▢▢ ▢▢▢▢▢▢▢ ▢▢▢▢▣▢▢
   Thu ▢▢▢▢▢▢▢ ▢▣▢▢▢▢▢ ▢▢▢▢▣▢▢ ▢▢▢▣▢▢▢
   Fri ▢▣▣▢▢▢▢ ▢▢▢▢▣▢▢ ▢▢▢▢▢▢▢ ▢▢▢▢▢▢▢
   Sat ▣▣▣▣▣▢▢ ▢▢▢▢▣▢▢ ▢▢▢▣▢▢▢ ▢▣▣▢▢▢▢
   Sun ▣▢▢▢▣▢▢ ▢▢▢▢▢▢▢ ▢▢▢▢▢▢▢ ▢▢▢▢▢▢▢
       Jan Feb Mar Apr May Jun ...
```

GitHub-style contribution graph. Each column is a week, each row is a day-of-week (Mon-Sun). Each cell is one day.

#### Cell intensity

Four shades based on print count for that day:
- **0 prints:** empty cell with thin `--color-border-tertiary` outline
- **1–2 prints:** light tint of `--color-text-success` (~20% opacity)
- **3–4 prints:** medium tint (~50% opacity)
- **5+ prints:** full `--color-text-success`

Cells representing future dates (after today) render even more faintly or not at all — they're not "0 prints," they're "haven't happened yet."

#### Year navigation

`[< Year] [Current Year*] [Year >]` controls above the heatmap. Arrows navigate by year. If a navigated year has no data, the heatmap renders empty — that's fine.

Default view: current year.

#### Summary line

Above the heatmap, below the year nav:
```
2026 · 47 prints · 168 hours · 4.2kg filament
```

Three aggregates for the displayed year. Pulled from a single SQL query against the `prints` table. If a value isn't available (e.g. filament weight wasn't recorded for older prints), gracefully omit it rather than show "0kg."

#### Day detail panel

Clicking a cell opens a panel/modal showing that day's prints:

```
Wednesday, 14 May 2026
─────────────────────────
19:14  build-tower-cap_PLA_2h0m       4h 49m    COMPLETE   ~81g
       [thumbnail]

15:30  200x200NEW.gcode               35m       COMPLETE   ~20g
       [thumbnail]
```

Each row shows: start time, filename / subtask_name, duration, final state, filament used, thumbnail (if cached).

Click a row → full print detail (larger thumbnail, error message if any, layer count, full filename, etc).

Cancelled and errored prints show their badge inline (`CANCELLED at 67%`, `ERROR: Heater not heating at expected rate`).

#### Implementation notes

Two SQL queries underpin the whole view:

```sql
-- Heatmap aggregation
SELECT date(started_at) as print_date, count(*) as print_count
FROM prints
WHERE printer_id = ?
  AND started_at >= ?
  AND started_at < ?
GROUP BY print_date;

-- Day detail
SELECT * FROM prints
WHERE printer_id = ?
  AND date(started_at) = ?
ORDER BY started_at DESC;
```

Both should be fast even with thousands of rows. Index on `(printer_id, started_at)` already exists from Tier 1 spec.

Year summary aggregates similarly:

```sql
SELECT count(*) as total_prints,
       sum(duration_seconds) as total_seconds,
       sum(filament_grams) as total_grams
FROM prints
WHERE printer_id = ?
  AND started_at >= date(?,'start of year')
  AND started_at < date(?,'start of year','+1 year')
  AND final_state = 'FINISHED';
```

Only completed prints count toward the "X hours" total to avoid inflating with cancelled-after-3-hours prints.

---

## All Cameras view (`/cameras`)

Pure visual. Grid of live feeds, minimal chrome.

### Layout

Desktop: cards arranged in `grid-template-columns: repeat(auto-fit, minmax(360px, 1fr))`. Two-wide on smaller desktop, three-wide on larger, scales smoothly.

Mobile: single column, vertical scroll. Each tile takes the full width minus padding.

Tile dimensions: 16:9 aspect ratio (preserves the camera's native ratio).

### Tile content

Each tile renders:
- Live MJPEG feed filling the tile (same source as the per-printer Live tab, can be same or lower resolution per "Performance note" below)
- Bottom-left overlay: `<Model Name> · <State>` (e.g. "Voron · PRINTING 54%")
- Bottom-right overlay: small live timestamp / "last frame X seconds ago" if the stream stalls

Overlays use a semi-transparent dark background to remain readable against any camera image.

State colour-coding in the overlay matches the Tier 1 pills: green for IDLE/FINISHED, blue for PRINTING, amber for PAUSED, red for ERROR/OFFLINE.

### Interaction

- **Tap/click tile** → navigates to that printer's Live tab (`/printer/{id}`)
- **Long-press / right-click** → fullscreen that single tile with controls overlay (Tier 2.5 if too complex for v1; OK to defer)
- **Offline camera** → tile shows placeholder with "Camera offline" message, doesn't break the grid

### Performance note

Three (or more) simultaneous MJPEG streams over Tailscale to a mobile device on cellular is the bandwidth-stressing case. Pi 5 has the headroom; cellular may not.

**v1 approach:** use the same stream as the per-printer view. Monitor whether bandwidth becomes an issue in real use.

**Later (if needed):** add a per-tile lower-resolution stream variant for the all-cameras view. Don't optimise prematurely — wait until there's evidence it's a problem.

The proxy lazy-starts ffmpeg per stream and idles it out at 60s of inactivity. Three tiles open = three active streams; closing the page = streams idle out within a minute.

---

## State of empty / offline / weird cases

### Per-printer page when printer is OFFLINE

The page renders, but:
- Camera shows "Camera offline" placeholder
- Buttons are all disabled
- Temps show "—"
- Print details show last-known data with a small "Last seen X ago" timestamp
- Status pill shows OFFLINE (grey)

Don't redirect to Tier 1; the user navigated here for a reason and might want to see what's known.

### Per-printer page when printer is IDLE

Camera live. Controls disabled (except "Set temperature" for preheating). Print details panel shows "Last print" info (same shape as Tier 1 idle-card). History tab works normally.

### All Cameras view when a camera is offline

Single tile shows offline state. Other tiles unaffected.

### History tab with no data

Heatmap renders empty for the year. Summary line shows "No prints recorded yet." No empty-state illustration needed — the empty heatmap *is* the empty state.

### Confirmation modals on slow networks

If the user taps Cancel, the confirmation modal opens optimistically. If the actual cancel command takes 3+ seconds to confirm via MQTT, the button shows a loading state but the state-change confirmation comes via the normal websocket flow.

Don't add a separate "confirming…" overlay — trust the existing state machine to update the UI when the printer reports the new state.

---

## Bonus additions (display-only, added during Tier 2 implementation)

These weren't in the original scope but were cheap to add since the data already flowed through the backend. Both are **display-only** — no controls.

### Two-column Live layout

On desktop (>900px): camera fills the left column at full viewport height; controls, temps, print details, AMS/objects stack in a 320px right sidebar. No scrolling required. On mobile (<900px) reverts to single-column with a fixed 16:9 camera.

### AMS material display (Bambu printers)

A panel on the Live sub-tab (in the right sidebar, below temps). Shows the AMS unit(s) attached to each Bambu printer: slot colour, material type, and which slot is currently active.

Data source: `mqtt_dump()["print"]["ams"]` — parsed directly from the MQTT stream already being consumed. No new network calls.

Renders only when at least one slot has material loaded. Hidden when AMS is empty or absent.

**Known cosmetic issue:** AMS HT (High Temperature variant on H2D) has MQTT unit ID 128; the label renders as "AMS 129" instead of "AMS HT". Fix: special-case unit IDs ≥ 128 in the label.

### MMU gate display (Voron — Happy Hare)

A panel equivalent to the AMS display, but for the Voron's multi-material unit managed by Happy Hare via Moonraker.

Data source: Happy Hare exposes state via Moonraker's `printer.objects.query` endpoint — specifically the `mmu` object which includes gate colours, materials, filament presence, and the current selector position.

Renders only when MMU is enabled and has loaded gates. Hidden otherwise.

**Status as of Tier 2 completion:** AMS display shipped. MMU display shipped.

---

## What is NOT in Tier 2

Captured here for completeness. Anything you reach for in Tier 2 and don't find, check whether it's deliberately deferred:

- Manual axis movement (Mainsail does this better; Handy does too)
- G-code console
- File upload / queue management
- Macro buttons (per-printer specific, not unified across types)
- Mesh bed levelling visualisation
- **AMS slot management UI** (load/unload/swap — controls, not display; Bambu Handy handles this)
- **MMU controls** (load/eject/recover — controls, not display; Happy Hare's own UI handles this)
- Settings / config editing
- Slicer integration / file ingestion
- Multi-user access controls
- Push notifications
- Aggregated stats across printers (e.g. "total filament used across whole workshop")
- Print re-queue / "print this again" buttons
- Tier 2.5: long-press fullscreen on All Cameras tiles, low-bandwidth stream variant, "clear plate" context action

These live in `TIER2_BACKLOG.md` or future tier specs.

---

## Implementation order

1. ✅ **Bambu Network mode audit and command test** — LAN mode confirmed on both Bambus; RTSP on port 322; MQTT commands working.
2. ✅ **Top-level tab navigation** — printer tabs + All Cameras tab, client-side hash routing.
3. ✅ **Per-printer page Live tab — read-only.** Camera, temps, print details.
4. ✅ **Per-printer page Live tab — controls.** Pause / Resume / Cancel / E-Stop with confirmation modals for Cancel and E-Stop.
5. ✅ **Per-printer page Live tab — temperature controls.** Nudge buttons + inline edit.
6. ✅ **Object exclusion panel.** Renders when multi-object print active; confirmation modal before exclusion.
7. ✅ **All Cameras view.** Grid of live streams; tap-to-drill to printer.
8. ✅ **History sub-tab — heatmap.** Year-based grid, 4-tier green intensity, year navigation, summary line.
9. ✅ **History sub-tab — day detail.** Day panel with print list on cell click.
10. ✅ **History sub-tab — print detail.** Full print info card with back navigation; instant (cached).
11. ✅ **AMS display panel** (bonus). Slot colours, material type, active-slot indicator; Bambu Live tab. AMS HT unit (ID 128) labelled correctly via `_AMS_LABELS` lookup.
12. ✅ **Two-column Live layout** (bonus). Camera fills left, sidebar right; no scrolling on desktop.
13. ✅ **MMU display panel** (bonus). Happy Hare gate state for the Voron via `mmu` Moonraker object. Gate colours, material, active gate indicator. Vendor label from `mmu_machine.unit_0.name` ("BTT VVD"). RRGGBBAA colour normalisation.
14. ✅ **Camera click-cycle** (bonus). Desktop: normal → wide (sidebar hides, blue outline affordance) → fullscreen → normal. Mobile (≤900px): toggle normal ↔ fullscreen, skipping wide. ESC returns to normal from any state.

---

## Design principles to honour throughout

- **Mobile-first sensibility, desktop-first scale.** Layouts should work on a phone but be optimised for a desktop browser, since that's where workshop sessions actually happen. The phone case is "remote glance + occasional intervention," not "primary interaction."
- **Consistent across printer types.** A Klipper printer and a Bambu printer should look and behave identically in the UI. Backend translates to the right commands; frontend doesn't know the difference.
- **Optimistic UI for safe actions, confirmed UI for destructive ones.** Pause/Resume = instant feedback. Cancel/E-Stop/Exclude = confirmation.
- **Status pills are the load-bearing colour signal.** Same as Tier 1 — don't introduce competing colour systems.
- **Don't try to be Mainsail.** When in doubt about a feature, ask "is this something Mainsail does well already?" If yes, link to Mainsail rather than building a worse version.
