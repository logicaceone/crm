from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup


def categories_keyboard() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(text="📱 TG Ads", callback_data="cat:tg_ads"),
                InlineKeyboardButton(text="🎯 VK Ads", callback_data="cat:vk_ads"),
            ],
            [
                InlineKeyboardButton(text="🔍 Яндекс", callback_data="cat:yandex"),
                InlineKeyboardButton(text="👤 Блогеры", callback_data="cat:blogger"),
            ],
            [
                InlineKeyboardButton(text="👥 Подписчики", callback_data="cat:subscribers"),
                InlineKeyboardButton(text="🍽 Обеды", callback_data="cat:lunch"),
            ],
            [
                InlineKeyboardButton(text="🎁 Подарки", callback_data="cat:giveaway"),
                InlineKeyboardButton(text="⚙️ Сервисы", callback_data="cat:services"),
            ],
            [
                InlineKeyboardButton(text="💼 Зарплата", callback_data="cat:salary"),
                InlineKeyboardButton(text="📝 Прочие", callback_data="cat:other"),
            ],
            [InlineKeyboardButton(text="❌ Отмена", callback_data="cancel")],
        ]
    )
