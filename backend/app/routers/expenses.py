import logging
from datetime import date, datetime, timezone
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

from ..database import get_db
from ..models.user import User, UserRole
from ..models.expense import (
    ExternalChannel,
    Expense,
    ExpenseStatus,
    ExpenseCategory,
    CPA_CATEGORIES,
)
from ..schemas.expenses import (
    ExternalChannelResponse,
    CreateExternalChannelRequest,
    ExpenseResponse,
    CreateExpenseRequest,
    UpdateExpenseRequest,
    ExpenseSummary,
    InviteLinkResponse,
    CpaSyncResponse,
)
from .auth import require_roles
from ..activity import log_action
from ..models.channel import Channel

router_ext = APIRouter(prefix="/external-channels", tags=["external-channels"])
router = APIRouter(prefix="/expenses", tags=["expenses"])

read_access = require_roles([UserRole.root, UserRole.admin, UserRole.manager, UserRole.viewer])
write_access = require_roles([UserRole.root, UserRole.admin, UserRole.manager])


CATEGORY_LABEL = {
    ExpenseCategory.tg_ads: "TG Ads",
    ExpenseCategory.vk_ads: "VK Ads",
    ExpenseCategory.yandex: "Яндекс",
    ExpenseCategory.blogger: "Реклама у блогеров",
    ExpenseCategory.subscribers: "Оплата подписчикам",
    ExpenseCategory.lunch: "Обеды",
    ExpenseCategory.giveaway: "Подарки",
    ExpenseCategory.services: "Сервисы",
    ExpenseCategory.salary: "Зарплата",
    ExpenseCategory.other: "Прочие",
}
# Categories that require a non-empty responsible field at create/update time.
# Spec: subscribers / lunch / giveaway / services / other — ad-like categories
# don't enforce it because the buyer is usually the same person.
RESPONSIBLE_REQUIRED = frozenset({
    ExpenseCategory.subscribers,
    ExpenseCategory.lunch,
    ExpenseCategory.giveaway,
    ExpenseCategory.services,
    ExpenseCategory.salary,
    ExpenseCategory.other,
})


def _cat_value(c) -> str:
    return c.value if hasattr(c, "value") else str(c)


# ── External channels ────────────────────────────────────────────────────────

@router_ext.get("", response_model=list[ExternalChannelResponse])
def list_external_channels(
    db: Session = Depends(get_db),
    _: User = Depends(read_access),
):
    return db.query(ExternalChannel).order_by(ExternalChannel.name).all()


@router_ext.get("/all")
def list_external_channels_all(
    db: Session = Depends(get_db),
    _: User = Depends(read_access),
):
    rows = db.query(ExternalChannel).order_by(ExternalChannel.name).all()
    return [{"id": ch.id, "name": ch.name, "tg_link": ch.tg_link} for ch in rows]


@router_ext.post("", response_model=ExternalChannelResponse, status_code=201)
def create_external_channel(
    data: CreateExternalChannelRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(write_access),
):
    ch = ExternalChannel(**data.model_dump())
    db.add(ch)
    db.commit()
    db.refresh(ch)
    log_action(db, current_user, "create", "external_channel", ch.id, f"Площадка: {ch.name}")
    return ch


@router_ext.delete("/{channel_id}", status_code=204)
def delete_external_channel(
    channel_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(write_access),
):
    ch = db.query(ExternalChannel).filter(ExternalChannel.id == channel_id).first()
    if not ch:
        raise HTTPException(status_code=404, detail="External channel not found")
    name = ch.name
    db.delete(ch)
    db.commit()
    log_action(db, current_user, "delete", "external_channel", channel_id, f"Площадка: {name}")


# ── Expenses ─────────────────────────────────────────────────────────────────

def _apply_filters(q, external_channel_id, status, from_, to, category, responsible, city=None):
    if external_channel_id:
        q = q.filter(Expense.external_channel_id == external_channel_id)
    if status:
        q = q.filter(Expense.status == status)
    if from_:
        q = q.filter(Expense.date >= from_)
    if to:
        q = q.filter(Expense.date <= to)
    if category:
        q = q.filter(Expense.category == category)
    if responsible:
        q = q.filter(Expense.responsible.ilike(f"%{responsible}%"))
    if city:
        q = q.filter(Expense.city.any(city))
    return q


