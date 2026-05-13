from __future__ import annotations
from dataclasses import dataclass, field
from typing import Literal, Optional
from datetime import datetime

from pydantic import BaseModel


class PrintPreview(BaseModel):
    image_url: Optional[str] = None
    image_type: Literal["static", "mjpeg", "webrtc"] = "static"
    filename: str
    estimated_total_seconds: Optional[int] = None
    elapsed_seconds: Optional[int] = None
    layer_height_mm: Optional[float] = None
    filament_weight_g: Optional[float] = None
    filament_type: Optional[str] = None


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
    state: str               # "printing" | "idle" | "paused" | "finished" | "error" | "offline"
    temps: dict[str, TempReading] = field(default_factory=dict)
    job: Optional[JobStatus] = None
    substage: Optional[int] = None   # Bambu stg_cur (PrintStatus enum value); None when unused
    error: Optional[str] = None
    updated_at: datetime = field(default_factory=datetime.utcnow)
