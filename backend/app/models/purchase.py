import enum
from sqlalchemy import Column, Integer, String, Float, Date, DateTime, Enum, ForeignKey, Text
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from ..database import Base


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
    external_channel_id = Column(Integer, ForeignKey("external_channels.id"), nullable=False, index=True)
    date = Column(Date, nullable=False)
    price = Column(Float, nullable=False)
    currency = Column(String(10), nullable=False, default="RUB", server_default="RUB")
    format = Column(Enum(AdFormat, name="ad_format"), nullable=False)
    status = Column(Enum(PurchaseStatus, name="purchase_status"), nullable=False, default=PurchaseStatus.planned, server_default="planned")
    comment = Column(Text, nullable=True)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    external_channel = relationship("ExternalChannel", back_populates="purchases")
    creator = relationship("User")
