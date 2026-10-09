# Windows Slicer Worker and Browser Slicers

Flightdeck can run on a Pi while using a Windows PC for slicer handoff. This is useful when OrcaSlicer, Bambu Studio, Docker Desktop, and the browser slicer containers live on Windows.

## What Each Piece Does

| Component | Purpose |
| --- | --- |
| Desktop Orca worker | Opens a model in the installed Windows OrcaSlicer app |
| Browser Orca | Docker/browser OrcaSlicer, usually `https://127.0.0.1:3011` |
| Browser Bambu Studio | Docker/browser Bambu Studio, usually `https://127.0.0.1:3012` |
| Slicer API sidecar | Optional background `/slice` API, usually `http://127.0.0.1:3003` |

The Pi cannot restart Docker Desktop on Windows by itself. If Docker Desktop sleeps or crashes, Flightdeck can show the slicer health failure but the Windows host has to bring the containers back.

## Browser Slicers

On the Windows machine, run:

```powershell
.\Start-Flightdeck-Slicers-Windows.cmd
```

Or run the helper directly:

```powershell
.\scripts\windows\start-slicer-browsers.ps1
```

It starts or repairs:

```text
https://127.0.0.1:3011  OrcaSlicer
https://127.0.0.1:3012  Bambu Studio
```

Default login:

```text
flightdeck / flightdeck
```

The containers use the Flightdeck Print Vault as `/prints`.

## Configure Flightdeck

In Flightdeck:

```text
System -> Settings -> Slicer
```

Set:

- Browser Orca URL.
- Bambu Studio URL.
- Desktop Orca worker URL, if using desktop handoff.
- Slicer API URL, if using background slicing.

Then click:

```text
Check all
```

All configured services should show reachable before testing model handoff.

## Common Failure Modes

### Browser slicer opens but the model is missing

The browser URL opened, but model injection failed.

Likely causes:

- Windows worker is not running.
- Docker Desktop is asleep.
- The Orca/Bambu container stopped.
- The `/prints` mount is not available.

Run the Windows helper again and use `Check all`.

### `Slicer API offline`

The optional sidecar on port `3003` is not reachable.

Start the sidecar process or switch Flightdeck to manual slicer review.

### Self-signed HTTPS warning

The browser slicers use self-signed HTTPS. Open the URL once and accept the browser warning on your trusted LAN/tailnet.

## Repair Commands

Check only:

```powershell
.\scripts\windows\start-slicer-browsers.ps1 -CheckOnly
```

Recreate containers while keeping config and print vault:

```powershell
.\scripts\windows\start-slicer-browsers.ps1 -Force
```

Start only Orca:

```powershell
.\scripts\windows\start-slicer-browsers.ps1 -OrcaOnly
```

Start only Bambu Studio:

```powershell
.\scripts\windows\start-slicer-browsers.ps1 -BambuOnly
```

Install Docker Desktop with winget when available:

```powershell
.\scripts\windows\start-slicer-browsers.ps1 -InstallDockerDesktop
```

## Beta Recommendation

For first beta testers, use manual slicer review first. Once printer, spool, and queue flows are proven, add browser slicers and background slicing.
