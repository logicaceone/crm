from aiogram.types import InlineKeyboardMarkup
from aiogram.utils.keyboard import InlineKeyboardBuilder


def confirm_keyboard() -> InlineKeyboardMarkup:
    kb = InlineKeyboardBuilder()
    kb.button(text="✅ Сохранить", callback_data="confirm:yes")
    kb.button(text="❌ Отменить", callback_data="confirm:no")
    kb.adjust(2)
    return kb.as_markup()
