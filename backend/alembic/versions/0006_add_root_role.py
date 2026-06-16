"""add root role to userrole enum

Revision ID: 0006
Revises: 0005
Create Date: 2026-06-16
"""
from alembic import op

revision = '0006'
down_revision = '0005'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ADD VALUE cannot be used in the same transaction — promotion of admin→root
    # is handled by _seed_admin() in main.py after this transaction commits.
    op.execute("ALTER TYPE userrole ADD VALUE IF NOT EXISTS 'root' BEFORE 'admin'")


def downgrade() -> None:
    # PostgreSQL does not support removing enum values; manual recreation required
    pass
