from datetime import datetime
from typing import Optional
from pydantic import BaseModel
from ..models.user import UserRole


class LoginRequest(BaseModel):
    username: str
    password: str
    recaptcha_token: Optional[str] = None


class UserResponse(BaseModel):
    id: int
    username: str
    role: UserRole
    telegram_username: Optional[str] = None
    created_at: datetime

    model_config = {"from_attributes": True}
