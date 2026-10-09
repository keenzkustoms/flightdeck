from __future__ import annotations
import json
import logging
import re
import threading
import time
from datetime import datetime, timezone, timedelta
from types import SimpleNamespace
from typing import Optional

import bambulabs_api as bl
from bambulabs_api.filament_info import AMSFilamentSettings
from bambulabs_api.mqtt_client import PrinterMQTTClient

from .. import db
from ..models import PrinterStatus, JobStatus, TempReading

log = logging.getLogger(__name__)

FINISHED_TTL = timedelta(minutes=5)
_BAMBU_PREVIEW_FAILED = object()  # sentinel: FTP failed, don't retry until job changes
_BAMBU_STALE_REPORT_SECONDS = 45


class BambuAmsMappingError(RuntimeError):
    """Raised when a sliced Bambu job cannot be mapped to the loaded AMS path."""


def _preview_metadata(value: object):
    if value is None or value is _BAMBU_PREVIEW_FAILED:
        return None
    return value if hasattr(value, "filament_weight_g") else None


def _queue_preview_metadata(printer_id: str):
    """Return queued 3MF metadata when live FTP preview metadata is unavailable."""
    row = db.queue_active_job(printer_id)
    if not row:
        return None
    if not any(row.get(k) is not None for k in ("filament_weight_g", "filament_type", "filament_colors")):
        return None
    return SimpleNamespace(
        filament_weight_g=row.get("filament_weight_g"),
        filament_type=row.get("filament_type"),
        filament_colors=row.get("filament_colors"),
    )


