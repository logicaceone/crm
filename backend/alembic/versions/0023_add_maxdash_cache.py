"""maxdash_cache table for /competitors API response caching

Revision ID: 0023
Revises: 0022
Create Date: 2026-06-24
"""
from alembic import op
import sqlalchemy as sa


revision = '0023'
down_revision = '0022'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "maxdash_cache",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("cache_key", sa.String(), nullable=False),
        sa.Column("data", sa.Text(), nullable=False),
        sa.Column("cached_at", sa.DateTime(timezone=True),
                  server_default=sa.func.now(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("cache_key", name="uq_maxdash_cache_key"),
    )
    op.create_index("ix_maxdash_cache_key", "maxdash_cache", ["cache_key"])


def downgrade() -> None:
    op.drop_index("ix_maxdash_cache_key", table_name="maxdash_cache")
    op.drop_table("maxdash_cache")