def _validate(category: ExpenseCategory, effective: dict) -> None:
    """Shared invariant check used by POST + PATCH."""
    if category == ExpenseCategory.blogger and not effective.get("external_channel_id"):
        raise HTTPException(
            status_code=400,
            detail="Укажите площадку для категории «Реклама у блогеров»",
        )
    if effective.get("invite_link") and category not in CPA_CATEGORIES:
        raise HTTPException(
            status_code=400,
            detail="Инвайт-ссылка недоступна для этой категории",
        )
    if category in RESPONSIBLE_REQUIRED:
        if not (effective.get("responsible") or "").strip():
            raise HTTPException(
                status_code=400,
                detail="Поле «Ответственный» обязательно для этой категории",
            )
    if category in (ExpenseCategory.other, ExpenseCategory.salary):
        if not (effective.get("comment") or "").strip():
            label = "«Зарплата»" if category == ExpenseCategory.salary else "«Прочие»"
            raise HTTPException(
                status_code=400,
                detail=f"Поле «Комментарий» обязательно для категории {label}",
            )


@router.get("/summary", response_model=ExpenseSummary)
def expenses_summary(
    external_channel_id: Optional[int] = None,
    status: Optional[ExpenseStatus] = None,
    from_: Optional[date] = Query(default=None, alias="from"),
    to: Optional[date] = None,
    category: Optional[ExpenseCategory] = None,
    responsible: Optional[str] = None,
    city: Optional[str] = None,
    db: Session = Depends(get_db),
    _: User = Depends(read_access),
):
    rows = _apply_filters(
        db.query(
            Expense.category,
            func.count(Expense.id),
            func.coalesce(func.sum(Expense.price), 0),
        ),
        external_channel_id, status, from_, to, category, responsible, city,
    ).group_by(Expense.category).all()

    by_category: dict[str, float] = {c.value: 0.0 for c in ExpenseCategory}
    total = 0.0
    count = 0
    for cat, cnt, sum_price in rows:
        key = _cat_value(cat)
        amount = float(sum_price or 0)
        by_category[key] = amount
        total += amount
        count += int(cnt or 0)

    currencies = [c for (c,) in _apply_filters(
        db.query(Expense.currency).distinct(),
        external_channel_id, status, from_, to, category, responsible, city,
    ).all()]
    if not currencies:
        currency = "RUB"
    elif len(currencies) == 1:
        currency = currencies[0]
    else:
        currency = "mixed"

    city_subq = _apply_filters(
        db.query(
            func.unnest(Expense.city).label("c"),
            Expense.price.label("p"),
        ).filter(Expense.category == ExpenseCategory.subscribers),
        external_channel_id, status, from_, to, None, responsible, city,
    ).subquery()
    city_rows = db.query(
        city_subq.c.c,
        func.coalesce(func.sum(city_subq.c.p), 0),
    ).group_by(city_subq.c.c).all()
    by_city: dict[str, float] = {c: float(s or 0) for c, s in city_rows if c}

    return ExpenseSummary(
        total=total,
        by_category=by_category,
        by_city=by_city,
        currency=currency,
        count=count,
    )


