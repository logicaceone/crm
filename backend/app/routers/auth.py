from fastapi import APIRouter, Depends, HTTPException, Response, Cookie
from sqlalchemy.orm import Session
from passlib.context import CryptContext
from itsdangerous import URLSafeTimedSerializer, BadSignature, SignatureExpired

from ..database import get_db
from ..models.user import User
from ..schemas.auth import LoginRequest, UserResponse
from ..config import settings

router = APIRouter(prefix="/auth", tags=["auth"])
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

SESSION_COOKIE = "session"
SESSION_MAX_AGE = 7 * 24 * 3600  # 7 days


def _serializer() -> URLSafeTimedSerializer:
    return URLSafeTimedSerializer(settings.secret_key)


def get_current_user(
    session: str | None = Cookie(default=None),
    db: Session = Depends(get_db),
) -> User:
    if not session:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        user_id = _serializer().loads(session, max_age=SESSION_MAX_AGE)
    except (BadSignature, SignatureExpired):
        raise HTTPException(status_code=401, detail="Invalid or expired session")
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user


@router.post("/login", response_model=UserResponse)
def login(data: LoginRequest, response: Response, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == data.username).first()
    if not user or not pwd_context.verify(data.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    token = _serializer().dumps(user.id)
    response.set_cookie(
        key=SESSION_COOKIE,
        value=token,
        httponly=True,
        max_age=SESSION_MAX_AGE,
        samesite="lax",
    )
    return UserResponse.model_validate(user)


@router.post("/logout")
def logout(response: Response):
    response.delete_cookie(key=SESSION_COOKIE)
    return {"message": "Logged out"}


@router.get("/me", response_model=UserResponse)
def me(current_user: User = Depends(get_current_user)):
    return current_user
