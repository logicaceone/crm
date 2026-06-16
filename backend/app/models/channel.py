from sqlalchemy import Column, Integer, String, DateTime, Date, ForeignKey
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from ..database import Base


class Channel(Base):
    __tablename__ = "channels"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    tg_link = Column(String, nullable=True)
    description = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    stats = relationship("ChannelStat", back_populates="channel", cascade="all, delete-orphan")


class ChannelStat(Base):
    __tablename__ = "channel_stats"

    id = Column(Integer, primary_key=True, index=True)
    channel_id = Column(Integer, ForeignKey("channels.id", ondelete="CASCADE"), nullable=False, index=True)
    date = Column(Date, nullable=False)
    subscribers_count = Column(Integer, nullable=True)
    avg_views_per_post = Column(Integer, nullable=True)

    channel = relationship("Channel", back_populates="stats")
