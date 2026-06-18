from datetime import date, timedelta
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db
from ..models.channel import Channel, ChannelStat
from ..models.user import User, UserRole
from .auth import get_current_user, require_roles

router = APIRouter(prefix="/stats", tags=["stats"])

all_roles = require_roles([UserRole.root, UserRole.admin, UserRole.manager, UserRole.viewer])


class ChannelBrief(BaseModel):
    id: int
    name: str
    platform: str


class SubscriberPoint(BaseModel):
    date: date
    subscribers_count: int


class SubscribersResponse(BaseModel):
    channel: ChannelBrief
    stats: list[SubscriberPoint]


@router.get("/subscribers", response_model=SubscribersResponse)
def get_subscriber_stats(
    channel_id: int = Query(...),
    from_: Optional[date] = Query(default=None, alias="from"),
    to: Optional[date] = Query(default=None),
    db: Session = Depends(get_db),
    _: User = Depends(all_roles),
):
    ch = db.query(Channel).filter(Channel.id == channel_id).first()
    if not ch:
        raise HTTPException(status_code=404, detail="Channel not found")

    date_from = from_ or (date.today() - timedelta(days=30))
    date_to = to or date.today()

    rows = (
        db.query(ChannelStat)
        .filter(
            ChannelStat.channel_id == channel_id,
            ChannelStat.subscribers_count.isnot(None),
            ChannelStat.date >= date_from,
            ChannelStat.date <= date_to,
        )
        .order_by(ChannelStat.date.asc())
        .all()
    )

    return SubscribersResponse(
        channel=ChannelBrief(
            id=ch.id,
            name=ch.name,
            platform=ch.platform.value if hasattr(ch.platform, "value") else str(ch.platform),
        ),
        stats=[
            SubscriberPoint(date=r.date, subscribers_count=r.subscribers_count)
            for r in rows
        ],
    )
