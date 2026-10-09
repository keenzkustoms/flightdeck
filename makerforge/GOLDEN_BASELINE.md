# MakerDeck golden baseline — DO NOT REGRESS

**Locked:** 2026-07-11  
**Build tag:** `b284`  
**Git tag:** `makerdeck-golden-b284` (create after commit: `git tag -a makerdeck-golden-b284 -m "Golden: b278 emboss + b284 trace preview"`)

Chris confirmed this state works. Before changing trace or emboss/wrap paths, read this file.

---

## What works (verified)

| Asset | Container | Face | Mode | Result |
|-------|-----------|------|------|--------|
| Coffee bag PNG | Jar / box | Front | Auto | Full cyan ink overlay in trace preview; clean line-art emboss |
| Knight / heraldic PNG | Jar | Front | Silhouette / Auto | Solid silhouette emboss |
| broncs.svg | Jar | Front | Silhouette | Clean shield + text islands |
| Same assets | Cooler | Wrap | — | Test jar first; wrap is separate (known hard path) |

---

## Golden code anchors

| Area | Baseline | Notes |
|------|----------|-------|
| **Trace auto + line art** | `ad24606` (b278) in `trace.js` | Auto picks `outlineRaster` ink mask, not silhouette blob |
| **Trace preview overlay** | b284 `drawTracePreview` | Ink mask **before** stroke paths; `outlineRaster` never uses centerline stroke preview |
| **Emboss / wrap extrude** | `ad24606` (b278) in `features.js` | `buildEmbossBitmap` + `extrudeGroupsOnFace` — no island merge, no b279–b282 wrap experiments |

### Files that must stay aligned

- `js/trace.js` — especially `drawTracePreview`, `finishRasterInkTrace`, `chooseAutoTraceResult`
- `js/features.js` — especially `buildEmbossBitmap`, `buildWrapTraceSlabMesh`, `extrudeGroupsOnFace`
- `js/app.js` — `MAKERDECK_BUILD`, import cache-bust versions

---

## Trace preview rule (b284)

When meta says **`line art mask · N ink runs · mask X% fill`**:

- Preview must fill **every ink pixel** cyan (dimmed source underneath).
- Must **NOT** draw thin centerline strokes only.
- Code path: `resolveTracePreviewMask` → `drawTraceInkMaskOverlay` before any `strokePaths` branch.

---

## Emboss rule (b278)

- **Trace = container** — cyan overlay in preview is what embosses.
- Line art: `outlineRaster` → full ink pixel mask extrude.
- Silhouettes: per-island contour on flat faces; wrap uses simple-solid contour or art slabs (b278 logic).
- **Do not** re-add `mergeWrapSolidLogoGroups` (b279 broke heraldic logos into shards).

---

## Safe test order after any change

1. Hard refresh — check header matches `MAKERDECK_BUILD`
2. **Jar/box + front face** — coffee bag Auto (line art) ← default baseline
3. **Jar + front face** — knight PNG (silhouette)
4. Only then — cooler **wrap** (now uses ink mask slabs like coffee bag, b285)

If jar/front breaks, revert emboss/trace changes before chasing wrap.

---

## Commits to avoid replaying without jar tests

- `8dd3dd4` b279 — merge wrap islands → broken shards
- `666b18f` b280 — opts bug (blank wrap)
- `cc82d9f` / `6907325` b281–b282 — scan lines / per-island wrap churn

---

## Restore to golden

```powershell
cd C:\Users\Kidabah\flightdeck
git checkout makerdeck-golden-b284 -- makerforge/js/trace.js makerforge/js/features.js
# Then bump build tag, cache-bust, commit, push, Pi deploy
```

Or full tree: `git checkout makerdeck-golden-b284 -- makerforge/`
