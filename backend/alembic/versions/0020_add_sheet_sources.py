"""sheet_sources + sheets_import_log; make expenses.created_by nullable

Revision ID: 0020
Revises: 0019
Create Date: 2026-06-22

Sheets-sync-created expenses have no human author, so created_by needs
to be nullable. Manual creates still go through the API which sets
created_by from the current user.
"""
from alembic import op
import sqlalchemy as sa


revision = '0020'
down_revision = '0019'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "sheet_sources",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("gid", sa.String(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False,
                  server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True),
                  server_default=sa.func.now()),
        sa.Column("last_synced_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_sync_result", sa.String(), nullable=True),
        sa.UniqueConstraint("gid", name="uq_sheet_sources_gid"),
    )
    op.create_index("ix_sheet_sources_id", "sheet_sources", ["id"])

    op.create_table(
        "sheets_import_log",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("row_hash", sa.String(), nullable=False),
        sa.Column("sheet_source_id", sa.Integer(),
                  sa.ForeignKey("sheet_sources.id", ondelete="SET NULL"),
                  nullable=True),
        sa.Column("imported_at", sa.DateTime(timezone=True),
                  server_default=sa.func.now()),
        sa.Column("expense_id", sa.Integer(),
                  sa.ForeignKey("expenses.id", ondelete="SET NULL"),
                  nullable=True),
        sa.Column("raw_data", sa.Text(), nullable=True),
        sa.UniqueConstraint("row_hash", name="uq_sheets_import_log_row_hash"),
    )
    op.create_index("ix_sheets_import_log_id", "sheets_import_log", ["id"])
    op.create_index("ix_sheets_import_log_row_hash", "sheets_import_log", ["row_hash"])
    op.create_index("ix_sheets_import_log_sheet_source_id", "sheets_import_log",
                    ["sheet_source_id"])

    op.alter_column("expenses", "created_by", nullable=True)


def downgrade() -> None:
    op.alter_column("expenses", "created_by", nullable=False)
    op.drop_table("sheets_import_log")
    op.drop_table("sheet_sources")
