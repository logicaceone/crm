import logging
from datetime import date

import httpx
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

from .config import settings
from .database import SessionLocal
from .models.channel import Channel, ChannelStat, ChannelPlatform
from .utils.stats import update_left_count

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
    from .db_settings import get_setting

    db = SessionLocal()
    bot_token = get_setting(db, "telegram_bot_token", settings.telegram_bot_token)
    if not bot_token:
        db.close()
        logger.warning("TELEGRAM_BOT_TOKEN not set, skipping TG subscriber sync")
        return

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
                        f"https://api.telegram.org/bot{bot_token}/getChatMemberCount",
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
                    # Propagate any subscriber drop into per-purchase left_count.
                    update_left_count(db, ch.id)
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
    from .services.max_parser import MaxParserService, MaxAuthError, MaxNotFoundError, MaxApiError

    db = SessionLocal()
    today = date.today()
    synced = 0
    failed = 0
    skipped_empty = 0

    try:
        channels = db.query(Channel).filter(
            Channel.platform == ChannelPlatform.max,
            Channel.max_bot_token.isnot(None),
        ).all()

        for ch in channels:
            try:
                svc = MaxParserService(ch.max_bot_token, base_url=settings.max_api_base_url)

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

                # Two requests: chat info (subscribers + posts_total) + messages (avg_views)
                info = await svc.get_chat_info(chat_id)
                subscribers = info["subscribers"]
                if subscribers is None:
                    print(f"[MAX] No subscriber count returned for {ch.name}", flush=True)
                    failed += 1
                    continue

                posts_total = info["posts_total"]
                if posts_total == 0:
                    skipped_empty += 1

                avg_result = await svc.get_avg_views(
                    chat_id,
                    posts_total=posts_total,
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
                        channel_id=ch.id,
                        date=today,
                        subscribers_count=subscribers,
                        avg_views_per_post=avg_views,
                        posts_sampled=posts_sampled,
                    ))
                db.commit()
                # Propagate any subscriber drop into per-purchase left_count.
                update_left_count(db, ch.id)
                db.commit()
                synced += 1
                print(f"[MAX] Synced {ch.name}: {subscribers} subs, {avg_views} avg_views ({posts_sampled} posts)", flush=True)

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

    print(
        f"[MAX] Sync done: {synced} synced, "
        f"{skipped_empty} with no posts, {failed} failed",
        flush=True,
    )


async def _daily_report_job() -> None:
    """Wrapper that owns its own DB session — the scheduler can't be
    given a Depends-style session, and a per-job session keeps the
    transaction scoped to one run.

    Failures here MUST NOT propagate or the APScheduler job's next
    fire is at risk; we log loud and swallow.
    """
    from .services.daily_report import run_daily_report
    from .db_settings import get_setting
    db = SessionLocal()
    try:
        # Toggle is "1"/"0" in system_settings; default = enabled.
        # The cron stays scheduled regardless of the flag so flipping
        # the toggle takes effect on the next day's run without a restart.
        if get_setting(db, "daily_report_enabled", "1") == "0":
            print("[Scheduler] Daily report toggle is OFF — skipping", flush=True)
            return
        await run_daily_report(db)
    except Exception as exc:
        logger.exception("Daily report job failed: %s", exc)
    finally:
        db.close()


async def sync_all_channels(job_id: str = "manual") -> None:
    """Run TG + MAX sync back-to-back in one job.

    APScheduler fires this twice a day (00:00 and 23:50 MSK). Both
    underlying functions own their own DB session and swallow
    per-channel errors, so a single failing channel doesn't abort
    the run. We don't wrap them in another try/except — let surprises
    surface in logs.
    """
    print(f"[Scheduler] Channel sync started — job={job_id}", flush=True)
    await sync_subscriber_counts()
    await sync_max_channels()
    print(f"[Scheduler] Channel sync finished — job={job_id}", flush=True)


def start_scheduler() -> None:
    # Two combined TG+MAX syncs per day, in Europe/Moscow time:
    #   00:00 — snapshot for the start of the new day
    #   23:50 — snapshot just before the 23:55 daily report runs
    # The daily report compares the two newest snapshots, so the
    # 23:50 run guarantees a fresh "стало" value for that evening's
    # report.
    scheduler.add_job(
        sync_all_channels,
        CronTrigger(hour=0, minute=0, timezone="Europe/Moscow"),
        id="channel_sync_midnight",
        replace_existing=True,
        kwargs={"job_id": "channel_sync_midnight"},
    )
    scheduler.add_job(
        sync_all_channels,
        CronTrigger(hour=23, minute=50, timezone="Europe/Moscow"),
        id="channel_sync_evening",
        replace_existing=True,
        kwargs={"job_id": "channel_sync_evening"},
    )
    # Daily report at 23:55 in report_timezone (default Europe/Moscow).
    # The 23:50 channel-sync above writes today's "стало" snapshot,
    # which this job then compares against yesterday's 23:50 snapshot.
    scheduler.add_job(
        _daily_report_job,
        CronTrigger(hour=23, minute=55, timezone=settings.report_timezone),
        id="daily_report",
        replace_existing=True,
    )
    scheduler.start()
    print(
        "[Scheduler] Started — channel sync 00:00 + 23:50 MSK, "
        f"daily report 23:55 {settings.report_timezone}",
        flush=True,
    )


def stop_scheduler() -> None:
    scheduler.shutdown(wait=False)
