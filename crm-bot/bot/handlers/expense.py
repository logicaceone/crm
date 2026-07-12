import logging
from datetime import date, datetime

from aiogram import F, Router
from aiogram.filters import Command
from aiogram.fsm.context import FSMContext
from aiogram.types import CallbackQuery, Message

from bot.keyboards.categories import categories_keyboard
from bot.keyboards.channels import channels_keyboard
from bot.keyboards.confirm import confirm_keyboard
from bot.services.auth import get_crm_user
from bot.services.city_normalizer import normalize_cities
from bot.services.crm_api import create_expense, get_channels
from bot.states.expense import ExpenseStates

logger = logging.getLogger(__name__)
router = Router()

CPA_CATEGORIES = {"tg_ads", "vk_ads", "yandex", "blogger"}

# Categories that show the "our channel" picker. CPA plus `boost` (накрутка),
# which records the channel the boost targets without any CPA tracking.
CHANNEL_CATEGORIES = CPA_CATEGORIES | {"boost"}

CATEGORY_NAMES = {
    "tg_ads": "📱 TG Ads",
    "vk_ads": "🎯 VK Ads",
    "yandex": "🔍 Яндекс",
    "blogger": "👤 Блогеры",
    "subscribers": "👥 Подписчики",
    "lunch": "🍽 Обеды",
    "giveaway": "🎁 Подарки",
    "services": "⚙️ Сервисы",
    "salary": "💼 Зарплата",
    "boost": "📈 Накрутка",
    "other": "📝 Прочие",
}

COMMENT_REQUIRED = {"other", "salary"}

COMMENT_REQUIRED_LABEL = {
    "other": "«Прочие»",
    "salary": "«Зарплата»",
}


# ── Global cancel button ─────────────────────────────────

@router.callback_query(F.data == "cancel")
async def on_cancel_button(callback: CallbackQuery, state: FSMContext) -> None:
    await callback.message.edit_reply_markup(reply_markup=None)
    await callback.answer()
    await state.clear()
    await callback.message.answer(
        "❌ Действие отменено.\n"
        "Введите /add чтобы начать заново."
    )


# ── Step 1: /add ─────────────────────────────────────────

@router.message(Command("add"))
async def cmd_add(message: Message, state: FSMContext) -> None:
    user = await get_crm_user(message)
    if not user or user["role"] == "viewer":
        await message.answer("❌ Нет доступа.")
        return

    await state.clear()
    await state.update_data(crm_user=user)
    await message.answer(
        "📂 Шаг 1 из 5\n\nВыберите категорию расхода:",
        reply_markup=categories_keyboard(),
    )
    await state.set_state(ExpenseStates.waiting_category)


# ── Step 2: category ─────────────────────────────────────

@router.callback_query(ExpenseStates.waiting_category, F.data.startswith("cat:"))
async def on_category(callback: CallbackQuery, state: FSMContext) -> None:
    category = callback.data.split(":", 1)[1]
    if category not in CATEGORY_NAMES:
        await callback.answer("Неизвестная категория", show_alert=True)
        return

    await state.update_data(category=category)
    await callback.message.edit_reply_markup(reply_markup=None)
    await callback.message.answer(f"Категория: {CATEGORY_NAMES[category]}")
    await callback.answer()

    if category in CHANNEL_CATEGORIES:
        channels = await get_channels()
        if not channels:
            await callback.message.answer(
                "⚠️ Не удалось загрузить список каналов.\n"
                "Продолжаем без выбора канала."
            )
            await ask_date(callback.message, state)
            return

        # Cache once so pagination doesn't re-hit the CRM on every page.
        await state.update_data(channels_list=channels)

        await callback.message.answer(
            "📺 Шаг 2 из 5\n\n"
            "Выберите наш канал\n"
            f"Всего каналов: {len(channels)}",
            reply_markup=channels_keyboard(channels, page=0),
        )
        await state.set_state(ExpenseStates.waiting_channel)
    elif category == "subscribers":
        await ask_city(callback.message, state)
    else:
        await ask_date(callback.message, state)


# ── Step 3: channel (CPA only) ───────────────────────────

@router.callback_query(ExpenseStates.waiting_channel, F.data.startswith("ch_page:"))
async def on_channel_page(callback: CallbackQuery, state: FSMContext) -> None:
    try:
        page = int(callback.data.split(":", 1)[1])
    except (IndexError, ValueError):
        await callback.answer()
        return

    data = await state.get_data()
    channels = data.get("channels_list")
    if not channels:
        # Cache was lost (bot restart, state expiry) — refetch lazily.
        channels = await get_channels()
        if not channels:
            await callback.answer("Не удалось загрузить каналы", show_alert=True)
            return
        await state.update_data(channels_list=channels)

    await callback.message.edit_reply_markup(
        reply_markup=channels_keyboard(channels, page=page),
    )
    await callback.answer()


