from datetime import date, timedelta
from typing import Iterable, Optional

from sqlalchemy.orm import Session

from ..models.channel import ChannelStat
from ..models.purchase import AdPurchase


def _valid_snapshots(snapshots: Iterable[ChannelStat]) -> list[ChannelStat]:
    return [s for s in snapshots if s.subscribers_count is not None]


def get_latest_snapshot(snapshots: Iterable[ChannelStat]) -> Optional[ChannelStat]:
    """Return the most recent snapshot with a non-null subscribers_count."""
    valid = _valid_snapshots(snapshots)
    if not valid:
        return None
    return max(valid, key=lambda s: s.date)


def get_baseline_30d_ago(snapshots: Iterable[ChannelStat]) -> Optional[ChannelStat]:
    """Return the snapshot nearest to 30 days ago (nearest neighbour).

    Returns None when fewer than 2 valid snapshots exist or the nearest
    neighbour coincides with the latest snapshot (i.e. no history).
    """
    valid = _valid_snapshots(snapshots)
    if len(valid) < 2:
        return None
    sorted_snaps = sorted(valid, key=lambda s: s.date, reverse=True)
    latest = sorted_snaps[0]
    target_date = date.today() - timedelta(days=30)
    candidates = [s for s in sorted_snaps if s.date <= latest.date and s is not latest]
    if not candidates:
        return None
    return min(candidates, key=lambda s: abs((s.date - target_date).days))


def update_left_count(db: Session, channel_id: int) -> None:
    """Distribute subscriber loss between the last two snapshots equally
    across active purchases (joined_count > 0).

    Telegram does not report which invite link a leaver came through, so
    per-purchase left_count is always an approximation. Equal division
    is the least biased; the integer remainder is dropped on the floor.

    Safe to call repeatedly — only acts on the gap between the two most
    recent snapshots, so a same-day double-sync does not double-count.
    """
    last_two = (
        db.query(ChannelStat)
        .filter(ChannelStat.channel_id == channel_id, ChannelStat.subscribers_count.isnot(None))
        .order_by(ChannelStat.date.desc())
        .limit(2)
        .all()
    )
    if len(last_two) < 2:
        return
    loss = max(0, last_two[1].subscribers_count - last_two[0].subscribers_count)
    if loss == 0:
        return
    purchases = (
        db.query(AdPurchase)
        .filter(AdPurchase.channel_id == channel_id, AdPurchase.joined_count > 0)
        .all()
    )
    if not purchases:
        return
    per = loss // len(purchases)
    if per == 0:
        return
    for p in purchases:
        p.left_count += per


def get_growth_30d(snapshots: Iterable[ChannelStat]) -> Optional[int]:
    """Subscriber growth over the last 30 days (latest − baseline).

    Single source of truth for "+/- за 30д" — both the channels list
    and the dashboard call this so the same channel always shows the
    same number.
    """
    latest = get_latest_snapshot(snapshots)
    baseline = get_baseline_30d_ago(snapshots)
    if latest is None or baseline is None:
        return None
    return latest.subscribers_count - baseline.subscribers_count
