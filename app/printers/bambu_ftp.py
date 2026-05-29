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
import json

log = logging.getLogger(__name__)


@dataclass
class BambuPreview:
    image_png: bytes
    estimated_total_seconds: Optional[int]
    filament_weight_g: Optional[float]
    filament_type: Optional[str]
    filament_colors: Optional[str] = None
    objects: Optional[list[dict]] = None


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


def _parse_3mf(buf: io.BytesIO) -> BambuPreview:
    """Extract thumbnail and metadata from an in-memory .gcode.3mf zip."""
    with zipfile.ZipFile(buf) as z:
        try:
            image_png: Optional[bytes] = z.read("Metadata/plate_1.png")
        except KeyError:
            image_png = None
        try:
            slice_xml = z.read("Metadata/slice_info.config").decode()
        except KeyError:
            return BambuPreview(image_png=image_png, estimated_total_seconds=None,
                                filament_weight_g=None, filament_type=None, filament_colors=None,
                                objects=None)

    root_el = ET.fromstring(slice_xml)
    plate = root_el.find("plate")

    def meta(key: str) -> Optional[str]:
        el = plate.find(f"metadata[@key='{key}']") if plate is not None else None
        return el.get("value") if el is not None else None

    pred = meta("prediction")
    weight = meta("weight")
    filament_el = plate.find("filament") if plate is not None else None
    filament_type = filament_el.get("type") if filament_el is not None else None
    filaments = []
    objects = []
    if plate is not None:
        name_counts: dict[str, int] = {}
        for el in plate.findall("filament"):
            color = el.get("color")
            used_g = el.get("used_g")
            ftype = el.get("type")
            if color:
                try:
                    grams = float(used_g) if used_g else None
                except ValueError:
                    grams = None
                filaments.append({"type": ftype, "color": color.upper(), "used_g": grams})
        for el in plate.findall("object"):
            obj_id = el.get("identify_id")
            name = el.get("name") or f"Object {obj_id or len(objects) + 1}"
            try:
                identify_id = int(obj_id) if obj_id is not None else None
            except ValueError:
                identify_id = None
            base = name.rsplit("/", 1)[-1].rsplit("\\", 1)[-1]
            name_counts[base] = name_counts.get(base, 0) + 1
            objects.append({
                "id": identify_id,
                "name": base,
                "label": f"{base} #{name_counts[base]}" if name_counts[base] > 1 else base,
                "state": "excluded" if el.get("skipped", "false").lower() == "true" else "available",
            })

    return BambuPreview(
        image_png=image_png,
        estimated_total_seconds=int(pred) if pred else None,
        filament_weight_g=float(weight) if weight else None,
        filament_type=filament_type,
        filament_colors=json.dumps(filaments) if filaments else None,
        objects=objects or None,
    )


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

    return _parse_3mf(buf)


def download_bambu_file(ip: str, access_code: str, path: str) -> bytes:
    """Download a file from Bambu printer SD via implicit FTPS."""
    ftp = _ImplicitFTP_TLS()
    remote = "/" + path.strip("/")
    try:
        ftp.connect(ip, 990, timeout=20)
        ftp.login("bblp", access_code)
        ftp.prot_p()
        ftp.set_pasv(True)
        buf = io.BytesIO()
        ftp.retrbinary(f"RETR {remote}", buf.write)
        return buf.getvalue()
    finally:
        try:
            ftp.quit()
        except Exception:
            pass


def upload_bambu_file(ip: str, access_code: str, filename: str, data: bytes) -> BambuPreview:
    """Upload a .gcode.3mf to the printer via FTPS and return parsed metadata.

    Raises on connection or transfer failure — caller handles retry logic.
    """
    buf = io.BytesIO(data)
    ftp = _ImplicitFTP_TLS()
    try:
        ftp.connect(ip, 990, timeout=30)
        ftp.login("bblp", access_code)
        ftp.prot_p()
        ftp.set_pasv(True)
        buf.seek(0)
        ftp.storbinary(f"STOR /{filename}", buf)
    finally:
        try:
            ftp.quit()
        except Exception:
            pass

    try:
        buf.seek(0)
        return _parse_3mf(buf)
    except Exception:
        return BambuPreview(image_png=None, estimated_total_seconds=None,
                            filament_weight_g=None, filament_type=None)


def list_bambu_files(ip: str, access_code: str, path: str = "/") -> list[dict]:
    """List Bambu printer SD files via implicit FTPS."""
    ftp = _ImplicitFTP_TLS()
    rows: list[dict] = []
    root = "/" + path.strip("/")
    if root == "/":
        root = "/"
    try:
        ftp.connect(ip, 990, timeout=15)
        ftp.login("bblp", access_code)
        ftp.prot_p()
        ftp.set_pasv(True)
        try:
            entries = list(ftp.mlsd(root))
            for name, facts in entries:
                if name in (".", ".."):
                    continue
                kind = "dir" if facts.get("type") == "dir" else "file"
                size = int(facts.get("size") or 0) if kind == "file" else None
                modified = facts.get("modify")
                rows.append({
                    "name": name,
                    "path": f"{root.rstrip('/')}/{name}".lstrip("/"),
                    "kind": kind,
                    "size": size,
                    "modified": modified,
                })
        except Exception:
            names = ftp.nlst(root)
            for item in names:
                name = item.rsplit("/", 1)[-1]
                if not name or name in (".", ".."):
                    continue
                rows.append({
                    "name": name,
                    "path": item.lstrip("/"),
                    "kind": "file",
                    "size": None,
                    "modified": None,
                })
    finally:
        try:
            ftp.quit()
        except Exception:
            pass
    return sorted(rows, key=lambda r: (r["kind"] != "dir", r["name"].lower()))


def clear_bambu_print_files(ip: str, access_code: str) -> dict:
    """Delete printable job files from the Bambu SD root, leaving utility folders alone."""
    printable_ext = (".3mf", ".gcode.3mf")
    rows = list_bambu_files(ip, access_code)
    ftp = _ImplicitFTP_TLS()
    deleted: list[str] = []
    skipped: list[str] = []
    try:
        ftp.connect(ip, 990, timeout=20)
        ftp.login("bblp", access_code)
        ftp.prot_p()
        ftp.set_pasv(True)
        for row in rows:
            name = row.get("name") or ""
            path = (row.get("path") or name).lstrip("/")
            lower = name.lower()
            if row.get("kind") == "dir" or not lower.endswith(printable_ext):
                skipped.append(path)
                continue
            ftp.delete(f"/{path}")
            deleted.append(path)
    finally:
        try:
            ftp.quit()
        except Exception:
            pass
    return {"deleted": deleted, "skipped": skipped}


def delete_bambu_file(ip: str, access_code: str, path: str) -> None:
    """Delete one printable file from a Bambu SD card."""
    clean_path = path.strip().lstrip("/")
    if not clean_path:
        raise FileNotFoundError("Bambu file path required")
    name = clean_path.rsplit("/", 1)[-1].lower()
    if not (name.endswith(".3mf") or name.endswith(".gcode.3mf")):
        raise ValueError("Only printable Bambu .3mf files can be deleted")
    ftp = _ImplicitFTP_TLS()
    try:
        ftp.connect(ip, 990, timeout=20)
        ftp.login("bblp", access_code)
        ftp.prot_p()
        ftp.set_pasv(True)
        ftp.delete(f"/{clean_path}")
    finally:
        try:
            ftp.quit()
        except Exception:
            pass
