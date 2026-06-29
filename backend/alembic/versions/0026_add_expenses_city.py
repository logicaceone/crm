"""add expenses.city text[] for per-city subscriber analytics

Revision ID: 0026
Revises: 0025
Create Date: 2026-06-29
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = '0026'
down_revision = '0025'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "expenses",
        sa.Column("city", postgresql.ARRAY(sa.Text()), nullable=True),
    )
    op.execute("CREATE INDEX ix_expenses_city ON expenses USING GIN (city)")


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_expenses_city")
    op.drop_column("expenses", "city")
