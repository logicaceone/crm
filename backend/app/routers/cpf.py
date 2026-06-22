from datetime import date, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, case, Numeric
from sqlalchemy.orm import Session

from ..database import get_db
from ..models.user import User, UserRole
from ..models.channel import Channel
from ..models.purchase import AdPurchase, ExternalChannel, PurchaseStatus, PurchaseType
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
    """CPF per channel for the period.

    spent  = SUM(price)        over status='placed' purchases in [from,to]
    joined = SUM(joined_count) over the same set
    cpf    = spent / joined    (NULL when joined = 0)

    Sorted by cpf ASC, channels with joined=0 last.
    """
    date_from, date_to = _default_range(from_, to)

    spent_sum = func.coalesce(func.sum(AdPurchase.price), 0).label("spent")
    joined_sum = func.coalesce(func.sum(AdPurchase.joined_count), 0).label("joined")
    cpf_expr = case(
        (joined_sum == 0, None),
        else_=func.round(
            (func.sum(AdPurchase.price) / func.sum(AdPurchase.joined_count)).cast(Numeric),
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
            AdPurchase,
            (AdPurchase.channel_id == Channel.id)
            & (AdPurchase.status == PurchaseStatus.placed)
            & (AdPurchase.date >= date_from)
            & (AdPurchase.date <= date_to),
        )
        .group_by(Channel.id, Channel.name, Channel.platform)
        # NULLS LAST is Postgres-specific; the project targets PG (postgres:15).
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
    """CPF for one channel, grouped by source (external_channel.name for
    type=ad, target_platform for type=target).

    Aggregates and the channel-level totals are computed in SQL.
    """
    ch = db.query(Channel).filter(Channel.id == channel_id).first()
    if not ch:
        raise HTTPException(status_code=404, detail="Channel not found")

    date_from, date_to = _default_range(from_, to)

    source_name = case(
        (AdPurchase.type == PurchaseType.ad, ExternalChannel.name),
        else_=AdPurchase.target_platform,
    ).label("source_name")

    spent_sum = func.coalesce(func.sum(AdPurchase.price), 0).label("spent")
    joined_sum = func.coalesce(func.sum(AdPurchase.joined_count), 0).label("joined")
    cpf_expr = case(
        (joined_sum == 0, None),
        else_=func.round(
            (func.sum(AdPurchase.price) / func.sum(AdPurchase.joined_count)).cast(Numeric),
            2,
        ),
    ).label("cpf")

    rows = (
        db.query(
            source_name,
            AdPurchase.type.label("source_type"),
            spent_sum,
            joined_sum,
            cpf_expr,
        )
        .outerjoin(ExternalChannel, ExternalChannel.id == AdPurchase.external_channel_id)
        .filter(
            AdPurchase.channel_id == channel_id,
            AdPurchase.status == PurchaseStatus.placed,
            AdPurchase.date >= date_from,
            AdPurchase.date <= date_to,
        )
        .group_by(source_name, AdPurchase.type)
        .order_by(cpf_expr.asc().nullslast())
        .all()
    )

    # Channel-level totals in a single aggregate query — never iterate
    # rows in Python to derive them, otherwise rounding of per-source
    # CPF would skew the channel CPF.
    total_row = (
        db.query(
            func.coalesce(func.sum(AdPurchase.price), 0).label("spent"),
            func.coalesce(func.sum(AdPurchase.joined_count), 0).label("joined"),
        )
        .filter(
            AdPurchase.channel_id == channel_id,
            AdPurchase.status == PurchaseStatus.placed,
            AdPurchase.date >= date_from,
            AdPurchase.date <= date_to,
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
                "source_type": (r.source_type.value if hasattr(r.source_type, "value") else str(r.source_type)),
                "source_name": r.source_name or "—",
                "spent": float(r.spent or 0),
                "joined": int(r.joined or 0),
                "cpf": float(r.cpf) if r.cpf is not None else None,
            }
            for r in rows
        ],
    }
