import enum
from sqlalchemy import Column, Integer, String, Float, Date, DateTime, Enum, ForeignKey, Text
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from ..database import Base
from .expense import AdFormat


class SaleStatus(str, enum.Enum):
    agreed = "agreed"
    placed = "placed"
    paid = "paid"
    cancelled = "cancelled"


class AdSale(Base):
    __tablename__ = "ad_sales"

    id = Column(Integer, primary_key=True, index=True)
    client_name = Column(String, nullable=False)
    # channel_id nullable so Sheets-imported sales without a linked CRM
    # channel can still be stored (they're carrying the channel name in
    # `comment` instead).
    channel_id = Column(Integer, ForeignKey("channels.id"), nullable=True, index=True)
    date = Column(Date, nullable=False)
    paid_at = Column(Date, nullable=True)
    price = Column(Float, nullable=False)
    currency = Column(String(10), nullable=False, default="RUB", server_default="RUB")
    format = Column(Enum(AdFormat, name="ad_format", create_constraint=False), nullable=True)
    status = Column(Enum(SaleStatus, name="sale_status"), nullable=False, default=SaleStatus.agreed, server_default="agreed")
    comment = Column(Text, nullable=True)
    topic = Column(String, nullable=True)
    # Nullable so sheet-imported sales have no human author. Manual creates
    # always set this via the API.
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    channel = relationship("Channel")
    creator = relationship("User")
