import asyncio
import json
from datetime import date, datetime
from typing import Optional
import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from ..database import get_db
from ..models.user import User, UserRole
from ..models.channel import Channel, ChannelStat, ChannelPlatform
from ..models.purchase import AdPurchase
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
from ..utils.stats import get_latest_snapshot, get_baseline_30d_ago, update_left_count
from ..services.max_parser import canonical_chat_link, normalize_chat_link

router = APIRouter(prefix="/channels", tags=["channels"])


read_access = require_roles([UserRole.root, UserRole.admin, UserRole.manager, UserRole.viewer])
write_access = require_roles([UserRole.root, UserRole.admin, UserRole.manager])



def _last_views_stat(db: Session, channel_id: int) -> Optional[ChannelStat]:
    return (
        db.query(ChannelStat)
        .filter(ChannelStat.channel_id == channel_id, ChannelStat.avg_views_per_post.isnot(None))
        .order_by(ChannelStat.date.desc())
        .first()
    )


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
    all_subs = (
        db.query(ChannelStat)
        .filter(ChannelStat.channel_id == ch.id, ChannelStat.subscribers_count.isnot(None))
        .all()
    )
    last_sub = get_latest_snapshot(all_subs)
    ago = get_baseline_30d_ago(all_subs)
    last_views = _last_views_stat(db, ch.id)
    base = _channel_response(ch)
    return ChannelWithStats(
        **base.model_dump(),
        last_subscriber_stat=ChannelStatResponse.model_validate(last_sub) if last_sub else None,
        last_views_stat=ChannelStatResponse.model_validate(last_views) if last_views else None,
        stat_30d_ago=ChannelStatResponse.model_validate(ago) if ago else None,
    )


@router.get("/all")
def list_channels_all(
    db: Session = Depends(get_db),
    _: User = Depends(read_access),
):
    """Lightweight unpaginated list for dropdowns.

    Returns id/name/platform only — no snapshot joins, no
    pagination. Use this everywhere a dropdown needs to show every
    channel; reserve the main `GET /channels` for the Channels
    table.
    """
    channels = db.query(Channel).order_by(Channel.created_at).all()
    return [
        {
            "id": ch.id,
            "name": ch.name,
            "platform": ch.platform.value if hasattr(ch.platform, "value") else str(ch.platform),
        }
        for ch in channels
    ]


async def _sync_one_tg_channel(
    db: Session, ch: Channel, bot_token: str, today: date
) -> dict:
    """Pull subscriber_count from Telegram for one TG channel, upsert
    today's ChannelStat. Bot API does not expose avg views, so only
    subscribers_count is recorded."""
    chat_id = ch.tg_chat_id
    if not chat_id and ch.tg_link:
        from ..services.telegram_cpa import _extract_username
        username = _extract_username(ch.tg_link)
        if username:
            chat_id = f"@{username}"
    if not chat_id:
        return {"channel_id": ch.id, "name": ch.name, "status": "error",
                "error": "Не задан tg_chat_id и нет @username"}
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.get(
                f"https://api.telegram.org/bot{bot_token}/getChatMemberCount",
                params={"chat_id": chat_id},
            )
        data = r.json()
    except Exception as e:
        return {"channel_id": ch.id, "name": ch.name, "status": "error",
                "error": f"Network: {e}"}
    if not data.get("ok"):
        return {"channel_id": ch.id, "name": ch.name, "status": "error",
                "error": data.get("description", "Telegram error")}
    count = int(data["result"])
    existing = (
        db.query(ChannelStat)
        .filter(ChannelStat.channel_id == ch.id, ChannelStat.date == today)
        .first()
    )
    if existing:
        existing.subscribers_count = count
    else:
        db.add(ChannelStat(
            channel_id=ch.id, date=today,
            subscribers_count=count, avg_views_per_post=None,
        ))
    db.commit()
    update_left_count(db, ch.id)
    db.commit()
    return {"channel_id": ch.id, "name": ch.name, "status": "ok",
            "platform": "telegram", "subscribers": count}