def _bambu_physical_start_confirmed(job: Optional[JobStatus], temps: dict[str, TempReading]) -> bool:
    if any(float((reading.target if reading else 0) or 0) > 0 for reading in temps.values()):
        return True
    if job and float(job.progress or 0) > 0.001:
        return True
    return False


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
    "GFA01": {
        "brand": "Bambu Lab",
        "profile": "Bambu PLA Matte",
        "material": "PLA",
        "tray_info_idx": "GFA01",
        "tray_type": "PLA",
        "nozzle_temp_min": 190,
        "nozzle_temp_max": 250,
    },
    "GFA19": {
        "brand": "Bambu Lab",
        "profile": "Bambu PLA Pure",
        "material": "PLA",
        "tray_info_idx": "GFA19",
        "tray_type": "PLA",
        "nozzle_temp_min": 190,
        "nozzle_temp_max": 240,
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
    "GFG98": {
        "brand": "Generic",
        "profile": "Generic PETG-CF",
        "material": "PETG-CF",
        "tray_info_idx": "GFG98",
        "tray_type": "PETG-CF",
        "nozzle_temp_min": 240,
        "nozzle_temp_max": 270,
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
                        filament_ids: list[int] | None = None,
                        regular_ams_slots: int = 0,
                        ) -> bool:
        """Start a 3MF with BambuStudio-style AMS mapping fields.

        bambulabs_api 2.6.6 only sends the legacy flat ams_mapping. Newer Bambu
        firmware, especially H2D with AMS 2 / AMS HT, expects ams_mapping2 as
        well or it can pause with 0700-8012 "Failed to get AMS mapping table".
        filament_ids are the sequential slot indices from the 3MF plate JSON
        (BambuStudio's own tray numbering); they override the default flat
        ams_mapping values for AMS HT slots so the firmware lookup succeeds.
        regular_ams_slots is the total slot count across all non-HT AMS units
        (n_regular_units * 4), used to compute the correct ams_id for AMS HT.
        """
        if skip_objects is not None and not skip_objects:
            skip_objects = None

        if isinstance(plate_number, int):
            plate_location = f"Metadata/plate_{int(plate_number)}.gcode"
        else:
            plate_location = plate_number

        flat_mapping, detailed_mapping = _build_bambu_ams_mappings(ams_mapping, filament_ids, regular_ams_slots)
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


    def start_calibration(
        self,
        bed_leveling: bool = False,
        vibration: bool = False,
        motor_noise: bool = False,
        nozzle_offset: bool = False,
        high_temp_heatbed: bool = False,
    ) -> bool:
        option = 0
        if bed_leveling:
            option |= 1 << 1
        if vibration:
            option |= 1 << 2
        if motor_noise:
            option |= 1 << 3
        if nozzle_offset:
            option |= 1 << 4
        if high_temp_heatbed:
            option |= 1 << 5
        if option == 0:
            return False
        return self._PrinterMQTTClient__publish_command({
            "print": {
                "command": "calibration",
                "option": option,
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
        self._physical_start_confirmed = False
        self._current_print_id: Optional[int] = None  # prints.id for the active job
        self._error_print_id: Optional[int] = None    # prints.id of the last error (for snapshot)
        self._last_finished_print_id: Optional[int] = None
        self._last_timelapse_path: Optional[str] = None
        self._ams_slot_snapshot: dict[int, dict] = {}      # slot_index → slot info at print start
        self._ams_slot_snapshot_print_id: Optional[int] = None  # print_id the snapshot belongs to
        self._ams_active_slot_at_start: Optional[int] = None    # canonical AMS slot at print start

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
            timelapse_state = _read_bambu_timelapse_state(print_data)
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
            if not subtask:
                subtask = _resolve_bambu_job_subtask(self.id, filename)
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

            state = self._resolve_state(raw_state, job, subtask, alarm_message, temps)

            if (state == "printing"
                    and self._current_print_id is not None
                    and self._ams_slot_snapshot_print_id != self._current_print_id):
                # Never FTP on the status poll path — a hung FTPS session wedged the
                # whole Flightdeck API (queue/printers). Prefer queue metadata; hydrate
                # via FTP only from explicit preview endpoints / print-end.
                self._hydrate_print_preview_metadata(self._current_print_id, allow_ftp=False)
                raw_snap = _snapshot_ams_slots(print_data)
                self._ams_slot_snapshot = raw_snap
                self._ams_slot_snapshot_print_id = self._current_print_id
                active_slots = [slot_idx for slot_idx, slot_data in raw_snap.items() if slot_data.get("active")]
                self._ams_active_slot_at_start = active_slots[0] if len(active_slots) == 1 else None
                # Enrich snapshot with current spool assignments and persist to DB
                enriched: dict[str, dict] = {}
                for slot_idx, slot_data in raw_snap.items():
                    spool = db.get_spool_at_slot(self.id, slot_idx)
                    if spool is None:
                        flat_slot = _safe_int(slot_data.get("flat_slot"))
                        if flat_slot is not None and flat_slot != slot_idx:
                            spool = db.get_spool_at_slot(self.id, flat_slot)
                    enriched[str(slot_idx)] = {
                        **slot_data,
                        "spool_id": spool["id"] if spool else None,
                        "remaining_g_at_start": spool["remaining_g"] if spool else None,
                    }
                    if spool is None and slot_data.get("active"):
                        db.log_decision(
                            self.id,
                            "spool_missing",
                            f"No spool assigned to {_ams_slot_decision_label(slot_idx)}",
                            print_id=self._current_print_id,
                        )
                if self._ams_active_slot_at_start is not None:
                    enriched["__meta__"] = {"active_slot": self._ams_active_slot_at_start}
                db.write_slot_snapshot(self._current_print_id, enriched)
                log.info("AMS slot snapshot for %s print_id=%d: slots=%s active=%s",
                         self.id, self._current_print_id, list(raw_snap.keys()),
                         self._ams_active_slot_at_start)

            if (state == "printing"
                    and self._current_print_id is not None
                    and self._ams_slot_snapshot_print_id == self._current_print_id
                    and job and job.progress is not None):
                pv = self._hydrate_print_preview_metadata(self._current_print_id, allow_ftp=False)
                if pv and pv.filament_weight_g:
                    try:
                        db.deduct_spool_usage_progress(
                            self.id,
                            self._current_print_id,
                            pv.filament_weight_g,
                            job.progress,
                            active_slot=self._ams_active_slot_at_start,
                            filament_usage=_preview_filament_requirements(pv.filament_colors, pv.filament_type),
                        )
                    except Exception as exc:
                        log.exception("Bambu live spool deduction failed for %s print_id=%s", self.id, self._current_print_id)
                        db.log_decision(
                            self.id,
                            "spool_deduction_error",
                            f"Live spool deduction failed without changing printer state: {exc}",
                            print_id=self._current_print_id,
                        )

            if state == "idle":
                job = None  # MQTT retains last-print data; don't surface it as active

            idle_info: dict[str, str] = {}
            if state == "idle":
                last = db.get_last_print(self.id)
                if last:
                    idle_info["Last print"] = _fmt_last_print(last)

            extruder_map = _read_ams_extruder_map(print_data)
            try:
                ams = _parse_ams(
                    print_data,
                    extruder_map=extruder_map,
                    model_name=self.model_name,
                )
            except Exception:
                ams = []
            maintenance = _parse_care(print_data)
            toolheads = _parse_h_series_nozzles(print_data, self.model_name)

            now = datetime.utcnow()
            self._last_seen = now
            return PrinterStatus(
                id=self.id, model_name=self.model_name, custom_name=self.custom_name,
                icon=self.icon, kind="bambu", state=state,
                temps=temps, job=job, substage=substage,
                idle_info=idle_info, ams=ams, toolheads=toolheads,
                maintenance=maintenance, light_state=light_state, timelapse_state=timelapse_state,
                fan_speed=fan_speeds.get("part"),
                fan_speeds=fan_speeds,
                error=alarm_message if state in ("paused", "error") else None,
                last_seen=now, updated_at=now,
            )
        except Exception as exc:
            return PrinterStatus(id=self.id, model_name=self.model_name,
                                 custom_name=self.custom_name, icon=self.icon,
                                 kind="bambu", state="error", error=str(exc))

    def mqtt_debug_snapshot(self) -> dict:
        """Return the last raw MQTT dump plus connection metadata.

        This is read-only and intended for H-series field discovery, such as
        finding where H2C hotend rack state appears in Bambu's MQTT payload.
        Redaction is applied by the API layer before returning this data.
        """
        if not self._connected:
            raise RuntimeError("Bambu MQTT is not connected")
        mc = self._printer.mqtt_client
        return {
            "id": self.id,
            "model_name": self.model_name,
            "custom_name": self.custom_name,
            "connected": bool(self._connected),
            "mqtt_connected": bool(mc.is_connected()),
            "report_age_seconds": mc.report_age_seconds(),
            "last_report_wall": mc.last_report_wall() or self._last_seen,
            "snapshot_at": datetime.utcnow(),
            "mqtt_dump": self._printer.mqtt_dump(),
        }

    def _resolve_state(self, raw: bl.GcodeState, job: Optional[JobStatus],
                       subtask: Optional[str], alarm_message: Optional[str] = None,
                       temps: Optional[dict[str, TempReading]] = None) -> str:
        now = datetime.now(timezone.utc)

        if raw == bl.GcodeState.FINISH:
            self._estimated_stored = False
            self._job_started_at = 0.0
            self._seen_finish_this_session = True
            if self._current_job_key:
                if not self._physical_start_confirmed:
                    print_id = db.on_print_ended(
                        self.id,
                        self._current_job_key,
                        final_state="ERROR",
                        layers_completed=0,
                        error_message="Printer accepted start command but finished without heating or progressing",
                    )
                    if print_id:
                        db.log_decision(
                            self.id,
                            "ghost_start_resolved",
                            "FINISH seen with no physical start proof; closed as ERROR and skipped spool deduction",
                            print_id=print_id,
                        )
                    self._current_job_key = None
                    self._current_print_id = None
                    self._ams_active_slot_at_start = None
                    self._preview_cache = None
                    self._physical_start_confirmed = False
                    return "idle"
                filament_g = material = filament_usage = None
                pv = self._hydrate_print_preview_metadata(self._current_print_id) if self._current_print_id else None
                if pv is None:
                    pv = _queue_preview_metadata(self.id)
                if pv:
                    filament_g = pv.filament_weight_g
                    material = pv.filament_type
                    filament_usage = _preview_filament_requirements(pv.filament_colors, pv.filament_type)
                finished_print_id = db.on_print_finished(
                    self.id, self._current_job_key,
                    layers_completed=job.layer_current if job else None,
                    filament_grams=filament_g,
                    material=material,
                )
                if finished_print_id is None and self._current_print_id:
                    if db.on_print_finished_by_id(
                        self._current_print_id,
                        layers_completed=job.layer_current if job else None,
                        filament_grams=filament_g,
                        material=material,
                    ):
                        finished_print_id = self._current_print_id
                        db.log_decision(
                            self.id,
                            "finish_key_fallback",
                            f"Closed tracked print by id after finish key mismatch (key={self._current_job_key})",
                            print_id=finished_print_id,
                        )
                if finished_print_id and filament_g:
                    try:
                        db.deduct_spool_usage(
                            self.id, finished_print_id, filament_g,
                            active_slot=self._ams_active_slot_at_start,
                            filament_usage=filament_usage,
                        )
                    except Exception as exc:
                        log.exception("Bambu finish spool deduction failed for %s print_id=%s", self.id, finished_print_id)
                        db.log_decision(
                            self.id,
                            "spool_deduction_error",
                            f"Finish spool deduction failed without changing printer state: {exc}",
                            print_id=finished_print_id,
                        )
                elif finished_print_id and self._ams_slot_snapshot_print_id == finished_print_id:
                    db.log_decision(self.id, "spool_no_deduction_cancelled",
                                   "Print finished but filament weight unknown; no spool deduction",
                                   print_id=finished_print_id)
                self._last_finished_print_id = finished_print_id
                self._last_timelapse_path = _read_bambu_timelapse_path(self._printer.mqtt_dump())
                self._current_job_key = None
                self._current_print_id = None
                self._ams_active_slot_at_start = None
                self._preview_cache = None
                self._physical_start_confirmed = False
            else:
                # Service restarted during the print; close any open row as FINISHED
                # rather than leaving it orphaned for the stale-orphan sweep.
                closed_ids = db.close_open_prints(self.id, final_state="FINISHED")
                self._last_timelapse_path = _read_bambu_timelapse_path(self._printer.mqtt_dump())
                for pid in closed_ids:
                    self._last_finished_print_id = pid
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
            self._last_finished_print_id = None
            self._last_timelapse_path = None
            if self._seen_finish_this_session:
                closed_ids = db.close_open_prints(self.id, final_state="FINISHED")
                for pid in closed_ids:
                    db.log_decision(
                        self.id,
                        "finish_idle_cleanup",
                        "IDLE followed a finished state with an open print row; closed as FINISHED before clearing the finish window",
                        print_id=pid,
                    )
                db.clear_finished_at(self.id)
                self._seen_finish_this_session = False
                self._current_job_key = None
                self._current_print_id = None
                self._cancel_requested = False
                self._physical_start_confirmed = False
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
            self._preview_cache = None
            self._physical_start_confirmed = False
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
            self._last_finished_print_id = None
            self._last_timelapse_path = None
            if _bambu_physical_start_confirmed(job, temps or {}):
                self._physical_start_confirmed = True
            if self._current_job_key is None:
                self._current_job_key = self._make_job_key(subtask)
                self._preview_cache = None
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
                if print_id:
                    # Queue metadata only — FTP from status() stalls the whole API.
                    self._hydrate_print_preview_metadata(print_id, allow_ftp=False)
            if self._current_print_id and job is not None:
                live_layer = job.layer_current
                if live_layer is None and job.layer_total and job.progress is not None:
                    live_layer = int(max(0.0, min(1.0, job.progress)) * job.layer_total)
                db.update_print_live_progress(
                    self._current_print_id,
                    layers_completed=live_layer,
                    layers_total=job.layer_total,
                )
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
            self._physical_start_confirmed = False
            err_code = self._printer.mqtt_dump().get("print", {}).get("print_error", 0)

            if self._current_job_key:
                # In-session failure: close the job and start showing the error.
                # If the operator has already requested a cancel, treat Bambu's
                # retained FAILED state as the cancel resolving rather than a
                # reliability failure.
                job_key = self._current_job_key
                err_msg = alarm_message or (f"Bambu error: {err_code}" if err_code else "Print failed")
                operator_cancel = self._cancel_requested or _bambu_failed_is_operator_cancel(err_code, alarm_message)
                if operator_cancel:
                    print_id = db.on_print_ended(
                        self.id, job_key,
                        final_state="CANCELLED",
                        layers_completed=job.layer_current if job else None,
                    )
                    if print_id:
                        detail = "User-initiated cancel" if self._cancel_requested else "Printer-side operator cancel"
                        db.log_decision(self.id, "cancel_resolved",
                                       f"{detail} confirmed from Bambu FAILED state ({err_msg})",
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
                self._last_timelapse_path = _read_bambu_timelapse_path(self._printer.mqtt_dump())
                self._error_seen_at = time.monotonic()
                if print_id:
                    db.log_decision(self.id, "error_resolved", err_msg, print_id=print_id)
                return "error"

            if self._error_job_key:
                # Bambu can retain FAILED after the printer UI has been cleared.
                # Keep a real error visible, but release a closed, code-free fault
                # after a short grace period so queue preflight stops blocking.
                age = time.monotonic() - self._error_seen_at if self._error_seen_at else 999.0
                operator_cancel = self._cancel_requested or _bambu_failed_is_operator_cancel(err_code, alarm_message)
                if operator_cancel or (not err_code and age >= 15.0 and db.is_print_closed(self.id, self._error_job_key)):
                    if self._error_print_id:
                        db.log_decision(self.id, "error_cleared",
                                       "Bambu FAILED state retained after cancel; live fault cleared",
                                       print_id=self._error_print_id)
                    self._error_job_key = None
                    self._error_print_id = None
                    self._error_seen_at = 0.0
                    self._cancel_requested = False
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
                operator_cancel = _bambu_failed_is_operator_cancel(err_code, alarm_message)
                print_id = db.on_print_ended(
                    self.id, job_key,
                    final_state="CANCELLED" if operator_cancel else "ERROR",
                    layers_completed=job.layer_current if job else None,
                    error_message=None if operator_cancel else err_msg,
                )
                if print_id:
                    if operator_cancel:
                        db.log_decision(self.id, "cancel_resolved",
                                       "Printer-side operator cancel seen after service start",
                                       print_id=print_id)
                    else:
                        db.log_decision(self.id, "error_resolved",
                                       f"Stale error at service start: {err_msg}",
                                       print_id=print_id)
                if operator_cancel:
                    self._error_job_key = None
                    self._error_print_id = None
                    self._error_seen_at = 0.0
                    return "idle"
                self._error_job_key = job_key
                self._error_print_id = print_id
                self._last_timelapse_path = _read_bambu_timelapse_path(self._printer.mqtt_dump())
                self._error_seen_at = time.monotonic()
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
        self._publish_clean_print_error()

    def estop(self) -> None:
        self._cancel_requested = True
        self._printer.stop_print()  # Bambu MQTT has no dedicated e-stop
        self._publish_clean_print_error()

    def _publish_clean_print_error(self) -> None:
        """Dismiss a retained FAILED/HMS banner so the printer can go idle."""
        try:
            client = self._printer.mqtt_client
            client._PrinterMQTTClient__publish_command({
                "print": {"command": "clean_print_error", "sequence_id": "0"},
            })
        except Exception:
            log.debug("Bambu clean_print_error publish failed", exc_info=True)

    def start_calibration(
        self,
        *,
        bed_leveling: bool = True,
        vibration: bool = True,
        motor_noise: bool = True,
        nozzle_offset: bool = False,
        high_temp_heatbed: bool = False,
    ) -> None:
        client = self._printer.mqtt_client
        if not hasattr(client, "start_calibration"):
            raise RuntimeError("Calibration not supported for this printer connection")
        if not client.start_calibration(
            bed_leveling=bed_leveling,
            vibration=vibration,
            motor_noise=motor_noise,
            nozzle_offset=nozzle_offset,
            high_temp_heatbed=high_temp_heatbed,
        ):
            raise RuntimeError("Bambu calibration command was not accepted")

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

    def set_ams_slot_filament(self, slot: int, spool: Optional[dict], profile_override: Optional[dict] = None) -> bool:
        ams_id, tray_id = _split_ams_slot(slot)
        if spool is None:
            return self._printer.mqtt_client._PrinterMQTTClient__publish_command({
                "print": {
                    "command": "ams_filament_setting",
                    "ams_id": ams_id,
                    "tray_id": tray_id,
                    "slot_id": 0 if ams_id >= 128 else tray_id,
                    "tray_info_idx": "",
                    "tray_color": "00000000",
                    "nozzle_temp_min": 0,
                    "nozzle_temp_max": 0,
                    "tray_type": "",
                    "tray_sub_brands": "",
                    "tray_id_name": "",
                    "sequence_id": "0",
                }
            })

        if profile_override:
            payload = _ams_profile_override_payload(spool, profile_override, ams_id, tray_id)
            return self._printer.mqtt_client._PrinterMQTTClient__publish_command({"print": payload})

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
        try:
            dump = self._printer.mqtt_dump().get("print", {})
            ams = dump.get("ams", {}) or {}
            units = ams.get("ams", [])
            if slot is None:
                # Unload-without-slot: heat to whatever tray_now still has loaded.
                tray_now = int(ams.get("tray_now", 255))
                if tray_now < 0 or tray_now >= 254:
                    return ""
                regular_ams_slots = _regular_ams_slot_count(units)
                for unit_data in units:
                    unit_id = int(unit_data.get("id", 0))
                    for tray_data in unit_data.get("tray", []):
                        tray_id = int(tray_data.get("id", 0))
                        slot_index = _bambu_slot_index(unit_id, tray_id)
                        if tray_now == _bambu_tray_target(slot_index, regular_ams_slots):
                            return str(tray_data.get("tray_type") or "")
                return ""
            unit_id, tray_id = _split_ams_slot(slot)
            for unit_data in units:
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

    def jog_axis(self, axis: str, distance: float, speed: int | float | None = None) -> None:
        axis_key = str(axis or "").strip().lower()
        if axis_key not in {"x", "y", "z"}:
            raise ValueError("invalid jog axis")
        limit = 50.0 if axis_key in {"x", "y"} else 10.0
        delta = max(-limit, min(limit, float(distance)))
        if abs(delta) < 0.01:
            raise ValueError("distance must be non-zero")
        default_speed = 3000 if axis_key in {"x", "y"} else 600
        feed = int(speed or default_speed)
        feed = max(60, min(6000, feed))
        ok = self._printer.gcode([
            "G91",
            f"G1 {axis_key.upper()}{delta:.2f} F{feed}",
            "G90",
        ])
        if not ok:
            raise RuntimeError(f"Bambu {axis_key.upper()} jog command was not accepted")

    def get_preview(self):
        """Return cached BambuPreview, fetching via FTP if the job changed."""
        if not self._connected:
            return None
        subtask = self._printer.subtask_name()
        filename = self._printer.get_file_name()
        plate_number = _plate_number(filename)
        if not subtask:
            subtask = _resolve_bambu_job_subtask(self.id, filename)
        if not subtask:
            return None
        cache_key = f"{subtask}|plate:{plate_number or 1}"
        if self._preview_cache and self._preview_cache[0] == cache_key:
            val = self._preview_cache[1]
            return _preview_metadata(val)
        try:
            from .bambu_ftp import fetch_bambu_preview
            preview = fetch_bambu_preview(self._ip, self._access_code, subtask, plate_number=plate_number)
            self._preview_cache = (cache_key, preview)
            return preview
        except Exception as exc:
            log.warning("FTP preview failed for %s: %s", self.model_name, exc)
            self._preview_cache = (cache_key, _BAMBU_PREVIEW_FAILED)
            return None

    def _hydrate_print_preview_metadata(self, print_id: Optional[int], *, allow_ftp: bool = True):
        """Attach 3MF preview metadata when a print started outside Flightdeck."""
        if not print_id:
            return None
        pv = _preview_metadata(self._preview_cache[1]) if self._preview_cache else None
        if pv is None and allow_ftp:
            pv = _preview_metadata(self.get_preview())
        if pv is None:
            pv = _queue_preview_metadata(self.id)
        if pv and pv.filament_weight_g:
            db.update_print_filament_metadata(
                print_id,
                filament_grams=pv.filament_weight_g,
                material=pv.filament_type,
            )
            return pv
        if db.try_apply_relay_filament_metadata(
            print_id,
            log_event="print_filament_metadata_from_relay",
        ):
            prow = db.get_print_by_id(print_id)
            if prow and prow.get("filament_grams"):
                return SimpleNamespace(
                    filament_weight_g=prow.get("filament_grams"),
                    filament_type=prow.get("material"),
                    filament_colors=None,
                )
        if pv:
            db.update_print_filament_metadata(
                print_id,
                filament_grams=pv.filament_weight_g,
                material=pv.filament_type,
            )
        return pv

    def get_objects(self) -> dict:
        """Return skip-object candidates parsed from the current 3MF metadata."""
        preview = self.get_preview()
        if not preview or not preview.objects:
            return {
                "supported": False,
                "mode": "bambu_skip_objects",
                "label": "Bambu skip objects",
                "objects": [],
                "detail": "No skip-object metadata found. Enable Label objects and Exclude objects in Orca/Bambu Studio, then reslice/send the job.",
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
            "bed_bounds": preview.bed_bounds,
            "bbox_all": preview.bbox_all,
            "plate_image_url": f"/api/printers/{self.id}/thumbnail",
            "plate_top_image_url": f"/api/printers/{self.id}/thumbnail?view=top",
            "map_rotation": 0,
            "map_image_rotation": 0,
            "map_image_offset_x": 0,
            "map_image_offset_y": 0,
            "map_image_mode": "top_down",
            "map_view": "top_down",
            "detail": "Bambu object exclusion uses the printer skip-object list and 3MF object positions.",
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
        print_data = dump.get("print", {})
        extruder_map = _read_ams_extruder_map(print_data)
        units = list(_parse_ams(
            print_data,
            extruder_map=extruder_map,
            model_name=self.model_name,
        ))
        # Regular AMS units (unit_id < 128) each occupy 4 sequential print-command slots.
        # AMS HT (unit_id >= 128) follows sequentially after all regular units.
        n_regular_units = sum(1 for u in units if int(u.get("unit", 0)) < 128)
        regular_ams_slots = _regular_ams_slot_count(units)
        slots = []
        for unit in units:
            unit_id = int(unit.get("unit", 0))
            nozzle = unit.get("nozzle")
            if nozzle not in (0, 1):
                nozzle = extruder_map.get(unit_id)
            if nozzle is None and self.model_name.upper() == "H2D":
                # H-series nozzle IDs are 0=left, 1=right. H2D regular AMS
                # feeds the left path, while AMS HT feeds the right path.
                nozzle = 1 if unit_id >= 128 else 0
            if nozzle is None and self.model_name.upper() == "H2C":
                # H2C regular AMS feeds the right toolhead path; AMS HT feeds left.
                nozzle = 0 if unit_id >= 128 else 1
            for slot in unit.get("slots") or []:
                if slot.get("empty"):
                    continue
                slot_idx = int(slot.get("idx", 0))
                flat_idx = _bambu_slot_index(unit_id, slot_idx)
                bambu_tray_id = _bambu_tray_target(flat_idx, regular_ams_slots)
                slots.append({
                    **slot,
                    "unit": unit_id,
                    "global_idx": flat_idx,
                    "bambu_tray_id": bambu_tray_id,
                    **({"nozzle": nozzle} if nozzle in (0, 1) else {}),
                })
        return slots

    def send_file(self, file_path: str, filename: str, plate_number: Optional[int] = None) -> None:
        """Upload a .gcode.3mf to the printer via FTPS then send the MQTT print command."""
        from .bambu_ftp import upload_bambu_file
        with open(file_path, "rb") as f:
            data = f.read()
        try:
            requested_plate = int(plate_number) if plate_number is not None else None
        except (TypeError, ValueError):
            requested_plate = None
        preview = upload_bambu_file(
            self._ip, self._access_code, filename, data, plate_number=requested_plate,
        )
        subtask_name = filename.removesuffix(".gcode.3mf")
        if preview and preview.image_png:
            self.seed_preview(subtask_name, preview)

        filament_ids = preview.filament_ids if preview else None
        print_plate_number = requested_plate or (
            preview.print_plate_number if preview and preview.print_plate_number else 1
        )
        slots = self.ams_slots()
        ams_mapping, mapping_note = _derive_bambu_ams_mapping(
            preview.filament_colors if preview else None,
            preview.filament_type if preview else None,
            slots,
        )
        # Count regular AMS units from MQTT so we can compute ams_id=128 for AMS HT.
        ams_raw = (self._printer.mqtt_dump().get("print") or {}).get("ams") or {}
        regular_ams_slots = _regular_ams_slot_count(ams_raw.get("ams", []))
        flat_mapping, detailed_mapping = _build_bambu_ams_mappings(ams_mapping, filament_ids, regular_ams_slots)
        db.log_decision(self.id, "queue_bambu_mapping", json.dumps({
            "file": filename,
            "ams_mapping": ams_mapping,
            "filament_ids": filament_ids,
            "flat_ams_mapping": flat_mapping,
            "ams_mapping2": detailed_mapping,
            "mapping_note": mapping_note,
            "regular_ams_slots": regular_ams_slots,
            "print_plate_number": print_plate_number,
        }))
        self.start_uploaded_3mf(filename, ams_mapping, filament_ids=filament_ids,
                                 regular_ams_slots=regular_ams_slots,
                                 plate_number=print_plate_number)

    def start_uploaded_3mf(self, filename: str, ams_mapping: list[int],
                            filament_ids: list[int] | None = None,
                            regular_ams_slots: int = 0,
                            plate_number: int = 1) -> bool:
        """Start an uploaded 3MF using the H2D-safe AMS mapping payload."""
        return self._printer.mqtt_client.start_print_3mf(
            filename, plate_number, True, ams_mapping, filament_ids=filament_ids,
            regular_ams_slots=regular_ams_slots,
        )

    def hms_summary(self) -> Optional[str]:
        """Latest HMS warning/error text from MQTT, if any."""
        try:
            return bambu_hms_summary(self._printer.mqtt_dump())
        except Exception:
            return None


def _read_dual_nozzle_temps(mqtt_dump: dict, model_name: str) -> dict[str, "TempReading"]:
    """Return {hotend_l, hotend_r} TempReadings for H-series dual-nozzle printers.

    H2D extruder encoding in device.extruder.info[]:
      - Primary extruder (id=0, Right): packed (actual<<16)|target  e.g. 17694990=(270<<16)|270
      - Secondary extruder (id=1, Left): plain int when temp>>16==0  e.g. 77 → 77°C
    Assignment confirmed: nozzle_temper tracks extruder[0] (Right); extruder[1] is Left.
    """
    if not str(model_name or "").upper().startswith("H"):
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


def _parse_h_series_nozzles(print_data: dict, model_name: str) -> list[dict]:
    """Return H-series toolhead/rack state from Bambu's device.nozzle payload."""
    if not str(model_name or "").upper().startswith("H"):
        return []
    device = print_data.get("device", {}) if isinstance(print_data, dict) else {}
    nozzle = device.get("nozzle", {}) if isinstance(device, dict) else {}
    info = nozzle.get("info", []) if isinstance(nozzle, dict) else []
    if not isinstance(info, list):
        return []

    src_id = _safe_int(nozzle.get("src_id"))
    tar_id = _safe_int(nozzle.get("tar_id"))
    tools: list[dict] = []
    for raw in info:
        if not isinstance(raw, dict):
            continue
        nozzle_id = _safe_int(raw.get("id"))
        if nozzle_id is None:
            continue
        serial = str(raw.get("sn") or "").strip()
        has_physical = bool(serial and serial.upper() != "N/A")
        colour = _norm_bambu_hex(raw.get("color_m")) or ""
        filament_id = str(raw.get("fila_id") or "").strip()
        diameter = _safe_float(raw.get("diameter"))
        max_temp = _safe_int(raw.get("tm"))
        usage_raw = _safe_int(raw.get("p_t"))

        if nozzle_id in (0, 1):
            # H2D uses the opposite toolhead-id sense from extruder temps (0=left).
            # H2C aligns MQTT toolhead ids with extruder ids: 0=right, 1=left.
            model_key = str(model_name or "").upper()
            if model_key == "H2C":
                position = "right" if nozzle_id == 0 else "left"
                label = "Right nozzle" if nozzle_id == 0 else "Left nozzle"
                flightdeck_nozzle = 1 if nozzle_id == 0 else 0
            else:
                position = "left" if nozzle_id == 0 else "right"
                label = "Left nozzle" if nozzle_id == 0 else "Right nozzle"
                flightdeck_nozzle = nozzle_id
            zone = "toolhead"
            slot = nozzle_id
        elif nozzle_id >= 16:
            position = "rack"
            rack_slot = nozzle_id - 15
            label = f"Rack {rack_slot}"
            zone = "rack"
            slot = rack_slot
        else:
            position = "unknown"
            label = f"Nozzle {nozzle_id}"
            zone = "unknown"
            slot = nozzle_id

        tools.append({
            "idx": slot,
            "id": nozzle_id,
            "label": label,
            "position": position,
            "zone": zone,
            "loaded": zone == "toolhead" and has_physical,
            "present": has_physical,
            "active": nozzle_id in (src_id, tar_id),
            "serial": serial if has_physical else "",
            "type": str(raw.get("type") or "").strip(),
            "diameter": diameter,
            "max_temp": max_temp,
            "usage": usage_raw,
            "color": colour,
            "filament_id": filament_id,
            "wear": _safe_int(raw.get("wear")),
            **({"nozzle": flightdeck_nozzle} if zone == "toolhead" else {}),
        })

    return sorted(tools, key=lambda item: (0 if item.get("zone") == "toolhead" else 1, item.get("idx") or 0))


def _read_ams_extruder_map(print_data: dict) -> dict[int, int]:
    """Return AMS unit -> H-series nozzle target where 0=left and 1=right."""
    ams_raw = print_data.get("ams", {}) if isinstance(print_data, dict) else {}
    candidates = [
        print_data.get("ams_extruder_map") if isinstance(print_data, dict) else None,
        ams_raw.get("ams_extruder_map") if isinstance(ams_raw, dict) else None,
    ]
    for candidate in candidates:
        if not candidate:
            continue
        if isinstance(candidate, str):
            try:
                candidate = json.loads(candidate)
            except Exception:
                pairs = re.findall(r"(\d+)\s*[:=]\s*(\d+)", candidate)
                if pairs:
                    return {int(k): int(v) for k, v in pairs if int(v) in (0, 1)}
                continue
        if isinstance(candidate, dict):
            out = {}
            for key, value in candidate.items():
                try:
                    nozzle = int(value)
                    if nozzle in (0, 1):
                        out[int(key)] = nozzle
                except (TypeError, ValueError):
                    continue
            if out:
                return out
        if isinstance(candidate, list):
            out = {}
            for row in candidate:
                if not isinstance(row, dict):
                    continue
                unit = row.get("ams_id", row.get("id", row.get("unit")))
                nozzle = row.get("extruder", row.get("nozzle", row.get("target")))
                try:
                    nozzle_i = int(nozzle)
                    if nozzle_i in (0, 1):
                        out[int(unit)] = nozzle_i
                except (TypeError, ValueError):
                    continue
            if out:
                return out
    return {}


def _build_bambu_ams_mappings(
    ams_mapping: list[int] | None,
    filament_ids: list[int] | None = None,
    regular_ams_slots: int = 0,
) -> tuple[list[int], list[dict]]:
    """Return legacy flat ams_mapping plus detailed ams_mapping2.

    The H2D gcode uses T[project_filament_idx] and M620 S[project_filament_idx]A.
    The firmware resolves these by looking up ams_mapping[project_filament_idx].
    When filament_ids is provided (the 0-based project filament indices used on
    the plate, from plate_N.json), the output is expanded to a project-indexed
    array so ams_mapping[filament_ids[i]] = physical tray for plate slot i.
    Unused project filament slots are filled with -1 / {255,255}.

    Without filament_ids (X1C / single-AMS prints), the output is plate-indexed
    and matches the existing behaviour where ams_mapping[plate_slot_i] = tray.

    regular_ams_slots: total number of slots across all regular (non-HT) AMS
    units, i.e. n_regular_units * 4.  When non-zero, flat tray IDs that equal
    or exceed this value are treated as AMS HT slots and get ams_id=128 in
    ams_mapping2, matching the unit_id the firmware reports in MQTT status.
    """
    flat: list[int] = []
    detailed: list[dict] = []
    for raw_id in (ams_mapping or []):
        tray_id = int(raw_id) if raw_id is not None else -1
        if tray_id < 0:
            flat.append(-1)
            detailed.append({"ams_id": 255, "slot_id": 255})
        elif tray_id >= 254:
            flat.append(-1)
            detailed.append({"ams_id": 255, "slot_id": 0})
        else:
            flat.append(tray_id)
            if regular_ams_slots > 0 and tray_id >= regular_ams_slots:
                # AMS HT slot: ams_id matches the MQTT unit_id (128), slot_id
                # is the offset within the HT unit.
                detailed.append({"ams_id": 128, "slot_id": tray_id - regular_ams_slots})
            else:
                # Regular AMS: sequential unit numbering within 4-slot units.
                detailed.append({"ams_id": tray_id // 4, "slot_id": tray_id % 4})

    # When filament_ids are present, remap from plate-slot-indexed to
    # project-filament-indexed so the firmware can look up T4 as ams_mapping[4].
    if filament_ids and len(filament_ids) == len(flat):
        size = max(filament_ids) + 1
        proj_flat = [-1] * size
        proj_detailed: list[dict] = [{"ams_id": 255, "slot_id": 255}] * size
        for i, proj_idx in enumerate(filament_ids):
            proj_flat[proj_idx] = flat[i]
            proj_detailed[proj_idx] = detailed[i]
        return proj_flat, proj_detailed

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


def _bambu_subtask_from_filename(filename: Optional[str]) -> Optional[str]:
    if not filename or _is_plate_gcode(filename):
        return None
    name = str(filename).strip().split("?", 1)[0].rsplit("/", 1)[-1].rsplit("\\", 1)[-1]
    if not name or name in {".", ".."}:
        return None
    lower = name.lower()
    for suffix in (".gcode.3mf", ".3mf", ".gcode.gz", ".gcode"):
        if lower.endswith(suffix):
            name = name[: -len(suffix)]
            break
    return name.strip() or None


def _resolve_bambu_job_subtask(printer_id: str, filename: Optional[str]) -> Optional[str]:
    if _is_plate_gcode(filename):
        return _active_queue_subtask(printer_id)
    return _bambu_subtask_from_filename(filename) or _active_queue_subtask(printer_id)


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


def _bambu_colour_family(color: Optional[str]) -> str:
    color = _norm_bambu_hex(color)
    if not color:
        return ""
    rgb = [int(color[i:i + 2], 16) for i in (1, 3, 5)]
    spread = max(rgb) - min(rgb)
    avg = sum(rgb) / 3
    if spread <= 45:
        if avg <= 45:
            return "black"
        if avg >= 220:
            return "white"
        return "grey_silver"
    return ""


def _bambu_colour_matches(actual: Optional[str], expected: Optional[str]) -> bool:
    if not expected:
        return True
    if _bambu_hex_dist(actual, expected) <= 95:
        return True
    return bool(_bambu_colour_family(actual) == _bambu_colour_family(expected) == "grey_silver")


def _bambu_nozzle_label(nozzle: Optional[int]) -> str:
    return "left nozzle" if nozzle == 0 else "right nozzle" if nozzle == 1 else "unknown nozzle"


def _bambu_slot_label(slot: dict) -> str:
    unit = int(slot.get("unit") or 0)
    slot_idx = int(slot.get("idx") or 0)
    bay = "AMS HT" if unit >= 128 else f"AMS {unit + 1} slot {slot_idx + 1}"
    nozzle = slot.get("nozzle")
    return f"{bay} / {_bambu_nozzle_label(nozzle)}"


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
            item = {"color": color, "material": material, "used_g": row.get("used_g")}
            try:
                nozzle = int(row.get("nozzle"))
                if nozzle in (0, 1):
                    item["nozzle"] = nozzle
            except (TypeError, ValueError):
                pass
            out.append(item)
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
        nozzle = req.get("nozzle")
        enforce_nozzle_path = nozzle in (0, 1) and any("nozzle" in slot for slot in material_matches)
        if enforce_nozzle_path:
            nozzle_matches = [slot for slot in material_matches if slot.get("nozzle") == nozzle]
            if nozzle_matches:
                colour_matches = [
                    slot for slot in nozzle_matches
                    if _bambu_colour_matches(slot.get("color_norm"), req.get("color"))
                ]
                if colour_matches:
                    material_matches = colour_matches
                else:
                    other_path = [
                        slot for slot in material_matches
                        if slot.get("nozzle") != nozzle
                        and _bambu_colour_matches(slot.get("color_norm"), req.get("color"))
                    ]
                    wanted = " ".join(p for p in [req.get("material"), req.get("color")] if p) or "filament"
                    if other_path:
                        raise BambuAmsMappingError(
                            f"H2D AMS mapping blocked: sliced filament {wanted} is assigned to "
                            f"{_bambu_nozzle_label(nozzle)}, but the matching loaded tray is "
                            f"{_bambu_slot_label(other_path[0])}. Move that filament to the correct AMS path "
                            "or re-slice the job for the nozzle fed by that AMS."
                        )
                    raise BambuAmsMappingError(
                        f"H2D AMS mapping blocked: sliced filament {wanted} is assigned to "
                        f"{_bambu_nozzle_label(nozzle)}, but no matching loaded tray is available on that AMS path."
                    )
            else:
                wanted = " ".join(p for p in [req.get("material"), req.get("color")] if p) or "filament"
                raise BambuAmsMappingError(
                    f"H2D AMS mapping blocked: sliced filament {wanted} is assigned to "
                    f"{_bambu_nozzle_label(nozzle)}, but Flightdeck cannot see any loaded AMS tray feeding that nozzle."
                )
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
            f"{' nozzle=' + ('R' if nozzle == 0 else 'L') if nozzle in (0, 1) else ''}"
            f"->{best['bambu_tray_id']} {best.get('type') or ''} {best.get('color') or ''}"
        )

    return mapping or [0], "; ".join(notes)


def _read_bambu_timelapse_path(mqtt_dump: dict) -> Optional[str]:
    """Return the printer-reported timelapse path from Bambu MQTT, if present."""
    print_data = (mqtt_dump or {}).get("print") or {}
    device = print_data.get("device") if isinstance(print_data, dict) else {}
    cam = (device or {}).get("cam") if isinstance(device, dict) else {}
    if not isinstance(cam, dict):
        return None
    for key in ("timelapse_path", "timelapse"):
        value = cam.get(key)
        if value and str(value).strip():
            return str(value).strip()
    return None


def _read_bambu_timelapse_state(print_data: dict) -> Optional[str]:
    """Return Bambu's live timelapse enable/disable state when reported."""
    ipcam = print_data.get("ipcam") if isinstance(print_data, dict) else {}
    if not isinstance(ipcam, dict):
        return None
    value = str(ipcam.get("timelapse") or "").strip().lower()
    return value if value in {"enable", "disable"} else None


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
    "18008012": 'Failed to get AMS mapping table; please select "Resume" to retry.',
    "1E07008012": 'Failed to get AMS mapping table; please select "Resume" to retry.',
    "07008012": 'Failed to get AMS mapping table; please select "Resume" to retry.',
    "07FF8012": 'Failed to get AMS mapping table; please select "Resume" to retry.',
    "117473298": 'Failed to get AMS mapping table; please select "Resume" to retry.',
}

# Common HMS codes (attr/code → XXXX-XXXX-XXXX-XXXX) with wiki-style text.
_BAMBU_HMS_MESSAGES = {
    "0500-0300-0002-000E": (
        "Printer HMS 0500-0300-0002-000E (module/firmware compatibility advisory)."
    ),
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


def _format_bambu_hms_code(attr, code) -> str:
    """Decode Bambu HMS attr/code ints into XXXX-XXXX-XXXX-XXXX."""
    try:
        a = int(attr)
        c = int(code)
    except (TypeError, ValueError):
        return ""
    if a == 0 and c == 0:
        return ""
    return (
        f"{(a >> 16) & 0xFFFF:04X}-{(a & 0xFFFF):04X}-"
        f"{(c >> 16) & 0xFFFF:04X}-{(c & 0xFFFF):04X}"
    )


def _bambu_hms_entries(mqtt_dump: Optional[dict]) -> list[dict]:
    print_data = (mqtt_dump or {}).get("print") if isinstance(mqtt_dump, dict) else None
    raw = (print_data or {}).get("hms") if isinstance(print_data, dict) else None
    if not isinstance(raw, list):
        return []
    out: list[dict] = []
    seen: set[str] = set()
    for row in raw:
        if not isinstance(row, dict):
            continue
        code = _format_bambu_hms_code(row.get("attr"), row.get("code"))
        if not code or code in seen:
            continue
        seen.add(code)
        text = _BAMBU_HMS_MESSAGES.get(code) or f"Printer HMS {code}"
        out.append({"code": code, "message": text})
    return out


def bambu_hms_summary(mqtt_dump: Optional[dict]) -> Optional[str]:
    """Short user-facing HMS summary for queue/Live errors."""
    entries = _bambu_hms_entries(mqtt_dump)
    if not entries:
        return None
    parts = []
    for entry in entries[:3]:
        code = entry["code"]
        msg = entry["message"]
        if msg.startswith("Printer HMS "):
            parts.append(msg)
        else:
            parts.append(f"{msg} [{code}]")
    extra = len(entries) - len(parts)
    if extra > 0:
        parts.append(f"+{extra} more")
    return "; ".join(parts)


def _bambu_failed_is_operator_cancel(err_code, alarm_message: Optional[str]) -> bool:
    """Bambu reports printer-screen Stop as FAILED; 0300-400C is 'Printing was cancelled'."""
    code = _normalise_bambu_alarm_code(err_code)
    if code.endswith("0300400C") or code == "50348044":
        return True
    msg = (alarm_message or "").lower()
    if "0300-400c" in msg or "printing was cancelled" in msg:
        return True
    return not alarm_message and not code


def _bambu_slot_index(unit_id: int, tray_id: int) -> int:
    """Return Flightdeck's canonical AMS slot index."""
    return int(unit_id) + int(tray_id) if int(unit_id) >= 128 else int(unit_id) * 4 + int(tray_id)


def _ams_unit_id(unit_data: dict) -> int:
    for key in ("id", "unit"):
        if key in unit_data:
            try:
                return int(unit_data.get(key) or 0)
            except (TypeError, ValueError):
                return 0
    return 0


def _regular_ams_slot_count(units: list[dict] | None) -> int:
    """Flat slot boundary before AMS HT trays in project_file mapping.

    Only meaningful when an AMS HT unit (id >= 128) is present. Printers with
    only regular AMS — including a lone AMS 2 at unit id 1 — must use 0 so
    trays like 6 map to ams_id 1 / slot 2 instead of being misclassified as HT.
    """
    ams_units = units or []
    if not any(_ams_unit_id(u) >= 128 for u in ams_units):
        return 0
    n_regular = sum(1 for u in ams_units if _ams_unit_id(u) < 128)
    return n_regular * 4


def _split_ams_slot(slot: int) -> tuple[int, int]:
    slot = int(slot)
    if slot >= 512:
        return slot // 4, slot % 4
    if slot >= 128:
        return slot, 0
    return slot // 4, slot % 4


def _ams_slot_decision_label(slot_idx: int) -> str:
    """Human-readable AMS bay label for decision-trail messages."""
    unit, tray = _split_ams_slot(slot_idx)
    if unit >= 128:
        return "AMS HT slot 1"
    return f"AMS {unit + 1} slot {tray + 1}"


def _bambu_tray_target(slot: int, regular_ams_slots: int = 0) -> int:
    """Return the print-command flat tray ID for a canonical AMS slot index.

    Regular AMS (slot < 128): flat ID == canonical slot index (unit*4+slot).
    AMS HT (slot >= 128): flat ID is sequential after all regular slots,
    i.e. regular_ams_slots + (slot - 128).  This matches the sequential
    numbering the H2D firmware and BambuStudio use in ams_mapping.
    """
    slot = int(slot)
    if slot >= 128:
        return regular_ams_slots + (slot - 128)
    return slot


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


def _bambu_pla_profile_key(spool: dict) -> Optional[str]:
    """Named Bambu PLA variants → tray_info_idx. Generic PLA (GFL99) collapses these,
    so the AMS tray reports 'Generic PLA' and Bambu Studio can't match a PLA Pure job."""
    material = str(spool.get("material") or "").strip().upper()
    brand = str(spool.get("brand") or "").strip().lower()
    if material != "PLA" or "bambu" not in brand:
        return None
    label = " ".join(str(spool.get(k) or "") for k in ("subtype", "profile", "name")).lower()
    if "pure" in label:
        return "GFA19"
    if "matte" in label:
        return "GFA01"
    if "basic" in label:
        return "GFA00"
    return None


def _custom_filament_for_spool(spool: dict) -> Optional[AMSFilamentSettings]:
    material = str(spool.get("material") or "").strip().upper()
    subtype = str(spool.get("subtype") or "").strip().upper()
    brand = str(spool.get("brand") or "").strip().lower()
    if material == "ASA" and "siddament" in brand:
        profile = _BAMBU_PROFILE_ALIASES["P461bccf"]
        return AMSFilamentSettings(
            profile["tray_info_idx"],
            profile["nozzle_temp_min"],
            profile["nozzle_temp_max"],
            profile["tray_type"],
        )
    pla_key = _bambu_pla_profile_key(spool)
    if pla_key:
        profile = _BAMBU_PROFILE_ALIASES[pla_key]
        return AMSFilamentSettings(
            profile["tray_info_idx"],
            profile["nozzle_temp_min"],
            profile["nozzle_temp_max"],
            profile["tray_type"],
        )
    if "PETG" in material and "CF" in f"{material} {subtype}":
        profile = _BAMBU_PROFILE_ALIASES["GFG98"]
        return AMSFilamentSettings(
            profile["tray_info_idx"],
            profile["nozzle_temp_min"],
            profile["nozzle_temp_max"],
            profile["tray_type"],
        )
    return None


def _profile_alias_for_spool(spool: dict) -> dict:
    material = str(spool.get("material") or "").strip().upper()
    subtype = str(spool.get("subtype") or "").strip().upper()
    brand = str(spool.get("brand") or "").strip().lower()
    if material == "ASA" and "siddament" in brand:
        return _BAMBU_PROFILE_ALIASES["P461bccf"]
    pla_key = _bambu_pla_profile_key(spool)
    if pla_key:
        return _BAMBU_PROFILE_ALIASES[pla_key]
    if "PETG" in material and "CF" in f"{material} {subtype}":
        return _BAMBU_PROFILE_ALIASES["GFG98"]
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
    return _ams_filament_command(
        ams_id=ams_id,
        tray_id=tray_id,
        tray_info_idx=alias.get("tray_info_idx") or filament.tray_info_idx,
        tray_color=f"{color}FF",
        nozzle_temp_min=alias.get("nozzle_temp_min", filament.nozzle_temp_min),
        nozzle_temp_max=alias.get("nozzle_temp_max", filament.nozzle_temp_max),
        tray_type=alias.get("tray_type") or filament.tray_type,
        tray_sub_brands=brand,
        tray_id_name=profile,
    )


_GENERIC_BAMBU_FILAMENT_IDS = {
    "PLA": "GFL99",
    "PLA-CF": "GFL98",
    "PLA SILK": "GFL96",
    "PLA HIGH SPEED": "GFL95",
    "PETG": "GFG99",
    "PETG HF": "GFG96",
    "PETG-CF": "GFG98",
    "PCTG": "GFG97",
    "ABS": "GFB99",
    "ASA": "GFB98",
    "PC": "GFC99",
    "PA": "GFN99",
    "PA-CF": "GFN98",
    "NYLON": "GFN99",
    "TPU": "GFU99",
    "PVA": "GFS99",
    "HIPS": "GFS98",
    "PE": "GFP99",
    "PP": "GFP97",
}


def _generic_bambu_filament_id(material: str) -> str:
    mat = re.sub(r"[^A-Z0-9 +-]+", " ", str(material or "").upper()).strip()
    mat = re.sub(r"\s+", " ", mat)
    return (
        _GENERIC_BAMBU_FILAMENT_IDS.get(mat)
        or _GENERIC_BAMBU_FILAMENT_IDS.get(mat.replace("+", ""))
        or _GENERIC_BAMBU_FILAMENT_IDS.get(mat.split(" ")[0].split("-")[0])
        or "GFL99"
    )


def _bambu_setting_id_for_filament_id(tray_info_idx: str) -> str:
    idx = str(tray_info_idx or "").strip()
    if re.fullmatch(r"GFS[A-Z0-9]+", idx):
        return idx
    if re.fullmatch(r"GF[A-Z0-9]+", idx):
        return f"GFS{idx[2:]}"
    if re.fullmatch(r"P[0-9A-Fa-f]+", idx):
        return idx
    return ""


def _ams_filament_command(
    *,
    ams_id: int,
    tray_id: int,
    tray_info_idx: str,
    tray_color: str,
    nozzle_temp_min: int,
    nozzle_temp_max: int,
    tray_type: str,
    tray_sub_brands: str,
    tray_id_name: str = "",
    setting_id: str = "",
) -> dict:
    command = {
        "command": "ams_filament_setting",
        "ams_id": ams_id,
        "tray_id": tray_id,
        "slot_id": 0 if int(ams_id) >= 128 else tray_id,
        "tray_info_idx": tray_info_idx,
        "tray_color": tray_color,
        "nozzle_temp_min": nozzle_temp_min,
        "nozzle_temp_max": nozzle_temp_max,
        "tray_type": tray_type,
        "tray_sub_brands": tray_sub_brands,
        "tray_id_name": tray_id_name,
        "sequence_id": "0",
    }
    setting_id = str(setting_id or "").strip() or _bambu_setting_id_for_filament_id(tray_info_idx)
    if setting_id:
        command["setting_id"] = setting_id
    return command


def _ams_profile_override_payload(spool: dict, profile: dict, ams_id: int, tray_id: int) -> dict:
    fallback = _ams_filament_setting_payload(
        spool,
        str(spool.get("color_hex") or "#808080").lstrip("#")[:6].upper(),
        ams_id,
        tray_id,
    )
    material = str(profile.get("tray_type") or profile.get("material") or fallback.get("tray_type") or "PLA").strip().upper()
    name = str(profile.get("profile_name") or profile.get("tray_id_name") or fallback.get("tray_id_name") or material).strip()
    brand = str(profile.get("brand") or profile.get("tray_sub_brands") or "").strip()
    color = str(profile.get("color") or profile.get("tray_color") or spool.get("color_hex") or "#808080").strip().lstrip("#")[:6]
    if not re.fullmatch(r"[0-9A-Fa-f]{6}", color):
        color = str(spool.get("color_hex") or "#808080").lstrip("#")[:6]
    if not re.fullmatch(r"[0-9A-Fa-f]{6}", color):
        color = "808080"
    tray_info_idx = str(profile.get("tray_info_idx") or "").strip()
    if not tray_info_idx:
        tray_info_idx = _generic_bambu_filament_id(material)
    temp_min = _safe_int(profile.get("nozzle_temp_min") or profile.get("temp_min")) or int(fallback.get("nozzle_temp_min") or 0)
    temp_max = _safe_int(profile.get("nozzle_temp_max") or profile.get("temp_max")) or int(fallback.get("nozzle_temp_max") or 0)
    if temp_min <= 0 or temp_max <= 0 or temp_max < temp_min:
        temp_min = int(fallback.get("nozzle_temp_min") or 0)
        temp_max = int(fallback.get("nozzle_temp_max") or 0)
    return _ams_filament_command(
        ams_id=ams_id,
        tray_id=tray_id,
        tray_info_idx=tray_info_idx,
        tray_color=f"{color.upper()}FF",
        nozzle_temp_min=temp_min,
        nozzle_temp_max=temp_max,
        tray_type=material,
        tray_sub_brands=brand or name.replace("@", " @").split(" @", 1)[0].strip(),
        tray_id_name=name,
        setting_id=str(profile.get("setting_id") or "").strip(),
    )


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


def _parse_ams(
    dump: dict,
    *,
    extruder_map: dict[int, int] | None = None,
    model_name: str = "",
) -> list[dict]:
    """Parse AMS data from mqtt_dump()['print']. Returns JSON-serialisable list."""
    ams_raw = dump.get("ams", {})
    if not ams_raw or ams_raw.get("ams_exist_bits", "0") == "0":
        return []

    extruder_map = extruder_map if extruder_map is not None else _read_ams_extruder_map(dump)
    model_key = str(model_name or "").upper()
    tray_now = int(ams_raw.get("tray_now", 255))
    _AMS_LABELS = {128: "AMS HT"}
    result = []
    n_regular_units = sum(1 for u in ams_raw.get("ams", []) if int(u.get("id", 0)) < 128)
    regular_ams_slots = _regular_ams_slot_count(ams_raw.get("ams", []))

    for unit_data in ams_raw.get("ams", []):
        unit_id = int(unit_data.get("id", 0))
        nozzle = extruder_map.get(unit_id)
        if nozzle is None and model_key == "H2D":
            # H-series nozzle IDs are 0=left, 1=right. H2D regular AMS feeds
            # the left path, while AMS HT feeds the right path.
            nozzle = 1 if unit_id >= 128 else 0
        if nozzle is None and model_key == "H2C":
            # H2C regular AMS feeds the right toolhead path; AMS HT feeds left.
            nozzle = 0 if unit_id >= 128 else 1
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

            slot_index = _bambu_slot_index(unit_id, tray_id)
            active = (not empty) and (tray_now == _bambu_tray_target(slot_index, regular_ams_slots))

            slot_payload = {
                "idx": tray_id,
                "type": tray_type,
                "color": color,
                "brand": brand,
                "profile_id": profile_id,
                "profile_name": profile_name,
                "tray_state": tray_state,
                "active": active,
                "empty": empty,
            }
            if nozzle in (0, 1):
                slot_payload["nozzle"] = nozzle
            slots.append(slot_payload)

        if slots:
            unit_payload = {
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
            }
            if nozzle in (0, 1):
                unit_payload["nozzle"] = nozzle
            result.append(unit_payload)

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
    tray_now = _safe_int(ams_raw.get("tray_now"))
    ams_units = ams_raw.get("ams", [])
    n_regular_units = sum(
        1
        for unit_data in ams_units
        if (_safe_int(unit_data.get("id")) or 0) < 128
    )
    regular_ams_slots = _regular_ams_slot_count(ams_units)
    result: dict[int, dict] = {}
    for unit_data in ams_units:
        unit_id = _safe_int(unit_data.get("id")) or 0
        for tray_data in unit_data.get("tray", []):
            tray_id = _safe_int(tray_data.get("id")) or 0
            tray_type = tray_data.get("tray_type", "")
            if not tray_type:
                continue
            slot_index = _bambu_slot_index(unit_id, tray_id)
            flat_slot = _bambu_tray_target(slot_index, regular_ams_slots)
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
                "flat_slot": flat_slot,
                "active": tray_now is not None and tray_now in (slot_index, flat_slot),
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
