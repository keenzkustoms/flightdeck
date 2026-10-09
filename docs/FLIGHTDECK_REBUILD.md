# Flightdeck rebuild brief

Updated 2 October 2026. This is the working brief for the WatchTower-inspired rebuild. It distinguishes requested behavior, proposed implementation, and verified current code. The first implementation is now in the local checkout; production deployment remains pending.

## Product direction

Make Flightdeck useful at a glance for the owner's three printers and easy to grow into a larger mixed fleet for their mate and Steve. Preserve Flightdeck's identity while making the daily workflow coherent. WatchTower screenshots are visual and workflow references, not evidence that Flightdeck already supports those features.

## User requirements captured

1. A complete printer workspace: camera, current job, file upload/browsing, pending queue, movement, temperatures, cooling, and loaded filament together.
2. Bottom-row placement: **Movement → Loaded filament → Temperatures & cooling**. This supersedes the first preview's order.
3. A visible per-printer pending queue, with current job and upcoming work on the same screen.
4. A compact fleet grid that remains useful as printers are added. The reference shows model imagery, status, temperature, layers, remaining time, progress, filename, printer name, and a camera shortcut.
5. One-click LAN discovery with visible progress for each printer ecosystem, a running total, selectable results, and pairing when required. Bambu, OctoPrint, Klipper, and PrusaLink are the desired discovery groups.
6. Future print-removal automation: per-printer ejection profiles covering cooldown, release, removal/sweep, park, and optional custom steps, connected to the queue.
7. Continue gathering value-adding upgrades while design work progresses. The feature list remains open.
8. A camera wall that automatically orders printers by print time and allows dragging a camera into the desired position. Current interpretation: shortest remaining time first; dragging pins that camera's position while the others remain automatically ordered. Provide individual unpin and restore-automatic-order actions. The user has not yet explicitly confirmed remaining time versus total job duration.

Candidate under discussion: a shared fleet queue that can hold a job as pending match, then assign it to a compatible printer and map required materials/tools. The user asked how the WatchTower screenshot works; they have not yet selected this for the first implementation milestone. The screenshot alone does not establish WatchTower's matching algorithm.

## Preview delivered

The original printer preview remains available. A combined rebuild preview adds:

- Flight Tower, Printer live, and Add printers navigation.
- A selectable sample fleet of 3, 12, or 48 printers.
- State filters, text search, bench grouping, sorting, and compact/larger cards.
- Clicking a printer opens its illustrative workspace.
- H2D dual-nozzle, X1C single-nozzle, and Voron external-spool presentations.
- Simulated Bambu and Klipper discovery with visible progress, cancellation, duplicate labels, selection, and a per-printer connection-test step.
- OctoPrint and PrusaLink visibly marked as planned support.
- A camera wall ordered by remaining time, draggable/keyboard-movable camera tiles, individual pins, and an automatic-order reset. It reuses one existing demo camera still, explicitly labelled as an example rather than a live feed.

All preview devices, print jobs, telemetry, and network addresses are examples. Camera panels are labelled illustrations. Preview controls do not contact printers. Rendering 48 sample cards is a layout check, not a claim of 48-printer production capacity.

## Verified current code foundation

Read-only inspection of `C:\Users\Kidabah\flightdeck` at HEAD `8daad1b` on 2 October 2026. The checkout has pre-existing changes; this work has not edited or committed them.

- `app/static/app.js:2248`: `_detailLiveOps` already provides preheat, fan, jog, home, calibration, and related capabilities with state-dependent controls.
- `app/static/app.js:2409`: `_detailLiveOpsDrawer` currently combines temperatures and operation controls inside a drawer.
- `app/static/app.js:9737`: the live screen builds a camera/main area, a live strip, and a separate print-detail panel. The proposed arrangement can reuse these data and command paths.
- `app/static/app.js:14964`: an existing **Scan LAN** action is present.
- `app/static/app.js:15409`: scanning currently waits for `POST /api/config/printers/scan` to return before showing results. The same setup area already has candidate selection and an `addSelectedScanCandidates` handler.
- `app/main.py:4710`: the scanner accepts IPv4 networks and caps the range at 256 addresses. That is an address-range constraint, not a tested fleet-size limit.
- `app/main.py:4793`: Bambu SSDP discovery already exists.
- `app/main.py:4848`: host probing checks Moonraker and Bambu candidates. A port-only MQTT candidate can currently fall back to a Bambu H2D label; stronger identification should precede claiming a model.
- `app/main.py:4895`: the scan endpoint uses bounded concurrency and returns the completed result set. Real progress reporting needs an observable scan lifecycle, not a frontend countdown.
- `app/printer_config.py:47`: connection types include Moonraker, Snapmaker U1, Bambu, and simulated devices. OctoPrint and PrusaLink are not in this connection union.
- `app/main.py:11526`: queue auto-advance already checks active jobs, printer state, preflight, and a per-printer lock. Ejection must be integrated with this dispatch path rather than built as an independent process that can race it.
- The latest handoff documents Print Memory fleet history cards and AMS remaining-filament meters. This inspection does not establish live deployment status.
- `app/static/app.js:13632`: `renderFleetWall` already provides a camera wall, currently ordered by dashboard state rank and bench ordering. It has card-size controls and uses the existing camera feed helpers. This is the foundation for the requested remaining-time order and manual placement.

