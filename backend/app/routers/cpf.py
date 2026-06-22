from datetime import date, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, case, Numeric
from sqlalchemy.orm import Session

from ..database import get_db
from ..models.user import User, UserRole
from ..models.channel import Channel
from ..models.expense import (
    Expense,
    ExternalChannel,
    ExpenseStatus,
    ExpenseCategory,
    CPA_CATEGORIES,
)
from .auth import require_roles

router = APIRouter(prefix="/cpf", tags=["cpf"])

cpf_access = require_roles([UserRole.root, UserRole.admin, UserRole.manager])


def _default_range(from_: Optional[date], to: Optional[date]) -> tuple[date, date]:
    today = date.today()
    return (from_ or today - timedelta(days=30), to or today)


@router.get("/summary")
def cpf_summary(
    from_: Optional[date] = Query(default=None, alias="from"),
    to: Optional[date] = Query(default=None),
    db: Session = Depends(get_db),
    _: User = Depends(cpf_access),
):
    """CPF per channel — only CPA-category expenses contribute."""
    date_from, date_to = _default_range(from_, to)
    cpa_cats = list(CPA_CATEGORIES)

    spent_sum = func.coalesce(func.sum(Expense.price), 0).label("spent")
    joined_sum = func.coalesce(func.sum(Expense.joined_count), 0).label("joined")
    cpf_expr = case(
        (joined_sum == 0, None),
        else_=func.round(
            (func.sum(Expense.price) / func.sum(Expense.joined_count)).cast(Numeric),
            2,
        ),
    ).label("cpf")

    rows = (
        db.query(
            Channel.id.label("channel_id"),
            Channel.name.label("channel_name"),
            Channel.platform.label("platform"),
            spent_sum,
            joined_sum,
            cpf_expr,
        )
        .outerjoin(
            Expense,
            (Expense.channel_id == Channel.id)
            & (Expense.status == ExpenseStatus.placed)
            & (Expense.category.in_(cpa_cats))
            & (Expense.date >= date_from)
            & (Expense.date <= date_to),
        )
        .group_by(Channel.id, Channel.name, Channel.platform)
        .order_by(cpf_expr.asc().nullslast())
        .all()
    )

    return [
        {
            "channel_id": r.channel_id,
            "channel_name": r.channel_name,
            "platform": r.platform.value if hasattr(r.platform, "value") else str(r.platform),
            "spent": float(r.spent or 0),
            "joined": int(r.joined or 0),
            "cpf": float(r.cpf) if r.cpf is not None else None,
        }
        for r in rows
    ]


@router.get("/by-channel")
def cpf_by_channel(
    channel_id: int = Query(...),
    from_: Optional[date] = Query(default=None, alias="from"),
    to: Optional[date] = Query(default=None),
    db: Session = Depends(get_db),
    _: User = Depends(cpf_access),
):
    """CPF for one channel, grouped by category. For blogger spend each
    external_channel becomes its own row, since the actual ad platform
    (the blogger's TG channel) is the meaningful breakdown there."""
    ch = db.query(Channel).filter(Channel.id == channel_id).first()
    if not ch:
        raise HTTPException(status_code=404, detail="Channel not found")

    date_from, date_to = _default_range(from_, to)
    cpa_cats = list(CPA_CATEGORIES)

    source_name = case(
        (Expense.category == ExpenseCategory.blogger, ExternalChannel.name),
        else_=None,
    ).label("source_name")

    spent_sum = func.coalesce(func.sum(Expense.price), 0).label("spent")
    joined_sum = func.coalesce(func.sum(Expense.joined_count), 0).label("joined")
    cpf_expr = case(
        (joined_sum == 0, None),
        else_=func.round(
            (func.sum(Expense.price) / func.sum(Expense.joined_count)).cast(Numeric),
            2,
        ),
    ).label("cpf")

    rows = (
        db.query(
            source_name,
            Expense.category.label("category"),
            spent_sum,
            joined_sum,
            cpf_expr,
        )
        .outerjoin(ExternalChannel, ExternalChannel.id == Expense.external_channel_id)
        .filter(
            Expense.channel_id == channel_id,
            Expense.status == ExpenseStatus.placed,
            Expense.category.in_(cpa_cats),
            Expense.date >= date_from,
            Expense.date <= date_to,
        )
        .group_by(source_name, Expense.category)
        .order_by(cpf_expr.asc().nullslast())
        .all()
    )

    total_row = (
        db.query(
            func.coalesce(func.sum(Expense.price), 0).label("spent"),
            func.coalesce(func.sum(Expense.joined_count), 0).label("joined"),
        )
        .filter(
            Expense.channel_id == channel_id,
            Expense.status == ExpenseStatus.placed,
            Expense.category.in_(cpa_cats),
            Expense.date >= date_from,
            Expense.date <= date_to,
        )
        .one()
    )
    total_spent = float(total_row.spent or 0)
    total_joined = int(total_row.joined or 0)
    total_cpf = round(total_spent / total_joined, 2) if total_joined > 0 else None

    return {
        "channel_id": ch.id,
        "channel_name": ch.name,
        "platform": ch.platform.value if hasattr(ch.platform, "value") else str(ch.platform),
        "total": {
            "spent": total_spent,
            "joined": total_joined,
            "cpf": total_cpf,
        },
        "rows": [
            {
                "category": (r.category.value if hasattr(r.category, "value") else str(r.category)),
                "source_name": r.source_name or "—",
                "spent": float(r.spent or 0),
                "joined": int(r.joined or 0),
                "cpf": float(r.cpf) if r.cpf is not None else None,
            }
            for r in rows
        ],
    }
