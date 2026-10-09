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
    top_image_png: Optional[bytes] = None
    filament_colors: Optional[str] = None
    filament_ids: Optional[list[int]] = None
    objects: Optional[list[dict]] = None
    plate_bounds: Optional[dict] = None
    bed_bounds: Optional[dict] = None
    bbox_all: Optional[list[float]] = None
    print_plate_number: Optional[int] = None


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


def _parse_3mf(
    buf: io.BytesIO,
    plate_number: Optional[int] = None,
    *,
    include_object_geometry: bool = True,
) -> BambuPreview:
    """Extract thumbnail and metadata from an in-memory .gcode.3mf zip."""
    with zipfile.ZipFile(buf) as z:
        plate_number = _resolve_print_plate_number(z.namelist(), plate_number)
        try:
            image_png: Optional[bytes] = z.read(f"Metadata/plate_{plate_number}.png")
        except KeyError:
            try:
                image_png = z.read("Metadata/plate_1.png")
            except KeyError:
                image_png = None
        try:
            top_image_png: Optional[bytes] = z.read(f"Metadata/top_{plate_number}.png")
        except KeyError:
            try:
                top_image_png = z.read("Metadata/top_1.png")
            except KeyError:
                top_image_png = None
        try:
            slice_xml = z.read("Metadata/slice_info.config").decode()
        except KeyError:
            return BambuPreview(image_png=image_png, estimated_total_seconds=None,
                                top_image_png=top_image_png,
                                filament_weight_g=None, filament_type=None, filament_colors=None,
                                objects=None, print_plate_number=plate_number)
        try:
            plate_json = json.loads(z.read(f"Metadata/plate_{plate_number}.json").decode())
        except Exception:
            plate_json = None
        try:
            plate_gcode = z.read(f"Metadata/plate_{plate_number}.gcode").decode("utf-8", "ignore")
        except Exception:
            plate_gcode = ""
        try:
            project_settings = z.read("Metadata/project_settings.config").decode("utf-8", "ignore")
        except Exception:
            try:
                project_settings = z.read("project_settings.config").decode("utf-8", "ignore")
            except Exception:
                project_settings = ""

    root_el = ET.fromstring(slice_xml)
    plates = root_el.findall("plate")
    plate = None
    if plates:
        # Prefer metadata index=N (matches Metadata/plate_N.gcode). Fall back
        # to 1-based position when the export omitted index keys.
        for el in plates:
            idx_el = el.find("metadata[@key='index']")
            try:
                idx = int(idx_el.get("value")) if idx_el is not None else None
            except (TypeError, ValueError):
                idx = None
            if idx == plate_number:
                plate = el
                break
        if plate is None:
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
    slice_filament_ids: list[int] = []
    objects = []
    bbox_by_name, bbox_all = _extract_plate_bbox_objects(plate_json)
    object_boxes, object_boxes_by_name, object_points_by_name, plate_bounds = _extract_plate_object_boxes(plate_json)
    if plate_bounds:
        object_boxes = {k: _flip_bbox_y(v, plate_bounds) for k, v in object_boxes.items()}
        object_boxes_by_name = {
            k: [_flip_bbox_y(v, plate_bounds) for v in vals]
            for k, vals in object_boxes_by_name.items()
        }
    # Object footprint extraction walks every G1 in the plate gcode — fine for
    # one-shot previews, disastrous on the queue hot path (multi‑MB files).
    gcode_object_boxes: dict = {}
    gcode_object_shapes: dict = {}
    bed_bounds: Optional[dict] = None
    if include_object_geometry:
        gcode_object_boxes, gcode_object_shapes, bed_bounds = _extract_gcode_object_geometry(plate_gcode)
        if gcode_object_boxes:
            plate_bounds = plate_bounds or _bounds_for_boxes(gcode_object_boxes.values())
    if plate is not None:
        filament_nozzles = _parse_filament_nozzle_map(project_settings, plate)
        name_counts: dict[str, int] = {}
        name_box_counts: dict[str, int] = {}
        name_point_counts: dict[str, int] = {}
        for idx, el in enumerate(plate.findall("filament")):
            color = el.get("color")
            used_g = el.get("used_g")
            ftype = el.get("type")
            if color:
                try:
                    grams = float(used_g) if used_g else None
                except ValueError:
                    grams = None
                filament = {"type": ftype, "color": color.upper(), "used_g": grams}
                try:
                    # XML filament id is 1-indexed (global project slot number);
                    # the gcode uses 0-indexed T commands, so subtract 1.
                    filament_slot = int(el.get("id")) - 1
                    slice_filament_ids.append(filament_slot)
                except (TypeError, ValueError):
                    filament_slot = idx
                try:
                    nozzle_idx = int(el.get("id")) - 1
                except (TypeError, ValueError):
                    nozzle_idx = idx
                if 0 <= nozzle_idx < len(filament_nozzles):
                    filament["nozzle"] = filament_nozzles[nozzle_idx]
                filaments.append(filament)
        for el in plate.findall("object"):
            obj_id = el.get("identify_id")
            name = el.get("name") or f"Object {obj_id or len(objects) + 1}"
            try:
                identify_id = int(obj_id) if obj_id is not None else None
            except ValueError:
                identify_id = None
            base = name.rsplit("/", 1)[-1].rsplit("\\", 1)[-1]
            name_counts[base] = name_counts.get(base, 0) + 1
            map_x = map_y = None
            map_bbox = None
            for lookup in (name, base):
                bboxes = bbox_by_name.get(lookup)
                if bboxes:
                    raw = bboxes.pop(0)
                    map_x = (raw[0] + raw[2]) / 2
                    map_y = (raw[1] + raw[3]) / 2
                    map_bbox = {
                        "x": raw[0],
                        "y": raw[1],
                        "w": raw[2] - raw[0],
                        "h": raw[3] - raw[1],
                    }
                    break
            box = map_bbox
            if box is None:
                box = object_boxes.get(identify_id) if identify_id is not None else None
            if box is None:
                name_box_counts[base] = name_box_counts.get(base, 0) + 1
                matching_boxes = object_boxes_by_name.get(base) or []
                box_index = name_box_counts[base] - 1
                if box_index < len(matching_boxes):
                    box = matching_boxes[box_index]
            point = None
            if map_x is not None and map_y is not None:
                point = {"x": map_x, "y": map_y}
            else:
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

    raw_fids = plate_json.get("filament_ids") if isinstance(plate_json, dict) else None
    filament_ids: Optional[list[int]] = None
    if slice_filament_ids:
        filament_ids = slice_filament_ids
    elif isinstance(raw_fids, list) and raw_fids:
        try:
            filament_ids = [int(x) for x in raw_fids]
        except (TypeError, ValueError):
            filament_ids = None

    return BambuPreview(
        image_png=image_png,
        top_image_png=top_image_png,
        estimated_total_seconds=int(pred) if pred else None,
        filament_weight_g=float(weight) if weight else None,
        filament_type=filament_type,
        filament_colors=json.dumps(filaments) if filaments else None,
        filament_ids=filament_ids,
        objects=objects or None,
        plate_bounds=plate_bounds,
        bed_bounds=bed_bounds,
        bbox_all=bbox_all,
        print_plate_number=plate_number,
    )


