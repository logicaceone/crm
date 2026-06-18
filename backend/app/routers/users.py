from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
import bcrypt

from ..database import get_db
from ..models.user import User, UserRole
from ..schemas.auth import UserResponse
from ..schemas.users import CreateUserRequest, UpdateUserRequest
from .auth import require_roles
from ..activity import log_action

router = APIRouter(prefix="/users", tags=["users"])

root_or_admin = require_roles([UserRole.root, UserRole.admin])


@router.get("")
def list_users(
    page: Optional[int] = None,
    per_page: int = Query(default=15, ge=1, le=200),
    db: Session = Depends(get_db),
    _: User = Depends(root_or_admin),
):
    q = db.query(User).order_by(User.created_at)
    if page is None:
        return q.all()
    total = q.count()
    total_pages = max(1, (total + per_page - 1) // per_page)
    page = max(1, min(page, total_pages))
    items = q.offset((page - 1) * per_page).limit(per_page).all()
    return {
        "items": [UserResponse.model_validate(u) for u in items],
        "pagination": {"page": page, "per_page": per_page, "total": total, "total_pages": total_pages},
        "admin_count": _admin_count(db),
    }


@router.post("", response_model=UserResponse, status_code=201)
def create_user(
    data: CreateUserRequest,
    db: Session = Depends(get_db),
    me: User = Depends(root_or_admin),
):
    if data.role == UserRole.root:
        raise HTTPException(status_code=403, detail="Cannot create root user")
    if data.role == UserRole.admin and me.role != UserRole.root:
        raise HTTPException(status_code=403, detail="Only root can create admin users")
    if db.query(User).filter(User.username == data.username).first():
        raise HTTPException(status_code=409, detail="Username already exists")
    user = User(
        username=data.username,
        password_hash=bcrypt.hashpw(data.password.encode(), bcrypt.gensalt()).decode(),
        role=data.role,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    log_action(db, me, "create", "user", user.id, f"Пользователь {user.username} ({user.role.value})")
    return user


_ADMIN_ROLES = (UserRole.root, UserRole.admin)


def _admin_count(db: Session) -> int:
    """Total number of accounts with management access (root + admin)."""
    return db.query(User).filter(User.role.in_(_ADMIN_ROLES)).count()


@router.patch("/{user_id}", response_model=UserResponse)
def update_user(
    user_id: int,
    data: UpdateUserRequest,
    db: Session = Depends(get_db),
    me: User = Depends(root_or_admin),
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    # Block self-role-change to avoid leaving the system without admins.
    if user_id == me.id and data.role is not None and data.role != user.role:
        raise HTTPException(status_code=400, detail="You cannot change your own role.")
    if user.role == UserRole.root and me.role != UserRole.root:
        raise HTTPException(status_code=403, detail="Cannot edit root user")
    if user.role == UserRole.admin and me.role == UserRole.admin and user.id != me.id:
        raise HTTPException(status_code=403, detail="Admin cannot edit other admin users")
    if data.role == UserRole.root:
        raise HTTPException(status_code=403, detail="Cannot assign root role")
    if data.role == UserRole.admin and me.role != UserRole.root:
        raise HTTPException(status_code=403, detail="Only root can assign admin role")
    if data.role is not None:
        user.role = data.role
    if data.password is not None:
        user.password_hash = bcrypt.hashpw(data.password.encode(), bcrypt.gensalt()).decode()
    db.commit()
    db.refresh(user)
    log_action(db, me, "update", "user", user.id, f"Пользователь {user.username} обновлён")
    return user


@router.delete("/{user_id}", status_code=204)
def delete_user(
    user_id: int,
    db: Session = Depends(get_db),
    me: User = Depends(root_or_admin),
):
    if user_id == me.id:
        raise HTTPException(status_code=400, detail="You cannot delete your own account.")
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if user.role == UserRole.root:
        raise HTTPException(status_code=403, detail="Cannot delete root user")
    if user.role == UserRole.admin and me.role != UserRole.root:
        raise HTTPException(status_code=403, detail="Only root can delete admin users")
    if user.role in _ADMIN_ROLES and _admin_count(db) <= 1:
        raise HTTPException(status_code=400, detail="Cannot delete the last admin account.")
    username = user.username
    db.delete(user)
    db.commit()
    log_action(db, me, "delete", "user", user_id, f"Пользователь {username}")
