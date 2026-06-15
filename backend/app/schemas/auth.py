from pydantic import BaseModel
from ..models.user import UserRole


class LoginRequest(BaseModel):
    username: str
    password: str


class UserResponse(BaseModel):
    id: int
    username: str
    role: UserRole

    model_config = {"from_attributes": True}