def _gcode_plate_numbers(names: list[str]) -> list[int]:
    """Return sorted 1-based plate indexes that have Metadata/plate_N.gcode."""
    plates: list[int] = []
    for name in names:
        match = re.search(r"(?i)(?:^|/)Metadata/plate_(\d+)\.gcode$", name.replace("\\", "/"))
        if not match:
            continue
        try:
            plates.append(int(match.group(1)))
        except ValueError:
            pass
    return sorted(set(plates))


def list_3mf_gcode_plates(data: bytes) -> list[int]:
    """Plate numbers inside a .gcode.3mf that can actually be printed."""
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            return _gcode_plate_numbers(z.namelist())
    except Exception:
        return []


def _resolve_print_plate_number(names: list[str], requested: Optional[int] = None) -> int:
    """Return the plate number that actually has printable gcode.

    Bambu Studio can export a project where only one non-first plate is sliced,
    for example Metadata/plate_6.gcode with preview JSON/PNGs for plates 1-9.
    The printer rejects a start command that points at a missing plate_1.gcode.
    """
    try:
        requested_num = int(requested) if requested is not None else None
    except (TypeError, ValueError):
        requested_num = None
    gcode_plates = _gcode_plate_numbers(names)
    if requested_num and requested_num in gcode_plates:
        return requested_num
    if gcode_plates:
        return gcode_plates[0]
    return requested_num or 1


