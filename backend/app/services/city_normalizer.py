"""Normalize free-form city strings for subscriber expenses.

The input comes from a Google Sheet column filled by humans — full of
typos, lowercase variants, multi-city entries like "Альмет-Казань" and
parenthetical asides like "Челны(Чел из Азны)". This module converts any
such string into a list of canonical city names from CANONICAL_CITIES.

Lookup order:
  1. Split on '-' / ',' / '/' and '(' to handle multi-city.
  2. For each chunk: exact lookup in ALIASES (lowercased).
  3. Fallback: difflib fuzzy match against CANONICAL_CITIES (cutoff 0.82).
  4. Anything still unmatched → None for that chunk; caller decides what
     to do (we keep raw text in comment).

Caller usage:

    cities, leftover = normalize_cities(raw)
    # cities    → list[str] in canonical form, may be []
    # leftover  → list[str] of un-normalized chunks (for the comment)

The canonical list is the set of Tatarstan cities actually seen in
prod (1420 rows). New cities can be added via CANONICAL_CITIES; aliases
via ALIASES.
"""
from __future__ import annotations

import difflib
import re
from typing import Iterable


CANONICAL_CITIES: tuple[str, ...] = (
    "Азнакаево",
    "Аксубаево",
    "Альметьевск",
    "Арск",
    "Балтаси",
    "Бавлы",
    "Бугульма",
    "Буинск",
    "Елабуга",
    "Заинск",
    "Зеленодольск",
    "Казань",
    "Кукмор",
    "Лениногорск",
    "Мамадыш",
    "Менделеевск",
    "Мензелинск",
    "Нижнекамск",
    "Нурлат",
    "Татарстан",
    "Тетюши",
    "Уруссу",
    "Челны",
    "Чистополь",
)

# Lowercase alias → canonical. Covers every distinct typo / short form
# observed in the existing 1420 prod rows plus a few obvious extras.
ALIASES: dict[str, str] = {
    # exact lowercase variants
    **{c.lower(): c for c in CANONICAL_CITIES},

    # Альметьевск family
    "альметевск": "Альметьевск",
    "альметьвск": "Альметьевск",
    "альметьвсе": "Альметьевск",
    "аьметьевск": "Альметьевск",
    "альмет": "Альметьевск",
    "альметь": "Альметьевск",
    "алмет": "Альметьевск",

    # Азнакаево family
    "азнкаево": "Азнакаево",
    "азнакааево": "Азнакаево",
    "азнакаео": "Азнакаево",
    "азна": "Азнакаево",
    "азны": "Азнакаево",

    # Елабуга family
    "елаабуга": "Елабуга",
    "елабугаа": "Елабуга",

    # Бугульма family
    "бушульма": "Бугульма",
    "буга": "Бугульма",

    # Казань family
    "казнь": "Казань",
    "какзань": "Казань",

    # Нижнекамск family
    "нижнекмск": "Нижнекамск",
    "нижнек": "Нижнекамск",

}

# Strings that explicitly are NOT cities — drop the city, keep raw in comment.
NON_CITY_TOKENS: frozenset[str] = frozenset({
    "рт",
    "теннис",
    "праздник",
    "праздник в парке",
})

_FUZZY_CUTOFF = 0.82
_SPLIT_RE = re.compile(r"[\s\-,/]+")


def _strip_parens(s: str) -> tuple[str, str | None]:
    """Return (outside, inside_or_None).

    "Челны(Чел из Азны)" → ("Челны", "Чел из Азны")
    "Казань"             → ("Казань", None)
    """
    m = re.match(r"^([^()]*)\(([^)]*)\)\s*$", s.strip())
    if not m:
        return s.strip(), None
    return m.group(1).strip(), m.group(2).strip() or None


def _match_one(chunk: str) -> str | None:
    """Match a single bare chunk → canonical city or None."""
    key = chunk.strip().lower()
    if not key or key in NON_CITY_TOKENS:
        return None
    if key in ALIASES:
        return ALIASES[key]
    # Fuzzy against the canonical list (also lowercased).
    canonical_lower = [c.lower() for c in CANONICAL_CITIES]
    match = difflib.get_close_matches(key, canonical_lower, n=1, cutoff=_FUZZY_CUTOFF)
    if match:
        idx = canonical_lower.index(match[0])
        return CANONICAL_CITIES[idx]
    return None


def _dedup_preserve_order(items: Iterable[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for x in items:
        if x not in seen:
            seen.add(x)
            out.append(x)
    return out


def normalize_cities(raw: str | None) -> tuple[list[str], list[str]]:
    """Parse a free-form city string into (canonical_cities, leftover_chunks).

    canonical_cities — deduplicated list of canonical city names, may be [].
    leftover_chunks  — chunks that couldn't be matched, in the order seen.
                       The caller typically appends them to the comment.

    Examples:
        normalize_cities("Альметьевск")          → (["Альметьевск"], [])
        normalize_cities("альметевс")            → (["Альметьевск"], [])
        normalize_cities("Альмет-Казань")        → (["Альметьевск", "Казань"], [])
        normalize_cities("Челны(Чел из Азны)")   → (["Челны", "Азнакаево"], [])
        normalize_cities("теннис")               → ([], ["теннис"])
        normalize_cities("Татарстан")            → (["Татарстан"], [])
        normalize_cities("")                     → ([], [])
        normalize_cities(None)                   → ([], [])
    """
    if not raw or not raw.strip():
        return [], []

    cities: list[str] = []
    leftover: list[str] = []

    # First peel off parenthetical aside, normalize both halves separately.
    outside, inside = _strip_parens(raw)
    pieces: list[str] = []
    if outside:
        pieces.extend(p for p in _SPLIT_RE.split(outside) if p.strip())
    if inside:
        pieces.extend(p for p in _SPLIT_RE.split(inside) if p.strip())

    for chunk in pieces:
        canonical = _match_one(chunk)
        if canonical:
            cities.append(canonical)
        else:
            leftover.append(chunk.strip())

    return _dedup_preserve_order(cities), leftover
