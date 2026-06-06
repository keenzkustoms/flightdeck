from __future__ import annotations
import json
import logging
import re
import threading
import time
from datetime import datetime, timezone, timedelta
from typing import Optional

import bambulabs_api as bl
from bambulabs_api.filament_info import AMSFilamentSettings
from bambulabs_api.mqtt_client import PrinterMQTTClient

from .. import db
from ..models import PrinterStatus, JobStatus, TempReading

log = logging.getLogger(__name__)

FINISHED_TTL = timedelta(minutes=30)
_BAMBU_PREVIEW_FAILED = object()  # sentinel: FTP failed, don't retry until job changes
_BAMBU_STALE_REPORT_SECONDS = 45
_BAMBU_CARE_LABELS = {
    "cr": "Clean carbon rods",
    "ls": "Lubricate lead screws",
    "lr": "Lubricate linear rails",
    "ld": "Clean build plate",
    "hr": "Clean hotend/nozzle",
    "pt": "Check PTFE tube",
    "bt": "Check belt tension",
}
_BAMBU_PROFILE_ALIASES = {
    "P461bccf": {
        "brand": "Siddament",
        "profile": "Siddament ASA",
        "material": "ASA",
        "tray_info_idx": "P461bccf",
        "tray_type": "ASA",
        "nozzle_temp_min": 240,
        "nozzle_temp_max": 280,
    },
    "GFB98": {
        "brand": "Generic",
        "profile": "Generic ASA",
        "material": "ASA",
        "tray_info_idx": "GFB98",
        "tray_type": "ASA",
        "nozzle_temp_min": 240,
        "nozzle_temp_max": 270,
    },
    "GFB01": {
        "brand": "Bambu Lab",
        "profile": "Bambu ASA",
        "material": "ASA",
        "tray_info_idx": "GFB01",
        "tray_type": "ASA",
        "nozzle_temp_min": 240,
        "nozzle_temp_max": 270,
    },
    "GFL99": {
        "brand": "Generic",
        "profile": "Generic PLA",
        "material": "PLA",
        "tray_info_idx": "GFL99",
        "tray_type": "PLA",
        "nozzle_temp_min": 190,
        "nozzle_temp_max": 250,
    },
    "GFA00": {
        "brand": "Bambu Lab",
        "profile": "Bambu PLA Basic",
        "material": "PLA",
        "tray_info_idx": "GFA00",
        "tray_type": "PLA",
        "nozzle_temp_min": 190,
        "nozzle_temp_max": 250,
    },
    "GFG99": {
        "brand": "Generic",
        "profile": "Generic PETG",
        "material": "PETG",
        "tray_info_idx": "GFG99",
        "tray_type": "PETG",
        "nozzle_temp_min": 220,
        "nozzle_temp_max": 260,
    },
    "GFU99": {
        "brand": "Generic",
        "profile": "Generic TPU",
        "material": "TPU",
        "tray_info_idx": "GFU99",
        "tray_type": "TPU",
        "nozzle_temp_min": 200,
        "nozzle_temp_max": 250,
    },
}


