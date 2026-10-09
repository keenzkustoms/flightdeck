#!/usr/bin/env bash
# MakerDeck geometry regression tests.
# Stages ../js into ./_staged with import specifiers rewritten for Node
# (strips ?v= cache-busts, points earcut at the local dep), then runs the checks.
# Usage:  cd makerforge/test && ./run.sh
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
cd "$here"
rm -rf _staged && mkdir _staged
cp ../js/*.js _staged/
# rewrite ./mod.js?v=NNN -> ./mod.js, and CDN imports -> bare specifiers resolved from node_modules
sed -i 's/from "\.\/\([a-z0-9-]*\)\.js?v=[0-9]*"/from ".\/\1.js"/g; s|from "https://esm.sh/earcut@2.2.4"|from "earcut"|; s|from "https://cdn.jsdelivr.net/npm/manifold-3d@[0-9.]*/manifold.js"|from "manifold-3d"|' _staged/*.js
{ [ -d node_modules/earcut ] && [ -d node_modules/manifold-3d ]; } || npm install --silent >/dev/null 2>&1
status=0
node manifold.mjs || status=1
node chop-manifold.mjs || status=1
node painter-art.mjs || status=1
node h2c-3mf.mjs || status=1
exit $status
