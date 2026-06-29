import csv
import hashlib
import json
import logging
from datetime import date, datetime
from io import StringIO
from typing import Optional

import httpx
from sqlalchemy.orm import Session

from ..config import settings
from ..models.expense import Expense, ExpenseCategory, ExpenseStatus
from ..models.sheet_source import SheetSource, SheetsImportLog
from ..services.city_normalizer import normalize_cities

logger = logging.getLogger(__name__)


def _csv_url(gid: str) -> str:
    base = (settings.sheets_base_url or "").rstrip()
    if not base:
        raise RuntimeError("SHEETS_BASE_URL is not configured")
    return f"{base}{gid}"


async def fetch_csv(gid: str) -> list[dict]:
    """Pull the CSV export of a single tab and return rows as dicts.

    Row layout (per spec):
      row 0 — section header ("СММ ВЫПЛАТЫ ЗА НОВОСТЬ")
      row 1 — column names
      row 2+ — data
    """
    url = _csv_url(gid)
    async with httpx.AsyncClient(timeout=30, follow_redirects=True) as client:
        response = await client.get(url)
    response.raise_for_status()

    reader = csv.reader(StringIO(response.text))
    rows = list(reader)

    data: list[dict] = []
    for row in rows[2:]:
        if len(row) < 4:
            continue
        data.append({
            "date":        row[0].strip(),
            "city":        row[1].strip(),
            "price":       row[2].strip(),
            "about":       row[3].strip(),
            "responsible": row[4].strip() if len(row) > 4 else "",
        })
    return data


def make_row_hash(row: dict, gid: str) -> str:
    """Hash a row keyed by gid so the same row in two tabs stays distinct."""
    key = (
        f"{gid}|{row['date']}|{row['city']}|"
        f"{row['price']}|{row['about']}|{row['responsible']}"
    )
    return hashlib.md5(key.encode("utf-8")).hexdigest()


def parse_date(raw: str) -> Optional[date]:
    raw = raw.strip()
    for fmt in ("%d.%m.%Y", "%Y-%m-%d", "%d/%m/%Y"):
        try:
            return datetime.strptime(raw, fmt).date()
        except ValueError:
            continue
    return None


def parse_price(raw: str) -> Optional[float]:
    try:
        cleaned = raw.replace(" ", "").replace("\xa0", "").replace(",", ".")
        value = float(cleaned)
        return value if value > 0 else None
    except (ValueError, AttributeError):
        return None


def _save_result(db: Session, source: SheetSource, result: dict) -> None:
    source.last_synced_at = datetime.utcnow()
    source.last_sync_result = json.dumps(result, ensure_ascii=False)
    db.commit()


async def sync_source(source: SheetSource, db: Session) -> dict:
    """Sync one sheet — returns {'created', 'skipped', 'errors'}.

    Per-row commits keep partial successes durable: a malformed row in
    the middle of the sheet doesn't undo the imports above it.
    """
    created = 0
    skipped = 0
    errors = 0

    try:
        rows = await fetch_csv(source.gid)
    except Exception as e:
        logger.error("Sheets sync [%s]: fetch failed — %s", source.name, e)
        result = {"created": 0, "skipped": 0, "errors": 1,
                  "error_message": str(e)}
        _save_result(db, source, result)
        return result

    for row in rows:
        if not row["date"] and not row["price"]:
            skipped += 1
            continue

        row_hash = make_row_hash(row, source.gid)
        if db.query(SheetsImportLog).filter(
            SheetsImportLog.row_hash == row_hash
        ).first():
            skipped += 1
            continue

        expense_date = parse_date(row["date"])
        if not expense_date:
            errors += 1
            continue

        price = parse_price(row["price"])
        if not price:
            errors += 1
            continue

        cities, leftover = normalize_cities(row["city"])
        about = row["about"] or ""
        if leftover and row["city"]:
            comment = f"[city: {row['city']}] {about}".rstrip() or None
        else:
            comment = about or None

        try:
            expense = Expense(
                category=ExpenseCategory.subscribers,
                date=expense_date,
                price=price,
                currency="RUB",
                status=ExpenseStatus.placed,
                comment=comment,
                city=cities or None,
                responsible=row["responsible"] or None,
                channel_id=None,
                created_by=None,
            )
            db.add(expense)
            db.flush()

            log = SheetsImportLog(
                row_hash=row_hash,
                sheet_source_id=source.id,
                expense_id=expense.id,
                raw_data=json.dumps(row, ensure_ascii=False),
            )
            db.add(log)
            db.commit()
            created += 1
        except Exception as e:
            db.rollback()
            logger.error("Sheets sync [%s]: row error — %s", source.name, e)
            errors += 1

    result = {"created": created, "skipped": skipped, "errors": errors}
    _save_result(db, source, result)
    return result


async def sync_all_sources(db: Session) -> list[dict]:
    sources = db.query(SheetSource).filter(SheetSource.is_active.is_(True)).all()
    results = []
    for source in sources:
        result = await sync_source(source, db)
        results.append({"source_id": source.id, "source": source.name, **result})
    return results


async def preview_sheet(gid: str, sample: int = 3) -> dict:
    """Pull the sheet and return a small preview for the 'Test' button
    on the add-source modal: total row count + the first sample dates."""
    rows = await fetch_csv(gid)
    first_dates = [r["date"] for r in rows[:sample] if r["date"]]
    return {
        "row_count": len(rows),
        "first_dates": first_dates,
        "sample": rows[:sample],
    }
