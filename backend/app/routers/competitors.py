from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ..database import get_db
from ..models.user import User, UserRole
from ..config import settings
from ..services.maxdash import (
    search_channels,
    check_token,
    MaxdashError,
    MaxdashAuthError,
    MaxdashNotConfigured,
)
from .auth import require_roles

router = APIRouter(tags=["competitors"])

read_access = require_roles([UserRole.root, UserRole.admin, UserRole.manager, UserRole.viewer])
root_only = require_roles([UserRole.root])


@router.get("/competitors/search")
async def competitors_search(
    q: Optional[str] = Query(default=None),
    region: Optional[str] = Query(default=None),
    category: Optional[str] = Query(default=None),
    participants_min: Optional[int] = Query(default=None, ge=0),
    participants_max: Optional[int] = Query(default=None, ge=0),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    _: User = Depends(read_access),
):
    """Cached MaxDash /channels/search proxy.

    Defaults to `region=Республика Татарстан`, `category=Новости и СМИ`
    so the page opens immediately with the local-news rating. Empty
    string from the client means "no filter" and resets the default.
    """
    # `is None` (not falsy) so users can pass an explicit empty string
    # to clear the default region/category.
    if region is None:
        region = settings.maxdash_default_region
    if category is None:
        category = settings.maxdash_default_category

    try:
        return await search_channels(
            db,
            q=q or None,
            region=region or None,
            category=category or None,
            participants_min=participants_min,
            participants_max=participants_max,
            limit=limit,
            offset=offset,
        )
    except MaxdashNotConfigured:
        raise HTTPException(
            status_code=503,
            detail="MaxDash API не настроен. Добавьте токен в Настройках.",
        )
    except MaxdashAuthError as e:
        raise HTTPException(status_code=502, detail=f"MaxDash auth: {e}")
    except MaxdashError as e:
        raise HTTPException(status_code=502, detail=f"MaxDash: {e}")


@router.get("/maxdash/check")
async def maxdash_check(
    db: Session = Depends(get_db),
    _: User = Depends(root_only),
):
    """Root-only — verify the token by calling /usage/stat."""
    try:
        return await check_token(db)
    except MaxdashNotConfigured:
        raise HTTPException(status_code=400, detail="Токен не задан")
    except MaxdashAuthError as e:
        raise HTTPException(status_code=401, detail=f"Токен недействителен: {e}")
    except MaxdashError as e:
        raise HTTPException(status_code=502, detail=str(e))
