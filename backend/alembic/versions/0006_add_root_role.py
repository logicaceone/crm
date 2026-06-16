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
    op.execute("ALTER TYPE userrole ADD VALUE IF NOT EXISTS 'root' BEFORE 'admin'")
    # Promote existing 'admin' username to root if no root exists yet
    op.execute("""
        UPDATE users SET role = 'root'
        WHERE username = 'admin'
          AND role = 'admin'
          AND NOT EXISTS (SELECT 1 FROM users WHERE role = 'root')
    """)


def downgrade() -> None:
    # PostgreSQL does not support removing enum values; manual recreation required
    pass
