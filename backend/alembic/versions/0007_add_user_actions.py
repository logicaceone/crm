"""add user_actions table

Revision ID: 0007
Revises: 0006
Create Date: 2026-06-16
"""
from alembic import op
import sqlalchemy as sa

revision = '0007'
down_revision = '0006'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'user_actions',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('username', sa.String(), nullable=False),
        sa.Column('role', sa.String(), nullable=False),
        sa.Column('action', sa.String(), nullable=False),
        sa.Column('entity_type', sa.String(), nullable=False),
        sa.Column('entity_id', sa.Integer(), nullable=True),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_user_actions_id'), 'user_actions', ['id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_user_actions_id'), table_name='user_actions')
    op.drop_table('user_actions')
