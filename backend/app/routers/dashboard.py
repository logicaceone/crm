from datetime import date, timedelta
from typing import Optional, Sequence
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, or_, and_
from sqlalchemy.orm import Session, aliased

from ..database import get_db
from ..models.channel import Channel, ChannelStat, ChannelPlatform
from ..models.expense import Expense, ExpenseStatus
from ..models.sale import AdSale, SaleStatus
from ..routers.auth import get_current_user
from ..models.user import User
from ..utils.stats import get_latest_snapshot, get_baseline_30d_ago, get_growth_30d

router = APIRouter(prefix="/dashboard", tags=["dashboard"])

INCOME_STATUSES = (SaleStatus.placed, SaleStatus.paid)


@router.get("/summary")
def dashboard_summary(
    from_: Optional[date] = Query(default=None, alias="from"),
    to: Optional[date] = Query(default=None),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    exp_q = db.query(func.coalesce(func.sum(Expense.price), 0)).filter(
        Expense.status == ExpenseStatus.placed
    )
    if from_:
        exp_q = exp_q.filter(Expense.date >= from_)
    if to:
        exp_q = exp_q.filter(Expense.date <= to)
    expenses: float = float(exp_q.scalar())

    inc_q = db.query(func.coalesce(func.sum(AdSale.price), 0)).filter(
        AdSale.status.in_(INCOME_STATUSES)
    )
    if from_:
        inc_q = inc_q.filter(AdSale.date >= from_)
    if to:
        inc_q = inc_q.filter(AdSale.date <= to)
    income: float = float(inc_q.scalar())

    sales_count_q = db.query(func.count(AdSale.id))
    if from_:
        sales_count_q = sales_count_q.filter(AdSale.date >= from_)
    if to:
        sales_count_q = sales_count_q.filter(AdSale.date <= to)
    sales_count: int = sales_count_q.scalar()

    expenses_count_q = db.query(func.count(Expense.id))
    if from_:
        expenses_count_q = expenses_count_q.filter(Expense.date >= from_)
    if to:
        expenses_count_q = expenses_count_q.filter(Expense.date <= to)
    expenses_count: int = expenses_count_q.scalar()

    margin = income - expenses
    margin_pct = (margin / income * 100) if income else 0.0

    return {
        "income": round(income, 2),
        "expenses": round(expenses, 2),
        "margin": round(margin, 2),
        "margin_pct": round(margin_pct, 2),
        "sales_count": sales_count,
        "expenses_count": expenses_count,
    }


def _group_subscribers(
    db: Session,
    *,
    platforms: Optional[Sequence[ChannelPlatform]],
    name_patterns: Sequence[str],
) -> dict:
    """Aggregate first/last subscriber count across channels matching
    platforms + ILIKE name patterns.

    Per-channel min/max date is computed once in a subquery, then joined
    back to ChannelStat twice (aliased) to pull the actual counts.
    (channel_id, date) is unique on ChannelStat, so each join yields at
    most one row per channel — the SUMs aren't inflated by duplicates.

    Channels with no snapshots are excluded by the inner join. A
    channel with a single snapshot still appears: first == last and
    growth comes out to 0, which is the desired "no history" behaviour.
    """
    pc = (
        db.query(
            ChannelStat.channel_id.label("channel_id"),
            func.min(ChannelStat.date).label("min_date"),
            func.max(ChannelStat.date).label("max_date"),
        )
        .filter(ChannelStat.subscribers_count.isnot(None))
        .group_by(ChannelStat.channel_id)
        .subquery()
    )
    first_s = aliased(ChannelStat)
    last_s = aliased(ChannelStat)

    name_or = or_(*(Channel.name.ilike(p) for p in name_patterns))
    where = [name_or]
    if platforms:
        where.append(Channel.platform.in_(platforms))

    rows = (
        db.query(
            first_s.subscribers_count.label("first"),
            last_s.subscribers_count.label("last"),
        )
        .select_from(Channel)
        .join(pc, pc.c.channel_id == Channel.id)
        .join(first_s, and_(first_s.channel_id == Channel.id,
                            first_s.date == pc.c.min_date))
        .join(last_s, and_(last_s.channel_id == Channel.id,
                           last_s.date == pc.c.max_date))
        .filter(*where)
        .all()
    )

    current = sum(int(r.last or 0) for r in rows)
    first = sum(int(r.first or 0) for r in rows)
    return {
        "current": current,
        "first": first,
        "growth": current - first,
        "channels_count": len(rows),
    }


@router.get("/subscribers-summary")
def dashboard_subscribers_summary(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Five named groups of channels: TG Светлый, TG Тёмный, TG light+dark,
    MAX Светлый, all-platforms Светлый. For each group: current
    subscribers (sum of latest snapshots), first subscribers (sum of
    earliest snapshots), growth, and channel count.

    Name matching is ILIKE so it stays diacritic-aware ('Тёмный' and
    'Темный' are both passed in explicitly).
    """
    tg = [ChannelPlatform.telegram]
    mx = [ChannelPlatform.max]
    LIGHT = ["%Светлый%"]
    DARK = ["%Темный%", "%Тёмный%"]
    LIGHT_AND_DARK = LIGHT + DARK

    return {
        "tg_light": _group_subscribers(db, platforms=tg, name_patterns=LIGHT),
        "tg_dark": _group_subscribers(db, platforms=tg, name_patterns=DARK),
        "tg_light_and_dark": _group_subscribers(db, platforms=tg, name_patterns=LIGHT_AND_DARK),
        "max_light": _group_subscribers(db, platforms=mx, name_patterns=LIGHT),
        "all_light": _group_subscribers(db, platforms=None, name_patterns=LIGHT),
    }


@router.get("/top-channels")
def dashboard_top_channels(
    limit: int = Query(default=50, ge=1, le=100),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    channels = db.query(Channel).all()
    result = []

    for ch in channels:
        snapshots = (
            db.query(ChannelStat)
            .filter(
                ChannelStat.channel_id == ch.id,
                ChannelStat.subscribers_count.isnot(None),
            )
            .all()
        )
        latest = get_latest_snapshot(snapshots)
        if not latest:
            continue

        baseline = get_baseline_30d_ago(snapshots)
        previous = baseline.subscribers_count if baseline else latest.subscribers_count
        growth = get_growth_30d(snapshots) or 0
        growth_pct = (growth / previous * 100) if previous else 0.0

        result.append({
            "id": ch.id,
            "name": ch.name,
            "platform": ch.platform.value if hasattr(ch.platform, "value") else str(ch.platform),
            "tg_link": ch.tg_link,
            "subscribers_current": latest.subscribers_count,
            "subscribers_30d_ago": previous,
            "growth": growth,
            "growth_pct": round(growth_pct, 2),
        })

    result.sort(key=lambda x: x["growth"], reverse=True)
    return result[:limit]


@router.get("/recent-expenses")
def dashboard_recent_expenses(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    rows = (
        db.query(Expense)
        .order_by(Expense.date.desc(), Expense.id.desc())
        .limit(5)
        .all()
    )
    return [
        {
            "id": r.id,
            "category": r.category.value if hasattr(r.category, "value") else str(r.category),
            "date": str(r.date),
            "external_channel_name": r.external_channel.name if r.external_channel else None,
            "channel_name": r.channel.name if r.channel else None,
            "price": r.price,
            "currency": r.currency,
            "status": r.status.value,
            "responsible": r.responsible,
        }
        for r in rows
    ]


@router.get("/recent-sales")
def dashboard_recent_sales(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    rows = (
        db.query(AdSale)
        .order_by(AdSale.date.desc(), AdSale.id.desc())
        .limit(5)
        .all()
    )
    return [
        {
            "id": r.id,
            "date": str(r.date),
            "client_name": r.client_name,
            # channel may be NULL for sheet-imported sales — the UI shows '—'.
            "channel_name": r.channel.name if r.channel else None,
            "price": r.price,
            "currency": r.currency,
            "status": r.status.value,
        }
        for r in rows
    ]


@router.get("/audience-table")
def dashboard_audience_table(
    platform: str = Query(..., description="telegram or max"),
    page: int = Query(default=1, ge=1),
    per_page: int = Query(default=15, ge=1, le=100),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Audience snapshots over the last 30 days for a single platform.

    Response is transposed: rows = channels, columns = ISO dates
    (newest first). Pagination is by channel — date columns stay the
    same across pages so the UI doesn't have to refit headers.
    """
    if platform not in ("telegram", "max"):
        raise HTTPException(status_code=400, detail="platform must be telegram or max")

    today = date.today()
    from_date = today - timedelta(days=30)

    # Count channels first so pagination math doesn't load rows we
    # won't show. Empty platforms get the standard empty envelope.
    total = (
        db.query(func.count(Channel.id))
        .filter(Channel.platform == ChannelPlatform(platform))
        .scalar()
    ) or 0

    total_pages = max(1, (total + per_page - 1) // per_page)
    page = max(1, min(page, total_pages))

    if total == 0:
        return {
            "columns": [],
            "rows": [],
            "pagination": {"page": 1, "per_page": per_page, "total": 0, "total_pages": 1},
        }

    page_channels = (
        db.query(Channel)
        .filter(Channel.platform == ChannelPlatform(platform))
        .order_by(Channel.created_at)
        .offset((page - 1) * per_page)
        .limit(per_page)
        .all()
    )
    channel_ids = [c.id for c in page_channels]

    # All distinct snapshot dates across the whole platform in the
    # window, so every page shows the same column set. Dates without
    # any snapshot don't appear — the spec says "last 30 days where
    # snapshots exist".
    date_rows = (
        db.query(ChannelStat.date)
        .join(Channel, Channel.id == ChannelStat.channel_id)
        .filter(
            Channel.platform == ChannelPlatform(platform),
            ChannelStat.date >= from_date,
            ChannelStat.subscribers_count.isnot(None),
        )
        .distinct()
        .order_by(ChannelStat.date.desc())
        .all()
    )
    columns = [d[0].isoformat() for d in date_rows]

    # Snapshots only for the channels on this page — one query, no N+1.
    stats = (
        db.query(ChannelStat)
        .filter(
            ChannelStat.channel_id.in_(channel_ids) if channel_ids else False,
            ChannelStat.date >= from_date,
            ChannelStat.subscribers_count.isnot(None),
        )
        .all()
    )

    # values[channel_id][iso_date] = count
    values_by_ch: dict[int, dict[str, int]] = {ch.id: {} for ch in page_channels}
    for s in stats:
        values_by_ch[s.channel_id][s.date.isoformat()] = s.subscribers_count

    rows = []
    for ch in page_channels:
        ch_vals = values_by_ch.get(ch.id, {})
        rows.append({
            "channel_id": ch.id,
            "channel_name": ch.name,
            "platform": platform,
            # Explicit None for dates without a snapshot so the UI can
            # render "—" directly without a separate "has key" check.
            "values": {d: ch_vals.get(d) for d in columns},
        })

    return {
        "columns": columns,
        "rows": rows,
        "pagination": {
            "page": page,
            "per_page": per_page,
            "total": total,
            "total_pages": total_pages,
        },
    }