@router.callback_query(ExpenseStates.waiting_channel, F.data == "ch_page_info")
async def on_channel_page_info(callback: CallbackQuery) -> None:
    # The "n / m" counter is decorative — just dismiss the spinner.
    await callback.answer()


@router.callback_query(ExpenseStates.waiting_channel, F.data == "ch:skip")
async def on_channel_skip(callback: CallbackQuery, state: FSMContext) -> None:
    await state.update_data(channel_id=None, channel_name=None)
    await callback.message.edit_reply_markup(reply_markup=None)
    await callback.message.answer("Канал: не выбран")
    await callback.answer()
    await ask_date(callback.message, state)


@router.callback_query(ExpenseStates.waiting_channel, F.data.startswith("ch:"))
async def on_channel(callback: CallbackQuery, state: FSMContext) -> None:
    parts = callback.data.split(":", 2)
    try:
        channel_id = int(parts[1])
    except (IndexError, ValueError):
        await callback.answer("Некорректный канал", show_alert=True)
        return
    channel_name = parts[2] if len(parts) > 2 else "—"

    await state.update_data(channel_id=channel_id, channel_name=channel_name)
    await callback.message.edit_reply_markup(reply_markup=None)
    await callback.message.answer(f"Канал: {channel_name}")
    await callback.answer()
    await ask_date(callback.message, state)


# ── Step 3b: city (subscribers only) ─────────────────────

async def ask_city(message: Message, state: FSMContext) -> None:
    await message.answer(
        "🏙 Введите город (или несколько через запятую/дефис):\n"
        "Например: Альметьевск или Альмет-Казань"
    )
    await state.set_state(ExpenseStates.waiting_city)


@router.message(ExpenseStates.waiting_city)
async def on_city(message: Message, state: FSMContext) -> None:
    text = (message.text or "").strip()

    if text == "-":
        await state.update_data(city=None, city_leftover=None)
        await message.answer("Город: пропущен")
        await ask_date(message, state)
        return

    cities, leftover = normalize_cities(text)
    if not cities:
        await message.answer(
            "❌ Не распознал ни одного города. Попробуй ещё раз или отправь «-» чтобы пропустить."
        )
        return

    await state.update_data(city=cities)
    reply = f"Город: {', '.join(cities)}"
    if leftover:
        await state.update_data(city_leftover=leftover)
        reply += f"\n⚠️ не распознано: {', '.join(leftover)} — добавлено в комментарий"
    await message.answer(reply)
    await ask_date(message, state)


# ── Step 4: date ─────────────────────────────────────────

async def ask_date(message: Message, state: FSMContext) -> None:
    data = await state.get_data()
    step = "3" if data.get("category") in CHANNEL_CATEGORIES else "2"
    await message.answer(
        f"📅 Шаг {step} из 5\n\n"
        "Введите дату расхода в формате дд.мм.гггг\n"
        "Или отправьте «сегодня»:"
    )
    await state.set_state(ExpenseStates.waiting_date)


@router.message(ExpenseStates.waiting_date)
async def on_date(message: Message, state: FSMContext) -> None:
    raw = (message.text or "").strip()
    if raw.lower() == "сегодня":
        expense_date = date.today()
        display = "сегодня"
    else:
        try:
            expense_date = datetime.strptime(raw, "%d.%m.%Y").date()
            display = raw
        except ValueError:
            await message.answer(
                "❌ Неверный формат даты.\n"
                "Введите дату как дд.мм.гггг\n"
                "Например: 18.06.2026\n"
                "Или отправьте «сегодня»"
            )
            return

    await state.update_data(date=expense_date.isoformat())
    await message.answer(
        f"Дата: {display}\n\n"
        "💰 Шаг 3 из 5\n\nВведите сумму в рублях:"
    )
    await state.set_state(ExpenseStates.waiting_amount)


# ── Step 5: amount ───────────────────────────────────────

@router.message(ExpenseStates.waiting_amount)
async def on_amount(message: Message, state: FSMContext) -> None:
    raw = (message.text or "").strip().replace(",", ".").replace(" ", "").replace("\xa0", "")
    try:
        amount = float(raw)
        if amount <= 0:
            raise ValueError
    except ValueError:
        await message.answer(
            "❌ Введите корректную сумму.\n"
            "Например: 1500 или 1500.50"
        )
        return

    await state.update_data(amount=amount)
    data = await state.get_data()
    user = data["crm_user"]

    await message.answer(
        f"Сумма: {amount:,.0f} ₽\n\n"
        "👤 Шаг 4 из 5\n\n"
        "Введите имя ответственного\n"
        f"Или отправьте «я» — подставится «{user['username']}»:"
    )
    await state.set_state(ExpenseStates.waiting_responsible)


