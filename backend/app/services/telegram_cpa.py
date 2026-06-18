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

    async def fetch_member_events(
        self, offset: Optional[int]
    ) -> tuple[list[dict], list[dict], Optional[int]]:
        """
        Fetch all new chat_member events since `offset`.

        Returns:
          join_events  — list of {"user_id", "chat_id", "invite_link"}
          leave_events — list of {"user_id", "chat_id"}
          new_offset   — int or None
        """
        join_events: list[dict] = []
        leave_events: list[dict] = []
        new_offset = offset

        while True:
            params: dict = {
                "allowed_updates": ["chat_member"],
                "limit": 100,
            }
            if new_offset is not None:
                params["offset"] = new_offset

            async with httpx.AsyncClient(timeout=30) as client:
                r = await client.post(self._url("getUpdates"), json=params)

            data = r.json()
            if not data.get("ok"):
                raise TelegramCPAError(f"Telegram API: {data.get('description', 'unknown error')}")

            updates = data.get("result", [])
            if not updates:
                break

            for update in updates:
                new_offset = update["update_id"] + 1
                cm = update.get("chat_member")
                if not cm:
                    continue

                chat_id: int = (cm.get("chat") or {}).get("id", 0)
                user_id: int = ((cm.get("new_chat_member") or {}).get("user") or {}).get("id", 0)
                if not chat_id or not user_id:
                    continue

                old_status = (cm.get("old_chat_member") or {}).get("status", "")
                new_status = (cm.get("new_chat_member") or {}).get("status", "")

                # Join: was outside, now inside
                if old_status in ("left", "kicked") and new_status in ("member", "administrator", "restricted"):
                    link_info = cm.get("invite_link") or {}
                    invite_link = link_info.get("invite_link")
                    if invite_link:
                        join_events.append({
                            "user_id": user_id,
                            "chat_id": chat_id,
                            "invite_link": invite_link,
                        })

                # Leave: was inside, now outside
                elif old_status in ("member", "administrator", "restricted") and new_status in ("left", "kicked"):
                    leave_events.append({"user_id": user_id, "chat_id": chat_id})

        return join_events, leave_events, new_offset
