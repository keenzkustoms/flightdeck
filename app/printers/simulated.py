from __future__ import annotations

from datetime import datetime, timezone
from hashlib import sha1

from ..models import JobStatus, PrinterStatus, TempReading


_PROFILES = {
    "prusalink": {
        "kind": "prusalink",
        "file": "Prusa_gearbox_cover_0.20mm_PETG.bgcode",
        "material": "PETG",
        "idle": "PrusaLink ready",
        "control": "PrusaLink simulator",
    },
    "reprap": {
        "kind": "reprap",
        "file": "Kobra_panel_clip_PLA.gcode",
        "material": "PLA",
        "idle": "RepRapFirmware ready",
        "control": "RepRapFirmware simulator",
    },
    "octoprint": {
        "kind": "octoprint",
        "file": "benchy_quality_check.gcode",
        "material": "PLA",
        "idle": "OctoPrint ready",
        "control": "OctoPrint simulator",
    },
}


def _seed_int(value: str) -> int:
    return int(sha1(value.encode("utf-8")).hexdigest()[:8], 16)


def _scenario_state(printer_id: str, scenario: str) -> str:
    if scenario != "mixed":
        return scenario
    cycle = ("idle", "printing", "printing", "paused", "idle", "error")
    slot = (int(datetime.now(timezone.utc).timestamp()) // 90 + _seed_int(printer_id)) % len(cycle)
    return cycle[slot]


def status(
    printer_id: str,
    model_name: str,
    custom_name: str,
    icon: str,
    profile: str = "prusalink",
    scenario: str = "mixed",
) -> PrinterStatus:
    meta = _PROFILES.get(profile, _PROFILES["prusalink"])
    state = _scenario_state(printer_id, scenario)
    now = datetime.utcnow()

    base = _seed_int(f"{printer_id}:{profile}")
    progress = ((int(datetime.now(timezone.utc).timestamp()) // 6 + base) % 100) / 100
    if state in {"idle", "error"}:
        progress = 0.0
    elif state == "paused":
        progress = max(0.18, min(progress, 0.82))
    else:
        progress = max(0.03, progress)

    job = None
    if state in {"printing", "paused", "error"}:
        total_layers = 180 if profile == "prusalink" else 220 if profile == "reprap" else 140
        current_layer = max(1, min(total_layers, int(total_layers * progress)))
        eta = int((1 - progress) * (4.5 * 3600)) if state == "printing" else None
        job = JobStatus(
            filename=meta["file"],
            progress=progress,
            eta_seconds=eta,
            layer_current=current_layer,
            layer_total=total_layers,
            subtask_name=meta["file"].replace(".gcode", "").replace(".bgcode", ""),
        )

    hot_target = 245 if meta["material"] == "PETG" else 215
    bed_target = 85 if meta["material"] == "PETG" else 60
    temps = {
        "hotend": TempReading(
            actual=hot_target - 4 if state in {"printing", "paused"} else 32 + base % 6,
            target=hot_target if state in {"printing", "paused"} else 0,
        ),
        "bed": TempReading(
            actual=bed_target - 2 if state in {"printing", "paused"} else 27 + base % 4,
            target=bed_target if state in {"printing", "paused"} else 0,
        ),
    }

    idle_info = {
        "Simulator": meta["idle"],
        "Connector": meta["control"],
    }
    if state == "idle":
        idle_info["Last print"] = "simulated calibration cube - 42m"

    maintenance = []
    if profile == "prusalink":
        maintenance.append({
            "id": "sim:prusa-nozzle",
            "code": "nozzle",
            "title": "Inspect nozzle",
            "source": "simulator",
            "state": "ok",
            "is_due": False,
            "detail": "Synthetic PrusaLink care item",
        })
    elif profile == "reprap":
        maintenance.append({
            "id": "sim:rrf-belts",
            "code": "belts",
            "title": "Check belt tension",
            "source": "simulator",
            "state": "due",
            "is_due": True,
            "detail": "Synthetic RepRapFirmware care item",
        })

    return PrinterStatus(
        id=printer_id,
        model_name=model_name,
        custom_name=custom_name,
        icon=icon,
        kind=meta["kind"],
        state=state,
        temps=temps,
        job=job,
        idle_info=idle_info,
        maintenance=maintenance,
        error="Simulated recoverable printer fault" if state == "error" else None,
        last_seen=now,
        updated_at=now,
    )
