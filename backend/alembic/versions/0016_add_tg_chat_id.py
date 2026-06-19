"""add tg_chat_id to channels for private channel CPA support

Revision ID: 0016
Revises: 0015
Create Date: 2026-06-19
"""
from alembic import op
import sqlalchemy as sa


revision = '0016'
down_revision = '0015'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "channels",
        sa.Column("tg_chat_id", sa.BigInteger(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("channels", "tg_chat_id")
