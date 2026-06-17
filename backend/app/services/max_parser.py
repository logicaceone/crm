import asyncio
import logging
from typing import Optional

import httpx

logger = logging.getLogger(__name__)

_RETRY_DELAYS = (5, 15, 60)


class MaxApiError(Exception):
    pass


class MaxAuthError(MaxApiError):
    pass


class MaxNotFoundError(MaxApiError):
    pass


class MaxParserService:
    def __init__(self, bot_token: str, base_url: str = "https://platform-api.max.ru"):
        self.bot_token = bot_token
        self.base_url = base_url.rstrip("/")

    @property
    def _headers(self) -> dict:
        return {"Authorization": f"Bearer {self.bot_token}"}

    async def _get(self, client: httpx.AsyncClient, path: str, **params) -> dict:
        url = f"{self.base_url}{path}"
        last_exc: Exception = RuntimeError("unreachable")
        for attempt, delay in enumerate((*_RETRY_DELAYS, None)):
            try:
                r = await client.get(url, headers=self._headers, params=params or None, timeout=15)
                if r.status_code == 429:
                    logger.warning("[MAX] Rate-limited on %s, waiting 60s", path)
                    await asyncio.sleep(60)
                    continue
                if r.status_code in (401, 403):
                    raise MaxAuthError(f"Auth error {r.status_code} for {path}")
                if r.status_code == 404:
                    raise MaxNotFoundError(f"Not found: {path}")
                r.raise_for_status()
                return r.json()
            except (MaxAuthError, MaxNotFoundError):
                raise
            except Exception as exc:
                last_exc = exc
                if delay is None:
                    raise MaxApiError(f"Network error after retries for {path}: {exc}") from exc
                logger.warning("[MAX] Network error for %s, retry in %ds: %s", path, delay, exc)
                await asyncio.sleep(delay)
        raise last_exc

    async def resolve_chat_id(self, chat_link: str) -> Optional[int]:
        """Resolve a Max.ru chat link to a numeric chat_id via username lookup."""
        username = chat_link.strip().rstrip("/")
        for prefix in ("https://max.ru/", "http://max.ru/", "@"):
            if username.startswith(prefix):
                username = username[len(prefix):]
                break
        username = username.split("/")[0].split("?")[0]
        if not username:
            return None

        async with httpx.AsyncClient(timeout=15) as client:
            try:
                data = await self._get(client, "/v1/chats", username=username)
                items = data.get("chats") or data.get("items") or []
                if items:
                    return items[0].get("chat_id") or items[0].get("id")
            except MaxNotFoundError:
                pass
        return None

    async def get_subscribers(self, chat_id: int) -> Optional[int]:
        """Return current member/subscriber count for a Max.ru chat."""
        async with httpx.AsyncClient(timeout=15) as client:
            data = await self._get(client, f"/v1/chats/{chat_id}")
            chat = data.get("chat") or data
            return chat.get("members_count") or chat.get("subscribers_count")

    async def get_avg_views(self, chat_id: int, last_n: int = 20) -> Optional[int]:
        """Return average views across the last `last_n` messages."""
        async with httpx.AsyncClient(timeout=15) as client:
            data = await self._get(client, f"/v1/chats/{chat_id}/messages", count=last_n)
            messages = data.get("messages") or data.get("items") or []
            views = [m["views"] for m in messages if m.get("views") is not None]
            if not views:
                return None
            return int(sum(views) / len(views))
