import logging
from datetime import date

import httpx
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

from .config import settings
from .database import SessionLocal
from .models.channel import Channel, ChannelStat, ChannelPlatform

logger = logging.getLogger(__name__)

scheduler = AsyncIOScheduler()


def _extract_tg_username(tg_link: str) -> str | None:
    link = tg_link.strip()
    if link.startswith("https://t.me/"):
        part = link[len("https://t.me/"):].split("/")[0].split("?")[0]
        return part if part else None
    if link.startswith("http://t.me/"):
        part = link[len("http://t.me/"):].split("/")[0].split("?")[0]
        return part if part else None
    if link.startswith("@"):
        return link[1:] or None
    return link if link else None


async def sync_subscriber_counts() -> None:
    if not settings.telegram_bot_token:
        logger.warning("TELEGRAM_BOT_TOKEN not set, skipping TG subscriber sync")
        return

    db = SessionLocal()
    today = date.today()
    synced = 0
    failed = 0

    try:
        channels = db.query(Channel).filter(
            Channel.tg_link.isnot(None),
            Channel.platform == ChannelPlatform.telegram,
        ).all()
        async with httpx.AsyncClient(timeout=15) as client:
            for ch in channels:
                username = _extract_tg_username(ch.tg_link)
                if not username:
                    continue
                try:
                    r = await client.get(
                        f"https://api.telegram.org/bot{settings.telegram_bot_token}/getChatMemberCount",
                        params={"chat_id": f"@{username}"},
                    )
                    data = r.json()
                    if not data.get("ok"):
                        logger.warning("TG API error for %s: %s", username, data.get("description"))
                        failed += 1
                        continue

                    count: int = data["result"]

                    existing = (
                        db.query(ChannelStat)
                        .filter(
                            ChannelStat.channel_id == ch.id,
                            ChannelStat.date == today,
                            ChannelStat.avg_views_per_post.is_(None),
                        )
                        .first()
                    )
                    if existing:
                        existing.subscribers_count = count
                    else:
                        db.add(ChannelStat(
                            channel_id=ch.id,
                            date=today,
                            subscribers_count=count,
                            avg_views_per_post=None,
                        ))
                    db.commit()
                    synced += 1
                    print(f"[TG] Synced @{username}: {count} subscribers", flush=True)
                except Exception as exc:
                    print(f"[TG] Failed to sync @{username}: {exc}", flush=True)
                    failed += 1
    finally:
        db.close()

    print(f"[TG] Sync done: {synced} synced, {failed} failed", flush=True)


async def sync_max_channels() -> None:
    if not settings.fernet_key:
        logger.warning("FERNET_KEY not set, skipping Max.ru subscriber sync")
        return

    from .services.max_parser import MaxParserService, MaxAuthError, MaxNotFoundError, MaxApiError
    from .crypto import decrypt_token

    db = SessionLocal()
    today = date.today()
    synced = 0
    failed = 0

    try:
        channels = db.query(Channel).filter(
            Channel.platform == ChannelPlatform.max,
            Channel.max_bot_token.isnot(None),
        ).all()

        for ch in channels:
            try:
                raw_token = decrypt_token(ch.max_bot_token)
                svc = MaxParserService(raw_token, base_url=settings.max_api_base_url)

                chat_id = ch.max_chat_id
                if not chat_id and ch.max_chat_link:
                    chat_id = await svc.resolve_chat_id(ch.max_chat_link)
                    if chat_id:
                        ch.max_chat_id = chat_id
                        db.commit()

                if not chat_id:
                    print(f"[MAX] No chat_id for channel {ch.name}, skipping", flush=True)
                    failed += 1
                    continue

                subscribers = await svc.get_subscribers(chat_id)
                if subscribers is None:
                    print(f"[MAX] No subscriber count returned for {ch.name}", flush=True)
                    failed += 1
                    continue

                existing = (
                    db.query(ChannelStat)
                    .filter(
                        ChannelStat.channel_id == ch.id,
                        ChannelStat.date == today,
                        ChannelStat.avg_views_per_post.is_(None),
                    )
                    .first()
                )
                if existing:
                    existing.subscribers_count = subscribers
                else:
                    db.add(ChannelStat(
                        channel_id=ch.id,
                        date=today,
                        subscribers_count=subscribers,
                        avg_views_per_post=None,
                    ))
                db.commit()
                synced += 1
                print(f"[MAX] Synced {ch.name}: {subscribers} subscribers", flush=True)

            except (MaxAuthError, MaxNotFoundError) as exc:
                print(f"[MAX] Skipping {ch.name}: {exc}", flush=True)
                failed += 1
            except MaxApiError as exc:
                print(f"[MAX] API error for {ch.name}: {exc}", flush=True)
                failed += 1
            except Exception as exc:
                print(f"[MAX] Unexpected error for {ch.name}: {exc}", flush=True)
                failed += 1
    finally:
        db.close()

    print(f"[MAX] Sync done: {synced} synced, {failed} failed", flush=True)


def start_scheduler() -> None:
    # 23:58 GMT+3 = 20:58 UTC
    scheduler.add_job(
        sync_subscriber_counts,
        CronTrigger(hour=20, minute=58, timezone="UTC"),
        id="sync_tg_subscribers",
        replace_existing=True,
    )
    # Max.ru sync every 24h at 00:00 GMT+3 = 21:00 UTC
    scheduler.add_job(
        sync_max_channels,
        CronTrigger(hour=21, minute=0, timezone="UTC"),
        id="sync_max_subscribers",
        replace_existing=True,
    )
    scheduler.start()
    print("[Scheduler] Started — TG sync 23:58 GMT+3, MAX sync 00:00 GMT+3", flush=True)


def stop_scheduler() -> None:
    scheduler.shutdown(wait=False)
