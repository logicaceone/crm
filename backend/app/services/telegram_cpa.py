import logging
import httpx
from typing import Optional

logger = logging.getLogger(__name__)


class TelegramCPAError(Exception):
    pass


class TelegramWebhookConflict(RuntimeError):
    """Raised when a webhook is active on the bot token.

    After the switch to per-link getChatInviteLink the CPA sync itself
    no longer collides with a webhook, but having one set still
    signals a likely misconfiguration that may break other bot flows.
    """


async def check_webhook_conflict(bot_token: str) -> Optional[str]:
    """Check whether the bot token has an active webhook.

    Returns the webhook URL if one is configured (and logs an error).
    Returns None if no webhook is set.
    Raises TelegramWebhookConflict if a webhook URL is present — caller
    decides whether to abort.
    """
    if not bot_token:
        return None
    url = f"https://api.telegram.org/bot{bot_token}/getWebhookInfo"
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.get(url)
    data = r.json()
    if not data.get("ok"):
        logger.warning(
            "Telegram getWebhookInfo failed: %s",
            data.get("description", "unknown error"),
        )
        return None
    webhook_url = (data.get("result") or {}).get("url") or ""
    if webhook_url:
        logger.error(
            "TELEGRAM CPA WARNING: Webhook is active → %s. "
            "getUpdates would return 409 Conflict. "
            "Remove webhook via POST /api/settings/telegram/delete-webhook "
            "or directly via the Telegram Bot API deleteWebhook.",
            webhook_url,
        )
        raise TelegramWebhookConflict(
            f"Telegram webhook conflict detected ({webhook_url})."
        )
    return None


async def delete_webhook(bot_token: str) -> dict:
    """Delete any active webhook on the bot token.

    Returns the raw Telegram API response.
    """
    if not bot_token:
        raise TelegramCPAError("Bot token не задан")
    url = f"https://api.telegram.org/bot{bot_token}/deleteWebhook"
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.post(url, json={"drop_pending_updates": True})
    data = r.json()
    if not data.get("ok"):
        raise TelegramCPAError(
            f"Telegram API: {data.get('description', 'unknown error')}"
        )
    return data


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
