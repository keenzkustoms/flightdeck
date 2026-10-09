---

# MakerDeck SESSION_NEXT (active)

## 2026-09-17 — Painter b629 OBJ load

### What
- STL Painter drop zone / browse / batch now accepts **`.obj`** (with STL + 3MF).
- `parseOBJ()` in `js/painter.js` builds the same flat triangle soup as binary STL (fan-triangulates quads/ngons, computes face normals).
- Smoke: `node makerforge/test/painter-obj.mjs`.

### Cache-bust
- Hard refresh **b629** — `painter.html?v=629`, `painter.js?v=629`, Flightdeck shell `app.js?v=737`, MakerDeck index Painter link `painter.html?v=629`.

### Next
- Drop an OBJ → paint → export 3MF as usual. Weird Blender unit scales may still need Flip/Spin after load.

---

## b628 — Deboss cutter manifold fix
**Date:** 2026-09-01

### MakerDeck
- Fixes b627 export failure: `Not a valid manifold mesh (Not manifold) — repair it in Mesh Prep first.`
- Root cause: b627 made the positive `Text inlay` watertight, but the hidden `deboss-cutter` used for body subtraction was still built by the preview extrusion path and was open. `subtractMesh()` correctly rejected that cutter before creating the 3MF.
- Both `deboss-inlay` and `deboss-cutter` now route through MakerDeck's export-grade closed-solid builders. Pocket/inlay dimensions are unchanged.
- Build/cache: MakerDeck `b628`, `geometry.js?v=628`, `features.js?v=628`, `app.js?v=628`.

### Validation / next physical gate
- Runner checks JS syntax, full MakerDeck regression suite, and verifies both deboss modes are classified as export-grade solids.
- Next: re-export the same `COFFEE` test. Expected: no manifold warning and no Mesh Prep error; then inspect Body + Text inlay in Bambu Studio.


## b627 — Close deboss Text inlay solids
**Date:** 2026-09-01

### MakerDeck
- Fixes the second `COFFEE` deboss export failure (3100 open edges on Text inlay).
- Root cause isolated: b626 marked deboss inlays as export-grade, but `buildEmbossText()` still sent them through its preview vector fallback, which caps only the visible/top face. That guarantees an open mesh.
- Export-grade text, including `deboss-inlay`, now uses `buildFlatShapeGroupsSolidMesh()` so every glyph gets a fully closed printable solid. Preview-only vector emboss remains unchanged.
- Build/cache: MakerDeck `b627`, `geometry.js?v=627`, `features.js?v=627`, `app.js?v=627`.

### Validation / next physical gate
- JS syntax + full MakerDeck regression suite pass before commit. Source guard confirms export-grade labels use the closed solid builder.
- Next: re-export the exact same `COFFEE` design. Text inlay must report zero open/non-manifold edges before Bambu Studio inspection.


## b626 — Deboss inlay manifold export fix
**Date:** 2026-09-01

### MakerDeck
- Fixes b625 export warning where `Text inlay` could report thousands of open edges (observed: 2915 on `COFFEE`).
- Root cause: b625 correctly introduced `deboss-inlay` depth, but generated the positive inlay through the preview vector extrusion path. Deboss inlays now count as export-grade labels, so text uses the existing watertight solid/voxel export builder and art uses the corresponding closed export slab path.
- Pocket geometry is unchanged: coloured inlay fills from the pocket floor to the original outside surface; cutter remains 0.05 mm deeper for clean body subtraction.
- Build/cache: MakerDeck `b626`, `geometry.js?v=626`, `features.js?v=626`, `app.js?v=626`.

### Validation / next physical gate
- Runner checks JS syntax, full MakerDeck regression suite, and verifies `deboss-inlay` is routed through `isLabelExport`.
- Next: re-export the same `COFFEE` design. Manifold check must no longer flag `Text inlay`; then inspect Body + Text inlay in Bambu Studio before printing.


## b625 — Deboss pocket + printable colour inlay
**Date:** 2026-09-01

### MakerDeck
- Deboss 3MF boolean-carves the selected cutter from Body before packaging, then exports matching closed text/art inlay bodies in their selected filament colours. A Bambu native negative part is no longer left overlapping the printable inlay.
- Inlay depth follows Deboss depth and finishes flush with the original outside surface. The cutter reaches 0.05 mm deeper for a clean pocket floor.
- Preview shows the printable coloured text inlay instead of the red cutter. Standalone **STL deboss cutter** remains available.
- Build/cache: MakerDeck `b625`, `geometry.js?v=625`, `features.js?v=625`, `app.js?v=625`.

### Validation / next physical gate
- Patch runner performs JS syntax checks plus the full MakerDeck geometry regression suite before committing.
- Next: export Deboss `COFFEE`, open the 3MF in Bambu Studio, confirm Body + Text inlay are separate filament parts and slice flush, then print the small test.


## 2026-08-24 — Mesh Prep Stage 2C planar convex quad repair

### Second repair operation
- `js/sanitiser-core.js?v=5` adds `repairSanitiserBoundaryStage2C()` for one additional conservative case only: a selected simple closed planar convex boundary with exactly four open edges and four vertices.
- The current mesh topology and directed boundary cycle must still match the selection. The quad must be planar within a tight scale-aware tolerance, turn consistently at every corner, and produce two non-degenerate faces. The shorter valid diagonal is used.
- Existing Float32 source coordinates are copied unchanged. Stage 2C appends exactly two triangles and performs no welding, vertex movement, shell joining, arbitrary triangulation, or topology reconstruction.
- Mesh Prep offers **REPAIR SELECTED** for supported three-edge Stage 2B loops and four-edge Stage 2C loops. The shared post-repair gate requires an N-edge cap to add exactly `N-2` faces, remove exactly N open edges, and leave non-manifold edges unchanged.

### Validation
- Deterministic and live-browser quad calibration: faces `10 → 12`, open edges `4 → 0`, boundary groups `1 → 0`, watertight `NO → YES`, and non-manifold edges `0 → 0`; existing source coordinates remain unchanged.
- Derived concave, non-planar, five-edge polygonal, complex/branched, and missing-selection cases are refused.
- Stage 1, Stage 2A, Stage 2B triangular repair, Stage 2B.1 persistent IDs, Auto-Frame, and BING all remain green. Repeatable gate: `node makerforge/test/sanitiser-stage2c.mjs`.

### Stop / Next
- Validate convex quad repair on deliberately broken real meshes. Do not generalise to five-plus-edge polygons yet.

## 2026-08-24 — Mesh Prep Stage 2B.1 persistent boundary IDs

### Identity fix
- Multi-hole live testing exposed display renumbering after each re-analysis: repairing original Boundary 1 left the surviving original Boundary 2 / Boundary 3 labelled Boundary 1 / Boundary 2.
- `meshprep.html` now builds a canonical geometric signature from each loop's topology, edge count, and sorted quantized boundary segments. The first analysis assigns Boundary 1 / 2 / 3; surviving signatures retain those IDs through sequential repairs.
- Persistent labels are used by the Boundary Inspector cards, Auto-Frame/BING status, repair status, and repair-complete summary. The ID map resets only when a genuinely new STL is loaded.
- This was a Mesh Prep UI identity fix only. `js/sanitiser-core.js?v=4` was unchanged by Stage 2B.1; the separate quad-only Stage 2C checkpoint is now recorded above.

### Validation
- `node makerforge/test/boundary-id-regression.mjs` passes: `Boundary 1, 2, 3 → Boundary 2, 3 → Boundary 3`.
- Existing Stage 1, Stage 2A, and Stage 2B suites, all syntax checks, exact supplied-page parity, and `git diff --check` remain green.

## 2026-08-24 — Mesh Prep Stage 2B triangular boundary repair

### First repair operation
- `js/sanitiser-core.js?v=4` adds `repairSanitiserBoundaryStage2B()` for one conservative case only: a selected simple closed boundary with exactly three open edges and three vertices.
- Existing Float32 mesh coordinates are copied unchanged. The operation derives the directed boundary cycle from the current mesh, reverses it for the cap, and appends exactly one replacement triangle. It does not weld vertices, move geometry, join shells, fill larger polygons, or reconstruct topology.
- Complex/branched boundaries, open chains, larger polygonal loops, ambiguous/inconsistent winding, stale selections, and degenerate caps are refused. The UI exposes **REPAIR SELECTED** only when the selected loop passes the same closed triangular gate.
- Mesh Prep re-analyses the candidate before accepting it. Exactly one face must be added, open edges must fall by exactly three, and non-manifold edges must remain unchanged; failure preserves the original current mesh. Success shows a before/after summary and exports with the `_repaired.stl` suffix.

### Validation
- Stage 2B deterministic and live-browser calibration: faces `3 → 4`, open edges `3 → 0`, boundary groups `1 → 0`, watertight `NO → YES`, and non-manifold edges `0 → 0`.
- Repeatable refusal checks pass for the recovered complex/branched boundary and a simple closed four-edge polygon. Existing source coordinates remain byte-for-byte unchanged and exactly nine Float32 values are appended.
- Stage 1 and Stage 2A regression suites remain green without behavioural changes: diagnostic-only analysis, MAJOR 40/120 classification, exact three-edge highlight, complex-topology handling, Auto-Frame, and BING all pass. The sole Stage 2A test compatibility update is the expected Core cache assertion `v=3 → v=4`.
- Repeatable gates: `node makerforge/test/sanitiser-stage2a.mjs` and `node makerforge/test/sanitiser-stage2b.mjs`.

### Stop / Next
- Validate this triangular repair on deliberately broken real meshes. Do not generalise Stage 2B to arbitrary polygon filling yet.

## 2026-08-24 — Mesh Prep Boundary Auto-Frame v2

### Presentation
- Selecting a Stage 2A boundary now highlights the existing open-edge loop and eases the camera to a contextual view before the locator fires. The current view direction is preserved so the model does not unexpectedly flip.
- Framing uses the boundary span with 20% padding, a conservative `1.65x` camera-distance multiplier, and a minimum floor of the greater of `1.25x` boundary span or 40% of the current target distance. This keeps surrounding mesh visible and prevents over-zoom on broad, flat, or tilted openings.
- The Mesh Prep sidebar is narrowed from 300 px to 280 px. A subtle viewport focus treatment marks the framed state, and BING fires only after the 420 ms camera animation settles.

### Safety / Validation
- Presentation only: `js/sanitiser-core.js?v=3` is unchanged. Stage 2A remains diagnostic and performs no hole filling, vertex welding, shell joining, topology reconstruction, or other geometry modification.
- Embedded-module `node --check`, `node makerforge/test/sanitiser-stage2a.mjs`, exact supplied-source parity, and `git diff --check` passed.
- The separate triangular-only Stage 2B checkpoint is now recorded above; Auto-Frame itself remains presentation-only.

## 2026-08-24 — Recovered Mesh Prep Sanitiser Stage 2A

### Recovery
- Restored the surviving Stage 2A Boundary Inspector page and reconstructed the missing `js/sanitiser-core.js?v=3` from the known-good Stage 1 v2 core, the recovered page's exact consumer contract, and the August 20 handoff/calibration.
- Stage 1 behaviour is preserved: only zero/near-zero triangles and duplicate/reversed faces are removable. No vertex welding, hole filling, shell joining, normal reorientation, or topology reconstruction was added.
- Stage 2A is diagnostic only. Open edges are grouped by shared boundary vertices and reported with edge segments, centroid, edge count, perimeter, maximum span, closed/complex topology, classification, and recommendation. Branched/non-loop boundaries are `COMPLEX` and explicitly manual-review only.
- The original v3 implementation was not recoverable. Grouping and fields follow the surviving UI/handoff contract; the exact 40/120 MAJOR calibration is recovered. The conservative `SMALL`/`REVIEW` category thresholds and their recommendation wording are reconstructed/inferred, and do not authorise repair.

### Validation
- Recovered v2 parity passed on all four surviving STL fixtures: every pre-Stage-2 analysis field and every Stage 1 repair result matched.
- Stage 1 calibration passed: 7 faces with 2 duplicate/reversed and 1 degenerate face became 4 faces, 0 open, 0 non-manifold, 0 degenerate, 1 shell, watertight YES.
- Stage 2A calibration passed: 3 faces, 3 open edges, 1 shell, watertight NO, 1 boundary group; Boundary 1 = MAJOR, 3 edges, 40.0 mm maximum span, 120.0 mm perimeter. Analysis left source geometry unchanged.
- Live browser validation against the active checkout confirmed the Boundary Inspector card and filename, correct three-edge highlight, active selection, cyan/orange BING locator animation, status text, and zero console errors.
- Repeatable checkout gate: `node makerforge/test/sanitiser-stage2a.mjs`.

### Stop / Next
- The recovery commit itself included no Boundary Auto-Frame and no Stage 2B geometry repair. Boundary Auto-Frame v2 is now recorded above as a separate presentation-only follow-up.
- Next: validate deliberately holed real-world meshes before designing Stage 2B.

Notes from roughly the last 4 weeks. Older: [../docs/archive/makerforge_SESSION_NEXT_before_2026-06-28.md](../docs/archive/makerforge_SESSION_NEXT_before_2026-06-28.md).

## b623 — Hoodie container loads again
**Date:** 2026-08-19

