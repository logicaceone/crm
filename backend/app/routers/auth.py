import logging

from fastapi import APIRouter, Depends, HTTPException, Response, Cookie, Request
from sqlalchemy.orm import Session
import bcrypt
from itsdangerous import URLSafeTimedSerializer, BadSignature, SignatureExpired

from ..database import get_db
from ..models.user import User, UserRole
from ..schemas.auth import LoginRequest, UserResponse
from ..config import settings
from ..rate_limit import limiter, get_real_ip

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["auth"])

SESSION_COOKIE = "session"
SESSION_MAX_AGE = 7 * 24 * 3600  # 7 days

# Cookie attributes used at both set_cookie and delete_cookie time.
# Browsers only honour the deletion when path/samesite match the original
# set — mismatched attributes leave the cookie in place and the user stays
# logged in.
_COOKIE_PATH = "/"
_COOKIE_SAMESITE = "lax"
_COOKIE_SECURE = False  # flip to True for HTTPS-only deployments


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


def require_roles(roles: list[UserRole]):
    def dependency(current_user: User = Depends(get_current_user)) -> User:
        if current_user.role not in roles:
            raise HTTPException(status_code=403, detail="Forbidden")
        return current_user
    return dependency


@router.post("/login", response_model=UserResponse)
@limiter.limit("5/5minutes")
def login(
    request: Request,
    data: LoginRequest,
    response: Response,
    db: Session = Depends(get_db),
):
    # NB: `request` must be a real `Request` parameter (not Depends) so
    # slowapi can read it via the function signature. The limit counts
    # every call — successful logins also consume budget, but legitimate
    # users won't hit 5/5min in practice.
    user = db.query(User).filter(User.username == data.username).first()
    if not user or not bcrypt.checkpw(data.password.encode(), user.password_hash.encode()):
        logger.warning(
            "Failed login attempt: username=%r ip=%s",
            data.username, get_real_ip(request),
        )
        raise HTTPException(status_code=401, detail="Invalid credentials")
    token = _serializer().dumps(user.id)
    response.set_cookie(
        key=SESSION_COOKIE,
        value=token,
        httponly=True,
        max_age=SESSION_MAX_AGE,
        path=_COOKIE_PATH,
        samesite=_COOKIE_SAMESITE,
        secure=_COOKIE_SECURE,
    )
    return UserResponse.model_validate(user)


@router.post("/logout")
def logout(response: Response):
    # The session token is stateless (signed via itsdangerous), so there is
    # no server-side store to clear — deleting the browser cookie is what
    # severs the session. Attributes must match the original set_cookie call
    # for the browser to accept the deletion.
    response.delete_cookie(
        key=SESSION_COOKIE,
        path=_COOKIE_PATH,
        samesite=_COOKIE_SAMESITE,
        secure=_COOKIE_SECURE,
    )
    return {"message": "Logged out"}


@router.get("/me", response_model=UserResponse)
def me(current_user: User = Depends(get_current_user)):
    return current_user
