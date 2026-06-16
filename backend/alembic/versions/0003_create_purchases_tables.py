"""create purchases tables

Revision ID: 0003
Revises: 0002
Create Date: 2026-06-16 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0003"
down_revision: Union[str, None] = "0002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "external_channels",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("tg_link", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_external_channels_id"), "external_channels", ["id"], unique=False)

    op.create_table(
        "ad_purchases",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("external_channel_id", sa.Integer(), nullable=False),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("price", sa.Float(), nullable=False),
        sa.Column("currency", sa.String(10), nullable=False, server_default="RUB"),
        sa.Column("format", sa.Enum("post", "repost", "integration", "other", name="ad_format"), nullable=False),
        sa.Column("status", sa.Enum("planned", "placed", "cancelled", name="purchase_status"), nullable=False, server_default="planned"),
        sa.Column("comment", sa.Text(), nullable=True),
        sa.Column("created_by", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["external_channel_id"], ["external_channels.id"]),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_ad_purchases_id"), "ad_purchases", ["id"], unique=False)
    op.create_index(op.f("ix_ad_purchases_external_channel_id"), "ad_purchases", ["external_channel_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_ad_purchases_external_channel_id"), table_name="ad_purchases")
    op.drop_index(op.f("ix_ad_purchases_id"), table_name="ad_purchases")
    op.drop_table("ad_purchases")
    op.execute("DROP TYPE IF EXISTS ad_format")
    op.execute("DROP TYPE IF EXISTS purchase_status")
    op.drop_index(op.f("ix_external_channels_id"), table_name="external_channels")
    op.drop_table("external_channels")
