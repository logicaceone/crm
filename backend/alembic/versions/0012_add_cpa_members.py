"""add cpa_members table

Revision ID: 0012
Revises: 0011
Create Date: 2026-06-17
"""
from alembic import op
import sqlalchemy as sa

revision = '0012'
down_revision = '0011'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'cpa_members',
        sa.Column('id', sa.Integer, primary_key=True),
        sa.Column('user_id', sa.BigInteger, nullable=False, index=True),
        sa.Column('chat_id', sa.BigInteger, nullable=False),
        sa.Column('purchase_id', sa.Integer, sa.ForeignKey('ad_purchases.id', ondelete='CASCADE'), nullable=False),
    )
    op.create_index('ix_cpa_members_user_chat', 'cpa_members', ['user_id', 'chat_id'])


def downgrade():
    op.drop_index('ix_cpa_members_user_chat', table_name='cpa_members')
    op.drop_table('cpa_members')
