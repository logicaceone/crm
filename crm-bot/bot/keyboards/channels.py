from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup

PAGE_SIZE = 8

PLATFORM_EMOJI = {
    "telegram": "🔵 TG",
    "max": "🔴 MAX",
}

# Telegram caps callback_data at 64 bytes. Trim the name by *bytes*
# (UTF-8) so Cyrillic doesn't blow the budget.
_CALLBACK_MAX = 64


def _name_for_callback(name: str, prefix_len: int) -> str:
    budget = _CALLBACK_MAX - prefix_len
    encoded = name.encode("utf-8")[:budget]
    return encoded.decode("utf-8", errors="ignore")


def channels_keyboard(channels: list[dict], page: int = 0) -> InlineKeyboardMarkup:
    """Paginated channel picker — one channel per row, 8 per page.

    Callback shapes used here::
      ch:<id>:<name>        — pick a channel
      ch_page:<page>        — switch page
      ch_page_info          — noop (the "n / m" counter button)
      ch:skip               — proceed without a channel
      cancel                — abort the whole flow
    """
    total = len(channels)
    total_pages = max(1, (total + PAGE_SIZE - 1) // PAGE_SIZE)
    page = max(0, min(page, total_pages - 1))
    start = page * PAGE_SIZE
    page_channels = channels[start:start + PAGE_SIZE]

    buttons: list[list[InlineKeyboardButton]] = []

    for ch in page_channels:
        platform = PLATFORM_EMOJI.get(ch.get("platform", ""), "")
        label = f"{platform} {ch['name']}" if platform else ch["name"]
        prefix = f"ch:{ch['id']}:"
        name_safe = _name_for_callback(ch["name"], len(prefix.encode("utf-8")))
        buttons.append([
            InlineKeyboardButton(
                text=label[:60],
                callback_data=f"{prefix}{name_safe}",
            )
        ])

    # Navigation row — only shown when there's more than one page.
    if total_pages > 1:
        nav_row: list[InlineKeyboardButton] = []
        if page > 0:
            nav_row.append(InlineKeyboardButton(
                text="◀️ Назад", callback_data=f"ch_page:{page - 1}",
            ))
        nav_row.append(InlineKeyboardButton(
            text=f"{page + 1} / {total_pages}", callback_data="ch_page_info",
        ))
        if page < total_pages - 1:
            nav_row.append(InlineKeyboardButton(
                text="Вперёд ▶️", callback_data=f"ch_page:{page + 1}",
            ))
        buttons.append(nav_row)

    buttons.append([InlineKeyboardButton(text="⏭ Пропустить", callback_data="ch:skip")])
    buttons.append([InlineKeyboardButton(text="❌ Отмена", callback_data="cancel")])

    return InlineKeyboardMarkup(inline_keyboard=buttons)
