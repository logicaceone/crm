import asyncio
import logging

from aiogram import Bot, Dispatcher
from aiogram.fsm.storage.memory import MemoryStorage
from aiogram.types import BotCommand

from bot.config import settings
from bot.handlers import cancel, expense, start
from bot.services import crm_api


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)


async def set_commands(bot: Bot) -> None:
    await bot.set_my_commands([
        BotCommand(command="add", description="Добавить расход"),
        BotCommand(command="cancel", description="Отменить текущее действие"),
        BotCommand(command="help", description="Справка"),
        BotCommand(command="start", description="Главное меню"),
    ])


async def on_startup(bot: Bot) -> None:
    logger.info("Checking CRM API connection...")
    channels = await crm_api.get_channels()
    if channels:
        logger.info("CRM API OK — %d channels available", len(channels))
    else:
        logger.warning(
            "CRM API connection failed or no channels. "
            "Check CRM_API_URL and BOT_API_KEY in .env"
        )
    await set_commands(bot)
    logger.info("Bot commands registered")


async def on_shutdown(bot: Bot) -> None:
    logger.info("Bot shutting down...")


async def main() -> None:
    bot = Bot(token=settings.bot_token)
    dp = Dispatcher(storage=MemoryStorage())

    dp.startup.register(on_startup)
    dp.shutdown.register(on_shutdown)

    # Router order matters: `cancel` carries the catch-all
    # @router.message() handler and must stay last so /start, /add,
    # /help and the per-state expense handlers all get a chance first.
    dp.include_router(start.router)
    dp.include_router(expense.router)
    dp.include_router(cancel.router)

    logger.info("Starting CRM Expense Bot...")
    await dp.start_polling(bot, allowed_updates=dp.resolve_used_update_types())


if __name__ == "__main__":
    asyncio.run(main())
