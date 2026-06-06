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
    plate_bounds: Optional[dict] = None


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


def _parse_3mf(buf: io.BytesIO, plate_number: Optional[int] = None) -> BambuPreview:
    """Extract thumbnail and metadata from an in-memory .gcode.3mf zip."""
    plate_number = int(plate_number or 1)
    with zipfile.ZipFile(buf) as z:
        try:
            image_png: Optional[bytes] = z.read(f"Metadata/plate_{plate_number}.png")
        except KeyError:
            try:
                image_png = z.read("Metadata/plate_1.png")
            except KeyError:
                image_png = None
        try:
            slice_xml = z.read("Metadata/slice_info.config").decode()
        except KeyError:
            return BambuPreview(image_png=image_png, estimated_total_seconds=None,
                                filament_weight_g=None, filament_type=None, filament_colors=None,
                                objects=None)
        try:
            plate_json = json.loads(z.read(f"Metadata/plate_{plate_number}.json").decode())
        except Exception:
            plate_json = None

    root_el = ET.fromstring(slice_xml)
    plates = root_el.findall("plate")
    plate = None
    if plates:
        # Bambu plate filenames are 1-based: Metadata/plate_6.gcode maps to
        # the sixth <plate> entry in slice_info.config.
        if 1 <= plate_number <= len(plates):
            plate = plates[plate_number - 1]
        else:
            plate = plates[0]

    def meta(key: str) -> Optional[str]:
        el = plate.find(f"metadata[@key='{key}']") if plate is not None else None
        return el.get("value") if el is not None else None

    pred = meta("prediction")
    weight = meta("weight")
    filament_el = plate.find("filament") if plate is not None else None
    filament_type = filament_el.get("type") if filament_el is not None else None
    filaments = []
    objects = []
    object_boxes, plate_bounds = _extract_plate_object_boxes(plate_json)
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
                **({"bbox": object_boxes[identify_id]} if identify_id in object_boxes else {}),
            })

    if not plate_bounds and object_boxes:
        plate_bounds = _bounds_for_boxes(object_boxes.values())

    return BambuPreview(
        image_png=image_png,
        estimated_total_seconds=int(pred) if pred else None,
        filament_weight_g=float(weight) if weight else None,
        filament_type=filament_type,
        filament_colors=json.dumps(filaments) if filaments else None,
        objects=objects or None,
        plate_bounds=plate_bounds,
    )


def _numbers(value) -> list[float]:
    if isinstance(value, str):
        value = value.replace("[", " ").replace("]", " ").replace(",", " ").split()
    if isinstance(value, (list, tuple)):
        out = []
        for item in value:
            try:
                out.append(float(item))
            except (TypeError, ValueError):
                continue
        return out
    return []


def _bbox_from_value(value) -> Optional[dict]:
    if isinstance(value, dict):
        if all(k in value for k in ("x", "y", "w", "h")):
            return {"x": float(value["x"]), "y": float(value["y"]), "w": float(value["w"]), "h": float(value["h"])}
        if all(k in value for k in ("min_x", "min_y", "max_x", "max_y")):
            x = float(value["min_x"])
            y = float(value["min_y"])
            return {"x": x, "y": y, "w": float(value["max_x"]) - x, "h": float(value["max_y"]) - y}
        if all(k in value for k in ("x_min", "y_min", "x_max", "y_max")):
            x = float(value["x_min"])
            y = float(value["y_min"])
            return {"x": x, "y": y, "w": float(value["x_max"]) - x, "h": float(value["y_max"]) - y}
    nums = _numbers(value)
    if len(nums) < 4:
        return None
    x, y, a, b = nums[:4]
    if a > x and b > y:
        w, h = a - x, b - y
    else:
        w, h = a, b
    if w <= 0 or h <= 0:
        return None
    return {"x": x, "y": y, "w": w, "h": h}


def _bounds_for_boxes(boxes) -> Optional[dict]:
    vals = [b for b in boxes if b and b.get("w", 0) > 0 and b.get("h", 0) > 0]
    if not vals:
        return None
    min_x = min(b["x"] for b in vals)
    min_y = min(b["y"] for b in vals)
    max_x = max(b["x"] + b["w"] for b in vals)
    max_y = max(b["y"] + b["h"] for b in vals)
    return {"x": min_x, "y": min_y, "w": max_x - min_x, "h": max_y - min_y}


def _extract_plate_object_boxes(data) -> tuple[dict[int, dict], Optional[dict]]:
    boxes: dict[int, dict] = {}
    plate_bounds = None

    def walk(node):
        nonlocal plate_bounds
        if isinstance(node, dict):
            if plate_bounds is None:
                for key in ("bbox_all", "plate_bbox", "build_plate_bbox"):
                    if key in node:
                        plate_bounds = _bbox_from_value(node.get(key))
                        if plate_bounds:
                            break
            raw_id = node.get("identify_id", node.get("object_id", node.get("id")))
            bbox = None
            for key in ("bbox", "bbox_all", "bounding_box", "bounds"):
                if key in node:
                    bbox = _bbox_from_value(node.get(key))
                    if bbox:
                        break
            try:
                obj_id = int(raw_id) if raw_id is not None else None
            except (TypeError, ValueError):
                obj_id = None
            if obj_id is not None and bbox:
                boxes[obj_id] = bbox
            for value in node.values():
                walk(value)
        elif isinstance(node, list):
            for value in node:
                walk(value)

    walk(data)
    return boxes, plate_bounds


def fetch_bambu_preview(ip: str, access_code: str, subtask_name: str, plate_number: Optional[int] = None) -> Optional[BambuPreview]:
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

    return _parse_3mf(buf, plate_number=plate_number)


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
