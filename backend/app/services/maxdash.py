"""MaxDash API client + 24h response cache.

MaxDash bills per request, so all calls go through the maxdash_cache
table. cache_key is a hash of the filter params — same filters
served from a single API call regardless of how many users open the
competitors page.

Token is stored in system_settings (root-managed), not in .env, so
it can be rotated through the UI without a redeploy.
"""
import hashlib
import json
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

import httpx
from sqlalchemy.orm import Session

from ..config import settings
from ..db_settings import get_setting, set_setting
from ..models.maxdash_cache import MaxdashCache

logger = logging.getLogger(__name__)

BASE_URL = "https://maxdash.ru/api/v1"
TOKEN_KEY = "maxdash_api_token"


class MaxdashError(Exception):
    pass


class MaxdashAuthError(MaxdashError):
    pass


class MaxdashNotConfigured(MaxdashError):
    pass


def get_token(db: Session) -> Optional[str]:
    return get_setting(db, TOKEN_KEY)


def set_token(db: Session, value: Optional[str]) -> None:
    set_setting(db, TOKEN_KEY, value or None)
    db.commit()


def _cache_key(*, q: Optional[str], region: Optional[str], category: Optional[str],
               participants_min: Optional[int], participants_max: Optional[int],
               limit: int, offset: int) -> str:
    """Deterministic key. SHA-1 over the canonical form is short and
    safe in a varchar column; collisions are not a concern at this
    cardinality."""
    payload = json.dumps({
        "q": q or "",
        "region": region or "",
        "category": category or "",
        "pmin": participants_min,
        "pmax": participants_max,
        "limit": limit,
        "offset": offset,
    }, sort_keys=True, ensure_ascii=False)
    return "rt:" + hashlib.sha1(payload.encode("utf-8")).hexdigest()


def _get_cached(db: Session, cache_key: str) -> Optional[dict]:
    row = db.query(MaxdashCache).filter(MaxdashCache.cache_key == cache_key).first()
    if not row:
        return None
    if row.expires_at and row.expires_at < datetime.now(timezone.utc):
        return None
    try:
        payload = json.loads(row.data)
    except Exception:
        # Corrupted cache row — drop it, force a refetch.
        db.delete(row)
        db.commit()
        return None
    payload["cached_at"] = row.cached_at.isoformat() if row.cached_at else None
    return payload


def _store_cache(db: Session, cache_key: str, payload: dict) -> None:
    # JSON-serializable form: stash without the cached_at injection.
    body = {k: v for k, v in payload.items() if k != "cached_at"}
    expires = datetime.now(timezone.utc) + timedelta(hours=settings.maxdash_cache_ttl_hours)
    existing = db.query(MaxdashCache).filter(MaxdashCache.cache_key == cache_key).first()
    if existing:
        existing.data = json.dumps(body, ensure_ascii=False)
        existing.cached_at = datetime.now(timezone.utc)
        existing.expires_at = expires
    else:
        db.add(MaxdashCache(
            cache_key=cache_key,
            data=json.dumps(body, ensure_ascii=False),
            expires_at=expires,
        ))
    db.commit()


async def _api_get(path: str, params: dict, timeout: float = 30.0) -> dict:
    url = f"{BASE_URL}{path}"
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            r = await client.get(url, params=params)
    except Exception as exc:
        logger.error("MaxDash GET %s failed (network): %s", path, exc)
        raise MaxdashError(f"Network error: {exc}") from exc

    if r.status_code in (401, 403):
        raise MaxdashAuthError(f"MaxDash auth error {r.status_code}")
    if r.status_code >= 400:
        raise MaxdashError(f"MaxDash {r.status_code}: {r.text[:300]}")
    try:
        return r.json()
    except Exception as exc:
        raise MaxdashError(f"Bad JSON from MaxDash: {exc}") from exc


async def search_channels(
    db: Session,
    *,
    q: Optional[str] = None,
    region: Optional[str] = None,
    category: Optional[str] = None,
    participants_min: Optional[int] = None,
    participants_max: Optional[int] = None,
    limit: int = 100,
    offset: int = 0,
    bypass_cache: bool = False,
) -> dict:
    """Return MaxDash channels-search response, either from cache or
    via a fresh API call (which is then cached for ttl).

    The returned dict carries `cached_at` so the UI can show when the
    data was last refreshed.
    """
    key = _cache_key(
        q=q, region=region, category=category,
        participants_min=participants_min, participants_max=participants_max,
        limit=limit, offset=offset,
    )
    if not bypass_cache:
        cached = _get_cached(db, key)
        if cached is not None:
            return cached

    token = get_token(db)
    if not token:
        raise MaxdashNotConfigured("MaxDash token is not set")

    params: dict[str, object] = {"token": token, "limit": limit, "offset": offset}
    if q:
        params["q"] = q
    if region:
        params["region"] = region
    if category:
        params["category"] = category
    if participants_min is not None:
        params["participants_min"] = participants_min
    if participants_max is not None:
        params["participants_max"] = participants_max

    raw = await _api_get("/channels/search", params)
    # MaxDash wraps results in {"response": {...}}; tolerate either form.
    response = raw.get("response") if isinstance(raw, dict) else None
    if response is None:
        response = raw
    if not isinstance(response, dict):
        raise MaxdashError(f"Unexpected MaxDash payload shape: {type(response).__name__}")

    _store_cache(db, key, response)
    # Echo cached_at to the caller so the first request also gets the
    # 'as of' timestamp.
    response = {**response, "cached_at": datetime.now(timezone.utc).isoformat()}
    return response


async def check_token(db: Session) -> dict:
    """Hit /usage/stat — confirms the token works and returns the plan
    info. Bypasses the cache (we want a live answer)."""
    token = get_token(db)
    if not token:
        raise MaxdashNotConfigured("MaxDash token is not set")
    return await _api_get("/usage/stat", {"token": token}, timeout=10)


async def refresh_default_cache(db: Session) -> Optional[dict]:
    """Background-job entry point — refresh the default Tatar+News view.

    Returns the payload on success, None if the token isn't set. We do
    not raise; the scheduler swallows the rest.
    """
    if not get_token(db):
        logger.warning("MaxDash token not set — skipping cache refresh")
        return None
    return await search_channels(
        db,
        region=settings.maxdash_default_region,
        category=settings.maxdash_default_category,
        limit=100,
        bypass_cache=True,
    )
