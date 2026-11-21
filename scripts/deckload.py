#!/usr/bin/env python3
"""Maintenance helper for the Spanish Flashcards Telegram Mini App.

Used by the /deckload skill. Keeps the mode state outside the git-tracked app,
validates incoming cards, backs up the deck and appends rows without rewriting
the existing CSV bytes.

Usage:
    python3 scripts/deckload.py status
    python3 scripts/deckload.py on [--note "..."]
    python3 scripts/deckload.py off
    python3 scripts/deckload.py validate
    python3 scripts/deckload.py add --json FILE [--dry-run]
    python3 scripts/deckload.py add --csv FILE [--dry-run]
    python3 scripts/deckload.py add --es ES --uk UK [--topic T] [--example E] [--dry-run]
    python3 scripts/deckload.py list [--topic T] [--limit N]
    python3 scripts/deckload.py search --query TEXT [--limit N]
    python3 scripts/deckload.py remove --ids 1,2 [--dry-run]
    python3 scripts/deckload.py remove --es TEXT [--dry-run]
    python3 scripts/deckload.py update --id N [--es ES] [--uk UK] [--topic T] [--example E] [--dry-run]

The list/search commands are read-only. remove/update always make a backup and
require --dry-run preview before a real change in natural-language flows.
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import os
import re
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CARDS = ROOT / "data" / "cards.csv"
STATE = Path("/home/ubuntu/.openclaw/state/deckload.json")
BACKUP_DIR = Path("/home/ubuntu/.openclaw/state/backups")
HEADER = ["id", "topic", "es", "uk", "example"]

ALIASES = {
    "es": ("es", "spanish", "sp", "question", "front", "palabra", "palabra_es"),
    "uk": ("uk", "ukrainian", "ua", "answer", "back", "translation", "переклад"),
    "topic": ("topic", "theme", "category", "тема", "розділ"),
    "example": ("example", "sentence", "checking", "приклад"),
    "id": ("id",),
}


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def load_state() -> dict:
    try:
        data = json.loads(STATE.read_text(encoding="utf-8"))
        if isinstance(data, dict):
            return data
    except (OSError, ValueError):
        pass
    return {"active": False, "since": None, "note": "", "last_batch": None}


def save_state(state: dict) -> None:
    STATE.parent.mkdir(parents=True, exist_ok=True)
    tmp = STATE.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(state, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    os.replace(tmp, STATE)


def read_cards() -> list[dict]:
    raw = CARDS.read_text(encoding="utf-8-sig")
    rows = list(csv.reader(io.StringIO(raw), delimiter=";"))
    if not rows:
        return []
    head = [cell.strip().lstrip("\ufeff").casefold() for cell in rows[0]]
    start = 1 if {"id", "topic", "es", "uk"}.issubset(set(head)) else 0
    cards = []
    for row in rows[start:]:
        if len(row) < 4 or not any(field.strip() for field in row):
            continue
        row = (row + [""] * len(HEADER))[: len(HEADER)]
        cards.append(dict(zip(HEADER, (field.strip() for field in row))))
    return cards


def clean(value) -> str:
    if value is None:
        return ""
    text = str(value)
    text = text.replace("\r", " ").replace("\n", " ")
    return re.sub(r"[ \t]{2,}", " ", text).strip()


def pick(record: dict, field: str) -> str:
    for key in ALIASES[field]:
        if key in record and clean(record[key]):
            return clean(record[key])
    return ""


def next_id(cards: list[dict]) -> int:
    numbers = []
    for card in cards:
        value = str(card.get("id", "")).strip()
        if value.isdigit():
            numbers.append(int(value))
    return max(numbers, default=0) + 1


def validate_deck(cards: list[dict]) -> list[str]:
    problems = []
    seen_ids = set()
    seen_pairs = set()
    for index, card in enumerate(cards, 1):
        label = card.get("id") or f"row {index}"
        if not card.get("id"):
            problems.append(f"{label}: empty id")
        elif card["id"] in seen_ids:
            problems.append(f"{label}: duplicate id")
        else:
            seen_ids.add(card["id"])
        for field in ("topic", "es", "uk"):
            if not card.get(field):
                problems.append(f"{label}: empty {field}")
        pair = (card.get("es", "").casefold(), card.get("uk", "").casefold())
        if pair in seen_pairs:
            problems.append(f"{label}: duplicate es/uk pair")
        else:
            seen_pairs.add(pair)
    return problems


def load_candidates(path: Path) -> list[dict]:
    text = path.read_text(encoding="utf-8-sig")
    if path.suffix.lower() == ".json":
        payload = json.loads(text)
        if isinstance(payload, dict):
            payload = payload.get("cards", [])
        if not isinstance(payload, list):
            raise ValueError("JSON must be a list of cards or an object with a 'cards' list")
        return [item for item in payload if isinstance(item, dict)]

    # CSV: full headers (es;uk;...) or a bare two-column list (es;uk).
    rows = list(csv.reader(io.StringIO(text), delimiter=";"))
    if not rows:
        return []
    head = [cell.strip().lstrip("\ufeff").casefold() for cell in rows[0]]
    looks_like_header = any(key in head for key in ("es", "uk", "spanish", "ukrainian"))
    candidates = []
    for row in rows[1:] if looks_like_header else rows:
        if not any(cell.strip() for cell in row):
            continue
        if looks_like_header:
            candidates.append(dict(zip(head, row)))
        else:
            padded = (row + ["", "", "", ""])[:4]
            candidates.append({"es": padded[0], "uk": padded[1], "example": padded[2], "topic": padded[3]})
    return candidates


def append_cards(new_cards: list[dict], backup: bool = True) -> None:
    original = CARDS.read_bytes()
    buffer = io.StringIO()
    if original and not original.endswith((b"\n", b"\r")):
        buffer.write("\n")
    writer = csv.writer(buffer, delimiter=";", quoting=csv.QUOTE_MINIMAL, lineterminator="\n")
    first_line = original.decode("utf-8-sig", errors="replace").splitlines()[0] if original else ""
    head = [cell.strip().lstrip("\ufeff").casefold() for cell in first_line.split(";")]
    if not {"id", "topic", "es", "uk"}.issubset(set(head)):
        writer.writerow(HEADER)
    for card in new_cards:
        writer.writerow([card.get(field, "") for field in HEADER])
    addition = buffer.getvalue().encode("utf-8")

    if backup:
        BACKUP_DIR.mkdir(parents=True, exist_ok=True)
        stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        shutil.copy2(CARDS, BACKUP_DIR / f"cards_{stamp}.csv")

    tmp = CARDS.with_suffix(".csv.tmp")
    tmp.write_bytes(original + addition)
    os.replace(tmp, CARDS)


def write_cards(cards: list[dict], backup: bool = True) -> None:
    """Rewrite the deck from a card list (for remove/update). Always backed up."""
    buffer = io.StringIO()
    writer = csv.writer(buffer, delimiter=";", quoting=csv.QUOTE_MINIMAL, lineterminator="\n")
    writer.writerow(HEADER)
    for card in cards:
        writer.writerow([clean(card.get(field, "")) for field in HEADER])
    if backup:
        BACKUP_DIR.mkdir(parents=True, exist_ok=True)
        stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        shutil.copy2(CARDS, BACKUP_DIR / f"cards_{stamp}_rewrite.csv")
    tmp = CARDS.with_suffix(".csv.tmp")
    tmp.write_text(buffer.getvalue(), encoding="utf-8")
    os.replace(tmp, CARDS)


def as_json_cards(cards: list[dict]) -> list[dict]:
    return [{field: card.get(field, "") for field in HEADER} for card in cards]


def match_topic(card: dict, topic: str) -> bool:
    return not topic or topic.casefold() in card.get("topic", "").casefold()


def cmd_list(args) -> None:
    cards = [card for card in read_cards() if match_topic(card, args.topic)]
    total = len(cards)
    if args.limit > 0:
        cards = cards[: args.limit]
    print(json.dumps({"total_matching": total, "shown": len(cards), "cards": as_json_cards(cards)}, ensure_ascii=False, indent=2))


def cmd_search(args) -> None:
    query = args.query.strip().casefold()
    if not query:
        print(json.dumps({"error": "empty query"}, ensure_ascii=False))
        return 2
    cards = read_cards()
    found = [
        card for card in cards
        if any(query in card.get(field, "").casefold() for field in ("es", "uk", "topic", "example"))
    ]
    total = len(found)
    if args.limit > 0:
        found = found[: args.limit]
    print(json.dumps({"query": args.query, "total_matching": total, "shown": len(found), "cards": as_json_cards(found)}, ensure_ascii=False, indent=2))
    return 0


def cmd_remove(args) -> None:
    cards = read_cards()
    ids = {part.strip() for part in (args.ids or "").split(",") if part.strip()}
    if not ids and not args.es:
        print(json.dumps({"error": "provide --ids or --es"}, ensure_ascii=False))
        return 2
    targets = []
    if ids:
        targets = [card for card in cards if card["id"] in ids]
    elif args.es:
        targets = [card for card in cards if card["es"].casefold() == args.es.strip().casefold()]
    if not targets:
        print(json.dumps({"removed": 0, "error": "no matching card", "ids": sorted(ids), "es": args.es}, ensure_ascii=False))
        return 1
    removed_ids = [card["id"] for card in targets]
    remaining = [card for card in cards if card not in targets]
    if not args.dry_run:
        write_cards(remaining, backup=not args.no_backup)
    print(json.dumps({
        "dry_run": args.dry_run,
        "removed": len(targets),
        "ids": removed_ids,
        "cards": as_json_cards(targets),
        "total_after": len(remaining),
    }, ensure_ascii=False, indent=2))


def cmd_update(args) -> None:
    cards = read_cards()
    target = next((card for card in cards if card["id"] == str(args.id).strip()), None)
    if target is None:
        print(json.dumps({"error": "card not found", "id": args.id}, ensure_ascii=False))
        return 1
    changes = {field: getattr(args, field) for field in ("es", "uk", "topic", "example") if getattr(args, field) is not None}
    if not changes:
        print(json.dumps({"error": "no fields to update"}, ensure_ascii=False))
        return 2
    updated = dict(target)
    updated.update({field: clean(value) for field, value in changes.items()})
    problems = []
    if not updated.get("es") or not updated.get("uk") or not updated.get("topic"):
        problems.append("es/uk/topic must stay non-empty")
    pair = (updated["es"].casefold(), updated["uk"].casefold())
    if any(card is not target and (card["es"].casefold(), card["uk"].casefold()) == pair for card in cards):
        problems.append("es/uk pair already exists")
    if problems:
        print(json.dumps({"error": "invalid update", "problems": problems}, ensure_ascii=False))
        return 1
    before = dict(target)
    target.update(updated)
    if not args.dry_run:
        write_cards(cards, backup=not args.no_backup)
    print(json.dumps({
        "dry_run": args.dry_run,
        "id": target["id"],
        "before": before,
        "after": target,
    }, ensure_ascii=False, indent=2))


def cmd_status(args) -> None:
    state = load_state()
    cards = read_cards()
    topics = sorted({card["topic"] for card in cards if card["topic"]})
    print(json.dumps({
        "active": state.get("active", False),
        "since": state.get("since"),
        "note": state.get("note", ""),
        "last_batch": state.get("last_batch"),
        "total_cards": len(cards),
        "topics": topics,
        "cards_file": str(CARDS),
    }, ensure_ascii=False, indent=2))


def cmd_on(args) -> None:
    state = load_state()
    state.update({"active": True, "since": utc_now(), "note": args.note or ""})
    save_state(state)
    print(json.dumps({"active": True, "since": state["since"], "note": state["note"]}, ensure_ascii=False))


def cmd_off(args) -> None:
    state = load_state()
    state.update({"active": False, "closed_at": utc_now()})
    save_state(state)
    print(json.dumps({"active": False, "closed_at": state["closed_at"]}, ensure_ascii=False))


def cmd_validate(args) -> None:
    cards = read_cards()
    problems = validate_deck(cards)
    print(json.dumps({"total": len(cards), "problems": problems[:20], "problem_count": len(problems)}, ensure_ascii=False, indent=2))
    return 1 if problems else 0


def cmd_add(args) -> int:
    if args.es or args.uk:
        # Inline single card from a natural-language chat request.
        candidates = [{
            "es": args.es,
            "uk": args.uk,
            "topic": args.topic,
            "example": args.example or "",
        }]
    else:
        source = Path(args.json_file) if args.json_file else Path(args.csv_file)
        candidates = load_candidates(source)
    cards = read_cards()
    existing_pairs = {(card["es"].casefold(), card["uk"].casefold()) for card in cards}
    used_pairs = set(existing_pairs)
    current_id = next_id(cards)

    accepted = []
    duplicates = []
    invalid = []
    for item in candidates:
        es = pick(item, "es")
        uk = pick(item, "uk")
        if not es or not uk:
            invalid.append({"es": es, "uk": uk, "reason": "missing es or uk"})
            continue
        pair = (es.casefold(), uk.casefold())
        if pair in used_pairs:
            duplicates.append({"es": es, "uk": uk})
            continue
        used_pairs.add(pair)
        card = {
            "id": str(current_id),
            "topic": pick(item, "topic") or args.topic or "Нова тема",
            "es": es,
            "uk": uk,
            "example": pick(item, "example"),
        }
        current_id += 1
        accepted.append(card)

    if not args.dry_run:
        if accepted:
            append_cards(accepted, backup=not args.no_backup)
        state = load_state()
        state["last_batch"] = {
            "at": utc_now(),
            "added": len(accepted),
            "duplicates": len(duplicates),
            "invalid": len(invalid),
            "topics": sorted({card["topic"] for card in accepted}),
        }
        save_state(state)

    print(json.dumps({
        "dry_run": args.dry_run,
        "candidates": len(candidates),
        "added": len(accepted),
        "duplicates_skipped": len(duplicates),
        "invalid": len(invalid),
        "invalid_samples": invalid[:5],
        "ids": [card["id"] for card in accepted],
        "total_after": len(cards) + (0 if args.dry_run else len(accepted)),
    }, ensure_ascii=False, indent=2))
    return 1 if invalid and not accepted else 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("status").set_defaults(func=cmd_status)
    on = sub.add_parser("on")
    on.add_argument("--note", default="")
    on.set_defaults(func=cmd_on)
    sub.add_parser("off").set_defaults(func=cmd_off)
    sub.add_parser("validate").set_defaults(func=cmd_validate)

    add = sub.add_parser("add")
    group = add.add_mutually_exclusive_group(required=False)
    group.add_argument("--json", dest="json_file")
    group.add_argument("--csv", dest="csv_file")
    add.add_argument("--es", default="", help="inline Spanish text (single card)")
    add.add_argument("--uk", default="", help="inline Ukrainian translation (single card)")
    add.add_argument("--topic", default="", help="default topic when cards omit one")
    add.add_argument("--example", default="", help="optional inline example sentence")
    add.add_argument("--dry-run", action="store_true")
    add.add_argument("--no-backup", action="store_true")
    add.set_defaults(func=cmd_add)

    listing = sub.add_parser("list")
    listing.add_argument("--topic", default="")
    listing.add_argument("--limit", type=int, default=20, help="0 = all")
    listing.set_defaults(func=cmd_list)

    search = sub.add_parser("search")
    search.add_argument("--query", required=True)
    search.add_argument("--limit", type=int, default=20, help="0 = all")
    search.set_defaults(func=cmd_search)

    remove = sub.add_parser("remove")
    remove.add_argument("--ids", default="", help="comma-separated card ids")
    remove.add_argument("--es", default="", help="remove by exact Spanish text")
    remove.add_argument("--dry-run", action="store_true")
    remove.add_argument("--no-backup", action="store_true")
    remove.set_defaults(func=cmd_remove)

    update = sub.add_parser("update")
    update.add_argument("--id", required=True)
    for field in ("es", "uk", "topic", "example"):
        update.add_argument(f"--{field}", default=None)
    update.add_argument("--dry-run", action="store_true")
    update.add_argument("--no-backup", action="store_true")
    update.set_defaults(func=cmd_update)

    args = parser.parse_args()
    if args.command == "add":
        inline = bool(args.es or args.uk)
        if inline and (args.json_file or args.csv_file):
            parser.error("use either --es/--uk or --json/--csv, not both")
        if inline and not (args.es and args.uk):
            parser.error("inline add requires both --es and --uk")
        if not inline and not (args.json_file or args.csv_file):
            parser.error("add requires --json, --csv, or --es + --uk")
    return args.func(args) or 0


if __name__ == "__main__":
    sys.exit(main())
