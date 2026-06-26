"""Thin async client for the CRM /bot/* API.

Every request carries the shared X-Bot-Token header. Errors are swallowed
and surface as None so handlers can render a friendly fallback instead
of crashing the polling loop when the CRM is briefly unreachable.
"""
import logging
from typing import Any, Optional

import httpx

from bot.config import settings

logger = logging.getLogger(__name__)

DEFAULT_TIMEOUT = httpx.Timeout(10.0, connect=5.0)


def _headers() -> dict[str, str]:
    return {"X-Bot-Token": settings.bot_api_key}


async def crm_get(path: str) -> Optional[Any]:
    url = f"{settings.crm_api_url.rstrip('/')}{path}"
    try:
        async with httpx.AsyncClient(timeout=DEFAULT_TIMEOUT) as client:
            r = await client.get(url, headers=_headers())
    except httpx.HTTPError as e:
        logger.warning("CRM GET %s failed: %s", path, e)
        return None
    if r.status_code == 404:
        return None
    if r.status_code >= 400:
        logger.warning("CRM GET %s -> %s: %s", path, r.status_code, r.text[:200])
        return None
    try:
        return r.json()
    except ValueError:
        logger.warning("CRM GET %s returned non-JSON body", path)
        return None


async def crm_post(path: str, json: dict[str, Any]) -> Optional[Any]:
    url = f"{settings.crm_api_url.rstrip('/')}{path}"
    try:
        async with httpx.AsyncClient(timeout=DEFAULT_TIMEOUT) as client:
            r = await client.post(url, headers=_headers(), json=json)
    except httpx.HTTPError as e:
        logger.warning("CRM POST %s failed: %s", path, e)
        return None
    if r.status_code >= 400:
        logger.warning("CRM POST %s -> %s: %s", path, r.status_code, r.text[:200])
        return None
    try:
        return r.json()
    except ValueError:
        return None


async def get_channels() -> Optional[list[dict]]:
    return await crm_get("/bot/channels")


async def create_expense(payload: dict) -> Optional[dict]:
    return await crm_post("/bot/expenses", payload)
