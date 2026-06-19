from datetime import date, datetime, timezone
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ..database import get_db
from ..models.user import User, UserRole
from ..models.purchase import ExternalChannel, AdPurchase, PurchaseStatus, PurchaseType
from ..schemas.purchases import (
    ExternalChannelResponse,
    CreateExternalChannelRequest,
    AdPurchaseResponse,
    CreatePurchaseRequest,
    UpdatePurchaseRequest,
    PurchaseSummary,
    InviteLinkResponse,
    CpaSyncResponse,
)
from .auth import get_current_user, require_roles
from ..activity import log_action
from ..models.channel import Channel

router_ext = APIRouter(prefix="/external-channels", tags=["external-channels"])
router = APIRouter(prefix="/purchases", tags=["purchases"])

read_access = require_roles([UserRole.root, UserRole.admin, UserRole.manager, UserRole.viewer])
write_access = require_roles([UserRole.root, UserRole.admin, UserRole.manager])


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
    """Lightweight unpaginated list for dropdowns (id/name/tg_link)."""
    rows = db.query(ExternalChannel).order_by(ExternalChannel.name).all()
    return [
        {"id": ch.id, "name": ch.name, "tg_link": ch.tg_link}
        for ch in rows
    ]


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


# ── Purchases ────────────────────────────────────────────────────────────────

def _apply_filters(q, external_channel_id, status, from_, to):
    if external_channel_id:
        q = q.filter(AdPurchase.external_channel_id == external_channel_id)
    if status:
        q = q.filter(AdPurchase.status == status)
    if from_:
        q = q.filter(AdPurchase.date >= from_)
    if to:
        q = q.filter(AdPurchase.date <= to)
    return q


@router.get("/summary", response_model=PurchaseSummary)
def purchases_summary(
    external_channel_id: Optional[int] = None,
    status: Optional[PurchaseStatus] = None,
    from_: Optional[date] = Query(default=None, alias="from"),
    to: Optional[date] = None,
    type_filter: Optional[str] = Query(default=None, alias="type"),
    db: Session = Depends(get_db),
    _: User = Depends(read_access),
):
    q = _apply_filters(db.query(AdPurchase), external_channel_id, status, from_, to)
    if type_filter:
        q = q.filter(AdPurchase.type == type_filter)
    purchases = q.all()
    total = sum(p.price for p in purchases)
    by_type = {
        "ad": sum(p.price for p in purchases if p.type == PurchaseType.ad),
        "target": sum(p.price for p in purchases if p.type == PurchaseType.target),
    }
    currencies = {p.currency for p in purchases}
    currency = currencies.pop() if len(currencies) == 1 else "mixed"
    return PurchaseSummary(total=total, by_type=by_type, currency=currency, count=len(purchases))


