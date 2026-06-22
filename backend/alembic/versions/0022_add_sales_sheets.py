"""sales_sheet_sources + sales_import_log; AdSale.paid_at + nullable channel/creator

Revision ID: 0022
Revises: 0021
Create Date: 2026-06-23
"""
from alembic import op
import sqlalchemy as sa


revision = '0022'
down_revision = '0021'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("ad_sales", sa.Column("paid_at", sa.Date(), nullable=True))
    op.alter_column("ad_sales", "created_by", nullable=True)
    op.alter_column("ad_sales", "channel_id", nullable=True)
    op.alter_column("ad_sales", "format", nullable=True)

    op.create_table(
        "sales_sheet_sources",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("gid", sa.String(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False,
                  server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True),
                  server_default=sa.func.now()),
        sa.Column("last_synced_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_sync_result", sa.String(), nullable=True),
        sa.UniqueConstraint("gid", name="uq_sales_sheet_sources_gid"),
    )
    op.create_index("ix_sales_sheet_sources_id", "sales_sheet_sources", ["id"])

    op.create_table(
        "sales_import_log",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("row_hash", sa.String(), nullable=False),
        sa.Column("sales_sheet_source_id", sa.Integer(),
                  sa.ForeignKey("sales_sheet_sources.id", ondelete="SET NULL"),
                  nullable=True),
        sa.Column("imported_at", sa.DateTime(timezone=True),
                  server_default=sa.func.now()),
        sa.Column("sale_id", sa.Integer(),
                  sa.ForeignKey("ad_sales.id", ondelete="SET NULL"),
                  nullable=True),
        sa.Column("raw_data", sa.Text(), nullable=True),
        sa.UniqueConstraint("row_hash", name="uq_sales_import_log_row_hash"),
    )
    op.create_index("ix_sales_import_log_id", "sales_import_log", ["id"])
    op.create_index("ix_sales_import_log_row_hash", "sales_import_log", ["row_hash"])
    op.create_index("ix_sales_import_log_source_id", "sales_import_log",
                    ["sales_sheet_source_id"])


def downgrade() -> None:
    op.drop_table("sales_import_log")
    op.drop_table("sales_sheet_sources")
    op.alter_column("ad_sales", "format", nullable=False)
    op.alter_column("ad_sales", "channel_id", nullable=False)
    op.alter_column("ad_sales", "created_by", nullable=False)
    op.drop_column("ad_sales", "paid_at")
