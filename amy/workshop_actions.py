"""Exact workshop commands. Queue waits. Reprint is the one that starts."""
from __future__ import annotations

import re
from typing import Any

_PREFIX = re.compile(
    r"^(?:hey|hi|ok|yo|amy|please|just|can you|could you|would you|will you)\s+"
)
_TAIL = re.compile(r"\s+(?:please|now|thanks|thank you)$")

# AMS HT's first bay is Bambu tray 128. A spoken "slot 2" on the HT is 129.
AMS_HT_BASE = 128


def _clean(question: str) -> str:
    q = (question or "").lower().replace("\u2019", "'")
    q = q.replace("number", " ").replace("#", " ")
    q = re.sub(r"[^a-z0-9.'\" _+-]+", " ", q)
    q = re.sub(r"\s+", " ", q).strip()
    for _ in range(6):
        nxt = _PREFIX.sub("", q)
        if nxt == q:
            break
        q = nxt
    for _ in range(3):
        nxt = _TAIL.sub("", q)
        if nxt == q:
            break
        q = nxt.strip()
    return q


# Spoken page, hash, label. Longest names first so "print bay" beats "files".
FLIGHTDECK_PAGES: tuple[tuple[str, str, str], ...] = (
    ("global print bay", "#/files", "Global Print Bay"),
    ("print vault", "#/files", "Global Print Bay"),
    ("print bay", "#/files", "Global Print Bay"),
    ("flight tower", "#/mission", "Flight Tower"),
    ("fleet wall", "#/fleet", "Fleet Wall"),
    ("fleet filament", "#/filament", "Fleet Filament"),
    ("print memory", "#/memory", "Print Memory"),
    ("stl painter", "#/painter", "STL Painter"),
    ("mesh prep", "#/meshprep", "Mesh Prep"),
    ("flight manual", "#/manual", "Flight Manual"),
    ("makerworld", "#/makerworld", "MakerWorld"),
    ("makerdeck", "#/makerdeck", "MakerDeck"),
    ("walkthrough", "#/walkthrough", "Walkthrough"),
    ("telemetry", "#/stats", "Telemetry"),
    ("dashboard", "#/", "Dashboard"),
    ("queue", "#/queue", "Queue"),
    ("spools", "#/spools", "Spools"),
    ("projects", "#/projects", "Projects"),
    ("settings", "#/settings", "Settings"),
    ("filament", "#/filament", "Fleet Filament"),
    ("painter", "#/painter", "STL Painter"),
    ("cameras", "#/fleet", "Fleet Wall"),
    ("chop", "#/chop", "Chop"),
    ("about", "#/about", "About"),
    ("manual", "#/manual", "Flight Manual"),
    ("stats", "#/stats", "Telemetry"),
    ("files", "#/files", "Global Print Bay"),
    ("mission", "#/mission", "Flight Tower"),
    ("memory", "#/memory", "Print Memory"),
)

FLIGHTDECK_PRINTERS: tuple[tuple[str, str, str], ...] = (
    ("big girl", "o1c2", "Big Girl"),
    ("biggirl", "o1c2", "Big Girl"),
    ("big boy", "h2d", "BigBoy"),
    ("bigboy", "h2d", "BigBoy"),
    ("greyhound", "greyhound", "Greyhound"),
    ("voron", "greyhound", "Greyhound"),
    ("little boy", "x1c", "Little Boy"),
    ("o1c2", "o1c2", "Big Girl"),
    ("h2d", "h2d", "BigBoy"),
    ("x1c", "x1c", "X1C"),
)


def parse_flightdeck_page(question: str) -> dict[str, str] | None:
    """Open a page inside the Flightdeck window. Never a print start."""
    q = _clean(question)
    if not q:
        return None
    if re.search(r"\b(pause|resume|stop|cancel|abort)\b", q):
        return None
    if re.search(r"\bgo\s+(small|big|large|away)\b", q):
        return None
    if not re.search(r"\b(open|show|switch|go|pull|bring)\b", q):
        return None
    for key, href, label in FLIGHTDECK_PAGES:
        if re.search(rf"\b{re.escape(key)}\b", q):
            return {"hash": href, "label": label}
    for alias, pid, label in FLIGHTDECK_PRINTERS:
        if re.search(rf"\b{re.escape(alias)}\b", q):
            return {"hash": f"#/printer/{pid}", "label": label}
    return None


