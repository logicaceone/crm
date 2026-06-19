from datetime import date, timedelta
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..database import get_db
from ..models.channel import Channel, ChannelStat, ChannelPlatform
from ..models.purchase import AdPurchase, PurchaseStatus
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
    exp_q = db.query(func.coalesce(func.sum(AdPurchase.price), 0)).filter(
        AdPurchase.status == PurchaseStatus.placed
    )
    if from_:
        exp_q = exp_q.filter(AdPurchase.date >= from_)
    if to:
        exp_q = exp_q.filter(AdPurchase.date <= to)
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

    purchases_count_q = db.query(func.count(AdPurchase.id))
    if from_:
        purchases_count_q = purchases_count_q.filter(AdPurchase.date >= from_)
    if to:
        purchases_count_q = purchases_count_q.filter(AdPurchase.date <= to)
    purchases_count: int = purchases_count_q.scalar()

    margin = income - expenses
    margin_pct = (margin / income * 100) if income else 0.0

    return {
        "income": round(income, 2),
        "expenses": round(expenses, 2),
        "margin": round(margin, 2),
        "margin_pct": round(margin_pct, 2),
        "sales_count": sales_count,
        "purchases_count": purchases_count,
    }


@router.get("/top-channels")
def dashboard_top_channels(
    limit: int = Query(default=5, ge=1, le=20),
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


@router.get("/recent-purchases")
def dashboard_recent_purchases(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    rows = (
        db.query(AdPurchase)
        .order_by(AdPurchase.created_at.desc())
        .limit(5)
        .all()
    )
    return [
        {
            "id": r.id,
            "type": r.type.value if hasattr(r.type, "value") else str(r.type),
            "date": str(r.date),
            "channel_name": r.external_channel.name if r.external_channel else (r.target_platform or "—"),
            "price": r.price,
            "currency": r.currency,
            "status": r.status.value,
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
        .order_by(AdSale.created_at.desc())
        .limit(5)
        .all()
    )
    return [
        {
            "id": r.id,
            "date": str(r.date),
            "client_name": r.client_name,
            "channel_name": r.channel.name,
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
    """Audience snapshots over the last 90 days for a single platform.

    Replaces the previous client-side N+1 (one /channels/{id}/stats call
    per channel). One query for the platform's channels + one query for
    their stats, server-side merge and pagination.
    """
    if platform not in ("telegram", "max"):
        raise HTTPException(status_code=400, detail="platform must be telegram or max")

    today = date.today()
    from_date = today - timedelta(days=90)

    channels = (
        db.query(Channel)
        .filter(Channel.platform == ChannelPlatform(platform))
        .order_by(Channel.created_at)
        .all()
    )
    channel_payload = [
        {"id": c.id, "name": c.name, "platform": platform}
        for c in channels
    ]

    if not channels:
        return {
            "channels": [],
            "rows": [],
            "pagination": {"page": 1, "per_page": per_page, "total": 0, "total_pages": 1},
        }

    channel_ids = [c.id for c in channels]
    stats = (
        db.query(ChannelStat)
        .filter(
            ChannelStat.channel_id.in_(channel_ids),
            ChannelStat.date >= from_date,
            ChannelStat.subscribers_count.isnot(None),
        )
        .all()
    )

    name_by_id = {c.id: c.name for c in channels}
    by_date: dict[str, dict] = {}
    for s in stats:
        d = str(s.date)
        row = by_date.setdefault(d, {"date": d})
        row[name_by_id[s.channel_id]] = s.subscribers_count

    rows = sorted(by_date.values(), key=lambda r: r["date"], reverse=True)
    total = len(rows)
    total_pages = max(1, (total + per_page - 1) // per_page)
    page = max(1, min(page, total_pages))
    page_rows = rows[(page - 1) * per_page : page * per_page]

    return {
        "channels": channel_payload,
        "rows": page_rows,
        "pagination": {
            "page": page,
            "per_page": per_page,
            "total": total,
            "total_pages": total_pages,
        },
    }
