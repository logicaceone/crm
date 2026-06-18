"""add purchase type

Revision ID: 0013
Revises: 0012
Create Date: 2026-06-17
"""
from alembic import op
import sqlalchemy as sa

revision = '0013'
down_revision = '0012'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE TYPE purchase_type AS ENUM ('ad', 'target')")

    op.add_column('ad_purchases', sa.Column(
        'type',
        sa.Enum('ad', 'target', name='purchase_type', create_type=False),
        nullable=False,
        server_default='ad',
    ))

    op.add_column('ad_purchases', sa.Column('target_platform', sa.String(), nullable=True))

    # target purchases don't have external_channel or format
    op.alter_column('ad_purchases', 'external_channel_id',
                    existing_type=sa.Integer(), nullable=True)

    op.alter_column('ad_purchases', 'format',
                    existing_type=sa.Enum('post', 'repost', 'integration', 'other', name='ad_format'),
                    nullable=True)


def downgrade() -> None:
    op.alter_column('ad_purchases', 'format',
                    existing_type=sa.Enum('post', 'repost', 'integration', 'other', name='ad_format'),
                    nullable=False)
    op.alter_column('ad_purchases', 'external_channel_id',
                    existing_type=sa.Integer(), nullable=False)
    op.drop_column('ad_purchases', 'target_platform')
    op.drop_column('ad_purchases', 'type')
    op.execute("DROP TYPE purchase_type")