def parse_open_folder(question: str) -> str | None:
    """Any folder they name. Not a Flightdeck page, and not a print start."""
    raw = question or ""
    path_match = re.search(
        r"(?i)\b(?:open|show)\s+(?:me\s+)?(?:the\s+)?(?:folder\s+)?([a-z]:\\[^\n]+|\\\\[^\n]+)",
        raw,
    )
    if path_match:
        folder = path_match.group(1).strip().strip("\"'").rstrip(" .,")
        folder = re.split(r"(?i)\s+\band\b\s+", folder, maxsplit=1)[0].strip()
        return folder or None
    q = _clean(question)
    if not q or not re.search(r"\b(open|show)\b", q):
        return None
    if re.search(r"\b(pause|resume|stop|cancel|abort)\b", q):
        return None
    head = re.split(r"\s+\band\b\s+", q, maxsplit=1)[0].strip()
    named = re.search(r"\b(?:open|show)\s+(?:me\s+)?(?:the\s+)?folder\s+(.+)$", head)
    if named:
        folder = named.group(1).strip(" \"'")
        if folder and folder not in {"a", "an", "some", "any", "it", "that", "this"}:
            return folder
    trailing = re.search(r"\b(?:open|show)\s+(?:me\s+)?(?:the\s+)?(.+?)\s+(?:folder|directory)$", head)
    if trailing:
        folder = trailing.group(1).strip(" \"'")
        folder = re.sub(r"^(?:my|the)\s+", "", folder)
        if folder and folder not in {"a", "an", "some", "any"}:
            return folder
    if re.search(r"\b(queue|flightdeck|printer)\b", head):
        return None
    place = re.search(
        r"\b(?:open|show)\s+(?:me\s+)?(?:my\s+|the\s+)?(desktop|documents|docs|downloads|download|pictures|videos|music|onedrive)$",
        head,
    )
    if place:
        return place.group(1)
    drive = re.search(r"\b(?:open|show)\s+(?:me\s+)?(?:the\s+)?([a-z])\s+drive$", head)
    if drive:
        return f"{drive.group(1).upper()}:\\"
    return None


# Find a file and start it. Reprint, print, send, run, start, fire, kick off.
_START_FILE = re.compile(
    r"\b(?:re\s*-?\s*prints?|prints?\s+again|prints?|sends?|runs?|starts?|fires?(?:\s+up)?|kicks?\s+off)\b"
)
# Find a file and wait. Queue, que, cue, add, put, line up.
_WAIT_FILE = re.compile(r"\b(?:queues?|que|cue|adds?|puts?|line\s+up)\b")
_FILE_VERB = re.compile(
    r"\b(?:re\s*-?\s*prints?|prints?\s+again|prints?|sends?|runs?|starts?|"
    r"fires?(?:\s+up)?|kicks?\s+off|line\s+up|queues?|que|cue|adds?|puts?)\s+(.+)$"
)
_FILE_SKIP = {
    "the", "my", "a", "an", "it", "that", "this", "file", "files", "please",
    "printer", "flightdeck", "again", "job", "jobs", "just", "up", "onto",
    "and", "print", "queue",
}


def parse_queue_local_file(question: str) -> dict[str, Any] | None:
    """Queue or print a named file on a printer.

    'queue pla box on BigBoy' waits.
    'reprint pla box on BigBoy', 'send pla box to BigBoy', and
    'print pla box again on BigBoy' start it.
    """
    q = _clean(question)
    if not q:
        return None
    if re.search(r"\bspool\b", q) and re.search(r"\bams\b", q):
        return None
    if re.search(r"\b(pause|resume|stop|cancel|abort)\b", q):
        return None
    if re.search(r"\b(send|start)\s+(?:the\s+)?print\b", q):
        return None
    if re.fullmatch(r"(?:open|show|go to|switch to)\s+(?:the\s+)?(?:flightdeck\s+)?queue", q):
        return None
    start = _START_FILE.search(q) is not None
    if not start and _WAIT_FILE.search(q) is None:
        return None
    printer_id = ""
    printer_label = ""
    printer_alias = ""
    for alias, pid, label in FLIGHTDECK_PRINTERS:
        if re.search(rf"\b{re.escape(alias)}\b", q):
            printer_id = pid
            printer_label = label
            printer_alias = alias
            break
    if not printer_id:
        return None
    rest = re.sub(rf"\b{re.escape(printer_alias)}\b", " ", q)
    rest = re.sub(r"\s+", " ", rest).strip()
    opened = re.search(
        r"\b(?:open|grab|get|use)\s+(.+?)\s+and\s+(?:re\s*-?\s*prints?|prints?|sends?|runs?|queue|que|cue)\b",
        rest,
    )
    if opened:
        phrase = opened.group(1)
    else:
        queued = _FILE_VERB.search(rest)
        if not queued:
            return None
        phrase = re.sub(r"\b(?:in|on|to|for|onto)\b.*$", "", queued.group(1)).strip()
    tokens = [part for part in phrase.split() if part not in _FILE_SKIP]
    if not tokens:
        return None
    places = {"desktop", "documents", "docs", "downloads", "download", "pictures", "videos", "music", "onedrive"}
    if tokens[0] in places and len(tokens) >= 2:
        folders, filename = tokens[:-1], tokens[-1]
    else:
        folders, filename = [], " ".join(tokens)
    return {
        "folders": folders,
        "file": filename,
        "printer_id": printer_id,
        "printer_label": printer_label,
        "start": start,
    }


