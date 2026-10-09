# MakerDeck SESSION_NEXT archive (before 2026-06-28)

Archived 2026-07-26.

---

## MakerDeck session handoff

> **GOLDEN BASELINE: b284** — see `makerforge/GOLDEN_BASELINE.md`. Coffee bag trace + jar emboss confirmed good. Do not change `drawTracePreview` ink-mask order or revert b278 emboss without reading that file.

Latest GitHub/Pi state:
- Branch: `main`
- Current: **b392** — emboss font change applies to full vertical stack
- (was b391) — bigger emboss text size slider range
- (was b390) — vertical text path (stacked letters) + fix 4-line clip
- (was b389) — garden stake mount (ground spikes)
- (was b388) — 8 sign plate shapes (rect/rounded/pill/oval/hex/arch/shield/banner)
- (was b387) — sign arc text fixed (own circular bend, closed + centred)
- (was b386) — sign Flat/Arch buttons auto-centre the text
- (was b385) — sign arc text = gentle arch; mounts moved to corners
- (was b384) — Novelty (animal) section removed from UI
- (was b383) — NEW Signs section (door/name plaque, plate engine)
- (was b382) — animal shapes: switching fixed + recognizable silhouettes + watertight
- (was b381) — silhouette animal shape canisters (bear/cat/bunny/dog)
- (was b380) — batch manifold summary + canister filament preset
- (was b379) — manifold export gate blocks non-manifold 3MFs
- (was b378) — single-filament 3MFs (liner) also pin to left nozzle so AMS HT is offered
- Cache-bust: `app.js?v=392`, `features.js?v=392`, `geometry.js?v=392` — header **b392**

### 2026-07-17 — b392: Font change was only updating CO

**Symptom:** Vertical COFFEE — switching to Oswald (etc.) only restyled **C/O**; **F/F/E/E** stayed in the previous/fallback face.

**Cause:** `ensureEmbossFontLoaded` loaded `700 96px Oswald, "Arial Narrow", …`. The Font Loading API can resolve on the fallback before Oswald is ready, and Chrome then mixes faces mid-string. Rebuild also fired before glyphs at raster size (640/1280) were loaded. Deboss preview also hid the label mesh, so font checks were easy to miss.

**Fix:**
- Load Google faces as `"Oswald"` alone at 96/640/1280 with the label’s sample glyphs; await `fonts.ready`
- Canvas raster uses the primary face when `document.fonts.check` passes (no mixed stack)
- Font dropdown awaits load, then immediate rebuild; boot/text input re-prefetch
- Cap tall vertical raster height under browser canvas limits
- Show label mesh in Deboss preview (cutter silhouette) so font updates are visible

**Files:** `js/features.js`, `js/app.js`, `js/geometry.js`, `index.html`

**Test:** Hard refresh **b392** → Vertical → COFFEE → switch Oswald/Bebas/Anton — all six letters match.

### 2026-07-17 — b391: Bigger text size slider

**Request:** Text size slider range too small for vertical COFFEE.

**Fix:** Vertical max ≈ 98% of face height (cap 220 mm); flat/arc max ≈ 72% face (cap 100 mm). HTML/slider defaults raised to 220.

**Test:** Hard refresh **b391** → Vertical → size slider goes well past the old 4.8 cm stop.

### 2026-07-17 — b390: Vertical text path (COFFEE no longer clipped)

**Symptom:** Stacked `C/O/F/F/E/E` (newlines) only showed **COFF** — EE cut off at the bottom of the face.

**Cause:** `rasterTextMask` hard-capped at **4 lines** (`.slice(0, 4)`). Size slider also capped flat text to ~half face height, awkward for tall stacks.

**Fix:**
- Raise emboss text line limit to 16
- New **Text path → Vertical** — stacks letters automatically from `COFFEE` (no manual newlines needed), centres align, allows taller block (~90% face height)

**Files:** `js/features.js`, `js/app.js`, `index.html`

**Test:** Hard refresh **b390** → Art → Text → path **Vertical** → type COFFEE → all 6 letters visible; nudge size/up-down as needed.

### 2026-07-16 — bambu.py: AMS push registers named Bambu PLA variants (PLA Pure -> GFA19)

**Symptom:** Liner 3MF correctly asks for Bambu PLA Pure (GFA19), but the AMS HT tray holding spool #100 "White · PLA Pure" reported to the printer (and Bambu Studio) as **"Generic PLA · Generic · GFL99"**. Exact filament match failed -> Bambu colour-matched -> grouped to AMS 1.

**Cause:** `_filament_for_spool` collapses ALL PLA subtypes to `bl.Filament("PLA")` -> GFL99. So `set_ams_slot_filament` / Trust Flightdeck wrote Generic PLA to the tray regardless of the spool being PLA Pure.

**Fix (`app/printers/bambu.py`):** New `_bambu_pla_profile_key(spool)` — Bambu-brand PLA whose subtype/name contains pure/matte/basic maps to GFA19 / GFA01 / GFA00. Wired into `_custom_filament_for_spool` and `_profile_alias_for_spool`, so both the tray push and the profile-doctor override now send the real `tray_info_idx` + `setting_id` (GFSA19) + correct temps. Added GFA19/GFA01 aliases.

**Verified:** unit test — spool {Bambu Lab, PLA, Pure} -> tray_info_idx GFA19, setting_id GFSA19, name "Bambu PLA Pure", 190-240C. Non-Bambu PLA still GFL99.