def _parse_config_value(text: str, key: str):
    if not text:
        return None
    try:
        data = json.loads(text)
        if isinstance(data, dict):
            return data.get(key)
    except Exception:
        pass
    try:
        root = ET.fromstring(text)
        for el in root.iter():
            if el.get("key") == key or el.get("name") == key:
                return el.get("value") or (el.text or "")
    except Exception:
        pass
    match = re.search(
        rf'["\']?{re.escape(key)}["\']?\s*[:=]\s*(?:"([^"]*)"|\'([^\']*)\'|([^\r\n<]+))',
        text,
        re.IGNORECASE,
    )
    if match:
        return next((g for g in match.groups() if g is not None), "")
    return None


def _parse_int_list(value) -> list[int]:
    if value is None:
        return []
    if isinstance(value, (list, tuple)):
        raw = value
    else:
        raw = re.findall(r"-?\d+", str(value))
    out: list[int] = []
    for item in raw:
        try:
            out.append(int(item))
        except (TypeError, ValueError):
            continue
    return out


def _bambu_nozzle_to_flightdeck(value: int) -> Optional[int]:
    """Convert Bambu/printer extruder ids to Flightdeck queue ids.

    Bambu ``physical_extruder_map`` and MQTT extruder ids use 0=right and
    1=left. Flightdeck queue labels, AMS path checks, and H2D slot mapping
    use 0=left and 1=right.
    """
    if value == 0:
        return 1
    if value == 1:
        return 0
    return None


def _parse_filament_nozzle_map(project_settings: str, plate: Optional[ET.Element] = None) -> list[int]:
    """Return per-filament nozzle targets in Flightdeck ids (0=left, 1=right).

    The authoritative post-slice grouping is the per-plate ``filament_maps``
    metadata in slice_info.config: one 1-based group per global filament slot
    (1=left extruder, 2=right). project_settings ``filament_map`` can be stale
    when filament_map_mode is auto ("Auto For Flush"), so it must not win.
    """
    physical_map = _parse_int_list(_parse_config_value(project_settings, "physical_extruder_map"))

    def logical_to_flightdeck(logical: int) -> Optional[int]:
        # Logical extruder ids (0-based) map to physical MQTT ids via
        # physical_extruder_map (H2D: [1, 0]), and physical ids use 0=right,
        # 1=left. Without a physical map, logical order already matches
        # Flightdeck's 0=left/1=right labelling.
        if 0 <= logical < len(physical_map):
            return _bambu_nozzle_to_flightdeck(physical_map[logical])
        return logical if logical in (0, 1) else None

    if plate is not None:
        maps_el = plate.find("metadata[@key='filament_maps']")
        if maps_el is not None:
            maps = _parse_int_list(maps_el.get("value"))
            out = []
            for group in maps:
                converted = logical_to_flightdeck(group - 1)
                if converted is None:
                    break
                out.append(converted)
            if out and len(out) == len(maps):
                return out

    plate_extruders: list[int] = []
    if plate is not None:
        for nozzle_el in plate.findall("nozzle"):
            # <nozzle extruder_id=...> is a 1-based logical extruder id;
            # the id attribute is the same value 0-based.
            raw_ext = (nozzle_el.get("extruder_id") or "").strip()
            raw_id = (nozzle_el.get("id") or "").strip()
            try:
                if raw_ext:
                    plate_extruders.append(int(raw_ext) - 1)
                elif raw_id:
                    plate_extruders.append(int(raw_id))
            except (TypeError, ValueError):
                continue
    if plate_extruders:
        out = [
            converted
            for logical in plate_extruders
            for converted in [logical_to_flightdeck(logical)]
            if converted is not None
        ]
        if len(out) == 1 and plate is not None:
            return out * len(plate.findall("filament"))
        if out:
            return out

    nozzle_map = _parse_int_list(_parse_config_value(project_settings, "filament_nozzle_map"))
    if nozzle_map:
        out = []
        for nozzle in nozzle_map:
            mapped = nozzle
            if physical_map and 0 <= nozzle < len(physical_map):
                mapped = physical_map[nozzle]
            converted = _bambu_nozzle_to_flightdeck(mapped)
            if converted is not None:
                out.append(converted)
        return out

    return [
        converted
        for n in physical_map
        for converted in [_bambu_nozzle_to_flightdeck(n)]
        if converted is not None
    ]


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


