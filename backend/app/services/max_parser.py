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


def normalize_chat_link(raw: Optional[str]) -> str:
    """Normalize any reasonable Max.ru chat link to a bare username.

    Accepts:
      @channel
      channel
      max.ru/channel
      www.max.ru/channel
      https://max.ru/channel
      http://max.ru/channel
      https://max.ru/@channel
      max.ru/channel/about?utm=foo  (extra path/query trimmed)

    Returns the bare 'channel' identifier. Empty string when nothing
    salvageable was found (caller can treat as invalid input).
    """
    if not raw:
        return ""
    link = raw.strip()
    for scheme in ("https://", "http://"):
        if link.startswith(scheme):
            link = link[len(scheme):]
            break
    if link.startswith("www."):
        link = link[4:]
    if link.startswith("max.ru/"):
        link = link[len("max.ru/"):]
    if link.startswith("@"):
        link = link[1:]
    link = link.split("/")[0].split("?")[0].strip()
    return link


def canonical_chat_link(raw: Optional[str]) -> Optional[str]:
    """Return a canonical 'https://max.ru/{name}' form, or None for empty."""
    name = normalize_chat_link(raw)
    if not name:
        return None
    return f"https://max.ru/{name}"


class MaxParserService:
    def __init__(self, bot_token: str, base_url: str = "https://platform-api.max.ru"):
        self.bot_token = bot_token
        self.base_url = base_url.rstrip("/")

    @property
    def _headers(self) -> dict:
        return {"Authorization": self.bot_token}

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
        """Resolve a Max.ru chat link to a numeric chat_id.
        Tries GET /chats/{username} first (direct lookup), then falls back to
        scanning the paginated list and matching by link field.
        """
        username = normalize_chat_link(chat_link)
        if not username:
            return None

        async with httpx.AsyncClient(timeout=15) as client:
            # Attempt 1: direct path lookup GET /chats/{username}
            try:
                data = await self._get(client, f"/chats/{username}")
                chat = data.get("chat") or data
                cid = chat.get("chat_id") or chat.get("id")
                if cid:
                    logger.info("[MAX] resolve_chat_id: direct lookup OK %r -> %s", username, cid)
                    return int(cid)
            except MaxNotFoundError:
                logger.info("[MAX] resolve_chat_id: direct GET /chats/%s returned 404, trying list", username)
            except MaxAuthError:
                raise

            # Attempt 2: list and match by link field
            try:
                data = await self._get(client, "/chats", username=username)
                items = data.get("chats") or data.get("items") or []
                username_lower = username.lower()
                for item in items:
                    link_field = (item.get("link") or item.get("username") or "")
                    if link_field.lower().rstrip("/").split("/")[-1] == username_lower:
                        cid = item.get("chat_id") or item.get("id")
                        return int(cid) if cid else None
                logger.warning(
                    "[MAX] resolve_chat_id: no match for %r in %d items from /chats list",
                    username, len(items),
                )
            except MaxNotFoundError:
                pass
        return None

    async def get_chat_info(self, chat_id: int) -> dict:
        """Return {'subscribers': int|None, 'posts_total': int|None} from GET /chats/{chat_id}."""
        async with httpx.AsyncClient(timeout=15) as client:
            data = await self._get(client, f"/chats/{chat_id}")
            chat = data.get("chat") or data
            return {
                "subscribers": chat.get("participants_count") or chat.get("members_count"),
                "posts_total": chat.get("messages_count"),
            }

    async def get_avg_views(
        self,
        chat_id: int,
        posts_total: Optional[int],
        posts_limit: int = 20,
    ) -> Optional[dict]:
        """
        Return avg views computed from last `posts_limit` posts.
        Only messages with a `stat` field are included (channel posts).
        Returns None if there are no eligible posts.
        Result: {'avg_views': int, 'posts_sampled': int, 'posts_total': int|None}
        """
        async with httpx.AsyncClient(timeout=15) as client:
            data = await self._get(client, "/messages", chat_id=chat_id, count=posts_limit)
            messages = data.get("messages") or data.get("items") or []

        views = []
        for msg in messages:
            stat = msg.get("stat")
            if stat is not None and stat.get("views") is not None:
                views.append(stat["views"])

        if not views:
            return None

        return {
            "avg_views": round(sum(views) / len(views)),
            "posts_sampled": len(views),
            "posts_total": posts_total,
        }
