"""Extract estimated print time and filament grams from sliced vault files."""
from __future__ import annotations

import gzip
import io
import json
import re
import zipfile
from xml.etree import ElementTree as ET


def _local(tag: str) -> str:
    return tag.split("}")[-1].lower()


def _fmt_hours(seconds: float | None) -> float | None:
    if seconds is None or seconds <= 0:
        return None
    return round(float(seconds) / 3600.0, 2)


def parse_slice_totals(filename: str, data: bytes) -> dict:
    name = str(filename or "").lower()
    result = {
        "sliced": False,
        "seconds": None,
        "grams": None,
        "material": None,
        "plate_count": 0,
        "status": "not_sliced",
        "status_detail": "Not sliced yet",
    }
    if name.endswith(".gcode.3mf") or name.endswith(".3mf"):
        parsed = _parse_3mf_slice(data)
        result.update(parsed)
        return result
    if name.endswith(".gcode.gz"):
        try:
            text = gzip.decompress(data).decode("utf-8", "ignore")
        except Exception:
            return result
        parsed = _parse_gcode_slice(text)
        result.update(parsed)
        return result
    if name.endswith(".gcode") or name.endswith(".ufp"):
        parsed = _parse_gcode_slice(data.decode("utf-8", "ignore"))
        result.update(parsed)
        return result
    return result


def _status_for(out: dict, *, has_gcode: bool, has_slice_file: bool, plate_previews: int) -> dict:
    if out.get("seconds") or out.get("grams"):
        out["sliced"] = True
        out["status"] = "sliced"
        out["status_detail"] = "Sliced"
        return out
    if has_gcode:
        out["sliced"] = False
        out["status"] = "gcode_no_totals"
        out["status_detail"] = "Has plate gcode but no time/weight totals"
        return out
    if has_slice_file or plate_previews > 0:
        out["sliced"] = False
        out["status"] = "project_archive"
        out["status_detail"] = (
            "Bambu project file — Save Project keeps previews only. "
            "Export each plate as .gcode.3mf for quotes."
        )
        return out
    out["sliced"] = False
    out["status"] = "not_sliced"
    out["status_detail"] = "Not sliced yet"
    return out


def _parse_3mf_slice(data: bytes) -> dict:
    out = {
        "sliced": False,
        "seconds": None,
        "grams": None,
        "material": None,
        "plate_count": 0,
        "status": "not_sliced",
        "status_detail": "Not sliced yet",
    }
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            names = [n.replace("\\", "/") for n in z.namelist()]
            lower_map = {n.lower(): n for n in names}
            slice_name = next(
                (lower_map[n] for n in lower_map if n.endswith("metadata/slice_info.config") or n == "metadata/slice_info.config"),
                None,
            )
            if not slice_name:
                slice_name = next((lower_map[n] for n in lower_map if n.endswith("slice_info.config")), None)
            gcode_names = [
                n for n in names
                if n.replace("\\", "/").lower().startswith("metadata/")
                and n.lower().endswith(".gcode")
                and "/plate_" in n.replace("\\", "/").lower()
            ]
            plate_previews = sum(
                1 for n in names
                if re.search(r"(?i)metadata/plate_\d+\.png$", n.replace("\\", "/"))
            )
            xml = ""
            if slice_name:
                xml = z.read(slice_name).decode("utf-8", "ignore")
            seconds, grams, material, plates = _sum_slice_info_xml(xml)
            # Fall back: sum totals from embedded plate_*.gcode comments.
            if (seconds is None or grams is None) and gcode_names:
                g_secs = 0
                g_grams = 0.0
                g_mat = material
                g_plates = 0
                for gn in gcode_names:
                    try:
                        text = z.read(gn).decode("utf-8", "ignore")
                    except Exception:
                        continue
                    parsed = _parse_gcode_slice(text)
                    if parsed.get("seconds"):
                        g_secs += int(parsed["seconds"])
                        g_plates += 1
                    if parsed.get("grams"):
                        g_grams += float(parsed["grams"])
                        if not g_plates:
                            g_plates += 1
                    if not g_mat and parsed.get("material"):
                        g_mat = parsed["material"]
                if g_secs > 0 and seconds is None:
                    seconds = g_secs
                if g_grams > 0 and grams is None:
                    grams = g_grams
                if g_mat:
                    material = g_mat
                if g_plates and plates <= 0:
                    plates = g_plates
            out["seconds"] = int(seconds) if seconds and seconds > 0 else None
            out["grams"] = round(grams, 2) if grams and grams > 0 else None
            out["material"] = str(material).strip() if material else None
            out["plate_count"] = int(plates or 0)
            return _status_for(
                out,
                has_gcode=bool(gcode_names),
                has_slice_file=bool(slice_name),
                plate_previews=plate_previews,
            )
    except Exception:
        return out


