"""add 'salary' value to expense_category enum

Revision ID: 0025
Revises: 0024
Create Date: 2026-06-29
"""
from alembic import op


revision = '0025'
down_revision = '0024'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TYPE expense_category ADD VALUE IF NOT EXISTS 'salary'")


def downgrade() -> None:
    # Postgres has no DROP VALUE for enums — recreate the type without 'salary'.
    op.execute("ALTER TYPE expense_category RENAME TO expense_category_old")
    op.execute(
        "CREATE TYPE expense_category AS ENUM "
        "('tg_ads','vk_ads','yandex','blogger',"
        "'subscribers','lunch','giveaway','services','other')"
    )
    op.execute(
        "ALTER TABLE expenses ALTER COLUMN category TYPE expense_category "
        "USING category::text::expense_category"
    )
    op.execute("DROP TYPE expense_category_old")