def match_named_files(names: list[str], query: str) -> list[str]:
    """Filenames whose stem contains the spoken name. Case and punctuation ignored."""
    needle = re.sub(r"[^a-z0-9]+", "", (query or "").lower())
    if not needle:
        return []
    hits: list[str] = []
    for name in names:
        stem = name.lower()
        for ext in (".gcode.3mf", ".gcode.gz", ".3mf", ".gcode", ".stl"):
            if stem.endswith(ext):
                stem = stem[: -len(ext)]
                break
        folded = re.sub(r"[^a-z0-9]+", "", stem)
        if needle in folded:
            hits.append(name)
    return hits


def parse_queue_load(question: str) -> str | None:
    """'open the queue in Flightdeck and load file <name>'."""
    q = _clean(question)
    if "load" not in q or "file" not in q:
        return None
    if "queue" not in q and "flightdeck" not in q:
        return None
    patterns = (
        r"(?:open|show)\s+(?:the\s+)?queue(?:\s+in\s+flightdeck)?\s+and\s+load\s+file\s+(.+)$",
        r"load\s+file\s+(.+?)\s+(?:in|on|into|from)\s+(?:the\s+)?(?:flightdeck\s+)?queue$",
        r"(?:open|show)\s+flightdeck(?:\s+queue)?\s+and\s+load\s+file\s+(.+)$",
    )
    name = ""
    for pattern in patterns:
        match = re.search(pattern, q)
        if match:
            name = match.group(1).strip(" \"'")
            break
    if not name or name in {"it", "that", "this", "the file"}:
        return None
    return name


def printer_label_for(printer_id: str) -> str:
    for _alias, pid, label in FLIGHTDECK_PRINTERS:
        if pid == printer_id:
            return label
    return printer_id or "that printer"


def describe_ams_slot(slot: int) -> str:
    """Turn a Flightdeck slot index into AMS 1 slot 2 or AMS HT slot 2."""
    flat = int(slot)
    if flat >= AMS_HT_BASE:
        number = flat - AMS_HT_BASE + 1
        if number <= 1:
            return "AMS HT"
        return f"AMS HT slot {number}"
    unit = flat // 4
    index = flat % 4
    return f"AMS {unit + 1} slot {index + 1}"


def _spoken_ams(text: str) -> tuple[bool, int | None, int | None]:
    """AMS HT, a spoken AMS number, and a spoken slot number. Numbers are 1-based."""
    q = text.lower().replace("\u2019", "'")
    q = re.sub(r"\s+", " ", q)
    ht = re.search(r"\bams\s*-?\s*ht\b", q) is not None
    unit = None
    if not ht:
        unit_match = re.search(r"\bams\s*-?\s*(\d+)\b", q)
        if unit_match:
            unit = int(unit_match.group(1))
    slot_match = re.search(r"\b(?:slot|s)\s*-?\s*(\d+)\b", q)
    slot = int(slot_match.group(1)) if slot_match else None
    return ht, unit, slot


def ams_flat_slot(ht: bool, unit: int | None, slot: int | None) -> int | None:
    """Flightdeck index. AMS 1 slot 2 is 1. AMS HT slot 2 is 129."""
    if ht:
        if slot is None:
            return AMS_HT_BASE
        if slot < 1:
            return None
        return AMS_HT_BASE + slot - 1
    if slot is None:
        return None
    if slot < 1:
        return None
    unit_index = 0 if unit is None else unit - 1
    if unit_index < 0:
        return None
    return unit_index * 4 + (slot - 1)


