"""create sales table

Revision ID: 0004
Revises: 0003
Create Date: 2026-06-16 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0004"
down_revision: Union[str, None] = "0003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "ad_sales",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("client_name", sa.String(), nullable=False),
        sa.Column("channel_id", sa.Integer(), nullable=False),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("price", sa.Float(), nullable=False),
        sa.Column("currency", sa.String(10), nullable=False, server_default="RUB"),
        sa.Column(
            "format",
            sa.Enum("post", "repost", "integration", "other", name="ad_format", create_type=False),
            nullable=False,
        ),
        sa.Column(
            "status",
            sa.Enum("agreed", "placed", "paid", "cancelled", name="sale_status"),
            nullable=False,
            server_default="agreed",
        ),
        sa.Column("comment", sa.Text(), nullable=True),
        sa.Column("created_by", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["channel_id"], ["channels.id"]),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_ad_sales_id"), "ad_sales", ["id"], unique=False)
    op.create_index(op.f("ix_ad_sales_channel_id"), "ad_sales", ["channel_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_ad_sales_channel_id"), table_name="ad_sales")
    op.drop_index(op.f("ix_ad_sales_id"), table_name="ad_sales")
    op.drop_table("ad_sales")
    op.execute("DROP TYPE IF EXISTS sale_status")
