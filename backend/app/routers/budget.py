from datetime import date
from typing import Optional
from fastapi import APIRouter, Depends, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..database import get_db
from ..models.purchase import AdPurchase, PurchaseStatus
from ..models.sale import AdSale, SaleStatus
from ..routers.auth import get_current_user
from ..models.user import User

router = APIRouter(prefix="/budget", tags=["budget"])

INCOME_STATUSES = (SaleStatus.placed, SaleStatus.paid)


def _exp_base(db: Session, from_: Optional[date], to: Optional[date]):
    q = db.query(AdPurchase).filter(AdPurchase.status == PurchaseStatus.placed)
    if from_:
        q = q.filter(AdPurchase.date >= from_)
    if to:
        q = q.filter(AdPurchase.date <= to)
    return q


def _inc_base(db: Session, from_: Optional[date], to: Optional[date], channel_id: Optional[int]):
    q = db.query(AdSale).filter(AdSale.status.in_(INCOME_STATUSES))
    if from_:
        q = q.filter(AdSale.date >= from_)
    if to:
        q = q.filter(AdSale.date <= to)
    if channel_id:
        q = q.filter(AdSale.channel_id == channel_id)
    return q


@router.get("/summary")
def budget_summary(
    from_: Optional[date] = Query(default=None, alias="from"),
    to: Optional[date] = Query(default=None),
    channel_id: Optional[int] = Query(default=None),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    expenses: float = _exp_base(db, from_, to).with_entities(
        func.coalesce(func.sum(AdPurchase.price), 0)
    ).scalar()

    income: float = _inc_base(db, from_, to, channel_id).with_entities(
        func.coalesce(func.sum(AdSale.price), 0)
    ).scalar()

    margin = income - expenses
    margin_pct = (margin / income * 100) if income else 0.0

    return {
        "expenses": round(float(expenses), 2),
        "income": round(float(income), 2),
        "margin": round(float(margin), 2),
        "margin_pct": round(margin_pct, 2),
        "currency": "RUB",
    }


@router.get("/monthly")
def budget_monthly(
    from_: Optional[date] = Query(default=None, alias="from"),
    to: Optional[date] = Query(default=None),
    channel_id: Optional[int] = Query(default=None),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    exp_rows = (
        _exp_base(db, from_, to)
        .with_entities(
            func.to_char(AdPurchase.date, "YYYY-MM").label("month"),
            func.sum(AdPurchase.price).label("total"),
        )
        .group_by(func.to_char(AdPurchase.date, "YYYY-MM"))
        .all()
    )
    inc_rows = (
        _inc_base(db, from_, to, channel_id)
        .with_entities(
            func.to_char(AdSale.date, "YYYY-MM").label("month"),
            func.sum(AdSale.price).label("total"),
        )
        .group_by(func.to_char(AdSale.date, "YYYY-MM"))
        .all()
    )

    exp_map = {r.month: float(r.total) for r in exp_rows}
    inc_map = {r.month: float(r.total) for r in inc_rows}
    months = sorted(set(exp_map) | set(inc_map))

    return [
        {
            "month": m,
            "expenses": round(exp_map.get(m, 0.0), 2),
            "income": round(inc_map.get(m, 0.0), 2),
            "margin": round(inc_map.get(m, 0.0) - exp_map.get(m, 0.0), 2),
        }
        for m in months
    ]