class _SequencedMQTTClient(PrinterMQTTClient):
    """Injects an incrementing sequence_id into every command payload.

    Firmware >= 1.08 silently drops commands that lack this field.
    The base class name-mangles __publish_command to
    _PrinterMQTTClient__publish_command; defining that literal name here
    intercepts all base-class calls via MRO before they reach the original.
    """

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._seq = 0
        self._last_report_monotonic = 0.0
        self._last_report_wall: datetime | None = None

    def manual_update(self, doc: dict) -> None:
        self._last_report_monotonic = time.monotonic()
        self._last_report_wall = datetime.utcnow()
        return super().manual_update(doc)

    def report_age_seconds(self) -> float | None:
        if not self._last_report_monotonic:
            return None
        return time.monotonic() - self._last_report_monotonic

    def last_report_wall(self) -> datetime | None:
        return self._last_report_wall

    # Intercepts every self.__publish_command(...) call made by the base class.
    def _PrinterMQTTClient__publish_command(self, payload: dict) -> bool:
        self._seq += 1
        seq = str(self._seq)
        for v in payload.values():
            if isinstance(v, dict):
                v['sequence_id'] = seq
        return super()._PrinterMQTTClient__publish_command(payload)

    def start_print_3mf(self, filename: str,
                        plate_number: int | str,
                        use_ams: bool = True,
                        ams_mapping: list[int] = [0],
                        skip_objects: list[int] | None = None,
                        flow_calibration: bool = True,
                        ) -> bool:
        """Start a 3MF with BambuStudio-style AMS mapping fields.

        bambulabs_api 2.6.6 only sends the legacy flat ams_mapping. Newer Bambu
        firmware, especially H2D with AMS 2 / AMS HT, expects ams_mapping2 as
        well or it can pause with 0700-8012 "Failed to get AMS mapping table".
        """
        if skip_objects is not None and not skip_objects:
            skip_objects = None

        if isinstance(plate_number, int):
            plate_location = f"Metadata/plate_{int(plate_number)}.gcode"
        else:
            plate_location = plate_number

        flat_mapping, detailed_mapping = _build_bambu_ams_mappings(ams_mapping)
        use_ams_flag = bool(use_ams)
        if ams_mapping and use_ams_flag:
            if all(t is None or int(t) < 0 or int(t) >= 254 for t in ams_mapping):
                use_ams_flag = False

        return self._PrinterMQTTClient__publish_command({
            "print": {
                "command": "project_file",
                "param": plate_location,
                "file": filename,
                "bed_leveling": True,
                "bed_type": "textured_plate",
                "flow_cali": bool(flow_calibration),
                "vibration_cali": True,
                "url": f"ftp:///{filename}",
                "layer_inspect": False,
                "sequence_id": "10000000",
                "use_ams": use_ams_flag,
                "ams_mapping": flat_mapping,
                "ams_mapping2": detailed_mapping,
                "skip_objects": skip_objects,
            }
        })


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
        self._printer.mqtt_client = _SequencedMQTTClient(ip, access_code, serial)
        self._lock = threading.Lock()
        self._connected = False
        self._last_seen: datetime | None = None
        self._preview_cache: tuple[str, object] | None = None
        self._seen_finish_this_session = False
        self._current_job_key: Optional[str] = None
        self._error_job_key: Optional[str] = None  # job_key of active in-session error
        self._error_seen_at: float = 0.0
        self._cancel_requested = False
        self._estimated_stored = False   # True once slicer estimate written for this job
        self._job_started_at: float = 0.0  # monotonic time when _current_job_key was set
        self._current_print_id: Optional[int] = None  # prints.id for the active job
        self._error_print_id: Optional[int] = None    # prints.id of the last error (for snapshot)
        self._ams_slot_snapshot: dict[int, dict] = {}      # slot_index → slot info at print start
        self._ams_slot_snapshot_print_id: Optional[int] = None  # print_id the snapshot belongs to
        self._ams_active_slot_at_start: Optional[int] = None    # tray_now at print start for deduction

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
            mc = self._printer.mqtt_client
            if not mc.is_connected():
                return PrinterStatus(
                    id=self.id, model_name=self.model_name, custom_name=self.custom_name,
                    icon=self.icon, kind="bambu", state="offline",
                    error="MQTT disconnected", last_seen=mc.last_report_wall() or self._last_seen,
                )
            age = mc.report_age_seconds()
            if age is None:
                return PrinterStatus(
                    id=self.id, model_name=self.model_name, custom_name=self.custom_name,
                    icon=self.icon, kind="bambu", state="offline",
                    error="Waiting for MQTT report", last_seen=self._last_seen,
                )
            if age > _BAMBU_STALE_REPORT_SECONDS:
                last_seen = mc.last_report_wall() or self._last_seen
                return PrinterStatus(
                    id=self.id, model_name=self.model_name, custom_name=self.custom_name,
                    icon=self.icon, kind="bambu", state="offline",
                    error=f"No MQTT report for {int(age)}s", last_seen=last_seen,
                )
            raw_state = self._printer.get_state()
            substage_raw = self._printer.get_current_state()
            substage = substage_raw.value if substage_raw is not None else None

            dump = self._printer.mqtt_dump()
            print_data = dump.get("print", {})
            alarm_message = _bambu_alarm_message(print_data)
            temps: dict[str, TempReading] = {}
            dual = _read_dual_nozzle_temps(dump, self.model_name)
            if dual:
                temps.update(dual)
            else:
                nozzle = self._printer.get_nozzle_temperature()
                if nozzle is not None:
                    temps["hotend"] = TempReading(
                        actual=float(nozzle),
                        target=float(mc.get_nozzle_temperature_target()),
                    )
            bed = self._printer.get_bed_temperature()
            chamber = _read_chamber_temp(dump, self.model_name)
            light_state = _read_light_state(print_data)
            fan_speeds = _read_fan_speeds(mc)
            if bed is not None:
                temps["bed"] = TempReading(
                    actual=float(bed),
                    target=float(mc.get_bed_temperature_target()),
                )
            if chamber is not None:
                temps["chamber"] = TempReading(actual=chamber, target=0.0)

            job = None
            filename = self._printer.get_file_name()
            pct = self._printer.get_percentage()
            subtask = self._printer.subtask_name() or None
            if _is_plate_gcode(filename) and not subtask:
                subtask = _active_queue_subtask(self.id)
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

            state = self._resolve_state(raw_state, job, subtask, alarm_message)

            if (state == "printing"
                    and self._current_print_id is not None
                    and self._ams_slot_snapshot_print_id != self._current_print_id):
                # Proactively fetch preview so filament_weight_g is available at
                # print-end even if nobody visits the detail page during the print.
                # get_preview() caches on subtask_name so this is a one-shot FTP call.
                if subtask and not self._preview_cache:
                    self.get_preview()
                raw_snap = _snapshot_ams_slots(print_data)
                self._ams_slot_snapshot = raw_snap
                self._ams_slot_snapshot_print_id = self._current_print_id
                # Capture active tray for single-spool deduction attribution
                ams_raw = print_data.get("ams", {})
                tray_now = int(ams_raw.get("tray_now", 255))
                self._ams_active_slot_at_start = None if tray_now == 255 else tray_now
                # Enrich snapshot with current spool assignments and persist to DB
                enriched: dict[str, dict] = {}
                for slot_idx, slot_data in raw_snap.items():
                    spool = db.get_spool_at_slot(self.id, slot_idx)
                    enriched[str(slot_idx)] = {
                        **slot_data,
                        "spool_id": spool["id"] if spool else None,
                        "remaining_g_at_start": spool["remaining_g"] if spool else None,
                    }
                    if spool is None:
                        db.log_decision(self.id, "spool_missing",
                                       f"No spool assigned to AMS slot {slot_idx}",
                                       print_id=self._current_print_id)
                if self._ams_active_slot_at_start is not None:
                    enriched["__meta__"] = {"active_slot": self._ams_active_slot_at_start}
                db.write_slot_snapshot(self._current_print_id, enriched)
                log.info("AMS slot snapshot for %s print_id=%d: slots=%s active=%s",
                         self.id, self._current_print_id, list(raw_snap.keys()),
                         self._ams_active_slot_at_start)

            if state == "idle":
                job = None  # MQTT retains last-print data; don't surface it as active

            idle_info: dict[str, str] = {}
            if state == "idle":
                last = db.get_last_print(self.id)
                if last:
                    idle_info["Last print"] = _fmt_last_print(last)

            try:
                ams = _parse_ams(print_data)
            except Exception:
                ams = []
            maintenance = _parse_care(print_data)

            now = datetime.utcnow()
            self._last_seen = now
            return PrinterStatus(
                id=self.id, model_name=self.model_name, custom_name=self.custom_name,
                icon=self.icon, kind="bambu", state=state,
                temps=temps, job=job, substage=substage,
                idle_info=idle_info, ams=ams, maintenance=maintenance, light_state=light_state,
                fan_speed=fan_speeds.get("part"),
                fan_speeds=fan_speeds,
                error=alarm_message if state in ("paused", "error") else None,
                last_seen=now, updated_at=now,
            )
        except Exception as exc:
            return PrinterStatus(id=self.id, model_name=self.model_name,
                                 custom_name=self.custom_name, icon=self.icon,
                                 kind="bambu", state="error", error=str(exc))

    def _resolve_state(self, raw: bl.GcodeState, job: Optional[JobStatus],
                       subtask: Optional[str], alarm_message: Optional[str] = None) -> str:
        now = datetime.now(timezone.utc)

        if raw == bl.GcodeState.FINISH:
            self._estimated_stored = False
            self._job_started_at = 0.0
            self._seen_finish_this_session = True
            if self._current_job_key:
                filament_g = material = filament_usage = None
                if self._preview_cache:
                    _, pv = self._preview_cache
                    filament_g = pv.filament_weight_g
                    material = pv.filament_type
                    filament_usage = _preview_filament_requirements(pv.filament_colors, pv.filament_type)
                finished_print_id = db.on_print_finished(
                    self.id, self._current_job_key,
                    layers_completed=job.layer_current if job else None,
                    filament_grams=filament_g,
                    material=material,
                )
                if finished_print_id and filament_g:
                    db.deduct_spool_usage(
                        self.id, finished_print_id, filament_g,
                        active_slot=self._ams_active_slot_at_start,
                        filament_usage=filament_usage,
                    )
                elif finished_print_id and self._ams_slot_snapshot_print_id == finished_print_id:
                    db.log_decision(self.id, "spool_no_deduction_cancelled",
                                   "Print finished but filament weight unknown; no spool deduction",
                                   print_id=finished_print_id)
                self._current_job_key = None
                self._current_print_id = None
                self._ams_active_slot_at_start = None
            else:
                # Service restarted during the print; close any open row as FINISHED
                # rather than leaving it orphaned for the stale-orphan sweep.
                closed_ids = db.close_open_prints(self.id, final_state="FINISHED")
                for pid in closed_ids:
                    db.log_decision(self.id, "job_cleanup",
                                   "FINISH seen at startup with no tracked job; closed open row as FINISHED",
                                   print_id=pid)
                self._current_print_id = None
            finished_at = db.get_finished_at(self.id)
            if finished_at is None:
                # Anchor to the actual last print end time so a stale FINISH state
                # after restart doesn't reset the 30-min window to "now".
                last_ended = db.get_last_ended_at(self.id)
                finished_at = last_ended if last_ended else now
                db.set_finished_at(self.id, finished_at)
            if (now - finished_at.replace(tzinfo=timezone.utc)) > FINISHED_TTL:
                db.clear_finished_at(self.id)
                return "idle"
            return "finished"

        if raw == bl.GcodeState.IDLE:
            self._estimated_stored = False
            self._job_started_at = 0.0
            self._error_job_key = None
            self._error_print_id = None
            self._error_seen_at = 0.0
            if self._seen_finish_this_session:
                db.clear_finished_at(self.id)
                self._seen_finish_this_session = False
                self._current_job_key = None
                self._current_print_id = None
                self._cancel_requested = False
                return "idle"
            if self._current_job_key:
                # In-session stop: distinguish user-initiated cancel from unexpected drop.
                if self._cancel_requested:
                    print_id = db.on_print_ended(
                        self.id, self._current_job_key,
                        final_state="CANCELLED",
                        layers_completed=job.layer_current if job else None,
                    )
                    if print_id:
                        db.log_decision(self.id, "cancel_resolved",
                                       f"User-initiated cancel confirmed (layers={job.layer_current if job else None})",
                                       print_id=print_id)
                        if self._ams_slot_snapshot_print_id == print_id:
                            db.log_decision(self.id, "spool_no_deduction_cancelled",
                                           "Print cancelled; no filament deducted from spools",
                                           print_id=print_id)
                else:
                    print_id = db.on_print_ended(
                        self.id, self._current_job_key,
                        final_state="ERROR",
                        layers_completed=job.layer_current if job else None,
                        error_message="Connection lost mid-print",
                    )
                    if print_id:
                        db.log_decision(self.id, "connection_lost",
                                       "Printer went IDLE without cancel request; likely connection drop",
                                       print_id=print_id)
                        if self._ams_slot_snapshot_print_id == print_id:
                            db.log_decision(self.id, "spool_no_deduction_cancelled",
                                           "Print ended as ERROR; no filament deducted from spools",
                                           print_id=print_id)
            else:
                # Service restarted while printer was mid-print then went idle:
                # _make_job_key may return a stale/wrong key, so close all open rows directly.
                closed_ids = db.close_open_prints(
                    self.id,
                    error_message="Connection lost mid-print",
                )
                for pid in closed_ids:
                    db.log_decision(self.id, "job_cleanup",
                                   "IDLE seen at startup with no tracked job; closed open rows as ERROR",
                                   print_id=pid)
            self._cancel_requested = False
            self._current_job_key = None
            self._current_print_id = None
            self._ams_active_slot_at_start = None
            finished_at = db.get_finished_at(self.id)
            if finished_at is not None:
                if (now - finished_at.replace(tzinfo=timezone.utc)) <= FINISHED_TTL:
                    return "finished"
                db.clear_finished_at(self.id)
            return "idle"

        if raw in (bl.GcodeState.RUNNING, bl.GcodeState.PREPARE):
            db.clear_finished_at(self.id)
            self._seen_finish_this_session = False
            self._error_job_key = None
            self._error_print_id = None
            self._error_seen_at = 0.0
            if self._current_job_key is None:
                self._current_job_key = self._make_job_key(subtask)
                self._job_started_at = time.monotonic()
                self._estimated_stored = False
                print_id, is_reattach = db.on_print_started(
                    self.id,
                    self._current_job_key,
                    job.filename if job else "",
                    subtask_name=subtask,
                    layers_total=job.layer_total if job else None,
                )
                self._current_print_id = print_id
                if is_reattach and print_id:
                    db.log_decision(self.id, "job_reattached",
                                   f"Service restarted mid-print; reattached to existing row key={self._current_job_key}",
                                   print_id=print_id)
                elif print_id:
                    db.log_decision(self.id, "job_started",
                                   f"New print started key={self._current_job_key}",
                                   print_id=print_id)
            # Derived slicer estimate: capture once after 60s elapsed.
            # Primary path for Bambu — no metadata API available.
            # Formula: slicer_total = eta_seconds / (1 - progress)
            # (remaining = total * fraction_remaining, so total = remaining / fraction_remaining)
            if (not self._estimated_stored
                    and self._job_started_at > 0
                    and time.monotonic() - self._job_started_at > 60
                    and job is not None
                    and job.eta_seconds is not None
                    and 0.01 < job.progress < 0.99):
                slicer_total = int(job.eta_seconds / (1.0 - job.progress))
                db.update_estimated_duration(self.id, self._current_job_key, slicer_total)
                log.info("stored slicer estimate for %s: %ds (derived)", self.id, slicer_total)
                if self._current_print_id:
                    db.log_decision(self.id, "calibration_captured",
                                   f"Slicer estimate derived: {slicer_total}s "
                                   f"({slicer_total // 3600}h {(slicer_total % 3600) // 60}m)",
                                   print_id=self._current_print_id)
                self._estimated_stored = True
            return "printing"

        if raw == bl.GcodeState.PAUSE:
            return "paused"

        if raw == bl.GcodeState.FAILED:
            self._estimated_stored = False
            self._job_started_at = 0.0
            db.clear_finished_at(self.id)
            err_code = self._printer.mqtt_dump().get("print", {}).get("print_error", 0)

            if self._current_job_key:
                # In-session failure: close the job and start showing the error.
                # If the operator has already requested a cancel, treat Bambu's
                # retained FAILED state as the cancel resolving rather than a
                # reliability failure.
                job_key = self._current_job_key
                err_msg = alarm_message or (f"Bambu error: {err_code}" if err_code else "Print failed")
                if self._cancel_requested:
                    print_id = db.on_print_ended(
                        self.id, job_key,
                        final_state="CANCELLED",
                        layers_completed=job.layer_current if job else None,
                    )
                    if print_id:
                        db.log_decision(self.id, "cancel_resolved",
                                       f"User-initiated cancel confirmed from Bambu FAILED state ({err_msg})",
                                       print_id=print_id)
                        if self._ams_slot_snapshot_print_id == print_id:
                            db.log_decision(self.id, "spool_no_deduction_cancelled",
                                           "Print cancelled; no filament deducted from spools",
                                           print_id=print_id)
                    self._current_job_key = None
                    self._current_print_id = None
                    self._cancel_requested = False
                    self._error_job_key = None
                    self._error_print_id = None
                    self._error_seen_at = 0.0
                    return "idle"
                print_id = db.on_print_ended(
                    self.id, job_key,
                    final_state="ERROR",
                    layers_completed=job.layer_current if job else None,
                    error_message=err_msg,
                )
                self._current_job_key = None
                self._current_print_id = None
                self._cancel_requested = False
                self._error_job_key = job_key
                self._error_print_id = print_id
                self._error_seen_at = time.monotonic()
                if print_id:
                    db.log_decision(self.id, "error_resolved", err_msg, print_id=print_id)
                return "error"

            if self._error_job_key:
                # Bambu can retain FAILED after the printer UI has been cleared.
                # Keep a real error visible, but release a closed, code-free fault
                # after a short grace period so queue preflight stops blocking.
                age = time.monotonic() - self._error_seen_at if self._error_seen_at else 999.0
                if not err_code and age >= 15.0 and db.is_print_closed(self.id, self._error_job_key):
                    if self._error_print_id:
                        db.log_decision(self.id, "error_cleared",
                                       "Bambu FAILED state retained with no active error code; live fault cleared",
                                       print_id=self._error_print_id)
                    self._error_job_key = None
                    self._error_print_id = None
                    self._error_seen_at = 0.0
                    return "idle"
                # Already showing this in-session error; keep showing it while active.
                return "error"

            # No in-session job — stale FAILED state from before service started.
            job_key = self._make_job_key(subtask)
            if job_key and db.is_print_closed(self.id, job_key):
                # Error already recorded in a previous session; nothing new to show.
                return "idle"

            # Pre-existing failure not yet in DB — close it and show error once.
            if job_key:
                err_msg = alarm_message or (f"Bambu error: {err_code}" if err_code else "Print failed")
                print_id = db.on_print_ended(
                    self.id, job_key,
                    final_state="ERROR",
                    layers_completed=job.layer_current if job else None,
                    error_message=err_msg,
                )
                self._error_job_key = job_key
                self._error_print_id = print_id
                self._error_seen_at = time.monotonic()
                if print_id:
                    db.log_decision(self.id, "error_resolved",
                                   f"Stale error at service start: {err_msg}",
                                   print_id=print_id)
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

    # ── Controls ───────────────────────────────────────────────────────────

    def pause(self) -> None:
        if not self._printer.pause_print():
            raise RuntimeError("Bambu pause command was not accepted")

    def resume(self) -> None:
        if not self._printer.resume_print():
            raise RuntimeError("Bambu resume command was not accepted")

    def cancel(self) -> None:
        self._cancel_requested = True
        self._printer.stop_print()

    def estop(self) -> None:
        self._cancel_requested = True
        self._printer.stop_print()  # Bambu MQTT has no dedicated e-stop

    def light_on(self) -> None:
        self._set_light("on")

    def light_off(self) -> None:
        self._set_light("off")

    def _set_light(self, mode: str) -> None:
        nodes = ["chamber_light"]
        if self.model_name.upper() == "H2D":
            nodes = ["chamber_light", "chamber_light2", "work_light"]

        ok_any = False
        for node in nodes:
            ok = self._printer.mqtt_client._PrinterMQTTClient__publish_command({
                "system": {
                    "command": "ledctrl",
                    "led_node": node,
                    "led_mode": mode,
                    "led_on_time": 500,
                    "led_off_time": 500,
                    "loop_times": 1,
                    "interval_time": 1000,
                }
            })
            ok_any = ok_any or ok
        if not ok_any:
            raise RuntimeError(f"Bambu light command failed: {mode}")

    def set_ams_slot_filament(self, slot: int, spool: Optional[dict]) -> bool:
        ams_id, tray_id = _split_ams_slot(slot)
        if spool is None:
            return self._printer.mqtt_client._PrinterMQTTClient__publish_command({
                "print": {
                    "command": "ams_filament_setting",
                    "ams_id": ams_id,
                    "tray_id": tray_id,
                    "tray_info_idx": "",
                    "tray_color": "00000000",
                    "nozzle_temp_min": 0,
                    "nozzle_temp_max": 0,
                    "tray_type": "",
                    "tray_sub_brands": "",
                    "tray_id_name": "",
                }
            })

        color = str(spool.get("color_hex") or "#808080").lstrip("#")[:6]
        if len(color) != 6:
            color = "808080"
        payload = _ams_filament_setting_payload(spool, color.upper(), ams_id, tray_id)
        return self._printer.mqtt_client._PrinterMQTTClient__publish_command({"print": payload})

    def unload_ams_filament(self, slot: Optional[int] = None) -> bool:
        ams_id, _tray_id = _split_ams_slot(slot) if slot is not None else (255, 255)
        if slot is None:
            try:
                tray_now = int((self._printer.mqtt_dump().get("print", {}).get("ams", {}) or {}).get("tray_now", 255))
                if 0 <= tray_now < 128:
                    ams_id = tray_now // 4
                elif tray_now >= 128:
                    ams_id = tray_now
            except Exception:
                ams_id = 255
        temp = _filament_change_temp(self._ams_slot_material(slot))
        return self._printer.mqtt_client._PrinterMQTTClient__publish_command({
            "print": {
                "command": "ams_change_filament",
                "ams_id": ams_id,
                "slot_id": 255,
                "target": 255,
                "curr_temp": temp,
                "tar_temp": temp,
            }
        })

    def load_ams_filament(self, slot: Optional[int] = None) -> bool:
        if slot is None:
            return self._printer.load_filament_spool()
        ams_id, tray_id = _split_ams_slot(slot)
        target = _bambu_tray_target(slot)
        return self._printer.mqtt_client._PrinterMQTTClient__publish_command({
            "print": {
                "command": "ams_change_filament",
                "ams_id": ams_id,
                "slot_id": tray_id,
                "target": target,
                "curr_temp": -1,
                "tar_temp": -1,
            }
        })

    def _ams_slot_material(self, slot: Optional[int]) -> str:
        if slot is None:
            return ""
        unit_id, tray_id = _split_ams_slot(slot)
        try:
            dump = self._printer.mqtt_dump().get("print", {})
            for unit_data in (dump.get("ams", {}) or {}).get("ams", []):
                if int(unit_data.get("id", 0)) != int(unit_id):
                    continue
                for tray_data in unit_data.get("tray", []):
                    if int(tray_data.get("id", 0)) == int(tray_id):
                        return str(tray_data.get("tray_type") or "")
        except Exception:
            return ""
        return ""

    def set_ams_drying(
        self,
        ams_id: int,
        enabled: bool,
        *,
        filament: str = "PLA",
        temp: int = 45,
        duration: int = 12,
        rotate_tray: bool = False,
    ) -> bool:
        if enabled:
            max_temp = 85 if int(ams_id) >= 128 else 65
            temp = max(45, min(int(temp), max_temp))
            duration = max(1, min(int(duration), 24))
            payload = {
                "print": {
                    "command": "ams_filament_drying",
                    "ams_id": int(ams_id),
                    "temp": temp,
                    "cooling_temp": 20,
                    "duration": duration,
                    "humidity": 0,
                    "mode": 1,
                    "rotate_tray": bool(rotate_tray),
                    "filament": str(filament or "PLA").upper(),
                    "close_power_conflict": False,
                }
            }
        else:
            payload = {
                "print": {
                    "command": "ams_filament_drying",
                    "ams_id": int(ams_id),
                    "temp": 0,
                    "cooling_temp": 0,
                    "duration": 0,
                    "humidity": 0,
                    "mode": 0,
                    "rotate_tray": False,
                    "filament": "",
                    "close_power_conflict": False,
                }
            }
        return self._printer.mqtt_client._PrinterMQTTClient__publish_command(payload)

    def set_temp(self, heater: str, target: int) -> None:
        if heater == "hotend":
            self._printer.set_nozzle_temperature(target)
        elif heater == "bed":
            self._printer.set_bed_temperature(target)

    def set_fan(self, channel: str, speed_percent: int) -> None:
        pct = max(0, min(100, int(speed_percent)))
        pwm = round(pct * 255 / 100)
        channel_key = (channel or "part").lower()
        if channel_key == "part":
            ok = self._printer.set_part_fan_speed(pwm)
        elif channel_key == "aux":
            ok = self._printer.set_aux_fan_speed(pwm)
        elif channel_key == "chamber":
            ok = self._printer.set_chamber_fan_speed(pwm)
        else:
            raise ValueError("invalid fan channel")
        if not ok:
            raise RuntimeError(f"Bambu {channel_key} fan command was not accepted")

    def home_all(self) -> None:
        if not self._printer.home_printer():
            raise RuntimeError("Bambu home command was not accepted")

    def get_preview(self):
        """Return cached BambuPreview, fetching via FTP if the job changed."""
        if not self._connected:
            return None
        subtask = self._printer.subtask_name()
        filename = self._printer.get_file_name()
        plate_number = _plate_number(filename)
        if _is_plate_gcode(filename) and not subtask:
            subtask = _active_queue_subtask(self.id)
        if not subtask:
            return None
        cache_key = f"{subtask}|plate:{plate_number or 1}"
        if self._preview_cache and self._preview_cache[0] == cache_key:
            val = self._preview_cache[1]
            return None if val is _BAMBU_PREVIEW_FAILED else val
        try:
            from .bambu_ftp import fetch_bambu_preview
            preview = fetch_bambu_preview(self._ip, self._access_code, subtask, plate_number=plate_number)
            self._preview_cache = (cache_key, preview)
            return preview
        except Exception as exc:
            log.warning("FTP preview failed for %s: %s", self.model_name, exc)
            self._preview_cache = (cache_key, _BAMBU_PREVIEW_FAILED)
            return None

    def get_objects(self) -> dict:
        """Return skip-object candidates parsed from the current 3MF metadata."""
        preview = self.get_preview()
        if not preview or not preview.objects:
            return {
                "supported": False,
                "mode": "bambu_skip_objects",
                "label": "Bambu skip objects",
                "objects": [],
                "detail": "No object metadata found in the active 3MF.",
            }

        skipped = set()
        try:
            skipped = {int(x) for x in self._printer.mqtt_client.get_skipped_objects() or []}
        except Exception:
            skipped = set()

        objects = []
        for obj in preview.objects:
            obj_id = obj.get("id")
            state = obj.get("state") or "available"
            if obj_id in skipped:
                state = "excluded"
            objects.append({**obj, "state": state})
        return {
            "supported": len(objects) > 1,
            "mode": "bambu_skip_objects",
            "label": "Bambu skip objects",
            "objects": objects,
            "excluded_ids": sorted(skipped),
            "plate_bounds": preview.plate_bounds,
            "plate_image_url": f"/api/printers/{self.id}/thumbnail",
            "detail": "Bambu object exclusion uses the printer skip-object list.",
        }

    def skip_object(self, object_id: int) -> bool:
        skipped = set()
        try:
            skipped = {int(x) for x in self._printer.mqtt_client.get_skipped_objects() or []}
        except Exception:
            skipped = set()
        skipped.add(int(object_id))
        return self._printer.mqtt_client.skip_objects(sorted(skipped))

    def seed_preview(self, subtask_name: str, preview) -> None:
        """Pre-populate preview cache from relay upload; avoids FTP fetch for H2D."""
        self._preview_cache = (subtask_name, preview)

    def ams_slots(self) -> list[dict]:
        """Return flattened live AMS slots with Bambu's global slot index."""
        dump = self._printer.mqtt_dump()
        slots = []
        for unit in _parse_ams(dump.get("print", {})):
            unit_id = int(unit.get("unit", 0))
            for slot in unit.get("slots") or []:
                if slot.get("empty"):
                    continue
                slot_idx = int(slot.get("idx", 0))
                flat_idx = unit_id * 4 + slot_idx
                bambu_tray_id = unit_id + slot_idx if unit_id >= 128 else flat_idx
                slots.append({
                    **slot,
                    "unit": unit_id,
                    "global_idx": flat_idx,
                    "bambu_tray_id": bambu_tray_id,
                })
        return slots

    def send_file(self, file_path: str, filename: str) -> None:
        """Upload a .gcode.3mf to the printer via FTPS then send the MQTT print command."""
        from .bambu_ftp import upload_bambu_file
        with open(file_path, "rb") as f:
            data = f.read()
        preview = upload_bambu_file(self._ip, self._access_code, filename, data)
        subtask_name = filename.removesuffix(".gcode.3mf")
        if preview and preview.image_png:
            self.seed_preview(subtask_name, preview)

        ams_mapping, mapping_note = _derive_bambu_ams_mapping(
            preview.filament_colors if preview else None,
            preview.filament_type if preview else None,
            self.ams_slots(),
        )
        db.log_decision(self.id, "queue_bambu_mapping", json.dumps({
            "file": filename,
            "ams_mapping": ams_mapping,
            "mapping_note": mapping_note,
        }))
        self._printer.start_print(filename, 1, True, ams_mapping)