def _extract_plate_bbox_objects(plate_json) -> tuple[dict[str, list[list[float]]], Optional[list[float]]]:
    """Read Bambu plate_N.json bbox_objects for skip-object preview alignment."""
    if not isinstance(plate_json, dict):
        return {}, None
    raw_bbox_all = plate_json.get("bbox_all")
    bbox_all: Optional[list[float]] = None
    if isinstance(raw_bbox_all, (list, tuple)) and len(raw_bbox_all) >= 4:
        try:
            bbox_all = [float(raw_bbox_all[0]), float(raw_bbox_all[1]), float(raw_bbox_all[2]), float(raw_bbox_all[3])]
        except (TypeError, ValueError):
            bbox_all = None
    by_name: dict[str, list[list[float]]] = {}
    for item in plate_json.get("bbox_objects") or []:
        if not isinstance(item, dict):
            continue
        obj_name = item.get("name")
        bbox = item.get("bbox")
        if not isinstance(obj_name, str) or not isinstance(bbox, (list, tuple)) or len(bbox) < 4:
            continue
        try:
            parsed = [float(bbox[0]), float(bbox[1]), float(bbox[2]), float(bbox[3])]
        except (TypeError, ValueError):
            continue
        by_name.setdefault(obj_name, []).append(parsed)
    return by_name, bbox_all


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


def _extract_gcode_object_geometry(gcode: str) -> tuple[dict[int, dict], dict[int, dict], Optional[dict]]:
    """Recover top-down per-object footprints from Bambu/Orca object label markers."""
    if not gcode:
        return {}, {}, None
    start_re = re.compile(r";\s*start printing object,\s*unique label id:\s*(\d+)", re.IGNORECASE)
    stop_re = re.compile(r";\s*stop printing object,\s*unique label id", re.IGNORECASE)
    feature_re = re.compile(r";\s*FEATURE:\s*(\S+.*)", re.IGNORECASE)
    area_re = re.compile(r";\s*printable_area\s*=\s*(.+)", re.IGNORECASE)
    move_re = re.compile(r"^G[01]\b([^;]*)")
    coord_re = re.compile(r"\b([XYE])(-?(?:\d+(?:\.\d*)?|\.\d+))")
    _SKIP_FEATURES = {"brim", "skirt", "prime_tower", "prime tower"}
    raw_boxes: dict[int, list[float]] = {}
    raw_shapes: dict[int, list[list[float]]] = {}
    current_id: Optional[int] = None
    last_x: Optional[float] = None
    last_y: Optional[float] = None
    skip_feature = False
    bed_bounds: Optional[dict] = None

    for raw_line in gcode.splitlines():
        line = raw_line.strip()
        if bed_bounds is None:
            am = area_re.match(line)
            if am:
                try:
                    pts = [tuple(float(v) for v in p.strip().split('x')) for p in am.group(1).split(',')]
                    xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
                    bw = max(xs) - min(xs); bh = max(ys) - min(ys)
                    if bw > 0 and bh > 0:
                        bed_bounds = {"x": min(xs), "y": min(ys), "w": bw, "h": bh}
                except Exception:
                    pass
        start = start_re.search(line)
        if start:
            current_id = int(start.group(1))
            skip_feature = False
            last_x = last_y = None
            raw_boxes.setdefault(current_id, [float("inf"), float("inf"), float("-inf"), float("-inf")])
            raw_shapes.setdefault(current_id, [])
            continue
        if stop_re.search(line):
            current_id = None
            skip_feature = False
            continue
        fm = feature_re.search(line)
        if fm:
            new_skip = fm.group(1).strip().lower() in _SKIP_FEATURES
            if new_skip and not skip_feature:
                last_x = last_y = None
            skip_feature = new_skip
            continue
        if skip_feature:
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
        if "X" not in values and "Y" not in values:
            continue  # pure retract/unretract: no XY movement, skip for bbox
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
    return boxes, shapes, bed_bounds


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
    if "553" in lowered or "could not create file" in lowered:
        return (
            "Bambu could not write the file to printer storage. "
            "Check the SD/USB card is inserted, not full, and formatted (FAT32/exFAT). "
            "If the same file was already sent from Bambu Studio, wait until that print finishes "
            "or clear it from Print Bay, then retry."
        )
    if "552" in lowered or "quota" in lowered or "storage quota" in lowered:
        return (
            "Bambu printer storage is full. "
            "Free space on the SD/USB card or use Print Bay → Clear SD prints, then retry."
        )
    if "550" in lowered or "no such file" in lowered or "not found" in lowered:
        return (
            "Bambu storage path is not available. "
            "Check the printer USB/SD storage and refresh the Print Bay before retrying."
        )
    if "timed out" in lowered or "timeout" in lowered or "connection" in lowered:
        return "Could not reach the Bambu FTP service. Check the printer is online and LAN access is enabled."
    return f"Bambu FTP upload failed: {text}"


