from __future__ import annotations
from dataclasses import dataclass, field
from typing import Optional
from datetime import datetime


@dataclass
class TempReading:
    actual: float
    target: float


@dataclass
class JobStatus:
    filename: str
    progress: float          # 0.0 – 1.0
    eta_seconds: Optional[int] = None
    layer_current: Optional[int] = None
    layer_total: Optional[int] = None


@dataclass
class PrinterStatus:
    id: str
    name: str
    kind: str                # "moonraker" | "bambu"
    state: str               # "printing" | "idle" | "paused" | "error" | "offline"
    temps: dict[str, TempReading] = field(default_factory=dict)
    job: Optional[JobStatus] = None
    error: Optional[str] = None
    updated_at: datetime = field(default_factory=datetime.utcnow)
