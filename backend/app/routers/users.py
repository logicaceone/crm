from fastapi import APIRouter, Depends, HTTPException
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


@router.get("", response_model=list[UserResponse])
def list_users(
    db: Session = Depends(get_db),
    _: User = Depends(root_or_admin),
):
    return db.query(User).order_by(User.created_at).all()


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
        raise HTTPException(status_code=400, detail="Cannot delete yourself")
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if user.role == UserRole.root:
        raise HTTPException(status_code=403, detail="Cannot delete root user")
    if user.role == UserRole.admin and me.role != UserRole.root:
        raise HTTPException(status_code=403, detail="Only root can delete admin users")
    username = user.username
    db.delete(user)
    db.commit()
    log_action(db, me, "delete", "user", user_id, f"Пользователь {username}")