def _sum_slice_info_xml(xml: str) -> tuple[float | None, float | None, str | None, int]:
    if not xml.strip():
        return None, None, None, 0
    try:
        root = ET.fromstring(xml)
    except Exception:
        return None, None, None, 0
    seconds = 0.0
    grams = 0.0
    material = None
    plates = 0
    for plate in root.iter():
        if _local(plate.tag) != "plate":
            continue
        plates += 1
        pred = None
        weight = None
        for child in list(plate):
            tag = _local(child.tag)
            if tag == "metadata":
                key = (child.attrib.get("key") or "").lower()
                value = child.attrib.get("value")
                if key == "prediction":
                    pred = value
                elif key == "weight":
                    weight = value
            elif tag == "filament" and material is None:
                material = child.attrib.get("type") or None
                used_g = child.attrib.get("used_g")
                if weight is None and used_g:
                    weight = used_g
        try:
            if pred:
                seconds += float(pred)
        except (TypeError, ValueError):
            pass
        try:
            if weight:
                grams += float(weight)
        except (TypeError, ValueError):
            pass
    return (
        seconds if seconds > 0 else None,
        grams if grams > 0 else None,
        material,
        plates,
    )


_RE_TIME = re.compile(r"\bTIME\s*:\s*(\d+)", re.I)
_RE_PRUSA_TIME = re.compile(
    r"estimated printing time(?: \(normal mode\))?\s*=\s*(?:(\d+)d\s*)?(?:(\d+)h\s*)?(?:(\d+)m\s*)?(?:(\d+)s)?",
    re.I,
)
_RE_WEIGHT = re.compile(
    r"(?:total filament used|filament used)\s*(?:\[[gG]\])?\s*=\s*([0-9]+(?:\.[0-9]+)?)",
    re.I,
)
_RE_MATERIAL = re.compile(r"filament[_ -]?type\s*[:=]\s*([A-Za-z0-9+/* -]+)", re.I)
_RE_BAMBU_MODEL_TIME = re.compile(r";\s*model printing time:\s*(?:(\d+)h\s*)?(?:(\d+)m\s*)?(?:(\d+)s)?", re.I)
_RE_BAMBU_TOTAL_TIME = re.compile(r";\s*total estimated time:\s*(?:(\d+)h\s*)?(?:(\d+)m\s*)?(?:(\d+)s)?", re.I)
_RE_BAMBU_WEIGHT = re.compile(r";\s*total filament weight \[g\]\s*:\s*([0-9]+(?:\.[0-9]+)?)", re.I)


def _hms_to_seconds(hours, mins, secs) -> int:
    return int(hours or 0) * 3600 + int(mins or 0) * 60 + int(secs or 0)


def _prusa_time_seconds(match: re.Match) -> int:
    days, hours, mins, secs = (int(g or 0) for g in match.groups())
    return days * 86400 + hours * 3600 + mins * 60 + secs