def _preview_from_gcode_bytes(data: bytes) -> Optional[BambuPreview]:
    """Best-effort filament estimate from a gcode header when no 3MF is on printer storage."""
    import re

    text = data[:512_000].decode("utf-8", "ignore")
    filament_weight_g = filament_type = None
    re_weight = re.compile(
        r"\b(?:filament[_ -]?weight|filament[_ -]?used|filament_total|filament_total_weight)\s*(?:\[[gG]\])?\s*=\s*([0-9]+(?:\.[0-9]+)?)",
        re.I,
    )
    re_material = re.compile(r"\b(?:material|filament[_ -]?type)\b\s*[:=]\s*([A-Za-z0-9+\\-/* ]+)", re.I)
    for line in text.splitlines()[:5000]:
        if not line.startswith(";"):
            continue
        if filament_weight_g is None:
            m = re_weight.search(line)
            if m:
                try:
                    filament_weight_g = float(m.group(1))
                except ValueError:
                    pass
        if filament_type is None:
            m = re_material.search(line)
            if m:
                filament_type = re.split(r"[,/;]", m.group(1).strip())[0].strip() or None
        if filament_weight_g is not None and filament_type is not None:
            break
    if filament_weight_g is None and filament_type is None:
        return None
    return BambuPreview(
        image_png=None,
        top_image_png=None,
        estimated_total_seconds=None,
        filament_weight_g=filament_weight_g,
        filament_type=filament_type,
    )


_PLATE_GCODE_RE = re.compile(r"(?:^|[/\\])plate_(\d+)\.gcode$", re.IGNORECASE)


def _job_stem_from_name(name: str | None) -> Optional[str]:
    if not name:
        return None
    stem = str(name).strip().split("?", 1)[0].rsplit("/", 1)[-1].rsplit("\\", 1)[-1]
    if not stem or stem in {".", ".."} or _PLATE_GCODE_RE.search(stem):
        return None
    lower = stem.lower()
    for suffix in (".gcode.3mf", ".3mf", ".gcode.gz", ".gcode"):
        if lower.endswith(suffix):
            stem = stem[: -len(suffix)].strip()
            break
    return stem or None


def plate_number_from_job_name(name: str | None) -> Optional[int]:
    if not name:
        return None
    match = _PLATE_GCODE_RE.search(str(name))
    if not match:
        return None
    try:
        return int(match.group(1))
    except ValueError:
        return None


def resolve_preview_job_lookup(
    filename: str | None,
    subtask_name: str | None,
) -> tuple[Optional[str], Optional[int]]:
    """Return (job stem, plate number) for FTP preview lookup on Bambu storage."""
    plate_number = plate_number_from_job_name(filename) or plate_number_from_job_name(subtask_name)
    for candidate in (subtask_name, filename):
        stem = _job_stem_from_name(candidate)
        if stem:
            return stem, plate_number
    return None, plate_number


