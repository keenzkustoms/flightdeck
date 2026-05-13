from __future__ import annotations
import asyncio
import logging
import threading
from typing import Optional
import bambulabs_api as bl
from ..models import PrinterStatus, JobStatus, TempReading
from datetime import datetime

log = logging.getLogger(__name__)


class BambuPrinter:
    """Wraps a bambulabs_api.Printer, maintaining a persistent MQTT connection.
    Status is cached in memory; reads are non-blocking."""

    def __init__(self, id: str, name: str, ip: str, access_code: str, serial: str):
        self.id = id
        self.name = name
        self._ip = ip
        self._access_code = access_code
        self._printer = bl.Printer(ip_address=ip, access_code=access_code, serial=serial)
        self._lock = threading.Lock()
        self._connected = False
        self._preview_cache: tuple[str, object] | None = None  # (subtask_name, BambuPreview)

    def start(self) -> None:
        self._printer.connect()
        self._connected = True
        log.info("Bambu MQTT connected: %s", self.name)

    def stop(self) -> None:
        try:
            self._printer.disconnect()
        except Exception:
            pass
        self._connected = False

    def status(self) -> PrinterStatus:
        if not self._connected:
            return PrinterStatus(id=self.id, name=self.name, kind="bambu", state="offline",
                                 error="not connected")
        try:
            raw_state = self._printer.get_state()
            state = _map_state(raw_state)

            temps: dict[str, TempReading] = {}
            nozzle = self._printer.get_nozzle_temperature()
            bed = self._printer.get_bed_temperature()
            chamber = self._printer.get_chamber_temperature()
            if nozzle is not None:
                temps["hotend"] = TempReading(actual=float(nozzle), target=0.0)
            if bed is not None:
                temps["bed"] = TempReading(actual=float(bed), target=0.0)
            if chamber is not None:
                temps["chamber"] = TempReading(actual=float(chamber), target=0.0)

            job = None
            filename = self._printer.get_file_name()
            pct = self._printer.get_percentage()
            if filename and pct is not None:
                remaining = self._printer.get_time()
                eta = int(remaining * 60) if remaining is not None else None
                layer_cur = self._printer.current_layer_num()
                layer_tot = self._printer.total_layer_num()
                job = JobStatus(
                    filename=filename,
                    progress=float(pct) / 100.0,
                    eta_seconds=eta,
                    layer_current=layer_cur,
                    layer_total=layer_tot,
                )

            return PrinterStatus(
                id=self.id, name=self.name, kind="bambu", state=state,
                temps=temps, job=job, updated_at=datetime.utcnow(),
            )
        except Exception as exc:
            return PrinterStatus(id=self.id, name=self.name, kind="bambu",
                                 state="error", error=str(exc))


    def get_preview(self):
        """Return cached BambuPreview, fetching via FTP if the job changed."""
        if not self._connected:
            return None
        subtask = self._printer.subtask_name()
        if not subtask:
            return None
        if self._preview_cache and self._preview_cache[0] == subtask:
            return self._preview_cache[1]
        try:
            from .bambu_ftp import fetch_bambu_preview
            preview = fetch_bambu_preview(self._ip, self._access_code, subtask)
            self._preview_cache = (subtask, preview)
            return preview
        except Exception as exc:
            log.warning("FTP preview failed for %s: %s", self.name, exc)
            return None


def _map_state(raw) -> str:
    import bambulabs_api as bl
    _map = {
        bl.GcodeState.RUNNING: "printing",
        bl.GcodeState.PREPARE: "printing",
        bl.GcodeState.PAUSE:   "paused",
        bl.GcodeState.FINISH:  "idle",
        bl.GcodeState.IDLE:    "idle",
        bl.GcodeState.FAILED:  "error",
        bl.GcodeState.UNKNOWN: "offline",
    }
    return _map.get(raw, "offline")
