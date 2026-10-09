#!/usr/bin/env python3
"""Index markdown notes into viewer/graph-data.js for the Amy galaxy."""
from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent
NOTES = ROOT / "notes"
OUT = ROOT / "viewer" / "graph-data.js"
EXCERPT_LEN = 700
WIKILINK_RE = re.compile(r"\[\[([^\]]+)\]\]")
WORD_RE = re.compile(r"[a-z0-9]{3,}", re.I)


def title_from_path(path: Path) -> str:
    return path.stem.replace("-", " ").replace("_", " ").strip() or path.stem


def group_from_path(path: Path, notes_root: Path) -> str:
    try:
        rel = path.relative_to(notes_root)
    except ValueError:
        return "notes"
    parts = rel.parts
    if len(parts) > 1:
        return parts[0]
    return "notes"


def excerpt(text: str) -> str:
    cleaned = re.sub(r"\s+", " ", text).strip()
    if len(cleaned) <= EXCERPT_LEN:
        return cleaned
    return cleaned[: EXCERPT_LEN - 1].rstrip() + "…"


def collect_notes(notes_root: Path) -> list[dict]:
    files = sorted(notes_root.rglob("*.md"))
    nodes: list[dict] = []
    for path in files:
        if path.name.startswith("."):
            continue
        try:
            text = path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        rel = str(path.relative_to(notes_root)).replace("\\", "/")
        nodes.append(
            {
                "id": len(nodes),
                "label": title_from_path(path),
                "group": group_from_path(path, notes_root),
                "path": rel,
                "excerpt": excerpt(text),
                "text": text,
            }
        )
    return nodes


def build_links(nodes: list[dict]) -> list[dict]:
    by_label = {n["label"].lower(): n["id"] for n in nodes}
    by_stem = {Path(n["path"]).stem.lower(): n["id"] for n in nodes}
    links: list[dict] = []
    seen: set[tuple[int, int]] = set()

    def add(a: int, b: int) -> None:
        if a == b:
            return
        key = (min(a, b), max(a, b))
        if key in seen:
            return
        seen.add(key)
        links.append({"source": key[0], "target": key[1]})

    for node in nodes:
        text_l = node["text"].lower()
        label_l = node["label"].lower()
        for m in WIKILINK_RE.finditer(node["text"]):
            target = m.group(1).split("|")[0].strip().lower()
            tid = by_label.get(target) or by_stem.get(target.replace(" ", "-")) or by_stem.get(
                target.replace(" ", "_")
            )
            if tid is not None:
                add(node["id"], tid)
        for other in nodes:
            if other["id"] == node["id"]:
                continue
            other_label = other["label"].lower()
            if len(other_label) < 4:
                continue
            if other_label in text_l and other_label != label_l:
                add(node["id"], other["id"])
    return links


def write_graph(nodes: list[dict], links: list[dict], out: Path) -> None:
    public_nodes = [
        {
            "id": n["id"],
            "label": n["label"],
            "group": n["group"],
            "path": n["path"],
            "excerpt": n["excerpt"],
        }
        for n in nodes
    ]
    out.parent.mkdir(parents=True, exist_ok=True)
    payload = {"nodes": public_nodes, "links": links}
    out.write_text(
        "const GRAPH = " + json.dumps(payload, ensure_ascii=False, indent=2) + ";\n",
        encoding="utf-8",
    )


def main() -> None:
    NOTES.mkdir(parents=True, exist_ok=True)
    (NOTES / "captures").mkdir(parents=True, exist_ok=True)
    nodes = collect_notes(NOTES)
    links = build_links(nodes)
    write_graph(nodes, links, OUT)
    # Also write a server-side index with full text for RAG.
    index_path = ROOT / "notes-index.json"
    index_path.write_text(
        json.dumps(
            [
                {
                    "id": n["id"],
                    "label": n["label"],
                    "group": n["group"],
                    "path": n["path"],
                    "excerpt": n["excerpt"],
                    "text": n["text"][:12000],
                }
                for n in nodes
            ],
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    print(f"Indexed {len(nodes)} notes, {len(links)} links -> {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
