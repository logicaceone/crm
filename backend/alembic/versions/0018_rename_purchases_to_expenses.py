"""rename ad_purchases -> expenses; type/format/target_platform replaced by category

Revision ID: 0018
Revises: 0017
Create Date: 2026-06-22

Data is wiped: existing ad_purchases / cpa_members rows are TRUNCATEd
before the table is dropped. Per the spec — this is a fresh start, not
a data migration.
"""
from alembic import op
import sqlalchemy as sa


revision = '0018'
down_revision = '0017'
branch_labels = None
depends_on = None


EXPENSE_CATEGORY_VALUES = (
    'tg_ads', 'vk_ads', 'yandex', 'blogger',
    'subscribers', 'lunch', 'giveaway', 'services', 'other',
)


def upgrade() -> None:
    # Wipe legacy data — the spec is "start fresh".
    op.execute("TRUNCATE TABLE cpa_members RESTART IDENTITY CASCADE")
    op.execute("TRUNCATE TABLE ad_purchases RESTART IDENTITY CASCADE")

    # Drop the FK from cpa_members first — plain drop_table would fail
    # because cpa_members.purchase_id still references ad_purchases.id.
    op.execute(
        "ALTER TABLE cpa_members DROP CONSTRAINT IF EXISTS cpa_members_purchase_id_fkey"
    )
    op.drop_table("ad_purchases")

    # Drop enums that were only used by ad_purchases.
    op.execute("DROP TYPE IF EXISTS purchase_type")
    op.execute("DROP TYPE IF EXISTS purchase_status")
    # ad_format is still used by ad_sales.format, leave it.

    # Drop the new enums too in case a previous failed migration attempt
    # left them behind (postgres has no CREATE TYPE IF NOT EXISTS).
    op.execute("DROP TYPE IF EXISTS expense_category")
    op.execute("DROP TYPE IF EXISTS expense_status")
    op.execute(
        "CREATE TYPE expense_category AS ENUM "
        + "(" + ",".join(f"'{v}'" for v in EXPENSE_CATEGORY_VALUES) + ")"
    )
    op.execute(
        "CREATE TYPE expense_status AS ENUM ('planned','placed','cancelled')"
    )

    # Build the table with plain SQL so SQLAlchemy's Enum event system
    # doesn't try to re-create the PG enum types we already made above.
    # `op.create_table` with sa.Enum(create_type=False) STILL fires the
    # Enum.before_create event on PG dialect — bypassing it via raw DDL
    # is the only reliable way.
    op.execute("""
        CREATE TABLE expenses (
            id SERIAL PRIMARY KEY,
            category expense_category NOT NULL,
            external_channel_id INTEGER REFERENCES external_channels(id),
            date DATE NOT NULL,
            price DOUBLE PRECISION NOT NULL,
            currency VARCHAR(10) NOT NULL DEFAULT 'RUB',
            status expense_status NOT NULL DEFAULT 'planned',
            comment TEXT,
            responsible VARCHAR,
            channel_id INTEGER REFERENCES channels(id) ON DELETE SET NULL,
            invite_link VARCHAR,
            joined_count INTEGER NOT NULL DEFAULT 0,
            left_count INTEGER NOT NULL DEFAULT 0,
            cpa_synced_at TIMESTAMP WITH TIME ZONE,
            cpa_last_member_count INTEGER NOT NULL DEFAULT 0,
            created_by INTEGER NOT NULL REFERENCES users(id),
            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            CONSTRAINT ck_expense_blogger_channel
                CHECK (category <> 'blogger' OR external_channel_id IS NOT NULL),
            CONSTRAINT ck_expense_cpa_invite_link
                CHECK (
                    invite_link IS NULL
                    OR category IN ('tg_ads','vk_ads','yandex','blogger')
                )
        )
    """)
    op.create_index("ix_expenses_external_channel_id", "expenses",
                    ["external_channel_id"])
    op.create_index("ix_expenses_channel_id", "expenses", ["channel_id"])
    op.create_index("ix_expenses_id", "expenses", ["id"])

    # Reattach cpa_members to expenses (rename column + add FK).
    op.alter_column("cpa_members", "purchase_id", new_column_name="expense_id")
    op.create_foreign_key(
        "fk_cpa_members_expense_id_expenses",
        "cpa_members", "expenses",
        ["expense_id"], ["id"],
        ondelete="CASCADE",
    )


def downgrade() -> None:
    raise NotImplementedError(
        "0018 is one-way: it drops ad_purchases and the purchase_type/"
        "purchase_status enums. Restore from a backup to roll back."
    )