def _parse_gcode_slice(text: str) -> dict:
    head = "\n".join(text.splitlines()[:4000])
    tail = "\n".join(text.splitlines()[-800:])
    blob = head + "\n" + tail
    seconds = None
    grams = None
    material = None
    m_time = _RE_TIME.search(blob)
    if m_time:
        try:
            seconds = int(m_time.group(1))
        except ValueError:
            seconds = None
    if seconds is None:
        m_prusa = _RE_PRUSA_TIME.search(blob)
        if m_prusa:
            seconds = _prusa_time_seconds(m_prusa) or None
    if seconds is None:
        for rx in (_RE_BAMBU_TOTAL_TIME, _RE_BAMBU_MODEL_TIME):
            m = rx.search(blob)
            if m:
                seconds = _hms_to_seconds(*m.groups()) or None
                if seconds:
                    break
    m_w = _RE_WEIGHT.search(blob) or _RE_BAMBU_WEIGHT.search(blob)
    if m_w:
        try:
            grams = float(m_w.group(1))
        except ValueError:
            grams = None
    m_mat = _RE_MATERIAL.search(blob)
    if m_mat:
        material = m_mat.group(1).strip() or None
    sliced = seconds is not None or grams is not None
    return {
        "sliced": sliced,
        "seconds": seconds if seconds and seconds > 0 else None,
        "grams": round(grams, 2) if grams and grams > 0 else None,
        "material": material,
        "plate_count": 1 if sliced else 0,
        "status": "sliced" if sliced else "not_sliced",
        "status_detail": "Sliced" if sliced else "Not sliced yet",
    }


def hours_from_seconds(seconds: int | None) -> float | None:
    return _fmt_hours(seconds)


# Bambu Studio writes inherit-sentinels into Metadata/project_settings.config.
# The GUI treats them as "use parent preset"; Orca's CLI range-checks them first
# and exits with "Param values in 3mf/config error". Drop those keys so
# --load-settings supplies valid defaults.
_CLI_SENTINEL_MINUS_ONE_KEYS = {
    "raft_first_layer_expansion",
    "tree_support_wall_count",
    "prime_tower_brim_width",
    "prime_tower_width",
    "support_interface_spacing",
    "support_base_pattern_spacing",
}
_CLI_SENTINEL_ZERO_FILAMENT_KEYS = {
    "solid_infill_filament",
    "sparse_infill_filament",
    "wall_filament",
    "support_filament",
    "support_interface_filament",
}
_CLI_PARAM_ERROR_RE = re.compile(
    r"^([A-Za-z0-9_]+):\s+[-0-9.]+ not in range",
    re.MULTILINE,
)


def _cli_scalar_is(value, *, target: float) -> bool:
    if isinstance(value, bool):
        return False
    if isinstance(value, (int, float)) and float(value) == target:
        return True
    if isinstance(value, str):
        try:
            return float(value.strip()) == target
        except ValueError:
            return False
    return False


def _cli_value_is_sentinel(key: str, value, extra_keys: set[str] | None = None) -> bool:
    extra = extra_keys or set()
    if isinstance(value, list):
        return bool(value) and all(_cli_value_is_sentinel(key, item, extra) for item in value)
    if (key in _CLI_SENTINEL_MINUS_ONE_KEYS or key in extra) and _cli_scalar_is(value, target=-1.0):
        return True
    if (key in _CLI_SENTINEL_ZERO_FILAMENT_KEYS or key in extra) and _cli_scalar_is(value, target=0.0):
        return True
    return False


def parse_3mf_cli_param_keys(detail: str) -> set[str]:
    return {match.group(1) for match in _CLI_PARAM_ERROR_RE.finditer(detail or "")}


def sanitize_3mf_cli_sentinels(
    data: bytes,
    extra_keys: set[str] | None = None,
    extra_gcode_names: set[str] | None = None,
) -> bytes:
    """Strip Bambu inherit-sentinels so Orca CLI can slice MakerWorld/Save Project 3MFs."""
    if not data or data[:2] != b"PK":
        return data
    extra = {str(k) for k in (extra_keys or set()) if str(k).strip()}
    extra_gcode = {str(k).strip() for k in (extra_gcode_names or set()) if str(k).strip()}
    try:
        source = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile:
        return data
    try:
        names = source.namelist()
        targets = [
            name for name in names
            if "project_settings.config" in name.replace("\\", "/").lower()
        ]
        if not targets:
            return data
        replacements: dict[str, bytes] = {}
        for name in targets:
            raw_settings = source.read(name)
            try:
                parsed = json.loads(raw_settings.decode("utf-8", "ignore"))
            except Exception:
                continue
            if not isinstance(parsed, dict):
                continue
            cleaned = {
                key: value
                for key, value in parsed.items()
                if not _cli_value_is_sentinel(str(key), value, extra)
            }
            rewritten = sanitize_profile_gcode_placeholders(
                json.dumps(cleaned, indent=4).encode("utf-8"),
                extra_gcode,
            )
            if rewritten != raw_settings:
                replacements[name] = rewritten
        if not replacements:
            return data
        out = io.BytesIO()
        with zipfile.ZipFile(out, "w", compression=zipfile.ZIP_DEFLATED) as dest:
            for info in source.infolist():
                if info.is_dir():
                    continue
                payload = replacements.get(info.filename)
                if payload is None:
                    payload = source.read(info.filename)
                dest.writestr(info.filename, payload)
        return out.getvalue()
    except Exception:
        return data
    finally:
        source.close()


