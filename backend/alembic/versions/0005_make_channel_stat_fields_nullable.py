"""make channel_stat fields nullable for bot/manual split

Revision ID: 0005
Revises: 0004
Create Date: 2026-06-16
"""
from alembic import op
import sqlalchemy as sa

revision = '0005'
down_revision = '0004'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column('channel_stats', 'subscribers_count', nullable=True, existing_type=sa.Integer())
    op.alter_column('channel_stats', 'avg_views_per_post', nullable=True, existing_type=sa.Integer())


def downgrade() -> None:
    op.execute("UPDATE channel_stats SET subscribers_count = 0 WHERE subscribers_count IS NULL")
    op.execute("UPDATE channel_stats SET avg_views_per_post = 0 WHERE avg_views_per_post IS NULL")
    op.alter_column('channel_stats', 'subscribers_count', nullable=False, existing_type=sa.Integer())
    op.alter_column('channel_stats', 'avg_views_per_post', nullable=False, existing_type=sa.Integer())