@router.get("")
def list_expenses(
    external_channel_id: Optional[int] = None,
    status: Optional[ExpenseStatus] = None,
    from_: Optional[date] = Query(default=None, alias="from"),
    to: Optional[date] = None,
    category: Optional[ExpenseCategory] = None,
    responsible: Optional[str] = None,
    city: Optional[str] = None,
    page: Optional[int] = None,
    per_page: int = Query(default=15, ge=1, le=100),
    db: Session = Depends(get_db),
    _: User = Depends(read_access),
):
    q = _apply_filters(
        db.query(Expense),
        external_channel_id, status, from_, to, category, responsible, city,
    ).order_by(Expense.date.desc())
    if page is None:
        return q.all()
    total = q.count()
    total_pages = max(1, (total + per_page - 1) // per_page)
    page = max(1, min(page, total_pages))
    items = q.offset((page - 1) * per_page).limit(per_page).all()
    return {
        "items": [ExpenseResponse.model_validate(e) for e in items],
        "pagination": {"page": page, "per_page": per_page, "total": total, "total_pages": total_pages},
    }


@router.post("", response_model=ExpenseResponse, status_code=201)
def create_expense(
    data: CreateExpenseRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(write_access),
):
    payload = data.model_dump()
    payload["currency"] = "RUB"

    # Strip fields that aren't meaningful for the chosen category — the
    # CHECK constraints would catch most of these too but a 400 is friendlier.
    if data.category != ExpenseCategory.blogger:
        payload["external_channel_id"] = None
    if data.category not in CPA_CATEGORIES:
        payload["invite_link"] = None
        payload["channel_id"] = None

    _validate(data.category, payload)

    ext_ch = None
    if payload.get("external_channel_id"):
        ext_ch = db.query(ExternalChannel).filter(
            ExternalChannel.id == payload["external_channel_id"]
        ).first()
        if not ext_ch:
            raise HTTPException(status_code=404, detail="External channel not found")

    expense = Expense(**payload, created_by=current_user.id)
    db.add(expense)
    db.commit()
    db.refresh(expense)

    label = CATEGORY_LABEL.get(data.category, data.category.value)
    desc = (
        f"{label} #{expense.id}: {ext_ch.name}, {expense.price} {expense.currency}"
        if ext_ch else
        f"{label} #{expense.id}: {expense.price} {expense.currency}"
    )
    log_action(db, current_user, "create", "expense", expense.id, desc)
    return expense


@router.get("/{expense_id}", response_model=ExpenseResponse)
def get_expense(
    expense_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(read_access),
):
    e = db.query(Expense).filter(Expense.id == expense_id).first()
    if not e:
        raise HTTPException(status_code=404, detail="Expense not found")
    return e


async def _resolve_tg_chat_id(db: Session, svc, ch: Channel) -> int:
    if ch.tg_chat_id:
        return ch.tg_chat_id
    from ..services.telegram_cpa import TelegramCPAError, _extract_username
    if not ch.tg_link:
        raise HTTPException(
            status_code=400,
            detail=(
                "Не задан числовой ID канала и нет TG-ссылки — "
                "укажите Chat ID в настройках канала."
            ),
        )
    username = _extract_username(ch.tg_link)
    if not username:
        raise HTTPException(status_code=400, detail="Не удалось определить username канала")
    try:
        chat_id = await svc.resolve_chat_id(f"@{username}")
    except TelegramCPAError as e:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Не удалось получить chat_id из Telegram ({e}). "
                "Для приватных каналов введите Chat ID вручную в настройках канала."
            ),
        )
    ch.tg_chat_id = chat_id
    db.commit()
    return chat_id


@router.patch("/{expense_id}", response_model=ExpenseResponse)
def update_expense(
    expense_id: int,
    data: UpdateExpenseRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(write_access),
):
    e = db.query(Expense).filter(Expense.id == expense_id).first()
    if not e:
        raise HTTPException(status_code=404, detail="Expense not found")

    updates = data.model_dump(exclude_unset=True)
    updates.pop("currency", None)

    old_category = e.category
    new_category = updates.get("category", e.category)
    category_changing = "category" in updates and new_category != old_category

    # When category leaves the blogger / CPA buckets, clear the now-irrelevant
    # fields directly on the row so the CHECK constraints don't fire.
    if category_changing and new_category != ExpenseCategory.blogger:
        e.external_channel_id = None
        updates.pop("external_channel_id", None)
    if category_changing and new_category not in CPA_CATEGORIES:
        e.invite_link = None
        e.channel_id = None
        e.joined_count = 0
        e.left_count = 0
        e.cpa_synced_at = None
        for k in ("invite_link", "channel_id", "joined_count", "left_count"):
            updates.pop(k, None)

    effective = {
        "external_channel_id": updates.get("external_channel_id", e.external_channel_id),
        "channel_id": updates.get("channel_id", e.channel_id),
        "invite_link": updates.get("invite_link", e.invite_link),
        "responsible": updates.get("responsible", e.responsible),
        "comment": updates.get("comment", e.comment),
    }
    _validate(new_category, effective)

    for field, value in updates.items():
        setattr(e, field, value)

    db.commit()
    db.refresh(e)
    log_action(db, current_user, "update", "expense", e.id, f"Расход #{e.id} обновлён")
    return e


