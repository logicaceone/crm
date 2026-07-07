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
    """Build per-channel rows from the two newest snapshots.

    Order in the final report: MAX channels first, then Telegram; within
    each platform, sorted by current subscriber count descending.
    """
    rows: list[_Row] = []
    channels = db.query(Channel).all()

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

    # MAX before TG; inside each platform, biggest channels first.
    _PLATFORM_ORDER = {"MAX": 0, "TG": 1}
    rows.sort(key=lambda r: (_PLATFORM_ORDER.get(r.platform, 99), -r.current_subs))
    return rows


def _format_row_block(r: _Row) -> str:
    prev_label = _fmt_int(r.previous_subs) if r.previous_subs is not None else "н/д"
    cur_label = _fmt_int(r.current_subs)
    return (
        f"[{r.name}]\n"
        f" — платформа: {r.platform}\n"
        f" — подписчиков было: {prev_label}\n"
        f" — подписчиков стало: {cur_label} ({_diff_str(r.diff)})"
    )


def format_report(rows: list[_Row], today: Optional[date] = None) -> str:
    """Single-message report — kept for the run-once manual trigger that
    returns a preview. format_report_chunks() is what send_report uses
    in practice."""
    today = today or date.today()
    header = today.strftime("%d.%m.%Y")
    if not rows:
        return f"{header}\n\nНет данных по каналам."

    parts = [header, ""]
    for r in rows:
        parts.append(_format_row_block(r))
        parts.append("")
    return "\n".join(parts).rstrip()


# Telegram caps sendMessage text at 4096 characters. Leave headroom so a
# stray emoji or unicode-quirk doesn't push us over the cliff.
TG_MAX_CHARS = 4000


def format_report_chunks(
    rows: list[_Row],
    today: Optional[date] = None,
    max_chars: int = TG_MAX_CHARS,
) -> list[str]:
    """Split the report across multiple messages, never cutting a
    channel block in half. First chunk carries the date header; later
    chunks get a 'Часть N/M' suffix appended at format time once the
    total is known.
    """
    today = today or date.today()
    header = today.strftime("%d.%m.%Y")
    if not rows:
        return [f"{header}\n\nНет данных по каналам."]

    blocks = [_format_row_block(r) for r in rows]

    chunks: list[list[str]] = []
    current: list[str] = []
    current_len = 0

    # Reserve some room in chunk 1 for the header line + part marker, in
    # later chunks for just the part marker.
    HEADER_RESERVE = len(header) + 32
    PART_RESERVE = 32

    def fits(block: str, reserve: int) -> bool:
        # +2 for the "\n\n" between blocks
        return current_len + len(block) + 2 + reserve <= max_chars

    is_first = True
    for block in blocks:
        reserve = HEADER_RESERVE if is_first and not chunks else PART_RESERVE
        if current and not fits(block, reserve):
            chunks.append(current)
            current = [block]
            current_len = len(block)
            is_first = False
        else:
            current.append(block)
            current_len += len(block) + 2
    if current:
        chunks.append(current)

    total = len(chunks)
    out: list[str] = []
    for i, group in enumerate(chunks, 1):
        body = "\n\n".join(group)
        parts: list[str] = []
        if i == 1:
            parts.append(header)
            parts.append("")
        if total > 1:
            parts.append(f"(часть {i}/{total})")
            parts.append("")
        parts.append(body)
        out.append("\n".join(parts).rstrip())
    return out


def _resolve_bot_token(db: Session) -> Optional[str]:
    # Settings UI stores telegram_bot_token in the DB; .env value is a
    # default. REPORT_BOT_TOKEN (env-only) overrides both, but only if
    # explicitly set — leaving it blank means "reuse the channel-sync
    # bot".
    if settings.report_bot_token:
        return settings.report_bot_token
    return get_setting(db, "telegram_bot_token", settings.telegram_bot_token)


async def _send_single(text: str, bot_token: str, chat_id: str) -> bool:
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
    return True


async def send_report(text_or_chunks, db: Session) -> bool:
    """Send the report — accepts either a single string (back-compat) or
    a list of chunks. Every chunk must succeed for the overall call to
    report True; on partial failure later chunks are still attempted so
    we don't sit on a half-sent report."""
    bot_token = _resolve_bot_token(db)
    chat_id = settings.report_chat_id
    if not bot_token or not chat_id:
        logger.warning(
            "Daily report skipped: bot_token=%s chat_id=%s",
            bool(bot_token), bool(chat_id),
        )
        return False

    chunks = [text_or_chunks] if isinstance(text_or_chunks, str) else list(text_or_chunks)
    ok = True
    for i, chunk in enumerate(chunks, 1):
        sent = await _send_single(chunk, bot_token, chat_id)
        if not sent:
            ok = False
            logger.warning("Daily report: chunk %d/%d failed", i, len(chunks))
        else:
            logger.info("Daily report chunk %d/%d sent (len=%d)", i, len(chunks), len(chunk))
    return ok


async def run_daily_report(db: Session) -> dict:
    """Build + send. Returns a small status dict for the manual trigger.

    The preview is the joined chunks so callers see the full report,
    even when the wire payload was split into multiple messages.
    """
    rows = get_report_data(db)
    chunks = format_report_chunks(rows)
    sent = await send_report(chunks, db)
    return {
        "sent": sent,
        "channels": len(rows),
        "chunks": len(chunks),
        "preview": "\n\n---\n\n".join(chunks),
    }
