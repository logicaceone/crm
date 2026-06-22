"""add ad_sales.topic

Revision ID: 0021
Revises: 0020
Create Date: 2026-06-22
"""
from alembic import op
import sqlalchemy as sa


revision = '0021'
down_revision = '0020'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("ad_sales", sa.Column("topic", sa.String(), nullable=True))


def downgrade() -> None:
    op.drop_column("ad_sales", "topic")
