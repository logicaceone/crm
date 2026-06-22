import csv
import hashlib
import json
import logging
from datetime import datetime
from io import StringIO
from typing import Optional

import httpx
from sqlalchemy.orm import Session

from ..config import settings
from ..models.channel import Channel, ChannelPlatform
from ..models.sale import AdSale, SaleStatus
from ..models.sales_sheet_source import SalesSheetSource, SalesImportLog
from .sheets_sync import parse_date, parse_price

logger = logging.getLogger(__name__)


# ── Channel matching (column C) ──────────────────────────────────────────────

# Bilingual prefixes; values map to ChannelPlatform value or 'vk' which
# intentionally never resolves to a row in our `channels` table.
PLATFORM_MAP = {
    "мах": "max", "max": "max",
    "тг":  "telegram", "tg": "telegram",
    "вк":  "vk", "vk": "vk",
}

VK_PLATFORMS = frozenset({"vk"})

# Strings that mean "this row covers many channels and we can't pin one
# down" — used as a substring check on the lowercase entry.
SKIP_TOKENS = ("все", "темный", "включая", "темн")


def preprocess_channel_string(raw: Optional[str]) -> str:
    """Strip + collapse whitespace + treat '.' as ',' (real data has both)."""
    if not raw:
        return ""
    result = raw.strip()
    result = " ".join(result.split())
    result = result.replace(".", ",")
    return result


def parse_channel_entry(raw: str) -> Optional[tuple[str, str]]:
    """Parse one comma-separated piece into (platform, city). Returns None
    for garbage / "covers everything" markers."""
    entry = raw.strip()
    if len(entry) < 3:
        return None
    low = entry.lower()
    if any(tok in low for tok in SKIP_TOKENS):
        return None

    parts = entry.split(None, 1)
    prefix = parts[0].lower()
    platform = PLATFORM_MAP.get(prefix)
    if platform and len(parts) > 1:
        city = parts[1].strip()
    else:
        # Unknown prefix or single word → treat the entire entry as a
        # city name on the default (Max) platform.
        platform = "max"
        city = entry
    return (platform, city)


def parse_channels_column(raw: Optional[str]) -> list[tuple[str, str]]:
    pre = preprocess_channel_string(raw)
    if not pre:
        return []
    entries = [e.strip() for e in pre.split(",") if e.strip()]
    out: list[tuple[str, str]] = []
    for e in entries:
        parsed = parse_channel_entry(e)
        if parsed:
            out.append(parsed)
    return out


def find_channel_id(
    platform: str,
    city: str,
    db: Session,
    cache: dict,
) -> Optional[int]:
    """Lookup the channel by platform + tolerant city match. Cached per
    (platform, lowered-city) so a single sync touches the DB once per
    distinct entry, not once per row."""
    cache_key = f"{platform}:{city.lower()}"
    if cache_key in cache:
        return cache[cache_key]

    # Map our string platform back to the enum the column uses.
    try:
        platform_enum = ChannelPlatform(platform)
    except ValueError:
        cache[cache_key] = None
        return None

    channels = db.query(Channel).filter(Channel.platform == platform_enum).all()
    city_lower = city.lower().strip()

    match: Optional[Channel] = None
    for ch in channels:
        name_lower = ch.name.lower()
        # Two-way containment so "Елабуга" matches "Светлый | Елабуга"
        # and vice versa. Stricter exact matching would miss the bulk
        # of the data because sheet entries are bare city names.
        if city_lower in name_lower or name_lower in city_lower:
            match = ch
            break

    result = match.id if match else None
    cache[cache_key] = result
    if not match:
        logger.warning(
            "Sales sheets: no channel match — platform=%s, city=%r", platform, city,
        )
    return result


def resolve_channel_id(
    raw: Optional[str],
    db: Session,
    cache: dict,
) -> Optional[int]:
    """Apply the matching rules:
      0 entries        → None
      1 entry  (non-VK)→ DB lookup
      2+ entries       → None (ambiguous)
      only VK entries  → None (VK is intentionally not in the channel table)
    """
    entries = parse_channels_column(raw)
    if not entries:
        return None
    matchable = [(p, c) for p, c in entries if p not in VK_PLATFORMS]
    if len(matchable) != 1:
        return None
    p, c = matchable[0]
    return find_channel_id(p, c, db, cache)


def _csv_url(gid: str) -> str:
    base = (settings.sales_sheets_base_url or "").rstrip()
    if not base:
        raise RuntimeError("SALES_SHEETS_BASE_URL is not configured")
    return f"{base}{gid}"


