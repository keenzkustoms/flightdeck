from __future__ import annotations
import asyncio
from contextlib import asynccontextmanager
from dataclasses import asdict
from typing import Optional

from fastapi import FastAPI, HTTPException

from .config import settings
from .printers import moonraker
from .printers.bambu import BambuPrinter

# -- Bambu instances (only created if config is present) --
_bambu: list[BambuPrinter] = []


@asynccontextmanager
async def lifespan(app: FastAPI):
    if settings.bambu_x1c_ip and settings.bambu_x1c_access_code and settings.bambu_x1c_serial:
        p = BambuPrinter("x1c", settings.bambu_x1c_name,
                         settings.bambu_x1c_ip, settings.bambu_x1c_access_code,
                         settings.bambu_x1c_serial)
        await asyncio.to_thread(p.start)
        _bambu.append(p)

    if settings.bambu_h2d_ip and settings.bambu_h2d_access_code and settings.bambu_h2d_serial:
        p = BambuPrinter("h2d", settings.bambu_h2d_name,
                         settings.bambu_h2d_ip, settings.bambu_h2d_access_code,
                         settings.bambu_h2d_serial)
        await asyncio.to_thread(p.start)
        _bambu.append(p)

    yield

    for p in _bambu:
        await asyncio.to_thread(p.stop)
    _bambu.clear()


app = FastAPI(title="Flightdeck", lifespan=lifespan)


@app.get("/healthz")
def healthz():
    return {"status": "ok"}


@app.get("/api/printers")
async def get_printers():
    results = []

    if settings.moonraker_url:
        status = await moonraker.fetch("voron", settings.moonraker_name, settings.moonraker_url)
        results.append(asdict(status))

    for p in _bambu:
        status = await asyncio.to_thread(p.status)
        results.append(asdict(status))

    return results


@app.get("/api/printers/{printer_id}")
async def get_printer(printer_id: str):
    if printer_id == "voron" and settings.moonraker_url:
        status = await moonraker.fetch("voron", settings.moonraker_name, settings.moonraker_url)
        return asdict(status)

    for p in _bambu:
        if p.id == printer_id:
            status = await asyncio.to_thread(p.status)
            return asdict(status)

    raise HTTPException(status_code=404, detail="printer not found")