### MakerDeck
- b622 bumped `hoodie-stubby.js?v=622` in `app.js` but left `geometry.js` / `features.js` on `?v=598`. The STL loaded into one cache; the builder read another (empty). Same bug as b587. All three imports are `?v=623` now.
- Hard refresh MakerDeck **b623** (`app.js?v=623`). Flightdeck iframe `/makerdeck/?v=623`, shell `app.js?v=735`. Click **Hoodie container** again.

## b622 — Preset cleanup: hoodie container, drop Ooshies + Temora Vet
**Date:** 2026-08-19

### MakerDeck
- **Ooshies stand** is off Quick presets (and its settings panel is gone). A saved session on that shape falls back to rounded.
- **Stubby holder** is labelled **Hoodie container** in the UI, stats, status, and export filename (`hoodie-container-…`). Internal id stays `stubbyHolder`.
- **Temora Vet shelf** sample is gone from Signs. Generic **Sign / plaque** stays.
- Hard refresh MakerDeck **b622** (`app.js?v=622`). Flightdeck iframe `/makerdeck/?v=622`, shell `app.js?v=734`.

## b626 — Protected bucket fill and base-colour swap
**Date:** 2026-08-19

### STL Painter
- **Bucket** fills the connected base-model paint region under the click with the active slot. It respects hidden faces and will not cross into stamped artwork.
- **Swap base colours** exchanges two selected paint slots only on the original model. All stamped-artwork faces remain assigned to their existing artwork colours.
- Every ordinary paint and clear path now shares the same artwork lock. Split Painter 3MF imports restore the `object_2` artwork boundary, and a slot still used by artwork cannot be removed accidentally.
- Feature commit `0362a36`. Hard refresh **b626** (`painter.html?v=626`; Painter module `v=624`; Flightdeck shell `app.js?v=733`). Painter-art tests include export/import preservation of the protected boundary.

## 2026-08-19 — Flightdeck Bambu Lab naming and free colour entry
- Flightdeck now stores the printer spelling **Bambu Lab** instead of the old **Bambu** alias, including a startup migration for existing spool/catalogue/cost data. AMS/Queue profile checks recognise both historical spellings so a BigBoy job cannot be blocked solely by `printer Bambu Lab` versus `Flightdeck Bambu`.
- Spool Manager colour names are now literal text fields: no app-side partial-name replacement, datalist, or browser autocomplete. Standard swatch clicks still fill a standard colour name deliberately.
- Feature commit `a149fdf`; hard refresh Flightdeck shell `app.js?v=732` after deploy.

## b625 — Painter artwork moves freely before stamping
**Date:** 2026-08-19

### STL Painter
- The live artwork preview now has a small blue centre target: drag it over the mesh to continuously re-project/move the logo across the fabric. The outer blue ring remains rotation-only, so move and rotate no longer fight each other.
- Size and Rotation readouts are editable numeric fields as well as sliders. Type an exact value and press Enter or click away; both controls remain in sync.
- Feature commit `2093056`. Hard refresh **b625** (`painter.html?v=625`; Flightdeck shell `app.js?v=731`). Painter-art tests, module syntax, and browser control/console checks passed.

## b624 — Painter artwork can be rotated before it becomes geometry
**Date:** 2026-08-19

### STL Painter
- Placing artwork now creates a live, correctly aligned preview instead of immediately changing the mesh. Drag its bright blue rotation ring like a slicer transform control, or use the Rotation slider, then click **Stamp artwork** to create the raised multi-colour geometry.
- After stamping, **Adjust artwork** reopens the same stored position so a logo can be moved or rotated without re-uploading/retracing. **Cancel position** / Escape discards only the pending preview and keeps the prior stamp.
- Feature commit `427432f`. Hard refresh **b624** (`painter.html?v=624`; Flightdeck shell `app.js?v=730`). `test/painter-art.mjs`, module syntax, and browser console smoke passed.

## b623 — Painter 3MF exports contain real body and logo volumes
**Date:** 2026-08-19

### STL Painter
- The b591–b622 split-art exporter accidentally assigned an external 3MF component the same ID as its parent. Studio interpreted that recursive reference as an invalid/zero-volume object: the preview looked correct, but import fell back to geometry-only and removed the stamp.
- Body and logo now use standard distinct parent/resource pairs (`1 → 2`, `3 → 4`), carry the required 3MF `mimetype`, and use the small, printer-neutral Bambu settings shape. The visual decal geometry and colour layers are unchanged.
- `test/painter-art.mjs` round-trips the split 3MF and asserts the non-recursive resources, valid logo plate instance, package mimetype, and neutral configuration. Hard refresh **b623**, reload the model/artwork, stamp, and export a new 3MF. Old b622 downloads cannot be repaired after export.

## b622 — Painter artwork follows curved, reversed-winding meshes
**Date:** 2026-08-19

### STL Painter
- Artwork height sampling now treats triangle winding as import metadata, not as the physical outside of the model. On an STL whose winding was flipped during import or automatic bed orientation, the Painter retains the nearest chest surface rather than falling back to a flat decal that cuts through it.
- The artwork remains a separate, closed raised part (0.04 mm skin gap, 0.72 mm relief) and retains its colour layers for 3MF export. `test/painter-art.mjs` covers the reversed-winding curved-chest case.
- Hard refresh **b622** (the Flightdeck Painter frame now loads `painter.html?v=622`; static shell `app.js?v=728`), reload the model, then place and export a new stamp. Existing exports retain their old geometry.

## b621 — Hoodie crest sits on the fabric, not carved into Body
**Date:** 2026-08-18

### MakerDeck
- Export CSG was cutting the panther out of the hoodie (Fusion embedded-logo look, rough print). Body is the original mesh; art is a ~0.84 mm decal on the chest. Red/black still trimmed so they don’t share voxels. Hard refresh **b621**. Re-export.

## b620 — Print-safe cleanup for hoodie bitmap logos
**Date:** 2026-08-17

### MakerDeck
- Back lettering stays on the fine vector-text path. Multi-colour PNG logo layers on the hoodie now resample to a nozzle-appropriate grid, close one-cell anti-aliasing cracks, and remove disconnected sub-nozzle dust before their closed, supported H2C volumes are built. This cleans the detailed front crest without altering the correct b619 left/right filament grouping, purge matrix, tower placement, or time calculation.
- `test/manifold.mjs` now covers a dense two-colour hoodie crest-style bitmap and asserts both cleaned colour volumes remain watertight. Hard refresh **b620** and export a new 3MF; an existing b619 download retains its old crest mesh.

## b619 — H2C purge matrix and tower position
**Date:** 2026-08-17

### MakerDeck
- b618 restored correct left/right grouping, but its imported project omitted the two 3×3 H2C purge matrices and their two nozzle multipliers. Bambu therefore divided an empty matrix while calculating the Preview panel: `inf` / `-NaN` filament totals, no total time, and detached vertical prime-tower toolpaths. b619 writes both native matrices, `0.4` multipliers, H2C nozzle purge data, prime volumes, and an explicit plate-bound tower position while retaining b618's right-nozzle mapping.
- `test/h2c-3mf.mjs` locks the 18-entry H2C matrix, the two multipliers, and tower coordinates. Reload **b619** and export a new 3MF; b618 exports cannot gain these values after import.

## b618 — H2C slice was remapping RHS grouping to left
**Date:** 2026-08-17

### MakerDeck
- Dual nozzles aren’t the difference. The 6 Jul vase that sliced with a right nozzle had `flush_into_infill=0`, H2C per-nozzle printable areas, and HT-left AMS banks. Tonight’s vase flushed extras into infill and omitted those zones, so H2C slice parked everything on the left. Hard refresh **b618**. Re-export.

## b617 — H2C hoodie: native volume metadata for Preview
**Date:** 2026-08-17

### MakerDeck
- Direct comparison with a Bambu Studio-saved H2C hoodie project showed why b616 could look correct in Prepare while Preview assigned all geometry to left white: its linked meshes lacked the native parent extruder, per-volume assemble rows, object-model Bambu version metadata, and singular project-level `filament_volume_map`; its H2C AMS-bank order was also reversed. b617 writes those native bindings while retaining b616's one parent, non-overlapping Body / Art Red / Art Dark grey geometry.
- `test/h2c-3mf.mjs` now checks every Preview-critical binding. Reload **b617**, export a new 3MF, and slice that new file; previous downloads cannot gain the missing metadata.

## b616 — H2C hoodie: one linked parent model, no runner
**Date:** 2026-08-17

### MakerDeck
- b615's separate Body / Art Red / Art Dark grey objects (and its in-air runner) reproduce the Bambu conflicts, floating-region warnings, and all-white single-nozzle slice. Hoodie export is back to one Bambu parent model containing three linked volume meshes: CSG removes red/black space from the white body, trims colour-to-colour collisions, and writes the H2C left/right map (`1 2 2`). No plate runner or independent art object is emitted.
- The root model carries `MakerDeck-Export=H2C-single-parent-volumes-b616`, and `test/h2c-3mf.mjs` asserts that the only printable build item is the parent object. Re-export after loading **b616**; old b615 files are structurally invalid for this workflow.

## b615 — Hoodie runner in front of the crest
**Date:** 2026-08-17

### MakerDeck
- b613 sprue punched through Body (layer 79 conflict) and did not touch the crest (empty layers / floating grey) so slice dropped colour. Separate objects again (b606 colours); art sits on the surface; 1.6 mm runner in the air in front of the chest with a joining bar. Hard refresh **b615**. Re-export.

## b614 — Restore STL Painter tool navigation
**Date:** 2026-08-17

### MakerDeck
- The Painter UI restore had removed its Home and cross-tool links. Its header now links to Container, Paper3D, Mesh Prep, and Chop, with the active tool marked; the shared navigation/build labels are b614. At desktop width the links stay in the header; below 900px only the active tool remains visible.
- Hoodie H2C export no longer creates b613's disconnected plate-to-crest sprues. The white body, red art, and dark-grey art are linked non-overlapping Bambu volumes in one printable hoodie object; the body is CSG-cut around art, red/black are trimmed apart, and the per-plate `filament_volume_maps` are written with the left/right filament map. The MakerDeck status reports the three actual output volumes rather than the pre-merge PNG trace layers. Re-export: older b613 files cannot be repaired into this structure.
- Added `test/h2c-3mf.mjs` to lock the H2C project structure (three linked volumes, `1 2 2` nozzle map, `0 0 0` volume map, no sprue). Also fixed the documented no-font headless text-export path so the full geometry gate can run.
- Verified live HTTP paths for Container, Painter, Paper3D, Mesh Prep, Chop, and the shared navigation assets. Browser-console and rendered-layout verification remain pending because the local Browser component is unavailable.

## b613 — Hoodie H2C object extruders + sprues
**Date:** 2026-08-17

### MakerDeck
- Assembled volumes / paint still sliced as filament 1 on H2C (crest visible as grey relief, right nozzle empty). H2C only honours per-object extruders. Separate objects again; continuous sprue from plate to crest (empty-layer skip was dumping the art); CSG gap between red and black on the right nozzle. Hard refresh **b613**. Re-export.

## b612 — Hoodie one object, one volume per colour
**Date:** 2026-08-17

### MakerDeck
- b611 separate objects coloured in Prepare then slice failed (Art Red <-> Dark grey conflicts, Art Red 3 floating, empty layers from the bed foot). Merge same-colour meshes; export as one assembled object. Hard refresh **b612**. Re-export.

## b611 — Hoodie separate objects + bed foot
**Date:** 2026-08-17

### MakerDeck
- H2C ignores assembled/painted volume extruders. b606 separate objects coloured correctly then dropped the crest. Art meshes get a hidden foot at body Z so `ensure_on_bed` cannot dump them. Hard refresh **b611**. Re-export.

## b610 — Hoodie volumes in one object_1.model
**Date:** 2026-08-17

### MakerDeck
- b609 wrote one `.model` file per colour; Bambu Studio binds part extruders from a single `object_1.model`. Same all-white H2C slice. Hard refresh **b610**. Re-export.

## b609 — Hoodie native Bambu volumes
**Date:** 2026-08-17

### MakerDeck
- Mid-plate placement was not the empty-nozzle bug. H2C does not treat triangle paint as volumes; separate objects dropped the crest. Hoodie 3MF is now production volumes (`3D/Objects/object_N.model`) under one assembled parent. Hard refresh **b609**. Re-export.

## b608 — Hoodie in the dual-nozzle zone
**Date:** 2026-08-17

### MakerDeck
- H2C showed right nozzle empty because the hoodie sat on “Left nozzle only area” (origin). Assemble-only transform, dual overlap 25–325 mm. Hard refresh **b608**. Re-export.

## b607 — Hoodie logo painted on one object
**Date:** 2026-08-17

### MakerDeck
- b606 separate objects dropped the crest off the chest (red crumbs at the hem, 3-colour tower). One object again; art triangles carry paint_color. Hard refresh **b607**. Re-export. Do not click Repair.

## b606 — Hoodie colours as separate objects
**Date:** 2026-08-17

### MakerDeck
- H2C sliced the assembly as filament 1 only (right nozzle empty). Body/art/text are separate assembled objects with their own extruders. Hard refresh **b606**. Re-export.

