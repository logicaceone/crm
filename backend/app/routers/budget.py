from datetime import date
from typing import Optional
from fastapi import APIRouter, Depends, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..database import get_db
from ..models.expense import Expense, ExpenseStatus, ExpenseCategory
from ..models.sale import AdSale, SaleStatus
from ..routers.auth import get_current_user
from ..models.user import User

router = APIRouter(prefix="/budget", tags=["budget"])

INCOME_STATUSES = (SaleStatus.placed, SaleStatus.paid)


def _exp_base(db: Session, from_: Optional[date], to: Optional[date]):
    q = db.query(Expense).filter(Expense.status == ExpenseStatus.placed)
    if from_:
        q = q.filter(Expense.date >= from_)
    if to:
        q = q.filter(Expense.date <= to)
    return q


def _inc_base(db: Session, from_: Optional[date], to: Optional[date]):
    q = db.query(AdSale).filter(AdSale.status.in_(INCOME_STATUSES))
    if from_:
        q = q.filter(AdSale.date >= from_)
    if to:
        q = q.filter(AdSale.date <= to)
    return q


@router.get("/summary")
def budget_summary(
    from_: Optional[date] = Query(default=None, alias="from"),
    to: Optional[date] = Query(default=None),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    expenses: float = _exp_base(db, from_, to).with_entities(
        func.coalesce(func.sum(Expense.price), 0)
    ).scalar()

    income: float = _inc_base(db, from_, to).with_entities(
        func.coalesce(func.sum(AdSale.price), 0)
    ).scalar()

    margin = income - expenses
    margin_pct = (margin / income * 100) if income else 0.0

    # Same filter set as the headline `expenses` so parts add up exactly.
    by_cat_rows = (
        _exp_base(db, from_, to)
        .with_entities(
            Expense.category,
            func.coalesce(func.sum(Expense.price), 0).label("total"),
        )
        .group_by(Expense.category)
        .all()
    )
    by_category: dict[str, float] = {c.value: 0.0 for c in ExpenseCategory}
    for cat, total in by_cat_rows:
        key = cat.value if hasattr(cat, "value") else str(cat)
        by_category[key] = round(float(total or 0), 2)

    # Per-city is subscribers-only; a single payment covering N cities
    # contributes its full price to each city (intentional — see UI note).
    city_q = _exp_base(db, from_, to).filter(
        Expense.category == ExpenseCategory.subscribers,
        Expense.city.isnot(None),
    )
    city_subq = city_q.with_entities(
        func.unnest(Expense.city).label("c"),
        Expense.price.label("p"),
    ).subquery()
    city_rows = (
        db.query(city_subq.c.c, func.coalesce(func.sum(city_subq.c.p), 0))
        .group_by(city_subq.c.c)
        .all()
    )
    by_city: dict[str, float] = {
        c: round(float(s or 0), 2) for c, s in city_rows if c
    }

    return {
        "expenses": round(float(expenses), 2),
        "income": round(float(income), 2),
        "margin": round(float(margin), 2),
        "margin_pct": round(margin_pct, 2),
        "currency": "RUB",
        "by_category": by_category,
        "by_city": by_city,
    }


@router.get("/monthly")
def budget_monthly(
    from_: Optional[date] = Query(default=None, alias="from"),
    to: Optional[date] = Query(default=None),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
):
    exp_rows = (
        _exp_base(db, from_, to)
        .with_entities(
            func.to_char(Expense.date, "YYYY-MM").label("month"),
            Expense.category.label("category"),
            func.sum(Expense.price).label("total"),
        )
        .group_by(func.to_char(Expense.date, "YYYY-MM"), Expense.category)
        .all()
    )
    inc_rows = (
        _inc_base(db, from_, to)
        .with_entities(
            func.to_char(AdSale.date, "YYYY-MM").label("month"),
            func.sum(AdSale.price).label("total"),
        )
        .group_by(func.to_char(AdSale.date, "YYYY-MM"))
        .all()
    )

    exp_total: dict[str, float] = {}
    exp_by_category: dict[str, dict[str, float]] = {}
    for r in exp_rows:
        key = r.category.value if hasattr(r.category, "value") else str(r.category)
        exp_total[r.month] = exp_total.get(r.month, 0.0) + float(r.total or 0)
        exp_by_category.setdefault(
            r.month, {c.value: 0.0 for c in ExpenseCategory}
        )
        exp_by_category[r.month][key] = float(r.total or 0)

    # Per-city per-month, subscribers only.
    city_subq = (
        _exp_base(db, from_, to)
        .filter(
            Expense.category == ExpenseCategory.subscribers,
            Expense.city.isnot(None),
        )
        .with_entities(
            func.to_char(Expense.date, "YYYY-MM").label("month"),
            func.unnest(Expense.city).label("c"),
            Expense.price.label("p"),
        )
        .subquery()
    )
    city_rows = (
        db.query(city_subq.c.month, city_subq.c.c, func.sum(city_subq.c.p))
        .group_by(city_subq.c.month, city_subq.c.c)
        .all()
    )
    exp_by_city: dict[str, dict[str, float]] = {}
    for month, c, total in city_rows:
        if not c:
            continue
        exp_by_city.setdefault(month, {})[c] = round(float(total or 0), 2)

    inc_map = {r.month: float(r.total) for r in inc_rows}
    months = sorted(set(exp_total) | set(inc_map))

    return [
        {
            "month": m,
            "expenses": round(exp_total.get(m, 0.0), 2),
            "income": round(inc_map.get(m, 0.0), 2),
            "margin": round(inc_map.get(m, 0.0) - exp_total.get(m, 0.0), 2),
            "by_category": {
                k: round(v, 2)
                for k, v in (exp_by_category.get(m) or {}).items()
            },
            "by_city": exp_by_city.get(m, {}),
        }
        for m in months
    ]
