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
from ..models.sale import AdSale, SaleStatus
from ..models.sales_sheet_source import SalesSheetSource, SalesImportLog
from .sheets_sync import parse_date, parse_price

logger = logging.getLogger(__name__)


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
        comment = f"Канал: {row['channels']}" if row["channels"] else None

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
                channel_id=None,
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

    result = {"created": created, "skipped": skipped, "errors": errors}
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
