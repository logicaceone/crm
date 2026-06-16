import enum
from sqlalchemy import Column, Integer, String, Float, Date, DateTime, Enum, ForeignKey, Text
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from ..database import Base
from .purchase import AdFormat


class SaleStatus(str, enum.Enum):
    agreed = "agreed"
    placed = "placed"
    paid = "paid"
    cancelled = "cancelled"


class AdSale(Base):
    __tablename__ = "ad_sales"

    id = Column(Integer, primary_key=True, index=True)
    client_name = Column(String, nullable=False)
    channel_id = Column(Integer, ForeignKey("channels.id"), nullable=False, index=True)
    date = Column(Date, nullable=False)
    price = Column(Float, nullable=False)
    currency = Column(String(10), nullable=False, default="RUB", server_default="RUB")
    format = Column(Enum(AdFormat, name="ad_format", create_constraint=False), nullable=False)
    status = Column(Enum(SaleStatus, name="sale_status"), nullable=False, default=SaleStatus.agreed, server_default="agreed")
    comment = Column(Text, nullable=True)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    channel = relationship("Channel")
    creator = relationship("User")
