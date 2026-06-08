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
import re

log = logging.getLogger(__name__)
_MAX_OBJECT_SHAPE_SEGMENTS = 260


class BambuFtpError(RuntimeError):
    """Operator-facing Bambu FTP/FTPS error."""


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
        try:
            plate_gcode = z.read(f"Metadata/plate_{plate_number}.gcode").decode("utf-8", "ignore")
        except Exception:
            plate_gcode = ""

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
    object_boxes, object_boxes_by_name, object_points_by_name, plate_bounds = _extract_plate_object_boxes(plate_json)
    if plate_bounds:
        object_boxes = {k: _flip_bbox_y(v, plate_bounds) for k, v in object_boxes.items()}
        object_boxes_by_name = {
            k: [_flip_bbox_y(v, plate_bounds) for v in vals]
            for k, vals in object_boxes_by_name.items()
        }
    gcode_object_boxes, gcode_object_shapes = _extract_gcode_object_geometry(plate_gcode)
    if gcode_object_boxes:
        object_boxes.update(gcode_object_boxes)
        plate_bounds = plate_bounds or _bounds_for_boxes(gcode_object_boxes.values())
    if plate is not None:
        name_counts: dict[str, int] = {}
        name_box_counts: dict[str, int] = {}
        name_point_counts: dict[str, int] = {}
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
            box = object_boxes.get(identify_id) if identify_id is not None else None
            if box is None:
                name_box_counts[base] = name_box_counts.get(base, 0) + 1
                matching_boxes = object_boxes_by_name.get(base) or []
                box_index = name_box_counts[base] - 1
                if box_index < len(matching_boxes):
                    box = matching_boxes[box_index]
            point = None
            matching_points = object_points_by_name.get(name) or object_points_by_name.get(base) or []
            if matching_points:
                name_point_counts[base] = name_point_counts.get(base, 0) + 1
                point_index = name_point_counts[base] - 1
                if point_index < len(matching_points):
                    point = matching_points[point_index]
            objects.append({
                "id": identify_id,
                "name": base,
                "label": f"{base} #{name_counts[base]}" if name_counts[base] > 1 else base,
                "state": "excluded" if el.get("skipped", "false").lower() == "true" else "available",
                **({"x": point["x"], "y": point["y"]} if point else {}),
                **({"bbox": box} if box else {}),
                **({"shape": gcode_object_shapes[identify_id]} if identify_id in gcode_object_shapes else {}),
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


def _flip_bbox_y(box: dict, bounds: dict) -> dict:
    bounds_y = float(bounds["y"])
    bounds_max_y = bounds_y + float(bounds["h"])
    return {
        **box,
        "y": bounds_y + (bounds_max_y - (float(box["y"]) + float(box["h"]))),
    }


def _extract_plate_object_boxes(data) -> tuple[dict[int, dict], dict[str, list[dict]], dict[str, list[dict]], Optional[dict]]:
    boxes: dict[int, dict] = {}
    boxes_by_name: dict[str, list[dict]] = {}
    points_by_name: dict[str, list[dict]] = {}
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
            raw_name = node.get("name")
            if isinstance(raw_name, str) and bbox:
                base = raw_name.rsplit("/", 1)[-1].rsplit("\\", 1)[-1]
                boxes_by_name.setdefault(base, []).append(bbox)
                point = {
                    "x": float(bbox["x"]) + (float(bbox["w"]) / 2),
                    "y": float(bbox["y"]) + (float(bbox["h"]) / 2),
                }
                points_by_name.setdefault(raw_name, []).append(point)
                if base != raw_name:
                    points_by_name.setdefault(base, []).append(point)
            for value in node.values():
                walk(value)
        elif isinstance(node, list):
            for value in node:
                walk(value)

    walk(data)
    return boxes, boxes_by_name, points_by_name, plate_bounds


def _extract_gcode_object_geometry(gcode: str) -> tuple[dict[int, dict], dict[int, dict]]:
    """Recover top-down per-object footprints from Bambu/Orca object label markers."""
    if not gcode:
        return {}, {}
    start_re = re.compile(r";\s*start printing object,\s*unique label id:\s*(\d+)", re.IGNORECASE)
    stop_re = re.compile(r";\s*stop printing object,\s*unique label id", re.IGNORECASE)
    move_re = re.compile(r"^G[01]\b([^;]*)")
    coord_re = re.compile(r"\b([XYE])(-?\d+(?:\.\d+)?)")
    raw_boxes: dict[int, list[float]] = {}
    raw_shapes: dict[int, list[list[float]]] = {}
    current_id: Optional[int] = None
    last_x: Optional[float] = None
    last_y: Optional[float] = None

    for raw_line in gcode.splitlines():
        line = raw_line.strip()
        start = start_re.search(line)
        if start:
            current_id = int(start.group(1))
            raw_boxes.setdefault(current_id, [float("inf"), float("inf"), float("-inf"), float("-inf")])
            raw_shapes.setdefault(current_id, [])
            continue
        if stop_re.search(line):
            current_id = None
            continue
        move = move_re.match(line)
        if not move:
            continue
        values = {
            axis: float(value)
            for axis, value in coord_re.findall(move.group(1))
        }
        old_x, old_y = last_x, last_y
        if "X" in values:
            last_x = values["X"]
        if "Y" in values:
            last_y = values["Y"]
        if current_id is None or last_x is None or last_y is None:
            continue
        if values.get("E", 0.0) <= 0:
            continue
        box = raw_boxes[current_id]
        segment_points = []
        for x, y in ((old_x, old_y), (last_x, last_y)):
            if x is None or y is None:
                continue
            segment_points.append((x, y))
            box[0] = min(box[0], x)
            box[1] = min(box[1], y)
            box[2] = max(box[2], x)
            box[3] = max(box[3], y)
        if (
            len(segment_points) == 2
            and len(raw_shapes[current_id]) < _MAX_OBJECT_SHAPE_SEGMENTS
        ):
            (x1, y1), (x2, y2) = segment_points
            raw_shapes[current_id].append([
                round(x1, 3),
                round(y1, 3),
                round(x2, 3),
                round(y2, 3),
            ])

    boxes: dict[int, dict] = {}
    for obj_id, (min_x, min_y, max_x, max_y) in raw_boxes.items():
        if max_x > min_x and max_y > min_y:
            boxes[obj_id] = {"x": min_x, "y": min_y, "w": max_x - min_x, "h": max_y - min_y}
    shapes = {}
    for obj_id, segments in raw_shapes.items():
        if not segments or obj_id not in boxes:
            continue
        shape = {"segments": segments}
        hull = _convex_hull([(seg[0], seg[1]) for seg in segments] + [(seg[2], seg[3]) for seg in segments])
        if len(hull) >= 3:
            shape["polygon"] = [[round(x, 3), round(y, 3)] for x, y in hull]
        shapes[obj_id] = shape
    return boxes, shapes


def _convex_hull(points: list[tuple[float, float]]) -> list[tuple[float, float]]:
    unique = sorted(set(points))
    if len(unique) <= 2:
        return unique

    def cross(origin, a, b) -> float:
        return (a[0] - origin[0]) * (b[1] - origin[1]) - (a[1] - origin[1]) * (b[0] - origin[0])

    lower: list[tuple[float, float]] = []
    for point in unique:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], point) <= 0:
            lower.pop()
        lower.append(point)

    upper: list[tuple[float, float]] = []
    for point in reversed(unique):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], point) <= 0:
            upper.pop()
        upper.append(point)

    return lower[:-1] + upper[:-1]


def friendly_bambu_ftp_error(exc: Exception) -> str:
    text = str(exc).strip() or exc.__class__.__name__
    lowered = text.lower()
    if "426" in lowered or "partial" in lowered or "partial file" in lowered:
        return (
            "Bambu storage rejected the upload before it completed. "
            "Check the printer USB/SD storage is inserted, formatted, and not full, then try again."
        )
    if "550" in lowered or "no such file" in lowered or "not found" in lowered:
        return (
            "Bambu storage path is not available. "
            "Check the printer USB/SD storage and refresh the Print Bay before retrying."
        )
    if "timed out" in lowered or "timeout" in lowered or "connection" in lowered:
        return "Could not reach the Bambu FTP service. Check the printer is online and LAN access is enabled."
    return f"Bambu FTP upload failed: {text}"


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
    except Exception as exc:
        raise BambuFtpError(friendly_bambu_ftp_error(exc)) from exc
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
