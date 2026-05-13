from __future__ import annotations
import ftplib
import io
import socket
import ssl
import zipfile
import xml.etree.ElementTree as ET
import logging
from dataclasses import dataclass
from typing import Optional

log = logging.getLogger(__name__)


@dataclass
class BambuPreview:
    image_png: bytes
    estimated_total_seconds: Optional[int]
    filament_weight_g: Optional[float]
    filament_type: Optional[str]


class _ImplicitFTP_TLS(ftplib.FTP_TLS):
    """Implicit FTPS (port 990) with SSL session reuse on the data channel."""

    def connect(self, host, port=990, timeout=15):
        self.host = host
        self.port = port
        self.timeout = timeout
        self._ctx = ssl.create_default_context()
        self._ctx.check_hostname = False
        self._ctx.verify_mode = ssl.CERT_NONE
        raw = socket.create_connection((host, port), timeout=timeout)
        self.sock = self._ctx.wrap_socket(raw, server_hostname=host)
        self.af = self.sock.family
        self.file = self.sock.makefile('r', encoding=self.encoding)
        self.welcome = self.getresp()
        return self.welcome

    def ntransfercmd(self, cmd, rest=None):
        conn, size = ftplib.FTP.ntransfercmd(self, cmd, rest)
        conn = self._ctx.wrap_socket(
            conn, server_hostname=self.host, session=self.sock.session,
        )
        return conn, size


def fetch_bambu_preview(ip: str, access_code: str, subtask_name: str) -> Optional[BambuPreview]:
    """Download the .3mf for the current job and extract thumbnail + metadata."""
    ftp = _ImplicitFTP_TLS()
    try:
        ftp.connect(ip, 990, timeout=15)
        ftp.login("bblp", access_code)
        ftp.prot_p()
        ftp.set_pasv(True)

        buf = io.BytesIO()
        ftp.retrbinary(f"RETR /{subtask_name}.gcode.3mf", buf.write)
        buf.seek(0)
    finally:
        try:
            ftp.quit()
        except Exception:
            pass

    with zipfile.ZipFile(buf) as z:
        image_png = z.read("Metadata/plate_1.png")
        slice_xml = z.read("Metadata/slice_info.config").decode()

    root_el = ET.fromstring(slice_xml)
    plate = root_el.find("plate")

    def meta(key: str) -> Optional[str]:
        el = plate.find(f"metadata[@key='{key}']") if plate is not None else None
        return el.get("value") if el is not None else None

    pred = meta("prediction")
    weight = meta("weight")
    filament_el = plate.find("filament") if plate is not None else None
    filament_type = filament_el.get("type") if filament_el is not None else None

    return BambuPreview(
        image_png=image_png,
        estimated_total_seconds=int(pred) if pred else None,
        filament_weight_g=float(weight) if weight else None,
        filament_type=filament_type,
    )