def _read_dual_nozzle_temps(mqtt_dump: dict, model_name: str) -> dict[str, "TempReading"]:
    """Return {hotend_l, hotend_r} TempReadings for dual-nozzle printers (H2D only).

    H2D extruder encoding in device.extruder.info[]:
      - Primary extruder (id=0, Right): packed (actual<<16)|target  e.g. 17694990=(270<<16)|270
      - Secondary extruder (id=1, Left): plain int when temp>>16==0  e.g. 77 → 77°C
    Assignment confirmed: nozzle_temper tracks extruder[0] (Right); extruder[1] is Left.
    """
    if model_name != "H2D":
        return {}

    print_data = mqtt_dump.get("print", {})
    device = print_data.get("device", {})
    if not isinstance(device, dict):
        return {}
    ext = device.get("extruder", {})
    if not isinstance(ext, dict):
        return {}
    info = ext.get("info", [])
    if not isinstance(info, list) or len(info) < 2:
        return {}

    _ID_TO_KEY = {0: "hotend_r", 1: "hotend_l"}
    result: dict[str, TempReading] = {}
    for entry in info:
        eid = entry.get("id")
        raw = entry.get("temp")
        if eid is None or raw is None:
            continue
        try:
            val = int(raw)
            if val >> 16 > 0:
                actual = float(val >> 16)
                target = float(val & 0xFFFF)
            else:
                actual = float(val)
                target = 0.0
            if 0 <= actual <= 400:
                key = _ID_TO_KEY.get(eid, f"hotend_{eid}")
                result[key] = TempReading(actual=actual, target=target)
        except (TypeError, ValueError):
            pass

    return result if len(result) == 2 else {}


