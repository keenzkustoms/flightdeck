from __future__ import annotations

import os
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
    PRODUCT = "8004"

    def __init__(self, device_path: str = "/dev/usb/hiddev0"):
        self.device_path = device_path
        self.last_error: Optional[str] = None

    def is_available(self) -> bool:
        self.last_error = None
        if not self._usb_present():
            self.last_error = "Dymo M10 USB scale not detected"
            return False
        candidates = [self.device_path, "/dev/hidraw0", "/dev/hidraw1", "/dev/hidraw2"]
        if any(Path(p).exists() for p in candidates):
            return True
        self.last_error = "Scale device path not found"
        return False

    def read_once(self) -> Optional[ScaleReading]:
        self.last_error = None
        if not self._usb_present():
            self.last_error = "Dymo M10 USB scale not detected"
            return None
        paths = [self.device_path] + [f"/dev/hidraw{i}" for i in range(8)]
        for path in paths:
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

    def _usb_present(self) -> bool:
        try:
            out = subprocess.check_output(["lsusb"], text=True)
        except Exception as exc:
            self.last_error = str(exc)
            return False
        return f"{self.VENDOR}:{self.PRODUCT}" in out

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
