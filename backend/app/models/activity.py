from sqlalchemy import Column, Integer, String, DateTime, Text
from sqlalchemy.sql import func
from ..database import Base


class UserAction(Base):
    __tablename__ = "user_actions"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, nullable=False)
    role = Column(String, nullable=False)
    action = Column(String, nullable=False)        # create | update | delete
    entity_type = Column(String, nullable=False)   # purchase | sale | channel | user | external_channel
    entity_id = Column(Integer, nullable=True)
    description = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
