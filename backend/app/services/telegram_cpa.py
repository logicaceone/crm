import httpx
from typing import Optional


class TelegramCPAError(Exception):
    pass


def _extract_username(tg_link: str) -> Optional[str]:
    link = tg_link.strip()
    for prefix in ("https://t.me/", "http://t.me/"):
        if link.startswith(prefix):
            return link[len(prefix):].split("/")[0].split("?")[0] or None
    if link.startswith("@"):
        return link[1:] or None
    return link or None


class TelegramCPAService:
    _BASE = "https://api.telegram.org"

    def __init__(self, bot_token: str):
        self._token = bot_token

    def _url(self, method: str) -> str:
        return f"{self._BASE}/bot{self._token}/{method}"

    async def create_invite_link(self, tg_link: str, purchase_id: int) -> str:
        """Create a named invite link for the channel and return the URL."""
        username = _extract_username(tg_link)
        if not username:
            raise TelegramCPAError("Не удалось определить username канала из tg_link")
        chat_id = f"@{username}"
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.post(
                self._url("createChatInviteLink"),
                json={"chat_id": chat_id, "name": f"Закупка #{purchase_id}"},
            )
        data = r.json()
        if not data.get("ok"):
            raise TelegramCPAError(f"Telegram API: {data.get('description', 'unknown error')}")
        return data["result"]["invite_link"]

    async def get_invite_link_member_count(self, chat_id: str, invite_link: str) -> int:
        """Return number of members who joined via the given invite link.

        Calls Telegram getChatInviteLink — per-link query, no offset state,
        no race conditions across parallel calls.
        """
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.post(
                self._url("getChatInviteLink"),
                json={"chat_id": chat_id, "invite_link": invite_link},
            )
        data = r.json()
        if not data.get("ok"):
            raise TelegramCPAError(f"Telegram API: {data.get('description', 'unknown error')}")
        result = data.get("result") or {}
        return int(result.get("member_count", 0))
