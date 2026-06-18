import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from alembic.config import Config as AlembicConfig
from alembic import command as alembic_command

from .config import settings
from .database import SessionLocal
from .models.user import User, UserRole
from .models.cpa_member import CpaMember  # noqa: F401 — ensures table is in metadata for migrations
from .routers import auth, users, channels

logger = logging.getLogger(__name__)
from .routers.purchases import router as purchases_router, router_ext as ext_channels_router
from .routers.sales import router as sales_router
from .routers.budget import router as budget_router
from .routers.dashboard import router as dashboard_router
from .routers.activity import router as activity_router
from .routers.system_settings import router as system_settings_router
from .routers.stats import router as stats_router
from .scheduler import start_scheduler, stop_scheduler


def _run_migrations() -> None:
    cfg = AlembicConfig("alembic.ini")
    alembic_command.upgrade(cfg, "head")


def _check_admin_exists() -> None:
    """Non-destructive check: warn if no root user exists.

    No user is created or modified here. Create a root user manually via
    psql or a one-off script if this warning appears.
    """
    db = SessionLocal()
    try:
        count = db.query(User).filter(User.role == UserRole.root).count()
        if count == 0:
            logger.warning(
                "WARNING: No root users found in database. "
                "Create one manually via psql or a seed script."
            )
    finally:
        db.close()


async def _check_telegram_webhook() -> None:
    """Warn (don't crash) if a webhook is active on the configured bot token."""
    from .database import SessionLocal
    from .db_settings import get_setting
    from .services.telegram_cpa import check_webhook_conflict, TelegramWebhookConflict

    db = SessionLocal()
    try:
        token = get_setting(db, "telegram_bot_token", settings.telegram_bot_token)
    finally:
        db.close()
    if not token:
        return
    try:
        await check_webhook_conflict(token)
    except TelegramWebhookConflict:
        # Already logged inside the service; do not abort startup.
        pass
    except Exception as e:
        logger.warning("Telegram webhook check failed: %s", e)


@asynccontextmanager
async def lifespan(app: FastAPI):
    _run_migrations()
    _check_admin_exists()
    await _check_telegram_webhook()
    start_scheduler()
    yield
    stop_scheduler()


app = FastAPI(title="CRM API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.cors_origin],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(users.router)
app.include_router(channels.router)
app.include_router(ext_channels_router)
app.include_router(purchases_router)
app.include_router(sales_router)
app.include_router(budget_router)
app.include_router(dashboard_router)
app.include_router(activity_router)
app.include_router(system_settings_router)
app.include_router(stats_router)


@app.get("/health")
def health():
    return {"status": "ok"}
