# Tier 1 — Print history persistence

## Context

Tier 1 dashboard is rendering real telemetry from all three printers — Bambu MQTT for X1C and H2D, Moonraker websocket for the Voron. State machine handles transitions correctly. **But nothing is being persisted.** Every print that completes, cancels, or errors is being observed and then forgotten.

This spec adds a `prints` table to the existing SQLite database and wires up state-transition handlers to record print lifecycle events. Once this lands:

- The "Last print" row on idle cards becomes real (currently has nowhere to read from)
- The FINISHED-state hydration logic on backend restart actually has data to hydrate from
- Tier 3 stats become possible later (hours per printer, filament consumed, success rates)

Scope is deliberately small. Don't over-engineer the schema — get something useful capturing data today, evolve later.

## Schema

Single table for now. Resist adding a `print_events` audit-log table or a `materials` lookup table at this stage — both are tempting, neither is needed for v1.

```sql
CREATE TABLE prints (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    printer_id TEXT NOT NULL,                    -- FK to the printer config 'id' field
    job_key TEXT NOT NULL,                       -- Bambu task_id or Moonraker job uid; used for idempotency
    filename TEXT NOT NULL,                      -- raw filename as reported by printer
    subtask_name TEXT,                           -- Bambu project name from MQTT subtask_name; NULL for Moonraker
    started_at TIMESTAMP NOT NULL,               -- when state first became PRINTING
    ended_at TIMESTAMP,                          -- when state left PRINTING (NULL while still running)
    duration_seconds INTEGER,                    -- ended_at - started_at, computed on completion
    final_state TEXT,                            -- 'FINISHED' | 'CANCELLED' | 'ERROR' | NULL while running
    error_message TEXT,                          -- populated if final_state = 'ERROR'
    layers_total INTEGER,
    layers_completed INTEGER,                    -- last known layer at end; for cancelled prints this matters
    filament_grams REAL,                         -- estimated grams used; populated on completion if available
    material TEXT,                               -- 'PLA', 'PETG-HF', etc — Bambu publishes this, Moonraker may not
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_prints_printer_started ON prints(printer_id, started_at DESC);
CREATE UNIQUE INDEX idx_prints_job_key ON prints(printer_id, job_key);
```

The unique index on `(printer_id, job_key)` is the idempotency guard. State transition events can fire multiple times during reconnect storms — every write should be UPSERT-shaped, not blind INSERT.

## Lifecycle handling

Three state transitions matter for persistence:

### Transition: `* → PRINTING`

Either a new print started or the backend restarted mid-print and is re-observing one already running.

```python
def on_print_started(printer_id, job_key, filename, ...):
    # UPSERT: if (printer_id, job_key) exists, do nothing.
    # Otherwise INSERT new row with started_at = now() and final_state = NULL.
```

For Bambu, `job_key` = `task_id` from MQTT (stable for the duration of a print). For Moonraker, `job_key` = `job_uid` from `print_stats` (also stable).

If `started_at` is recoverable from the printer itself (Moonraker exposes `print_stats.print_duration`, Bambu publishes `print_real_action_time`), prefer that over `now()` — it gives correct duration on backend-restart-mid-print scenarios. If not recoverable, `now()` is fine as a best-effort.

### Transition: `PRINTING → FINISHED`

Print completed normally.

```python
def on_print_finished(printer_id, job_key, layers_completed, filament_grams, ...):
    # UPDATE prints SET ended_at = now(), duration_seconds = ..., 
    #                   final_state = 'FINISHED', layers_completed = ..., 
    #                   filament_grams = ...
    # WHERE printer_id = ? AND job_key = ?
```

Pull `filament_grams` from the slicer metadata if available (Bambu MQTT publishes this in `print.subtask`; Moonraker exposes `print_stats.filament_used` in mm — needs conversion to grams using filament diameter and density, OK to skip for v1 if conversion is fiddly).

### Transition: `PRINTING → IDLE` (cancelled) or `PRINTING → ERROR`

Same UPDATE shape as FINISHED, but `final_state = 'CANCELLED'` or `'ERROR'`, and `layers_completed` captures wherever the print stopped (this is the bit that matters for honest "Last print" copy — "cancelled at 67%" rather than just "cancelled").

For ERROR, capture `error_message` from whatever the printer publishes:
- Bambu: `print_error` field in MQTT, sometimes plus `mc_print_error_code`
- Moonraker: `print_stats.message`

If both are empty, store `'Unknown error'` rather than NULL — makes the UI simpler downstream.

## "Last print" idle-card row

Now that data exists, wire up the existing UI row:

```sql
SELECT filename, subtask_name, duration_seconds, final_state, layers_completed, layers_total
FROM prints
WHERE printer_id = ?
ORDER BY started_at DESC
LIMIT 1;
```

