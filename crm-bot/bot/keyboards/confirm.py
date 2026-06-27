from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup


def confirm_keyboard() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(text="✅ Сохранить", callback_data="confirm:yes"),
                InlineKeyboardButton(text="❌ Отменить", callback_data="confirm:no"),
            ]
        ]
    )
