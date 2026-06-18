"""add cpa fields to ad_purchases

Revision ID: 0011
Revises: 0010
Create Date: 2026-06-17
"""
from alembic import op
import sqlalchemy as sa

revision = "0011"
down_revision = "0010"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("ad_purchases", sa.Column("channel_id", sa.Integer(), nullable=True))
    op.add_column("ad_purchases", sa.Column("invite_link", sa.String(), nullable=True))
    op.add_column("ad_purchases", sa.Column("joined_count", sa.Integer(), nullable=False, server_default="0"))
    op.add_column("ad_purchases", sa.Column("left_count", sa.Integer(), nullable=False, server_default="0"))
    op.add_column("ad_purchases", sa.Column("cpa_synced_at", sa.DateTime(timezone=True), nullable=True))

    op.create_foreign_key(
        "fk_ad_purchases_channel_id",
        "ad_purchases", "channels",
        ["channel_id"], ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_ad_purchases_channel_id", "ad_purchases", ["channel_id"])


def downgrade() -> None:
    op.drop_index("ix_ad_purchases_channel_id", table_name="ad_purchases")
    op.drop_constraint("fk_ad_purchases_channel_id", "ad_purchases", type_="foreignkey")
    op.drop_column("ad_purchases", "cpa_synced_at")
    op.drop_column("ad_purchases", "left_count")
    op.drop_column("ad_purchases", "joined_count")
    op.drop_column("ad_purchases", "invite_link")
    op.drop_column("ad_purchases", "channel_id")
