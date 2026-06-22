import enum
from sqlalchemy import Column, Integer, String, Float, Date, DateTime, Enum, ForeignKey, Text, CheckConstraint
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from ..database import Base


class ExpenseCategory(str, enum.Enum):
    tg_ads = "tg_ads"
    vk_ads = "vk_ads"
    yandex = "yandex"
    blogger = "blogger"
    subscribers = "subscribers"
    lunch = "lunch"
    giveaway = "giveaway"
    services = "services"
    other = "other"


CPA_CATEGORIES = frozenset({
    ExpenseCategory.tg_ads,
    ExpenseCategory.vk_ads,
    ExpenseCategory.yandex,
    ExpenseCategory.blogger,
})


class AdFormat(str, enum.Enum):
    """Still used by Sale.format. Lives here because the original `purchase.py`
    is gone; sales kept their format dimension."""
    post = "post"
    repost = "repost"
    integration = "integration"
    other = "other"


class ExpenseStatus(str, enum.Enum):
    planned = "planned"
    placed = "placed"
    cancelled = "cancelled"


class ExternalChannel(Base):
    __tablename__ = "external_channels"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    tg_link = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    expenses = relationship("Expense", back_populates="external_channel")


class Expense(Base):
    __tablename__ = "expenses"

    id = Column(Integer, primary_key=True, index=True)
    category = Column(
        Enum(ExpenseCategory, name="expense_category"),
        nullable=False,
    )
    external_channel_id = Column(Integer, ForeignKey("external_channels.id"), nullable=True, index=True)
    date = Column(Date, nullable=False)
    price = Column(Float, nullable=False)
    currency = Column(String(10), nullable=False, default="RUB", server_default="RUB")
    status = Column(
        Enum(ExpenseStatus, name="expense_status"),
        nullable=False,
        default=ExpenseStatus.planned,
        server_default="planned",
    )
    comment = Column(Text, nullable=True)
    responsible = Column(String, nullable=True)
    # CPA tracking — only for CPA categories (tg_ads/vk_ads/yandex/blogger)
    channel_id = Column(Integer, ForeignKey("channels.id", ondelete="SET NULL"), nullable=True, index=True)
    invite_link = Column(String, nullable=True)
    joined_count = Column(Integer, nullable=False, default=0, server_default="0")
    left_count = Column(Integer, nullable=False, default=0, server_default="0")
    cpa_synced_at = Column(DateTime(timezone=True), nullable=True)
    cpa_last_member_count = Column(Integer, nullable=False, default=0, server_default="0")

    created_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    external_channel = relationship("ExternalChannel", back_populates="expenses")
    channel = relationship("Channel", foreign_keys=[channel_id])
    creator = relationship("User")

    __table_args__ = (
        CheckConstraint(
            "category <> 'blogger' OR external_channel_id IS NOT NULL",
            name="ck_expense_blogger_channel",
        ),
        CheckConstraint(
            "invite_link IS NULL OR category IN "
            "('tg_ads','vk_ads','yandex','blogger')",
            name="ck_expense_cpa_invite_link",
        ),
    )
