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
    from .db_settings import get_setting

    db = SessionLocal()
    today = date.today()
    synced = 0
    failed = 0
    skipped_empty = 0

    try:
        bot_token = get_setting(db, "max_bot_token")
        if not bot_token:
            print("[MAX] Max Bot Token not set in system_settings — skipping sync", flush=True)
            return
        channels = db.query(Channel).filter(
            Channel.platform == ChannelPlatform.max,
        ).all()

        for ch in channels:
            try:
                svc = MaxParserService(bot_token, base_url=settings.max_api_base_url)

                chat_id = ch.max_chat_id
                if not chat_id and ch.max_chat_link:
                    chat_id = await svc.resolve_chat_id(ch.max_chat_link, channel_name=ch.name)
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


async def _sales_sheets_sync_job() -> None:
    """Hourly pull from Sales Google Sheets."""
    if not settings.sales_sheets_sync_enabled:
        return
    from .services.sales_sheets_sync import sync_all_sales_sources
    db = SessionLocal()
    try:
        results = await sync_all_sales_sources(db)
        for r in results:
            print(
                f"[Sales Sheets] {r.get('source')}: "
                f"created={r.get('created')} skipped={r.get('skipped')} "
                f"errors={r.get('errors')}",
                flush=True,
            )
    except Exception as exc:
        logger.exception("Sales sheets sync job failed: %s", exc)
    finally:
        db.close()


async def _sheets_sync_job() -> None:
    """Hourly pull from Google Sheets — wraps sync_all_sources in its own
    DB session. Gated by settings.sheets_sync_enabled so the toggle in
    .env takes effect on next fire without code changes."""
    if not settings.sheets_sync_enabled:
        return
    from .services.sheets_sync import sync_all_sources
    db = SessionLocal()
    try:
        results = await sync_all_sources(db)
        for r in results:
            print(
                f"[Sheets] {r.get('source')}: "
                f"created={r.get('created')} skipped={r.get('skipped')} "
                f"errors={r.get('errors')}",
                flush=True,
            )
    except Exception as exc:
        logger.exception("Sheets sync job failed: %s", exc)
    finally:
        db.close()


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


async def _backup_job() -> None:
    """Wrapper: own its DB session, swallow exceptions so a bad
    backup doesn't take the whole scheduler down. The service itself
    already logs and notifies on failure."""
    from .services.backup import run_backup
    db = SessionLocal()
    try:
        result = await run_backup(db)
        logger.info("Backup job result: %s", result)
    except Exception as exc:
        logger.exception("Backup job crashed: %s", exc)
    finally:
        db.close()


async def _maxdash_cache_job() -> None:
    """Refresh the default MaxDash competitors view in advance.

    Catches its own exceptions so a bad day for MaxDash doesn't take
    the scheduler down with it. If the token isn't set the service
    just logs and returns None.
    """
    from .services.maxdash import refresh_default_cache
    db = SessionLocal()
    try:
        await refresh_default_cache(db)
    except Exception as exc:
        logger.exception("MaxDash cache refresh failed: %s", exc)
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
    # Sheets sync — every hour at minute 7 (avoids overlap with on-the-hour
    # jobs). The job itself bails out early when sheets_sync_enabled is
    # false, but the cron stays registered so the toggle is hot.
    from apscheduler.triggers.cron import CronTrigger as _CT
    scheduler.add_job(
        _sheets_sync_job,
        _CT(minute=7),
        id="sheets_sync_hourly",
        replace_existing=True,
    )
    # Sales sheets sync — offset to :17 so we don't pile both csv fetches
    # onto the same minute.
    scheduler.add_job(
        _sales_sheets_sync_job,
        _CT(minute=17),
        id="sales_sheets_sync_hourly",
        replace_existing=True,
    )
    # MaxDash competitors cache — refresh the default Tatar+News view
    # at 04:00 MSK so when somebody opens /competitors during business
    # hours the data is at most ~6h old without an extra API call.
    scheduler.add_job(
        _maxdash_cache_job,
        CronTrigger(hour=4, minute=0, timezone="Europe/Moscow"),
        id="maxdash_cache_refresh",
        replace_existing=True,
    )
    # Nightly DB backup at 03:00 MSK — before the channel sync and
    # daily report so the dump captures yesterday's state cleanly.
    scheduler.add_job(
        _backup_job,
        CronTrigger(hour=3, minute=0, timezone="Europe/Moscow"),
        id="db_backup",
        replace_existing=True,
    )
    scheduler.start()
    print(
        "[Scheduler] Started — channel sync 00:00 + 23:50 MSK, "
        f"daily report 23:55 {settings.report_timezone}, "
        "sheets at :07, sales sheets at :17, maxdash cache at 04:00 MSK, "
        "db backup at 03:00 MSK",
        flush=True,
    )


def stop_scheduler() -> None:
    scheduler.shutdown(wait=False)
