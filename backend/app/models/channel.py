import enum
from sqlalchemy import Column, Integer, String, DateTime, Date, ForeignKey, BigInteger, UniqueConstraint
from sqlalchemy import Enum as PgEnum
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from ..database import Base


class ChannelPlatform(enum.Enum):
    telegram = "telegram"
    max = "max"


class Channel(Base):
    __tablename__ = "channels"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    platform = Column(PgEnum(ChannelPlatform, name="channelplatform"), nullable=False, server_default="telegram")
    tg_link = Column(String, nullable=True)
    description = Column(String, nullable=True)
    max_chat_id = Column(BigInteger, nullable=True)
    max_chat_link = Column(String, nullable=True)
    max_bot_token = Column(String, nullable=True)  # Fernet-encrypted; never return plaintext
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    stats = relationship("ChannelStat", back_populates="channel", cascade="all, delete-orphan")


class ChannelStat(Base):
    __tablename__ = "channel_stats"

    id = Column(Integer, primary_key=True, index=True)
    channel_id = Column(Integer, ForeignKey("channels.id", ondelete="CASCADE"), nullable=False, index=True)
    date = Column(Date, nullable=False)
    subscribers_count = Column(Integer, nullable=True)
    avg_views_per_post = Column(Integer, nullable=True)
    posts_sampled = Column(Integer, nullable=True)  # how many posts avg_views was computed from

    channel = relationship("Channel", back_populates="stats")

    __table_args__ = (
        UniqueConstraint("channel_id", "date", name="uq_channel_stat_channel_date"),
    )
