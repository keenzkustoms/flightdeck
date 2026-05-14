from __future__ import annotations
from pathlib import Path
from typing import Annotated, Literal, Optional, Union

import yaml
from pydantic import BaseModel, Field

CONFIG_PATH = Path(__file__).parent.parent / "printers.yaml"

VALID_ICONS = {"voron", "bambu", "generic"}


class MoonrakerConnection(BaseModel):
    type: Literal["moonraker"]
    host: str
    port: int = 7125

    @property
    def url(self) -> str:
        return f"http://{self.host}:{self.port}"


class BambuConnection(BaseModel):
    type: Literal["bambu"]
    host: str
    access_code: str
    serial: str


Connection = Annotated[
    Union[MoonrakerConnection, BambuConnection],
    Field(discriminator="type"),
]


class MjpegDirectCamera(BaseModel):
    type: Literal["mjpeg_direct"]
    stream_url: str
    snapshot_url: Optional[str] = None


class BambuRtspCamera(BaseModel):
    type: Literal["bambu_rtsp"]
    # stream_url served via /api/camera/{printer_id}/stream proxy


Camera = Annotated[
    Union[MjpegDirectCamera, BambuRtspCamera],
    Field(discriminator="type"),
]


class PrinterEntry(BaseModel):
    id: str
    model_name: str
    custom_name: str
    icon: str = "generic"
    connection: Connection
    camera: Optional[Camera] = None

    # Future expansion fields — optional so old configs stay valid
    park_position: Optional[str] = None
    alert_thresholds: Optional[dict] = None

    def icon_key(self) -> str:
        return self.icon if self.icon in VALID_ICONS else "generic"


class PrintersConfig(BaseModel):
    printers: list[PrinterEntry]


def load() -> PrintersConfig:
    with open(CONFIG_PATH) as f:
        data = yaml.safe_load(f)
    return PrintersConfig.model_validate(data)
