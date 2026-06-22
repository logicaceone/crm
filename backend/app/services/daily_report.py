"""Daily subscriber-delta report posted to a Telegram group.

The report compares the two most recent ChannelStat snapshots per
channel (current vs. previous) — that's whatever the channel sync
last wrote, not strictly "today vs. yesterday", so a channel that
hasn't been synced for a week still gets a meaningful before/after.

If REPORT_BOT_TOKEN is not configured we fall back to the existing
TELEGRAM_BOT_TOKEN (channel sync uses the same one). When neither
token nor chat id is set, send_report logs a warning and exits — the
scheduler keeps running other jobs.
"""
import logging
from dataclasses import dataclass
from datetime import date
from typing import Optional

import httpx
from sqlalchemy.orm import Session

from ..config import settings
from ..db_settings import get_setting
from ..models.channel import Channel, ChannelPlatform, ChannelStat

logger = logging.getLogger(__name__)


@dataclass
class _Row:
    name: str
    platform: str  # "TG" or "MAX"
    previous_subs: Optional[int]
    current_subs: int
    diff: Optional[int]


def _fmt_int(n: int) -> str:
    # Non-breaking-thin spaces would be nicer in TG, but a regular
    # space renders fine and copies cleanly. 22800 → "22 800".
    return f"{n:,}".replace(",", " ")


def _diff_str(diff: Optional[int]) -> str:
    if diff is None:
        return "н/д"
    if diff > 0:
        return f"+{_fmt_int(diff)}"
    if diff < 0:
        # _fmt_int handles the minus from the int formatter already
        return _fmt_int(diff)
    return "0"


def get_report_data(db: Session) -> list[_Row]:
    """Build per-channel rows from the two newest snapshots."""
    rows: list[_Row] = []
    channels = db.query(Channel).order_by(Channel.name).all()

    for ch in channels:
        # Skip snapshots where subscribers_count is NULL — those rows
        # exist (e.g. avg_views-only writes) but don't carry a count.
        stats = (
            db.query(ChannelStat)
            .filter(
                ChannelStat.channel_id == ch.id,
                ChannelStat.subscribers_count.isnot(None),
            )
            .order_by(ChannelStat.date.desc())
            .limit(2)
            .all()
        )
        if not stats:
            continue

        current = stats[0]
        previous = stats[1] if len(stats) > 1 else None
        cur_subs = int(current.subscribers_count)
        prev_subs = int(previous.subscribers_count) if previous else None
        diff = cur_subs - prev_subs if prev_subs is not None else None

        platform_label = (
            "MAX" if ch.platform == ChannelPlatform.max else "TG"
        )
        rows.append(_Row(
            name=ch.name,
            platform=platform_label,
            previous_subs=prev_subs,
            current_subs=cur_subs,
            diff=diff,
        ))

    return rows


def format_report(rows: list[_Row], today: Optional[date] = None) -> str:
    today = today or date.today()
    header = today.strftime("%d.%m.%Y")
    if not rows:
        return f"{header}\n\nНет данных по каналам."

    lines = [header, ""]
    for r in rows:
        lines.append(f"[{r.name}]")
        lines.append(f" — платформа: {r.platform}")
        prev_label = _fmt_int(r.previous_subs) if r.previous_subs is not None else "н/д"
        lines.append(f" — подписчиков было: {prev_label}")
        cur_label = _fmt_int(r.current_subs)
        lines.append(f" — подписчиков стало: {cur_label} ({_diff_str(r.diff)})")
        lines.append("")
    return "\n".join(lines).rstrip()


def _resolve_bot_token(db: Session) -> Optional[str]:
    # Settings UI stores telegram_bot_token in the DB; .env value is a
    # default. REPORT_BOT_TOKEN (env-only) overrides both, but only if
    # explicitly set — leaving it blank means "reuse the channel-sync
    # bot".
    if settings.report_bot_token:
        return settings.report_bot_token
    return get_setting(db, "telegram_bot_token", settings.telegram_bot_token)


async def send_report(text: str, db: Session) -> bool:
    bot_token = _resolve_bot_token(db)
    chat_id = settings.report_chat_id
    if not bot_token or not chat_id:
        logger.warning(
            "Daily report skipped: bot_token=%s chat_id=%s",
            bool(bot_token), bool(chat_id),
        )
        return False

    url = f"https://api.telegram.org/bot{bot_token}/sendMessage"
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.post(
                url,
                json={
                    "chat_id": chat_id,
                    "text": text,
                    # Plain text — channel names may contain Markdown/HTML
                    # special chars. Skip parse_mode to avoid escape pain.
                    "disable_web_page_preview": True,
                },
            )
    except Exception as exc:
        logger.error("Daily report send failed (network): %s", exc)
        return False

    if r.status_code != 200 or not r.json().get("ok"):
        logger.error(
            "Daily report send failed: status=%s body=%s",
            r.status_code, r.text[:500],
        )
        return False
    logger.info("Daily report sent (chat_id=%s, len=%d)", chat_id, len(text))
    return True


async def run_daily_report(db: Session) -> dict:
    """Build + send. Returns a small status dict for the manual trigger."""
    rows = get_report_data(db)
    text = format_report(rows)
    sent = await send_report(text, db)
    return {"sent": sent, "channels": len(rows), "preview": text}