## b605 — Hoodie AMS HT on left only
**Date:** 2026-08-17

### MakerDeck
- All three filaments showed HT-A because the 3MF had no `extruder_ams_count`. Left = AMS HT, right = regular AMS. Hard refresh **b605**. Re-export.

## b604 — Hoodie dual nozzle (white left, art right)
**Date:** 2026-08-17

### MakerDeck
- b602 pinned all slots to the left, so AMS HT white + right-nozzle red/black showed an empty right nozzle. Body → left, red/black → right, tower on. Hard refresh **b604**. Re-export.

## b603 — Hoodie dark grey stays black
**Date:** 2026-08-17

### MakerDeck
- b602 merged `Art Dark grey` into the body (knight on white). Dark grey/black now keep their own filament. Hard refresh **b603**. Re-export.

## b602 — Hoodie: no prime tower, colours on left
**Date:** 2026-08-17

### MakerDeck
- 20h slice was 8 filaments with 2–8 on the right nozzle + stock 0.24mm Standard tower. Merge similar reds/pinks (cap 4), map every slot to left, `enable_prime_tower=0` listed in `different_settings_to_system`. Hard refresh **b602**. Re-export. Do not click Set to Optimal.

## b601 — 3MF is H2C 0.24mm Standard
**Date:** 2026-08-17

### MakerDeck
- Invalid config: 3MF now has `BambuStudio-01.09.00.00`, `from: project`, dual `nozzle_diameter` + `extruder_type`. Process is **0.24mm Standard @BBL H2C** (fastest system preset Chris has). Hard refresh **b601**. Re-export.

## b600 — Hoodie 0.4 stamp fills; H2C 0.4 config
**Date:** 2026-08-17

### MakerDeck
- Slice cracks: stamp was 0.62 mm (one 0.4 mm line). Export is ~0.90 mm. 3MF printer is **H2C 0.4** + **0.20mm Standard @BBL H2C**. Hard refresh **b600**. Re-export. Do not click Repair.

## b599 — Close hoodie Body 3-open
**Date:** 2026-08-17

### MakerDeck
- 3MF peel punched a hole in duplicate hoodie faces. Strip dups first. Hard refresh MakerDeck **b599**. Re-export. Do not click Repair.

## b598 — Back text uses the chest stamp
**Date:** 2026-08-17

### MakerDeck
- Front is close (Y-stamp + 5-pass blur). Back now uses that same setup on the outer rear skin — Face → Back, type in Text. PNG stays on the chest. Hard refresh MakerDeck **b598**. Re-click Stubby holder.

## b597 — No back text on the stubby holder
**Date:** 2026-08-17

### MakerDeck
- Rear text on the well kept clipping and crumpling. Face is chest only — type or drop a PNG there. Hard refresh MakerDeck **b597**. Re-click Stubby holder.

## b596 — Back text wraps around the well
**Date:** 2026-08-17

### MakerDeck
- Y-stamping LITTLE into the cylindrical back crumpled the letters. Back face is an arc-length cylinder at `backY`. Type in Text, Face → Back. Front unchanged. Hard refresh MakerDeck **b596**. Re-click Stubby holder.

## b595 — Back text uses the same stamp as the chest
**Date:** 2026-08-17

### MakerDeck
- Normal wrap spiked LITTLE into a comb. Back now stamps like the front (type in Text, offset in Y). Face Front = chest logo or text. Hard refresh MakerDeck **b595**. Re-click Stubby holder.

## b594 — Back letters follow the curve
**Date:** 2026-08-17

### MakerDeck
- LITTLE sat on a flat plane (buried in the middle, floating at L/E). Back field is the un-blurred outer cylinder; stamp offsets along the surface normal. Front unchanged. Hard refresh MakerDeck **b594**. Re-click Stubby holder.

## b593 — Back text stays on the outer fabric
**Date:** 2026-08-17

### MakerDeck
- Back field was mixing the drink-well wall with the outer skin (`y > 2`), so LITTLE stretched through the cylinder. Outer-back only now. Front unchanged. Hard refresh MakerDeck **b593**. Re-click Stubby holder.

## b592 — Undo b591 front spikes
**Date:** 2026-08-17

### MakerDeck
- b591’s front-most chest field sampled the pouch interior and exploded the shield. Restored pocket-close blur. Back drape unchanged. Hard refresh MakerDeck **b592**. Re-click Stubby holder, drop the PNG again.

## b591 — Hoodie letters sit on the pocket, not in it
**Date:** 2026-08-17

### MakerDeck
- LITTLE looked Swiss-cheese because the chest field was averaged behind the kangaroo pocket. Outer envelope + 0.25 mm preview standoff. Hard refresh MakerDeck **b591**. Re-click Stubby holder.

## b590 — Hoodie back text sits on the fabric
**Date:** 2026-08-17

### MakerDeck
- b589’s 0.55 mm embed punched LITTLE through the back in preview. Stamp sits on the fabric; export only overlaps 0.12 mm. Back field keeps the outer envelope. Hard refresh MakerDeck **b590**. Re-click Stubby holder.

## b589 — Hoodie shield stays in the slice
**Date:** 2026-08-17

### MakerDeck
- Export sanitiser skipped the hoodie because it had 0 *open* edges; Bambu still saw 24 *non-manifold* (3+ face) edges. `prepareMeshFor3mf` now peels those. Crest/text embed ~0.55 mm into the fabric so they bond instead of floating. Stamp mask pinches filled. Hard refresh MakerDeck **b589**. Re-export 3MF. Do not click Repair.

## b588 — Hoodie text on the back
**Date:** 2026-08-17

### MakerDeck
- Face dropdown now has Front (chest logo) and Back (text). Logo stays on the chest. Hard refresh MakerDeck **b588**. Art tab → Face → Back — text.

## b587 — Stubby holder loads again
**Date:** 2026-08-17

### MakerDeck
- b586 split `hoodie-stubby.js` into two module caches, so selecting the preset built an empty mesh. One import version now. Hard refresh MakerDeck **b587**. Click Stubby holder again.

## b586 — Hoodie multi-colour 3MF flushes into the body
**Date:** 2026-08-17

### MakerDeck
- 18h slice was 553 AMS swaps into a prime tower (crest spans ~280 layers). Export Body+art as one object, purge into infill, no tower. Hard refresh MakerDeck **b586**. Re-export 3MF. Or in the open slicer: flush into infill/objects, multiplier 0.4, tower off.

## b585 — Hoodie crest is a fine Painter-style stamp
**Date:** 2026-08-17

### MakerDeck
- b584’s 0.22 mm cells + layer-height row banding made ST. GEORGE / ILLAWARRA blocky with scanlines. Chest art is now a shared-vertex shell (same idea as Painter `appendStampHeightfield`), ~0.06–0.11 mm grid, same 0.04 / ~0.72 mm skin. Logo stays a separate colour part. Hard refresh MakerDeck **b585**. Re-click Stubby holder and drop the PNG.

## STOP — 2026-08-17: hoodie crest still not crisp
**Date:** 2026-08-16 (parked)

### MakerDeck
- b584 made the stamp *thin* like Painter but **not crisp**. 0.22 mm cells + `DECAL_LAYER_MM` row banding = blocky ST. GEORGE and horizontal scanlines. Same class of bug as Painter b589 (per-cell prisms) / b590 (painted hoodie tris → spikes).
- Tomorrow: drop the 0.22 mm hoodie override; use fine voxels or `appendStampHeightfield`; keep 0.04 / 0.72 skin; never paint hoodie triangles. Details in root `SESSION_NEXT.md`.

---

## b584 — Hoodie stamp matches STL Painter
**Date:** 2026-08-16

### MakerDeck
- Logo was a chunky sawtooth brick. Now a thin Painter-style decal: 0.04 mm skin, ~0.72 mm thick, smoothed chest field, ~0.22 mm cells. Hard refresh MakerDeck **b584**. Re-click Stubby holder and drop the PNG.

---

## b583 — Hoodie 3MF keeps the logo standing in Bambu
**Date:** 2026-08-16

### MakerDeck
- Preview looked great; Bambu said invalid config / zero volume, then showed a blank hoodie on its back. Export the chest art as closed proud solids and as separate 3MF objects (geometry-only import still keeps the picture). `auto_drop=0` so it stays upright. Hard refresh MakerDeck **b583**. Download 3MF from MakerDeck again.

---

## b582 — Hoodie stamp follows the pocket, not a flat chest plane
**Date:** 2026-08-16

### MakerDeck
- Side view still showed a step: hole-close flattened the logo onto the chest while the pocket stuck out. Drop the flatten; fill openings with the front-most neighbour; sit ~0.85 mm proud. Hard refresh MakerDeck **b582**. Re-click Stubby holder and drop the PNG again.

---

## b581 — Hoodie chest stamp is shallow, not a pocket carve
**Date:** 2026-08-16

### MakerDeck
- The WAK logo was boolean-carved into the kangaroo pocket because drape sampled the pouch interior. Hole-close the chest heightfield, sample it in `mapPoint` (~0.18 mm proud), default `embossDepth` 0.4 mm. Hard refresh MakerDeck **b581**. Re-click Stubby holder and drop the PNG again.

---

## b580 — Stubby holder no longer crashes on round1
**Date:** 2026-08-16

### MakerDeck
- Clicking the preset threw `round1 is not defined` (helper got dropped when chest drape landed). It’s back. Hard refresh MakerDeck **b580**.

---

## b579 — Hoodie logos sit on the chest, not in front of it
**Date:** 2026-08-16

### MakerDeck
- Art was on the belly bounding-box plane, so the logo floated in space. It now drapes onto the chest surface. Hard refresh MakerDeck **b579**. Re-drop the PNG.

---

## b578 — Stubby holder is the Panthers hoodie
**Date:** 2026-08-16

### MakerDeck
- Quick preset **Stubby holder** loads the hoodie mesh (150 mm tall, 65 mm well), not the parametric can cup. Art tab stamps the chest as Body + Art, same as other MakerDeck boxes. Hard refresh MakerDeck **b578**.

---

## b577 — Stubby holder preset is back (wrap art on the cup)
**Date:** 2026-08-16

### MakerDeck
- Parametric drink holder is a Quick preset again so logos can be tested the same way as other wrap-art shapes. Can (375 ml) or Bottle (350 ml stack), Easy 68 mm / Snug 67.5 mm. Art tab PNG wraps the cup wall. Export ZIP: base + stack 3MF. Hard refresh MakerDeck **b577**.

---

## b591 — Painter logo is its own part, not painted hoodie triangles
**Date:** 2026-08-16

### MakerDeck
- Painting the chest mesh made the St George crest grow jagged red spikes. The logo sits on the surface again and exports as a second 3MF object so slice keeps it. Hard refresh Painter **b591**. Reload the STL, stamp once, export. Preview: **Filament**, not Line Type.

---

## b590 — Painter logos survive Bambu slice
**Date:** 2026-08-16

### MakerDeck
- Prepare showed the crest, Preview did not (almost no filament changes). The stamp floated off the chest as a thin wafer. It now embeds into the hoodie, stacks ink on the plate, and paints the chest triangles so Studio keeps the colours. Hard refresh Painter **b590**. Reload the STL, stamp once, export. Preview colour mode: **Filament**, not Line Type.

---

## b589 — Painter 3MF export no longer writes a 0-byte file
**Date:** 2026-08-16

### MakerDeck
- Logo stamps were one prism per cell (the white crest plate exploded into millions of faces). Export crashed after the save picker created the file, leaving a 0-byte 3MF that slicer and Painter both reject. Stamp is now a shared heightfield, grid is capped, empty exports are rejected. Hard refresh Painter **b589**. Those 0-byte files cannot be repaired — reload the STL, stamp once, export again.

---

## b588 — Painter sits logos on the hoodie, not through it
**Date:** 2026-08-16

### MakerDeck
- Artwork stamp follows the chest surface and sits on top (~0.32 mm) instead of a flat slab cutting into the hoodie (the Fusion “embedded panther” look). Pale grey fringe/under-layers are dropped. Hard refresh Painter **b588**. Reload the STL, stamp once.

---

## b587 — Painter stops restamping the grey PNG fringe
**Date:** 2026-08-16

### MakerDeck
- Logo stamp no longer falls back to the raw PNG (that was putting the grey halo back after scrub). Grey layers + border-connected grey pixels are dropped; the white crest plate stays; 1px saw-teeth on the plate are opened off. Hard refresh Painter **b587**. Reload the STL, stamp once.

---

## b586 — Painter clips logos to the ink island
**Date:** 2026-08-16

### MakerDeck
- Team-logo stamp clips to the sealed red/black outline (grey halo outside the shield is punched) and uses majority downsample so fringe doesn't fatten. Hard refresh Painter **b586**. Reload the STL, stamp once.

---

## b585 — Painter floods PNG paper, replaces old stamp
**Date:** 2026-08-16

### MakerDeck
- Logo stamp knocks out border-connected grey/white from the **source pixels**, then replaces any previous stamp mesh. Hard refresh Painter **b585**. Reload the STL, drop the logo, stamp once.

---

## b584 — Painter punches grey halo around logos
**Date:** 2026-08-15

