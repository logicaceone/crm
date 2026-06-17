"""add max platform support to channels

Revision ID: 0008
Revises: 0007
Create Date: 2026-06-17
"""
from alembic import op
import sqlalchemy as sa

revision = '0008'
down_revision = '0007'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE TYPE channelplatform AS ENUM ('telegram', 'max')")
    op.add_column('channels', sa.Column(
        'platform',
        sa.Enum('telegram', 'max', name='channelplatform', create_type=False),
        nullable=False,
        server_default='telegram',
    ))
    op.add_column('channels', sa.Column('max_chat_id', sa.BigInteger(), nullable=True))
    op.add_column('channels', sa.Column('max_chat_link', sa.String(), nullable=True))
    op.add_column('channels', sa.Column('max_bot_token', sa.String(), nullable=True))


def downgrade() -> None:
    op.drop_column('channels', 'max_bot_token')
    op.drop_column('channels', 'max_chat_link')
    op.drop_column('channels', 'max_chat_id')
    op.drop_column('channels', 'platform')
    op.execute("DROP TYPE channelplatform")