def _build_bambu_ams_mappings(ams_mapping: list[int] | None) -> tuple[list[int], list[dict]]:
    """Return legacy flat ams_mapping plus detailed ams_mapping2.

    For regular AMS, Bambu's flat tray ID is unit*4+slot. For AMS HT, the
    flat tray ID is the unit ID itself (128, 129, ...), not unit*4. External
    virtual trays are represented as -1 in the flat array and resolved through
    ams_mapping2.
    """
    flat: list[int] = []
    detailed: list[dict] = []
    for raw_id in ams_mapping or []:
        tray_id = int(raw_id) if raw_id is not None else -1
        if tray_id < 0:
            flat.append(-1)
            detailed.append({"ams_id": 255, "slot_id": 255})
        elif tray_id >= 254:
            flat.append(-1)
            detailed.append({"ams_id": 255, "slot_id": 0})
        elif tray_id >= 128:
            flat.append(tray_id)
            detailed.append({"ams_id": tray_id, "slot_id": 0})
        else:
            flat.append(tray_id)
            detailed.append({"ams_id": tray_id // 4, "slot_id": tray_id % 4})
    return flat, detailed


def _is_plate_gcode(filename: Optional[str]) -> bool:
    return bool(re.search(r"(?:^|[/\\])plate_\d+\.gcode$", str(filename or ""), re.IGNORECASE))


def _plate_number(filename: Optional[str]) -> Optional[int]:
    match = re.search(r"(?:^|[/\\])plate_(\d+)\.gcode$", str(filename or ""), re.IGNORECASE)
    if not match:
        return None
    try:
        return int(match.group(1))
    except ValueError:
        return None


def _active_queue_subtask(printer_id: str) -> Optional[str]:
    row = db.queue_active_job(printer_id)
    if not row:
        return None
    name = str(row.get("filename") or "").rsplit("/", 1)[-1].rsplit("\\", 1)[-1]
    return name.removesuffix(".gcode.3mf").removesuffix(".3mf").removesuffix(".gcode") or None


def _norm_bambu_hex(value: Optional[str]) -> str:
    h = str(value or "").strip().lstrip("#")[:6].upper()
    return f"#{h}" if re.fullmatch(r"[0-9A-F]{6}", h) else ""


def _bambu_hex_dist(a: Optional[str], b: Optional[str]) -> float:
    ha, hb = _norm_bambu_hex(a), _norm_bambu_hex(b)
    if not ha or not hb:
        return 999.0
    va = [int(ha[i:i + 2], 16) for i in (1, 3, 5)]
    vb = [int(hb[i:i + 2], 16) for i in (1, 3, 5)]
    return sum((x - y) ** 2 for x, y in zip(va, vb)) ** 0.5


def _norm_bambu_material(value: Optional[str]) -> str:
    return re.sub(r"[^a-z0-9]+", "", (value or "").lower())


def _preview_filament_requirements(filament_colors, fallback_type: Optional[str]) -> list[dict]:
    if not filament_colors:
        return []
    if isinstance(filament_colors, list):
        rows = filament_colors
    else:
        try:
            rows = json.loads(filament_colors)
        except Exception:
            return []
    out = []
    for row in rows if isinstance(rows, list) else []:
        if not isinstance(row, dict):
            continue
        color = _norm_bambu_hex(row.get("color"))
        material = _norm_bambu_material(row.get("type") or fallback_type)
        if color or material:
            out.append({"color": color, "material": material, "used_g": row.get("used_g")})
    return out


def _derive_bambu_ams_mapping(
    filament_colors,
    fallback_type: Optional[str],
    slots: list[dict],
) -> tuple[list[int], str]:
    requirements = _preview_filament_requirements(filament_colors, fallback_type)
    if not requirements:
        return [0], "no 3MF filament metadata; fallback to slot 0"

    available = []
    for slot in slots:
        material = _norm_bambu_material(slot.get("type"))
        color = _norm_bambu_hex(slot.get("color"))
        if material:
            available.append({**slot, "material_norm": material, "color_norm": color})
    if not available:
        return [0], "no loaded AMS slots reported; fallback to slot 0"

    mapping: list[int] = []
    used: set[int] = set()
    notes: list[str] = []
    for req in requirements:
        material_matches = [
            slot for slot in available
            if req["material"] and (
                req["material"] == slot["material_norm"]
                or req["material"] in slot["material_norm"]
                or slot["material_norm"] in req["material"]
            )
        ] or available
        ranked = sorted(
            material_matches,
            key=lambda slot: (
                slot["bambu_tray_id"] in used,
                _bambu_hex_dist(req.get("color"), slot.get("color_norm")),
                slot["bambu_tray_id"],
            ),
        )
        best = ranked[0]
        mapping.append(int(best["bambu_tray_id"]))
        used.add(int(best["bambu_tray_id"]))
        notes.append(
            f"{req.get('material') or 'unknown'} {req.get('color') or ''}"
            f"->{best['bambu_tray_id']} {best.get('type') or ''} {best.get('color') or ''}"
        )

    return mapping or [0], "; ".join(notes)


def _read_chamber_temp(mqtt_dump: dict, model_name: str) -> float | None:
    """Return chamber temperature in °C, or None if unavailable/invalid.

    X1C stores device.ctc.info.temp as a plain int (e.g. 27 → 27 °C).
    H2D packs it as (actual_celsius << 16) | target_celsius
    (e.g. 4259905 = 0x410041 → actual = 0x41 = 65 °C).
    Clamp at 150 °C to catch any future encoding surprises.
    """
    print_data = mqtt_dump.get("print", {})

    raw = print_data.get("chamber_temper")
    if raw is not None:
        try:
            val = float(raw)
            return val if 0 <= val <= 150 else None
        except (TypeError, ValueError):
            pass

    device = print_data.get("device", {})
    if isinstance(device, dict):
        ctc = device.get("ctc", {})
        if isinstance(ctc, dict):
            info = ctc.get("info", {})
            if isinstance(info, dict):
                packed = info.get("temp")
                if packed is not None:
                    try:
                        val = int(packed)
                        if model_name == "H2D":
                            val = val >> 16  # upper 16 bits = actual °C
                        return float(val) if 0 <= val <= 150 else None
                    except (TypeError, ValueError):
                        pass

    return None


def _read_light_state(print_data: dict) -> str:
    report = print_data.get("lights_report") or []
    if not report:
        return "unknown"
    modes = [str((r or {}).get("mode", "unknown")).lower() for r in report]
    known = [m for m in modes if m in {"on", "off"}]
    if not known:
        return "unknown"
    if any(m == "on" for m in known):
        return "on"
    return "off"


def _read_fan_speeds(mc) -> dict[str, float]:
    speeds: dict[str, float] = {}
    readers = {
        "part": mc.get_part_fan_speed,
        "aux": mc.get_aux_fan_speed,
        "chamber": mc.get_chamber_fan_speed,
    }
    for channel, reader in readers.items():
        try:
            raw = reader()
            if raw is None:
                continue
            speeds[channel] = max(0.0, min(1.0, float(raw) / 255.0))
        except Exception:
            continue
    return speeds


_BAMBU_ALARM_MESSAGES = {
    "1E07008012": 'Failed to get AMS mapping table; please select "Resume" to retry.',
    "07008012": 'Failed to get AMS mapping table; please select "Resume" to retry.',
    "117473298": 'Failed to get AMS mapping table; please select "Resume" to retry.',
}


def _normalise_bambu_alarm_code(value) -> str:
    text = str(value or "").strip()
    if not text or text == "0":
        return ""
    if text.endswith(".0"):
        text = text[:-2]
    return text.upper()


def _format_bambu_display_code(code: str) -> str:
    if len(code) >= 8 and all(ch in "0123456789ABCDEF" for ch in code[-8:]):
        return f"{code[-8:-4]}-{code[-4:]}"
    return code


def _bambu_alarm_message(print_data: dict) -> Optional[str]:
    """Return a user-facing Bambu alarm reason from MQTT fields."""
    candidates: list[str] = []
    for key in ("err", "print_error", "ap_err", "fail_reason", "mc_print_error_code", "mc_err"):
        code = _normalise_bambu_alarm_code(print_data.get(key))
        if code:
            candidates.append(code)
    err2 = print_data.get("err2")
    if isinstance(err2, dict):
        code = _normalise_bambu_alarm_code(err2.get("err_code"))
        if code:
            candidates.append(code)

    for code in candidates:
        message = _BAMBU_ALARM_MESSAGES.get(code) or _BAMBU_ALARM_MESSAGES.get(code[-8:])
        if message:
            return f"{message} [{_format_bambu_display_code(code)}]"

    for code in candidates:
        return f"Bambu alarm {_format_bambu_display_code(code)}"
    return None


def _split_ams_slot(slot: int) -> tuple[int, int]:
    slot = int(slot)
    return slot // 4, slot % 4


def _bambu_tray_target(slot: int) -> int:
    unit_id, tray_id = _split_ams_slot(slot)
    return unit_id + tray_id if unit_id >= 128 else int(slot)


def _filament_change_temp(material: Optional[str]) -> int:
    material_norm = _norm_bambu_material(material)
    if material_norm in ("asa", "abs", "pc", "pa", "nylon"):
        return 255
    if material_norm in ("petg", "pet", "pctg"):
        return 245
    if material_norm in ("tpu", "pla", "plasilk", "plamatte", "plaplus"):
        return 220
    return 220


def _bambu_profile_for_idx(idx: Optional[str]) -> dict:
    return _BAMBU_PROFILE_ALIASES.get(str(idx or "").strip(), {})


def _custom_filament_for_spool(spool: dict) -> Optional[AMSFilamentSettings]:
    material = str(spool.get("material") or "").strip().upper()
    brand = str(spool.get("brand") or "").strip().lower()
    if material == "ASA" and "siddament" in brand:
        profile = _BAMBU_PROFILE_ALIASES["P461bccf"]
        return AMSFilamentSettings(
            profile["tray_info_idx"],
            profile["nozzle_temp_min"],
            profile["nozzle_temp_max"],
            profile["tray_type"],
        )
    return None


def _profile_alias_for_spool(spool: dict) -> dict:
    material = str(spool.get("material") or "").strip().upper()
    brand = str(spool.get("brand") or "").strip().lower()
    if material == "ASA" and "siddament" in brand:
        return _BAMBU_PROFILE_ALIASES["P461bccf"]
    filament = _filament_for_spool(spool)
    if isinstance(filament, AMSFilamentSettings):
        for alias in _BAMBU_PROFILE_ALIASES.values():
            if alias.get("tray_info_idx") == filament.tray_info_idx:
                return alias
        return {
            "tray_info_idx": filament.tray_info_idx,
            "tray_type": filament.tray_type,
            "nozzle_temp_min": filament.nozzle_temp_min,
            "nozzle_temp_max": filament.nozzle_temp_max,
            "brand": str(spool.get("brand") or "").strip(),
            "profile": " ".join(str(spool.get(k) or "").strip() for k in ("brand", "material", "subtype")).strip(),
        }
    return {}


def _ams_filament_setting_payload(spool: dict, color: str, ams_id: int, tray_id: int) -> dict:
    alias = _profile_alias_for_spool(spool)
    filament = _filament_for_spool(spool)
    if not isinstance(filament, AMSFilamentSettings):
        filament = AMSFilamentSettings(str(filament), 0, 0, str(spool.get("material") or "").upper())

    brand = str(alias.get("brand") or spool.get("brand") or "").strip()
    profile = str(alias.get("profile") or " ".join(
        str(spool.get(k) or "").strip() for k in ("brand", "material", "subtype")
    ).strip()).strip()
    return {
        "command": "ams_filament_setting",
        "ams_id": ams_id,
        "tray_id": tray_id,
        "tray_info_idx": alias.get("tray_info_idx") or filament.tray_info_idx,
        "tray_color": f"{color}FF",
        "nozzle_temp_min": alias.get("nozzle_temp_min", filament.nozzle_temp_min),
        "nozzle_temp_max": alias.get("nozzle_temp_max", filament.nozzle_temp_max),
        "tray_type": alias.get("tray_type") or filament.tray_type,
        "tray_sub_brands": brand,
        "tray_id_name": profile,
    }


def _filament_for_spool(spool: dict):
    custom = _custom_filament_for_spool(spool)
    if custom:
        return custom

    material = str(spool.get("material") or "").upper()
    subtype = str(spool.get("subtype") or "").upper()
    label = f"{material} {subtype}"

    if "PA" in material and "CF" in label:
        key = "PA_CF"
    elif "PLA" in material and "CF" in label:
        key = "PLA_CF"
    elif "ABS" in material:
        key = "ABS"
    elif "ASA" in material:
        key = "ASA"
    elif "PETG" in material:
        key = "PETG"
    elif "TPU" in material:
        key = "TPU"
    elif "PC" in material:
        key = "PC"
    elif "PVA" in material:
        key = "PVA"
    elif "PA" in material:
        key = "PA"
    elif "PLA" in material:
        key = "PLA"
    else:
        key = "PLA"

    return bl.Filament(key)


def _parse_ams(dump: dict) -> list[dict]:
    """Parse AMS data from mqtt_dump()['print']. Returns JSON-serialisable list."""
    ams_raw = dump.get("ams", {})
    if not ams_raw or ams_raw.get("ams_exist_bits", "0") == "0":
        return []

    tray_now = int(ams_raw.get("tray_now", 255))
    _AMS_LABELS = {128: "AMS HT"}
    result = []

    for unit_data in ams_raw.get("ams", []):
        unit_id = int(unit_data.get("id", 0))
        dry_setting = unit_data.get("dry_setting") or {}
        dry_time = _safe_int(unit_data.get("dry_time"))
        unit_temp = _safe_float(
            unit_data.get("temp")
            or unit_data.get("temperature")
            or unit_data.get("dry_temp")
        )
        humidity = _safe_int(unit_data.get("humidity"))
        humidity_raw = _safe_int(unit_data.get("humidity_raw"))
        dry_filament = str(dry_setting.get("dry_filament") or "").upper()
        dry_temperature = _safe_int(dry_setting.get("dry_temperature"))
        dry_duration = _safe_int(dry_setting.get("dry_duration"))
        dry_reasons = []
        if isinstance(unit_data.get("dry_sf_reason"), list):
            for reason in unit_data.get("dry_sf_reason") or []:
                parsed = _safe_int(reason)
                if parsed is not None:
                    dry_reasons.append(parsed)
        dry_status = None
        dry_sub_status = None
        info = unit_data.get("info")
        if info is not None:
            try:
                info_val = int(str(info), 16)
                dry_status = (info_val >> 4) & 0xF
                dry_sub_status = (info_val >> 22) & 0xF
            except (TypeError, ValueError):
                pass
        slots = []
        for tray_data in unit_data.get("tray", []):
            tray_id = int(tray_data.get("id", 0))
            tray_type = tray_data.get("tray_type", "")
            tray_state = tray_data.get("state")
            try:
                tray_state_int = int(tray_state)
            except (TypeError, ValueError):
                tray_state_int = None
            empty = (not tray_type) and tray_state_int != 11
            profile_id = str(tray_data.get("tray_info_idx") or "")
            profile = _bambu_profile_for_idx(profile_id)
            brand = tray_data.get("tray_sub_brands", "") or profile.get("brand", "")
            profile_name = tray_data.get("tray_id_name", "") or profile.get("profile", "")

            hex_c = tray_data.get("tray_color", "")
            if len(hex_c) >= 6 and hex_c.upper() not in ("00000000", ""):
                color = f"#{hex_c[:6].upper()}"
            else:
                color = ""

            active = (not empty) and (tray_now == unit_id * 4 + tray_id)

            slots.append({
                "idx": tray_id,
                "type": tray_type,
                "color": color,
                "brand": brand,
                "profile_id": profile_id,
                "profile_name": profile_name,
                "tray_state": tray_state,
                "active": active,
                "empty": empty,
            })

        if slots:
            result.append({
                "unit": unit_id,
                "label": _AMS_LABELS.get(unit_id, f"AMS {unit_id + 1}"),
                "slots": slots,
                "humidity": humidity_raw if humidity_raw is not None else humidity,
                "humidity_level": humidity,
                "temperature": unit_temp,
                "dry_time": dry_time,
                "drying": bool(dry_time and dry_time > 0),
                "dry_capable": unit_id >= 128 or bool(dry_setting),
                "dry_status": dry_status,
                "dry_sub_status": dry_sub_status,
                "dry_sf_reason": dry_reasons,
                "dry_setting": {
                    "filament": dry_filament,
                    "temperature": dry_temperature,
                    "duration": dry_duration,
                },
            })

    return result


def _parse_care(dump: dict) -> list[dict]:
    """Return Bambu MQTT care advisories as Flightdeck maintenance signals.

    The printer only publishes active care rows, so their presence is treated
    as due/attention rather than as a full schedule replacement.
    """
    care = dump.get("care") or []
    if not isinstance(care, list):
        return []

    items = []
    for raw in care:
        if not isinstance(raw, dict):
            continue
        code = str(raw.get("id") or "").strip().lower()
        if not code:
            continue
        info = str(raw.get("info") or "").strip()
        title = _BAMBU_CARE_LABELS.get(code, f"Printer care {code.upper()}")
        items.append({
            "id": f"bambu:{code}",
            "code": code,
            "title": title,
            "source": "bambu_mqtt",
            "state": "due",
            "is_due": True,
            "info": info,
            "detail": f"Printer reported {code.upper()} care via Bambu MQTT",
        })
    return items


def _safe_int(value) -> Optional[int]:
    try:
        if value is None or value == "":
            return None
        return int(float(value))
    except (TypeError, ValueError):
        return None


def _safe_float(value) -> Optional[float]:
    try:
        if value is None or value == "":
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def _snapshot_ams_slots(print_data: dict) -> dict[int, dict]:
    """Capture AMS slot state at print start. Returns {slot_index: slot_info}."""
    ams_raw = print_data.get("ams", {})
    tray_now = int(ams_raw.get("tray_now", 255))
    result: dict[int, dict] = {}
    for unit_data in ams_raw.get("ams", []):
        unit_id = int(unit_data.get("id", 0))
        for tray_data in unit_data.get("tray", []):
            tray_id = int(tray_data.get("id", 0))
            tray_type = tray_data.get("tray_type", "")
            if not tray_type:
                continue
            slot_index = unit_id * 4 + tray_id
            hex_c = tray_data.get("tray_color", "")
            color = f"#{hex_c[:6].upper()}" if len(hex_c) >= 6 and hex_c.upper() not in ("00000000", "") else ""
            profile_id = str(tray_data.get("tray_info_idx") or "")
            profile = _bambu_profile_for_idx(profile_id)
            brand = tray_data.get("tray_sub_brands", "") or profile.get("brand", "")
            profile_name = tray_data.get("tray_id_name", "") or profile.get("profile", "")
            result[slot_index] = {
                "type": tray_type,
                "brand": brand,
                "profile_id": profile_id,
                "profile_name": profile_name,
                "color": color,
                "uuid": tray_data.get("tray_uuid", ""),
                "remain_pct": tray_data.get("remain", -1),
                "active": tray_now == slot_index,
            }
    return result


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
