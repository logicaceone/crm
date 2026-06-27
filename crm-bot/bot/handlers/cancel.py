import logging

from aiogram import Router
from aiogram.filters import Command
from aiogram.fsm.context import FSMContext
from aiogram.types import Message

from bot.services.auth import get_crm_user

logger = logging.getLogger(__name__)
router = Router()


@router.message(Command("cancel"))
async def cmd_cancel(message: Message, state: FSMContext) -> None:
    current = await state.get_state()
    if current is None:
        await message.answer(
            "Нечего отменять.\n\n"
            "Введите /add чтобы добавить расход."
        )
        return

    await state.clear()
    await message.answer(
        "❌ Действие отменено.\n\n"
        "Введите /add чтобы начать заново."
    )


@router.message()
async def on_unexpected_message(message: Message, state: FSMContext) -> None:
    """Catch-all — must live in the last router so /start, /add, /help
    and every FSM-state message handler get a chance to match first."""
    current = await state.get_state()

    if current is not None:
        await message.answer(
            "⚠️ Продолжается добавление расхода.\n\n"
            "Введите /cancel чтобы отменить\n"
            "или ответьте на текущий вопрос."
        )
        return

    user = await get_crm_user(message)
    if not user:
        await message.answer("❌ Нет доступа.")
        return

    await message.answer(
        "Доступные команды:\n\n"
        "/add — добавить расход\n"
        "/cancel — отменить текущее действие\n"
        "/help — справка"
    )