# Newer Bambu H2D / MakerWorld 3MF G-code uses placeholders Orca 2.4.0-alpha
# does not know. Treat unknown bools as false; rewrite elsif/ceil; stub the rest.
_CLI_UNKNOWN_GCODE_BOOLS = {
    "cooling_filter_enabled",
    "timelapse_inline_photo",
    "farthest_point_timelapse_enabled",
}
_CLI_UNKNOWN_GCODE_STRINGS = {
    "old_extruder_variant",
    "new_extruder_variant",
}
_CLI_UNKNOWN_GCODE_ARRAYS = {
    "filament_map",
    "retract_length_toolchange",
    "flush_volumetric_speeds",
    "retraction_distances_when_cut",
}
_CLI_UNKNOWN_GCODE_FUNCS = {"ceil"}
_GCODE_KEEP_IDENTS = {
    "if", "else", "endif", "elsif", "min", "max", "true", "false", "and", "or", "not",
}
_GCODE_IDENT_RE = re.compile(r"[A-Za-z_][A-Za-z0-9_]*")
_GCODE_UNKNOWN_VAR_RE = re.compile(
    r"Not a variable name[^\n]*\r?\n\s*\{(?:if\s*\(?\s*)?([A-Za-z_][A-Za-z0-9_]*)",
    re.IGNORECASE,
)
_GCODE_UNKNOWN_CARET_RE = re.compile(
    r"Not a variable name[^\n]*\r?\n([^\n]+)\r?\n([ \t]*)\^",
    re.IGNORECASE,
)
_GCODE_FIELD_LINE_RE = re.compile(
    r"([A-Za-z0-9_]*gcode) Parsing error at line (\d+):",
    re.IGNORECASE,
)
_GCODE_IF_TOKEN_RE = re.compile(r"\{if\b|\{else\}|\{endif\}", re.IGNORECASE)
_GCODE_FLOW_RE = re.compile(r"\{elsif\b|\{if\b|\{else\}|\{endif\}", re.IGNORECASE)


def parse_unknown_gcode_vars(detail: str, gcode_sources: list[bytes] | None = None) -> set[str]:
    text = detail or ""
    names = {match.group(1) for match in _GCODE_UNKNOWN_VAR_RE.finditer(text)}
    for match in _GCODE_UNKNOWN_CARET_RE.finditer(text):
        line = match.group(1)
        col = len(match.group(2))
        hit = ""
        for ident in _GCODE_IDENT_RE.finditer(line):
            if ident.start() <= col < ident.end():
                hit = ident.group(0)
                break
        if not hit:
            later = [ident for ident in _GCODE_IDENT_RE.finditer(line) if ident.start() >= col]
            if later:
                hit = later[0].group(0)
        if hit and hit.lower() not in _GCODE_KEEP_IDENTS:
            names.add(hit)
    field_match = _GCODE_FIELD_LINE_RE.search(text)
    if field_match:
        names.update(_names_from_gcode_error_line(
            field_match.group(1),
            int(field_match.group(2)),
            gcode_sources or [],
        ))
    return {name for name in names if name and name.lower() not in _GCODE_KEEP_IDENTS}


def _profile_dicts_from_blob(blob: bytes) -> list[dict]:
    if not blob:
        return []
    if blob[:2] == b"PK":
        try:
            with zipfile.ZipFile(io.BytesIO(blob)) as archive:
                found: list[dict] = []
                for name in archive.namelist():
                    if "project_settings.config" not in name.replace("\\", "/").lower():
                        continue
                    parsed = json.loads(archive.read(name).decode("utf-8", "ignore"))
                    if isinstance(parsed, dict):
                        found.append(parsed)
                return found
        except Exception:
            return []
    try:
        parsed = json.loads(blob.decode("utf-8-sig"))
    except Exception:
        return []
    return [parsed] if isinstance(parsed, dict) else []


