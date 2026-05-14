# Tier 2 — Backlog (deferred features)

Features that were considered during Tier 2 design and deliberately scoped out. Captured here so they're not lost.

## Likely Tier 2.5 (small follow-ups after Tier 2 ships)

- **Long-press / right-click fullscreen on All Cameras tiles** with controls overlay. Tap a tile to expand it to full screen, show Pause/Cancel as overlay buttons, dismiss to return to grid. Useful for "spotted something wrong from across the room" interventions.

- **Low-bandwidth stream variant for All Cameras view.** Lower resolution / lower frame rate stream for cellular use. Add only if bandwidth is observed to be a problem in practice.

- **"Clear plate" context action on Bambus** when state is FINISHED. Bambu MQTT command to acknowledge print completion and return to IDLE.

- **Visual indicator on All Cameras tile when objects have been excluded.** Small "1 of 5 excluded" badge.

- **Optimistic "we tried to send a command but the printer hasn't responded yet" state.** Currently the spec leans on the state machine to update the UI; this would add an explicit "command in flight" indicator for slow connections.

## Tier 3 candidates (bigger features for later)

- **Aggregated stats across all printers.** Total hours / filament / prints across the workshop, not per-printer. Charts and trends.

- **Material-aware aggregations.** "How much PLA did I use this month, vs PETG, vs ASA?"

- **Success rate metrics.** Per printer, per material, per file. Includes failure analysis.

- **Print queue across printers.** Drop a file in, route it to whichever printer is free or matches the criteria (material, size, etc).

- **Cross-printer object exclusion.** Exclude an object name on all currently-running prints with that object (useful when you realise the STL was wrong).

- **Re-print buttons.** "Print this file again on this printer / different printer." Requires file management.

- **Push notifications.** Browser notifications when prints complete, fail, or need intervention. ntfy / Pushover integration for off-network alerts.

- **Webhooks / external integrations.** Slack, Discord, Home Assistant, etc.

- **Per-day timeline view** in addition to the year heatmap. Hour-by-hour breakdown of what was running on which printer.

- **Telemetry graphs over time.** Temperature charts, layer time trends. Mainsail does this; only worth building if there's a specific cross-printer angle that Mainsail can't cover.

## Slicer / file management territory (deliberately not in scope)

The original "universal printer management platform" vision included slicer integration. This was explicitly scoped out, but listed here for completeness in case the vision evolves:

- **STL/3MF upload to Flightdeck**
- **Slicer profile management** per printer + filament combination
- **Trigger slicer via CLI** (OrcaSlicer, PrusaSlicer)
- **Print routing logic** — "send this to the X1C, or whichever Bambu is free"
- **File library browser**

Building any of these meaningfully commits to a larger product scope. Don't drift into this territory without an explicit decision.

## Operational / deployment

- **systemd service for Flightdeck.** Not really a feature; an infrastructure must-have. Should happen before Tier 2 ships, separately.
- **Tailscale for remote access.** Same — infrastructure, not a feature. Independent of Tier 2.
- **Health-check endpoint** at `/health` for external monitoring.
- **Backup of SQLite DB** — periodic snapshot of `flightdeck.db` to a separate location. Print history is now valuable data.
- **Config validation on startup.** If `printers.yaml` has a typo, fail loudly with a clear message rather than half-starting.

## UI ideas that came up but were deferred

- **Visual object exclusion via camera tap.** Tap a part on the live camera feed → "Exclude this part?" Mapping screen coordinates to world coordinates is hard; the object list version is simpler and lands the same capability. Reconsider as Tier 2.5 if the list version proves clunky in practice.

- **Calendar picker** for jumping to a specific date in history. The year heatmap already provides this — clicking a cell is the picker. Don't add redundant navigation.

- **Audio on the camera feeds.** Not useful (cameras have poor audio, would alarm unnecessarily).

- **Print preview thumbnails on heatmap cell hover.** Too many preloads for too little value. Click-to-reveal is fine.

- **Filtering history by material or success/fail.** Adds complexity without clear v1 value. Reconsider when there's enough data to make filtering useful.

- **Multiple zoom levels on the history heatmap** (year / month / week). Year view + day detail panel is sufficient. Resist over-engineering.
