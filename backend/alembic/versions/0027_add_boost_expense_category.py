"""add 'boost' value to expense_category enum

Revision ID: 0027
Revises: 0026
Create Date: 2026-07-13
"""
from alembic import op


revision = '0027'
down_revision = '0026'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TYPE expense_category ADD VALUE IF NOT EXISTS 'boost'")


def downgrade() -> None:
    # Postgres has no DROP VALUE for enums — recreate the type without 'boost'.
    op.execute("ALTER TYPE expense_category RENAME TO expense_category_old")
    op.execute(
        "CREATE TYPE expense_category AS ENUM "
        "('tg_ads','vk_ads','yandex','blogger',"
        "'subscribers','lunch','giveaway','services','salary','other')"
    )
    op.execute(
        "ALTER TABLE expenses ALTER COLUMN category TYPE expense_category "
        "USING category::text::expense_category"
    )
    op.execute("DROP TYPE expense_category_old")
