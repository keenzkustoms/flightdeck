from __future__ import annotations
from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
from typing import Optional


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # Voron / Moonraker
    moonraker_url: Optional[str] = None
    moonraker_name: str = "Voron Greyhound"

    # Bambu X1C
    bambu_x1c_ip: Optional[str] = None
    bambu_x1c_access_code: Optional[str] = None
    bambu_x1c_serial: Optional[str] = None
    bambu_x1c_name: str = "Bambu X1C"

    # Bambu H2D
    bambu_h2d_ip: Optional[str] = None
    bambu_h2d_access_code: Optional[str] = None
    bambu_h2d_serial: Optional[str] = None
    bambu_h2d_name: str = "Bambu H2D"


settings = Settings()
