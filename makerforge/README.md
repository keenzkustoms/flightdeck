# MakerDeck

Standalone parametric container generator with live 3D preview and STL export.

Served by Flightdeck at **`/makerdeck/`** (Pi: `https://flightdeck.tail7de73e.ts.net/makerdeck/`). Requires a **backend restart** after deploy.

## Run locally

From this folder, serve the static files (ES modules need HTTP, not `file://`):

```bash
# Python
python -m http.server 8765

# or Node
npx serve .
```

Open [http://localhost:8765](http://localhost:8765) — or run Flightdeck and use [http://localhost:8000/makerdeck/](http://localhost:8000/makerdeck/) if the app is up locally.

## MVP features

- **Shapes:** rectangular box, rounded box, hexagonal container
- **Sliders:** inner size, wall thickness, floor thickness, corner radius (rounded)
- **Live preview:** Three.js orbit/zoom on a virtual bed
- **Export:** binary STL download with sensible filename

## Roadmap (later)

- Slip / snap lids
- Vase profile editor (revolve)
- Batch “set of N boxes”
- Quote PDF / email share link
- Flightdeck hook: slice → queue → dispatch

## Stack

Vanilla HTML/CSS/JS, Three.js (CDN), no build step.
