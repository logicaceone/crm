from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db
from ..models.user import User, UserRole
from ..config import settings
from ..db_settings import get_setting, set_setting
from .auth import require_roles
from ..services.telegram_cpa import (
    check_webhook_conflict,
    delete_webhook,
    TelegramCPAError,
    TelegramWebhookConflict,
)

router = APIRouter(prefix="/settings", tags=["settings"])

root_only = require_roles([UserRole.root])


class SettingsResponse(BaseModel):
    telegram_bot_token_set: bool
    max_bot_token_set: bool
    max_api_base_url: str
    max_posts_sample: int


class UpdateSettingsRequest(BaseModel):
    telegram_bot_token: Optional[str] = None  # None=no change; ""=clear; value=update
    max_bot_token: Optional[str] = None        # same semantics
    max_api_base_url: Optional[str] = None
    max_posts_sample: Optional[int] = None


@router.get("", response_model=SettingsResponse)
def get_settings(
    db: Session = Depends(get_db),
    _: User = Depends(root_only),
):
    tg_token = get_setting(db, "telegram_bot_token", settings.telegram_bot_token)
    max_token = get_setting(db, "max_bot_token")
    base_url = get_setting(db, "max_api_base_url") or settings.max_api_base_url
    sample_raw = get_setting(db, "max_posts_sample")
    sample = int(sample_raw) if sample_raw is not None else settings.max_posts_sample

    return SettingsResponse(
        telegram_bot_token_set=bool(tg_token),
        max_bot_token_set=bool(max_token),
        max_api_base_url=base_url,
        max_posts_sample=sample,
    )


@router.patch("", response_model=SettingsResponse)
def update_settings(
    data: UpdateSettingsRequest,
    db: Session = Depends(get_db),
    _: User = Depends(root_only),
):
    if data.telegram_bot_token is not None:
        set_setting(db, "telegram_bot_token", data.telegram_bot_token or None)

    if data.max_bot_token is not None:
        set_setting(db, "max_bot_token", data.max_bot_token or None)

    if data.max_api_base_url is not None:
        set_setting(db, "max_api_base_url", data.max_api_base_url or None)

    if data.max_posts_sample is not None:
        set_setting(db, "max_posts_sample", str(data.max_posts_sample))

    db.commit()
    return get_settings(db=db, _=None)  # type: ignore[arg-type]


class WebhookInfo(BaseModel):
    webhook_active: bool
    webhook_url: Optional[str] = None


@router.get("/telegram/webhook", response_model=WebhookInfo)
async def telegram_webhook_status(
    db: Session = Depends(get_db),
    _: User = Depends(root_only),
):
    token = get_setting(db, "telegram_bot_token", settings.telegram_bot_token)
    if not token:
        raise HTTPException(status_code=400, detail="Telegram Bot Token не задан")
    try:
        await check_webhook_conflict(token)
    except TelegramWebhookConflict as e:
        # Webhook is set — extract URL from the exception message.
        msg = str(e)
        url = msg.split("(", 1)[-1].rstrip(").") if "(" in msg else None
        return WebhookInfo(webhook_active=True, webhook_url=url)
    return WebhookInfo(webhook_active=False)


@router.post("/telegram/delete-webhook")
async def telegram_delete_webhook(
    db: Session = Depends(get_db),
    _: User = Depends(root_only),
):
    token = get_setting(db, "telegram_bot_token", settings.telegram_bot_token)
    if not token:
        raise HTTPException(status_code=400, detail="Telegram Bot Token не задан")
    try:
        result = await delete_webhook(token)
    except TelegramCPAError as e:
        raise HTTPException(status_code=502, detail=str(e))
    return {"deleted": True, "telegram_response": result}


# ── Daily report ────────────────────────────────────────────────────────

class DailyReportConfig(BaseModel):
    enabled: bool
    chat_id_set: bool
    chat_id_masked: Optional[str]
    schedule: str  # human-readable e.g. "23:55 Europe/Moscow"


@router.get("/daily-report", response_model=DailyReportConfig)
def get_daily_report_config(
    db: Session = Depends(get_db),
    _: User = Depends(root_only),
):
    """Surface the report's runtime state without leaking the chat id.

    The toggle is stored in system_settings (string "1"/"0"); the chat
    id stays in .env so a UI bug can't redirect reports to the wrong
    group. We only show a masked tail so an admin can confirm "yes,
    that's the right group".
    """
    enabled_raw = get_setting(db, "daily_report_enabled")
    enabled = enabled_raw != "0"  # default = on
    chat_id = settings.report_chat_id
    masked = None
    if chat_id:
        masked = f"…{chat_id[-4:]}" if len(chat_id) > 4 else chat_id
    return DailyReportConfig(
        enabled=enabled,
        chat_id_set=bool(chat_id),
        chat_id_masked=masked,
        schedule=f"23:55 {settings.report_timezone}",
    )


class UpdateDailyReportRequest(BaseModel):
    enabled: bool


@router.patch("/daily-report", response_model=DailyReportConfig)
def update_daily_report_config(
    data: UpdateDailyReportRequest,
    db: Session = Depends(get_db),
    _: User = Depends(root_only),
):
    set_setting(db, "daily_report_enabled", "1" if data.enabled else "0")
    db.commit()
    return get_daily_report_config(db=db, _=None)  # type: ignore[arg-type]


@router.post("/daily-report/send-test")
async def send_daily_report_test(
    db: Session = Depends(get_db),
    _: User = Depends(root_only),
):
    """Build + send the report on demand. Useful for smoke-testing the
    pipeline without waiting for 23:55.
    """
    from ..services.daily_report import run_daily_report
    result = await run_daily_report(db)
    if not result["sent"]:
        raise HTTPException(
            status_code=502,
            detail="Не удалось отправить отчёт. Проверь REPORT_BOT_TOKEN, "
                   "REPORT_CHAT_ID и логи backend.",
        )
    return {"status": "sent", "channels": result["channels"]}
