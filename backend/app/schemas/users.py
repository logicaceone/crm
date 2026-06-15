from typing import Optional
from pydantic import BaseModel
from ..models.user import UserRole


class CreateUserRequest(BaseModel):
    username: str
    password: str
    role: UserRole = UserRole.viewer


class UpdateUserRequest(BaseModel):
    role: Optional[UserRole] = None
    password: Optional[str] = None
