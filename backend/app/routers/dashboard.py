from datetime import date, timedelta
from typing import Optional
from fastapi import APIRouter, Depends, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..database import get_db
from ..models.channel import Channel, ChannelStat
from ..models.purchase import AdPurchase, PurchaseStatus
from ..models.sale import AdSale, SaleStatus
from ..routers.auth import get_current_user
from ..models.user import User

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
    today = date.today()
    ago_30 = today - timedelta(days=30)

    channels = db.query(Channel).all()
    result = []

    for ch in channels:
        # latest stat with subscriber count (bot records)
        latest = (
            db.query(ChannelStat)
            .filter(
                ChannelStat.channel_id == ch.id,
                ChannelStat.date <= today,
                ChannelStat.subscribers_count.isnot(None),
            )
            .order_by(ChannelStat.date.desc())
            .first()
        )
        if not latest:
            continue

        # closest stat to 30 days ago
        ago_stat = (
            db.query(ChannelStat)
            .filter(
                ChannelStat.channel_id == ch.id,
                ChannelStat.date <= ago_30,
                ChannelStat.subscribers_count.isnot(None),
            )
            .order_by(ChannelStat.date.desc())
            .first()
        )

        current = latest.subscribers_count
        previous = ago_stat.subscribers_count if ago_stat else current
        growth = current - previous
        growth_pct = (growth / previous * 100) if previous else 0.0

        result.append({
            "id": ch.id,
            "name": ch.name,
            "tg_link": ch.tg_link,
            "subscribers_current": current,
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
            "date": str(r.date),
            "channel_name": r.external_channel.name,
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