def _names_from_gcode_error_line(field: str, line_no: int, sources: list[bytes]) -> set[str]:
    names: set[str] = set()
    known = (
        _CLI_UNKNOWN_GCODE_BOOLS
        | _CLI_UNKNOWN_GCODE_STRINGS
        | _CLI_UNKNOWN_GCODE_ARRAYS
        | _CLI_UNKNOWN_GCODE_FUNCS
    )
    for blob in sources:
        for profile in _profile_dicts_from_blob(blob):
            raw = profile.get(field)
            if not isinstance(raw, str):
                continue
            lines = raw.splitlines()
            for idx in (line_no - 1, line_no - 2):
                if idx < 0 or idx >= len(lines):
                    continue
                line = lines[idx]
                for ident in _GCODE_IDENT_RE.findall(line):
                    if ident in known or ident.lower() in _CLI_UNKNOWN_GCODE_FUNCS:
                        names.add(ident)
                    elif re.search(rf"\b{re.escape(ident)}\s*\(", line) and ident.lower() not in {"min", "max", "if"}:
                        names.add(ident)
    return names


def _placeholder_end(text: str, start: int) -> int:
    close = text.find("}", start)
    return close + 1 if close >= 0 else len(text)


def _rewrite_elsif_blocks(text: str) -> str:
    """Orca 2.4.0-alpha has no {elsif}; expand to nested {else}{if}…{endif}."""
    if "{elsif" not in text.lower():
        return text
    out: list[str] = []
    cursor = 0
    depth = 0
    extras: dict[int, int] = {}
    for token in _GCODE_FLOW_RE.finditer(text):
        if token.start() < cursor:
            continue
        out.append(text[cursor:token.start()])
        kind = token.group(0).lower()
        end = _placeholder_end(text, token.start())
        chunk = text[token.start():end]
        if kind.startswith("{elsif"):
            cond = chunk[len("{elsif"):-1] if chunk.endswith("}") else chunk[len("{elsif"):]
            extras[depth] = extras.get(depth, 0) + 1
            out.append("{else}{if" + cond + "}")
        elif kind.startswith("{if"):
            depth += 1
            extras[depth] = 0
            out.append(chunk)
        elif kind == "{else}":
            out.append(chunk)
        elif kind == "{endif}":
            extra = extras.get(depth, 0)
            extras[depth] = 0
            out.append(chunk + ("{endif}" * extra))
            depth = max(0, depth - 1)
        cursor = end
    out.append(text[cursor:])
    return "".join(out)


def _replace_array_uses(text: str, name: str, value: str) -> str:
    pattern = re.compile(rf"\b{re.escape(name)}\s*\[[^\[\]]*\]", re.IGNORECASE)
    prev = None
    out = text
    while out != prev:
        prev = out
        out = pattern.sub(value, out)
    return out


def _replace_func_uses(text: str, name: str) -> str:
    pattern = re.compile(rf"\b{re.escape(name)}\s*\(([^()]*)\)", re.IGNORECASE)
    return pattern.sub(r"(\1)", text)


def _replace_ident_uses(text: str, name: str, value: str) -> str:
    pattern = re.compile(rf"\b{re.escape(name)}\b", re.IGNORECASE)

    def repl(match: re.Match) -> str:
        body = match.group(1)
        return "{" + pattern.sub(value, body) + "}"

    return re.sub(r"\{([^{}]+)\}", repl, text)