@router.get("")
def list_purchases(
    external_channel_id: Optional[int] = None,
    status: Optional[PurchaseStatus] = None,
    from_: Optional[date] = Query(default=None, alias="from"),
    to: Optional[date] = None,
    type_filter: Optional[str] = Query(default=None, alias="type"),
    page: Optional[int] = None,
    per_page: int = Query(default=15, ge=1, le=100),
    db: Session = Depends(get_db),
    _: User = Depends(read_access),
):
    q = _apply_filters(db.query(AdPurchase), external_channel_id, status, from_, to)
    if type_filter:
        q = q.filter(AdPurchase.type == type_filter)
    q = q.order_by(AdPurchase.date.desc())
    if page is None:
        return q.all()
    total = q.count()
    total_pages = max(1, (total + per_page - 1) // per_page)
    page = max(1, min(page, total_pages))
    items = q.offset((page - 1) * per_page).limit(per_page).all()
    return {
        "items": [AdPurchaseResponse.model_validate(p) for p in items],
        "pagination": {"page": page, "per_page": per_page, "total": total, "total_pages": total_pages},
    }


@router.post("", response_model=AdPurchaseResponse, status_code=201)
def create_purchase(
    data: CreatePurchaseRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(write_access),
):
    ext_ch = None
    if data.type == PurchaseType.ad:
        if not data.external_channel_id:
            raise HTTPException(status_code=400, detail="Площадка обязательна для рекламы")
        ext_ch = db.query(ExternalChannel).filter(ExternalChannel.id == data.external_channel_id).first()
        if not ext_ch:
            raise HTTPException(status_code=404, detail="External channel not found")
        if not data.format:
            raise HTTPException(status_code=400, detail="Формат обязателен для рекламы")
    elif data.type == PurchaseType.target:
        if not data.target_platform or not data.target_platform.strip():
            raise HTTPException(status_code=400, detail="Платформа обязательна для таргета")

    payload = data.model_dump()
    payload["currency"] = "RUB"
    if data.type == PurchaseType.target:
        # Strip ad-only fields so a misbehaving client cannot leave them set.
        payload["external_channel_id"] = None
        payload["format"] = None
        payload["invite_link"] = None
    else:
        payload["target_platform"] = None
    purchase = AdPurchase(**payload, created_by=current_user.id)
    db.add(purchase)
    db.commit()
    db.refresh(purchase)

    if data.type == PurchaseType.ad and ext_ch:
        log_action(db, current_user, "create", "purchase", purchase.id,
                   f"Реклама #{purchase.id}: {ext_ch.name}, {purchase.price} {purchase.currency}")
    else:
        log_action(db, current_user, "create", "purchase", purchase.id,
                   f"Таргет #{purchase.id}: {data.target_platform}, {purchase.price} {purchase.currency}")
    return purchase


@router.get("/{purchase_id}", response_model=AdPurchaseResponse)
def get_purchase(
    purchase_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(read_access),
):
    p = db.query(AdPurchase).filter(AdPurchase.id == purchase_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="Purchase not found")
    return p


def _type_str(t) -> str:
    return t.value if hasattr(t, "value") else str(t)


async def _resolve_tg_chat_id(db: Session, svc, ch: Channel) -> int:
    """Return a numeric Telegram chat_id for the channel, resolving and
    caching it on first use.

    Order of preference:
      1. ch.tg_chat_id if already cached (works for public + private)
      2. Resolve via getChat using @username derived from ch.tg_link,
         cache result back to ch.tg_chat_id

    Raises HTTPException(400) when there's no way to identify the chat.
    """
    if ch.tg_chat_id:
        return ch.tg_chat_id

    from ..services.telegram_cpa import TelegramCPAError, _extract_username
    if not ch.tg_link:
        raise HTTPException(
            status_code=400,
            detail=(
                "Не задан числовой ID канала и нет TG-ссылки — "
                "укажите Chat ID в настройках канала (нужен для приватных каналов)."
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


@router.patch("/{purchase_id}", response_model=AdPurchaseResponse)
def update_purchase(
    purchase_id: int,
    data: UpdatePurchaseRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(write_access),
):
    p = db.query(AdPurchase).filter(AdPurchase.id == purchase_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="Purchase not found")

    updates = data.model_dump(exclude_unset=True)
    # Currency is server-controlled.
    updates.pop("currency", None)

    old_type = _type_str(p.type)
    new_type_raw = updates.get("type", p.type)
    new_type = _type_str(new_type_raw)
    type_changing = "type" in updates and new_type != old_type

    # Validate required fields for the post-update type.
    if new_type == PurchaseType.target.value:
        target_platform = updates.get("target_platform", p.target_platform)
        if not target_platform:
            raise HTTPException(
                status_code=400,
                detail="target_platform is required for type=target",
            )
    elif new_type == PurchaseType.ad.value:
        # On a target→ad switch the client must supply external_channel_id
        # in the same payload, otherwise the row would violate the CHECK.
        ext_channel = updates.get("external_channel_id", p.external_channel_id)
        if not ext_channel:
            raise HTTPException(
                status_code=400,
                detail="external_channel_id is required for type=ad",
            )

    # invite_link is allowed only for ad — covers the third CHECK constraint.
    if "invite_link" in updates and updates["invite_link"] is not None \
            and new_type != PurchaseType.ad.value:
        raise HTTPException(
            status_code=400,
            detail="invite_link is not allowed for type=target",
        )

    # Cleanup stale fields from the old type. Drop the corresponding keys
    # from the payload so client values cannot reintroduce them.
    if type_changing:
        if new_type == PurchaseType.target.value:
            p.external_channel_id = None
            p.format = None
            p.invite_link = None
            p.joined_count = 0
            p.left_count = 0
            p.cpa_synced_at = None
            for k in ("external_channel_id", "format", "invite_link",
                      "joined_count", "left_count"):
                updates.pop(k, None)
        elif new_type == PurchaseType.ad.value:
            p.target_platform = None
            updates.pop("target_platform", None)

    # Apply remaining payload fields.
    for field, value in updates.items():
        setattr(p, field, value)

    db.commit()
    db.refresh(p)
    log_action(db, current_user, "update", "purchase", p.id, f"Закупка #{p.id} обновлена")
    return p


@router.post("/{purchase_id}/invite-link", response_model=InviteLinkResponse)
async def create_invite_link(
    purchase_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(write_access),
):
    p = db.query(AdPurchase).filter(AdPurchase.id == purchase_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="Purchase not found")
    if p.type != PurchaseType.ad:
        raise HTTPException(status_code=400, detail="Инвайт-ссылки доступны только для рекламных закупок")
    if p.invite_link:
        return InviteLinkResponse(invite_link=p.invite_link)

    if not p.channel_id:
        raise HTTPException(status_code=400, detail="Канал не привязан к закупке")
    ch = db.query(Channel).filter(Channel.id == p.channel_id).first()
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
    try:
        chat_id = await _resolve_tg_chat_id(db, svc, ch)
    except HTTPException:
        raise
    try:
        link = await svc.create_invite_link(chat_id, p.id)
    except TelegramCPAError as e:
        raise HTTPException(status_code=502, detail=str(e))

    p.invite_link = link
    db.commit()
    log_action(db, current_user, "update", "purchase", p.id, f"Создана инвайт-ссылка для закупки #{p.id}")
    return InviteLinkResponse(invite_link=link)


@router.post("/{purchase_id}/sync-cpa", response_model=CpaSyncResponse)
async def sync_cpa(
    purchase_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(write_access),
):
    p = db.query(AdPurchase).filter(AdPurchase.id == purchase_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="Purchase not found")
    if p.type != PurchaseType.ad:
        raise HTTPException(status_code=400, detail="CPA синхронизация доступна только для рекламных закупок")
    if not p.invite_link:
        raise HTTPException(status_code=400, detail="Инвайт-ссылка не создана")
    if not p.channel_id:
        raise HTTPException(status_code=400, detail="Канал не привязан к закупке")

    ch = db.query(Channel).filter(Channel.id == p.channel_id).first()
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
    try:
        chat_id = await _resolve_tg_chat_id(db, svc, ch)
    except HTTPException:
        raise
    try:
        member_count = await svc.get_invite_link_member_count(chat_id, p.invite_link)
    except TelegramCPAError as e:
        raise HTTPException(status_code=502, detail=str(e))

    # `member_count` is the CUMULATIVE total of unique users who joined via
    # this invite link, not a delta. Assign (don't `+=`) so syncing twice
    # produces the same result as syncing once. The delta `(current - prev)`
    # gives "new joins since last sync" — useful for charting later.
    #
    # Re-join limitation: if a user leaves and re-joins through the same
    # link, Telegram counts them again. Bot API does not expose unique
    # joiners separately, so joined_count may slightly overcount in high-
    # churn channels. No workaround is available.
    p.joined_count = member_count
    p.cpa_last_member_count = member_count
    p.cpa_synced_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(p)

    log_action(db, current_user, "update", "purchase", p.id,
               f"CPA: {p.joined_count} вступило по инвайт-ссылке")
    return CpaSyncResponse(
        joined_count=p.joined_count,
        left_count=p.left_count,
        cpa_synced_at=p.cpa_synced_at,
    )


@router.delete("/{purchase_id}", status_code=204)
def delete_purchase(
    purchase_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(write_access),
):
    p = db.query(AdPurchase).filter(AdPurchase.id == purchase_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="Purchase not found")
    if p.type == PurchaseType.ad and p.external_channel:
        desc = f"Реклама #{p.id}: {p.external_channel.name}, {p.price} {p.currency}"
    else:
        desc = f"Таргет #{p.id}: {p.target_platform}, {p.price} {p.currency}"
    db.delete(p)
    db.commit()
    log_action(db, current_user, "delete", "purchase", purchase_id, desc)