# ── Step 6: responsible ──────────────────────────────────

@router.message(ExpenseStates.waiting_responsible)
async def on_responsible(message: Message, state: FSMContext) -> None:
    data = await state.get_data()
    text = (message.text or "").strip()
    responsible = data["crm_user"]["username"] if text.lower() == "я" else text
    if not responsible:
        await message.answer("❌ Имя ответственного не может быть пустым.")
        return

    await state.update_data(responsible=responsible)

    if data["category"] in COMMENT_REQUIRED:
        label = COMMENT_REQUIRED_LABEL[data["category"]]
        prompt = (
            "💬 Шаг 5 из 5\n\n"
            "Введите комментарий:\n"
            f"⚠️ Для категории {label} комментарий обязателен"
        )
    else:
        prompt = (
            "💬 Шаг 5 из 5\n\n"
            "Введите комментарий\n"
            "Или отправьте «-» чтобы пропустить:"
        )
    await message.answer(f"Ответственный: {responsible}\n\n{prompt}")
    await state.set_state(ExpenseStates.waiting_comment)


# ── Step 7: comment ──────────────────────────────────────

@router.message(ExpenseStates.waiting_comment)
async def on_comment(message: Message, state: FSMContext) -> None:
    data = await state.get_data()
    text = (message.text or "").strip()

    if text == "-":
        if data["category"] in COMMENT_REQUIRED:
            label = COMMENT_REQUIRED_LABEL[data["category"]]
            await message.answer(
                f"❌ Для категории {label} комментарий обязателен.\n"
                "Введите комментарий:"
            )
            return
        comment = None
    else:
        comment = text or None
        if data["category"] in COMMENT_REQUIRED and not comment:
            label = COMMENT_REQUIRED_LABEL[data["category"]]
            await message.answer(
                f"❌ Для категории {label} комментарий обязателен.\n"
                "Введите комментарий:"
            )
            return

    leftover = data.get("city_leftover")
    if leftover:
        prefix = f"[city: {' / '.join(leftover)}] "
        comment = f"{prefix}{comment}" if comment else prefix.rstrip()

    await state.update_data(comment=comment)
    await show_confirm(message, state)


# ── Step 8: confirm ──────────────────────────────────────

async def show_confirm(message: Message, state: FSMContext) -> None:
    data = await state.get_data()
    date_display = datetime.fromisoformat(data["date"]).strftime("%d.%m.%Y")

    summary = (
        "📋 Проверьте данные расхода:\n\n"
        f"Категория:     {CATEGORY_NAMES[data['category']]}\n"
        f"Дата:          {date_display}\n"
        f"Сумма:         {data['amount']:,.0f} ₽\n"
        f"Ответственный: {data['responsible']}\n"
    )
    if data.get("channel_name"):
        summary += f"Канал:         {data['channel_name']}\n"
    if data.get("city"):
        summary += f"Город:         {', '.join(data['city'])}\n"
    if data.get("comment"):
        summary += f"Комментарий:   {data['comment']}\n"

    await message.answer(summary, reply_markup=confirm_keyboard())
    await state.set_state(ExpenseStates.waiting_confirm)


# ── Step 9: save ─────────────────────────────────────────

@router.callback_query(ExpenseStates.waiting_confirm, F.data == "confirm:yes")
async def on_confirm_yes(callback: CallbackQuery, state: FSMContext) -> None:
    data = await state.get_data()
    await callback.message.edit_reply_markup(reply_markup=None)
    await callback.answer()

    payload = {
        "category": data["category"],
        "date": data["date"],
        "price": data["amount"],
        "currency": "RUB",
        "status": "placed",
        "responsible": data["responsible"],
        "comment": data.get("comment"),
        "channel_id": data.get("channel_id"),
        "city": data.get("city"),
        "created_by": data["crm_user"]["id"],
    }
    result = await create_expense(payload)

    if result and result.get("id"):
        await callback.message.answer(
            f"✅ Расход сохранён!\n"
            f"ID: #{result['id']}\n\n"
            "Введите /add чтобы добавить ещё один."
        )
    else:
        await callback.message.answer(
            "❌ Ошибка при сохранении расхода.\n"
            "Попробуйте снова: /add"
        )

    await state.clear()


@router.callback_query(ExpenseStates.waiting_confirm, F.data == "confirm:no")
async def on_confirm_no(callback: CallbackQuery, state: FSMContext) -> None:
    await callback.message.edit_reply_markup(reply_markup=None)
    await callback.answer()
    await state.clear()
    await callback.message.answer(
        "❌ Расход отменён.\n"
        "Введите /add чтобы начать заново."
    )
