from datetime import date, timedelta
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ..database import get_db
from ..models.user import User, UserRole
from ..models.channel import Channel, ChannelStat
from ..schemas.channels import (
    ChannelResponse,
    ChannelWithStats,
    ChannelStatResponse,
    CreateChannelRequest,
    UpdateChannelRequest,
    CreateStatRequest,
)
from .auth import get_current_user, require_roles

router = APIRouter(prefix="/channels", tags=["channels"])

read_access = require_roles([UserRole.admin, UserRole.manager, UserRole.viewer])
write_access = require_roles([UserRole.admin, UserRole.manager])


def _last_stat(db: Session, channel_id: int) -> Optional[ChannelStat]:
    return (
        db.query(ChannelStat)
        .filter(ChannelStat.channel_id == channel_id)
        .order_by(ChannelStat.date.desc())
        .first()
    )


def _stat_near_date(db: Session, channel_id: int, target: date) -> Optional[ChannelStat]:
    """Return stat whose date is closest to `target`."""
    after = (
        db.query(ChannelStat)
        .filter(ChannelStat.channel_id == channel_id, ChannelStat.date >= target)
        .order_by(ChannelStat.date.asc())
        .first()
    )
    before = (
        db.query(ChannelStat)
        .filter(ChannelStat.channel_id == channel_id, ChannelStat.date < target)
        .order_by(ChannelStat.date.desc())
        .first()
    )
    if not after and not before:
        return None
    if not after:
        return before
    if not before:
        return after
    if abs((after.date - target).days) <= abs((before.date - target).days):
        return after
    return before


@router.get("", response_model=list[ChannelWithStats])
def list_channels(
    db: Session = Depends(get_db),
    _: User = Depends(read_access),
):
    channels = db.query(Channel).order_by(Channel.created_at).all()
    result = []
    for ch in channels:
        last = _last_stat(db, ch.id)
        ago = None
        if last:
            target = last.date - timedelta(days=30)
            candidate = _stat_near_date(db, ch.id, target)
            if candidate and candidate.id != last.id:
                ago = candidate
        result.append(
            ChannelWithStats(
                **ChannelResponse.model_validate(ch).model_dump(),
                last_stat=ChannelStatResponse.model_validate(last) if last else None,
                stat_30d_ago=ChannelStatResponse.model_validate(ago) if ago else None,
            )
        )
    return result


@router.post("", response_model=ChannelResponse, status_code=201)
def create_channel(
    data: CreateChannelRequest,
    db: Session = Depends(get_db),
    _: User = Depends(write_access),
):
    ch = Channel(**data.model_dump())
    db.add(ch)
    db.commit()
    db.refresh(ch)
    return ch


@router.get("/{channel_id}", response_model=ChannelWithStats)
def get_channel(
    channel_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(read_access),
):
    ch = db.query(Channel).filter(Channel.id == channel_id).first()
    if not ch:
        raise HTTPException(status_code=404, detail="Channel not found")
    last = _last_stat(db, ch.id)
    ago = None
    if last:
        target = last.date - timedelta(days=30)
        candidate = _stat_near_date(db, ch.id, target)
        if candidate and candidate.id != last.id:
            ago = candidate
    return ChannelWithStats(
        **ChannelResponse.model_validate(ch).model_dump(),
        last_stat=ChannelStatResponse.model_validate(last) if last else None,
        stat_30d_ago=ChannelStatResponse.model_validate(ago) if ago else None,
    )


@router.patch("/{channel_id}", response_model=ChannelResponse)
def update_channel(
    channel_id: int,
    data: UpdateChannelRequest,
    db: Session = Depends(get_db),
    _: User = Depends(write_access),
):
    ch = db.query(Channel).filter(Channel.id == channel_id).first()
    if not ch:
        raise HTTPException(status_code=404, detail="Channel not found")
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(ch, field, value)
    db.commit()
    db.refresh(ch)
    return ch


@router.delete("/{channel_id}", status_code=204)
def delete_channel(
    channel_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(write_access),
):
    ch = db.query(Channel).filter(Channel.id == channel_id).first()
    if not ch:
        raise HTTPException(status_code=404, detail="Channel not found")
    db.delete(ch)
    db.commit()


@router.post("/{channel_id}/stats", response_model=ChannelStatResponse, status_code=201)
def add_stat(
    channel_id: int,
    data: CreateStatRequest,
    db: Session = Depends(get_db),
    _: User = Depends(write_access),
):
    ch = db.query(Channel).filter(Channel.id == channel_id).first()
    if not ch:
        raise HTTPException(status_code=404, detail="Channel not found")
    stat = ChannelStat(channel_id=channel_id, **data.model_dump())
    db.add(stat)
    db.commit()
    db.refresh(stat)
    return stat


@router.get("/{channel_id}/stats", response_model=list[ChannelStatResponse])
def list_stats(
    channel_id: int,
    from_: Optional[date] = Query(default=None, alias="from"),
    to: Optional[date] = None,
    db: Session = Depends(get_db),
    _: User = Depends(read_access),
):
    ch = db.query(Channel).filter(Channel.id == channel_id).first()
    if not ch:
        raise HTTPException(status_code=404, detail="Channel not found")
    q = db.query(ChannelStat).filter(ChannelStat.channel_id == channel_id)
    if from_:
        q = q.filter(ChannelStat.date >= from_)
    if to:
        q = q.filter(ChannelStat.date <= to)
    return q.order_by(ChannelStat.date.asc()).all()