**Deploy:** Pi backend restart required. After restart, re-push AMS HT slot (Trust Flightdeck / re-assign #100) so the tray re-registers as PLA Pure.

### 2026-07-16 — b389: Garden stake mount

New sign mount **Garden stakes** — two tapered ground spikes hanging from the plate bottom (garden/yard sign form, like the Mimi's Garden reference). `buildGardenStakes()` in signs.js builds each spike as its own watertight extrusion embedded ~6 mm into the plate (clean union). Wired into buildSign (mount "stake" → no holes, append stakes) and the Wall-mount dropdown. Verified watertight on arch/rounded/rectangle. Files: js/signs.js, js/geometry.js, js/app.js, index.html, test (app.js?v=389, geometry.js?v=389, signs.js?v=389, header b389).

### 2026-07-16 — b388: Sign plate shapes

New **Shape** selector on signs: rectangle, rounded, pill/stadium, oval, hexagon, arch-top, shield, banner/ribbon. `shapeOutline()` in signs.js generates each outline; plate, raised border, and mount cutouts all follow the chosen shape. `cleanRing()` dedupes near-coincident points (the cause of non-manifold on curved outlines) and mount holes auto-clamp inside the shape (`clampInside` + point-in-poly) so screws/keyholes never fall in the cut-away of oval/shield/etc. Arch = straight sides + elliptical top that always fits the box.

Verified (harness): all 8 shapes × border + screw mounts = 0 open / 0 non-manifold. Committed test cases added.

Files: js/signs.js, js/geometry.js, js/app.js, index.html, test/manifold.mjs (app.js?v=388, geometry.js?v=388, signs.js?v=388, header b388).

### 2026-07-16 — b387: Sign arc text — correct symmetric arch (own bend), closed + centred

The arc engine assumes a vertical face; on the sign's flat top it produced a rotated, off-centre curl regardless of start angle. Rebuilt sign text handling:
- Text/art built on a virtual vertical FACE with the **closed voxel builders** (buildTextLabelExportMesh / buildGraphicLabelExportMesh — watertight, b374 path), remapped flat onto the plate top.
- Arc replaced with our **own circular bend**: flat text warped along a circle whose span = Curve amount → clean symmetric ∩ (arch-up) / ∪ (arch-down), auto-centred, then user nudge applied.
- Export uses these exact bent meshes (new sign branch in collectColoredExportParts: Plate + Art + Text), so 3MF == preview. All parts watertight (plate + text 0 open edges, verified with a headless canvas render).
- Flat/Arch buttons just zero the offsets now (buildSign centres the arch itself).

Verified by rendering the real text geometry headless (node-canvas): flat centred, arch-up ∩, arch-down ∪ — all level and centred.

**Files:** js/geometry.js, js/app.js, index.html (app.js?v=387, geometry.js?v=387, header b387).

### 2026-07-16 — b386: Sign text auto-centres on Flat / Arch up / Arch down

For signs, the Flat / Arch up / Arch down buttons preserved existing offsets, so switching styles left the text off-position and the user had to hand-nudge Move up/down every time. New `centerSignText(preset)` resets textOffsetX=0 and a small preset-aware textOffsetY (arch-up drops slightly, arch-down lifts slightly), and syncs the sliders. Wired into the layout-btn and arc-preset-btn handlers for `shape === "sign"` only (canister/wrap behaviour unchanged). One click now snaps the text to a centred flat or arch. Files: js/app.js, index.html (app.js?v=386, header b386).

### 2026-07-16 — b385: Sign arc text (arch not curl) + mounts to corners

- **Arc text on flat/plate faces** used the 220° cylinder-wrap sweep, curling whole words into a circle. Non-wrap arc now uses a shallow **Curve-amount-driven sweep** (12–120°, curve 60 ≈ 66°) and lets the radius follow the sweep, so it's a predictable gentle arch. Wrap (canister) arc unchanged. An explicit fine-tuned sweep < 200° is still honoured. (features.js `computeTextArtLayout`.)
- **Mount cutouts** (keyhole + hanging) moved from ~0.22–0.28·W (too central, collided with a centred title) to the **top corners** (±(W/2−margin)), matching the screw holes. Central area now clear for text. All mount×border combos still watertight.

**Files:** js/features.js, js/signs.js, js/app.js, js/geometry.js, index.html (app.js?v=385, features.js?v=385, signs.js?v=385, header b385).

### 2026-07-16 — b384: Remove Novelty (animal) section from UI

Removed the **Novelty** heading, Animal shape button, and animal-name dropdown from index.html per request. Animal geometry code (animal-profiles.js, buildSign/resolveContainer animal branch, listeners) left dormant — shape "animal" is simply no longer selectable; listeners use optional chaining so the absent elements don't error. Bump app.js?v=384, header b384.

### 2026-07-16 — b383: Signs section — plate engine + door/name plaque (1 of 4)

New **Signs** section (Design tab) and a `sign` shape. First type: **door / name plaque**.
- `js/signs.js` (NEW): watertight flat plate via one `extrudeShapeGroupBetween` (outer ring + hole rings — no CSG). Mount cutouts: keyhole slots, 4 screw holes, 2 hanging holes, or none. Optional raised border (inset + embedded into the plate so it unions cleanly — no coincident faces).
- `buildSign()` in geometry.js: plate + border + mounts, meta with the plate face as "top"; text/art reuse the emboss engine (buildParams forces embossFace "top" for signs). Two-tone by giving the text its own colour (separate-parts export).
- Wired: SIGN_PRESET, PRESET_CONFIG, PRESET_SHAPES, shapeSupportsDecor/Art/AccentFrontFace, Signs UI (type / W / H / thickness / corner / mount / border), listeners, sign-type size defaults.

**Verified (harness + trimesh):** all mount×border combos 0 open / 0 non-manifold; bordered keyhole sign watertight + winding-consistent, 140×70×5.4 mm; 3D render confirms plate + raised frame + keyholes. Committed sign test cases PASS.

**Caveat:** geometry/export verified headless; the Signs UI itself wasn't click-tested. Types 2–4 (desk stand, house number, hanging) are next — the plate engine already supports their mounts/sizes; they mainly add the desk stand + size/text presets.

**Files:** js/signs.js (new), js/geometry.js, js/features.js, js/app.js, index.html, test/manifold.mjs (app.js?v=383, geometry.js?v=383, features.js?v=383, signs.js?v=383, header b383).

### 2026-07-16 — b382: Animal shapes — switching fix + real silhouettes + watertight

Fixes to the b381 animal shapes after review ("not changing" + "don't look like animals"):
- **Switching bug:** `buildParams()` never passed `animalName`, so every animal rebuilt as the default. Added `animalName: state.animalName` — the dropdown now actually changes the shape.
- **Recognisable silhouettes:** rebuilt `animal-profiles.js` recipes with distinctive front-facing heads — cat (pointed triangle ears), bear (round ears), bunny (long ears), dog (floppy ears + muzzle). Fixed a vertical flip (ears were pointing down). Rendered each to PNG and eyeballed before shipping.
- **Watertight on sharp features:** sharp ear valleys made `offsetProfileInward` self-intersect (cat/bunny had open edges). New `animalProfilePair()` derives the inner wall by ERODING the silhouette mask (can't self-intersect). Animal preset uses a flat, lip-less lid (the lid lip's inward offset also choked on ears). All 4 animals — body AND lid — now 0 open edges; cat + bunny confirmed watertight + winding-consistent in trimesh.

**Known:** dog is the weakest silhouette (acceptable); these are footprint-extruded (animal visible from above / in orbit, not a flat face-on plaque) — a front-elevation style is a possible future variant.

**Files:** js/animal-profiles.js, js/geometry.js, js/app.js, index.html, test/manifold.mjs (app.js?v=382, geometry.js?v=382, animal-profiles.js?v=382, header b382).

### 2026-07-16 — b381: Silhouette animal shape canisters

New **Animal** shape (Design tab -> Novelty) with a name dropdown: **bear / cat / bunny / dog**. Chunky front-facing silhouette canisters that reuse the whole pipeline — flat-face emboss/art, lid, accent. Liner not offered (non-canister).

- `js/animal-profiles.js` (NEW): each animal = union of primitive blobs rasterised to a mask, boundary extracted via the existing `maskToPolygons` -> one clean simple closed polygon, scaled to mm. Deliberately chunky so `offsetProfileInward(outer, wall)` never self-intersects on ears/legs.
- `resolveContainer` gains a guarded `shape === "animal"` branch (zero effect on existing shapes): outer = silhouette profile, inner = inward offset, same floor/lid/meta as star/heart.
- Wired into `shapeSupportsDecor` / `shapeSupportsAccent` / front-face; `ANIMAL_PRESET`, PRESET_CONFIG, PRESET_SHAPES, shape button + `#animal-name` dropdown + `state.animalName`.

**Verified (harness + trimesh):** all 4 animals — body AND lid — 0 open edges / 0 non-manifold; cat container watertight + winding-consistent in trimesh; front-face name emboss on a bear watertight. Committed test `animal * body/lid` cases all PASS.

**Files:** js/animal-profiles.js (new), js/geometry.js, js/features.js, js/app.js, index.html, test/manifold.mjs (app.js?v=381, geometry.js?v=381, features.js?v=381, animal-profiles.js?v=381, header b381).

**Next (UX polish, needs your eyes):** more/finer animal silhouettes, a preview thumbnail per animal, filename `animal-<name>-…` instead of `box-…`, and optionally profile-wrap art around the silhouette edge.

### 2026-07-16 — b380: Batch manifold summary + canister filament preset

**Batch export summary:** Library folder export now tallies open edges per design and writes a "Manifold check" section into the batch README, plus a status line ("all watertight" or "N design(s) NON-MANIFOLD — see README"). Reuses `tallyExportOpenEdges`.

**Canister filament preset:** New "Canister filament preset" field (Design tab, by the liner preset) writes the chosen Bambu preset into the container Body + Lid + Accent 3MF slots — same mechanism as the liner's PLA Pure. Blank = Generic PLA (no change). `state.canisterFilamentPreset`; verified a Body slot picks up "Bambu PLA Basic" -> GFA00.

**Files:** js/app.js, js/geometry.js, index.html (app.js?v=380, geometry.js?v=380, header b380).

### 2026-07-16 — test harness + two stack-lip bugs found

New `makerforge/test/` (run `./run.sh`) — headless geometry regression guard for the b371-b378 non-manifold work. Stages `../js`, checks every exported part is watertight after `prepareMeshFor3mf`. Core cases (flat trace, AMS B&W layers, text, non-stacking body, liner, gasket lid) all PASS.

**Found by the harness (advisory, not yet fixed):**
- **Nest stack lid rim** (`appendNestStackLidRim`): ~168 open edges. AFFECTS the 250g SET (nest style). Body is fine (0). Only the raised lip rim is open at its base (bottom ring not capped; coincides with lid top disk).
- **Hex stack** (`buildStackableHex` feet + `appendStackableLidPockets`): ~3076 body / 16 lid open.

Both are the same unwelded-cap-ring family as the liner/gasket fixes. Fix next session WITH print-fit validation (changing lip geometry affects how jars nest). Non-stacking canisters unaffected.

### 2026-07-16 — b379: Manifold export gate

Export now tallies open edges across every shipping part (container Body/Art/Text/Accent + Lid + Liner) BEFORE packing. If any part is non-manifold it shows a blocking confirm ("N open edges … Export anyway?") and a red status line, so broken files can't slip to Bambu unnoticed (which was the whole b371–b378 saga). `tallyExportOpenEdges()` in app.js; uses existing `partOpenEdgeCount`/`countOpenEdges`. Files: js/app.js, index.html (app.js?v=379, header b379).

### 2026-07-16 — b378: Pin single-filament exports to left nozzle (liner ignored AMS HT)

**Symptom:** b377 liner 3MF verified correct (PLA Pure / GFA19 in project_settings) but Bambu still grouped it to AMS 1.

**Cause:** `filament_map` / `physical_extruder_map` were only written when `maxExtruder > 1`. Single-filament liner files let Bambu choose the nozzle — it grouped to the RIGHT nozzle, and AMS auto-mapping won't offer trays feeding the left side (AMS HT), so it fell back to AMS 1.

**Fix:** Always write `filament_map` (all logical 1 / left) + `filament_map_mode Manual` + `physical_extruder_map` — consistent with the b365 container behaviour.

**Note for operator:** when opening an exported 3MF, let Bambu load the FILE's filament presets (don't "keep current") — otherwise slot 1 stays whatever the live session had.

**Files:** `js/3mf.js`, `js/app.js`, `index.html` (`app.js?v=378`, `3mf.js?v=378`, header **b378**)

**Test:** Hard refresh **b378** → re-export liner → open fresh in Bambu → Project Filaments shows PLA Pure, grouping = left nozzle, AMS mapping offers the HT tray.

### 2026-07-16 — b377: Liner filament preset — PLA Pure maps to AMS HT

**Symptom:** *-liner.3mf opened in Bambu with slot 1 = Generic PLA → grouped to AMS 1, not the AMS HT holding PLA Pure. Manual re-slotting every time.

**Cause:** `buildFilamentSlots` hardcoded every slot to `Generic PLA @BBL H2D` / `GFL99` / vendor Generic.

**Fix:**
- Parts can carry `filamentPreset`; Liner sets it from new `state.linerFilamentPreset` (default **"Bambu PLA Pure @BBL H2D"** — editable field on the Design tab under Food-safe liner, with datalist suggestions).
- `buildFilamentSlots` writes per-slot `filament_settings_id`, `filament_ids`, `filament_vendor` from the preset. IDs verified against BambuStudio system profiles: **PLA Pure = GFA19**, PLA Basic = GFA00, PLA Matte = GFA01 (`Bambu PLA Pure @base.json`, `…@BBL H2D.json`).
- Applies to the standalone liner 3MF AND the Liner part inside container exports (incl. Library batch export).

**Verified:** Node harness builds liner-test.3mf → project_settings.config: `filament_settings_id ["Bambu PLA Pure @BBL H2D"]`, `filament_ids ["GFA19"]`, `filament_vendor ["Bambu Lab"]`.

**Files:** `js/geometry.js`, `js/app.js`, `js/3mf.js`, `index.html` (`app.js?v=377`, `geometry.js?v=377`, `3mf.js?v=377`, header **b377**)

**Test:** Hard refresh **b377** → re-export liner → open in Bambu → slot shows Bambu PLA Pure and grouping picks the AMS HT tray (GFA19 RFID match).

### 2026-07-16 — b376: Lid gasket groove watertight + Library folder batch export

**Lid fix:** Flat lids with gasket enabled reported "448 open edges" in Bambu. `appendFlatLidGasketGroove` capped the groove with `capRingXZ` (which resamples the inner ring via `radialMatchInner`) but extruded walls with the RAW `innerGroove` points — cap and wall verts never welded (2×112 open edges at z=0 and z=gasketDepth). Now radial-matches once and reuses the ring for caps AND walls. trimesh: lid watertight ✓.

**Feature — Export library folder to Downloads:** Library tab, select a folder chip (e.g. Kitchen) → new **“Export ‹folder› to Downloads”** button. For every design in the folder: loads its saved state (same path as Load, awaits trace restore), builds the standard container/lid/liner 3MFs through the b375 golden export path, renames per design (`250-coffee-container.3mf`, `250-coffee-lid.3mf`, `250-coffee-liner.3mf`, …) and writes everything to `Downloads/…/{folder}/` via the cached folder handle (one picker prompt max, during the click). Inserts ship inside the container 3MF as before. Restores your live session afterwards. Failures are listed per design without aborting the batch.

**Files:** `js/features.js`, `js/app.js`, `js/geometry.js`, `index.html` (`app.js?v=376`, `features.js?v=376`, `geometry.js?v=376`, header **b376**)

**Test:** Hard refresh **b376** → Library → Kitchen → Export “Kitchen” to Downloads → pick Downloads/Makerdeck once → `Makerdeck/Kitchen/` fills with 9 files (3 designs × container/lid/liner) + README. Lid 3MF: no open-edges info line.

### 2026-07-16 — b375: Liner watertight + sack prints solid (embed + gap fill)

**Symptoms (b374):** container fully manifold ✓ but (1) **Liner: 256 non-manifold edges** — Bambu repair caps the opening with an unwanted top; (2) sack art has horizontal body-colour streaks in the slice.

**Causes:**
1. `buildCavityLiner` never closed the **top rim ring** (2×128 open edges); also extruded an inner-wall stub inside the solid floor (dangling ring at z=0) and capped the inner floor with raw `cupInner` points that don't weld against the `radialMatchInner()` wall verts.
2. Art parts floated **0.1 mm proud** of the wall ("floating regions" warning; bridged first layer drops thin details), and anti-aliased trace pixels claimed by neither colour left sub-nozzle body-colour cracks between black strokes.

**Fixes:**
- Liner: `capRing` at zTop (rim only — top stays open), floor slab extrudes outer wall only, inner floor cap uses the radially-matched ring. trimesh: watertight ✓ winding ✓; top face area = rim ring only (326 mm², a lid would be ~8,000).
- `labelOffsets`: multi-colour AMS parts embed **-0.06 mm into the wall** (safe now all parts are watertight — no coplanar z-fight, kills floating warning).
- `fillLightLayerGapsForExport`: 2-layer exports close the light layer (morph close ×2) then subtract dark ink — hairline cracks print as white instead of body colour.

**Files:** `js/geometry.js`, `js/features.js`, `js/app.js`, `index.html` (`app.js?v=375`, `features.js?v=375`, `geometry.js?v=375`, header **b375**)

**Test:** Hard refresh **b375** → re-export → liner 3MF: no error, top open. Container: all parts clean, no floating-regions warning, sack solid in slice.

### 2026-07-16 — b374: Voxelize Text export (last non-manifold part)

**Symptom:** b373 container — Body / Art Black / Art White / Accent all clean; **Text: 3,264 non-manifold edges** (3,244 tris), only remaining error.

**Cause:** Flat text export still used earcut vector letter solids (`extrudeGroupsOnFace`). Glyph contours are dense; the 0.04 mm 3MF weld collapses points and earcut cap/wall pairing breaks — fragile by nature.

**Fix:** New `buildFlatShapeGroupsSolidMesh` — rasterizes the letter shape groups at 0.05 mm cells (canvas raster) and runs the same watertight voxel-surface builder as the art layers, with layer-height row banding. `buildTextLabelExportMesh` uses it for flat-face **export**; preview keeps smooth vector letters. 0.05 mm stair-steps are invisible at a 0.42 mm nozzle.

**Verified:** harness — letter "O" with 2,500-pt rings (0.01 mm spacing, worse than any glyph) + asymmetric "L": 0 open / 0 non-manifold raw AND after prepareMeshFor3mf; orientation check confirms no vertical mirroring. Art layer + line-art regressions all pass.

**Files:** `js/features.js`, `js/app.js`, `js/geometry.js`, `index.html` (`app.js?v=374`, `features.js?v=374`, header **b374**)

**Test:** Hard refresh **b374** → re-export → Bambu: zero non-manifold on ALL parts incl. Text → slice.

### 2026-07-16 — b373: Flat voxel hook — match any mask mode (b372 gate was too narrow)

**Symptom:** b372 re-export still ~88.5k non-manifold edges; art still shredded on slice (Text was fixed — count dropped 90,352 → 88,542, tris +1.9k from the kept slivers).

**Cause:** `buildMultiColourLayerEmboss` builds its bitmap with `mode: traceData.mode` — multi-colour traces are `"multi-colour"` / `"black-white"`, NOT `"silhouette"`, and it never passes `multiColourContour`. The b372 gate (`outlineRaster || multiColourContour || mode === "silhouette"`) evaluated false → AMS layers regressed to the vector earcut route again.

**Fix:** Flat-face gate is now `mask present && mode !== "outline"`. Outline stroke mode keeps its extrusion branch; everything else with an ink mask gets the watertight voxel solid.

**Verified:** harness rerun with `mode: "black-white"` (exact session data shape) — Art Black + Art White 0 open / 0 non-manifold, all prior regressions pass.

**Files:** `js/features.js`, `js/app.js`, `js/geometry.js`, `index.html` (`app.js?v=373`, `features.js?v=373`, header **b373**)

**Test:** Hard refresh **b373** (check header!) → re-export → Bambu: no non-manifold error at all; slice art solid.

### 2026-07-16 — b372: Multi-colour AMS art + Text watertight (b371 fixed the wrong branch for B&W sessions)

**Symptom:** Container re-exported on b371 still showed **90,352 non-manifold edges**. Parsed the actual 3MF: Body/Accent clean, but **Art Black 2,704 + Art White 4,130 + Text 340 open edges**.

**Cause (two separate leaks):**
1. B&W (2 AMS) trace sessions export via `buildMultiColourGraphicEmboss` → `layerToEmbossBitmap` sets `multiColourContour` but **not** `outlineRaster` — so the b371 voxel hook was bypassed and layers went down the **vector earcut** route, which silently drops caps on big pixel contours (b358 disease).
2. `prepareMeshFor3mf` welds at 0.04 mm, merging dense glyph contour points into degenerate tris, then `removeDegenerateTriangles` culled positive-area slivers — deleting a sliver from a closed mesh tears an open edge. That's Text's 340.

**Fix:**
- `buildEmbossBitmap`: flat-face voxel-solid hook now fires for **any** ink/silhouette mask — `outlineRaster || multiColourContour || mode === "silhouette"` (outline stroke mode keeps its vector branch).
- `stl.js`: `prepareMeshFor3mf` uses new `removeCollapsedTriangles` — drops only repeated-index / invalid / non-finite tris, **keeps slivers** (topology-safe). STL path (`sanitizeMeshForStl`) unchanged.

**Verified in Node harness:** simulated B&W two-layer coffee bag → Art Black + Art White both **0 open / 0 non-manifold**, raw and after prepareMeshFor3mf. Dense-glyph torture (3,000-pt ring, 0.017 mm spacing — worse than any font) survives the 0.04 weld closed. All b371 regressions (faces, rotation, checkerboard, preview perf) still pass.

**Files:** `js/features.js`, `js/stl.js`, `js/app.js`, `js/geometry.js`, `js/3mf.js`, `index.html` (`app.js?v=372`, `features.js?v=372`, `stl.js?v=372`, header **b372**)

**Test:** Hard refresh **b372** → re-export (no re-trace needed, B&W session data fine) → Bambu object info: no non-manifold error on container. Slice: solid bag art, no shred.

### 2026-07-16 — b371: Watertight flat-face trace export (fix 90k non-manifold edges)

**Symptom:** box-94x94x127mm-container in Bambu: **Error: 90350 non-manifold edges**, "Use Fix Model to repair" — coffee bag art chewed after auto-repair, paint/colour regions unreliable.

**Cause:** Flat-face trace export used per-row **run shells** (`pushWrapRunShell`) — each mask row run is an open tube (outer + inner skin + end walls, deliberately **no top/bottom caps** to avoid z-fight). Every run leaks 2 open edges per boundary → line art = tens of thousands of open edges. Earcut vector solids (b358–b362) are no fix either: earcut silently drops caps on giant pixel-exact multi-hole contours (verified: 41k open edges at tol=0).

**Fix:** New `buildFlatTraceSolidMesh` in `features.js` — voxel-lattice surface extraction, manifold **by construction**, no triangulation library:
- caps per run, subdivided at neighbouring rows' run breakpoints (kills T-junctions), merge-triangulated between chains (no zero-area tris)
- walls only where a filled cell borders an empty one; all verts shared via one lattice cache
- 2×2 checkerboard pinches pre-filled (`resolveMaskDiagonalPinches`) — diagonal ink touches would give 4-wall edges
- honours the existing `stepPx` row-band merge (preview stays light, 3MF stays small) and `decorRotation` (rigid rotation post-lattice, still manifold)
- hooks into `buildWrapTraceSlabMesh` for `frame.face !== "wrap"` only — **wrap golden path (b284/b302) untouched**

**Verified in Node harness (real module code):** synthetic coffee-bag line art 420×520 — before: 11,628 open edges; after: **0 open / 0 non-manifold** at exact, 1e-4 and 0.04 weld. trimesh: watertight ✓ winding-consistent ✓ volume = ink×depth ✓ on front/back/left/right/top, rotation, checkerboard, dot/row/block masks. Preview 900×1100 dense mask: 111k tris in 77 ms.

**Files:** `js/features.js`, `js/app.js`, `js/geometry.js`, `index.html` (`app.js?v=371`, `features.js?v=371`, header **b371**)

**Test:** Hard refresh **b371** → re-export coffee canister → open container 3MF in Bambu → object info shows **no non-manifold error**, no Repair prompt. Slice: bag silhouette solid, per-letter/art colours intact. Wrap models (dragons cooler) unchanged.

### 2026-07-16 — b370: Restore coffee bag Auto line-art (stop B&W posterise)

**Symptom:** Coffee bag still looked terrible after b369 — chunky jagged black blobs, not clean line-art sack.

**Cause:** Kitchen presets / DEFAULTS forced **Black + white (2 AMS)** multi-colour. That posterises greyscale coffee-bag art into solid chunks. Golden path (b284) is **Auto → outlineRaster ink mask**. Auto-merge of greyscale multi-colour → B&W made it worse on export.

**Fix:**
- Default + kitchen canister `traceMode: "auto"`
- Only collapse greys when Black+white is explicitly selected
- Flat AMS emboss uses golden `buildEmbossBitmap` (same as preview/wrap)
- Trace mode dropdown: Auto first

**Test:** Hard refresh **b370** → Trace mode **Auto** → Invert on → Trace coffee bag → cyan line-art overlay → re-export. Must re-trace (old B&W session data stays chunky until Trace).

### 2026-07-16 — b369: Restore coffee bag emboss (stop accent-slab shred)

**Symptom:** Coffee bag in Bambu Prepare looked chewed up — horizontal blue-grey gaps through the black bag silhouette (COFFEE text OK).

**Cause:** b364 flat multi-colour export used `buildFaceDecalSlabMesh` (0.2 mm accent-style horizontal wall slabs). Fine line art re-rasterised onto that grid shreds into jagged stripes.

**Fix:** Flat AMS export back to dilated united vector solids + `extrudeGroupsOnFace` (b361 path). Wrap still uses `buildEmbossBitmap` row shells.

**Files:** `js/features.js`, `js/app.js`, `index.html`

**Test:** Hard refresh **b369** → re-export coffee canister → bag silhouette solid (no horizontal chew). Backend restart not required.

### 2026-07-15 — b368: Export folder picker UX (don't type name in Windows box)

**Symptom:** Windows folder picker error "Path does not exist" when user typed export name in bottom Folder field.

**Cause:** User must select **Downloads** (or New folder), not type the export name — MakerDeck creates the subfolder via API.

**Fix:** First-time confirm with step-by-step instructions. Dynamic hint in export dialog. Cached Downloads handle → later exports skip picker and auto-create `{name}/` in Downloads.

**Test:** Hard refresh b368 → Export → confirm → click Downloads → Select Folder (leave bottom box empty) → folder appears.

### 2026-07-15 — b367: Fix folder export (picker timing + README bytes)

**Symptom:** b366 folder never appeared in Downloads.

**Cause:** Directory picker ran after async mesh build — outside user click, browser blocked it (NotAllowedError → export cancelled silently). README.txt was a raw string (bad bytes on write).

**Fix:** Pick Downloads on Export dialog submit (while click is active), pass handle through to write after build. TextEncoder for README. Secure-context check with ZIP fallback message on http://.

**Test:** Hard refresh b367 → Export → pick Downloads when prompted → folder with 3MFs appears during/after build.

### 2026-07-15 — b366: Export folder straight to Downloads (not ZIP)

**Request:** Chris wanted multi-file export as a ready-to-use folder in Downloads — not a ZIP to extract.

**Fix:** `export-folder.js` uses File System Access API — writes `{Downloads}/{projectName}/` with container, lid, liner 3MFs + README. First export prompts to pick Downloads once (remembered). ZIP fallback only if API unavailable or write fails.

**Test:** Hard refresh b366 → export with lid on → pick Downloads once → folder appears in Downloads with all 3MFs inside.

### 2026-07-15 — b365: H2D left-nozzle filament map (fix printable range error)

**Symptom:** Red error — Filament 1 on right nozzle exceeds printable range; moiré/shredded slice; floating regions.

**Cause:** Bambu Auto For Flush put body (F1) on right nozzle; 94 mm canister wider than right-only zone. b362 merged AMS also broke colours (reverted b364).

**Fix:** `filament_map` + `filament_maps` all logical **1** (left hotend / regular AMS). Separate Body + Art + Text parts; flat art = accent-style slabs (b364).

**Test:** Hard refresh b365 → re-export → Filament grouping: all left nozzle; no right-nozzle range error.

### 2026-07-15 — b364: Revert merged AMS; accent-style art export slabs

**Symptom:** b362 merged painted mesh was worst yet — Bambu history: one grey body, no filament colours.

**Fix:** Back to **separate Body + Art Black + Art White + Text** parts. Flat multi-colour art export uses **buildFaceDecalSlabMesh** (same horizontal wall slabs as orange accent rim — b201 golden path). Wrap unchanged (buildEmbossBitmap). ZIP root folder kept (b363).

**Test:** Hard refresh b364 → re-export → object list shows separate art parts; slice should match accent-band quality.

### 2026-07-15 — b363: ZIP root folder for clean extract

**Request:** Multi-file export ZIP should unpack into a folder named like the zip (7-Zip / Explorer ready for slicer).

**Fix:** `createZipArchiveBlob({ rootFolder })` — entries live under `box-94x94x127mm/` matching zip basename. Liner-only exports also use `.zip` when applicable.

**Test:** Export ZIP → extract → one folder with container/lid/liner 3MFs + README.

### 2026-07-15 — b362: Single AMS-painted body (fix floating regions)

**Symptom:** Bambu warns "floating regions"; filaments 2–4 ~0.04 m; 385 tool changes; slice still shredded.

**Cause:** Separate Body + Art Black + Art White + Text components in 3MF assembly — Bambu treats art as disconnected floating meshes.

**Fix:** `buildMergedAmsExportMesh` — one Body object, `paint_color` per triangle for each AMS slot. Multi-colour layers + text appended with extruder tags. Accents stay separate parts.

**Test:** Hard refresh b362 → re-export → Bambu: one Body object, no floating warning, filaments 2–4 show real usage.

### 2026-07-15 — b361: Printable flat-face multi-colour export

**Symptom:** b360 still shredded in slice; filaments 2–4 ~0.04–0.10 m (line art sub-nozzle width).

**Cause:** Row shells on flat face = ~0.01 mm wide runs; slicer drops below 0.4 mm nozzle. Dragons cooler worked on **wrap** with **solid fills**, not 1 px line art on flat.

**Fix:** Flat AMS export → dilated united vector solids (~0.52 mm min stroke) + 0.6 mm art depth / 0.4 mm text. Wrap still buildEmbossBitmap. Text via prepareMeshFor3mf.

**Test:** Hard refresh b361 → re-export → slice: solid fills, filaments 2–4 should show metres not centimetres.

### 2026-07-15 — b360: Multi-colour export = buildEmbossBitmap per layer (dragons cooler path)

**Symptom:** b358/b359 still wrong in slicer — Prepare OK, slice garbage.

**Fix:** Each AMS colour layer routes through golden `buildEmbossBitmap` — same path as dragons beer cooler (b302) and single-colour coffee bag. Wrap → `buildWrapGoldenSlabEmboss`; flat line-art → layer-height row shells (not fineRows, not vector islands).

**Test:** Hard refresh b360 → re-export → slice should match cooler-quality fills.

### 2026-07-15 — b359: Flat-face multi-colour vector export (fix slice stripes)

**Symptom:** Prepare view perfect; slice shows horizontal fragments, 189 filament changes, tiny colour usage.

**Cause:** b358 used pixel row shells on flat faces — each mask row is a separate thin slab with no caps between rows; slicer sees horizontal gaps.

**Fix:** Flat AMS export uses united vector solids per colour (`extrudeGroupsOnFace`), same as text export. Wrap still uses row shells.

**Test:** Hard refresh b359 → re-export → slice: solid Art Black/White fills, not horizontal slivers.

### 2026-07-15 — b358: Multi-colour art export row shells (fix mesh mess)

**Symptom:** Container 3MF — 149k triangles, 149k+ non-manifold edges, Art Black split into hundreds of fragments in Bambu.

**Cause:** Flat-face AMS export used vector contour extrusion per ink island — coffee bag line art = thousands of open meshes.

**Fix:** Multi-colour layers use closed row shells (same path as single-colour trace export). Art parts via `prepareMeshFor3mf` not STL repair.

**Test:** Hard refresh b358 → re-export container → Bambu: Body + Art Black + Art White + Text, no non-manifold spam.

### 2026-07-15 — b357: Liner floor matches rounded profile

**Symptom:** White sharp corners poking through rounded container bottom in preview/slice — liner floor was AABB box, not profile shape.

**Fix:** Liner floor uses `capProfileSolid` + annulus extrusion on `cupOuter`/`cupInner` (same rounded profile as cavity). Hide liner in preview when exported as separate *-liner.3mf.

**Test:** Hard refresh b357 → preview shows clean rounded bottom; *-liner.3mf floor matches canister inner curve.

### 2026-07-15 — b356: Bambu metadata always + liner floor slab

**Symptom:** Filament slots showed `(box-94x94x127mm-container…)` not H2D/AMS colours. Liner still hollow (walls only) in Bambu slice.

**Cause:** Single-part exports (liner/lid) used `plainSingle` — skipped `project_settings.config` + `model_settings.config`. Bambu fell back to filename as process profile. Liner earcut floor cap not sliced.

**Fix:** Always embed Bambu Metadata (`printer_settings_id`, `filament_settings_id`, plate JSON). Liner = solid `appendSolidBox` floor + annulus walls.

**Test:** Hard refresh b356 → re-export → open *-liner.3mf alone → solid first layer + H2D printer + Generic PLA slots.

### 2026-07-15 — b355: Liner solid floor + export greyscale merge

**Symptom:** *-liner.3mf sliced as hollow walls only (no base). Container still exported 6 grey AMS art layers from old trace.

**Fix:** Liner bottom = solid `cupOuter` cap (plate-down) + annulus walls. Export/load merges greyscale colour layers to Black + White even without re-trace.

**Test:** Re-export ZIP → liner has solid first layer; container shows Body + Art Black + Art White + Text.

### 2026-07-15 — b354: Black + white trace (2 AMS slots, not 6 greys)

**Symptom:** Coffee bag exported Art White + Black + Dark grey + Grey + Dark grey 2 + Grey 2 — 9 filament slots, Bambu couldn't map AMS colours.

**Cause:** Multi-colour trace quantised anti-alias pixels into many grey buckets. Coffee bag is really B&W line art.

**Fix:** New trace mode **Black + white (2 AMS)**. Auto-merge greyscale multi-colour palettes to 2 layers. Kitchen square preset defaults to black-white.

**Test:** Hard refresh b354 → re-trace coffee bag → trace meta "2 colours · black + white" → export shows Body + Art Black + Art White + Text only.

### 2026-07-15 — b353: Separate liner 3MF for second printer

**What:** Export ZIP includes `*-liner.3mf` (on build plate) alongside container + lid. Liner removed from container 3MF.

**Files:** `js/app.js`, `js/geometry.js`, `js/3mf.js`, `index.html`

**Test:** Square stack canister → Download 3MF ZIP → container, lid, liner files. Print liner + lid on second printer.

### 2026-07-15 — b352: Simple open liner (no flange shelf)

**Symptom:** Container still showed grey flat cap inside top in Bambu after b351.

**Fix:** Liner = plain open cup (no flange shelf). Export liner/insert via prepareMeshFor3mf (not STL repair that confuses open tops).

**Test:** Hard refresh b352 → re-export container 3MF → look down into top: hollow cavity, no grey lid.

### 2026-07-15 — b351: Liner open top — inner wall full height

**Symptom:** b350 liner still looked solid capped in Bambu (flat closed top).

**Cause:** Inner wall stopped at flange bottom while outer wall continued — single-sided shell above that line; slicer filled cavity solid. Full flangeOuter extrude + top annulus cap made it worse.

**Fix:** Inner + outer cup walls same height (open top). Flange = external annulus ring only — no top cap, no full-profile flange tube.

**Test:** Hard refresh b351 → re-export container 3MF → Liner hollow open-top in Bambu slice.

### 2026-07-15 — b350: Liner slicer bottom + open top

**Symptom:** Bambu capped liner top and skipped bottom layers (looked like insert with no floor).

**Cause:** Peel membrane solid cap at flange top; floor only had inner disk normals up — no exterior down-facing bed cap.

**Fix:** Exterior floor annulus (normal down), open cup under flange, removed peel membrane.

**Files:** `js/geometry.js`, `js/app.js`, `index.html`

**Test:** Hard refresh b350 → re-export Kitchen container 3MF → Liner: solid bottom in slice, open top, no cap.

### 2026-07-15 — b349: Restore cyan overlay + fast trace

**Symptom:** Trace hung on "Tracing…", no cyan overlay, 3D not updating. Multi-colour on single-colour line art returned empty layers; heavy mask ops froze tab.

**Fix:** Fast light multi-colour mask (cap 1600px work). Fallback to silhouette when <2 AMS colours. Always attach preview mask for cyan overlay. Auto-apply trace to box again.

**Files:** `js/trace.js`, `js/app.js`, `index.html`

**Test:** Hard refresh b349 → load Milo graphic → Trace → cyan overlay + graphic on box within a few seconds.

### 2026-07-15 — b348: Stop cutting spoon handles on trace

**Symptom:** b346 aggressive erode/split clipped thin spoon handle while trying to remove bag/spoon wedge.

**Fix:** Reverted morphological neck removal. Multi-colour trace only drops tiny disconnected specks — keeps thin parts like spoon handles.

**Files:** `js/trace.js`, `js/app.js`, `index.html`

**Test:** Trace Milo graphic → full spoon handle → Apply. Wedge may remain; try threshold ~140–170. Hard refresh b348.

### 2026-07-15 — b347: Fix trace crash (const assignment)

**Symptom:** Trace failed with "Assignment to constant variable" — nothing applied.

**Fix:** b346 accidentally reassigned `const colorLayers`; use `trimmedLayers` instead.

**Files:** `js/trace.js`, `js/app.js`, `index.html`

**Test:** Trace Milo graphic → no error → Apply. Hard refresh b347.

### 2026-07-15 — b346: Clip wedge from combined multi-colour mask

**Symptom:** Bag/spoon wedge still visible after b345 per-layer neck removal.

**Fix:** Union all AMS layers, erode/split/dilate to drop thin bridges, clip every colour layer to cleaned combined mask (up to 6 erode passes).

**Files:** `js/trace.js`, `js/app.js`

**Test:** Trace Milo graphic → wedge gone in 2D preview → Apply. Hard refresh b346.

### 2026-07-15 — b345: Trace speed + bag/spoon neck fix

**Symptom:** b344 laggy trace/preview; wedge between bag and spoon still visible.

**Fix:** Trace updates 2D preview only (click **Apply** for 3D). Neck removal erodes thin bridges between logo parts at working resolution. Preview overlay downsampled for speed.

**Files:** `js/trace.js`, `js/app.js`

**Test:** Trace Milo graphic → preview should be quick. Wedge gone → **Apply**. Hard refresh b345.

### 2026-07-15 — b344: Multi-colour trace wedge cleanup

**Symptom:** Milo (and similar logos) picked up a small filled wedge between bag body and spoon handle.

**Cause:** Per-colour layer masks ran horizontal morphological close, bridging narrow gaps between separate logo parts on the same scanline.

**Fix:** Skip horizontal close on multi-colour layers; prune tiny islands + light open per layer (keeps bag + spoon satellites).

**Files:** `js/trace.js`

**Test:** Milo stack member → Art → Trace again. Wedge between bag and spoon should be gone. Hard refresh b344.

### 2026-07-15 — b343: Fix duplicate folder chips

**Symptom:** Library tab showed four identical **Kitchen** folder buttons.

**Cause:** Parallel library refreshes each appended folder chips after fetch (race). Backend now case-folds folder names for dedupe.

**Fix:** Stale-refresh guard on folder nav + UI refresh; unique folder list on frontend.

**Files:** `app/makerdeck_library.py`, `js/app.js`

**Test:** Library tab → one **Kitchen** chip only. Hard refresh b343.

### 2026-07-15 — b342: Library delete dialog + save size fix + folder UX

**Symptom:** Save failed with `400: Part exceeded maximum size of 1024KB`; browser `confirm()` on delete; folder not obvious after save.

**Fix:** Design save endpoint allows 8 MB parts (was Starlette 1 MB default). Trace/thumbnail compress before upload. In-app confirm dialog for delete. Library tab shows **Folder** chips; save success links to Library tab + folder filter.

**Files:** `app/main.py`, `index.html`, `css/style.css`, `js/app.js`

**Backend restart required** on Pi.

**Test:** Save “250g Sugar” to Kitchen folder → View in Library → Kitchen chip shows design. Delete uses in-app dialog, not browser popup.

### 2026-07-15 — b341: Collapse sliders by category

**What:** Edges, Inner size, Walls, and Vase each get their own collapsible panel (default closed). Library save stays at top of Design tab. Open/closed state remembered per category.

**Files:** `index.html`, `css/style.css`, `js/app.js`

**Test:** Design tab → expand only the section you need. Hard refresh for b341.

### 2026-07-15 — b340: Library at top + collapsible Fine tune

**What:** Save to library moved to top of Design tab (compact name/folder row). Edges, inner size, walls, and vase sliders tucked under collapsed **Fine tune** details (remembers open/closed).

**Files:** `index.html`, `css/style.css`, `js/app.js`

**Test:** Design tab → library bar at top. Fine tune collapsed by default; expand for sliders. Hard refresh for b340.

### 2026-07-15 — b339: Save to library from Design tab + folders

**What:** Save designs directly from the Design tab (params + thumbnail + trace, no export required). Optional folder name on save; Library tab filters by folder (All / Unfiled / named folders). Export dialog also accepts a library folder.

**Files:** `app/makerdeck_library.py`, `app/main.py`, `js/library.js`, `js/app.js`, `index.html`, `css/style.css`

**Backend restart required** on Pi (new `/api/makerdeck/designs` POST + `/api/makerdeck/folders` GET).

**Test:** Design tab → name + folder “Kitchen” → Save to library. Library tab → Kitchen filter shows it. Load restores sliders/art.

### 2026-07-15 — b338: Hardcode 1 mm stack lip

**Symptom:** b337 looked unchanged — saved session still had 5 mm / 2.8 mm nest rim.

**Fix:** `STACK_LIP_MM = 1` constant in geometry; ignores old session values; `normalizeStackLipParams()` on rebuild + session restore.

### 2026-07-15 — b337: 1 mm stack lip (no nest groove)

**What:** Dropped nest groove/seating pocket entirely. Stack lids = flat top + **1 mm** outer positioning lip (anti-slide only). Presets updated for square stack set + round stack set.

**Files:** `js/features.js`, `js/geometry.js`, `js/app.js`, `index.html`

**Test:** Square stack set → lid preview is flat with thin outer fence; re-export lid 3MF on b337.

### 2026-07-15 — b336: Solid nest lid top (removed groove trench)

**Symptom:** Lid top still showed black air gap between centre plate and outer rim in Bambu.

**Cause:** Nest seating groove was an open annular trench on the top face — correct for stacking but reads as floating/disconnected geometry in slicer preview.

**Fix:** Full solid top plate + raised outer lip only; next jar registers inside the lip. No top groove trench.

**Test:** Re-export lid on b336 — top should be continuous solid tan, lip ring welded at outer edge.

### 2026-07-15 — b335: Nest lid rim welded solid (groove depth clamp)

**Symptom:** Lid top insert looked like thin floating band with air gap in Bambu layer view.

**Cause:** Nest groove depth (4 mm) exceeded lid thickness (2.8 mm) → groove cut below plate. Full top cap overlapped nest rim; rimInner used scaled profile with mismatched cap vertices.

**Fix:** Clamp groove to plate thickness; nest shell = bottom + outer wall + centre disk (no full top cap); rim annulus + lip welded at zTop; radial-matched cap rings.

**Test:** Re-export lid 3MF on b335 — outer nest lip should be solid ~5 mm × 2.8 mm band, no black gap.

### 2026-07-15 — b334: Liner slice fix + flat lid print orientation

**Symptom:** Slicer capped liner top / ate liner bottom; lid had floating regions even when flipped.

**Cause:** Liner floor cap had inverted normals. `orientLidForPrint` 180°-flipped flat nest lids — nest rim on bed, geometry floating.

**Fix:** Floor normal up; peel-off 0.18 mm liner membrane; flat lids export plate-down (no flip). Optional **Lid breakaway supports** toggle. ZIP README updated.

**Files:** `js/geometry.js`, `js/features.js`, `js/app.js`, `index.html`

**Test:** Hard refresh `app.js?v=334` → re-export ZIP → peel liner membrane; lid flat on bed, don’t flip in Bambu.

### 2026-07-14 — b333: Liner non-manifold + Bambu plate split fix

**Symptom:** Bambu put **Liner** on a separate “Bambu Cool Plate” tab; 392 non-manifold edges on Liner; Art/Text warning icons.

**Cause:** `buildCavityLiner()` stacked overlapping `cupOuter` wall extrusions + annulus caps at the flange junction (T-junctions). `model_settings.config` used `identify_id=0` while `plate_1.json` used assembly object id — Bambu plate registration mismatch.

**Fix:** Refactored liner to one continuous `cupOuter` wall + flange annulus (no duplicate extrusion). Aligned `identify_id` to assembly id. AMS art/text standoff 0.06→0.10 mm. Export status reports liner open edges.

**Files:** `js/geometry.js`, `js/3mf.js`, `js/features.js`, `js/app.js`, `index.html`

**Test:** Re-export square stack set ZIP → open **only** `*-container.3mf` → all parts on Plate 01, Liner in same assembly tree, no Repair needed. Hard refresh `app.js?v=333`.

### 2026-07-14 — b332: Multi-colour trace auto-repair (graphic lost overlay)

**Symptom:** Trace panel still shows “6 colours · multi-colour logo” but 3D preview only has thin light-blue COFFEE text edges — coffee bag graphic missing.

**Cause:** Large trace masks (e.g. 2003×2400 px) exceed localStorage/session save limit — colour layer metadata survives but ink masks are stripped. Undo/history snapshots also omit mask blobs. Preview still thinks art exists; mesh build skips empty layers.

**Fix:** Detect invalid/stale masks; auto re-apply from `traceLastResult` or deferred re-trace from saved image; warn “graphic lost — click Trace”; don’t wipe trace on first rebuild failure.

**Files:** `js/app.js`, `index.html`

**Test:** Hard refresh `app.js?v=332` → open wife’s coffee canister → graphic should auto-restore within ~2s OR trace meta says “graphic lost — click Trace”. Click **Trace** once if needed. Emboss depth ~0.5–0.7 mm, graphic size ~16–20 mm.

### 2026-07-14 — b331: Bambu 3MF loads H2D + colours (not box filename)

**Symptom:** Bambu showed `(box-94x94x127mm-container…)` as printer/process and filament labels; no plate bed; line widths 0 mm if that corrupt profile was saved.

**Cause:** `project_settings.config` used model filename as `"name"` (Bambu treats it as embedded process profile). Single-plate export omitted `plate_1.json` + bed-centring `<assemble>`.

**Fix:** `name: "project_settings"`, `printer_model: "Bambu Lab H2D"`, plate JSON/PNGs + assemble transform on all multi-part exports. Re-click **Square stack set** to reset corner radius if presets were tweaked.

**Test:** Re-export container 3MF → Bambu: H2D printer, colour swatches, plate bed visible. Hard refresh `app.js?v=331`. Reset Bambu process if old 0 mm profile persists.

### 2026-07-14 — b330: Food-safe liner — top flange clears lid lip

**What:** **Food-safe liner** toggle on canisters — thin PLA Pure cup (0.9 mm wall) with top registration flange. Top auto-reserves space for flat-lid lip or nest-stack cap so the lid still seats on the outer shell. Separate **Liner** 3MF part. On by default for **Square stack set**.

**Files:** `js/geometry.js`, `js/features.js`, `js/app.js`, `index.html`

**Test:** Square stack set → liner visible inside cavity; toggle off/on; export 3MF includes Liner slot. Hard refresh `app.js?v=330`.

### 2026-07-14 — b329: Square stack set — nest-stack tower lids

**What:** **Square stack set** now uses nest-stack lids (same as round Stack set) — raised rim + seating groove so jars tower on the bench. 250g locked, front-face COFFEE/SUGAR/MILO, gasket groove + TPU ring.

**Files:** `js/geometry.js`, `js/app.js`, `index.html`

**Test:** Square stack set → preview lid rim groove; stack two in hand mentally. Hard refresh `app.js?v=329`.

### 2026-07-14 — b328: Square set — 250g Coffee · Sugar · Milo trio

**What:** New **Square set** kitchen preset (separate from round Stack set). Locked **250g** square canisters, front-face **COFFEE / SUGAR / MILO** labels, trio chips swap body colours. Same cavity as square canister (94×94×127 mm).

**Files:** `js/geometry.js`, `js/app.js`, `js/features.js`, `index.html`

**Test:** Kitchen → **Square set** → C/S/M chips. Export body+lid 3MF ×3. Hard refresh `app.js?v=328`.

### 2026-07-14 — b327: Kitchen stack trio — Coffee · Sugar · Milo (no tea)

**What:** Stack set + contents preset for Chris's 250g wife set — **C · S · M** instead of T · C · S. Added **Milo** content (chocolate body, green art default, letter M on wrap).

**Files:** `js/app.js`, `index.html`, `js/geometry.js`

**Test:** Stack set → C/S/M chips swap colours + letter. Square/jar Contents dropdown includes Milo. Hard refresh `app.js?v=327`.

### 2026-07-14 — b326: 3MF text export — solid letters, fewer Bambu mesh errors

**Symptom:** Bambu Studio on coffee box 3MF: ~14k non-manifold edges; COFFEE text looked horizontal stripey in slicer.

**Cause:** Separate-colour text export used preview row shells (`buildFaceDecalSlabMesh`) instead of vector letter extrusion. Flush Body/Text/Art parts also shared coplanar faces.

**Fix:** Flat-face text export → `extrudeGroupsOnFace` (closed solids). Multi-colour AMS parts get 0.06 mm proud skin offset. Art layers sanitized with `sanitizeMeshForStl`.

**Files:** `js/features.js`, `js/app.js`, `index.html`

**Test:** Re-export coffee box 3MF → Bambu: solid COFFEE letters, mesh warnings gone or minimal. Hard refresh `app.js?v=326`.

### 2026-07-14 — b325: Multi-colour graphic resize no longer freezes preview

**Symptom:** Dragging graphic size / art sliders with 6-colour coffee bag + COFFEE text hung the tab ("Page Unresponsive"); resize eventually applied but unusably slow.

**Cause:** Flat/front multi-colour preview ran full vector polygon union ×6 layers on every art rebuild (~900k px/layer). Wrap had row shells; front face did not.

**Fix:**
- Front/wrap **preview** → row shells per AMS layer (export still vector contours)
- Preview mask budget 900k → **450k** cells
- Art slider debounce **320ms** when multi-colour trace active

**Files:** `features.js`, `app.js`, `index.html`

**Test:** Coffee bag + text, drag Graphic size — preview keeps up. Export unchanged. Hard refresh `app.js?v=325`.

### 2026-07-14 — b324: Restore golden cyan trace preview for multi-colour logos

**Symptom:** Coffee bag trace preview showed dark red/navy AMS swatches (tiny/wrong) instead of full cyan ink overlay + big black bag silhouette.

**Cause:** Multi-colour preview drew each layer in sampled hex (burgundy bg leaked in when invert off). Dark-background logos need light-on-dark invert.

**Fix:**
- Multi-colour `drawTracePreview` → unified **cyan ink mask** (golden b284 path)
- Auto-detect dark logo background → effective invert for multi-colour trace
- Canister coffee presets default `traceInvert: true`

**Files:** `trace.js`, `geometry.js`, `app.js`, `index.html`

**Test:** Re-import coffee bag → cyan overlay, full bag shape. Toggle invert still works. Hard refresh `app.js?v=324`.

### 2026-07-14 — b323: Fix wrap preview freeze with multi-colour graphic + text

**Symptom:** Canister/cooler with multi-colour trace + wrap text (e.g. coffee bag + COFFEE) hung the tab ("Page Unresponsive").

**Cause:** Wrap text row shells (b319+) and multi-colour wrap graphics (b315) both forced `fineRows: true` in **preview**, scanning every mask row × 6 colour layers — no `WRAP_TRACE_PREVIEW_MAX_ROWS` cap.

**Fix:** `fineRows` only on export (`__labelExportStandoff`). Preview uses capped row step like coffee-bag golden path. Wrap text band layout reuses computed flat band (no extra text raster pass).

**Files:** `features.js`, `app.js`, `index.html`

**Test:** Coffee bag multi-colour + COFFEE on wrap/canister — preview responsive; export still full-res. Hard refresh `app.js?v=323`.

### 2026-07-12 — b322: Fix stale build tag (MAKERDECK_BUILD stuck on b315)

**Symptom:** Pi had b321 wrap-arc code but `MAKERDECK_BUILD = "b315"` — header showed 315 after load.

**Fix:** Align `MAKERDECK_BUILD`, `index.html` `app.js?v=`, to **b322**. Hard refresh required.

**Files:** `app.js`, `index.html`

### 2026-07-12 — b321: Wrap arch up / arch down banner bow

**Problem:** Arch up/down on wrap used circular plaque arc — letters tilted sideways on the cylinder. Preset clicks didn't reposition above/below graphic when move sliders were set.

**Fix:**
- Wrap arc uses **horizontal banner bow** (upright letters, curve in height) — not circular plaque arc
- **Arch up** → above graphic, bow upward; **Arch down** → below, bow downward
- Preset buttons on wrap reset offsets and snap to logo stack

**Files:** `features.js`, `app.js`, `index.html`

**Test:** MUSTANG wrap → Arch up above car (level arch); Arch down below. Hard refresh `app.js?v=321`.

### 2026-07-12 — b320: Wrap text move sliders work (flat + arc)

**Problem:** Text up/down and left/right did nothing on wrap (flat or arc). Arc still landed on the side of the cylinder.

**Cause:** Row shells mapped mask pixels via canvas offsets that didn't track the face bbox; arc placement ignored move sliders unless &gt; 0.05 mm.

**Fix:**
- Wrap text row shells use **face left/bottom + glyph origin** (same convention as graphic art)
- **resolveWrapTextBand** — move sliders always apply; with zero offsets text stacks above/below traced graphic
- Flat and arc share one placement path on wrap

**Files:** `features.js`, `app.js`, `index.html`

**Test:** MUSTANG on wrap — up/down moves text; Arc stays on front above car. Hard refresh `app.js?v=320`.

### 2026-07-12 — b319: Wrap text row shells (same as graphics)

**Problem:** Arc MUSTANG still landed on the side of the cylinder (~90° rotated) while flat text and traced graphics sat correctly on the front.

**Cause:** Wrap **graphics** use ink-mask **row shells** with seam unwrap at the logo centre; wrap **text** used vector extrude + `normalizeWrapShapeGroups`, which folded arc letters to the wrong side of the wrap.

**Fix:**
- All wrap text (flat + arc) now uses **row shells** from `computeTextArtLayout` placement — same golden path as traced art
- Explicit `anchorX` from layout centre for seam unwrap
- Arc preset buttons no longer wipe move sliders

**Files:** `features.js`, `app.js`, `index.html`

**Test:** Flat MUSTANG above car → Arc/Wide → stays on front, arched above graphic. Hard refresh `app.js?v=319`.

### 2026-07-12 — b318: Flat→arc inherits move sliders on wrap

**Problem:** Flat MUSTANG at up/down 2.70 was easy to place; switching Text path to Arc jumped to the opposite side — arc ignored flat move sliders and preset clicks wiped offsets.

**Fix:**
- Wrap arc **inherits flat text band** when move sliders are non-zero (same spot, now arched)
- Flat→Arc switch always refreshes arc params but **preserves** left/right + up/down
- Arc preset buttons only reset offsets when explicitly nudging (Arch up/down), not on every graphic load

**Files:** `features.js`, `app.js`, `index.html`

**Test:** Flat MUSTANG above car at up/down 2.70 → switch Arc → stays above car, arched. Hard refresh `app.js?v=318`.

### 2026-07-12 — b317: Wrap arc text glyph anchoring

**Problem:** b316 put arc text on the right side of the wrap but still offset (arc circle origin ≠ ink centre) and tilted — titles did not sit centred above/below the logo.

**Fix:**
- Anchor to **glyph ink bounds**, not arc raster centre — horizontal centre on logo, bottom/top edge above/below graphic
- Wider auto arc radius on wrap (flatter title bar)
- Auto arc preset on wrap + graphic → **Wide (banner)** instead of tight arch-up

**Files:** `features.js`, `app.js`, `index.html`

**Test:** Mustang wrap → MUSTANG centred above car, same face. Hard refresh `app.js?v=317`.

### 2026-07-12 — b316: Wrap arc text above/below graphic

**Problem:** Arc text on wrap (e.g. MUSTANG above car graphic) landed on the **opposite side** of the cylinder from the logo, often upside-down — arc centre used X=0 instead of the graphic’s wrap centre (`faceW/2`).

**Fix:**
- Arc text on **wrap** anchors horizontally to the **graphic centre** (same as trace placement)
- **Arch up / Wide** → text above the logo; **Arch down** → below
- Move up/down sliders fine-tune from that auto position
- Flat faces unchanged

**Files:** `features.js`, `app.js`, `index.html`

**Test:** Mustang (or any wrap + graphic) → Arc + MUSTANG sits above/below the graphic on the same side. Hard refresh `app.js?v=316`.

### 2026-07-12 — b315: Multi-colour wrap row shells (fix earcut gaps)

**Problem:** St George preview/export on wrap showed broken top edge, horizontal splits, giant folded triangles — earcut contour caps fold on curved walls.

**Fix:** Wrap face multi-colour layers use **ink-mask row shells** (coffee-bag golden path) per AMS colour. Flat faces still use vector contours. Export masks capped ~520k px/layer.

**Files:** `features.js`, `app.js`, `index.html`

**Test:** Re-trace Dragons on wrap → solid fills, no top-edge holes. Hard refresh `app.js?v=315`.

### 2026-07-12 — b314: Multi-colour resolution + closed contour export

**Problem:** Horizontal shredded lines on logos (Tigers silver border) — partly trace upscale to 2000px (too many mask pixels → dense/stair-step contours); export open-bottom caps caused inside anomalies + slicer static. Slab export (b313 draft) also caused 0.2 mm horizontal banding — not suitable for logos.

**Fix:**
- Trace upscale cap **2000 → 1400 px** — enough for team logos, fewer pixel stairs
- Export: **closed vector contours** (both caps) for AMS parts — not row shells, not 0.2 mm slabs
- `prepareMeshFor3mf` on art parts (light weld)

**Files:** `trace.js`, `features.js`, `app.js`, `index.html`

**Test:** Re-trace Tigers/Dragons → smoother preview; export → solid slicer fills, no inside red dots. Hard refresh `app.js?v=314`.

### 2026-07-12 — b312: Multi-colour export contour quality (revert row shells)

**Problem:** b311 row shells shredded in Bambu slicer (horizontal band islands). Too-coarse export simplify also caused giant wrap facets on flat shield fills.

**Fix:**
- Export back to **vector contour extrusion** (same clean path as preview/slicer-tested Tigers)
- Moderate export downsample (~1M px/layer — one halving from trace, not full 4M)
- Finer export simplify (`max(0.22, w/680)`) — smaller 3MF than full-res but no huge triangles

**Files:** `features.js`, `app.js`, `index.html`

**Test:** Export St George → solid colour fills in slicer, file smaller than pre-b311 full-res. Hard refresh `app.js?v=312`.

### 2026-07-12 — b311: Smaller multi-colour 3MF export

**Problem:** Multi-colour heraldic exports produced huge 3MF files — full-res contour extrusion × 6 AMS layers.

**Fix:**
- **Export (wrap):** compact row shells on downsampled masks (~320k px/layer) with ~0.2 mm row stepping — same strategy as coffee-bag art
- **Preview:** unchanged smooth contours, masks downsampled to ~900k px before polygonise (faster rebuild)
- Export flat-face fallback uses coarse contour if row path unavailable

**Files:** `features.js`, `app.js`, `index.html`

**Test:** Export St George 3MF — file size should drop dramatically; slicer colours still separate. Hard refresh `app.js?v=311`.

### 2026-07-12 — b310: Multi-colour contour clean edges (St George mesh fix)

**Problem:** After b309 palette merge, preview still showed hairy/scratchy outlines and triangulation noise — especially on heraldic crests (St George).

**Cause:** Each AMS layer ran `unionShapeGroupsToPrepared` with **dilatePasses=3**, expanding contours outward into neighbouring colour regions. All layers shared the same emboss depth → z-fighting and messy seam lines. Trace-time shapeGroups were also too detailed (low simplifyTol) and cached into mesh build.

**Fix:**
- Rebuild contours at mesh time only — ignore cached trace shapeGroups
- **dilatePasses=0** for multi-colour layers (no outward bleed)
- Stronger simplify (`max(0.14, w/1100)`) + 5 smooth passes for clean wrap curves
- Trace stores masks only (faster trace, mesh always uses fresh contours)

**Files:** `features.js`, `trace.js`, `app.js`, `index.html`

**Test:** Re-trace St George → smooth colour fills, no scratchy overlap at boundaries. Hard refresh `app.js?v=310`.

### 2026-07-12 — b309: Multi-colour palette merge (St George fix)

**Problem:** Complex heraldic PNGs (St George Dragons) detected 10+ anti-alias colour buckets → overlapping contour meshes, jagged noisy 3D preview.

**Fix:**
- Coarser ink quantize for multi-colour only (`step 48` vs 28)
- Cap practical AMS layers to **6** (`MULTI_COLOUR_MAX_LAYERS`)
- **Nearest-neighbour palette assignment** — each pixel belongs to exactly one dominant colour (mutually exclusive masks)
- Higher min pixel threshold drops anti-alias fringe
- Trace meta shows `merged from N inks (AMS max 6)` when colours were consolidated

**Files:** `trace.js`, `app.js`, `index.html`

**Test:** Re-trace St George PNG → expect ≤6 clean colour layers, no overlapping mesh garbage. Wests Tigers / coffee bag Auto path unchanged.

### 2026-07-12 — b308: Font always visible on Text tab

**Fix:** Font, text colour, size, and Flat/Arc path no longer hidden until text is typed — arc controls only show when text + Arc mode.

### 2026-07-12 — b302: Multi-colour logo trace (team logos → AMS slots)

**Goal:** Stop fighting solid-logo line-art traces for heraldic/team crests. Detect colours from PNG, emboss each separately, export one 3MF part per colour.

**Changes:**
- **Trace mode:** `Multi-colour — team logo (AMS)` splits foreground into per-colour ink masks (`traceMultiColourCanvasAsync`).
- **Preview:** Each colour layer renders in its detected hex on the wrap.
- **Export:** Separate 3MF parts (`Art Orange`, `Art White`, etc.) — one AMS filament slot each. Uses golden `buildEmbossBitmap` row shells per layer (same path as coffee-bag preview).
- **UI:** Art colour picker hidden when multi-colour trace active; export plan lists each colour part.

**Files:** `trace.js`, `features.js`, `app.js`, `geometry.js`, `index.html`

**Test:** Wests Tigers / Broncos PNG → trace mode **Multi-colour** → cooler wrap → export 3MF. Expect Body + Art Orange + Art White + Art Black (colours vary by asset). Coffee bag line-art path unchanged (Auto/Outline).

**Deploy:** Hard refresh (Ctrl+Shift+R). Pi pull + restart.

### 2026-07-12 — b301: Dense heraldic line art — skip wrap mask close (Tigers striations)

**Symptom:** b300 close but Tigers still horizontal strips in slicer/preview.

**Cause:** `needsClose` triggered for outlineRaster with ≥5000 runs + ≥18% fill — morphological close eroded Tigers ink into broken row fragments. Export also downsampled mask to 1.2M cells.

**Fix:** Only close for colour logo or fill ≥28% block art. Export keeps up to 4M mask cells; wider run spans on export (fewer vertical slice seams).

### 2026-07-12 — b300: Slicer export matches preview for wrap trace art

**Symptom:** Wests Tigers (etc.) perfect in MakerDeck preview; 3MF Art part horizontal bands / garbage in Bambu slicer.

**Cause:** Separate-colour export used `collectBitmapGraphicShapeGroups` + earcut/coarse `buildFaceDecalSlabMesh` instead of preview's `buildEmbossBitmap` row shells. Export also stepped wrap rows at `DECAL_LAYER_MM` (~87px) → visible striations.

**Fix:** `buildGraphicLabelExportMesh` routes trace through `buildEmbossBitmap`. Skip layer-height row coarsening when `fineRows` (wrap golden path).

### 2026-07-12 — b299: Stop wrap emboss solid black slab (outline flood fill)

**Symptom:** b298 made logos worse — solid dark rectangle on wrap, no detail.

**Cause:** b298 always picked `outlineRaster` on wrap. Megapixel outline fast-path bins entire crop (lum < threshold) → ~100% fill mask → row shells = solid slab.

**Fix:** Wrap auto only picks outline when fill 4–45% or line-art meta. Otherwise solid silhouette. Reject outline blob masks >52% fill at emboss time.

### 2026-07-12 — b298: Broncos/Warriors — stop mask close eroding thin logo text

**Symptom:** Trace preview full (BRISBANE + shield) but 3D wrap only shows thick shield — thin text gone. Meta still `solid logo`.

**Cause:** `preprocessWrapDenseLineArtMask` ran for all non-line-art fills ≥18% — dilate+erode ate 1–2px text strokes while thick shield survived.

**Fix:** Only close mask for dense **line-art** (`outlineRaster` + high run count / colour logo). Wrap auto always prefers `outlineRaster` when available. Re-trace on face change to wrap.

### 2026-07-12 — b297: Warriors solid-logo wrap — rects mask + no earcut fallback

**Symptom:** b296 still broken on Warriors — meta `solid logo` (not colour logo). Preview OK, 3D jagged/missing detail on wrap.

**Cause:** (1) Megapixel traces stored without mask after session; `ensureEmbossBitmapMask` rebuilt from simplified united `shapeGroups` instead of `rects`. (2) Golden wrap path failure fell through to `extrudeGroupsOnFace` earcut. (3) Auto on wrap picked solid silhouette over `outlineRaster` (thin-edge fill below line-art threshold).

**Fix:** Rebuild mask rects → silhouetteMask → shapeGroups. Block earcut on wrap entirely. Downsample megapixel masks for wrap emboss. On wrap auto, prefer `outlineRaster` when ink runs exist.

### 2026-07-12 — b296: Wrap golden path for colour logo / silhouette traces

**Symptom:** Coffee bag / Wests / knight perfect (`line art mask · double-edge`). Warriors etc. fail — meta says `colour logo` or `silhouette`, 3D broken on wrap. PNG vs JPG irrelevant.

**Cause:** Only `outlineRaster` used coffee-bag row shells on wrap. Colour logo / silhouette used earcut contour on curve.

**Fix:** `buildWrapGoldenSlabEmboss` — any trace with mask/silhouetteMask → row shells on wrap. Auto on wrap prefers line art when viable.

### 2026-07-12 — b289: Circle cooler wrap — seam unwrap + contour silhouettes

**Symptom:** Wests Tigers / solid logos on circle cooler **Wrap** — horizontal black bars, shredded text at bottom. Jar/front still OK.

**Cause:** b286 forced all wrap silhouettes through `buildWrapTraceSlabMesh` **before** contour/shapeGroups path. Row slabs had no `unwrapWrapX` at the cylinder seam (unlike `buildWrapArtSlabMesh`).

**Fix:**
- `buildWrapTraceSlabMesh` — seam-unwrap runs via `unwrapWrapX` (anchor = art centre).
- Removed early wrap-silhouette slab shortcut — silhouettes use `extrudeGroupsOnFace` (single island → direct contour; multi → art slabs with unwrap).
- Wrap line art keeps fine-row slabs with seam unwrap.

**Test:** Jar/front coffee bag first, then Wests Tigers PNG on circle cooler **Wrap**.

### 2026-07-11 — b288: Drop PNG/JPG — clear hidden SVG + old trace state

**Symptom:** Dropping coffee bag after SVG still wrong; old SVG details seem to linger.

**Cause:** Only canvas swapped — `traceSvgImport`, `embossSvgText`, `embossSvgEnabled`, old `embossTraceRects`, Add SVG checkbox all stayed from prior import.

**Fix:** `resetTraceImportForRaster()` on PNG/JPG drop/paste; Clear also wipes SVG UI state.

### 2026-07-11 — b287: Coffee bag broken after SVG — clear traceSvgImport

**Symptom:** Coffee bag on Auto shows `2 islands · single colour · 29% fill` (silhouette blob) instead of `6977 ink runs · line art mask · 14% fill`.

**Cause:** After SVG import, `traceSvgImport` stayed true. Pasting/dropping PNG still ran `traceFlattenedSvgCanvasAsync` (silhouette) instead of Auto triple-trace.

**Fix:** Reset `traceSvgImport = false` on PNG/JPG load and Clear.

### 2026-07-11 — b286: Wrap JPG/silhouette — fine-row ink mask

**Symptom:** JPG paste + Auto on wrap — trace preview OK (1 island · 42% fill) but 3D broken/empty. SVG same on wrap.

**Cause:** Wrap ink slab coarsened to zero tris (preview index cap) → fell back to broken shapeGroups extrude.

**Fix:** Wrap silhouette slabs use `fineRows` (full mask, no preview cap). Rebuild mask from shapeGroups when session mask missing.

### 2026-07-11 — b285: Wrap + SVG — coffee-bag defaults (front face, ink mask emboss)

**Symptom:** drags.svg on cooler wrap — trace preview OK but 3D shows broken hook shard; canister auto-switches to Wrap face.

**Why:** Coffee bag uses Auto + ink pixel mask on emboss. SVG silhouettes on wrap used multi-island contour/art slabs → partial geometry. Canister shape forced `embossFace = "wrap"`.

**Fix:**
- Canister keeps **Front** face by default (wrap opt-in).
- Wrap silhouettes: **ink pixel slabs** (same as coffee bag line art) before shapeGroups extrude.
- SVG import keeps **Auto** in trace mode UI (fast silhouette raster path unchanged).

- Cache **b285**. Hard refresh, re-drop drags.svg on front first, then try wrap.

### 2026-07-11 — GOLDEN: b284 locked (trace preview + b278 emboss)

**Symptom:** Trace meta says `line art mask · 6977 ink runs · mask 14% fill` but preview shows thin cyan edge strokes only, not full ink overlay like b278.

**Fix:** `drawTracePreview` now prioritises raster ink mask (`silhouetteMask` / `mask` / ink runs) before vector stroke paths. `outlineRaster` never uses centerline stroke preview.

- Cache **b284**. Hard refresh, Clear, re-trace coffee bag (Auto) — cyan should cover all ink pixels.

### 2026-07-11 — b283: Revert emboss path to b278 (ad24606)

**Symptom:** b279–b282 wrap experiments broke coffee bag line art, heraldic logos, scan quality.

**Fix:** Restore `features.js` emboss/wrap extrude logic from **b278** (`ad24606`). Trace/auto line-art detection unchanged (already b278 in `trace.js`).

- Cache **b283**. Hard refresh — coffee bag + knight on jar should match b278 “perfect” again.

### 2026-07-11 — b282: Fix broken wrap logos — per-island contour, no merge

**Symptom:** Heraldic/knight logo on cooler wrap shows fragmented shards (shield corners + thin sliver only).

**Cause:** b279 `mergeWrapSolidLogoGroups` unioned multi-island logos into one ring (holes stripped) → self-intersecting polygon → partial/broken contour extrude.

**Fix:**
- **Removed** island merge on wrap — extrude each trace island separately (same as jar).
- Wrap solids: per-group contour → art slabs → fine mask slab last resort.
- Line art on wrap unchanged (ink pixel slabs).

- Cache **b282**. Hard refresh, re-drop knight/broncs on cooler wrap.

### 2026-07-11 — b281: Fix wrap scan lines — no pixel-row fallback for solid logos

**Symptom:** After b280 blank fix, cooler wrap logos show horizontal scan lines again.

**Cause:** b280 enabled `buildWrapTraceSlabMesh` pixel-row fallback for solid silhouettes when contour extrude failed. Row shells without seam unwrap = scan-line texture on wrap.

**Fix:**
- Solid logos on wrap: contour extrude → seam-unwrapped **art slabs** if contour fails (never pixel-row mask slabs).
- Pixel-row wrap shells **only** for `outlineRaster` line art (always `fineRows`).
- `buildWrapTraceSlabMesh` uses `unwrapWrapX` at wrap seam for line art.

- Cache **b281**. Hard refresh, re-test knight/broncs on cooler wrap + coffee bag on jar.

### 2026-07-11 — b280: Fix blank wrap emboss (`opts` ReferenceError)

**Symptom:** After b279, emboss blank on cooler wrap (and any wrap fallback path). `buildWrapTraceSlabMesh` referenced `opts.fineRows` but `opts` was never a parameter — `ReferenceError` on fallback.

**Fix:**
- Add `opts = {}` to `buildWrapTraceSlabMesh` signature.
- Wrap contour extrude only returns early when geometry was actually produced; mask slab fallback can run when contour fails.

- Cache **b280**. Hard refresh (Ctrl+Shift+R), re-drop logo on cooler wrap.

### 2026-07-11 — b279: Cooler wrap logos — contour extrude, not row slabs

**Symptom:** Knight/heraldic logo perfect on jar; cooler shows horizontal black bars through art. Trace correct — cooler wrap used row-slab mesh on multi-part silhouette.

**Fix:**
- Merge wrap logo islands to **one solid contour** before extrude.
- Solid silhouettes on wrap → **direct contour extrude** (same as jar).
- Row slabs only for line-art raster (`outlineRaster`).

- Cache **b279**. Hard refresh, re-drop logo on cooler wrap.

### 2026-07-11 — b278: Trace = container — auto picks line art not silhouette blob

**Insight:** Preview and container match — problem is **what gets traced**. Auto picked solid silhouette (21% fill, 1 island) for coffee-bag line art; ink lines never traced.

**Fix:**
- Auto mode detects **line art** (low fill + many ink runs) → picks outline raster, not silhouette blob.
- Emboss uses **full ink pixel mask** for outline raster (every traced line, not polygonised outer shell).
- Trace preview dims source image — cyan overlay is what embosses.

- Cache **b278**. Coffee bag: re-trace on Auto or Outline. broncs SVG unchanged (silhouette path).

### 2026-07-11 — b277: Wrap logo — direct contour extrude, not broken slab strips

**Symptom:** b276 showed jagged partial shape — straight edge, missing left side (slab-run artefact).

**Root cause:** Wrap path preferred pixel **slab runs** over traced **shapeGroups** — column strips mapped wrong on cylinder.

**Fix:**
- Traced silhouettes use **direct wrap extrude** (earcut in arc-length space) for single solid shapes.
- Slab runs only for complex multi-island / holed art fallback.
- Merge text+shield islands into one group before extrude.
- Keep BRISBANE banner satellites; fill row extents in SVG trace.

- Cache **b277**. Hard refresh → **b277**, re-drop broncs.svg.

### 2026-07-11 — b276: Full logo on wrap — fix mid-mesh chop + direct SVG silhouette

**Symptom:** b275 showed distorted BRISBANE text only — horse/shield missing. Preview triangle budget cut mesh **top-to-bottom** mid-row.

**Fix:**
- **No mid-mesh chop** — coarsen row step uniformly across full art height.
- Wrap trace uses **pixel mask slabs** (full silhouette bitmap, not simplified polygons).
- New `traceFlattenedSvgCanvasAsync` — direct mask from flattened SVG, morphological close + fill.
- Preview capped at 420 rows evenly spaced (whole logo, slightly softer detail).

- Cache **b276**. Hard refresh → **b276**, re-drop broncs.svg.

### 2026-07-11 — b275: Unfreeze broncs — raster silhouette, cap wrap mesh budget

**Symptom:** b274 vector path froze tab; preview showed hollow red shield outline only.

**Fix:**
- Dual-layer SVGs (broncs) → **raster silhouette only** — skip vector parse entirely.
- Single silhouette trace (never auto triple-trace on SVG import).
- SVG trace mode changes forced to silhouette (not auto).
- Wrap preview mesh **index budget** 96k; coarser slab grid (380 cols vs 1600).
- Yields before/after rebuild; 896px raster cap.

- Cache **b275**. Hard refresh → **b275**, re-drop broncs.svg. Should trace in ~2s, solid filled logo, tab stays alive.

### 2026-07-11 — b274: Fix broncs.svg — strip bg frame, solid wrap slabs, vector-first

**Symptom:** Outline/silhouette showed logo inside full **rect frame** with horizontal slits; auto logo = two vertical bars only.

**Root causes:**
1. Fast-logo path rasterized full-canvas `#222` background rect → trace saw a picture frame not a logo.
2. Wrap trace slabs used hollow preview shells (`solid: false`) → horizontal gaps between rows.
3. Trace path ignored united `shapeGroups` and used raw pixel mask slabs instead.

**Fix:**
- `prepareSvgForImport()` strips full-viewBox background subpaths before import.
- SVG fill imports use **vector silhouette** (b272 raster merge) — not broken fast-logo trace.
- Trace fallback: `flattenCanvasToInkSilhouette()` unions dark + light ink layers.
- Wrap slabs always **solid**; prefer `shapeGroups` over raw mask on wrap.

- Cache **b274**. Hard refresh → **b274**, re-drop broncs.svg. Expect solid filled horse shield on wrap — no frame, no slits, no twin bars.

### 2026-07-11 — b273: Stop page freeze on broncs.svg — fast logo import path

**Symptom:** Browser **Page Unresponsive** on SVG drop — vector parse + triple auto-trace blocked main thread for seconds.

**Fix:**
- **Complex SVGs** (dual colour, 5+ paths, e.g. broncs) skip vector parse entirely.
- One **1280px raster + single colourLogo trace** (not slow auto triple-trace).
- Yields to browser between raster / trace / rebuild; `Loading broncs.svg…` status.
- Simple SVGs still use lightweight vector path.

- Cache **b273**. Hard refresh → **b273**, re-drop SVG. Click **Wait** if prompt appears once — should finish in ~2–4s not hang.

### 2026-07-11 — b272: Solid SVG silhouette — fill horse, not hollow outline

**Symptom:** broncs showed arched text + shield **outline only** — empty interior, horse missing.

**Cause:** Dual-layer paths nested as polygon holes; union kept outline rings, dropped solid fill.

**Fix:** Raster-merge **all ink islands** to one mask (both #222 + #e3e3e3), dilate/close, extract **largest solid outer** with **zero holes** — one filled plaque for emboss.

- Cache **b272**. Hard refresh, re-drop broncs.svg.

### 2026-07-11 — b271: Faster SVG preview + loading status

**Symptom:** broncs.svg eventually appeared but felt slow — heavy union + wrap slab grid blocked UI with no feedback.

**Fix:**
- Preview tier: lower path samples (880), silhouette union (704px), wrap mask (1664 cells); export unchanged.
- `Processing broncs.svg…` / `Tracing…` status while import runs; yield to browser before rebuild.

- Cache **b271**. Hard refresh → **b271**.

### 2026-07-11 — b270: Hotfix blank b269 — restore applyTraceToBox, vector-first SVG

**Symptom:** b269 blank preview — app.js syntax break (`applyTraceToBox` body orphaned at module scope).

**Fix:**
- Restore `applyTraceToBox()` function.
- SVG import: **vector first** (island union), trace fallback only if mesh empty — drop forced multi-ink trace route.

- Cache **b270**. Hard refresh — must show **b270**, re-drop broncs.svg.

### 2026-07-11 — b269: Complete SVG logo import — multi-ink trace + island union

**Symptom:** broncs.svg showed horizontal band gap (false holes), shattered earcut (b267), or incomplete silhouette — not matching browser SVG.

**Root causes:**
1. Dual-layer auto-traced paths nested as **holes** inside shield → text band carved out.
2. b267 **earcut on wrap** → triangle slashes on curved wall.
3. Filled SVG always forced **vector** path, bypassing proven **colorLogo** trace.

**Fix:**
- **Multi-ink SVGs** (≥2 fill colours or ≥8 rings, e.g. broncs.svg) → raster + **auto trace** (colorLogo silhouette) + wrap trace slabs.
- **Simple SVGs** → vector with **ink island union** (no hole nesting before merge).
- Vector failure → auto fallback to trace.
- UI: SVG checkbox stays on; meta shows `traced silhouette · on box`.

- Cache **b269**. Hard refresh, re-drop broncs.svg.

### 2026-07-11 — b268: Fix wrap SVG earcut slashes — slabs only

**Symptom:** b267 vector earcut on wrap → shattered triangle web inside bronco logo.

**Fix:**
- **Never earcut on wrap** — always `buildWrapArtSlabMesh` (seam-unwrapped pixel runs).
- Finer mask (1600 cols, 3072 cell cap, 0.03 mm step), solid depth shells in preview.
- Layout bbox uses filtered ink rings only (drops full-canvas background from sizing).

- Cache **b268**. Hard refresh, re-load broncs.svg.

### 2026-07-11 — b267: Cleaner SVG on wrap — vector extrude + seam-unwrapped slabs

**Symptom:** broncs.svg visible on wrap but **horizontal scanlines**, gaps in upper half, centre seam — coarse `buildFaceDecalSlabMesh` without wrap seam unwrap.

**Fix:**
- **Vector first** for united SVG silhouettes (≤8 groups, ≤1600 pts) — solid earcut extrusion on wrap arc space.
- **Fallback:** `buildWrapArtSlabMesh` — same pixel-mask + `unwrapWrapX` + `pushWrapRunShell` strategy as traced bitmap (not flat face slabs).
- Finer SVG slab grid (1280 cols, 0.035–0.09 mm step), mask dilate + close to fill pinholes.

**Files:** `js/features.js`, `js/app.js`, `index.html`

- Cache **b267**. Hard refresh, re-drop broncs.svg — logo should be solid maroon, no horizontal slicing.

### 2026-07-11 — b266: SVG drag-and-drop + reliable vector silhouette

**Symptom:** Could not drag broncs.svg onto MakerDeck; plain file input had no drop target. SVG still invisible on wrap after b265.

**Fix:**
- **SVG drop zone** (`#svg-drop`) — dashed box with drag-over highlight, click-to-browse, always visible on Art tab (profile/box shapes).
- Shared `wireArtDropZone()` — `dragenter`/`dragleave` depth counter, `dropEffect=copy`, Windows `DataTransferItem` fallback.
- Image drop zone (`#trace-drop`) uses same hardened handlers.
- **Vector parse:** sample paths in SVG user units only (no `getCTM` in scratch parse) — avoids hidden-SVG scale bugs.
- **Silhouette prep:** union dual ink layers first, then extrude slabs on wrap.

**Files:** `index.html`, `css/style.css`, `js/app.js`, `js/features.js`

- Cache **b266**. Hard refresh (Ctrl+Shift+R). Art tab → drop broncs.svg on **SVG import** box or **or image** box. Meta: `Loaded: broncs.svg · filled vector · on box`.

### 2026-07-11 — b265: Fix invisible SVG — CTM squashed paths to 1px coords

**Symptom:** SVG showed loaded but **no emboss mesh** — blank cylinder.

**Root cause:** Hidden scratch `<svg>` had CSS `width:1px;height:1px`. `getCTM()` scaled viewBox coords (395×578) down to ~0–1 px; background filter then discarded all rings as noise.

**Fix:**
- Scratch SVG uses full viewBox pixel size (hidden off-screen).
- Skip destructive CTM when scale &lt; 0.25 — sample in SVG user units.
- Status line shows **on box** vs **no emboss mesh yet** after rebuild.

- Cache **b265**. Hard refresh, Clear, re-load broncs.svg — meta should say `Loaded: broncs.svg · filled vector · on box`.

### 2026-07-11 — b264: SVG file picker feedback — visible loaded filename

**Symptom:** After choosing broncs.svg, native input showed **No file chosen** and no status — looked like import failed.

**Cause:** Handler cleared `input.value` immediately; status went to hidden `#trace-meta` then `updateTraceUi()` wiped it.

**Fix:**
- Visible `#svg-import-meta` under SVG file field — `Loaded: broncs.svg · filled vector`.
- Store `embossSvgFileName` in state; `syncSvgImportUi()` on load/clear.
- Drop zone + trace file picker accept **SVG** and route to vector import.

- Cache **b264**. Hard refresh, tick **Add SVG graphic**, choose file — meta line shows filename even though browser input resets.

### 2026-07-11 — b263: Fix invisible SVG — relaxed path closure + vector prep first

**Symptom:** b262 loaded fast but **no art visible** on Wrap — fill rings empty because path closure check was 0.05 px; raster-only union returned nothing.

**Fix:**
- `svgSampleIsFillRing` — trust explicit `Z`, scale closure eps to path size (~0.4% span).
- Union **all** non-background ink layers (not dark-only pick that dropped rings).
- **Vector prep first**, raster union fallback; raw groups last resort.
- Stroke fallback when fill extrusion produces no mesh.

- Cache **b263** (`app.js?v=263`, `features.js?v=263`). Hard refresh, Clear, re-load broncs.svg.

### 2026-07-11 — b262: SVG wrap speed + fix earcut mesh gore

**Symptom:** b261 loaded forever and preview showed earcut slash garbage (spiky triangle soup) on Wrap.

**Fix:**
- **Wrap always uses raster slabs** — reverted earcut on curved walls (root cause of mesh gore).
- **Finer SVG wrap slabs** — 880 cols, 0.05–0.16 mm step (was 560 / 0.08–0.26 for trace).
- **Fast SVG silhouette prep** — single 768px raster union instead of chaikin + earcut on 6400-pt polylines.
- **Reduced path sampling** — 1600 pt cap, 0.1 spacing (was 6400 / 0.06).
- **Import speed** — skip full mesh build on import; stroke extrusion skipped when fills present.

- Cache **b262** (`app.js?v=262`, `features.js?v=262`). Hard refresh, Clear, re-load broncs.svg on Wrap — should load quickly with clean slab emboss, no triangle soup.

### 2026-07-11 — b261: SVG compound paths — hole grouping, bg filter, single ink layer

**Symptom:** b260 still jagged/messy on Wrap — overlapping solids, full-canvas background rect extruded, dual #222+#e3e3e3 layers doubled geometry.

**Fix (`features.js`):**
- Track fill colour per ring; **pick primary dark ink layer** (skip light duplicate layer from auto-traced SVGs).
- **Filter full-viewBox background rects** and speck noise.
- **groupPolygonsWithHoles** on all fill rings (compound path cutouts become holes, not stacked solids).
- Per-path multi-`M` subpaths collected before global hole grouping.
- `filterDegenerateShapeGroups` before extrude; fragment union only when >10 loose groups.

- Cache **b261** (`app.js?v=261`, `features.js?v=261`, `contour.js?v=241`). Hard refresh, Clear, re-load broncs.svg on Wrap. Expect **filled vector**, clean shield silhouette with BRISBANE text island — no scribbly overlap.

### 2026-07-11 — b260: SVG vector quality — fine path sampling + wrap extrusion

**Symptom:** Proper SVG logos (e.g. Broncos broncs.svg) looked crisp in browser but jagged/stepped in MakerDeck 3D preview — especially on **Wrap** face (horizontal slab ribs).

**Fix:**
- `features.js` — SVG path sampling: 6400 pt cap, 0.06 spacing (was 900 / 0.28); lighter dedupe.
- `contour.js` — new `prepareSvgShapeGroups` keeps native vector detail (no trace-style pixel stair smoothing).
- `features.js` — SVG fill simplify tol ~`max(sw,sh)/2200` (was `/480`); wrap face uses **vector earcut extrusion** for SVG imports instead of raster slabs.
- `features.js` — `normalizeWrapShapeGroups` on SVG fill rings before extrusion.
- `app.js` — filled SVGs always take vector import path (no trace fallback).

- Cache **b260** (`app.js?v=260`, `features.js?v=260`, `contour.js?v=240`, `geometry.js?v=260`). Hard refresh, Clear, re-load broncs.svg on Wrap face. Status should say **filled vector**; preview should show smooth curves not horizontal steps.

### 2026-07-11 — b259: Auto prefer colour logo + keep BRISBANE satellite text

**Symptom:** Broncos crest Auto picked **solid logo** (1 island, ~21% fill). Shield/horse embossed but **BRISBANE** arched text missing — separate island pruned because `keepLogoSatellites` only applied on colour-logo path and silhouette won auto scoring.

**Fix (`trace.js`):**
- `chooseAutoTraceResult` — prefer colour-logo when fill ≥8% and score within ~25 of silhouette, or when it captures more islands/detail.
- `traceAutoScore` — mascot crest colour-logo gets fill/island bonuses; silhouette-only bonuses no longer stack on colour path.
- `colorLogoMask` — vertical dilate passes bridge arched title toward shield.
- `pruneSilhouetteMask` for colour logo — `minIslandRatio` 0.007, wider `maxIslandDist` (55% span) keeps small text islands.
- Meta uses `islandCount` from mask (not merged polygon count).

- Cache **b259** (`app.js?v=259`, `trace.js?v=259`). Hard refresh, Clear, **Auto — logo / mascot**, re-drop Broncos crest. Expect meta like **`2+ islands · colour logo · auto picked colour logo · mask 25%+ fill`** with BRISBANE on emboss.

### 2026-07-11 — b258: Solidify colour-logo interior (shield + white horse stripes)

**Symptom:** b257 got BRISBANE text but shield/horse hollow — white interior flooded as page background (17% mask). Only bottom outline fragment embossed.

**Fix:** Colour-logo seeds dark + chromatic pixels, dilate/close outline, `fillInteriorEnclosedByOutline` + row extent — fills shield interior including white horse detail.

- Cache **b258**. Hard refresh, Clear, re-drop crest — mask fill should rise (~25%+), full horse+shield in preview and emboss.

### 2026-07-11 — b257: Flood foreground logo mask (BRISBANE + white horse detail)

**Symptom:** Broncos/B&W crest on white background — Auto picked single-colour silhouette. White horse stripes and BRISBANE text missing from emboss because white pixels matched border background; thin text island pruned.

**Fix:** `colorLogoMask` floods **background-only** from image border (not “reject all white pixels”). White detail inside maroon shield stays foreground. Colour-logo prune keeps small satellite islands (text). Auto should show **auto picked colour logo**.

- Cache **b257**. Hard refresh, Clear, Auto — logo/mascot, re-drop crest. Meta should include BRISBANE + horse detail in blue preview and red emboss.

### 2026-07-11 — b256: Dark-background logo foreground detection

**Symptom:** B&W Broncos image traced better overall, but missed **BRISBANE** and white horse detail because the colour-logo candidate treated near-white as background. That works for logos on white, but fails for logos on a dark tile/background.

**Fix:** Colour-logo tracing now samples the image border/corners to infer the real background. If the background is dark/low-chroma, it keeps pixels that differ from that background, including white text and white/cyan detail. White-background logos still use the previous "ignore white" rule.

- Cache **b256** (`app.js?v=256`, `trace.js?v=256`). Hard refresh, Clear, keep **Auto — logo / mascot**, re-drop the B&W Broncos image. Expect BRISBANE and light horse detail to be included.

### 2026-07-11 — b255: Auto colour-logo trace + threshold max 254

**Symptom:** Broncos-style colour logos were choppy or changed unpredictably with threshold. Threshold 97/121/235 did not solve it because the old Auto candidates were still mostly brightness-based, so coloured logo art on white background could turn into partial masks or filled slabs.

**Fix:** Auto trace now includes a **colour logo** candidate: ignore transparent/white background, keep saturated or dark logo pixels, then score that against line-art and solid-logo candidates. Trace status can now say **auto picked colour logo**. Threshold slider max is exposed as **254** (the internal clamp), up from 235.

- Cache **b255** (`app.js?v=255`, `trace.js?v=255`). Hard refresh, Clear, keep mode on **Auto — logo / mascot**, re-drop Broncos/Bulldogs-style logos. For colour logos, expect **auto picked colour logo** rather than fighting threshold.

### 2026-07-11 — b254: Auto trace for logo/mascot workflow

**Goal:** MakerDeck should support the normal shop workflow: pick cooler colours, drop a Bulldogs/mascot/logo image on the face, trace, and send to print without hand-tuning every artwork.

**Fix:** Added **Auto — logo / mascot** trace mode and made it the default. Auto runs the existing solid-logo and line-art trace paths, scores both for printability, and picks the better result. Status text shows whether Auto picked **line art** or **solid logo**. Manual Silhouette and Outline modes remain available for overrides.

- Cache **b254** (`app.js?v=254`, `geometry.js?v=254`, `features.js?v=254`, `trace.js?v=254`). Hard refresh. Default trace mode should be **Auto — logo / mascot**.

### 2026-07-11 — b253: Close smoothed masks before contour wrap

**Symptom:** b252 switched smoothed complex masks away from row slabs, but rider/dragon still showed fine horizontal texture in filled areas because the contour path was polygonising the raw stair-stepped mask.

**Fix:** Before contour extrusion, `rasterSimplified` trace masks get a small morphological close. This plugs tiny alternating scanline holes and smooths mask edges before polygonising. Normal traces still bypass this cleanup.

- Cache **b253** (`app.js?v=253`, `features.js?v=253`). Hard refresh, Clear, re-drop/re-trace rider/dragon. Expect less horizontal texture in filled rider/leg areas.

### 2026-07-11 — b252: Use contour wrap for complex masks

**Symptom:** b251 reduced bloating, but rider/dragon wrap still showed a stacked-strip look because wrap preview built smoothed masks as thousands of horizontal run slabs.

**Fix:** Applied trace metadata now preserves `outlineRaster`, `rasterSimplified`, and `maskFillPct`. Wrap emboss uses the old row-slab path for normal traces, but smoothed/very busy outline masks now use contour extrusion instead. This should keep the fixed tiger path stable while making complex rider/dragon art less banded.

- Cache **b252** (`app.js?v=252`, `features.js?v=252`, `trace.js?v=252`). Hard refresh, Clear, re-drop/re-trace rider/dragon. If it still says **smoothed complex mask**, the wrap should use contour geometry rather than row slabs.

### 2026-07-11 — b251: Coverage smoothing for complex line art

**Symptom:** b250 reduced the rider/dragon from 12,239 to 6,109 ink runs, but the OR-style downsample fattened thin lines and left chunky filled patches.

**Fix:** Complex line-art smoothing now uses coverage downsample instead of "any ink wins" downsample. A 2x2 block must have enough ink before it survives, reducing run count without swelling fine detail. Trigger lowered to 9,000 runs so near-edge complex art is handled consistently.

- Cache **b251**. Hard refresh, Clear, re-drop/re-trace rider/dragon. Expect less bloating than b250 while still showing **smoothed complex mask** when triggered.

### 2026-07-11 — b250: Smooth over-complex line-art masks

**Symptom:** The tiger is fixed, but very busy black/white art could become thousands of tiny direct ink runs on wrap preview/export. Example: rider/dragon art showed **12,239 ink runs**, producing ragged bands and chunky fragments on the cooler.

**Fix:** Direct line-art masks now auto-simplify when they exceed 12,000 horizontal runs. The source art is still traced as an ink mask, but the mask is downsampled just enough to reduce geometry noise before wrapping. The trace meta adds **smoothed complex mask** when this triggers.

- Cache **b250**. Hard refresh, clear/re-drop the rider/dragon image, then trace. Expect fewer ink runs and less shredded wrap geometry.

### 2026-07-11 — b249: Add trace preview Clear button

**Symptom:** When debugging image trace, there was no local clear/reset control beside the preview, making it hard to rule out stale preview or applied trace state.

**Fix:** Added a **Clear** button in the trace action row. It clears the loaded trace image, preview canvas, trace result/SVG state, and any applied traced emboss while leaving typed text and SVG art alone.

- Cache **b249**. Hard refresh MakerDeck; the trace action row should show **Trace / Use in editor / Clear / Download SVG**.

### 2026-07-11 — b248: Outline trace preserves exact ink mask

**Symptom:** b247 still did not change the tiger. The trace preview continued to leave dark forehead/top marks uncovered, because outline tracing had already erased fine isolated ink with an open/cleanup pass before the double-edge fallback ran.

**Fix:** Outline mode now binarizes with the outline threshold and keeps the raw detected ink mask as the emboss source. Complex/double-edge art no longer falls back to a filled silhouette island; it uses a direct line-art pixel mask so thin separated details survive into preview and 3D wrap.

- Cache **b248**. Hard refresh, re-drop/re-trace the tiger. The meta should say **line art mask** and the preview should put blue over all detected ink, including the top/forehead marks.

### 2026-07-11 — b247: Preserve original ink after double-edge solidify

**Symptom:** b246 did not change the tiger result. The trace preview itself still showed dark/unembossed forehead/crown details, so wrap placement was not the cause.

**Fix:** After double-edge line art is solidified, the final trace mask now unions the original traced ink back into the cleaned solid mask. This prevents cleanup from discarding separate interior detail islands such as the tiger forehead/top stripe while keeping the filled body mask.

- Cache **b247**. Hard refresh, re-trace/re-drop the tiger; the trace preview should show blue over the top/forehead ink before checking the 3D wrap.

### 2026-07-11 — b246: Keep wrap trace inside cooler wall bounds

**Symptom:** Large traced wrap art at max image size could sit flush to the top of the cooler/canister wall, making the top of the tiger trace appear cut off.

**Fix:** Wrap art now uses a small vertical gutter when resolving image height and clamps wrap placement inside that safe wall band. Trace/SVG measurement now uses the actual scaled art height when width-limited, so preview handles, live wrap mesh, and export placement agree.

- Cache **b246**. Hard refresh, re-drop or re-trace the image; if the tiger still feels high, the Move vertical control should now stop before it clips the top edge.

### 2026-07-11 — b245: Plug interior wedge holes (forehead triangular voids)

**Symptom:** Mask mostly fills but forehead has dark triangular wedges — interior holes between double-edge pairs not closed by row extent alone.

**Fix:** After row extent + gap bridge + sandwich: `closeMask` then `fillInteriorEnclosedByOutline` + second row extent. Wider neighbor span (3 rows) and gap bridge span/18.

- Cache **b245**. Hard refresh, re-drop — forehead wedges should be solid teal; meta `mask N% fill` should rise.

### 2026-07-11 — b244: Row-extent fill (preview downscale was lying)

**Root cause:** Trace preview downscales 2400px mask into ~300px — thin edge ink (~5% fill) merges visually and looks solid blue. 3D wrap uses mask 1:1 → only edge strokes emboss. Outline/silhouette modes identical because both produce same low-fill edge mask.

**Fix:** `fillRowExtents` + `fillSandwichedEmptyRows` in `lineArtMaskToSolidFill` — fill between left/right ink per row. Trace meta now shows `mask N% fill` (need ≥14% for solid wrap).

- Cache **b244**. Hard refresh, re-drop — meta should show **mask 20%+ fill**.

### 2026-07-11 — b243: Polygon re-rasterize for line art

**Audit finding:** Outline vs silhouette looked the same because both large traces end in `finishSilhouetteTrace` with low-fill edge mask (~3–12%). Flood-fill interior failed on open double-edge boundaries. Emboss sometimes had no mask blob (localStorage limit) and fell back to hollow shapeGroups.

**Fix:**
- `lineArtMaskToSolidFill` — dilate/merge double-edge strokes → `maskToPolygons` → largest outer → `rasterizeShapeGroupsToMask` (true solid fill). Flood only as fallback.
- `ensureEmbossBitmapMask` — rebuild mask from rects when session omitted large mask.

- Cache **b243**. Hard refresh, re-drop image.

### 2026-07-11 — b242: Root-cause fix — line art ≠ solid silhouette

**Root cause (line-by-line audit):**
1. `silhouetteFillUsable` treated 0.8–52% ink as “solid” — double-edge tiger/heraldic is ~3–12% (edges only) → `solidSilhouetteFill: true` **skipped** interior fill entirely (b240 bug).
2. `solidifyOutlineSilhouetteMask` used hRadius≤10 on 2400px crops — double-edge gaps are 30–80px → flood exterior leaked through → hollow outline emboss.
3. Secondary: full-res masks (4.6M px) couldn’t persist in localStorage → stale/wrong `embossTraceRects.mask` on restore fell back to hollow `shapeGroups`.

**Fix:**
- `isSolidSilhouetteMask` — only skip solidify when fill ≥14% AND no band-gap pattern.
- `solidifyOutlineSilhouetteMask` — close radii scale with image size (hRadius ~span/55, gap ~span/25), retry with thicker wall.
- Session: skip maskB64 when >1.5M px; re-trace on restore (b241 sync keeps preview ≡ emboss).

- Cache **b242**. Hard refresh, re-drop image — preview AND wrap must both be solid fill.

### 2026-07-11 — b241: Sync emboss mask when trace re-runs (preview ≠ 3D)

**Symptom:** Trace preview solid blue (b240 mask) but 3D wrap still hollow outline — "back here again".

**Root cause:** `runTraceAsync` updated preview/`traceLastResult` but never called `storeTraceOnBox` — emboss kept stale `embossTraceRects.mask` from session or prior trace. Threshold tweaks and deferred restore re-traced preview only.

**Fix (`app.js`):** After successful trace, if emboss trace enabled, `storeTraceOnBox` + `rebuild` so wrap uses same `silhouetteMask` as preview.

- Cache **b241**. Hard refresh — nudge threshold or re-drop image; preview and wrap should match.

### 2026-07-11 — b240: Solid silhouette binarize for double-edge auto (not outline ink + flood)

**Symptom:** b239 no visible change — emboss still hollow outline shell on tiger + heraldic.

**Root cause:** Outline fallback used thin `outlineInkCrop` lines. Flood-fill interior fails when double-edge gaps let exterior flood leak through — only edge strokes emboss.

**Fix (`trace.js`):** `finishOutlineFallbackSilhouette` prefers `silhouetteInkCrop` (silhouette binarize + polarity fix) for solid interior. Skips solidify hacks when fill is usable. Outline ink + flood only as fallback.

- Cache **b240**. Hard refresh, re-drop image — preview solid blue fill, not edge ring.

### 2026-07-11 — b239: Flood-fill interior from closed outline (fix hollow emboss)

**Symptom:** After b238, trace/emboss captures outline edges well but interior is hollow — tiger shows only jagged outer edges embossed; heraldic knight/dragon is a fragmented outline shell with gaps where solid body should be.

**Root cause:** b238 row-span hacks (`fillRowInkSpans`, `fillInteriorRowsBetweenInk`, `fillSparseRowsBetweenNeighborInk`) only fill horizontal spans on rows that already have *some* ink. Rows in the true interior (zero ink) stay empty → outline shell, not solid silhouette.

**Fix (`trace.js`):**
- `floodExteriorEmpty` — BFS from image border through non-ink pixels.
- `fillInteriorEnclosedByOutline` — fill pixels neither ink nor exterior (enclosed by closed boundary).
- `solidifyOutlineSilhouetteMask` — close/bridge outline boundary (keep b238 horizontal close + gap bridge), 1px dilate to plug pinholes, then flood-fill interior; retry with wider close if fill still &lt; 4%.
- Removed row-span hacks that caused hollow horizontal-band fills.
- `silhouetteMask` unchanged path — preview + wrap still use same mask after solidify.

- Cache **b239**. Hard refresh, re-drop tiger + heraldic — trace preview mask should be solid black fill inside outline; wrap emboss solid through body/face.

### 2026-07-11 — b238: Stronger double-edge span fill (fix heraldic knight bands)

**Symptom:** Heraldic knight/dragon wrap still has 2–3 thick horizontal void bands through knight/horse upper body after b235–b237. Tiger improved with b236; heraldic bands persist. Art metadata: `1 island · silhouette (auto — double-edge)`.

**Root cause:** `outlineFallback` path was correct and solidify ran, but b235 fixes were too weak for sparse heraldic hatching:
- Outline ink mask is thin double-edge lines with **entire empty rows** between line pairs (knight upper body sparser than dragon).
- `bridgeRowGapsInMask` max gap was only `span/100` (~24px on 2400px crops) — too small for wide double-line spacing.
- `fillSparseRowsBetweenNeighborInk` only filled column-aligned pixels where both neighbors had ink; did not span-fill rows.
- No horizontal 1D morphological close before vertical close.
- Solidify only ran when `outlineFallback` flag set (heraldic does set it, but detection now also catches auto silhouette double-edge).

**Fix (`trace.js`):**
- `closeMaskHorizontal` — 1D morphological close per scanline before 2D close (bridges wide horizontal gaps).
- `fillRowInkSpans` — if a row has any ink, fill minX→maxX span.
- `fillInteriorRowsBetweenInk` — fill completely empty sandwiched rows across neighbor ink span.
- Stronger params: hRadius up to 10, close radius up to 8, maxGap `span/45` (min 20).
- `maskNeedsDoubleEdgeSolidify` — auto-solidify any silhouette with band-gap row pattern, not only outline fallback.
- `pruneSilhouetteMask` skipOpen whenever solidify runs.

- Cache **b238**. Hard refresh, re-drop heraldic image on wrap face — knight upper body should be solid emboss like dragon; trace preview mask should show no horizontal void bands.

### 2026-07-11 — b237: Fix stale build tag (MAKERDECK_BUILD was stuck on b234)

**Symptom:** Pi had b236 code but `app.js` overwrote header with `MAKERDECK_BUILD = "b234"` on boot — UI showed 2 builds behind.

**Fix:** Align `MAKERDECK_BUILD`, `index.html` tag, and `app.js?v=` to **b237**.

- Cache **b237**. Hard refresh `https://flightdeck.tail7de73e.ts.net/#/makerdeck` — header must show **b237**.

### 2026-07-11 — b236: Wrap preview 1px rows for tall traces (fix top scan-line gaps)

**Symptom:** Tiger (2400×1920, silhouette auto, wrap face): trace preview top third darker/speckled blue; 3D wrap top of head thin horizontal scan-line texture; jaw/sides solid.

**Root cause:** `buildWrapTraceSlabMesh` coarsened preview row step when `maskH > 1400` (~10px bands for 1920px traces). Empty 10-row bands in sparse mask regions (forehead/ears) → horizontal voids in radial shells. Dense jaw rows still had ink every band → looked solid. Preview mask is pixel-true; 3D was skipping empty bands.

**Fix (`features.js`):** Preview keeps **1px mask rows** unless row count exceeds 2048 mesh budget. Adaptive `wrapDecalStepMm` coarsening only for label export (`exportSolid`).

- Cache **b236**. Hard refresh, re-drop tiger (or any tall wrap trace) — top emboss should match bottom solidity; no horizontal scan lines at crown.

### 2026-07-11 — b235: Morphological close + row bridge for outline fallback (fix knight bands)

**Symptom:** b233 dragon perfect; b234 2–3px dilate still left horizontal void bands on knight/horse upper body.

**Root cause:** Outline fallback mask is thin double-edge lines — rows between line pairs have zero ink. b234 dilate alone did not bridge wider gaps; then `pruneSilhouetteMask` called `openMask` (1px erode) on single-component masks, re-hollowing filled rows.

**Fix (`trace.js`):**
- `solidifyOutlineSilhouetteMask` — size-scaled morphological **close** (3–6px radius), then `bridgeRowGapsInMask` + `fillSparseRowsBetweenNeighborInk`
- `pruneSilhouetteMask` — `skipOpen` for outline fallback so solidified mask is not re-eroded
- Preview + wrap both use same `silhouetteMask` (unchanged path)

- Cache **b235**. Hard refresh, re-drop heraldic image — knight upper body should be solid black emboss like dragon.

### 2026-07-11 — b234: Solidify outline double-edge mask (fix knight horizontal gaps)

**Symptom:** b233 dragon perfect; knight/horse upper body still had horizontal void bands.

**Root cause:** Outline ink mask is thin double-edge lines — horizontal rows between line pairs have no ink. Dragon area denser/solid; knight upper hollow.

**Fix (`trace.js`):** `solidifyOutlineSilhouetteMask` — 2–3px dilate on outline fallback before wrap/preview mask.

- Cache **b234**. Hard refresh, re-drop image.

### 2026-07-11 — b233: Wrap radial shells from mask (past earcut + row z-fight)

**Symptom:** b232 earcut slashes returned; row slabs had horizontal z-fight voids — stuck between two broken paths.

**Fix (`features.js`):**
- Wrap always uses **mask raster → radial outer shells** (no earcut on curved wall)
- Dropped full 6-face row boxes — only outer skin + side walls (no coplanar horizontal caps between rows)
- Preview: 1px rows, outer skin only; export: solid radial shell
- Removed united-silhouette polygon extrude fallback

- Cache **b233**. Hard refresh, re-drop image — solid heraldic wrap, no slashes or band voids.

### 2026-07-11 — b232: REVERTED path — earcut slashes on united wrap

**Symptom:** b230 introduced thick horizontal voids through knight/horse on cylinder wrap.

**Action:** Rolled back b230 changes — removed `collapseDoubleEdgeMask` and 1px preview row slabs; restored b229 trace + wrap slab behaviour.

- Cache **b231**. Hard refresh, re-drop image — should match b229 “nearly there” state.

### 2026-07-11 — b230: REVERTED — double-edge collapse + 1px slabs made wrap worse

### 2026-07-11 — b229: Fix inverted heraldic mask (blue rectangle / frame emboss)

**Symptom:** Trace preview = solid blue rectangle with white dragon inside; 3D = embossed rectangular patch around art.

**Root cause:** High threshold (235) + silhouette binarize treated dark ornate **frame** as ink (mask ~full crop). Dragon was the hole. Outline fallback still used silhouette flood mask.

**Fix (`trace.js`):**
- `autoCorrectSilhouettePolarity` — invert when fill >40% or crop edges mostly ink
- Outline fallback uses **outline ink** crop (line art), not silhouette bg flood
- Preview + wrap still use `silhouetteMask` after correction

- Cache **b229**. Hard refresh, re-drop image. Blue should trace **dragon/knight ink only**, not the frame box.

### 2026-07-11 — b228: Mask-first silhouette (fix blue wedge regression)

**Symptom:** Blue overlay wedge returned; 3D wrap shredded again after b227.

**Root cause:** Low-res polygonise → scale-up reintroduced spike geometry; cleaning polygons couldn't fix mask noise from high threshold (235). Preview drew polygons, 3D drew polygons — both wrong when mask had extra blob.

**Fix (`trace.js`, `features.js`, `app.js`):**
- `pruneSilhouetteMask` — drop detached noise islands, open thin spikes
- `silhouetteGroupsFromMask` — rebuild from pruned mask (not scaled polygonise)
- Preview + emboss store/use `silhouetteMask` (same raster for blue overlay and wrap slabs)
- `buildWrapTraceSlabMesh` prefers stored mask over polygon raster

- Cache **b228**. Hard refresh, re-drop image. Blue fill = mask truth; 3D should match.

### 2026-07-11 — b227: Wrap 3D from pixel mask (match trace preview)

**Symptom:** Trace preview clean (b226) but 3D wrap still a horizontal shredded band.

**Root cause:** Preview rasterises trace in **pixel space**; 3D remapped polygons to mm first, then re-rasterised — bbox/seam drift produced wrong slab rows on the cylinder.

**Fix (`features.js`):**
- `buildWrapTraceSlabMesh` — rasterise shape groups at trace resolution, map pixel rows directly to wrap mm
- Same mask as blue trace preview overlay → solid wrap emboss
- `remappedBitmapFaceGroups` uses true art height + `normalizeWrapShapeGroups`

- Cache **b227**. Hard refresh, re-drop image, 3D wrap should match trace preview silhouette.

### 2026-07-11 — b226: Remove blue spike wedge from trace silhouette (1-island garbage)

**Symptom:** Trace preview showed odd light-blue polygon blob beside dragon; same geometry shredded wrap 3D mesh.

**Root cause:** Polygonise can bake a spike/trapezoid into a **single** outer ring. Filter + merge only ran on multi-island traces, so "1 island" still carried garbage. Blue overlay = exact emboss shape.

**Fix (`contour.js`, `trace.js`):**
- `cleanTraceSilhouetteGroups` — always re-rasterize silhouette after trace
- `finishSilhouetteTrace` runs clean pass before merge
- Trace meta now labels **wrap** face correctly

- Cache **b226**. Hard refresh, **re-drop image** (old trace keeps bad geometry), blue fill should match knight/dragon only.

### 2026-07-11 — b225: Finer wrap slab resolution (fix blocky heraldic preview)

**Symptom:** b224 stopped earcut slashes but wrap art looked chunky/pixelated — visible horizontal slab steps.

**Fix (`features.js`):**
- Adaptive `wrapDecalStepMm` (~560 cols along longest art edge, 0.08–0.26 mm)
- Slab grid auto-coarsens if >2048 cells (no null → earcut fallback)
- No mask dilate on wrap slabs (was bloating edges by one 0.4 mm cell)
- Wrap path never falls back to earcut extrusion

- Cache **b225**. Hard refresh, re-check 3D wrap (should read as solid heraldic art, not blocks).

### 2026-07-11 — b224: Wrap emboss via raster slabs (fix shredded 3D mesh)

**Symptom:** Heraldic trace on cylinder wrap still showed diagonal slash triangles / horizontal slice garbage in 3D preview (earcut on complex wrap polygons).

**Fix (`features.js`):**
- `buildFaceDecalSlabMesh` extended to **wrap** face (accent-band style horizontal raster slabs)
- `extrudeGroupsOnFace` routes wrap art through slabs (`WRAP_DECAL_STEP_MM = 0.4`) instead of `extrudeShapeGroupBetween` + earcut
- `buildEmbossBitmap`, SVG fill rings, label export paths use same slab route on wrap
- Restored broken `appendColoredMeshPart` helper

- Cache **b224**. Hard refresh, re-drop heraldic image, check 3D wrap preview (solid art, no slashes).

### 2026-07-10 — b223: Fix blue wedge / diagonal mesh on heraldic trace (7 islands)

**Symptom:** Trace preview showed blue trapezoid wedge; 3D wrap had diagonal slash triangles through horse.

**Root cause:** Merge only ran when **>8 islands** — Chris's trace had **7**, so one garbage spike polygon from downscaled polygonise survived. Earcut fanned across it on wrap extrude.

**Fix:** Filter degenerate spike polygons; **always merge when >1 island**; single solid silhouette for import + model.

- Cache **b223**. Hard refresh, re-drop image.

### 2026-07-10 — b222: Trace hang during Tracing… — see b223 for wedge fix

### 2026-07-10 — b222: Fix freeze *during* Tracing… on large heraldic PNGs

**Symptom:** Tab hung while meta still said Tracing… (before 3D preview).

**Root cause:** Outline mode ran **morphological skeleton** on ~3k×4k masks (thousands of full-size erode/dilate passes). Silhouette path ran **full-res maskToPolygons** (589 islands). Colour layers scanned 16M pixels × 7 layers.

**Fix (`trace.js`, `app.js`):**
- Large crops skip skeleton → fast silhouette polygonise
- `polygonizeMaskGroups` downsamples before polygonise, scales back
- Skeleton capped at 64 iterations; disabled above 900k pixels
- Colour-layer loop aborts early; `colorSeparation: false` on image trace
- Max trace load 2400px (was 4096)

- Cache **b222**. Hard refresh, drop image again.

### 2026-07-10 — b221: Image drop trace merge — freeze was during trace; see b222

### 2026-07-10 — b221: Fix image drop / trace freeze (restore fast add-image flow)

**Symptom:** Dropping heraldic PNG used to work; b217–b220 froze on trace.

**Root cause:** `finishSilhouetteTrace` ran **full-res union** on hundreds of islands the moment you dropped an image. Colour-layer separation also exploded island count.

**Fix (`trace.js`, `app.js`):**
- Trace ends with **fast 256px merge** (few groups), not blocking full union
- Skip colour-layer separation when it would create >40 islands
- Dense trace preview draws raster bitmap, not 589 canvas paths
- **Auto-apply to box** after successful image trace (like before — drop image → see it on cylinder)

- Cache **b221**. Hard refresh, drop your St George image again.

### 2026-07-10 — b220: Wrap preview freeze — see b221 for image drop

> MakerDeck session notes live here — not in the repo-root `SESSION_NEXT.md` (Flightdeck farm/queue/UI only).

### 2026-07-10 — b220: Stop wrap-preview freeze (b219 still hung)

**Symptom:** Page Unresponsive still on dense St George wrap art after b219.

**Root causes b219 missed:**
1. **Outline stroke path** — preview extruded every stroke segment on wrap (bypassed island merge)
2. **Preview merge re-ran every rebuild** — no cache on `embossTraceRects`
3. **Background async union** — `scheduleEmbossTraceUnion` still ran full 589-island union + `rebuild()` (second hang)
4. **Undo history** — `JSON.stringify` of 589 island polygons on every art slider `change`

**Fix:**
- Cache `previewShapeGroups` on trace rects (merge once)
- Dense outline traces use merged `shapeGroups`, not per-segment stroke extrusion
- Preview merge downscaled to 256px, 0 smooth passes
- Removed background async union from rebuild path
- `stateForHistory()` omits trace polygon blobs

- Cache **b220**. Hard refresh MakerDeck.

### 2026-07-10 — b219: Fast preview merge — incomplete; see b220

**Symptom:** Chris still got Page Unresponsive on dense St George trace after b218.

**Root cause (b218 gap):** `ensureEmbossTraceUnited()` still ran **sync at start of every `rebuildMesh()`** until union finished; preview also **extruded each of 589 islands** when union hadn't completed.

**Fix (`contour.js`, `features.js`, `app.js`, `index.html`):**
- `previewMergeTraceShapeGroups` — low-res (384px) raster merge for live preview → **one extrude**, not 589
- Preview never runs full `unionDenseEmbossShapeGroups` on slider rebuilds
- `scheduleEmbossTraceUnion()` — full-res union runs **async** after first paint

- Cache **b219** (`app.js?v=219`, `features.js?v=219`). Hard refresh MakerDeck.

### 2026-07-10 — b218: Fix preview freeze from b217 dense-trace union — incomplete; see b219

**Art / trace / preview** (`js/contour.js`, `js/trace.js`, `js/features.js`, `js/app.js`, `js/geometry.js`, `index.html`)

**Symptom:** MakerDeck **Page Unresponsive** during 3D preview after b217 — St George trace (589 islands · 7 layers · 3357×4096 px) freezes browser with red geometry visible.

**Root cause:** b217 added `unionDenseTraceShapeGroups` in **preview** (`buildEmbossBitmap`) and export, running sync rasterise + dilate + re-polygonise on **every preview rebuild** (slider ticks, move art, etc.). With 589 islands that blocks the main thread for seconds each call.

**Fix:**
- New shared `unionDenseEmbossShapeGroups` in `contour.js` — runs **once at trace time** inside `finishSilhouetteTrace` (all silhouette paths: colour layers, plain silhouette, outline fallback).
- Trace result stores `shapeGroupsUnited: true`; preview/export skip re-union when flag set.
- `ensureEmbossTraceUnited()` in `app.js` — one-time migration for b217 sessions already on the box (589-island stored trace); runs once on first rebuild, then never again.
- b217 gap fix retained (united silhouette closes wrap white band); outline mode still skips colour separation.

**Re-trace?** Not required if art already on box — first preview after hard refresh may pause ~1–2 s while legacy union runs once. Re-trace + Apply is cleaner for new `shapeGroupsUnited` data.

- Cache **b218** (`app.js?v=218`, `features.js?v=218`, `trace.js?v=218`, `geometry.js?v=218`). Hard refresh MakerDeck (Ctrl+Shift+R). UI-only — Pi pull sufficient; restart optional.

### 2026-07-10 — b217: Preview union for dense trace emboss (cylinder wrap gap fix) — caused preview hang; superseded by b218

**Art / trace / preview** (`js/features.js`, `js/trace.js`, `js/app.js`, `index.html`)

**Symptom:** Horizontal white gap / fragmented emboss on cylinder wrap preview — knight/dragon heraldic trace (589 islands · 7 colour layers · Outline mode).

**Root cause:** b189+ unioned trace islands for **export** only (`collectBitmapGraphicShapeGroups` + `isLabelExport`). **Preview** still used `buildEmbossBitmap`, extruding each of 589 colour-layer islands as separate solids — micro-gaps between adjacent slivers show as white body through the art band (especially upper third where ink layers don't meet). Also: colour-layer separation ran **before** Outline mode, so "Outline" traces silently became multi-layer silhouettes.

**Fix:**
- New `unionDenseTraceShapeGroups` — rasterise + dilate + re-polygonise when >8 islands; used in **preview** (`buildEmbossBitmap`) and export (`collectBitmapGraphicShapeGroups`).
- `trace.js`: skip colour-layer separation when trace mode is **Outline**; outline fallback uses **single silhouette** (not 7 halo layers).
- Silhouette colour layers union when >30 islands (`unionDenseColorLayerGroups`, dilate 5–7).
- Preview emboss depth floor **0.35 mm** (stops z-fight white seams).
- Trace meta hints when many islands: prefer **Silhouette** for line art.

**Workaround if still patchy:** re-trace as **Silhouette** (single colour), Emboss depth ≥ 0.4 mm, Apply to box, hard refresh.

- Cache **b217** (`app.js?v=217`, `features.js?v=217`, `trace.js?v=217`). Hard refresh MakerDeck. UI-only — Pi pull sufficient; restart optional.

### 2026-07-10 — b216: Remove stubby / drink holder preset (wrong direction)

**Scrapped b214 + b215 drink-holder work** per Chris — clean removal, working MakerDeck.

**Removed:**
- **Stubby holder** / **Drink holder** preset chip in Design tab
- Entire `#section-stubby` UI (Can fit chips, rolled top, twist opener, holder mode)
- `stubbyHolder` shape, `STUBBY_HOLDER_PRESET`, `DRINK_HOLDER_PRESET`
- Modular holder geometry (`buildHolderModularParts`, snap rings, can ring / neck / cap)
- `topRimRoll`, twist opener hooks, holder stack ZIP export + exploded preview
- b215 WIP holder-mode UI (never shipped cleanly)

**Kept:** Unit dropdown (b213), ZIP container+lid export, gasket toggle, kitchen canisters, all other presets.

**Session restore:** saved `stubbyHolder` sessions fall back to **circle**.

- Cache **b216** (`app.js?v=216`, `geometry.js?v=216`, `features.js?v=216`). Hard refresh MakerDeck. **Backend restart required** (geometry.js changed).

### 2026-07-10 — b215: Modular drink holder — **SCRAPPED** (see b216)

Wrong direction — removed entirely in b216. Notes kept for history only.

### 2026-07-10 — b214: Stubby holder preset — **SCRAPPED** (see b216)

Wrong direction — removed entirely in b216. Notes kept for history only.

### 2026-07-10 — b213: Display unit dropdown (mm / cm / in)

**Design UI** (`js/app.js`, `index.html`, `css/style.css`)

- **Topbar** dropdown: **mm** | **cm** | **in** (imperial inches). Internal geometry stays mm; only sliders, value-edits, labels, and **Outer** stat readout convert.
- `state.displayUnit` persisted in session save/restore (`makerdeck-session-v1`).
- Conversion: cm ÷10 display / ×10 input; in ÷25.4 / ×25.4. Export filenames unchanged (always mm in STL/3MF names).
- Length fields: inner W/D/H, walls/floor, edges, lid dims, joiner, insert, vase, emboss/art offsets & sizes, accent band height/wave.
- Cache **b213**. Hard refresh MakerDeck. UI-only — Pi pull sufficient; restart optional.

### 2026-07-10 — b212: Separate gasket groove from gasket 3MF export

**Lid tab** (`js/app.js`, `index.html`)

- **Problem:** Unchecking **Gasket groove** removed both the underside groove (needed for TPU cord) and the separate **Gasket** part in lid 3MF — no way to keep groove-only.
- **Fix:** New toggle **Include gasket in 3MF** (`lidGasketExportRing`, default on) appears when groove is enabled. Uncheck to keep groove geometry in the lid but export lid-only (no Gasket part). Hint: "Uncheck to keep the groove for TPU cord but export lid-only in the 3MF."
- `collectColoredLidExportParts` respects `lidGasketExportRing`; session save/restore and presets already carried the param.
- Cache **b212**. Hard refresh MakerDeck. UI-only — Pi pull sufficient; restart optional.

### 2026-07-10 — b211: Art/Text manifold sanitize + export open-edge warning

**Export** (`js/app.js`, `index.html`)

- **Root cause:** Body+Art+Text+Accent multi-part 3MF had correct `model_settings.config` extruder slots, but Art/Text still used `prepareMeshFor3mf` (light weld only). Open/non-manifold art meshes made Bambu block AMS colour assignment until **Repair** — Repair then remeshes/merges parts and breaks filament slots.
- **Fix:** Art and Text export parts now run through `sanitizeMeshForStl` (weld + non-manifold peel). Export status reports open edges for accent too; warns to avoid Bambu Repair when any part has open edges.
- Cache **b211**. Hard refresh, re-export — status should show `open edges: body 0, art 0, text 0, accent 0`.

### 2026-07-10 — b210: Dual-file ZIP export (container + lid 3MF)

**Export** (`js/3mf.js`, `js/app.js`, `index.html`)

- **Problem:** b203–b209 single-file multi-plate 3MF never produced separate Bambu plate tabs on Chris's H2D — container+lid always landed on plate 1. No working 2-plate golden reference in repo.
- **Fix:** when lid is enabled, **3MF project** download is now a **ZIP** with:
  - `{name}-container.3mf` — Body + Art + Text + Accent (single plate, known working)
  - `{name}-lid.3mf` — Lid + Gasket (+ lid art if any), plate-down (known working)
  - `README.txt` — Import both files in Bambu Studio. Slice container first, then lid.
- Uses browser `createZipStore` (no CDN). UI: export plan chip **ZIP · container + lid**, dropdown **3MF · ZIP (container + lid)**, status **ZIP downloaded — open container.3mf and lid.3mf in Bambu**.
- **Removed** broken single-file multi-plate path from `buildBody3mfExport` (multi-plate builder remains in `3mf.js` for verify script only).
- **Bambu workflow:** unzip → open `container.3mf` → slice plate 1 → open `lid.3mf` → slice plate 1 (lid is plate-down).
- Cache **b210**. Hard refresh, re-download with lid on — expect `.zip` not `.3mf`.

### 2026-07-10 — b209: Fix Bambu H2D multi-plate tabs (H2D grid stride) — SUPERSEDED by b210 ZIP export

**Export** (`js/3mf.js`, `js/app.js`, `index.html`, `.ref/multi-plate-3mf-verify.mjs`)

- **Golden reference:** Bambu `PartPlate.cpp` `reload_all_objects()` — plate tabs come from **bbox intersection** with each plate's world grid box, not `model_instance` alone. H2D `printable_area` 350×320 from `.ref/repaired-unzip/Metadata/project_settings.config`.
- **Root cause:** b208 used **256 mm** bed for transforms; Chris opens on **H2D (350 mm)**. Plate stride = 350×1.2 = **420 mm**. Lid at ~431 mm still intersected plate 0 (0–350) → both objects on plate 1; plate 2 empty → tab deleted.
- **Fix:** default bed **350×320**, `plateGridOffset()` + `worldTransformForPlate()` (local centre + grid offset) on build + assemble. `plate_N.json` stays plate-local. `project_settings` embeds H2D `printable_area`. Verify simulates Bambu plate intersection.
- Verify: `node .ref/multi-plate-3mf-verify.mjs`
- Cache **b209**. Hard refresh, re-download 3MF, open in Bambu H2D — expect **Plate 01 Container** + **Plate 02 Lid** tabs.

### 2026-07-10 — b208: Fix Bambu H2D multi-plate tabs (plate-local layout)

**Export** (`js/3mf.js`, `js/app.js`, `index.html`, `.ref/multi-plate-3mf-verify.mjs`)

- **Root cause:** b207 applied **+303 mm plate-grid X offset** to build + assemble transforms. That offset is for Bambu project-overview thumbnail layout, not plate-tab separation. Both container+lid rendered side-by-side on plate 01; container partially off bed; only one plate tab.
- **Fix:** remove `plateGridOffset`; plate assignment via `<model_instance>` only. Build + assemble transforms use **plate-local bed-centring** (`centeringOffsetOnBed` on 256×256 mm bed). `plate_N.json` bbox translated to match. Verify script checks separate plate object assignment and rejects +303 mm grid offsets.
- Verify: `node .ref/multi-plate-3mf-verify.mjs`
- Cache **b208**. Hard refresh, re-download 3MF, open in Bambu H2D — expect **Plate 01 Container** + **Plate 02 Lid** tabs, each centred on its own bed.

### 2026-07-10 — b207: Fix Bambu H2D multi-plate stacking (12-value transforms)

**Export** (`js/3mf.js`, `js/app.js`, `index.html`, `.ref/multi-plate-3mf-verify.mjs`)

- **Root cause:** b205/b206 wrote **15-number** transform strings (`1 0 0 0 0 1 0 0 0 0 1 0 tx ty tz`). Bambu/Orca `bbs_get_transform_from_3mf_specs_string` requires **exactly 12** values (4×3 column-major); anything else → **identity**. Both container+lid landed at origin on plate 1; `auto_drop="1"` stacked lid on container bbox. plate_2.json bbox was also world-offset (+303 mm) instead of plate-local.
- **Fix:** `formatTransform3x4` → `1 0 0 0 1 0 0 0 1 tx ty tz` (12 values). plate_N.json bbox uses plate-local coords. Added `pattern_bbox_file` metadata per Orca export. Verify script checks transform length, +303 mm plate-2 offset, local bbox.
- Verify: `node .ref/multi-plate-3mf-verify.mjs`
- Cache **b207**. Hard refresh, re-download 3MF, open in Bambu H2D — expect **Plate 1 Container** + **Plate 2 Lid** tabs, lid on its own bed.

### 2026-07-10 — b206: Fix Bambu H2D multi-plate tabs (plate_N.json)

**Export** (`js/3mf.js`, `js/app.js`, `index.html`, `.ref/multi-plate-3mf-verify.mjs`)

- **Root cause:** b205 added `<plate>` + `<assemble>` + build transforms, but Bambu Studio still lumped container+lid on plate 1 because **`Metadata/plate_1.json` / `Metadata/plate_2.json` were missing**. BS/Orca GUI loader requires per-plate JSON bbox files to register separate plate tabs (Orca #13729).
- **Fix:** emit `Metadata/plate_N.json` (bbox_all + bbox_objects with identify_id), minimal `plate_N.png` + top/pick/no_light stubs, plate thumbnail paths in `model_settings.config`, identify_id aligned to assembly object id, multi-plate build items with `printable="1" auto_drop="1"`.
- Verify: `node .ref/multi-plate-3mf-verify.mjs`
- Cache **b206**. Hard refresh, re-download 3MF, open in Bambu H2D — expect **Plate 1 Container** tab and **Plate 2 Lid** tab.

### 2026-07-10 — b205: Fix 2-plate Bambu/Orca lid placement

**Export** (`js/3mf.js`, `js/app.js`, `index.html`)

- **Root cause:** multi-plate 3MF had two `<plate>` blocks but build items had no transforms and no `<assemble>` section — Bambu Studio imported both assemblies at origin on plate 1.
- **Fix:** plate-grid transforms on build items (+303 mm X for plate 2), `<assemble>` block with matching `assemble_item` entries, unique `identify_id` per plate.
- Cache **b205**. Superseded by **b206** (missing plate JSON).

### 2026-07-10 ??? b204: Export top bar + save dialog rework

**UI** (`index.html`, `css/style.css`, `js/app.js`)

- Top bar split: title/tools row, then dedicated **export dock** underneath.
- Live **export plan** chip shows plate layout before download (`2 plates ?? P1 Body + Art ?? P2 Lid`).
- Status line moved to full-width bar below export controls (shorter headline, hover for detail).
- Export dialog renamed **Export** with plate chips + parts list; submit button **Export**.
- Cache **b204**. Hard refresh.

### 2026-07-10 ??? b203: 2-plate 3MF when lid is enabled

**Export** (`js/3mf.js`, `js/app.js`, `index.html`)

- **3MF project** download now auto-includes **Container on plate 1** and **Lid on plate 2** when lid is enabled (Bambu/Orca multi-plate `model_settings.config`).
- Lid parts are plate-down (`orientLidForPrint`) with filament slots offset after body/art/text/accent colours.
- Save dialog hint updated when lid is on. Separate **3MF lid** export still available for lid-only.
- Cache **b203**. Hard refresh, re-download 3MF, open in Bambu Studio ??? expect two plates.

### 2026-07-10 ??? b202: Accent front panel + floor stripe placement

**Accent** (`js/features.js`, `js/accent-bands.js`, `js/app.js`, `index.html`)

- **Front panel only** was on the back: `frontProfileEdgeFilter` used `maxY` (back) and rect front band used `+Y`; front is `-Y` / `minY` (same as COFFEE text).
- **Floor stripe** appeared at top: `bandToBuildParams` treated `face: floor` as rim when default `pos` was 50; floor face now always maps to floor ring. UI sets `pos=0` when floor is selected.
- Cache **b202**. Hard refresh only (UI/static JS). Pi pull still required.

### 2026-07-10 ??? b201: Art/text export like accent bands (horizontal wall slabs)

**Export** (`js/features.js`, `index.html`)

- **Insight:** accent rim bands slice cleanly because they're **horizontal wall slabs** per layer ??? not thin plaques extruded into the wall.
- Art + COFFEE text now export via `buildFaceDecalSlabMesh` ??? 0.2 mm rows, 0.12+0.45 mm proud (same skin/thickness as accent).
- Preview still uses normal emboss; only 3MF Art/Text parts use slab path.
- Cache **b201**. Hard refresh, re-export.

### 2026-07-10 ??? b200: Lid colour picker on Lid tab

**UI** (`index.html`, `js/app.js`)

- **Lid** tab ??? **Lid colour** swatch + **Match body** (clears separate lid colour).
- **Size** tab **Box colour** hint updated ??? body only.
- Lid colour saved in session and used for lid 3MF export.
- Cache **b200**. Hard refresh.

### 2026-07-10 ??? b199: Shallow export emboss (sticker skin, fewer text seams)

**Export** (`js/features.js`, `index.html`)

- White dashes in Bambu preview are **Seams** (confirmed) ??? thick 1.0 mm plaques multiply perimeter loops on arc COFFEE.
- Export caps: **text 0.36 mm**, **art 0.48 mm** (respects lower Emboss depth slider). Top-cap-only on flush skin.
- Preview still uses full emboss depth; only 3MF export is shallow.
- Cache **b199**. Hard refresh, re-export. Tip: Emboss depth slider ??? 0.3???0.4 for even flatter.

### 2026-07-10 ??? b198: Fix white layer-gap seams in art + COFFEE text

**Export** (`js/features.js`, `js/app.js`, `index.html`)

- **Root cause:** (1) 0.2 mm proud standoff left an air gap between body and art ??? grey shows through as white horizontal seams. (2) Hatch trace slivers not fully unioned ??? slicer drops sparse layers inside the sack/letters.
- **Fix:** flush embed on outer skin (no standoff gap, still no wall punch). Always raster-union trace art on export with heavier dilate. Text mask dilate 4. Emboss depth snapped to 1.0 mm (0.2 mm layer grid).
- Cache **b198**. Hard refresh, re-export.

### 2026-07-10 ??? b197: Hollow body export (stop punching front-wall holes)

**Export** (`js/app.js`, `index.html`)

- **Root cause:** `punchBodyShellForLabelExport` deleted front-wall triangles under art ??? **through-holes** into the cavity. Bambu treated the canister as a solid block (red infill filling the interior).
- **Fix:** export intact hollow `boxShell` (no punch). Art/Text sit **0.2 mm proud** of the wall (`__labelExportEmbedded: false`) so filaments stay separate without breaching the shell.
- Cache **b197**. Hard refresh, re-export.

### 2026-07-10 ??? b196: Restore 3-part export (Body + Art + Text filaments)

**Export** (`js/app.js`, `index.html`)

- **Root cause:** b194 merged AMS mesh painted art+text per-triangle, but `prepareMeshFor3mf` weld/dedup dropped `triangleExtruders` alignment ??? Bambu saw one "Body" object with art colour on everything.
- **Fix:** back to **3 separate parts** (Body / Art / Text), each with its own filament slot. Keeps b195 scale fix + flush embedded placement (no 0.2 mm air gap).
- Cache **b196**. Hard refresh, re-export. Bambu object list should show Body + Art + Text.

### 2026-07-10 ??? b195: Fix shrunk bag + missing COFFEE text on export

**Export** (`js/contour.js`, `js/features.js`, `js/app.js`, `index.html`)

- **Root cause:** `unionShapeGroupsToPrepared` rasterised at 1024px but returned polygons in **downscaled** coordinates. Export then mapped them with the full-resolution scale ??? bag ~50% size, text shifted off-face / invisible. Status falsely showed `art 0, text 0` (no separate Art/Text parts in merged AMS).
- **Fix:** rescale united polygons back to original trace/mask pixel space before placement.
- Arc **COFFEE** text no longer unioned (letters stay on the curve).
- Export status now shows `art N tris, text N tris` for AMS painted mesh.
- Cache **b195**. Hard refresh, re-export.

### 2026-07-10 ??? b194: Single AMS mesh (fix empty layers + shattered art)

**Export** (`js/app.js`, `js/features.js`, `index.html`)

- **Root cause of ???worse???:** b193 exported **3 separate floating parts** (Body + Art + Text). Bambu saw empty layers at 129.8???130.2 mm (box top) and sparse red dots ??? floating 0.2 mm standoff meshes don???t slice as one solid.
- **Fix:** multi-colour export now builds **one watertight mesh** via `buildMergedAmsExportMesh` + `punchBodyShellForLabelExport` on plain `boxShell` (no stack feet).
- Art/text **embedded flush** (`__labelExportEmbedded`) ??? no air gap; pockets cut in front wall under ink.
- Min emboss depth **0.8 mm** on label export for reliable toolpaths.
- Heavier trace union dilate (4???5 passes) for hatch-heavy coffee-sack traces.
- Export status shows **???AMS painted 3MF???** (one object, per-triangle filament colours).
- Cache **b194**. Run `DEPLOY-B194.bat`, hard refresh, **re-export** ??? do not reuse old `coffee jar (3).3mf`.

### 2026-07-10 ??? b193: Fix coffee canister slice (manifold body + united COFFEE text)

**Export** (`js/geometry.js`, `js/features.js`, `js/app.js`)

- **Body:** exported plain `boxShell` without stack feet / honeycomb (those merged ~5k open edges in Bambu).
- **Text:** export unions all letters into **one** solid (letter solids touching = non-manifold).
- **Art:** closed-cap extrude path aligned with text (watertight plaque).
- **Watermark:** skipped on multi-part AMS export (bottom deboss broke body shell).
- Export status shows open-edge counts per part (body / art / text) ??? all should be 0.
- Cache **b193**. Deploy, hard refresh, **re-export** coffee jar (old 3MF still broken).

### 2026-07-10 ??? b192: Fix 3MF export freeze (Page Unresponsive)

**Export** (`js/contour.js`, `js/stl.js`, `js/app.js`, `index.html`)

- **Root cause:** b191 unioned traced art by testing every pixel ?? every shape group (billions of point-in-polygon hits on coffee-sack traces) ??? browser froze on Download.
- Union now uses **canvas fill** + **1024px max** working resolution.
- Art/text export skips heavy non-manifold repair (already solid union mesh).
- 3MF export is **async** with status text ("Preparing???", "Building meshes???").
- Cache **b192**. Hard refresh, re-download coffee jar 3MF.

### 2026-07-10 ??? b191: Fix blank canvas (duplicate pointInRing in contour.js)

**Boot** (`js/contour.js`, cache-bust **b191**)

- **Root cause:** b189 added a second `pointInRing` in `contour.js` ??? file already had one at line 127. ES module parse error: `Identifier 'pointInRing' has already been declared` ??? entire app dead, blank viewport.
- Removed duplicate; kept `pointInShapeGroup` + union helpers.
- Hard refresh until header shows **b191**.

### 2026-07-10 ??? b190: Fix blank canvas after b189 (contour.js cache)

**Boot** (`js/features.js`, `js/trace.js`, `js/app.js`, `index.html`)

- **Root cause:** b189 added `unionShapeGroupsToPrepared` to `contour.js` but imports were unversioned ??? browser kept stale `contour.js`, `features.js?v=189` failed to load (`export not found`) ??? blank viewport, header stuck on HTML **b189**.
- Versioned `contour.js?v=190`; bumped all module tags to **b190**; fixed `MAKERDECK_BUILD` constant.
- Hard refresh (`Ctrl+Shift+R`) until header shows **b190** and preview renders.

### 2026-07-10 ??? b189: Union traced art for manifold 3MF export

**Export** (`js/contour.js`, `js/features.js`, `js/app.js`, `index.html`)

- **Root cause:** silhouette / colour-separated traces store hundreds of `shapeGroups` (coffee-sack hatching). Export extruded each as its own solid ??? adjacent slivers share faces ??? 3000+ open edges, 284 non-manifold, Bambu swiss-cheese toolpaths. b186???b188 only fixed the `strokePaths` branch; `shapeGroups` was still broken.
- New `unionShapeGroupsToPrepared` ??? rasterises all trace loops to one ink mask, re-polygonises, extrudes as a single solid.
- Art/text 3MF parts now run through `sanitizeMeshForStl` after weld (non-manifold peel).
- Cache **b189**. Hard refresh, **re-export** coffee jar 3MF (old `coffee jar (3).3mf` will still be broken).

### 2026-07-10 ??? b188: Wrap art follows surface texture (swiss-cheese fix)

**Export / preview** (`js/features.js`, `js/geometry.js`, `js/app.js`, `index.html`)

- **Root cause:** wall-wrap emboss sat on the *smooth* cylinder while ripple/scales displaced the body wall outward ??? texture peaks punched through COFFEE / coffee-sack art ??? Bambu swiss-cheese toolpaths.
- Wrap `mapPoint` now adds the same `vaseTextureDisplacement` as the body shell, then emboss depth on top.
- Separate-colour export standoff grows with texture depth so peaks never pierce thin art.
- Also bumped stale `geometry.js` ??? `features.js?v=188` (was stuck on v=174).
- Cache **b188**. Hard refresh and **re-export** coffee jar 3MF (don't reuse old files).

### 2026-07-10 ??? b187: Export actually uses solid art mesh path

**Export** (`js/features.js`, `js/app.js`, `index.html`)

- **Root cause:** b186 improved `collectBitmapGraphicShapeGroups` but export still called `buildEmbossBitmap`, which bypassed it and extruded thin stroke quads for outline traces.
- New `buildGraphicLabelExportMesh` ??? export now routes through solid filled shape groups + closed caps.
- Removed centroid inflate on export (was breaking concave letters like C/E); wider stroke raster + more mask dilate instead.
- Arc text export raster at 1280px. Cache **b187**. Hard refresh and re-export.

### 2026-07-10 ??? b186: Solid trace + arc text export

**Export** (`js/contour.js`, `js/features.js`, `js/app.js`, `index.html`)

- Outline trace art (coffee sack line art) now **rasterises to filled solids** on export instead of thousands of thin quad segments ??? fixes horizontal gaps / missing chunks in Bambu.
- Arc text export: 1px mask dilate, no smooth pass, slightly more inflate (0.15 mm).
- Cache **b186**. Hard refresh and re-export coffee canister 3MF (upright on base).

### 2026-07-10 ??? b185: Library upload fix + export art detail

**Export / library** (`app/main.py`, `js/features.js`, `js/library.js`, `index.html`)

- Fixed library save crash: `max_file_size` not supported on Pi Starlette ??? bump `MultiPartParser` limits at boot instead.
- Export art/text: finer simplify, thicker strokes, slight inflate so COFFEE letters and trace lines don't lose chunks in Bambu.
- Cache **b185**. Hard refresh + **backend restart required**.

### 2026-07-10 ??? b184: Closed export solids + library upload limit

**Export** (`js/features.js`, `js/app.js`, `app/main.py`, `index.html`)

- Art/text export meshes are now **closed solids** (not open-bottom shells) with **0.2 mm** standoff ??? fixes empty layers and pitting when sliced upright.
- Library POST raised Starlette multipart limit (was 1 MB ??? blocked large 3MF saves).
- Open-edge warning now reports **body only** (art/text open bottoms no longer scare you).
- Print canisters **standing upright** (lid flat separately). Cache **b184**. Hard refresh + **backend restart**.

### 2026-07-10 ??? b183: Fix 3MF colours (separate parts) + library save

**Export** (`js/app.js`, `js/features.js`, `index.html`)

- Reverted merged single-mesh AMS export ??? it created ~20k open edges and Bambu imported one grey body with no filament colours.
- Body + art + text export as **3 separate 3MF objects** (extruders 1???3) with **0.06 mm proud standoff** on art/text.
- Library save compresses preview/trace images before upload; retries without trace if needed; shows error text in export status.
- Cache **b183**. Hard refresh and re-export coffee canister 3MF.

### 2026-07-10 ??? b182: Export filename dialog + optional library save

**Export** (`index.html`, `js/app.js`, `js/library.js`, `css/style.css`, `app/makerdeck_library.py`, `app/main.py`)

- **Download** opens a dialog ??? edit the file name before saving (all STL / 3MF formats).
- **Save to design library** checkbox (body STL + 3MF only); preference remembered in localStorage.
- Library upload no longer stuffs huge trace/thumbnail data into JSON ??? separate multipart files fix silent save failures.
- Cache **b182**. Hard refresh. **Backend restart required** (library API change).

### 2026-07-10 ??? b181: Fix blank preview (duplicate stl export)

**Boot** (`js/stl.js`, `js/app.js`, `js/3mf.js`, `index.html`)

- `prepareMeshFor3mf` was declared **twice** in `stl.js` ??? ES module parse error killed the whole app (header showed b180 from HTML but viewport stayed empty).
- Removed duplicate; kept the version that preserves `triangleExtruders` for AMS export.
- Cache **b181**. Hard refresh (Ctrl+Shift+R); header must show **b181** and box preview should render.

### 2026-07-10 ??? b180: Fix export crash (stack overflow)

**Export** (`js/3mf.js`, `js/app.js`, `index.html`)

- b179 export crashed silently: `Math.max(...triangleExtruders)` overflowed on large meshes ??? no download.
- Visible build tag now updates to **b180** so you can confirm fresh JS loaded.
- Cache **b180**. Hard refresh; check header says **b180** before exporting.

### 2026-07-10 ??? b179: AMS merged export + arc text mesh fix

**Export** (`js/features.js`, `js/app.js`, `js/stl.js`, `js/3mf.js`, `index.html`)

- Body + art + text export as **one mesh** with per-triangle filament paint (stops Bambu stripping the front wall).
- Body shell uses **light 3MF prep** only ??? no face-peeling sanitize.
- Text export uses **open-bottom** shells (top cap + walls), matching preview ??? fixes arc letter glitches like the striped **F**.
- Cache **b179**. Hard refresh and re-export 3MF.

### 2026-07-10 ??? b178: Keep body wall on multi-colour export (standoff fix)

**Export** (`js/features.js`, `js/app.js`, `index.html`)

- Reverted wall **punching** (left 17k+ open edges ??? broken shell in Bambu).
- Body stays **fully closed**; Art/Text export **0.06 mm proud** so Bambu does not strip coplanar faces.
- Preview unchanged (flush); only download geometry shifts.
- Cache **b178**. Hard refresh and **re-export** 3MF.

### 2026-07-10 ??? b177: Fix missing front wall on multi-colour export

**Export** (`js/features.js`, `js/app.js`, `index.html`)

- Body export now **punches wall pockets only under art + text** instead of leaving a coplanar face Bambu strips away.
- Art/Text parts fill those pockets; wall remains everywhere else on the front face.
- Cache **b177**. Hard refresh and re-export 3MF.

### 2026-07-09 ??? b176: Fix arch down + wide preset

**Arc text geometry** (`js/features.js`, `js/app.js`, `index.html`, `js/geometry.js`)

- **Arch down** ??? text on bottom of circle, right-side up (C left, E right under the graphic); auto-nudges below the art.
- **Wide** (was Banner) ??? shallow arch over the top, same orientation as arch up.
- Cache **b176**. Hard refresh MakerDeck.

### 2026-07-09 ??? b175: Word-style arc text (presets + curve slider)

**Arc text UX** (`js/features.js`, `js/app.js`, `js/geometry.js`, `index.html`)

- **Curve style** presets: Arch up, Arch down, Banner (like Word WordArt).
- Single **Curve amount** slider (0???100) bends radius; old radius/sweep/start/tilt/spacing tucked under **Fine tune arc???**
- Letter spacing now **centres the word** on the arc (no more ???rotating??? the whole word).
- Typing text with a graphic auto-applies **Arch up** and nudges text above the art.
- Flat **Text rotation** hidden in arc mode (syncArtEditorUi fix).
- Cache **b175**. Hard refresh MakerDeck.


**Arc text tuning** (`js/features.js`, `js/app.js`, `index.html`, `js/geometry.js`)

- Arc centre moves independently (left/right + up/down position the circle centre, not just the bbox).
- New sliders: **Arc start** (???90 = top), **Arc tilt**, **Letter spacing**.
- Arc span 40???360??; radius up to ~115% of face width; auto sizes wider around traced art.
- Flat-mode **Text rotation** hidden in arc mode ??? use **Arc tilt** instead (fixes the 104?? mess).
- Cache **b174**. Hard refresh MakerDeck.

### 2026-07-09 ??? b173: Larger arc radius for label text

**Art tab arc text** (`js/features.js`, `js/app.js`, `index.html`)

- Auto arc radius now sizes from **traced/SVG graphic** bounds (not just SVG).
- Bigger auto radius + manual slider up to ~92% of face width.
- Cache **b173**. Hard refresh MakerDeck.

### 2026-07-09 ??? b172: Independent text vs graphic placement

**Art tab** (`js/decor.js`, `js/features.js`, `js/app.js`, `js/geometry.js`, `index.html`)

- Typing text **no longer clears** traced/SVG line art.
- **Separate move/rotate** for text vs graphic (text position sliders + graphic sliders).
- Typing text while art is on auto-switches to **Arc** path so COFFEE curves around the graphic.
- Wider move sliders (??80 mm); graphic size up to 56 mm.
- Cache **b172**. Hard refresh MakerDeck.

### 2026-07-09 ??? b171: Art colour picker (SVG / trace)

**Art tab** (`js/app.js`, `js/geometry.js`, `index.html`)

- **Art colour** picker for SVG and traced image art ??? separate from body and text colours.
- Preview shows graphic in chosen colour (brown `#4a3728` default ??? good on white canisters).
- **3MF export** adds an **Art** part (separate filament slot) alongside Body / Text.
- Coffee canister preset seeds `artColor: #4a3728`.
- Cache **b171**. Hard refresh MakerDeck.

### 2026-07-09 ??? b170: Text + SVG together, arc labels, Windows fonts

**Art tab** (`js/features.js`, `js/geometry.js`, `js/app.js`, `index.html`)

- **Text and SVG at the same time** ??? type COFFEE while a coffee-bean SVG stays on the face; 3MF exports body (with graphic) + separate Text colour part.
- **Arc text path** ??? Flat | Arc chips; arc span + radius (0 = auto around centre graphic).
- **36 Windows/office fonts** ??? Bahnschrift, Candara, Gabriola, Franklin Gothic, Palatino, etc.
- SVG toggle renamed **Add SVG graphic**; text fields stay visible when SVG is on.
- Cache **b170**. Hard refresh MakerDeck. UI-only ??? pull on Pi sufficient (restart harmless).

### 2026-07-09 ??? b169: SVG import overhaul (filled paths + smart fallback)

**Art tab SVG** (`js/features.js`, `js/app.js`, `index.html`)

- **Filled SVG** paths emboss as solid geometry (logos, plaques) ??? not just stroke outlines.
- **Transform-aware** parsing (`getCTM`) ??? grouped/scaled SVGs land in the right place.
- **Wrap face** uses same seam normalization as text/trace for jar plaques.
- **Smart import**: vector first; auto-fallback to silhouette trace when paths are empty.
- Status line reports `filled vector`, `stroke vector`, or `traced silhouette`.
- Cache **b169**. Hard refresh MakerDeck.

### 2026-07-09 ??? b168: Flat-lid gasket groove + TPU ring export

**Optional dust seal for canisters** (`js/features.js`, `js/geometry.js`, `js/app.js`, `index.html`)

- **Gasket groove** toggle on Lid tab (flat cap) ??? underside annular channel; on by default for kitchen canister presets.
- Lid **3MF** exports a third **Gasket** part (grey slot) sized to the groove ??? print in TPU; or press in 2 mm cord.
- Sliders: groove width / depth. Not fully airtight ??? better dust seal than bare plastic-on-plastic.
- Cache **b168**. Hard refresh MakerDeck.


**Uniform T/C/S jar tower** (`js/features.js`, `js/geometry.js`, `js/app.js`, `index.html`)

- New **Stack set** preset ??? 250g round jars, nest-stack flat lids (raised rim + outer seating groove), single-letter wrap labels.
- **Stack trio** chips: T ?? Tea, C ?? Coffee, S ?? Sugar ??? auto body colour + wood-tone `lidColor` for 3MF export.
- `stackStyle: "nest"` vs hex feet; nest geometry in `appendNestStackLidRim`.
- Cache **b167** (`app.js?v=167`, `geometry.js?v=167`, `features.js?v=167`). Hard refresh MakerDeck. Pi deployed + restarted.

### 2026-07-09 ??? b163: True 2-manifold welded divider (0 open / 0 overused)

**Sharp-box welded export topology rewrite** (`js/features.js`)

- Root cause of Bambu non-manifold: solid divider end-caps + long unsplit rim edges ??? **6 overused (n=3) edges** at wall/divider junctions, plus T-junctions on the top rim.
- **Fix:** bay faces + top only (no end caps / bottom); split outer walls, bottom, and rim at every divider station; corner ears share verts with side rim.
- Depth + length axes, 1???3 dividers: audit shows **0 open edges, 0 overused edges** (~76 tris for one divider).
- Export guard expects ???50 tris for sharp welded boxes.
- Cache **b163**. Hard refresh. Re-download 3MF ??? Bambu should show **0 non-manifold** without Repair. Do **not** Repair old b134/b135 files.

### 2026-07-09 ??? b166: 1.5 kg biscuit canister size

**Fourth size tier for biscuits** (`js/app.js`, `js/geometry.js`, `index.html`)

- New **1.5kg** chip ??? wide square biscuit tin (150??115??165 mm inner) or tall round jar (145??232 mm).
- Picking **Biscuits** in Contents auto-selects 1.5kg.
- Cache **b166**. Hard refresh.

### 2026-07-09 ??? b165: Canister sizes from OEM coffee-tin chart

**125g / 250g / 500g footprints** (`js/app.js`, `js/geometry.js`, `index.html`)

- Size chips now match common tin outer dimensions (250 ml ??? 125g, 500 ml ??? 250g, 1 L ??? 500g).
- Inner cavity derived from chart ????height minus wall + floor; hover chip for outer mm reference.
- Default preset = **250g** (500 ml tin).
- Cache **b165**. Hard refresh.

### 2026-07-09 ??? b164: Canister preset buttons always visible

**Kitchen canister UX** (`index.html`, `css/style.css`)

- Square canister / Round jar preset buttons now always show under **Kitchen canisters** (were hidden until already on a canister ??? catch-22).
- Contents + Size chips appear after you pick a preset.
- Cache **b164**. Hard refresh.

### 2026-07-09 ??? b162: Kitchen canister presets

**Square canister + round jar** (`js/geometry.js`, `js/features.js`, `js/app.js`, `index.html`, `css/style.css`)

- New presets: **Square canister** (flat front label, flat stackable lid) and **Round jar** (wrap label, optional screw lid).
- Contents picker: Coffee / Tea / Sugar / Biscuits / Custom ??? sets label text on Art tab.
- Size chips: Small / Medium / Large footprint presets.
- Food-contact filament hint in Design tab.
- Cache **b162**. Hard refresh MakerDeck.

### 2026-07-08 ??? b161: Accent rotation + on-top layering

**Multi-band accents** (`js/accent-bands.js`, `js/vase.js`, `js/features.js`, `js/geometry.js`, `js/app.js`, `index.html`)

- **Rotate pattern** (??) on wavy vase bands ??? spins the wave around the pot.
- **On top** checkbox per band when two colours ??? mutually exclusive; top band sits ~0.22 mm further out so it crosses over the other (preview + print).
- New second band defaults to on top.
- Cache **b161**. Hard refresh.

### 2026-07-08 ??? b160: Accent band click-to-edit values

**Accent tab** (`js/app.js`, `index.html`)

- Band height, position %, and wave sliders now wire `data-slider` like box dimensions ??? click the number to type a value.
- Works on boxes, profile pots, and vases.
- Cache **b160**. Hard refresh.

### 2026-07-08 ??? b159: Profile wrap art polish

**Wall-wrap emboss fixes** (`js/contour.js`, `js/decor.js`, `js/features.js`, `js/app.js`, `index.html`)

- Cap triangulation uses art-space (arc ?? height) on curved walls ??? no more twisted caps on heart/teardrop.
- Art anchors on the front (-Y) of the profile; vertical centering on wrap pots.
- Seam unwrap keeps polygons near their anchor so edges don't chord across the perimeter.
- Offset sliders relabel for wrap: **Around wall** / **Height**.
- Cache **b159**. Hard refresh + re-export.

### 2026-07-08 ??? b158: Profile wall-wrap art + box textures

**Art tab on profile pots** (`js/features.js`, `js/geometry.js`, `js/app.js`, `index.html`)

- Teardrop / heart / star / circle / oval: **Art** tab enabled with **Wrap (around wall)** face ??? text, SVG, and trace emboss follow the outer profile.
- Box / rounded / pencil shapes: **Surface texture** (Walls tab) now supported via profile relief path.
- Cache **b158**. Hard refresh + re-export.

### 2026-07-08 ??? b157: Profile pot wall textures

**Surface relief on teardrop / heart / star / circle / oval** (`js/vase-textures.js`, `js/geometry.js`, `js/app.js`, `index.html`)

- Reuses vase texture styles (ripple, scales, bark, weave, knit) on profile containers ??? outward-normal displacement, constant wall thickness.
- Walls tab ??? **Surface texture** when a supported preset/round shape is selected.
- Cache **b157**. Hard refresh + re-export.

### 2026-07-08 ??? b156: Heart accent cleft ??? whisker more

**Tiny extra carry into back V** (`js/features.js`)

- Edge cutoff 0.28 ??? 0.25, taper step 0.10 ??? 0.09 ??? band nudges a whisker closer without bleed.
- Cache **b156**. Hard refresh + re-export.

### 2026-07-08 ??? b155: Heart wall smoothing (adaptive segments)

**Faceted lobe walls on heart accent + body** (`js/geometry.js`)

- Heart profile now uses adaptive segment count (~1 mm facets, 256???512) instead of fixed 160 ??? lobe curves ~2.3 mm facets ??? ~1 mm.
- Cache **b155**. Hard refresh + re-export.

### 2026-07-08 ??? b154: Heart accent cleft ??? extend band slightly

**Back V gap a touch wide after b153** (`js/features.js`)

- Narrower pinch taper (8 passes / 0.10) and lower edge cutoff (0.28) so the band carries a bit further into the cleft without reintroducing bleed.
- Cache **b154**. Hard refresh + re-export.

### 2026-07-08 ??? b153: Heart accent cleft overflow fix

**Orange still bleeding inside back V after b152** (`js/features.js`)

- Heart cleft vertices are tessellated convex ??? concave-only pinch never fired.
- Pinch now keys off **offset points inside the profile** (where the band folds through the wall), plus edge skip on low-weight bridge quads.
- Cache **b153**. Hard refresh + re-export.

### 2026-07-08 ??? b152: Heart accent pinch at cleft (revert fragment patches)

**b150/b151 broke the band into lobe patches** (`js/features.js`)

- Skipping whole edge runs left disjoint orange slabs ??? not the goal.
- New approach: **continuous** accent ring, but thickness **pinches to zero** at concave notches (heart cleft) with a smooth taper ??? band fades out at the V instead of punching through.
- Cache **b152**. Hard refresh + re-export.

### 2026-07-08 ??? b151: Heart accent wide cleft exclusion zone

**Gold still bleeding inside heart notch** (`js/features.js`)

- b150 skipped concave edges only; adjacent lobe edges still offset into the footprint.
- Now: dilated skip mask (16 hops), 14 mm+ clearance from sharpest concave apex, drop edge if parallel offset lands inside profile polygon.
- Band may have a wider intentional gap at the back V ??? no interior bleed.
- Cache **b151**. Hard refresh + re-export.

### 2026-07-08 ??? b150: Heart accent skip concave cleft edges

**Gold band bleeding inside heart notch** (`js/features.js`)

- Cleft has dozens of concave profile vertices ??? joined offset ring still folded through the wall at the back V.
- Accent sleeve now extrudes **per-edge** with parallel outward offset; edges touching any concave vertex are skipped (small gap at notch, no interior bleed).
- Cache **b150**. Hard refresh MakerDeck.

### 2026-07-08 ??? b149: Basket weave + knit textures; heart accent cleft fix

**Vase textures** (`js/vase-textures.js`, `index.html`)
- New styles: **Basket weave** (alternating over/under strands) and **Knitted** (staggered V-stitch rows)
- Finer auto-tessellation for weave/knit

**Heart/star accent at cleft and tip** (`js/features.js`)
- Profile accent sleeve used vertex-normal miters that folded **through** concave corners (heart notch) and spiked at sharp tips ??? gold band showed on the inside. Now uses edge-intersection outward offset with spike clamp.

- Cache **b149**. Hard refresh MakerDeck.

### 2026-07-08 ??? b148: Vase surface textures (ripple, scales, bark)

**Parametric relief on vase/pot walls** (`js/vase-textures.js`, `js/vase.js`, `js/app.js`, `index.html`)

- New **Surface texture** toggle on Vase tab ??? styles: **Ripple**, **Scales**, **Bark**
- Depth + scale sliders; fades at floor (bed adhesion) and near rim
- Inner wall mirrors outer displacement for constant wall thickness (vase mode safe)
- Accent bands follow textured surface via `outerRingAt`
- Cache **b148**. Hard refresh MakerDeck. UI-only ??? Pi pull sufficient.

### 2026-07-08 ??? b147: Profile accent solid sleeve + teardrop CCW

**Teardrop accent invisible / body looked like inside-out ribbon** (`geometry.js`, `features.js`)

- Teardrop footprint was CW while star/heart/circle are CCW ??? wall quads faced inward; exterior accent was backface-culled.
- Profile accent was a 0.08 mm skin (visible inside before b146, invisible outside after). Now a **0.45 mm solid sleeve** on the exterior wall.
- Cache **b147**. Hard refresh MakerDeck.

### 2026-07-08 ??? b146: Accent offset to exterior wall

- Vertex-normal offset used inward normal for CCW footprints ??? bands hugged cavity side. Flipped to exterior normals.
- Cache **b146**. Hard refresh.

### 2026-07-08 ??? b145: Profile accent meshes discarded

- `buildContainer` built `accentMeshes` for profile shapes but non-box return path hard-coded `accentMeshes: []`.
- Cache **b145**. Hard refresh.

### 2026-07-07 ??? b144: Profile accent normal offset + position %

- Centroid radial offset wrong on concave profiles; now vertex-normal offset. Profile shapes use position % slider like vases.
- Cache **b144**. Hard refresh.

### 2026-07-07 ??? b143: Band 2 colour picker

- `ensureStateAccentBands` replaced band objects on UI refresh ??? Band 2 picker updated stale copy. Fixed in-place + index handlers.
- Cache **b143**. Hard refresh.

### 2026-07-07 ??? b141: Multi-accent bands (up to 2)

- Accent tab: Band 1 / Band 2 cards, separate 3MF filament slots. Legacy sessions migrate to `accentBands[]`.
- Cache **b141**. UI-only ??? Pi pull sufficient.

### 2026-07-07 ??? b140: Boot fix + library thumbnails

- Missing `buildWatermarkPreviewMesh` export broke entire app load. Library thumbnails moved to separate files + `GET /api/makerdeck/designs/{id}/thumbnail`.
- Cache **b140**. **Backend restart required.**

### 2026-07-07 ??? b139: Design library copy cleanup

**What changed:** User-facing labels stay **Design library** (Library tab). Removed Print Vault / recall wording from hints, export status, and delete confirm.

**Files:** `index.html`, `js/app.js?v=139`, `js/library.js?v=139` ??? header **b139**

**Deploy:** Pi `git pull`. Hard refresh.

### 2026-07-07 ??? b138: Watermark orientation fix

**What changed:** Bottom watermark was double-mirrored (`-px, -py`) so text read backwards in Bambu. Now maps normally on the exterior underside ??? reads correctly on layer 1 / when you flip the part over.

**Files:** `js/features.js?v=138`, cache-bust **b138**

**Deploy:** Pi `git pull`. Hard refresh. Re-download export.

### 2026-07-07 ??? b137: Design library (auto-save on export)

**What changed:**
- **Auto-archive** ??? body **3MF** and **STL** downloads POST to `POST /api/makerdeck/exports`. Files land in Print Vault `MakerDeck/` with a `.makerdeck.json` sidecar (full slider state + trace thumbnail).
- **Library tab** ??? browse saved designs, **Load** restores params, **Delete** removes vault file + manifest entry.
- **Backend** ??? `app/makerdeck_library.py`, manifest `makerdeck_designs.json` on Pi.

**Files:** `app/makerdeck_library.py`, `app/main.py`, `js/library.js?v=137`, `js/app.js?v=137`, `index.html` ??? header **b137**

**Deploy:** Pi `git pull` + **restart flightdeck.service** (backend routes added). Hard refresh MakerDeck.

### 2026-07-07 ??? b136: Bottom watermark + SVG lid emboss polish

**What changed:**
- **Bottom watermark** ??? every body 3MF/STL export gets a shallow 0.6mm deboss on the underside: chunky **MD** monogram + `MakerDeck ?? YYYY-MM-DD ?? #NNNN`. Mirrored for read-from-below. Toggle in top bar (**Watermark** checkbox, on by default). Serial counter in `localStorage` (`makerdeck-export-serial`).
- **SVG stroke emboss** ??? SVG uploads now use native path extrusion (`buildEmbossSvg`) instead of rasterize-and-trace. **Mechanic badge sample** button on Label tab. Badge sample auto-sets Face ??? Lid top when lid is enabled.

**Files:** `js/features.js?v=136`, `js/app.js?v=136`, `js/geometry.js?v=136`, `index.html` ??? header **b136**, `css/style.css`

**Deploy:** Pi `git pull`. Hard refresh (Ctrl+F5). Backend restart optional (UI-only).

### 2026-07-07 ??? b135: Solid divider slab (0 open edges in Bambu)

**What changed:** Bambu still reported 8 open edges on b134 ??? divider panels were zero-thickness sheets (2 faces only), leaving open top edges at the cavity rim.
- **`appendWeldedDividerSolid()`** ??? welded dividers are now a proper 6-face slab (floor, top cap, bay faces, wall-plane sides) with shared `WeldPool` verts.
- Sharp + rounded export paths both use the solid slab.
- Expect **~46 triangles** and **0 open edges** in Bambu without Repair.

**Files:** `js/features.js?v=135`, `js/app.js?v=135`, `index.html` ??? header **b135**

**Deploy:** Pi `git pull`. Hard refresh. Re-download for next print ??? current job on b134 is fine to finish.

### 2026-07-07 ??? b134: From-scratch watertight welded box mesh

**What changed:** b133 made things worse (16 open edges). Bambu Repair then filled the cavity solid (2.3kg). Root cause: merging a 6-face divider box into a stripped shell left T-junctions; depth-axis dividers only need left/right wall slots, not front/back.
- **`buildSharpWeldedBoxExport()`** ??? sharp rect welded exports are now one mesh from a shared `WeldPool`: shell + split floor patches + two divider faces per panel (not a solid box).
- **Correct wall slots** ??? depth axis segments left/right walls only; length axis segments front/back only; perpendicular walls stay full height.
- **Rounded fallback** ??? floor strip + two divider faces, no wall stripping.

**Files:** `js/features.js?v=134`, `js/app.js?v=134`, `index.html` ??? header **b134**

**Deploy:** Pi `git pull`. Hard refresh. Re-download ??? do **not** use Bambu Repair. Should show ~36 tris, 0 open edges.

### 2026-07-07 ??? b133: Segmented welded divider walls (manifold fix)

**What changed:** Chris's sharp-corner welded divider box exported (~40 tris) but Bambu still reported **8 non-manifold edges** at top corners + divider/wall junctions. Partial face stripping left T-junctions; divider and shell didn't share vertices.
- **Segmented inner walls** ??? for sharp rect profiles, remove full-height inner wall quads and rebuild only the wall bands above/below the divider slot; divider panel fills the gap with shared corners via `mergeMeshesSnap()`.
- **Welded divider height** ??? fixed mount panels now run floor-to-cavity-top (no lid-clearance gap that left open side walls).
- **Rounded fallback** ??? curved inner walls still use coplanar strip + snap merge.
- Export sanitize vertex weld tightened to **0.05 mm**; download status shows open-edge count if any remain.

**Files:** `js/features.js?v=133`, `js/stl.js?v=133`, `js/app.js?v=133`, `js/geometry.js?v=133`, `js/3mf.js?v=133`, `index.html` ??? header **b133**

**Deploy:** Pi `git pull`. Hard refresh (Ctrl+Shift+R). Re-download 3MF ??? Bambu should show **0 non-manifold edges** without Repair.

### 2026-07-07 ??? b132: Welded divider wall-strip + sharp-box export guard

**What changed:** Chris's export alert showed `shell=28, joiner=off` and blocked at 40 triangles ??? looked like the old joiner-shell leak, but **28 tris is the correct sharp-corner rect shell** (4-point profile = ~28 faces). The `<200` triangle guard was a false positive; Bambu non-manifold on welded dividers was duplicate **inner-wall** faces where the panel meets the cavity walls (only the floor was being stripped before merge).
- **`fixedDividerStripBoxes()`** ??? also strips inner-wall tris along welded divider edges (left/right/front/back contact patches), not just the floor footprint.
- **`weldedDividerExportLooksBroken()`** ??? shape-aware guard: sharp boxes expect ~40 tris total; rounded/filleted boxes still require ~300+ (catches real joiner-shell leaks).
- **`buildParams()`** ??? forces `joinerEnabled: false` when mount is Fixed; session restore does the same.
- **Cache-bust** all MakerDeck modules to `v=132` (geometry.js was still importing `features.js?v=102`).

**Files:** `js/features.js?v=132`, `js/geometry.js?v=132`, `js/app.js?v=132`, `js/3mf.js?v=132`, `js/stl.js?v=132`, `index.html` ??? header **b132**

**Deploy:** Pi `git pull`. Hard refresh (Ctrl+Shift+R). Re-download 3MF ??? sharp-corner box should show **~40 triangles** and pass; Bambu should report **0 non-manifold edges**. Rounded-corner boxes still expect ~328 tris.

### 2026-07-07 ??? b131: Export builds fresh geometry (fixes stale 40-tri joiner cache)

**What changed:** Chris still hit the b130 export block (40 triangles) even with Fixed welded + Joiner off. Headless export with the same params produces **328 triangles** ??? so the browser was exporting **stale preview meshCache** (e.g. joiner shell left over from before toggling Joiner off, or `rebuild()` skipped while `rebuildBusy`).
- **`buildFreshExportCache()`** ??? export always calls `buildContainer(buildParams())` from current UI state instead of reusing preview cache.
- **`collectColoredExportParts(exportCache)`** / STL export use the fresh cache for body, accent, and insert parts.
- Blocked-export alert now includes a **diagnostic line** (`shell=`, `joiner=`, `axis=`, `mount=`) to spot mismatches quickly.

**Files:** `js/app.js?v=131`, `js/3mf.js?v=131`, `index.html` ??? header **b131**

**Deploy:** Pi `git pull` ??? UI-only; restart optional but harmless. Hard refresh MakerDeck (Ctrl+Shift+R) to load `app.js?v=131`.

### 2026-07-07 ??? b130: Root cause ??? 40-tri joiner shell export, not Bambu packaging

**What we missed:** Headless tests used `.ref/mdtest/` copies of geometry/features ??? **not the same files** as `makerforge/js/` served to the browser. The repaired.3MF Chris shared preserved `MakerDeck-Triangles: 40`, proving the downloaded file literally contained **40 triangles**, not 328 misread by Bambu. That count exactly matches the **Link/joiner shell** export path when the welded divider merge does not run.

**Fixes:**
- Fixed (welded) divider export no longer depends on preview `insertCache` ??? always calls `buildWatertightFixedDividerExport` when mount is Fixed.
- Sync insert/joiner controls from DOM right before export (guards stale state).
- Block 3MF download when fixed divider expected but &lt;200 triangles ??? shows alert instead of silently shipping broken mesh.
- Block fixed divider + joiner together; selecting Fixed mount auto-disables joiner.
- **Cache-bust all modules to v=130** (features.js was stuck at ?v=102 through b125???b129).

**Files:** `js/app.js?v=130`, `js/features.js?v=130`, `js/geometry.js?v=130`, `js/3mf.js?v=130`, `js/stl.js?v=130`, `index.html` ??? header **b130**

### 2026-07-07 ??? b129: Export guard after repaired.3mf diff

**What changed:** Chris shared Bambu-repaired 3MF; diff showed the original MakerDeck file only had **40 triangles** (`MakerDeck-Triangles=40`), not 328 misread by Bambu. Bambu split that into a 28-tri shell + 12-tri divider panel. 40-tri export matches the **joiner/link shell path** when the welded divider is not merged.
- Export merge check now falls back to `meshCache.insertMesh` if preview insert cache is stale.
- 3MF download warns when fixed divider is enabled but export has &lt;200 triangles (likely joiner on or mount not Fixed welded).

**Files:** `js/app.js?v=129`, `index.html` ??? header **b129**

### 2026-07-07 ??? b128: Plain 3MF for single-colour body (Bambu still 40 tris)

**What changed:** Chris's fixed-divider box 3MF still showed 40 triangles / 8 non-manifold in Bambu after b127. Headless export still had 328 triangles in the mesh XML ??? Bambu was ignoring the mesh when Bambu project metadata was present.
- **Root cause:** `Metadata/model_settings.config` + `project_settings.config` make Bambu treat the file as a multi-part project and look up triangle-range part volumes instead of the mesh object. With no valid ranges, it validates an empty shell (~40 tris, 8 non-manifold).
- **Fix:** single-part / single-extruder exports now write a **plain core 3MF** ??? mesh only, no `Metadata/` folder, no `paint_color`, no Bambu assembly metadata. Multi-colour exports (body + accent/text) still use the full Bambu coloured project format.
- Download status now says `plain 3MF` vs `colored 3MF` with triangle count.

**Files:** `js/3mf.js?v=128`, `js/app.js?v=128`, `index.html` ??? header **b128**

**Deploy:** Pi `git pull`. Hard refresh. Re-download ??? status should read **`plain 3MF downloaded ??? 328 triangles (Body)`**. Bambu should show ~328 tris, 0 non-manifold.

### 2026-07-07 ??? b127: 3MF model_settings single-mesh fix (Bambu still 40 tris)

**What changed:** Chris's fixed-divider box 3MF still showed ~40 triangles / 8 non-manifold edges in Bambu after b126 hard refresh. Headless export already had 328 triangles in the XML ??? Bambu was mis-reading the file.
- **Root cause:** `Metadata/model_settings.config` wrapped a lone mesh object in `<part id="1">` tags. Bambu treats that like an empty multi-part assembly shell (~40 tris, non-manifold) instead of the real Body geometry.
- **Fix:** single-part exports now write object-level extruder metadata only (no `<part>` children). Multi-part exports (body + accent/text) unchanged.
- 3MF model metadata now includes `MakerDeck-Triangles` count for verification.
- Export always rebuilds geometry first; Download shows triangle count under the button.
- Separate-colour text export still welds fixed dividers into the Body mesh.

**Files:** `js/3mf.js?v=127`, `js/app.js?v=127`, `index.html`, `css/style.css?v=22` ??? header **b127**

**Deploy:** Pi `git pull`. Hard refresh (Ctrl+Shift+R). Re-download 3MF (don't reopen an old file). Bambu should show **~328 triangles** and **0 non-manifold edges**. Download status should say `328 triangles (Body)`.

### 2026-07-07 ??? b126: 3MF single-part export fix (Bambu 40 tris / non-manifold)

**What changed:** Chris's fixed-divider box 3MF still showed ~40 triangles and 8 non-manifold edges in Bambu after b125.
- **Root cause:** single-part 3MF exports wrapped the real Body mesh in an empty assembly object (`<components>` only, 0 triangles). Bambu validates that shell as "makerdeck" instead of the 328-triangle Body geometry.
- **Fix:** when only one coloured part is exported, reference the mesh object directly ??? no assembly wrapper. Multi-part exports (body + accent/text) still use the assembly pattern.
- 3MF object name now uses the proper model name (`box-300x275x130mm`) instead of generic "makerdeck".
- Skip redundant second sanitize pass when writing 3MF (parts are already cleaned).

**Files:** `js/3mf.js?v=126`, `js/app.js?v=126`, `index.html` ??? header **b126**

**Deploy:** Pi `git pull`. Hard refresh (Ctrl+Shift+R). Re-download 3MF ??? Bambu should show ~328 triangles and 0 non-manifold edges.

### 2026-07-07 ??? b125: Manifold STL export (welded dividers + sanitize)

**What changed:** Bambu Studio flagged Chris's 300??270??130 box with a fixed divider as non-manifold (4 bad edges). Root cause: welded dividers were na??vely merged into the body shell, leaving duplicate internal faces where the panel overlaps the cavity floor and walls.
- New **`buildWatertightFixedDividerExport()`** ??? strips cavity-floor tris under the divider footprint, then merges the panel into one body mesh (STL + 3MF Body part).
- Fixed dividers are now **flush** with inner walls/floor (removed the 0.5mm overlap bite that created parallel duplicate faces).
- **STL sanitize** tightened for export: 0.04mm vertex weld, coplanar duplicate peel, 12 non-manifold repair passes.

**Files:** `js/features.js?v=102`, `js/stl.js?v=76`, `js/app.js?v=125`, `js/3mf.js?v=125`, `js/geometry.js?v=125`, `index.html` ??? header **b125**

**Deploy:** Pi `git pull`. Hard refresh MakerDeck (Ctrl+Shift+R). Re-download the box STL/3MF ??? Bambu should report 0 non-manifold edges.

### 2026-07-07 ??? b124: Retire Fat quarters preset + clean download filenames

**What changed:** Two tidy-ups Chris asked for.
- **Fat quarters preset removed** ??? shape button, preset config, size profile, and all special-case wiring (fuse-to-body is now purely the Fixed mount's job, from b123). Old saved sessions with the preset restore as a plain rounded box, same dimensions.
- **Filenames no longer full of float noise** (`box-93.39999999999999x93.39999999999999x154.6mm.3mf` ??? `box-93.4x93.4x154.6mm.3mf`). New shared `baseModelName()` in `stl.js` rounds to 0.1mm and drops trailing zeros; STL + 3MF now name identically. Bonus fixes: vases finally get proper names (`goblet-88.7x110mm.3mf` instead of generic `box-???`/`makerdeck`), and saucer / deboss-cutter STLs get `-saucer` / `-deboss-cutter` suffixes instead of silently reusing the body filename.

**Files:** `js/stl.js?v=75`, `js/3mf.js?v=124`, `js/geometry.js?v=124`, `js/app.js?v=124`, `index.html` ??? header **b124**

**Deploy:** Pi `git pull`. Hard refresh ??? confirm header shows **b124** and the Fat quarters button is gone; download any 3MF and check the tidy filename.

### 2026-07-06 ??? b123: Fixed (welded) divider option

**What changed:** Chris's snap-fit divider shifted mid-print and wrecked the print. New **Mount ??? Fixed ??? welded to body** option:
- Divider panels print as one piece with the box: zero clearance, panels bite 0.5mm into the walls and floor so the merged mesh overlaps firmly (coplanar faces can slice as a hairline gap).
- Exports: 3MF merges the dividers into the Body part; plain STL body download also includes them. No separate loose insert.
- Fixed is vertical-panels only (a welded horizontal shelf would print mid-air) ??? picking Fixed with Height shelves flips the axis back to Length, and vice versa, same interlock as slide-in slots.
- Wall-clearance slider hides when Fixed (nothing to tune); hint explains the one-piece print.
- Node-verified: welded panels exceed the cavity span (bite) but stay inside the outer shell and floor; snap panels still float clear.

**Files:** `js/features.js?v=101`, `js/geometry.js?v=123`, `js/app.js?v=123`, `index.html` ??? header **b123**

**Deploy:** Pi `git pull`. Hard refresh ??? confirm header shows **b123**. Try: rect box ??? Insert tab ??? Mount ??? Fixed ??? welded to body.

### 2026-07-06 ??? b122: Sliceable vase accents ??? solid band + single-object 3MF

**What changed:** Chris's 3MF looked right in MakerDeck but "reverted" in Bambu Studio ??? errors: empty first layer, floating regions, collision. Two root causes:
- **The accent was a zero-thickness skin** floating 0.12mm off the wall ??? unprintable, and Bambu's auto-repair mangles it. Exports now use a new **solid** variant (`buildVaseAccentMesh` with `accentSolid: true`): outer surface = the preview skin, inner surface bites ~0.6???1mm **into** the body wall (never through ??? always leaves ???0.4mm), edges capped ??? watertight ring with firm slicer overlap. Preview still uses the thin skin (crisp, no bleed).
- **3MF exported each mesh as a separate build object**, so Bambu saw a free-floating "Accent" model. `buildColoredProject3mf` now emits one assembled object with component parts (Bambu `<part>` entries in model_settings.config, per-part extruders). Body + accent (+ text/insert) import as a single model ??? parts mid-air are fine because the object as a whole sits on the plate.
- Node-verified: solid band watertight (open=0) for straight/wavy/base-wave/rolled-rim on fluted+twisted goblet; 3MF structure test checks assembly + parts + extruders; all prior accent/grid tests ALL OK.

**Files:** `js/vase.js?v=122`, `js/geometry.js?v=122`, `js/3mf.js?v=122`, `js/app.js?v=122`, `index.html` ??? header **b122**

**Deploy:** Pi `git pull`. Hard refresh ??? confirm header shows **b122**. Re-download the 3MF and drop into Bambu Studio: should import as ONE object with a Body + Accent part, no errors.

### 2026-07-06 ??? b121: Vase rim finishes (bevel / bullnose / rolled lip)

**What changed:** Chris's idea ??? the vase rim was a dead-flat annulus. New **Rim finish** select in the vase section:
- **Square (flat)** ??? unchanged default.
- **Bevelled** ??? 45?? chamfer on both rim edges.
- **Rounded (bullnose)** ??? half-circle sweep across the wall top.
- **Rolled lip** ??? the wall flares outward near the top (smoothstep, ~4.5% of diameter, clamped 2.2???6mm) and finishes in a bullnose, like a thrown-pottery rolled rim. Inner wall follows the flare so wall thickness stays constant (vase-mode safe).
- Rim sweep lerps per-vertex between the outer and inner rings so flutes + twist carry through the rim profile.
- Accent bands clamp below the rim sweep and track the rolled-lip flare (fixed the accent's z???layer interpolation to use rim-clamped layer heights).
- Node-verified: watertight (open=0) and exact height for all 9 styles ?? bevel/round/rolled incl. fluted+twisted; new ray-cast accent test on a rolled-lip wavy band at the rim passes; all prior accent/twist tests still ALL OK.

**Files:** `js/vase.js?v=121`, `js/geometry.js?v=121`, `js/app.js?v=121`, `index.html` ??? header **b121**

**Deploy:** Pi `git pull`. Hard refresh ??? confirm header shows **b121**. Try: urn, Rim finish ??? Rolled lip.

### 2026-07-06 ??? b120: Wavy accent band bleed-through fix (twisted/fluted vases)

**What changed:** Chris's screenshot showed the red body poking through the grey wavy band on a twisted goblet. Three root causes, all in `buildVaseAccentMesh`:
- **Non-planar body quads**: with flutes + twist the body's wall quads aren't flat, so its triangles bulge up to ~0.3mm outside the vertex-lerped surface the band was tracking. Band now pads its offset by the measured per-layer diagonal sag (`sagAt`).
- **Steep walls**: a fixed radial 0.12mm offset shrinks to almost nothing measured perpendicular to a leaning wall (goblet base flare). Skin is now slope-compensated (`skinAt`), capped at 0.5mm.
- **Wave chords cutting corners**: steep waves shift z by several mm between adjacent columns, so horizontal chords sliced diagonally through body layer kinks. Wavy bands now subdivide columns until each step's wave delta is ???0.5mm, and use denser vertical slices (every 0.5mm).
- New ray-cast test (M??ller???Trumbore against actual body triangles, sampling band vertices + edge midpoints): positive gap everywhere on twisted goblet with wavy band at the base flare, including max amp 10 / 16 waves. Old binned tests still pass (gap ceiling raised to 0.7 for the sag pad).

**Files:** `js/vase.js?v=120`, `js/geometry.js?v=120`, `js/app.js?v=120`, `index.html` ??? header **b120**

**Deploy:** Pi `git pull`. Hard refresh ??? confirm header shows **b120**. Try: goblet, flutes 12, twist 90, accent on, wavy edge near the base ??? no red patches.

### 2026-07-06 ??? b119: Taller accent bands + wavy band edge

**What changed:** More of Chris's accent ideas.
- **Band height** now goes 2???80 mm (was 10) ??? proper two-tone vases. Clamped to the part height on both vases and boxes.
- **Band edge** select (vase only): **Straight ring** or **Wavy (up-n-down)** ??? the whole ribbon undulates around the circumference. Wave height 0.5???10 mm, waves-around 2???16. Band height stays constant along the wave; wave flattens at the very base/rim so it never runs off the part.
- Node-verified: 55 mm tall band and wavy band (amp 4, 6 waves) both hug the wall with positive gap everywhere on fluted+twisted urns/goblets; all position/legacy tests still pass.

**Files:** `js/vase.js?v=119`, `js/geometry.js?v=119`, `js/features.js?v=100`, `js/app.js?v=119`, `index.html` ??? header **b119**

**Deploy:** Pi `git pull`. Hard refresh ??? confirm header shows **b119**. Try: goblet, accent on, height 30, position 40%, edge Wavy.

### 2026-07-06 ??? b118: Movable vase accent band + z-fighting fix

**What changed:** Chris's idea ??? slide the accent band anywhere on the vase wall.
- **Band position slider** (vase only, replaces the face select): 0% = base, 25/33/50 = part-way, 100% = rim. Type exact values via the number button. Legacy floor/rim sessions map to 0/100.
- **Red-through-grey patches fixed**: the band previously sampled the smooth analytic surface while the body wall is piecewise-linear between layers, so the skin cut in and out of the body (z-fighting patches in Chris's screenshots). Band slices now reuse the body's exact layer rings (per-vertex lerp between layers) pushed radially out by a fatter 0.12mm skin ??? verified constant 0.12mm gap at every matched sample across 4 styles ?? 5 positions with flutes 12 + twist 90.

**Files:** `js/vase.js?v=118`, `js/geometry.js?v=118`, `js/app.js?v=118`, `index.html` ??? header **b118**

**Deploy:** Pi `git pull`. Hard refresh ??? confirm header shows **b118**. Try: vase accent on ??? drag Band position to 33%.

### 2026-07-06 ??? b117: Accent bands on vases / pots

**What changed:** The Accent tab now works for vase / pot shapes.
- Band is a 0.08mm skin that follows the full outer surface ??? profile curve, flutes and twist included ??? so it prints as a clean second-colour ring even on spiralled vases.
- Faces: **Rim band** (below the top edge) or **Floor band** (above the base). "Front" is hidden for vases (no flat front on a revolve).
- Bundled in Download 3MF as its own filament slot, or exportable as a separate accent STL ??? same flow as boxes.
- Refactored `vase.js` with a shared `vaseSurface()` resolver so body + accent always agree on geometry.
- Node-verified: accent hugs the surface at exactly 0.08mm across cylinder/urn/goblet/bud ?? rim/floor with flutes 12 + twist 90??; full watertight grid + twist tests still ALL OK.

**Files:** `js/vase.js?v=117`, `js/geometry.js?v=117`, `js/app.js?v=117`, `index.html` ??? header **b117**

**Deploy:** Pi `git pull`. Hard refresh ??? confirm header shows **b117**. Try: Vase ??? flutes 12, twist 90 ??? Accent tab ??? enable, Floor band, 8mm.

### 2026-07-06 ??? b116: Vase twist fix (slider did ~nothing)

**What changed:** Twist was applied as `cos(flutes*a - phase)` ??? the rib pattern only rotated by twist/fluteCount (90?? slider = 7.5?? visible with 12 flutes). Now `cos(flutes*(a - phase))` so ribs rotate by the full twist angle.
- Node-verified: crest rotation between z-bands matches the expected twist fraction for 0/45/90/???120??; full 9-style watertight grid still ALL OK.
- Twist slider now hides when Flutes = 0 (twist has no visible effect on a smooth surface of revolution).

**Files:** `js/vase.js?v=116`, `js/geometry.js?v=116`, `js/app.js?v=116`, `index.html` ??? header **b116**

**Deploy:** Pi `git pull`. Hard refresh ??? confirm header shows **b116**. Try: flutes 12, twist 90?? ??? ribs should visibly spiral a quarter turn.

### 2026-07-06 ??? b115: Screw lid fit fix (first print wouldn't thread on)

**What changed:** Chris's printed 35mm screw lid wouldn't screw on ??? modelled pass-over clearance was only 0.35 mm, which FDM perimeter swell (bore prints small, external threads print big) eats entirely.
- **FDM fit compensation**: lid bore gets +0.25 mm radial on top of the Fit clearance (pass-over now 0.6 mm at default 0.35), and the lid's internal thread flanks are slimmed 0.15 mm so they can't bind axially.
- **Chunkier thread**: pitch 3.2 ??? 4.0, depth 1.2 ??? 1.4, wider root ??? coarser thread is more forgiving of stringing/blobs and keeps 0.8 mm radial engagement despite the extra bore room.
- Node-verified at 80 mm and at the printed 35 mm size: engagement 0.80 mm, pass-over 0.60 mm, watertight components unchanged.
- Bodies and lids must be **re-exported together** ??? old body + new lid mixes thread pitches.

**Files:** `js/geometry.js?v=115`, `js/app.js?v=115`, `index.html` ??? header **b115**

**Deploy:** Pi `git pull`. Hard refresh ??? confirm header shows **b115**. Re-export both STLs and reprint; if still snug, raise Fit clearance slider (each +0.1 = +0.1 radial all round).

### 2026-07-06 ??? b114: Vase studio ??? new styles, flutes, twist

**What changed:** Vase / pot generator got a designer upgrade.
- **4 new styles**: Bowl planter (low + wide), Goblet (stem + cup), Hourglass (pinched waist), Bud vase (narrow neck) ??? alongside the existing five.
- **Smooth profiles**: control points now interpolate with a monotone cubic spline (Fritsch???Carlson) instead of straight lines ??? bellies and necks curve naturally with no overshoot. Applies to all styles including the old ones.
- **Flutes (ribs)**: 0???24 vertical ribs, depth 0.5???6 mm. Cosine modulation preserves mean radius; inner wall follows the wave so wall thickness stays constant (vase-mode friendly). Flutes fade to circular at the base for bed adhesion and a clean bottom cap.
- **Twist**: ???180?? to +180?? over the height ??? turns flutes into spirals. Tessellation auto-densifies (segments up to 240, layers up to 160) so twisted/fluted surfaces stay smooth.
- Node-verified watertight (0 open edges) across all 9 styles ?? 7 variant combos (flutes, twist, deep ribs, small diameter, no-drain).

**Files:** `js/vase.js?v=114`, `js/geometry.js?v=114`, `js/app.js?v=114`, `index.html` ??? header **b114**

**Deploy:** Pi `git pull` (static only, restart optional). Hard refresh ??? confirm header shows **b114**. Try: Vase / pot ??? Goblet, Flutes 12, Twist 90??.

### 2026-07-06 ??? b113: Screw-top lids (round containers)

**What changed:** New **Screw top** lid type, offered only when shape = Circle.
- Coarse 2-start trapezoid thread (pitch 3.2, lead 6.4, depth 1.2 mm, tapered run-in/out) ??? prints without support on vertical walls.
- Body gets matching external neck threads over the skirt zone; lid is a knurled cap (24 grip flutes) with internal threads.
- Existing sliders drive it: **Skirt** = thread engagement depth (8???12 mm sweet spot), **Clearance** = radial fit (0.35 default), **Thickness** = top plate.
- Node-verified: 0.85 mm radial thread engagement, 0.35 mm pass-over clearance, lid/body watertight (shell + 2 thread-start solids each), print orientation plate-down.
- Non-circle shapes never see the option; saved sessions with screw on other shapes normalize to slip.

**Files:** `js/geometry.js`, `js/app.js?v=113`, `js/features.js?v=99`, `js/art-editor.js`, `index.html` ??? header **b113**

**Deploy:** Pi `git pull`. Hard refresh ??? confirm header shows **b113**. Try: Circle ??? Lid tab ??? enable ??? Screw top.

### 2026-07-06 ??? b112: floor marks, heart knuckles, smooth curves ??? `a57799a`

### 2026-07-06 ??? b112: floor marks, heart knuckles, smooth curves

**What changed:**
- **Floor marks on every shape** were shadow-map acne (self-shadowing from the key light), not geometry ??? verified with a Node mesh scan (all shapes = 1 watertight component, no flipped floor tris). Shadows now disabled in the preview renderer.
- **Heart/star knuckle balls**: `filletedOutline` forced every arc CCW, so reflex corners (heart notch, star inner points) drew near-full circles. Fillets now skip reflex corners and sweep the short way; radius adapts to clamped trim so sharp tips stay tangent. This also removed a stray 23-tri patch on the heart floor.
- **Smoother curves**: heart outline 52 ??? 160 segments, teardrop 32 ??? 72 ??? prints and previews smooth instead of faceted.

**Files:** `js/geometry.js`, `js/app.js`, `index.html` ??? `app.js?v=112`, header **b112**

**Deploy:** Pi `git pull`. Hard refresh ??? confirm header shows **b112**.

### 2026-07-06 ??? Houdini fix: earcut annulus crash (b111) ??? `e772aa4`

### 2026-07-06 ??? Houdini fix: earcut annulus crash (b111)

**What changed:** b110 passed only outer coords to `earcut()` while declaring a hole index ??? earcut threw, preview went blank. Now passes outer+hole flat coords; try/catch falls back to radial `capRing`.

**Files:** `js/geometry.js`, `index.html`, `js/app.js` ??? `app.js?v=111`, header **b111**

**Deploy:** Pi `git pull`. Hard refresh.

### 2026-07-06 ??? Floor artifacts v2 (radial pairing + earcut annulus)

**What changed:** v109 arc-length resample was not enough ??? capRing quads still crossed the floor when fillet counts matched but angles did not. Now: radial ray-cast pairing, horizontal rims use earcut annulus (hole winding fixed), build tag **b110** in header so you can confirm the loaded bundle.

**Files:** `js/geometry.js`, `index.html`, `css/style.css?v=21`, `js/app.js` ??? `app.js?v=110`

**Deploy:** Pi `git pull`. Hard refresh ??? confirm header shows **b110**.

### 2026-07-06 ??? Preview floor artifacts (all shapes)

**What changed:** Center floor slivers and star/heart ???knuckle??? spikes were from (1) duplicate coplanar floor caps in `capFloorSlab` and (2) `capRing` pairing outer/inner vertices by index when filleted profiles had different point counts. Inner rings are now arc-length resampled to match outer; floor slabs use a single cap face.

**Files:** `js/geometry.js`, `index.html`, `js/app.js` ??? `app.js?v=109`

**Deploy:** Pi `git pull`. Hard refresh (Ctrl+Shift+R).

### 2026-07-06 ??? Houdini fix (vase earcut import)

**What changed:** `vase.js` imported earcut from `three/examples/...` which is not in the import map ??? module load failed and the whole preview went blank ("Houdini"). Switched to same `esm.sh/earcut` as `geometry.js`.

**Files:** `js/vase.js`, `index.html`, `js/app.js` ??? `app.js?v=108`

**Deploy:** Pi `git pull`. Hard refresh (Ctrl+Shift+R).

### 2026-07-06 ??? Preview artifact fix (slip lid + vase caps)

**What changed:** Slip-over lids had a hollow top rim so the internal skirt floor looked like a floating plane in every lidded preview. Solid earcut top plate now. Vase floors use earcut caps too.

**Files:** `js/geometry.js`, `js/vase.js`, `index.html` ??? `app.js?v=107`

**Deploy:** Pi `git pull`. Hard refresh.

### 2026-07-06 ??? Divider top clearance (match lid)

**What changed:** Insert tab ??? **Match lid clearance** (default on) shortens dividers when inset plug skirt or flat-cap lip hangs inside. **Top clearance** slider for manual override.

**Files:** `js/features.js?v=98`, `js/insert-slots.js`, `js/app.js?v=106`, `js/geometry.js`, `index.html`

**Deploy:** Pi `git pull`. Hard refresh.

### 2026-07-05 ??? Inset plug lid restored

**What changed:** Inset plug (skirt inside the opening) is back as a third simple lid ??? distinct from slip-over and flat cap. Hinges/slide/roll still gone.

**Files:** `js/geometry.js`, `js/app.js?v=105`, `js/art-editor.js`, `index.html`

**Deploy:** Pi `git pull`. Hard refresh.

### 2026-07-05 ??? KISS lids (slip-over + flat cap only)

**What changed:** Chris asked to drop hinges and keep it simple.
- **Two lid types:** Slip-over skirt outside walls, Flat cap plate on rim (+ optional lip).
- **Removed:** Hinge tab, clip/slide/roll/hinge lid types, `hinge-hardware.js`, `clip-hinge.js`, `hinge-lid.js`, `slide-lid.js`, `roll-lid.js`.
- Old saved sessions auto-map `hinge`/`clip`/`slide`/`roll`/`plug` ??? slip or flat.
- Preview is vertical lift/lower only ??? no knuckle cylinders on star/heart/teardrop.

**Files:** `js/geometry.js`, `js/app.js?v=104`, `js/features.js?v=97`, `js/art-editor.js`, `js/stl.js`, `index.html` ??? deleted hinge/slide modules

**Deploy:** Pi `git pull`. Hard refresh MakerDeck / `#/makerdeck`. UI-only ??? no backend restart.

### 2026-07-05 ??? Hinge dropdown + live 3D preview

**What changed:** Hinge tab now works like a real hinge generator:
- **Hinge type** dropdown (Snap clip, Butt pin, Strap door, Flush barrel)
- Switching type shows that hinge in the **viewport** (orange hardware; snap clip also shows gold pin)
- **Length / width** sliders update the preview live; leaf types also expose thickness, knuckle, and pin controls
- Box hides while the Hinge tab is active so the hardware is easy to inspect
- Standalone leaf hinges preview without needing a box; snap clip previews on supported shapes even before Clip hinge lid is enabled

**Files:** `js/hinge-hardware.js`, `js/app.js?v=102`, `js/geometry.js?v=102`, `index.html`

**Deploy:** Pi `git pull`. Hard refresh MakerDeck / `#/makerdeck`.

### 2026-07-05 ??? Hinge generator presets (butt, strap, barrel)

**What changed:** Hinge tab is now a **hinge generator** with style presets:
- **Snap clip** ??? box rail system (needs Clip hinge lid)
- **Butt pin** ??? flat-leaf alternating knuckles
- **Strap door** ??? long door leaf + short frame leaf
- **Flush barrel** ??? compact cabinet barrel hinge

Each style has tuned sliders, assembly steps, and Download hinge / pin STLs (manifold, flat on bed).

**Files:** `js/hinge-hardware.js` (new), `js/app.js?v=101`, `js/geometry.js`, `js/stl.js`, `index.html`, `css/style.css?v=20`

**Deploy:** Pi `git pull`. Hard refresh.

### 2026-07-05 ??? Hinge tab (clip generator)

**What changed:** Dedicated **Hinge** tab for clip hinge hardware ??? rail/pin/position sliders, assembly steps, and **Download clips / pins** buttons. Clips + pins removed from main export dropdown. Picking Clip hinge on Lid tab jumps you to Hinge.

**Files:** `index.html`, `css/style.css?v=19`, `js/app.js?v=100`, `js/geometry.js`

**Deploy:** Pi `git pull`. Hard refresh.

### 2026-07-05 ??? Clip export: one fused part, 4-up on bed

**What changed:** Clip STL was two floating pieces (C-grip + ring) ??? unusable in Bambu. Now:
- Grip + knuckle barrel **fused** with web ribs (one solid per clip)
- **Laid flat on the bed** (barrel down, arch up)
- Export arranges **4 clips** or **2 pins** on the plate automatically

**Files:** `js/clip-hinge.js`, `js/geometry.js`, `js/app.js`, `index.html` ??? cache-bust `app.js?v=99`

**Deploy:** Pi `git pull`. Hard refresh. Re-export clip + pin STLs.

### 2026-07-05 ??? Fix blank preview (duplicate export crash)

**What changed:** `geometry.js` exported `clipHingeAvailable` and `normalizeLidType` twice ??? the module failed to load and the viewport showed no box. Removed duplicate re-exports; added missing `skirtDepth` on clip fit guides.

**Files:** `js/geometry.js`, `js/app.js`, `index.html` ??? cache-bust `app.js?v=98`

**Deploy:** Pi `git pull`. Hard refresh.

### 2026-07-05 ??? Clip hinge: snap rails + separate clip/pin exports

**What changed:** Replaced the hidden integrated flip hinge with a focused **clip hinge** system:
- **Clip hinge** lid type ??? clean inset plug + snap rails on box/lid back rim (no integrated knuckles)
- **Separate exports:** STL hinge clip (??4) and STL hinge pin (??2) in the download dropdown
- Clip + pin meshes are **manifold** (0 open edges after sanitize) ??? no Bambu Repair
- Preview reuses flip animation on back edge; saved `hinge` lid type maps to `clip`

**Files:** `js/clip-hinge.js` (new), `js/geometry.js`, `js/app.js`, `js/stl.js`, `js/art-editor.js`, `index.html` ??? cache-bust `app.js?v=97`

**Deploy:** Pi `git pull`. Hard refresh. Enable lid ??? Clip hinge ??? export body, lid, clips, pins.

### 2026-07-05 ??? Flip hinge hidden (not strong enough yet)

**What changed:** **Flip hinge** removed from the lid-type dropdown for now ??? filament knuckles aren???t strong enough for real use. Saved sessions with hinge selected fall back to **Inset plug**. Code stays in repo (`HINGE_LID_ENABLED = false`) for a future stronger design.

**Files:** `js/geometry.js`, `js/app.js`, `index.html` ??? cache-bust `app.js?v=95`

**Deploy:** Pi `git pull`. Hard refresh.

### 2026-07-05 ??? Manifold exports (no slicer repair)

**What changed:** Exports should load in Bambu without **Repair**:
- **Hinge lid** ??? closed plug shell (no open back wall); pin tunnels capped with washer end-faces
- **STL sanitize** ??? stronger non-manifold peel (8 passes) + open-edge check (warns in console if any remain)

**Files:** `js/hinge-lid.js`, `js/stl.js`, `js/app.js`, `js/3mf.js`, `index.html` ??? cache-bust `app.js?v=94`, `stl.js?v=74`

**Deploy:** Pi `git pull`. Hard refresh. Re-export STLs/3MF.

### 2026-07-05 ??? Flip hinge v2: flat lid export, pin tunnels, tighter knuckles

**What changed:** Hinge redesign from Chris???s Bambu slice feedback:
- **Lid exports flat** on the bed (vertical rim knuckles, no horizontal Y overhang; bottom shifted to Z=0)
- **5 knuckle positions** (body/lid/body/lid/body) packed with tighter pitch ??? not 2+1 at the ends
- **Pin tunnels** through each knuckle (1.75 mm filament slides in from either side along box width)
- Default knuckle radius **4 mm**, count **5**

**Files:** `js/hinge-lid.js`, `js/geometry.js`, `js/app.js`, `index.html` ??? cache-bust `app.js?v=93`

**Deploy:** Pi `git pull`. Hard refresh. Re-export body + lid STL/3MF.

### 2026-07-05 ??? Fat quarters: fuse dividers to floor/walls (print fix)

**What changed:** Fat quarters tray dividers were floating **0.12 mm** above the floor with side gaps ??? fine for removable inserts, but when merged into one 3MF they printed as weak free-standing walls that delaminated (layer ribbons). Dividers now **fuse to floor and side walls** on the fat quarters preset; default divider thickness **3.2 mm**.

**Files:** `js/features.js`, `js/geometry.js`, `js/app.js`, `index.html` ??? cache-bust `app.js?v=92`

**Deploy:** Pi `git pull`. Hard refresh. **Re-export 3MF** before reprinting.

### 2026-07-05 ??? Fix flip hinge reverting / clearing lid

**What changed:** Selecting **Flip hinge** was crashing during preview guide setup (`plateOuter` missing on hinge fit guides ??? rebuild error ??? emergency reset to default box). Hinge guides now use the correct rim/plate loops; fat quarters preset also listed as hinge-capable.

**Files:** `js/app.js`, `js/hinge-lid.js`, `index.html` ??? cache-bust `app.js?v=90`

**Deploy:** Pi `git pull`. Hard refresh.

### 2026-07-05 ??? Fix flip hinge lid preview (invisible lid)

**What changed:** Hinge lid preview was offset ~27 mm behind the box (invisible). Now uses a pivot group on the back edge. Picking a lid type also auto-enables **Enable lid** if it was off.

**Files:** `js/app.js`, `js/hinge-lid.js`, `index.html` ??? cache-bust `app.js?v=89`

**Deploy:** Pi `git pull`. Hard refresh.

### 2026-07-05 ??? Lids: flip hinge + roll lock (bayonet)

**What changed:** Two new lid types on the Lid tab:
- **Flip hinge** ??? pin knuckles on the back edge (box + lid interleave). Use **1.75 mm filament** as hinge pin. Best on box / rounded / pencil box. Preview animates clamshell open.
- **Roll lock** ??? push-down + twist bayonet cap for **circle, oval, hex**. Body gets inner rim tracks; lid gets radial lugs. Preview animates lift + quarter-turn.

**Files:** `js/hinge-lid.js`, `js/roll-lid.js`, `js/geometry.js`, `js/app.js`, `js/art-editor.js`, `index.html` ??? cache-bust `app.js?v=88`

**Deploy:** Pi `git pull`. Hard refresh. Re-export body + lid STLs.

### 2026-07-05 ??? Edge fillet: adaptive arc segments (box shape)

**What changed:** **Box + edge fillet** (the `box-*.stl` path, not the Rounded shape) now uses adaptive arc segments ??? ~1 mm facet target, min 12 / max 96 per corner. A **12 mm fillet** goes from 6 segments to **~19** per corner.

**Files:** `js/geometry.js`, `js/app.js`, `index.html` ??? cache-bust `app.js?v=87`

**Deploy:** Pi `git pull`. Hard refresh. Re-export STL/3MF.

### 2026-07-05 ??? Oval shape + smoother rounded corners

**What changed:** New **Oval** shape (width + depth elliptical box). **Rounded** boxes (and pencil / pencil box / fat quarters rounded corners) now use adaptive corner arc segments (~1.5 mm facet length, scales with corner radius) instead of a fixed 8???10 segments ??? much smoother walls in Bambu slice preview.

**Files:** `js/geometry.js`, `js/app.js`, `js/stl.js`, `js/3mf.js`, `index.html` ??? cache-bust `app.js?v=86`

**Deploy:** Pi `git pull`. Hard refresh. Re-export STL/3MF.

### 2026-07-05 ??? Circle boxes: smoother wall mesh for slicing

**What changed:** **Circle** shape no longer uses a fixed 56-sided outline. Segment count now scales with diameter (~1.5 mm facet length, 96???256 segments) so Bambu Studio shows round walls instead of chunky flat facets.

**Files:** `js/geometry.js`, `js/app.js`, `index.html` ??? cache-bust `app.js?v=84`

**Deploy:** Pi `git pull`. Hard refresh. Re-export STL/3MF for circle boxes.

### 2026-07-05 ??? Lids polish: flat cap retention lip + stackable lid pockets

**What changed:** **Flat cap** lids now support an optional **retention lip** (inner skirt that drops into the opening for alignment). New **Retention lip** slider on the Lid tab (flat cap only). **Fat quarters** preset defaults to **3 mm** lip when lid is enabled. When **Stack** hex feet are enabled, matching **pockets are cut into the top of flat lids** so trays can nest lid-on-tray. Preview fit guides show the lip ring.

**Planned next ??? adjustable removable dividers:** mirrored vertical slot pairs on left/right walls; slot positions on a slider scale so panels slide in and bays resize for on-call custom boxes.

**Files:** `js/geometry.js`, `js/features.js`, `js/app.js`, `index.html` ??? cache-bust `app.js?v=83`

**Deploy:** Pi `git pull`. Hard refresh. UI-only ??? no backend restart required.

### 2026-07-05 ??? Lids: flat cap default for fat quarters tray

**What changed:** **Fat quarters** preset defaults to **Flat cap** lid type when you enable lid (still off by default). Lid tab shows tray hint for dust cover / stacking.

**Planned next ??? adjustable removable dividers:** mirrored vertical slot pairs on left/right walls; slot positions on a slider scale so panels slide in and bays resize for on-call custom boxes.

**Files:** `js/geometry.js`, `js/app.js`, `index.html` ??? cache-bust `app.js?v=82`

**Deploy:** Pi `git pull`. Hard refresh.

### 2026-07-05 ??? Fat quarters: single-colour export

**What changed:** **Fat quarters** preset dividers match **box colour** in preview. **3MF export** merges Insert into Body (one part, one extruder) for single-filament prints.

**Files:** `js/app.js`, `index.html` ??? cache-bust `app.js?v=81`

**Deploy:** Pi `git pull`. Hard refresh. Re-export 3MF.

### 2026-07-05 ??? Fat quarters preset: flat H-series tray

**What changed:** **Fat quarters** preset matches Chris???s print ??? **300??300??55 mm** flat tray, **2 vertical dividers** (3 bays ~98 mm), prints on H-series bed (~305??58 mm outer). Removed 400 mm bookcase layout.

**Files:** `js/geometry.js`, `js/app.js`, `index.html` ??? cache-bust `app.js?v=80`

**Deploy:** Pi `git pull`. Hard refresh. Re-export 3MF.

### 2026-07-05 ??? Insert body gap + slide-in shelf slots

**What changed:** **0.12 mm air gap** between Insert and Body (fixes Bambu Insert ??? Body gcode conflicts). Insert gets its own extruder slot in 3MF. New **Mount** option: **Slide-in slots** (horizontal shelves only) ??? dados on side walls, shelves slide in from the front.

**Files:** `js/insert-slots.js`, `js/features.js`, `js/geometry.js`, `js/app.js`, `index.html` ??? cache-bust `app.js?v=79`

**Deploy:** Pi `git pull`. Hard refresh. Re-export 3MF.

### 2026-07-05 ??? Fat quarters: open-front bookcase preview

**What changed:** **Fat quarters** now builds an **open-front bookcase** (no front wall ??? like your reference), **front-facing camera**, **amber shelf** panels with edge lines. Still 300??135??400 mm, 3 tiers, horizontal shelves.

**Files:** `js/geometry.js`, `js/app.js`, `index.html` ??? cache-bust `app.js?v=78`

**Deploy:** Pi `git pull`. Hard refresh; turn off X-ray if shelves are hard to see.

### 2026-07-05 ??? Fat quarters: standing bookcase (horizontal shelves)

**What changed:** **Fat quarters** preset is now a **standing bookcase** ??? tall box with **2 horizontal shelves** (3 tiers), not a flat tray. New insert axis **Height ??? horizontal shelves**. Inner **300 ?? 135 ?? 400 mm** (~133 mm per tier for ~132 mm standing quarters).

**Files:** `js/features.js`, `js/geometry.js`, `js/app.js`, `index.html` ??? cache-bust `app.js?v=77`

**Deploy:** Pi `git pull`. Hard refresh on `/makerdeck/`. Print lying on back if build height is tight.

### 2026-07-05 ??? Fat quarters preset: bookcase (standing) layout

**What changed:** **Fat quarters** preset reworked for **bookcase storage** ??? quarters stand on edge (~8 mm thick), not flat. Inner **300 ?? 135 ?? 135 mm**, **1 divider** ??? two rows (~**148 ?? 134 mm** each, ~18 quarters per row). Insert tab shows bookcase hint on this preset.

**Files:** `js/geometry.js`, `js/app.js`, `index.html` ??? cache-bust `app.js?v=76`

**Deploy:** Pi `git pull`. Hard refresh on `/makerdeck/`.

### 2026-07-05 ??? Fat quarters preset tuned for real folded size

**What changed:** **Fat quarters** preset now uses **1 divider** (2 bays **~147 ?? 299 mm**) sized for **~130 ?? 132 ?? 8 mm** folded quarters. Inner height **45 mm** (~5 stacks at 8 mm); use the height slider for more.

**Files:** `js/geometry.js`, `js/app.js`, `index.html` ??? cache-bust `app.js?v=75`

**Deploy:** Pi `git pull`. Hard refresh on `/makerdeck/`.

### 2026-07-05 ??? Export dropdown, divider count, fat quarters preset

**What changed:**
- **Download** is now a format dropdown (default **3MF project**) + single Download button ??? extra formats (lid, accent, insert, deboss cutter, saucer) appear only when relevant.
- **Reset defaults** button is red normally, flashes green with ??? on success.
- **Insert** tab: divider **count** slider (1???4) splits the cavity into equal bays; hint shows compartments.
- New **Fat quarters** preset: 300??300??45 mm box, 1 divider (2 bays) for ~130??132??8 mm folded fabric.

**Files:** `js/app.js`, `js/features.js`, `js/geometry.js`, `index.html`, `css/style.css` ??? cache-bust `app.js?v=74`, `style.css?v=18`

**Deploy:** Pi `git pull`. Hard refresh on `/makerdeck/` (Ctrl+Shift+R).

### 2026-07-05 ??? Reset defaults button

**What changed:** **Reset defaults** in the top bar clears all settings back to the starter box (dimensions, colours, accent, insert, lid, art, etc.) and saves that as the new session. **Reset view** still only moves the camera.

**Files:** `js/app.js`, `index.html` ??? cache-bust `app.js?v=72`

**Deploy:** Pi `git pull`. Hard refresh on `/makerdeck/`.

### 2026-07-05 ??? Divider insert (half split)

**What changed:** New **Insert** tab ??? optional flat divider splits the cavity into two halves (length or depth). Separate **Insert** part in 3MF export (box filament). **Pencil box** preset enables it by default (length split).

**Files:** `js/features.js`, `js/geometry.js`, `js/app.js`, `js/stl.js`, `index.html` ??? cache-bust `app.js?v=71`

**Deploy:** Pi `git pull`. Hard refresh on `/makerdeck/`.

### 2026-07-05 ??? Fix Bambu 3MF auto filament assignment

**What changed:** **Download 3MF** now writes Bambu-compatible colour data ??? `Metadata/model_settings.config` as **XML** with per-object extruder slots (was JSON, which Bambu ignored), plus `paint_color` on every triangle so Body / Text / Accent import with the right filament without manual repainting.

**Files:** `js/3mf.js`, `js/app.js`, `index.html` ??? cache-bust `app.js?v=70`

**Deploy:** Pi `git pull`. Re-export 3MF and open in Bambu (fresh import, not merge into existing project).

### 2026-07-05 ??? Fix accent preview strobing (z-fight)

**What changed:** Accent band geometry sits **0.08 mm outside** the body shell so it no longer shares the same faces (classic z-fight flicker). Preview accent also skips shadow casting and uses depth bias toward the camera.

**Files:** `js/features.js`, `js/app.js`, `index.html` ??? cache-bust `app.js?v=69`

**Deploy:** Pi `git pull`. Hard refresh on `/makerdeck/`.

### 2026-07-05 ??? Preview matches customer 3MF colours

**What changed:** Viewport preview now mirrors what ships in **Download 3MF** ??? body and lid use the same box filament colour (was a hardcoded grey-blue lid), accent/text use their picker hex with matte PLA shading (no fake glow), deboss no longer shows a red dev overlay, and wireframe edges only appear in X-ray mode.

**Files:** `js/app.js`, `index.html` ??? cache-bust `app.js?v=68`

**Deploy:** Pi `git pull`. Hard refresh on `/makerdeck/` or `#/makerdeck`.

### 2026-07-05 ??? Accent bands follow profile + contrast picker

**What changed:** Accent bands (rim / front / floor) now **follow the box outline** ??? rounded pencil box corners curve with the body instead of a square axis-aligned skirt. **Floor stripe** is an outer base ring only (no solid fill slab). Preview accent has subtle emissive glow so it reads on the dark viewport. **Suggest contrast** picks a complementary filament swatch from the box colour.

**Files:** `js/features.js`, `js/geometry.js`, `js/color-picker.js`, `js/app.js`, `index.html`, `css/style.css` ??? cache-bust `app.js?v=67`, `style.css?v=17`

**Deploy:** Pi `git pull`. Hard refresh (`Ctrl+Shift+R`) on `/makerdeck/` or `#/makerdeck`. Backend restart not required.

### 2026-07-05 ??? MakerDeck tab inside Flightdeck

**What changed:** **MakerDeck** is now a sidebar page in Flightdeck (`#/makerdeck`) ??? no separate URL or port. Opens `/makerdeck/` in a full-height iframe on the same origin (Tailscale HTTPS works).

**Files:** `app/static/index.html`, `app/static/app.js?v=625`, `app/static/style.css?v=481`

**Deploy:** Pi `git pull` + **restart flightdeck.service** (Flightdeck static JS changed). MakerDeck iframe still uses `app.js?v=66`.

### 2026-07-05 ??? Restore text colour + L/C/R align (cache bust)

**What changed:** Text **colour** picker and **Left / Centre / Right** align stay visible with deboss on (align still positions multiline text). Full module cache-bust (`app.js?v=66`, `features.js?v=66`, `color-picker.js?v=66`, `style.css?v=16`) so Pi/browsers don't serve stale JS without the formatting UI.

**Files:** `js/app.js`, `js/3mf.js`, `index.html`

**Deploy:** Hard refresh (`Ctrl+Shift+R`) on `/makerdeck/`. Backend restart optional (static files).

### 2026-07-05 ??? Fix slide lid on pencil tube + grooves when lid off

**What changed:**
- **Channel slide** no longer offered on **pencil tube** (stadium ends) ??? rectangular slide lid/rails were the wrong shape; use slip-over or inset plug instead. **Pencil box** still supports channel slide.
- **Rail grooves** only carved into the body when **Enable lid** is on ??? turning the lid off no longer leaves square slider bumps on the case.

**Files:** `js/slide-lid.js`, `js/geometry.js`, `js/app.js`, `index.html` ??? `app.js?v=65`, `geometry.js?v=65`

**Deploy:** Hard refresh required. Backend restart not needed.

### 2026-07-05 ??? Fix 3MF export crash on multiline text

**What changed:** **Download 3MF** no longer throws `object null is not iterable` when exporting multiline label text (e.g. FAT / QUARTERS). Root cause was `repairNonManifoldFaces` in `stl.js` nulling a triangle mid-pass then dereferencing it on the same edge. STL export now has try/catch like 3MF.

**Files:** `js/stl.js`, `js/app.js`, `js/3mf.js`, `index.html` ??? `app.js?v=64`, `stl.js?v=64`

**Deploy:** Hard refresh required (Ctrl+Shift+R). Backend restart not needed.

### 2026-07-05 ??? Fix pencil box blank after preset switch (with text)

**What changed:** Switching pencil tube ??? pencil box with label text no longer wipes the viewport. Rebuild is serialized (no overlapping art-timer + preset rebuilds), pending art rebuilds cancel on preset change, lid+label children dispose cleanly, camera fit guards NaN.

**Files:** `js/app.js`, `js/geometry.js`, `index.html` ??? `app.js?v=63`

**Deploy:** Hard refresh required (Ctrl+Shift+R). Backend restart not needed.

### 2026-07-05 ??? Fix pencil preset switching blank viewport

**What changed:** Pencil tube / pencil box no longer bleed lid+slide state into each other. Rebuild validates new geometry before removing old preview. `PENCIL_PRESET` resets lid off + front face.

**Files:** `js/app.js`, `js/geometry.js`, `index.html` ??? `app.js?v=62`

### 2026-07-05 ??? Fix 3MF export, pencil box, text align

**What changed:**
- **3MF download** ??? replaced fflate CDN zip with built-in writer; guards null mesh indices (fixes "null is not iterable")
- **Pencil box** ??? `cornerRadius` now passed to geometry for `pencilBox` shape (was forced to 0); slide lid + rounded case work again
- **Text align** ??? Left / Centre / Right buttons on Art tab (multiline lines align within the block)

**Files:** `js/3mf.js`, `js/app.js`, `js/features.js`, `js/geometry.js`, `index.html`, `css/style.css` ??? `app.js?v=61`, `style.css?v=15`

### 2026-07-05 ??? Visual colour pickers + 3MF Orca export + multiline text

**What changed:**
- **Colour pickers** ??? swatch grid + hex chip (box, text, accent) instead of tiny native colour input
- **Download 3MF** ??? body / text / accent as separate objects with `filament_colour` for Orca; **Download STL** kept for single mesh
- **Multiline text** ??? textarea, Enter for new line (up to 4 lines)
- **Preview** ??? text shown as separate coloured mesh matching export slots
- **Pencil presets** ??? "Quick presets" heading + better camera framing for pencil tube/box

**Files:** `js/color-picker.js`, `js/3mf.js`, `js/app.js`, `js/features.js`, `js/geometry.js`, `js/art-editor.js`, `index.html`, `css/style.css` ??? cache-bust `app.js?v=60`, `style.css?v=14`

**Deploy:** Pi `git pull` + hard refresh.

### 2026-07-05 ??? Box preview colour picker

**What changed:** Design tab ??? **Preview colour** ??? **Box** colour picker. Updates the 3D preview body material; saved in session like accent colour. STL export unchanged (pick filament in slicer).

**Files:** `js/geometry.js`, `js/app.js`, `index.html` ??? cache-bust `app.js?v=59`

**Deploy:** Pi `git pull` + hard refresh (UI-only; restart optional).

### 2026-07-05 ??? Watertight STL export for embossed text

**What changed:** Download box now rebuilds a **watertight export mesh** ??? solid wall behind letters, closed letter solids, overlapping wall tris stripped under ink. STL pass welds verts + peels non-manifold faces. Preview unchanged.

**Files:** `js/features.js`, `js/stl.js`, `js/app.js`, `index.html` ??? cache-bust `app.js?v=58`

### 2026-07-05 ??? Revert cut-through emboss (restore raised letters)

**What changed:** Rolled back the "punch holes in wall" manifold experiment ??? it cut straight through the box. Text is **raised emboss** again: flush with the wall, top cap + side walls only (no bottom cap duplicating the face).

**Files:** `js/features.js`, `js/geometry.js`, `index.html`

- STL export still welds vertices / drops duplicate tris (may reduce Orca warnings vs before).
- Cache-bust: `app.js?v=57`

### 2026-07-05 ??? Manifold STL export (Orca non-manifold fix)

**What changed:** Text emboss is now **integrated into the shell face** (punch holes + shared edges) instead of stacking two meshes. STL export also welds nearby vertices and drops duplicate triangles.

**Files:** `js/features.js`, `js/contour.js`, `js/geometry.js`, `js/stl.js`, `index.html`

- Side-face text (front/back/left/right/top) builds one watertight mesh ??? no 400+ non-manifold edges in Orca.
- Lid / joiner / trace art still use the legacy merge + weld fallback.
- Cache-bust: `app.js?v=56`

**Deploy:** Pi `git pull` + hard refresh.

### 2026-07-05 ??? Live text art (no bounding box)

**What changed:** Removed the misaligned viewport bounding box and draft/Apply workflow. Text edits go straight to the box mesh ??? type, adjust Size / Move / Rotation sliders, done.

**Files:** `index.html`, `css/style.css`, `js/app.js`, `js/art-editor.js`

- Removed `#art-overlay` handles and all overlay JS/CSS.
- Removed **Apply to box** / **Cancel** ??? text updates live via debounced rebuild.
- Added **Move left/right** and **Move up/down** sliders (`decorOffsetX/Y`).
- Fixed text vanishing after apply: body preview now uses merged mesh when emboss is on a body face.
- Cache-bust: `app.js?v=55`

**Deploy:** `git pull` on Pi ??? static files only; hard refresh (`Ctrl+Shift+R`).

### 2026-07-04 fix (blank preview on Pi)

**`js/app.js`** ??? moved stray `import` to top of module (mid-file import caused SyntaxError; JS never ran).
- Prior: `734b8e9` ??? trace autosave; `e91f615` ??? full MakerDeck MVP

### URLs

- **Pi / Tailscale:** `https://flightdeck.tail7de73e.ts.net/makerdeck/`
- **Local dev server:** `http://localhost:8765` (`cd makerforge && python -m http.server 8765`)
- **Local Flightdeck:** `http://localhost:8000/makerdeck/` (after backend restart)

**Hard refresh** (`Ctrl+Shift+R`) after pulling JS changes. No cache-bust on `js/app.js`; Flightdeck serves with `no-store`.

### 2026-07-04 ??? Import QoL + autosave

**Files:** `index.html`, `css/style.css`, `js/app.js`, `js/trace.js`

- **Paste** ??? Ctrl+V on Import tab loads clipboard images into trace pipeline.
- **Clear from box** ??? removes applied trace emboss without hard refresh.
- **Undo / redo** ??? ??? ??? (or Ctrl+Z / Ctrl+Y) for apply vs clear on the box.
- **Session autosave** ??? box settings, applied trace, and import image saved to `localStorage` (`makerdeck-session-v1`); survives refresh.
- Served at `/makerdeck/` via `app/main.py` static mount ??? **backend restart required** after deploy.

### Working features

- Shapes: rect, rounded, hex, circle, pencil/teardrop/star/heart presets
- Lid, link joiner, accent stripe, honeycomb, stackable feet
- Label tab: text emboss, SVG upload
- Import tab: image ??? silhouette/outline trace ??? emboss on front face
- STL export (body, lid, accent)

### Known / later

- Preview rougher than Bambu slice at small art sizes
- Deboss (cut inward) not built yet
- Face picker for emboss (front/back/side) not built yet
- No Pi-hosted URL yet ??? local dev only

## b502 — Wireframe Overlay + Symmetry Painting + Clear Model Fix

### Changes
- **Box select now feeds into selection** instead of auto-painting — drag a box, then choose Paint Selection or Hide Selection
- Enables hiding arbitrary regions on solid (single-island) meshes — drag over the beard, Hide, paint behind it, Show when done
- Box tool now shows the selection panel (Paint Selection / Hide Selection / Clear / Show Hidden)
- Switching to box tool preserves existing selection
- Updated hint text for box tool
- Build number synced across MakerDeck and STL Painter (b503)

### Workflow for solid models
1. Select the **Box** tool, enable **Lock**
2. Drag a rectangle over the area you want to hide (e.g. beard, hat brim)
3. Click **Hide Selection** — those faces disappear
4. Paint the area behind them
5. Click **Show** to bring hidden faces back
6. Export as normal — all faces included in the 3MF

---
