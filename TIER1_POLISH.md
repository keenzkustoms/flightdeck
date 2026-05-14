# Tier 1 — Polish & state handling

## Context

The Tier 1 dashboard cards and hover thumbnail popover are scaffolded and rendering. This spec covers the remaining polish to get Tier 1 to "feels finished" before moving to Tier 2 controls.

Most items here are about **state correctness** (showing the right thing at the right time) and **trust signals** (small affordances that confirm the dashboard is actually live and the data is fresh). Aesthetics are secondary — don't over-design; match the existing card styling.

## 1. Printer state machine

The current implementation collapses too many states into `IDLE`. Add the following distinct states with corresponding pill styles:

| State | Pill colour | When it applies | Card body |
|---|---|---|---|
| `IDLE` | green (`--color-background-success` / `--color-text-success`) | Powered on, no job, no recent finish | Show idle-state info rows (see §3) |
| `PRINTING` | blue (`--color-background-info` / `--color-text-info`) | Job actively running | Show progress, thumbnail, ETA |
| `FINISHED` | green, but *outlined* not filled | Job completed within last ~30 min, hasn't cleared yet | Show "Print complete · Xh Ym" + filename, plus cooling temps if hotend > 50°C |
| `PAUSED` | amber (`--color-background-warning` / `--color-text-warning`) | Job paused by user or filament runout | Show "Paused · reason" + progress frozen |
| `ERROR` | red (`--color-background-danger` / `--color-text-danger`) | Print failed, thermal runaway, etc | Show error code / message |
| `OFFLINE` | grey (`--color-background-secondary` / `--color-text-tertiary`) | MQTT/Moonraker unreachable | Collapse card body, show "Last seen: HH:MM" |

**Source mapping:**

- **Bambu MQTT `gcode_state`:** `IDLE` → IDLE, `RUNNING` → PRINTING, `FINISH` → FINISHED, `PAUSE` → PAUSED, `FAILED` → ERROR
- **Moonraker `print_stats.state`:** `standby` → IDLE, `printing` → PRINTING, `complete` → FINISHED, `paused` → PAUSED, `error` → ERROR, `cancelled` → IDLE (after a brief FINISHED display)

**Bug the current build has:** X1C shows IDLE with progress at 100% / Layer 142/142 / ETA —. That's a `FINISH` state from Bambu MQTT being mapped to IDLE. Fix the mapping so it shows FINISHED with the completion summary, then transitions to IDLE after 30 min OR when the user clears the build plate (Bambu publishes `gcode_state: IDLE` after plate clear).

## 2. Connection health indicator

A small dot (7px circle) next to each printer name showing the underlying link state:

| Dot colour | Meaning | Trigger |
|---|---|---|
| Green (`--color-text-success`) | Healthy | Last MQTT/Moonraker message within heartbeat window (10s for MQTT, 5s for Moonraker websocket) |
| Amber (`--color-text-warning`) | Degraded | No message in 10–30s, but socket still open |
| Red (`--color-text-danger`) | Disconnected | Socket closed or no message for >30s |

Tooltip on hover: `"MQTT healthy · last update 2s ago"` / `"Moonraker disconnected · last seen 14:22"` etc.

This is separate from the printer's `state` field — a printer can be `OFFLINE` (dot red) or `IDLE` (dot green). Both pieces of information matter.

## 3. Idle-card information rows

When a printer is in `IDLE` state, fill the empty space below the temperature row with three info rows separated from the temps by a 0.5px border-top. Same row layout as the previous mockup:

```
Last print     SIDDAMENT ASA · 4h 12m
Toolhead       homed · X175 Y175 Z10
MMU            Gate 0 loaded · 4 gates ready    (Voron only — skip on Bambus)
```

**Important copy note:** the Voron is **homed**, not **parked**. "Parked" implies a defined park position macro has run (e.g., `_TOOLHEAD_PARK_PAUSE_RESUME`). "Homed" just means endstops are triggered and position is known. The state machine should track these separately if possible:

- After `G28` only → "homed"
- After park macro → "parked"
- Mid-print idle (paused) → "paused at Xn Yn Zn"

If distinguishing is too noisy for v1, just show "homed" since that's the most common idle state.

**Data sources:**

- **Last print:** SQLite print history table (we'll need this anyway for stats later). For now if the table is empty, omit the row rather than showing "—".
- **Toolhead position:** Moonraker `/printer/objects/query?toolhead` returns `position` array.
- **MMU status:** Happy Hare exposes gate status via Klipper objects — `mmu_machine` and `mmu_gate_map` printer objects. Show the active gate and the count of "ready" gates (status != "empty").

## 4. Header status pill

Top-left of the header, next to the "FLIGHTDECK" wordmark. A small pill aggregating any per-printer warnings or errors:

| State | Display | When |
|---|---|---|
| All good | green dot + "All systems nominal" | No printer is in ERROR, PAUSED, or OFFLINE; no warnings active |
| Warning | amber dot + "1 warning" / "N warnings" | Any of: filament low (<200g remaining), printer PAUSED, MMU error, chamber temp out of range |
| Fault | red dot + "1 fault" / "N faults" | Any printer in ERROR state or OFFLINE >2 min during a print |

Clicking the pill (future): scroll/jump to the offending card. For now, no click behaviour needed, but make it look interactive (hover state).

## 5. "Live" indicator + clock

Top-right of the header:

- Clock showing current time, updates every second
- Small pulsing green dot to the right of the clock with text "Live"
- If the websocket from the frontend to the backend disconnects: dot turns red, text becomes "Reconnecting…", clock keeps ticking but greys out

The frontend↔backend connection is separate from the backend↔printer connections. Both need to be healthy for the dashboard to be trustworthy. Per-printer dots cover backend↔printer; the header "Live" indicator covers frontend↔backend.

## 6. Hover popover — fallback content

Current bug: when no thumbnail is available, the popover shows only "Preview unavailable" and stops. Per the original spec, the metadata fallback should still render. Fix:

**No-thumbnail layout:**
```
[grey placeholder icon, ~80px square, centered]
filename.gcode
Estimated 3h 42m · Layer height 0.20mm
PLA · ~340g
```

**Order of preference for what to show:**
1. Thumbnail + full metadata (best case)
2. Placeholder icon + full metadata (no thumbnail, but metadata available)
3. Placeholder icon + filename only (minimal data — better than nothing)
4. Suppress the popover entirely only if the printer is IDLE (nothing to preview)

The popover should never appear on IDLE or OFFLINE cards. It's only meaningful for PRINTING, PAUSED, and FINISHED states.

## 7. Footer

Bottom of the dashboard, small text in `--color-text-tertiary`:

```
flightdeck · 192.168.4.127               3 printers · 2 active · 1 idle
```

The right side updates based on actual state counts.

## Implementation order suggestion

1. Fix the state machine first (§1) — everything else depends on having correct states
2. Idle-card info rows (§3) — fills the most visible "looks unfinished" gap
3. Hover popover fallback (§6) — small fix, big quality bump
4. Connection dots (§2) — needs websocket plumbing, do once that's stable
5. Header status pill and Live indicator (§4, §5) — these aggregate from §1 and §2, so do them last
6. Footer (§7) — trivial, do whenever

## Out of scope for this spec

- Tier 2 controls (start/stop/pause buttons)
- Live camera feeds — Tier 2
- Print history detail views — Tier 2 or Tier 3
- Filament tracking beyond "remaining grams" — Tier 3
- Alerts/notifications panel — Tier 2
- Settings UI — later

If anything in this spec conflicts with what's in `SESSION_NEXT.md` or `TIER1_HOVER_THUMBNAIL.md`, flag it before implementing rather than picking one silently.