def parse_spool_check(question: str) -> dict[str, Any] | None:
    """Look up a spool or an AMS slot. Does not move anything or start a print.

    'check if spool 14 is in ams1 s2 on big boy'
    'where is spool 14'
    'what's in ams 1 slot 2 on bigboy'
    """
    q = _clean(question)
    if not q or ("spool" not in q and "ams" not in q):
        return None
    if not re.search(r"\b(check|see|look|confirm|where|what|which|is)\b", q):
        return None
    if re.search(r"\b(change|set|move|put|swap|load|assign|stick)\b", q):
        return None
    if re.search(r"\b(pause|resume|stop|cancel|abort)\b", q):
        return None
    number_match = re.search(r"\bspool\s+(\d+)\b", q)
    number = int(number_match.group(1)) if number_match else None
    ht, unit, spoken_slot = _spoken_ams(q)
    flat = None
    if ht or unit is not None or spoken_slot is not None:
        flat = ams_flat_slot(ht, unit, spoken_slot)
    if number is None and flat is None:
        return None
    printer_id = ""
    printer_label = ""
    for alias, pid, label in FLIGHTDECK_PRINTERS:
        if re.search(rf"\b{re.escape(alias)}\b", q):
            printer_id = pid
            printer_label = label
            break
    return {
        "spool_number": number,
        "slot": flat,
        "printer_id": printer_id,
        "printer_label": printer_label,
        "place": describe_ams_slot(flat) if flat is not None else "",
    }


def parse_spool_change(question: str) -> dict[str, Any] | None:
    """Move a numbered spool into an AMS slot. Does not start a print.

    'put spool 12 in BigBoy AMS HT' or
    'spool 12, AMS HT slot 2 on Big Girl'.
    """
    q = _clean(question)
    if "spool" not in q or "ams" not in q:
        return None
    if re.search(r"\b(pause|resume|stop|cancel|abort)\b", q):
        return None
    if re.search(r"\b(check|see|look|confirm|where|what|which)\b", q):
        return None
    has_verb = re.search(r"\b(change|set|move|put|swap|load|assign|stick)\b", q) is not None
    if re.search(r"\bis\b", q) and not has_verb:
        return None
    match = re.search(r"\bspool\s+(\d+)\b", q)
    if not match:
        return None
    slot = ams_slot(q)
    if slot is None:
        return None
    printer_id = ""
    printer_label = ""
    for alias, pid, label in FLIGHTDECK_PRINTERS:
        if re.search(rf"\b{re.escape(alias)}\b", q):
            printer_id = pid
            printer_label = label
            break
    named_slot = _spoken_ams(q)[2] is not None
    if not has_verb and not printer_id and not named_slot:
        return None
    return {
        "spool_number": int(match.group(1)),
        "slot": slot,
        "ams_ht": _spoken_ams(q)[0],
        "printer_id": printer_id,
        "printer_label": printer_label,
        "place": describe_ams_slot(slot),
    }


def ams_slot(text: str) -> int | None:
    """Spoken AMS slot. AMS 1 slot 2 is index 1. AMS HT with no number is the HT bay."""
    q = text.lower().replace("\u2019", "'")
    q = re.sub(r"\s+", " ", q)
    ht, unit, slot = _spoken_ams(q)
    if not ht and unit is None and slot is None:
        return None
    return ams_flat_slot(ht, unit, slot)


def explicit_printer_control(question: str, has_printer: bool) -> str | None:
    """Pause, resume, or stop a print. Music commands stay with Spotify."""
    q = _clean(question)
    if re.search(r"\b(music|spotify|song|track)\b", q) and not re.search(r"\b(print|printer|job)\b", q):
        return None
    if re.search(r"\bpause\b", q):
        action = "pause"
    elif re.search(r"\b(resume|continue)\b", q):
        action = "resume"
    elif re.search(r"\b(stop|cancel|abort)\b", q) and re.search(r"\b(print|printer|job)\b", q):
        action = "stop"
    else:
        return None
    if has_printer or re.search(r"\b(print|printer|job)\b", q):
        return action
    return None


def asks_to_print(question: str) -> bool:
    """A load or a spool change must not also start a print."""
    q = _clean(question)
    return bool(re.search(r"\b(print|send|start)\b", q))
