"""dedupe + unique constraint on channel_stats(channel_id, date)

Revision ID: 0014
Revises: 0013
Create Date: 2026-06-18
"""
from alembic import op


revision = '0014'
down_revision = '0013'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Step 1 — collapse pre-existing duplicates: keep the lowest id per
    # (channel_id, date) and drop the rest. Required before the unique
    # constraint can be created.
    op.execute(
        """
        DELETE FROM channel_stats a
        USING channel_stats b
        WHERE a.id > b.id
          AND a.channel_id = b.channel_id
          AND a.date = b.date
        """
    )

    # Step 2 — enforce uniqueness going forward.
    op.create_unique_constraint(
        "uq_channel_stat_channel_date",
        "channel_stats",
        ["channel_id", "date"],
    )


def downgrade() -> None:
    op.drop_constraint(
        "uq_channel_stat_channel_date",
        "channel_stats",
        type_="unique",
    )