The inspected files establish a useful baseline, not a complete architecture or safety audit.

## Proposed implementation sequence

### 1. Unified printer workspace

Restructure the existing live screen around the accepted layout. Reuse current telemetry, hardware-specific filament views, and command handlers. Add the existing per-printer queue data beside file actions. Preserve command availability checks and ensure refreshing telemetry does not reset user input, queue selection, or camera state.

Acceptance: render and click through on desktop and narrow screens; verify queued/current job consistency and hardware differences against real printer data. Layout-only changes must not change command payloads or automatically start jobs.

### 2. Expandable Flight Tower

Introduce compact, consistent cards with useful model identification and an explicit distinction between live values, stale values, and unknown values. Provide state filtering, bench/group selection, text search, and sorting. Camera views should be opened intentionally, with unused streams released. Keep the selected printer and navigation stable as updates arrive.

Acceptance: exercise 3/12/48-device fixtures including faults, reconnects, missing cameras, long names, and mixed hardware. Measure rendering and update latency. Then measure actual server load and memory on the intended host; do not infer physical fleet capacity from fixture counts.

Camera-wall ordering should use stable printer identifiers. Automatically order unpinned active jobs by remaining time, with a stable tie-break and explicit handling of unknown/stale ETA and non-printing machines. Dragging reserves the selected position; updates must preserve those reservations. Offer equivalent keyboard placement and individual unpin/reset actions. Avoid restarting feeds merely because tile positions change. Persist viewer layout preferences separately from printer commands. Camera concurrency and refresh policy need host measurements before claiming large-fleet video capacity.

### 3. Discovery and onboarding

Reuse existing discovery and bulk-add logic where appropriate. Introduce a scan identifier and observable states for every supported protocol: waiting, scanning, complete, cancelled, or failed. Stream or poll real counts and results. A retry must not create duplicate devices.

Deduplicate using a stable device identity where available, with address changes handled explicitly. Treat an open port as a candidate until the device is identified. Distinguish already configured devices, verified new printers, and candidates requiring manual details. Keep manual IP entry and explicit network selection available.

Pairing remains per printer. An added device must pass its appropriate connection test. Show partial success clearly when adding several devices, so a single authentication failure does not hide the successful ones. Keep protocol adapters separate from the discovery presentation. Add OctoPrint and PrusaLink support only after their connection, telemetry, and control paths are implemented and tested.

Acceptance: mocked transport cases for cancellation, timeout, duplicate identities, address changes, unsupported services on printer-like ports, partial discovery, and connection failure. Then verify discovery and pairing against the actual supported LAN devices. No forced network-wide scan during unrelated page loads.

### 4. Ejection profiles and repeat printing

Treat this as a later hardware milestone, as requested. Each profile belongs to a specific printer and relevant plate/process configuration. A model must only expose steps it can actually perform; the screenshot's bed-flex mechanism must not be assumed to exist on every printer.

Proposed visible stages: print finished → cooling → releasing/removing → parking → bed-clear confirmation → next-job preflight → dispatch. The exact mechanism and evidence for bed clearance remain to be designed and physically verified.

Record attempts and outcomes, handle cancellation and interrupted runs, and prevent duplicate dispatch after reconnects or service restarts. Unknown or failed removal must leave the next job waiting. Preserve manual bed-clear operation for machines without a tested removal profile.

Acceptance: a supervised physical test for each supported printer/profile/plate combination, including failure and interruption cases, with decision logs. Neither a UI preview nor valid G-code syntax is evidence that ejection works.

## Delivery discipline

### WatchTower overview reference

