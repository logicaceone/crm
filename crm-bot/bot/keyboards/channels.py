from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup

PLATFORM_EMOJI = {
    "telegram": "TG",
    "max": "MAX",
}

# Hard cap on callback_data length set by Telegram. Keep margin for the
# `ch:<id>:` prefix.
_CALLBACK_MAX = 64


def _name_for_callback(name: str, prefix_len: int) -> str:
    """Trim by bytes (UTF-8) so Cyrillic names don't blow the 64-byte
    callback_data ceiling. Falls back to char-truncation only if the
    string is ASCII."""
    budget = _CALLBACK_MAX - prefix_len
    encoded = name.encode("utf-8")[:budget]
    # Drop a possibly-cut multibyte char at the tail.
    return encoded.decode("utf-8", errors="ignore")


def channels_keyboard(channels: list[dict]) -> InlineKeyboardMarkup:
    """Build a 2-per-row picker for up to 20 channels + Skip/Cancel.

    Callback shape: ``ch:<id>:<name>`` — handler uses the name to render
    the confirmation summary without a second round-trip to the CRM.
    """
    buttons: list[list[InlineKeyboardButton]] = []
    row: list[InlineKeyboardButton] = []

    for ch in channels[:20]:
        platform = PLATFORM_EMOJI.get(ch.get("platform", ""), "")
        label = f"[{platform}] {ch['name']}" if platform else ch["name"]
        prefix = f"ch:{ch['id']}:"
        name_safe = _name_for_callback(ch["name"], len(prefix.encode("utf-8")))

        row.append(
            InlineKeyboardButton(
                text=label[:40],
                callback_data=f"{prefix}{name_safe}",
            )
        )
        if len(row) == 2:
            buttons.append(row)
            row = []

    if row:
        buttons.append(row)

    buttons.append([InlineKeyboardButton(text="⏭ Пропустить", callback_data="ch:skip")])
    buttons.append([InlineKeyboardButton(text="❌ Отмена", callback_data="cancel")])

    return InlineKeyboardMarkup(inline_keyboard=buttons)