### MakerDeck
- Grey mat/halo around a team logo is flooded from the image edge (grey/empty only) so the jagged silver fringe goes; crest white/red/black stays. Hard refresh Painter **b584**. Undo the previous stamp first.

---

## b583 — Painter drops grey logo mat
**Date:** 2026-08-15

### MakerDeck
- Multi-colour AMS stamp no longer extrudes the grey PNG bounding box. Edge-hugging grey/white paper is scrubbed; the crest stays. Hard refresh Painter **b583**.

---

## b582 — Painter uses MakerDeck multi-colour team-logo trace
**Date:** 2026-08-15

### MakerDeck
- STL Painter Artwork runs the same **Multi-colour — team logo (AMS)** trace as Art on box, then stamps those ink layers as raised slabs.
- Grey paper/mat is dropped by the trace. Threshold + Invert included. Hard refresh Painter **b582**.

---

## b581 — Painter artwork is MakerDeck slabs, not face paint
**Date:** 2026-08-15

### MakerDeck
- STL Painter stamps a **raised logo mesh** (~0.28 mm slabs, same idea as MakerDeck face decals) instead of painting the hoodie’s coarse triangles.
- Logo colours become real geometry + AMS slots. Undo restores the mesh. Hard refresh Painter **b581**.

---

## b580 — Painter stamp: Fine auto + no fringe shards
**Date:** 2026-08-15

### MakerDeck
- Artwork stamp auto-upgrades to **Fine** (Ultra if still chunky) so logos aren't triangle-shattered.
- Face must be mostly on solid logo pixels (not one grazing vertex). Anti-alias white/grey/blue fringe is ignored.
- Re-stamp wipes the stamp rectangle first. Hard refresh Painter **b580**.

---

## b579 — Painter PNG/JPG artwork
**Date:** 2026-08-15

### MakerDeck
- STL Painter Artwork accepts **PNG / JPG / WebP / GIF** as well as SVG. Same click-to-stamp.
- White paper knockout for photos (toggle). Logo colours come from the image palette.
- Hard refresh Painter **b579**.

---

## b578 — Painter SVG artwork stamp
**Date:** 2026-08-15

### MakerDeck
- STL Painter Paint tab has **Artwork**: drop an SVG, size/rotate, then click the model to stamp it as face paint.
- **SVG colours** maps fills onto AMS slots (adds slots as needed). **Active slot** stamps a silhouette in the current colour.
- Ghost preview follows the cursor. Hard refresh Painter **b578** (`painter.html?v=578`).

---

## b577 — Painter Flip + Chop socket seating
**Date:** 2026-08-13

### MakerDeck
- Auto-orient no longer treats a recessed Chop connector as the bed — it scores the dominant flat so a cut neck lands down, not the snout.
- **Flip over**, **Spin 90°**, **Roll 90°** on the Model tab and a toolbar **Flip** button.
- Hard refresh Painter **b577**.

---

## Chop — Flexi range + Flightdeck tab
**Date:** 2026-08-13

### MakerDeck
- Flexi Cut / Number of planes max **256** (was 64). Adjust-plane slider uses 0–1000 so you can nudge a plane along the full piece more precisely.
- Chop has its own Flightdeck sidebar tab (`#/chop` → `/makerdeck/chop.html`), same as STL Painter. MakerDeck nav still links to it. Flightdeck commit `f654a16`.

---

## Chop — tidy UI, finish by default
**Date:** 2026-08-12

### MakerDeck
- Chop sidebar: Load → Setup → Cut → Finish → Pieces.
- Connectors + part numbers default **on**, applied after every cut.

---

## Chop — LuBan-style single connectors
**Date:** 2026-08-12

### MakerDeck
- Add Connectors no longer tiles a dense peg grid. Matches LuBan: **one** tapered peg/socket per shared cut face, sized from the face (bigger piece → bigger connector).
- `planSingleConnectorSite` + `maxSites: 1` default in `buildConnectorMeshes`; width ~85% of min dim on small faces, ~35% on large, shrink-to-fit for organic boundaries.
- Hard refresh Chop (`mesh-cut.js?v=17`). Tests updated in `chop-manifold.mjs` (203 pass).

---

## Chop — plane-cutting tool (Phase 1)
**Date:** 2026-08-04

### MakerDeck
- New tool **Chop** (`chop.html`) — load an STL/OBJ, scale to a target size (mm/cm/m/in, printer-bed prefill), cut it with a straight (axis slider) or angled (drag gizmo) plane, live clipping-plane preview, undo, per-piece bed-fit pill, per-piece STL export.
- New from-scratch plane-cutting core (`js/mesh-cut.js`): triangle-plane clip + loop-chaining (handles disjoint/multi-loop cuts) + earcut capping (hole support for tube-like cross-sections) + weld/verify. No CSG existed in the repo before this. Covered by `test/chop-manifold.mjs` (axis-aligned, angled, vertex-through, multi-loop, chained cuts — all 0 open edges, wired into `test/run.sh`).
- New STL (binary+ASCII) + OBJ loaders (`js/mesh-import.js`) — neither existed before.
- New backend `GET /api/printers/bed-sizes` (reads `printers.yaml` `build_volume`) feeds the bed picker/prefill.
- Registered in shared MakerDeck nav (`js/nav.js`); `js/stl.js`'s `weldMeshVertices` exported for reuse.
- Deferred to a later session: connector pegs/sockets between cut faces, embossed part-number stamping, batch folder/zip export (per-piece export only for now).
- Verified via automated tests + a headless-Chrome scripted pass (load → cut → undo → angled cut → export), not yet a manual hands-on pass. **Backend restart required** (new route).

---

## b576 — Ooshies stand matches reference scale + photo
**Date:** 2026-07-28

### MakerDeck
- Retuned Ooshies stand to ~**218×93×244 mm** (peg Ø6.5 reference) with deep base tongue, rear-aligned shelves, bigger side pills, 7 upper shelves.
- Default figure gap **28 mm** (matches that height); raise clearance for taller Ooshies.
- Hard refresh `app.js?v=576` / **b576**.

---

## b575 — Ooshies stand generator
**Date:** 2026-07-28

### MakerDeck
- New **Ooshies stand** preset: multi-tier peg rack sized from peg Ø 6.5×10 mm and 40–50 mm figure height (52 mm shelf gap).
- Kit join: shelf end tabs → side-panel slots (~0.25 mm fit). Export = Side L/R + Base + Shelves.
- Hard refresh Container Generator `app.js?v=575` / build **b575**.

---

## b574 — Log-scale brush / nozzle size
**Date:** 2026-07-25

### MakerDeck
- Brush Size and Spray Nozzle sliders are now **logarithmic** so small nudges stay in the fine range instead of jumping tiny → huge.
- Brush maps ~0.2–12 mm (default 1.0); nozzle ~0.5–16 mm (default 4.0).
- Hard refresh Painter build **b574**.

---

## b573 — Freehand brush stops on mouse-up + less lag
**Date:** 2026-07-25

### MakerDeck
- Freehand brush/spray now ends immediately on mouse/touch release (capture-phase window `pointerup`, abort in-flight samples).
- Much less lag while dragging: max 8 dabs/move (was 96), live colour tint instead of full mesh recolour, skip already-painted faces, reuse brush visit stamps (no huge alloc per dab).
- Hard refresh Painter `painter.js?v=573` / build **b573**.

---

## b572 — Fix Smart fill sprawl (classic facing patch)
**Date:** 2026-07-25

### MakerDeck
- Smart fill was painting roofs + pillars together: **Wrap** defaulted on and used 3D air-distance, so nearby posts inside the Size ball got flooded.
- Restored classic Orca-style default: Wrap **off**, Angle **40°**, Size **8mm** — paints the facing patch only.
- Wrap mode (optional) now walks **surface path** distance + local normals, so it can follow posts without jumping through open air.
- Hard refresh Painter `painter.js?v=572` / build **b572**.

---

## b571 — Rebuild STL Painter paint core
**Date:** 2026-07-25

### MakerDeck
- Rebuilt paint interaction to restore the original workflow: **hide colour (hard mask) → paint → Show All Hidden**.
- Brush/spray use one start/move/end stroke path; OrbitControls disabled during the stroke; removed fighting mouseup/touchend kill switches.
- Smart fill now respects hidden faces as hard masks (`canUseFace`) — fill cannot bridge through a hidden colour.
- Clean Edge: click selects the fringe (magenta); **Fill** / **Clear** buttons commit (no auto-apply on click).
- Hard refresh Painter `painter.js?v=571` / build **b571**.

---

## b570 — Shelf slot base (solid → 0.2 mm floor)
**Date:** 2026-07-25

### MakerDeck
- Edit shelf **Slot base** slider: from shelf thickness (**no slot** / solid) down to a **0.2 mm** floor under the press-fit pocket.
- Slot is never a through-hole — minimum base stays 0.2 mm no matter how thick the shelf is.
- Hard refresh `app.js?v=570` / `style.css?v=570` / `geometry.js?v=570` / `signs.js?v=570`.

---

## b569 — Shelf length slider to 200 mm
**Date:** 2026-07-25

### MakerDeck
- Raised Edit shelf **Shelf length** max from 120 mm to **200 mm** (slider + geometry clamp).
- Hard refresh `app.js?v=569` / `style.css?v=569` / `geometry.js?v=569`.

---

## b568 — Hidden colours mask brush strokes
**Date:** 2026-07-25

### MakerDeck
- Fixed STL Painter brush/spray dabs so hidden colours act as hard masks while painting.
- This restores the intended workflow: hide the white colour, switch to brown/orange, paint the visible edge, then show hidden colours to keep the white section clean.
- Brush stroke status now counts only faces that were actually painted, not hidden faces that were skipped.
- Bumped STL Painter cache/build labels to **b568**.

---

## b567 — Stop Find Parts freezing huge Painter models
**Date:** 2026-07-25

### MakerDeck
- Added a safety guard for STL Painter **Find Parts**: live component scanning is skipped above 500k faces unless explicitly forced from the Model tab.
- Paint-tab **Find Parts** now avoids freezing on huge welded models and explains to use **Select → Same Color**, **Hide**, or **Hide Active Colour** instead.
- Model-tab **Find Islands** can still be forced with a warning if a real disconnected-part scan is needed.
- Bumped STL Painter cache/build labels to **b567**.

---

## b566 — Restore Painter visibility workflow
**Date:** 2026-07-25

### MakerDeck
- Restored practical STL Painter visibility controls directly in the Paint tab: **Hide Active Colour**, **Find Parts**, and **Show All Hidden**.
- **Show All Hidden** now clears manual face hides, island/part hides, active-colour hides, and isolate mode in one click.
- Model load, 3MF load, model clear, and paint-resolution upgrades now reset stale hidden-face masks so old hidden state cannot leak into the next job.
- Bumped STL Painter cache/build labels to **b566**.

---

## b565 — Finer Clean Edge default
**Date:** 2026-07-25

### MakerDeck
- Tightened STL Painter **Clean Edge** for detail work: default Width is now **1** instead of 3, with a smaller local search/run so it grabs less of the jagged triangle boundary.
- Reduced the Clean Edge width range to 1–8 so small edge repairs are easier to control.
- Bumped STL Painter cache/build labels to **b565**.

---

## b564 — Clean Edge click modes and smoother brush stop
**Date:** 2026-07-25

### MakerDeck
- Restored STL Painter **Clean Edge** mode behaviour: choose **Fill** for magenta preview or **Clear** for cyan preview, then click the fringe to apply immediately.
- Clean Edge no longer requires highlight-then-Fill for the normal precision workflow.
- Batched brush/freehand mesh refresh during strokes so large models should feel less laggy.
- Hardened brush release with touch/mouse/pointer fail-safes and viewport `touch-action:none` so strokes should stop when a finger is lifted.
- Bumped STL Painter cache/build labels to **b564**.

---

## b563 — Make Clean Edge local again
**Date:** 2026-07-25

### MakerDeck
- Tightened STL Painter **Clean Edge** so hover/click picks the nearest local wrong-colour boundary beside the active colour instead of every matching boundary on a connected wall/roof patch.
- Added a small pointer-local search radius so Clean Edge behaves like a precision repair picker and avoids large crescent selections on angled house surfaces.
- Bumped STL Painter cache/build labels to **b563**.

---

## b562 — Restore Clean Edge boundary picker
**Date:** 2026-07-25

### MakerDeck
- Reworked STL Painter **Clean Edge** so it previews only the wrong-colour band touching the active colour instead of selecting a circular blob around the pointer.
- Clean Edge now floods the clicked wrong-colour patch, finds the boundary beside the active slot, and highlights that repair strip in magenta for **Fill Selection**.
- Added hover preview for Clean Edge while keeping the clicked magenta selection locked long enough to move to Fill/Clear.
- Bumped STL Painter cache/build labels to **b562**.

---

## b561 — Fix Clean Edge click mode fighting Lock
**Date:** 2026-07-25

### MakerDeck
- Clean Edge no longer auto-enables **Lock left-drag** like Lasso/Box.
- Selecting Clean Edge now clears Lock so a normal click runs the edge-fringe preview instead of falling into area-select behavior.
- Clean Edge click-preview now runs regardless of prior Lock state, keeping the intended magenta fringe workflow.
- Bumped STL Painter cache/build labels to **b561**.