The user's overview image lists live cameras, live control, wide compatibility, smart queue, multi-colour remapping, e-commerce integrations, global file library, filament tracking, AI failure detection, alerts anywhere, unified alarms, analytics, power control, auto ejection, auto ready, and cross-platform access. This is a reference checklist, not confirmation that these features exist in Flightdeck or approval to enable physical automation.

Capture the additional candidates: order-to-job integration with external shops; consolidated printer alarms with actionable context; configurable remote notifications; fleet utilisation, completion and failure analytics; supported power-device integrations; and usable desktop/mobile access. Keep delivery status explicit for every printer family and feature. Define "auto ready" before implementation: the image does not establish what conditions or actions it uses. Any readiness workflow must distinguish printer idle, plate clear, filament compatible and actual permission to dispatch. Prioritise the agreed workspace, fleet layout, camera ordering and discovery; retain these extra candidates for subsequent scoped milestones.

### Later upgrade: camera-based failure detection

User supplied an AI failure-detection reference and recalls discussing it previously. Keep this as a later milestone. Proposed progression: detect suspected spaghetti/detachment in camera images, show an annotated evidence snapshot and alert, then consider optional per-printer automatic pause after supervised validation. Confidence is a model score, not proof; avoid promising instant or universal detection. Require repeated evidence, camera freshness checks, false-alarm handling and recorded outcomes. Measure inference cost, latency and host load across multiple cameras before choosing local or remote processing. Reuse supported printer-native detection signals where available. Do not enable physical actions from the design preview.

For implementation changes: preserve existing unrelated work, keep changes reviewable, validate the rendered workflow and relevant behavior, and update `SESSION_NEXT.md` truthfully. Record build/commit state, what was tested, remaining limitations, and whether Pi pull/restart and physical verification are still pending. Do not describe a local preview as a deployed upgrade.

## Still to establish

### Filament and tool remapping

New reference: automatically map each job's required filament to the actual loaded AMS slot or tool. Match material compatibility as well as colour; present the proposed mapping for review and flag missing or ambiguous matches. Slot numbers may differ between printers. Revalidate loaded materials before dispatch. This does not make a printer-specific sliced file portable to another model; printer, nozzle, tool and file compatibility remain separate requirements. Implementation must use each printer adapter's supported mapping mechanism.

### MeshFinder and prepared print library

Reuse MeshFinder's browsing/search foundation. A selected prepared print file should expose available slicer metadata: per-tool material/colour/grams, estimated time, nozzle, layer height and temperatures. Keep the source model distinct from its sliced variants. Plain meshes do not contain those print settings. Provide a path from finding a model to choosing a compatible sliced variant, reviewing filament mapping and adding to the queue. Missing metadata must remain visibly unknown.

- Steve's actual printer count, models, network layout, and hosting hardware.
- Which extra capabilities matter enough to enter the first release.
- Desired grouping scheme: benches, rooms, production roles, or custom groups.
- Supported ejection hardware and the method of confirming that a plate is clear.

These details do not block the current layout and workflow work.

## Verification record

### First implementation, 2 October 2026

Git commit attempt was blocked by permission denied creating `.git/index.lock`, despite granted write access. The implementation remains local and uncommitted; nothing was pushed or deployed.

Local Flightdeck code now includes the combined Movement → Loaded filament → Temperatures & cooling row, upcoming per-printer queue panel, and Fleet Wall remaining-time ordering with drag/keyboard placement and persistent pins. Demo route/telemetry gaps were repaired. Six focused Node tests passed; browser demo confirmed dragging, reset, keyboard placement, reload persistence and H2D/Voron rendering. No physical printer commands were issued. Pi deployment remains unverified and pending. Files/upload remain a link to the existing file workflow; discovery progress and fleet-card expansion are still to implement. SESSION_NEXT.md records this boundary and the next work.

Combined preview checked in the browser: 3/12/48-camera fixtures, visible pin/unpin and restore controls, keyboard placement moving X1C ahead of H2D, fleet search (16 Vorons in the 48-device fixture), and discovery completing with three sample results and two selected new devices. No horizontal overflow in the checked desktop camera wall or 320px viewport; no browser errors were recorded. Dynamic camera actions now have visible text labels. Pointer dragging and the complete pairing flow still require verification. These are simulated UI checks, not evidence of LAN discovery, live streaming, physical control or host fleet capacity. The original printer preview was already checked for layout, queue interaction, hardware selection, and narrow-screen fit.
