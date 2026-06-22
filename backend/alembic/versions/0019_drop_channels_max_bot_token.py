"""drop channels.max_bot_token (moved to system_settings)

Revision ID: 0019
Revises: 0018
Create Date: 2026-06-22

The Max bot token is now stored once in system_settings under
key='max_bot_token'. Per-channel storage is removed.
"""
from alembic import op
import sqlalchemy as sa


revision = '0019'
down_revision = '0018'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_column("channels", "max_bot_token")


def downgrade() -> None:
    op.add_column(
        "channels",
        sa.Column("max_bot_token", sa.String(), nullable=True),
    )
