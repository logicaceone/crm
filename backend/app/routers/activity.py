from datetime import date
from typing import Optional
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from pydantic import BaseModel
from datetime import datetime

from ..database import get_db
from ..models.user import User, UserRole
from ..models.activity import UserAction
from .auth import require_roles

router = APIRouter(prefix="/activity", tags=["activity"])

root_or_admin = require_roles([UserRole.root, UserRole.admin])


class UserActionResponse(BaseModel):
    id: int
    username: str
    role: str
    action: str
    entity_type: str
    entity_id: Optional[int]
    description: Optional[str]
    created_at: datetime

    model_config = {"from_attributes": True}


@router.get("")
def list_actions(
    username: Optional[str] = None,
    action: Optional[str] = None,
    entity_type: Optional[str] = None,
    from_: Optional[date] = Query(default=None, alias="from"),
    to: Optional[date] = None,
    page: int = Query(default=1, ge=1),
    per_page: int = Query(default=15, ge=1, le=100),
    db: Session = Depends(get_db),
    _: User = Depends(root_or_admin),
):
    q = db.query(UserAction)
    if username:
        q = q.filter(UserAction.username == username)
    if action:
        q = q.filter(UserAction.action == action)
    if entity_type:
        q = q.filter(UserAction.entity_type == entity_type)
    if from_:
        q = q.filter(UserAction.created_at >= from_)
    if to:
        q = q.filter(UserAction.created_at <= to)
    q = q.order_by(UserAction.created_at.desc())
    total = q.count()
    total_pages = max(1, (total + per_page - 1) // per_page)
    page = max(1, min(page, total_pages))
    items = q.offset((page - 1) * per_page).limit(per_page).all()
    return {
        "items": [UserActionResponse.model_validate(a) for a in items],
        "pagination": {"page": page, "per_page": per_page, "total": total, "total_pages": total_pages},
    }
