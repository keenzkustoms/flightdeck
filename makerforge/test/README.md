# MakerDeck geometry tests

Regression guard for the b371–b378 non-manifold work. Every part that ships in a
3MF (container Body/Art/Text, lid, liner) must be watertight after the same
`prepareMeshFor3mf` pass the real export uses.

## Run

    cd makerforge/test
    ./run.sh

`run.sh` stages `../js` into `./_staged` (strips `?v=` cache-busts, points earcut
at the local dep), then runs `manifold.mjs`. Exit 0 = pass, 1 = a core regression.

## What's covered

Core (fail the run): flat-face line-art trace, multi-colour B&W AMS layers, text
export, non-stacking container body, liner, gasket lid, and H2C's linked
body/red/black volume export (including the left/right filament maps).

Advisory (WARN only): stackable-lip geometry (nest + hex). These are **known
non-manifold** as of 2026-07-16 — nest lid rim ~168 open edges, hex feet/pockets
~3076 body / 16 lid. Fix pending with print-fit validation (see SESSION_NEXT).
