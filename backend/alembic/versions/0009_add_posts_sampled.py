"""add posts_sampled to channel_stats

Revision ID: 0009
Revises: 0008
Create Date: 2026-06-17
"""
from alembic import op
import sqlalchemy as sa

revision = '0009'
down_revision = '0008'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('channel_stats', sa.Column('posts_sampled', sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column('channel_stats', 'posts_sampled')
