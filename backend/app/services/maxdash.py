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


# MaxDash advertises max limit=100, in practice the API returns at most
# 30 items per call regardless of limit. We page through offset to
# accumulate the whole result, just like their own web UI does.
MAXDASH_PAGE_SIZE = 30
# Safety cap so a misconfigured client can't drain the monthly quota.
MAXDASH_MAX_FETCH = 3000


async def _resolve_region_variants(db: Session, needle: str) -> list[str]:
    """Return MaxDash region names whose name contains any of the
    comma-separated substrings in `needle` (case-insensitive).

    Examples:
      "Татарстан"          → 20+ names containing "Татарстан"
      "Татарстан,Казань"   → union, dedup'd by exact name

    Multi-substring is the only way to cover region families where
    MaxDash uses divergent naming for the same place — e.g. "Казань
    Светлый" lives in region ['Казань'] (no "Татарстан" in that
    string), so a single Татарстан substring would miss it.

    The resolved list is cached 24h so this doesn't burn quota.
    """
    if not needle:
        return []
    key = f"rt:regions:{needle.lower()}"
    cached = _get_cached(db, key)
    if cached is not None and isinstance(cached.get("variants"), list):
        return cached["variants"]

    token = get_token(db)
    if not token:
        return []
    data = await _api_get("/database/regions", {"token": token})
    regs = data.get("response") if isinstance(data, dict) else None
    if not isinstance(regs, list):
        return []
    needles = [s.strip().lower() for s in needle.split(",") if s.strip()]
    if not needles:
        return []
    # Word-boundary match. Plain substring catches false positives like
    # "Арск" matching "КраснодАрский край" or "Бавлы" matching anything
    # ending in -бавлы. \b in Python re works against Unicode \w which
    # includes Russian letters.
    import re
    patterns = [re.compile(rf"\b{re.escape(n)}\b", re.IGNORECASE) for n in needles]
    variants: list[str] = []
    seen: set[str] = set()
    for r in regs:
        if not isinstance(r, dict):
            continue
        name = r.get("name")
        if not isinstance(name, str):
            continue
        if any(p.search(name) for p in patterns) and name not in seen:
            seen.add(name)
            variants.append(name)
    _store_cache(db, key, {"variants": variants})
    return variants