def _storage_name_stem(name: str) -> str:
    stem = str(name or "").rsplit("/", 1)[-1].rsplit("\\", 1)[-1].lower()
    for suffix in (".gcode.3mf", ".3mf", ".gcode.gz", ".gcode"):
        if stem.endswith(suffix):
            return stem[: -len(suffix)]
    return stem


def _best_storage_match(entries: list[tuple[str, dict]], stem: str) -> Optional[str]:
    wanted = _storage_name_stem(stem)
    if not wanted:
        return None
    ranked: list[tuple[int, str, str]] = []
    for name, facts in entries:
        if name in (".", ".."):
            continue
        lower = name.lower()
        if not lower.endswith((".gcode.3mf", ".3mf", ".gcode")):
            continue
        base = _storage_name_stem(name)
        if wanted == base:
            score = 0
        elif wanted in base or base in wanted:
            score = 1
        elif lower.endswith(".gcode.3mf"):
            score = 3
        else:
            continue
        ranked.append((score, facts.get("modify") or "", name))
    if not ranked:
        return None
    ranked.sort(key=lambda item: item[0])
    best_score = ranked[0][0]
    best = [item for item in ranked if item[0] == best_score]
    best.sort(key=lambda item: item[1], reverse=True)
    return best[0][2]


def fetch_bambu_preview(ip: str, access_code: str, subtask_name: str, plate_number: Optional[int] = None) -> Optional[BambuPreview]:
    """Download job metadata from printer storage, trying several FTP paths."""
    stem = str(subtask_name or "").strip().strip("/")
    paths: list[str] = []
    if stem:
        paths.extend([f"/{stem}.gcode.3mf", f"/{stem}.3mf"])
    if plate_number:
        paths.append(f"/plate_{plate_number}.gcode")

    ftp = _ImplicitFTP_TLS()
    try:
        ftp.connect(ip, 990, timeout=15)
        ftp.login("bblp", access_code)
        ftp.prot_p()
        ftp.set_pasv(True)

        for path in paths:
            try:
                buf = io.BytesIO()
                ftp.retrbinary(f"RETR {path}", buf.write)
                data = buf.getvalue()
                if path.endswith(".gcode"):
                    preview = _preview_from_gcode_bytes(data)
                    if preview:
                        return preview
                    continue
                return _parse_3mf(io.BytesIO(data), plate_number=plate_number)
            except Exception:
                continue

        if stem:
            try:
                match = _best_storage_match(list(ftp.mlsd("/")), stem)
            except Exception:
                match = None
            if match:
                try:
                    buf = io.BytesIO()
                    ftp.retrbinary(f"RETR /{match}", buf.write)
                    data = buf.getvalue()
                    if match.lower().endswith(".gcode"):
                        preview = _preview_from_gcode_bytes(data)
                        if preview:
                            return preview
                    else:
                        return _parse_3mf(io.BytesIO(data), plate_number=plate_number)
                except Exception:
                    pass
    finally:
        try:
            ftp.quit()
        except Exception:
            pass

    return None


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


def upload_bambu_file(
    ip: str,
    access_code: str,
    filename: str,
    data: bytes,
    plate_number: Optional[int] = None,
) -> BambuPreview:
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
        remote = f"/{filename.lstrip('/')}"
        try:
            ftp.delete(remote)
        except ftplib.error_perm as exc:
            # 550 = file not present; other errors are logged but upload may still succeed.
            if not str(exc).strip().startswith("550"):
                log.debug("Bambu pre-upload delete %s: %s", remote, exc)
        buf.seek(0)
        ftp.storbinary(f"STOR {remote}", buf)
    except Exception as exc:
        raise BambuFtpError(friendly_bambu_ftp_error(exc)) from exc
    finally:
        try:
            ftp.quit()
        except Exception:
            pass

    try:
        buf.seek(0)
        return _parse_3mf(buf, plate_number=plate_number, include_object_geometry=False)
    except Exception:
        return BambuPreview(image_png=None, estimated_total_seconds=None,
                            filament_weight_g=None, filament_type=None,
                            print_plate_number=plate_number)


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
