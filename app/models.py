from __future__ import annotations
from dataclasses import dataclass, field
from typing import Literal, Optional
from datetime import datetime

from pydantic import BaseModel


class PrintPreview(BaseModel):
    image_url: Optional[str] = None
    image_type: Literal["static", "mjpeg", "webrtc"] = "static"
    fallback_thumbnail_url: Optional[str] = None  # static thumb when image_type is mjpeg
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
    subtask_name: Optional[str] = None   # Bambu project name; None for Moonraker


@dataclass
class PrinterStatus:
    id: str
    model_name: str          # from printers.yaml — leads the card header
    custom_name: str         # from printers.yaml — subtitle
    icon: str                # icon key: "voron" | "bambu" | "generic"
    kind: str                # "moonraker" | "bambu"
    state: str               # "printing" | "idle" | "paused" | "finished" | "error" | "offline"
    temps: dict[str, TempReading] = field(default_factory=dict)
    job: Optional[JobStatus] = None
    substage: Optional[int] = None   # Bambu stg_cur (PrintStatus enum value); None when unused
    idle_info: dict[str, str] = field(default_factory=dict)
    ams: list = field(default_factory=list)  # list of AMS unit dicts; empty for non-Bambu
    mmu: list = field(default_factory=list)  # list of MMU unit dicts; empty for non-HH
    light_state: Optional[str] = None  # Bambu chamber light state: "on" | "off" | "unknown"
    temperature_presets: dict = field(default_factory=dict)  # {hotend: [{label, value}], bed: [...]}
    error: Optional[str] = None
    last_seen: Optional[datetime] = None  # last successful data from printer link
    updated_at: datetime = field(default_factory=datetime.utcnow)
