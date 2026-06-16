import logging
from datetime import date

import httpx
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

from .config import settings
from .database import SessionLocal
from .models.channel import Channel, ChannelStat

logger = logging.getLogger(__name__)

scheduler = AsyncIOScheduler()


def _extract_username(tg_link: str) -> str | None:
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
        logger.warning("TELEGRAM_BOT_TOKEN not set, skipping subscriber sync")
        return

    db = SessionLocal()
    today = date.today()
    synced = 0
    failed = 0

    try:
        channels = db.query(Channel).filter(Channel.tg_link.isnot(None)).all()
        async with httpx.AsyncClient(timeout=15) as client:
            for ch in channels:
                username = _extract_username(ch.tg_link)
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

                    # upsert: one bot-record per channel per day
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
                    logger.info("Synced @%s: %d subscribers", username, count)
                except Exception as exc:
                    logger.error("Failed to sync @%s: %s", username, exc)
                    failed += 1
    finally:
        db.close()

    logger.info("Subscriber sync done: %d synced, %d failed", synced, failed)


def start_scheduler() -> None:
    # 23:58 GMT+3 = 20:58 UTC
    scheduler.add_job(
        sync_subscriber_counts,
        CronTrigger(hour=20, minute=58, timezone="UTC"),
        id="sync_subscribers",
        replace_existing=True,
    )
    scheduler.start()
    logger.info("Scheduler started (subscriber sync at 23:58 GMT+3)")


def stop_scheduler() -> None:
    scheduler.shutdown(wait=False)