async def _sync_one_max_channel(db: Session, ch: Channel, today: date) -> dict:
    """Pull subscribers + avg_views from Max.ru, upsert today's snapshot."""
    from ..services.max_parser import (
        MaxParserService, MaxAuthError, MaxNotFoundError, MaxApiError,
    )
    try:
        svc = MaxParserService(ch.max_bot_token, base_url=settings.max_api_base_url)
        chat_id = ch.max_chat_id
        if not chat_id and ch.max_chat_link:
            chat_id = await svc.resolve_chat_id(ch.max_chat_link)
            if chat_id:
                ch.max_chat_id = chat_id
                db.commit()
        if not chat_id:
            return {"channel_id": ch.id, "name": ch.name, "status": "error",
                    "error": "Не задан max_chat_id"}
        info = await svc.get_chat_info(chat_id)
        subscribers = info["subscribers"]
        if subscribers is None:
            return {"channel_id": ch.id, "name": ch.name, "status": "error",
                    "error": "Max API не вернул число подписчиков"}
        avg_result = await svc.get_avg_views(
            chat_id, posts_total=info["posts_total"],
            posts_limit=settings.max_posts_sample,
        )
        avg_views = avg_result["avg_views"] if avg_result else None
        posts_sampled = avg_result["posts_sampled"] if avg_result else None
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
                channel_id=ch.id, date=today,
                subscribers_count=subscribers,
                avg_views_per_post=avg_views,
                posts_sampled=posts_sampled,
            ))
        db.commit()
        update_left_count(db, ch.id)
        db.commit()
        return {"channel_id": ch.id, "name": ch.name, "status": "ok",
                "platform": "max", "subscribers": subscribers,
                "avg_views": avg_views}
    except MaxAuthError as e:
        return {"channel_id": ch.id, "name": ch.name, "status": "error",
                "error": f"Auth: {e}"}
    except MaxNotFoundError as e:
        return {"channel_id": ch.id, "name": ch.name, "status": "error",
                "error": f"Not found: {e}"}
    except MaxApiError as e:
        return {"channel_id": ch.id, "name": ch.name, "status": "error",
                "error": f"API: {e}"}
    except Exception as e:
        return {"channel_id": ch.id, "name": ch.name, "status": "error",
                "error": str(e)}


@router.post("/sync-all")
async def sync_all_channels(
    db: Session = Depends(get_db),
    current_user: User = Depends(write_access),
):
    """Sync every channel — TG (subscribers via getChatMemberCount) and
    Max (subscribers + avg_views via MaxParserService). Sequential, so we
    stay under Max's 30 rps. Per-channel failures don't abort the loop.
    """
    from ..db_settings import get_setting
    today = date.today()
    tg_token = get_setting(db, "telegram_bot_token", settings.telegram_bot_token)
    channels = db.query(Channel).order_by(Channel.created_at).all()
    results = []
    synced = 0
    failed = 0
    for ch in channels:
        platform = ch.platform.value if hasattr(ch.platform, "value") else str(ch.platform)
        try:
            if platform == "telegram":
                if not tg_token:
                    result = {"channel_id": ch.id, "name": ch.name,
                              "status": "error",
                              "error": "Telegram Bot Token не задан в настройках"}
                else:
                    result = await _sync_one_tg_channel(db, ch, tg_token, today)
            elif platform == "max":
                if not ch.max_bot_token:
                    result = {"channel_id": ch.id, "name": ch.name,
                              "status": "error",
                              "error": "Max бот-токен не задан"}
                else:
                    result = await _sync_one_max_channel(db, ch, today)
            else:
                result = {"channel_id": ch.id, "name": ch.name,
                          "status": "error",
                          "error": f"Unsupported platform: {platform}"}
        except Exception as e:
            db.rollback()
            result = {"channel_id": ch.id, "name": ch.name,
                      "status": "error", "error": str(e)}
        results.append(result)
        if result.get("status") == "ok":
            synced += 1
        else:
            failed += 1
    log_action(db, current_user, "update", "channel", None,
               f"Массовая синхронизация: {synced} OK, {failed} ошибок")
    return {"synced": synced, "failed": failed, "results": results}


@router.get("/sync-all/stream")
async def sync_all_channels_stream(
    db: Session = Depends(get_db),
    current_user: User = Depends(write_access),
):
    """Same as POST /channels/sync-all, but streams per-channel results
    over Server-Sent Events so the UI can show progress in real time.

    Each event payload is JSON:
      { index, total, channel_id, name, status, subscribers?, error? }
    A final event includes `done: true` plus aggregate counters.
    """
    from ..db_settings import get_setting
    today = date.today()
    tg_token = get_setting(db, "telegram_bot_token", settings.telegram_bot_token)
    channels = db.query(Channel).order_by(Channel.created_at).all()
    total = len(channels)

    async def event_gen():
        synced = 0
        failed = 0
        for i, ch in enumerate(channels, 1):
            platform = ch.platform.value if hasattr(ch.platform, "value") else str(ch.platform)
            try:
                if platform == "telegram":
                    if not tg_token:
                        result = {
                            "channel_id": ch.id, "name": ch.name,
                            "status": "error",
                            "error": "Telegram Bot Token не задан в настройках",
                        }
                    else:
                        result = await _sync_one_tg_channel(db, ch, tg_token, today)
                elif platform == "max":
                    if not ch.max_bot_token:
                        result = {
                            "channel_id": ch.id, "name": ch.name,
                            "status": "error",
                            "error": "Max бот-токен не задан",
                        }
                    else:
                        result = await _sync_one_max_channel(db, ch, today)
                else:
                    result = {
                        "channel_id": ch.id, "name": ch.name,
                        "status": "error",
                        "error": f"Unsupported platform: {platform}",
                    }
            except Exception as e:
                db.rollback()
                result = {
                    "channel_id": ch.id, "name": ch.name,
                    "status": "error", "error": str(e),
                }

            if result.get("status") == "ok":
                synced += 1
            else:
                failed += 1

            payload = {"index": i, "total": total, **result}
            yield f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"
            await asyncio.sleep(0)  # yield to the event loop

        log_action(
            db, current_user, "update", "channel", None,
            f"Массовая синхронизация (stream): {synced} OK, {failed} ошибок",
        )
        yield (
            "data: "
            + json.dumps(
                {"done": True, "synced": synced, "failed": failed, "total": total},
                ensure_ascii=False,
            )
            + "\n\n"
        )

    return StreamingResponse(
        event_gen(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            # Disable nginx response buffering for this stream so events
            # flow client-side as soon as they're yielded.
            "X-Accel-Buffering": "no",
        },
    )


