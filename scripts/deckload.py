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
    group = add.add_mutually_exclusive_group(required=True)
    group.add_argument("--json", dest="json_file")
    group.add_argument("--csv", dest="csv_file")
    add.add_argument("--topic", default="", help="default topic when cards omit one")
    add.add_argument("--dry-run", action="store_true")
    add.add_argument("--no-backup", action="store_true")
    add.set_defaults(func=cmd_add)

    args = parser.parse_args()
    return args.func(args) or 0


if __name__ == "__main__":
    sys.exit(main())
