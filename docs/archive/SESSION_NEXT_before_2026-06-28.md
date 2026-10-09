# SESSION_NEXT archive (before 2026-06-28)

Archived from active SESSION_NEXT.md on 2026-07-26. Keep for archaeology; do not treat as current.

---

## What was changed - Session 28.257 (Bambu skip-object map mirror - 8 June)
- Bambu object maps now send `map_mirror_x=true` for the top-down skip-object view.
- The frontend mirrors object overlay coordinates and SVG footprint outlines from that flag, so the red hit regions and white object shapes move together visually.
- Raw Bambu object IDs are unchanged; skip commands still send the original printer/MQTT object IDs.
- Static cache bumped to `app.js?v=384` and `style.css?v=313`; backend restart and frontend refresh required.

## What was changed - Session 28.258 (Bambu skip-object top-right orientation - 8 June)
- Switched the Bambu top-down skip-object map from X mirror to Y mirror: `map_mirror_x=false`, `map_mirror_y=true`.
- This orientation puts the skipped X1C object `#96` in the top-right corner while keeping the same object outlines and raw skip IDs.
- Backend restart required; static cache remains `app.js?v=384` and `style.css?v=313`.

## What was changed - Session 28.259 (Bambu skip-object left rotation - 8 June)
- Added `map_coordinate_rotation=-90` for Bambu top-down object maps.
- Frontend map rendering now applies mirror/rotation transforms to the actual object coordinates and SVG footprint points, so the red regions and white outlines rotate together as one layout.
- Coordinate check against live X1C data puts skipped `#96` at `left=0.00%, top=0.00%`, matching the previous `#115` corner.
- Static cache bumped to `app.js?v=385` and `style.css?v=314`; backend restart and frontend refresh required.

## What was changed - Session 28.260 (Bambu skip-object front marker - 8 June)
- Added a small `Front` marker at the right-hand centre of Bambu top-down skip-object maps.
- The marker is visual only, rendered above the map with `pointer-events: none`, and does not affect object regions, outlines, or skip commands.
- Static cache bumped to `app.js?v=386` and `style.css?v=315`; frontend refresh required.

## What was changed - Session 28.261 (Bambu vertical front marker - 8 June)
- Changed the Bambu top-down skip-object `Front` marker to vertical text on the far right-hand side.
- Static cache bumped to `style.css?v=316`; frontend refresh required.

## What was changed - Session 28.262 (Bambu front marker outside map - 8 June)
- Moved the vertical Bambu top-down skip-object `Front` marker just outside the map area on the far right.
- Static cache bumped to `style.css?v=317`; frontend refresh required.

## What was changed - Session 28.263 (Bambuddy-style skip-object map - 8 June)
- Reworked the Bambu skip-object map presentation to match Bambuddy's simpler operator workflow.
- The visible map now uses compact red object markers with blue ID dots and an active count, while the raw G-code extrusion path is no longer shown as the main visual shape.
- Added a compact object ID/name list below the map; map regions and list rows still send the original Bambu skip IDs.
- Static cache bumped to `app.js?v=387` and `style.css?v=318`; frontend refresh required.

## What was fixed - Session 28.264 (Bambu skip-object plate bounds - 8 June)
- Fixed the skip-object map looking exploded compared with the print-detail preview.
- The parser now preserves 3MF plate/preview bounds when they exist and only falls back to tight G-code object bounds when no plate bounds are available.
- Clarified the Bambu object detail text: skip state comes from MQTT, object positions come from 3MF metadata.
- Static cache bumped to `app.js?v=388`; backend restart and frontend refresh required.

## What was changed - Session 28.265 (Bambuddy plate preview for skip objects - 8 June)
- Replaced the visible Bambu top-down skip-object grid/exploded marker presentation with a Bambuddy-style plate preview: the active 3MF thumbnail is now shown under compact red object pins with blue ID badges.
- The transparent clickable red-box/hit regions are still generated from the preserved 3MF plate bounds and still send the raw Bambu object IDs; the ID/name list remains available below the map.
- The map badge now reports mapped pins when the skip list has objects without plate bboxes, so list-only IDs do not make the plate count look wrong.
- List-only Bambu IDs without bed bboxes no longer render as loose buttons on top of the plate preview; they remain available in the ID/name list.
- Removed the previous `transform: rotate(25deg)` thumbnail-slice visual trial from `.obj-map-image-piece`.
- Static cache bumped to `app.js?v=391` and `style.css?v=321`; frontend refresh required.

## What was changed - Session 28.266 (Camera stale stream cleanup - 8 June)
- Strengthened `/api/camera/*` stream headers to `no-store, no-cache, must-revalidate, max-age=0` with `Pragma`, `Expires`, and `X-Accel-Buffering: no`.
- Added a frontend stale-connection refresh for visible camera images: each visible stream gets a fresh timestamped URL after 2 minutes, and all visible streams refresh when the browser tab becomes visible again.
- This targets browser/MJPEG stale connections without changing the configured camera frame rates: Bambu remains 5 fps via ffmpeg; Voron/Greyhound remains pass-through from Crowsnest.
- Static cache bumped to `app.js?v=392`; backend restart and frontend refresh required.

## What was fixed - Session 28.267 (Bambu skip-object ID pin mapping - 8 June)
- Fixed Bambu skip-object IDs being attached to the wrong visual footprint on plates where G-code object-label IDs do not match the `slice_info.config` object order.
- The backend now matches each `slice_info.config` skip ID/name to the center of the same object name in `Metadata/plate_N.json`, following Bambuddy's source-of-truth approach.
- The frontend now prefers those plate JSON `x/y` centers for Bambu top-down pin and click-target placement, falling back to bboxes only when no point exists.
- Verified against the active Can Opener H2D plate: `701` now maps to the upper-left hook area instead of the lower-left footprint.
- Static cache bumped to `app.js?v=393`; backend restart and frontend refresh required.

## What was fixed - Session 28.268 (Bambu skip-object top image - 8 June)
- Bambu 3MF parsing now keeps `Metadata/top_N.png` alongside the normal plate preview.
- `/api/printers/{id}/thumbnail?view=top` serves that top-down image for Bambu printers when available, falling back to the normal thumbnail behavior otherwise.
- The skip-object map now uses the top-down image URL for top-down object maps, while Print Details and other thumbnail uses remain on the regular angled `plate_N.png` preview.
- Static cache bumped to `app.js?v=394`; backend restart and frontend refresh required.

## What was changed - Session 28.269 (Flightdeck shortcut icon - 8 June)
- Added explicit `shortcut icon` and PNG favicon fallback links to the live app and demo HTML heads.
- Added `docs/assets/flightdeck-icon-192.png` and linked it from the GitHub Pages `docs/index.html` page so the GitHub-hosted project page has the Flightdeck shortcut icon fallback as well as the SVG icon.
- No backend restart required; frontend/page refresh enough.

## What was changed - Session 28.270 (Windows installer icon - 8 June)
- Added packaged `app/static/flightdeck.ico` generated from the existing Flightdeck app icon.
- Windows install and desktop shortcut scripts now use the `.ico` for Desktop/Startup shortcut icons, with the existing PNG as fallback.
- README/INSTALL now describe the Windows shortcuts as Flightdeck-branded.
- No backend restart required.

## What was added - Session 28.271 (Klipper XYZ jog controls - 8 June)
- Added `/api/printers/{id}/jog` for Klipper/Moonraker printers with bounded X/Y/Z relative motion.
- Live Ops now shows a compact XYZ jog pad: X/Y use 10mm steps, Z uses 1mm steps, and the centre button homes XY.
- Existing `/jog-z` remains available for compatibility.
- Bambu pages show the jog pad as unavailable and still expose Home All separately; no Bambu axis jog is enabled until the MQTT/control path is proven safe.
- Static cache bumped to `app.js?v=395` and `style.css?v=322`; backend restart and frontend refresh required.

## What was fixed - Session 28.272 (Bambu XYZ jog controls - 8 June)
- Enabled the same bounded XYZ jog endpoint for Bambu printers using the Bambu package's validated `Printer.gcode()` / MQTT `gcode_line` path.
- Bambu Live Ops jog buttons now enable when the printer is in a safe idle state; printing, paused, error, finished, offline, and estop states still disable jog.
- Static cache bumped to `app.js?v=396`; backend restart and frontend refresh required.

## What was fixed - Session 28.273 (Paused printer jog enablement - 8 June)
- Live Ops jog controls now remain enabled for paused printers so recovery/clearance moves are possible.
- Jog is still disabled during active printing, finished, offline, error, and estop states.
- Static cache bumped to `app.js?v=397`; frontend refresh required.

## What was added - Session 28.274 (Windows install with data archive - 8 June)
- Added `-DataArchive` support to `scripts/windows/bootstrap-install.ps1` and `scripts/windows/install-windows.ps1`.
- `Install-Flightdeck-Windows.cmd` now passes command-line arguments through to the bootstrap, so a data archive path can be supplied from the root installer too.
- The Windows install restores the normal Pi backup archive layout into `%LOCALAPPDATA%\Flightdeck` and creates a `restore-safety-*` copy first when existing Windows data is present.
- README/INSTALL now document making a Pi backup with `INCLUDE_PRINT_LIBRARY=1` and passing it to the Windows installer.
- Created current all-data Pi archive for Windows install: `/home/flightdeck/windows-install-backups/flightdeck-backup-20260608-182118.tar.gz`; SHA256 `5ff17fa0819f54d4d4588253e7ea4a254a067e0a66336c7fe584df001d240c49`.
- No backend restart required for installer-only changes.

## What was added - Session 28.275 (Windows uninstall helper - 8 June)
- Added root `Uninstall-Flightdeck-Windows.cmd`.
- Hardened `scripts/windows/uninstall-windows.ps1` to stop Flightdeck tray/backend processes for the checkout and remove both Desktop and Startup shortcuts.
- Windows uninstall keeps `%LOCALAPPDATA%\Flightdeck` by default; pass `-RemoveData` to delete restored data/history/uploads/print vault, and `-RemoveVenv` to remove the repo virtual environment.
- README/INSTALL now document uninstall commands.
- No backend restart required for installer-only changes.

## What was fixed - Session 28.241 (AMS HT slot canonicalization - 7 June)
- Regular AMS slots continue to use `unit*4 + slot` indexes.
- AMS HT slots now consistently use Bambu global tray ids (`128 + slot`) across live parsing, snapshots, backend reconciliation, frontend labels, slot editor, and spool assignment UI.
- Legacy `512` slot ids are still accepted when syncing to Bambu and when reading recent slot memory during transition; existing Pi `h2d:512` spool rows are normalized to `h2d:128`.
- Bumped static cache to `app.js?v=366`; backend restart and frontend refresh required.

## What was fixed - Session 28.242 (Bambu skip-object map fallback - 7 June)
- H2D/Bambu skip-object metadata can expose MQTT skip IDs in `slice_info.config` while the plate layout JSON uses different internal object IDs.
- The 3MF parser now still uses exact ID matches when available, but falls back to matching object-layout boxes by basename and occurrence order.
- Verified against BigBoy's active `Filament Keeper v1_ASA_3h12m` 3MF: object IDs `148`, `463`, `417`, and `439` now include bed bounding boxes for the clickable skip-object map.
- Backend restart required.

## What was fixed - Session 28.243 (Bambu skip-object map Y axis - 7 June)
- Bambu plate layout boxes are now flipped vertically into the thumbnail/screen orientation before Flightdeck renders the skip-object map.
- This keeps the left/right positions unchanged while moving the front/bottom parts to the bottom of Flightdeck's map.
- Verified against BigBoy's current job: small front `Spool Holder v3.step` object `#417` now maps near the bottom/front instead of the top.
- Backend restart required.

## What was changed - Session 28.244 (Bambu skip-object map display rotation - 7 June)
- Bambu object maps now send `map_rotation=90`, and the frontend rotates the thumbnail plus hit regions clockwise as a display transform.
- ID labels are counter-rotated so they remain readable.
- Static cache bumped to `app.js?v=367` and `style.css?v=296`; backend restart and frontend refresh required.

## What was changed - Session 28.245 (Bambu skip-object 45-degree preview - 7 June)
- Bambu object maps now send `map_rotation=45` for a user-requested visual check between the unrotated/flipped map and the full 90-degree clockwise screen orientation.
- Frontend object maps now use CSS rotation variables, so the thumbnail/hit regions and counter-rotated labels can support non-90-degree rotations.
- Static cache bumped to `app.js?v=368` and `style.css?v=297`; backend restart and frontend refresh required.

## What was reverted - Session 28.246 (Bambu skip-object image-only rotation - 7 June)
- Reverted the separate background-image rotation layer.
- The image-only trial kept red boxes at 45 degrees and rotated the thumbnail to 90 degrees underneath, but visually made the map worse.
- Current live target is back to the shared 45-degree thumbnail/box rotation from Session 28.245.
- Static cache remains `app.js?v=368` and `style.css?v=297`; backend restart and frontend refresh required.

## What was restored - Session 28.247 (Bambu skip-object overlay target - 7 June)
- Restored the user-approved shared 45-degree thumbnail/box rotation after the separate image-layer approach moved the red overlay away from the desired screenshot target.
- The red overlay target is `#148/#463` on the left, `#417` bottom-left, and `#439` on the right.
- Static cache bumped to `app.js?v=370` and `style.css?v=299`; backend restart and frontend refresh required.

## What was locked - Session 28.248 (Bambu skip-object red overlay position - 7 June)
- The red object overlay is now locked unrotated/axis-aligned to match the user's second reference image.
- H2D/Bambu maps now report `map_rotation=0`; existing object coordinates from the parsed 3MF remain unchanged.
- Treat the red overlay as source of truth: `#148/#463` vertical on the left, `#417` bottom-left, `#439` across the right.
- Future visual alignment should not move/rotate these red boxes.
- Backend restart required.

## What was changed - Session 28.249 (Bambu skip-object thumbnail-only rotation - 7 June)
- Reintroduced separate thumbnail and overlay layers, with the red overlay locked unrotated and axis-aligned.
- H2D/Bambu maps now report `map_rotation=0` and `map_image_rotation=45`.
- The frontend applies `map_image_rotation` only to the thumbnail layer underneath the red boxes.
- The red boxes must remain untouched: only image rotation/scale/translation should change from here.
- Static cache bumped to `app.js?v=371` and `style.css?v=300`; backend restart and frontend refresh required.

## What was changed - Session 28.250 (Bambu skip-object thumbnail upward offset - 7 June)
- Added `map_image_offset_x` / `map_image_offset_y` support for Bambu object maps.
- Current H2D trial values: `map_rotation=0`, `map_image_rotation=45`, `map_image_offset_x=5`, `map_image_offset_y=-92`.
- This moves only the thumbnail layer upward so the star shape moves toward the centre of the locked `#439` red overlay.
- Red boxes remain locked and must not be moved.
- Static cache bumped to `app.js?v=372` and `style.css?v=301`; backend restart and frontend refresh required.

## What was reverted - Session 28.251 (Bambu skip-object plate underlay - 8 June)
- Reverted the Bambu/H2D-style plate underlay because it made the object map worse.
- Current live target is back to the previous best state: locked red overlay, thumbnail `45deg`, `map_image_offset_x=5`, `map_image_offset_y=-92`.
- Static cache bumped to `app.js?v=374` and `style.css?v=303`; frontend refresh required.

## What was changed - Session 28.252 (Bambu skip-object offset reset - 8 June)
- Reset H2D thumbnail offsets to `map_image_offset_x=0`, `map_image_offset_y=0`.
- Current trial values: `map_rotation=0`, `map_image_rotation=45`, no image offset.
- This removes image translation so rotation can be judged without making the thumbnail appear to float off the bed.
- Backend restart required.

## What was added - Session 28.253 (Bambu skip-object per-object thumbnail slices - 8 June)
- Added `map_image_mode=per_object` for Bambu skip maps.
- The frontend now slices the plate thumbnail using each object's bbox and renders each slice inside that object's locked red overlay box.
- This treats each red box as the object's home instead of moving the entire bed thumbnail as a single layer.
- Current H2D values: `map_rotation=0`, `map_image_rotation=0`, offsets `0,0`, `map_image_mode=per_object`.
- Static cache bumped to `app.js?v=375` and `style.css?v=304`; backend restart and frontend refresh required.

## What was changed - Session 28.254 (Bambu skip-object slice rotation trial - 8 June)
- Added `transform: rotate(10deg)` to `.obj-map-image-piece`.
- This rotates each white thumbnail slice independently inside its locked red box.
- Red overlay boxes remain untouched.
- Static cache bumped to `style.css?v=305`; frontend refresh required.

## What was fixed - Session 28.240 (Generic AMS auto-claim guard - 7 June)
- Generic Bambu AMS reports now only auto-claim the exact recent spool remembered for that slot.
- If the remembered spool is unavailable, Flightdeck no longer grabs another matching generic colour/material spool from storage.
- This prevents BigBoy/AMS HT generic ABS black reports from stealing a different black ABS spool after the original remembered spool was moved elsewhere.
- Backend restart required.

## What was fixed - Session 28.239 (Bambu operator cancel stats - 7 June)
- Bambu printer-side/operator Stop now maps code-free `FAILED` reports to `CANCELLED`.
- Alarm-coded Bambu failures still record as `ERROR`, so real failures such as AMS mapping errors remain visible.
- Existing H2D generic `Print failed` rows from this session were corrected on the Pi from `ERROR` to `CANCELLED`.
- Backend restart required.

## What was fixed - Session 28.238 (Print Watch focus flash - 7 June)
- Print Watch no longer rebuilds the focused camera image when the selected printer/camera is unchanged.
- The focus header, pin state, status chip, HUD copy, progress bar, and temperature chips still refresh in place.
- Bumped static cache to `app.js?v=365`; frontend refresh required.

## What was fixed - Session 28.237 (No-stats printer health - 7 June)
- Printer health now follows Print Memory's trusted-stats rule: prints with `exclude_from_stats` set are ignored for 14d health totals, early-failure counts, cancelled counts, and success-rate warnings.
- This fixes H2D staying in attention because Flightdeck testing/no-stats failures were still counted as `4 failed prints in 14d`.
- Backend restart required.

## What was fixed - Session 28.236 (Fleet Wall AMS demo polish - 7 June)
- Fleet Wall AMS visuals now use mode-specific sizing variables and wrap within the card instead of forcing a clipped horizontal AMS strip.
- Feed indicators are no longer hidden by the Fleet Wall AMS wrapper's vertical clipping.
- Standalone `/demo` now includes the missing Fleet Wall view container, so the demo Fleet Wall nav item renders instead of hitting a null view.
- Fleet Wall camera feed clicks now open Live as `#/printer/{id}?from=fleet`; fullscreen camera close uses that origin marker to return to Fleet Wall, while direct Live-page fullscreen still shrinks back to Live.
- Fleet Wall now renders immediately and hydrates camera feeds as their URLs resolve, avoiding one slow camera lookup blocking the whole wall.
- `Cameras` has been renamed to `Print Watch` in navigation and command search while keeping `#/cameras` compatible.
- Print Watch has a large rotating focus camera, pins to the first printer needing attention, and resumes cycling once attention clears.
- Print Watch no longer auto-pins just because a printer is intentionally on hold; the `Pinned` chip is now a manual pin/unpin control, and unpinning an auto-pinned feed pauses auto-pin until attention clears.
- Camera URL fetches are shared across Fleet Wall/Print Watch and camera retry handlers are attached once per image.
- Demo shell now loads current `app.js?v=366`; main and demo shells load `style.css?v=295`.
- Static-only change; frontend refresh required.


# Flightdeck — next session brief
_Last updated 7 June 2026 (Session 28.235 Bambu FTP error hints)_

## What was improved - Session 28.235 (Bambu FTP error hints - 7 June)
- Bambu FTPS upload failures now raise operator-facing messages instead of raw FTP codes.
- The `426 partial file` case now points operators at USB/SD storage being missing, unformatted, full, or otherwise rejected by the printer.
- Backend restart required.

## What was added - Session 28.234 (Slicer connection diagnostics - 7 June)
- Added `POST /api/slicer/check` so Flightdeck can test Browser Orca, Slicer API, and Worker URLs from the host running Flightdeck.
- Settings -> Slicer now has `Test Browser Orca`, `Test API`, and `Test Worker` buttons with inline reachability feedback.
- Demo mode now stubs the slicer check endpoint.
- Bumped static cache to `app.js?v=339` and `style.css?v=277`; backend restart required.

## What was improved - Session 28.233 (Setup backup check - 7 June)
- Setup Health now has an explicit optional `Backup tools` check for the backup/restore scripts.
- Print Vault readiness and Backup readiness are no longer conflated in the first-run summary.
- Backend restart required.

## What was improved - Session 28.232 (Printer config startup guard - 7 June)
- Flightdeck now starts with an empty fleet if `printers.yaml` is missing or empty, which helps fresh Windows/Pi installs reach the Add Printer screen.
- Duplicate printer IDs in `printers.yaml` now fail validation with a clear `Duplicate printer id` message instead of producing confusing runtime behavior.
- Backend restart required.

## What was added - Session 28.231 (Health endpoint alias - 7 June)
- Added conventional `/health` alongside the existing `/healthz` endpoint.
- Health response now includes the Flightdeck version plus websocket/broadcast status for simple external monitors.
- Backend restart required.

## What was hardened - Session 28.230 (Upload size guardrails - 7 June)
- Added shared backend size/read helpers for files entering Flightdeck.
- Print Vault uploads, Queue uploads, Orca relay uploads, Slicer worker source files, custom slicer profile uploads, and sliced outputs now return clear `413` errors when too large instead of failing later in odd ways.
- Print/model file limit defaults to 2048 MB and can be changed with `FLIGHTDECK_MAX_PRINT_FILE_MB`.
- Custom slicer profile import limit defaults to 64 MB and can be changed with `FLIGHTDECK_MAX_PROFILE_UPLOAD_MB`.
- Backend restart required.

## What was hardened - Session 28.229 (File path safety hardening - 7 June)
- Added shared backend helpers for safe basename normalization and safe path joins under trusted directories.
- Routed Print Vault reads/writes, library upload/copy destinations, slicer output checks, slicer output writes, queue upload staging, and relay filenames through the shared helpers.
- Normal filenames still work, but path-like or unsafe filenames are flattened/sanitized instead of being treated as filesystem paths.
- Backend restart required.

## What was fixed - Session 28.228 (AMS RHS rail padding - 7 June)
- Nudged AMS dryer/status side-rail content to align visually within the dark RHS panel.
- Bumped static cache to `style.css?v=276`; frontend refresh required.

## What was fixed - Session 28.227 (AMS HT scale correction - 7 June)
- Reduced AMS HT reel bay to match normal AMS slot visual scale more closely.
- Gave the AMS HT RHS rail more width so its status text sits further right.
- Bumped static cache to `style.css?v=275`; frontend refresh required.

## What was fixed - Session 28.226 (AMS side rail header anchor - 7 June)
- AMS side rail now aligns from the top label (`4 slot loadout` / `High-temp bay`) instead of centering the entire control stack.
- Drying state/time/stop controls remain centered under the side-rail label.
- Bumped static cache to `style.css?v=274`; frontend refresh required.

## What was fixed - Session 28.225 (AMS side rail centering - 7 June)
- Centered AMS dryer/status side-rail contents horizontally and vertically in the RHS column.
- Bumped static cache to `style.css?v=273`; frontend refresh required.

## What was changed - Session 28.224 (AMS dryer side rails - 7 June)
- Reworked AMS live loadout cards into a left visual area and a right dryer/status rail.
- AMS 1 is wider so the four spool slots keep their spacing while dryer controls sit to the RHS.
- AMS HT uses the same side-rail pattern, keeping the reel visual separate from dryer information.
- Removed dryer status/time from the cramped title metadata line.
- Bumped static cache to `app.js?v=338` and `style.css?v=272`; frontend refresh required.

## What was fixed - Session 28.223 (AMS dry countdown chip - 7 June)
- Removed the drying countdown from the AMS metadata sentence so it no longer truncates words.
- Added the remaining drying time as a compact chip beside the Dry/Stop control.
- Bumped static cache to `app.js?v=337` and `style.css?v=271`; frontend refresh required.

## What was fixed - Session 28.222 (AMS header wrap fix - 7 June)
- AMS loadout metadata now stays on one clipped line instead of wrapping a final word onto its own row.
- Header text area now owns remaining width while the action buttons keep their fixed space.
- Bumped static cache to `style.css?v=270`; frontend refresh required.

## What was fixed - Session 28.221 (AMS slot centering - 7 June)
- Centered normal AMS slot groups inside their loadout bay.
- Kept AMS HT’s single spool bay left-aligned inside its side-rail layout.
- Bumped static cache to `style.css?v=269`; frontend refresh required.

## What was improved - Session 28.220 (AMS loadout alignment - 7 June)
- Normal AMS headers now reserve a consistent header band so their slot row starts cleanly.
- AMS HT spool bay is offset by the same header band, aligning the HT reel with AMS 1 slot visuals.
- AMS 1 header text/actions now align from the top instead of drifting around the center line.
- Bumped static cache to `style.css?v=268`; frontend refresh required.

## What was improved - Session 28.219 (AMS HT side rail layout - 7 June)
- AMS HT live loadout now moves bay/status/dry information into a side rail beside the spool.
- AMS HT spool visual keeps the same slot size language as normal AMS slots instead of being squeezed by stacked text.
- Normal multi-slot AMS layout remains unchanged.
- Bumped static cache to `app.js?v=336` and `style.css?v=267`; frontend refresh required.

## What was changed - Session 28.218 (Object panel list removal - 7 June)
- Removed the duplicate long object row list from the live Objects panel.
- The panel now keeps the thumbnail/map plus compact ID selector, with the enlarged selector handling detailed selection.
- Removed stale object-list CSS from the frontend.
- Bumped static cache to `app.js?v=335` and `style.css?v=266`; frontend refresh required.

## What was added - Session 28.217 (Enlarged object selector - 7 June)
- Clicking the object thumbnail now opens a larger skip-object selector modal.
- Jobs with real object geometry can be selected from the enlarged bed map.
- Jobs without object geometry show a larger preview plus a clear printer-object-ID selector, so operators can match the ID shown on the printer screen.
- Shared the same exclusion confirmation flow between the list, inline map, and enlarged selector.
- Bumped static cache to `app.js?v=334` and `style.css?v=265`; frontend refresh required.

## What was improved - Session 28.216 (Object ID selector honesty - 7 June)
- Object exclusion no longer draws approximate ID buttons over the thumbnail when the 3MF lacks object geometry.
- No-geometry Bambu jobs now show the thumbnail as a preview and a separate `Printer object IDs` selector.
- Helper text now states that there are no bed positions in the 3MF and the operator must match the ID shown on the printer screen.
- Bumped static cache to `app.js?v=333` and `style.css?v=264`; frontend refresh required.

## What was fixed - Session 28.215 (Object panel empty state - 7 June)
- Object exclusion panel now shows an explicit no-metadata note instead of going blank when a Bambu print has no usable object metadata.
- Object map thumbnails no longer get a timestamp cache-buster on every refresh, preventing live-panel flashing.
- Object panel refresh now only rewrites the DOM when the rendered content actually changes.
- Bumped static cache to `app.js?v=332` and `style.css?v=263`; frontend refresh required.

## What was improved - Session 28.214 (Object exclude map simplification - 7 June)
- Simplified the object exclusion map after the first readability pass became too busy.
- Approximate object map markers now show only the slicer/printer ID over the thumbnail; labels stay in the list below.
- Added map-specific button styling so the generic red Exclude button style does not bleed into plate markers.
- Bumped static cache to `app.js?v=331` and `style.css?v=262`; frontend refresh required.

## What was improved - Session 28.213 (Object exclude ID readability - 7 June)
- Object exclusion maps now keep the plate thumbnail clearer and put the slicer/printer object ID in a larger, brighter overlay.
- Approximate Bambu/Orca object selectors now show the object label under the large ID where available.
- Object list rows now show the ID as a visible pill instead of tiny muted metadata.
- The helper text explains that Bambu/Orca object IDs can be high and should be matched to the printer screen.
- Bumped static cache to `app.js?v=330` and `style.css?v=261`; frontend refresh required.

## What was improved - Session 28.212 (Exclude object map fallback - 7 June)
- Bambu/Klipper Objects panel now presents no-geometry object IDs as an approximate plate selector instead of a loose chip pile.
- Exact object geometry still wins when the active 3MF exposes object bounding boxes.
- The approximate selector is labelled honestly and reminds operators to match the object ID shown on the printer screen.
- Exclude confirmation now includes the object label/ID and warns that Flightdeck cannot un-skip the object mid-print.
- Bumped static cache to `app.js?v=329` and `style.css?v=260`; frontend refresh required.

## What was added - Session 28.211 (Stock-in edit and clear - 7 June)
- Pending incoming stock rolls can now be edited before they become real spool records.
- Pending incoming stock rolls can be cleared/cancelled with a reason for damaged stock, wrong details, or bad scans.
- Received incoming rolls are locked from stock-in edits; use the normal spool edit path after receipt.
- Stock In list rows and on-screen sheets now show `Edit`, `Clear`, and `Receive` actions for pending rolls.
- Cleared rows remain visible as cancelled with their reason, so the receiving sheet still explains what happened.
- Bumped static cache to `app.js?v=326` and `style.css?v=256`; backend restart required for new edit/clear endpoints.

## What was added - Session 28.210 (On-screen stock-in sheets - 7 June)
- Stock In orders now have separate `Open sheet` and `Print / PDF` actions.
- Creating a receiving sheet opens an in-app sheet viewer instead of immediately launching print.
- The sheet viewer shows QR rows with roll number, colour swatch/name, weight, shelf, pending/received state, and receive links.
- The sheet viewer has `Print / Save PDF`, which uses the browser print dialog so operators can print paper or save as PDF.
- Bumped static cache to `app.js?v=325` and `style.css?v=255`; frontend refresh required.

## What was added - Session 28.209 (Mixed stock-in receiving sheets - 7 June)
- Stock In receiving sheets now support multiple roll-type lines in one batch.
- Each line carries its own quantity, material, brand, subtype/type, colour name/hex, label weight, tare, shelf, and notes.
- Added quick colour chips to the Stock In line editor for common colours.
- Bumped static cache to `app.js?v=324` and `style.css?v=254`; frontend refresh required.

## What was added - Session 28.208 (Stock-in QR receiving - 7 June)
- Added a Spools -> `Stock In` view for incoming filament receiving.
- Operators can create a receiving sheet from supplier/order, quantity, material, brand, subtype/type, colour name/hex, label weight, tare, shelf, and notes.
- Flightdeck creates pending incoming-roll tokens and prints a receiving sheet with QR codes.
- Scanning a receiving QR opens the pending roll, then `Receive and number spool` creates the real spool record, assigns the next spool number, and optionally prints the permanent spool label.
- Added backend stock-in tables/endpoints plus QR PNG generation:
  - `GET/POST /api/stock-in/orders`
  - `GET /api/stock-in/rolls/{token}`
  - `GET /api/stock-in/rolls/{token}/qr.png`
  - `POST /api/stock-in/rolls/{token}/receive`
- Bumped static cache to `app.js?v=323` and `style.css?v=253`; backend restart required.

## What was fixed - Session 28.207 (Printer Print Bay scroll fix - 7 June)
- Corrected the per-printer Print Bay scroll container so `.printer-bay-body` scrolls directly inside the printer detail flex layout.
- Removed the nested shell scroll attempt that could still be clipped by the parent view.
- Bumped static cache to `style.css?v=252`; frontend refresh only.

## What was fixed - Session 28.206 (Printer Print Bay scroll - 7 June)
- Per-printer Print Bay pages now keep their content inside a scrollable bay shell, so tall BigBoy/H2D storage and vault lists do not push the page layout out of view.
- Printer-local and vault file lists are capped a little lower inside the bay to keep the printer sub-tabs/header usable.
- Bumped static cache to `style.css?v=251`; frontend refresh only.

## What was added - Session 28.205 (Bambu live controls - 7 June)
- Bambu live pages now report separate fan speeds for Part, Aux, and Chamber fans.
- Added Bambu Part/Aux/Chamber fan controls with Off/50/100 buttons and fine sliders.
- Added guarded Bambu `Home All` on the live page using the existing confirmation prompt.
- The shared fan endpoint now accepts a `channel` (`part`, `aux`, or `chamber`) and routes commands to Moonraker or Bambu as appropriate.
- Bumped static cache to `app.js?v=322` and `style.css?v=250`; backend restart required.

## What was added - Session 28.204 (Klipper live control polish - 7 June)
- Added a fine fan slider beside the Moonraker/Klipper fan quick buttons; the command is sent when the slider change is committed.
- Added guarded homing buttons on Moonraker/Klipper live pages: `XY`, `Z`, and `All`.
- Homing opens a confirmation prompt and is disabled during printing, paused, finished, offline, error, and estop states.
- Added `POST /api/printers/{printer_id}/home` for Moonraker homing commands.
- Bumped static cache to `app.js?v=321` and `style.css?v=249`; backend restart required.

## What was added - Session 28.203 (Klipper live controls - 7 June)
- Added Moonraker/Klipper live fan controls on the printer live page: Off, 50%, and 100%.
- Added small Bed/Z jog controls on Moonraker/Klipper live pages: `Z -1` and `Z +1`.
- Live Moonraker status now includes reported part-cooling fan speed and toolhead position so the controls show current fan/Z context.
- Fan commands are blocked for offline/error/estop states; Z jog is additionally disabled during printing, paused, finished, error, estop, and offline states.
- Backend endpoints added: `POST /api/printers/{printer_id}/fan` and `POST /api/printers/{printer_id}/jog-z`.
- Bumped static cache to `app.js?v=320` and `style.css?v=248`; backend restart required.

## What was added - Session 28.199 (Windows bootstrap installer - 6 June)
- Added `Install-Flightdeck-Windows.cmd` at the repo root as the double-click Windows installer entry point.
- Added `scripts/windows/bootstrap-install.ps1` to unblock downloaded files, check Python/Git, install missing dependencies through `winget` when available, run the real installer, and start the tray app.
- Updated `install-windows.ps1` so the bootstrap can pass a discovered Python command such as `py -3`.
- Updated README and INSTALL with the double-click Windows install flow.

## What was added - Session 28.198 (Live AMS visual loadout - 6 June)
- Real Bambu live pages now use the graphical AMS loadout deck from the demo instead of the compact AMS pill rows.
- AMS slot editing still works by clicking a visual slot card.
- AMS drying controls were preserved inside the new visual AMS header.
- Bumped static cache to `app.js?v=301` and `style.css?v=237`; frontend refresh required.

## What was added - Session 28.197 (Colour name aliases - 6 June)
- Colour name entry now includes browser autocomplete suggestions for common colour names.
- Typing short aliases like `mag`, `blu`, `gre`, `sil`, or `rainbow` applies the matching colour name and swatch.
- Magenta maps to the existing pink/magenta swatch so Bambu-style `Magenta` labels can be corrected quickly when OCR misses the tiny colour text.
- Bumped static cache to `app.js?v=300` and `style.css?v=236`; frontend refresh required.

## What was added - Session 28.196 (Spool scan label swatch colour - 6 June)
- Spool OCR now falls back to photo colour detection when label text finds material/subtype but misses the colour name.
- The detector looks for a saturated swatch near white label pixels, aimed at Bambu-style coloured label dots.
- Colour detection only runs when OCR has not already applied a colour, keeping operator-entered colour choices intact.
- Bumped static cache to `app.js?v=299` and `style.css?v=235`; frontend refresh required.

## What was fixed - Session 28.195 (Spool OCR conservative apply - 6 June)
- OCR no longer creates or selects an `Unknown` brand when the label text is noisy.
- The scan result message now shows only the fields Flightdeck actually applied instead of raw OCR gibberish.
- Material-only OCR keeps the brand blank for operator confirmation unless the label confidently names a brand.
- Bumped static cache to `app.js?v=298` and `style.css?v=234`; frontend refresh required.

## What was added - Session 28.194 (Spool scan OCR stage 2 - 6 June)
- Spool scan now has a `Read label` step using browser-side OCR loaded on demand.
- OCR text is parsed into editable spool suggestions for common brand, material, subtype, and colour names.
- Camera/photo scans now attempt barcode first, then fall back to OCR when no barcode is detected.
- On phone-width layouts, the scan panel starts collapsed with an `Open` button so the Add Spool form stays usable.
- Bumped static cache to `app.js?v=297` and `style.css?v=233`; frontend refresh required.

## What was added - Session 28.193 (Spool scan stage 1 - 6 June)
- Add Spool now has a `Spool scan` panel inside the filament catalogue area.
- Stage 1 supports browser camera capture plus a photo-upload fallback for filament labels/boxes.
- Chromium barcode detection is used when available; detected barcodes populate the catalogue search and keep the final spool form editable before saving.
- Camera streams are stopped when the spool modal closes or saves, so the browser does not leave the camera session running.
- Bumped static cache to `app.js?v=296` and `style.css?v=232`; frontend refresh required.

## What was added - Session 28.192 (Dashboard add-printer CTA - 6 June)
- Dashboard now shows a first-run `Add Printer` panel when there are no configured printers.
- Dashboard printer cards now end with a dashed `+ Add Printer` card that links straight to Settings -> Printers.
- The add-printer card reminds operators to edit existing printers when only an IP changes, preserving printer history and metrics.
- Bumped static cache to `app.js?v=295` and `style.css?v=230`; frontend refresh required.

## What was added - Session 28.191 (Printer edit in settings - 6 June)
- Added a Settings -> Printers `Edit` action so connection details can change without changing the printer ID.
- Editing locks the printer ID field to preserve print history, metrics, maintenance, spool links, and queue identity.
- Added `PUT /api/config/printers/{printer_id}` to update runtime printer connections and persist the edited config.
- Bumped static cache to `app.js?v=294` and `style.css?v=229`; backend restart required for the edit endpoint.

## What was added - Session 28.190 (Windows tray install - 6 June)
- Added a per-user Windows install path with `scripts/windows/install-windows.ps1`.
- Added `scripts/windows/flightdeck-tray.py`, a `pythonw.exe` tray launcher that starts Uvicorn hidden, shows Flightdeck in the notification area, and provides Open Dashboard, Restart, Open Logs, Stop, and Exit actions.
- Windows live data defaults to `%LOCALAPPDATA%\Flightdeck`, with uploads, print vault, and logs kept outside the git checkout.
- Added `requirements-windows.txt` for the tray dependency and `scripts/windows/uninstall-windows.ps1` for removing the Startup shortcut/data.
- Setup Health now treats `FLIGHTDECK_RUNTIME=windows` / `Windows tray` as a managed runtime instead of expecting systemd.
- Updated README and INSTALL with the Windows tray install flow.
- Fixed the Windows shortcut creation path so PowerShell passes a plain string working directory to the `.lnk` writer.

## What was fixed - Session 28.189 (OrcaSlicer launcher guard - 6 June)
- Settings -> Slicer no longer opens a guessed `:3011` URL when no Orca Docker URL has been configured.
- The Orca launcher now stays disabled with `Set URL first` until the NAS/PC sidecar is actually running and its URL is saved.
- Bumped static cache to `app.js?v=293` and `style.css?v=228`; frontend refresh required.

## What was added - Session 28.188 (OrcaSlicer Docker sidecar - 6 June)
- Added an OrcaSlicer sidecar service to `docker-compose.nas.yml` using `lscr.io/linuxserver/orcaslicer:latest`.
- The sidecar publishes Orca on host HTTPS port `3011`, persists config in `/volume2/flightdeck-orcaslicer`, and mounts the Flightdeck print vault at `/prints`.
- Added `.env.nas.example` for Orca web UI auth and UID/GID settings.
- Settings -> Slicer now includes an `OrcaSlicer Docker` launcher and configurable Docker URL.
- Bumped static cache to `app.js?v=292` and `style.css?v=227`; backend restart required for the new default setting.

## What was updated - Session 28.187 (Dashboard lockout visibility - 6 June)
- Dashboard now treats printers with `Print enabled` unticked as attention items instead of ordinary idle printers.
- Printer cards show an amber `Dispatch locked` strip with the saved downtime reason, so H2D-style lockouts are visible from the fleet overview.
- Flight Briefing, Needs Attention, the top status warning, and Flight Tower all use the saved lockout note when explaining why the printer is down.
- Flight Tower dispatch scoring blocks locked printers from being recommended until the operator ticks `Print enabled` again.
- Bumped static cache to `app.js?v=291` and `style.css?v=226`; frontend refresh required.

## What was added - Session 28.186 (Bambu object map - 6 June)
- Bambu 3MF parsing now tries to pull object bounding boxes from `Metadata/plate_N.json` alongside the object IDs/names from `slice_info.config`.
- The live Objects panel now includes a Bambu-style plate map: tap an object overlay when geometry is available, or use large object-ID chips when the 3MF does not expose positions.
- The map uses the active plate thumbnail as visual context and keeps the same guarded exclude confirmation flow.
- Bumped static cache to `app.js?v=290` and `style.css?v=225`; backend restart required.

## What was updated - Session 28.185 (Unified object exclusion - 6 June)
- Bambu object skipping now presents like the Klipper exclude-object flow: one live Objects panel, object status, and a clear Exclude action per object.
- Backend object metadata now identifies whether the printer uses Klipper `EXCLUDE_OBJECT` or Bambu `skip_objects`, while the UI keeps the operator experience consistent.
- Object exclusions are logged for both Klipper and Bambu, and failed commands now show a useful toast instead of silently doing nothing.
- Bumped static cache to `app.js?v=289` and `style.css?v=224`; backend restart required.

## What was added - Session 28.184 (Simulated camera feeds - 6 June)
- Simulated printers now expose a generated camera endpoint through the normal printer camera API.
- The synthetic feed renders an animated printer scene with state, job name, progress, temperatures, material, and a belt-bed treatment for the IdeaFormer IR3 V2 simulator.
- No extra camera workers or image libraries are required; the feed is a lightweight SVG served from Flightdeck.

## What was added - Session 28.183 (Printer lockout reasons - 6 June)
- Unticking a printer's `Print enabled` checkbox now opens a reason note prompt.
- Disabled printers stay visible, but Queue/relay dispatch blocks include the saved reason so operators know why the printer is out of service.
- Live printer headers show an amber `Dispatch locked` note while the printer is disabled; ticking the printer back on clears the active lockout note.
- Bumped static cache to `app.js?v=288` and `style.css?v=223`; backend restart required for the new note field.

## What was fixed - Session 28.181 (Multi-colour spool deduction fix - 5 June)
- Fixed the Bambu multi-colour spool deduction path so it builds the persisted AMS slot snapshot before matching slicer colour/material usage to loaded spools.
- Root cause for the finished H2D Macaw print not deducting filament: Flightdeck had captured the correct print-start slots (#48 red, #76 green, #61 blue), but the multi-colour attribution branch referenced `slot_snapshot` before it existed and exited before writing `spool_usage`.
- Repaired H2D print #121 from scale readings: #48 red 348g -> 220g, #76 green 378g -> 304g, and #61 blue corrected upward from 38g -> 64g because its captured start value was bad tare/inventory data.
- Marked 85.31g as unallocated against the slicer total rather than charging it to the wrong roll; likely purge/waste, scale variance, or prior inventory drift.
- Corrected known bad tares after repair: Bambu Lab #61 from 230g -> 256g, eSun #76 from 140g -> 224g. Inkstation #48 remains at 128g until a trusted tare is provided.
- Improved Add/Edit Spool save failures so slot conflicts and server errors show a useful message instead of changing the submit button to plain `Error`.
- Fixed new spool creation after the multi-colour fields changed the spool insert shape: the insert listed 16 columns but still had only 15 placeholders, causing Add Spool to fail with a generic server error.
- Tightened AMS auto-claim/Profile Doctor matching so printer-reported Generic PLA no longer silently matches composite/specialty rolls such as PLA CF; added recent printer-slot memory from print-start AMS snapshots so the known prior roll (#48 PLA Silk Red) wins the H2D AMS 1 S1 auto-claim.
- Fixed Bambu multi-plate preview metadata so active jobs such as `/data/Metadata/plate_6.gcode` use `Metadata/plate_6.png` and the matching slice-info plate instead of always showing plate 1.
- Added explicit AMS profile sync feedback when moving or adding a spool into a Bambu AMS slot: Flightdeck now reports whether the printer confirmed the profile push.
- Bumped static cache to `app.js?v=260`; backend restart required for the structured add-spool conflict response, stricter AMS auto-claim rules, active Bambu plate metadata, and add/move AMS sync feedback.

## What was fixed - Session 28.180 (Finished job live-detail cleanup - 5 June)
- Live printer header, camera HUD, print details panel, dashboard active rows, and Flight Tower active-job labels now only treat jobs as active while printer state is `printing` or `paused`.
- Finished Bambu printers can still report a retained 100% job payload, but Flightdeck no longer shows it as an active Print Details card with stale thumbnail/detail context.
- Bumped static cache to `app.js?v=257`; frontend-only refresh required.

## What was fixed - Session 28.179 (Print Memory passport detail fix - 5 June)
- Fixed Print Memory passport detail rendering when another hidden printer-history detail container already exists on the page.
- Print Memory now renders into its own explicit detail target instead of relying on a duplicate `history-day-detail` id lookup.
- Bumped static cache to `app.js?v=256`; frontend-only refresh required.

## What was fixed - Session 28.178 (Stale nav progress badge fix - 5 June)
- Sidebar/top printer progress badges now only render for active `printing` or `paused` states.
- Finished/idle printers no longer show stale job progress such as H2D `91%` after a completed print.
- Bumped static cache to `app.js?v=255`; frontend-only refresh required.

## What was built - Session 28.177 (DYMO GPIO keep-awake hook - 5 June)
- Confirmed plain USB keep-awake pings do not stop the DYMO M10 from sleeping; USB stays present but weight reports stop.
- Added an optional GPIO units-button pulse path, enabled by `FLIGHTDECK_SCALE_UNITS_GPIO=<BCM pin>`, to support the Adafruit-style hardware mod.
- `/api/scale/status` and `/api/scale/keep-awake` now report the keep-awake method (`usb` or `gpioN`) and configured GPIO pin.
- Backend restart required after setting or changing GPIO env vars.

## What was built - Session 28.176 (DYMO scale keep-awake - 5 June)
- Added a background DYMO M10 scale keep-awake loop that pings the USB HID endpoint every 120 seconds by default.
- Added `POST /api/scale/keep-awake` for an immediate manual ping and extended `/api/scale/status` with keep-awake state.
- Kept this USB-only and non-blocking; a true units-button toggle still requires the DYMO hardware GPIO/button mod.
- Backend restart required.

## What was polished - Session 28.175 (Spool group card header polish - 5 June)
- Shortened grouped spool card header badges from `2 rolls · latest #...` to `2 rolls`, keeping full roll detail in the tooltip and chips below.
- Adjusted spool card header layout so colour names get first priority and avoid awkward word wrapping on narrow cards.
- Bumped static cache to `style.css?v=197`; frontend-only refresh required.

## What was built - Session 28.174 (Multi-colour spool selection - 5 June)
- Added persisted secondary and tertiary spool colour fields (`color_hex_2`, `color_hex_3`) so Dual, Gradient, Tri-colour, and Mixed schemes can represent the actual filament colours.
- The Add/Edit Spool modal now reveals second/third colour pickers only when the selected colour scheme needs them.
- Spool cards, cabinet/table swatches, live chips, detail bands, location rows, and draft previews render saved multi-colour schemes from the extra colour fields.
- Bumped static cache to `app.js?v=254`; backend restart required.

## What was built - Session 28.173 (Spool colour schemes - 5 June)
- Added spool `color_scheme` metadata with Add/Edit support for Solid, Dual, Tri-colour, Rainbow, Gradient, and Mixed.
- Spool cards, cabinet/table swatches, live loaded spool chips, location rows, detail headers, and the draft preview now render split/gradient/rainbow backgrounds from the saved scheme.
- Bumped static cache to `app.js?v=253`; backend restart required.

## What was built - Session 28.172 (Brand tare estimates - 5 June)
- Added a curated brand-level empty-spool/tare estimate table to the Add/Edit Spool modal, seeded from the operator-provided list plus public FilamIQ and Empty Spool Weight Catalog references.
- Saved material/brand tare values and catalogue-specific tare values still override the estimates; manual edits mark the field as `manual tare`.
- New material/brand rows created from the spool form persist the best available tare estimate.
- Bumped static cache to `app.js?v=252`; no backend restart required.

## What was polished - Session 28.171 (Auto-move visibility - 5 June)
- Made AMS auto-claim/auto-return decision trails easier to trust: future log rows include shelf/slot wording, and spool activity rows show clear badges such as `Matched automatically`, `Unique stored spool`, and `Home shelf return`.
- Bumped static cache to `app.js?v=251` and `style.css?v=196`; backend restart required.

## What was polished - Session 28.170 (Spool edit ID visibility - 5 June)
- Added the spool ID to the Add/Edit Spool modal title and draft preview so it is clear which spool is being edited.
- Bumped static cache to `app.js?v=250` and `style.css?v=195`; no backend restart required.

## What was fixed - Session 28.169 (Print Memory tag length - 5 June)
- Raised Print Memory custom tag storage from 40 to 96 characters and added a matching browser input limit so long tags are not silently cut off after save.
- Bumped static cache to `app.js?v=249`; backend restart required.

## What was built - Session 28.168 (AMS auto-load reconciliation - 5 June)
- Tightened the existing AMS auto-claim path so printer-reported slots can infer material from profile names such as `Generic PLA` when the direct material field is missing.
- The auto-load path remains conservative: only a unique high-confidence stored spool match is moved into the printer/slot; ambiguous or low-score candidates are ignored for manual review.
- Backend restart required.

## Next up - Tomorrow morning
- Validate auto-load reconciliation for spools physically inserted into a printer AMS/MMU.
- Desired behaviour: when a printer reports a newly loaded AMS slot, Flightdeck should find a high-confidence matching stored spool, move it from storage into the selected printer/slot, and keep its home shelf memory for return.
- Confidence rules should start conservative: auto-move only obvious unique matches, prompt/flag possible matches when colour/material/brand are ambiguous, and never guess between near-identical spools.
- Validate against the overnight H2D print: final state, spool deduction, AMS generic-profile tolerance, notifications, and Print Memory scoring/exclusion.

## What was fixed - Session 28.166 (Spool detail breadcrumb - 5 June)
- Fixed the Spool detail page breadcrumb so `Spools` returns to the current inventory route (`#/spools`) instead of the old Settings route.
- Bumped static cache to `app.js?v=248`; no backend restart required.

## What was fixed - Session 28.165 (Generic AMS profile tolerance - 5 June)
- Fixed AMS/Profile Doctor mismatch logic so printer-reported generic profiles such as `Generic PLA` do not count as a mismatch when Flightdeck has a trusted, material/colour-compatible branded spool such as eSun PLA+ Peak Green.
- Applied the same tolerance to backend queue/preflight mismatch checks so generic printer profile names do not block a job after the operator trusts Flightdeck.
- Bumped static cache to `app.js?v=247`; backend restart required.

## What was built - Session 28.164 (Print Memory scorecard - 5 June)
- Added the Stage 3 Print Memory score layer with `/api/print-memory-score`.
- Reliability score counts trusted real attempts only: `FINISHED` vs `ERROR`/`ESTOP`; `CANCELLED` is visible but neutral, and `exclude_from_stats` rows are ignored.
- Print Memory now shows a compact score panel with fleet score, trusted attempt count, excluded count, per-printer scores, ETA error where available, and top material score chips.
- The score panel follows the Memory `days` filter while remaining independent of state/tag/search filters so browsing does not distort reliability.
- Bumped static cache to `app.js?v=246` and `style.css?v=194`; backend restart required.

## What was built - Session 28.163 (Print Memory tags - 4 June)
- Added Stage 2 Print Memory operator metadata: per-print tags and an `Exclude from reliability stats` flag.
- Print Memory rows now show tag/no-stats pills, and the filter toolbar includes a tag filter.
- Print passports now include a Memory Tags section with preset tags (`Flightdeck testing`, `Calibration`, `Prototype`, `Customer job`, `Maintenance`, `First layer`), custom comma-separated tags, and the stats-exclusion toggle.
- Added `PATCH /api/print-memory/{print_id}` plus SQLite migrations for `prints.tags` and `prints.exclude_from_stats`.
- Escaped print note display while touching the shared history/passport detail renderer.
- Bumped static cache to `app.js?v=245` and `style.css?v=193`; backend restart required.

## What was fixed - Session 28.162 (Print Memory render guard - 4 June)
- Stopped Print Memory from rerendering on every fleet refresh while the route and filters are unchanged.
- This removes the visible flashing/flicker while staying on `#/memory` or filtered memory routes.
- Bumped static cache to `app.js?v=244`; no backend restart required.

## What was built - Session 28.161 (Print Memory v1 - 4 June)
- Added a fleet-level Print Memory page under Operations as the first cross-printer print passport surface.
- Added `/api/print-memory` and `/api/print-memory/{print_id}` endpoints over existing history, notes, snapshots, spool usage, and estimate/actual print data.
- Print Memory starts as a searchable/filterable fleet list with clickable rows that open a print passport detail.
- Bumped static cache to `app.js?v=243` and `style.css?v=192`; backend restart required.

## What was polished - Session 28.160 (Sidebar printer picker - 4 June)
- Changed the left sidebar printer section into a compact printer picker instead of expanding every printer into Live/Print Bay/History/Failures/Maintenance links.
- Printer rows now show a status dot, printer label, and active-print progress where available.
- The selected printer stays highlighted across all top printer sub-tabs; task navigation remains in the existing horizontal printer tab bar.
- Bumped static cache to `app.js?v=242` and `style.css?v=191`.

## What was polished - Session 28.159 (Simulator notification polish - 4 June)
- Simulated printer state-change notifications now stay inside Flightdeck with a `SIM` title prefix.
- External ntfy alerts are skipped for simulated printer complete/error/paused/cancelled transitions so phone alerts remain reserved for real hardware.
- Real printer notification behaviour is unchanged.

## What was built - Session 28.158 (Compatibility simulator - 4 June)
- Added a `simulated` printer connection type with PrusaLink, RepRapFirmware, and OctoPrint profiles plus idle/printing/paused/error/mixed scenarios.
- Simulated printers now flow through the normal printer gather/websocket/status card path with synthetic temps, jobs, care items, idle info, and preview thumbnails.
- Settings can add/remove simulated printers without editing YAML.
- Hardware controls, temperature commands, and queue uploads intentionally reject simulated printers for now so the simulator cannot masquerade as real hardware.
- Bumped static cache to `app.js?v=241`; backend restart required.

## What was built - Session 28.157 (History heatmap ranges - 4 June)
- Added a compact History heatmap range selector with Week, Month, and Year views.
- Kept Year as the default existing daily heatmap; Week and Month summarize from the same per-day history calendar data.
- Weekly/monthly summary tiles open the busiest day in that range so the existing day/detail drill-in remains the only print detail surface.
- Bumped static cache versions to `app.js?v=240` and `style.css?v=190`.

## What was reverted - Session 28.156 (History gallery removed - 4 June)
- Removed the History thumbnail gallery after live review; the History tab is back to year nav, heatmap, and day/detail drill-in only.
- Removed the `/api/printers/{printer_id}/history/gallery` endpoint and gallery-only frontend/CSS.
- Bumped static cache versions to `app.js?v=239` and `style.css?v=189`.
- Keep future history work focused on the existing heatmap/day/detail surface unless the gallery is explicitly re-requested.

## What was built - Session 28.155 (History thumbnail gallery - 4 June)
- Added a per-printer History gallery endpoint, `/api/printers/{printer_id}/history/gallery`, returning recent print rows for the selected year.
- Added a `Recent print snapshots` gallery below the History heatmap, using captured print snapshots when available and compact state tiles otherwise.
- Gallery cards open the existing History print detail below the gallery, preserving notes, spool usage, and decision trail as the single detail surface.
- Restored the original gallery-first layout after the above-gallery detail treatment felt too jumpy in use.
- Bumped static cache versions to `app.js?v=238` and `style.css?v=188`.
- Verified live H2D gallery data: 36 items with 13 snapshots; gallery card click opened `can_openerV2` detail with notes and decision trail visible.

## What was fixed - Session 28.154 (Bambu Print Bay scoped file loading - 4 June)
- Diagnosed X1C/H2D Print Bay slowness to printer-specific bay tabs fetching the full fleet `/api/files` payload.
- Confirmed Bambu FTPS SD listings were fast (~0.17s each); the delay was the offline Voron/Moonraker file source taking about 3s inside the fleet endpoint.
- Added optional `printer_id` scoping to `/api/files` so printer-specific Print Bay tabs fetch only the relevant printer storage plus Print Vault.
- Updated printer Print Bay UI to call `/api/files?printer_id={id}` and bumped the app cache to `app.js?v=233`.
- Parallelized fleet file source reads and tightened Moonraker file-list connect timeout so Global Print Bay is less affected by an offline Voron.
- Verified live timings: X1C scoped `/api/files` ~0.16-0.18s, H2D scoped ~0.16-0.19s, global `/api/files` ~1.01s instead of ~3.4s.

## What was polished - Session 28.153 (Decision trail repeat folding - 4 June)
- Collapsed exact repeated print decision trail rows into one API row with `repeat_count`, preserving first/last timestamps so restart/poll noise remains auditable without dominating History.
- Updated the History decision trail UI to show compact repeat chips such as `x11` and the last repeat time.
- Escaped decision event/detail text while touching the renderer.
- Bumped static cache versions to `app.js?v=232` and `style.css?v=185`.
- Verified live Voron print `#94` (`Cube_ABS_1h14m.gcode`) now returns 6 decision rows instead of the long repeated trail: `calibration_captured x12`, `job_reattached x11`, `spool_missing x11`, plus the real start/cancel rows.

## What was fixed - Session 28.152 (Flight Tower printer snapshot cache - 4 June)
- Diagnosed Flight Tower sluggishness to `/api/printers`, which was taking about 3.1s because every request forced a fresh hardware gather even though the background broadcast loop already polls printers every 5s.
- Added a recent printer snapshot cache for `/api/printers` so normal UI reads return the latest known state instantly when it is fresh, while still falling back to a live gather if the cache is empty/stale.
- Added a gather lock so overlapping printer polls do not stack up and make the Pi work harder than needed.
- Backend restart required before this takes effect.

## What was fixed - Session 28.151 (Spool activity exact match fix - 4 June)
- Fixed spool detail activity rows so `Spool #1` no longer also matches `Spool #17`, `Spool #18`, `Spool #19`, etc.
- The AMS / Shelf Activity panel now filters decision rows by exact spool number before returning them to the UI.

## What was polished - Session 28.150 (Spool card detail navigation - 4 June)
- Made single-spool cards in Cards view open the spool detail page when the non-control card surface is clicked.
- Kept Label/Edit/Actions buttons and multiple-roll chip links independent so operators do not accidentally leave the page while using controls.
- Added a subtle hover cue to clickable spool cards.
- Bumped static cache versions to `app.js?v=231` and `style.css?v=184`; no service restart is needed for this static-only pass.

## What was polished - Session 28.149 (Add spool catalogue flow polish - 4 June)
- Added a live spool draft preview inside the Add/Edit Spool modal so catalogue selections, colour, location, and weight are visible before saving.
- Split the modal form into clearer identity, weight, and location sections so adding a spool feels guided without becoming a wizard.
- Reworded catalogue confirmation copy to say the match has been applied and remains editable before save.
- Added a late mobile override for the modal so the new preview and section layout stack cleanly on narrow screens.
- Bumped static cache versions to `app.js?v=230` and `style.css?v=183`; no service restart is needed for this static-only pass.

## What was polished - Session 28.148 (Spool header/search layout polish - 4 June)
- Rebalanced the Spools page after the toolbar merge: the top row now keeps `Spool Inventory`, a long search box, and `+ Add Spool`.
- Moved Cards/Table/Cabinet/Filament catalogue plus quick filters and material/brand selectors below Spool Intelligence so the page reads as overview first, controls second, spools third.
- Kept the previous Spools flash fix in place.
- Bumped static cache versions to `app.js?v=229` and `style.css?v=182`; no service restart is needed for this static-only pass.

## What was polished - Session 28.147 (Spool toolbar merge + flash fix - 4 June)
- Merged the Spools view buttons, quick filter chips, material/brand filters, search box, and Add Spool button into one desktop toolbar above the Spool Intelligence/catalogue area.
- Kept the toolbar responsive so it can wrap on narrow screens without breaking the spool card/cabinet layout.
- Fixed the Spools flashing regression by only doing a full Spools rerender when entering Spools or when the Spools hash/sub-view changes, rather than on every app refresh pass.
- Updated Spools view buttons to keep the hash in step with Cards/Table/Cabinet/Filament catalogue without forcing an unnecessary full repaint.
- Bumped static cache versions to `app.js?v=228` and `style.css?v=181`; no service restart is needed for this static-only pass.

## What was polished - Session 28.146 (Spool catalogue toolbar tidy - 4 June)
- Removed the duplicate blue `Filament catalogue` link from the Spool Intelligence panel so the spool screen has one clean top control row.
- Renamed the top spool view control from `Catalogue` to `Filament catalogue`, keeping it alongside Cards/Table/Cabinet, filters, search, and Add Spool.
- Fixed same-page spool catalogue navigation so links to `#/spools?view=catalogue` rerender the Spools surface even when the user is already on the Spools screen.
- Bumped the app static cache to `app.js?v=227`; no service restart is needed for this static-only pass.

## What was polished - Session 28.145 (Telemetry filament trend polish - 4 June)
- Confirmed live filament telemetry is already recording deductions: `/api/filament/summary` reports 110.4 g total usage, split across ASA and PLA, all currently in one month.
- Updated the Telemetry filament trend panel so early single-month history explains itself instead of looking empty or broken.
- Added gram labels to month bars so the user can see actual usage even before multiple months build a visible trend shape.
- Bumped static cache versions to `app.js?v=226` and `style.css?v=180`; no service restart is needed for this static-only pass.

## What was polished - Session 28.144 (Demo breadcrumb docs - 4 June)
- Updated the install guide so new testers know they can open either **System -> Demo Mode** or the standalone `/demo` page before touching live printer controls.
- Updated the public website tester path to mention the standalone `/demo` page alongside Demo Mode, Setup Health, and the first-printer walkthrough.

## What was polished - Session 28.143 (Standalone demo realism - 4 June)
- Cut a real Voron camera frame from the all-cameras screenshot and added it as `app/static/demo-assets/voron-camera.png`.
- Wired the standalone demo camera data so H2D, X1C, and Voron all show real Flightdeck-style camera imagery instead of the generated blue placeholder.
- Changed the demo Voron state back to an online/idle cross-ecosystem example so the demo fleet better shows Bambu + Voron together.
- Updated demo host/camera-worker telemetry so the Telemetry page has believable demo data instead of looking empty.
- Routed demo printer/queue preview media to the real can-opener preview asset and bumped demo/static cache versions to `demo-runtime.js?v=4` and `app.js?v=225`.

## What was polished - Session 28.142 (Easy install + public repo cleanup - 4 June)
- Reworded the install path around the public promise: Flightdeck install is easy as 1-2-3: install, add printers, add spools.
- Added practical Pi sizing guidance: Pi 5 4 GB for small fleets, Pi 5 8 GB as the recommended default beyond 5 printers, Pi 5 16 GB for 10+ printers/camera-heavy rooms, and Pi 4 as a light-install fallback rather than the main target.
- Added a one-command Raspberry Pi installer entry point, `scripts/install-pi.sh`, so layman installs can start with a single copy/paste command.
- Updated README and GitHub Pages install wording so the public page, repo, and install guide all lead with UI setup instead of YAML editing.
- Removed tracked legacy profile backup artifacts from the public repo and ignored `kprofiles/` so clean clones do not expose private/old profile exports.
- Renamed the default MQTT topic prefix in tracked app settings from the old external-project value to `flightdeck`.

## What was polished - Session 28.141 (Tester path polish - 4 June)
- Tightened the public GitHub Pages landing page so the primary action opens the plain-English install guide, with a secondary GitHub link and contact CTA.
- Added a `Tester path` section to the public page explaining the safe first-run flow: Demo Mode, Setup Health, one printer, then read-only screens before queue/hardware actions.
- Added the same first-tester checklist to `INSTALL.md` so a layman install has a clear route through Demo Mode, Setup Health, printer setup, and cautious control testing.
- Added a `First Tester Path` section to the in-app Flight Manual so the live app, install docs, and public website all tell the same story.
- Bumped the app static cache to `app.js?v=224`; no service restart is needed for this static/manual/docs pass.

## What was polished - Session 28.140 (Setup readiness + spool return polish - 4 June)
- Expanded Setup Health into a first-run readiness summary covering fleet config, data path, camera workers, optional scale/QL-700, access URL, and backup/vault status.
- Wired Setup Health to the same live printer, scale, and label-printer status used elsewhere so the ready summary reflects the actual bench.
- Added clearer "ready for real use / preflight checks needed" wording so missing optional hardware does not look like a blocked install.
- Added home-shelf memory guidance to spool detail pages and AMS Profile Doctor, making auto-return/default return behaviour visible at the point of use.
- Updated the Flight Manual with the spool return/RFID auto-claim workflow.
- Bumped static cache versions to `app.js?v=223` and `style.css?v=179`; no service restart is needed for this static-only pass.

## What was polished - Session 28.139 (Warning target + manual polish - 3 June)
- Kept warning rows visually clean while preserving click-through guidance: dashboard briefing rows and Needs Attention rows now carry the same target metadata/title text as the top warning pill.
- Added a `Warnings And Attention` section to the Flight Manual explaining the orange/red pill, Flight Briefing rows, AMS Profile Doctor targets, Clear skies, and failed-vs-cancelled handling.
- Bumped the static cache to `app.js?v=222`; no service restart is needed for this static-only pass.

## What was fixed - Session 28.138 (Dashboard briefing mobile polish - 3 June)
- Tightened the new `Flight Briefing` dashboard panel on narrow/mobile widths so briefing rows stack cleanly instead of pushing the action label off-screen.
- Moved the responsive briefing rules after the base briefing styles so the mobile layout actually wins in the final cascade.
- Bumped static cache versions to `app.js?v=221` and `style.css?v=178`.

## What was polished - Session 28.137 (Dashboard flight briefing - 3 June)
- Added a `Flight Briefing` handover panel at the top of the dashboard so the first view now summarises what needs operator eyes before the printer cards.
- The briefing uses existing Flightdeck state only: printer faults/offline/paused states, actionable health warnings, AMS profile warnings, active prints, and loaded low-spool risk.
- Briefing rows link directly to the relevant printer, spool, Flight Tower, or exact AMS slot/Profile Doctor when Flightdeck knows the warning source.
- Added a calm `Clear skies` state when there are no active warnings or loaded spool risks.
- Bumped static cache versions to `app.js?v=220` and `style.css?v=177`.

## What was polished - Session 28.136 (Spool activity trace polish - 3 June)
- Extended `/api/spools/{id}/trace` so spool detail pages include matching spool activity from the Flightdeck decision log.
- Added an `AMS / Shelf Activity` timeline to spool detail pages showing moves, auto-returns, auto-claims, printer-trust updates, and warning events for that spool.
- Styled the activity timeline with clear event labels and colour-coded dots so a spool's shelf/AMS story is readable without digging through logs.
- Bumped static cache versions to `app.js?v=219` and `style.css?v=176`.

## What was polished - Session 28.135 (AMS spool doctor polish - 3 June)
- Reworked the AMS slot modal so it clearly separates the printer's reported slot state from Flightdeck's assigned spool.
- Added a best stored-spool suggestion card above the search list, using the same assignment path as the normal spool picker.
- Split current-slot actions into everyday controls (`Details`, `Load/Unload`, `Label`, `Weigh`) and correction controls (`Trust Flightdeck`, `Trust Printer`, `Return spool`) so mismatch repair is easier for a layman to follow.
- Widened the modal and added responsive layouts so the Profile Doctor stays readable on desktop and mobile.
- Bumped static cache versions to `app.js?v=218` and `style.css?v=175`.

## What was fixed - Session 28.134 (Bambu RFID spool auto-claim - 3 June)
- Added Bambu reported-loaded slot reconciliation so if the printer reports an RFID/profile-family spool in an empty Flightdeck AMS slot, Flightdeck can auto-claim the matching shelved spool.
- The auto-claim scorer prefers confident material/profile-family matches, Bambu Lab + subtype matches such as `PLA Basic`, close colour, and enough remaining weight, so old near-empty catalogue ghosts do not win just because their colour is exact.
- Repaired the current H2D AMS 1 S3 case by moving spool `#71` from Shelf #1 into the reported printer slot while leaving old spool `#28` shelved.
- Kept the warning pill behaviour unchanged: the current top warning is valid when Voron is offline and real failed-print count warnings exist.

## What was fixed - Session 28.133 (AMS ghost-spool cleanup + clickable warnings - 3 June)
- Added Bambu empty-slot reconciliation so if the printer reports an AMS/HT slot empty, Flightdeck automatically returns any stale assigned spool to its home shelf, falling back to the first active shelf if the spool predates home-shelf memory.
- Repaired the current ghost assignment by returning spool `#28` from H2D AMS 1 S3 to Shelf #1; the actual loaded state should remain `#3` in AMS1 S1, `#31` in AMS1 S2, and `#2` in AMS HT.
- Made AMS mismatch warnings click-through controls: dashboard attention rows, Flight Tower warning chips, and the top warning pill can now open the exact AMS slot/Profile Doctor when Flightdeck knows the warning source.
- The header warning pill now counts actionable health/AMS warnings, not just paused/offline printer states.
- Bumped static cache versions to `app.js?v=217` and `style.css?v=174`.

## What was fixed - Session 28.132 (H2D AMS-test cancellations repaired - 3 June)
- Reclassified the known H2D AMS mismatch test stops from `ERROR` to `CANCELLED` so they no longer cry wolf on the dashboard.
- Added an audit note before each repair so the original printer error text is still traceable in the decision trail.
- Tightened Bambu cancel handling so a user-requested cancel that lands in Bambu's retained `FAILED` state resolves as `CANCELLED`, not a reliability failure.
- Repaired the one X1C history row that explicitly said it was cancelled, while leaving real/suspicious X1C error-code rows visible for review.

## What was fixed - Session 28.131 (Operator cancels separated from failures - 3 June)
- Stopped operator-cancelled prints from counting as reliability failures or dashboard Needs Attention causes.
- Kept `CANCELLED` prints visible in normal history, while Failure Review now focuses on real failure states (`ERROR` / `ESTOP`).
- Added a separate cancelled-print counter in usage summaries so cancellations remain reportable without skewing failure metrics.
- Changed health wording from "failed/cancelled" to "failed" so printer cards read honestly.

## What was built - Session 28.130 (Spool home shelf memory + installer guide - 3 June)
- Added spool home-shelf memory with `home_storage_location_id`, so a spool loaded from a shelf can automatically return to that shelf when cleared from an AMS/MMU slot.
- Updated spool moves so manually returning a spool to a different shelf teaches Flightdeck the new home location.
- Updated the AMS slot modal to default to `Return home (Shelf #x)` while still allowing an explicit shelf override.
- Added a plain-English `INSTALL.md` for Raspberry Pi testers and linked it from the README.
- Bumped the app cache to `app.js?v=215` so the AMS modal update is picked up immediately.

## What was polished - Session 28.129 (Public website fleet screenshot polish - 3 June)
- Expanded the public website fleet camera screenshot into a full-width showcase so Voron, X1C, and H2D all remain visible.
- Changed the fleet camera image rendering from cropped cover mode to contained display for the cross-ecosystem screenshot.
- Updated the caption to call out the live cross-ecosystem view.

## What was polished - Session 28.128 (Public website positioning polish - 2 June)
- Added the Flightdeck logo mark above the hero title on the public website.
- Reworded the public website positioning from "built for the room" into clearer mixed-fleet printer-room language.
- Changed the status band to say Flightdeck is tested and proven on Bambu + Voron.
- Added mobile-ready positioning for phone/tablet checks away from the desk.
- Added a real all-three-camera screenshot with Voron, X1C, and H2D online.
- Added a tester callout for other printer ecosystems such as Prusa, Qidi, Creality, and RatRig.

## What was built - Session 28.127 (Public website first pass - 2 June)
- Added a GitHub Pages-ready public website under `docs/`.
- Built a Flightdeck-branded landing page with real screenshots for the live printer screen, camera wall, spool inventory, and print details.
- Added public positioning for Flightdeck as a self-hosted, LAN-first mixed Bambu/Voron/Klipper fleet dashboard.
- Included GitHub, install, roadmap, and `flightdeck3dprinters@gmail.com` contact calls to action.
- Added `docs/.nojekyll` and a README pointer so GitHub Pages can serve the site from `/docs` on `main`.

## What was fixed - Session 28.126 (Demo authenticity pass - 2 June)
- Replaced the generated demo print thumbnail with a real can-opener preview capture for H2D.
- Set the demo H2D job to 0% / layer 0 of 530 with the authentic 4h25/4h26 ETA treatment so Print Details matches the real first-pass job screen.
- Expanded the demo print-object list to the seven can-opener STL objects shown in the real UI.
- Removed the generated Greyhound camera placeholder by putting the demo Voron into the native Flightdeck offline state.
- Added a demo fetch fallback and corrected demo failure/usage payload shapes so Telemetry renders in demo mode.
- Bumped demo app cache loading to `app.js?v=214` so demo media changes are picked up immediately.

## What was polished - Session 28.125 (Demo camera captures - 2 June)
- Added real H2D and X1C camera captures as static demo assets so `/demo` looks like the actual Flightdeck live surfaces without starting camera workers.
- Demo camera endpoints now return those static captures for H2D and X1C, with the generated placeholder kept as a fallback for future demo printers.
- Set the demo H2D state to paused so the live page showcases Flightdeck's guarded pause/resume/cancel controls and alert surface.
- Kept the Voron offline state rendered by Flightdeck UI rather than embedding an offline screenshot inside the feed.
- Bumped the demo runtime cache version to `demo-runtime.js?v=2`.

## What was rebuilt - Session 28.124 (True Flightdeck demo mode - 2 June)
- Replaced the first-pass standalone promo demo with the real Flightdeck interface served in demo mode.
- `/demo` now loads the normal Flightdeck shell and `app.js` with a demo runtime that mocks API and WebSocket data.
- Demo controls simulate command feedback locally and do not call live printer, scale, label, camera, queue, or file endpoints.
- Demo media uses generated Flightdeck preview/camera placeholders so no camera workers or printer media routes are started.
- Bumped static cache versions to `app.js?v=213` and `style.css?v=173`.

## What was built - Session 28.123 (Standalone demo mode - 2 June)
- Added a standalone `/demo` page for prospects/testers to try Flightdeck without connecting to live printer APIs.
- Built the standalone demo with simulated fleet cards, live printer controls, filament route, spools, Print Bay, maintenance, alerts, and activity log.
- Demo commands now respond locally with simulated feedback while real printer commands stay disabled.
- Added README notes explaining when to use `/demo` versus the in-app Flightdeck walkthrough.

## What was polished - Session 28.122 (Manual demo shortcut - 2 June)
- Added a direct Demo Mode button to the Flight Manual hero so testers can jump from the handbook into the guided walkthrough.
- Bumped static cache versions to `app.js?v=212` and `style.css?v=172`.

## What was documented - Session 28.121 (Demo docs - 2 June)
- Added a README Demo Mode section under Flight Manual.
- Documented the recommended demo flow: Dashboard, Flight Tower, Live printer, Spools, Global Print Bay, then Maintenance.
- Added a short reminder to avoid destructive controls during casual walkthroughs.

## What was built - Session 28.120 (Demo fleet cards - 2 June)
- Added Live Fleet Picks to Demo Mode so each configured printer has a compact state card with Live, Bay, and Failures shortcuts.
- Demo Mode now surfaces attention context such as offline/fault state, recent failures, and loaded spool count before opening a printer page.
- Expanded demo readiness metrics with an Attention tile and bumped static cache to `app.js?v=211` and `style.css?v=171`.

## What was built - Session 28.119 (Demo Mode first pass - 2 June)
- Added a dedicated System > Demo Mode page for a safe first-look Flightdeck walkthrough.
- Demo Mode now shows live demo readiness across fleet count, host/runtime, setup health, and camera-worker state.
- Added a guided tour path covering Dashboard, Flight Tower, Live Printer, Spools, Global Print Bay, and Maintenance.
- Added demo talk-track notes and a "Do Not Demo First" guardrail list to keep walkthroughs focused and low-risk.
- Added Demo Mode to the sidebar and command palette, with static cache bumped to `app.js?v=210` and `style.css?v=170`.

## What was fixed - Session 28.118 (Flight Manual render guard - 2 June)
- Stopped the Flight Manual from rebuilding on every printer refresh tick, which was causing the page to flash while live updates arrived.
- Bumped the static cache version so browsers pick up the guarded manual route immediately.

## What was built - Session 28.117 (Flight Manual first pass - 2 June)
- Added a first-class Flight Manual page under System for demo readiness, daily flow, Bambu multi-colour rules, spool/label notes, recovery steps, maintenance notes, and tester guidance.
- Added live demo-readiness checks on the manual page using setup health, instance health, printer count, memory, disk, and camera worker status.
- Added Flight Manual to the sidebar and command palette so it is easy to find during testing.

## What was built - Session 28.116 (System health telemetry - 1 June)
- Expanded `/api/instance` with host load, memory, and data-disk usage so Flightdeck can surface Pi/NAS pressure without another diagnostic tool.
- Added a Telemetry “System Health” panel for runtime host, CPU load, RAM, data disk, and Bambu camera worker count.
- Kept camera-worker state visible in Telemetry as an early warning if live feeds ever start overworking the Pi again.

## What was built - Session 28.115 (Camera worker guardrails - 1 June)
- Added camera worker diagnostics to `/api/instance` and Settings > Setup health so runaway Bambu `ffmpeg` workers are visible before they overload the Pi.
- Added `scripts/clear-camera-workers.sh` to reset only Bambu camera transcoders without restarting Flightdeck.
- Documented the camera-only recovery script in the README.

## What was built - Session 28.114 (Runtime footer label - 1 June)
- Added `/api/instance` so Flightdeck reports its local address, runtime, and detected hardware label.
- Dashboard footer now shows the detected host, e.g. `flightdeck · 192.168.4.127 · running on Pi 5 8GB`, instead of a hardcoded Pi IP.
- Raspberry Pi installs auto-detect model and memory from `/proc/device-tree/model` and `/proc/meminfo`; NAS/Docker installs can override the label with `FLIGHTDECK_INSTANCE_NAME`.
- Documented optional `.env` overrides for footer address and instance label.
- Added a camera proxy start lock so multiple browser image requests cannot race and spawn duplicate Bambu `ffmpeg` workers.
- Reduced proxied Bambu camera output to a Pi-friendlier stream size and frame rate to keep the live UI from overwhelming the 4GB Pi.

## What was built - Session 28.113 (NAS USB hardware passthrough - 1 June)
- Added `usbutils` to the NAS Docker image so hardware detection can run `lsusb` inside the container.
- Passed `/dev/bus/usb` and `/dev/hidraw0` through the NAS compose file for the Brother QL-700 and Dymo scale.
- Documented NAS Docker hardware passthrough for optional scale and label-printer support.

## What was built - Session 28.112 (NAS Docker service health polish - 1 June)
- Made the setup health check Docker-aware so NAS/Portainer installs no longer show a missing `systemctl` warning.
- Added NAS compose environment labels for `FLIGHTDECK_RUNTIME`, `FLIGHTDECK_SERVICE_MANAGER`, and `FLIGHTDECK_INSTANCE_NAME`.
- Docker installs now report the service as Docker / Portainer managed while Pi installs keep the normal systemd check.
- Docker-managed service health now shows as a green OK state instead of optional.

## What was built - Session 28.111 (NAS staging restore prep - 1 June)
- Moved the NAS Docker preview host port to `8010` so it does not collide with Portainer/ASUSTOR services already listening on `8000`.
- Documented the NAS preview URL/port expectation before the first Portainer stack test.
- Staged the latest Pi backup archive for restore into `/volume2/flightdeck-data` on the ASUSTOR NAS.

## What was built - Session 28.110 (NAS Docker staging - 1 June)
- Added a NAS-ready `Dockerfile` for running Flightdeck in a Python 3.13 container with FFmpeg and USB support libraries available.
- Added `.dockerignore` so live databases, secrets, print vaults, backups, caches, and virtual environments are not copied into Docker builds.
- Added `docker-compose.nas.yml` mapping the ASUSTOR SSD paths: `/volume2/flightdeck-data`, `/volume3/flightdeck-vault`, and `/volume3/flightdeck-backups`.
- Documented the NAS/Portainer preview deployment while keeping the Pi as the live host until the container is tested.

## What was built - Session 28.109 (Backup and restore foundation - 1 June)
- Added `scripts/backup-flightdeck-data.sh` for private recovery archives of Flightdeck live data.
- Added `scripts/restore-flightdeck-data.sh` with a typed confirmation and automatic safety copy before overwriting live data.
- Documented the private GitHub backup repo workflow and optional NAS staging copy for `/volume3/flightdeck-backups/pi-imports`.
- The default backup excludes `.env`, SSH keys, caches, and the large print vault unless `INCLUDE_PRINT_LIBRARY=1` is set.
- Adjusted backup checksum files to use relative archive names so NAS-staged copies can be verified in place.

## What was built - Session 28.108 (Security cameras removed - 1 June)
- Removed the experimental Security Cameras watchtower screen to reduce Pi memory and camera-stream load.
- Kept the normal Cameras page in place for manual monitoring.
- Removed the route, navigation entry, view container, renderer, and security-camera CSS.
- Static cache-bust bumped to `app.js?v=205` and `style.css?v=166`.

## What was built - Session 28.107 (Security camera rollback - 1 June)
- Reverted the anti-flash render guard because it caused black camera screens in live use.
- Restored the Security Cameras page to the first-pass watchtower behavior while we design a safer no-flash implementation.
- Static cache-bust bumped to `app.js?v=204`.

## What was built - Session 28.105 (Security Cameras first pass - 1 June)
- Added a dedicated Operations > Security Cameras screen with a rotating spotlight that cycles printer feeds every 5 seconds.
- Added alert-lock behavior so printer faults, emergency stops, and faulted pauses pin the spotlight to the affected printer.
- Added camera thumbnails, status context, offline cards, and a zoom toggle for closer inspection.
- Static cache-bust bumped to `app.js?v=202` and `style.css?v=165`.

## What was built - Session 28.104 (Camera nav convenience - 1 June)
- Moved the printer camera wall up directly under Dashboard in the left navigation for faster daily access.
- Kept Operations focused on queue and global print bay work, leaving room for a future separate Security Cameras screen.
- Static cache-bust bumped to `app.js?v=201`.

## What was built - Session 28.103 (Faster Bambu offline timeout - 1 June)
- Reduced Bambu MQTT stale detection from 150 seconds to 45 seconds so powered-off printers leave `IDLE` faster while still avoiding brief LAN/MQTT flaps.

## What was built - Session 28.102 (Camera tile live refresh fix - 1 June)
- Fixed the All Cameras refresh path so tile bodies update when printers move between offline and online, not just the header badge.
- Split camera tile feed rendering into a reusable helper and reattached retry handlers after feed swaps.
- Fixed a duplicate camera endpoint JSON read and bumped `app.js?v=200`.

## What was built - Session 28.101 (Camera offline tile polish - 1 June)
- Reused the Live page signal-lost treatment in the All Cameras view.
- Offline and unconfigured camera tiles now show the radar card, status badge, and last-contact/context text instead of plain black placeholders.
- Static cache-bust bumped to `app.js?v=199` and `style.css?v=164`.

## What was built - Session 28.100 (Bambu offline init fix - 1 June)
- Initialised the Bambu connector's cached last-seen timestamp before first contact.
- Fixed powered-off Bambu printers briefly rendering as `ERROR` after restart instead of the intended `OFFLINE` state.

## What was built - Session 28.99 (Offline state consistency polish - 1 June)
- Added Bambu MQTT staleness detection so retained printer payloads do not keep powered-off printers showing as `idle`.
- Dashboard and All Cameras now inherit the backend `offline` state once Bambu printers stop sending fresh reports.
- Kept the Session 28.98 Environment fallback polish in place for offline/non-reporting printers.

## What was built - Session 28.98 (Live loaded spool fallback polish - 1 June)
- Replaced the old skinny loaded-spool fallback chips with proper loaded rows for printers without live AMS/MMU data.
- Offline Voron now keeps the newer Environment panel language with swatch, material/brand, spool number, slot, grams, and percent meter.
- Static cache-bust bumped to `app.js?v=198` and `style.css?v=163`.

## What was built - Session 28.97 (Live offline hero restore - 1 June)
- Replaced the plain black live-feed offline placeholder with a polished signal-lost card.
- Live camera hero now swaps between stream and offline/no-feed states cleanly when printer state changes.
- Static cache-bust bumped to `app.js?v=197` and `style.css?v=162`.

## What was built - Session 28.96 (Operations nav restore - 1 June)
- Restored `Cameras` and `Queue` under the Operations section after the printer-scoped navigation pass.
- Static cache-bust bumped to `app.js?v=196`.

## What was built - Session 28.95 (Printer failure scroll pane - 1 June)
- Gave each printer `Failures` tab the same fixed-context/scrolling-results behaviour as the spool swatch view.
- The failure header, filters, and stat cards stay visible while the failure row list scrolls underneath.
- Static cache-bust bumped to `style.css?v=161`.

## What was built - Session 28.94 (Printer scoped Print Bay and failures - 1 June)
- Reworked the left navigation into printer groups so each machine owns its own `Live`, `Print Bay`, `History`, `Failures`, and `Maintenance` pages.
- Added printer-specific Print Bay tabs for machine-local files, recent work, and vault-compatible candidates while keeping the Print Vault inside the global Print Bay.
- Moved failure review into each printer page so timing buckets, material, spool attribution, snapshots, and failure rows are scoped per machine.
- Removed the combined `Failures` item from the primary nav and renamed the fleet file area to `Global Print Bay`.
- Static cache-bust bumped to `app.js?v=195` and `style.css?v=159`.

## What was built - Session 28.93 (Maintenance service cockpit - 31 May)

The printer Maintenance tab now reads more like a service cockpit than a plain task list.

### Frontend
- Added a top cockpit panel with printer-reported care count, scheduled due count, manual task count, next service, and last completed service.
- Collapsed the add-task form behind an "Add service task" drawer so the service status is the first thing you see.
- Kept Bambu MQTT care and manual schedules visually separate.
- Static cache-bust bumped to `app.js?v=194` and `style.css?v=158`.

### Verification
- `node --check app/static/app.js`
- `git diff --check`

## What was built - Session 28.92 (Printer usage telemetry - 31 May)

Telemetry now includes per-printer historical print counters.

### Backend
- Added `/api/printers/usage` with all-time Flightdeck print counts, finished counts, failure counts, print hours, and filament grams by printer.
- Corrected Bambu MQTT care label `ls` to "Lubricate lead screws"; `lr` remains "Lubricate linear rails".

### Frontend
- Telemetry Printer Balance rows now show per-printer print count and recorded print hours.
- Static cache-bust bumped to `app.js?v=193`.

### Verification
- `python -m py_compile app/db.py app/main.py app/printers/bambu.py`
- `node --check app/static/app.js`
- `git diff --check`

## What was built - Session 28.91 (Bambu MQTT maintenance automation - 31 May)

Flightdeck now reads Bambu MQTT care advisories into the printer Maintenance tab using its own maintenance model.

### Backend
- Bambu status parses MQTT `print.care` into live maintenance advisories.
- Printer status includes a `maintenance` telemetry list for due care codes.

### Frontend
- Maintenance tabs show an Auto maintenance panel above manual operator tasks.
- Bumped static cache-bust to `app.js?v=192` and `style.css?v=157`.

### Verification
- `python -m py_compile app/models.py app/printers/bambu.py`
- `node --check app/static/app.js`
- `git diff --check`

## What was built - Session 28.90 (Camera sim route fix - 31 May)

Flightdeck's 30-camera simulator link now opens the camera wall correctly.

### Frontend
- Router now recognises `#/cameras?sim=30`, not only plain `#/cameras`.
- The Flight Tower `View 30 cameras` link can now switch to the simulated camera wall instead of only changing the hash.
- Static cache-bust bumped to `app.js?v=188`.

### Verification
- `node --check app/static/app.js`
- `git diff --check`

## What was built - Session 28.89 (H2D route cooling guard - 31 May)

Flightdeck now avoids showing a false H2D AMS HT route while a nozzle is only cooling down after unload.

### Frontend
- H2D route inference now treats a nozzle as route-active from target temperature immediately.
- Actual nozzle heat only counts as route-active while the printer has an active thermal context, such as a print/job, pause, loading, preparing, or busy state.
- When H2D is idle and both AMS slots report inactive, the Live filament route stays hidden even if a nozzle is still hot from the previous unload/print.
- Static cache-bust bumped to `app.js?v=187`.

### Verification
- `node --check app/static/app.js`
- `git diff --check`

## What was built - Session 28.88 (H2D filament route nozzle inference - 31 May)

Flightdeck's Live filament route now handles the H2D's dual-nozzle/AMS HT reporting more accurately.

### Frontend
- Added H2D-specific route inference for the Live filament route.
- When the right nozzle is hot/working and AMS HT is loaded, Flightdeck now routes AMS HT to `Right nozzle` even if Bambu's generic `active` flag still points at AMS 1.
- Normal AMS routes label as `Left nozzle` on H2D.
- Active/fed highlighting in the loaded AMS row uses the same inferred route signal as the route graphic.
- Static cache-bust bumped to `app.js?v=186`.

### Verification
- `node --check app/static/app.js`
- `git diff --check`

## What was built - Session 28.87 (Live filament route polish - 31 May)

The Live AMS route graphic now reads more like an active feed indicator.

### Frontend
- Active/fed AMS slot swatches now get a subtle green active ring and dot.
- Filament route source node now includes a compact `Fed now` state badge.
- The route line now has a quiet animated flow treatment so live filament movement is easier to spot without crowding the camera.
- Static cache-bust bumped to `style.css?v=155` and `app.js?v=185`.

### Verification
- `node --check app/static/app.js`
- `git diff --check`

## What was built - Session 28.86 (Live AMS-to-toolhead route graphic - 31 May)

Flightdeck now shows the currently fed AMS filament path on the printer Live tab.

### Frontend
- Added a compact `Filament route` strip inside the Live `Environment` panel.
- The route uses the printer's live `active` AMS slot signal and draws the slot colour toward the toolhead/nozzle area.
- Clicking the source node opens the same AMS Profile Doctor for that slot.
- Parked/non-active AMS rolls remain in the normal `Loaded` rows so Flightdeck does not overclaim which spool is actually feeding.
- Static cache-bust bumped to `style.css?v=154` and `app.js?v=184`.

### Verification
- `node --check app/static/app.js`
- `git diff --check`

## What was built - Session 28.85 (Bambu queued plate display fallback - 30 May)

Flightdeck now keeps queued Bambu 3MF job names/previews visible when firmware reports only an internal plate file.

### Backend
- Added an active queue job lookup.
- Bambu live status now resolves `/data/Metadata/plate_1.gcode` back to the active queue filename when the printer does not report a subtask name.
- Bambu preview/object lookup now uses that active queue filename as the cache key, so queued multi-object 3MF previews and object exclusion can stay available.

### Verification
- `python3 -m py_compile app/db.py app/printers/bambu.py`
- `git diff --check`

## What was built - Session 28.84 (Bambu queue AMS mapping - 30 May)

Flightdeck queue starts now use the same Bambu AMS mapping logic as relay starts.

### Backend
- Bambu queue/file starts now parse the uploaded 3MF preview metadata and derive AMS tray mapping before starting the print.
- Queue starts now send the derived `ams_mapping` through Flightdeck's BambuStudio-style `ams_mapping2` command path.
- Added `queue_bambu_mapping` decision logging so future multi-colour failures show exactly which tray IDs Flightdeck sent.
- Seeded the print preview cache from queue uploads so live/history previews stay in sync with the queued file.

### Verification
- `python3 -m py_compile app/printers/bambu.py`
- `git diff --check`

## What was built - Session 28.83 (Bambu AMS mapping2 start command - 30 May)

Flightdeck now sends BambuStudio-style AMS mapping details when starting Bambu relay prints.

### Backend
- Overrode the Bambu 3MF start command in Flightdeck's sequenced MQTT client so it sends both legacy `ams_mapping` and detailed `ams_mapping2`.
- Converted external/unknown slots to Bambu's expected detailed mapping format instead of leaving unsupported values in the flat map.
- Corrected relay-start mapping for AMS HT: Flightdeck now sends Bambu-native AMS HT tray IDs like `128`, not internal UI slot IDs like `512`.
- Relay mapping notes now log the Bambu tray ID that was sent.

### Verification
- `python3 -m py_compile app/relay.py app/printers/bambu.py`
- `git diff --check`

## What was built - Session 28.82 (AMS drying power warning - 30 May)

Flightdeck now warns before starting AMS drying while the printer is active.

### Frontend
- AMS drying dialog shows an amber warning when the printer is printing/loading/paused: drying may need a separate AMS power supply for reliable drying.
- The warning is advisory and does not block the command.
- Static cache-bust bumped to `style.css?v=151` and `app.js?v=173`.

### Verification
- `node --check app/static/app.js`
- `git diff --check`

## What was built - Session 28.81 (Bambu AMS mapping start command - 30 May)

Flightdeck now derives Bambu AMS mapping for relay-started multicolour jobs instead of always sending slot `[0]`.

### Backend
- Relay upload now stores parsed 3MF filament colour metadata in the pending Bambu upload record.
- Added a flattened live AMS slot reader to `BambuPrinter`.
- Bambu print start now builds `ams_mapping` by matching 3MF material/colour requirements to the printer's currently reported AMS slots.
- Start decisions now log the mapping used and the material/colour-to-slot matches.
- If metadata or live AMS slots are unavailable, Flightdeck falls back to slot `[0]` and records why in the decision log.

### Verification
- `python3 -m py_compile app/relay.py app/printers/bambu.py`
- `git diff --check`

## What was built - Session 28.80 (Bambu pause alarm reasons - 30 May)

Flightdeck now surfaces the real Bambu AMS pause alarm instead of only saying a print paused.

### Backend
- Added Bambu MQTT alarm decoding from `err`, `err2.err_code`, `print_error`, `ap_err`, `fail_reason`, and related fields.
- Added a friendly decoder for `1E07008012` / `0700-8012`: `Failed to get AMS mapping table; please select "Resume" to retry.`
- Bambu paused/error printer status now carries the decoded alarm in `error`.
- Print paused/error notifications now include the decoded printer reason.
- If the paused print later becomes a failed print, the decoded reason is saved into print history as the failure message.

### Frontend
- Dashboard issue text and live-screen warning chips now show the decoded paused reason when present.
- Static cache-bust bumped to `app.js?v=172`.

### Verification
- `python3 -m py_compile app/printers/bambu.py app/main.py`
- `node --check app/static/app.js`
- `git diff --check`

## What was built - Session 28.79 (Print Vault copy polish - 30 May)

Print Bay copy-to-vault now keeps the archive area in view.

### Frontend
- Print Vault open/closed state is preserved during File Desk refreshes.
- Copy-to-vault forces Print Vault open after a successful archive so the copied file stays visible.
- File Desk refresh cache is invalidated after copy-to-vault so new vault state is fetched immediately.
- Static cache-bust bumped to `app.js?v=171`.

### Verification
- `node --check app/static/app.js`
- `git diff --check`

## Current state

**Tier 1 complete. Tier 2 complete. Post-Tier-2 niceties complete. Spool inventory + Print queue + queue refinements + Maintenance schedule + Queue preflight + Spool traceability + Failure review + Printer health score + Scale/label hardware integration + dashboard command overview shipped.**

Service running at:
- `http://flightdeck.local:8000`
- `http://192.168.4.127:8000`
- **`https://flightdeck.tail7de73e.ts.net`** (Tailscale Serve — HTTPS, used for PWA / notifications)

---

## What was built — Session 28.78 (Print Vault archive indicators — 30 May)

Print Bay now recognises files that are already backed up into Print Vault.

### Backend
- Added archive-key matching between printer storage files and Print Vault files.
- Printer bay file rows now include `in_vault` and `vault_path` when the file appears to already exist in the vault.

### Frontend
- Printer bay rows show a green `Vaulted` chip for files already backed up.
- Printer bay source strips show how many visible files are vaulted.
- Bulk copy action now reads `Copy to Vault`.
- Copy success and replace prompts now use Print Vault wording.
- Static cache-bust bumped to `style.css?v=150` and `app.js?v=170`.

### Verification
- `python3 -m py_compile app/main.py`
- `node --check app/static/app.js`
- `git diff --check`

---

## What was built — Session 28.77 (Configurable Print Vault — 30 May)

Print Vault can now be pointed at a Pi, USB, or HDD-backed archive path from Flightdeck preferences.

### Backend
- Added `print_vault_path` setting support.
- Print Bay resolves the vault path at request time, so path changes do not require a service restart after the backend update is running.
- Validates the vault path is a writable directory before saving.
- Setup Health now reports `Print Vault` using the configured runtime path.

### Frontend
- Added `Print Vault` path field under `Settings -> Preferences / System`.
- Saving a vault path shows success/failure feedback.
- Static cache-bust bumped to `style.css?v=149` and `app.js?v=169`.

### Verification
- `python3 -m py_compile app/main.py app/db.py`
- `node --check app/static/app.js`
- `git diff --check`

---

## What was built — Session 28.76 (Print Vault split — 30 May)

Print Bay now separates active printer storage from the backup/archive library.

### Frontend
- The Pi print library now reads as `Print Vault`, suitable for Pi/USB/HDD-backed file storage.
- Printer storage is presented first as `Printer Bays / Active storage`.
- The vault is moved into its own collapsible panel so Print Bay has more room for live printer file lanes.
- Overview wording changed from `Pi library` to `vault files`.
- Static cache-bust bumped to `style.css?v=148` and `app.js?v=168`.

### Note
- The existing `FLIGHTDECK_PRINT_LIBRARY` path can be pointed at a mounted USB/HDD location when you want the vault on external storage.

### Verification
- `node --check app/static/app.js`
- `git diff --check`

---

## What was built — Session 28.75 (Spool picker visibility — 30 May)

Spool cards and Add Spool previous-colour picks now make newly-added duplicate rolls easier to find.

### Frontend
- Add Spool `Previously used` colour picks are no longer capped at six results.
- Previous picks now render as a scrollable paint-chart list with spool numbers.
- Previous picks are sorted newest-first so fresh rolls/colours appear immediately.
- Spool card search now matches spool numbers, hex colours, subtype, notes, storage location, and loaded printer ids.
- Grouped duplicate cards now sort by latest roll id and show `latest #...` in the card badge.
- Static cache-bust bumped to `style.css?v=147` and `app.js?v=167`.

### Data note
- Spool #64 exists and is grouped with matching `White / PLA+ / 3DFillies` rolls.
- Spool #5 does not exist in the database; the id was skipped by SQLite during an earlier failed/conflicting insert.

### Verification
- `node --check app/static/app.js`
- `git diff --check`

---

## What was built — Session 28.74 (Print Bay density pass — 30 May)

Print Bay now uses the available screen space more like a dispatch board.

### Frontend
- Widened the Print Bay canvas for large desktop displays.
- Compacted the hero, overview counters, and Reprint Bay cards.
- Source panels now flow into more across-the-page lanes instead of being locked to two wide stacks.
- File rows are tighter, with shorter spacing and a viewport-aware scroll inside each source lane.
- Static cache-bust bumped to `style.css?v=146`.

### Verification
- `git diff --check`

---

## What was built — Session 28.73 (Reprint Bay run memory — 30 May)

Reprint Bay cards now expose lightweight run-memory chips so the strip reads as dispatch context rather than a plain history list.

### Frontend
- Each Reprint Bay card now shows up to three memory chips:
  - last run completed/cancelled/failed
  - source match location or source file missing
  - model grams when known
- Source match chip distinguishes same-printer source vs another source panel.
- Static cache-bust bumped to `style.css?v=145` and `app.js?v=166`.

### Verification
- `node --check app/static/app.js`

---

## What was built — Session 28.72 (Reprint Bay first pass — 30 May)

Print Bay now has its first history-aware Reprint Bay strip.

### Backend
- Added `db.get_recent_reprints(limit)` for recent completed/cancelled/error print records.
- Added `GET /api/files/reprints?limit=12`, enriched with printer model/custom names.

### Frontend
- Print Bay now fetches recent print history alongside file sources.
- Added `Reprint Bay / Recent work` cards above the source panels.
- Reprint cards show:
  - job name
  - outcome badge
  - printer
  - duration
  - material/grams when known
  - failure snapshot when available
- Reprint cards search current Print Bay sources for a matching file; if found, they expose a direct `Queue` action.
- If no source file exists, the card is marked history-only.
- Static cache-bust bumped to `style.css?v=144` and `app.js?v=165`.

### Verification
- `python3 -m py_compile app/db.py app/main.py`
- `node --check app/static/app.js`

---

## What was built — Session 28.71 (Print Bay first pass — 30 May)

The old Files surface has been renamed and reshaped into the first pass of Print Bay.

### Frontend
- Navigation now calls the page `Print Bay` instead of `Files`.
- Page heading changed to `Print Bay / Run-ready library`.
- Added overview counters for:
  - ready to launch
  - Pi library files
  - printer storage files
  - total printable files
- Source panels now show operational summary chips: ready count, compatible printer count, and total size.
- Replaced the cramped file table with launch rows:
  - checkbox
  - file type/name/path
  - size/modified metadata
  - compatible printer chips
  - visible `Queue` action at the right edge
- Bulk copy/delete flows remain intact.
- Static cache-bust bumped to `style.css?v=143` and `app.js?v=164`.

### Verification
- `node --check app/static/app.js`

---

## What was built — Session 28.70 (Live environment compact pass — 30 May)

The Live tab Environment panel was tightened so it no longer creates a large empty temperature column under the camera.

### Frontend
- Environment now uses one compact header row containing the title and temperature chips.
- Loaded AMS rows now run full-width underneath the header.
- AMS rows were changed to compact two-column instrument rows: metadata/dry control on the left, slot swatches on the right.
- Dry buttons and AMS slot swatches were slightly reduced so the panel supports the camera-first layout.
- Static cache-bust bumped to `style.css?v=142` and `app.js?v=163`.

### Verification
- `node --check app/static/app.js`

---

## What was built — Session 28.69 (Pause/resume control polish — 30 May)

Live printer controls now use one state-aware Pause/Resume button instead of separate buttons.

### Frontend
- Transport deck shows `Pause` while printing and `Resume` while paused.
- Pause and resume now both ask for confirmation before sending the command.
- Older detail control renderer was kept in sync for any fallback surfaces.
- Static cache-bust bumped to `app.js?v=162`.

### Backend
- Bambu `pause()` and `resume()` now raise an error if the MQTT command is not accepted instead of silently returning success.

### Verification
- `python3 -m py_compile app/printers/bambu.py app/printers/bambu_ftp.py app/main.py`
- `node --check app/static/app.js`

---

## What was built — Session 28.68 (Bambu object skip metadata — 30 May)

Flightdeck now reads Bambu object/part candidates from the active 3MF metadata instead of waiting for live MQTT `s_obj` to populate.

### Backend
- `BambuPreview` now carries parsed objects from `Metadata/slice_info.config`.
- Bambu `/api/printers/{id}/objects` returns parsed object IDs/names for multi-object plates.
- Bambu `/api/printers/{id}/exclude-object` sends the MQTT `skip_objects` command with the selected object ID.

### Frontend
- Existing Print Objects panel now passes Bambu object IDs through the checkbox flow.
- Static cache-bust bumped to `app.js?v=161`.

### Verification
- Parsed the active H2D 3MF and confirmed twelve object IDs from `slice_info.config`.
- `python3 -m py_compile app/printers/bambu.py app/printers/bambu_ftp.py app/main.py`

---

## What was built — Session 28.67 (Bambu stale fault clear — 30 May)

Flightdeck now releases stale Bambu fault state after the printer has already recorded the failed job and no longer reports an active error code.

### Backend
- Bambu printer adapter now tracks when an in-session error was first seen.
- If Bambu keeps reporting `FAILED` for an already-closed print but `print_error` is clear, Flightdeck logs `error_cleared` and returns the printer to `idle` after a short grace period.
- Queue preflight still blocks real active `error` states, but no longer stays blocked on a retained Bambu failure from a physically cleared printer.

### Verification
- `python3 -m py_compile app/printers/bambu.py`

---

## What was built — Session 28.66 (Live environment band — 30 May)

The Live tab now uses the space under the camera as one coherent Environment band instead of separate half-empty cards.

### Frontend
- Combined `Temperatures` and `Loaded` into a single `Environment` panel.
- Environment panel uses a compact two-column layout:
  - temperatures on the left
  - AMS/loaded feeder rows on the right
- RHS remains available for Print Details and object exclusion during multi-part prints.
- Mobile/narrow layout stacks the same sections cleanly.
- Static cache-bust bumped:
  - `style.css?v=141`
  - `app.js?v=160`

### Verification
- JavaScript syntax check: `node --check app/static/app.js`
- Whitespace check: `git diff --check`
- Browser check on `#/printer/h2d` confirmed one Environment panel with temperature and loaded sections.

---

## What was built — Session 28.65 (Live transport controls — 29 May)

The Live tab print controls were moved into the cockpit header as a compact transport deck.

### Frontend
- Replaced the large RHS command card with header-level transport controls.
- Controls now sit in line with the `Now printing` status:
  - Pause
  - Resume/play
  - Cancel/stop
  - E-stop
  - compact Light control
- The transport buttons keep the existing command handlers and confirmation flow.
- Static cache-bust bumped:
  - `style.css?v=140`
  - `app.js?v=159`

---

## What was built — Session 28.64 (Live compact light control — 29 May)

Live screen command panel polish.

### Frontend
- Replaced the large glowing `BAMBU` light toggle with a compact bulb-style `Light` control.
- The control still reflects on/off state visually and uses the existing click handler.
- Static cache-bust bumped:
  - `style.css?v=139`
  - `app.js?v=158`

---

## What was built — Session 28.63 (Live feed hero tightening — 29 May)

The Live tab layout was tightened so the camera feed stays the visual hero.

### Frontend
- Reduced Live page spacing around the camera.
- Made the cockpit header more compact.
- Slimmed signal chips, camera HUD, temperature chips, Loaded cards, and AMS rows.
- Reduced RHS panel spacing and detail panel padding.
- Kept AMS Dry/slot controls compact after the alignment pass.
- Static cache-bust bumped:
  - `style.css?v=138`
  - `app.js?v=157`

---

## What was built — Session 28.62 (Live AMS row alignment — 29 May)

Small Live screen polish for the AMS rows.

### Frontend
- Aligned AMS colour slot rows with the Dry control so each feeder row reads as one clean block.
- Reduced the Dry button footprint so the swatches stay visually dominant.
- Capped live AMS slot width so single-slot HT rows stay swatch-sized instead of stretching into a full bar.
- Static cache-bust bumped:
  - `style.css?v=137`
  - `app.js?v=156`

---

## What was built — Session 28.61 (Live AMS loaded rows — 29 May)

The Live tab `Loaded` cockpit block now mirrors the actual feeder layout for AMS printers.

### Frontend
- Bambu AMS printers now show loaded filament as feeder rows:
  - `AMS 1` row with RH/temp/dry status and colour slots
  - `AMS HT` row with RH/temp/dry status and colour slot
- Slot swatches keep the same click-to-edit behaviour as the existing AMS panel.
- Dry controls are available directly from the cockpit Loaded block.
- Non-AMS printers still fall back to loaded spool chips.
- Removed the duplicate RHS AMS card from Live so AMS state lives in one place.
- Static cache-bust bumped:
  - `style.css?v=136`
  - `app.js?v=155`

### Verification
- JavaScript syntax check: `node --check app/static/app.js`
- Whitespace check: `git diff --check`
- Browser check on `#/printer/h2d` confirmed two live AMS rows, five slot buttons, two Dry controls, and no duplicate RHS AMS card.

---

## What was built — Session 28.60 (Live idle HUD cleanup — 29 May)

Small Live screen polish after real visual review.

### Frontend
- Camera HUD now hides when there is no active job, avoiding duplicated idle/status text already shown in the cockpit header.
- Camera HUD still appears for active jobs with job name, progress, ETA, and key temperatures.
- Static cache-bust bumped:
  - `style.css?v=135`
  - `app.js?v=154`

### Verification
- JavaScript syntax check: `node --check app/static/app.js`

---

## What was built — Session 28.59 (Live screen signal pass — 29 May)

The printer Live tab got a second cockpit polish pass focused on surfacing useful signals without duplicating panels.

### Frontend
- Added a live signal row in the printer cockpit header:
  - clear state shows `Clear skies`
  - faults, paused/offline state, reliability notes, low loaded spools, and AMS mismatches surface as chips
- Styled signal chips with calm/blue, warning/amber, and danger/red treatments.
- Wrapped the Live command controls in a clearer `Command` card.
- Kept temperatures in the cockpit strip and removed the duplicate RHS Live temperature card.
- Static cache-bust bumped:
  - `style.css?v=134`
  - `app.js?v=153`

### Verification
- JavaScript syntax check: `node --check app/static/app.js`
- Whitespace check: `git diff --check`

---

## What was built — Session 28.58 (Live screen cockpit pass — 29 May)

The printer Live tab now has a stronger operator cockpit layout.

### Frontend
- Added a live command header above the camera with:
  - printer/model identity
  - shop name
  - current job or status summary
  - state badge
- Added a camera HUD overlay with:
  - active job/status
  - progress bar when printing
  - compact temperature chips
- Added a live strip under the camera with:
  - temperature chips
  - loaded Flightdeck spool chips with remaining grams
  - low/warn colour treatment for low loaded spools
- Live refreshes update the header, HUD, and strip without rebuilding the whole camera stream.
- Mobile layout stacks the new cockpit blocks cleanly.
- Static cache-bust bumped:
  - `style.css?v=133`
  - `app.js?v=152`

### Verification
- JavaScript syntax check: `node --check app/static/app.js`
- Whitespace check: `git diff --check`
- Browser check on `#/printer/h2d` confirmed the live header, camera HUD, live strip, and detail panels render.

---

## What was built — Session 28.57 (Command palette result grouping — 29 May)

The command palette now groups spool-specific matches so searches like `spool 31`, `label 31`, or `weight spool 31` show one tidy spool result instead of scattering Open, Edit, and Actions through the general list.

### Frontend
- Command items now support optional grouping metadata:
  - `cluster`
  - `clusterLabel`
  - `clusterMeta`
  - `actionLabel`
- Spool command results share a spool cluster and render as one grouped card when multiple actions match.
- Grouped spool results expose quick action buttons:
  - `Open`
  - `Edit`
  - `Actions`
- Added compact grouped-result styling for desktop and mobile.
- Static cache-bust bumped:
  - `style.css?v=132`
  - `app.js?v=151`

### Verification
- JavaScript syntax check: `node --check app/static/app.js`

---

## What was built — Session 28.41 (AMS active-slot deduction hardening — 28 May)

Real print testing on H2D exposed a restart-sensitive spool deduction bug: a single-colour Bambu print could deduct evenly from every assigned AMS/HT slot if Flightdeck restarted between print start and print finish.

### Fix
- Bambu AMS print-start snapshots now persist the active `tray_now` slot in two ways:
  - per-slot `"active": true` on the slot that the printer reports as feeding
  - snapshot `__meta__.active_slot` when Flightdeck captured the active slot in memory
- `db.deduct_spool_usage()` now recovers the active slot from persisted snapshot metadata when its in-memory `active_slot` argument is missing.
- If metadata is missing but exactly one snapshot slot is marked active, deduction uses that slot instead of splitting grams across all loaded spools.

### Behaviour
- Future Bambu spool deductions survive a service restart between print start and print finish.
- If Flightdeck truly cannot identify an active slot, it keeps the existing conservative equal-split fallback rather than guessing.

### Verification
- Python compile: `python -m py_compile app/db.py app/printers/bambu.py`

---

## What was built — Session 28.42 (Notification stale-error guard — 28 May)

Real ntfy testing showed a false pairing: H2D finished a print and X1C sent a `Print error` notification at nearly the same time, even though X1C had no active print row.

### Fix
- Backend ntfy now only sends `Print error` when:
  - the printer was previously `printing`, or
  - the error state has an attached `_error_print_id`.
- Failure snapshots and queue failure cancellation use the same guard, avoiding `failure_snapshot_unavailable` rows for stale Bambu error states with no print row.
- Browser notifications/toasts now use the same stale-error guard.
- Static cache-bust bumped to `v=97`.

### Behaviour
- A stale Bambu `FAILED` state no longer produces a fresh print-error notification when there was no current print.
- Real print failures still notify when the printer transitions from `printing` to `error`.

---

## What was built — Session 28.43 (Safe restart health wait — 28 May)

Real restart testing showed `scripts/safe-restart-flightdeck.sh` can correctly start `flightdeck.service`, but still fail its local health check because `/api/printers` may need more than the old 5s curl window while Bambu MQTT/camera startup settles.

### Fix
- Added `HEALTH_TIMEOUT`, defaulting to 45 seconds.
- Health check now retries `/api/printers` every 2 seconds until it responds or the deadline expires.
- On timeout, the script prints a fuller `systemctl status` block before exiting.

### Behaviour
- Safe restart no longer reports a false failure just because the app was active before the API had finished warming.
- Existing overrides remain available:
  - `STOP_TIMEOUT=...`
  - `START_TIMEOUT=...`
  - `HEALTH_TIMEOUT=...`

---

## What was built — Session 28.44 (Spool usage reconciliation — 28 May)

Real H2D testing showed the slicer filament estimate can be much lower than the actual physical spool loss because purge/prime/waste comes off the same spool.

### Backend
- Bambu AMS print-start snapshots now store `remaining_g_at_start` for each assigned Flightdeck spool.
- Finished-print spool usage entries now include:
  - `remaining_before_g`
  - `remaining_after_g`
  - `remaining_start_g` when captured
- Added `POST /api/prints/{print_id}/spool_usage/{spool_id}/reconcile`.
- Reconcile updates the spool's actual remaining grams, annotates the print usage with `actual_grams` and `waste_grams`, and logs `spool_reconciled` to the decision trail.
- Reconcile can optionally mark one spool as the only spool actually used, removing other usage rows and restoring their wrongly deducted grams.
- Moved spool deduction decision logging outside the write transaction to stop the non-fatal SQLite lock warning during `spool_deducted` logging.

### UI
- History print detail spool usage rows now show a `Reconcile` action.
- Reconcile prompts for the actual remaining grams after a re-weigh.
- If a print predates start-weight capture, Reconcile can also accept a one-off starting gram value.
- If a print has multiple recorded usage rows, Reconcile asks whether the selected spool was the only actual spool used.
- If actual usage exceeds slicer-recorded model grams, the row shows model grams plus purge/waste grams.
- Static cache-bust bumped to `app.js?v=98` and `style.css?v=86`.

---

## What was built — Session 28.45 (Smart weigh-in trial — 29 May)

First pass at making reconciliation useful without turning it into operator homework.

### Behaviour
- History print detail now marks spool usage rows with `Weigh-in suggested` only when the row looks worth checking:
  - multiple spools were recorded for one print
  - the spool is below the low-stock threshold, capped at 20%
  - the spool is near empty
  - the deduction is large relative to remaining stock
- Suggested rows get a subtle amber treatment and the action reads `Weigh`.
- Normal low-risk rows still show the quieter `Reconcile` action and do not nag.

### Cache
- Static cache-bust bumped to `app.js?v=99` and `style.css?v=87`.

---

## What was built — Session 28.46 (Reconciled usage state — 29 May)

- History spool usage rows that already have `actual_grams` now show a quiet green `Reconciled` state instead of continuing to show the `Reconcile` button.
- Static cache-bust bumped to `app.js?v=100` and `style.css?v=88`.

---

## What was built — Session 28.47 (Dashboard badge drill-downs — 29 May)

- Dashboard `Needs attention` badges now link to Failure Review filtered to that printer instead of leaving the operator on a Live screen with no visible explanation.
- Dashboard `Low filament` badges now link to Spools filtered to low loaded spools for that printer.
- Card click handling now ignores nested links/buttons, so badge drill-downs work without triggering the card's Live navigation.
- Failure Review and Spools pages now read simple hash query filters such as `#/failures?printer=h2d` and `#/spools?filter=low&printer=h2d`.
- Static cache-bust bumped to `app.js?v=101` and `style.css?v=89`.

---

## What was built — Session 28.48 (Demote dashboard low-stock badge — 29 May)

- Removed the top-level dashboard `Low filament` badge because it was a raw inventory condition, not necessarily a print-impacting problem.
- Loaded spool percentages still show low/amber/red inside each printer card.
- Queue preflight and Mission Control continue to be the surfaces for actual print-impacting stock risk such as `Loaded filament short` or `Low filament margin`.
- Static cache-bust bumped to `app.js?v=102`.

---

## What was built — Session 28.49 (Demote historical health alarm — 29 May)

- Dashboard historical health signals now show as `Reliability` instead of `Needs attention`.
- Historical failure/cancel/success-rate reasons still link to Failure Review and still appear as a small card note.
- The dashboard `Needs attention` panel now only includes current printer states or actionable health items such as maintenance due / failed queue jobs.
- The former `Health` KPI is now `Review`, so it counts historical review signals without implying an active fault.
- Static cache-bust bumped to `app.js?v=103` and `style.css?v=90`.

---

## What was built — Tier 1 (complete)

### Infrastructure
- FastAPI backend, SQLite, systemd service (`flightdeck.service`)
- `printers.yaml` config: model/custom names, icons, connection info, camera config, temperature presets
- `flightdeck.local` mDNS resolves correctly

### Printer integrations
- **Voron Greyhound Elite V2** — Moonraker polling, layer counts, toolhead position
- **Bambu X1C (Greyhound Ludicrous)** — bambulabs_api MQTT, subtask_name preferred over `plate_1.gcode`
- **Bambu H2D (BigBoy)** — same as X1C; both Bambus on **LAN mode**

### State machine
- States: `PRINTING` / `IDLE` / `PAUSED` / `FINISHED` / `ERROR` / `OFFLINE` / `ESTOP`
- FINISHED persists 30 min post-completion, survives restart via SQLite hydration
- Connection health dots (green/amber/red) per card

### Print history (SQLite `prints` table)
- UPSERT on `(printer_id, job_key)` — idempotent through reconnect storms
- Three lifecycle hooks: `on_print_started`, `on_print_finished`, `on_print_ended`
- Stale orphan cleanup on startup (prints open >24h closed as ERROR)
- "Last print" idle-card row: `Xh Ym`, `cancelled at N%`, `failed at N%`

### UI (Tier 1)
- Card header: brand icon + connection dot + model name + custom name + state badge
- Printing cards: progress bar, layer counter, ETA, filename (subtask_name preferred for Bambu)
- Finished cards: print complete summary + cooling indicator if hotend >50°C
- Idle cards: last print info rows
- Header: status pill + live indicator + clock; footer: host IP + printer counts

### Camera feeds (Tier 1.5)
- **Voron**: MJPEG direct from crowsnest — working
- **X1C**: ffmpeg RTSPS proxy port 322 → MJPEG — working
- **H2D**: RTSPS port 322 — working (LAN mode; printers.yaml `type: bambu_rtsp`)
- 2.5s fallback chain: live → static thumbnail → placeholder

---

## What was built — Tier 2 (complete)

All 10 steps from TIER2_SPEC.md shipped, plus four bonus items.

### Navigation
- Top-level tab strip: per-printer tabs + All Cameras + Queue + Settings, client-side hash routing (`#/printer/{id}`, `#/cameras`, `#/queue`, `#/settings`)
- Per-printer sub-tabs: Live | History; instant client-side switch

### Live sub-tab
- **Two-column layout** — camera left (fills full viewport height), controls+panels right sidebar (320px); stacks to single column on mobile (<900px)
- **Camera click-cycle** — desktop: normal → wide (sidebar hidden, blue outline affordance) → fullscreen → All Cameras view; mobile: tap → fullscreen → tap → normal; ESC returns to normal from any state
- **Print controls** — Pause / Resume / Cancel / E-Stop; optimistic UI; confirmation modals on Cancel and E-Stop
- **Temperature controls** — per-heater actual/target display; ±5° nudge buttons; click reading → numeric modal
- **Temperature modal** — numeric keypad with presets running vertically down the right side, current→target display, hot-value warning (>280° hotend / >120° bed), range clamping with amber flash
- **Temperature display colour-coding** — LEFT/RIGHT/BED/CHAMBER values coloured by safety: red (>200°), blue (at-target / warm-controlled), white (cold/ambient). H2D dual-nozzle display split correctly.
- **Print details panel** — filename/subtask_name, progress bar, layer count, ETA; shows last print info when idle
- **Object exclusion panel** — renders for Moonraker printers when multi-object print active; confirmation modal before exclusion; disabled for Bambu
- **AMS display panel** — per-slot colour swatches, material type, active-slot indicator; Bambu Live tab only; AMS HT unit (ID 128) labelled correctly
- **MMU display panel** — Happy Hare gate state for Voron via `mmu` Moonraker object; gate colours, material, active gate indicator

### History sub-tab
- **Year heatmap** — Jan 1 → Dec 31 grid, Mon–Sun rows; 4-tier green intensity; future cells dimmed
- **Year navigation** — `‹ prev | year | next ›` above heatmap; persists selected year per printer
- **Summary line** — "47 prints · 168h · 4.2kg filament" (FINISHED only)
- **Day detail panel** — click a cell → list of that day's prints with time, duration, state badge
- **Print detail card** — click a print row → full detail (started/ended, duration, layers, filament, error); back button returns to day list instantly (cached)
- **Failure snapshot display** — for prints with snapshot_paths set, embed the captured image inline labelled "Last frame before failure"

### All Cameras view
- Grid of all live MJPEG feeds; tap tile → that printer's Live tab
- Partial update on WS tick — header badge/state updates without resetting the stream
- Offline camera shows placeholder, doesn't break grid

---

## Post-Tier-2 niceties (complete)

- **Browser tab title** — live state in tab: `67% · Greyhound Ludicrous`, `2 printing · Flightdeck`, `⚠ ERROR · Flightdeck`
- **Toast notifications** — slide-in bottom-right on finished/error/paused; auto-dismisses, stacks
- **Bell button** — 🔔 in header; native browser Notification API when HTTPS + permission granted
- **ffmpeg watchdog** — three layers: proc-exit auto-restart, staleness watchdog (8s no-frames), max-session-life cap (15 min, recycles ffmpeg to dodge H2D firmware freeze bug)
- **ntfy.sh push notifications** — server-side transition detection; topic: `flightdeck-c1f2849dcb`
- **Failure snapshot capture** — ERROR/ESTOP/CANCELLED transitions trigger frame grab; stored to `~/flightdeck/snapshots/{printer_id}/{print_id}_{ts}.jpg`
- **Decision log** — `decisions` table (columns: id, print_id, printer_id, event, detail, logged_at) captures state transitions, snapshot captures, calibration captures, reattachments, cancel-vs-error resolutions, relay uploads, spool operations
- **Server-side settings** — `settings` table holds theme, accent colour, temperature unit, time format, preferred slicer, low-stock threshold, queue settings, view-mode preferences. Replaces browser localStorage; syncs across all clients.
- **Slicer settings page** — "Preferred Slicer" picker with cards for OrcaSlicer / Bambu Studio / PrusaSlicer / SuperSlicer; coloured borders + badges per slicer; passive version detection from gcode header at relay upload time
- **OrcaSlicer relay (Voron only)** — Moonraker-shaped endpoints `/api/server/files/upload` + `/api/printer/print/start` per-printer; OrcaSlicer hard-codes Bambu LAN protocol so Bambu relay is not feasible
- **Tailscale Serve HTTPS** — `tailscale serve --bg http://localhost:8000` exposes Flightdeck on `https://flightdeck.tail7de73e.ts.net`. HTTPS Certificates enabled in tailnet admin DNS settings. Required for PWA install + browser notifications.
- **PWA install** — `manifest.json` + minimal service worker (no caching, just installability). Phone home-screen / desktop app install works.
- **Filament tracking** — `material_costs` table (multi-brand per material), cost-per-gram editor with brand support, per-print filament_grams capture, monthly bar chart
- **ETA calibration** — captures slicer estimated_duration_seconds at print start. Computes per-printer ratio after 5+ FINISHED prints. Sample bounded to last 50.
- **Per-printer identity colours on Live tab** — Voron red, X1C green, H2D amber. Coloured name banner + side-strip + sub-tab underline.

---

## What was built — Session 14 (Spool Inventory — 25 May)

Major new subsystem. Real physical filament spool tracking, separate from the cost-catalogue layer.

### Schema
- New `spools` table: `material`, `brand`, `subtype`, `color_hex`, `color_name`, `label_weight_g` (REAL), `remaining_g` (REAL), `location_printer_id`, `location_slot`, `notes`, `added_at`, `archived_at`
- `UNIQUE(location_printer_id, location_slot)` — one spool per loaded slot. SQLite NULL != NULL semantics let multiple storage spools coexist.
- `prints.spool_usage` TEXT — JSON `[{spool_id, grams, slot}]` per finished print
- `prints.ams_slot_snapshot` TEXT — JSON snapshot of slot→material/brand/colour at print start (DB-persisted, survives restart)

### Slot capture at print start (prerequisite work)
- **Bambu (`bambu.py`)**: `_snapshot_ams_slots()` reads `print.ams.ams[].tray[]` at first poll where state=printing AND print_id changes. Idempotent guard via `_ams_slot_snapshot_print_id`. Skips empty slots.
- **Moonraker (`moonraker.py`)**: `_snapshot_mmu_gates()` runs at `on_print_started` if `mmu.enabled`. Skips status=0. Non-MMU Voron untouched.

### Auto-deduction at print end
- On FINISHED state: look up `ams_slot_snapshot`; for each populated slot, find assigned spool at (printer_id, slot); deduct grams from `spools.remaining_g` (clamped to 0)
- Cancelled / errored prints do NOT deduct
- Decision-log events: `spool_deducted` / `spool_overdrawn` / `spool_missing` / `spool_no_deduction_cancelled`

### API endpoints
- `GET/POST/PUT/DELETE /api/spools` + `/archive`, `/restore`, `/reset_weight`, `/move`
- `GET /api/spools/summary` — total weight, count, in-printer, low-stock, by-material
- `GET /api/spools/by-printer/{id}` — slot-keyed dict

### UI — Spools settings tab
- **Summary strip** — 5 stat tiles: Total Inventory, Total Consumed, By Material, In Printer, Low Stock (threshold editable inline, default 20%)
- **Filter chips** — Active/Archived/All/Loaded/Storage/Low Stock + Material/Brand dropdowns + search
- **View toggle** — `[Cards] [Table]`, choice persisted in settings table
- **Card view** — coloured header band using `color_hex` with luminance-aware text contrast; colour name centred; spool # badge; material+subtype/brand/location-pin; progress bar colour-coded (green ≥50%, amber 20-50%, red <20%); action icons
- **Table view** — sortable columns; location text per-printer-type ("Greyhound Elite V2 S1" / "BigBoy AMS HT" / "Greyhound Ludicrous AMS 2 · S1")

### UI — Add Spool modal
- Material + Brand dropdowns with inline "+ Add new" expand flows
- Subtype freeform with autocomplete
- 12 common-colour swatches + hex input + colour-name field
- Label weight (default 1000g) + Remaining weight (defaults to label)
- Location: radio (In storage / Loaded on); cascading printer + slot dropdowns
- Notes freeform
- Validation: slot uniqueness with swap-suggestion

### Post-launch bug fixes (real-use testing — same day)
- Catalogue multi-brand persistence required restart to take effect first time (transient bug, not reproducible)
- Luminance threshold tightened for medium-grey backgrounds

---

## What was built — Session 15 (Polish — 25 May)

- **Per-printer identity colours on Live tab** — Voron red, X1C green, H2D amber. Coloured name banner + side-strip + sub-tab underline. Mutually distinguishable across the room.
- **Duplicate-printer detection on add** — confirmation dialog when new printer's connection details match an existing entry. Three actions: Cancel / View existing / Continue anyway (red destructive styling). Names the existing printer in the message.
- **Notification dedup logic** — ntfy fires server-side always. Browser notification fires only when `document.visibilityState === 'hidden'`. Toast only when visible.
- **Bell button states** — granted/denied/default with appropriate tooltips. `notif-unavailable` class for HTTPS-not-available.

---

## What was built — Session 16 (Print Queue — 26 May)

Per-printer print queue with file upload, drag-reorder, auto-dispatch on print completion, and failed-job rotation.

### Backend
- New `queue_items` table (printer_id, file_path, file_name, file_metadata JSON, status, position, created_at, started_at, completed_at)
- Statuses: `PENDING`, `PRINTING`, `COMPLETED`, `FAILED`
- File upload accepts:
  - Moonraker (Voron): `.gcode`
  - Bambu (X1C/H2D): `.3mf`, `.gcode.3mf`
- Metadata extraction at upload: material, weight, duration, thumbnail (from existing relay pipeline)

### Auto-dispatch
- On FINISHED transition: check for next PENDING item on that printer; dispatch via relay (Voron) or Bambu MQTT print-start
- **Failed jobs moved to end of queue, not skipped or kept blocking** — next PENDING moves up to ready position; failed stays visible at bottom with FAILED status

### Survival
- Queue state persisted to DB; survives service restart cleanly (tested)
- In-flight print at restart resumes queue context

### UI — Queue tab
- Per-printer sections (header: printer name + connection type badge MOONRAKER/BAMBU)
- Drag-drop or click-to-browse upload zone per section with file-format hint
- Queue items show: thumbnail, filename, material/weight/duration metadata, status badge, action buttons (up/down/play/cancel)
- Empty state: "No jobs queued"

### Tested behaviours
- Auto-dispatch on FINISHED ✅
- Failed job moves to end ✅
- Queue survives restart ✅
- OrcaSlicer-from-Voron workflow (same source mesh, switch printer in Orca to slice for Voron, dispatch via queue) ✅

### Note: obsoletes virtual-printer test mechanism
Earlier add/remove stress testing used virtual printer instances pointing at real printer IPs. The print queue + duplicate-detection dialog now cover that use case directly. Virtual printer testing not needed going forward.

---

## What was built — Session 17 (Queue refinements + format additions — 26 May)

### Queue format additions
- Moonraker now accepts `.gcode.gz` (compressed gcode) and `.ufp` (Cura format) in addition to `.gcode`
- Multi-part extension detection fixed (`.gcode.gz` was previously misread as `.gz`)
- Upload zone hint text updated per printer kind

### Queue refinements (all 5 shipped)
1. **Live updates** — `_detectTransitions` triggers `renderQueueView()` on any printer state change; queue page reflects auto-advance in real time without manual refresh
2. **Queue badge** — nav tab shows `Queue (3)` pending count; updated on every WS tick via lightweight `GET /api/queue/summary` endpoint
3. **Retry failed jobs** — purple ↺ button on failed/cancelled jobs; `POST /api/queue/{id}/retry` resets status to pending without re-upload
4. **Bulk clear** — "Clear done" button in section header (visible only when completed jobs exist); `DELETE /api/queue/completed?printer_id=x` deletes DB rows and files on disk
5. **Duration summary** — "3 pending · ~4h 20m" in each section header, summed from `estimated_seconds` on pending jobs

---

## What was built — Session 18 (Maintenance schedule — 26 May)

Printer-specific maintenance scheduling was added as a third per-printer sub-tab after Live and History.

### Backend
- New `maintenance_items` table: `printer_id`, `title`, `notes`, `due_at`, `interval_days`, `interval_prints`, `interval_hours`, `last_completed_at`, timestamps, `archived_at`
- API endpoints:
  - `GET/POST /api/printers/{printer_id}/maintenance`
  - `PUT /api/printers/{printer_id}/maintenance/{item_id}`
  - `POST /api/printers/{printer_id}/maintenance/{item_id}/complete`
  - `DELETE /api/printers/{printer_id}/maintenance/{item_id}` (archives)
- Due status is computed server-side from due date, elapsed days, completed print count, and completed print hours since last completion / creation.
- Completing a repeating day-based task rolls `due_at` forward; one-off date tasks clear `due_at`.
- Decision log events: `maintenance_added`, `maintenance_completed`, `maintenance_archived`

### UI
- New per-printer `Maintenance` sub-tab: `#/printer/{id}/maintenance`
- Add/edit form supports task title, notes, due date, repeat by days, repeat by prints, repeat by print hours
- Task cards show Due/OK badge, schedule progress summary, notes, Done/Edit/Del controls
- Archive confirmation uses existing confirmation modal
- CSS added for responsive maintenance form/cards; cache-bust bumped to static `v=29`

### Verification
- Python compile: `python -m py_compile app/db.py app/main.py`
- FastAPI import smoke: `import app.main`
- JS syntax: `node --check app/static/app.js` via `nvm`
- Maintenance DB smoke test against temporary SQLite DB
- Service restart still needs interactive sudo from user after deploy

---

## What was built — Session 19 (Queue preflight — 26 May)

Preflight readiness checks were added to the print queue. The goal is to prevent dispatch when Flightdeck already knows a job is unsafe or unready, without mutating the queue item into a failed state.

### Backend
- Queue jobs now receive computed `preflight` data from `GET /api/queue` for pending jobs.
- Preflight states: `ready`, `warning`, `waiting`, `blocked`.
- `can_start` is true for ready/warning jobs and false for waiting/blocked jobs.
- Checks include:
  - Printer telemetry available
  - Printer state is idle/finished before dispatch
  - Printer not offline/error/estop
  - No due maintenance items for that printer
  - Loaded spool inventory exists when filament metadata is known
  - Loaded spool material matches job material when metadata is known
  - Loaded spool remaining grams cover job filament grams when metadata is known
  - Low filament margin warning when remaining grams are under 115% of required grams
- Auto-dispatch checks preflight before starting the next pending job. Blocked jobs remain pending at the front of the queue instead of being marked failed or skipped.
- Manual "send now" checks preflight and returns HTTP 409 with preflight details when blocked.
- Decision log event: `queue_preflight_blocked`

### UI
- Queue cards now show a preflight badge beside the queue status badge.
- Preflight issue text is shown inline under the job metadata.
- Send-now button is disabled when preflight `can_start` is false.
- Static cache-bust bumped to `v=30`.

### Verification
- Python compile: `python -m py_compile app/db.py app/main.py`
- FastAPI import smoke: `import app.main`
- JS syntax: `node --check app/static/app.js` via `nvm`
- Preflight DB smoke test against temporary SQLite DB:
  - ready PLA job with matching loaded spool
  - material mismatch blocks
  - overdue maintenance blocks
- Service restart still needs interactive sudo from user after deploy

---

## What was built — Session 20 (Spool traceability — 26 May)

Spool-to-print traceability was added so physical filament inventory can be inspected from both directions. This sets up the future Brother label / QR workflow cleanly: `#/spool/{id}` is now a real detail destination.

### Backend
- New `GET /api/spools/{spool_id}/trace` endpoint.
- New `db.get_spool_trace(spool_id)` helper returns:
  - spool identity and current location
  - `usage_count`
  - `usage_total_g`
  - per-print usage rows derived from `prints.spool_usage`
- `get_prints_for_day()` now includes decoded `spool_usage` JSON for history print detail views.

### UI
- New route: `#/spool/{id}`
- New spool detail page:
  - colour band, spool #, material/subtype, brand, location
  - remaining weight and progress bar
  - consumed/traced stats
  - notes
  - print usage list with print name, printer, date, slot, grams, final state
- Spool inventory card/table rows now include a Details link.
- Print history detail now shows a Spool usage block when a print has `spool_usage`, linking each spool to its detail page.
- Static cache-bust bumped to `v=31`.

### Verification
- Python compile: `python -m py_compile app/db.py app/main.py`
- FastAPI import smoke: `import app.main`
- JS syntax: `node --check app/static/app.js` via `nvm`
- Spool trace DB smoke test against temporary SQLite DB:
  - create spool
  - create finished print
  - write slot snapshot
  - deduct usage
  - verify spool trace lists the print
  - verify history day print includes decoded `spool_usage`
- Service restart still needs interactive sudo from user after deploy

### Follow-up note
- Smoke testing surfaced an existing non-fatal SQLite lock warning in `log_decision()` during spool deduction (`spool_deducted` logging inside a write transaction). Spool deduction and `prints.spool_usage` still write correctly. Consider tidying decision logging around spool deduction in a small future cleanup.

### UI polish follow-up
- Spool inventory `Details` links now use the same lighter pill treatment as the `Edit` button, with cache-bust bumped to `v=32`.

---

## What was built — Session 21 (Failure review — 26 May)

Evidence-based failure review was added as a top-level operational view. It reports observed patterns without claiming causality.

### Backend
- New `GET /api/failures?days=N` endpoint.
- New `db.get_failure_review(days)` helper returns:
  - recent `ERROR`, `CANCELLED`, `ESTOP` prints
  - decoded `spool_usage`
  - snapshot availability
  - progress percent where layer counts exist
  - timing bucket: first 10m / first 25% / mid-print / late print / unknown
  - summary buckets by printer, material, final state, timing, and spool
- Query window is clamped to 1-365 days and returns up to 200 recent rows.

### UI
- New top-level `Failures` tab: `#/failures`
- Failure Review page:
  - 30/90/180/365 day selector
  - filters for printer, state, material
  - summary cards for observed patterns
  - recent failure/cancel list with snapshot thumbnail when available
  - print name, printer, timestamp, material, timing bucket, progress, spool links, error text
- Static cache-bust bumped to `v=33`.

### Verification
- Python compile: `python -m py_compile app/db.py app/main.py`
- FastAPI import smoke: `import app.main`
- JS syntax: `node --check app/static/app.js` via `nvm`
- Failure review DB smoke test against temporary SQLite DB:
  - create failed print
  - verify row appears
  - verify progress/timing bucket
  - verify printer/material summaries
- Service restart still needs interactive sudo from user after deploy

### UI polish follow-up
- `By Timing` card renamed to `Failure Timing`.
- Empty `By Spool` summary card is hidden until spool-linked failures exist.
- Failure rows now include a subtle `History` link back to the printer history surface.
- Failure stat grid now auto-fits, so three-card and four-card states both fill the row cleanly.
- Static cache-bust bumped to `v=34`.

### Flicker fix
- Failure Review no longer re-renders on every websocket/dashboard tick while already active, preventing the brief `Loading...` flash.
- Static cache-bust bumped to `v=35`.

---

## What was built — Session 22 (Printer health score — 26 May)

Compact, explainable printer health was added to the main dashboard cards.

### Backend
- New `db.get_printer_health(printer_id)` helper computes:
  - status: `healthy`, `watch`, `attention`
  - label: `Healthy`, `Watch`, `Needs attention`
  - 14-day print count
  - 14-day failure/cancel count
  - 14-day early failure count
  - 14-day success rate when enough data exists
  - reason list
- Health reasons currently include:
  - due maintenance
  - recent failed/cancelled/estop prints
  - early failures
  - failed queue jobs
  - low recent success rate
- Health data is attached to `/api/printers` websocket/API payloads for each printer.

### UI
- Dashboard printer cards now show a health badge beside the existing state badge.
- Badge states:
  - Healthy: green
  - Watch: amber
  - Needs attention: red
- First health reason is shown as a compact muted line on the card.
- Full reason list is available in the badge tooltip.
- Static cache-bust bumped to `v=36`.

### Verification
- Python compile: `python -m py_compile app/db.py app/main.py`
- FastAPI import smoke: `import app.main`
- JS syntax: `node --check app/static/app.js` via `nvm`
- Printer health DB smoke test against temporary SQLite DB:
  - empty printer reports healthy
  - three recent early failures report attention
- Service restart still needs interactive sudo from user after deploy

---

## What was built — Session 23 (Scale + label hardware integration — 27 May)

First real hardware pass for the Dymo M10 scale and Brother QL-700 label printer.

### Backend
- Added `app/scale.py` for Dymo M10 reads via Linux HID device paths (`/dev/usb/hiddev0`, `/dev/hidraw*`), with stable-read sampling.
- Added `app/label_printer.py` for Brother QL-700 status detection, 40x30 label rendering, optional QR code generation, and USB print dispatch through `brother_ql`.
- New API endpoints:
  - `GET /api/scale/status`
  - `GET /api/scale/read`
  - `GET /api/label_printer/status`
  - `POST /api/label_printer/print/{spool_id}`
  - `POST /api/label_printer/test`
  - `POST /api/spools/{spool_id}/correct_weight`
- Added `empty_spool_weight_g` to spool and material cost records.
- Added decision log events for `scale_read`, `scale_unavailable`, `spool_weight_corrected`, `label_printed`, `label_print_failed`, and `label_printer_unavailable`.
- Added optional auto-label setting: `label_auto_print`.

### UI
- New Settings → Hardware tab with live status cards for:
  - Dymo M10 scale
  - Brother QL-700 label printer
- Hardware tab can read the scale and print a test label.
- Spool inventory cards/tables now include:
  - `Label` button to print a spool label
  - `Weigh` button to correct remaining grams from the scale
- Add/Edit Spool modal now includes:
  - `Empty spool` tare weight
  - `Weigh` button that reads scale grams and subtracts the tare
- Static cache-bust bumped to `v=37`.

### Dependencies
- Added to `requirements.txt`:
  - `pyusb==1.3.1`
  - `qrcode[pil]==8.2`
  - `brother-ql==0.9.4`

### Hardware setup notes
- Brother was previously detected as `04f9:2049` (Editor Lite mass-storage mode). Printing requires printer mode, expected `04f9:2042`.
- Scale was not visible during the first preflight; verify USB, udev rules, and permissions after plugging it in.
- Service restart still needs interactive sudo from user after deploy.

### Session 23.1 refinement
- Label renderer switched from fixed `40x30` to DK-22212 / 62mm continuous roll support.
- Brother print conversion now uses label type `62`.
- Spool label render size is now 696x520 px, roughly a compact 62mm x 44mm cut on the continuous roll.
- Hardware tab reports DK-22212 readiness when the printer is available.
- Scale read failures now tell the operator to wake the scale and retry when the Dymo is asleep/not detected.
- Static cache-bust bumped to `v=38`.

### Session 23.2 hardware detection note
- Real scale identified on the Pi as `0922:8009 Dymo-CoStar Corp. S250 Digital Postal Scale` / `DYMO M25 25 lb`.
- Scale detector now accepts both `0922:8004` and `0922:8009`.
- Current Pi permissions showed `/dev/hidraw0` and `/dev/usb/hiddev0` as `root:root` `0600`; user still needs udev rule / plugdev setup for service access.
- Brother still reports as `04f9:2049` Editor Lite mass-storage mode; printing requires switching it to printer mode.

### Session 23.3 spool inventory layout polish
- Settings layout widened from 1140px to a viewport-aware 1480px max and side-nav footprint tightened.
- Spool card grid now uses wider responsive cards (`minmax(320px, 1fr)`) instead of forcing three narrow columns.
- Spool card action rows wrap cleanly instead of crowding.
- Spool table padding/action spacing tightened to reduce horizontal scrolling.
- Static cache-bust bumped to `v=39`.

### Session 23.4 Brother USB permission detection
- Brother QL-700 now correctly detected in printer mode as `04f9:2042`.
- Actual print failed with `[Errno 13] Access denied (insufficient permissions)`.
- Device node observed as `/dev/bus/usb/003/004` owned by `root:lp` with `0664`; `flightdeck` was not in `lp`.
- Label printer status now checks USB node read/write access and reports permission denied instead of showing READY when print access will fail.
- Print errors now give an operator-facing permission hint.

### Session 23.5 tare defaults + label text layout
- Settings > Filament catalogue now exposes `Tare g` per material/brand.
- Add/Edit Spool now auto-fills `Empty spool` from the selected material/brand tare default for new spools.
- Existing per-spool tare overrides are preserved when editing.
- Scale-backed weigh flow continues to calculate remaining filament as gross scale weight minus tare.
- DK-22212 label layout no longer prints a heavy colour swatch; it uses material/subtype, brand, colour name, spool number, QR, label weight, and date as text.
- Label render height reduced from 520px to 430px to waste less continuous tape.
- Static cache-bust bumped to `v=40`.

### Session 23.6 compact spool cards + colour hex on labels
- Spool cards changed to a denser preview layout:
  - grid minimum width reduced from 320px to 260px
  - card header height reduced from 60px to 42px
  - card padding/type/actions tightened
  - primary actions ordered as Details / Label / Weigh / Edit, with utility icon actions pushed right
- Printed labels now include the colour hex code beside the colour name.
- Static cache-bust bumped to `v=41`.

### Session 23.7 card action polish
- Spool card utility icon actions are now compact text buttons (`Copy`, `Reset`, `Archive`, `Delete`) matching the rest of the card action language.
- Utility actions remain visually secondary; delete is styled as a muted danger action.
- Static cache-bust bumped to `v=42`.

### Session 23.8 table action + density polish
- Spool table actions now use the same compact text button language as card actions.
- Spool summary cards, filter spacing, and table row padding tightened slightly.
- Static cache-bust bumped to `v=43`.

### Session 24 navigation refactor
- Primary app navigation moved from the crowded top tab strip to a persistent left sidebar.
- Sidebar groups:
  - Dashboard
  - Printers
  - Operations: Cameras, Queue, Failures, Spools
  - System: Settings
- Printer-specific Live / History / Maintenance tabs remain horizontal inside each printer page.
- Settings categories now render as horizontal section tabs inside Settings instead of another left rail.
- Added deep links for Settings categories, including `#/settings/spools`; `#/spools` routes directly to the Spools settings category.
- Mobile keeps the primary nav as a horizontal scroll strip.
- Static cache-bust bumped to `v=44`.

### Session 24.1 sidebar heading polish
- Sidebar section headings now use a soft blue accent (`#7aa2d8`) instead of muted grey.
- Added subtle divider lines above sidebar sections to improve scan structure.
- Static cache-bust bumped to `v=45`.

### Session 25 dashboard command overview
- Dashboard now opens with a compact fleet overview strip before the printer cards.
- Added live KPI tiles for total printers, printing, paused, faults, health warnings, and offline printers.
- Added a "Needs attention" panel that links directly to affected printer pages.
- Dashboard printer cards now sort by urgency first: E-stop/error, health attention, paused/watch, printing, offline, finished, idle.
- Static cache-bust bumped to `v=46`.

### Session 25.1 dashboard density polish
- Dashboard KPI tiles were shortened and capped to compact widths so the top overview stops dominating the page.
- Printer card status badges now wrap and use slightly tighter sizing, preventing `Idle` from clipping when health and filament badges are also shown.
- Static cache-bust bumped to `v=47`.

### Session 25.2 stats page + real spool locations
- Dashboard is printer-first again: fleet KPI/attention overview moved to a dedicated `#/stats` page and sidebar item.
- Printer card health lines remain underneath the related printer, keeping attention information beside the affected machine.
- Added backend `spool_locations` storage model and `storage_location_id` on spools.
- Added `/api/spool-locations` endpoints for list/create/update/archive.
- Added Settings > Locations screen for defining real storage locations such as shelves, dry boxes, tubs, or bays.
- Spool add/edit now lets a spool be stored at one of those named locations or loaded on a printer slot.
- Spool cards, table rows, and detail text now show the named storage location instead of generic `Storage`.
- Static cache-bust bumped to `v=48`.

### Session 25.3 spool label hex/location polish
- Spool labels now print the colour hex code on its own dedicated line so it cannot be crowded out by longer colour names.
- Spool labels now include `Loc: <storage location>` only when the spool is stored, not when it is loaded on a printer.
- Spool API records now include `storage_location_name` for label rendering and UI display.

### Session 25.4 spool label location reliability
- Label renderer now computes a dedicated storage-location line and treats blank printer IDs as stored spools.
- Location text is drawn larger and higher on the label so it is more visible on DK-22212 prints.
- Location fallback now accepts either `storage_location_name`, `storage_location`, or `Storage`.

### Session 25.5 spool label location placement
- Stored-spool location moved to the top-right of the label above the QR code.
- Printer-loaded spools still omit location text entirely.

### Session 26 location overview
- Settings > Locations now includes a physical overview grouped by storage location.
- Each location card shows spool count, remaining kg, notes, and the spools currently stored there.
- Stored spool rows show colour, material/subtype, brand, spool ID, remaining grams, and quick actions for Details, Label, and Edit.
- Added an Unassigned Storage card for stored spools without a named location.
- Static cache-bust bumped to `v=49`.

### Session 27 interactive AMS/MMU slots
- AMS and MMU slots/gates on printer Live pages are now clickable slot editors.
- Slot editor shows the current Flightdeck spool assignment, with quick Details, Label, Weigh, and Clear slot actions.
- Stored spools can be assigned directly into the clicked printer slot/gate from the slot editor.
- Assigned slots show the mapped spool ID under the slot and receive a subtle green mapped ring.
- Empty AMS/MMU slots remain visible and clickable so spools can be assigned before the printer reports filament.
- Static cache-bust bumped to `v=50`.

### Session 27.1 AMS/MMU mismatch warnings
- AMS/MMU slots now show an amber warning marker when the printer-reported filament and Flightdeck assignment disagree.
- Warnings cover unassigned printer-loaded filament, assigned spool while printer reports empty, material mismatch, and large colour mismatch.
- Slot editor now shows the printer-reported slot state and a plain-text warning when a mismatch is detected.
- Static cache-bust bumped to `v=51`.

### Session 27.2 slot editor picker polish
- Slot editor now uses a searchable stored-spool picker instead of a long plain dropdown.
- Stored spool choices show colour, material/subtype, brand, spool ID, remaining weight, percent, and storage location.
- Clearing a slot now lets the user choose the storage location to return the spool to.
- Static cache-bust bumped to `v=52`.

### Session 27.3 spool colour paint chart
- Spool modal fixed colour swatches now render as a bounded paint-chart grid instead of a long wrapping toolbar.
- Swatches use square paint chips with stable sizing and vertical scrolling when needed.
- Previously-used colour picks now render as a compact paint chart sorted by spool number and include the spool ID.
- Static cache-bust bumped to `v=53`.

### Session 27.4 spool inventory paint chart
- Main Spools `Cards` view now behaves like a compact paint chart instead of large inventory cards.
- Colour tile cards are smaller, colour-led, and ordered by spool number.
- Card metadata and actions were tightened to fit many more spools on screen while preserving Info, Label, Weigh, Edit, Copy, Reset, Archive, and Delete.
- Static cache-bust bumped to `v=54`.

### Session 27.5 spool action columns
- Added a `Columns` menu to the Spools header so card quick actions can be toggled on/off per browser.
- Spool cards now keep selected quick actions visible and move the full action list into a compact `Actions` dropdown on each card.
- Paint-chart cards were tightened again so more colour tiles fit per row while still keeping all functions available.
- Static cache-bust bumped to `v=55`.

### Session 27.6 spool menu clipping fix
- Fixed the Spools `Columns` dropdown being painted underneath the spool cards.
- Settings content now allows Spools dropdown overlays to render above the page content.
- Static cache-bust bumped to `v=56`.

### Session 27.7 previous colour pills
- Reverted the Add/Edit Spool modal `Previously used` colour picks back to the compact pill buttons.
- Main Spools card paint-chart view was left unchanged.
- Static cache-bust bumped to `v=57`.

### Session 27.8 columns menu spacing
- Spools now adds temporary vertical space below the header while the `Columns` menu is open.
- This keeps the summary/cards from sitting underneath the open columns checklist.
- Static cache-bust bumped to `v=58`.

### Session 28.1 spool intelligence panel
- Added `/api/spools/intelligence`, aggregating recent spool deductions, unattributed finished prints, loaded low-stock risk, overdraw events, and most-used spools.
- Spools page now has a `Spool Intelligence` panel showing the last 30 days of auto-deduct tracking and recent usage.
- This surfaces the existing print-finish deduction engine instead of leaving `spool_usage` hidden in history/detail views.
- Static cache-bust bumped to `v=59`.

### Session 28.2 simplified spool card actions
- Removed the Spools `Columns` button and per-browser quick-action chooser.
- Spool cards now always show only `Label`, `Edit`, and `Actions` on the card footer.
- The `Actions` dropdown still exposes the full function set: Info, Label, Weigh, Edit, Copy, Reset, Archive, and Delete.
- Removed the temporary spacing behavior that existed only for the old `Columns` menu.
- Static cache-bust bumped to `v=60`.

### Session 28.3 fixed spool cockpit
- Spools page now keeps the inventory controls, intelligence panel, summary cards, and filter chips fixed while the card/table list scrolls underneath.
- Both Cards and Table views use the same dedicated `#spool-list` scroll region.
- Table headers now stay visible inside the scrolling list.
- Static cache-bust bumped to `v=61`.

### Session 28.4 H2D camera + Spools top-level
- Spools moved out of Settings into its own top-level `#/spools` view; Settings no longer shows a Spools subtab.
- Old `#/settings/spools` routes now land on the top-level Spools view.
- Bambu RTSP camera proxy now transcodes a lighter 1280px-wide MJPEG stream at 8fps/q5 with low-latency ffmpeg flags to help H2D start reliably in-browser.
- Frontend camera images now use cache-busted stream URLs and retry failed image loads.
- Static cache-bust bumped to `v=62`.

### Session 28.5 Spools nav cleanup
- Standalone Spools view now strips any leftover Settings subnav from the Spools container.
- Added a defensive CSS guard so Settings tabs cannot show inside `#view-spools`.
- Static cache-bust bumped to `v=63`.

### Session 28.6 live light controls
- Live printer detail controls now include light buttons.
- Bambu printers expose `Light On` / `Light Off` via the installed Bambu MQTT API.
- Greyhound Voron exposes `Bars On` / `Bars Off` through Moonraker gcode macros (`STATUS_IDLE` / `STATUS_SLEEP`).
- Light commands are allowed whenever the printer is not offline and clear their pending UI state quickly after the request succeeds.
- Static cache-bust bumped to `v=64`.

### Session 28.7 Bambu light command fix
- Bambu light control no longer uses the library's generic `system.led_mode` command.
- X1C/H2D light buttons now publish Bambu `print.command=ledctrl` with `led_node=chamber_light` and `led_mode=on/off`.
- Static cache-bust bumped to `v=65`.

### Session 28.8 Bambu light badge
- Printer status now includes Bambu chamber light state from `lights_report`.
- Bambu model text glows when `light_state` is `on` and dims when `off`/`unknown`.
- Light button clicks apply an optimistic glow/dim immediately, then settle to the reported MQTT state.
- Static cache-bust bumped to `v=66`.

### Session 28.9 Bambu word toggle
- Removed separate `Light On` / `Light Off` buttons from Bambu live controls.
- Added a single glowing `Bambu` word control; clicking it toggles the chamber light on/off.
- Bambu model labels remain clickable light toggles and stop dashboard/camera tile navigation when clicked directly.
- Static cache-bust bumped to `v=67`.

### Session 28.10 Bambu camera/light recovery
- Bambu RTSP watchdog now detects byte-identical frozen frames, not just missing frames, and recycles ffmpeg after 8 seconds of frozen output.
- Bambu light control now publishes `system.command=ledctrl` with `led_node=chamber_light` and timing fields, matching known Bambu MQTT light commands.
- This fixes the case where Flightdeck returned `200 OK` but H2D/X1C ignored the previous `print.command=ledctrl` payload.

### Session 28.11 printer label cleanup
- Sidebar printer links now use machine model names (`Voron`, `X1C`, `H2D`) instead of shop/custom names.
- Queue printer group labels now use the same machine names.
- Shop/custom names remain unchanged as secondary labels on cards/detail/camera surfaces.
- Static cache-bust bumped to `v=68`.

### Session 28.12 H2D paired light control
- H2D light on/off now publishes the same MQTT command to `chamber_light`, `chamber_light2`, and `work_light` so both light bars move together.
- Bambu light state now reads all reported light modes and treats the printer as lit if any known channel is on.
- Removed the duplicate Bambu light click path on the printer detail view so one click sends one toggle command.
- Static cache-bust bumped to `v=69`.

### Session 28.13 shelf location cleanup
- Removed the generic seeded `Storage` location and kept the default physical shelf locations (`Shelf #1`, `Shelf #2`, `Shelf #3`).
- Startup migration moves any spools still assigned to `Storage` onto `Shelf #1` before archiving the generic location.
- Location fallback labels now read `Unassigned` instead of `Storage`.
- The Locations settings content and each shelf's spool list are scrollable so long shelf lists remain reachable.
- Static cache-bust bumped to `v=70`.

### Session 28.14 AMS slot metadata sync
- Assigning a Flightdeck spool to a Bambu AMS slot now best-effort syncs the printer's own AMS metadata using Bambu `ams_filament_setting`.
- Moving a spool away from a Bambu AMS slot now best-effort clears that printer slot's filament metadata.
- Generic Flightdeck materials are mapped to Bambu-compatible material families (`PLA`, `ASA`, `ABS`, `PETG`, `TPU`, etc.) before publishing.
- The spool modal keeps the friendly `Storage:` label, while the Locations overview stays shelf-only.
- Static cache-bust bumped to `v=71`.

### Session 28.15 AMS drying control
- AMS units now expose humidity, temperature, drying countdown, and drying capability when reported by Bambu MQTT.
- Heated AMS units such as AMS HT can be started/stopped from the live AMS panel using Bambu `ams_filament_drying`.
- Default manual dry cycle is conservative: 45°C for 12 hours, no tray rotation; Stop sends Bambu's drying-off payload.
- Static cache-bust bumped to `v=72`.

### Session 28.16 AMS drying presets
- Raw H2D MQTT inspection showed `humidity_raw` is the actual RH value and `humidity` is Bambu's level indicator.
- AMS parsing now uses `humidity_raw` for `% RH` and keeps Bambu's level separately as `humidity_level`.
- Drying payload now includes Bambu's reported setting fields: `dry_filament`, `dry_temperature`, and `dry_duration`.
- Drying now opens a Flightdeck dialog with filament presets (`PLA`, `PETG`, `ABS`, `ASA`, `TPU`, `PA`, `PC`), temperature, duration, and rotate option.
- Static cache-bust bumped to `v=73`.

### Session 28.17 AMS drying screen polish
- Reworked the AMS drying dialog into a richer Flightdeck control surface with AMS/printer subtitle, RH/temp/state chips, preset selector, sliders, rotate toggle, and stronger Start/Stop actions.
- Temperature and duration controls now use range sliders with live readouts and preset-driven defaults.
- Static cache-bust bumped to `v=74`.

### Session 28.18 safe restart helper
- Added `scripts/safe-restart-flightdeck.sh` for restarts that hang on lingering Bambu RTSP `ffmpeg` or Flightdeck `uvicorn` processes.
- Helper stops `flightdeck.service` with a timeout, terminates only Flightdeck-owned leftovers, starts the service, and prints a compact `/api/printers` health check.
- README now documents `sudo ./scripts/safe-restart-flightdeck.sh`.

### Session 28.19 Mission Control v1
- Added a new top-level `Mission Control` navigation screen (`#/mission`).
- Mission Control combines printer state, queue jobs, spool inventory, health reasons, and maintenance data into a fleet forecast view.
- Added fleet KPIs for pending jobs, blocked jobs, caution jobs, and queued time forecast.
- Added per-printer mission lanes with current action, queue timeline blocks, loaded spool pills, and operator signals.
- Added a right-side Next Dispatch panel that ranks upcoming queued/blocked work.
- Static cache-bust bumped to `v=75`.

### Session 28.20 Mission Control anti-flicker
- Fixed Mission Control flashing by keeping the rendered screen visible while refresh data loads.
- Added an in-flight render guard so websocket ticks cannot stack overlapping Mission Control refreshes.
- Mission Control now only swaps DOM markup when the generated view actually changes.
- Static cache-bust bumped to `v=76`.

### Session 28.21 Mission Control fleet scaling
- Fixed Mission Control queue detail overflow by constraining long queue blocks and filenames inside their lane.
- Added automatic dense fleet mode for Mission Control once the printer count reaches 8+ printers.
- Dense mode changes lanes into a multi-column fleet board and limits visible queue blocks per printer with a `+N more` queue link.
- Static cache-bust bumped to `v=77`.

### Session 28.22 AMS drying polish/fix
- Changed AMS drying MQTT command payload to the lean firmware-compatible `ams_filament_drying` shape.
- Capped AMS 2 Pro drying temperature at 65°C while keeping AMS HT up to 85°C.
- Changed AMS drying UI accents from orange to Flightdeck blue.
- Tightened AMS slot sizing and spacing so four-slot AMS rows fit in the live sidebar without wrapping.
- Static cache-bust bumped to `v=78`.

### Session 28.23 AMS drying diagnostics
- Matched Flightdeck's AMS drying payload to the observed Bambu MQTT wire shape, including `filament` and `close_power_conflict`.
- Parsed Bambu `dry_sf_reason`, `dry_status`, and `dry_sub_status` from raw AMS MQTT.
- Added backend guardrails so blocked drying starts return a useful 409 error instead of silently doing nothing.
- Added AMS drying modal warning text for known block reasons such as filament sitting at the AMS outlet.
- Static cache-bust bumped to `v=79`.

### Session 28.24 Mission Control dispatch board
- Added Mission Control status filters for All, Ready, Printing, Needs attention, and Blocked printers.
- Split the side panel into `Dispatch Ready` and `Blocked` queue lists so startable work and queue issues are separated.
- Added a 30-printer simulation toggle on Mission Control to stress-test dense fleet layout without changing real printer config.
- Added lane bucket styling and empty-filter states for the dispatch board.
- Static cache-bust bumped to `v=80`.

### Session 28.25 Simulated camera wall
- Added a `View 30 cameras` link when Mission Control's 30-printer simulation is active.
- Added `#/cameras?sim=30`, which renders thirty simulated camera tiles using the existing real camera sources instead of opening thirty unique feeds.
- Simulated camera tiles are clearly labelled and use a denser grid for wall-scale layout testing.
- Static cache-bust bumped to `v=81`.

### Session 28.26 Dispatch intelligence v1
- Added advisory Dispatch Intel to Mission Control's side panel.
- Dispatch Intel scores queued pending jobs against each real printer by availability, loaded matching material, stock level, health, maintenance, and current queue target.
- Recommendations are read-only and do not move, start, or retarget queue jobs.
- Static cache-bust bumped to `v=82`.

### Session 28.27 Dispatch material rescue
- Dispatch Intel now explains material rescue paths for pending jobs.
- It distinguishes ready-now loaded filament, same-printer slot selection, shelf/storage spool loading, and no-single-spool-enough cases.
- Rescue hints include spool number, material/brand, remaining grams, and storage/slot location.
- Static cache-bust bumped to `v=83`.

### Session 28.28 Mission Control sidebar compacting
- Tightened Mission Control right-panel job cards to reduce overflow.
- Added clamping/ellipsis for long Dispatch Intel filenames and recommendation text.
- Gave the sidebar a responsive width clamp while keeping the main printer lanes flexible.
- Static cache-bust bumped to `v=84`.

### Session 28.29 Queue colour-aware dispatch
- Added `filament_colors` metadata to queued jobs and 3MF parsing.
- Queue preflight now treats slicer filament colours as a constraint when colour metadata is present.
- Mission Control Dispatch Intel now displays required colours and only suggests loaded/shelf spools whose colours match within tolerance.
- Existing queued 3MF files can be backfilled from their saved upload files.
- Static cache-bust bumped to `v=85`.

### Session 28.30 Multi-colour dispatch coverage
- Backfilled existing queued 3MF files so the current queue now exposes slicer colour metadata through `/api/queue`.
- Tightened Mission Control Dispatch Intel so multi-colour jobs require coverage for every required colour, not just one matching colour.
- Dispatch rescue hints now pick per-colour spool coverage before suggesting loaded, same-printer, shelf, or mixed stock paths.
- Printer recommendation scoring now treats partial colour coverage as a weaker match instead of calling it fully ready.
- Static cache-bust bumped to `v=86`.

### Session 28.31 Queue preflight colour coverage
- Queue preflight now groups slicer filament colour metadata by required colour and grams.
- Multi-colour queued jobs now check each loaded colour independently instead of summing all matching-material loaded spools.
- Preflight block messages now identify the short colour directly, e.g. `Loaded colour coverage short: #FFFFFF 118g/280g`.
- Restarted `flightdeck.service`; API health is OK after startup.

### Session 28.32 Friendly colour names
- Preflight colour shortfall messages now display nearest plain colour names such as `White 118g/280g` instead of raw hex values.
- Mission Control Dispatch Intel now shows required colour names like `White / Brown` instead of `#FFFFFF / #7C4B00`.
- Colour matching still uses hex distance tolerance under the hood so near-white/off-white slicer values can match a white spool.
- Static cache-bust bumped to `v=87`.

### Session 28.33 Brand-aware colour coverage
- Queue preflight colour shortfall messages now include matching loaded inventory brands, e.g. `White (3DFillies) 118g/280g`.
- If no loaded spool matches the required colour/material, preflight says `White (no loaded spool) 0g/280g`.
- Mission Control missing-colour rescue text now includes candidate brand and grams where possible.
- Static cache-bust bumped to `v=88`.

### Session 28.34 Dispatch Intel duplicate grouping
- Mission Control Dispatch Intel now groups duplicate pending jobs by filename, material, grams, and required colours.
- Duplicate queue copies are shown as one advisory row with a `N queue copies` note instead of repeated recommendations.
- Recommendation change detection now treats any duplicate target as already represented, avoiding noisy `Recommend H2D` wording for a copy already queued to H2D.
- Static cache-bust bumped to `v=89`.

### Session 28.35 Queue Fix It panel
- Added a Mission Control `Fix It` panel between `Blocked` and `Dispatch Intel`.
- Fix It groups duplicate blocked queue jobs and translates preflight failures into physical next actions.
- Colour-aware steps can suggest loading a specific shelf spool, adding/loading a missing colour, or checking a short loaded colour/brand.
- Duplicate queue copies use the best matching target printer for advice, so H2D-targetable copies get H2D-focused steps.
- Static cache-bust bumped to `v=90`.

### Session 28.36 Filament catalogue import
- Added local SQLite `filament_catalog` cache for brand/material/product/colour/hex/weight/tare data.
- Added Open Filament Database sync/search endpoints:
  - `POST /api/filament/catalog/sync`
  - `GET /api/filament/catalog/search`
  - `GET /api/filament/catalog/status`
- Add Spool modal now has a Catalogue search field and Sync button.
- Selecting a catalogue result fills material, brand, subtype/product, colour name, hex, label weight, and tare if known.
- Static cache-bust bumped to `v=91`.
- Fixed catalogue sync fetch headers/fallback mirror and timestamp handling.
- Sync verified on the Pi: imported 18k+ usable 1.75mm catalogue rows; `bambu white pla` returns Bambu Lab results.
- Catalogue search ordering now prioritises everyday materials for broad brand searches, so `bambu` shows PLA before ABS.
- Add Spool catalogue search now asks for 30 results instead of 12.
- Add Spool catalogue results panel is taller and includes a hint when broad searches return many matches.
- Static cache-bust bumped to `v=93`.

### Session 28.37 Catalogue-first spool modal
- Reworked Add Spool into a wider two-column modal.
- Left column is now a pinned catalogue browser with large searchable result cards.
- Right column is the spool confirmation/edit panel for material, brand, colour, weight, tare, location, and notes.
- Selecting a catalogue entry now shows a selected-source card while filling the spool fields.
- Mobile/narrow screens fall back to the stacked single-column flow.
- Static cache-bust bumped to `v=94`.

### Session 28.38 Catalogue picker polish
- Added quick catalogue chips for common materials and brands: PLA, PLA+, PETG, ASA, ABS, TPU, Bambu, 3DFillies, Polymaker.
- Catalogue selected-source card now shows `Open Filament Database · editable defaults` so imported values are clearly defaults.
- If the catalogue entry has no tare, Add Spool now falls back to the saved brand/material tare from Filament settings when available.
- Static cache-bust bumped to `v=95`.

### Session 28.39 Active AMS slot preflight guard
- Added a hard queue preflight guard for single-colour Bambu jobs when the printer-reported active AMS slot does not match the queued job's required material/colour.
- This catches cases where Flightdeck inventory says the right colour exists somewhere, but the printer is actually using another active tray.
- Example intended block: `Active AMS slot mismatch: printer is using AMS 1 slot 1 (Black PLA), expected Yellow PLA`.
- Deploy copied `app/main.py`, but service restart is pending because sudo requested a password. Run `sudo systemctl restart flightdeck.service`.

### Session 28.40 Catalogue chip cleanup
- Removed the `3DFillies` quick chip from the Add Spool catalogue picker because that brand is no longer in current use.
- Existing 3DFillies spool/history data is untouched.
- Static cache-bust bumped to `v=96`.

---

## Known issues

- Service restart pending for Sessions 18/19/20/21/22/23 until user runs `sudo systemctl restart flightdeck.service`.
- Hardware setup still needs real-device confirmation after deploy:
  - Brother QL-700 must be switched out of Editor Lite mass-storage mode before printing (`lsusb` should show `04f9:2042`, not `04f9:2049`).
  - Dymo M10 scale was not detected in the last preflight; plug/wake it and apply udev rules if `/dev/hidraw*` or `/dev/usb/hiddev*` is inaccessible.

---

## Next session priorities

### Latest dashboard attention cleanup
- Dashboard card health badges now only appear for actionable items, not ordinary failure-history review.
- Historical failure/success-rate context is shown as a quiet `Reliability` line that links to Failure Review.
- Mission Control no longer buckets printers into `Needs attention` or penalises dispatch score purely because of reliability history or low loaded-spool percentage.
- Mission Control attention is now reserved for current faults, paused/offline states, overdue maintenance, and failed queue jobs.
- Static cache-bust bumped to `style.css?v=91` and `app.js?v=104`.

### Mission Control Action Inbox
- Added an `Action Inbox` at the top of the Mission Control right panel, above the supporting legend/note.
- Inbox entries are derived from live printer state, maintenance due, failed queue jobs, blocked preflight, and queue cautions.
- Empty state now reads `Clear deck` so the panel still confirms there is nothing active to do.
- Static cache-bust bumped to `style.css?v=92` and `app.js?v=105`.

### Stats page upgrade
- Reworked Stats from a plain dashboard KPI repeat into a fleet telemetry page.
- Added operator pulse, fleet/material/inventory/reliability KPI cards, filament trend chart, material and inventory bar panels, spool tracking panel, most-used spools, and printer balance table.
- Stats uses existing endpoints only: `/api/filament/summary`, `/api/spools/summary`, `/api/spools`, `/api/spools/intelligence`, `/api/failures`, and `/api/queue`.
- Static cache-bust bumped to `style.css?v=93` and `app.js?v=106`.

### Stats AMS humidity
- Added AMS RH to the Stats KPI strip with average RH, max RH, and sensor count.
- Added an `AMS Humidity` panel showing each AMS/HT humidity and temperature reading by printer.
- RH status colours are currently green under 35%, amber from 35%, and red from 45%.
- Static cache-bust bumped to `style.css?v=94` and `app.js?v=107`.

### Stats renamed to Telemetry
- Sidebar label changed from `Stats` to `Telemetry`.
- Page eyebrow/loading/error copy changed to telemetry language.
- Route remains `#/stats` for compatibility with existing links and browser history.
- Static cache-bust bumped to `app.js?v=108` only.

### Telemetry drill-downs
- `#/stats` now accepts query params without dropping back to the dashboard.
- Telemetry printer KPI links to `#/stats?focus=printers`, highlighting Printer Balance.
- AMS RH KPI and AMS Humidity panel link to `#/stats?focus=rh`, which opens a Humidity Detail drill-down.
- Humidity Detail shows the highest RH bay first with a dry/watch/ok recommendation and the full AMS RH list underneath.
- Static cache-bust bumped to `style.css?v=95` and `app.js?v=109`.

### Moisture Watch
- Added a current-conditions Moisture Watch classifier using AMS RH telemetry.
- Status thresholds match RH colours: stable under 35%, watch from 35%, drying suggested from 45%.
- Telemetry RH detail now separates Moisture Watch recommendations from raw sensor readings.
- Mission Control Action Inbox now surfaces amber/red Moisture Watch items as operator actions linking to `#/stats?focus=rh`.
- Static cache-bust bumped to `style.css?v=96` and `app.js?v=110`.

### Moisture Watch persistence
- Moisture Watch now keeps a lightweight browser-side timer per AMS bay so alerts include how long the RH condition has persisted; it uses local storage with an in-memory fallback for embedded browsers.
- Telemetry still shows current watch/dry conditions immediately, but Mission Control only raises operator actions after persistence thresholds: watch for 15m, dry for 5m.
- Non-persistent RH rows show "Tracking before Mission Control alert" to make the quiet period visible.
- Static cache-bust bumped to `style.css?v=97` and `app.js?v=111`.

### Spool edit clear fix
- Fixed `PUT /api/spools/{id}` so explicitly cleared optional fields, such as subtype, are written as `NULL` instead of being ignored.
- This fixes the edit form reverting a removed subtype back to the old value.

### Flight Tower rename
- Renamed the visible `Mission Control` screen/nav wording to `Flight Tower`.
- Internal route remains `#/mission` for compatibility.
- Static cache-bust bumped to `app.js?v=112`.

### Spool confidence
- Added a backend confidence signal for spool remaining weights using entry age, print deductions, scale reconciles, tare presence, low-stock state, and overdraw history.
- Spool cards and table now show `Verified`, `Estimated`, or `Needs weigh-in` with a score tooltip.
- Spool detail now includes a Weight Confidence panel with short reasons.
- Static cache-bust bumped to `style.css?v=98` and `app.js?v=113`.

### Filament cabinet view
- Added a third Spools view mode: `Cabinet`.
- Cabinet groups stored spools by configured shelf/location and sorts tiles by spool number like a paint chart.
- Each shelf lane scrolls independently and shows colour, spool number, material, brand, remaining grams, plus quick Label/Edit actions.
- Loaded printer spools appear in a separate Loaded lane when included by filters.
- Static cache-bust bumped to `style.css?v=99` and `app.js?v=114`.

### File Desk v1
- Added a new `Files` navigation screen for a read-only file desk.
- Pi print library defaults to `/home/flightdeck/print_library`.
- `GET /api/files` lists the Pi library, Voron Moonraker gcodes, and Bambu SD cards through existing LAN/FTPS details.
- Bambu targets expose `format_sd` capability metadata but no destructive format action is wired yet.
- Static cache-bust bumped to `style.css?v=100` and `app.js?v=115`.

### File Desk anti-flicker
- File Desk now keeps the previous rendered screen visible during refresh.
- Added an in-flight render guard so websocket/router refreshes cannot stack overlapping File Desk fetches.
- DOM is only swapped when the generated File Desk HTML actually changes.
- Static cache-bust bumped to `app.js?v=116`.

### File Desk queue action
- Added `POST /api/files/queue` to copy a File Desk item into the normal Flightdeck queue storage and create a pending queue job.
- Supports Pi library, Bambu SD files via FTPS, and Voron Moonraker files.
- Queue action only appears for compatible target types: `.3mf/.gcode.3mf` to Bambu, `.gcode/.gcode.gz/.ufp` to Moonraker.
- File Desk rows now have a `Queue` action that prompts for the compatible target printer and then jumps to Queue.
- Static cache-bust bumped to `style.css?v=101` and `app.js?v=117`.

### File Desk queue picker polish
- Replaced the native browser `prompt()`/`alert()` queue flow with an in-app Flightdeck modal picker.
- Moved the `Queue` action into the filename cell so it is visible without horizontal scrolling.
- Removed the separate Path/Actions columns; the path now sits under the filename in muted text.
- Queue cancel/close no longer leaves stale `Queued`/clicked button state behind when returning to Files.
- Static cache-bust bumped to `style.css?v=102` and `app.js?v=118`.

### File Desk and Queue native dialog cleanup
- File Desk now hides non-printable rows, so Bambu utility folders such as `ipcam`, `timelapse`, and `System Volume Information` no longer appear as printable items even when the SD card reports them as files.
- Queue job removal now uses the in-app Flightdeck confirmation modal instead of the browser `confirm()` dialog.
- Queue action failures now use Flightdeck toast errors instead of browser alerts.
- Static cache-bust bumped to `app.js?v=119`.

### File Desk Bambu SD cleanout
- Added guarded Bambu-only SD cleanout from File Desk.
- Backend endpoint: `POST /api/files/bambu/{printer_id}/clear`.
- The action requires typed `CLEAR`, refuses to run while the printer is printing/paused, and deletes printable `.3mf` jobs from the SD root while leaving utility folders alone.
- UI exposes `Clear SD prints` only on Bambu File Desk targets, with an in-app confirmation dialog and toast result.
- Static cache-bust bumped to `style.css?v=103` and `app.js?v=120`.

### File Desk copy and delete actions
- Added `Copy` row action for pulling Bambu SD or Voron Moonraker files into the Pi Library.
- Backend endpoint: `POST /api/files/library/copy`; duplicate filenames are kept by adding a numeric suffix.
- Added guarded `Delete` row action for Pi Library, Bambu SD, and Moonraker files.
- Backend endpoint: `DELETE /api/files`; requires typed `DELETE` and only permits supported printable file types.
- File Desk rows now show `Queue`, `Copy` (when not already in library), and `Delete` grouped beside the filename.
- Static cache-bust bumped to `style.css?v=104` and `app.js?v=121`.

### File Desk bulk selection
- Reworked File Desk file actions around checkbox selection.
- Each target now has select-all plus per-file checkboxes.
- Row actions are quieter: `Queue` stays inline, while `Copy selected` and `Delete selected` live in a per-target bulk toolbar.
- Bulk copy runs selected files sequentially into Pi Library.
- Bulk delete requires typed `DELETE` and shows the selected filenames before removing them.
- Static cache-bust bumped to `style.css?v=105` and `app.js?v=122`.

### File Desk copy replace prompt
- Copy-to-library now detects filename conflicts instead of silently creating numbered duplicates.
- `POST /api/files/library/copy` returns `409` with conflict metadata when a matching Pi Library filename already exists.
- The bulk copy UI now asks whether to `Replace` or `Skip` each conflicting file and continues through the selected set.
- Static cache-bust bumped to `style.css?v=106` and `app.js?v=123`.

### File Desk command refresh polish
- File Desk commands no longer clear the render cache before refreshing.
- Copy, delete, clear-SD, and queue actions now keep the current File Desk visible while the refresh runs.
- The DOM only swaps when the actual file-list HTML changes, removing the brief loading/blank flash after commands.
- Static cache-bust bumped to `app.js?v=124`.

### Portable runtime data paths
- Added `app/paths.py` as the single runtime path resolver.
- Flightdeck now reads `.env` early and supports `FLIGHTDECK_DATA_DIR` plus explicit overrides for DB, uploads, printer config, and print library paths.
- Current Pi behavior is preserved until migration: repo-local `flightdeck.db`, repo-local `uploads/`, repo-local `printers.yaml`, and `/home/flightdeck/print_library`.
- Clean installs can keep live data outside git in `~/flightdeck-data`.
- Added `printers.yaml.example`, `flightdeck.service.example`, `scripts/install.sh`, `scripts/install-systemd.sh`, and `scripts/migrate-to-portable-data.sh`.
- Updated README install/migration notes.
- `printers.yaml` should be untracked from git so real printer IPs, access codes, and serials never ship in a clean clone.

### Settings preferences
- Added server-side default settings so fresh installs have sensible values before any UI changes.
- Added `Settings > Preferences` for system base URL, spool thresholds, default label weight, printed label fields, and queue colour matching posture.
- Label QR codes now use `system_base_url` instead of a hard-coded Tailscale URL.
- Label field toggles can hide colour, brand, or storage location on future spool labels.
- Add Spool now uses `default_label_weight_g`.
- Queue preflight colour mismatches respect `queue_strict_colour`: strict blocks, advisory warns.
- Static cache-bust bumped to `app.js?v=125`.

### Setup health
- Added `GET /api/setup/health` to audit the running install.
- Checks app checkout, data directory, SQLite DB, uploads, print library, printer config, base URL, ntfy, Dymo scale, QL-700, and systemd service status.
- Added `Settings > Setup` as the first settings tab with required/optional readiness summary and runtime path readout.
- Static cache-bust bumped to `style.css?v=107` and `app.js?v=126`.

### Notification centre
- Added persistent `notifications` table plus APIs to list, mark read, clear one, and clear all.
- Print complete, error, paused, and cancelled transitions now create in-app notifications while keeping ntfy/browser notifications.
- Header bell now opens a notification centre with unread count, recent events, click-through links, and clear actions.
- Browser notification permission can be enabled from inside the notification centre.
- Static cache-bust bumped to `style.css?v=108` and `app.js?v=127`.

### Radar header control
- Replaced the generic notification bell with a compact `RADAR` control and CSS radar mark.
- Notification centre behavior and unread badge are unchanged.
- Static cache-bust bumped to `style.css?v=109` and `app.js?v=128`.

### Browser dialog cleanup
- Replaced remaining native browser `alert` / `prompt` / `confirm` calls with Flightdeck-styled confirm/input modals and toasts.
- Covered spool reconcile, spool archive/reset/delete, weigh flows, label printing failures, AMS drying failures, filament catalogue sync/delete failures, and scale read failures.
- Hardware and catalogue failures now also write RADAR notification entries from the backend.
- Static cache-bust bumped to `style.css?v=110` and `app.js?v=129`.

### Grouped spool cards
- Card view now groups duplicate physical rolls that share material, subtype, brand, colour name/hex, and label weight.
- Each physical roll keeps its own spool number, detail page, label, edit, weigh, copy, reset, archive, and delete actions.
- Group cards show roll chips, combined remaining grams, combined label weight, location summary, and per-roll rows.
- Table and cabinet views still show individual rolls.
- Static cache-bust bumped to `style.css?v=111` and `app.js?v=130`.

### Grouped card polish
- Moved per-roll controls inside a compact expandable `Rolls` drawer on grouped cards.
- The default grouped card now reads like a paint-chart tile: colour, material, roll chips, combined remaining stock, and one compact drawer for individual actions.
- Static cache-bust bumped to `style.css?v=112` and `app.js?v=131`.

### App shell cache guard
- Static files and the root app shell now send `Cache-Control: no-store` so UI updates do not get stuck behind an old browser module.
- This requires a backend restart because it changes FastAPI static serving.

### Grouped spool compact pass
- Grouped cards now use the same grid footprint as normal spool cards instead of spanning two columns.
- Reduced visible grouped-card metadata and kept individual roll actions behind the `Rolls` drawer.
- Raised RADAR notification panel above the Spools toolbar/filter layer.
- Static cache-bust bumped to `style.css?v=113` and `app.js?v=132`.

### Grouped roll drawer polish
- Open grouped-card drawers now render as compact per-roll rows: spool number, grams, location, and one Actions menu.
- Removed always-visible Label/Edit buttons from each roll row to keep 3+ roll stacks readable.
- Static cache-bust bumped to `style.css?v=114` and `app.js?v=133`.

### Grouped drawer overflow fix
- Removed nested Actions dropdowns from grouped-card roll drawers because they could overlap neighbouring spool cards.
- Each roll row now exposes compact inline Label, Edit, and Info actions with no flyout.
- Static cache-bust bumped to `style.css?v=115` and `app.js?v=134`.

### Multiples spool filter
- Added a `Multiples` chip above the spool colour chart.
- The chip filters the current spool list down to duplicate physical rolls sharing the same material, subtype, brand, colour, and label weight.
- Static cache-bust bumped to `style.css?v=116` and `app.js?v=135`.

### Spool action row tidy
- Normal spool cards now use a fixed three-slot `Label / Edit / Actions` layout so buttons stay aligned across cards.
- Grouped drawer rows use the same three-slot alignment for `Label / Edit / Info`.
- Static cache-bust bumped to `style.css?v=117` and `app.js?v=136`.

### Spool card breathing room
- Increased colour-chart card minimum width slightly so `Actions` fits cleanly.
- Grouped drawer rows now use one compact `Manage` button per physical roll, opening a centred spool action picker.
- Static cache-bust bumped to `style.css?v=118` and `app.js?v=137`.

### Spool action clipping fix
- Increased the colour-chart card minimum width again for the real Spools viewport.
- Reduced action-button horizontal padding so `Label / Edit / Actions` fits without clipping.
- Static cache-bust bumped to `style.css?v=119` and `app.js?v=138`.

### Header status polish
- Centred the Flightdeck wordmark in the top header.
- Upsized the centred Flightdeck logo/wordmark so it anchors the header visually.
- Moved aggregate system state to the left side of the header.
- Renamed the old `RADAR` notification button to `Alerts`.
- Moved the clock into the left-hand system status cluster for better header balance.
- Swapped `Alerts` before the live radar so its dropdown opens inward instead of clipping off-screen.
- Made the alerts dropdown viewport-fixed so it cannot clip off the right edge on narrow windows.
- Added a deliberate mobile header stack: logo row, status row, then Alerts/Live row.
- Replaced the small live dot with a larger animated radar sweep for live/reconnect state.
- Static cache-bust bumped to `style.css?v=127` and `app.js?v=144`.

### Command palette
- Added a global command palette opened with `Ctrl/Cmd+K`.
- Palette supports searchable navigation for Dashboard, Flight Tower, Telemetry, Cameras, Queue, Files, Failures, Spools, and Settings.
- Added printer commands for live, history, and maintenance subtabs.
- Added spool commands for opening individual active spools, low-stock/loaded filters, cabinet view, and Add Spool.
- Palette supports keyboard operation: arrows to move, Enter to run, Escape to close.
- Empty palette now keeps the core navigation order before search ranking kicks in.
- Static cache-bust bumped to `style.css?v=128` and `app.js?v=146`.

### Spools catalogue workflow
- Add/Edit Spool modal now keeps the catalogue pane in its own scrollable column so the form/actions remain reachable.
- Moved filament catalogue management into Spools as a `Catalogue` view alongside Cards/Table/Cabinet.
- Moved the catalogue `Add material type` form to the top of the Catalogue view and made it sticky while the catalogue list scrolls below.
- Removed Filament from the Settings side navigation; legacy `#/settings/filament` redirects into `#/spools?view=catalogue`.
- Updated filament stats/catalogue links and command palette entry to point at the Spools catalogue view.
- Static cache-bust bumped to `style.css?v=130` and `app.js?v=148`.

### Command palette action polish
- Added printer `lights` commands that jump straight to the live controls for that printer.
- Added spool edit commands for each active spool.
- Added spool action commands for label/weigh/copy/reset/archive flows without firing hardware directly.
- Added a compact `Command Ctrl K` header button so the command palette is discoverable without knowing the shortcut.
- Static cache-bust bumped to `style.css?v=131` and `app.js?v=150`.

### Closing fixes (shipped same session)
- **Bambu filament metadata**: `get_preview()` now called proactively on first poll of any new print (same trigger as AMS snapshot). One-shot FTP call per job; cached on `subtask_name`. Ensures `filament_weight_g` and `material` are always populated for spool deduction, even when nobody views the detail page.
- **Spool snapshot overwrite on restart**: `write_slot_snapshot` now uses `WHERE ams_slot_snapshot IS NULL`. Post-restart the snapshot condition re-fires (in-memory state resets), but the original DB row is preserved. Spool deduction uses correct print-start slot assignments regardless of restarts.

---

### Hardware integration follow-up
- Physical device validation now remains:
  - disable Brother Editor Lite mode and confirm `lsusb` shows printer mode
  - plug/wake Dymo M10 and confirm readable HID node
  - install new requirements and restart service
- Once both devices are confirmed live, print a real spool label and do one scale-backed spool correction.
- QR codes via `qrcode[pil]` → `https://flightdeck.tail7de73e.ts.net/#/spool/{id}`

### Other queued ideas (not yet scoped)
- Print annotations (notes column on prints, "Add note" link in finish toast and history detail)
- Thumbnail gallery view of past prints
- ETA accuracy report (scatter chart per printer)

---

### Bambu AMS profile aliases
- Added a first-pass Bambu AMS profile alias table in `app/printers/bambu.py`.
- Confirmed custom profile `P461bccf` is treated as **Siddament ASA** with ASA temp/profile metadata.
- AMS parsing and print-start snapshots now fall back to alias brand/profile names when Bambu MQTT leaves `tray_sub_brands` / `tray_id_name` blank.
- Assigning a Flightdeck Siddament ASA spool to a Bambu AMS slot now sends `P461bccf` instead of generic ASA, so Flightdeck can preserve the user-created Bambu profile where possible.
- Built-in aliases also cover common Generic/Bambu PLA/ASA/PETG/TPU IDs for clearer future display.
- Frontend AMS tooltips now show the richer reported profile name/brand from Bambu (`Siddament ASA`, `Generic ASA`, etc.) instead of only the raw material.
- Static cache-bust bumped to `app.js?v=174`.

---

### Multi-filament spool deduction fix
- Fixed Bambu/H2D spool deduction so completed multi-filament jobs use the sliced 3MF per-colour `used_g` rows before falling back to the active AMS slot.
- This prevents H2D dual-nozzle jobs from charging the entire print weight to the first active slot.
- Repaired completed print `#118` (`can_openerV2`) from one usage row to two:
  - Spool `#3` / AMS 1 S1 / white: `68.38g`
  - Spool `#2` / AMS HT / red: `28.89g`
- Updated spool balances from the print-start snapshot:
  - Spool `#3`: `604.0g -> 535.62g`
  - Spool `#2`: `324.0g -> 295.11g`
- Weigh-in hints no longer trigger just because a print has multiple usage rows when the deduction was repaired or matched from sliced per-filament usage.

---

### Spool detail flashing fix
- Fixed spool detail page flashing by preventing printer polling from re-running `renderSpoolDetail()` for the same spool every tick.
- Spool detail now renders on navigation or when switching to a different spool, but background printer polling no longer replaces the page with `Loading...`.
- Static cache-bust bumped to `app.js?v=175`.

---

### AMS Profile Doctor first pass
- Extended the AMS slot modal into a lightweight Profile Doctor.
- Slot modal now shows a `Matched`, `Review`, `Empty`, or `Unassigned` status comparing Flightdeck assignment against the printer-reported AMS material/profile/colour.
- Added `Trust Flightdeck` action to re-push the assigned spool profile/colour to the printer AMS slot.
- Stored spool picker now ranks likely matches first and marks close material/colour matches as `Suggested`.
- Static cache-bust bumped to `style.css?v=152` and `app.js?v=176`.

### Actionable AMS mismatch badges
- Live printer warning chips now name the exact mismatched AMS slot instead of only showing a generic mismatch count when there is one mismatch.
- Clicking the mismatch chip opens that slot directly in the AMS Profile Doctor.
- Multi-mismatch chips still summarise the count, include all slot details in the tooltip, and open the first mismatched slot for fast triage.
- Static cache-bust bumped to `style.css?v=153` and `app.js?v=177`.

### Flight Tower AMS mismatch awareness
- Flight Tower printer lanes now include AMS mismatch signals from the same Profile Doctor truth layer.
- A printer with a mismatch now falls into `Needs attention` instead of looking ready/idle.
- Mission lane mismatch chips include the detailed mismatch reason in the tooltip.
- `Idle and available` is suppressed when another warning/fault signal is present, avoiding mixed messages.
- Static cache-bust bumped to `app.js?v=178`.

### Queue preflight AMS mismatch guard
- Queue preflight now compares Flightdeck spool assignments against printer-reported AMS slots.
- If a mismatch affects the queued job's required material/colour, the job is blocked before dispatch with a specific AMS slot reason.
- Unrelated AMS mismatches remain visible in Live/Flight Tower but do not block unrelated queue jobs.

### AMS Profile Doctor Trust Printer action
- Added the opposite repair path to `Trust Flightdeck`.
- `Trust Printer` updates the already-assigned Flightdeck spool from the live AMS report (material, colour, colour name, and brand when reported).
- If the printer reports the slot empty, `Trust Printer` clears that Flightdeck spool back to the selected storage location.
- Static cache-bust bumped to `app.js?v=179`.

### AMS profile/vendor mismatch tightening
- Profile Doctor no longer treats matching material/colour as fully matched when the Bambu-reported profile/vendor differs from Flightdeck.
- Non-generic brand/profile differences now show `Brand mismatch` or `Profile mismatch`.
- Generic printer profiles against a specific Flightdeck brand now show `Profile review`, which is useful for cases where Flightdeck knows the spool better than the AMS.
- Backend queue/Flight Tower mismatch checks use the same profile/vendor rules.
- Static cache-bust bumped to `app.js?v=180`.

### Richer Bambu AMS slot sync payload
- `Trust Flightdeck` now sends Flightdeck's own AMS filament payload instead of the bambulabs_api minimal helper.
- Payload still sends the required Bambu fields (`tray_info_idx`, colour, nozzle temperatures, and material type), but now also includes `tray_sub_brands` and `tray_id_name` when Flightdeck knows them.
- This is intended to help the printer touchscreen/UI show the same profile/vendor that Flightdeck and MQTT are already using.
- Empty-slot clears also send blank profile/vendor display fields.

### Flight Manual H2D dual-nozzle note
- Added a `Flight Manual` section to README.
- Documented the H2D dual-nozzle colour-print workflow learned during testing:
  - Trust Flightdeck when the physical spool/profile is correct.
  - Sync filament from AMS in the slicer.
  - Assign model colours.
  - Use Regroup and slice if the send dialog maps everything to one nozzle.
  - Confirm left/right nozzle grouping before sending.
- Captured the key gotcha: if the model has no geometry assigned to a colour, the slicer may leave that nozzle blank even when Flightdeck and the AMS are correct.

### AMS slot unload action
- Added a Bambu AMS unload command path from Flightdeck.
- Backend now exposes `POST /api/printers/{printer_id}/ams/unload`, calling Bambu's `unload_filament_spool()` and logging an `ams_unload_requested` decision.
- AMS Profile Doctor now shows `Unload AMS slot` when the printer reports filament loaded in the clicked slot.
- The action asks for confirmation and sends the printer unload/retract command without changing Flightdeck inventory; inventory still changes only after the printer reports empty or the operator clears/moves the spool.
- Static cache-bust bumped to `app.js?v=181`.

### AMS slot load action
- Added the matching Bambu AMS load command path.
- Backend now exposes `POST /api/printers/{printer_id}/ams/load`, calling Bambu's `load_filament_spool()` and logging an `ams_load_requested` decision.
- AMS Profile Doctor now shows `Load AMS slot` when the printer reports filament in the clicked slot.
- Like unload, this is a physical printer command only; it does not mutate Flightdeck spool inventory.
- Static cache-bust bumped to `app.js?v=182`.

### AMS load/unload active-slot refinement
- Tightened the AMS Profile Doctor actions so parked loaded slots show `Load AMS slot`, while the currently active/fed slot shows `Unload AMS slot`.
- Load now targets the clicked AMS tray instead of relying on Bambu's generic load helper.
- Load/unload commands now choose a safer temperature from the clicked slot's material instead of always using the library default.
- This should make AMS 2 slot 2 style cases clearer: load the parked slot first, then unload once it becomes active.
- Static cache-bust bumped to `app.js?v=183`.

### BambuStudio-shaped AMS load/unload commands
- Updated Flightdeck's Bambu AMS load/unload MQTT payloads to match captured Bambu command traffic more closely.
- Load now sends `ams_id`, `slot_id`, `target`, and `curr_temp/tar_temp=-1`.
- Unload now sends `slot_id=255` and `target=255`, with source `ams_id` derived from the clicked/active slot.
- This replaces the older bambulabs_api helper shape that was accepted by MQTT but ignored by the H2D AMS state machine.

### Voron live camera proxy
- Fixed the Voron/Greyhound Elite V2 live feed path for HTTPS/Tailscale use.
- `mjpeg_direct` cameras now advertise a same-origin Flightdeck proxy URL (`/api/camera/{printer_id}/stream`) instead of returning the printer's raw HTTP MJPEG URL to the browser.
- Added direct MJPEG proxy streaming for Moonraker/Crowsnest cameras while preserving the upstream content type and no-cache headers.
- Updated the live printer config model name from `Voron` to `Voron 2.4 350`; the shop name remains `Greyhound Elite V2`.

### Localhost-only service hardening
- Reviewed a third-party fail-open auth advisory against Flightdeck's own authentication and error handling.
- Flightdeck does not currently have a comparable auth gate that can fail open, but it was still listening on `0.0.0.0:8000`, which exposed the raw HTTP app to the LAN.
- Changed the shipped systemd service and install docs to bind Uvicorn to `127.0.0.1:8000` by default.
- Tailscale Serve remains the intended remote doorway: `tailscale serve --bg http://127.0.0.1:8000`.

### Voron live page first polish
- Started giving the Voron/Greyhound Elite V2 live page its own treatment instead of letting it feel like a Bambu page without AMS.
- Added a Moonraker/MMU environment row with gate cards, active/buffered/empty states, slot editing hooks, and mismatch highlighting.
- Added a Voron filament-route strip from the active MMU gate to the toolhead, matching the visual language of the Bambu AMS-to-nozzle route.
- Removed the duplicate legacy MMU panel from the live page so the new Environment panel is the single source of truth.
- Static cache-bust bumped to `app.js?v=189` and `style.css?v=156`.

### Voron VVD filament path accuracy
- Captured live Happy Hare/VVD MMU state showing the difference between selected/gear-buffered filament and filament loaded all the way to the extruder/nozzle.
- Moonraker status now passes through VVD fields including `filament`, `filament_pos`, `operation`, `action`, and `sensors`.
- Voron route UI now labels the active path as `Pre-gate`, `Gear / buffer`, or `Toolhead` depending on reported VVD sensors instead of assuming the active gate is already at the nozzle.
- Static cache-bust bumped to `app.js?v=190`.
- Updated Voron/VVD operator labels from `G1/G2/G3/G4` to `T0/T1/T2/T3`, matching the Vivid/Happy Hare tool-position naming where the selector moves to the tool position.
- Static cache-bust bumped to `app.js?v=191`.

### Bambu RFID AMS profile matching
- Investigated H2D AMS slot re-load where Bambu RFID filament reported `A00-P6 · PLA Basic` and Flightdeck showed a false profile mismatch against the assigned spool.
- Confirmed the live printer was reading the RFID slot correctly and Flightdeck had already moved spool `#28` into `AMS 1 · S3`; the mismatch was caused by comparing Bambu profile codes as if they were human-readable filament names.
- Added Bambu profile-code tolerance so codes such as `A00-P6` do not trigger a profile mismatch once material and colour already match.
- Added profile-family matching so Bambu RFID names such as `PLA Basic` can match spools stored as `Bambu Lab / Basic / PLA`.
- Mirrored the same Bambu RFID tolerance in the frontend AMS slot tooltip/Profile Doctor path, which had its own profile mismatch logic.
- Bumped the app cache to `app.js?v=216` so browsers pick up the frontend AMS matching fix.

### Public contact address
- Corrected the public landing-page contact address to `flightdeck3dprinters@gmail.com`.

---

## Architecture decisions locked

- Python + FastAPI backend
- SQLite (not Postgres)
- Single-package project
- Host: Pi 5 + NVMe SSD (`flightdeck`, `192.168.4.127`)
- Vanilla JS frontend (no SPA framework)
- Local-first / no cloud (Tailscale used for tailnet-only remote access)

## Host facts
- Hostname: `flightdeck`, IP: `192.168.4.127` (eero reserved)
- Tailscale: `100.106.112.104`, MagicDNS hostname `flightdeck.tail7de73e.ts.net`, HTTPS certs enabled
- User: `flightdeck` (UID 1001, sudo, key-only SSH, in `systemd-journal` group)
- OS: Debian 13 Trixie, kernel 6.12.75, aarch64, 4GB RAM, 476.9GB NVMe
- Python 3.13.5
- Node 24.15.0 (nvm), npm 11.12.1

## Printers
| ID | Model | Custom name | Brand colour | Connection | Camera |
|---|---|---|---|---|---|
| `greyhound` | Voron | Greyhound Elite V2 | Red | Moonraker @ 192.168.4.215:7125 | MJPEG direct (crowsnest) |
| `x1c` | X1C | Greyhound Ludicrous | Green | Bambu MQTT @ 192.168.4.43 — LAN mode | RTSP port 322 (ffmpeg) |
| `h2d` | H2D | BigBoy | Amber | Bambu MQTT @ 192.168.4.206 — LAN mode | RTSP port 322 (ffmpeg) — 15min session recycle for firmware freeze workaround (commit ea20293) |

## Repository
- https://github.com/Kidabah/flightdeck (private)
- Recent commits: spool inventory (session 14), per-printer identity colours + duplicate detection (session 15), print queue subsystem (session 16), queue refinements + format additions (session 17), maintenance schedule (session 18), queue preflight (session 19), spool traceability (session 20), failure review (session 21), printer health score (session 22), scale + label hardware integration (session 23)

---

## Project context (for new Claude Code sessions)

If you're picking this up cold without prior conversation memory, here's the shape:

Flightdeck is a unified dashboard for a 3-printer mixed-fleet 3D print farm (Voron + 2 Bambus). It started as a Tier 1 monitor and grew into a full management surface — monitoring, control, history, spool inventory, print queue — with relay-based dispatch for Voron and direct Bambu integration via bambulabs_api MQTT.

The user (Kidabah) is technically experienced — runs the hardware hands-on, debugs at the protocol level (RTSP, MQTT field decoding, USB HID), and provides high-quality bug reports based on real use. Communication style: direct, brief, expects the same back. Owns the engineering decisions; uses Claude Code as a strong collaborator who can push back. Frequent screenshot evidence; values verification over assumption.

Workflow pattern: feature is specced, scope-pushback exchange happens, implementation in one or two sessions, real-use testing surfaces small bugs, fixes within the same day. Decision log + SESSION_NEXT discipline maintained throughout.

Important: when scope of a feature gets pushed back during specification (e.g. "let's defer X to a later session"), respect the decision. Don't accumulate scope under "while I'm here." Sessions stay focused.

The user values being treated as a collaborator, not a junior. Push back when something seems wrong; ask before making assumptions; explain trade-offs honestly. The decision log + SESSION_NEXT discipline isn't bureaucracy — it's how the project keeps state across multi-session work without burning context on re-discovery.

## 2026-06-14 Session handoff

Latest GitHub/Pi state:
- Branch: main
- Latest commit: MakerDeck b532 — fix smashed shelf female socket on Back
- **MakerDeck** session notes → [`makerforge/SESSION_NEXT.md`](makerforge/SESSION_NEXT.md) (not here)

### 2026-07-21 fix (MakerDeck b532 — back dovetail unusable)

**Need:** Shelf male looked fine; back socket looked smashed / couldn’t see how they join.

**Cause:** Female was embedded into the plate and welded → intersecting faces blocked the cavity.

**What shipped:** Clean U-bracket fully in front of the plate; slide male in from the side. Hard refresh **b532**, re-export back.

### 2026-07-21 fix (MakerDeck b531 — shelf 3MF “the lot”)

**Need:** Download still imported Back + Shelf + text into Bambu together.

**Cause:** 3MF always packed every shelf part; only STL followed Edit mode.

**What shipped:** 3MF follows Edit back / Edit shelf (`-back`/`-shelf` filename). Hard refresh **b531**.

### 2026-07-21 fix (MakerDeck b530 — shelf manifold)

**Need:** Shelf download warned “Manifold check: 8 open edges (Back 8)”.

**Cause:** Female dovetail used a hole that sat on the outer boundary → open slot edges.

**What shipped:** Closed U-channel female fused into the plate; male embeds into the deck. Hard refresh **b530**.

### 2026-07-21 fix (MakerDeck b529 — shelf download = sign)

**Need:** Downloading the shelf part gave the sign/back instead.

**Cause:** STL “body” export always used the back plate; 3MF could also fall back to the Edit-shelf preview mesh as Body.

**What shipped:** STL follows Edit back/Edit shelf (`-back`/`-shelf` filename); 3MF parts named Back + Shelf. Hard refresh **b529**.

### 2026-07-21 polish (Mobile layout — heroes crushed / misaligned)

**Need:** Phone / PWA UI looking messy; sections not aligned.

**Cause:** Early ≤760px hero rules lost to later desktop `.dashboard-hero` (and similar) definitions — copy column collapsed to 0px, metrics/links piled beside an invisible title.

**What shipped:** Late mobile polish block (heroes → 1 col, metrics 2×2, tab underline, queue actions wrap); force-open sidebar sections on phone + row clusters so nav strip stays ~one row; hide Settings flyout in strip; drop conflicting header duplicate. Hard refresh `style.css?v=500` + `app.js?v=644`.

### 2026-07-21 fix (API stall — queue won't load)

**Need:** Flightdeck super slow; queue never loads.

**Cause:** H2D queue preflight re-parsed the full `.gcode.3mf` (incl. walking every G1 for object geometry) on the event loop — Tired Eyes ~16MB pinned uvicorn ~80% CPU and starved every other request. Secondary: printer status/FTP could also stall polls.

**What shipped:** Skip gcode geometry on queue/metadata parses; don't re-read 3MF when nozzle fields already stored; status timeouts + no FTP on poll path; stale printer snapshot for queue/UI. Backend restart required.

### 2026-07-20 (b528 — Edit back / Edit shelf + z-fight fix)

**Need:** Centre flicker line on shelf preview; edit shelf separately from back.

**What shipped:** Female dovetail fully in front of plate (no coplanar faces); Edit back / Edit shelf chips with part-only preview + sliders. Hard refresh **b528**.

### 2026-07-20 (b527 — shelf size sliders + separate parts + short filament override)

**Need:** No preset text; round shelf corners; width/length sliders; parts print separate; start print despite short filament.

**What shipped:** Temora blank text; shelf width/length/thickness/corner; print-layout preview + Body/Shelf export; queue **Allow short** toggle. Hard refresh **b527**; backend restart.

### 2026-07-20 feature (MakerDeck b526 — shelf display + dovetail)

**Need:** Temora-style shelf so animals sit naturally; print as two parts that slide together.

**What shipped:** Sign type Shelf display (back + shelf, dovetail); export Body + Shelf; Temora preset. Hard refresh **b526**.

### 2026-07-20 polish (MakerDeck b525 — text res + plain/lines toggle)

**Need:** Cleaner print lettering; plain-text edit trapped you with no way back to by-line.

**What shipped:** Higher text raster/voxel/union res; mode toggle stays visible (**Back to lines**). Hard refresh **b525**.

### 2026-07-20 fix (MakerDeck b524 — Light font still blobbed)

**Need:** Font weight Light still sliced as thick fused letters — nothing like the original sign.

**Cause:** Label/sign text path dilated the mask ×4, then union dilated ×2–4 again (counters filled, letters merged). Weight slider never had a chance.

**What shipped:** Close AA pinholes only; Light gets slight erode; union dilate 0; Tahoma auto=400; Temora defaults Light. Hard refresh **b524**, re-export.

### 2026-07-20 polish (MakerDeck b523 — accent: 1 standard + add 2nd)

**Need:** Clear 2-band accent model (one standard, optional second).

**What shipped:** Band 1 labelled standard; **+ Add second band** stays visible (disables at max instead of hiding). Hard refresh **b523**.

### 2026-07-20 fix (MakerDeck b522 — still boggy)

**Need:** MakerDeck still laggy after b520.

**Cause:** `accent-bands.js?v=161` (geometry) vs `?v=163` (app) = second module copy; `updateDecorUi` → `syncArtEditorUi` often called twice; heavy `buildParams` art checks + line-list re-render every sync.

**What shipped:** Align accent-bands to v163; drop duplicate sync; cheap art-state check; skip line UI rebuild when unchanged; longer SVG rebuild debounce. Hard refresh **b522**.

### 2026-07-20 feature (MakerDeck b521 — text spacing + weight)

**Need:** Words running together on plaques; want letter spacing, line spacing, font weight.

**What shipped:** Flat **Letter spacing** + **Line spacing** sliders; **Font weight** select (auto/light…black). Temora defaults: spacing 1.28 / 1.4, weight 600. Hard refresh **b521**.

### 2026-07-20 fix (MakerDeck b520 — boggy = doubled features.js)

**Need:** MakerDeck laggy after per-line text (Chris: usually means doubled JS).

**Cause:** `insert-slots.js` imported bare `./features.js` while app/geometry used `features.js?v=519` → two module copies.

**What shipped:** Align import to `features.js?v=520`; stop calling `updateDecorUi` on every text keystroke. Hard refresh **b520**.

### 2026-07-20 feature (MakerDeck b519 — per-line emboss text)

**Need:** Separate font size per line + clearer line editing for plaques.

**What shipped:** Art → Text **Lines** editor (`text` + `heightMm` each); `embossTextLines` in state/session; flat raster uses per-line sizes when they differ; Temora title/quote/names sized. Hard refresh MakerDeck **b519**.

### 2026-07-20 fix (MakerDeck b518 — Flat text kept snapping to Arc)

**Need:** Plaque text arched even when user wanted Flat; “Wide” looked like flat centre.

**Cause:** Text input auto-switched Flat→Arc whenever graphic art was loaded (canister “text around logo” helper). Signs + Celtic SVG kept re-arching.

**What shipped:** Auto-arc only for wrap-face canisters; Temora forces Flat; rename Wide→Banner arc. Hard refresh MakerDeck **b518**.

### 2026-07-20 feature (STL Painter — own sidebar menu)

**Need:** Painter out of MakerDeck toolbar; first-class Flightdeck nav.

**What shipped:** `#/painter` view + amber **STL Painter** sidebar tab; removed MakerDeck topbar link; Painter branding standalone (b517). Hard refresh Flightdeck (`app.js?v=642`, `style.css?v=495`). Backend restart not required (static only; pull still needed).

### 2026-07-20 feature (MakerDeck b516 / b515 — Temora Vet plaque)

**Need:** Printable vet plaque with exact names + Celtic SVG (not AI text).

**What shipped:** Temora Vet plaque preset; Celtic frame SVG; emboss textarea 240 chars; verified export Body+Art+Text. Hard refresh **b516**.

### 2026-07-20 feature (MakerDeck b515 — Temora Vet plaque)

**Need:** Printable vet plaque with exact names (AI text fails) + Celtic knot via SVG.

**What shipped:** Temora Vet plaque preset, Celtic frame SVG emboss, longer emboss textarea. Hard refresh b515.

### 2026-07-20 fix (MakerDeck b514 — Orca broken by Studio settings dump)

**Need:** b513 full Studio project_settings broke Orca; Studio still showed AMS black/yellow.

**What shipped:** Slim Orca-safe export again; `Chris_Friend_Bust_ORCA_COLOURS.3mf`. Cache-bust `painter.js?v=514`.

### 2026-07-20 fix (MakerDeck b513 — Orca OK / Studio wrong colours)

**Need:** Same painted 3MF — colours correct in Orca, wrong in Bambu Studio.

**Cause:** Studio wants `Generic PLA @BBL H2C 0.4 nozzle` + full project_settings; slim JSON is enough for Orca only.

**What shipped:** H2C Studio template expand on export; `Chris_Friend_Bust_STUDIO_COLOURS.3mf`. Cache-bust `painter.js?v=513`.

### 2026-07-20 fix (MakerDeck b512 — Studio still wrong colours)

**Need:** Bust paint regions OK but Studio swatches wrong (orange/brown defaults).

**Cause:** Export had bare `Generic PLA` settings ids — Studio discards filament_colour.

**What shipped:** Always embed `Generic PLA @BBL H2C`. Patched `Chris_Friend_Bust_COLOURS_FIXED.3mf`. Cache-bust `painter.js?v=512`.

### 2026-07-20 fix (MakerDeck b511 — paint lost on Painter reload)

**Need:** Bust paint vanished when reloading 3MF into Painter; Studio save had also stripped plaid slots.

**What shipped:** Regex 3MF import (no DOMParser OOM); status shows painted count. Cache-bust `painter.js?v=511`.

**Recover:** Load `Desktop/3MF/RECOVERED/Chris_Friend_Bust_FULL_PAINT_b510.3mf` (not Downloads `Chris_Painted.3mf`).

### 2026-07-20 fix (MakerDeck b510 — slicer colours scrambled)

**Need:** Painted bust looked right in Painter; H2C Studio showed wrong filament colours (no AMS loaded).

**What shipped:** Richer 3MF `project_settings` + correct `.config` MIME; Export printer = H2C. Cache-bust `painter.js?v=510`.

**Deploy:** Hard refresh Painter → re-export → reopen in Studio.

### 2026-07-20 fix (MakerDeck b509 — magenta selection ≠ paint)

**Need:** Shirt looked “painted” magenta; clicking red didn’t apply colour.

**What shipped:** Magenta = selection only; click colour slot or Fill Selection to paint. Cache-bust `painter.js?v=509`.

**Deploy:** Hard refresh Painter.

### 2026-07-20 feature (MakerDeck b508 — export Replace / Save as)

**Need:** Don’t silently pile up `*_painted.3mf` downloads — ask Replace or Save as.

**What shipped:** Save picker + session Replace/Save as dialog. Cache-bust `painter.js?v=508`.

**Deploy:** Hard refresh Painter (no backend restart).

### 2026-07-20 feature (MakerDeck b507 — AMS HT / 16 colours)

**Need:** Include HT / multi-AMS colours beyond 4 slots.

**What shipped:** +/− up to 16 filaments; full paint_color export. Cache-bust `painter.js?v=507`.

**Deploy:** Hard refresh Painter (no backend restart).

### 2026-07-20 feature (MakerDeck b506 — AMS slot +/-)

**Need:** Add/remove AMS colours from the slot list.

**What shipped:** +/− for slots 1–4; remove remaps paint to Base. Cache-bust `painter.js?v=506`.

**Deploy:** Hard refresh Painter (no backend restart).

### 2026-07-20 feature (MakerDeck b505 — lasso area fill)

**Need:** Draw around an area (e.g. eyebrows) and fill with a chosen AMS slot.

**What shipped:** Lasso tool + always-visible Fill Selection. Cache-bust `painter.js?v=505`.

**Deploy:** Hard refresh Painter (no backend restart).

### 2026-07-20 fix (MakerDeck b504 — hover no longer paints)

**Need:** Moving the cursor painted with the active slot without holding the mouse button (stuck brush stroke).

**What shipped:** Paint only while primary button down; clear stuck strokes on lost capture / button-up. Cache-bust `painter.js?v=504`.

**Deploy:** Hard refresh Painter (no backend restart).

### 2026-07-19 feature (MakerDeck b503 — box select for Hide Selection)

**Need:** Box-drag a region (e.g. beard) into selection so Hide Selection can clear it while painting behind; Show restores for 3MF.

**What shipped:** Box tool feeds selection (not auto-paint). Cache-bust `painter.js?v=503`, MakerDeck build **b503**.

**Deploy:** Hard refresh Painter (no backend restart).

### 2026-07-19 fix (MakerDeck b423 — frozen view)

**Need:** After Isolate, only a tiny black patch showed; unlock wouldn’t orbit; painting stuck.

**What shipped:** Unstick / Show all; right-drag always orbits; Alt/Space orbit. Cache-bust `painter.js?v=423`.

**Deploy:** Hard refresh Painter (no backend restart).

### 2026-07-18 feature (Colour Match Live screen eyedrop)

**Need:** Pick colours from the live slicer window (rotate the dog in Bambu/Orca) instead of a still screenshot.

**What shipped:** **Live screen** button uses Chromium `EyeDropper` API — pick any desktop pixel; loop until Esc. Cache-bust `app.js?v=641`, `style.css?v=494`.

**Note:** Needs Chrome/Edge + secure context (HTTPS or localhost). Plain `http://pi-ip` may block it.

**Deploy:** Hard refresh (restart optional).

### 2026-07-18 fix (Colour Match LAB match + eyedrop Move/Pick)

**Need:** Dark blood-red was ranking as Black (RGB collapse). Eyedrop “rotate” UX was a tilt slider — user wants click-drag to move around.

**What shipped:**
- Colour Match uses Lab + chroma/hue distance (blood red → Nightfire/Rosewood, not Hatchbox Black)
- Eyedrop: **Move** (drag around) / **Pick** (click pixel), zoom, optional 90° rotate only — no tilt slider
- Cache-bust `app.js?v=641`, `style.css?v=494`

**Deploy:** Backend restart + hard refresh.

### 2026-07-18 feature (Colour Match palette plan)

**Need:** After reducing a multi-colour print to the strongest N colours (e.g. dog 15→5), get one plan: use shelf vs order, preferring true colour but using inventory when ≤~2% under the best buy so jobs aren’t held up waiting on stock.

**What shipped:**
- Colour-match API returns `recommendation` + `palette` / `palette_summary` with `prefer_inventory_pct` (default 2)
- UI **Palette plan** above detail results: Use shelf / Order per pick, Copy plan / Copy order list, click row to focus that pick
- Cache-bust: `app.js?v=637`, `style.css?v=490`

**Files:** `app/main.py`, `app/db.py`, `app/static/app.js`, `app/static/style.css`, `app/static/index.html`, `app/static/demo-runtime.js`, `SESSION_NEXT.md`

**Deploy:** Backend restart required. Hard refresh after pull.

**Test:** Spools → Colour match → eyedrop 5 colours from screenshot → confirm Palette plan shows shelf vs order with ≤2% rule; Copy order list; click a row to drill into inventory/buy detail.

### 2026-07-18 fix (Colour Match blank screen)

**Symptom:** Flightdeck blank after Colour Match deploy.

**Cause:** `app.js` had two full Colour Match implementations (merge duplicate). The later one overwrote helpers and referenced an unbound `costs` variable.

**Fix:** Keep the `_cm*` implementation only; align CSS to `.cm-*` classes; cache-bust `app.js?v=635`, `style.css?v=488`.

**Deploy:** `git pull` + hard refresh (restart optional for static-only).

### 2026-07-18 feature (Filament Colour Match)

**Need:** Mix or eyedrop a target colour (e.g. multi-colour dog print) and find nearest filaments across the catalogue + on-shelf spools, with brand / name / order link / price.

**What shipped:**
- `GET/POST /api/filament/colour-match` — ranks `filament_catalog` + active `spools` by RGB distance; returns match %, Siddament `product_url` / `price_aud` from traits
- Spools view **Colour match** (`#/spools?view=colour`) — HSV mixer, hex paste, material/brand chips, image eyedropper with multi-target list, inventory + buy results, Add spool / Order / Copy hex
- Command palette: “Colour match”
- Cache-bust: `app.js?v=635`, `style.css?v=488`

**Files:** `app/main.py`, `app/db.py`, `app/static/app.js`, `app/static/style.css`, `app/static/index.html`, `app/static/demo-runtime.js`, `SESSION_NEXT.md`

**Deploy:** Backend restart required. Hard refresh after pull.

**Test:** Spools → Colour match → paste a hex or drop an Orca screenshot → click pixel → confirm inventory + Siddament/OFDB matches; Sync catalogue if empty.

### 2026-07-16 fix (queue start shows HMS instead of stale Printing…)

**Symptom:** Big Girl queue showed IDLE + “Printing…” then cancelled as stale after ~8 min. Retry of coffee container did the same. Hold was not involved.

**Cause:** MQTT `project_file` start never confirmed; printer stayed idle/FINISH with HMS `0500-0300-0002-000E` (module/firmware incompatible). Watchdog only logged `queue_bambu_start_unconfirmed` and left the row active until the stale sweeper. Often no OTA is offered — module (AMS/hotend) out of sync after nozzle work.

**Fix:** Decode Bambu HMS from MQTT. If start stays idle/finished (or errors) without physical proof, fail the queue job immediately with the HMS text (or a clear “stayed idle — check printer screen” message) instead of waiting for stale clear.

**Files:** `app/printers/bambu.py`, `app/main.py`, `SESSION_NEXT.md`

**Test:** Queue a job to a printer that refuses start with HMS → within ~45–60s job status **Failed** with HMS message (not stuck Printing…). Backend restart required. No frontend cache bump.

### 2026-07-16 fix (AMS profile doctor: Bambu vs Bambu Lab false mismatch)

**Symptom:** After the PLA Pure AMS fix the HT tray correctly reports "Bambu PLA Pure", but the passport showed **"Profile mismatch: printer Bambu PLA Pure, Flightdeck Bambu Lab PLA Pure"**.

**Cause:** Bambu profile names use "Bambu"; Flightdeck builds the expected string from brand "Bambu Lab". `_norm_material` containment failed on the stray "lab".

**Fix:** `_canon_profile()` / `_canonProfile()` collapse "bambu lab" -> "bambu" before the profile comparison in `app/main.py` and `app/static/app.js` (`app.js?v=632`). Backend restart + hard refresh.

### 2026-07-14 fix (Settings Print enabled checkbox lied)

**Symptom:** Settings → Printers showed **Print enabled** ticked while Live/Fleet still showed **On hold** (e.g. Big Girl/o1c2 stuck with note "Broken Nozzle Selector").

**Cause:** Settings loaded `/api/config/printers` only — no `print_enabled` field — so checkbox defaulted to checked (`?? true`).

**Fix:** Merge `print_enabled` + `print_enabled_note` from `/api/printers` when rendering Settings → Printers.

**Files:** `app/static/app.js`, `app/static/index.html` (`app.js?v=631`)

**Test:** Disable a printer → Settings shows unchecked + note; re-enable → Live drops "On hold". Hard refresh after deploy.

### 2026-07-08 feature (native recorder survives restart)

**Mid-print Flightdeck restart no longer wipes timelapse segments** (`app/native_recorder.py`, `app/main.py`)

- Service shutdown now **suspends** native recorder (stops ffmpeg, keeps `.{print_id}-capture/seg_*.mp4`) instead of concatenating + deleting mid-print.
- On resume after `job_reattached`, recorder continues segment numbering from the highest existing `seg_*.mp4` and logs `flight_recorder_native_resume`.
- Print finish concatenates **all** segments (pre- and post-restart) before attach; orphan capture dirs finalize if the in-memory recorder is gone.
- **Backend restart required** on Pi. No frontend cache bump.

### 2026-07-08 fix (history passport scroll)

**Printer History passport was clipped with no scrollbar** (`app/static/style.css`, `app/static/index.html`)

- `#printer-detail > .history-body` now scrolls (`flex:1`, `overflow-y:auto`) like Print Bay — passport content is no longer trapped by parent `overflow:hidden`.
- Removed flex clip on `#history-day-detail`; decision trail uses page scroll instead of a nested dead-end scroll area.
- Cache `style.css?v=485`. Hard refresh required.

### 2026-07-08 fix (sidebar open + history passport focus)

**Sidebar sections default open; heatmap hides when passport open** (`app/static/app.js`, `app/static/style.css`, `app/static/index.html`)

- Operations + System sidebar groups default **expanded** again (new localStorage key resets prior collapsed state).
- Printer History hides the year heatmap while a print passport is open — back arrow returns to the day list and calendar.
- Cache `app.js?v=629` `style.css?v=484`. Hard refresh required.

### 2026-07-08 fix (passport collapsible sections + scroll)

**Print passport sections collapse; decision trail scroll trap** (`app/static/app.js`, `app/static/style.css`, `app/static/index.html`)

- Print passport (History + Print Memory) now uses collapsible sections: Flight Recorder, Print details, Spool usage, Notes, Memory tags, Decision trail (closed by default).
- Fixed Print Memory passport scroll trap: sticky panel now has `max-height` + internal scroll so the bottom (decision trail) is reachable.
- Decision trail shows entry count when loaded; larger scroll area.
- Cache `app.js?v=628` `style.css?v=483`. Hard refresh required.

### 2026-07-08 fix (timelapse low coverage + collapsible sidebar)

**Fat quarters box timelapse only ~24s of 15h print** (`app/main.py`, `app/native_recorder.py`, `app/static/app.js`, `app/static/style.css`, `app/static/index.html`)

- Diagnosed print #430 on h2d: **24s clip / 56 369s print (~10% coverage)** — native recorder likely started late (service restart mid-job) and auto-harvest was blocked once the short native clip attached.
- Auto-harvest and **Find better clip** now retry when coverage &lt; 45% or source is `ipcam/*` — can replace with a longer Bambu SD timelapse.
- Passport shows **coverage caption** (e.g. `24m clip · ~10% of 15h 39m print`) + **Find better clip** button on low coverage.
- Multi-segment native concat re-encodes (fixes timestamp glitches on very long jobs).
- Sidebar **Printers / Operations / System** are collapsible `<details>` sections (state saved in localStorage; Operations + System default collapsed).
- Cache `app.js?v=627` `style.css?v=482`. **Backend restart required** on Pi.

### 2026-07-07 fix (spool restock)

**Restocking a reserved/archived spool failed with "Unable to restock spool"** (`app/db.py`)

- `restock_spool_line()` runs `UPDATE spools ... SET updated_at = CURRENT_TIMESTAMP`, but the `spools` table never had an `updated_at` column — sqlite threw `OperationalError: no such column: updated_at`, surfacing as HTTP 500 on `POST /api/spools/{id}/restock`. Two other paths (auto-archive empty spool, storage-location delete archive) referenced the same missing column and would have failed the same way.
- Added `ALTER TABLE spools ADD COLUMN updated_at TIMESTAMP` to the startup migration list in `init_db()`. Verified the restock UPDATE succeeds against a copy of the live Pi DB after migration.
- Backend change: Pi restart required (migration runs on startup). No cache bust.

### 2026-07-06 fix (H2D queue nozzle grouping)

**False "sliced for left nozzle" block on right-nozzle jobs** (`app/printers/bambu_ftp.py`)

- `_parse_filament_nozzle_map()` treated `<nozzle extruder_id="2">` as a physical MQTT id (0=right/1=left) and swapped it, so a right-nozzle job (logical extruder 2) parsed as nozzle 0 (left) and preflight blocked with "H2D nozzle/AMS mismatch: job is sliced for left nozzle".
- `extruder_id` is actually a **1-based logical** extruder id (1=left, 2=right). Now the per-plate `filament_maps` metadata from slice_info.config is the primary source (one group per filament, mapped through `physical_extruder_map` to physical then to Flightdeck 0=left/1=right), with the corrected `<nozzle>` interpretation as fallback. Stale `filament_map` in project_settings ("Auto For Flush" mode) is never trusted over plate metadata.
- Verified against real uploads: box-270x300x55mm (right, was misread as left), PETG tests plate 4 (right), 4-way splitter (left).
- Backend change: Pi restart required. No cache bust.

### 2026-07-06 infra (Pi passwordless service restart)

- `sudo systemctl restart flightdeck.service` had started prompting for a password over SSH, breaking the deploy protocol.
- Installed `/etc/sudoers.d/flightdeck-restart` on the Pi: NOPASSWD for `systemctl restart|status|is-active flightdeck.service` (flightdeck user only). Written via a root docker container since the flightdeck user is in the docker group.
- Full deploy sequence (`git pull && sudo systemctl restart flightdeck.service`) verified working end to end.

### 2026-07-06 fix (MakerDeck preview artifacts)

**Slip lid + vase cap triangulation** (`makerforge/js/geometry.js`, `makerforge/js/vase.js`)

- Slip-over lid was a hollow rim at the top — internal skirt floor showed as a floating horizontal plane in preview. Top plate is now solid (earcut cap).
- Vase/pot floor caps use earcut instead of center-fan triangulation (no spoke artifact).
- Cache `app.js?v=107`. Hard refresh MakerDeck.

### 2026-07-06 feature (MakerDeck divider top clearance)

**Dividers respect inset plug / flat-cap lip** (`makerforge/js/features.js`, `makerforge/js/app.js`, `makerforge/index.html`)

- **Match lid clearance** (default on): divider top gap auto-follows inset skirt or flat lip depth.
- **Top clearance** slider on Insert tab for manual override (partial-height dividers).
- Cache `app.js?v=106`. Hard refresh MakerDeck.

### 2026-07-05 fix (MakerDeck inset plug lid restored)

**Third simple lid type back** (`makerforge/js/geometry.js`, `makerforge/js/app.js`, `makerforge/index.html`)

- **Inset plug** (skirt inside the opening) restored alongside slip-over and flat cap — still no hinges/slide/roll.
- Old saved `plug` sessions map to inset plug again (not slip-over).
- Cache `app.js?v=105`. Hard refresh MakerDeck.

### 2026-07-05 feature (MakerDeck KISS lids)

**Drop hinges / slide / roll / clip — two lid types only** (`makerforge/js/geometry.js`, `makerforge/js/app.js`, `makerforge/js/features.js`, `makerforge/index.html`)

- Lid types: **Slip-over** and **Flat cap** only. Hinge tab and all hinge/slide/roll hardware modules removed.
- Saved sessions map old lid types (`hinge`, `clip`, `slide`, `roll`, `plug`) → slip or flat via `normalizeLidType()`.
- Fixes knuckle/cylinder preview artifacts on star, heart, teardrop.
- Cache `makerforge` `app.js?v=104`. Hard refresh `#/makerdeck` or `/makerforge/`.

### 2026-07-05 feature (MakerDeck hinge dropdown + live preview)

**Hinge generator viewport preview** (`makerforge/js/hinge-hardware.js`, `makerforge/js/app.js`, `makerforge/index.html`)

- Hinge tab: type dropdown, live 3D preview of selected hinge (length/width sliders update in viewport).
- Cache `makerforge` `app.js?v=102`. Hard refresh `#/makerdeck` or standalone `/makerdeck/`.

### 2026-07-05 fix (spool display_id + loaded-slot replace)

**Reserve model UI completion and AMS slot assignment** (`app/static/app.js`, `app/static/index.html`, `app/static/demo.html`)

- Operator-facing labels (live routes, fleet watch, command palette, assign modal, mismatch text, swap toasts) now use `display_id` via `_spoolDisplayLabel()` instead of internal `spools.id`.
- Spool form save to a loaded printer slot sends `replace_existing: true` + `sync_ams: true` on `/move` (same as quick-assign) so assigning #98 to AMS HT bumps the old occupant to storage and pushes the AMS profile.
- New spool + restock flows create/restock first, then move to loaded slot with replace+sync (avoids create-time 409 on occupied bays).
- Static cache `app.js?v=626`; hard refresh required. UI-only — backend restart optional.

### 2026-07-05 feature (MakerDeck inside Flightdeck)

**MakerDeck sidebar tab** (`app/static/index.html`, `app.js`, `style.css`)

- New nav item **MakerDeck** → `#/makerdeck` embeds `/makerdeck/` full-height iframe (same origin, works on Tailscale HTTPS).
- Command palette entry added. Standalone `/makerdeck/` still works.
- **Restart flightdeck.service** after pull.

### 2026-07-05 fix (MakerDeck shape switch pencil box → box)

**Box button now resets lid and dimensions after a preset** (`app.js`)

- Leaving pencil box (or any preset) for Box/Rounded/Hex/Circle clears slide lid + case size back to default 80×60×40.
- Cachebust app.js?v=54. Hard refresh required.

### 2026-07-05 fix (MakerDeck blank viewport)

**Box no longer disappears when rebuild fails** (`app.js`)

- Build new mesh before disposing old; auto-recover to default box on failure.
- Art tab with applied lid art no longer duplicates preview mesh (draft preview only when dirty).
- Overlay uses face-corner projection only (no giant extrusion bbox).
- Reset view rebuilds if mesh missing. Cachebust app.js?v=53. Hard refresh required.

### 2026-07-04 fix (MakerDeck lid export + overlay overnight)

**Lid art export and selection frame** (`app.js`, `geometry.js`, `stl.js`)

- Label preview parented to lidMesh (moves with slide lid; no double offset).
- projectFacePoint uses Three.js localToWorld (matches rendered mesh).
- Overlay uses screen AABB from mesh vertices; face-corner fallback when needed.
- Draft edit skips merging applied art into lid/body (no ghost/double text).
- STL export sanitizes invalid/degenerate triangles; orientLidForPrint guards NaN.
- Cachebust app.js?v=52. Hard refresh required.

### 2026-07-04 fix (MakerDeck art on lid + overlay)

**Slide-lid text now targets the lid STL; frame samples the visible cap** (`app.js`, `art-editor.js`, `geometry.js`, `index.html`)

- Pencil box preset defaults Face to **Lid top**; hint warns when Top (box body) won't export on Download lid.
- Apply button reads **Apply to lid** when appropriate; label preview follows sliding lid.
- Overlay uses top-cap mesh vertices (not full extrusion AABB) for tighter wrap.
- Cachebust app.js?v=51. Hard refresh required.

### 2026-07-04 fix (MakerDeck art overlay — mesh-driven like skip-object map)

**Selection frame now follows the rendered label mesh, not a parallel face transform** (`app.js`)

- Same lesson as Bambu skip-object map (`bbox_objects` on `top_N.png`, not custom gcode axis math): overlay projects the actual Three.js label mesh to screen and fits handles to that.
- Drag rotate/resize anchors use mesh screen centroid too.
- Cachebust app.js?v=50. Hard refresh required.

### 2026-07-04 fix (MakerDeck text frame + size + fonts)

**Selection box now wraps the letters; size slider is letter height in mm** (`features.js`, `app.js`, `index.html`)

- Size measured from glyph ink bounds, not padded canvas — fixes frame sitting below the word.
- Size slider up to 48 mm (face-dependent); width limit relaxed to ~88% of face.
- Windows/Office fonts first: Segoe UI, Calibri, Arial, Tahoma, Verdana, Times, Cambria, Consolas.
- Cachebust app.js?v=49. Hard refresh required.

### 2026-07-04 fix (MakerDeck art overlay + stuck text)

**Selection frame now tracks rotated text; applied art no longer ghosts while editing** (`app.js`, `index.html`)

- Overlay projects **rotated** face corners to screen (single angle) — fixes frame vs text mismatch at rotation.
- Art tab always initializes a draft; preview uses draft only (not old applied label on top).
- **Remove art** button in Art tab clears text/SVG/trace from the box.
- Cachebust app.js?v=48. Hard refresh required.

### 2026-07-04 fix (MakerDeck text selection frame alignment)

**Handles now wrap the actual letters, not the empty canvas** (`features.js`, `app.js`)

- Shared `computeTextArtLayout` — tight mask bounds for mesh + overlay + rotation centre.
- Fixes frame floating above/shifted from PENCILS on top/lid faces.
- Cachebust app.js?v=47. Hard refresh required.

### 2026-07-04 feature (MakerDeck Word-style text on face)

**Type word → see it on the lid with selection handles** (`app.js`, `index.html`, `style.css`)

- Live 3D preview while editing (draft); white Word-style frame wraps the actual text bounds.
- Eight resize handles + rotation handle; transparent frame, not an empty blue box.
- Cachebust app.js?v=46, style.css?v=13. Hard refresh required.

### 2026-07-04 fix (MakerDeck art overlay rotation)

**Transform box now rotates instead of expanding** (`app.js`)

- Overlay uses unrotated screen size + CSS rotate to match text angle (not axis-aligned bbox).
- Cachebust app.js?v=45. Hard refresh required.

### 2026-07-04 feature (MakerDeck Photoshop-style art editor)

**Draft → Apply workflow with transform box** (`art-editor.js`, `app.js`, `index.html`, `style.css`, `features.js`, `decor.js`)

- Art tab edits go to a draft first; mesh updates only when you click **Apply to box**.
- Preview transform box: drag anywhere to move, corners to resize, purple handle to rotate.
- Face, font, size, rotation, emboss/deboss all editable before apply. Removed H/V offset sliders.
- Cachebust app.js?v=44, style.css?v=12. Hard refresh required.

### 2026-07-04 feature (MakerDeck art on top / lid)

**Stencil placement on horizontal faces** (`features.js`, `geometry.js`, `decor.js`, `slide-lid.js`, `app.js`, `index.html`)

- Art tab Face selector adds **Top (box rim)** and **Lid top** (when lid enabled).
- Lid-top art merges into the **lid STL** export; body STL stays clean.
- Preview overlay follows slide-lid position on lid face.
- Cachebust app.js?v=43. Hard refresh required.

### 2026-07-04 fix (MakerDeck stencil text emboss)

**Text no longer built from pixel rectangles** (`features.js`, `index.html`)

- Emboss text now uses high-res canvas mask → contour polygons → smooth extrusion (same pipeline as traced images).
- Each letter is a separate solid with clean edges — no non-manifold stair-steps; suitable for Bambu slicer colour painting per letter.
- Cachebust app.js?v=42. Hard refresh required.

### 2026-07-04 feature (MakerDeck Art tab + placement handles)

**Unified Art tab** — text, image trace, SVG, placement, emboss in one place (`index.html`, `app.js`, `features.js`, `decor.js`, `style.css`)

- Replaced separate Label + Import tabs with **Art**.
- Horizontal / vertical offset sliders (mm) wired into emboss geometry.
- Viewport overlay on Art tab: drag centre to move, corner handles to resize (font size or image size).
- Cachebust app.js?v=41, style.css?v=11. Hard refresh required.

### 2026-07-04 fix (MakerDeck slide lid centre diamond — mesh)

**Lid top was one quad → two coplanar tris through centre** (`slide-lid.js`, `geometry.js`, `app.js`)

- Slide lid slab top/bottom now use a 6×4 subdivided cap grid (no single diagonal across centre).
- Slide grooves stay on the body whenever lid type is Channel slide (not tied to Enable lid checkbox).
- Cachebust app.js?v=40. Hard refresh required.

### 2026-07-04 fix (MakerDeck X-ray floor diamond — real cause)

**Not the lid mesh — floor caps + grid through transparent preview** (`app.js`)

- Preview fit turns on X-ray; disabling the lid also stops X-ray, so it looked lid-specific.
- Centre diamond = coplanar floor cap tris z-fighting + build grid bleeding through transparent walls.
- X-ray now uses depthWrite off on body/lid; grid hidden and moved off-screen; log depth buffer on.
- Cachebust app.js?v=39. Hard refresh required.

### 2026-07-04 fix (MakerDeck slide lid thumb pocket z-fight)

**Removed inset thumb pocket from slide lid** (`slide-lid.js`)

- Pocket wall tops shared the same Z as the outer top face → dark rectangular z-fight patch on lid.
- Lid is now a plain watertight slab; thumb notch can be added later as a proper cutout.
- Cachebust app.js?v=38. Hard refresh required.

### 2026-07-04 fix (MakerDeck slide lid top artifact)

**Lid mesh rebuilt as single watertight box** (`slide-lid.js`)

- Removed degenerate zero-thickness face + overlapping top caps that z-fought on the lid surface.
- Flat rectangular slab + open-top thumb pocket (walls only, no duplicate top face).
- Cachebust app.js?v=37. Hard refresh required.

### 2026-07-04 fix (MakerDeck slide lid artifact + reference polish)

**Dado grooves inset from wall; lid shelf clearance** (`slide-lid.js`, `app.js`)

- Groove geometry offset 0.1 mm from inner wall — stops z-fighting with shell (floor moiré in X-ray).
- Lower groove shelf + lid seat clearance so rail and body don't share one plane.
- Simpler flat-slab lid with thumb notch on entry end; rectangular dados like wooden pencil cases.
- X-ray keeps depthWrite on body/lid with polygon offset for cleaner transparency.
- Cachebust app.js?v=36. Hard refresh required.

### 2026-07-04 feature (MakerDeck channel slide lid)

**True sliding pencil-case lid** (`slide-lid.js`, `geometry.js`, `app.js`, `index.html`)

- New lid type **Channel slide** — angled grooves on long walls, beveled lid rails, end-stop pocket at far short end.
- Body gets rail lips when slide lid enabled; lid slides in along length (−X entry). Preview fit animates horizontally.
- **Pencil box** preset defaults to channel slide. Works on rect / rounded / pencil box / pencil tube.
- Lid tab: groove height + end stop length when channel slide selected.
- Cachebust app.js?v=35. Hard refresh required.

### 2026-07-04 feature (MakerDeck pencil box + lid types done)

**Rectangular pencil box with slide-in lid** (`geometry.js`, `app.js`, `index.html`, `features.js`, `stl.js`)

- New preset **Pencil box** — rectangular case (200×72×25 mm), corner radius, slide-in lid enabled by default.
- Renamed **Pencil tube** for the stadium-ended original pencil case.
- Lid types polished: "Inset plug" → **Slide-in**; dropdown built from `LID_TYPES` (slip / slide-in / flat cap).
- Cachebust app.js?v=34. Hard refresh required.

### 2026-07-04 fix (MakerDeck floor centre hatch — round 2)

**Grid bleed + zero-thickness floor** (`geometry.js`, `app.js`)

- Floor/bottom caps are thin slabs (0.08 mm) — no more paper-thin z-fighting at centre.
- Removed center-fan capSolid fallback entirely; earcut + boundary fan only.
- Hide build-plate grid during X-ray preview fit (grid lines were moiré-ing through transparent floor).
- Body/lid preview uses FrontSide; body edge threshold raised to 28°.
- Cachebust app.js?v=33. Hard refresh required.

### 2026-07-04 fix (MakerDeck X-ray floor diamond artifact)

**Centre floor moiré was cap z-fighting, not the lid** (`app.js`, `geometry.js`)

- X-ray mode now uses FrontSide on body/lid — zero-thickness floor caps no longer fight front/back faces.
- Slip lid plate built as annulus + walls (capRing top) instead of solid earcut cap over the skirt hole.
- Cachebust app.js?v=32. Hard refresh required.

### 2026-07-04 hotfix (MakerDeck floor missing + mesh corruption)

**capProfileSolid used wrong pushTri API** (`geometry.js`)

- Earcut caps were passing vertex indices to pushTri (expects vec3), writing NaN triangles — no floor, random rim notches.
- Fixed with pushTriIdx; fallback to center-fan capSolid if earcut returns empty.
- Cachebust app.js?v=31. Hard refresh required.

### 2026-07-04 fix (MakerDeck lid fit polish + perf)

**Thumbs-up on seated fit + floor artifact fix** (`geometry.js`, `app.js`, `index.html`, `style.css`)

- 👍 green badge with random Aussie phrase when lid seats ("Good as gold!", etc.).
- Box floor/bottom caps now use earcut (was still center-fan) — fixes dark floor patch in X-ray.
- Background trace on session restore deferred to idle and only when emboss trace enabled; cancelled during preview fit.
- Hide body wireframe during X-ray. Skip 3D render when tab hidden (unless animating).
- Cachebust app.js?v=30, style.css?v=10. Hard refresh required.

### 2026-07-04 fix (MakerDeck lid preview clarity)

**Rim guide rings + clean lid caps** (`makerforge/js/geometry.js`, `app.js`, `index.html`)

- Lid top/bottom caps use earcut triangulation instead of center-fan — removes moiré / floating rectangle artifact in X-ray.
- Preview fit shows coloured profile loops: orange box rim, green skirt (outside slip / inside plug), white plate.
- Replaced lid EdgesGeometry outline with profile loops that move with the animation.
- Cachebust app.js?v=29. Hard refresh required.

### 2026-07-04 feature (MakerDeck lid X-ray preview fit)

**Transparent box + ghost lid during Preview fit** (`makerforge/js/app.js`)

- Preview fit toggles X-ray: box walls ~18% opacity, lid ~46% with bright edge outline.
- See skirt slide over/outside walls (slip) or into cavity (plug). Restores solid view after animation.
- Cachebust app.js?v=28. Hard refresh required.


**Preview fit button on Lid tab** (`makerforge/js/app.js`, `index.html`)

- Animates lid: raised → seated → brief hold → back to preview gap (~2.5s).
- Preview-only; STL export unchanged. Cachebust app.js?v=27.


**Slip-over, inset plug, flat cap + fit clearance** (`makerforge/js/geometry.js`, `app.js`, `index.html`)

- Lid tab: type dropdown, skirt depth, thickness, fit clearance (slip/plug only).
- Flat cap = plate only; plug = skirt inside opening; slip-over = original outside skirt.
- Separate lid STL export unchanged (plate-down). Hard refresh app.js?v=26.


**Async trace — UI stays responsive** (`makerforge/js/trace.js`, `app.js`, `contour.js`)

- 4096px trace no longer blocks main thread; yields between heavy steps with "Tracing at high resolution…" status.
- Session restore loads 3D preview first, traces in background after boot.
- Skips storing 16M-pixel mask when shapeGroups present; pre-simplify long curves before Chaikin.
- Cachebust app.js?v=24. Hard refresh; page should load instantly, trace runs after.

- Refresh cachebust currently: MakerDeck app.js?v=24 / style.css?v=8 · Flightdeck app.js?v=623 / style.css?v=480
- MakerDeck: `https://flightdeck.tail7de73e.ts.net/makerdeck/` — hard refresh after pull
- Backend restart NOT required (only static files changed).

### 2026-07-04 fix (MakerDeck max-quality trace)

**4096px trace, color-layer separation, no rect downsampling** (`makerforge/js/trace.js`, `contour.js`, `features.js`)

- Trace raster now upscales to 4096px (was 1280 cap + downsample-only). SVG raster uses 2× supersample.
- Removed rect-count auto-downsample that was crushing quality before polygon extraction.
- Gentler simplify (tw/1400), 5× Chaikin passes, 1800pt curve budget.
- Minimal dilation — parts stay separate for slicer paint-by-region.
- Multi-colour PNG/SVG: each ink colour traced as separate islands (`N colour layers` in status).
- Cachebust app.js?v=23. Hard refresh + Clear from box + re-Trace. Use coloured source art for best part separation.


**Skeleton outline auto-fallback + open-polyline fixes** (`makerforge/js/trace.js`, `makerforge/js/contour.js`)

- Outline on double-edge art (converter PNG/SVG, brake-disc icon) now auto-falls back to printable silhouette when >6 paths or ring-like skeleton loops detected.
- Fixed Chaikin smoothing wrapping open centerlines back to start (was creating spurious closed rings).
- Trace preview no longer force-closes open stroke paths before drawing.
- Cachebust app.js?v=22. Hard refresh, hit **Trace** again (or Clear from box + re-import). Status should read `silhouette (auto — this art is double-edge, not single stroke)` for that brake icon.

### 2026-07-04 fix (MakerDeck smooth SVG/silhouette edges)

**Higher-res trace + gentler simplify + no double-smoothing** (`makerforge/js/trace.js`, `makerforge/js/contour.js`, `makerforge/js/features.js`)

- SVG rasterize at 1280px with supersample; silhouette simplify tolerance reduced (tw/480 not tw/200).
- 4× Chaikin on SVG import; build step no longer re-simplifies already-smoothed shapeGroups (was making stairs worse).
- Cachebust app.js?v=20. Re-import SVG after hard refresh.

### 2026-07-04 fix (MakerDeck SVG ring garbage + label priority)

**Silhouette-only SVG import; text label beats stale trace** (`makerforge/js/trace.js`, `makerforge/js/features.js`, `makerforge/js/app.js`)

- SVG import was auto-picking Outline on thin edge-detected art → dozens of concentric ring tubes on the box. Now always Silhouette + slight ink thicken for printable strokes.
- Label text now renders ahead of stale trace/SVG geometry (typing "Parts" no longer hides behind broken trace).
- Unchecking "Use SVG instead" clears trace from box. Outline stroke extrusion only closes paths that actually end where they start.
- Cachebust app.js?v=19. Hard refresh + Clear from box required to drop old session garbage.

### 2026-07-04 fix (MakerDeck SVG import via rasterize + trace)

**Converter SVGs no longer produce garbled ring geometry** (`makerforge/js/trace.js`, `makerforge/js/app.js`, `makerforge/js/features.js`)

- Label-tab SVG drop now rasterizes the file to a bitmap, auto-detects line art vs solid fill, and runs the same trace pipeline as Import (handles Bezier curves, edge-detected double-line SVGs from online converters).
- Vector `buildEmbossSvg` kept as fallback only; primary path is trace → emboss on box.
- Cachebust app.js?v=18. Hard refresh required.

### 2026-07-04 add (MakerDeck header toolbar)

**Undo / redo / clear / reset view moved to top bar — app-wide** (`makerforge/index.html`, `makerforge/js/app.js`, `makerforge/css/style.css`)

- Toolbar in header: Undo ↶, Redo ↷, Clear from box, Reset view (left of download buttons).
- Undo/redo now snapshots full app state (shape, dimensions, label, SVG, trace on box, import image) — works from any tab. Ctrl+Z / Ctrl+Y shortcuts work globally.
- Clear from box removes traced art, embossed text, and SVG from the box.
- Cachebust app.js?v=17 style.css?v=8. Hard refresh required.

### 2026-07-04 fix (MakerDeck SVG import + outline quality)

**SVG drop-in was broken; outline trace quality bumped** (`makerforge/js/features.js`, `makerforge/js/trace.js`, `makerforge/index.html`)

- SVG import now samples paths with native `getPointAtLength()` — handles cubic/quadratic Bezier curves from online converters (old parser only knew M/L/H/V, which produced random stacked rectangles).
- SVG emboss uses the same oriented stroke extrusion as outline trace, respects `stroke-width`, and sizes with `embossTraceSize` like traced art.
- Outline trace: 960px source resolution, 4× Chaikin passes, gentler simplify, slightly thicker stroke width.
- Cachebust app.js?v=16. Hard refresh required.

### 2026-07-04 fix (MakerDeck Houdini / blank preview)

**Duplicate `const` in `drawTracePreview`** (`makerforge/js/trace.js`) — `factor`/`ox`/`oy` declared twice in the same function; ES module failed to parse so the whole app never booted (blank 3D viewport). Also added outline stroke fallthrough if saved stroke data is corrupt. Cachebust app.js?v=15. Hard refresh required.

### 2026-07-04 add (MakerDeck outline trace quality)

**Outline mode now traces ink boundaries as smooth stroke paths** (`makerforge/js/trace.js`, `makerforge/js/contour.js`, `makerforge/js/features.js`, `makerforge/js/app.js`, `makerforge/index.html`)

- Replaced morphological 1px ring → filled polygon pipeline with proper boundary tracing (outer + hole perimeters).
- Preview draws stroked line art; SVG export uses stroke paths (fill=none, round joins) like professional converters.
- 3D emboss extrudes thick oriented segments on the chosen face instead of paper-thin filled bands.
- Extra Chaikin smoothing for outline; meta shows "N paths · line art".
- Cachebust app.js?v=14. Hard refresh required.

### 2026-07-04 add (MakerDeck feature batch)

**Face picker, Deboss, Vase / plant pot family, smoother traces** (`makerforge/js/features.js`, `makerforge/js/geometry.js`, `makerforge/js/vase.js` (new), `makerforge/js/contour.js`, `makerforge/js/app.js`, `makerforge/index.html`, `makerforge/css/style.css`)

- Label / Import emboss now lands on the chosen face: Front (visible), Back (opposite), Left, Right. `Front` = preview-visible face; text reads L→R correctly on all four.
- **Deboss (cut inward)** toggle in Label tab. Preview shows red cutter geometry so you can see where it lands; body STL prints clean (no letters). Separate **"Download deboss cutter"** STL — drop into slicer, set as *Negative Part / Modifier* to subtract.
- New shape **Vase / pot** with profiles: Cylinder / Tapered / Herbal (narrow top) / Urn (belly) / Amphora (long belly). Optional drainage hole, optional saucer STL.
- Small trace art (< 20 mm) now uses extra Chaikin passes + gentler simplify — no more chunky pixel stairs on tiny logos.
- Trace meta text now says "N islands · single colour · applied to <face> face" (previously "N stamps" — sounded like separate STLs).
- Generic `.hidden` CSS rule so new sections toggle correctly.

**No backend restart required — static-only.** Cachebust updated app.js?v=13 style.css?v=7. Hard refresh browser (Ctrl+Shift+R) after `git pull` on Pi.

### 2026-07-04 fix (MakerDeck traced emboss on wrong face)

**Traced silhouettes landed on box floor instead of chosen face** (`makerforge/js/contour.js`, `makerforge/js/features.js`)

- Face picker worked for text labels (`boxOnFace`) but traced art still used `extrudeShapeGroup`, which hardcoded Y ≈ 0.08 instead of the actual wall coordinate.
- New `extrudeShapeGroupBetween()` extrudes between full 3D surface points from the face frame — trace art now lands on Front / Back / Left / Right like text does.
- Cachebust app.js?v=13. Hard refresh required.

### 2026-07-04 fix (MakerDeck blank preview)

**Stray mid-file import in `makerforge/js/app.js`** — module failed to parse; preview and estimates dead.

### 2026-07-04 add (MakerDeck on Pi)

**Serve MakerDeck at `/makerdeck/`** (`app/main.py`, `makerforge/`)

- Static mount with no-cache headers; redirect `/makerdeck` → `/makerdeck/`.
- **Backend restart required** on Pi after `git pull`.

### 2026-07-04 add (MakerDeck / makerforge)

**Parametric box generator with trace emboss + session autosave** (`makerforge/`)

- Import tab: paste image, trace, apply emboss, clear/undo/redo.
- `localStorage` restores design on refresh.

### 2026-07-03 fix (native timelapse speed + first-layer start)

**Sparse capture and 30fps output; record from layer 1 not print start** (`app/native_recorder.py`, `app/main.py`, `app/static/app.js`, `app/static/index.html`, `SESSION_NEXT.md`)

- Was ~5fps wall-clock → playback felt like real-time; now one frame every 8s encoded at 30fps (Bambu-like timelapse).
- Recorder waits for layer ≥1 (or ~1.5% progress) before capturing — skips AMS prep/calibration preamble.
- Env: `FLIGHTDECK_TIMELAPSE_INTERVAL`, `FLIGHTDECK_TIMELAPSE_FPS`. Old clips get gentle auto speed-up if still long.
- Backend restart required; static `app.js?v=624`.

### 2026-07-03 polish (Live controls drawer header)

**Move Controls close into top bar; compact rail to fit calibration** (`app/static/app.js`, `app/static/style.css`, `app/static/index.html`, `SESSION_NEXT.md`)

- Removed duplicate Controls header inside the slide-out; close × sits beside the top Controls button when open.
- Tighter rail padding/gaps so temps + jog + calibrate fit without scrolling on desktop.
- Static cache `app.js?v=623` / `style.css?v=480`; hard refresh only.

### 2026-07-03 feature (remote Bambu calibration + calibrate-before-queue)

**Run calibration from Live; queue can calibrate then auto-start** (`app/printers/bambu.py`, `app/main.py`, `app/db.py`, `app/static/app.js`, `app/static/style.css`, `app/static/index.html`, `SESSION_NEXT.md`)

- Live Controls → Calibrate panel for Bambu (bed, vibration, motor noise; H2 adds nozzle offset).
- Queue pending jobs: **Cal first** checkbox runs calibration before dispatch, then auto-starts when idle.
- ntfy + decision log on calibration start/complete; preflight shows calibrating/will-calibrate states.
- Static cache `app.js?v=622` / `style.css?v=479`; **backend restart + hard refresh** required.

### 2026-07-03 fix (native timelapse finalize on cancel)

**Validate MP4 before attach; graceful ffmpeg shutdown on killed prints** (`app/native_recorder.py`, `SESSION_NEXT.md`)

- Killed prints (e.g. #390) could attach a corrupt clip (`moov atom not found`) — player showed 0:00 black with "Recorded · flightdeck-native".
- Stop now EOFs ffmpeg stdin and uses fragmented segment flags; ffprobe validates output before attach.
- Invalid clips are discarded — UI shows no timelapse instead of a broken player. Backend restart required.

### 2026-07-03 fix (camera freeze hardening — H2D live feed)

**Faster frozen-frame recovery and browser-side health polling** (`app/camera.py`, `app/main.py`, `app/static/app.js`, `app/static/index.html`, `SESSION_NEXT.md`)

- Backend: unified hard-restart on stale/frozen/dropped RTSP (10s frozen, 8min session recycle, 1s reconnect).
- New `/api/camera/{id}/health` exposes `changed_seq` so the UI detects H2D duplicate-frame freezes.
- Frontend polls health every 5s and force-reopens MJPEG streams when picture content stalls ~12s.
- Static cache `app.js?v=621`; **backend restart + hard refresh** on Pi.

### 2026-07-03 fix (camera black screen + single RTSP timelapse)

**Restore broken camera proxy init; record timelapse from shared MJPEG stream** (`app/camera.py`, `app/native_recorder.py`, `app/main.py`, `SESSION_NEXT.md`)

- `rtsp_url` property accidentally truncated `BambuCameraProxy.__init__` — live camera showed black + RECONNECTING.
- Native recorder now taps proxy frames (image2pipe) instead of opening a second RTSP session on H2D.
- Recorder holds keep ffmpeg alive while timelapsing with no browser viewers.
- **Backend restart required** on Pi.

### 2026-07-03 feature (native RTSP timelapse recorder)

**Flightdeck-native timelapse from live camera while printing** (`app/native_recorder.py`, `app/main.py`, `app/camera.py`, `app/db.py`, `SESSION_NEXT.md`)

- Bambu printers with RTSP camera now record a timelapse automatically on print start → stop on finish/cancel/error.
- Saves `{print_id}-{job}.mp4` under `flight_recorder/` and attaches with source `flightdeck-native`.
- Existing Bambu SD/MQTT auto-harvest still runs as fallback when native clip missing.
- Env `FLIGHTDECK_NATIVE_RECORDER=0` disables; default on. Backend restart required.

### 2026-07-03 fix (H2D false nozzle block + spool #98 label)

**Plate extruder_id nozzle parsing and display spool numbers** (`app/printers/bambu_ftp.py`, `app/main.py`, `app/static/app.js`, `app/static/index.html`, `SESSION_NEXT.md`)

- Single-plate H2D exports now read `<nozzle extruder_id="…">` from slice_info instead of mis-mapping global `filament_nozzle_map` to the wrong nozzle (Chris PETG job was blocked as right when plate targets left).
- Queue preflight spool labels and AMS slot badges use `display_id` (#97) instead of internal database id (#98).
- Backend restart required; static cache `app.js?v=620`.

### 2026-07-03 fix (Bambu Studio opens desktop, not Pi browser)

**Desktop Bambu Studio handoff via Windows worker** (`app/main.py`, `app/static/app.js`, `app/static/index.html`, `SESSION_NEXT.md`)

- `slicer_open_mode=bambu_studio` and MakerWorld/Print Vault handoffs now call `/api/slicer/open` with `target=bambu_studio` instead of opening the Pi browser Docker URL.
- Pi forwards model bytes to the configured Windows worker (`orcaslicer_worker_url`); worker launches installed `bambu-studio.exe` on the PC (same pattern as desktop Orca).
- Settings label updated to **Desktop Bambu Studio**; browser Bambu panel remains for manual Docker use only.
- Static cache `app.js?v=619`; **backend restart required** on Pi and Windows worker host.

### 2026-07-03 feature (Fleet Filament phases 2–4)

**Room actions, health strip, and queue mapping on Fleet Filament** (`app/static/app.js`, `app/static/style.css`, `app/static/index.html`, `SESSION_NEXT.md`)

- Phase 2: Room actions bar — bulk Trust all mismatches, Return empties from reported-empty AMS slots; slot click still quick-loads by spool #.
- Phase 3: Room health strip — AMS review, unattributed prints, loaded-low, queue filament gaps with links.
- Phase 4: Dispatch mapping panel — pending queue jobs vs loaded colours/readiness per printer.
- Static cache `app.js?v=618` / `style.css?v=478`; hard refresh only.

### 2026-07-03 fix (Find clip reusing same timelapse)

**Per-print Flight Recorder discovery** (`app/main.py`, `app/db.py`, `SESSION_NEXT.md`)

- Find clip no longer re-attaches another print's recorder file from the local pool; Bambu SD paths already used by another print are skipped too.
- Time-only matches now require a real print start/end window and land within 25 minutes of finish unless the filename/subtask matches.
- Backend/service restart required; no frontend cache bump.

### 2026-07-02 fix (bench order — Big Girl printer id)

**Fleet Filament sort now recognises Big Girl as `o1c2`** (`app/static/app.js`, `app/static/index.html`, `SESSION_NEXT.md`)

- Chris order X1C → Big Girl → BigBoy → Voron was wrong because Big Girl's config id is `o1c2`, not `h2c`; she was falling through to the bottom.
- H2C model detection still maps to the Big Girl slot if the id ever changes.
- Static cache `app.js?v=617`; hard refresh only.

### 2026-07-02 fix (bench order — Chris layout)

**Explicit bench order** (`app/static/app.js`, `app/static/index.html`, `SESSION_NEXT.md`)

- Printers sort X1C → Big Girl H2C → BigBoy H2D → Voron Greyhound everywhere bench order applies.
- Static cache `app.js?v=616`; hard refresh only.

### 2026-07-02 fix (bench order — X1 directly above Big Girl)

**Left-to-right bench walk on Fleet Filament** (`app/static/app.js`, `app/static/index.html`, `SESSION_NEXT.md`)

- Order is now BigBoy → X1C → Big Girl: X1 sits immediately above Big Girl with BigBoy first as the left-most bench printer.
- Static cache `app.js?v=615`; hard refresh only.

### 2026-07-02 fix (bench printer order)

**Stop pinning BigBoy to the top of the room board** (`app/static/app.js`, `app/static/index.html`, `SESSION_NEXT.md`)

- Bench sort is now X1C → BigBoy → Big Girl so the X1 sits above Big Girl without hoisting BigBoy to first place.
- Static cache `app.js?v=614`; hard refresh only.

### 2026-07-02 polish (bench printer order)

**Fleet Filament and nav follow physical bench layout** (`app/static/app.js`, `app/static/index.html`, `SESSION_NEXT.md`)

- Printer cards/tabs now sort X1C → BigBoy → Big Girl, then any others alphabetically.
- Applies to Fleet Filament, sidebar printer tabs, Dashboard cards/briefing, and Fleet Wall.
- Static cache `app.js?v=613`; hard refresh only.

### 2026-07-02 feature (Fleet Filament H2C rack view)

**H2C hotend rack on Fleet Filament board** (`app/static/app.js`, `app/static/style.css`, `app/static/index.html`, `SESSION_NEXT.md`)

- Big Girl's Fleet Filament card now has AMS / Rack tabs (same rack board as Live): toolhead panel + 6-bay induction rack.
- Card stats include rack loaded count; route strip hides on Rack tab so the board stays focused.
- Static cache `app.js?v=612` / `style.css?v=477`; hard refresh only.

### 2026-07-02 feature (Fleet Filament Phase 1)

**Whole-room AMS loadout board** (`app/static/app.js`, `app/static/style.css`, `app/static/index.html`, `SESSION_NEXT.md`)

- New `#/filament` Fleet Filament ops page: every printer's AMS loadout, feed routes, slot status, and spool assignments on one scroll (reuses Live AMS rows + Fleet Wall route strip).
- Room hero shows loaded/feeding/review counts; slot click still opens quick-load / Profile Doctor.
- Static cache `app.js?v=611` / `style.css?v=476`; hard refresh only.

### 2026-07-02 polish (compact Live toolbar)

**Slimmer, quieter top bar on Live view** (`app/static/app.js`, `app/static/style.css`, `app/static/index.html`, `SESSION_NEXT.md`)

- Replaced the full shouty command header with a compact single-line toolbar: printer · job · state · mini transport controls.
- Removed heavy shadow/blur, smaller type, thinner accent — camera feed is the focus again.
- Warnings only appear as a slim second row when something needs attention.
- Static cache `app.js?v=609` / `style.css?v=475`; hard refresh only.


**Scope ops drawer to camera stage so nozzle controls are not hidden** (`app/static/app.js`, `app/static/style.css`, `app/static/index.html`, `SESSION_NEXT.md`)

- Wrapped camera feed + controls rail in `live-deck-stage` below the persistent status bar; rail/backdrop no longer extend behind the toolbar.
- Open controls rail z-index raised above the status bar so temps/nozzle rows at the top are fully visible.
- Static cache `app.js?v=608` / `style.css?v=474`; hard refresh only.


**Replace hover dropdown header with always-visible status bar above camera** (`app/static/app.js`, `app/static/style.css`, `app/static/index.html`, `SESSION_NEXT.md`)

- Live printer/job/status header now sits in a persistent top bar above the camera feed (same dark card styling); Controls stays as its own separate button beside it.
- Removed hover-to-reveal dropdown over the camera — feed stays clean, status always readable.
- Static cache `app.js?v=607` / `style.css?v=473`; hard refresh only.


**Controls button restyled to match dropdown header bar** (`app/static/style.css`, `app/static/index.html`, `SESSION_NEXT.md`)

- Controls now uses the same rounded header card shape (0.75rem radius, left accent bar, blur/gradient) instead of a pill.
- Nudged left and the hover header inset uses a shared slot width so the two bars sit side-by-side without overlapping.
- Static cache `app.js?v=606` / `style.css?v=472`; hard refresh only.


**Keep Controls clickable and move REC beside Stream live** (`app/static/app.js`, `app/static/style.css`, `app/static/index.html`, `SESSION_NEXT.md`)

- Live hover header no longer steals clicks from the Controls button: header shell uses `pointer-events: none`, the panel itself stays interactive, Controls sits above at `z-index: 12`, and the header inset clears the button when the ops drawer is present.
- REC timelapse badge moved to the bottom-right beside the existing **Stream live** camera signal chip (shared `camera-bottom-status` bar).
- Static cache `app.js?v=605` / `style.css?v=471`; hard refresh only (no backend restart).


**Bambu timelapse discovery by filename time + always-visible REC overlay** (`app/main.py`, `app/static/app.js`, `app/static/style.css`, `app/static/index.html`, `SESSION_NEXT.md`)

- Flight Recorder discovery now parses Bambu `video_YYYY-MM-DD_HH-MM-SS` / `ipcam-record.*` filenames when FTP modified time is missing, scores by proximity to print end and whether the clip falls inside the print window, and strongly prefers `timelapse/` over `ipcam/` chunk files.
- Live camera view shows a top-left flashing red dot + **REC** badge whenever Bambu timelapse is enabled and the printer is printing or paused (removed the hidden-header timelapse chip).
- Static cache `app.js?v=604` / `style.css?v=470`; **backend/service restart required** for matcher changes, hard refresh for REC overlay.

### 2026-07-02 debug (Flight Recorder inspector + Live timelapse badge)

**Recorder debug panel and Bambu timelapse-on indicator in Live view** (`app/main.py`, `app/models.py`, `app/printers/bambu.py`, `app/static/app.js`, `app/static/style.css`, `app/static/index.html`, `SESSION_NEXT.md`)

- Print History / Passport Flight Recorder card now includes a `Recorder debug` expander that shows the printer state, recovered finished print id, MQTT timelapse hint, mapped FTPS paths, local candidate samples, and Bambu candidate samples.
- Added `/api/printers/{printer_id}/prints/{print_id}/timelapse/debug` so recorder troubleshooting is visible in the app instead of requiring SSH.
- Bambu live status now reads MQTT `print.ipcam.timelapse` and surfaces a clear `Timelapse on` / `Timelapse off` signal chip in the Live camera header.
- Static cache `app.js?v=603` / `style.css?v=469`; backend/service restart required for the new API/status field, hard refresh required for the UI.

### 2026-07-02 fix (Flight Recorder after backend restart mid-print)

**Startup-finish recorder harvest now survives backend restarts** (`app/main.py`, `app/printers/bambu.py`, `SESSION_NEXT.md`)

- H2D print `376` exposed a restart edge case: the backend restarted mid-print, then on boot saw Bambu `FINISH` with no in-memory active job and closed the row via `job_cleanup`.
- That startup cleanup path previously marked the print `FINISHED` but did not preserve `_last_finished_print_id` or the Bambu MQTT `timelapse_path`, so the new auto Flight Recorder harvest never ran.
- Bambu startup-finish cleanup now stores the recovered finished `print_id` plus any MQTT timelapse hint, and `_check_transitions()` now kicks off auto-harvest once when a printer first appears in `finished` state after restart.
- Static cache unchanged: `app.js?v=601` / `style.css?v=468`; backend/service restart required, frontend hard refresh not required.

### 2026-07-02 polish (Print Memory + Flight Recorder auto-harvest)

**Print Memory hero/briefing + automatic recorder harvest after print finish** (`app/main.py`, `app/printers/bambu.py`, `app/printers/moonraker.py`, `app/static/app.js`, `app/static/style.css`, `app/static/index.html`, `SESSION_NEXT.md`)

- Print Memory now has a reliability-focused hero (score, in-view/finished/failed/clip counts) and an operator-learning briefing for failed prints, missing recorder clips, and excluded stats rows.
- List rows get state-coloured left accents (finished/failed/cancelled/open); passport panel unchanged.
- Flight Recorder now auto-harvests after print finish/error: reads Bambu MQTT `timelapse_path` when present, retries local/Bambu SD discovery at 30/90/180s, attaches best match, logs `flight_recorder_auto_mqtt` / `flight_recorder_auto_discovered` / `flight_recorder_auto_miss`.
- History recorder copy updated; manual Find clip / Add video still available for older prints.
- Static cache `app.js?v=601` / `style.css?v=468`; **backend/service restart required** for auto-harvest.

### 2026-07-02 polish (Print Bay hero + briefing)

**Per-printer Print Bay glow-up aligned with Print Vault** (`app/static/app.js`, `app/static/style.css`, `app/static/index.html`, `SESSION_NEXT.md`)

- Printer bay hero now shows live machine state, local/vault/recent counts, and a cleaner machine-status line instead of plain descriptive copy.
- New bay briefing banner calls out local launch-ready files, matching vault files, and recent printer history at a glance.
- Existing on-machine storage and vault-match panels stay intact; this is a visibility/UX pass over the printer-specific bay view.
- Static cache `app.js?v=600` / `style.css?v=467`; hard refresh required.

### 2026-07-02 polish (MakerWorld hero + briefing)

**MakerWorld glow-up aligned with Print Vault / Queue** (`app/static/app.js`, `app/static/style.css`, `app/static/index.html`, `SESSION_NEXT.md`)

- Hero strip: token/plates/to-import/recent chips, cleaner import status line, and quick links to MakerWorld / Print Vault / token settings.
- New import briefing banner explains whether the next action is save token, import pending plates, open already-imported plates in the vault, or resume from recent imports.
- Existing resolve/import/recent workflow stays intact; this is a top-of-page operator UX pass, not a flow rewrite.
- Static cache `app.js?v=599` / `style.css?v=466`; hard refresh required.

### 2026-07-02 polish (Print Vault hero + briefing)

**Print Vault glow-up aligned with Queue / Dashboard / Flight Tower** (`app/static/app.js`, `app/static/style.css`, `app/static/index.html`, `SESSION_NEXT.md`)

- Hero strip: live status line, Ready/Vault/Bays Live/Reprints chips, quick links to MakerWorld / Queue / Flight Tower.
- New vault briefing banner calls out launch-ready files, source models waiting to be sliced, history-only reprints, and hidden printer bays.
- Existing Vault / Printer Bays / Reprints tabs stay intact, but the top of the page now reads like an operator launch surface instead of a plain file browser.
- Static cache `app.js?v=598` / `style.css?v=465`; hard refresh required.

### 2026-07-02 polish (Queue hero + briefing)

**Queue glow-up aligned with Dashboard / Fleet / Flight Tower** (`app/static/app.js`, `app/static/style.css`, `app/static/index.html`, `SESSION_NEXT.md`)

- Hero strip: live status line, Ready/Blocked/Caution/Active chips, quick links to Dashboard / Flight Tower / Print Vault.
- Dispatch briefing banner: clear-skies when queues are healthy; blocked/caution/active/recovery rows when not.
- Printer lanes get state-coloured left borders, live printer badge, and hover lift.
- Job cards get readiness accents (ready/caution/blocked) and slightly richer thumbs.
- Static cache `app.js?v=596` / `style.css?v=464`; hard refresh required.

- Pi deploy: `cd /home/flightdeck/flightdeck && git pull && sudo systemctl restart flightdeck.service`
- Pi SSH: `ssh -i C:\Users\Kidabah\.ssh\flightdeck_cursor -o IdentitiesOnly=yes flightdeck@100.106.112.104`

### 2026-07-02 fix (H2C rack toolhead side)

**H2C toolhead ids align with extruder path, not H2D-inverted mapping** (`app/printers/bambu.py`, `app/static/app.js`, `app/static/index.html`, `SESSION_NEXT.md`)

- Live MQTT on Big Girl puts the mounted hotend on toolhead id `0`, which is the right path (extruder 0 / `hotend_r`), not left.
- H2C parser now maps id `0` → Right, id `1` → Left; adds Flightdeck `nozzle` index on toolheads for route code.
- H2C AMS fallback: regular AMS → right nozzle, AMS HT → left (opposite of H2D layout).
- Idle route label uses loaded toolhead when neither side is actively heating.
- Static cache `app.js?v=595`; **backend restart required** on Pi.

### 2026-07-02 polish (Live View hover header + H2C route)

**Hover-reveal command header on camera; fix H-series nozzle index mapping** (`app/static/app.js`, `app/static/style.css`, `app/static/index.html`, `SESSION_NEXT.md`)

- Command header moved inside `.camera-hero` as `.live-hover-header` — drops in on hover/focus for all printers.
- Touch/coarse pointers: header stays visible at top (no hover).
- Fixed inverted nozzle labels: backend `0=Left`, `1=Right` now matches filament route + toolhead panel.
- H2C rack slot lookup prefers `tool.idx` from backend payload.
- Partial camera refresh preserves hover header wrapper.
- Static cache `app.js?v=594` / `style.css?v=463`; hard refresh required. No backend restart needed.

### 2026-06-30 polish (Dashboard hero + briefing)

**Dashboard glow-up — fleet snapshot hero, clear skies banner, printer card accents** (`app/static/app.js`, `app/static/style.css`, `app/static/index.html`, `SESSION_NEXT.md`)

- New hero strip: live status line, Active/Idle/Attention/Offline chips, quick links to Fleet Wall / Flight Tower / Queue.
- Clear skies briefing is now a green celebration banner with camera + tower shortcuts.
- Printer cards get state-coloured borders (printing blue, paused amber, fault red) and subtle hover lift.
- Static cache `app.js?v=587` / `style.css?v=456`; hard refresh required.

### 2026-06-30 polish (Fleet Wall hero + cards)

**Fleet Wall glow-up aligned with Dashboard** (`app/static/app.js`, `app/static/style.css`, `app/static/index.html`, `SESSION_NEXT.md`)

- Hero matches Dashboard energy: live status line, Live/Idle/Attention/Offline chips, quick links to Dashboard / Flight Tower / Queue.
- When one printer is printing, status calls it out by name and job.
- Printer tiles get stronger state borders, hover lift, and blue camera-frame glow when active.
- Progress bar pops more on live prints; per-printer "all clear" warnings use green check banner.
- Static cache `app.js?v=588` / `style.css?v=457`; hard refresh required.

### 2026-06-30 polish (Fleet Wall subtle name overlay)

**Move printer label onto camera feed instead of header band** (`app/static/app.js`, `app/static/style.css`, `app/static/index.html`, `SESSION_NEXT.md`)

- Removed the chunky top banner (icon, bold name, Bambu kind pill).
- Name + model now sit on a soft bottom gradient over the feed — security-cam style.
- Warning flags stay as small pills on the overlay when needed.
- Static cache `app.js?v=589` / `style.css?v=458`; hard refresh required.

### 2026-07-02 polish (Telemetry compact bento)

**One-screen shop vitals default; full boards on demand** (`app/static/app.js`, `app/static/style.css`, `app/static/index.html`, `SESSION_NEXT.md`)

- Default Telemetry is a 2×2 bento: host health, filament, RH, printer balance (scroll inside tiles).
- Removed redundant KPI strip and green briefing when all clear.
- `?focus=boards` expands all long-view panels; `?focus=rh` / `?focus=printers` for drills.
- Static cache `app.js?v=593` / `style.css?v=462`; hard refresh required.

### 2026-07-02 polish (Telemetry shop telemetry)

**Telemetry glow-up aligned with Dashboard / Fleet Wall / Flight Tower** (`app/static/app.js`, `app/static/style.css`, `app/static/index.html`, `SESSION_NEXT.md`)

- Hero card: live status line, Active/Avg RH/Logged/Failures/Host CPU chips, quick links.
- Briefing banner: clear / watch / humidity / host-stress states with jump links.
- KPI strip and long-view boards get section headers, hover lift, and warn accents.
- System health cards and printer balance rows use state-coloured left borders.
- Static cache `app.js?v=592` / `style.css?v=461`; hard refresh required.

### 2026-07-02 fix (X1C AMS mapping 07FF-8012)

**Stop misclassifying regular AMS trays as AMS HT on non-H2D printers** (`app/printers/bambu.py`, `SESSION_NEXT.md`)

- Greyhound Ludicrous (X1C) hit `07FF-8012` / failed AMS mapping table on queue job #144.
- Root cause: lone AMS 2 at unit id 1 produced flat tray 6, but `regular_ams_slots=4` made `ams_mapping2` point at AMS HT (128) instead of AMS 2 slot 3.
- `_regular_ams_slot_count()` now returns 0 unless an AMS HT unit is actually present.
- Added friendly decode for `07FF-8012`. **Backend restart required** on Pi.

### 2026-06-30 polish (Flight Tower offline filter)

**Rename printer filter Blocked → Offline** (`app/static/app.js`, `app/static/style.css`, `app/static/index.html`, `SESSION_NEXT.md`)

- Printer bucket/filter now says **Offline** (matches Dashboard/Fleet Wall when Voron is down).
- Offline printer lanes use muted slate border instead of red "blocked" styling.
- Queue **Blocked** KPI/panel unchanged — still for preflight failures.
- Legacy `?filter=blocked` URLs redirect to offline.
- Static cache `app.js?v=591` / `style.css?v=460`; hard refresh required.

### 2026-06-30 polish (Flight Tower dispatch center)

**Flight Tower glow-up aligned with Dashboard / Fleet Wall** (`app/static/app.js`, `app/static/style.css`, `app/static/index.html`, `SESSION_NEXT.md`)

- Hero card: **Dispatch center** with live queue status line, KPI chips, quick links.
- Operator board + printer lanes section headers.
- Printer lanes get state-coloured left borders (printing blue, blocked red, etc.) and hover lift.
- **Clear deck** inbox uses green check banner when nothing needs action.
- Static cache `app.js?v=590` / `style.css?v=459`; hard refresh required.

### 2026-06-29 feature (MakerWorld import missing only)

**Bulk import skips plates already in the Print Vault** (`app/makerworld.py`, `app/main.py`, `app/static/app.js`, `app/static/index.html`, `SESSION_NEXT.md`)

- `POST /api/makerworld/import-all` accepts `only_missing: true` (default false); bulk UI always sends true.
- Backend filters to plates not yet imported or needing vault-folder refresh before downloading.
- Button label **Import missing (N)** when some plates are already saved; **Move missing (N)** when only folder layout needs fixing.
- Response includes `skipped` count for plates left alone.
- Static cache `app.js?v=585`; **backend restart required** on Pi.

### 2026-06-29 fix (MakerWorld vault file detection)

**Recognize plates already on disk in the numbered vault folder** (`app/makerworld.py`, `SESSION_NEXT.md`)

- Resolve/import now treat `01 - …` / `02 - …` files in the model folder as already imported, even if MakerWorld recent history was cleared.
- Stops bulk import re-downloading all plates and creating timestamped duplicate 3MFs.
- **Backend restart required** on Pi.

### 2026-07-01 feature (smart queue from Print Vault)

**One-click vault queue with remembered printer + auto-dispatch** (`app/main.py`, `app/static/app.js`, `app/static/style.css`, `app/static/index.html`, `SESSION_NEXT.md`)

- Print Vault **Queue** button shows **Queue → BigBoy** when one idle compatible printer exists, or reuses your **last printer**.
- Single idle printer or last-used match queues **without** the picker dialog; opens Queue tab after add.
- Printer picker sorts idle/last-used first with **Last used** / **Ready** hints.
- `/api/files/queue` now triggers **auto-dispatch** when the printer is free (same as upload path).
- Static cache `app.js?v=584` / `style.css?v=454`; **backend restart required** on Pi.

### 2026-07-01 feature (queue auto-dispatch when idle)

**Auto-send next pending queue job when a printer is free** (`app/main.py`, `app/db.py`, `app/static/app.js`, `app/static/index.html`, `SESSION_NEXT.md`)

- Extends print-finish auto-dispatch: also triggers on **queue upload**, **retry**, **print cancel**, **service startup**, stale active-row cleanup, and a ~60s idle poll (picks up jobs when preflight later becomes ready).
- Skips when the printer is busy, errored, dispatch-locked, or preflight blocks; logs `queue_auto_dispatch` in the decision trail.
- Queue UI shows **auto-sends when free** on pending rows with no active job.
- **Backend restart required** on Pi; hard refresh for `app.js?v=583`.

### 2026-07-01 fix (Bambu FTP 553 upload errors)

**Clearer 553 messages and delete-before-upload on queue/relay sends** (`app/printers/bambu_ftp.py`, `SESSION_NEXT.md`)

- FTP **553 Could not create file** now explains missing/full SD storage and Studio filename conflicts instead of raw FTP text.
- **552** storage-full gets its own operator message.
- Queue and relay uploads delete an existing same-name file on the printer SD before `STOR` (avoids overwrite 553 when Bambu Studio sent the job first).
- Backend-only; **backend restart required** on Pi. No frontend cache bump.

### 2026-06-29 fix (Bambu Studio direct print spool_missing)

**Only warn spool_missing for the active AMS slot at print start** (`app/printers/bambu.py`, `SESSION_NEXT.md`)

- Direct Bambu Studio sends could log `spool_missing` for every loaded AMS tray without a Flightdeck spool — e.g. slot 4 while printing from slot 1.
- Print-start decision trail now logs `spool_missing` only when the tray is **active** (`tray_now` match).
- Messages use human labels (`AMS 1 slot 1`) instead of raw internal index (`AMS slot 3`).
- Backend-only; **backend restart required** on Pi. No frontend cache bump.

### 2026-07-01 fix (MakerWorld recent + import all)

**Clear recent imports + re-enable Import all for folder migration** (`app/makerworld.py`, `app/main.py`, `app/static/app.js`, `app/static/style.css`, `app/static/index.html`, `SESSION_NEXT.md`)

- Recent imports card gets **Clear all** — clears `makerworld_imports.json` history only; Print Vault files stay put. `POST /api/makerworld/recent/clear`.
- **Import all** / **Move all to folder** stays enabled when plates are imported but still at flat `MakerWorld/` paths (`needs_vault_refresh` from resolve).
- Static cache `app.js?v=579` / `style.css?v=451`; **backend restart required** on Pi.

### 2026-06-30 fix (Print Vault folders)

**Print Vault folder groups + MakerWorld re-import into model folders** (`app/main.py`, `app/makerworld.py`, `app/static/app.js`, `app/static/style.css`, `app/static/index.html`, `SESSION_NEXT.md`)

- Print Vault (`#/files`) now groups library files into collapsible folders (e.g. `MakerWorld/EasySpooler_1234567/`) instead of one flat list.
- Multi-plate MakerWorld imports that still sit flat in `MakerWorld/` are re-downloaded into the model subfolder on next import; superseded flat copies are removed.
- Static cache `app.js?v=578` / `style.css?v=450`; **backend restart required** on Pi.

### 2026-06-30 hotfix (app.js syntax)

**Fix duplicate `plateCount` declaration breaking entire UI** (`app/static/app.js`, `app/static/index.html`, `SESSION_NEXT.md`)

- `_makerWorldPreviewHtml()` declared `const plateCount` twice in the same scope → `SyntaxError: Identifier 'plateCount' has already been declared` prevented `app.js` from loading at all.
- Static cache `app.js?v=577`; hard refresh required after deploy (UI-only).

### 2026-06-30 fix (MakerWorld multi-plate vault layout)

**MakerWorld multi-plate folders, numbered files, and plate labels** (`app/makerworld.py`, `app/static/app.js`, `app/static/style.css`, `app/static/index.html`, `SESSION_NEXT.md`)

- Multi-plate models (2+) import into `MakerWorld/{slug}_{designId}/` with filenames like `01 - Plate title.3mf` (sorted default-first, then title).
- Single-plate models still land flat in `MakerWorld/`. Already-imported plates keep their existing vault path until re-imported.
- Resolve API returns `vault_folder`, `plate_index`, and `plate_total`; UI shows **Plate N of M**, colour accents, thumb badges, and target folder hint before import.
- Static cache `app.js?v=576` / `style.css?v=449`; **backend restart required** on Pi (`git pull` then `sudo systemctl restart flightdeck.service`).

### 2026-06-30 fix (MakerWorld import all)

**MakerWorld import-all plates + legacy fallback** (`app/makerworld.py`, `app/main.py`, `app/static/app.js`, `app/static/style.css`, `app/static/index.html`, `SESSION_NEXT.md`)

- Multi-plate models get **Import all to Vault** on `#/makerworld`; backend `POST /api/makerworld/import-all` loops profiles via existing single-plate import.
- If the Pi backend has not been restarted yet, bulk import 404s — frontend falls back to sequential per-plate `/api/makerworld/import` calls with `Importing N/M…` progress.
- Static cache `app.js?v=574`; **backend restart required** on Pi for the bulk endpoint (`sudo systemctl restart flightdeck.service` after `git pull`).

### 2026-06-30 fix (Skip object map — Bambuddy-style preview)

**Align skip-object map to Bambu top preview + plate bbox_all** (`app/printers/bambu_ftp.py`, `app/printers/bambu.py`, `app/static/app.js`, `app/static/style.css`, `app/static/index.html`, `SESSION_NEXT.md`)

- Root cause: Flightdeck derived skip-map positions from gcode geometry with custom axis transforms; Bambuddy/Bambu align markers to `Metadata/plate_N.json` `bbox_objects` centers mapped through `bbox_all` onto `top_N.png` with `object-contain`.
- Parser now reads `bbox_all` + `bbox_objects` (same as Bambuddy), API exposes `bbox_all`, and the UI places circular ID markers on the top preview image using the same percentage math. Static cache `app.js?v=572` / `style.css?v=447`; hard refresh after deploy.

### 2026-06-30 fix (Skip object map depth axis)

**Fix inverted front/back axis on skip-object map** (`app/static/app.js`, `app/static/style.css`, `app/static/index.html`, `SESSION_NEXT.md`)

- Root cause: bed depth used `(by+bh-y)` so objects like Benchy #245 landed on the wrong side; convex-hull gcode polygons drew trapezoid artefacts.
- Depth now uses `(y-by)` (back=left, front=right); footprints are bbox rects sharing the ID badge transform; Bambu top preview restored with 90° rotation. Static cache `app.js?v=571` / `style.css?v=446`; hard refresh after deploy.

### 2026-06-30 fix (Skip object footprint flip)

**Flip gcode footprints front/back on skip-object map** (`app/static/app.js`, `app/static/style.css`, `app/static/index.html`, `SESSION_NEXT.md`)

- Skip ID badges were already aligned with the printer screen; gcode footprint polygons were mirrored front/back relative to them.
- Footprints now use a separate front/back flip while ID tags stay put; removed the rotated Bambu bed PNG and gcode line-segment overlay (source of white-square/double-silhouette artefacts). Static cache `app.js?v=570` / `style.css?v=445`; hard refresh after deploy.

### 2026-06-30 fix (Skip objects bed map alignment)

**Align Bambu skip-object map IDs to gcode footprints** (`app/static/app.js`, `app/static/style.css`, `app/printers/bambu.py`, `app/static/index.html`, `SESSION_NEXT.md`)

- Root cause: top-down skip maps used a separate mirror/rotate transform for ID badges while the bed preview image used `object-fit: contain`, so multi-object plates (e.g. `mixed`) showed #245 on the wrong silhouette even though gcode geometry was correct.
- Top-down maps now use one bed-mm → screen transform (front on the right, bed-left toward the top), draw per-object gcode footprints as the primary overlay, and place each skip button over the object bbox with the ID centered on the shape.
- Bambu `top_N.png` is rotated 90° to match gcode orientation; footprints are the primary overlay. Static cache `app.js?v=569` / `style.css?v=444`; hard refresh required after deploy (UI-only).

### 2026-06-30 fix (H2D filament slot nozzle index)

**Fix H2D nozzle map keyed by global filament slot id** (`app/printers/bambu_ftp.py`, `SESSION_NEXT.md`)

- Root cause: `filament_nozzle_map` is indexed by **project filament slot** (1, 2, 3…), but `_parse_3mf()` assigned `filament_nozzles[idx]` using the plate XML element index. A plate using only filament **#2** (e.g. grey PLA on `mixed.gcode.3mf`) inherited slot **#1**'s nozzle (right) instead of slot **#2**'s (left), causing false `H2D nozzle/AMS mismatch` blocks.
- Nozzle assignment now uses `int(filament@id) - 1`, matching the existing gcode T-command indexing comment. Pending H2D queue jobs re-read the stored 3MF at preflight. **Backend restart required**; re-queue or refresh preflight after deploy.

### 2026-06-30 fix (Recover grams FTP fallback)

**Recover grams tries printer FTP when relay log is missing** (`app/db.py`, `app/printers/bambu_ftp.py`, `app/main.py`, `app/static/app.js`, `app/static/index.html`, `SESSION_NEXT.md`)

- Direct slicer → printer sends have no relay upload log, so History **Recover grams** failed even when `subtask_name` (e.g. `rack_spool`) and the 3MF still exist on printer SD.
- Repair now tries relay first, then Bambu FTP (`{subtask}.gcode.3mf`, fuzzy storage match, `plate_N.gcode` header parse).
- Clearer error when both miss: assign manually. Static cache `app.js?v=567`; **backend restart required** on Pi.

### 2026-06-30 fix (Direct slicer spool metadata)

**Recover spool metadata for direct slicer → printer sends** (`app/printers/bambu_ftp.py`, `app/printers/bambu.py`, `app/db.py`, `SESSION_NEXT.md`)

- Root cause: Queue/Relay uploads persist 3MF filament grams; **Send directly to printer IP** bypasses Flightdeck, so History rows had no grams and spool deduction was skipped.
- Bambu FTP preview now tries `{name}.gcode.3mf`, `{name}.3mf`, `plate_N.gcode`, fuzzy-matches storage filenames like `rack_spool_*`, and parses gcode headers when only plate gcode exists.
- At print start, Flightdeck also auto-applies matching **relay upload** metadata when the slicer was pointed at the Flightdeck physical-printer URL.
- Existing prints: History → **Recover grams** → **Assign manually** still works. **Backend restart required** on Pi; no frontend cache bump.

### 2026-06-30 fix (Slice modal, MakerWorld token, Desktop Orca)

**Slice modal, MakerWorld fixes, token/password UX, Desktop Orca handoff** (`app/main.py`, `app/static/app.js`, `app/static/style.css`, `app/static/index.html`, `SESSION_NEXT.md`)

- **Slice modal:** Manual workflows hide headless profile/support/brim fields; primary button matches workflow (Open in Desktop Orca / Bambu / headless). H-series printers show Bambu Studio hint. Fixed broken `preparePlan` / `_makerWorldBusy` ReferenceError that broke MakerWorld Resolve.
- **Desktop Orca:** Windows worker now launches `orca-slicer.exe <file>` directly instead of `os.startfile` first, so models load on the plate instead of opening empty Orca via “pick an app”.
- **Chrome password popup:** Bambu Cloud token no longer returned from `GET /api/settings`; saved tokens show as “Token saved · hint” + Replace (no credential field in DOM). Browser Orca docker password redacted the same way. Settings/Slicer DOM cleared when leaving those views.
- Static cache bumped to `app.js?v=566` and `style.css?v=442`; **backend restart required** on Pi for settings redaction + Orca launch path.


**Add Save & Slice handoff on MakerWorld plates** (`app/static/app.js`, `app/static/style.css`, `app/static/index.html`, `SESSION_NEXT.md`)

- Each plate now has **Save & open in slicer** (primary) plus **Save to Vault** (secondary). Already-imported plates get **Open in slicer** from the vault copy.
- Handoff follows Settings → Slicer → **Open in Slicer** (`Bambu Studio Docker`, `Browser Orca`, or `Desktop Orca`). Bambu Studio path opens the browser sidecar and triggers a vault download for import.
- Recent imports rows also get a slicer shortcut. Static cache bumped to `app.js?v=560` and `style.css?v=436`; frontend refresh required.


**Expose Bambu Cloud token paste on MakerWorld page** (`app/static/app.js`, `app/static/style.css`, `app/static/index.html`, `SESSION_NEXT.md`)

- Added a visible token field + **Save token** button directly on `#/makerworld`, plus the same explicit save control in Settings → Preferences → Bambu Cloud.
- Prior importer work was still local-only (never committed), which is why deploy reported nothing to change.
- Static cache bumped to `app.js?v=558` and `style.css?v=435`; backend restart plus hard refresh required.


**Add MakerWorld URL importer** (`app/makerworld.py`, `app/main.py`, `app/db.py`, `app/static/app.js`, `app/static/style.css`, `app/static/index.html`, `SESSION_NEXT.md`)

- MakerWorld page now resolves `makerworld.com/models/…` links against `api.bambulab.com`, previews plates, and saves 3MF files into Print Vault → `MakerWorld/`.
- Downloads use the locally stored Bambu Cloud bearer token (`Settings → Preferences → Bambu Cloud → Cloud token`, copied from the makerworld.com `token` cookie). Metadata resolve works without a token.
- Added `/api/makerworld/status`, `/resolve`, `/import`, `/recent`, and host-allowlisted `/thumbnail` proxy. Import history is tracked in `makerworld_imports.json` under the Flightdeck data dir.
- Static cache bumped to `app.js?v=557` and `style.css?v=434`; backend restart plus frontend refresh required.


**Match AMS HT loadout card height to AMS 1** (`app/static/style.css`, `app/static/index.html`, `SESSION_NEXT.md`)

- Shared CSS vars for slot width and slots-panel height so AMS HT uses the same bay size and card height as a regular 4-slot AMS unit.
- Loadout row uses stretch alignment so both unit cards line up top and bottom.
- Static cache bumped to `style.css?v=433`; hard refresh required.

### 2026-06-29 UX (live camera height rebalance)

**Rebalance live camera height** (`app/static/style.css`, `app/static/index.html`, `SESSION_NEXT.md`)

- Previous cap (~46vh max) lifted the AMS block too high with a large dead gap below. Camera min is now ~52vh (was 58vh originally, 38vh on the over-correction) with no max-height cap so the feed still fills the column naturally.
- Static cache bumped to `style.css?v=431`; hard refresh required.

### 2026-06-29 UX (compact AMS load popover)

**Anchor compact AMS load popover near clicked slot** (`app/static/app.js`, `app/static/style.css`, `app/static/index.html`, `SESSION_NEXT.md`)

- Quick load is now a ~220px popover positioned below (or above) the AMS slot you clicked, not a top-of-screen modal.
- Compact row: slot label, `#` input, **Load** button, tiny preview line, optional **Last: #N**, **Profile doctor** link.
- Static cache bumped to `app.js?v=556` and `style.css?v=429`; hard refresh required.
- Pi deploy: `cd /home/flightdeck/flightdeck && git pull && sudo systemctl restart flightdeck.service`
- Pi SSH (Tailscale): `ssh -i ~/.ssh/flightdeck_cursor flightdeck@100.106.112.104`

### 2026-06-29 fix (quick load opens doctor by mistake)

**Fix AMS slot click opening full doctor instead of quick load** (`app/static/app.js`, `app/static/index.html`, `SESSION_NEXT.md`)

- A legacy document-level click handler still routed every `data-slot-edit` click to the full Profile Doctor, so users saw the modified doctor with quick-load at the top instead of the compact Load & sync dialog.
- Slot swatch clicks now open the small quick-load dialog everywhere (dashboard, live, fleet wall). Full doctor is only via the slot `⋯` button or **Full AMS Profile Doctor** in the quick dialog.
- Removed the quick-load row from the top of the full doctor so that modal is unchanged again.
- Static cache bumped to `app.js?v=555`; hard refresh required.

### 2026-06-29 UX (quick AMS load by spool #)

**Add quick AMS load by spool number** (`app/static/app.js`, `app/static/style.css`, `app/static/index.html`, `SESSION_NEXT.md`)

- Clicking an AMS slot now opens a compact **Load & sync** dialog first: type rack label spool number (e.g. `93`), Enter or click Load — assigns in Flightdeck and pushes profile to Bambu (same as Trust Flightdeck) in one step.
- Full **AMS Profile Doctor** remains available via the `⋯` button on dashboard AMS slots or **Full AMS Profile Doctor** in the quick dialog / doctor modal.
- Doctor modal also has a **Quick load by spool #** row at the top for the same one-step flow.
- Static cache bumped to `app.js?v=554` and `style.css?v=428`; frontend refresh required after deploy (UI-only, no backend restart strictly required but harmless).

### 2026-06-29 fix (generic AMS slot assign)

**Fix generic AMS auto-claim and slot assign UX** (`app/main.py`, `app/db.py`, `app/static/app.js`, `app/static/index.html`, `SESSION_NEXT.md`)

- BigBoy AMS 1 S3 could show Bambu generic black PLA with no Flightdeck spool number while the physical roll was spool #93 light gold. Generic Bambu reports are stale/wrong colour — expected until Trust Flightdeck writes the real profile.
- Fixed dead auto-claim path: generic slots were blocked by the low-confidence guard before the generic handler could run. Generic loads now auto-claim via slot memory + material match (ignores wrong Bambu colour).
- Slot memory expanded: `get_recent_spool_for_slot()` now reads decision-log moves, not just print snapshots.
- AMS slot cards show orange **Assign** when printer reports loaded but Flightdeck has no spool; Profile Doctor explains generic/stale colour.
- Assigning from Profile Doctor on generic/incomplete reports now sends `sync_ams` so Bambu gets the real spool profile immediately.
- Added `GET /api/printers/{id}/slots/{slot}/memory` and Profile Doctor **Last spool in this slot** suggestion.
- Static cache bumped to `app.js?v=553`; backend restart plus frontend refresh required after deploy.

### 2026-06-29 feature (AMS auto-claim v2)

**Restore AMS auto-claim on fresh slot transitions** (`app/main.py`, `app/db.py`, `app/static/app.js`, `app/static/index.html`, `SESSION_NEXT.md`)

- Re-enabled `_reconcile_reported_loaded_slots()` with transition-based safety: only auto-claims when a poll sees empty→loaded or a profile/colour change, not on persistent stale AMS HT tray data (the failure mode that disabled auto-claim in `27f8d17`).
- First poll after restart establishes a baseline fingerprint per slot — no claim on stale reports already sitting there.
- Still requires unique high-confidence shelf match, physical-present tray signal, and skips generic/unknown Bambu profiles unless slot memory points at a specific spool.
- Respects empty-slot auto-return grace window so a just-returned spool is not immediately re-claimed.
- New preference **Settings → Preferences → AMS Inventory → Auto-claim on load** (`ams_auto_claim_enabled`, default on).
- Static cache bumped to `app.js?v=552`; backend restart plus frontend refresh required after deploy.


**Raise spool label metadata above number box** (`app/label_printer.py`, `SESSION_NEXT.md`)
Moved material, brand, and colour/hex lines up and dropped the hero number box slightly so the top text no longer crowds the bordered spool number. Backend/service restart required after deploy. No frontend cache bump needed.

### 2026-06-29 polish (spool label height trim)

**Trim spool label height while keeping hero number** (`app/label_printer.py`, `SESSION_NEXT.md`)
Full spool stickers drop from `696x430` to `696x340` by tightening top metadata spacing and bottom footer margin while keeping the large bordered spool number box and QR readable. Backend/service restart required after deploy. No frontend cache bump needed.

### 2026-06-29 polish (spool label hero number)

**Make spool label number large without Spool # prefix** (`app/label_printer.py`, `SESSION_NEXT.md`)
Full spool stickers now drop the `Spool #` prefix and render the visible spool number alone inside a large bordered box (up to 156pt for short numbers) so it reads clearly from across the room. Material, brand, and colour stay above the number box; location and QR stay on the right. Backend/service restart required after deploy. No frontend cache bump needed.

### 2026-06-29 fix (spool vs rack label templates)

**Keep spool and rack labels on separate templates** (`app/label_printer.py`, `app/main.py`, `app/static/app.js`, `app/static/index.html`, `app/static/demo.html`, `SESSION_NEXT.md`)
Flightdeck prints three distinct Brother QL-700 layouts: full spool stickers for filament rolls (`696x430`, material/brand/colour/`Spool #N`/plain `Loc:`/QR), compact rack-position strips for numbered cupboard slots (`696x210`, big slot number/material/`Rack Row N · 1-10`/QR), and short rack-row wall markers via `render_location_label()` (`696x190`). Normal spool print paths now always use the full template; compact printing is only exposed as `Rack label` / `rack-label` actions. AMS slot label buttons were corrected back to the full spool sticker instead of the rack strip. Static cache bumped to `app.js?v=551`; backend restart required after deploy for label rendering, frontend hard refresh for the new buttons.

### 2026-06-29 fix (H2D queue preflight left AMS nozzle parsing)

**Fix H2D queue preflight left AMS nozzle parsing** (`app/main.py`, `app/printers/bambu_ftp.py`, `app/db.py`, `SESSION_NEXT.md`)
Follow-up after `b857b50` made BigBoy/H2D queue blocks worse: a Bambu Studio job grouped to the left nozzle with red PETG in regular AMS 2 Pro slot 1 could show `job is sliced for right nozzle, but matching petg Red is loaded in AMS 1 slot 1 (left nozzle)`. The real fixes are split: `_spool_h2d_nozzle()` must map regular AMS slots to left (`0`) and AMS HT to right (`1`), and the 3MF parser must keep translating Bambu `physical_extruder_map` / MQTT extruder ids (`0=right`, `1=left`) into Flightdeck queue ids (`0=left`, `1=right`) via `_bambu_nozzle_to_flightdeck()`. Removing that swap in `b857b50` was incorrect and is reverted. H2D pending jobs still re-read the stored queue 3MF at preflight so existing rows pick up the corrected nozzle without re-upload. Backend/service restart required after deploy. No frontend cache bump needed.

### 2026-06-29 fix (H2D queue preflight nozzle-path stock)

**Fix H2D queue preflight nozzle-path stock checks** (`app/main.py`, `app/printers/bambu_ftp.py`, `app/db.py`, `SESSION_NEXT.md`)
BigBoy/H2D queue jobs could block with `Loaded nozzle-path stock short: left nozzle Red (no loaded spool) 0g/43g` even when the matching Flightdeck spool was loaded in regular AMS with enough grams. `_spool_h2d_nozzle()` in queue preflight still mapped regular AMS slots to the right path, pending queue rows kept stale inverted nozzle metadata from upload time, and H2D pending jobs now re-read the stored queue 3MF at preflight time so existing rows pick up corrected nozzle metadata without re-upload. `queue_list()` now includes `file_path` for that refresh path. Note: commit `b857b50` also removed the required `_bambu_nozzle_to_flightdeck()` swap and was corrected in the follow-up above. Backend/service restart required after deploy. No frontend cache bump needed.

### 2026-06-29 fix (H2D nozzle-path blocker and spool labels)

**Fix H2D regular AMS nozzle fallback** (`app/main.py`, `app/printers/bambu.py`, `app/relay.py`, `SESSION_NEXT.md`)
Flightdeck could block correctly sliced H2D jobs by claiming the file was sliced for the right nozzle even when Bambu Studio's filament grouping showed the filament under the left nozzle. The bug was an inverted fallback in H2D AMS-path handling: comments said regular AMS feeds the left path and AMS HT feeds the right path, but the fallback numbers were assigning the opposite. H-series nozzle labels are now consistently `0=left` and `1=right`, with H2D regular AMS mapped to left and AMS HT mapped to right when the printer does not provide a live extruder map. Backend/service restart required after deploy.

**Keep normal spool labels off the rack template** (`app/label_printer.py`, `SESSION_NEXT.md`)
The compact QL-700 label default made normal spool-label prints use the short rack-position style, so the user-facing spool label looked like a rack label. Normal spool labels now always use the full spool template, while rack/location labels keep their compact rack format. Backend/service restart required after deploy if labels are printed from the live Pi service. No frontend cache bump needed.

### 2026-06-28 polish (rack labels include loaded spools)

**Keep loaded spools on their home rack for labels** (`app/static/app.js`, `app/label_printer.py`, `app/static/index.html`, `app/static/demo.html`, `SESSION_NEXT.md`)
Rack/location labels now treat a loaded spool as still belonging to its home rack row, so the location overview can print all rack labels even when some rolls are currently loaded in AMS/AMS HT. Loaded rolls remain visibly loaded by adding their printer/slot in the location row, while spool labels now print the home rack location instead of dropping the location line when the spool is in a printer. Static cache bumped to `app.js?v=549`; frontend hard refresh required after deploy. No printer command, AMS mapping, queue-dispatch, or spool-deduction code was touched.

### 2026-06-29 fix (spool labels vs rack labels)

**Keep spool labels separate from rack labels** (`app/label_printer.py`, `SESSION_NEXT.md`)
The last rack-label polish accidentally made normal spool stickers inherit rack-style location text such as `Rack 31-40`, which made spool labels read like rack labels. Spool labels now go back to printing the plain home/storage location name, while rack labels remain their own dedicated format. The compact spool sticker also drops the `#` prefix from the big visible number so it fits the box more cleanly. Backend/service restart required after deploy if labels are printed from the live Pi service. No frontend cache bump needed.

### 2026-06-28 polish (H2D live nozzle panel)

**Hide H2D H-series hotend deck in Live** (`app/static/app.js`, `app/static/index.html`, `app/static/demo.html`, `SESSION_NEXT.md`)
BigBoy/H2D could show an extra `Left nozzle` / `Right nozzle` H-series hotend panel underneath the AMS loadout, which looked like another feed/rack state even though H2D does not have the H2C induction rack workflow. The Live environment renderer now keeps that H-series hotend/rack deck scoped to H2C only. H2D still shows the useful filament route target and AMS/AMS HT loadout, while Big Girl/H2C keeps the AMS/Rack tabs. Static cache bumped to `app.js?v=548`; frontend refresh required after deploy. UI-only: no backend, printer command, AMS mapping, queue-dispatch, or spool-deduction code was touched.

### 2026-06-28 fix (H-series AMS HT direct-start spool snapshots)

**Repair H-series AMS HT slot snapshots** (`app/printers/bambu.py`, `app/db.py`, `SESSION_NEXT.md`)
Direct printer-screen/storage starts on H-series Bambu printers could create a History row with `spool_missing No spool assigned to AMS slot 128` even when the matching spool was loaded/assigned. The Bambu firmware reports AMS HT through a mix of canonical unit IDs (`128+`) and flat sequential tray IDs, so print-start snapshots could fail to match the stored Flightdeck spool assignment and then stay wrong because existing snapshots were never updated after restart. `_snapshot_ams_slots()` now records the flat tray ID alongside the canonical slot and marks active slots using either value. Print-start active-slot attribution now stores the canonical Flightdeck slot, and snapshot enrichment falls back through the flat tray ID when resolving the assigned spool. `write_slot_snapshot()` still preserves original print-start data, but can now repair missing spool assignments and active-slot metadata when a later poll has better information. Backend/service restart required after deploy. No frontend cache bump needed.

### 2026-06-28 fix (direct printer-panel Bambu starts)

**Hydrate direct Bambu print metadata** (`app/printers/bambu.py`, `SESSION_NEXT.md`)
Bambu prints started straight from the printer screen/storage could create a History row but miss the 3MF preview metadata because Flightdeck only knew how to hydrate jobs that came through its queue. That left direct BigBoy/Big Girl starts without the expected thumbnail/filament metadata path and could prevent live/history spool deductions when the print never had a Flightdeck queue row. The Bambu adapter now resolves a source subtask from the printer-reported filename when no queue job exists, fetches/caches the same FTP preview metadata used by queued jobs, and attaches filament grams/material to the running print row at start, live deduction, and finish. Limitation: if firmware only reports `plate_N.gcode` and there is no active queue/source filename to fall back to, Flightdeck still cannot infer the original 3MF. Backend/service restart required after deploy. No frontend cache bump needed.

### 2026-06-28 fix (H-series live filament route selection)

**Use live route colour for H-series loaded toolhead** (`app/static/app.js`, `app/static/index.html`, `app/static/demo.html`, `SESSION_NEXT.md`)
Big Girl/H2C rack/toolhead view could show the loaded hotend with the stale colour reported by the hotend rack payload, even though the live filament route already knew the active AMS/spool colour. The H-series toolhead renderer now prefers the single active live route colour for the mounted toolhead while leaving stored rack bays to use their own hotend colours. Static cache bumped to `app.js?v=547`; frontend hard refresh required after deploy. No backend, AMS mapping, queue dispatch, or spool deduction code was touched.

**Fix H-series rack toolhead nozzle labels** (`app/printers/bambu.py`, `SESSION_NEXT.md`)
Big Girl/H2C rack view could show a loaded hotend under `Right nozzle` when the physical/Bambu-screen view showed it in the left nozzle. The H-series hotend rack payload reports physical rack nozzle IDs opposite to the temperature/extruder payload used by the live route code, so only the rack/toolhead parser label mapping was flipped. Live filament route selection, AMS mapping, queue dispatch, and spool deduction paths were not changed. Backend restart required after deploy.

**Fix H-series live filament route selection** (`app/printers/bambu.py`, `app/static/app.js`, `app/static/index.html`, `app/static/demo.html`, `SESSION_NEXT.md`)
Big Girl/H2C could show a stale regular AMS slot as the active route, so the Live filament route displayed `AMS 1 · S1` red feeding the right nozzle even when the active print was using AMS HT grey on the left nozzle. Bambu MQTT can leave regular AMS tray flags active while the actual active toolhead/nozzle has moved, so Flightdeck now carries AMS nozzle hints from the backend and, for dual-nozzle non-H2D H-series printers, prefers the active heated nozzle plus the AMS HT loaded tray signal before trusting stale slot-active flags. H2D's fixed regular-AMS-left / AMS-HT-right rule remains scoped to H2D only. Static cache bumped to `app.js?v=546`; backend restart plus frontend hard refresh required after deploy.

### 2026-06-28 fix (rack row range parsing)

**Keep rack rows locked to their visible number range** (`app/static/app.js`, `app/static/index.html`, `app/static/demo.html`, `SESSION_NEXT.md`)
Settings > Locations rack-row overview could still fall back to old storage-location membership when a rack row name/note used older punctuation or did not expose a clean `slots 1-10` range. That made Row 1 show unrelated stored spools such as `#21` or `#43` instead of only numbers `#1` through `#10`. Rack range parsing now prefers explicit `slots X-Y`, accepts normal hyphens/en dashes/em dashes, falls back to the final range in the row text, and finally derives `Rack Row N` as `((N-1)*10+1)..+9`. Non-rack locations still group by assigned location. Static cache bumped to `app.js?v=545`; frontend refresh required after deploy.

### 2026-06-28 polish (compact rack labels)

**Keep rack-row overview cards aligned by spool number** (`app/static/app.js`, `app/static/index.html`, `app/static/demo.html`, `SESSION_NEXT.md`)
Settings > Locations now treats rack-row cards as number-range views, so `Rack Row 1 · 1-10` only shows stored active spools with visible numbers `#1` through `#10` even if older location assignments still point somewhere else. Non-rack locations still group by their assigned location as before. Numbered spools that fall inside a rack row are also kept out of the Unassigned card, so the overview matches the physical rack story immediately; the existing `Build rack rows` action remains the database repair pass that can move stored spools into their matching row. Static cache bumped to `app.js?v=544`; frontend refresh required after deploy.

**Make rack/location stickers shorter** (`app/label_printer.py`, `SESSION_NEXT.md`)
Rack labels now render as compact 696x190 strip labels instead of the older 696x330 layout, so they fit the physical rack without wrapping around the rods. The label title is normalized to `Rack 1-10` style, with row/direction text, a smaller Flightdeck badge/date line, and a 150px QR on the right. Also tightened rack-range parsing so names like `Rack Row 1 - 1-10` do not get shortened to `Rack 1-1`.

**Make spool rack-position stickers shorter** (`app/label_printer.py`, `SESSION_NEXT.md`)
The normal compact spool label used by each rack position is now a short 696x210 strip instead of a taller spool card. It keeps the big spool number, material/brand/colour, rack range, printed date, and QR, so the sticker can sit beside a physical rack slot without wrapping. Verification preview rendered to `C:\Users\Kidabah\AppData\Local\Temp\flightdeck-spool-rack-label-preview.png`.

### 2026-06-27 polish (H2C AMS/Rack tab height)

**Match H2C AMS and rack panel height** (`app/static/app.js`, `app/static/style.css`, `app/static/index.html`, `app/static/demo.html`, `SESSION_NEXT.md`)
Big Girl/H2C Rack view now has the right Bambu-style hotend rack layout, but switching back to AMS made the Environment panel sit shorter than the Rack tab. H2C live panels now mark whether the `AMS` or `Rack` tab is active, and the AMS loaded area reserves a little bottom clearance so the two tabs feel the same height when toggling. Static cache bumped to `app.js?v=543` and `style.css?v=426`; frontend refresh required after deploy. UI-only: no backend, printer command, AMS mapping, queue-dispatch, or spool-deduction code was touched.

**Reserve H2C AMS tab height** (`app/static/style.css`, `app/static/index.html`, `app/static/demo.html`, `SESSION_NEXT.md`)
Follow-up after browser testing showed the first AMS clearance was too small to visually match the Rack tab. The H2C AMS and Rack states now share the same Environment panel minimum height, with extra AMS loaded-area reserve so toggling tabs keeps the bottom edge steady. Static cache bumped to `style.css?v=427`. UI-only: no backend, printer command, AMS mapping, queue-dispatch, or spool-deduction code was touched.

### 2026-06-26 polish (Bambu-style H2C rack view)

**Render H2C rack like Bambu hotend rack** (`app/static/app.js`, `app/static/style.css`, `app/static/index.html`, `app/static/demo.html`, `SESSION_NEXT.md`)
The first H2C Rack tab pass was functional but too generic: it showed compact `Rack 1`/`Rack 2` cards instead of resembling the printer's own Hotends & Rack screen. Big Girl/H2C now renders the Rack tab as a Bambu-style board with a Toolhead panel on the left and a fixed six-bay induction rack on the right. Rack bays are laid out in the same odd/even physical pattern as the printer screen (`1,3,5` over `2,4,6`), including empty bays such as the changeover slot, while loaded bays keep colour/material/hotend details. The AMS tab and normal nozzle/toolhead tab behaviour are unchanged. Static cache bumped to `app.js?v=542` and `style.css?v=425`; frontend refresh required after deploy. No backend, printer command, AMS mapping, queue-dispatch, or spool-deduction code was touched.

### 2026-06-26 fix (H-series history layer recovery and spool catch-up wording)

**Recover history from bad H-series layer totals** (`app/db.py`, `SESSION_NEXT.md`)
Big Girl/H2C exposed an H-series telemetry edge case where Live view showed the correct print progress (`110 / 110`) but History had latched onto a stale/high layer total (`1123 / 1123`). `update_print_live_progress()` now keeps normal layer progress monotonic but allows a later sane total to replace a wildly larger stored value, so history can recover from transient H-series layer ghosts instead of keeping the first bad number forever. Live spool deduction also now labels late first deductions as `catch-up deducted to 90%` when Flightdeck first sees a usable snapshot/metadata after the print is already well underway. This keeps the accounting behaviour the same, including holding the final 10% until the printer reports `FINISHED`, but makes the decision trail honest when a service restart or reattach misses earlier 10% checkpoints. Backend/service restart required after deploy. No printer command, AMS mapping, queue-dispatch, or frontend code was touched.

### 2026-06-26 polish (H2C Environment tabs)

**Move H2C rack tabs into Environment header** (`app/static/app.js`, `app/static/style.css`, `app/static/index.html`, `app/static/demo.html`, `SESSION_NEXT.md`)
The first tab pass rendered `Nozzles`/`Rack` below the AMS loadout, which made the controls feel disconnected and did not bring the rack view up where operators expect it. Big Girl/H2C now shows compact `AMS` and `Rack` tabs beside the Environment temperature chips. `AMS` shows the normal AMS/loadout view, while `Rack` replaces that loaded area with the hotend rack view. The selected tab is remembered per printer across live refreshes. BigBoy/H2D remains dual-nozzle/no-rack and does not get the rack tab. Static cache bumped to `app.js?v=541` and `style.css?v=424`; frontend refresh required after deploy. No backend, printer command, AMS mapping, queue-dispatch, or spool-deduction code was touched.

### 2026-06-26 polish (H2D no rack, H2C tabbed rack access)

**Use tabs for H-series nozzle and rack view** (`app/static/app.js`, `app/static/style.css`, `app/static/index.html`, `app/static/demo.html`, `SESSION_NEXT.md`)
H2D is now treated as a dual-nozzle engineering printer with no hotend rack UI. The Live environment panel filters rack bays out unless the printer model is H2C, so BigBoy/H2D shows only the nozzle/toolhead view while Big Girl/H2C keeps rack visibility. Replaced the native `Show`/`Hide` drawer with a cleaner tab strip: `Nozzles` is the default tab, and `Rack` appears only for H2C when rack bays are reported. Static cache bumped to `app.js?v=540` and `style.css?v=423`; frontend refresh required after deploy. No printer command, AMS mapping, H2C routing, or queue-dispatch code was touched.

### 2026-06-26 polish (H-series rack live drawer)

**Collapse H-series hotends/rack by default on Live** (`app/static/app.js`, `app/static/style.css`, `app/static/index.html`, `app/static/demo.html`, `SESSION_NEXT.md`)
The H2C/H-series hotends and rack visibility panel was technically scrollable after the previous fix, but it still rendered fully open under the AMS route and made the Live page feel unchanged/cluttered during active prints. The H-series section now renders as a compact native details drawer showing only `H-series hotends & rack` plus the `toolheads · rack loaded` summary until opened. This keeps Big Girl/BigBoy live monitoring focused on the print, filament route, and AMS state while preserving the detailed hotend/rack view on demand. Static cache bumped to `app.js?v=539` and `style.css?v=422`; frontend refresh required after deploy. No printer command, AMS mapping, H2C routing, or queue-dispatch code was touched.

**Current queue note**
Greyhound Ludicrous/X1C queue preflight now shows the real printer fault text (`Printer error: Bambu alarm 5034-8044`) when the printer reports an error state. Flightdeck is intentionally blocking dispatch until that printer-side Bambu alarm is cleared on the printer/Bambu app, then the queue row can be retried.

### 2026-06-26 fix (H-series rack scroll and queue fault wording)

**Let Live page scrolling own the H-series rack section** (`app/static/style.css`, `app/static/index.html`, `app/static/demo.html`, `SESSION_NEXT.md`)
The compact H-series hotend/rack strip had its own capped internal scrollbar plus contained overscroll. On Big Girl/H2C this could trap wheel/touch scrolling around the environment panel and make the Live page feel stuck near the rack. The rack strip now flows with the page, and full toolhead cards are slightly shorter so the H-series panel stays readable without becoming a scroll trap. Static cache bumped to `style.css?v=421`; frontend refresh required after deploy.

**Make printer-error queue blocks actionable** (`app/main.py`, `SESSION_NEXT.md`)
Queue preflight still blocks jobs when a printer is genuinely offline, in error, or in E-stop, but it no longer shows the vague `Printer is error` copy. For Bambu/Moonraker faults Flightdeck now uses the reported printer error text when available, and falls back to a clear operator instruction to clear the printer screen/Bambu app before retrying. Backend/service restart required after deploy.

### 2026-06-26 fix (H-series rack destructuring)

**Finish the `isRack` live-view crash fix** (`app/static/app.js`, `app/static/index.html`, `app/static/demo.html`, `SESSION_NEXT.md`)
The prior patch returned `isRack` from the shared H-series metadata helper but missed adding it to the full-card destructuring assignment, so Live view could still fail with `isRack is not defined`. The card renderer now destructures `isRack` explicitly. Static cache bumped to `app.js?v=538`; frontend refresh required after deploy.

### 2026-06-26 fix (H-series rack live crash)

**Fix undefined `isRack` in H-series rack renderer** (`app/static/app.js`, `app/static/index.html`, `app/static/demo.html`, `SESSION_NEXT.md`)
The compact rack-strip UI shared hotend metadata between the full toolhead card renderer and compact rack-cell renderer, but `isRack` stayed scoped inside the helper while the card renderer still referenced it for the fallback label. Live view could fail with `isRack is not defined`. The helper now returns `isRack` with the rest of the metadata. Static cache bumped to `app.js?v=537`; frontend refresh required after deploy.

### 2026-06-26 fix (H-series rack panel scrolling)

**Compact the H-series hotend rack display** (`app/static/app.js`, `app/static/style.css`, `app/static/index.html`, `app/static/demo.html`, `SESSION_NEXT.md`)
The first H-series rack visibility pass used full-height hotend cards for both active nozzles and rack storage bays. On Big Girl/H2C that made the Live environment panel too tall and awkward to scroll once AMS state and rack state were both visible. Rack bays now render as compact cells in a capped scroll strip, while the active left/right toolheads keep the richer card view. This is UI-only: no Bambu MQTT parsing, print-command, AMS mapping, or queue-dispatch code was touched. Static cache bumped to `app.js?v=536` and `style.css?v=420`; frontend refresh required after deploy.

### 2026-06-26 polish (H-series hotend rack visibility)

**Show H-series toolhead and hotend-rack state from Bambu MQTT** (`app/printers/bambu.py`, `app/static/app.js`, `app/static/style.css`, `app/static/index.html`, `app/static/demo.html`, `SESSION_NEXT.md`)
Big Girl/H2C publishes hotend and rack inventory in `device.nozzle.info`. Flightdeck now parses that H-series payload into `PrinterStatus.toolheads` and shows a read-only H-series hotend/rack deck in the Live environment panel alongside AMS state. In the first live Big Girl snapshot, nozzle ids `0` and `1` mapped to right/left toolheads, rack ids `16+` mapped to rack slots via `id - 15`, five rack hotends were present, and rack slot 6 stayed empty for changeover. This is visibility only: no print-command, AMS mapping, or queue-dispatch mapping logic was touched. Static cache bumped to `app.js?v=535` and `style.css?v=419`; backend/service restart plus frontend refresh required after deploy.

### 2026-06-26 H2C discovery (Bambu MQTT snapshot)

**Add read-only Bambu MQTT debug snapshot** (`app/printers/bambu.py`, `app/main.py`, `SESSION_NEXT.md`)
Added `/api/printers/{printer_id}/bambu/mqtt`, a redacted read-only endpoint that returns the latest Bambu MQTT dump plus connection metadata. It is for H-series discovery, especially finding whether H2C publishes hotend rack inventory/toolhead state outside Flightdeck's current parsed status snapshot. No printer commands are sent; the API layer redacts serial/access/token/password-like fields before returning the payload. Backend/service restart required after deploy.

### 2026-06-26 polish (H2C active nozzle display)

**Use active H-series nozzle in live displays** (`app/static/app.js`, `app/static/index.html`, `app/static/demo.html`, `SESSION_NEXT.md`)
Big Girl/H2C reports separate `hotend_l` and `hotend_r` readings. Flightdeck already decoded those readings, but non-H2D H-series live cards could still fall back to the first/cold side or generic `Toolhead` copy. The live/fleet hotend selector now treats any dual-nozzle H-series printer as dual-temp capable, picks the working heated nozzle, and labels filament route destinations as `Left nozzle` or `Right nozzle` when only one side is active. H2D-specific AMS vs AMS HT routing rules remain scoped to actual H2D only. Static cache bumped to `app.js?v=534`; frontend refresh required after deploy.

### 2026-06-26 polish (Rack wall-board overview)

**Add a whole-rack visual map to Spools -> Rack** (`app/static/app.js`, `app/static/style.css`, `app/static/index.html`, `app/static/demo.html`, `SESSION_NEXT.md`)
Spools -> Rack now shows a compact wall-board overview above the detailed rack rows. Each physical rack row renders as a 10-slot strip using the same Stored/Loaded/Low/Reserved/Empty states as the row cards, with quick totals for row count, rack slots, first empty slot, first loaded slot, and first reserved slot. Row strips link down to the matching detailed row so the rack can be scanned quickly before drilling into individual spool cards. Static cache bumped to `app.js?v=533` and `style.css?v=418`; frontend refresh required after deploy.

### 2026-06-26 fix (Archived default shelf startup crash)

**Make default spool-location seeding idempotent** (`app/db.py`, `SESSION_NEXT.md`)
Archived `Shelf #1`/`Shelf #2`/`Shelf #3` locations kept their unique names in SQLite, but the startup seed only checked for active rows. After those original shelves were archived in favour of rack rows, Flightdeck could try to insert `Shelf #1` again during boot and crash the service with `UNIQUE constraint failed: spool_locations.name`, showing as a 502 through Tailscale. The seed path now treats existing default shelf names as already handled whether active or archived, so archived shelves stay archived and startup cannot duplicate them. The legacy `Storage` migration now only moves spools into `Shelf #1` when that shelf is active, avoiding accidental moves into an archived shelf. Verified with `python -m py_compile app/db.py app/main.py app/printers/bambu.py`, `git diff --check`, and a throwaway SQLite startup test with all three default shelves archived.

### 2026-06-26 fix (Rack rows beyond 90)

**Grow rack map by visible spool number** (`app/static/app.js`, `app/static/index.html`, `app/static/demo.html`, `SESSION_NEXT.md`)
Spools -> Rack now grows from the highest visible spool number instead of stopping at the original 1-90 cupboard map. A reserved/active line such as `#91` now naturally creates row 10 (`91-100`), and future numbers like `#101` will extend the map to row 11 (`101-110`). Settings -> Locations now sorts stored spools by the visible spool number and shows the visible label in row cards, so physical rack order and Flightdeck order match. The `Build rack rows` helper now refreshes the current spool list first, creates enough rack rows for the visible range, and syncs stored spools up to that dynamic limit. Static cache bumped to `app.js?v=532`; frontend refresh required after deploy.

### 2026-06-26 fix (BigBoy completion ntfy accounting errors)

**Update running history layer progress live** (`app/db.py`, `app/printers/bambu.py`, `SESSION_NEXT.md`)
History detail rows now refresh `layers_completed` while a Bambu print is running instead of only filling the value when the print closes. The Bambu poll loop writes live layer progress to the active print row whenever the printer reports a current layer; if H-series telemetry omits the current layer, Flightdeck derives a running estimate from print percentage and the known sliced total so history no longer sits at `— / total` during long prints. The update is monotonic and only affects open rows, so finished/cancelled history is not regressed. Verified with `python -m py_compile app/db.py app/printers/bambu.py app/main.py` and `git diff --check`. Backend/service restart required after deploy.

**Harden Bambu spool/accounting errors after print completion** (`app/db.py`, `app/printers/bambu.py`, `SESSION_NEXT.md`)
BigBoy reported two scary ntfy `Print error` messages after a completed print: `no such column: updated_at` and `cannot access local variable 'slot_snapshot' where it is not associated with a value`. The `updated_at` fault came from older Pi databases where `filament_catalog` existed before the newer timestamp column; startup migration now adds `filament_catalog.updated_at`, and `get_filament_catalog_status()` defensively handles older schemas until migration has run. Bambu live and finish spool deduction is now isolated from printer polling: any deduction exception is logged and written to the print decision trail as `spool_deduction_error`, but it no longer bubbles out as a printer-status failure or ntfy `Print error`. Verified with `python -m py_compile app/db.py app/printers/bambu.py app/main.py` and `git diff --check`. Backend/service restart required after deploy.

### 2026-06-25 fix (H-series nozzle direction)

**Keep accepted Bambu starts active when confirmation is noisy** (`app/main.py`, `app/db.py`, `SESSION_NEXT.md`)
Flightdeck no longer marks a Bambu queue job failed just because the immediate physical-start watchdog gets an inconclusive early state after the printer accepted the MQTT start command. Bambu/H-series printers can briefly report idle/error-like handoff states while moving into calibration, which made queue rows show `Printer accepted the start command but...` even though the printer went on to heat and print. Queue rows are now marked `printing` as soon as the accepted send returns, and the watchdog only logs an inconclusive confirmation instead of auto-cancelling the printer, disabling dispatch, and failing the queue row. The queue reconcile hook can also reattach a recent row with the old false-fail message if telemetry says the printer is actually printing/paused. Backend/service restart required after deploy.

**Fix H-series slicer nozzle direction** (`app/printers/bambu_ftp.py`, `app/static/app.js`, `app/static/index.html`, `app/static/demo.html`, `SESSION_NEXT.md`)
Bambu Studio exports H-series slicer grouping with its own left/right nozzle numbering, while Flightdeck's queue and MQTT-side printer handling use the printer convention where `0=right` and `1=left`. Flightdeck was taking the exported slicer value directly, so a Bambu Studio file that clearly showed `Left nozzle` could be blocked as if it were sliced for the right nozzle. The 3MF parser now converts Bambu Studio's H-series nozzle ids into Flightdeck's internal convention before storing `filament_colors[].nozzle`, which fixes H2D queue preflight and dispatch AMS/nozzle-path checks for correctly sliced left-nozzle jobs. Live filament route copy now says `Loaded` / `Filament loaded` instead of `Fed now` / `Filament fed` so a hot/ready support path does not look like the actively printing path. Static cache bumped to `app.js?v=531`; backend/service restart plus frontend refresh required after deploy.

### 2026-06-25 fix (Queue preflight while busy)

**Make Rack view read like the physical cupboard map** (`app/static/app.js`, `app/static/style.css`, `app/static/index.html`, `app/static/demo.html`, `SESSION_NEXT.md`)
Spools -> Rack now has a map header with held/empty/loaded/reserved counts, clearer legend context, row range heroes, row direction cues, and per-row held/loaded counts. Slot cards now show their state badge (`Stored`, `Loaded`, `Low`, `Reserved`) while preserving the existing click-through to spool detail and the 1-90 snake numbering. Static cache bumped to `app.js?v=530` and `style.css?v=417`; frontend refresh required after deploy.

**Shorten rack location on spool labels** (`app/label_printer.py`, `SESSION_NEXT.md`)
Compact and standard spool labels now collapse rack-row storage locations like `Rack Row 1 · 1-10` into a readable `Loc: Rack 1-10` label instead of truncating the row name as `Rack Ro...`. The big spool number remains the exact physical rack slot; the location line now gives the row range at a glance. Verified by rendering a local compact spool label preview for spool `#5` stored in `Rack Row 1 · 1-10`.

**Make rack labels read as row markers** (`app/label_printer.py`, `SESSION_NEXT.md`)
Rack/location labels are now formatted for wall/rack use instead of printing the whole storage location name as one oversized, truncated title. Labels extract the physical slot range such as `1-10` as the hero text, show the row name below it, and use the direction text (`left to right` / `right to left`) as the short operator cue. The QR code still opens the matching Flightdeck cabinet/location view. Verified by rendering a local preview for `Rack Row 1 · 1-10`.

**Start Bambu multi-plate exports from the sliced plate** (`app/printers/bambu_ftp.py`, `app/printers/bambu.py`, `SESSION_NEXT.md`)
Bambu Studio can export a multi-plate `.gcode.3mf` where only a non-first plate is actually sliced, for example a project with preview JSON/PNGs for plates 1-9 but only `Metadata/plate_6.gcode`. Flightdeck previously uploaded the file correctly but always sent the MQTT start command for `Metadata/plate_1.gcode`, which made the H2C accept the command and then show `unable to parse the job`. The 3MF parser now detects the actual printable plate from the embedded `Metadata/plate_N.gcode` entries, stores it on `BambuPreview.print_plate_number`, logs it in `queue_bambu_mapping`, and starts that plate instead of assuming plate 1. Verified against `H2C first print.gcode.3mf` (plate 1) and `KYZ_AMS_Undermount...Lower.gcode.3mf` (plate 6). Backend/service restart required after deploy; recover/retry the failed H2C queue row after re-enabling printing.

**Keep H2D AMS/nozzle fallback off H2C dispatch** (`app/printers/bambu.py`, `SESSION_NEXT.md`)
The Bambu dispatch path still applied the H2D fallback that treats regular AMS as the left nozzle path and AMS HT as the right nozzle path to any model whose name started with `H2`. That made H2C queue jobs fail with `H2D AMS mapping blocked` even though the H2C AMS/rack path is different. `ams_slots()` now only injects that fallback nozzle map for actual `H2D`; H2C slots are left unforced unless the printer reports an explicit extruder map. Backend/service restart required after deploy; failed H2C queue rows can be recovered and retried.

**Defer pending-job AMS checks while a printer is already printing** (`app/main.py`, `SESSION_NEXT.md`)
Pending queue jobs now stop preflight at `Printer is printing` while their printer is actively printing/paused instead of also running AMS/nozzle-path checks against the filament path used by the current active print. This prevents queued H2D/H2C follow-up jobs from looking falsely blocked just because the printer is busy with a different job. H2D-specific nozzle-path checks are now scoped to actual `H2D` printer status, so H2C uses the broader material/colour/grams checks until its rack/toolhead mapping is explicitly modelled. Backend/service restart required after deploy.

### 2026-06-25 follow-up (Rack row sync)

**Sync shelved spools into numbered rack rows** (`app/static/app.js`, `app/static/index.html`, `app/static/demo.html`, `SESSION_NEXT.md`)
Settings -> Locations `Build rack rows` now does the wiring pass after creating/renaming the main cupboard rows. It moves active shelved spools with visible numbers `1-90` into the matching `Rack Row N` storage location (`1-10`, `11-20`, etc.) so Settings -> Locations, Cabinet, and the Spools `Rack` view tell the same physical story. Loaded printer spools are deliberately left loaded, and reserved/archived spool lines stay reserved. Static cache bumped to `app.js?v=528`; frontend refresh required after deploy.

**Rack sync reliability follow-up** (`app/static/app.js`, `app/static/index.html`, `app/static/demo.html`, `SESSION_NEXT.md`)
The `Build rack rows` helper now refreshes the spool list immediately before moving shelved spools and reports failed move calls in the toast instead of silently ignoring them. This makes rack wiring troubleshooting visible if any stored spool cannot be moved into its matching numbered row. Static cache bumped to `app.js?v=529`; frontend refresh required after deploy.

### 2026-06-25 feature (Snake rack view)

**Add main cupboard snake rack workflow** (`app/static/app.js`, `app/static/style.css`, `app/static/index.html`, `app/static/demo.html`, `SESSION_NEXT.md`)
Spools now has a `Rack` view that draws the physical main cupboard as a 9-row, 10-slot snake layout: odd rows run left-to-right and even rows run right-to-left, covering visible spool numbers `1-90`. Rack cells show the spool number, colour/material summary, low-stock/loaded/reserved/empty state, and click through to the spool detail page. Settings -> Locations now includes a `Build rack rows` helper that renames old `Shelf #N` rows or existing rack rows into `Rack Row N · range` and creates any missing rows through the existing location API without moving spools. This gives rack labels, cabinet storage, and the physical cupboard a shared row naming scheme. Static cache bumped to `app.js?v=527` and `style.css?v=416`; frontend refresh required after deploy.

### 2026-06-25 polish (Rack labels)

**Add printable rack/location labels** (`app/label_printer.py`, `app/main.py`, `app/static/app.js`, `app/static/style.css`, `app/static/index.html`, `app/static/demo.html`, `SESSION_NEXT.md`)
Settings -> Locations now has a `Label` action for each physical storage location. The backend prints a separate QL-700 rack/location label with a large location name/range, optional notes, a `FLIGHTDECK RACK` badge, print date, and QR code back to the Spools cabinet view for that location. This is separate from permanent spool QR labels and is intended for cupboard/rack ranges like `1-10`, `11-20`, or named wall bays. Static cache bumped to `app.js?v=525` and `style.css?v=415`; backend/service restart plus frontend refresh required after deploy.

**Reserved wording follow-up** (`app/static/app.js`, `app/static/index.html`, `app/static/demo.html`, `SESSION_NEXT.md`)
Cleaned up the last visible Spools search messages that still said `Archived` for reserved spool lines. Static cache bumped to `app.js?v=526`; frontend refresh required.

### 2026-06-25 feature (Bambu Cloud token health)

**Add Bambu Cloud token health monitor** (`app/db.py`, `app/static/app.js`, `app/static/style.css`, `app/static/index.html`, `app/static/demo.html`, `SESSION_NEXT.md`)
Settings -> Preferences now includes a Bambu Cloud health card for future MakerWorld/Cloud import workflows. Operators can record the last Bambu Cloud sign-in date, see an estimated 90-day expiry window, and get clear healthy/watch/urgent/expired status copy before cloud-backed imports fail. The card deliberately does not store Bambu account credentials or silently re-authenticate; local LAN printer control remains separate from optional Bambu Cloud features. Static cache bumped to `app.js?v=522` and `style.css?v=412`; backend/service restart plus frontend refresh required so the new default settings are available.

**MakerWorld quick link added** (`app/static/app.js`, `app/static/style.css`, `app/static/index.html`, `app/static/demo.html`, `SESSION_NEXT.md`)
The Bambu Cloud health card now includes an `Open MakerWorld` link next to the last sign-in date so operators can refresh Bambu/MakerWorld login from the same place they track token age. After signing in, use `Mark today` to reset the local reminder. Static cache bumped to `app.js?v=523` and `style.css?v=413`; frontend refresh required after deploy.

**MakerWorld main nav page** (`app/static/app.js`, `app/static/index.html`, `app/static/demo.html`, `SESSION_NEXT.md`)
MakerWorld is now a first-class System navigation item at `#/makerworld`. The page opens MakerWorld, shows Bambu Cloud token health, lets operators mark the current sign-in date, and clearly scopes the feature as a launch/health page until deeper import tooling is proven. Static cache bumped to `app.js?v=524` and `style.css?v=414`; frontend refresh required after deploy.

### 2026-06-24 polish (Reserved card actions)

**Tune reserved spool card menu** (`app/static/app.js`, `app/static/style.css`, `app/static/index.html`, `app/static/demo.html`, `SESSION_NEXT.md`)
Reserved spool cards now show only the actions that make sense for a reserved rack line: `Info`, `Restock`, and `Delete`. The inherited archived-card fade was removed from the card body so the action popover no longer looks washed out, and the reserved menu gets a slightly wider, clearer surface with the `Restock` action highlighted. Static cache bumped to `app.js?v=521` and `style.css?v=411`; frontend refresh required.

### 2026-06-24 polish (Reserved spool wording)

**Rename archived spool filter chip to Reserved** (`app/static/app.js`, `app/static/index.html`, `app/static/demo.html`, `SESSION_NEXT.md`)
The Spools status filter now labels the archived/reserved state as `Reserved` instead of `Archived`, matching the new rack-number model and the card stamp. The underlying filter key remains `archived` internally to avoid unnecessary data churn. Static cache bumped to `app.js?v=520`; frontend refresh required.

### 2026-06-24 follow-up (Reserved spool restock)

**Add first-pass restock flow for reserved spool numbers** (`app/db.py`, `app/main.py`, `app/static/app.js`, `app/static/index.html`, `app/static/demo.html`, `SESSION_NEXT.md`)
Reserved spool numbers now have a real path back into active stock. Archived/reserved spool cards show a `Restock` action that opens the normal spool form and updates that reserved line instead of creating a new visible number. Stock In receive forms now include `Restock spool #`; leaving it blank creates the next fresh number, while entering an archived reserved number refills that line. The backend protects active lines: if staff enter a number that is still active, Flightdeck returns a clear conflict instead of overwriting the current roll. Static cache bumped to `app.js?v=519`; backend/service restart plus frontend refresh required after deploy.
  - Verification: `python -m py_compile app/db.py app/main.py app/label_printer.py` passed with the usual Windows Python `<prefix>` warning. `node --check app/static/app.js` passed.

### 2026-06-24 follow-up (Reserved spool numbers)

**Change spool numbering from auto-reuse to reserved spool lines** (`app/db.py`, `app/static/app.js`, `app/static/index.html`, `app/static/demo.html`, `SESSION_NEXT.md`)
Follow-up after testing the first `display_id` split against the real rack workflow: lowest-free automatic number reuse was the wrong operator model because physical rack tags like `89 eSun` would drift out of sync if a totally different new roll inherited that number. Flightdeck now treats the visible spool number as a reserved spool line/rack identity instead of a recyclable slot token. New spools always take the next never-used display number (`MAX(display_id) + 1`), while archived spools keep their old number reserved for future restock/revival. Archived cards now stamp as `Reserved` rather than `Archived` so the UI better matches that intent. Exact search still works by visible number through `/api/spools/by-number/{display_id}`. Static cache bumped again to `app.js?v=518`; frontend refresh required.
  - Verification pending: add a brand-new spool after archiving an older one and confirm the new roll gets the next fresh number instead of reusing the archived display number.

### 2026-06-24 feature (Reusable spool numbering)

**Split human spool numbers from internal spool ids and reuse freed numbers** (`app/db.py`, `app/main.py`, `app/label_printer.py`, `app/static/app.js`, `app/static/index.html`, `app/static/demo.html`, `SESSION_NEXT.md`)
Flightdeck now keeps the database `spools.id` as the permanent internal identity/QR target while introducing a separate human-facing `display_id` for rack labels, UI cards, search, and operator workflows. Existing spools are backfilled so `display_id = id`, active spool numbers are protected by a partial unique index, and the codebase now has a clean split between internal spool identity and operator-facing numbering. Added `/api/spools/by-number/{display_id}` so exact search can open a spool by visible rack number, updated labels/swatch/detail/table/cabinet/fleet-wall/history surfaces to show the visible spool number instead of the raw row id, fixed the new by-number API route ordering so it is not shadowed by `/api/spools/{spool_id}`, and stamped live deduction / assigned-after-print / correction history text with the human-facing number. This entry was later superseded by the reserved spool-line model below, so automatic lowest-free number reuse is no longer the intended behaviour. Static cache first bumped to `app.js?v=517`; backend/service restart plus frontend refresh required after deploy.
  - Verification: `python -m py_compile app/db.py app/main.py app/label_printer.py` passed with the usual Windows Python `<prefix>` warning. `node --check app/static/app.js` passed. `git diff --check` passed with only the existing Windows CRLF warning.

### 2026-06-23 fix (H2C history finish close)

**Close Bambu finished prints by tracked id if the finish key drifts** (`app/db.py`, `app/printers/bambu.py`, `SESSION_NEXT.md`)
Hardened the Bambu finish path for H-series testing after `Big Girl` completed in Live view but stayed `RUNNING` in printer History. Root cause appears to be a finish-time job-key mismatch edge case: the session still knows the tracked print row id, spool deductions are attached to that row, and Live can show `finished`, but `db.on_print_finished(printer_id, job_key)` may return `None` if the printer-side finish key has drifted. Added `db.on_print_finished_by_id(print_id, ...)` and a Bambu fallback that closes the tracked open row directly by id, then logs `finish_key_fallback` for audit. Also added an `IDLE` cleanup catch-net: if Bambu rolls out of a finished window while any open print rows remain, Flightdeck now closes them as `FINISHED` before clearing the finish state. This keeps History, queue completion, and spool usage aligned instead of leaving an open print row behind.
  - Verification pending: run `python -m py_compile app/db.py app/printers/bambu.py`, then restart the backend and confirm `H2C first print` flips from `RUNNING` to `FINISHED` in History after the next completed H2C job.

### 2026-06-23 H2C bring-up

**Allow H-series dual-nozzle temp parsing** (`app/printers/bambu.py`, `SESSION_NEXT.md`)
Broadened the Bambu dual-nozzle temperature parser so it no longer hard-codes `H2D` as the only model allowed to decode `device.extruder.info[]`. H-series models now attempt the same dual-hotend parsing path, which is the first step toward exposing H2C left/right tool temperatures if its MQTT payload matches the H2D extruder layout. This is intentionally scoped to temperature parsing only; H2D-specific AMS/nozzle routing logic was not widened in the same change. Backend/service restart required after deploy; static cache unchanged.
  - Verification: `python -m py_compile app/printers/bambu.py` passed with the usual Windows Python `<prefix>` warning. `git diff --check` passed with only the existing Windows CRLF warning.

### 2026-06-23 polish (History decision trail)

**Make print history decision trail scrollable** (`app/static/style.css`, `app/static/index.html`, `app/static/demo.html`, `SESSION_NEXT.md`)
Print History detail pages now keep the Decision trail inside a capped scrollable log panel instead of letting long live-deduction/retry trails stretch the whole print card down the page. The panel has its own scrollbar, contained scroll behaviour, subtle log styling, wrapped event text, and a narrower mobile layout so repeated `spool_deducted_live`, `job_reattached`, and calibration entries remain useful without taking over the screen. Static cache bumped to `style.css?v=410`; frontend refresh required.
  - Verification: `git diff --check` passed with only the existing Windows CRLF warning.

### 2026-06-22 fix (History repair + spool polish)

**Repair archived spool history assignment and polish spool views** (`app/db.py`, `app/static/style.css`, `app/static/index.html`, `app/static/demo.html`, `SESSION_NEXT.md`)
Fixed the History repair path for cancelled-at-finish Bambu jobs where the physical print completed but the printer later reported a cancelled/error finish after the spool had already emptied and been archived. `assign_print_spool_usage()` can now attach grams to an archived spool, record `assigned_to_archived_spool`, keep the spool archived, and clamp the historical spool remaining value to 0g instead of blocking the repair. This is intended for cases like X1C print `289` / `Supporto rack componibile e impilabile per bobine`, which ran to completion but ended as `CANCELLED` with no filament metadata/spool usage after an extruder block. Also polished the Spools UI: Swatch cards now keep their natural height instead of stretching into tall columns when filters leave sparse rows, and the spool detail Back/Spools links now render as a compact breadcrumb pill. Static cache bumped to `style.css?v=409`; backend/service restart plus frontend refresh required.
  - Verification: `python -m py_compile app/db.py` passed with the usual Windows Python `<prefix>` warning. `node --check app/static/app.js` passed. Temp-DB smoke confirmed assigning `173.15g` to archived spool `#38` for print `289` records spool usage, leaves the spool archived, and clamps remaining to `0g`. `git diff --check` passed with only the existing Windows CRLF warning.

**Limit nozzle-path stock wording to H2 printers** (`app/main.py`, `SESSION_NEXT.md`)
Fixed a confusing X1C queue preflight message where a single-nozzle Bambu job sliced for X1C still showed `Loaded nozzle-path stock short: right nozzle Grey...`. The 3MF can carry nozzle metadata even for single-tool printers, but that should not be presented as H2D left/right nozzle routing. Queue stock checks now only use nozzle-path coverage for H2-series printer statuses; X1C/P1/A1-style Bambu jobs fall back to normal colour/material coverage wording such as `Loaded colour coverage short: Grey (no loaded spool) 0g/177g`. Backend/service restart required after deploy; static cache unchanged.
  - Verification: `.venv\Scripts\python.exe -m py_compile app/main.py` passed with the usual Windows Python `<prefix>` warning. A targeted preflight smoke for an X1C job with nozzle metadata confirmed no `right nozzle` / `nozzle-path` wording appears and the message uses colour coverage instead. `git diff --check` passed with only the existing Windows CRLF warning.

### 2026-06-21 fix (Queue stock-short wording)

**Clarify queue stock short spool labels** (`app/main.py`, `SESSION_NEXT.md`)
Queue preflight stock-short messages now name the actual matched loaded spool(s), including spool number and colour name, instead of only showing the sliced colour family and brand. This fixes the confusing X1C case where the queued `06_rack_bobine.gcode.3mf` job was correctly checking loaded spool `#38 Rainbow` but displayed `left nozzle Green (Inkstation) 166g/173g`, making it look like Flightdeck had selected the wrong spool. Rainbow/multicolour/gradient spools are also treated as colour-flexible for matching once material and nozzle path match, which better reflects how those rolls are used. Backend/service restart required; static cache unchanged.
  - Verification: `.venv\Scripts\python.exe -m py_compile app/main.py` passed with the usual Windows Python `<prefix>` warning. A targeted helper smoke confirmed the X1C/Rainbow case labels as `left nozzle Green via #38 Rainbow (Inkstation) 166g/173g` and rainbow spools match arbitrary requested colours once material/path match. `git diff --check` passed with only the existing Windows CRLF warning.

### 2026-06-21 fix (Print cost fallback)

**Fix print cost brand matching fallback** (`app/db.py`, `app/static/app.js`, `app/static/index.html`, `app/static/demo.html`, `SESSION_NEXT.md`)
Fixed a misleading print-history cost case where spool `#63` was stored as `Bambu Lab` but the filament cost row was named `Bambu`, so the exact brand lookup missed and Flightdeck used the broad PLA material average. That average mixed the plain PLA default, Bambu, and Inkstation rows, producing an obviously wrong `0.0973/g` rate and inflated active print cost. Print cost lookup now normalises common brand aliases (`Bambu`/`Bambu Lab`, `eSun`, `3DFillies`), tries exact spool brand first, then the plain material default row, and only uses a material average as the final fallback. Settings > Filament copy now states that order. Static cache bumped to `app.js?v=516`; backend/service restart plus frontend refresh required.
  - Verification: `python -m py_compile app/db.py` passed with the usual Windows Python `<prefix>` warning. `node --check app/static/app.js` passed. A targeted smoke test confirmed `Bambu Lab` matches the `Bambu` cost row as `spool brand`, `Inkstation` matches its exact row, and an unknown PLA brand falls back to the plain PLA default instead of the inflated material average. `git diff --check` passed with only the existing Windows CRLF warning.

### 2026-06-21 beta setup polish

**Lock non-Bambu printer setup for beta** (`app/static/app.js`, `app/static/style.css`, `app/static/index.html`, `app/static/demo.html`, `SESSION_NEXT.md`)
Settings > Printers now presents Bambu as the active `Beta ready` add-printer path while Klipper and Snapmaker remain visible as `Tester wanted` / coming-soon families. The locked tiles explain that those brands are planned tester paths but not part of the tested beta setup path yet, and new non-Bambu submissions are blocked with a clear validation message. Existing configured non-Bambu printers remain editable/visible, but new beta users are steered away from half-supported setup. LAN scan bulk-add language was adjusted so discovered Klipper/Snapmaker-style devices are treated as future tester candidates rather than auto-addable beta targets. Static cache bumped to `app.js?v=515` and `style.css?v=408`; frontend refresh required.
  - Verification: `node --check app/static/app.js` passed. `git diff --check` passed with only the existing Windows CRLF warning.

### 2026-06-21 beta launch prep (AGPL licensing)

**License Flightdeck under AGPL** (`LICENSE`, `TRADEMARK.md`, `README.md`, `docs/index.html`, `docs/releases/v0.4.0-beta.1.md`, `SESSION_NEXT.md`)
Added the official GNU AGPL-3.0 license text as `LICENSE` and updated the repo badge/license section from the older MIT wording to `AGPL-3.0-or-later`. Added `TRADEMARK.md` to reserve the Flightdeck name, logo, icon, wordmark, and branding separately from the code license. Updated the public site footer and beta release notes so testers see that the source is AGPL while branding is reserved. README now also names the tested optional hardware path: Dymo USB postal scale for spool weighing and Brother QL-700 with DK-22212 continuous labels for spool QR labels. Static cachebust unchanged (`app.js?v=514`, `style.css?v=407`, `demo-runtime.js?v=8`) because no app UI assets changed.
  - Verification: `git diff --check` passed with only the existing Windows CRLF warning.

### 2026-06-21 beta launch prep (Bambu beta docs)

**Prepare Bambu beta launch docs** (`README.md`, `INSTALL.md`, `docs/INSTALL_PI.md`, `docs/WINDOWS_SLICER_WORKER.md`, `docs/TROUBLESHOOTING.md`, `docs/BETA_LIMITATIONS.md`, `docs/releases/v0.4.0-beta.1.md`, `docs/index.html`, `app/version.py`, `app/static/demo-runtime.js`, `SESSION_NEXT.md`)
Converted the repo front door from an older broad/early-development README into a Bambu-focused beta landing README. Added focused Pi install, Windows slicer worker/browser slicer, troubleshooting, beta limitations, and `v0.4.0-beta.1` release notes docs. Updated the public GitHub Pages copy to present Flightdeck as a local-first Bambu beta instead of over-promising mixed-fleet/Snapmaker readiness. App/demo version metadata now reports `0.4.0-beta.1` / `Bambu beta launch candidate` with beta-focused release notes. Existing static cachebust unchanged (`app.js?v=514`, `style.css?v=407`, `demo-runtime.js?v=8`) because app UI assets were not changed.
  - Verification: `python -m py_compile app/version.py` passed with the usual Windows Python `<prefix>` warning. `node --check app/static/demo-runtime.js` passed. `git diff --check` passed with only the existing Windows CRLF warning.

### 2026-06-21 polish (Spool swatch/detail views)

**Add swatch and detail spool views** (`app/static/app.js`, `app/static/style.css`, `app/static/index.html`, `app/static/demo.html`, `SESSION_NEXT.md`)
Split the old Spools `Cards` mode into two clearer views. `Swatch` is now the colour-first overview with compact colour cards showing colour, material/profile, brand, roll count, location summary, remaining percent, and grams. `Detail` keeps the previous richer card workflow with spool tabs, actions, trust, weights, and edit/label tools. The view toggle now reads `Swatch`, `Detail`, `Table`, `Cabinet`, followed by `Stock In` and `Filament catalogue`; legacy `cards` routes/settings are normalised to `Detail` so old links do not break. Static cache bumped to `app.js?v=514` and `style.css?v=407`; frontend refresh required.
  - Verification: `node --check app/static/app.js` passed. `git diff --check` passed with only the existing Windows CRLF warning.

### 2026-06-21 polish (Grouped spool active tab marker)

**Add active marker to grouped spool tabs** (`app/static/style.css`, `app/static/index.html`, `app/static/demo.html`, `SESSION_NEXT.md`)
Follow-up after the reversible black/white spool tabs improved readability but the selected roll still needed a clearer state marker. Grouped spool tabs now show a green active underline plus a small marker below the selected tab, so operators can tell at a glance which roll's detail panel is being shown even on light, dark, or rainbow colour bands. Static cache bumped to `style.css?v=406`; frontend refresh required.
  - Verification: `git diff --check` passed with only the existing Windows CRLF warning.

### 2026-06-21 polish (Grouped spool reversible tab contrast)

**Use reversible contrast for spool tabs** (`app/static/app.js`, `app/static/style.css`, `app/static/index.html`, `app/static/demo.html`, `SESSION_NEXT.md`)
Follow-up after screenshots showed grouped spool tabs still lacked uniform contrast: black/dark cards looked acceptable but white, blue, and other light/bright cards made the tab numbers hard to read. Grouped card tabs now use a reversible black/white contrast scheme based on the colour band's luminance: light bands get black tabs with white numbers, while dark bands get white tabs with black numbers. Header tabs no longer inherit low-stock red/orange text tint, keeping spool number readability consistent; low-stock status remains visible in the selected detail panel. Static cache bumped to `app.js?v=513` and `style.css?v=405`; frontend refresh required.
  - Verification: `node --check app/static/app.js` passed. `git diff --check` passed with only the existing Windows CRLF warning.

### 2026-06-21 polish (Grouped spool tab contrast)

**Improve grouped spool tab contrast** (`app/static/style.css`, `app/static/index.html`, `app/static/demo.html`, `SESSION_NEXT.md`)
Follow-up after live screenshot review showed grouped spool tab numbers were hard to read, especially on white/light colour-band cards because inactive tabs inherited too much of the spool colour contrast. Header tabs now have their own darker high-contrast face, slightly taller hit area, brighter text, and a small shadow/text-shadow so spool numbers remain readable on white, pale, rainbow, and dark cards. Static cache bumped to `style.css?v=404`; frontend refresh required.
  - Verification: `git diff --check` passed with only the existing Windows CRLF warning.

### 2026-06-21 polish (Grouped spool stacked tabs)

**Style grouped spool tabs as stacked cards** (`app/static/style.css`, `app/static/index.html`, `app/static/demo.html`, `SESSION_NEXT.md`)
Follow-up after moving grouped spool tabs into the colour band: the number tabs were still reading like small badges beside the colour name. Grouped cards now reserve the colour band as a true header, keep the colour name on its own line, and place spool-number tabs along the lower edge like stacked cards/Flightdeck-style tabs. The active spool tab visually connects to the detail body underneath, making multiples feel like separate cards in one stack rather than one combined card. Static cache bumped to `style.css?v=403`; frontend refresh required.
  - Verification: `git diff --check` passed with only the existing Windows CRLF warning.

### 2026-06-21 polish (Spool card tab placement)

**Move spool tabs into colour band** (`app/static/app.js`, `app/static/style.css`, `app/static/index.html`, `app/static/demo.html`, `SESSION_NEXT.md`)
Follow-up after grouped spool cards landed: the number tabs were functionally right but sat in the detail body instead of the colour bar. Grouped cards now show their spool number tabs directly in the colour band where the old roll count/ID badge lived, keeping the tab selector as part of the card header while the selected spool's detail remains below. The spool `Actions` popover now opens centred under the button instead of offsetting left from the right edge, so far-left cards no longer have menus clipped offscreen. Static cache bumped to `app.js?v=512` and `style.css?v=402`; frontend refresh required.
  - Verification: `node --check app/static/app.js` passed. `git diff --check` passed with only the existing Windows CRLF warning.

### 2026-06-21 polish (Tabbed grouped spool cards)

**Add tabbed grouped spool cards** (`app/static/app.js`, `app/static/style.css`, `app/static/index.html`, `app/static/demo.html`, `SESSION_NEXT.md`)
Refined the Spools card layout after grouped/multiple cards still felt too combined and single-card actions needed better visual balance. Single spool cards now centre the one `Actions` button. Multiple/grouped cards now keep the shared colour/material band but render each roll as its own number tab (`#22`, `#26`, etc.); clicking a tab swaps the detail panel underneath so each spool remains separate for grams, trust, location, progress, and actions instead of showing one combined roll summary. Static cache bumped to `app.js?v=511` and `style.css?v=401`; frontend refresh required.
  - Verification: `node --check app/static/app.js` passed. `git diff --check` passed with only the existing Windows CRLF warning.

### 2026-06-21 polish (Uniform spool card actions)

**Use uniform spool card actions** (`app/static/app.js`, `app/static/style.css`, `app/static/index.html`, `app/static/demo.html`, `SESSION_NEXT.md`)
Follow-up after the readable action popover: compact spool cards in the far-left column still looked messy because single-spool cards rendered `Assign`, `Label`, and `Edit` inline plus a separate `Actions` menu. Single spool cards now use the same single `Actions` entry point everywhere, with all actions inside the readable popover. The card action strip styling was simplified from a three-column button grid to a clean one-button row. Static cache bumped to `app.js?v=510` and `style.css?v=400`; frontend refresh required.
  - Verification: `node --check app/static/app.js` passed. `git diff --check` passed with only the existing Windows CRLF warning.

### 2026-06-21 polish (Spool card action menu)

**Make spool action menu readable** (`app/static/style.css`, `app/static/index.html`, `app/static/demo.html`, `SESSION_NEXT.md`)
Polished the spool card `Actions` popover after the menu proved impossible to read on the compact card grid, especially when it opened over neighbouring colour bands. Open spool cards now rise above the grid, the action menu has an opaque dark surface with stronger border/shadow, and menu rows use full-width high-contrast button styling with clearer danger-state treatment. Static cache bumped to `style.css?v=399`; frontend refresh required.
  - Verification: `git diff --check` passed with only the existing Windows CRLF warning.

### 2026-06-21 fix (Fleet Wall active H2D hotend)

**Prefer hot H2D toolhead on Fleet Wall** (`app/static/app.js`, `app/static/index.html`, `app/static/demo.html`, `SESSION_NEXT.md`)
Follow-up after BigBoy showed Fleet Wall still displaying the cold H2D hotend (`40°`) while the active/right nozzle was physically printing. The first fix trusted the AMS HT route label too early; if Bambu/Flightdeck reports the active temperature under the other hotend key, the card could still choose the cold route side. Fleet Wall now prefers whichever H2D hotend has a live target or hot actual temperature, and only falls back to route-based left/right selection when neither side has an active thermal signal. Static cache bumped to `app.js?v=509`; frontend refresh required after deploy.
  - Verification: `node --check app/static/app.js` passed. `git diff --check` passed with only the existing Windows CRLF warning.

### 2026-06-21 fix (Spool archive polish)

**Improve spool archiving and H2D hotend display** (`app/db.py`, `app/main.py`, `app/static/app.js`, `app/static/index.html`, `app/static/demo.html`, `SESSION_NEXT.md`)
Fixed the confusing case where a user created a storage location named `Archive`, expecting it to archive a spool. Locations remain physical shelves/tubs/bays, but archiving a location now checks for active stored spools first. If the location still contains active stored spools, the API returns a clear 409 with the count and the Settings -> Locations UI asks a second confirmation: archive those stored spools too and remove the location. Loaded printer spools are not mass-archived by that flow; only active spools physically stored in that location are archived, and stale location/home pointers are cleared when the location is hidden. Spools now also auto-archive when their remaining weight reaches 0g through manual edits, scale correction/reconcile, live/final print deduction, assign-after-print, or spool usage correction; the archived empty spool is cleared from printer/storage assignments so it stops occupying active stock. Fleet Wall cards now choose the active H2D hotend reading from the active route/nozzle signal, so an AMS HT/right-nozzle print shows the hot right side instead of the cold left side. Static cache bumped to `app.js?v=508`; backend/service restart plus frontend refresh required after deploy.
  - Verification: `python -m py_compile app/db.py app/main.py` passed with the usual Windows Python `<prefix>` warning. `node --check app/static/app.js` passed. `git diff --check` passed with only the existing Windows CRLF warning.

### 2026-06-21 fix (Flight Tower active queue truth)

**Restore active queue rows from live printer state** (`app/db.py`, `app/main.py`, `app/static/app.js`, `app/static/index.html`, `app/static/demo.html`, `SESSION_NEXT.md`)
Fixed a bad Flight Tower story where BigBoy was physically printing but the related queue row still showed `CANCELLED`, causing Flight Tower to count it as blocked work. `/api/queue` now reconciles the live printer state back into the queue: if a printer reports `printing`/`paused`, has no active queue row, and the most recent terminal queue row was either stale-cleared by Flightdeck or cancelled within the last 30 minutes, that row is restored to `printing` and a `queue_active_restored` decision is logged. Flight Tower also stops treating terminal `done`/`failed`/`cancelled` rows as farm-forecast blockers; it focuses on active/pending queue work while Queue remains the recovery surface. Static cache bumped to `app.js?v=507` and `style.css?v=398`; backend/service restart plus frontend refresh required after deploy.
  - Verification: `python -m py_compile app/db.py app/main.py` passed with the usual Windows Python `<prefix>` warning. `node --check app/static/app.js` passed. `git diff --check` passed with only the existing Windows CRLF warning.

### 2026-06-21 feature (About Flightdeck page)

**Add About Flightdeck page** (`app/static/app.js`, `app/static/style.css`, `app/static/index.html`, `app/static/demo.html`)
Added a System -> About page at `#/about` plus command-palette navigation. The page gives Flightdeck a short origin/history without turning it into a marketing landing page: it names Chris Little as creator, explains that Kidabah is the family/GitHub handle from his wife's pet name, credits Steve Keen for practical shop-floor/staff workflow input, states the Bambu-focused beta scope, and summarizes major areas of change such as spool truth, Bambu reliability, slicer handoff, Live cockpit, and Flight Recorder. Static cache bumped to `app.js?v=506` and `style.css?v=397`; frontend refresh required after deploy.
  - Verification: `node --check app/static/app.js` passed. `git diff --check` passed with only the existing Windows CRLF warning.

### 2026-06-21 feature (Empty spool tare profiles)

**Add empty spool tare profiles** (`app/db.py`, `app/main.py`, `app/static/app.js`, `app/static/style.css`, `app/static/index.html`, `app/static/demo.html`)
Added a dedicated `empty_spool_profiles` table/API so measured spool tare weights can be stored separately from the broad material/brand cost row. Existing `material_costs.empty_spool_weight_g` values seed the new profile table on first startup, preserving current tare knowledge. Settings -> Filament now has an `Empty spool profiles` panel where profiles can be added or archived by brand/material/profile/grams/default. The Add/Edit Spool modal now loads these profiles, shows a `Tare profile` selector, and prefers the best matching measured profile before falling back to the old brand/material tare or hardcoded estimates. This is intended to fix real-world tare drift such as eSun measured at 256g while an older default said 224g, without forcing filament write-offs for grams that were never present. Static cache bumped to `app.js?v=505` and `style.css?v=396`; backend/service restart plus frontend refresh required after deploy.
  - Verification: `python -m py_compile app/db.py app/main.py` passed with the usual Windows Python `<prefix>` warning. `node --check app/static/app.js` passed. `git diff --check` passed with only the existing Windows CRLF warning.

### 2026-06-21 feature (QR spool quick assignment)

**Add QR spool quick assignment** (`app/static/app.js`, `app/static/style.css`, `app/static/index.html`, `app/static/demo.html`)
Added the first pass of the scan-to-assign workflow for Steve/staff testing. Existing spool label QR codes already open `#/spool/{id}`; that detail page now includes a mobile-friendly `QR quick move` panel that shows the scanned spool and lets the operator move it to a storage location or pre-assign it to a printer AMS/MMU slot. Printer slots are generated from the live printer model, including Bambu AMS/AMS HT flat slots. Assignment uses the existing `/api/spools/{id}/move` endpoint, can replace an already assigned spool in the destination slot, and requests AMS profile sync when assigning to a printer slot. Static cache bumped to `app.js?v=504` and `style.css?v=395`; frontend refresh required after deploy.
  - Verification: `node --check app/static/app.js` passed. `git diff --check` passed with only the existing Windows CRLF warning.

### 2026-06-21 polish (Compact Live controls drawer)

**Compact Live controls drawer** (`app/main.py`, `app/static/app.js`, `app/static/style.css`, `app/static/index.html`, `app/static/demo.html`)
Polished the Live slide-out controls after the restored temperature panel made the drawer too tall. Preheat presets now prefer the common material order and show up to eight presets plus Cool in a compact 3-column grid, so PETG appears when configured. Temperature rows are shorter and use clickable nozzle/bed readouts with the existing keypad popup; the +/- nudge buttons were removed. H2D-style `hotend_l`/`hotend_r` readouts now open the same temperature popup and are accepted by the backend by mapping to the Bambu hotend temperature command. Static cache bumped to `app.js?v=503` and `style.css?v=394`; backend/service restart plus browser refresh required after deploy.
  - Verification: `.venv\Scripts\python.exe -m py_compile app/main.py` passed with the usual Windows Python `<prefix>` warning. `node --check app/static/app.js` passed. `git diff --check` passed with only the existing Windows CRLF warning.

### 2026-06-21 fix (Queue start handoff debounce)

**Debounce stale queue cleanup during Bambu starts** (`app/db.py`, `app/main.py`)
Follow-up after H2D showed the stale active queue cleanup was still too eager: a freshly sent Bambu queue job could be marked cancelled/cleared while the printer still reported `idle` during the upload/AMS/prep handoff, then flip back to `printing` after the physical-start confirmer saw heat/progress. Queue rows now timestamp the `uploading` state, and stale active cleanup ignores fresh `printing/uploading` rows for an 8-minute grace window (`FLIGHTDECK_QUEUE_ACTIVE_STALE_GRACE_SECONDS`, default `480`). This restores the old smooth queue feel while still allowing genuinely old stuck active rows to be cleaned later. Backend/service restart required after deploy.
  - Verification: `.venv\Scripts\python.exe -m py_compile app/db.py app/main.py` passed with the usual Windows Python `<prefix>` warning. `git diff --check` passed with only the existing Windows CRLF warning.

### 2026-06-21 fix (Live temperature controls)

**Restore Live temperature controls** (`app/static/app.js`, `app/static/style.css`, `app/static/index.html`, `app/static/demo.html`)
Fixed a Live view regression introduced during the camera/control cleanup where `_detailTempsPanel()` still existed and refresh code still tried to update `#detail-temps`, but the full Live render no longer inserted that element anywhere. The nozzle/hotend and bed temperature controls now render at the top of the slide-out Controls rail, keeping the camera-first layout while restoring target editing and +/- nudges. Static cache bumped to `app.js?v=502` and `style.css?v=393`; frontend refresh required after deploy.
  - Verification: `node --check app/static/app.js` passed. `git diff --check` passed with only the existing Windows CRLF warning.

### 2026-06-21 fix (Queue stale active row wording)

**Mark stale active queue rows cancelled** (`app/db.py`, `app/main.py`)
Follow-up after live testing showed the new stale active queue cleanup worked, but the queue row appeared as a red `FAILED` item with `Printer is idle; clearing stale active queue job`, which made a harmless state repair look like another print failure. The idle/ready/finished stale cleanup path now marks those active rows `cancelled` with the softer message `Cleared stale queue state after printer returned to idle`, while genuine printer errors still use the existing failed path. Backend/service restart required after deploy.
  - Verification: `.venv\Scripts\python.exe -m py_compile app/db.py app/main.py` passed with the usual Windows Python `<prefix>` warning. `git diff --check` passed with only the existing Windows CRLF warning.

### 2026-06-20 fix (Queue stale active rows)

**Clear stale active queue rows** (`app/main.py`)
Fixed a Print Queue state leak seen on Greyhound Ludicrous/X1C where a cancelled/stopped Bambu job remained `PRINTING` in Flightdeck, then a newly queued copy was blocked/failed as `Superseded by newer active queue job` while the stale row stayed active. Queue reconciliation now clears active `printing/uploading` rows when the printer status has returned to an inactive state (`idle`, `ready`, `standby`, `finished`, `cancelled`, or `failed`) and logs `queue_active_cleared`. Explicit printer errors/estop are still handled by the existing error path, and genuinely active `printing/paused` printers are left alone. Backend/service restart required after deploy.
  - Verification: `.venv\Scripts\python.exe -m py_compile app/main.py` passed with the usual Windows Python `<prefix>` warning. `git diff --check` passed with only the existing Windows CRLF warning.

### 2026-06-20 feature (Flight Recorder beta discovery)

**Search Pi recorder folders for Flight Recorder** (`app/main.py`, `app/static/app.js`, `app/static/index.html`, `app/static/demo.html`)
Follow-up after live testing showed `Find clip` searched only Flightdeck's configured `flight_recorder` folder, not broader Pi-side folders. The local discovery scan now searches bounded Pi/Flightdeck media roots: the configured recorder folder, common `flight_recorder/timelapse/timelapses/recordings/records/videos/camera` folders under `DATA_DIR` and `PRINT_LIBRARY_DIR`, plus `DATA_DIR` itself. A custom semicolon/newline separated `FLIGHTDECK_RECORDER_SEARCH_DIRS` env var can add extra Pi folders without scanning the whole filesystem. Matches outside the recorder folder are copied into the recorder folder before attaching. History copy now says `Find Pi/Flightdeck clips...`. Static cache bumped to `app.js?v=501`; backend/service restart required after deploy.
  - Verification: `.venv\Scripts\python.exe -m py_compile app/main.py` passed with the usual Windows Python `<prefix>` warning. `node --check app/static/app.js` passed. Temp-folder smoke confirmed discovery can find a matching clip under a Pi-style `flightdeck-data/timelapse` folder while the recorder folder is empty. `git diff --check` passed with only the existing Windows CRLF warnings.

**Finish Flight Recorder beta discovery** (`app/main.py`, `app/static/app.js`, `app/static/index.html`, `app/static/demo.html`)
Finished the beta-sized Flight Recorder path. The existing History `Find clip` action now searches Flightdeck's own recorder folder first and attaches the best matching local clip by print name/subtask and start/end time. If no local clip matches, printer-storage discovery remains Bambu-first/Bambu-tested for beta; Moonraker/Snapmaker-style printer storage discovery now returns a clear beta boundary and operators can still use `Add video` manually. The History recorder copy now says local clips can be found and printer-storage discovery is Bambu-tested for beta, and failed searches surface the backend detail instead of raw response text. Static cache bumped to `app.js?v=500`; backend/service restart required after deploy.
  - Verification: `.venv\Scripts\python.exe -m py_compile app/main.py app/db.py` passed with the usual Windows Python `<prefix>` warning. `node --check app/static/app.js` passed. Temp-folder smoke confirmed the local recorder matcher picks a matching `H2D_H2S_H2C_Poop_Chute.mp4` clip. `git diff --check` passed with only the existing Windows CRLF warnings.

### 2026-06-20 fix (Bambu finish spool deduction fallback)

**Loosen relay filament metadata recovery** (`app/db.py`, `app/static/app.js`, `app/static/index.html`, `app/static/demo.html`)
Follow-up after live History repair on BigBoy's completed direct-slicer print showed `Recovery failed: No matching relay filament metadata found`. This was not caused by swapping filament; it means the existing repair lookup could not match the print's `plate_1.gcode`/subtask name to a stored relay upload entry. The recovery helper now tries exact file/subtask matching first, then falls back to the nearest relay upload for the same printer within two hours before print start or during the print. The History missing-metadata row also exposes `Assign manually` next to `Recover grams`, so an old print can still be repaired by choosing a spool and typing grams even if no relay log exists. Static cache bumped to `app.js?v=499`; backend/service restart required after deploy.
  - Verification: `python -m py_compile app/db.py app/main.py` passed with the usual Windows Python `<prefix>` warning. `node --check app/static/app.js` passed. Temp-DB smoke confirmed a `plate_1.gcode` finished print can recover `42.5g PLA` from a nearby differently named relay upload. `git diff --check` passed with only the existing Windows CRLF warnings.

**Persist and recover Bambu relay filament metadata** (`app/relay.py`, `app/printers/bambu.py`, `app/db.py`, `app/main.py`, `app/static/app.js`, `app/static/index.html`, `app/static/demo.html`)
Fixed the direct-slicer-to-Flightdeck path where a print sent straight from Orca/Bambu Studio via the Flightdeck relay could complete without filament/cost accounting, while the same file worked correctly when dropped into the Queue. Root cause: Queue uploads persist parsed 3MF metadata in `print_queue`, but relay uploads only kept it in memory and only seeded the Bambu preview cache if the preview image existed. Relay uploads now seed the preview cache whenever parsed metadata exists, and the Bambu status path writes that metadata onto the print row as soon as the print starts. History also gets a recovery button for older affected prints with no filament grams: `Recover grams` looks up the matching `relay_upload` decision, restores `filament_grams/material`, then the existing `Assign spool` action can deduct from the correct spool. Static cache bumped to `app.js?v=498`; backend/service restart required after deploy.
  - Verification: `python -m py_compile app/db.py app/main.py app/printers/bambu.py app/relay.py` passed with the usual Windows Python `<prefix>` warning. `node --check app/static/app.js` passed. Temp-DB smoke confirmed a finished print with no grams can recover `42.5g PLA` from a matching relay upload decision. `git diff --check` passed with only the existing Windows CRLF warnings.

**Use queue metadata when Bambu finish preview metadata is missing** (`app/printers/bambu.py`, `app/db.py`)
Fixed the BigBoy/H2D completion case where a print finished cleanly, but History showed no filament/cost rows and the decision trail logged `spool_no_deduction_cancelled` because the live FTP preview/cache did not provide `filament_weight_g` at finish. The Bambu status path now falls back to the active queue row's parsed 3MF metadata (`filament_weight_g`, `filament_type`, `filament_colors`) for both live progress deductions and final finish deductions before giving up. Also moved the `slot_snapshot` local initialisation ahead of snapshot parsing as a defensive guard against the recurring notification `cannot access local variable 'slot_snapshot' where it is not associated with a value`. This is accounting/deduction only; no AMS mapping, queue preflight, slicer, or printer command code was touched. Backend/service restart required after deploy.
  - Verification: `python -m py_compile app/db.py app/printers/bambu.py` passed with the usual Windows Python `<prefix>` warning. `git diff --check` passed with only the existing Windows CRLF warnings.

### 2026-06-19 polish (Compact spool labels)

**Tighten compact label colour line** (`app/label_printer.py`)
Adjusted the compact/default QL-700 label so the colour name and colour hex print on the same line, e.g. `Silver  #817E7E`, leaving more vertical breathing room for the large shelf-readable spool number. Backend/service restart required after deploy because label rendering lives in Python.
  - Verification: `python -m py_compile app/label_printer.py` passed with the usual Windows Python `<prefix>` warning. Bundled-Python render smoke confirmed compact label size `(696, 330)`. `git diff --check` passed with only the existing Windows CRLF warnings.

**Make compact label spool number prominent** (`app/label_printer.py`)
Polished the compact/default QL-700 spool label so the Flightdeck spool number is readable at shelf distance. The compact label now prints the spool number as a large bold `#ID` instead of the small `Spool #ID` line, with the footer moved lower to keep the number clear. Also hardened `_font()` with Windows font fallbacks so local preview renders use realistic font sizes instead of PIL's tiny default when Linux DejaVu paths are unavailable. Backend/service restart required after deploy because label rendering lives in Python.
  - Verification: `python -m py_compile app/label_printer.py` passed with the usual Windows Python `<prefix>` warning. Bundled-Python render smoke confirmed compact label size `(696, 330)`. `git diff --check` passed with only the existing Windows CRLF warnings.

### 2026-06-19 polish (Archived spool cards)

**Mark archived spool cards clearly** (`app/static/app.js`, `app/static/style.css`, `app/static/index.html`, `app/static/demo.html`)
Polished the archived spool inventory view so archived records read as historical/used stock at a glance. Single archived spool cards and archived multiple/group cards now get a muted archived card style plus an `ARCHIVED` stamp across the colour band. Archived groups remain separate from active groups because archive state is already part of the spool grouping key. Static cache bumped to `app.js?v=497` and `style.css?v=392`; frontend refresh only.
  - Verification: `node --check app/static/app.js` passed. `git diff --check` passed with only the existing Windows CRLF warnings.

### 2026-06-19 fix (Archived spool inventory cache)

**Keep archived spools loaded in inventory view** (`app/static/app.js`, `app/static/index.html`, `app/static/demo.html`)
Fourth pass on archived spool cards after live testing proved `/api/spools/all` returned archived spool `#89`, but `Cards + Archived + All` still rendered no cards unless searching `89`. Root cause: an older background spool refresh path still fetched active-only `/api/spools` and assigned it back into the shared `_allSpools` cache after the Spools page loaded the full inventory. The loaded-printer spool refresh now uses `/api/spools/all` and filters archived rows only when building `_latestSpoolsByPrinter`. The Archived view also self-recovers: if the current cache has no archived rows, it reloads `/api/spools/all` before showing the empty state. Archived Cabinet view falls back to card rendering because the cabinet layout intentionally hides archived loaded/shelf positions. Static cache bumped to `app.js?v=496`; frontend refresh only.
  - Verification: Live API probe confirmed `/api/spools/all` returns archived spool `#89` while the fresh browser tab still reproduced empty `Cards + Archived + All` before this fix. `node --check app/static/app.js` passed. `git diff --check` passed with only the existing Windows CRLF warnings.

### 2026-06-19 fix (Archived spool bulk list)

**Add explicit all-spools inventory endpoint** (`app/main.py`, `app/static/app.js`, `app/static/index.html`, `app/static/demo.html`)
Third pass on archived spool visibility after `Cards + Archived + All` still showed no spools unless the operator searched the exact number `89`. The direct `/api/spools/{id}` lookup could see archived spool `#89`, proving the row existed, but the bulk inventory fetch path could still drop archived rows. Added explicit `GET /api/spools/all` returning `db.get_spools(include_archived=True)` and moved the Spools inventory page to that route, so the normal archived/all card view loads the same full inventory before client-side filters run. Existing `/api/spools` remains the active-only/default route for older flows. Static cache bumped to `app.js?v=495`; backend restart required after deploy.
  - Verification: `python -m py_compile app/main.py` passed with the usual Windows Python `<prefix>` warning. `node --check app/static/app.js` passed. `git diff --check` passed with only the existing Windows CRLF warnings. Route order was checked in source: `/api/spools/all` is declared before `/api/spools/{spool_id}`.

### 2026-06-19 fix (Archived spool exact search hardening)

**Harden archived spool number search** (`app/static/app.js`, `app/static/index.html`, `app/static/demo.html`)
Second pass after archived spool `#89` still did not appear in the Spools search. The Spools page now fetches the full inventory with `include_archived=1`, disables browser cache for that list request, adds an `Any status` filter chip, and falls back to `/api/spools/{id}` when a numeric search like `89` returns no client-side matches. The fallback can show the exact archived/active spool even if the bulk list is stale, or explain that the spool exists under the other status. Static cache bumped to `app.js?v=494`; frontend refresh only.
  - Verification: `node --check app/static/app.js` passed. `git diff --check` passed with only the existing Windows CRLF warnings.

### 2026-06-19 fix (Archived spool search)

**Load archived spools for inventory search** (`app/static/app.js`, `app/static/index.html`, `app/static/demo.html`)
Fixed the Spools page search/filter path after archiving spool `#89`: the UI had an `Archived` filter chip, but the page loaded `/api/spools` without `include_archived=true`, so archived spools were never present in the client-side list and could not appear in search. The Spools page now fetches `/api/spools?include_archived=true`, letting `Archived` + search by number find archived spool records while leaving active/archived filtering client-side. Static cache bumped to `app.js?v=493`; frontend refresh only.
  - Verification: `node --check app/static/app.js` passed. `git diff --check` passed with only the existing Windows CRLF warnings.

### 2026-06-19 fix (Mobile Spools scrolling)

**Fix mobile spools page scrolling** (`app/static/style.css`, `app/static/index.html`, `app/static/demo.html`)
Fixed the Spools page not scrolling correctly on mobile. The standalone `#view-spools` page had its own `overflow: hidden` rule that overrode the generic mobile `.view { overflow: visible; }`, so the page could not grow naturally on phones. Mobile Spools now uses normal page scrolling, `#spool-list` no longer traps vertical scroll, table view keeps horizontal scrolling, and cabinet lanes stop using nested vertical scrolling on mobile. Static cache bumped to `style.css?v=391`; frontend refresh only.
  - Verification: `git diff --check` passed with only the existing Windows CRLF warnings. Static/CSS-only change; no backend restart required.

### 2026-06-19 feature (History spool assignment repair)

**Add history spool assignment repair** (`app/db.py`, `app/main.py`, `app/static/app.js`, `app/static/style.css`, `app/static/index.html`, `app/static/demo.html`)
Added an `Assign spool` recovery path in print History for finished/stored print records that have filament grams but no `spool_usage`. This covers the workshop case where staff load filament and run a print without assigning a Flightdeck spool first. The History detail now shows `No spool assigned` with an `Assign spool` action; the modal lets the operator choose the real spool and grams to deduct. The backend refuses to apply this path if the print already has recorded spool usage, deducts the selected amount once, records the usage row with `assigned_after_print`, and logs a decision entry. Existing reconcile/correct flows still handle prints that already have usage. Static cache bumped to `app.js?v=492` and `style.css?v=390`; backend restart required after deploy.
  - Verification: `python -m py_compile app/db.py app/main.py` passed with the usual Windows Python `<prefix>` warning. `node --check app/static/app.js` passed. `git diff --check` passed with only the existing Windows CRLF warnings. Temp-database smoke confirmed a 42.5g assignment deducts once and a second assignment is refused as already assigned.

### 2026-06-18 prototype (H2C Tool Matrix)

**Add H2C tool matrix prototype** (`docs/prototypes/h2c-tool-matrix.html`)
Added a standalone visual prototype for future H2C support before the printer arrives. The mockup treats the seven H2C tools/nozzles as the main operating surface, with each tool card owning state, material, source spool, active/review/ready status, and job intent. AMS and AMS HT are shown below as material sources feeding the tool matrix rather than drawing dense route lines across the live view. This is intentionally docs-only and does not change runtime app code, printer commands, AMS mapping, slicer flow, or cachebust versions.
  - Verification: `git diff --check` passed with only the existing Windows CRLF warning on `SESSION_NEXT.md`.

### 2026-06-18 polish (AMS review and Trust Printer copy)

**Polish AMS review and Trust Printer copy** (`app/static/app.js`, `app/static/style.css`, `app/static/index.html`, `app/static/demo.html`)
Reworded the AMS Profile Doctor advanced `Trust Printer` copy so lay users do not see a specific spool number and think the warning always applies to that spool. The warning now says it replaces the assigned spool's stored material, colour, and brand from the printer AMS report for this slot, and the confirmation uses the same generic wording. Also polished the Live Environment review state: warning/review route lines are softer, and the AMS loadout no longer draws the bright vertical feed beam through warning/review slots. The advanced panel styling was softened from amber warning to a quieter secondary repair block while keeping the action itself visually cautious. Static cache bumped to `app.js?v=491` and `style.css?v=389`; frontend refresh only.
  - Verification: `node --check app/static/app.js` passed. `git diff --check` passed with only the existing Windows CRLF warnings.

### 2026-06-18 polish (AMS Profile Doctor trust actions)

**Move Trust Printer behind advanced repair** (`app/static/app.js`, `app/static/style.css`, `app/static/index.html`, `app/static/demo.html`)
Demoted the AMS Profile Doctor `Trust Printer` action after the X1C case where Flightdeck correctly knew a slot was ASA White but the printer still reported ABS Black; one click on `Trust Printer` would overwrite the stored Flightdeck spool to the stale printer report. `Trust Flightdeck` remains in the normal action row. `Trust Printer` is now inside an `Advanced repair` details block with warning copy and a confirmation modal explaining it will overwrite Flightdeck's stored material/colour/brand from the printer AMS report. Static cache bumped to `app.js?v=490` and `style.css?v=388`; frontend refresh only.
  - Verification: `node --check app/static/app.js` passed. `git diff --check` passed with only the existing Windows CRLF warnings.

### 2026-06-17 fix (Bambu slot snapshot notification)

**Guard spool deduction against malformed slot snapshots** (`app/db.py`)
Fixed a Bambu status-poll notification/error like `BigBoy · cannot access local variable 'slot_snapshot' where it is not associated with a value`. The spool deduction helper now parses `ams_slot_snapshot` defensively: invalid JSON, non-dict snapshots, meta-only snapshots, and non-numeric slot keys are skipped cleanly instead of throwing inside the printer poll. Valid snapshots still deduct normally. This does not touch Bambu AMS mapping, queue preflight, printer commands, or frontend code. Backend restart required after deploy.
  - Verification: `python -m py_compile app/db.py app/printers/bambu.py`, `git diff --check`, and a temp-database smoke passed. The smoke confirmed malformed/meta-only snapshots return `False` without throwing and a valid snapshot still deducts. Windows Python emitted its usual `Could not find platform independent libraries <prefix>` warning but exited successfully.

### 2026-06-17 polish (Walkthrough first screen)

**Tighten Walkthrough Mode first screen** (`app/static/app.js`, `app/static/style.css`, `app/static/index.html`, `app/static/demo.html`)
Compressed the Walkthrough Mode header into a compact welcome strip with the Flightdeck icon and `Welcome to Flightdeck` copy, shortened the talk-track text, reduced metric/card spacing, and tightened the walkthrough/quick-start rows so the page is much more likely to fit as a single-screen overview on desktop. Mobile hero/logo wrapping was adjusted at the existing breakpoint. Static cache bumped to `app.js?v=489` and `style.css?v=387`; frontend refresh only.
  - Verification: `node --check app/static/app.js` passed. `git diff --check` passed with only the existing Windows CRLF warnings.

### 2026-06-17 polish (Walkthrough quick start)

**Add quick-start links to Walkthrough Mode** (`app/static/app.js`, `app/static/style.css`, `app/static/index.html`, `app/static/demo.html`)
Replaced the old right-side `Do Not Show First` warning card with an `Easy as 1-2-3` quick-start path: `Add printers` links to `#/settings/printers`, `Add spools` links to `#/spools`, `Add a file` links to `#/files`, and `Print` links to `#/queue`. The rows are styled as compact clickable setup steps with mobile wrapping. Static cache bumped to `app.js?v=488` and `style.css?v=386`; frontend refresh only.
  - Verification: `node --check app/static/app.js` passed. `git diff --check` passed with only the existing Windows CRLF warnings.

### 2026-06-17 polish (Walkthrough Mode rename)

**Turn in-app Demo Mode into Walkthrough Mode** (`app/static/app.js`, `app/static/index.html`, `app/static/demo.html`, `README.md`, `INSTALL.md`)
Renamed the real-install guided tour from `Demo Mode` to `Walkthrough Mode` so it better matches the release/demo workflow: use the live app for a guided screen-share or creator walkthrough, while keeping standalone `/demo` as the simulated no-printer sandbox. The sidebar and command palette now point at `#/walkthrough`; old `#/demo` links still route to the same in-app walkthrough for compatibility. The Flight Manual and install docs now explain `System -> Walkthrough Mode` versus standalone `/demo`. No printer, queue, AMS, slicer, or runtime paths were touched. Static cache bumped to `app.js?v=487`; frontend refresh only.
  - Verification: `node --check app/static/app.js` passed. `git diff --check` passed with only the existing Windows CRLF warnings.

### 2026-06-17 fix (H2D regular AMS nozzle parse)

**Parse H2D plate nozzle when filament nozzle map is missing** (`app/printers/bambu_ftp.py`)
Fixed a false queue block on `Spindle Centre v2.0_PLA_1h28m.gcode.3mf`, sliced for H2D using regular AMS/AMS2 Pro slot 1, where Flightdeck stored `filament_colors[].nozzle = 0` and blocked with `job is sliced for right nozzle... matching PLA Grey is loaded in AMS 1 slot 1 (left nozzle)`. Root cause: this 3MF has no `filament_nozzle_map`; it has `physical_extruder_map = [1,0]` plus plate `<nozzle id="0" extruder_id="1">`. The fallback parser treated `physical_extruder_map` itself as the nozzle list and then mapped it through `physical_extruder_map` again, turning the first filament into right nozzle. `_parse_filament_nozzle_map()` now uses explicit `filament_nozzle_map` exactly as before when present, but when it is missing it reads the plate `<nozzle id>` entries and translates those through `physical_extruder_map` once. Existing queued rows parsed before this fix still carry stale metadata; delete/re-upload or re-add those files after deploy so they parse fresh.
  - Verification: `python -m py_compile app/printers/bambu_ftp.py`, `git diff --check`, and parser smokes passed. `Spindle Centre v2.0_PLA_1h28m.gcode.3mf` now parses as `nozzle: 1` (left/regular AMS). Known AMS HT files `HT__TEST.gcode.3mf`, `Revised Wheel_HT_SilverPLA_2h39m.gcode.3mf`, and `Revised Wheel_PLA_2h38m.gcode.3mf` still parse as `nozzle: 0` (right/AMS HT). The explicit-map smoke still maps `filament_nozzle_map=[1]` plus `physical_extruder_map=[1,0]` to right nozzle.

### 2026-06-15 fix (H2D nozzle-path stock gate)

**Block H2D queue starts when nozzle-path spool stock is short** (`app/main.py`)
Hardened queue preflight after BigBoy/H2D paused mid-print on filament runout while the AMS HT modal showed the HT bay empty and no Flightdeck spool assigned. The existing colour stock check could prove that matching filament existed somewhere on the printer, but for H2D dual-path jobs it did not separately prove that the sliced nozzle path had an assigned Flightdeck spool with enough grams. `_queue_preflight()` now builds nozzle-path-aware coverage from sliced `filament_colors[].nozzle`: right-nozzle jobs only count canonical AMS HT slots (`location_slot >= 128`), left-nozzle jobs only count regular AMS slots, and insufficient/no assigned stock blocks dispatch with `Loaded nozzle-path stock short...`. This deliberately avoids touching the Bambu AMS mapping/send path. Backend restart required; it will protect future queue starts, but the already-paused printer still needs normal operator recovery/load-resume handling.
  - Verification: `python -m py_compile app/main.py`, `git diff --check`, and venv smoke tests passed. The smoke tests confirmed a right-nozzle HT job with only a matching regular AMS spool now blocks, a right-nozzle HT job with a 50g assigned HT spool for a 96g print blocks, and the same job with a 120g assigned HT spool is ready.

### 2026-06-15 research (Bambu-Run comparison)

**Add Bambu-Run comparison research note** (`docs/research/bambu-run-comparison.md`)
Stored a safe comparison note for RunLit/Bambu-Run covering feature overlap, Bambu cloud task sync clues, auth/token handling, MQTT/AMS field checklists, AMS type-code hints, and Bambu colour catalog notes. The note deliberately does **not** copy Bambu-Run code or full colour files because the repository metadata has a license mismatch (GitHub page GPL-3.0, `pyproject.toml` MIT). Colour work should use this as a shape reference and build a Flightdeck-owned catalog from official/user-owned sources.

### 2026-06-15 polish (live header controls)

**Polish live header action controls** (`app/static/style.css`, `app/static/index.html`, `app/static/demo.html`)
Tightened the Live header action area after the controls drawer change. The printer state/reprint/print-enabled group now sits in a subtle action pill, `Reprint last` reads as a deliberate green command, and the light/pause/cancel/e-stop transport deck has stronger button sizing, hover states, and danger styling. Static cache bumped to `style.css?v=385`; frontend refresh only.

### 2026-06-15 polish (live controls drawer)

**Move live controls into a slide-out drawer** (`app/static/app.js`, `app/static/style.css`, `app/static/index.html`, `app/static/demo.html`)
Moved the Live page preheat, fan, jog, home, and Klipper controls out of the always-visible left rail and into a left slide-out `Controls` drawer over the camera. The camera now gets the full main deck by default, while the same printer control buttons/sliders remain available on demand. Static cache bumped to `app.js?v=486` and `style.css?v=384`; frontend refresh only.

### 2026-06-15 polish (fan controls)

**Use proper red for fan-off sliders** (`app/static/style.css`, `app/static/index.html`, `app/static/demo.html`)
Changed the live fan-control slider off state from the theme danger colour, which read as pink in the current palette, to a fixed red accent. The green/on slider state is unchanged. Static cache bumped to `style.css?v=383`; frontend refresh only.

### 2026-06-15 fixes (X1C queue mapping)

**Scope H2D nozzle/AMS guard to path-aware printers** (`app/printers/bambu.py`, `app/relay.py`)
Fixed an X1C queue failure where `spacerv2.gcode.3mf` was blocked with `H2D AMS mapping blocked... assigned to right nozzle` even though the job targeted the X1C. Normal X1C 3MF metadata can include `nozzle: 0`, but X1C AMS slots do not have H2D left/right path annotations. The Bambu queue/relay mappers now enforce nozzle-path matching only when the loaded AMS slots actually include `nozzle` metadata (H2D path-aware case). X1C falls back to material/colour AMS matching as intended.

### 2026-06-14 fixes (live reprint)

**Live view Reprint last** (`app/main.py`, `app/db.py`, `app/static/app.js`, `app/static/style.css`)
Added a first-pass safe `Reprint last` action to the Live header when a printer is `idle` or `finished`. It finds that printer's newest completed queue row, resets it to `pending` at the end of the printer queue, then takes the operator to the Queue so normal preflight and `Send now` still apply. It does not start the printer automatically. Static cache bumped to `app.js?v=485` and `style.css?v=380`.

### 2026-06-14 fixes (queue clear done)

**Fix Clear done 422** (`app/main.py`, `app/static/app.js`)
The Print Queue `Clear done` button was calling `DELETE /api/queue/completed`, but FastAPI matched the earlier dynamic `DELETE /api/queue/{job_id}` route first and tried to parse `completed` as an integer job id, returning `422`. Added a non-conflicting `DELETE /api/queue/completed/clear` endpoint and pointed the UI at it. Static cache bumped to `app.js?v=484`.

### 2026-06-14 fixes (queue reprint)

**Reprint completed queue files** (`app/db.py`, `app/static/app.js`, `app/static/style.css`)
Completed `done` jobs in the Print Queue now show a `Reprint` action. It reuses the existing queue file and resets the row back to `pending` at the end of that printer's queue, clearing previous start/finish/error fields so normal queue preflight and `Send now` behaviour applies. Failed/cancelled retry now also moves the job to the back of the printer queue. Static cache bumped to `app.js?v=483` and `style.css?v=379`.

### 2026-06-14 fixes (UI progress display)

**Hide stale printer-nav progress badge** (`app/static/app.js`)
Removed the percent badge from the left printer navigation after BigBoy showed mismatched progress values between the nav (`84%`) and the live detail card (`91%`). The nav is now just printer identity/state; the live card, print details panel, and camera HUD remain the progress source of truth. Static cache bumped to `app.js?v=482`.

### 2026-06-14 fixes (camera streams)

**Frozen MJPEG stream — watchdog blind spot** (`app/camera.py`, `76826f4`)
The watchdog checked `_last_frame_at` (frames arriving) but not `_last_changed_at` (frame content changing). H2D firmware freeze sends the same JPEG on repeat — frames keep arriving so the 8s stale timeout never fires, stream stays frozen indefinitely. Fix: added `_FROZEN_TIMEOUT = 20` — if frame content hasn't changed for 20 seconds while frames are still arriving, kill and restart ffmpeg. Stream self-heals within 20s automatically. Note: `-rw_timeout`/`-stimeout` ffmpeg flags were tried and reverted — too aggressive for H2D RTSP, caused ffmpeg to exit prematurely. The watchdog is the right layer for this.

---

### 2026-06-14 fixes (H2D AMS HT end-to-end)

Root-cause investigation of H2D AMS HT prints not starting. Multiple stacked bugs, all now fixed and confirmed working with a live 2h 36m print running on AMS HT grey PLA via the right nozzle.

**1. `PrinterStatus` is a dataclass — no `.dict()` or `.model_dump()`** (`app/main.py`)
Cold-start detection polled `p.status()` every 3s and tried to serialise the result with `.dict()` / `.model_dump()`. Both raise `AttributeError` on a plain `@dataclass`. Every poll silently crashed, `last_state` stayed `"status error"`, and after 90s the start was always declared cold and the printer was blocked. Fixed by importing `PrinterStatus` and reading its fields directly.

**2. Auto-cancel never ran** (`app/main.py`)
When cold-start timeout fired, the code blocked the printer but never sent an MQTT cancel. The printer sat frozen in `printing` state indefinitely. Added `await asyncio.to_thread(p.cancel)` before the block so the printer returns to idle cleanly.

**3. AMS HT false active-slot detection** (`app/printers/bambu.py`)
`_parse_ams` called `_bambu_tray_target(slot_index)` without `regular_ams_slots`, so AMS HT slot 0 (canonical index 128) computed tray target 0 — same as regular AMS slot 0. Both showed `active=True` when `tray_now=0`, which caused a false pre-dispatch "active slot mismatch" block on idle printers. Fixed by pre-computing `regular_ams_slots = n_regular_units * 4` from the MQTT dump and passing it into `_bambu_tray_target`. Also restricted the mismatch check to `state in {"printing", "paused"}` so it never fires when the printer is idle.

**4. `filament_ids` off-by-one** (`app/printers/bambu_ftp.py`)
XML `<filament id="5">` in `slice_info.config` is 1-indexed; gcode T-commands are 0-indexed. Code was setting `ams_mapping[5] = 4` but firmware reads `ams_mapping[4]` (finds `-1`, falls back to tray 0 = wrong slot). Fixed: `int(el.get("id")) - 1`.

**5. Wrong `ams_id` for AMS HT in `ams_mapping2`** (`app/printers/bambu.py`)
`_build_bambu_ams_mappings` computed `ams_id = tray_id // 4 = 4 // 4 = 1`. The H2D firmware expects `ams_id = 128` for AMS HT — the same unit_id it reports in MQTT status. With `ams_id=1` the firmware rejected the slot address at "preparing AMS" (step 1) and the print stalled. Fixed by passing `regular_ams_slots` (read from MQTT dump as `n_regular_units * 4`) through `send_file → start_uploaded_3mf → start_print_3mf → _build_bambu_ams_mappings`. Slots with `tray_id >= regular_ams_slots` now get `ams_id=128, slot_id = tray_id - regular_ams_slots`.

**6. Cold-start detection too aggressive** (`app/main.py`)
90s timeout + immediate idle-break on first poll (3s after command) cancelled prints that were legitimately in the H2D AMS prep sequence (preparing AMS → cooling chamber → homing tool head → changing filament = 3-5 min). Fixed: timeout extended to 360s; idle-break only after 45s of sustained idle; immediate break on `error`/`estop` only.

**Verification:** decisions log `04:27:55` shows `ams_mapping2[4]={"ams_id":128,"slot_id":0}`, `regular_ams_slots=4`; `queue_bambu_start_confirmed` at `04:28:12`; print running.

---

### Prior 2026-06-13 work

Recent work:
- Added a Bambu/H2D failed-start safety block after BigBoy accepted a start command but stayed cold and the printer screen reported AMS/AMS HT communication fault `[0500-40c0 220913]`. `_advance_queue_specific()` already waits up to 90s for physical start proof; when that proof never appears, Flightdeck now fails the queue job **and disables Print enabled for that printer** with a clear note to check the printer screen for AMS/AMS HT errors, clear printer state, then re-enable printing. This prevents the UI from returning to a misleading "idle / print enabled" state after an accepted-but-not-started job. No AMS mapping code was touched.
  - Live check before this change: BigBoy returned to `idle`, no active job, heater targets `0`, AMS 1 and AMS HT visible in telemetry, queue job `#61` failed safely, latest cancelled print-memory entries had no spool usage, and spool `#89` remained restored. Verification: `python -m py_compile app/main.py` and `git diff --check` passed.
- Corrected the live ghost-start accounting caused by H2D job `#60` / print memory `#218`. The printer never heated, but Flightdeck had marked the print `FINISHED` and deducted `95.74g` from spool `#89`. Print `#218` is now tagged `ghost-start` and excluded from stats, and spool `#89` was reconciled back to `596.5g` (`actual_grams=0.0`). Follow-up backend hardening in `app/printers/bambu.py` tracks whether a Bambu job ever showed physical start proof; if `FINISH` arrives without heater target/progress proof, it closes the print as `ERROR`, logs `ghost_start_resolved`, and skips spool deduction. Backend restart required. No AMS mapping code was touched.
- Hardened Bambu queue starts against H2D ghost-print states. Live H2D showed `state=printing` and queue job `#60` was marked `printing`, but the user's photo and telemetry showed both nozzle targets and bed target were still `0`, progress was `0%`, and layer remained stale at `100/100`. `_advance_queue_specific()` now waits up to 90s after the Bambu MQTT start command for physical proof of start (heater target > 0 or progress > 0) before calling `queue_set_started()`. If the printer accepts the MQTT command but never heats/progresses, the queue row is failed with a clear "accepted start command but did not begin heating" error and logs `queue_bambu_start_unconfirmed`. Backend restart required. No AMS mapping code was touched.
- Fixed a silent queue-action failure path after H2D showed as idle and queue job `#60` was preflight-ready but the print still did not start from the browser. The queue click handler now uses `_queueFetchJson()` for send, retry, reorder, and clear-completed actions so non-2xx backend responses surface as the existing "Queue action failed" toast instead of being ignored. Static cache bumped to `app.js?v=481`; frontend refresh required. Live check at the time showed BigBoy `idle`, job `#60` pending, and `/api/queue/60/preflight` returned `can_start: true` with no issues.
- Shortened the Bambu/H2D finished-state display window from 30 minutes to 5 minutes after BigBoy completed successfully but stayed in Flightdeck as `finished` with the old `/data/Metadata/plate_1.gcode` job attached. Live check showed the queue was clean and H2D had no active job; sending the existing `cancel`/clear command returned `ok` but did not dismiss the H2D firmware's completion latch over MQTT. This change keeps the useful "print complete" state briefly, then lets Flightdeck return BigBoy to idle sooner so the next dispatch is not visually confused by stale completion/progress data. If the H2D touchscreen is still on the completion dialog, the operator may still need to tap OK on the printer; no AMS mapping code was touched.
- **Added slicer health endpoint + UI** (`app/main.py`, `app/static/app.js`, `app/static/style.css`). **`app/printers/bambu.py` was NOT touched — AMS mapping code (`_build_bambu_ams_mappings`, `_bambu_tray_target`, `ams_slots`) is unchanged.**
  - `GET /api/slicer/health` probes all four configured slicer services in parallel (3s timeout each): Windows worker (`/api/slicer/worker/status`), Browser Orca, Bambu Studio browser, Slicer API (`/health`). Returns per-component `{configured, ok, url, detail}` plus top-level `all_ok` / `any_configured`.
  - Settings > Slicer: new "Check all" button renders a colour-coded health grid (green=online, amber=offline + plain-English hint per service, grey=not configured).
  - Slice Modal: after the plan renders, if worker or API URL is configured, an async health probe fires and appends a `slicer-health-warning` strip if any service is offline — "Windows slicers offline / start Docker Desktop on Windows and wait for containers."
  - **Live test from Pi (2026-06-13, all services up):**
    - `worker`: `ok: true` — `http://100.112.171.88:8000` — `Reachable · C:\Program Files\OrcaSlicer\orca-slicer.exe`
    - `orca_browser`: `ok: true` — `https://100.112.171.88:3011` — `Reachable (sign-in required)`
    - `bambu_browser`: `ok: true` — `https://100.112.171.88:3012` — `Reachable (sign-in required)`
    - `slicer_api`: `ok: true` — `http://100.112.171.88:3003` — `Reachable`
    - `all_ok: true`, `any_configured: true`
  - `python -m py_compile app/main.py`, `node --check app/static/app.js`, `git diff --check` all clean.
  - Cachebusted: `app.js?v=480`, `style.css?v=378` (both `index.html` and `demo.html`).

- Reduced live camera freeze impact on printer detail streams. Direct H2D camera checks showed snapshots worked and `/api/camera/h2d/stream` delivered MJPEG bytes steadily, so the likely failure was the browser holding an open MJPEG image after repaint stalled. Visible camera streams now refresh every 45s instead of 120s, and the camera signal marks all stale streams, not only fleet-wall stills. Static cache bumped to `app.js?v=480`; frontend refresh required.
  - Verification: `node --check app/static/app.js`, `git diff --check`, live snapshot fetch for H2D, and a 12s direct MJPEG stream pull from `/api/camera/h2d/stream` passed.
- **CONFIRMED WORKING (cd1edb8)**: H2D AMS HT prints now start correctly via Flightdeck queue. Final root causes fixed across this session:
  1. **Wrong filament_ids index**: XML `<filament id="N">` is 1-indexed; gcode T-commands are 0-indexed. Fixed by subtracting 1 in `bambu_ftp.py`.
  2. **Wrong flat ams_mapping value**: Sequential flat tray ID for AMS HT slot 0 is `regular_ams_slots + 0 = 4` (not MQTT unit_id 128). Fixed in `_bambu_tray_target()`.
  3. **Wrong ams_mapping2 ams_id**: `ams_id` in the print command must be `128` for AMS HT, matching the MQTT unit_id — NOT `tray_id // 4 = 1`. Using `ams_id=1` caused the firmware to reject the slot address at "preparing AMS" step 1. Fixed in `_build_bambu_ams_mappings()` via `regular_ams_slots` parameter passed through `send_file → start_uploaded_3mf → start_print_3mf`.
  4. **Cold-start detection too aggressive**: 90s timeout and immediate idle-break cancelled prints during the H2D AMS prep sequence (preparing AMS → cooling → homing → filament change, which takes 3-5 min). Fixed: 360s timeout, 45s idle grace period, immediate break only on `error`/`estop`.
  - Verification: decisions log at 04:27:55 shows `ams_mapping2[4]={"ams_id":128,"slot_id":0}`, `queue_bambu_start_confirmed` at 04:28:12, print running 2h 36m job on AMS HT grey PLA via right nozzle.

- Follow-up after the fresh H2D retry still failed with `1800-8012`: diagnostics showed the queued job parsed `plate_1.json` `filament_ids: [4]` and Flightdeck would therefore send flat `ams_mapping=[4]`, but the same real 3MF's `Metadata/slice_info.config` has `<filament id="5" ...>` and Bambu Studio displays the filament as `5`. `_parse_3mf()` now prefers the slice-info filament `id` for `BambuPreview.filament_ids`, falling back to plate JSON only if slice-info IDs are missing. Queue mapping logs now include the final `flat_ams_mapping` and `ams_mapping2` that will be sent, so the next retry can be audited directly. Backend restart required.
  - Verification: parsed both real files `Revised Wheel_HT_SilverPLA_2h39m.gcode.3mf` and `Revised Wheel_PLA_2h38m.gcode.3mf`; both now report `filament_ids: [5]` and `_build_bambu_ams_mappings([128], [5])` returns flat `[5]` plus detailed `{"ams_id": 128, "slot_id": 0}`. `python -m py_compile app/printers/bambu.py app/printers/bambu_ftp.py app/relay.py` and `git diff --check` passed.
- First attempted H2D AMS HT 1800-8012 fix: Flightdeck had been sending `ams_mapping=[128]` (MQTT unit ID), while the H2D firmware's flat lookup table needs a slicer-side filament/tray index. The first fix used `plate_N.json` `"filament_ids": [4]` as that flat override and threaded it through `start_print_3mf()`, `start_uploaded_3mf()`, `bambu_upload()`, and `bambu_print_start()`. It also fixed `ams_mapping2` AMS HT decomposition: was sending `{"ams_id": 128+N, "slot_id": 0}` instead of `{"ams_id": 128, "slot_id": N}`. Retest still failed, which led to the follow-up above: use `slice_info.config` filament id `5` instead of plate JSON id `4`.
  - Verification: `python -m py_compile app/printers/bambu.py app/printers/bambu_ftp.py app/relay.py`, `git diff --check` passed. queue_bambu_mapping decision log now records `filament_ids` alongside `ams_mapping`. Next test: queue a fresh AMS HT print and confirm it starts without 1800-8012.

---

## 2026-06-07 Session handoff

Latest GitHub/Pi state:
- Branch: main
- Latest commit: current HEAD after this handoff (`Stabilize Bambu queue and H2D AMS mapping`)
- Pi repo: /home/flightdeck/flightdeck
- Data dir: /home/flightdeck/flightdeck-data
- App URL: https://flightdeck.tail7de73e.ts.net/
- Refresh cachebust currently: app.js?v=479 / style.css?v=377 / demo-runtime.js?v=8

Recent work:
- Added a Flightdeck recovery modal for stopped/failed queue jobs, modelled on the H2D `Print Stopped` flow the user photographed. Failed/cancelled queue jobs now show a `Recover` action that opens a `Print stopped` dialog with the failed job, reason, `Filament / nozzle check`, `Open live view`, `Clear printer state`, a required `Bed is clear` checkbox, and `Print again`. `Print again` retries then sends the same job, but preserves queue preflight protection; if H2D nozzle/AMS or filament checks still block the job, the modal shows the actual blocker instead of blindly sending it. Static cache bumped to `app.js?v=479` and `style.css?v=377`; frontend refresh required.
  - Verification: `node --check app/static/app.js`, `git diff --check`, and a local browser smoke at `http://127.0.0.1:8022/#/queue` passed with no console errors.
- Corrected the H2D slicer nozzle-map interpretation after the Bambu Studio Filament Grouping dialog showed filament `5` under `Right Nozzle` while Flightdeck had parsed the generated 3MF as `nozzle: 1` and treated that as left. `_parse_filament_nozzle_map()` now translates `filament_nozzle_map` through `physical_extruder_map` when present, so Bambu's raw slicer nozzle index becomes Flightdeck's internal convention (`0=right`, `1=left`) before queue preflight or AMS mapping uses it. Backend restart required.
  - Verification: a synthetic 3MF smoke with `filament_nozzle_map=[1]` and `physical_extruder_map=[1,0]` now parses as `nozzle: 0`, and the mapper smoke confirms the job maps to AMS HT tray `[128]`.
- Hardened H2D AMS mapping so impossible nozzle/AMS combinations are blocked before MQTT instead of becoming printer alarm `1800-8012`. The Bambu queue and relay mappers now require a colour/material match on the same nozzle path whenever the 3MF specifies a nozzle; if the matching tray is on the other path, Flightdeck raises a clear "move filament or re-slice" error and never sends `project_file` to the printer. Queue preflight now shows the same H2D nozzle/AMS block before dispatch. Backend restart required.
  - Verification: `.venv\Scripts\python.exe -m py_compile app\main.py app\printers\bambu.py app\relay.py`, `git diff --check`, a mapper smoke for the exact live mismatch, and a queue preflight smoke passed. The mapper smoke confirmed left-nozzle grey PLA with only AMS HT grey loaded raises `H2D AMS mapping blocked...` instead of returning a tray mapping.
- Stabilized the Bambu queue after BigBoy showed two duplicate `PRINTING` rows for the same file while the real printer was paused on `Failed to get AMS mapping table [1800-8012]`. Starting a queue job now fails any older active rows for that printer, terminal queue states get `finished_at`, printer errors are preserved on failed rows, and `GET /api/queue` reconciles active rows against live printer state so existing ghost rows are cleaned as soon as the queue is loaded after deploy/restart.
- Made Bambu/H2D AMS mapping nozzle-aware. The 3MF parser now reads `project_settings.config` for per-filament nozzle targets and stores them in `filament_colors`; Bambu queue and relay starts carry that through to the AMS mapper. `BambuPrinter.ams_slots()` now annotates live AMS slots with the reported `ams_extruder_map` when present, falling back on the existing H2D rule that normal AMS feeds left and AMS HT feeds right. This prevents a right-nozzle H2D slice from choosing a same-colour normal AMS slot when the correct tray is AMS HT `128`. Backend restart required, then the currently paused printer alarm still needs clearing/cancelling on the H2D before retrying the job.
  - Verification: `.venv\Scripts\python.exe -m py_compile app\db.py app\main.py app\printers\bambu.py app\printers\bambu_ftp.py app\relay.py`, `git diff --check`, a synthetic 3MF parser smoke test, and targeted mapper smokes passed. The mapper smokes confirmed right-nozzle grey PLA chooses tray `[128]` and left-nozzle grey PLA chooses the regular AMS tray. The Windows Python emitted its usual `Could not find platform independent libraries <prefix>` warning but exited successfully.
- Hardened the Browser Orca action after the live Pi still showed `Open Orca failed · Orca /prints mount was not found`. The Browser Orca action is now a real `target="_blank"` link to the configured browser slicer URL, with model handoff attempted separately in the background. If `/prints` injection fails, the browser slicer still opens and the toast reports only the model-handoff failure. Static cache bumped to `app.js?v=478`; frontend refresh required after update.
  - Verification: `.venv\Scripts\python.exe -m py_compile app\main.py app\db.py app\printers\bambu_ftp.py app\printers\moonraker.py`, `node --check app\static\app.js`, `git diff --check`, and source grep for the link-first Browser Orca action passed.
- Fixed Browser Orca handoff behavior for the Pi-control / Windows-browser-slicer setup after `Revised Wheel.stl` planned correctly but browser slicers were not opening. The frontend now opens the Browser Orca URL immediately on the user click, then separately attempts model handoff; if model injection fails, the browser slicer still opens and the toast says the handoff failed. Backend `/api/slicer/open` now prefers forwarding Browser Orca/Docker Orca file opens to the configured worker URL before falling back to a local Pi Docker container, which matches the live split where Flightdeck runs on the Pi and browser slicers/worker live at `100.112.171.88`. Static cache bumped to `app.js?v=477`; backend restart required.
  - Verification: `.venv\Scripts\python.exe -m py_compile app\main.py`, `node --check app\static\app.js`, and `git diff --check` passed. Local browser verification loaded `http://127.0.0.1:8019/?verify=477#/memory` with `app.js?v=477` and no console errors. Live safe plan check for `Revised Wheel.stl` on H2D returned `ready=true`, `manual_handoff=true`, Browser Orca `https://100.112.171.88:3011`, Bambu Studio `https://100.112.171.88:3012`, and worker `http://100.112.171.88:8000`; the live open action was not triggered from this session.
- Continued Flight Recorder with an operator-triggered `Find clip` path. Print detail now shows `Find clip` next to `Add video` when a print has no recorder media. The backend scans bounded Bambu SD/Moonraker media locations for `.mp4`, `.webm`, `.mov`, or `.avi` clips, scores candidates by print filename/subtask and print timing, copies the best match into Flightdeck's `flight_recorder` data folder, attaches it to the print, and logs `flight_recorder_discovered`. It will not attach an unrelated zero-score video. Static cache bumped to `app.js?v=476` and `style.css?v=376`; backend restart required.
  - Verification: `.venv\Scripts\python.exe -m py_compile app\main.py app\db.py app\printers\bambu_ftp.py app\printers\moonraker.py`, `node --check app\static\app.js`, `git diff --check`, and a scorer smoke test passed. The smoke test selected `Working_to_the_Bone_Office_Skeleton.mp4` over unsupported/unrelated files and returned `None` for a lone unrelated video. Local browser verification loaded `http://127.0.0.1:8019/#/memory` with `app.js?v=476` and `style.css?v=376` and reported no console errors. Live printer media discovery still needs Pi-side testing after deploy/restart.
- Fixed the H2D Bambu `Failed to get AMS mapping table` / alarm `1800-8012` start failure. Queue sends and relay starts were still calling the upstream `bambulabs_api` `start_print(...)`, which only sends the legacy flat AMS mapping. Flightdeck already had an H2D-safe MQTT payload builder that includes `ams_mapping2`, but those paths were bypassing it. Both queue and relay starts now call `BambuPrinter.start_uploaded_3mf(...)`, which sends the detailed H2D/AMS HT mapping payload, and `1800-8012` is now translated to the friendly mapping-table message. Backend restart required.
  - Verification: `python -m py_compile app/printers/bambu.py app/relay.py`, `git diff --check`, and a venv smoke test for `_build_bambu_ams_mappings([128])` passed, confirming AMS HT maps as flat `[128]` plus detailed `{"ams_id": 128, "slot_id": 0}`.
- Fixed a false queue preflight block on H2D reprints where a sliced job required Silver (`#C0C0C0`) but the loaded AMS HT spool was the correct Silver PLA Silk spool `#89` with a mid-grey stored hex (`#817e7e`). Queue colour matching now treats only mid neutral grey/silver colours as compatible while still keeping black, white, brown, red, and other colour families separate. The same neutral comparison is used for printer-reported AMS slot checks, so preflight and AMS doctor logic agree. Backend restart required.
  - Verification: `python -m py_compile app/main.py`, `git diff --check`, and a venv smoke test passed. The smoke test confirmed `#817E7E` matches requested `#C0C0C0` with 788g coverage, while black `#1A1A1A` and brown `#703838` do not match Silver.
- Stabilised the live printer right-hand Print Details/Objects rail after the user saw the panel jumping during active prints. Missing print thumbnails are now cached per printer/job after the first failed thumbnail load instead of being inserted and hidden on every poll, which stopped the repeated grow/collapse flicker. The right rail also has fixed overflow containment, stable detail-card minimum heights, grid-based label/value rows, tabular numeric values, and safer value wrapping so ETA/layer/file updates do not resize the panel mid-poll. Static cache bumped to `app.js?v=475` and `style.css?v=375`; frontend refresh only.
  - Verification: `node --check app/static/app.js` and `git diff --check` passed. Browser visual verification was skipped because browser-control tooling was not exposed in this turn; refresh the live page after deploy and confirm the Print Details/Object rail no longer jumps.
- Diagnosed the recurring AMS-HT "Printer reports filament but no Flightdeck spool is assigned" report as a Windows/Pi data split rather than an AMS slot-index bug. Live Pi API correctly showed H2D/BigBoy AMS HT slot `128` assigned to spool `#89` while Windows local API was on the same Git commit but its local `C:\Users\Kidabah\AppData\Local\Flightdeck\flightdeck.db` had no spool `#89` and no AMS-HT assignment. GitHub updates only pull app code and do not sync live inventory/history/settings between Pi and Windows. Added clearer Setup > Version & Updates wording that updates are code-only and live data is host-local; also guarded the Windows tray from spawning another uvicorn server when an existing Flightdeck server is already responding. Static cache bumped to `app.js?v=474`; Windows tray/app restart required for the tray guard and frontend refresh required for the wording.
  - Verification: `python -m py_compile scripts/windows/flightdeck-tray.py app/main.py`, `node --check app/static/app.js`, and `git diff --check` passed. Live checks showed Pi `/api/spools` has `#89` on `h2d:128`, while Windows `/api/spools` has only 85 spools and no `#89`.
- Started Flight Recorder as print-history media. `prints` rows now have `timelapse_path`, `timelapse_source`, and `timelapse_captured_at`; Flightdeck stores uploaded recorder clips under the data directory's `flight_recorder` folder, serves them from `/api/printers/{printer_id}/prints/{print_id}/timelapse`, and allows attaching `.mp4`, `.webm`, `.mov`, or `.avi` clips to a print. Print detail now shows a Flight Recorder card with an embedded video player when a clip exists or an `Add video` upload control when it does not; Print Memory rows get a green `recorder` pill. This is the first safe layer before automatic Bambu SD/Moonraker timelapse harvesting. Static cache bumped to `app.js?v=473` and `style.css?v=374`; backend restart required.
  - Verification: `python -m py_compile app/db.py app/main.py app/printers/bambu.py app/printers/moonraker.py`, `node --check app/static/app.js`, `git diff --check`, and a temp-database smoke test passed. The smoke test created a finished print, attached a fake mp4 under `flight_recorder`, and confirmed `db.get_print_by_id()` reports `has_timelapse` with source `smoke`.
- Added a print-history `Correct` action for wrong spool attribution. In the print detail `Spool usage` section, operators can now move the recorded grams from the incorrectly charged spool to the spool that actually printed the job. The backend restores the moved grams to the original spool, deducts the same grams from the corrected spool, rewrites the print's `spool_usage` row with `corrected_from_spool_id` / `corrected_at`, and logs a `spool_usage_corrected` decision. This is the safe UI path for cases like `spacerv2` being charged to X1C AMS 1/S4 spool `#10` instead of AMS 2/S1 spool `#68`, without hand-editing SQLite. Static cache bumped to `app.js?v=472` and `style.css?v=373`; backend restart required.
  - Verification: `python -m py_compile app/db.py app/main.py app/printers/bambu.py`, `node --check app/static/app.js`, `git diff --check`, and a temp-database correction smoke test passed. The smoke test moved 13.6g from a silver ABS+ spool to a black ABS spool, restored the old spool from 150.0g to 163.6g, deducted the corrected spool from 1000.0g to 986.4g, rewrote the print usage row, and logged `spool_usage_corrected`.
- Tightened live spool deduction attribution after `spacerv2` on X1C was charged to AMS 1/S4 spool `#10` even though the print used AMS 2/S1 black Siddament ABS spool `#68`. The Bambu print-start snapshot had both slots loaded, but the filament matcher normalised `ABS+` down to `ABS` and let colour proximity beat the exact material slot. `_usage_material_score()` now preserves `+` as `plus`, ranks exact material matches before compatible fuzzy matches, and only then uses colour distance, so a sliced `ABS` job prefers an exact `ABS` slot over `ABS+`. Existing finished print history was not silently rewritten; use reconcile or a deliberate DB correction if that specific row should move from `#10` to `#68`. Backend restart required.
  - Verification: `python -m py_compile app/db.py app/main.py app/printers/bambu.py`, `git diff --check`, and a targeted matcher smoke test passed. The smoke test reproduced the live case with silver `ABS+` on slot `3` and black `ABS` on slot `4`; the matcher now selects slot `4` / spool `#68`.
- Added the first pass of Cost per flight. Print history and Print Memory now enrich each `spool_usage` row with estimated dollar cost using the exact assigned spool's material/brand cost where available, then falling back to a material average. Print detail shows a `Cost` line plus per-spool dollar amounts next to grams, and Print Memory rows/summaries include cost totals when enough cost data exists. Costs with a configured `0` value remain treated as pending, so users do not get fake `$0.00` prints. Static cache bumped to `app.js?v=471` and `style.css?v=372`; backend restart required for live Pi/Windows service to serve the enriched API rows.
  - Verification: `python -m py_compile app/db.py app/main.py`, `node --check app/static/app.js`, `git diff --check`, and a temp-database smoke test passed. The smoke test created a PLA/eSUN spool, `$0.042/g` material cost, and a 25g print usage row; `db.get_prints_for_day()` returned `total_cost=1.05` and spool row `cost=1.05`. In-app browser verification loaded `http://127.0.0.1:8000/#/memory` with `app.js?v=471` and `style.css?v=372`, rendered Print Memory, and reported no console errors.
- Windows install now reduces browser-slicer setup friction. `scripts/windows/bootstrap-install.ps1` accepts `-BrowserSlicers auto|yes|no` (default `auto`) plus `-InstallDockerDesktop`. During install it pre-fills Browser Orca/Bambu Studio URLs in Flightdeck settings, then starts/repairs the browser OrcaSlicer and Bambu Studio containers automatically if Docker Desktop is already present. If the operator explicitly asks for browser slicers with `-BrowserSlicers yes`, the bootstrap installs Docker Desktop through `winget` when Docker is missing. If Docker is missing in the default auto path, install still completes and tells the user to run `Start-Flightdeck-Slicers-Windows.cmd` later. `scripts/windows/install-windows.ps1` now has `-ConfigureBrowserSlicerSettings` so fresh Windows installs default to manual slicer review with `https://127.0.0.1:3011` and `https://127.0.0.1:3012` ready. The slicer repair helper also saves those URL/login settings when the local Flightdeck venv exists, and it has `-InstallDockerDesktop` for later repair/setup. `INSTALL.md` and `README.md` document the easier install flow.
  - Verification: PowerShell parser checks passed for the changed Windows scripts; `powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\windows\bootstrap-install.ps1 -BrowserSlicers no -NoStartup -NoDesktopShortcut -Port 8017` completed against the existing checkout without creating startup/desktop shortcuts; the temporary `8017` server was stopped and local `.env` restored to port `8000`; `powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\windows\start-slicer-browsers.ps1 -CheckOnly` reported both browser slicers running; the normal helper path verified both URLs, saved Flightdeck slicer settings, and `/api/settings` showed `https://127.0.0.1:3011` plus `https://127.0.0.1:3012`; `git diff --check` passed.
- Added a Windows helper for the browser slicers proven during live testing. `Start-Flightdeck-Slicers-Windows.cmd` wraps `scripts/windows/start-slicer-browsers.ps1`, which starts Docker Desktop if needed and creates/starts `flightdeck-orcaslicer` on `https://127.0.0.1:3011` plus `flightdeck-bambustudio` on `https://127.0.0.1:3012` using Windows-safe mounts: `%LOCALAPPDATA%\Flightdeck\orcaslicer` or `bambustudio` -> `/config`, and `%LOCALAPPDATA%\Flightdeck\print_library` -> `/prints`. Added `-CheckOnly`, `-OrcaOnly`, `-BambuOnly`, and `-Force` repair options, then documented the Windows helper in `INSTALL.md` and `README.md` so users do not try the NAS compose file on Windows.
  - Verification: `powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\windows\start-slicer-browsers.ps1 -CheckOnly` reported both existing containers running; the normal helper path kept the existing Orca/Bambu containers running and verified `https://127.0.0.1:3011` plus `https://127.0.0.1:3012` with HTTP 200; `git diff --check` passed.
- Windows Bambu Studio Docker sidecar was started manually for live testing after Docker Desktop had been stopped. Docker Desktop was launched, then `flightdeck-bambustudio` was started from `lscr.io/linuxserver/bambustudio:latest` with Windows-safe mounts: `%LOCALAPPDATA%\Flightdeck\bambustudio` -> `/config` and `%LOCALAPPDATA%\Flightdeck\print_library` -> `/prints`, publishing `https://100.112.171.88:3012`. Raw curl with `flightdeck:flightdeck` and Flightdeck's `/api/slicer/check` both returned HTTP 200. No code change required for this operational note.
  - Verification: `docker ps` showed `flightdeck-bambustudio`, `flightdeck-orcaslicer`, and `orca-slicer-api` running; `curl.exe -k -u flightdeck:flightdeck https://100.112.171.88:3012/` returned HTTP 200; `/api/slicer/check` returned `ok: true`.
- Bambu Studio browser handoff now has the missing Docker sidecar wiring. `docker-compose.nas.yml` adds `flightdeck-bambustudio` using `lscr.io/linuxserver/bambustudio:latest`, publishes HTTPS port `3012`, sets `shm_size: "1gb"`, persists config at `/volume2/flightdeck-bambustudio`, and mounts the Print Vault at `/prints`. `.env.nas.example` adds Bambu Studio credentials. Settings > Slicer now derives a Bambu Studio URL from the Browser Orca host on port `3012` when the Bambu Studio URL field is blank, so an Orca host like `https://100.112.171.88:3011` becomes `https://100.112.171.88:3012` for Bambu Studio. README documents the paired Orca/Bambu URLs and x86-64 Docker-host caveat. Static cache bumped to `app.js?v=470`; frontend refresh plus Docker compose update required.
  - Verification: `node --check app/static/app.js`, structural grep for the `bambustudio` compose service/port, and `git diff --check` passed. PyYAML was unavailable in this Windows Python, so a full YAML parse was not run. Live curl probes before starting the new service showed nothing listening on `127.0.0.1:3012` or `100.112.171.88:3012`, as expected.
- Slice Model `Prepare slice` no longer silently rewrites the saved `slicer_open_mode` preference. The workflow dropdown remains the only place that persists the user's open-mode/API preference; Prepare now just plans the selected workflow for the current modal. This prevents Headless auto slice from resetting a saved Browser Orca/Bambu handoff preference back to Desktop Orca. Static cache bumped to `app.js?v=469`; frontend refresh only.
  - Verification: `node --check app/static/app.js` and `git diff --check` passed.
- Settings > Slicer OrcaSlicer Integration controls now use a dedicated responsive field grid instead of one long alternating label/input row. This fixes the collapsed tiny controls and sideways overflow seen on Windows for Open in Slicer, Use Slicer API, Browser Orca URL, Bambu Studio URL, browser credentials, Slicer API URL, and Worker URL. Static cache bumped to `app.js?v=468` and `style.css?v=371`; frontend refresh only.
  - Verification: `node --check app/static/app.js` and `git diff --check` passed.
- Bambu Studio manual slice handoff now behaves like the selected workflow instead of only showing a download. When `Open in Bambu Studio` is selected and the Bambu Studio URL is configured, `Prepare slice` attempts to open Bambu Studio automatically, shows `Open Bambu Studio` as the first action, and keeps `Download model for import` as the fallback. If no Bambu Studio URL is configured, the panel shows a disabled `Open Bambu Studio unavailable` action with a tooltip. Static cache bumped to `app.js?v=467`; frontend refresh only. Current limitation: Flightdeck can open Bambu Studio, but does not yet have a reliable Bambu Studio import API/URI to place the model on the plate automatically.
  - Verification: `node --check app/static/app.js` passed.
- Headless auto slice now shows an explicit blocked state when the selected job cannot currently be sliced in Flightdeck. Live test on `Working to the Bone - Office Skeleton.stl` for H2D showed the slicer API sidecar on port 3003 was unreachable, so the modal now says `Headless auto slice blocked`, keeps a disabled `Slice in Flightdeck blocked` button with the reason, and still offers the manual download/open fallback. This fixes the confusing case where the user selected Headless auto slice but saw only manual Orca actions. Static cache bumped to `app.js?v=466`; frontend refresh only.
  - Verification: `node --check app/static/app.js` passed. Direct probes showed Windows worker `/api/slicer/worker/status` is available but `http://100.112.171.88:3003/health` refuses connections.
- Slice Model now starts with the actual workflow choice the user described: `Headless auto slice`, `Open in Desktop Orca`, `Open in Browser Orca`, or `Open in Bambu Studio`. Headless auto slice enables the support/brim controls and saves `slicer_use_api=true` before planning, so the generated output bakes in selected profiles/supports/brims/plate settings. Manual Orca/Bambu choices save `slicer_use_api=false`, dim the support/brim controls, and show handoff/download actions for painted supports, manual supports, orientation tweaks, or final slicer inspection. Static cache bumped to `app.js?v=465`; frontend refresh only.
  - Verification: `node --check app/static/app.js` and `git diff --check` passed. Browser click-through was skipped because the in-app browser control tool was not available in this resumed tool set.
- Desktop Orca source-model handoff now opens files through the Windows file association first before falling back to launching the Orca executable directly. This should behave like double-clicking the STL/3MF and is intended to fix the blank Orca window where the desktop app opened but did not load the selected model. The Slice Model modal now disables/dims the support and brim controls when Flightdeck background slicing is not enabled or Bambu Studio handoff is selected, and it explicitly says manual Desktop Orca/Bambu handoff opens the raw model so supports/brim must be set in the slicer before exporting. Static cache bumped to `app.js?v=464` and `style.css?v=370`; backend restart required.
  - Verification: `python -m py_compile app/main.py`, `node --check app/static/app.js`, and `git diff --check` passed.
- Desktop Orca handoff now prefers the configured Windows worker before attempting a local Pi Orca launch. This fixes the blank-plate case where the Pi opened a local/remote Orca shell but did not pass the model into the user's real desktop Orca session. The modal toast now reports forwarded worker opens first. Static cache bumped to `app.js?v=463`; backend restart required.
  - Verification: `python -m py_compile app/main.py`, `node --check app/static/app.js`, and `git diff --check` passed.
- Bambu Studio handoff in the Slice Model modal is now manual-only while the Orca/background slicing path is parked. When `Open in slicer` is set to `Bambu Studio handoff`, Flightdeck no longer shows `Slice in Flightdeck` or Orca open actions; it offers the Bambu Studio Docker link when configured plus the source download/import handoff for desktop Bambu Studio. Static cache bumped to `app.js?v=462`; frontend refresh only.
  - Verification: `node --check app/static/app.js` and `git diff --check` passed.
- Added Steve's live spool deduction idea. Flightdeck now deducts filament from the print-start spool snapshot at 10% progress checkpoints while a print is running, reserves the final 10% until the printer reports FINISHED, and uses the existing finish deduction as an idempotent top-up to 100% rather than a second full deduction. Bambu uses active AMS tray plus 3MF preview filament usage when available; Klipper/Moonraker uses the existing slicer metadata filament weight. Repeated polling and backend restarts do not double-deduct because `prints.spool_usage` is treated as the recorded target so far. Bambu preview metadata is now cleared at job boundaries to avoid carrying one job's filament weight into the next job. Backend restart required.
  - Verification: `python -m py_compile app/db.py app/printers/bambu.py app/printers/moonraker.py`, temp-database smoke test for 10%/repeat/20%/90%/finish idempotent deduction, and `git diff --check` passed.
- Guarded the Bambu preview metadata cache after Steve hit `'object' object has no attribute 'filament_weight_g'` on an H2D printer card. If Bambu FTP preview/3MF metadata fetch fails, Flightdeck stores a retry sentinel; the print-finish path now treats that sentinel as metadata unavailable instead of trying to read filament weight from it. This prevents the printer card from surfacing a backend exception and allows the job state to continue resolving without preview-derived spool deduction data. Backend restart required.
  - Verification: `python -m py_compile app/printers/bambu.py` and `git diff --check` passed.
- Split the Slice Model handoff targets so `Open in Orca` no longer silently means the managed Docker/browser Orca. `Desktop OrcaSlicer` is now the default/manual open mode and `/api/slicer/open` launches the installed OrcaSlicer executable on the current host or forwards the model bytes to the configured Windows worker, preserving the user's real desktop printer/AMS setup. Browser Orca remains available only when explicitly selected. Added a first-pass `bambustudio_docker_url` setting and Settings > Slicer panel for browser-based Bambu Studio, plus `Bambu Studio Docker` as a modal handoff target that opens Bambu Studio and keeps the model download/import flow visible for Bambu-first review. Static cache bumped to `app.js?v=461`; backend restart required.
  - Verification: `python -m py_compile app/main.py app/db.py`, `node --check app/static/app.js`, and `git diff --check` passed.
- Slice Model modal now visibly shows the slicer handoff controls before the operator clicks Prepare. Added a Flightdeck-style plan panel with `Manual slicer review` / `API slicing enabled` status copy, an `Open in slicer` dropdown with `Browser OrcaSlicer` and `Bambu Studio handoff`, plus a disabled first-pass `Slicer bundle` row (`None - pick profiles individually`) to match the direction of the Bambuddy-style flow. Changing the modal dropdown saves `slicer_open_mode`, clears stale prepared actions, and the modal later uses that mode for Bambu Studio vs Orca handoff buttons. Static cache bumped to `app.js?v=460`; frontend refresh only.
  - Verification: `node --check app/static/app.js` and `git diff --check` passed.
- Settings > Slicer now has a Flightdeck-style manual-first slicer control surface inspired by the useful Bambuddy flow without copying their skin. Added durable `slicer_use_api` and `slicer_open_mode` settings: `Use Slicer API` defaults off, so `/api/slicer/plan` continues to hand off source models for manual Orca/Bambu review, while turning it on deliberately re-enables the background-slice offer when the worker/API/local slicer path is healthy. Added an `Open in Slicer` selector (`Same as API slicer`, `Browser OrcaSlicer`, `Bambu Studio handoff`), a warning banner about known Orca CLI/API risks, and clearer `Slicer Bundles & Profiles` copy for Orca JSON/ZIP and Bambu Studio `.bbscfg` uploads. The Slice Model modal now reflects the handoff mode: Orca mode can open the model in Browser Orca, while Bambu Studio mode steers operators to download/import manually instead of pretending to open Bambu Studio. Static cache bumped to `app.js?v=459`; backend restart required for the new defaults and plan gating. User also spotted that Bambuddy appears to include SpoolBuddy API hooks, which is worth revisiting for future inventory/profile integration.
  - Verification: `python -m py_compile app/main.py app/db.py`, `node --check app/static/app.js`, and `git diff --check` passed. Browser visual verification was skipped because the in-app browser control tool was not exposed in this turn.
- In-Flightdeck background slicing is intentionally paused in the operator UI while the managed Orca Docker printer/AMS workflow is validated. `/api/slicer/plan` now returns `can_background_slice=false`, `background_slice_paused=true`, and a manual-review message for source models with valid profiles. The Slice Model modal now shows `Manual Orca review`, explains that operators should open the model in Orca, confirm printer/AMS/supports, and export the sliced job back to the Print Vault, and no longer shows the tempting `Slice in Flightdeck` button. The backend `/api/slicer/run` remains in place for diagnostics/developer testing, including feature-count reporting from the previous change. Static cache bumped to `app.js?v=458`; backend restart required for the plan response.
  - Verification: `python -m py_compile app/main.py app/db.py`, `node --check app/static/app.js`, and `git diff --check` passed.
- Browser Orca launch and sliced-output trust cleanup: Settings > Slicer now has Browser Orca username/password fields, defaulting to `flightdeck` / `flightdeck` for the managed Docker container. Open/Test Browser Orca links launch with those credentials embedded in the browser URL while the saved base URL stays clean. The Slice Model modal now labels pre-slice handoff as `Open raw model in Orca`, keeps post-slice `Open sliced in Orca`, and explains that support/brim toggles apply to Flightdeck slicing while a raw Orca Prepare view uses Orca's current defaults. `/api/slicer/run` now counts generated G-code feature sections in the sliced output and returns `feature_counts`; the success panel reports detected support/brim paths so operators can confirm the actual generated file. Static cache bumped to `app.js?v=457`; backend restart required for the new settings defaults and feature-count response.
  - Verification: `python -m py_compile app/main.py app/db.py`, `node --check app/static/app.js`, `git diff --check`, and venv smoke test against `result_20260611120411.3mf` passed. The smoke test found `Support=415`, `Support interface=130`, and `Brim=0`, confirming the user's H2D skeleton slice was generated with supports and no brim, matching the modal selections.
- Slicer support/brim live diagnostic: the Pi was current at `3e364d1`, but the Windows worker at `http://127.0.0.1:8000` was still on `3f1bbee`, so H2D STL slices forwarded from the Pi could ignore the new support/brim toggle backend even while the Pi UI looked current. The Windows worker checkout at `C:\Users\Kidabah\flightdeck` was updated to `3e364d1` and the worker was restarted. A controlled Flightdeck slice of `Working to the Bone - Office Skeleton.stl` with `Tree auto` + `Outer brim` produced `result_20260611115530.3mf`; comparing it to the manual Orca result `result_20260611113748.3mf` showed matching embedded settings (`enable_support=1`, `support_type=tree(auto)`, `support_style=default`, `brim_type=outer_only`) and matching G-code feature counts (`FEATURE: Support` 415, `FEATURE: Support interface` 130). No app code change from this diagnostic note.
  - Verification: Windows `/api/update/status?check_remote=true` reports commit `3e364d1`, dirty false, behind false; direct `/api/slicer/run` returned `slice_options` `Tree auto` / `Outer brim`; 3MF zip inspection confirmed the generated G-code contains support features.
- Slice Model support/brim controls are now explicit toggles instead of profile-default dropdowns. `Enable supports` gates the support type dropdown (`Normal auto`, `Tree auto`, `Tree strong`) and sends `support_mode=off` when unchecked; `Enable brim` gates the brim type dropdown (`Auto brim`, `Outer brim`, `Mouse ears`) and sends `brim_mode=off` when unchecked. The backend now writes Orca's actual process-profile flags (`enable_support`, `support_type`, `support_style`, `enable_brim`, `brim_type`, including `brim_ears` for mouse ears) so the selected options actually apply during slicing. Demo mode echoes the selected support/brim choices instead of always showing profile default. Static cache bumped to `app.js?v=456`, `style.css?v=369`, and `demo-runtime.js?v=8`; backend restart required.
  - Verification: `python -m py_compile app/main.py`, `node --check app/static/app.js`, `node --check app/static/demo-runtime.js`, `git diff --check`, and venv smoke test for support/brim process-profile overrides passed.
- Printed Brother QL-700 spool labels now use a compact default layout on the normal Pi/Brother path as well as any future Windows queue path. The rendered label height drops from 696x430 to 696x330 pixels while keeping material, brand, colour, hex, spool ID, label weight/date, location, and QR. Set `FLIGHTDECK_LABEL_COMPACT=false` to temporarily use the old taller layout. Backend restart required.
  - Verification: compact sample rendered at 696x330, `python -m py_compile app/label_printer.py`, and `git diff --check` passed.
- Label-printer detection now handles the common Windows case where the Brother QL-700 is actually plugged into the Pi/NAS, not the Windows worker. If `lsusb` is missing, Flightdeck falls back to PyUSB detection and reports a plain setup message about using WinUSB/libusb on Windows or connecting the label printer to the Pi/NAS instead of surfacing raw `[WinError 2] The system cannot find the file specified`.
  - Verification: `python -m py_compile app/label_printer.py`, `git diff --check`, and venv smoke test for Windows-style status messaging passed.
- Ported only the useful label-size idea from Steve's fork: Klipper/Bambu no-geometry skip-object fallback buttons now use compact, left-aligned label tiles with a smaller ID/header and a second object-name line when an object ID exists. Real mapped object overlays were left unchanged. Static cache bumped to `app.js?v=455` and `style.css?v=368`; frontend refresh only.
  - Verification: `node --check app/static/app.js` and `git diff --check` passed.
- Spool cards now have an `Assign` quick action. The modal lets an operator move the roll to a shelf/home, assign it to a printer-only location, or assign it directly to a printer AMS/MMU/tool slot using grouped dropdown options built from the current fleet state. Assigning to an occupied printer/slot uses the existing replace flow so the previous roll returns home. Static cache bumped to `app.js?v=454` and `style.css?v=367`; frontend refresh only.
  - Verification: `node --check app/static/app.js` and `git diff --check` passed.
- Add Printer now presents Moonraker-backed printers as plain `Klipper` instead of `Voron / Klipper` or `Other Moonraker`. The Klipper model dropdown now includes common Voron, Rat Rig, Sovol, Qidi, FLSUN, VzBot, Annex, RailCore, HevORT, Creality K1, Elegoo Neptune 4, and Custom Klipper presets, with build-volume defaults for the listed models. Static cache bumped to `app.js?v=453`; frontend refresh only.
  - Verification: `node --check app/static/app.js` and `git diff --check` passed.
- Klipper no-geometry object selector font was reduced so long object-name pills read like compact labels instead of large headline buttons. Static cache bumped to `style.css?v=366`; frontend refresh only.
  - Verification: `node --check app/static/app.js` and `git diff --check` passed.
- Klipper exclude-object panels no longer let long STEP-derived object names overflow the printer detail card. When no bed geometry is available, the empty striped map is hidden and the fallback object selector uses wider responsive tiles with ellipsised labels/tooltips, so names like `BOV plates jigs.step` stay contained. Bambu's no-object empty state now tells operators to enable `Label objects` and `Exclude objects` in Orca/Bambu Studio, then reslice/send the job. Static cache bumped to `style.css?v=365`; backend restart required for the clearer Bambu message.
  - Verification: `python -m py_compile app/printers/bambu.py`, `node --check app/static/app.js`, and `git diff --check` passed.
- Public GitHub Pages website copy was tightened so Flightdeck is positioned as a local-first 3D print-farm control tower rather than a generic inventory app. The `docs/` landing page now leads with mixed-fleet operations, local-first/open-source positioning, Flightdeck-specific feature cards, real screenshot sections, a shop-floor systems grid, install links for Pi/Windows, a ready-to-post Facebook share block, Ko-fi support, and stronger social metadata. Added `.github/workflows/pages.yml` to publish `docs/` with GitHub Pages when Pages is enabled for the repo. No app runtime changes.
  - Verification: local `docs/` preview served HTTP 200 on port 8787, local asset-reference check passed, non-ASCII scan passed, and `git diff --check` passed.
- Slice Model `Open Orca` is now a real file handoff instead of only opening the remote desktop. New `/api/slicer/open` and `/api/slicer/worker/open` endpoints import/copy the selected source or sliced output into the shared Print Vault, then run `/opt/orcaslicer/bin/orca-slicer /prints/...` inside the `flightdeck-orcaslicer` container. If the Pi does not have the Orca container locally, it forwards the model bytes to the configured Windows worker URL so Windows opens the file in its managed Orca container. The slice modal now labels the actions as `Open model in Orca` before slicing and `Open sliced in Orca` after slicing. Static cache bumped to `app.js?v=452`; backend restart required.
  - Verification: `python -m py_compile app/main.py`, `node --check app/static/app.js`, `git diff --check`, and a direct helper smoke test opening `/prints/bedscraper.stl` in the local Windows `flightdeck-orcaslicer` container passed.
- Managed Docker Orca now suppresses Orca's own beta update prompt. Flightdeck locates the container `/config` mount, sets Orca's `check_stable_update_only` preference to true, removes downloaded beta Windows installers from the Orca Downloads folder, and runs that cleanup during Docker Orca status/restart/update. The Slicer panel now reports `Internal Orca updater: stable releases only`. The live Windows Orca container was restarted after the cleanup. Static cache remains `app.js?v=452`; backend restart required.
  - Verification: `python -m py_compile app/main.py`, `node --check app/static/app.js`, `git diff --check`, direct `_suppress_orca_internal_update_prompt()` smoke test, and `docker ps` confirmed `flightdeck-orcaslicer` running on `3011->3001/tcp`.
- Browser Orca launch URLs now force HTTPS on port `3011`. This fixes the `400 Bad Request: The plain HTTP request was sent to HTTPS port` page when clicking `Open Orca` from Settings or the Slice Model dialog. The Browser Orca default URL now uses `https://`, saving the Browser Orca URL normalises `http://...:3011` to `https://...:3011`, and Test Browser Orca uses the same launch-normalised URL. Static cache bumped to `app.js?v=451`; frontend refresh only.
  - Verification: `node --check app/static/app.js`, `git diff --check`, and a Node URL-normalisation smoke test passed.
- Managed Docker Orca status now handles the real Pi + Windows split-brain setup. If the Browser Orca/Worker URL points at another host and the current Flightdeck host has Docker but no local `flightdeck-orcaslicer`/`orca-slicer-api` containers, the Slicer panel now says `Remote Orca configured` and disables local Restart/Update instead of showing both containers as missing. Static cache bumped to `app.js?v=450` and `style.css?v=364`; frontend refresh only.
  - Verification: `node --check app/static/app.js` and `git diff --check` passed.
- Slicer settings now include a managed Docker Orca panel so operators update Orca from Flightdeck instead of clicking the update prompt inside the remote Orca desktop. New backend endpoints report Docker/Orca container status, restart the browser Orca/API sidecar containers, and update the browser Orca container by pulling `lscr.io/linuxserver/orcaslicer:latest`, recreating `flightdeck-orcaslicer` with its existing env/mounts/ports/restart policy, and leaving a stopped rollback copy. The API sidecar is shown/restartable but not image-updated because it is a custom local `flightdeck-orca-slicer-api:orca2.4.0-alpha` image. Static cache bumped to `app.js?v=449` and `style.css?v=363`; backend restart required.
  - Verification: `python -m py_compile app/main.py`, `node --check app/static/app.js`, `git diff --check`, direct `_orca_docker_status()` smoke test against Windows Docker, and browser check on local Settings > Slicer all passed. Browser check confirmed Docker 29.5.3, `flightdeck-orcaslicer` running on `3011->3001/tcp` with managed update, and `orca-slicer-api` running/healthy on `3003->3000/tcp`.
- Slice Model now shows an active slicing progress state instead of sitting silently while `/api/slicer/run` works. After `Slice in Flightdeck`, the modal disables the slice inputs, shows staged progress text with elapsed time, an animated progress bar, and keeps an `Open Orca` action available when the browser slicer URL is configured. Success still swaps to the preview/`Queue sliced job` panel, now with `Open Orca`; failures keep the modal open with `Try again` and `Open Orca`. Static cache bumped to `app.js?v=448` and `style.css?v=362`; frontend refresh only.
  - Verification: `node --check app/static/app.js` and `git diff --check` passed.
- Update blocking now ignores generated runtime/log clutter while still protecting real local edits. The web updater and Windows tray updater both ignore `00000.log`, numeric Orca-style root logs, and files under `logs/`, `tmp/`, or `temp/` when deciding whether a checkout is dirty. If a genuine tracked/untracked source file is blocking an update, `/api/update/status` returns `dirty_entries`, `/api/update` includes the first blockers in the 409 detail, and the Setup page keeps that blocker list visible instead of only flashing a toast. Static cache bumped to `app.js?v=447`; backend restart required.
  - Verification: `python -m py_compile app/main.py scripts/windows/flightdeck-tray.py`, `node --check app/static/app.js`, and `git diff --check` passed. A direct tray helper smoke import was not used because this Codex Python lacks `pystray`, but the tray script compiles cleanly.
- Windows tray can now supervise a slicer API sidecar at login. If `.env` contains `FLIGHTDECK_SLICER_SIDECAR_CMD`, the tray starts that command alongside Flightdeck, probes `FLIGHTDECK_SLICER_SIDECAR_URL` (default `http://127.0.0.1:3003`) at `/health`, restarts the sidecar if its process exits, writes logs to `%LOCALAPPDATA%\Flightdeck\logs\slicer-sidecar.log`, and adds Restart/Stop slicer sidecar menu items. Added `scripts/windows/configure-slicer-sidecar.ps1` so users can set the command/URL without hand-editing `.env`, and `install-windows.ps1` now accepts `-SlicerSidecarCommand` / `-SlicerSidecarUrl` for fresh installs. `INSTALL.md` documents the flow.
  - Verification: `python -m py_compile scripts/windows/flightdeck-tray.py`, PowerShell AST parse for `scripts/windows/install-windows.ps1` and `scripts/windows/configure-slicer-sidecar.ps1`, quoted sidecar command parsing smoke test, and `git diff --check` passed. Windows users must restart the Flightdeck tray process or log out/in after configuring the sidecar command.
- Added slicer API sidecar visibility for the H2D STL path after the user still saw a raw `failed to slice CLI` style error. Flightdeck now probes `{orcaslicer_api_url}/health` and exposes `Slicer API sidecar` as an optional Setup Health check. The Slice Model plan for H2D STL/OBJ now pings the sidecar instead of only checking whether the URL field has text; if it is missing/unreachable, the dialog tells the operator to use Open Orca until the sidecar is online. If the sidecar is reachable but still returns a generic H2D loose-mesh CLI failure, Flightdeck now says that clearly and preserves the raw slicer detail, so we can distinguish "sidecar asleep" from "sidecar awake but Orca rejected this H2D STL".
  - Verification: `python -m py_compile app/main.py`, `_probe_slicer_api` smoke test for not configured/unreachable, H2D loose-mesh helper smoke test, and `git diff --check` passed. Backend restart required.
- Ported the useful Bambuddy slicer lesson into Flightdeck's Orca profile handoff. Bambuddy's resolver documents that missing profile JSON `type` fields (`machine`/`process`/`filament`) can make Orca/Bambu surface useless generic slice failures, so Flightdeck now normalises those fields for both sidecar-uploaded profiles and local CLI temp profile files before slicing. This keeps support/brim overrides intact while making profile payloads match the slicer's slot expectations. Bambuddy also confirmed loose STL/OBJ has no embedded settings fallback, so H2D loose-mesh slicing is now treated as sidecar-required instead of silently falling back to local Orca: the plan endpoint offers manual handoff/Open Orca when no sidecar API is configured, `/api/slicer/run` rejects immediately with a clear sidecar-required message, and the Windows worker no longer falls back to local Orca for H2D STL/OBJ after a sidecar 502.
  - Verification: `python -m py_compile app/main.py`, profile-type helper smoke test, `git diff --check`, exact Downloads skeleton STL still fails on H2D local CLI with the friendly sidecar-required message, and the same skeleton STL still slices successfully as X1C through local Orca. Backend restart required.
- Investigated live failure slicing `Working to the Bone - Office Skeleton.stl`. STL slicing itself works: the exact Downloads STL sliced successfully through local Orca as X1C and produced a 21 MB `.gcode.3mf`. The failure is specific to local Orca CLI + H2D loose STL profiles: H2D dies at the actual `--slice` step with only `Slic3r::CLI::run found error, exit`, while X1C succeeds. Flightdeck now turns that vague Orca line into a truthful error: local Orca can slice the STL for single-toolhead printers, but this Orca build rejects the H2D loose STL slice profile; use Open Orca or start the Orca slicer API sidecar for that H2D STL until a proper H2D CLI workaround is found. Backend restart required.
  - Verification: `python -m py_compile app/main.py`, local venv reproduction of the H2D skeleton failure now returns the new friendly message, and `git diff --check` passed.
- Slice Model now shows a practical first-pass preview after `Slice in Flightdeck` succeeds. `/api/slicer/run` returns a `preview_url` for generated `.gcode.3mf` outputs, backed by new `GET /api/files/source/preview`, which reads the embedded 3MF thumbnail/top preview from the Print Vault file. The ready panel now shows that thumbnail above `Queue sliced job` and `Check vault`, with a quiet `Preview unavailable` state if the slicer did not embed an image. Demo mode now exercises the same ready/preview path. Static cache bumped to `app.js?v=446`, `style.css?v=361`, and `demo-runtime.js?v=7`; backend restart required.
  - Verification: `python -m py_compile app/main.py`, `node --check app/static/app.js`, `node --check app/static/demo-runtime.js`, and `git diff --check` passed.
- Slice Model next-stage flow started. The slice dialog now selects a target printer first, then shows per-slice profile dropdown/search inputs for Printer/nozzle, Process/layer, and Filament/profile, followed by Plate type, Supports, and Brim. These profile choices default from the selected printer's saved slicer defaults but can be changed for the current slice only. `/api/slicer/plan` and `/api/slicer/run` now accept optional `printer_profile`, `process_profile`, and `filament_profile` overrides. After `Slice in Flightdeck` succeeds, the modal stays open and flips to a blue `Queue sliced job` action for the generated Print Vault output instead of closing/flashing the vault list. Static cache bumped to `app.js?v=445` and `style.css?v=360`; backend restart required.
  - Verification: `python -m py_compile app/main.py`, `node --check app/static/app.js`, and `git diff --check` passed.
- Slicer worker fallback fixed after live test showed `Slicer API unreachable: [WinError 10061]` when `orcaslicer_api_url` on port 3003 was configured but not running. The Windows worker on port 8000 was healthy and had Orca available, but `/api/slicer/worker/slice` tried the sidecar first and failed immediately. Worker slicing now catches sidecar/API 502 connection failures and falls back to local Orca with the same plate/support/brim options.
  - Verification: `python -m py_compile app/main.py`, `node --check app/static/app.js`, venv smoke test for support/brim override labels, and `git diff --check` passed. The Pi updater pulled `748ca9d` and reported `restart_required: true`. The Windows worker checkout at `C:\Users\Kidabah\flightdeck` was also fast-forwarded to `748ca9d`, duplicate uvicorn workers were stopped, and a fresh worker started on port 8000. `http://100.112.171.88:8000/api/slicer/worker/status` reports Orca available; `http://100.112.171.88:3003/health` still refuses connections, so worker local-Orca fallback is the active path until the sidecar API is started again.
- Slice Model now has Supports and Brim dropdowns alongside Plate type. Defaults are profile-safe (`Profile default`), with support overrides for off, normal auto, tree auto, and tree strong, plus brim overrides for no brim and outer brim. The selected options are shown in the slice handoff panel, sent through `/api/slicer/plan`, `/api/slicer/run`, and `/api/slicer/worker/slice`, and applied by patching the Orca process profile JSON before handing it to the sidecar API or local Orca worker. Static cache bumped to `app.js?v=444`; backend restart required.
  - Verification: `python -m py_compile app/main.py`, `node --check app/static/app.js`, `node --check app/static/demo-runtime.js`, venv smoke test for support/brim process-profile overrides, and `git diff --check` passed. Next useful slicer feature idea from the user: after `Slice in Flightdeck`, preview the actual sliced output on the build plate, including generated supports/brims/toolpaths, with rotate/zoom plus `Open in Orca`, `Send to printer`, and `Queue` actions. This should be built from the generated `.gcode.3mf`/G-code rather than the unsliced source model so supports/brims are real.
- Camera feed status badges were softened after live review. They now sit in the bottom-right like a TV-style watermark, with smaller type, lower opacity, a lighter translucent background, and a slightly stronger warning treatment only for stale/reconnecting states. Static cache bumped to `style.css?v=359`; frontend refresh only.
  - Verification: `node --check app/static/app.js` and `git diff --check` passed. Live browser reload confirmed `style.css?v=359`, bottom-right placement, 8.8px text, 0.58 opacity, and translucent background on Fleet Wall.
- Camera feeds now get a small status pill overlay so black/waiting feeds are less mysterious. Live/Print Watch/Fleet Wall camera images show `Opening stream`, `Stream live`, `Waiting for frame`, `Frame now`, `Refreshing frame`, `Frame stale`, or `Reconnecting` depending on browser image load/retry state. Fleet Wall still-refresh feeds report real frame age; continuous MJPEG streams report stream state because the browser image element does not expose every individual MJPEG frame. Static cache bumped to `app.js?v=443` and `style.css?v=358`; frontend refresh only.
  - Verification: `node --check app/static/app.js` and `git diff --check` passed. Live browser check on the Pi confirmed Fleet Wall served `app.js?v=443`/`style.css?v=358` and showed three camera images with `Frame now` status badges.
- The normal Add Printer picker no longer shows the Simulated option now that demo mode lives separately. Underlying simulated support remains for demo/dev fixtures, but user-facing setup offers Bambu, Voron/Klipper, Snapmaker, and Other Moonraker. The first-run Add Printer copy was updated accordingly.
  - Verification: `node --check app/static/app.js` and `git diff --check` passed. Live browser check confirmed only Bambu, Voron/Klipper, Snapmaker, and Other Moonraker are visible/options in Add Printer.
- Add Printer now shows printer type as compact icon cards instead of a plain protocol dropdown. Bambu, Voron/Klipper, Snapmaker, Other Moonraker, and Simulated each show the same printer-family icon language used elsewhere, while the native select remains in place behind the picker for accessibility/fallback. Static cache bumped to `app.js?v=442` and `style.css?v=357`; frontend refresh only.
  - Verification: `node --check app/static/app.js` and `git diff --check` passed. Live browser check on the Pi confirmed five icon buttons with SVGs, Bambu active by default, and `app.js?v=442` plus `style.css?v=357` served.
- Add Printer layout was compacted so setup fits much better on one screen. The form now uses a 3-column desktop grid, short field blocks for internal ID/name/host/access/serial/camera values, and the temperature presets sit alongside the main connection fields instead of as a full-width section. Mobile still stacks to one column. Static cache bumped to `app.js?v=441` and `style.css?v=356`; frontend refresh only.
  - Verification: `node --check app/static/app.js` and `git diff --check` passed. Browser check on live Settings > Printers showed a 3-column Add Printer form about 455px tall with temp presets alongside the connection fields.
- LAN Scan now tries Bambu SSDP discovery on UDP 2021 before falling back to the existing port 8883 probe. When a Bambu printer advertises itself, scan results include the printer serial, model, and device name, and clicking `Use` pre-fills the serial field. The access code still cannot be discovered safely; Bambu treats it as the local LAN password, so the operator still enters it from the printer screen. Static cache bumped to `app.js?v=440`; backend restart required for the SSDP scanner.
  - Verification: `python -m py_compile app/main.py`, `node --check app/static/app.js`, SSDP parser smoke test, and `git diff --check` passed.
- AMS/AMS-HT Trust Flightdeck command aligned with the Bambuddy/Bambu Studio protocol shape. Bambuddy confirms AMS-HT uses `ams_id >= 128` with local `tray_id=0`, so Flightdeck's HT slot mapping was basically right. The fix is the command shape and flow: `ams_filament_setting` now includes `slot_id`, `sequence_id`, and derived `setting_id` where possible, and explicit Trust Flightdeck sends the set command directly instead of clearing a mismatched slot, waiting, then setting it. This should stop HT stale profile writes from bouncing through a clear-first sequence while keeping normal AMS behaviour consistent. README acknowledgements now credit Bambuddy for open AMS/AMS-HT protocol validation. Backend restart required.
  - Verification: `python -m py_compile app/main.py app/printers/bambu.py`, `.venv\Scripts\python.exe` payload smoke test for HT normal/profile override commands, and `git diff --check` passed.
- Trust Flightdeck explicit AMS sync restored: the conservative AMS inventory changes made ordinary spool moves inventory-only, but the Doctor's `Trust Flightdeck` button still used the same move endpoint. When no profile override checkbox was enabled, the backend returned without `ams_sync`, so the button flashed and did not show `AMS profile sent`. `SpoolMove` now has `sync_ams`, and only the Trust Flightdeck button sends it. Normal assigning remains inventory-only; Trust Flightdeck is again an explicit write-to-Bambu action. Static cache bumped to `app.js?v=439`; backend restart required.
  - Verification: `python -m py_compile app/main.py`, `node --check app/static/app.js`, and `git diff --check` passed.
- AMS inventory auto-claim/write disabled: diagnostics after `445690f` showed the remaining mutation was `spool_auto_claimed` moving `#3` from Shelf #3 into `h2d:128` purely because Bambu's stale AMS HT report still said `Siddament ASA`, then later assigning `#89` wrote a profile again. `_reconcile_reported_loaded_slots` is now a no-op, so Bambu reports can suggest matches in the doctor but cannot move shelved inventory by themselves. `POST /api/spools/{id}/move` now updates Flightdeck inventory only; it writes to Bambu only when an explicit AMS profile override is supplied. `Trust Flightdeck` remains the deliberate write-to-Bambu path. Backend restart required.
  - Verification: `python -m py_compile app/main.py` and `git diff --check` passed.
- AMS same-slot move no-op fix: after disabling background replay, live diagnostics still showed `Spool #89 h2d:128 -> h2d:128` followed by `ams_slot_synced`, meaning the move endpoint wrote the AMS profile even when the spool was already assigned to that exact slot. `POST /api/spools/{id}/move` now only syncs to Bambu when the destination actually changes or an explicit AMS profile override is supplied, and `db.move_spool` no longer logs no-op moves as real moves. Backend restart required.
  - Verification: `python -m py_compile app/main.py app/db.py` and `git diff --check` passed.
- AMS HT auto-replay disabled: BigBoy HT showed why the background profile replay was dangerous. The decision log showed `h2d:128 spool #3 overwrote stale printer profile` and `ams_slot_synced` firing roughly every minute, which explains the user's report that a slot changed back by itself after being corrected. `_replay_assigned_bambu_profiles` is now a no-op; `Trust Flightdeck`/AMS Profile Doctor remains the deliberate operator-approved path for writing a profile back to Bambu, but the poll loop will not fight real spool swaps. Backend restart required.
  - Verification: `python -m py_compile app/main.py`, `node --check app/static/app.js`, and `git diff --check` passed.
- HT AMS stale-profile safety pass: BigBoy's AMS HT exposed a real-world mismatch where Bambu reported the old `Siddament ASA`/white profile while the physical truth was not that spool. Live AMS loadout and filament route now let `Review` win over `Feeding` when Flightdeck's assigned spool and the printer's slot report disagree, and the live filament route gets an amber warning treatment/title instead of visually presenting the stale report as a clean feed. Static cache bumped to `app.js?v=438` and `style.css?v=355`; frontend refresh only.
  - Verification: `node --check app/static/app.js` and `git diff --check` passed.
- Flight Tower first dispatch-board pass: the former right sidebar sections are promoted into a top `Dispatch Board` with `Run Now`, `Needs Action`, `Blocked`, `Dispatch Intel`, and `Fix It` panels. Printer lanes now sit below as supporting printer context in a responsive grid instead of competing with a sticky sidebar. Static cache bumped to `app.js?v=437` and `style.css?v=354`; frontend refresh only.
  - Verification: `node --check app/static/app.js` and `git diff --check` passed.
- Dashboard printer-first briefing boxes now keep the same printer order as the printer cards below, so each top box lines up with its matching printer card instead of resorting by severity. Static cache bumped to `app.js?v=436` and `style.css?v=353`; frontend refresh only.
  - Verification: `node --check app/static/app.js` and `git diff --check` passed.
- Dashboard Flight Briefing wrapper frame/padding was removed so the top printer handover boxes line up on the same columns and gaps as the printer cards below. Static cache bumped to `app.js?v=435` and `style.css?v=352`; frontend refresh only.
  - Verification: `node --check app/static/app.js` and `git diff --check` passed.
- Dashboard aesthetics pass: the Flight Briefing heading is now centred above the handover boxes, and those boxes use the same `320px` grid rhythm as the printer cards below. The dashboard no longer appends the Add Printer tile after the printer cards. The left sidebar Settings item now expands on hover/focus to show direct Setup, Printers, Hardware, Preferences, Appearance, Slicer, and Locations links. Static cache bumped to `app.js?v=434` and `style.css?v=351`; frontend refresh only.
  - Verification: `node --check app/static/app.js` and `git diff --check` passed.
- Dashboard printer-first briefing rows now use stable action titles like `Printer attention`, `Dispatch locked`, `Paused`, or `Offline`, with the specific reason in the detail line. This removes duplicate rows such as `1 failed print in 14d / 1 failed print in 14d`. Static cache bumped to `app.js?v=433` and `style.css?v=350`; frontend refresh only.
  - Verification: `node --check app/static/app.js` and `git diff --check` passed.
- Dashboard Flight Briefing is now printer-first instead of fault-type-first. The top handover renders compact boxes per printer, with that printer's dispatch locks, failed-print watch, active/paused print, low loaded spools, and AMS moisture watch signals grouped together. Attention printers sort first, clear printers stay as small stable cards, and the inner scroll area was removed so polling no longer jumps the briefing scrollbar back to the top. Static cache bumped to `app.js?v=432` and `style.css?v=349`; frontend refresh only.
  - Verification: `node --check app/static/app.js` and `git diff --check` passed.
- Dashboard Flight Briefing grouped cards now render every actionable row instead of hiding rows behind a non-clickable `+N more` note. Long groups use an internal scroll area, so all low spool/watch rows remain accessible without stretching the whole dashboard. Static cache bumped to `app.js?v=431` and `style.css?v=348`; frontend refresh only.
  - Verification: `node --check app/static/app.js` and `git diff --check` passed.
- Dashboard Flight Briefing now groups the operator handover instead of showing a flat run of warning tiles. It builds separate briefing cards for Printer attention, Dispatch locked, Spool watch, and In flight; each card shows the count, the top actionable rows, and a `+N more` note when the shop has more items than fit cleanly. Existing links/AMS slot warning buttons are preserved inside the grouped rows. Static cache bumped to `app.js?v=430` and `style.css?v=347`; frontend refresh only.
  - Verification: `node --check app/static/app.js` and `git diff --check` passed.
- LAN Scan results now support bulk add for safe candidates. Scan rows include checkboxes and an `Add selected` button; unconfigured Moonraker/Snapmaker U1 results can be selected and added in one pass through the existing printer config API. Bambu scan rows remain prefill-only because access code and serial are still required before adding. Static cache bumped to `app.js?v=429` and `style.css?v=346`; frontend refresh only.
  - Verification: `node --check app/static/app.js` and `git diff --check` passed.
- Add Printer now has a LAN Scan helper in Settings > Printers. The new backend `POST /api/config/printers/scan` scans the local IPv4 /24 by default, or a user-entered IPv4 CIDR up to /24, and returns likely printer candidates. It detects Moonraker/Snapmaker U1-style printers through the Moonraker API on port 7125 and flags Bambu-looking hosts when LAN MQTT port 8883 is open. The frontend shows confidence/reason/configured state and `Use` pre-fills the existing Add Printer form with host, model family, suggested ID/name, build volume, camera URL guesses, and connection type. Bambu results still require the operator to enter access code and serial. Static cache bumped to `app.js?v=428` and `style.css?v=345`.
  - Verification: `node --check app/static/app.js`, `python -m py_compile app/main.py`, and `git diff --check` passed. Venv TestClient smoke test `POST /api/config/printers/scan` with `127.0.0.0/30` returned 200 with `scanned=2`.
  - Deploy note: backend restart required after Pi pull for the new scan endpoint: `sudo systemctl restart flightdeck`.
- AMS Profile Doctor modal now fits within the viewport at normal 100% browser scale. The slot editor gets its own overlay class, the modal is capped to the viewport, the body scrolls internally, and the footer/Close action stays reachable instead of falling below the screen. Static cache bumped to `app.js?v=427` and `style.css?v=344`; frontend refresh only.
  - Verification: `node --check app/static/app.js` and `git diff --check` passed.
- Windows update-block recovery: the Windows checkout at `C:\Users\Kidabah\flightdeck` is now clean and current at `a047a5c`, and the uvicorn worker has been restarted on port 8000. Both `http://127.0.0.1:8000/api/update/status?check_remote=true` and `http://100.112.171.88:8000/api/update/status?check_remote=true` report `dirty=false`, `behind=false`, `commit=a047a5c`, `remote_commit=a047a5c`. If the Windows browser still shows `Blocked`/old commit, it is stale browser state rather than the backend checkout; hard refresh or reopen the Windows Flightdeck page.
  - Verification: Windows worker local profile sync returned `Orca Local` with 6,826 filament profiles, 290 Siddament filament profiles, 1,393 machine profiles, and 2,898 process profiles.
- Slicer profile sync can now relay local Orca profiles from the configured Windows worker. This fixes the live Pi case where the Pi cannot read `C:\Users\Kidabah\AppData\Roaming\OrcaSlicer`, so `Orca Local` was missing in both Slicer defaults and the AMS Profile Doctor even though the Windows Orca worker had Siddament profiles. `POST /api/slicer/profiles/sync` now scans local profiles on the server and, when `orcaslicer_worker_url` is set, also asks `{worker}/api/slicer/profiles/sync?include_worker=false` for its `Orca Local` vendor and stores that result in the Pi catalogue. Worker relay calls are non-recursive.
  - Windows worker unblock note: `C:\Users\Kidabah\flightdeck` was blocked by an accidental untracked `app/app/` folder. It was moved to `C:\Users\Kidabah\flightdeck-local-backups\untracked-app-app-20260609-235730`, then the Windows checkout pulled to `9dc96d9` and the uvicorn worker was restarted on port 8000. `http://127.0.0.1:8000/api/slicer/profiles/sync?include_worker=false` now returns `Orca Local` with 6,826 filament profiles and 290 Siddament profiles.
  - Verification: `_sync_worker_orca_profiles("http://100.112.171.88:8000")` returned `Orca Local` with 6,826 filament profiles and 290 Siddament profiles; `python -m py_compile app/main.py` and `git diff --check` passed.
  - Deploy note: backend restart required on the Pi after pull. Then run `Setup > Slicer > Sync profiles` on the live Pi; it should pull `Orca Local` from the Windows worker and make Siddament appear in both Slicer and AMS Doctor.
- Slicer/AMS profile picker usability was tightened after live Windows feedback. Printer Defaults now has explicit column labels (`Printer/nozzle`, `Process/layer`, `Filament/profile`) so Siddament filament profiles are searched in the right-hand filament field rather than the process field. The slicer profile dropdown now uses a fixed floating menu, opens upward when there is no room below, widens to at least 380px where possible, and shows a useful no-match message instead of collapsing into a tiny strip at the bottom of the page. Profile search now tolerates common Siddament typos/prefixes such as `sydd`, `syd`, `syddament`, and `sidament`; the same matching is used in the AMS Profile Doctor. `Orca Local` profile source pills are highlighted green. Static cache bumped to `app.js?v=426` and `style.css?v=343`.
  - Verification: `node --check app/static/app.js` and `git diff --check` passed. Browser verification was attempted, but the local dev server at `127.0.0.1:8766` was not running (`ERR_CONNECTION_REFUSED`).
  - Deploy note: frontend/static-only; hard refresh after update. For local Orca/Siddament profiles to appear, the backend from the previous commit still needs to be restarted and `Setup > Slicer > Sync profiles` run on the Windows instance that has the Orca AppData folder.
- Orca profile sync now imports local OrcaSlicer AppData/config profiles as an `Orca Local` profile vendor. The scanner recursively reads profile JSONs under the discovered Orca data/profile roots, including nested paths like `AppData/Roaming/OrcaSlicer/user/2780676685/filament/base` and `user_backup-*`, and sorts active user profiles ahead of backup folders. This makes local Siddament filament profiles show in Flightdeck profile pickers after `Setup > Slicer > Sync profiles`.
  - Slicing profile resolution now prefers stored `local_path` entries from the synced profile catalog, so selected local profiles are read directly instead of recursively scanning AppData during each slice. Direct resolution of `Siddament ABS CF Big Parts @Bambu Lab H2D 0.4 nozzle` took ~0.014s in the local smoke test.
  - Orca Cloud note: `https://cloud.orcaslicer.com/app/profiles` redirects to Orca Cloud login in the Codex in-app browser unless that browser session is authenticated. Keep using the local AppData scanner for now; a future cloud sync would need an authenticated/export/API path.
  - Verification: local scanner found 17,271 Orca JSON profiles, 6,826 filament profiles, and 290 Siddament filament profiles; TestClient `POST /api/slicer/profiles/sync` with local-only input returned 200 with `Orca Local`; `python -m py_compile app/main.py` passed with the usual Windows embedded-Python prefix warning.
  - Deploy note: backend restart required for local Orca profile sync/resolution.
- Filament catalogue sync now imports Siddament as a first-class source from the public Siddament Shopify product feed. The existing Add Spool `Sync` button now syncs Open Filament Database plus Siddament by default; `POST /api/filament/catalog/sync?source=siddament` can run just Siddament while testing. Siddament rows are stored under source `siddament` with brand `Siddament`, inferred material/subtype/colour, 1.75mm diameter, inferred filament weight/tare from product/variant/gross weight, and factual traceability in `traits` including SKU/barcode, price, availability, product URL, product type, tags, gross weight, and shop update time. Add Spool catalogue chips now include `Siddament`, and result cards show the catalogue source label. Static cache bumped to `app.js?v=425`.
  - Also fixed the catalogue insert SQL placeholder count in `replace_filament_catalog`; it had 16 placeholders for 15 columns and would break catalogue sync paths.
  - Verification: `python -m py_compile app/main.py app/db.py` passed with the usual Windows embedded-Python prefix warning; `node --check app/static/app.js` passed; local TestClient `POST /api/filament/catalog/sync?source=siddament` returned 200 and imported 1,259 Siddament rows; search for `siddament asa black` returned Siddament ASA rows with SKU/source URL traits. `peak green` is currently found from Open Filament Database/eSUN, not Siddament's current public product titles/tags.
  - Deploy note: backend restart required for the new sync source and DB insert fix; hard refresh browsers to pick up `app.js?v=425`.
- Add Printer naming labels were clarified after user feedback: the URL-safe machine key is now labelled `Internal ID (no spaces)`, while the user-facing spaced field is labelled `Printer Name (spaces ok)`. Validation now says `Printer name is required` instead of `Custom name is required`. Internal IDs were deliberately left unchanged because routes/API paths/spool locations depend on them staying URL-safe. Static cache bumped to `app.js?v=424`.
  - Verification: `node --check app/static/app.js` passed.
  - Deploy note: frontend/static-only; hard refresh browsers after update.
- Bambu add-printer model presets were expanded after review. The dropdown now includes `H2C`, `P2S`, and `X2D` alongside the existing H2/X1/P1/A1 models, with build-volume defaults for the future exclude-object/bed-map flow. Static cache bumped to `app.js?v=423`.
  - Verification: `node --check app/static/app.js` passed.
  - Deploy note: frontend/static-only; hard refresh browsers after update.
- Add Printer now starts with a real `Printer` family dropdown instead of exposing protocol as the first mental model. The first flow is `Bambu -> Model Name`, with model presets for Bambu, Voron/Klipper, Snapmaker, Other Moonraker, and a tucked-away Simulated option for demo/dev use. Model selection fills sensible protocol/icon/camera defaults while leaving `Custom Name` as the user's shop nickname.
  - Printer config now carries optional `build_volume: {x, y, z}` in mm and `printers.yaml.example` shows the new field. The add-printer model dropdown auto-fills editable Build Plate dimensions because exclude-object/bed-map logic will need real plate size later. Current defaults include common Bambu sizes such as H2D `350x320x325`, X/P/A-series `256x256x256`, A1 mini `180x180x180`, plus common Voron presets.
  - Verification: `node --check app/static/app.js` passed; `python -m py_compile app/printer_config.py app/main.py` passed with the usual Windows embedded-Python prefix warning; venv smoke test confirmed `PrinterEntry` preserves `build_volume`.
  - Deploy note: backend restart required for the new optional printer config field; hard refresh browsers to pick up `app.js?v=422` and `style.css?v=342`.
- Snapmaker U1 add-printer defaults were tidied. Selecting `Snapmaker U1` still sets the model to `Snapmaker U1`, but it no longer fills `Custom Name`; that field stays empty with a faded `Printer Beast` placeholder so the user enters their shop name. The form also clears the old auto-filled Snapmaker value when switching connection type/resetting/editing, so `Snapmaker U1` does not stick in the next add-printer form. Static cache bumped to `app.js?v=421`.
  - Verification: `node --check app/static/app.js` passed.
  - Deploy note: frontend/static-only; hard refresh browsers after update.
- FFmpeg is now treated as a tested camera-driver family instead of "whatever newest version happens to be installed". Setup Health now reports `FFmpeg camera driver` and marks Raspberry Pi OS/Debian apt FFmpeg 5.x plus Gyan Windows FFmpeg 8.x as tested; other major versions remain allowed but show as untested/warn for support diagnostics. Windows bootstrap/diagnostics and the Pi installer print the same compatibility message. `INSTALL.md` documents the tested lane so new users do not assume latest FFmpeg is always the safest camera choice.
  - Fleet Wall still-frame preloader no longer shows the large camera icon/`Waiting for next frame` placeholder before the first real snapshot arrives. It now uses a quiet blank dark frame and swaps to the camera when ready. Static cache bumped to `app.js?v=420`.
  - Verification: `node --check app/static/app.js` passed; `python -m py_compile app/main.py` passed with the usual Windows embedded-Python prefix warning; PowerShell AST parse passed for `scripts/windows/bootstrap-install.ps1` and `scripts/windows/diagnose-windows.ps1`; normalized `scripts/install-pi.sh` and the staged Git version passed `bash -n`.
  - Deploy note: backend restart required for the Setup Health FFmpeg check: run `sudo systemctl restart flightdeck` after the Pi pulls it. Hard refresh browsers to pick up `app.js?v=420`.
- Fleet Wall camera load now uses low-rate still snapshots instead of holding a live MJPEG stream open for every printer tile. This was a narrow port of the useful part of Steve/keenzkustoms' fork idea, not a full merge: Flightdeck now exposes `fleet_url`/`fleet_refresh_ms` camera metadata, adds `/api/camera/{printer_id}/snapshot`, and the Fleet Wall frontend staggers still-frame refreshes around every 3.5s. Live view, printer camera pages, and normal camera stream quality remain unchanged.
  - Bambu snapshot requests use a temporary counted `BambuCameraProxy.snapshot()` client so the shared ffmpeg worker still benefits from the existing idle shutdown/watchdog logic. Deliberately not ported from Steve's fork: the global Bambu proxy downgrade to 640px/2fps/q8, unrelated label-printer changes, or any broad branch merge.
  - GPU/FFmpeg note: browser/GPU acceleration can help display/decoding on Windows, but Flightdeck cannot reliably force camera feeds into AMD VRAM from the web app. Reducing the number of persistent live camera streams is the practical win. FFmpeg is installed through the platform package path (`apt` on Pi, `winget`/Gyan on Windows), so it may trail the newest upstream FFmpeg release; upgrading FFmpeg can be tested separately, but this change reduces Fleet Wall dependence on constant ffmpeg/live streams.
  - Verification: `node --check app/static/app.js` passed; `python -m py_compile app/main.py app/camera.py` and `.venv/Scripts/python.exe -m py_compile app/main.py app/camera.py` passed with the usual Windows embedded-Python prefix warning; `git diff --check` passed.
  - Deploy note: functional commit is `12b7ca5` (`Use still snapshots on Fleet Wall`). Backend restart required for the new snapshot endpoint and camera metadata: run `sudo systemctl restart flightdeck` after the Pi pulls it. Hard refresh browsers to pick up `app.js?v=419`.
- Support bundles now require context during early testing. The visible `Diagnostics only` fallback was removed from the modal, the copy now asks users to fill in as much information as possible, then click `Download zip`, attach it to an email, and send it to `flightdeck3dprinters@gmail.com`. Frontend and backend both require name, email, and problem/what happened before generating `/api/setup/logs/support`. The plain `/api/setup/logs/download` endpoint remains available for internal direct use, but it is no longer offered in the modal. Static cache bumped to `app.js?v=418`.
  - Journal log capture was improved: diagnostic bundles now append a clear remediation note when `journalctl` cannot read service logs, Setup Health includes an optional `Journal logs` check, and `scripts/install-systemd.sh` writes `SupplementaryGroups=systemd-journal adm` so freshly installed/refreshed systemd units can read journal output.
  - Verification: `node --check app/static/app.js` passed; `python -m py_compile app/main.py` and `.venv/Scripts/python.exe -m py_compile app/main.py` passed with the usual Windows embedded-Python prefix warning. Local smoke test confirmed missing name/email/problem is rejected with 422 and a filled support bundle still contains `support-request.txt`.
  - Deploy note: GitHub was pushed and the Pi repo fast-forwarded to commit `757834f` via `/api/update`; updater reported `restart_required: true`. Run `sudo systemctl restart flightdeck` for the backend changes. To fully apply the journal permission unit change on an existing Pi install, run `cd /home/flightdeck/flightdeck && ./scripts/install-systemd.sh` once, or apply `sudo usermod -aG systemd-journal flightdeck && sudo systemctl restart flightdeck`.
- Support bundle modal fallback wording was clarified: the left-side plain diagnostics path now says `Diagnostics only` instead of `Quick zip`, while the main support-notes path remains `Download zip`. Static cache bumped to `app.js?v=417`; frontend refresh only.
  - Verification: `node --check app/static/app.js` passed.
  - Deploy note: GitHub was pushed and the Pi repo fast-forwarded to commit `35e170b` via `/api/update`; updater reported `restart_required: true`, but this specific change is frontend/static-only, so a hard browser refresh should pick up `app.js?v=417`.
- Setup `Download logs` now opens a support-bundle form before downloading the zip. The form captures optional name/email plus problem, expected outcome, and notes, then POSTs to `/api/setup/logs/support`; the generated `flightdeck-support-*.zip` includes both `support-request.txt` and `support-request.json` alongside the existing redacted diagnostics. The old `/api/setup/logs/download` quick zip remains available from inside the modal. Demo mode stubs both log endpoints, and static cache bumped to `app.js?v=416` / `style.css?v=341`; backend restart required for the new POST endpoint.
  - Verification: `node --check app/static/app.js` passed; `python -m py_compile app/main.py` and `.venv/Scripts/python.exe -m py_compile app/main.py` passed with the usual Windows embedded-Python prefix warning. Local venv smoke test generated a support zip containing `support-request.txt` and `support-request.json`. Local browser smoke test on `http://127.0.0.1:8766/#/settings/setup` opened the support modal and submitted the form; the in-app browser cannot save downloads but the modal closed and showed the success toast after the POST.
  - Deploy note: GitHub was pushed and the Pi repo fast-forwarded to commit `c667373` via `/api/update`; updater reported `restart_required: true`, so run `sudo systemctl restart flightdeck` before testing the support-bundle form on the live Pi.
- Setup now has a `Download logs` support button in Version & Updates. It downloads a generated diagnostic zip from `/api/setup/logs/download` containing setup health, instance/version metadata, redacted settings/config/environment, recent decisions/notifications, recent local log tails, git status/log, ffmpeg/python info, and systemd/journal/process details where available. Secret-like keys are redacted and log/config files are capped to recent tails. Static cache bumped to `app.js?v=415` and `style.css?v=340`; backend restart required for the new endpoint.
  - Verification: `node --check app/static/app.js` passed; `python -m py_compile app/main.py` and `.venv/Scripts/python.exe -m py_compile app/main.py` passed with the usual Windows embedded-Python prefix warning. Local venv smoke test generated a diagnostic zip containing setup health, redacted settings, recent decisions, recent notifications, redacted printer config, logs, and command outputs.
  - Deploy note: GitHub was pushed and the Pi repo fast-forwarded to commit `e402e3e` via `/api/update`; updater reported `restart_required: true`, so run `sudo systemctl restart flightdeck` before testing the download button.
- Added Flightdeck Ko-fi support wiring for `https://ko-fi.com/flightdeck3dprinters`: GitHub funding metadata in `.github/FUNDING.yml`, a restrained README support section, and Ko-fi CTAs on the GitHub Pages site. This is docs/static site only; no app restart required.
  - Deploy note: GitHub was pushed and the Pi repo fast-forwarded to commit `4ce6b5c` via `/api/update`. Updater reported `restart_required: true`, but this change is README/docs/funding metadata only; no Flightdeck service restart is needed for it.
- AMS Profile Doctor and Slicer settings now use Flightdeck custom profile pickers instead of browser datalist dropdowns. The AMS slot profile override shows a search field with a scrollable Bambuddy-style filament profile list, selected state, material tag, and keeps profile override opt-in. The Slicer defaults printer/process/filament inputs use the same search-and-select popup while preserving the existing Orca profile filtering and defaults save endpoint. Static cache bumped to `app.js?v=414` and `style.css?v=339`; frontend refresh required.
  - Deploy note: GitHub was pushed and the Pi repo fast-forwarded to commit `5663161` via `/api/update`. Updater reported `restart_required: true`, but this change is frontend/static-only; hard refresh the browser to pick up `app.js?v=414` and `style.css?v=339`.
- AMS slot picker now treats Flightdeck assignments in a live-empty printer slot as movable stale-location candidates. If a spool still says it is in H2D AMS 1 S2 but the printer reports that slot empty, it appears in another slot doctor's picker as an `Empty source slot` option and moving it relocates the same physical spool instead of blocking it as already assigned. Static cache bumped to `app.js?v=413`; frontend refresh required.
  - Deploy note: GitHub was pushed and the Pi repo fast-forwarded to commit `5d5f242` via `/api/update`. Updater reported `restart_required: true`, but this change is frontend/static-only; hard refresh the browser to pick up `app.js?v=413`.
- AMS Profile Doctor now has an explicit Bambu slot profile override panel for the assigned spool. The spool remains the Flightdeck identity; by default Trust Flightdeck still uses the existing spool-to-AMS mapping, including custom aliases like Siddament ASA. If the operator ticks/edits the override panel, Trust Flightdeck sends the chosen profile name, material, colour, temperature range, and generic Bambu family tray ID to the AMS slot. This mirrors the useful part of Bambuddy's Configure AMS Slot flow without making slicer sync silently become spool identity. Static cache bumped to `app.js?v=412` and `style.css?v=338`; backend restart required because `/api/spools/{id}/move` now accepts the optional `ams_profile` payload and the Bambu MQTT sender accepts an override.
  - Verification: `node --check app/static/app.js` passed; `python -m py_compile app/main.py app/printers/bambu.py` passed with the usual Windows embedded-Python prefix warning. Local server on `localhost:8765` served `app.js?v=412` and `style.css?v=338`, but the demo runtime stayed on `Connecting...`, so live Pi UI verification is still needed after deploy/restart.
  - Deploy note: GitHub was pushed and the Pi repo fast-forwarded to commit `ef07507` via `/api/update`; updater reported `restart_required: true`, so run `sudo systemctl restart flightdeck` before testing the new AMS profile override.
- AMS Profile Doctor now also treats Bambu slots that report `Loaded` but have blank material/colour/profile as low-confidence. Live watch of H2D AMS 1 S1 showed stale red -> Peak Green after Trust Flightdeck -> empty -> Flightdeck auto-returned #76 -> Bambu reinserted as loaded with blank metadata. The Doctor should no longer invent a best match such as Black ABS from an unknown loaded slot; pick the physical shelf spool and Flightdeck will overwrite the AMS profile. Static cache bumped to `app.js?v=411` and `style.css?v=337`; frontend refresh only.
  - Deploy note: GitHub was pushed and the Pi repo pulled commit `f47a256` via `/api/update`. Updater reported `restart_required: true`, but this is frontend/static-only; refresh the browser to pick up `app.js?v=411`.
- AMS Profile Doctor now treats unassigned Bambu slots with generic profiles (`Generic PLA`/`GFL99`) as low-confidence because the printer can retain stale AMS colour/profile memory after a physical spool change. It no longer promotes a "best stored match" or Suggested badges from stale generic colour; it shows a warning to choose the physical shelf spool, and assignment still overwrites the AMS slot profile. Static cache bumped to `app.js?v=410` and `style.css?v=336`; frontend refresh only.
  - Deploy note: GitHub was pushed and the Pi repo pulled commit `4d45176` via `/api/update`. The updater reported `restart_required: true`, but the code change is frontend/static-only; refresh the browser to pick up `app.js?v=410`.
- AMS slot doctor can now automate shelf-to-occupied-slot swaps. The picker sends an intentional `replace_existing` move: if the target AMS slot already has a Flightdeck spool, the backend returns that old spool to its home shelf, assigns the chosen shelf spool into the slot, then pushes the existing Trust Flightdeck/Bambu AMS profile sync. Static cache bumped to `app.js?v=409` and `style.css?v=335`; backend restart required.
  - Deploy note: GitHub was pushed and the Pi repo pulled commit `57f22f2` via `/api/update`; updater reported `restart_required: true`, so run `sudo systemctl restart flightdeck` before testing the automated swap path.
- AMS slot shelf assignment picker has been tightened for the "add spool from shelf to AMS slot" flow. Slot editor now shows shelf-aware filter chips (`All`, live-report `Matches`, and top storage locations), row badges for suggested/home-shelf spools, clearer shelf counts, and keeps the existing backend move/home-shelf memory plus Bambu AMS profile sync untouched. Static cache bumped to `app.js?v=408` and `style.css?v=334`; frontend refresh only.
  - Deploy note: GitHub was pushed and the Pi repo pulled commit `8b0391f` via `/api/update`. The updater reported `restart_required: true` even though the code change is static/frontend-only, so a browser refresh should pick it up; a service restart is only needed if the running app does not serve the new cache-busted static files.
- Snapmaker U1 setup camera defaults were corrected after live UI review: choosing Snapmaker U1 now replaces the old generic Moonraker `/webcam/?action=stream|snapshot` defaults with U1-style `/webcam/stream.mjpg` and `/webcam/snapshot.jpg` paths, and the placeholders match those paths.
- Ported Steve/keenzkustoms' Snapmaker U1 ecosystem support from his fork as a narrow Flightdeck-main change. Flightdeck now accepts `connection.type: snapmaker_u1`, polls U1 as a Moonraker-family printer with four independent toolheads (`T0`-`T3`), shows a Snapmaker U1 toolhead loadout/selected-tool route on Live, exposes Snapmaker U1 in printer setup with default MJPEG/snapshot paths, and documents the config shape in `printers.yaml.example`. Deliberately not ported from Steve's fork yet: adaptive snapshot/WebRTC camera experiments or broad polling/camera changes.
  - Deploy note: GitHub was pushed and the Pi repo pulled the change via `/api/update` to commit `731562f`, but the updater reported `restart_required: true`. SSH restart from this Windows session still failed with public-key auth, so the running Pi backend needs a Flightdeck service restart before the new `snapmaker_u1` config parser is active.
- Fleet Wall Medium now uses a compact AMS feed-route strip instead of the full AMS bay visual. It reuses the Live-page route truth, shows active/ready filament paths to Left/Right nozzle or toolhead, and falls back to loaded spool chips when nothing is actively feeding.
- Setup updater now has explicit visual states: Update changes colour/text for available, checking, updating, blocked, and updated states, and the update message becomes a coloured status box so Windows users can see when local changes or a failed pull block the update.
- Windows/web Setup update button now remains clickable when the checkout has local changes, so clicking Update surfaces the backend blocker message instead of feeling like a dead button. Check GitHub also explains that local changes must be committed, stashed, or removed before updating.
- Bambu camera proxy startup race fixed: Live/Print Wall camera streams now count the browser as a client before ffmpeg starts, and the watchdog restarts a missing worker while clients are still watching. This targets the recurring H2D black camera panel where AMS/MQTT kept updating but the MJPEG stream opened with no frames.
- H2D/other Bambu Print Bay loading is hardened: Bambu SD/FTP file listing now has a short timeout and a brief successful-target cache so the Print Bay can show vault/reprint content instead of sitting on `Loading Print Bay...` when the printer file store is slow.
- Live rail fan controls now match the preheat rail width: each fan channel uses a full-width slider row with the label/percent above it, so the controls no longer look squeezed beside the camera.
- Fixed the first-pass live-control rail camera collapse: `.live-main-deck` now has a viewport-based minimum height so the camera hero cannot compute to 0px high beside the new rail.
- Live printer controls now sit in a vertical left-side rail beside the camera instead of spanning across the top. The printer/status/transport header stays above the camera, while preheat, fan, jog, home, and Klipper controls move into `#detail-live-ops` inside `.live-control-rail`.
- Camera wide mode hides the new live-control rail and live strip so the camera can expand cleanly; mobile stacks the rail above the camera.
- Fleet Wall `XS` headers now use a two-row compact layout so printer identity and warning chips do not crowd each other. Names truncate cleanly, icons are smaller, and warning chips move under the printer name instead of fighting for the same row.
- Restored Fleet Wall `Small` as its own mode. `XS` is now the extra-small camera-wall-sized mode with fixed non-stretching `18rem` columns so three printers do not expand to Medium-sized cards.
- Camera Wall has been removed from command search and the top nav. Legacy `#/cameras` URLs now route back to Fleet Wall.
- Fleet Wall `XS` keeps normal live camera URLs, hides body panels, and uses compact 16:10 camera tiles.
- The active camera release endpoint/ffmpeg kill attempt was removed because it could race shared Bambu streams and make the wall black again. Camera pages are back to clearing `<img>` sources only, leaving the existing proxy idle cleanup to handle workers.
- Fleet Wall now has an `XS` mode that keeps the normal live camera URLs but strips the body panels down to a compact camera-first wall, closer to the original camera view.
- Reverted the Fleet Wall live-camera cap / `profile=fleet&fps=2` attempt because it made the live Fleet Wall camera areas black on the real 3-printer Pi view. Do not reapply that approach as-is; next camera-load attempt should preserve normal Fleet Wall stream URLs and first verify actual image rendering on the live Pi.
- Windows uninstall is now a root `Uninstall-Flightdeck-Windows.cmd` plus hardened `scripts/windows/uninstall-windows.ps1`. It stops Flightdeck tray/backend processes for this checkout, removes Desktop and Startup shortcuts, keeps `%LOCALAPPDATA%\Flightdeck` by default, and only deletes restored data when `-RemoveData` is passed.
- Windows installer can now import an existing Flightdeck backup archive via `-DataArchive`. The bootstrap passes the archive through, the install script extracts the standard `flightdeck-data` backup shape into `%LOCALAPPDATA%\Flightdeck`, and it creates a `restore-safety-*` copy first if Windows already has data.
- Fresh all-data Pi backup for Windows install: `/home/flightdeck/windows-install-backups/flightdeck-backup-20260608-182118.tar.gz` (37 MB, SHA256 `5ff17fa0819f54d4d4588253e7ea4a254a067e0a66336c7fe584df001d240c49`). It was also pushed to the private backup repo.
- Live Ops jog controls now allow paused printers, which is needed for recovery cases like the H2D reporting `paused` with a Bambu alarm. Jog still stays disabled for active printing, finished, offline, error, and estop states.
- Bambu XYZ jog is now wired through the installed Bambu package's validated `gcode_line` route (`G91`, bounded `G1 X/Y/Z`, `G90`). The Live Ops jog pad enables for idle/safe Bambu printers instead of showing "Jog unavailable"; Bambu Home All still uses the existing `home_printer()` path.
- Klipper/Moonraker printers have a compact XYZ jog pad in Live Ops. X/Y jogs are 10mm steps, Z jogs are 1mm steps, XY home sits in the pad centre, and backend `/api/printers/{id}/jog` keeps X/Y capped at 50mm and Z capped at 10mm.
- Windows desktop installer shortcuts now use a packaged `app/static/flightdeck.ico` file for the Flightdeck icon. Both fresh installs and the standalone desktop-shortcut helper prefer the `.ico` and fall back to the PNG if it is missing.
- Flightdeck shortcut icons are now explicit in the live app, demo app, and GitHub Pages site. The app pages link the SVG plus PNG favicon fallback, and `docs/assets/flightdeck-icon-192.png` gives the GitHub Pages page a PNG shortcut icon fallback.
- Bambu skip-object maps now use the 3MF `Metadata/top_N.png` top-down plate image as the visual background when available, while Print Details keeps using the normal `Metadata/plate_N.png` preview thumbnail. This should keep the current Bambuddy-style ID coordinate mapping but make the tags line up against a true top-down bed image instead of the angled preview.
- Bambu skip-object ID pins now use the same source as Bambuddy: `slice_info.config` provides the skip ID/name and `Metadata/plate_N.json` provides that object's bbox center by name. This fixes cases like Can Opener where G-code object-label IDs made `701` appear on the wrong thumbnail footprint.
- Camera stream caching/stale-connection handling has been tightened. `/api/camera/*` responses now send stronger no-store/no-buffer headers, and the frontend quietly refreshes visible live camera `<img>` streams after 2 minutes or when the browser tab becomes visible again.
- Bambu skip-object maps now use the active 3MF/print thumbnail as the visible plate preview behind the Bambuddy-style object IDs. The old top-down diagnostic grid/exploded shape view is no longer the primary visual; transparent hit regions and the ID/name skip list still use the original Bambu object IDs.
- Bambu skip-object map bounds now preserve the 3MF plate/preview bounds when available instead of replacing them with the tight recovered G-code object bounds. This avoids the skip-object map appearing exploded compared with the print-detail/top-preview layout.
- Bambu skip-object maps now follow the Bambuddy-style ID workflow: a clean positional map with small red object markers, blue ID dots, active count, and a compact ID/name skip list. The raw G-code extrusion path is no longer shown as the main object shape.
- The vertical Bambu skip-object `Front` marker now sits just outside the map area on the far right.
- The Bambu top-down skip-object `Front` marker is now vertical and sits on the far right-hand side of the map.
- Bambu top-down skip-object maps now show a small `Front` marker at the right-hand centre of the map. It is a visual-only overlay and does not affect red regions, object outlines, or skip IDs.
- Bambu top-down skip-object maps now apply mirror flags plus `map_coordinate_rotation=-90` through coordinate math, so the whole red overlay and SVG footprint layout rotates left together. On the X1C 6-object map, skipped object `#96` now lands where `#115` was previously.
- Bambu top-down skip-object maps now expose `map_mirror_y=true` and `map_mirror_x=false`; this keeps the skipped X1C object `#96` in the top-right corner while preserving raw Bambu object IDs for skip commands.
- Bambu top-down skip maps now draw a footprint shape for each object instead of only a generic rectangle. The parser sends a simplified convex footprint plus extrusion strokes from object-labelled gcode; X1C's 6-Benchy print parsed with 14-point footprints and 29 strokes for each skip ID.
- Bambu skip-object maps now render as a Mainsail-style top-down bed map instead of using the angled Bambu plate thumbnail. The parser now recovers per-object top-down bboxes from `Metadata/plate_*.gcode` object-label extrusion moves, which fixes repeated-copy jobs like the X1C 6-Benchy print where `plate_1.json` only exposed one combined bbox.
- Bambu/H2D camera proxy no longer restarts ffmpeg just because frames are byte-identical for 8 seconds; that false-positive could make the Live view appear frozen during quiet parts of a print. It still restarts when no frames arrive, the initial frame never appears, or the 15-minute H2D RTSP session lifetime is reached.
- H2D/AMS HT loaded filament now keeps a visible route to `Right nozzle` even when the HT slot is parked/idle; idle routes show `Ready` instead of pretending filament is actively fed. Demo AMS HT spool data now uses canonical slot `128` instead of legacy `512`.
- Queue STEP slice dialogs now hide `Slice in Flightdeck` and explain the Orca GUI handoff because the Orca background CLI/API rejects STEP imports (`Unknown file format... must have .stl, .obj, .amf`). STEP items still provide Download/Open Orca/Copy output/Check vault actions.
- Slicer API runs no longer require Orca installed on the Pi just to load profile JSON. If local Orca profile files are unavailable, Flightdeck fetches the selected profile JSONs from the synced Orca profile catalog paths.
- Queue/API slicing now falls back to the configured Slicer API URL when the configured Worker URL is unreachable. Live diagnosis showed `orcaslicer_worker_url=http://100.112.171.88:8000` timing out while `orcaslicer_api_url=http://100.112.171.88:3003` was healthy.
- Queued `.step` / `.stp` source-model items now show a `Slice` button that opens the existing slicer dialog for that queue item and target printer.
- Printer queues now accept `.step` and `.stp` uploads as source-model cue items. They appear in the queue with a STEP marker, but queue preflight blocks dispatch until the model is sliced into a printer-ready job.
- Bambu per-object thumbnail slices currently use `transform: rotate(25deg)` on `.obj-map-image-piece` as the latest visual trial. This rotates only the white object slices, not the red overlay.
- Bambu/Klipper live fan controls no longer show Off/50/100 preset buttons; each fan now uses one 10%-step percentage slider with a visible percent readout and red/green off/on styling.
- Previous Bambu per-object thumbnail slice trial used `transform: rotate(10deg)` on `.obj-map-image-piece`.
- Bambu skip-object maps now support `map_image_mode=per_object`, which slices the thumbnail by each object's bbox and renders that image piece inside its own locked red overlay box. This keeps the red boxes as source of truth and avoids moving the whole bed thumbnail as one layer.
- Bambu skip-object thumbnail offsets are now both `0` so the thumbnail sits flat under the locked red overlay. Current trial is red overlay locked, thumbnail angle `45deg`, `x=0%`, `y=0%`.
- Reverted the Bambu/H2D plate underlay because it made the skip-object map worse. Current map is back to the previous best: locked red overlay, thumbnail image `45deg`, `x=5%`, `y=-92%`.
- Bambu skip-object thumbnail layer now supports image-only X/Y offsets; current H2D trial keeps the red overlay locked and moves the rotated thumbnail by `x=5%`, `y=-92%` to bring the star down inside `#439` and move the spoon shapes left into `#148/#463`.
- Bambu skip-object red overlay remains locked unrotated/axis-aligned. The thumbnail image is now on a separate layer underneath and currently rotates 45 degrees to try to bring the left spoon/keeper shape into the `#148` box without moving the red boxes.
- Bambu skip-object map rotation is now locked at `0` so the red overlay stays axis-aligned like the user's second reference image: `#148/#463` vertical on the left, `#417` bottom-left, and `#439` across the right. Do not rotate or move the red overlay in future thumbnail alignment work.
- Restored the Bambu skip-object overlay to the user-approved 45-degree shared thumbnail/box rotation and removed the separate image-layer experiment again. The red overlay should match the screenshot target with `#148/#463` left, `#417` bottom-left, and `#439` right.
- Reverted the image-only rotation trial because it made the H2D skip-object map worse; Flightdeck is back to the better 45-degree shared thumbnail/box rotation.
- Bambu skip-object map display rotation is currently set to 45 degrees clockwise as a user-requested visual check after the full 90-degree version looked too far.
- Bambu skip-object maps now render the thumbnail/object overlay as a 90-degree clockwise display rotation while preserving the underlying skip IDs. This is to match the H2D touchscreen orientation from the user's photo.
- Bambu/H2D skip-object maps now fall back to matching plate-layout boxes by object name and occurrence when Bambu's plate JSON uses different internal IDs from the MQTT skip IDs, and the Y axis is flipped to match the Bambu screen/thumbnail orientation. BigBoy's current small front `Spool Holder` cylinder is object `#417`.
- AMS slot indexing now uses one canonical rule across backend/frontend: regular AMS slots stay `unit*4+slot`, AMS HT uses Bambu tray ids `128+slot`, with legacy `512` accepted during transition.
- Generic Bambu AMS/AMS HT reports now only auto-claim the exact recently remembered spool for that slot; if that spool is unavailable, Flightdeck leaves the slot for manual confirmation instead of grabbing a similar spool.
- Bambu printer-side/operator Stop now records as `CANCELLED` when the printer reports `FAILED` with no alarm/error code, instead of polluting reliability stats as `ERROR`.
- Print Watch focus now preserves the active camera image while refreshing status/HUD text, preventing the double flash when the same printer stays selected.
- Printer health now excludes prints marked no-stats/Flightdeck testing from 14d failure totals, early-failure counts, cancelled totals, and success-rate math.
- Fleet Wall added with Small/Medium/Large modes.
- Fleet Wall now uses Live-view style AMS visuals.
- Fleet Wall warnings compacted.
- Fleet Wall camera tile opens the printer Live view.
- Fleet Wall camera fullscreen exits back to Fleet Wall when opened from Fleet Wall.
- Cameras is now Print Watch with a rotating large focus feed that pins on attention.
- Live camera zoom cycle stays on Live view instead of jumping to Cameras.
- Themes, sidebar text colour, and wider adjustable sidebar are in.
- Printer nav uses shop name first, model second.
- Print disabled state shows as On hold.
- Orca/browser/worker slicer settings and tests are in.
- Bambu/Klipper live controls expanded.
- Stock-in sheet/QR workflow started.
- Bambu skip-object UI now thumbnail-first with list removed/reduced.
- Sim printer stale notifications cleaned up.

Likely next items:
- If the rotated Bambu object map looks correct on the X1C/H2D, keep `map_mirror_y=true` plus `map_coordinate_rotation=-90`; if the target changes, adjust only the display transform flags without changing the object parser or skip IDs.
- Keep polishing Fleet Wall layout and AMS sizing.
- Recheck BigBoy AMS HT assignment after any physical spool moves; HT should now show as slot `128` rather than legacy `512`.
- Recheck Fleet Wall click/zoom behaviour after real use.
- Continue slicer/API integration and profile filtering.
- Continue stock-in QR/label workflow.
- Make Windows installer/update flow smoother.