@router.get("")
def list_channels(
    page: Optional[int] = None,
    per_page: int = Query(default=15, ge=1, le=100),
    db: Session = Depends(get_db),
    _: User = Depends(read_access),
):
    q = db.query(Channel).order_by(Channel.created_at)
    if page is None:
        return [_build_channel_with_stats(db, ch) for ch in q.all()]
    total = q.count()
    total_pages = max(1, (total + per_page - 1) // per_page)
    page = max(1, min(page, total_pages))
    items = q.offset((page - 1) * per_page).limit(per_page).all()
    return {
        "items": [_build_channel_with_stats(db, ch) for ch in items],
        "pagination": {"page": page, "per_page": per_page, "total": total, "total_pages": total_pages},
    }


@router.post("", response_model=ChannelResponse, status_code=201)
def create_channel(
    data: CreateChannelRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(write_access),
):
    max_link_in = (data.max_chat_link or "").strip()
    if max_link_in and normalize_chat_link(max_link_in) == "":
        raise HTTPException(status_code=400, detail="Invalid Max.ru channel link format")
    ch = Channel(
        name=data.name,
        platform=ChannelPlatform(data.platform),
        tg_link=data.tg_link or None,
        tg_chat_id=data.tg_chat_id or None,
        description=data.description or None,
        max_chat_id=data.max_chat_id or None,
        max_chat_link=canonical_chat_link(max_link_in) if max_link_in else None,
        max_bot_token=data.max_bot_token or None,
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

    # `exclude_unset=True` keeps only fields the client actually sent,
    # so explicit null (clear) and missing (no change) stay distinguishable.
    updates = data.model_dump(exclude_unset=True)
    for field, value in updates.items():
        if field == "platform":
            ch.platform = ChannelPlatform(value) if value else ch.platform
        elif field == "max_chat_link":
            # Empty / null clears. Non-empty is normalized to the canonical
            # `https://max.ru/{name}` form so the stored value is always a
            # working URL the UI can render as an <a href>.
            link_in = (value or "").strip()
            if link_in and normalize_chat_link(link_in) == "":
                raise HTTPException(status_code=400, detail="Invalid Max.ru channel link format")
            ch.max_chat_link = canonical_chat_link(link_in) if link_in else None
        elif field in ("max_bot_token", "tg_link", "description"):
            # Empty string and null both mean "clear the field".
            setattr(ch, field, value or None)
        elif field == "max_chat_id":
            ch.max_chat_id = value  # allow explicit set/clear
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

    from ..services.max_parser import MaxParserService, MaxAuthError, MaxNotFoundError, MaxApiError
    from ..db_settings import get_setting as _gs

    base_url = _gs(db, "max_api_base_url") or settings.max_api_base_url
    posts_limit_raw = _gs(db, "max_posts_sample")
    posts_limit = int(posts_limit_raw) if posts_limit_raw else settings.max_posts_sample

    svc = MaxParserService(ch.max_bot_token, base_url=base_url)

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
            posts_limit=posts_limit,
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

    # Update left_count for purchases linked to this channel
    update_left_count(db, ch.id)
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
    existing = (
        db.query(ChannelStat)
        .filter(ChannelStat.channel_id == channel_id, ChannelStat.date == data.date)
        .first()
    )
    if existing:
        # Update only the field this endpoint owns; leave subscribers_count
        # (filled by the platform sync) alone.
        existing.avg_views_per_post = data.avg_views_per_post
        stat = existing
        action = "update"
    else:
        stat = ChannelStat(
            channel_id=channel_id,
            date=data.date,
            avg_views_per_post=data.avg_views_per_post,
            subscribers_count=None,
        )
        db.add(stat)
        action = "create"
    db.commit()
    db.refresh(stat)
    log_action(db, current_user, action, "channel_stat", stat.id,
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
