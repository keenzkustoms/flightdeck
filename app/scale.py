from __future__ import annotations

import os
import errno
import struct
import subprocess
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Literal, Optional


@dataclass
class ScaleReading:
    grams: int
    unit: Literal["g", "oz"] = "g"
    stable: bool = False


class Scale:
    VENDOR = "0922"
    PRODUCTS = {"8004", "8009"}

    def __init__(self, device_path: str = "/dev/usb/hiddev0"):
        self.device_path = device_path
        self.last_error: Optional[str] = None
        self.last_keep_awake_at: Optional[float] = None
        self.last_keep_awake_method: Optional[str] = None

    @staticmethod
    def _env_bool(name: str, default: bool) -> bool:
        value = os.getenv(name)
        if value is None:
            return default
        return value.strip().lower() not in {"0", "false", "no", "off"}

    @staticmethod
    def _env_int(name: str) -> Optional[int]:
        value = os.getenv(name)
        if value is None or value.strip() == "":
            return None
        try:
            return int(value)
        except ValueError:
            return None

    @staticmethod
    def _env_float(name: str, default: float) -> float:
        try:
            return float(os.getenv(name, str(default)))
        except ValueError:
            return default

    def _candidate_paths(self) -> list[str]:
        paths = [self.device_path] + [f"/dev/hidraw{i}" for i in range(8)]
        seen: set[str] = set()
        return [p for p in paths if not (p in seen or seen.add(p))]

    def is_available(self) -> bool:
        self.last_error = None
        if not self._usb_present():
            self.last_error = "Dymo M10 USB scale not detected"
            return False
        if os.name == "nt":
            return True
        if any(Path(p).exists() for p in self._candidate_paths()):
            return True
        self.last_error = "Scale device path not found"
        return False

    def read_once(self) -> Optional[ScaleReading]:
        self.last_error = None
        if not self._usb_present():
            self.last_error = "Dymo M10 USB scale not detected"
            return None
        if os.name == "nt":
            return self._read_windows_once()
        for path in self._candidate_paths():
            if not Path(path).exists():
                continue
            try:
                with open(path, "rb", buffering=0) as f:
                    data = f.read(16)
                reading = self._parse_report(data)
                if reading and reading.grams > 0:
                    return reading
            except PermissionError:
                self.last_error = f"Permission denied reading {path}"
                return None
            except Exception as exc:
                self.last_error = str(exc)
        self.last_error = self.last_error or "No non-zero scale reading"
        return None

    def keep_awake_ping(self) -> bool:
        if self.toggle_unit_button():
            return True
        if self._env_int("FLIGHTDECK_SCALE_UNITS_GPIO") is not None:
            return False
        return self.usb_keep_awake_ping()

    def toggle_unit_button(self) -> bool:
        """Pulse a GPIO wired to the DYMO units button, if configured.

        Set FLIGHTDECK_SCALE_UNITS_GPIO to a BCM pin number after wiring the
        button mod. The pulse defaults to active-high for 250ms; override with
        FLIGHTDECK_SCALE_UNITS_GPIO_ACTIVE_HIGH=false or
        FLIGHTDECK_SCALE_UNITS_GPIO_PULSE_MS=...
        """
        pin = self._env_int("FLIGHTDECK_SCALE_UNITS_GPIO")
        if pin is None:
            self.last_error = "Scale units GPIO not configured"
            return False
        active_high = self._env_bool("FLIGHTDECK_SCALE_UNITS_GPIO_ACTIVE_HIGH", True)
        pulse_s = max(0.05, self._env_float("FLIGHTDECK_SCALE_UNITS_GPIO_PULSE_MS", 250) / 1000.0)
        try:
            from gpiozero import OutputDevice  # type: ignore

            device = OutputDevice(pin, active_high=active_high, initial_value=False)
            try:
                device.on()
                time.sleep(pulse_s)
                device.off()
            finally:
                device.close()
            self.last_keep_awake_at = time.time()
            self.last_keep_awake_method = f"gpio{pin}"
            self.last_error = None
            return True
        except Exception as exc:
            gpiozero_error = exc

        try:
            import RPi.GPIO as GPIO  # type: ignore

            GPIO.setmode(GPIO.BCM)
            inactive = GPIO.LOW if active_high else GPIO.HIGH
            active = GPIO.HIGH if active_high else GPIO.LOW
            GPIO.setup(pin, GPIO.OUT, initial=inactive)
            GPIO.output(pin, active)
            time.sleep(pulse_s)
            GPIO.output(pin, inactive)
            self.last_keep_awake_at = time.time()
            self.last_keep_awake_method = f"gpio{pin}"
            self.last_error = None
            return True
        except Exception as exc:
            self.last_error = f"GPIO units-button pulse failed: {exc} (gpiozero: {gpiozero_error})"
            return False

    def usb_keep_awake_ping(self) -> bool:
        """Touch the USB HID endpoint so an attached scale has regular host activity.

        This is intentionally non-blocking. It can keep USB-readable DYMO scales active
        without stalling Flightdeck if the scale is asleep or not producing reports.
        A true units-button toggle still needs a wired GPIO/button mod.
        """
        self.last_error = None
        if not self._usb_present():
            self.last_error = "Dymo M10 USB scale not detected"
            return False
        if os.name == "nt":
            reading = self._read_windows_once(timeout_ms=250)
            if reading or self.last_error in {None, "No non-zero scale reading"}:
                self.last_keep_awake_at = time.time()
                self.last_keep_awake_method = "windows-hid"
                self.last_error = None
                return True
            return False
        for path in self._candidate_paths():
            if not Path(path).exists():
                continue
            fd: Optional[int] = None
            try:
                fd = os.open(path, os.O_RDONLY | os.O_NONBLOCK)
                try:
                    os.read(fd, 16)
                except BlockingIOError:
                    pass
                self.last_keep_awake_at = time.time()
                self.last_keep_awake_method = "usb"
                return True
            except PermissionError:
                self.last_error = f"Permission denied reading {path}"
                return False
            except OSError as exc:
                if exc.errno not in (errno.EAGAIN, errno.EWOULDBLOCK):
                    self.last_error = str(exc)
            finally:
                if fd is not None:
                    os.close(fd)
        self.last_error = self.last_error or "Scale device path not found"
        return False

    def _usb_present(self) -> bool:
        if os.name == "nt":
            try:
                import hid  # type: ignore

                devices = hid.enumerate(int(self.VENDOR, 16), 0)
                return any(f"{device.get('product_id', 0):04x}" in self.PRODUCTS for device in devices)
            except Exception as exc:
                self.last_error = str(exc)
                return False
        try:
            out = subprocess.check_output(["lsusb"], text=True)
        except Exception as exc:
            self.last_error = str(exc)
            return False
        return any(f"{self.VENDOR}:{product}" in out for product in self.PRODUCTS)

    def _read_windows_once(self, timeout_ms: int = 1000) -> Optional[ScaleReading]:
        try:
            import hid  # type: ignore
        except Exception as exc:
            self.last_error = f"Windows HID support unavailable: {exc}"
            return None

        devices = []
        for product in sorted(self.PRODUCTS):
            try:
                devices.extend(hid.enumerate(int(self.VENDOR, 16), int(product, 16)))
            except Exception as exc:
                self.last_error = str(exc)
        for info in devices:
            device = None
            try:
                device = hid.device()
                device.open_path(info["path"])
                data = bytes(device.read(16, timeout_ms=timeout_ms))
                reading = self._parse_report(data)
                if reading and reading.grams > 0:
                    self.last_error = None
                    return reading
            except Exception as exc:
                self.last_error = str(exc)
            finally:
                try:
                    if device is not None:
                        device.close()
                except Exception:
                    pass
        self.last_error = self.last_error or "No non-zero scale reading"
        return None

    def read_stable(self, timeout_s: float = 5.0) -> Optional[ScaleReading]:
        deadline = time.time() + timeout_s
        seen: list[int] = []
        while time.time() < deadline:
            reading = self.read_once()
            if reading and reading.grams > 0:
                seen.append(reading.grams)
                seen = seen[-3:]
                if len(seen) == 3 and len(set(seen)) == 1:
                    reading.stable = True
                    return reading
            time.sleep(0.25)
        self.last_error = self.last_error or "Reading did not stabilise"
        return None

    def _parse_report(self, data: bytes) -> Optional[ScaleReading]:
        if len(data) >= 16:
            vals = struct.unpack("4I", data[:16])
            grams = int(vals[3])
            if grams:
                return ScaleReading(grams=grams, stable=False)

        # hidraw Dymo reports are commonly 6 bytes:
        # report, status, unit, exponent, low, high.
        if len(data) >= 6:
            unit_code = data[2]
            exponent = struct.unpack("b", data[3:4])[0]
            raw = data[4] + (data[5] << 8)
            value = raw * (10 ** exponent)
            if unit_code == 0x0B:  # ounces
                grams = round(value * 28.3495)
                return ScaleReading(grams=grams, unit="oz", stable=False)
            grams = round(value)
            if grams:
                return ScaleReading(grams=grams, unit="g", stable=False)
        return None
