from datetime import date, datetime, timedelta
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ..database import get_db
from ..models.user import User, UserRole
from ..models.channel import Channel, ChannelStat, ChannelPlatform
from ..schemas.channels import (
    ChannelResponse,
    ChannelWithStats,
    ChannelStatResponse,
    CreateChannelRequest,
    UpdateChannelRequest,
    CreateStatRequest,
    SyncResult,
)
from .auth import get_current_user, require_roles
from ..activity import log_action
from ..config import settings

router = APIRouter(prefix="/channels", tags=["channels"])

read_access = require_roles([UserRole.root, UserRole.admin, UserRole.manager, UserRole.viewer])
write_access = require_roles([UserRole.root, UserRole.admin, UserRole.manager])


def _encrypt(plain: str) -> str:
    from ..crypto import encrypt_token
    return encrypt_token(plain)


def _decrypt(enc: str) -> str:
    from ..crypto import decrypt_token
    return decrypt_token(enc)


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


def _channel_response(ch: Channel) -> ChannelResponse:
    return ChannelResponse(
        id=ch.id,
        name=ch.name,
        platform=ch.platform.value if hasattr(ch.platform, "value") else str(ch.platform),
        tg_link=ch.tg_link,
        description=ch.description,
        max_chat_id=ch.max_chat_id,
        max_chat_link=ch.max_chat_link,
        max_bot_token_set=bool(ch.max_bot_token),
        created_at=ch.created_at,
    )


def _build_channel_with_stats(db: Session, ch: Channel) -> ChannelWithStats:
    last_sub = _last_subscriber_stat(db, ch.id)
    last_views = _last_views_stat(db, ch.id)
    ago = None
    if last_sub:
        target = last_sub.date - timedelta(days=30)
        candidate = _subscriber_stat_near_date(db, ch.id, target)
        if candidate and candidate.id != last_sub.id:
            ago = candidate
    base = _channel_response(ch)
    return ChannelWithStats(
        **base.model_dump(),
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
    raw_token = data.max_bot_token
    ch = Channel(
        name=data.name,
        platform=ChannelPlatform(data.platform),
        tg_link=data.tg_link or None,
        description=data.description or None,
        max_chat_link=data.max_chat_link or None,
        max_bot_token=_encrypt(raw_token) if raw_token and settings.fernet_key else None,
    )
    db.add(ch)
    db.commit()
    db.refresh(ch)
    log_action(db, current_user, "create", "channel", ch.id, f"Канал: {ch.name}")
    return _channel_response(ch)


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

    updates = data.model_dump(exclude_unset=True)
    for field, value in updates.items():
        if field == "platform":
            ch.platform = ChannelPlatform(value) if value else ch.platform
        elif field == "max_bot_token":
            if value and settings.fernet_key:
                ch.max_bot_token = _encrypt(value)
            elif value and not settings.fernet_key:
                raise HTTPException(status_code=500, detail="FERNET_KEY не настроен на сервере")
            # if value is None/empty, leave token unchanged
        else:
            setattr(ch, field, value)
    db.commit()
    db.refresh(ch)
    log_action(db, current_user, "update", "channel", ch.id, f"Канал: {ch.name} обновлён")
    return _channel_response(ch)


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


@router.post("/{channel_id}/sync", response_model=SyncResult)
async def sync_channel(
    channel_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(write_access),
):
    """Manually trigger a Max.ru subscriber + avg_views sync for a channel."""
    ch = db.query(Channel).filter(Channel.id == channel_id).first()
    if not ch:
        raise HTTPException(status_code=404, detail="Channel not found")

    platform = ch.platform.value if hasattr(ch.platform, "value") else str(ch.platform)
    if platform != "max":
        raise HTTPException(status_code=400, detail="Синхронизация доступна только для Max.ru каналов")
    if not ch.max_bot_token:
        raise HTTPException(status_code=400, detail="Bot token не задан для этого канала")
    if not settings.fernet_key:
        raise HTTPException(status_code=500, detail="FERNET_KEY не настроен на сервере")

    from ..services.max_parser import MaxParserService, MaxAuthError, MaxNotFoundError, MaxApiError

    try:
        raw_token = _decrypt(ch.max_bot_token)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Ошибка расшифровки токена: {e}")

    svc = MaxParserService(raw_token, base_url=settings.max_api_base_url)

    # Step 1: resolve chat_id if not cached
    chat_id = ch.max_chat_id
    if not chat_id and ch.max_chat_link:
        try:
            chat_id = await svc.resolve_chat_id(ch.max_chat_link)
            if chat_id:
                ch.max_chat_id = chat_id
                db.commit()
        except MaxAuthError as e:
            raise HTTPException(status_code=401, detail=str(e))
        except MaxApiError as e:
            raise HTTPException(status_code=502, detail=f"Ошибка Max API: {e}")

    if not chat_id:
        raise HTTPException(status_code=400, detail="chat_id не задан и не удалось получить из ссылки")

    try:
        # Step 2: GET /chats/{chat_id} → subscribers + posts_total
        info = await svc.get_chat_info(chat_id)
        subscribers = info["subscribers"]
        posts_total = info["posts_total"]

        # Step 3: GET /messages → avg_views_per_post
        avg_result = await svc.get_avg_views(
            chat_id,
            posts_total=posts_total,
            posts_limit=settings.max_posts_sample,
        )
    except MaxAuthError as e:
        raise HTTPException(status_code=401, detail=str(e))
    except MaxNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except MaxApiError as e:
        raise HTTPException(status_code=502, detail=f"Ошибка Max API: {e}")

    avg_views = avg_result["avg_views"] if avg_result else None
    posts_sampled = avg_result["posts_sampled"] if avg_result else None

    # Step 4: upsert ChannelStat for today with both subscribers + views
    today = date.today()
    existing = (
        db.query(ChannelStat)
        .filter(ChannelStat.channel_id == ch.id, ChannelStat.date == today)
        .first()
    )
    if existing:
        existing.subscribers_count = subscribers
        existing.avg_views_per_post = avg_views
        existing.posts_sampled = posts_sampled
    else:
        db.add(ChannelStat(
            channel_id=ch.id,
            date=today,
            subscribers_count=subscribers,
            avg_views_per_post=avg_views,
            posts_sampled=posts_sampled,
        ))
    db.commit()

    log_action(db, current_user, "update", "channel", ch.id,
               f"Синхронизация Max.ru: {subscribers} подписчиков, {avg_views} ср. просмотров ({posts_sampled} постов)")

    return SyncResult(
        subscribers=subscribers,
        avg_views=avg_views,
        posts_sampled=posts_sampled,
        posts_total=posts_total,
        synced_at=datetime.now(),
    )


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