---

## b560 — STL Painter fine brush and edge cleanup band
**Date:** 2026-07-25

### MakerDeck
- Added finer brush control: default brush is now **1.0mm**, with **0.1mm** minimum and step for close detail work.
- Smoothed freehand brush sampling so strokes use tighter intermediate points and should no longer jump across gaps.
- Hardened brush stop handling for touch/pen/mouse release, including window-level pointer-up/cancel fallbacks.
- Reworked Clean Edge to select a narrow wrong-colour band beside the active colour, matching the old b408-b410 edge-cleanup intent for rough paint boundaries.
- Bumped STL Painter cache/build labels to **b560**.

---

## b559 — Unify STL Painter Edge preview as magenta selection
**Date:** 2026-07-25

### MakerDeck
- Fixed Edge so both click-preview and Lock + drag-box paths produce the normal magenta selection instead of the old green edge-highlight overlay.
- Edge **Fill** now only commits the magenta selection; **Clear** only clears that preview and does not change paint.
- Bumped STL Painter cache/build labels to **b559**.

---

## b558 — Make STL Painter Edge click-preview usable
**Date:** 2026-07-25

### MakerDeck
- Edge now supports a direct click workflow: click beside a painted boundary and it previews the connected run to the next hard edge in the normal magenta selection colour.
- Edge **Fill** now fills that magenta preview, and **Clear** clears both direct-click previews and the older edge-band preview.
- Kept the old Lock + drag-box edge-band mode for larger boundary searches.
- Bumped STL Painter cache/build labels to **b558**.

---

## b557 — Smarter STL Painter smart fill for posts and awnings
**Date:** 2026-07-25

### MakerDeck
- Added Smart Paint **Wrap around connected edges** so fills can walk face-to-face around posts, pipes, awnings, and other curved/segmented parts instead of comparing every face to the first clicked face.
- Raised Smart Paint's angle range/default to better handle architectural geometry and corrugated surfaces.
- Clarified the Edge tool hint: Edge is for bands around existing painted boundaries, while Smart is the tool for filling connected object surfaces to their edges.
- Bumped STL Painter cache/build labels to **b557**.

---

## b556 — Lay flat models on STL Painter load
**Date:** 2026-07-25

### MakerDeck
- Replaced STL Painter's old render-only `-90°` mesh rotation with a vertex-level orientation pass before seating models on the bed.
- Plate-like models now use their thinnest axis as the bed-normal so shelves/signs land flat when loaded.
- Other models score possible bed-up directions by bottom contact area, preferring already-upright files before falling back to normal STL Z-up.
- Load status now notes when a model was **laid flat**, and STL/3MF/batch paths all use the same orientation step.
- Bumped STL Painter cache/build labels to **b556**.

---

## b555 — Apply 3MF placement on STL Painter import
**Date:** 2026-07-25

### MakerDeck
- Fixed STL Painter 3MF loading so it applies component/build transforms from `3D/3dmodel.model` before seating the mesh on the bed.
- This preserves slicer-stored lay-flat orientation instead of loading transformed 3MF parts on their side.
- Painter now reports when 3MF placement metadata was applied during import.
- Bumped STL Painter cache/build labels to **b555**.

---

## b554 — Export STL Painter as neutral AMS project
**Date:** 2026-07-24

### MakerDeck
- Changed STL Painter's 3MF project metadata to export as a neutral single-nozzle Bambu AMS profile instead of an H2C/H2D dual-nozzle project.
- Removed the H2C/H2D Painter export-profile choices so Bambu Studio stops auto-routing painted colour slots to HT-A or right-nozzle lanes.
- Kept the painted `paint_color` triangle data and filament colours intact; only the slicer import/routing profile changed.
- Bumped STL Painter cache/build labels to **b554**.

---

## b553 — Stop Painter exports forcing H2C HT filament presets
**Date:** 2026-07-24

### MakerDeck
- Changed STL Painter 3MF exports to write plain filament preset names such as **Generic PLA** instead of **Generic PLA @BBL H2C**.
- Removed Painter's `physical_extruder_map` override so Bambu Studio can bind colours to the user's loaded AMS / AMS 2 Pro trays instead of defaulting all imported slots to **HT-A**.
- Kept the H2C printer/process profile on the project, but left filament-source selection to Studio.
- Bumped STL Painter cache/build labels to **b553**.

---

## b552 — Let STL Painter use normal AMS tray mapping
**Date:** 2026-07-24

### MakerDeck
- Fixed STL Painter 3MF exports so painted colour slots use Bambu/Orca **Auto For Flush** mapping instead of hard-pinning every filament to map slot `1`.
- Added Bambu-style plate metadata to Painter exports so slicers see the project as a normal plate/object rather than only a loose painted model.
- Removed HT-specific wording from Painter's colour-slot UI; 16 slots still work for multi-AMS, but exports should no longer default every slot to **HT-A** in Studio.
- Bumped STL Painter cache/build labels to **b552**.

---

## b551 — Add Paper3D solid base protection
**Date:** 2026-07-24

### Paper3D
- Added a **Solid Base Height** control so the lower part of the source STL stays uncut before Paper3D holes/lattice begin.
- Preserves original triangles touching the protected base band, giving slicers a complete manifold first layer without needing bed contact pads.
- Status now reports how many base faces were protected and the effective solid-base height used.
- Bumped Paper3D, Voronoi redirect header, Mesh Prep shared nav import, and shared navigation cache/build labels to **b551**.

---

## b550 — Tune shelf slot fit for printed sign thickness
**Date:** 2026-07-23

### MakerDeck
- Added a separate **Slot fit** control for shelf-display signs so the shelf through-slot can match a measured printed back thickness without changing or reprinting the sign.
- Set the Temora Vet shelf preset to a **5.70mm** slot fit for the measured **5.54mm** printed sign back, giving a snug press-fit allowance.
- Kept the sign back export clean: the slot change only affects the shelf part.
- Bumped MakerDeck, Paper3D, Mesh Prep, shared nav, and geometry cache/build labels to **b550**.

---

## b549 — Give exported text more printable top layers
**Date:** 2026-07-22

### MakerDeck
- Raised the **Emboss depth** control ceiling from **2mm** to **4mm**.
- Increased slicer-facing AMS/text export thickness so text gets at least **0.8mm** of printable cap instead of the old ~0.36mm thin skin.
- Quantises exported label/text depth to 0.2mm layer-friendly steps, with text capped at 1.6mm and graphic art capped at 2.0mm for AMS standoff exports.
- Bumped MakerDeck, Paper3D, Mesh Prep, shared nav, and geometry cache/build labels to **b549**.

---

## b548 — Fix STL Painter clear/reset handling
**Date:** 2026-07-22

### MakerDeck
- Fixed STL Painter reset paths so **Clear Paint** clears selection/paint with one repaint pass instead of doing redundant heavy mesh colour updates.
- Fixed **Clear Model** to dispose the active mesh/wireframe through a shared scene cleanup path before resetting Painter state.
- Cleans up the previous model before loading a new STL/3MF, which helps very large files avoid stale mesh/wireframe leftovers.
- Bumped MakerDeck, Paper3D, Mesh Prep, shared nav, and Painter cache/build labels to **b548**.

---

## b547 — Use neutral STL Painter slot labels
**Date:** 2026-07-22

### MakerDeck
- Changed STL Painter's visible AMS names from box-oriented **Base / Accent / Detail / Trim** to neutral **Filament 1 / Filament 2 / ...** labels.
- Updated Painter status/help text so removed paint returns to **Slot 1**, not "Base".
- Bumped MakerDeck, Paper3D, Mesh Prep, shared nav, and Painter cache/build labels to **b547**.

---

## b546 — Restore current STL Painter UI
**Date:** 2026-07-22

### MakerDeck
- Restored `painter.html` from the current Painter b514 line after the later b539/b545 path had carried forward stale b504-era UI.
- Brings back the b506-b508 Painter features: AMS slot +/- controls, up to 16 HT/multi-AMS filaments, and Replace / Save as export flow.
- Kept current `painter.js` because it already matched the b514 engine.
- Bumped MakerDeck, Paper3D, Mesh Prep, shared nav, and Painter cache/build labels to **b546**.

---

## b545 — Fix STL Painter file loading
**Date:** 2026-07-22

### MakerDeck
- Fixed STL Painter startup so the file loader can initialize when the legacy sidebar toggle is not present in the shared navigation layout.
- Guarded the old `toggleSidebar` binding instead of letting it crash the Painter script before STL/3MF upload handlers finish binding.
- Bumped MakerDeck, Paper3D, STL Painter, Mesh Prep, shared nav, and nested Container module imports to **b545**.

---

## b544 — Restore shelf slot and clean back sign
**Date:** 2026-07-22

### MakerDeck
- Restored the shelf-display shelf part to the b542 straight through-slot design.
- Removed the added tongue/strip from the back sign part; the back sign now uses its own lower edge to press into the shelf slot.
- Disabled default mount/keyhole cutouts on shelf-display backs to remove the black dash artifact.
- Bumped MakerDeck, Paper3D, STL Painter, Mesh Prep, shared nav, and nested Container module imports to **b544**.

---

## b543 — Open shelf sign slot into rear notch
**Date:** 2026-07-22

### MakerDeck
- Changed the shelf-display shelf connector from a closed through-slot to an open rear-edge notch.
- This removes the black line artifact across the shelf face and avoids the extra strip/wall artifact along the shelf edge.
- Kept the simple press-fit design: the shelf notch is still inset **5mm** from both side edges and accepts the back sign's lower tongue.
- Bumped MakerDeck, Paper3D, STL Painter, Mesh Prep, shared nav, and nested Container module imports to **b543**.

---

## b542 — Replace shelf sign dovetail with press-fit slot
**Date:** 2026-07-22

### MakerDeck
- Replaced the shelf-display sign connector with a simple straight press-fit slot instead of dovetail lugs.
- The shelf part now has one equal-width through-slot set **5mm** in from the rear edge and **5mm** in from both side edges.
- The back sign part now gets a matching lower straight tongue so it can push firmly into the shelf slot.
- Bumped MakerDeck, Paper3D, STL Painter, Mesh Prep, shared nav, and nested Container module imports to **b542**.

---

## b541 — Embed shelf sign back receivers
**Date:** 2026-07-22

### MakerDeck
- Fixed the shelf-display **back sign** connector so the receiver brackets bite into the sign face instead of floating with a tiny front air gap.
- This should make the back part show/print as solid receiver sockets that match the shelf lugs, rather than a thin detached-looking fin.
- Updated the shelf hint text: the shelf lugs press straight into the back receivers, not slide in from the side.
- Bumped MakerDeck, Paper3D, STL Painter, Mesh Prep, shared nav, and nested Container module imports to **b541**.

---

## b540 — Rework shelf sign dovetail connectors
**Date:** 2026-07-22

### MakerDeck
- Replaced the shelf-display sign's old full-width side-slide dovetail rail with two straight-in front/back dovetail lugs.
- The shelf piece no longer exposes a long rail end sticking out of the side; the back piece gets matching front receiver brackets.
- Increased dovetail engagement depth and connector meat so the parts come forward further and should be easier to print/check.
- Bumped MakerDeck, Paper3D, STL Painter, Mesh Prep, shared nav, and nested Container module imports to **b540** so cached `signs.js` cannot keep serving the old connector.

---

## b539 — Unify MakerDeck tool build/cache tags
**Date:** 2026-07-22

### MakerDeck
- Moved Container Generator, STL Painter, Paper3D, Voronoi redirect page, Mesh Prep, and shared navigation onto one visible/cache build: **b539**.
- Container now loads `app.js`, `geometry.js`, `features.js`, and `style.css` with the same b539 cache tag so the restored shelf/text UI cannot mix with older cached geometry modules.
- STL Painter, Paper3D, Mesh Prep, and the old Voronoi URL now import shared nav with a b539 cache tag.
- Paper3D STL headers now stamp **MakerDeck Paper3D b539**.

---

## b538 — Restore Container Generator b532 UI
**Date:** 2026-07-22

### MakerDeck
- Restored the Container Generator HTML from the known-good **b532** shelf/text build after a later `index.html` cleanup left the page showing stale **b504** markup.
- Brought back the **Shelf display** controls: Edit back / Edit shelf plus shelf width, length, thickness, and corner sliders.
- Brought back the richer text controls: per-line editor, Add line / plain-text mode, font weight, letter spacing, line spacing, and the b532 sign hints.
- Reapplied the current toolbar links to **STL Painter** and **Paper3D**.
- Bumped the Container Generator HTML/app cache tags and runtime build badge to **b538**.

---

## b537 — Start Mesh Prep lab
**Date:** 2026-07-22

### MakerDeck
- Added a separate **Mesh Prep** lab page at `meshprep.html` and linked it in the shared MakerDeck nav.
- Mesh Prep loads binary STL files, previews them, and reports face count, bounds, average edge length, roughness, open edges, and non-manifold edge estimates.
- Added a Paper3D fit classifier so models can be labelled as direct Paper3D candidates, use-with-care meshes, or meshes that need a proper remesh first.
- This is analysis-only for now; no prepared STL export is exposed until the remesh path is good enough.
- Shared nav build badge updated to **b537**.

