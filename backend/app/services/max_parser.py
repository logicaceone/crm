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


def _norm_title(t: Optional[str]) -> str:
    """Normalise a chat title for tolerant comparison: lowercase, strip
    pipes, dashes, spaces and zero-width chars."""
    if not t:
        return ""
    s = t.lower()
    for ch in ("|", "—", "-", "‐", "−", "·", "•"):
        s = s.replace(ch, " ")
    return " ".join(s.split())


def _match_by_title(items: list[dict], channel_name: str) -> Optional[int]:
    """Find chat_id in `items` whose title best matches channel_name.

    Tries exact (normalised) match first, then a containment match in
    either direction so 'Светлый | Мамадыш' matches 'Светлый Мамадыш'
    and vice versa.
    """
    target = _norm_title(channel_name)
    if not target:
        return None
    # Exact normalised match wins.
    for item in items:
        if _norm_title(item.get("title")) == target:
            cid = item.get("chat_id") or item.get("id")
            return int(cid) if cid else None
    # Containment match — useful when one side has 'Светлый |' and the
    # other 'Светлый ' (just the pipe vs no pipe).
    for item in items:
        api_title = _norm_title(item.get("title"))
        if api_title and (api_title in target or target in api_title):
            cid = item.get("chat_id") or item.get("id")
            return int(cid) if cid else None
    return None


def is_join_link(raw: Optional[str]) -> bool:
    """True if `raw` looks like a Max.ru invite link (max.ru/join/HASH).

    Join links can't be resolved to a chat_id via the public Bot API —
    the bot must already be a member. Caller should fall back to
    matching by chat title against the bot's /chats list.
    """
    if not raw:
        return False
    return "max.ru/join/" in raw.strip().lower()


def normalize_chat_link(raw: Optional[str]) -> str:
    """Normalize a Max.ru chat link to a bare public username.

    Accepts public-link forms only:
      @channel
      channel
      max.ru/channel
      www.max.ru/channel
      https://max.ru/channel
      http://max.ru/channel
      https://max.ru/@channel
      max.ru/channel/about?utm=foo  (extra path/query trimmed)

    Returns "" for empty input OR for invite-link forms
    (max.ru/join/HASH) — those have no public username and must be
    resolved differently. Use is_join_link() to detect that case.
    """
    if not raw:
        return ""
    if is_join_link(raw):
        # Invite-hash links carry no public username. The first path
        # segment is literally "join", which is meaningless to the API.
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
    """Return a canonical 'https://max.ru/{name}' form for public links,
    pass invite links through unchanged, or None for empty."""
    if not raw:
        return None
    if is_join_link(raw):
        return raw.strip()
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

    async def _list_all_chats(self, client: httpx.AsyncClient) -> list[dict]:
        """Return every chat the bot is a member of, walking pagination.

        Max's /chats uses `marker` for cursor-style paging — fetch in
        batches of 100 until the response stops returning a next marker.
        """
        items: list[dict] = []
        marker: Optional[str] = None
        for _ in range(50):  # hard cap to stop runaway loops
            params: dict = {"count": 100}
            if marker:
                params["marker"] = marker
            try:
                data = await self._get(client, "/chats", **params)
            except MaxNotFoundError:
                break
            page = data.get("chats") or data.get("items") or []
            items.extend(page)
            marker = data.get("marker") or data.get("next_marker") or None
            if not marker or not page:
                break
        return items

    async def resolve_chat_id(
        self,
        chat_link: str,
        channel_name: Optional[str] = None,
    ) -> Optional[int]:
        """Resolve a Max.ru chat link to a numeric chat_id.

        Strategy:
          1. For public links (max.ru/{username}): GET /chats/{username}
             which works without scanning the bot's chat list.
          2. For invite links (max.ru/join/HASH) — and as a fallback when
             #1 fails — list every chat the bot is in and match by either
             `link` (public) or `title` (fuzzy, for invite-only).

        `channel_name` is required for invite-link resolution. Pass the
        local Channel.name so we can match it against the chat title in
        Max's chat list.
        """
        if is_join_link(chat_link):
            return await self._resolve_by_name(channel_name)

        username = normalize_chat_link(chat_link)
        if not username:
            return None

        async with httpx.AsyncClient(timeout=15) as client:
            # Attempt 1: direct GET /chats/{username}
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

            # Attempt 2: scan the full chat list and match by link
            items = await self._list_all_chats(client)
            username_lower = username.lower()
            for item in items:
                link_field = (item.get("link") or item.get("username") or "")
                if link_field.lower().rstrip("/").split("/")[-1] == username_lower:
                    cid = item.get("chat_id") or item.get("id")
                    return int(cid) if cid else None
            # Last fallback — match by title against channel_name if given.
            if channel_name:
                match = _match_by_title(items, channel_name)
                if match is not None:
                    logger.info("[MAX] resolve_chat_id: title-fallback %r -> %s", channel_name, match)
                    return match
            logger.warning(
                "[MAX] resolve_chat_id: no match for %r in %d items from /chats list",
                username, len(items),
            )
        return None

    async def _resolve_by_name(self, channel_name: Optional[str]) -> Optional[int]:
        if not channel_name:
            logger.warning("[MAX] resolve_by_name: no channel_name provided")
            return None
        async with httpx.AsyncClient(timeout=15) as client:
            items = await self._list_all_chats(client)
        match = _match_by_title(items, channel_name)
        if match is None:
            logger.warning(
                "[MAX] resolve_by_name: no chat titled %r among %d bot-member chats",
                channel_name, len(items),
            )
        return match

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

        Skips the GET /messages call entirely when posts_total == 0 —
        we already know the channel has no posts, so the API request
        would always come back empty (wasted RPS).

        Result: {'avg_views': int, 'posts_sampled': int, 'posts_total': int|None}
        """
        if posts_total == 0:
            logger.debug("[MAX] chat_id=%s has 0 posts — skipping /messages call", chat_id)
            return None

        # Don't ask for more posts than the channel actually has.
        count = posts_limit
        if posts_total is not None and posts_total > 0:
            count = min(posts_limit, posts_total)

        async with httpx.AsyncClient(timeout=15) as client:
            data = await self._get(client, "/messages", chat_id=chat_id, count=count)
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
