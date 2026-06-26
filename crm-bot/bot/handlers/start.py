import logging

from aiogram import Router
from aiogram.filters import Command
from aiogram.types import Message

from bot.services.auth import get_crm_user

logger = logging.getLogger(__name__)
router = Router()

ROLE_NAMES = {
    "root": "Root",
    "admin": "Администратор",
    "manager": "Менеджер",
    "viewer": "Наблюдатель",
}


@router.message(Command("start"))
async def cmd_start(message: Message) -> None:
    if not message.from_user or not message.from_user.username:
        await message.answer(
            "❌ У вас не установлен Telegram username.\n\n"
            "Установите его в Настройки → Изменить профиль → "
            "Имя пользователя и попробуйте снова."
        )
        return

    user = await get_crm_user(message)
    if not user:
        await message.answer(
            "❌ Нет доступа.\n\n"
            "Ваш Telegram аккаунт не привязан к CRM.\n"
            "Обратитесь к администратору."
        )
        return

    role_label = ROLE_NAMES.get(user["role"], user["role"])

    if user["role"] == "viewer":
        await message.answer(
            f"👋 Привет, {user['username']}!\n\n"
            f"Роль: {role_label}\n\n"
            "⚠️ У вас нет прав для внесения расходов.\n"
            "Обратитесь к администратору."
        )
        return

    await message.answer(
        f"👋 Привет, {user['username']}!\n"
        f"Роль: {role_label}\n\n"
        "Доступные команды:\n\n"
        "/add — добавить расход\n"
        "/cancel — отменить текущее действие\n"
        "/help — справка"
    )


@router.message(Command("help"))
async def cmd_help(message: Message) -> None:
    user = await get_crm_user(message)
    if not user:
        await message.answer("❌ Нет доступа.")
        return

    await message.answer(
        "📖 Справка\n\n"
        "Этот бот позволяет вносить расходы в CRM.\n\n"
        "Команды:\n"
        "/add — начать добавление расхода\n"
        "/cancel — отменить текущее действие\n"
        "/start — главное меню\n\n"
        "Категории расходов:\n"
        "📱 TG Ads — реклама в Telegram\n"
        "🎯 VK Ads — реклама ВКонтакте\n"
        "🔍 Яндекс — реклама в Яндекс\n"
        "👤 Блогеры — реклама у блогеров\n"
        "👥 Подписчики — оплата подписчикам\n"
        "🍽 Обеды — обеды\n"
        "🎁 Подарки — розыгрыши и подарки\n"
        "⚙️ Сервисы — оплата сервисов\n"
        "📝 Прочие — прочие расходы\n\n"
        "При любых вопросах обратитесь к администратору."
    )