---

## b536 — Roll back Paper3D mesh prep experiment
**Date:** 2026-07-22

### Paper3D
- Reverted the b535 **Prepare Mesh / Facet dense STL** workflow after it produced spike/glitter artifacts on the puppy.
- Restored the last stable Paper3D behavior from **b534**: helpers off by default, optional helper size guards, and the previous dense/full-detail generation path.
- Noted outcome: mesh prep needs a real remesh/decimation pipeline rather than the browser clustering shortcut.
- Shared nav build badge and STL export header updated to **b536**.

---

## b535 — Add Paper3D Prepare Mesh workflow
**Date:** 2026-07-22

### Paper3D
- Replaced the vague **Fast low-poly dense STL** checkbox with a **Prepare Mesh** selector.
- Default **Preserve detail** keeps the uploaded STL unchanged for Paper3D generation.
- New **Facet dense STL** mode prepares dense organic models with a controllable **Prep Detail** slider before Paper3D cuts are generated.
- Preparation can be changed after loading an STL without uploading the file again; the original source mesh stays available for preview.
- Shared nav build badge and STL export header updated to **b535**.

---

## b534 — Disable unsafe Paper3D auto supports
**Date:** 2026-07-22

### Paper3D
- Bed contact pads and self-support stilts are now off by default after hard refresh.
- Added model-size guards so optional pads/supports are skipped when they would be oversized relative to the generated Paper3D shell.
- Shared nav build badge and STL export header updated to **b534**.

---

## b533 — Roll back Paper3D fuzzy repair attempts
**Date:** 2026-07-22

### Paper3D
- Reverted the Paper3D geometry core to the last better puppy behavior from **b529**.
- Removed the b530-b532 inward-offset, seam-repair, and cut-boundary cap changes because they increased furry side-wall artifacts on dense organic models.
- Kept the expanded **1200** cell-count range and dense loose-island cleanup from b529.
- Shared nav build badge and STL export header updated to **b533**.

---

## b532 — Cap only true Paper3D cut boundaries
**Date:** 2026-07-22

### Paper3D
- Side-wall caps are now generated only for edges whose endpoints lie on the Paper3D cut boundary.
- Ordinary dense STL triangle seams are no longer capped when they fail to match exactly, reducing hair/fur strips on detailed models.
- Shared nav build badge and STL export header updated to **b532**.

---

## b531 — Reduce Paper3D boundary fins
**Date:** 2026-07-22

### Paper3D
- Boundary side-wall matching now uses scale-aware edge precision instead of a fixed 0.001-unit key.
- Adjacent clipped triangles on dense organic meshes should share edges more reliably, reducing the furry fin artifacts around tails and fur.
- Kept the puppy-friendly default cell count at **500**, while preserving the higher **1200** ceiling for manual testing.
- Shared nav build badge and STL export header updated to **b531**.

---

## b530 — Repair Paper3D outward flakes and seam cracks
**Date:** 2026-07-22

### Paper3D
- Shell body thickness now offsets inward relative to the model center, reducing peeled/flaked faces around tails, fur, and other noisy normals.
- Added a seam repair pass that snaps generated vertices, removes degenerate triangles, and drops duplicate triangles before island cleanup.
- Generation status now reports repaired seam faces when the repair pass removes bad output geometry.
- Shared nav build badge and STL export header updated to **b530**.

---

## b529 — Extend Paper3D fine-cell range
**Date:** 2026-07-22

### Paper3D
- Raised the cell-count slider ceiling from **500** to **1200** for dense/detail-heavy models like the puppy.
- Updated adaptive wall-band scaling so the new higher cell counts keep sensible hole sizing.
- Dense models now use stricter loose-island cleanup to reduce tiny shard artifacts.
- Shared nav build badge and STL export header updated to **b529**.

---

## b528 — Scale-clamp Paper3D thickness for tiny STLs
**Date:** 2026-07-22

### Paper3D
- Added model bounds detection so wall thickness, body thickness, bed pads, and self-supports scale down on tiny-unit STL files.
- Dense organic models no longer get full-size millimetre thicknesses applied when their source dimensions are much smaller than normal printable models.
- Generation status now appends **scale-clamped** when requested settings were reduced to protect model shape.
- Shared nav build badge and STL export header updated to **b528**.

---

## b527 — Make Paper3D dense low-poly opt-in
**Date:** 2026-07-22

### Paper3D
- Added an unchecked **Fast low-poly dense STL** option for users who want speed over shape fidelity.
- Dense STL files now preserve full source detail by default instead of automatically using the clustered low-poly reducer.
- Load status warns when a dense model is kept at full detail because generation may take longer.
- Shared nav build badge and STL export header updated to **b527**.

---

## b526 — Disable blocking Paper3D edge collapse
**Date:** 2026-07-22

### Paper3D
- Removed the synchronous Three.js `SimplifyModifier` edge-collapse pass after it froze dense STL processing in the browser.
- Dense models now use the prior browser-safe clustered low-poly path again while preserving the Paper3D shell/body generation.
- Shared nav build badge and STL export header updated to **b526**.

---

## b525 — Edge-collapse dense Paper3D low-poly
**Date:** 2026-07-22

### Paper3D
- Integrated Three.js `SimplifyModifier` as an edge-collapse refinement step for dense STL inputs.
- Dense models are still first reduced with vertex clustering for browser performance, then refined with topology-aware edge collapse instead of triangle sampling.
- Low-poly status now reports **edge-collapse** when that path succeeds.
- Shared nav build badge and STL export header updated to **b525**.

---

## b524 — Remove sampled low-poly fallback
**Date:** 2026-07-22

### Paper3D
- Removed the b523 sampled low-poly fallback after it made dense models unravel into disconnected surface strips.
- Retuned vertex clustering to start with a much finer grid and search more steps, so dense models can land in a useful middle range without losing continuity.
- Shared nav build badge and STL export header updated to **b524**.

---

## b523 — Fallback sampled low-poly path
**Date:** 2026-07-22

### Paper3D
- Added a sampled low-poly fallback for dense STLs when vertex clustering either over-crushes or refuses to simplify the model.
- Dense models should now consistently show an original-to-working face count instead of falling back to the full high-detail mesh.
- Footer/status text reports whether the low-poly source was **clustered** or **sampled**.
- Shared nav build badge and STL export header updated to **b523**.

---

## b522 — Keep dense low-poly detail
**Date:** 2026-07-22

### Paper3D
- Fixed the b521 auto low-poly pre-pass over-crushing dense models like the border collie puppy down to potato-level face counts.
- Simplification now searches for a working mesh near the target range instead of accepting the first overly coarse vertex-cluster result.
- Result stats now show original-to-working face counts when auto low-poly is applied.
- Shared nav build badge and STL export header updated to **b522**.

---

## b521 — Auto low-poly dense Paper3D inputs
**Date:** 2026-07-22

### Paper3D
- Added an automatic low-poly pre-pass for very dense STLs before Paper3D carving runs.
- Dense inputs above roughly **650k faces** are simplified with vertex clustering and duplicate-triangle removal, targeting about **320k working faces**.
- The footer/status now reports both the original face count and the low-poly working source count when simplification is applied.
- Shared nav build badge and STL export header updated to **b521**.

---

## b520 — Paper3D loads with spin off
**Date:** 2026-07-22

### Paper3D
- Changed the initial viewer state so Spin is off when an STL first loads.
- The Spin toolbar button still toggles rotation manually.
- Shared nav build badge and STL export header updated to **b520**.

---

## b519 — Add Paper3D self-support stilts
**Date:** 2026-07-22

### Paper3D
- Added an **Add self-support stilts** option, enabled by default, to reduce the huge slicer support forest under low overhangs.
- The generator detects downward-facing low shell clusters and adds a limited set of tapered built-in supports as part of the exported STL.
- Support counts are reported in the status text alongside bed pads and cleanup counts.
- Shared nav build badge and STL export header updated to **b519**.

---

## b518 — Restore Paper3D preferred defaults
**Date:** 2026-07-22

### Paper3D
- Fixed the rename feeling different because `paper3d.html` opened with the old generic defaults instead of the carved-shell settings we had been testing.
- Paper3D now defaults to **500 cells**, **3.0mm Wall Thickness**, **1.2mm Body Thickness**, and **80% Randomness**.
- Shared nav build badge and STL export header updated to **b518**.

---

## b517 — Rename Voronoi tool to Paper3D
**Date:** 2026-07-22

### Paper3D
- Renamed the MakerDeck Voronoi tool to **Paper3D** to match the carved/faceted printable-shell effect we landed on.
- Main tool route is now `paper3d.html`; the old `voronoi.html` remains as a redirect for stale links/bookmarks.
- Updated the MakerDeck index link, shared nav label, page title/footer, generate button, STL export filename, and STL header.
- Shared nav build badge updated to **b517**.

---

## b516 — Add Voronoi bed contact pads
**Date:** 2026-07-22

### Voronoi Generator
- Added an **Add bed contact pads** option, enabled by default, to address slicer errors where the Voronoi shell has an empty or fragile first layer.
- The generator now clusters the lowest shell vertices and adds small low-profile circular pads beneath likely foot/contact points.
- Status text reports how many bed pads were added to the exported shell.
- STL export header and shared nav build badge updated to **b516**.

---

## b515 — Separate printable body thickness
**Date:** 2026-07-22

### Voronoi Generator
- Added a **Body Thickness** slider so the preferred carved/faceted Voronoi look can stay while the exported shell gets enough internal meat to print.
- Wall Thickness still controls the visible Voronoi band/hole pattern; Body Thickness now controls the inward shell depth used for solid STL output.
- Default body depth is now **1.0mm** and can be pushed up to **2.0mm** for stronger slicer results.
- STL export header and shared nav build badge updated to **b515**.

---

## b514 — Preserve small Voronoi details
**Date:** 2026-07-22

### Voronoi Generator
- Reduced the loose-island cleanup threshold after b513 could remove valid narrow features such as cow horns/ears/tips.
- Cleanup now only drops tiny dust-sized fragments, preserving small clipped shell components that still belong to the model.
- STL export header and shared nav build badge updated to **b514**.

---

## b513 — Smooth Voronoi shell offset
**Date:** 2026-07-22

### Voronoi Generator
- Replaced the b511/b512 model-center shell offset with smoothed surface-normal offsets so body thickness follows the source mesh instead of forming slabby inward blocks.
- Clipped Voronoi intersection points now interpolate those smooth normals before the inner shell is built.
- Slightly reduced derived shell depth at high Wall Thickness values to keep the new body pass from overbuilding around narrow details.
- STL export header and shared nav build badge updated to **b513**.

---

## b512 — Clean loose Voronoi shell islands
**Date:** 2026-07-22

### Voronoi Generator
- Added a post-generation connected-component cleanup pass after the b511 shell body build.
- Tiny disconnected triangle islands are removed before preview/export, reducing slicer warnings from loose scraps around feet or narrow details.
- Status text now reports when loose faces were cleaned from the shell result.
- STL export header and shared nav build badge updated to **b512**.

---

## b511 — Add controlled Voronoi shell body
**Date:** 2026-07-22

### Voronoi Generator
- Fixed b510 still looking like cut paper by adding a controlled shell-body pass to the clipped Voronoi bands.
- The shell uses a stable model-center inward direction instead of noisy per-triangle STL normals, avoiding the b508 bristle/toilet-brush failure mode.
- Output now includes outer faces, inner faces, and boundary side walls so exported STL has visible body thickness rather than a single surface skin.
- Fixed the adaptive wall fallback variable name while touching the wall-band path.
- STL export header and shared nav build badge updated to **b511**.

---

## b510 — Chunkier Voronoi wall sizing
**Date:** 2026-07-22

### Voronoi Generator
- Retuned the adaptive wall band after comparing our cow output to Voronator: the previous b509 path removed too much material and left thin wire-like strands.
- Wall Thickness now maps to a wider printable-looking Voronoi band, with the adaptive sampler targeting a stronger retained-material ratio on organic meshes.
- Holes mode gets an extra retained-material bias so the result trends toward a perforated shell instead of a sparse lattice.
- Result preview now uses smooth shading again so clipped bands read as rounded material rather than faceted string.
- STL export header and shared nav build badge updated to **b510**.

---

## b509 — Back out unsafe Voronoi solidify
**Date:** 2026-07-22

### Voronoi Generator
- Reverted the b508 inward solid layer after it turned dense organic STLs into long bristle artifacts.
- Restored the safer clipped-surface output so the model keeps the Voronoi hole pattern without exploding normals.
- Current output is a surface/plane-style Voronoi result; real printable strength needs a proper volumetric/remeshing pass rather than per-triangle offsets.
- STL export header and shared nav build badge updated to **b509**.

---

## b508 — Voronoi solid layer strength pass
**Date:** 2026-07-22

### Voronoi Generator
- Inspected Voronator: its public page posts processing to the server and exposes **Number of holes** plus **Thickness of new layer**; it also warns that "Plane only" is not manifold/printable.
- Fixed our result still being weak/stringy by solidifying the clipped Voronoi surface into an inward-offset layer with side faces.
- Wall Thickness now controls both the retained Voronoi band and a derived layer depth, so high settings create a stronger printable shell instead of flat ribbons.
- STL export header and shared nav build badge updated to **b508**.

