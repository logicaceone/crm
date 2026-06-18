"""CHECK constraints to keep ad_purchases consistent with type

Revision ID: 0015
Revises: 0014
Create Date: 2026-06-18
"""
from alembic import op


revision = '0015'
down_revision = '0014'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Defensive cleanup so the CHECKs can be added without rejection.
    # No-op on a clean table; safe to run even if previous rows are
    # already consistent.
    op.execute(
        "UPDATE ad_purchases "
        "SET target_platform = NULL "
        "WHERE type = 'ad' AND target_platform IS NOT NULL"
    )
    op.execute(
        "UPDATE ad_purchases "
        "SET external_channel_id = NULL, format = NULL, invite_link = NULL, "
        "    joined_count = 0, left_count = 0, cpa_synced_at = NULL "
        "WHERE type = 'target'"
    )

    op.create_check_constraint(
        "ck_purchase_target_platform",
        "ad_purchases",
        "type <> 'target' OR target_platform IS NOT NULL",
    )
    op.create_check_constraint(
        "ck_purchase_ad_channel",
        "ad_purchases",
        "type <> 'ad' OR external_channel_id IS NOT NULL",
    )
    op.create_check_constraint(
        "ck_purchase_invite_link_type",
        "ad_purchases",
        "invite_link IS NULL OR type = 'ad'",
    )


def downgrade() -> None:
    op.drop_constraint("ck_purchase_invite_link_type", "ad_purchases", type_="check")
    op.drop_constraint("ck_purchase_ad_channel", "ad_purchases", type_="check")
    op.drop_constraint("ck_purchase_target_platform", "ad_purchases", type_="check")
