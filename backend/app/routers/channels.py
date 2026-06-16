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
from ..activity import log_action

router = APIRouter(prefix="/channels", tags=["channels"])

read_access = require_roles([UserRole.root, UserRole.admin, UserRole.manager, UserRole.viewer])
write_access = require_roles([UserRole.root, UserRole.admin, UserRole.manager])


def _last_subscriber_stat(db: Session, channel_id: int) -> Optional[ChannelStat]:
    return (
        db.query(ChannelStat)
        .filter(ChannelStat.channel_id == channel_id, ChannelStat.subscribers_count.isnot(None))
        .order_by(ChannelStat.date.desc())
        .first()
    )


def _last_views_stat(db: Session, channel_id: int) -> Optional[ChannelStat]:
    return (
        db.query(ChannelStat)
        .filter(ChannelStat.channel_id == channel_id, ChannelStat.avg_views_per_post.isnot(None))
        .order_by(ChannelStat.date.desc())
        .first()
    )


def _subscriber_stat_near_date(db: Session, channel_id: int, target: date) -> Optional[ChannelStat]:
    """Return subscriber stat whose date is closest to `target`."""
    after = (
        db.query(ChannelStat)
        .filter(
            ChannelStat.channel_id == channel_id,
            ChannelStat.subscribers_count.isnot(None),
            ChannelStat.date >= target,
        )
        .order_by(ChannelStat.date.asc())
        .first()
    )
    before = (
        db.query(ChannelStat)
        .filter(
            ChannelStat.channel_id == channel_id,
            ChannelStat.subscribers_count.isnot(None),
            ChannelStat.date < target,
        )
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


def _build_channel_with_stats(db: Session, ch: Channel) -> ChannelWithStats:
    last_sub = _last_subscriber_stat(db, ch.id)
    last_views = _last_views_stat(db, ch.id)
    ago = None
    if last_sub:
        target = last_sub.date - timedelta(days=30)
        candidate = _subscriber_stat_near_date(db, ch.id, target)
        if candidate and candidate.id != last_sub.id:
            ago = candidate
    return ChannelWithStats(
        **ChannelResponse.model_validate(ch).model_dump(),
        last_subscriber_stat=ChannelStatResponse.model_validate(last_sub) if last_sub else None,
        last_views_stat=ChannelStatResponse.model_validate(last_views) if last_views else None,
        stat_30d_ago=ChannelStatResponse.model_validate(ago) if ago else None,
    )


@router.get("", response_model=list[ChannelWithStats])
def list_channels(
    db: Session = Depends(get_db),
    _: User = Depends(read_access),
):
    channels = db.query(Channel).order_by(Channel.created_at).all()
    return [_build_channel_with_stats(db, ch) for ch in channels]


@router.post("", response_model=ChannelResponse, status_code=201)
def create_channel(
    data: CreateChannelRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(write_access),
):
    ch = Channel(**data.model_dump())
    db.add(ch)
    db.commit()
    db.refresh(ch)
    log_action(db, current_user, "create", "channel", ch.id, f"Канал: {ch.name}")
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
    return _build_channel_with_stats(db, ch)


@router.patch("/{channel_id}", response_model=ChannelResponse)
def update_channel(
    channel_id: int,
    data: UpdateChannelRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(write_access),
):
    ch = db.query(Channel).filter(Channel.id == channel_id).first()
    if not ch:
        raise HTTPException(status_code=404, detail="Channel not found")
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(ch, field, value)
    db.commit()
    db.refresh(ch)
    log_action(db, current_user, "update", "channel", ch.id, f"Канал: {ch.name} обновлён")
    return ch


@router.delete("/{channel_id}", status_code=204)
def delete_channel(
    channel_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(write_access),
):
    ch = db.query(Channel).filter(Channel.id == channel_id).first()
    if not ch:
        raise HTTPException(status_code=404, detail="Channel not found")
    name = ch.name
    db.delete(ch)
    db.commit()
    log_action(db, current_user, "delete", "channel", channel_id, f"Канал: {name}")


@router.post("/{channel_id}/stats", response_model=ChannelStatResponse, status_code=201)
def add_stat(
    channel_id: int,
    data: CreateStatRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(write_access),
):
    ch = db.query(Channel).filter(Channel.id == channel_id).first()
    if not ch:
        raise HTTPException(status_code=404, detail="Channel not found")
    stat = ChannelStat(
        channel_id=channel_id,
        date=data.date,
        avg_views_per_post=data.avg_views_per_post,
        subscribers_count=None,
    )
    db.add(stat)
    db.commit()
    db.refresh(stat)
    log_action(db, current_user, "create", "channel_stat", stat.id,
               f"Снапшот {ch.name}: {data.avg_views_per_post} просм/пост ({data.date})")
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
