from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
import bcrypt

from ..database import get_db
from ..models.user import User, UserRole
from ..schemas.auth import UserResponse
from ..schemas.users import CreateUserRequest, UpdateUserRequest
from .auth import require_roles

router = APIRouter(prefix="/users", tags=["users"])

admin_only = require_roles([UserRole.admin])


@router.get("", response_model=list[UserResponse])
def list_users(
    db: Session = Depends(get_db),
    _: User = Depends(admin_only),
):
    return db.query(User).order_by(User.created_at).all()


@router.post("", response_model=UserResponse, status_code=201)
def create_user(
    data: CreateUserRequest,
    db: Session = Depends(get_db),
    _: User = Depends(admin_only),
):
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
    return user


@router.patch("/{user_id}", response_model=UserResponse)
def update_user(
    user_id: int,
    data: UpdateUserRequest,
    db: Session = Depends(get_db),
    _: User = Depends(admin_only),
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if data.role is not None:
        user.role = data.role
    if data.password is not None:
        user.password_hash = bcrypt.hashpw(data.password.encode(), bcrypt.gensalt()).decode()
    db.commit()
    db.refresh(user)
    return user


@router.delete("/{user_id}", status_code=204)
def delete_user(
    user_id: int,
    db: Session = Depends(get_db),
    admin: User = Depends(admin_only),
):
    if user_id == admin.id:
        raise HTTPException(status_code=400, detail="Cannot delete yourself")
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    db.delete(user)
    db.commit()
