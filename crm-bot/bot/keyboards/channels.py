from aiogram.types import InlineKeyboardMarkup
from aiogram.utils.keyboard import InlineKeyboardBuilder

PLATFORM_PREFIX = {
    "telegram": "TG",
    "max": "MAX",
}


def channels_keyboard(channels: list[dict]) -> InlineKeyboardMarkup:
    """One button per channel + a final 'Пропустить' row.

    Callback payload is just `ch:<id>` — the channel name lives in FSM
    state (set by the handler that builds this keyboard), so we never
    have to round-trip long Russian names through Telegram's 64-byte
    callback_data limit.
    """
    kb = InlineKeyboardBuilder()
    for ch in channels:
        prefix = PLATFORM_PREFIX.get(ch.get("platform", ""), "")
        label = f"[{prefix}] {ch['name']}" if prefix else ch["name"]
        # Telegram caps button text length too; truncate for safety.
        if len(label) > 60:
            label = label[:57] + "…"
        kb.button(text=label, callback_data=f"ch:{ch['id']}")
    kb.button(text="⤵️ Пропустить", callback_data="ch:skip")
    kb.adjust(1)
    return kb.as_markup()
