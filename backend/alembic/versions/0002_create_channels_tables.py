"""create channels tables

Revision ID: 0002
Revises: 0001
Create Date: 2026-06-16 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0002"
down_revision: Union[str, None] = "0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "channels",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("tg_link", sa.String(), nullable=True),
        sa.Column("description", sa.String(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_channels_id"), "channels", ["id"], unique=False)

    op.create_table(
        "channel_stats",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("channel_id", sa.Integer(), nullable=False),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("subscribers_count", sa.Integer(), nullable=False),
        sa.Column("avg_views_per_post", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["channel_id"], ["channels.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_channel_stats_id"), "channel_stats", ["id"], unique=False)
    op.create_index(op.f("ix_channel_stats_channel_id"), "channel_stats", ["channel_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_channel_stats_channel_id"), table_name="channel_stats")
    op.drop_index(op.f("ix_channel_stats_id"), table_name="channel_stats")
    op.drop_table("channel_stats")
    op.drop_index(op.f("ix_channels_id"), table_name="channels")
    op.drop_table("channels")
