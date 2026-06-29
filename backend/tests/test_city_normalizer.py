"""Tests for city_normalizer driven by real prod values.

The fixtures in PROD_VARIANTS reflect every distinct city string seen in
expenses where category='subscribers' as of 2026-06-29 (1420 rows). If a
new alias is needed, add to ALIASES in city_normalizer.py and extend the
relevant case here.
"""
from app.services.city_normalizer import (
    CANONICAL_CITIES,
    normalize_cities,
)


# Each tuple: (raw, expected_cities, expected_leftover_nonempty)
PROD_SINGLE_CITY = [
    ("Азнакаево",       ["Азнакаево"]),
    ("азнакаево",       ["Азнакаево"]),
    ("Азнкаево",        ["Азнакаево"]),
    ("Азнакааево",      ["Азнакаево"]),
    ("Азнакаео",        ["Азнакаево"]),
    ("Альметьевск",     ["Альметьевск"]),
    ("альметьевск",     ["Альметьевск"]),
    ("Альметевск",      ["Альметьевск"]),
    ("Альметьвск",      ["Альметьевск"]),
    ("Аьметьевск",      ["Альметьевск"]),
    ("Альмет",          ["Альметьевск"]),
    ("Елабуга",         ["Елабуга"]),
    ("елабуга",         ["Елабуга"]),
    ("Елаабуга",        ["Елабуга"]),
    ("Елабугаа",        ["Елабуга"]),
    ("Бугульма",        ["Бугульма"]),
    ("бугульма",        ["Бугульма"]),
    ("Бушульма",        ["Бугульма"]),
    ("буга",            ["Бугульма"]),
    ("Казань",          ["Казань"]),
    ("казань",          ["Казань"]),
    ("Какзань",         ["Казань"]),
    ("Казнь",           ["Казань"]),
    ("Буинск",          ["Буинск"]),
    ("буинск",          ["Буинск"]),
    ("Нижнекамск",      ["Нижнекамск"]),
    ("Нижнекмск",       ["Нижнекамск"]),
    ("Челны",           ["Челны"]),
    ("челны",           ["Челны"]),
    ("Арск",            ["Арск"]),
    ("Лениногорск",     ["Лениногорск"]),
    ("Нурлат",          ["Нурлат"]),
    ("Зеленодольск",    ["Зеленодольск"]),
    ("Уруссу",          ["Уруссу"]),
    ("Кукмор",          ["Кукмор"]),
    ("Балтаси",         ["Балтаси"]),
    ("Бавлы",           ["Бавлы"]),
    ("Заинск",          ["Заинск"]),
    ("Чистополь",       ["Чистополь"]),
    ("Менделеевск",     ["Менделеевск"]),
    ("менделеевск",     ["Менделеевск"]),
    ("Аксубаево",       ["Аксубаево"]),
    ("Тетюши",          ["Тетюши"]),
    ("Мензелинск",      ["Мензелинск"]),
    ("Мамадыш",         ["Мамадыш"]),
]


PROD_MULTI_CITY = [
    ("Зеленодольск-Казань", ["Зеленодольск", "Казань"]),
    ("Челны-Елабуга",       ["Челны", "Елабуга"]),
    ("Бугульма-Азнакаево",  ["Бугульма", "Азнакаево"]),
    ("Альмет-Казань",       ["Альметьевск", "Казань"]),
    ("Казань-Зеленодольск", ["Казань", "Зеленодольск"]),
]


PROD_PARENTHETICAL = [
    # Inside the parens is "Чел из Азны" — comma-tokenised it's not a city,
    # but our "азны" alias maps the second word to Азнакаево.
    ("Челны(Чел из Азны)", ["Челны", "Азнакаево"], False),
]


PROD_NON_CITY = [
    ("теннис",           []),
    ("праздник в парке", []),
    ("Татарстан",        []),
]


def test_canonical_set_has_no_dupes():
    assert len(CANONICAL_CITIES) == len(set(CANONICAL_CITIES))


def test_empty_input():
    assert normalize_cities("") == ([], [])
    assert normalize_cities(None) == ([], [])
    assert normalize_cities("   ") == ([], [])


def test_single_city_variants():
    failures = []
    for raw, expected in PROD_SINGLE_CITY:
        got, leftover = normalize_cities(raw)
        if got != expected:
            failures.append(f"{raw!r}: got {got!r} (leftover {leftover!r}), expected {expected!r}")
    assert not failures, "\n".join(failures)


def test_multi_city_split():
    for raw, expected in PROD_MULTI_CITY:
        got, leftover = normalize_cities(raw)
        assert got == expected, f"{raw!r}: got {got!r}, expected {expected!r}"
        assert leftover == [], f"{raw!r}: unexpected leftover {leftover!r}"


def test_parenthetical():
    for raw, expected_cities, _ in PROD_PARENTHETICAL:
        got, _leftover = normalize_cities(raw)
        assert got == expected_cities, f"{raw!r}: got {got!r}, expected {expected_cities!r}"


def test_non_city_tokens_go_to_leftover():
    for raw, expected_cities in PROD_NON_CITY:
        got, leftover = normalize_cities(raw)
        assert got == expected_cities
        assert leftover, f"{raw!r}: expected leftover but got none"


def test_dedup_preserves_first_position():
    got, _ = normalize_cities("Казань-казань-Альмет")
    assert got == ["Казань", "Альметьевск"]


def test_unknown_chunk_keeps_raw_in_leftover():
    got, leftover = normalize_cities("Альметьевск-Урюпинск")
    assert got == ["Альметьевск"]
    assert leftover == ["Урюпинск"]
