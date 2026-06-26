from typing import Optional
from pydantic import BaseModel, field_validator
from ..models.user import UserRole


def _normalize_tg(v: Optional[str]) -> Optional[str]:
    if v is None:
        return None
    v = v.strip().lstrip("@")
    return v or None


class CreateUserRequest(BaseModel):
    username: str
    password: str
    role: UserRole = UserRole.viewer
    telegram_username: Optional[str] = None

    @field_validator("telegram_username")
    @classmethod
    def _strip_at(cls, v: Optional[str]) -> Optional[str]:
        return _normalize_tg(v)


class UpdateUserRequest(BaseModel):
    role: Optional[UserRole] = None
    password: Optional[str] = None
    telegram_username: Optional[str] = None

    @field_validator("telegram_username")
    @classmethod
    def _strip_at(cls, v: Optional[str]) -> Optional[str]:
        return _normalize_tg(v)