@router.post("/{expense_id}/invite-link", response_model=InviteLinkResponse)
async def create_invite_link(
    expense_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(write_access),
):
    e = db.query(Expense).filter(Expense.id == expense_id).first()
    if not e:
        raise HTTPException(status_code=404, detail="Expense not found")
    if e.category not in CPA_CATEGORIES:
        raise HTTPException(
            status_code=400,
            detail="Инвайт-ссылки доступны только для CPA-категорий (TG Ads / VK Ads / Яндекс / Блогеры)",
        )
    if not e.channel_id:
        raise HTTPException(status_code=400, detail="Канал не привязан к расходу")
    ch = db.query(Channel).filter(Channel.id == e.channel_id).first()
    if not ch:
        raise HTTPException(status_code=404, detail="Channel not found")

    platform = ch.platform.value if hasattr(ch.platform, "value") else str(ch.platform)
    if platform != "telegram":
        raise HTTPException(status_code=400, detail="Инвайт-ссылки через API поддерживаются только для Telegram")

    from ..db_settings import get_setting
    from ..config import settings as cfg
    bot_token = get_setting(db, "telegram_bot_token", cfg.telegram_bot_token)
    if not bot_token:
        raise HTTPException(status_code=400, detail="Telegram Bot Token не задан в настройках")

    from ..services.telegram_cpa import TelegramCPAService, TelegramCPAError
    svc = TelegramCPAService(bot_token)
    chat_id = await _resolve_tg_chat_id(db, svc, ch)

    if e.invite_link:
        revoked = await svc.is_invite_link_revoked(chat_id, e.invite_link)
        if not revoked:
            return InviteLinkResponse(invite_link=e.invite_link)
        logger.warning("Invite link for expense #%s is revoked — creating a new one", e.id)
        e.invite_link = None
        e.joined_count = 0
        e.cpa_last_member_count = 0
        e.cpa_synced_at = None
        db.commit()

    try:
        link = await svc.create_invite_link(chat_id, e.id)
    except TelegramCPAError as exc:
        raise HTTPException(status_code=502, detail=str(exc))

    e.invite_link = link
    db.commit()
    log_action(db, current_user, "update", "expense", e.id, f"Создана инвайт-ссылка для расхода #{e.id}")
    return InviteLinkResponse(invite_link=link)


@router.post("/{expense_id}/sync-cpa", response_model=CpaSyncResponse)
async def sync_cpa(
    expense_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(write_access),
):
    e = db.query(Expense).filter(Expense.id == expense_id).first()
    if not e:
        raise HTTPException(status_code=404, detail="Expense not found")
    if e.category not in CPA_CATEGORIES:
        raise HTTPException(status_code=400, detail="CPA синхронизация доступна только для CPA-категорий")
    if not e.invite_link:
        raise HTTPException(status_code=400, detail="Инвайт-ссылка не создана")
    if not e.channel_id:
        raise HTTPException(status_code=400, detail="Канал не привязан к расходу")

    ch = db.query(Channel).filter(Channel.id == e.channel_id).first()
    if not ch:
        raise HTTPException(status_code=404, detail="Channel not found")
    platform = ch.platform.value if hasattr(ch.platform, "value") else str(ch.platform)
    if platform != "telegram":
        raise HTTPException(status_code=400, detail="Автосинхронизация CPA доступна только для Telegram")

    from ..db_settings import get_setting
    from ..config import settings as cfg
    bot_token = get_setting(db, "telegram_bot_token", cfg.telegram_bot_token)
    if not bot_token:
        raise HTTPException(status_code=400, detail="Telegram Bot Token не задан в настройках")

    from ..services.telegram_cpa import TelegramCPAService, TelegramCPAError
    svc = TelegramCPAService(bot_token)
    chat_id = await _resolve_tg_chat_id(db, svc, ch)
    try:
        info = await svc.get_invite_link_info(chat_id, e.invite_link)
    except TelegramCPAError as exc:
        raise HTTPException(status_code=502, detail=str(exc))

    if info.get("is_revoked"):
        logger.warning("Invite link for expense #%s is revoked", e.id)
        e.invite_link = None
        e.joined_count = 0
        e.cpa_last_member_count = 0
        e.cpa_synced_at = None
        db.commit()
        raise HTTPException(
            status_code=400,
            detail=(
                "Инвайт-ссылка отозвана в Telegram. "
                "Нажмите «Создать ссылку», чтобы сгенерировать новую."
            ),
        )

    member_count = int(info.get("member_count", 0))
    e.joined_count = member_count
    e.cpa_last_member_count = member_count
    e.cpa_synced_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(e)

    log_action(db, current_user, "update", "expense", e.id,
               f"CPA: {e.joined_count} вступило по инвайт-ссылке")
    return CpaSyncResponse(
        joined_count=e.joined_count,
        left_count=e.left_count,
        cpa_synced_at=e.cpa_synced_at,
    )


@router.delete("/{expense_id}", status_code=204)
def delete_expense(
    expense_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(write_access),
):
    e = db.query(Expense).filter(Expense.id == expense_id).first()
    if not e:
        raise HTTPException(status_code=404, detail="Expense not found")
    label = CATEGORY_LABEL.get(e.category, _cat_value(e.category))
    desc = (
        f"{label} #{e.id}: {e.external_channel.name}, {e.price} {e.currency}"
        if e.external_channel else
        f"{label} #{e.id}: {e.price} {e.currency}"
    )
    db.delete(e)
    db.commit()
    log_action(db, current_user, "delete", "expense", expense_id, desc)