---

## b507 — Voronoi thicker-wall solid bias
**Date:** 2026-07-22

### Voronoi Generator
- Fixed b506 cutting too much away and producing a stringy lattice when Wall Thickness was high.
- Adaptive wall threshold now scales with the Wall Thickness slider: thin values stay open, while high values keep much more of the original surface for a solid-looking voronoi shell.
- At thick settings (e.g. 3mm) the generator now targets a mostly retained model with holes instead of removing most of the source faces.
- Shared nav build badge updated from stale b504 to **b507**.
- STL export header updated to **b507**.

---

## b506 — Voronoi adaptive wall threshold
**Date:** 2026-07-22

### Voronoi Generator
- Fixed b505 still reporting **0 removed** on very dense organic STLs.
- Wall Thickness is now treated as a maximum band width; the generator samples boundary distances and clamps to a lower percentile when the requested width would keep the entire model.
- Dense models like the 1.9M-face dog should now remove visible cell interiors instead of returning the original mesh unchanged.
- STL export header updated to **b506**.

---

## b505 — Voronoi surface clipping fix
**Date:** 2026-07-22

### Voronoi Generator
- Fixed the generator turning organic STLs into a rounded blob after Generate.
- Replaced centroid-only face classification + inward shell rebuild with continuous nearest-seed boundary evaluation at triangle vertices.
- Triangles are now clipped to the Voronoi wall band on the original STL surface, so the source model silhouette/detail is preserved instead of being re-shelled.
- Removed the dead Shell Thickness control from Voronoi because the fixed path no longer offsets an inner shell.
- STL export header updated to **b505**.

---

## b504 — MakerDeck Cleanup + Voronoi v2
**Date:** 2026-07-22

### MakerDeck Cleanup
- **Shared design system**: Extracted `css/makerdeck.css` — unified tokens, reset, common components (buttons, forms, dropzones, toolbars, status bars, footers)
- **Shared navigation**: Created `js/nav.js` — auto-injecting nav bar with MakerDeck branding + tool links (Container, STL Painter, Voronoi), active state detection
- **Consistent nav bar** across all 3 tools — no more ad-hoc header links bolted on
- **Removed duplicate CSS** from voronoi.html (was copy-pasted from painter.html)
- **Removed ad-hoc links** from index.html topbar and painter.html header
- **Unified grid layout**: All tools use `nav` grid area from shared nav component

### Voronoi Generator v2 (algorithm rewrite)
- **Distance-to-boundary** computation instead of face-adjacency boundary detection — produces smooth, circular holes like the reference bear model
- **Bisector plane** method: for each face, finds the two closest seeds, computes distance to the perpendicular bisector plane between them
- **Double-walled shell**: outer surface + inward-offset inner surface (using vertex normals for offset direction)
- **Rim faces**: quad strips connecting outer to inner surface at every hole edge — makes the mesh printable
- **Better seed spacing**: dart-throwing with rejection sampling for more uniform cell distribution
- Stats panel shows wall faces, rim faces breakdown

---

## b503 — Voronoi Generator + Box Select → Selection System
**Date:** 2026-07-21

### Voronoi Generator (new tool: `voronoi.html`)
- **New standalone tool** — drop an STL, generate Voronoi pattern, export modified STL
- **Two modes**: Surface Holes (punch organic holes through shell) and Wireframe Lattice (keep only cell edges)
- **Controls**: Cell count (10–500), wall thickness, shell thickness, randomness, smooth edges
- **Algorithm**: Poisson-disc surface sampling → face-to-cell assignment → adjacency-based boundary detection → layer expansion for wall thickness
- **Viewport**: Three.js with orbit controls, wireframe toggle, auto-rotate, original/result toggle
- **Export**: Binary STL download
- **Keyboard shortcuts**: F frame, W wire, T spin, G generate, O toggle original
- **Linked from**: MakerDeck index.html toolbar + STL Painter header

### Box Select → Selection System
- Box select now feeds into selection instead of auto-painting
- Enables hiding arbitrary regions on solid (single-island) meshes
- Box tool shows Paint Selection / Hide Selection / Clear / Show Hidden panel
- Updated hint text for box tool

### Workflow for solid models (hide regions)
1. Select the **Box** tool, enable **Lock**
2. Drag a rectangle over the area you want to hide
3. Click **Hide Selection** — those faces disappear
4. Paint the area behind them
5. Click **Show** to bring hidden faces back
6. Export as normal

---

## b502 — Wireframe Overlay + Symmetry Painting + Clear Model Fix
**Date:** 2026-07-19

### New Features

**Wireframe Overlay**
- Toggle button "Wire" in viewport toolbar shows/hides mesh wireframe
- Semi-transparent cyan lines over the solid mesh for edge visibility
- Built from `THREE.WireframeGeometry` — auto-rebuilds when mesh changes
- Helps identify individual faces and geometry structure while painting

**Symmetry Painting (Mirror X)**
- Checkbox "Symmetry paint (mirror X)" in Paint tab
- All brush, spray, smart fill, box select, and click-select painting is mirrored across the model's X center axis
- Symmetry map built on first toggle using spatial grid for O(n) lookup
- Tolerance-based face matching via centroid reflection
- New exported function: `buildSymmetryMap()` in `js/painter.js`

**Clear Model Fix**
- "Clear Model" button now fully resets the app for loading a new file
- Resets file input so the same file can be re-loaded
- Cleans up wireframe overlay and symmetry map
- Resets wireframe toggle and symmetry checkbox state
- All buttons properly disabled, viewport hint restored

### File Changes
- `painter.html`: 2092→2152 lines (+60) — wireframe UI/logic, symmetry toggle, clearModel improvements
- `js/painter.js`: 1244→1314 lines (+70) — `buildSymmetryMap()` with spatial grid acceleration

### Technical Notes
- Symmetry map uses spatial hashing (cell size = 2×tolerance) with 27-neighbour search for O(n) build time
- Mirror axis is computed as midpoint of model's X extent — works for any model position
- Wireframe uses `opacity: 0.18` for subtle overlay that doesn't obscure paint colours
- `paintFacesFree()` now appends mirrored face indices when symmetry is active
---

## b501 — 3MF Import + Clear/Reset Fix
**Date:** 2026-07-19

### New Features

**3MF Import**
- Load previously painted 3MF files back into the painter for continued editing
- File input now accepts `.stl,.3mf` — drag-and-drop or file picker
- Parses ZIP central directory, handles stored and deflated entries via `DecompressionStream('deflate-raw')`
- Reads object model XML with namespace-aware queries for vertices, faces, and `paint_color` attributes
- Maps OrcaSlicer paint codes back to AMS slots: `8`→emboss(slot2), `0C`→deboss(slot3), `1C`→trim(slot4)
- Restores filament colours from `project_settings.config` JSON
- New functions: `unzipEntries()`, `import3MF()` in `js/painter.js`
- New dispatcher: `loadFile()` routes `.3mf` vs `.stl` automatically

**Clear / Reset Overhaul**
- Split into two distinct actions with dedicated buttons in Model tab:
  - **Clear Paint** — removes all paint from the mesh, keeps the model loaded
  - **Clear Model** — removes the mesh entirely, resets all state to initial
- Reset View button now also clears paint (was previously non-functional for paint)
- Clear Paint pushes undo state before clearing

### File Changes
- `painter.html`: 1963→2092 lines (+129) — new clear section UI, loadFile dispatcher, clearPaint/clearModel functions, updated file handlers
- `js/painter.js`: 1104→1244 lines (+140) — ZIP reader, 3MF import parser with paint restoration

