from __future__ import annotations
import logging
import threading
from datetime import datetime, timezone, timedelta
from typing import Optional

import bambulabs_api as bl
from bambulabs_api.mqtt_client import PrinterMQTTClient

from .. import db
from ..models import PrinterStatus, JobStatus, TempReading

log = logging.getLogger(__name__)

FINISHED_TTL = timedelta(minutes=30)
_BAMBU_PREVIEW_FAILED = object()  # sentinel: FTP failed, don't retry until job changes


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

    # Intercepts every self.__publish_command(...) call made by the base class.
    def _PrinterMQTTClient__publish_command(self, payload: dict) -> bool:
        self._seq += 1
        seq = str(self._seq)
        for v in payload.values():
            if isinstance(v, dict):
                v['sequence_id'] = seq
        return super()._PrinterMQTTClient__publish_command(payload)


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
        self._preview_cache: tuple[str, object] | None = None
        self._seen_finish_this_session = False
        self._current_job_key: Optional[str] = None
        self._error_job_key: Optional[str] = None  # job_key of active in-session error

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
            mc = self._printer.mqtt_client
            if nozzle is not None:
                temps["hotend"] = TempReading(
                    actual=float(nozzle),
                    target=float(mc.get_nozzle_temperature_target()),
                )
            if bed is not None:
                temps["bed"] = TempReading(
                    actual=float(bed),
                    target=float(mc.get_bed_temperature_target()),
                )
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

            if state == "idle":
                job = None  # MQTT retains last-print data; don't surface it as active

            idle_info: dict[str, str] = {}
            if state == "idle":
                last = db.get_last_print(self.id)
                if last:
                    idle_info["Last print"] = _fmt_last_print(last)

            try:
                ams = _parse_ams(self._printer.mqtt_dump().get("print", {}))
            except Exception:
                ams = []

            now = datetime.utcnow()
            self._last_seen = now
            return PrinterStatus(
                id=self.id, model_name=self.model_name, custom_name=self.custom_name,
                icon=self.icon, kind="bambu", state=state,
                temps=temps, job=job, substage=substage,
                idle_info=idle_info, ams=ams, last_seen=now, updated_at=now,
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
            else:
                # Service restarted during the print; close any open row as FINISHED
                # rather than leaving it orphaned for the stale-orphan sweep.
                db.close_open_prints(self.id, final_state="FINISHED")
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
            self._error_job_key = None
            if self._seen_finish_this_session:
                db.clear_finished_at(self.id)
                self._seen_finish_this_session = False
                self._current_job_key = None
                return "idle"
            if self._current_job_key:
                # In-session interrupt: we know the exact job key.
                db.on_print_ended(
                    self.id, self._current_job_key,
                    final_state="ERROR",
                    layers_completed=job.layer_current if job else None,
                    error_message="Connection lost mid-print",
                )
            else:
                # Service restarted while printer was mid-print then went idle:
                # _make_job_key may return a stale/wrong key, so close all open rows directly.
                db.close_open_prints(
                    self.id,
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
            self._error_job_key = None
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

            if self._current_job_key:
                # In-session failure: close the job and start showing the error.
                job_key = self._current_job_key
                err_code = self._printer.mqtt_dump().get("print", {}).get("print_error", 0)
                err_msg = f"Error code {err_code}" if err_code else "Unknown error"
                db.on_print_ended(
                    self.id, job_key,
                    final_state="ERROR",
                    layers_completed=job.layer_current if job else None,
                    error_message=err_msg,
                )
                self._current_job_key = None
                self._error_job_key = job_key
                return "error"

            if self._error_job_key:
                # Already showing this in-session error; keep showing it until IDLE.
                return "error"

            # No in-session job — stale FAILED state from before service started.
            job_key = self._make_job_key(subtask)
            if job_key and db.is_print_closed(self.id, job_key):
                # Error already recorded in a previous session; nothing new to show.
                return "idle"

            # Pre-existing failure not yet in DB — close it and show error once.
            if job_key:
                err_code = self._printer.mqtt_dump().get("print", {}).get("print_error", 0)
                err_msg = f"Error code {err_code}" if err_code else "Unknown error"
                db.on_print_ended(
                    self.id, job_key,
                    final_state="ERROR",
                    layers_completed=job.layer_current if job else None,
                    error_message=err_msg,
                )
                self._error_job_key = job_key
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
        self._printer.pause_print()

    def resume(self) -> None:
        self._printer.resume_print()

    def cancel(self) -> None:
        self._printer.stop_print()

    def estop(self) -> None:
        self._printer.stop_print()  # Bambu MQTT has no dedicated e-stop

    def set_temp(self, heater: str, target: int) -> None:
        if heater == "hotend":
            self._printer.set_nozzle_temperature(target)
        elif heater == "bed":
            self._printer.set_bed_temperature(target)

    def get_preview(self):
        """Return cached BambuPreview, fetching via FTP if the job changed."""
        if not self._connected:
            return None
        subtask = self._printer.subtask_name()
        if not subtask:
            return None
        if self._preview_cache and self._preview_cache[0] == subtask:
            val = self._preview_cache[1]
            return None if val is _BAMBU_PREVIEW_FAILED else val
        try:
            from .bambu_ftp import fetch_bambu_preview
            preview = fetch_bambu_preview(self._ip, self._access_code, subtask)
            self._preview_cache = (subtask, preview)
            return preview
        except Exception as exc:
            log.warning("FTP preview failed for %s: %s", self.model_name, exc)
            self._preview_cache = (subtask, _BAMBU_PREVIEW_FAILED)
            return None


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
        slots = []
        for tray_data in unit_data.get("tray", []):
            tray_id = int(tray_data.get("id", 0))
            tray_type = tray_data.get("tray_type", "")
            empty = not tray_type

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
                "brand": tray_data.get("tray_sub_brands", ""),
                "active": active,
                "empty": empty,
            })

        if slots:
            result.append({"unit": unit_id, "label": _AMS_LABELS.get(unit_id, f"AMS {unit_id + 1}"), "slots": slots})

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
