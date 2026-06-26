"""Resolve a Telegram user to a CRM user via telegram_username.

Returns None whenever the lookup fails — no TG username, CRM unreachable,
no matching user, etc. Handlers treat None as "no access".
"""
import logging
from typing import Optional

from aiogram.types import Message

from bot.services.crm_api import crm_get

logger = logging.getLogger(__name__)


async def get_crm_user(message: Message) -> Optional[dict]:
    if not message.from_user or not message.from_user.username:
        return None
    username = message.from_user.username.lstrip("@")
    return await crm_get(f"/bot/user/{username}")