Display logic:
- Prefer `subtask_name` over `filename` if present (Bambu — solves the "everything is `plate_1.gcode`" problem)
- Format duration as `Xh Ym` or `Ym` for prints under an hour
- For FINISHED: `"<name> · 4h 12m"`
- For CANCELLED: `"<name> · cancelled at 67%"` (compute percentage from layers_completed/layers_total)
- For ERROR: `"<name> · failed at 67%"`
- If no prints in history: omit the row entirely (don't show "—" or "No prints yet")

## FINISHED state hydration on backend restart

Currently the FINISHED state is held in memory and lost on restart. With this table in place, hydrate it:

On backend startup, for each printer, run:
```sql
SELECT job_key, ended_at, final_state 
FROM prints 
WHERE printer_id = ? 
  AND final_state IN ('FINISHED', 'CANCELLED', 'ERROR')
  AND ended_at > datetime('now', '-30 minutes')
ORDER BY ended_at DESC
LIMIT 1;
```

If a row comes back AND the live printer state is currently `IDLE`, override the in-memory state to `FINISHED` (or `CANCELLED`/`ERROR`) until 30 minutes after `ended_at`. Then transition to `IDLE` naturally.

This solves the case where the backend restarts within the 30-minute FINISHED window — without it, a service bounce silently demotes a just-finished print back to IDLE.

## Edge cases worth handling

- **Power-cycle the printer mid-print:** Bambu will lose the `task_id`; on reconnect the printer reports IDLE. The previous PRINTING row in SQLite has no `ended_at`. After 60 seconds of seeing IDLE with a stale PRINTING row, mark it `final_state = 'ERROR'`, `error_message = 'Connection lost mid-print'`, set `ended_at = now()`. Don't leave orphaned NULL rows forever.

- **Multiple `gcode_state: FINISH` events:** Bambu can republish this during a connection wobble. The UPSERT pattern handles this — second event sees `final_state` already set and skips.

- **Print started before Flightdeck was running:** the first MQTT event Flightdeck sees is PRINTING with a `task_id` it has no row for. INSERT it with best-effort `started_at` (from printer telemetry if available, otherwise `now()`).

## Bambu filename display fix

Currently both Bambu cards show `plate_1.gcode` in the filename slot. This is because Bambu Studio names every export `plate_1.gcode` by default — the filename has nothing to do with the project. Two simultaneous Bambu prints both showing `plate_1.gcode` is a real glance-recognition failure.

**Fix:** prefer `subtask_name` from Bambu MQTT over `filename` when displaying the active print on Tier 1 cards.

`subtask_name` is the actual project name (e.g. `"enclosure_v3"`, `"bracket_array"`) and is published in the MQTT `print.subtask` field on `pushing.pushall` events. It's already being captured in the `prints` table per the schema above; this fix is about using it for the live print display, not just the history row.

**Display logic for the filename slot on PRINTING cards:**

```
if subtask_name and subtask_name.strip() and subtask_name != filename:
    display = subtask_name
else:
    display = filename
```

The third condition (`subtask_name != filename`) handles the case where someone has renamed their Bambu export to something meaningful — no point showing it twice.

**For the Voron (Moonraker):** the filename from Moonraker is the actual gcode file name from the slicer, which is usually meaningful already (e.g. `BTT_buffer_mount_PLA_30m.gcode`). No fix needed there; the `subtask_name` column will be NULL for Moonraker rows.

**Width handling:** project names can be longer than `plate_1.gcode`. Truncate with ellipsis at the card width — don't let the filename push the "filament · weight" slot off the line. Full filename should be visible in the hover popover tooltip without truncation.


- Print history detail view / browseable list (Tier 2 or Tier 3)
- Stats / charts / leaderboards (Tier 3)
- Filament tracking across multiple prints / lifetime totals (Tier 3)
- Per-layer telemetry capture (out of scope full-stop — that's not what this dashboard is for)
- Image capture of completed prints (could be Tier 2 with the cameras; not this)
- Export to CSV / API for external tools (later)

## Implementation order

1. Schema migration (Alembic if you're using it; raw SQL `CREATE TABLE` if not — fine either way at this stage)
2. UPSERT functions for the three state transitions, wired into the existing state machine
3. Backfill: if there's any way to ask Bambu/Moonraker for "what was the most recent print before Flightdeck started," try once at startup. Optional, skip if fiddly.
4. Bambu filename display fix (`subtask_name` preference) — independent of history wiring, but quick to do in the same pass since both touch the same MQTT event handler
5. "Last print" row population from SQL
6. FINISHED hydration on startup
7. Edge-case handling for orphaned PRINTING rows

Show me the schema migration and one of the state-transition UPSERTs before doing the rest — I want to eyeball the SQL shape and Pydantic models before they propagate through the code.