def _strip_unknown_gcode_if_blocks(text: str, names: set[str]) -> str:
    out = _rewrite_elsif_blocks(text)
    bools = {name for name in names if name in _CLI_UNKNOWN_GCODE_BOOLS or name.endswith("_enabled")}
    strings = {name for name in names if name in _CLI_UNKNOWN_GCODE_STRINGS or name.endswith("_variant")}
    arrays = {name for name in names if name in _CLI_UNKNOWN_GCODE_ARRAYS}
    funcs = {name for name in names if name.lower() in _CLI_UNKNOWN_GCODE_FUNCS}
    for name in names:
        key = name.lower()
        if key in _CLI_UNKNOWN_GCODE_FUNCS:
            funcs.add(name)
        if name in _CLI_UNKNOWN_GCODE_ARRAYS:
            arrays.add(name)
        if name in _CLI_UNKNOWN_GCODE_STRINGS or name.endswith("_variant"):
            strings.add(name)
        if name in _CLI_UNKNOWN_GCODE_BOOLS or name.endswith("_enabled"):
            bools.add(name)
    for name in funcs:
        out = _replace_func_uses(out, name)
    prev = None
    while out != prev:
        prev = out
        for name in arrays:
            out = _replace_array_uses(out, name, "1")
    for name in strings:
        out = _replace_ident_uses(out, name, '""')
    leftover = names - bools - strings - arrays - funcs
    for name in leftover:
        if name.lower() in _GCODE_KEEP_IDENTS:
            continue
        out = _replace_array_uses(out, name, "0")
        out = _replace_ident_uses(out, name, "0")
    for name in bools:
        if not name:
            continue
        out = _keep_else_for_unknown_bool(out, name)
        ident = re.escape(name)
        ternary = re.compile(
            rf"\(\s*{ident}\s*\?(?P<yes>.*?):(?P<no>.*?)\)",
            re.IGNORECASE | re.DOTALL,
        )
        out = ternary.sub(lambda m: f"({m.group('no').strip()})", out)
    return out


def _keep_else_for_unknown_bool(text: str, name: str) -> str:
    start_re = re.compile(
        rf"\{{if\s*\(?\s*{re.escape(name)}\s*\)?\}}",
        re.IGNORECASE,
    )
    pieces: list[str] = []
    cursor = 0
    while True:
        start = start_re.search(text, cursor)
        if not start:
            pieces.append(text[cursor:])
            break
        pieces.append(text[cursor:start.start()])
        depth = 1
        else_body_at: int | None = None
        scan = start.end()
        end_at = None
        while depth > 0:
            token = _GCODE_IF_TOKEN_RE.search(text, scan)
            if not token:
                pieces.append(text[start.start():])
                return "".join(pieces)
            kind = token.group(0).lower()
            if kind.startswith("{if"):
                depth += 1
            elif kind == "{else}":
                if depth == 1:
                    else_body_at = token.end()
            elif kind == "{endif}":
                depth -= 1
                if depth == 0:
                    end_at = token.start()
                    cursor = token.end()
                    break
            scan = token.end()
        if else_body_at is not None and end_at is not None:
            pieces.append(text[else_body_at:end_at])
        elif end_at is None:
            pieces.append(text[start.start():])
            break
    return "".join(pieces)


def sanitize_profile_gcode_placeholders(profile_data: bytes, extra_names: set[str] | None = None) -> bytes:
    """Replace unknown custom-G-code placeholders so older Orca CLI can slice."""
    names = set(_CLI_UNKNOWN_GCODE_BOOLS)
    names.update(_CLI_UNKNOWN_GCODE_STRINGS)
    names.update(_CLI_UNKNOWN_GCODE_ARRAYS)
    names.update(_CLI_UNKNOWN_GCODE_FUNCS)
    for name in extra_names or set():
        key = str(name).strip()
        if key:
            names.add(key)
    if not names or not profile_data:
        return profile_data
    try:
        profile = json.loads(profile_data.decode("utf-8-sig"))
    except Exception:
        return profile_data
    if not isinstance(profile, dict):
        return profile_data

    def rewrite(value, key=""):
        if isinstance(value, str):
            if "gcode" in str(key).lower():
                return _strip_unknown_gcode_if_blocks(value, names)
            return value
        if isinstance(value, list):
            return [rewrite(item, key) for item in value]
        if isinstance(value, dict):
            return {child: rewrite(item, child) for child, item in value.items()}
        return value

    cleaned = rewrite(profile)
    if cleaned == profile:
        return profile_data
    return json.dumps(cleaned, ensure_ascii=False, indent=4).encode("utf-8")
