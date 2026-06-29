"""One-shot backfill for expenses.city on subscribers rows."""
from __future__ import annotations

import argparse
import sys
from collections import Counter

from sqlalchemy.orm import Session

from ..database import SessionLocal
from ..models.expense import Expense, ExpenseCategory
from ..services.city_normalizer import normalize_cities


SEPARATOR = " — "
BATCH_SIZE = 100


def _parse_comment(comment: str | None) -> tuple[str | None, str | None]:
    if comment is None:
        return None, None
    text = comment.strip()
    if not text:
        return None, None

    if SEPARATOR in text:
        left, _, right = text.partition(SEPARATOR)
        raw_city = left.strip() or None
        about = right.strip() or None
        return raw_city, about

    cities, leftover = normalize_cities(text)
    if cities and not leftover:
        return text, None

    return None, text


def run(apply: bool, limit: int | None) -> int:
    session: Session = SessionLocal()
    examined = 0
    skipped_already_set = 0
    updated = 0
    comment_cleared = 0
    unrecognized = 0

    city_counts: Counter[str] = Counter()
    unrecognized_raws: list[str] = []
    seen_unrecognized: set[str] = set()

    try:
        query = (
            session.query(Expense)
            .filter(Expense.category == ExpenseCategory.subscribers)
            .order_by(Expense.id.asc())
        )
        if limit is not None:
            query = query.limit(limit)

        batch_pending = 0
        for expense in query.yield_per(BATCH_SIZE):
            examined += 1

            if expense.city is not None:
                skipped_already_set += 1
                continue

            raw_city, about = _parse_comment(expense.comment)
            cities, _leftover = normalize_cities(raw_city)

            if cities:
                old_comment = expense.comment
                new_comment = about if about else None
                if not apply:
                    print(
                        f"[dry-run] id={expense.id} city={cities!r} "
                        f"comment: {old_comment!r} -> {new_comment!r}"
                    )
                expense.city = cities
                expense.comment = new_comment
                updated += 1
                for c in cities:
                    city_counts[c] += 1
                if new_comment is None and old_comment is not None:
                    comment_cleared += 1
                batch_pending += 1
            else:
                if raw_city is not None:
                    unrecognized += 1
                    key = raw_city.strip()
                    if key and key not in seen_unrecognized:
                        seen_unrecognized.add(key)
                        unrecognized_raws.append(key)
                else:
                    unrecognized += 1

            if apply and batch_pending >= BATCH_SIZE:
                session.commit()
                batch_pending = 0

        if apply and batch_pending > 0:
            session.commit()
        elif not apply:
            session.rollback()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()

    mode = "APPLY" if apply else "DRY-RUN"
    print()
    print(f"=== Backfill report ({mode}) ===")
    print(f"Total subscribers rows examined: {examined}")
    print(f"Rows with city already set (skipped): {skipped_already_set}")
    print(f"Rows updated (city set): {updated}")
    print(f"Rows where comment now becomes NULL: {comment_cleared}")
    print(f"Rows we couldn't recognize (city stayed NULL): {unrecognized}")

    if city_counts:
        print()
        print("Per-canonical-city counts:")
        for city, count in sorted(city_counts.items(), key=lambda kv: (-kv[1], kv[0])):
            print(f"  {city}: {count}")

    if unrecognized_raws:
        print()
        print(f"Distinct un-normalized raw values (showing up to 50 of {len(unrecognized_raws)}):")
        for raw in unrecognized_raws[:50]:
            print(f"  {raw}")

    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Backfill expenses.city for category='subscribers' rows.",
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Commit changes (default is dry-run).",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Process at most N rows (for testing).",
    )
    args = parser.parse_args(argv)
    return run(apply=args.apply, limit=args.limit)


if __name__ == "__main__":
    sys.exit(main())
