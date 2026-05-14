from __future__ import annotations
import logging
import threading
from datetime import datetime, timezone, timedelta
from typing import Optional

import bambulabs_api as bl

from .. import db
from ..models import PrinterStatus, JobStatus, TempReading

log = logging.getLogger(__name__)

FINISHED_TTL = timedelta(minutes=30)


class BambuPrinter:
    """Wraps a bambulabs_api.Printer with persistent MQTT connection.
    Status reads are non-blocking; state transitions persist to SQLite."""

    def __init__(self, id: str, model_name: str, custom_name: str, icon: str,
                 ip: str, access_code: str, serial: str):
        self.id = id
        self.model_name = model_name
        self.custom_name = custom_name
        self.icon = icon
        self._ip = ip
        self._access_code = access_code
        self._printer = bl.Printer(ip_address=ip, access_code=access_code, serial=serial)
        self._lock = threading.Lock()
        self._connected = False
        self._preview_cache: tuple[str, object] | None = None
        self._seen_finish_this_session = False
        self._current_job_key: Optional[str] = None

    def start(self) -> None:
        self._printer.connect()
        self._connected = True
        log.info("Bambu MQTT connected: %s", self.model_name)

    def stop(self) -> None:
        try:
            self._printer.disconnect()
        except Exception:
            pass
        self._connected = False

    def status(self) -> PrinterStatus:
        if not self._connected:
            return PrinterStatus(id=self.id, model_name=self.model_name,
                                 custom_name=self.custom_name, icon=self.icon,
                                 kind="bambu", state="offline", error="not connected")
        try:
            raw_state = self._printer.get_state()
            substage_raw = self._printer.get_current_state()
            substage = substage_raw.value if substage_raw is not None else None

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
            subtask = self._printer.subtask_name() or None
            if filename and pct is not None:
                remaining = self._printer.get_time()
                eta = int(remaining * 60) if remaining is not None else None
                job = JobStatus(
                    filename=filename,
                    progress=float(pct) / 100.0,
                    eta_seconds=eta,
                    layer_current=self._printer.current_layer_num(),
                    layer_total=self._printer.total_layer_num(),
                    subtask_name=subtask,
                )

            state = self._resolve_state(raw_state, job, subtask)

            idle_info: dict[str, str] = {}
            if state == "idle":
                last = db.get_last_print(self.id)
                if last:
                    idle_info["Last print"] = _fmt_last_print(last)

            now = datetime.utcnow()
            self._last_seen = now
            return PrinterStatus(
                id=self.id, model_name=self.model_name, custom_name=self.custom_name,
                icon=self.icon, kind="bambu", state=state,
                temps=temps, job=job, substage=substage,
                idle_info=idle_info, last_seen=now, updated_at=now,
            )
        except Exception as exc:
            return PrinterStatus(id=self.id, model_name=self.model_name,
                                 custom_name=self.custom_name, icon=self.icon,
                                 kind="bambu", state="error", error=str(exc))

    def _resolve_state(self, raw: bl.GcodeState, job: Optional[JobStatus],
                       subtask: Optional[str]) -> str:
        now = datetime.now(timezone.utc)

        if raw == bl.GcodeState.FINISH:
            self._seen_finish_this_session = True
            if self._current_job_key:
                db.on_print_finished(
                    self.id, self._current_job_key,
                    layers_completed=job.layer_current if job else None,
                )
                self._current_job_key = None
            finished_at = db.get_finished_at(self.id)
            if finished_at is None:
                finished_at = now
                db.set_finished_at(self.id, finished_at)
            if (now - finished_at.replace(tzinfo=timezone.utc)) > FINISHED_TTL:
                db.clear_finished_at(self.id)
                return "idle"
            return "finished"

        if raw == bl.GcodeState.IDLE:
            if self._seen_finish_this_session:
                db.clear_finished_at(self.id)
                self._seen_finish_this_session = False
                self._current_job_key = None
                return "idle"
            # Close any open row — covers both in-session interrupts and restart-then-IDLE
            job_key = self._current_job_key or self._make_job_key(subtask)
            if job_key:
                db.on_print_ended(
                    self.id, job_key,
                    final_state="ERROR",
                    layers_completed=job.layer_current if job else None,
                    error_message="Connection lost mid-print",
                )
            self._current_job_key = None
            finished_at = db.get_finished_at(self.id)
            if finished_at is not None:
                if (now - finished_at.replace(tzinfo=timezone.utc)) <= FINISHED_TTL:
                    return "finished"
                db.clear_finished_at(self.id)
            return "idle"

        if raw in (bl.GcodeState.RUNNING, bl.GcodeState.PREPARE):
            db.clear_finished_at(self.id)
            self._seen_finish_this_session = False
            if self._current_job_key is None:
                self._current_job_key = self._make_job_key(subtask)
                db.on_print_started(
                    self.id,
                    self._current_job_key,
                    job.filename if job else "",
                    subtask_name=subtask,
                    layers_total=job.layer_total if job else None,
                )
            return "printing"

        if raw == bl.GcodeState.PAUSE:
            return "paused"

        if raw == bl.GcodeState.FAILED:
            db.clear_finished_at(self.id)
            # Use current key if we have it; fall back to reconstructing from MQTT
            # (covers the case where service restarted and printer was already FAILED)
            job_key = self._current_job_key or self._make_job_key(subtask)
            if job_key:
                err_code = self._printer.mqtt_dump().get("print", {}).get("print_error", 0)
                err_msg = f"Error code {err_code}" if err_code else "Unknown error"
                db.on_print_ended(
                    self.id, job_key,
                    final_state="ERROR",
                    layers_completed=job.layer_current if job else None,
                    error_message=err_msg,
                )
            self._current_job_key = None
            return "error"

        return "offline"  # UNKNOWN or anything unexpected

    def _make_job_key(self, subtask: Optional[str]) -> str:
        dump = self._printer.mqtt_dump().get("print", {})
        task_id = dump.get("task_id") or dump.get("subtask_id")
        if task_id:
            return str(task_id)
        if subtask:
            return subtask
        return f"bambu@{int(datetime.utcnow().timestamp())}"

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
            log.warning("FTP preview failed for %s: %s", self.model_name, exc)
            return None


def _fmt_last_print(row: dict) -> str:
    """Format the last print row for display in the idle card."""
    name = row.get("subtask_name") or (row.get("filename") or "").split("/")[-1]
    state = row.get("final_state", "")
    layers_done = row.get("layers_completed")
    layers_total = row.get("layers_total")
    dur = row.get("duration_seconds")

    pct_str = ""
    if layers_done is not None and layers_total:
        pct_str = f" at {int(layers_done / layers_total * 100)}%"

    if state == "FINISHED":
        if dur:
            h, m = dur // 3600, (dur % 3600) // 60
            return f"{name} · {h}h {m}m" if h else f"{name} · {m}m"
        return name
    if state == "CANCELLED":
        return f"{name} · cancelled{pct_str}"
    if state == "ERROR":
        return f"{name} · failed{pct_str}"
    return name
