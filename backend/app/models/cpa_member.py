from sqlalchemy import Column, Integer, BigInteger, ForeignKey, Index
from ..database import Base


class CpaMember(Base):
    __tablename__ = "cpa_members"

    id = Column(Integer, primary_key=True)
    user_id = Column(BigInteger, nullable=False, index=True)
    chat_id = Column(BigInteger, nullable=False)
    purchase_id = Column(Integer, ForeignKey("ad_purchases.id", ondelete="CASCADE"), nullable=False)

    __table_args__ = (
        Index("ix_cpa_members_user_chat", "user_id", "chat_id"),
    )