async def fetch_sales_csv(gid: str) -> list[dict]:
    """Pull the CSV export and return rows as dicts.

    Row layout: row 0 is the header (date pub | time | channels | client
    | topic | price | date paid | got money | made post), data starts at row 1.
    """
    url = _csv_url(gid)
    async with httpx.AsyncClient(timeout=30, follow_redirects=True) as client:
        response = await client.get(url)
    response.raise_for_status()

    reader = csv.reader(StringIO(response.text))
    rows = list(reader)

    data: list[dict] = []
    for row in rows[1:]:
        if len(row) < 9:
            continue
        data.append({
            "date_pub":  row[0].strip(),
            "channels":  row[2].strip(),
            "client":    row[3].strip(),
            "topic":     row[4].strip(),
            "price":     row[5].strip(),
            "date_paid": row[6].strip(),
            "got_money": row[7].strip(),
            "made_post": row[8].strip(),
        })
    return data


def make_sales_row_hash(row: dict, gid: str) -> str:
    key = (
        f"{gid}|{row['date_pub']}|{row['channels']}|"
        f"{row['client']}|{row['price']}|{row['date_paid']}"
    )
    return hashlib.md5(key.encode("utf-8")).hexdigest()


def parse_checkbox(raw: str) -> bool:
    """Google Sheets exports checkbox cells as the literal 'TRUE' / 'FALSE'."""
    return (raw or "").strip().upper() == "TRUE"


def _save_result(db: Session, source: SalesSheetSource, result: dict) -> None:
    source.last_synced_at = datetime.utcnow()
    source.last_sync_result = json.dumps(result, ensure_ascii=False)
    db.commit()


async def sync_sales_source(source: SalesSheetSource, db: Session) -> dict:
    created = 0
    skipped = 0
    errors = 0
    channel_cache: dict[str, Optional[int]] = {}
    unmatched: set[str] = set()

    try:
        rows = await fetch_sales_csv(source.gid)
    except Exception as e:
        logger.error("Sales sheets [%s]: fetch failed — %s", source.name, e)
        result = {"created": 0, "skipped": 0, "errors": 1,
                  "error_message": str(e)}
        _save_result(db, source, result)
        return result

    for row in rows:
        # Empty rows
        if not row["date_pub"] and not row["price"]:
            skipped += 1
            continue

        # Hard gate: only import rows where money received AND post made.
        if not (parse_checkbox(row["got_money"]) and parse_checkbox(row["made_post"])):
            skipped += 1
            continue

        row_hash = make_sales_row_hash(row, source.gid)
        if db.query(SalesImportLog).filter(
            SalesImportLog.row_hash == row_hash
        ).first():
            skipped += 1
            continue

        sale_date = parse_date(row["date_pub"])
        if not sale_date:
            logger.warning("Sales sheets [%s]: bad date %r — skipping",
                           source.name, row["date_pub"])
            errors += 1
            continue

        price = parse_price(row["price"])
        if not price:
            logger.warning("Sales sheets [%s]: bad price %r — skipping",
                           source.name, row["price"])
            errors += 1
            continue

        paid_at = parse_date(row["date_paid"]) if row["date_paid"] else None

        raw_channels = row["channels"]
        channel_id = resolve_channel_id(raw_channels, db, channel_cache)
        comment = f"Канал: {raw_channels}" if raw_channels.strip() else None

        # Track only single-entry, non-VK lookups that returned nothing —
        # multi-entry rows are intentional None and not worth surfacing.
        entries = parse_channels_column(raw_channels)
        matchable = [(p, c) for p, c in entries if p not in VK_PLATFORMS]
        if len(matchable) == 1:
            p, c = matchable[0]
            if channel_cache.get(f"{p}:{c.lower()}") is None:
                unmatched.add(f"{p}:{c}")

        try:
            sale = AdSale(
                client_name=row["client"] or "—",
                topic=row["topic"] or None,
                date=sale_date,
                paid_at=paid_at,
                price=price,
                currency="RUB",
                status=SaleStatus.paid,
                comment=comment,
                channel_id=channel_id,
                format=None,
                created_by=None,
            )
            db.add(sale)
            db.flush()

            log = SalesImportLog(
                row_hash=row_hash,
                sales_sheet_source_id=source.id,
                sale_id=sale.id,
                raw_data=json.dumps(row, ensure_ascii=False),
            )
            db.add(log)
            db.commit()
            created += 1
        except Exception as e:
            db.rollback()
            logger.error("Sales sheets [%s]: row error — %s", source.name, e)
            errors += 1

    result: dict = {"created": created, "skipped": skipped, "errors": errors}
    if unmatched:
        result["unmatched_channels"] = sorted(unmatched)
    _save_result(db, source, result)
    return result


async def sync_all_sales_sources(db: Session) -> list[dict]:
    sources = db.query(SalesSheetSource).filter(SalesSheetSource.is_active.is_(True)).all()
    results = []
    for source in sources:
        result = await sync_sales_source(source, db)
        results.append({"source_id": source.id, "source": source.name, **result})
    return results


async def preview_sales_sheet(gid: str, sample: int = 3) -> dict:
    rows = await fetch_sales_csv(gid)
    first_dates = [r["date_pub"] for r in rows[:sample] if r["date_pub"]]
    return {
        "row_count": len(rows),
        "first_dates": first_dates,
        "sample": rows[:sample],
    }
