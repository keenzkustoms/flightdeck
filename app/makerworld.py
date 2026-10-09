from __future__ import annotations

import json
import logging
import re
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from html import unescape
from html.parser import HTMLParser
from pathlib import Path
from typing import Any

log = logging.getLogger(__name__)

BAMBU_API = "https://api.bambulab.com"
USER_AGENT = "Flightdeck/1.0"
IMPORTS_FILENAME = "makerworld_imports.json"
IMPORT_SUBDIR = "MakerWorld"

_DESIGN_ID_RE = re.compile(r"makerworld\.com/(?:[a-z]{2}/)?models/(\d+)", re.I)
_PROFILE_HASH_RE = re.compile(r"#profileId-(\d+)", re.I)
_TAG_RE = re.compile(r"<[^>]+>")


class _HTMLText(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.parts: list[str] = []

    def handle_data(self, data: str) -> None:
        text = data.strip()
        if text:
            self.parts.append(text)

    def text(self) -> str:
        return unescape(" ".join(self.parts))


_ALLOWED_THUMB_HOSTS = {
    "makerworld.bblmw.com",
    "public-cdn.bambulab.com",
    "cdn.makerworld.com",
}


class MakerWorldError(Exception):
    def __init__(self, message: str, status: int = 400) -> None:
        super().__init__(message)
        self.status = status


def _strip_html(raw: str | None) -> str:
    if not raw:
        return ""
    parser = _HTMLText()
    parser.feed(raw)
    parser.close()
    return re.sub(r"\s+", " ", parser.text()).strip()


def _token_hint(token: str) -> str:
    token = token.strip()
    if not token:
        return ""
    if len(token) <= 8:
        return "••••"
    return f"{token[:4]}…{token[-4:]}"


def parse_makerworld_url(url: str) -> tuple[int, int | None]:
    raw = (url or "").strip()
    if not raw:
        raise MakerWorldError("Paste a MakerWorld model URL.")
    if raw.isdigit():
        return int(raw), None
    match = _DESIGN_ID_RE.search(raw)
    if not match:
        raise MakerWorldError("Could not find a MakerWorld model id in that URL.")
    design_id = int(match.group(1))
    profile_match = _PROFILE_HASH_RE.search(raw)
    profile_id = int(profile_match.group(1)) if profile_match else None
    return design_id, profile_id


def canonical_source_url(design_id: int, profile_id: int) -> str:
    return f"https://makerworld.com/en/models/{design_id}#profileId-{profile_id}"


def imports_path(data_dir: Path) -> Path:
    return data_dir / IMPORTS_FILENAME


def load_imports(data_dir: Path) -> list[dict[str, Any]]:
    path = imports_path(data_dir)
    if not path.exists():
        return []
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        log.warning("makerworld: could not read imports manifest at %s", path)
        return []
    rows = payload.get("imports") if isinstance(payload, dict) else payload
    if not isinstance(rows, list):
        return []
    return [row for row in rows if isinstance(row, dict)]


def save_imports(data_dir: Path, rows: list[dict[str, Any]]) -> None:
    path = imports_path(data_dir)
    path.parent.mkdir(parents=True, exist_ok=True)
    trimmed = rows[:50]
    path.write_text(json.dumps({"imports": trimmed}, indent=2), encoding="utf-8")


def clear_imports(data_dir: Path) -> int:
    count = len(load_imports(data_dir))
    save_imports(data_dir, [])
    return count


def _imports_by_profile(rows: list[dict[str, Any]]) -> dict[tuple[int, int], dict[str, Any]]:
    out: dict[tuple[int, int], dict[str, Any]] = {}
    for row in rows:
        try:
            key = (int(row["design_id"]), int(row["profile_id"]))
        except (KeyError, TypeError, ValueError):
            continue
        out[key] = row
    return out


def _api_request(path: str, token: str | None = None) -> Any:
    headers = {
        "User-Agent": USER_AGENT,
        "Accept": "application/json",
    }
    if token:
        headers["Authorization"] = f"Bearer {token.strip()}"
    req = urllib.request.Request(f"{BAMBU_API}{path}", headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            body = resp.read()
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")[:400]
        if exc.code in (401, 403):
            raise MakerWorldError(
                "Bambu Cloud token rejected. Sign in to MakerWorld, copy the token cookie, and save it in Settings.",
                status=401,
            ) from exc
        if exc.code == 404:
            raise MakerWorldError("MakerWorld model or print profile was not found.", status=404) from exc
        raise MakerWorldError(f"MakerWorld API error ({exc.code}): {detail or exc.reason}", status=502) from exc
    except urllib.error.URLError as exc:
        raise MakerWorldError(f"Could not reach MakerWorld API: {exc.reason}", status=502) from exc
    try:
        return json.loads(body)
    except json.JSONDecodeError as exc:
        raise MakerWorldError("MakerWorld returned unreadable JSON.", status=502) from exc


def fetch_design(design_id: int) -> dict[str, Any]:
    payload = _api_request(f"/v1/design-service/design/{design_id}")
    if not isinstance(payload, dict):
        raise MakerWorldError("Unexpected MakerWorld design response.", status=502)
    return payload


def fetch_profile_download(profile_id: int, model_id: str, token: str) -> tuple[str, str]:
    if not token.strip():
        raise MakerWorldError(
            "MakerWorld downloads need your Bambu Cloud token. Add it under Settings → Preferences → Bambu Cloud.",
            status=401,
        )
    query = urllib.parse.urlencode({"model_id": model_id})
    payload = _api_request(
        f"/v1/iot-service/api/user/profile/{profile_id}?{query}",
        token=token,
    )
    if not isinstance(payload, dict):
        raise MakerWorldError("Unexpected MakerWorld download response.", status=502)
    url = str(payload.get("url") or "").strip()
    name = str(payload.get("name") or f"profile_{profile_id}.3mf").strip()
    if not url:
        raise MakerWorldError("MakerWorld did not return a download URL for that plate.", status=502)
    return url, name


def download_presigned(url: str) -> bytes:
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme not in {"http", "https"}:
        raise MakerWorldError("MakerWorld returned an invalid download URL.", status=502)
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    opener = urllib.request.build_opener(_NoRedirectHandler())
    try:
        with opener.open(req, timeout=120) as resp:
            data = resp.read()
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")[:200]
        raise MakerWorldError(
            f"MakerWorld download failed ({exc.code}): {detail or exc.reason}",
            status=502,
        ) from exc
    except urllib.error.URLError as exc:
        raise MakerWorldError(f"MakerWorld download failed: {exc.reason}", status=502) from exc
    if not data:
        raise MakerWorldError("MakerWorld download returned an empty file.", status=502)
    return data


class _NoRedirectHandler(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def _format_seconds(seconds: int | None) -> str | None:
    if not seconds or seconds <= 0:
        return None
    hours, rem = divmod(int(seconds), 3600)
    minutes = rem // 60
    if hours:
        return f"{hours}h {minutes}m"
    return f"{minutes}m"


def _safe_folder_segment(name: str, fallback: str) -> str:
    raw = str(name or fallback).replace("\x00", "")
    raw = raw.rsplit("/", 1)[-1].rsplit("\\", 1)[-1]
    safe = re.sub(r"[^A-Za-z0-9._ -]+", "_", raw).strip(" ._")
    return safe or fallback


def _sorted_instances(design: dict[str, Any]) -> list[dict[str, Any]]:
    instances: list[dict[str, Any]] = []
    for row in design.get("instances") or []:
        if not isinstance(row, dict):
            continue
        profile_id = int(row.get("profileId") or 0)
        if profile_id:
            instances.append(row)
    instances.sort(key=lambda row: (not bool(row.get("isDefault")), str(row.get("title") or "").lower()))
    return instances


def _design_vault_folder(design: dict[str, Any], design_id: int, *, multi_plate: bool) -> str:
    if not multi_plate:
        return IMPORT_SUBDIR
    slug = str(design.get("slug") or "").strip()
    title = str(design.get("title") or f"design_{design_id}").strip()
    base = _safe_folder_segment(slug or title, f"design_{design_id}")
    if str(design_id) not in base:
        base = f"{base}_{design_id}"
    return f"{IMPORT_SUBDIR}/{base}"


def _plate_vault_filename(
    *,
    upstream_name: str,
    profile_id: int,
    plate_title: str,
    plate_index: int,
    plate_total: int,
    design_id: int,
    safe_basename,
) -> str:
    if plate_total <= 1:
        stem = safe_basename(upstream_name, f"{design_id}_{profile_id}.3mf")
    else:
        label = safe_basename(plate_title, f"plate_{profile_id}")
        stem = f"{plate_index:02d} - {label}.3mf"
    if not stem.lower().endswith(".3mf"):
        stem = f"{stem}.3mf"
    return stem


def _find_plate_vault_path_on_disk(
    *,
    vault_folder: str,
    plate_index: int,
    plate_total: int,
    library_root: Path,
    safe_join_under,
) -> str | None:
    if plate_total <= 1 or plate_index <= 0:
        return None
    try:
        folder = safe_join_under(library_root.resolve(), *vault_folder.split("/"), missing_ok=True)
    except Exception:
        return None
    if not folder.is_dir():
        return None
    prefix = f"{plate_index:02d} -"
    matches = [path for path in folder.glob("*.3mf") if path.name.startswith(prefix)]
    if not matches:
        return None

    def _sort_key(path: Path) -> tuple[bool, int, float]:
        stamped = bool(re.search(r"_\d{14}", path.stem))
        return (stamped, len(path.name), -path.stat().st_mtime)

    best = sorted(matches, key=_sort_key)[0]
    return best.relative_to(library_root.resolve()).as_posix()


def _effective_plate_vault_path(
    *,
    imported: dict[str, Any] | None,
    vault_folder: str,
    plate_index: int,
    plate_total: int,
    library_root: Path | None,
    safe_join_under=None,
) -> str | None:
    vault_path = str((imported or {}).get("vault_path") or "").strip()
    if vault_path and _plate_vault_layout_ok(
        vault_path=vault_path,
        vault_folder=vault_folder,
        plate_total=plate_total,
        library_root=library_root,
        safe_join_under=safe_join_under,
    ):
        return vault_path
    if library_root is None or safe_join_under is None:
        return None
    return _find_plate_vault_path_on_disk(
        vault_folder=vault_folder,
        plate_index=plate_index,
        plate_total=plate_total,
        library_root=library_root,
        safe_join_under=safe_join_under,
    )


def _plate_needs_action(
    *,
    design_id: int,
    profile_id: int,
    imported: dict[str, Any] | None,
    vault_folder: str,
    plate_index: int,
    plate_total: int,
    library_root: Path,
    safe_join_under,
) -> bool:
    return _effective_plate_vault_path(
        imported=imported,
        vault_folder=vault_folder,
        plate_index=plate_index,
        plate_total=plate_total,
        library_root=library_root,
        safe_join_under=safe_join_under,
    ) is None


def _plate_vault_layout_ok(
    *,
    vault_path: str,
    vault_folder: str,
    plate_total: int,
    library_root: Path | None,
    safe_join_under=None,
) -> bool:
    vault_path = str(vault_path or "").strip()
    if not vault_path:
        return False
    if plate_total > 1 and not vault_path.startswith(f"{vault_folder}/"):
        return False
    if library_root is None or safe_join_under is None:
        return True
    try:
        dest = safe_join_under(library_root.resolve(), vault_path, missing_ok=True)
    except Exception:
        return False
    return dest.is_file()


def _upsert_import_record(
    data_dir: Path,
    imports: list[dict[str, Any]],
    *,
    design_id: int,
    profile_id: int,
    model_id: str,
    design_title: str,
    plate_title: str,
    vault_rel: str,
    filename: str,
    size: int,
) -> None:
    record = {
        "imported_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
        "design_id": design_id,
        "profile_id": profile_id,
        "model_id": model_id,
        "title": design_title,
        "plate_title": plate_title,
        "source_url": canonical_source_url(design_id, profile_id),
        "vault_path": vault_rel,
        "filename": filename,
        "size": size,
    }
    imports = [record] + [
        row for row in imports
        if not (
            int(row.get("design_id") or -1) == design_id
            and int(row.get("profile_id") or -1) == profile_id
        )
    ]
    save_imports(data_dir, imports)


def _plate_row(instance: dict[str, Any], imported: dict[str, Any] | None) -> dict[str, Any]:
    profile_id = int(instance.get("profileId") or 0)
    cover = instance.get("cover")
    if not cover and instance.get("pictures"):
        first = instance["pictures"][0]
        if isinstance(first, dict):
            cover = first.get("url")
    print_seconds = instance.get("prediction")
    if isinstance(print_seconds, dict):
        print_seconds = print_seconds.get("totalSeconds") or print_seconds.get("prediction")
    return {
        "profile_id": profile_id,
        "instance_id": int(instance.get("id") or 0),
        "title": str(instance.get("title") or f"Plate {profile_id}").strip(),
        "cover_url": cover or "",
        "weight_g": instance.get("weight"),
        "print_seconds": print_seconds,
        "print_time_text": _format_seconds(print_seconds if isinstance(print_seconds, int) else None),
        "need_ams": bool(instance.get("needAms")),
        "filament_colors": instance.get("materialColorCnt"),
        "is_default": bool(instance.get("isDefault")),
        "already_imported": imported is not None,
        "vault_path": (imported or {}).get("vault_path"),
        "vault_name": (imported or {}).get("filename"),
    }


def resolve_url(
    url: str,
    token: str,
    data_dir: Path,
    library_root: Path | None = None,
    safe_join_under=None,
) -> dict[str, Any]:
    design_id, highlight_profile_id = parse_makerworld_url(url)
    design = fetch_design(design_id)
    model_id = str(design.get("modelId") or "").strip()
    if not model_id:
        raise MakerWorldError("MakerWorld design is missing model metadata.", status=502)
    creator = design.get("designCreator") or {}
    imports = _imports_by_profile(load_imports(data_dir))
    plates = []
    for instance in design.get("instances") or []:
        if not isinstance(instance, dict):
            continue
        profile_id = int(instance.get("profileId") or 0)
        if not profile_id:
            continue
        imported = imports.get((design_id, profile_id))
        plates.append(_plate_row(instance, imported))
    plates.sort(key=lambda row: (not row["is_default"], row["title"].lower()))
    plate_total = len(plates)
    for idx, plate in enumerate(plates):
        plate["plate_index"] = idx + 1
        plate["plate_total"] = plate_total
    vault_folder = _design_vault_folder(design, design_id, multi_plate=plate_total > 1)
    for plate in plates:
        profile_id = int(plate.get("profile_id") or 0)
        imported = imports.get((design_id, profile_id))
        effective_path = _effective_plate_vault_path(
            imported=imported,
            vault_folder=vault_folder,
            plate_index=int(plate.get("plate_index") or 0),
            plate_total=plate_total,
            library_root=library_root,
            safe_join_under=safe_join_under,
        )
        if effective_path:
            plate["vault_path"] = effective_path
            plate["vault_name"] = effective_path.rsplit("/", 1)[-1]
            plate["already_imported"] = True
        layout_ok = effective_path is not None
        plate["vault_layout_ok"] = layout_ok
        plate["needs_vault_refresh"] = bool(imported and not layout_ok)
    needs_refresh = sum(1 for plate in plates if plate.get("needs_vault_refresh"))
    return {
        "ok": True,
        "design_id": design_id,
        "model_id": model_id,
        "title": str(design.get("title") or f"Design {design_id}").strip(),
        "slug": str(design.get("slug") or "").strip(),
        "summary_text": _strip_html(design.get("summaryTranslated") or design.get("summary")),
        "cover_url": design.get("coverUrl") or "",
        "creator": str(creator.get("name") or creator.get("handle") or "").strip(),
        "license": str(design.get("license") or "").strip(),
        "download_count": design.get("downloadCount"),
        "print_count": design.get("printCount"),
        "source_url": f"https://makerworld.com/en/models/{design_id}",
        "highlight_profile_id": highlight_profile_id,
        "plates": plates,
        "plate_total": plate_total,
        "vault_folder": vault_folder,
        "needs_vault_refresh": needs_refresh,
        "can_download": bool(token.strip()),
        "token_hint": _token_hint(token),
    }


def import_plate(
    *,
    url: str,
    profile_id: int,
    token: str,
    data_dir: Path,
    library_root: Path,
    safe_basename,
    safe_join_under,
    enforce_file_size,
) -> dict[str, Any]:
    design_id, _ = parse_makerworld_url(url)
    design = fetch_design(design_id)
    model_id = str(design.get("modelId") or "").strip()
    if not model_id:
        raise MakerWorldError("MakerWorld design is missing model metadata.", status=502)

    instance = None
    instances = _sorted_instances(design)
    plate_total = len(instances)
    plate_index = 0
    for idx, row in enumerate(instances):
        if int(row.get("profileId") or 0) == profile_id:
            instance = row
            plate_index = idx + 1
            break
    if instance is None:
        raise MakerWorldError("That print profile is not on this MakerWorld model.", status=404)

    imports = load_imports(data_dir)
    existing = _imports_by_profile(imports).get((design_id, profile_id))
    vault_folder_rel = _design_vault_folder(design, design_id, multi_plate=plate_total > 1)
    plate_title = str(instance.get("title") or f"plate_{profile_id}").strip()
    design_title = str(design.get("title") or f"design_{design_id}").strip()

    vault_rel = _effective_plate_vault_path(
        imported=existing,
        vault_folder=vault_folder_rel,
        plate_index=plate_index,
        plate_total=plate_total,
        library_root=library_root,
        safe_join_under=safe_join_under,
    )
    if vault_rel:
        dest = safe_join_under(library_root.resolve(), vault_rel, missing_ok=True)
        if dest.is_file():
            if not existing or str(existing.get("vault_path") or "") != vault_rel:
                _upsert_import_record(
                    data_dir,
                    imports,
                    design_id=design_id,
                    profile_id=profile_id,
                    model_id=model_id,
                    design_title=design_title,
                    plate_title=plate_title,
                    vault_rel=vault_rel,
                    filename=dest.name,
                    size=dest.stat().st_size,
                )
            return {
                "ok": True,
                "already_existed": True,
                "name": dest.name,
                "path": vault_rel,
                "size": dest.stat().st_size,
                "design_id": design_id,
                "profile_id": profile_id,
                "title": (existing or {}).get("title") or design_title,
                "plate_title": (existing or {}).get("plate_title") or plate_title,
            }

    download_url, upstream_name = fetch_profile_download(profile_id, model_id, token)
    data = download_presigned(download_url)
    enforce_file_size(len(data), label="MakerWorld download")

    stem = _plate_vault_filename(
        upstream_name=upstream_name,
        profile_id=profile_id,
        plate_title=plate_title,
        plate_index=plate_index,
        plate_total=plate_total,
        design_id=design_id,
        safe_basename=safe_basename,
    )

    folder = safe_join_under(library_root.resolve(), *vault_folder_rel.split("/"), missing_ok=True)
    folder.mkdir(parents=True, exist_ok=True)
    dest = safe_join_under(folder, stem, missing_ok=True)
    if dest.exists() and dest.is_file():
        vault_rel = dest.relative_to(library_root.resolve()).as_posix()
        _upsert_import_record(
            data_dir,
            imports,
            design_id=design_id,
            profile_id=profile_id,
            model_id=model_id,
            design_title=design_title,
            plate_title=plate_title,
            vault_rel=vault_rel,
            filename=dest.name,
            size=dest.stat().st_size,
        )
        return {
            "ok": True,
            "already_existed": True,
            "name": dest.name,
            "path": vault_rel,
            "size": dest.stat().st_size,
            "design_id": design_id,
            "profile_id": profile_id,
            "title": design_title,
            "plate_title": plate_title,
        }
    dest.write_bytes(data)

    relocated = False
    old_rel = ""
    if existing and existing.get("vault_path"):
        old_rel = str(existing["vault_path"])
        relocated = old_rel != dest.relative_to(library_root.resolve()).as_posix()
        if relocated:
            try:
                old_dest = safe_join_under(library_root.resolve(), old_rel, missing_ok=True)
                if old_dest.is_file():
                    old_dest.unlink()
            except Exception:
                log.warning("makerworld: could not remove superseded vault file %s", old_rel)

    vault_rel = dest.relative_to(library_root.resolve()).as_posix()
    _upsert_import_record(
        data_dir,
        imports,
        design_id=design_id,
        profile_id=profile_id,
        model_id=model_id,
        design_title=design_title,
        plate_title=plate_title,
        vault_rel=vault_rel,
        filename=dest.name,
        size=len(data),
    )

    return {
        "ok": True,
        "already_existed": False,
        "relocated": relocated,
        "name": dest.name,
        "path": vault_rel,
        "size": len(data),
        "design_id": design_id,
        "profile_id": profile_id,
        "title": design_title,
        "plate_title": plate_title,
    }


def import_all_plates(
    *,
    url: str,
    token: str,
    data_dir: Path,
    library_root: Path,
    safe_basename,
    safe_join_under,
    enforce_file_size,
    only_missing: bool = False,
) -> dict[str, Any]:
    if not token.strip():
        raise MakerWorldError("Add your Bambu Cloud token in Settings before downloading.")

    design_id, _ = parse_makerworld_url(url)
    design = fetch_design(design_id)
    instances = _sorted_instances(design)
    plate_total = len(instances)
    if not plate_total:
        raise MakerWorldError("No downloadable plates were found for this model.", status=404)

    vault_folder = _design_vault_folder(design, design_id, multi_plate=plate_total > 1)
    imports = _imports_by_profile(load_imports(data_dir))
    profile_ids = [
        int(row.get("profileId") or 0)
        for row in instances
        if int(row.get("profileId") or 0)
    ]
    if only_missing:
        profile_ids = []
        for idx, row in enumerate(instances):
            profile_id = int(row.get("profileId") or 0)
            if not profile_id:
                continue
            if _plate_needs_action(
                design_id=design_id,
                profile_id=profile_id,
                imported=imports.get((design_id, profile_id)),
                vault_folder=vault_folder,
                plate_index=idx + 1,
                plate_total=plate_total,
                library_root=library_root,
                safe_join_under=safe_join_under,
            ):
                profile_ids.append(profile_id)
    skipped = plate_total - len(profile_ids) if only_missing else 0
    if not profile_ids:
        return {
            "ok": True,
            "design_id": design_id,
            "title": str(design.get("title") or f"Design {design_id}").strip(),
            "total": 0,
            "skipped": skipped,
            "imported": 0,
            "already_existed": 0,
            "relocated": 0,
            "failed": 0,
            "results": [],
            "only_missing": only_missing,
        }

    results: list[dict[str, Any]] = []
    imported = 0
    already_existed = 0
    relocated = 0
    failed = 0
    for profile_id in profile_ids:
        try:
            row = import_plate(
                url=url,
                profile_id=profile_id,
                token=token,
                data_dir=data_dir,
                library_root=library_root,
                safe_basename=safe_basename,
                safe_join_under=safe_join_under,
                enforce_file_size=enforce_file_size,
            )
            if row.get("already_existed"):
                already_existed += 1
            else:
                imported += 1
                if row.get("relocated"):
                    relocated += 1
            results.append({
                "ok": True,
                "profile_id": profile_id,
                "already_existed": bool(row.get("already_existed")),
                "relocated": bool(row.get("relocated")),
                "name": row.get("name"),
                "path": row.get("path"),
                "plate_title": row.get("plate_title"),
            })
        except MakerWorldError as exc:
            failed += 1
            results.append({
                "ok": False,
                "profile_id": profile_id,
                "error": str(exc),
            })
        except Exception as exc:
            failed += 1
            log.exception("makerworld: import_all failed for profile %s", profile_id)
            results.append({
                "ok": False,
                "profile_id": profile_id,
                "error": str(exc) or "Import failed",
            })

    return {
        "ok": failed == 0,
        "design_id": design_id,
        "title": str(design.get("title") or f"Design {design_id}").strip(),
        "total": len(profile_ids),
        "skipped": skipped,
        "imported": imported,
        "already_existed": already_existed,
        "relocated": relocated,
        "failed": failed,
        "results": results,
        "only_missing": only_missing,
    }


def recent_imports(data_dir: Path, limit: int = 10) -> list[dict[str, Any]]:
    limit = max(1, min(int(limit or 10), 50))
    rows = load_imports(data_dir)[:limit]
    return [
        {
            "imported_at": row.get("imported_at"),
            "design_id": row.get("design_id"),
            "profile_id": row.get("profile_id"),
            "title": row.get("title"),
            "plate_title": row.get("plate_title"),
            "source_url": row.get("source_url"),
            "vault_path": row.get("vault_path"),
            "filename": row.get("filename"),
            "size": row.get("size"),
        }
        for row in rows
    ]


def validate_thumbnail_url(url: str) -> str:
    raw = (url or "").strip()
    if not raw:
        raise MakerWorldError("Missing thumbnail URL.")
    parsed = urllib.parse.urlparse(raw)
    if parsed.scheme not in {"http", "https"}:
        raise MakerWorldError("Invalid thumbnail URL.")
    host = (parsed.hostname or "").lower()
    if host not in _ALLOWED_THUMB_HOSTS:
        raise MakerWorldError("Thumbnail host is not allowlisted.")
    return raw


def fetch_thumbnail(url: str) -> tuple[bytes, str]:
    safe_url = validate_thumbnail_url(url)
    req = urllib.request.Request(safe_url, headers={"User-Agent": USER_AGENT})
    opener = urllib.request.build_opener(_NoRedirectHandler())
    try:
        with opener.open(req, timeout=20) as resp:
            data = resp.read()
            content_type = resp.headers.get_content_type() or "image/jpeg"
    except urllib.error.HTTPError as exc:
        raise MakerWorldError(f"Thumbnail fetch failed ({exc.code}).", status=502) from exc
    except urllib.error.URLError as exc:
        raise MakerWorldError(f"Thumbnail fetch failed: {exc.reason}", status=502) from exc
    if not data:
        raise MakerWorldError("Thumbnail fetch returned empty data.", status=502)
    return data, content_type
