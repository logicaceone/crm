import enum
from sqlalchemy import Column, Integer, String, Float, Date, DateTime, Enum, ForeignKey, Text, BigInteger
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from ..database import Base


class PurchaseType(str, enum.Enum):
    ad = "ad"
    target = "target"


class AdFormat(str, enum.Enum):
    post = "post"
    repost = "repost"
    integration = "integration"
    other = "other"


class PurchaseStatus(str, enum.Enum):
    planned = "planned"
    placed = "placed"
    cancelled = "cancelled"


class ExternalChannel(Base):
    __tablename__ = "external_channels"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    tg_link = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    purchases = relationship("AdPurchase", back_populates="external_channel")


class AdPurchase(Base):
    __tablename__ = "ad_purchases"

    id = Column(Integer, primary_key=True, index=True)
    type = Column(
        Enum(PurchaseType, name="purchase_type"),
        nullable=False,
        default=PurchaseType.ad,
        server_default="ad",
    )
    # Ad-specific (nullable for target)
    external_channel_id = Column(Integer, ForeignKey("external_channels.id"), nullable=True, index=True)
    format = Column(Enum(AdFormat, name="ad_format"), nullable=True)
    # Target-specific
    target_platform = Column(String, nullable=True)
    # Common
    date = Column(Date, nullable=False)
    price = Column(Float, nullable=False)
    currency = Column(String(10), nullable=False, default="RUB", server_default="RUB")
    status = Column(Enum(PurchaseStatus, name="purchase_status"), nullable=False, default=PurchaseStatus.planned, server_default="planned")
    comment = Column(Text, nullable=True)
    # CPA tracking (ad+telegram only)
    channel_id = Column(Integer, ForeignKey("channels.id", ondelete="SET NULL"), nullable=True, index=True)
    invite_link = Column(String, nullable=True)
    joined_count = Column(Integer, nullable=False, default=0, server_default="0")
    left_count = Column(Integer, nullable=False, default=0, server_default="0")
    cpa_synced_at = Column(DateTime(timezone=True), nullable=True)

    created_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    external_channel = relationship("ExternalChannel", back_populates="purchases")
    channel = relationship("Channel", foreign_keys=[channel_id])
    creator = relationship("User")