### Technical Notes
- ZIP parsing reads central directory for reliable entry offsets (doesn't rely on local headers alone)
- 3MF XML uses BambuStudio namespace: `http://schemas.bambulab.com/package/2021/model`
- Paint code mapping handles the hex encoding OrcaSlicer uses in `paint_color` triangle attributes
- `clearModel()` fully tears down: removes mesh from scene, nulls geometry references, resets masks/islands/undo
### 2026-07-19 — b500: STL Painter overhaul — tabbed layout, click-to-select, mesh islands

Major restructure of the STL Painter. From 2580-line monolith to cleaner modular code.

**Layout:**
- Tabbed left panel (Model / Color / Paint / Export) — no more endless scrolling
- Collapsible sidebar toggle for full viewport mode
- Bottom components panel for mesh island management
- Compact stats in Model tab

**New features:**
- **Click-to-select** tool — click a face to select its connected island or same-color region
- **Mesh islands** — Find Islands detects disconnected components with face counts and bounding box sizes
- **Island management** — select, hide, show, paint entire islands from the bottom panel
- **Break-apart** — per-island operations (hide/paint/select individual mesh components)
- **Flood fill by color** — select all connected faces sharing the same paint slot

**Engine (js/painter.js):**
- `findMeshIslands()` — DFS connected-component detection with bounding boxes
- `buildIslandMap()` — per-face island ID lookup
- `floodFillSameClass()` — flood fill by paint slot
- `selectIsland()` — select all faces in an island

**Preserved:** all existing paint tools (brush, spray, eyedrop, smart, box, edge, detect), 4 AMS slots, resolution upgrade, batch processing, 3MF export, colour presets.

Files: `painter.html`, `js/painter.js`, `SESSION_NEXT.md`.

### 2026-07-19 — b423: STL Painter — unstick orbit + Show all

Controls could freeze after Isolate/Lock (tiny black patch + can’t turn/paint).
- **Unstick** toolbar btn + **Show all colours**
- Right-drag always orbits (Lock no longer freezes the view)
- Alt / Space + drag = orbit while Brush is active
- Esc resets stuck pointer capture
- Cache-bust `painter.js?v=423`

Files: `painter.html`, `js/painter.js`, `index.html`, `js/app.js`, `SESSION_NEXT.md`.

### 2026-07-19 — b422: STL Painter — clearer Hide vs Solo

Solo was confusing (“select black hides everything”). Now:
- Each colour chip has a clear **Hide / Show** button (hides that slot only)
- Solo renamed: “Show only active colour (opposite of Hide)”
- Tip text explains: Solo off → Hide on slot 2 to hide black web
- Cache-bust `painter.js?v=422`

Files: `painter.html`, `js/painter.js`, `index.html`, `js/app.js`, `SESSION_NEXT.md`.

### 2026-07-19 — b421: STL Painter — Freehand brush restored

- **Freehand** is the default stroke (H/V optional only)
- Drag on model paints; empty space / right-drag orbits again
- Smoother free strokes (gap fill + wider angle on curves)
- Brush options sit under Brush type so Freehand is obvious
- Cache-bust `painter.js?v=421`

Files: `painter.html`, `js/painter.js`, `index.html`, `js/app.js`, `SESSION_NEXT.md`.

### 2026-07-19 — b420: STL Painter — left-drag paints, not orbits

Fix: Brush left-drag was also rotating the model (OrbitControls stole the button), which made side panels feel “stuck”.
- Left = paint / select; right-drag = orbit
- Capture-phase pointer claim + window pointerup safety (no stuck capture)
- Sidebars z-index above viewport
- Cache-bust `painter.js?v=420` · shared build **b420**

Files: `painter.html`, `js/painter.js`, `index.html`, `js/app.js`, `SESSION_NEXT.md`.

### 2026-07-19 — b419: MakerDeck — shared build tag

Aligned Container Generator + STL Painter to one build number:
- Container header / `MAKERDECK_BUILD` / `app.js?v=419` → **b419**
- Painter header / `painter.js?v=419` → **b419**
- Fixed stale Container fallback `b368` in `index.html`

Files: `index.html`, `js/app.js`, `painter.html`, `js/painter.js`, `SESSION_NEXT.md`.

### 2026-07-19 — b418: STL Painter — resolution + hide sections (v1 easy)

Dummy-proof paint helpers:
- **Paint detail** Fine ×4 / Ultra ×16 (triangle subdivide, paint preserved)
- **Hide colour** eye on chips + **Solo active colour**
- Advanced tools tucked under “More tools”
- Easy-path tip under Paint
- Cache-bust `painter.js?v=418`

Files: `painter.html`, `js/painter.js`, `SESSION_NEXT.md`.

### 2026-07-19 — b417: STL Painter — Brush / Spray / Eyedropper

Paint menu rebuilt colour-first:
- Colour chips → Brush type (Brush · Spray · Eyedrop)
- Brush: Size + Stroke Free / Horizontal / Vertical
- Spray: Nozzle size + Density
- Eyedropper: click face → active AMS slot
- Smart / Box / Edge / Detect kept as secondary tools
- Cache-bust `painter.js?v=417`

Files: `painter.html`, `js/painter.js`, `SESSION_NEXT.md`.

### 2026-07-19 — b416: STL Painter — 4 AMS colour slots

- Slots 1–4: Base / Accent / Detail / Trim (full AMS)
- Slot 4 paint + undo + smart fill + edge + 3MF (`paint_color="1C"`)
- Aligned slot 3 export code to MakerDeck table (`0C`, was incorrectly `4`)
- Cache-bust `painter.js?v=416`

Files: `painter.html`, `js/painter.js`, `SESSION_NEXT.md`.

### 2026-07-19 — b415: STL Painter — paint-first layout rebuild

Full UI reflow with MakerDeck personality (not Orca clone):
- Flow: **01 Model → 02 Colours → 03 Paint → 04 Export**
- Colours as AMS Slot 1/2/3 (Base / Accent / Detail) — emboss/deboss are export roles, not the app spine
- Tool toggles: Smart fill · Box · Edge · Detect (optional) + Lock view
- Contextual options under the active tool only
- Viewport chrome slim: slot chips + zoom/undo
- Cache-bust `painter.js?v=415`

Files: `painter.html`, `js/painter.js`, `SESSION_NEXT.md`.

### 2026-07-19 — b414: STL Painter — free orbit + Lock, tidy toolbar

- Orbit free by default; **Lock** for precise paint (Box/Edge need Lock to drag)
- Removed Detect Mode dropdown + Edge Cyan/Magenta modes — Fill uses active colour
- Toolbar: Smart fill · Edge · Box · Lock · colours · zoom
- Cache-bust `painter.js?v=414`

Files: `painter.html`, `js/painter.js`, `SESSION_NEXT.md`.

### 2026-07-19 — b413: STL Painter — Orca-style Smart fill

Replaces box-flood for eyes: **Smart fill** tool with **Size (mm)** + **Angle (°)** (sensitivity), amber hover preview + circle cursor, click to paint. **Same colour** stops at emboss rim. Cache-bust `painter.js?v=413`.

Files: `painter.html`, `js/painter.js`, `SESSION_NEXT.md`.

### 2026-07-19 — b412: STL Painter — Flood region only replaces Body (etc.)

**Flood in region** was painting every face in the yellow box (white rectangle over Spidey eye + web). Now it only replaces the chosen class (**Replace Body** default) inside the region — black emboss rim stays. Unconstrained click-flood that would exceed 8% of the mesh is blocked (forces a yellow region). Cache-bust `painter.js?v=412`.

Files: `painter.html`, `js/painter.js`, `SESSION_NEXT.md`.

### 2026-07-19 — b411: STL Painter — Flood fill + region limit

Paint-phase **Flood** tool:
- Click a face → flood connected same paint class with active Body/Emboss/Deboss
- Drag a box → yellow **region** limit; click floods only inside it; **Flood region** paints the whole yellow area
- Eyes workflow: Deboss (white) → box the eye → click the pocket (or Flood region)
- Cache-bust: `painter.js?v=411`. Hard refresh.

Files: `painter.html`, `js/painter.js`, `SESSION_NEXT.md`.

### 2026-07-19 — b410: STL Painter — cyan Emboss / magenta Body edge modes

Edge finder preview splits by intent: **cyan → Emboss** (grow into red, thicken black), **magenta → Body** (grow into black, shave spill). Pick mode, tweak Width, **Fill**. Cache-bust `painter.js?v=410`.

Files: `painter.html`, `js/painter.js`, `SESSION_NEXT.md`.

### 2026-07-19 — b409: STL Painter — Edge finder Fill Body + magenta

Edge band highlight is **magenta** (splits from red/black). **Fill Emboss** thickens black; **Fill Body** shaves black spill back to red. Width grows both ways so either fill works. Cache-bust `painter.js?v=409`.

Files: `painter.html`, `js/painter.js`, `SESSION_NEXT.md`.

### 2026-07-19 — b408: STL Painter — Edge finder (rough emboss cleanup)

New **Edge finder** tool for jagged black/red boundaries:
- Drag a box over the rough emboss edge → cyan highlight of the emboss/body band
- **Width** slider grows the band into the body (red fringe)
- **Fill Emboss** commits the highlight to black; Clear drops it
- Stays in Edge tool after select so you can tweak Width then fill
- Cache-bust: `painter.js?v=408`. Hard refresh.

Files: `painter.html`, `js/painter.js`, `SESSION_NEXT.md`.

### 2026-07-19 — b407: STL Painter — red paint + smoother emboss

Fixes Chris couldn’t paint Spidey red + rough emboss edges:
- Default **Spidey** colours (red body / black emboss / white deboss) + Spidey colour preset
- Labeled Body/Emboss/Deboss paint chips — Body paints whole box (red)
- Constrain falls back to **free paint** when no detected features in the box (Deboss eyes/accents work)
- Box select: front-faces + any vertex in rect (not just centroid)
- Cleaner detect: score neighbour smooth, hysteresis grow, majority filter, stricter ridge tops; Fine detail morph less aggressive
- Cache-bust: `painter.js?v=407`. Hard refresh.

Files: `painter.html`, `js/painter.js`, `SESSION_NEXT.md`.

### 2026-07-19 — b406: STL Painter — better emboss detection

Detection upgrade for fine webbing / logos:
- **Adaptive threshold** (default): Sensitivity = keep top % of raised/sunken face scores (absolute mm toggle still available)
- **Ridge-top preference**: score = displacement × face/offset alignment (less side-wall paint)
- **Morph close / open**: dilate/erode face adjacency to fill pinholes and strip speckles
- Presets: **Fine detail** / **Text / bold** / Custom
- Cache-bust: `painter.js?v=406`. Hard refresh Painter; no backend restart.

Files: `painter.html`, `js/painter.js`, `SESSION_NEXT.md`.

### 2026-07-19 — b405: STL Painter — box paint respects detected emboss/deboss

Box paint with Emboss/Deboss no longer flood-fills the whole rectangle. With **constrain** on (default), it only paints faces inside the box that Detect classified as that feature. Body still fills the whole box (eraser). Feature maps kept separate from paint maps.

### 2026-07-19 — b404: STL Painter — return to Orbit after box paint

Box paint left OrbitControls disabled and toolbar clicks could start a paint drag. After a box paint finishes it auto-switches back to **Orbit**; right-drag orbits anytime in Box mode; toolbar clicks no longer start selections.

### 2026-07-19 — b403: STL Painter — area select + deep zoom

Phase 1 paint studio tools:
- **Orbit** vs **Box paint** tools in the viewport toolbar
- Paint target chips: Body / Emboss / Deboss (active AMS colour)
- Box-drag selects faces by screen projection and paints them
- Zoom-to-cursor scroll, +/−, Frame, double-click zoom-to-point, Undo
- Export enabled after load (manual paint without Detect is fine)

Next: hide / isolate. Files: `painter.html`, `SESSION_NEXT.md`.

### 2026-07-19 — b402: STL Painter — sit models on z=0 bed

Preview was centering the mesh in Y, so half the model sank through the grid. Now:
- Bake print-space seating on load/batch: centre XY, **min Z = 0**
- Viewer maps Z-up → Three.js Y-up (`rotation.x = -90°`) so the grid is the build plate
- Camera frames the seated model

Phase 1 next: area select + deep zoom, then hide/isolate. Files: `painter.html`, `index.html` (STL Painter link), `js/painter.js`.

### 2026-07-19 — b401: STL Painter — detect emboss/deboss and export painted 3MFs

New **STL Painter** page (`painter.html`) with full emboss/deboss detection pipeline:
- Drop an STL, detect raised (emboss) and sunken (deboss) regions via Laplacian smoothing
- Adjustable sensitivity, smoothing iterations, and minimum cluster area
- Three.js 3D preview with per-face colouring (body/emboss/deboss)
- Colour picker with preset swatches for quick filament assignment
- Export OrcaSlicer-compatible painted 3MFs (`paint_color="8"` on emboss triangles, proper BambuStudio namespace, model_settings, project_settings as JSON)
- Batch mode: load a folder of STLs, paint them all with the same settings
- Filament profile presets for BBL H2D, X1C, P1S, A1, generic PLA/PETG/ABS
- Engine extracted to `js/painter.js` ES module for reuse

Linked from Container Generator header toolbar. Files: `painter.html`, `js/painter.js`, `index.html` (painter link).


### 2026-07-17 — b400: Vertical text — uniform letter size across a canister set

Vertical text scaled the whole STACK to the size slider, so a matched set got mismatched letters (COFFEE letters 2.37mm, SUGAR 2.87, MILO 3.59). New toggle **"Same letter size across cans"** (vertical only): the size becomes the per-LETTER height, so every letter is identical and shorter words just take less vertical space (capped to the face so the longest word can't overflow). Verified: COFFEE/SUGAR/MILO all 14.1mm per letter with it on. `state.textUniformSize` + checkbox under Text path. Files: js/features.js, js/geometry.js, js/app.js, index.html (app.js?v=400, features.js?v=400, geometry.js?v=400, header b400).

### 2026-07-17 — b399: Accent band — make the paint-into-wall optional (keep it identifiable)

Painting the accent into the body (b398) made it fast to print but merged it into the Body object, so it couldn't be selected separately in the slicer. Now it's a toggle: **default OFF** = the accent stays a separate part (flush welded ring, identifiable, own filament slot); **ON** = "Weld band into wall (faster print)" paints it through the wall for far fewer colour changes. New `state.accentFastBand` + checkbox under Accent bands. Files: js/app.js, js/geometry.js, index.html (app.js?v=399, geometry.js?v=399, header b399).

### 2026-07-17 — b398: Full-thickness accent band (print-time) + liner deducts lid/insert

- **Accent band painted into the body** (rim/floor bands): instead of exporting a thin proud sleeve that forces a colour change on every layer of the band, the body triangles in the band height range are painted with the accent colour (per-triangle paint_color). Those layers slice as ONE colour = ~2 filament changes for the band instead of ~40. Sequential slots (no slot explosion); verified 2 slots + correct paint codes on nest + non-stack. Inside goes accent-coloured at the band (hidden by the liner). Partial front-face bands still export separate.
- **Liner top reserve** now deducts whatever intrudes into the cavity: flat-cap lip, plug/screw skirt, AND insert top clearance (deepest wins). Verified liner top drops with lip 0/2.5/6, plug skirt, and insert clearance.

Files: js/app.js, js/geometry.js, index.html (app.js?v=398, geometry.js?v=398, header b398).

### 2026-07-17 — b397: +33 Windows/Office emboss fonts

Added 33 local Windows/Office fonts to EMBOSS_FONTS (Comic Sans, Ink Free, Ebrima, Leelawadee, Rockwell, Bodoni MT, Bell MT, Perpetua, Baskerville, Goudy, Copperplate, Elephant, Bernard MT Condensed, Cooper Black, Britannic Bold, Berlin Sans FB, Agency FB, Bauhaus 93, Broadway, Stencil, Showcard Gothic, Harrington, Old English Text MT, Magneto, Papyrus, Brush Script, Lucida Handwriting, Monotype Corsiva, Vivaldi, Cascadia Mono, +more). All LOCAL (no `google` field) so they render synchronously — no web-font load race, which also sidesteps the partial-load size-mix on those fonts. Files: js/features.js, js/app.js, js/geometry.js, index.html (app.js?v=397, features.js?v=397, header b397).

### 2026-07-17 — b395: Vertical/emboss text — fix partial-font "CO bigger than FFEE"

The real cause of the inconsistent letters wasn't font FAMILY mixing but PARTIAL glyph loading: the browser had some glyphs (C, O) in the selected face and rendered the rest (F, E) in a fallback at a different SIZE. `embossFontStackForCanvas` now takes the label text and uses `document.fonts.check(face, text)` — it only uses the real face when EVERY glyph is loaded; otherwise it renders the whole label in one generic font (consistent size), and the post-load rebuild swaps in the real face. Applied to flat/vertical (rasterTextMask) + arc/banner. Files: js/features.js, js/app.js, js/geometry.js, index.html (app.js?v=395, features.js?v=395, header b395).

### 2026-07-17 — b394: Accent band welded flush into the wall (slip lid now fits)

Profile accent bands (rounded canisters, e.g. the coffee tin) were a proud sleeve standing ~0.57mm off the wall — a slip-over lid sized for the body couldn't clear it, and it read as a separate "slide-on" ring. `buildProfileAccentSleeve` now EMBEDS the ring into the wall (inner offset inward by the band thickness, overlapping the solid body = fused/welded) and protrudes only ACCENT_SKIN (~0.12mm), within slip-lid clearance. Verified: accent max radius 64.83 vs wall 64.71 (was ~65.3); band is a closed watertight solid (0 open edges, was an open sleeve). Sharp-corner box accents already sat ~0.12mm proud (unchanged). Files: js/features.js, js/app.js, js/geometry.js, index.html (app.js?v=394, features.js?v=394, header b394).

### 2026-07-17 — b393: Font-mixing fix (deeper) + nest stack lid watertight

- **Emboss font mixing** (CO in one font, FFEE in another): `embossFontStackForCanvas` fell back to a multi-font stack when the selected face wasn't confirmed loaded (e.g. at the shrunk vertical raster size), and Chrome then pulled different fonts per glyph. Now it always uses the primary Google face + ONE generic fallback, so every glyph is consistent (loaded → the face; not yet → one browser default). Fixes flat + vertical + arc text.
- **Nest stack lid rim** (the 250g set's lid): was ~168 open edges (open bottom rim coincident with the lid top). Rebuilt as a closed annular ring, radial-matched once, inset 0.1mm + embedded 0.5mm into the lid → clean union. trimesh watertight; committed test now PASSES (was WARN).

Files: js/features.js, js/app.js, js/geometry.js, index.html (app.js?v=393, features.js?v=393, header b393).
