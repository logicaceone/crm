import enum
from sqlalchemy import Column, Integer, String, DateTime, Enum
from sqlalchemy.sql import func
from ..database import Base


class UserRole(str, enum.Enum):
    admin = "admin"
    manager = "manager"
    viewer = "viewer"


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, nullable=False, index=True)
    password_hash = Column(String, nullable=False)
    role = Column(Enum(UserRole), nullable=False, server_default="viewer")
    created_at = Column(DateTime(timezone=True), server_default=func.now())