async def search_channels(
    db: Session,
    *,
    q: Optional[str] = None,
    region: Optional[str] = None,
    category: Optional[str] = None,
    participants_min: Optional[int] = None,
    participants_max: Optional[int] = None,
    limit: int = 500,
    offset: int = 0,
    bypass_cache: bool = False,
) -> dict:
    """MaxDash channels-search, paginated + post-filtered + sorted.

    Pipeline:
      1. Page through /channels/search (30 per call) until `limit` items
         collected or the API runs out. `region` is NOT sent to the API
         (their exact-match misses 'Татарстан' / 'Казань' variants);
         everything else passes through.
      2. If `region` is set, drop items whose region array doesn't
         substring-match it — gives us the same channels as the public
         "Рейтинг" page.
      3. Sort by participants_count DESC, assign `rank` starting from 1.
      4. Cache the whole sorted list 24h, return with `cached_at`.

    On the api_stat_S tier, /channels/search is billed against
    api_stat_S (not api_search_S). A typical category fetch is
    ~10-50 API calls per cache refresh.
    """
    capped_limit = min(max(limit, 0), MAXDASH_MAX_FETCH)

    key = _cache_key(
        q=q, region=region, category=category,
        participants_min=participants_min, participants_max=participants_max,
        limit=capped_limit, offset=offset,
    )
    if not bypass_cache:
        cached = _get_cached(db, key)
        if cached is not None:
            return cached

    token = get_token(db)
    if not token:
        raise MaxdashNotConfigured("MaxDash token is not set")

    base_params: dict[str, object] = {"token": token}
    if q:
        base_params["q"] = q
    if category:
        base_params["category"] = category
    if participants_min is not None:
        base_params["participants_min"] = participants_min
    if participants_max is not None:
        base_params["participants_max"] = participants_max

    # MaxDash quirk: `region` data is only returned when `region` is
    # part of the query. To cover a region "family" (Татарстан and
    # its districts/cities) we must hit /channels/search once per
    # exact region name, then dedupe.
    if region:
        region_variants = await _resolve_region_variants(db, region)
        # Fall back to the literal value if nothing matched the
        # substring (lets the user still type a single exact name).
        if not region_variants:
            region_variants = [region]
    else:
        region_variants = [None]

    collected_by_id: dict[str, dict] = {}

    async def _fetch_for(region_name: Optional[str]) -> list[dict]:
        """Fetch all pages for one region variant. Returns list of items.
        Each variant is independent → safe to fan out via asyncio.gather.
        """
        out: list[dict] = []
        cur_offset = offset
        remaining = capped_limit
        while remaining > 0:
            page_size = min(remaining, MAXDASH_PAGE_SIZE)
            params = {**base_params, "limit": page_size, "offset": cur_offset}
            if region_name:
                params["region"] = region_name
            raw = await _api_get("/channels/search", params)
            page_response = raw.get("response") if isinstance(raw, dict) else None
            if page_response is None:
                page_response = raw
            if not isinstance(page_response, dict):
                raise MaxdashError(
                    f"Unexpected MaxDash payload shape: {type(page_response).__name__}"
                )
            items = page_response.get("items") or page_response.get("channels") or []
            if not isinstance(items, list):
                items = []
            out.extend(items)
            if len(items) < page_size:
                break
            cur_offset += page_size
            remaining -= page_size
        return out

    # Fan out across region variants in parallel — 28 sequential calls
    # was the main bottleneck (~30s). MaxDash hasn't pushed back on
    # parallelism so far; if they start rate-limiting later, throttle
    # via asyncio.Semaphore here.
    import asyncio as _asyncio
    results = await _asyncio.gather(*[_fetch_for(v) for v in region_variants])
    for items in results:
        for it in items:
            k = str(it.get("id") or it.get("username") or it.get("title"))
            if k and k not in collected_by_id:
                collected_by_id[k] = it

    # Brand-name backfill: small-town "Светлый" channels often live in
    # region=['<city>'] strings that don't match the regional filter
    # (Бугульма, Азнакаево, Елабуга…). Pull them in by title search
    # so they're always in the list, regardless of region tagging.
    # Only triggers on the default region fetch (no user q), and only
    # when caller didn't already pass a brand-overriding `q`.
    if not q and settings.maxdash_brand_keywords:
        for brand in (b.strip() for b in settings.maxdash_brand_keywords.split(",")):
            if not brand:
                continue
            brand_params: dict[str, object] = {
                "token": token,
                "q": brand,
                "search_by_title": 1,
                "limit": MAXDASH_PAGE_SIZE,
            }
            if category:
                brand_params["category"] = category
            # Keep participants_min from main args — branded channels
            # below it are noise (small schools, kindergartens in towns
            # called "Светлый") and would crowd out real targets.
            if participants_min is not None:
                brand_params["participants_min"] = participants_min
            cur_off = 0
            while True:
                params = {**brand_params, "offset": cur_off}
                raw = await _api_get("/channels/search", params)
                page_response = raw.get("response") if isinstance(raw, dict) else {}
                items = (page_response or {}).get("items") or []
                if not isinstance(items, list) or not items:
                    break
                import re
                brand_re = re.compile(rf"\b{re.escape(brand)}\b", re.IGNORECASE)
                # Regional allow-list. Empty region passes (channel has
                # no region tag at all — some Светлый-branded channels
                # come this way). Populated region must intersect our
                # default region substring list so non-Tatar Подслушано
                # variants from Москва/Свердловск don't sneak in.
                allowed_regions_lower = {v.lower() for v in region_variants if v}
                for it in items:
                    title = it.get("title") or ""
                    if not brand_re.search(title):
                        continue
                    item_regions = it.get("region") or []
                    if isinstance(item_regions, str):
                        item_regions = [item_regions]
                    if item_regions:
                        if not any(str(r).lower() in allowed_regions_lower for r in item_regions):
                            continue
                    k = str(it.get("id") or it.get("username") or it.get("title"))
                    if k and k not in collected_by_id:
                        collected_by_id[k] = it
                if len(items) < MAXDASH_PAGE_SIZE:
                    break
                cur_off += MAXDASH_PAGE_SIZE

    collected = list(collected_by_id.values())

    # Sort by participants DESC and assign a stable rank. None / missing
    # subscriber counts fall to the bottom.
    collected.sort(
        key=lambda it: (it.get("participants_count") or 0),
        reverse=True,
    )
    for i, it in enumerate(collected, 1):
        it["rank"] = i

    response = {"count": len(collected), "items": collected}
    _store_cache(db, key, response)
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
        participants_min=settings.maxdash_default_participants_min,
        limit=2000,
        bypass_cache=True,
    )
