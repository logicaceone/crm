from aiogram.types import InlineKeyboardMarkup
from aiogram.utils.keyboard import InlineKeyboardBuilder

CATEGORY_LABELS = [
    ("tg_ads", "📱 TG Ads"),
    ("vk_ads", "🎯 VK Ads"),
    ("yandex", "🔍 Яндекс"),
    ("blogger", "👤 Блогеры"),
    ("subscribers", "👥 Подписчики"),
    ("lunch", "🍽 Обеды"),
    ("giveaway", "🎁 Подарки"),
    ("services", "⚙️ Сервисы"),
    ("other", "📝 Прочие"),
]


def categories_keyboard() -> InlineKeyboardMarkup:
    kb = InlineKeyboardBuilder()
    for key, label in CATEGORY_LABELS:
        kb.button(text=label, callback_data=f"cat:{key}")
    kb.adjust(2)
    return kb.as_markup()
