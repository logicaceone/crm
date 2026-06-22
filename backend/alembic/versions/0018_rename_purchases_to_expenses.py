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

    # FK cpa_members.purchase_id → ad_purchases.id will be dropped automatically
    # when we drop ad_purchases; recreate it pointing at expenses afterwards.
    op.drop_table("ad_purchases")

    # Drop enums that were only used by ad_purchases.
    op.execute("DROP TYPE IF EXISTS purchase_type")
    op.execute("DROP TYPE IF EXISTS purchase_status")
    # ad_format is still used by ad_sales.format, leave it.

    # New enums.
    op.execute(
        "CREATE TYPE expense_category AS ENUM "
        + "(" + ",".join(f"'{v}'" for v in EXPENSE_CATEGORY_VALUES) + ")"
    )
    op.execute(
        "CREATE TYPE expense_status AS ENUM ('planned','placed','cancelled')"
    )

    op.create_table(
        "expenses",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "category",
            sa.Enum(*EXPENSE_CATEGORY_VALUES, name="expense_category",
                    create_type=False),
            nullable=False,
        ),
        sa.Column("external_channel_id", sa.Integer(),
                  sa.ForeignKey("external_channels.id"), nullable=True),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("price", sa.Float(), nullable=False),
        sa.Column("currency", sa.String(length=10), nullable=False,
                  server_default="RUB"),
        sa.Column(
            "status",
            sa.Enum("planned", "placed", "cancelled", name="expense_status",
                    create_type=False),
            nullable=False, server_default="planned",
        ),
        sa.Column("comment", sa.Text(), nullable=True),
        sa.Column("responsible", sa.String(), nullable=True),
        sa.Column("channel_id", sa.Integer(),
                  sa.ForeignKey("channels.id", ondelete="SET NULL"),
                  nullable=True),
        sa.Column("invite_link", sa.String(), nullable=True),
        sa.Column("joined_count", sa.Integer(), nullable=False,
                  server_default="0"),
        sa.Column("left_count", sa.Integer(), nullable=False,
                  server_default="0"),
        sa.Column("cpa_synced_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("cpa_last_member_count", sa.Integer(), nullable=False,
                  server_default="0"),
        sa.Column("created_by", sa.Integer(),
                  sa.ForeignKey("users.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True),
                  server_default=sa.func.now()),
        sa.CheckConstraint(
            "category <> 'blogger' OR external_channel_id IS NOT NULL",
            name="ck_expense_blogger_channel",
        ),
        sa.CheckConstraint(
            "invite_link IS NULL OR category IN "
            "('tg_ads','vk_ads','yandex','blogger')",
            name="ck_expense_cpa_invite_link",
        ),
    )
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
