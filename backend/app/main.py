import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy.exc import IntegrityError
from alembic.config import Config as AlembicConfig  # used by _check_migration_revision
from alembic.runtime.migration import MigrationContext
from alembic.script import ScriptDirectory

from .config import settings
from .database import SessionLocal, engine
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
from .routers.cpf import router as cpf_router
from .scheduler import start_scheduler, stop_scheduler


def _check_migration_revision() -> None:
    """Read-only check that the DB schema matches the Alembic head.

    Migrations are applied by entrypoint.sh BEFORE any worker starts.
    This function just compares the recorded revision against the
    scripts directory and warns if they disagree — safe to run from
    every worker because it only reads.
    """
    try:
        cfg = AlembicConfig("alembic.ini")
        script = ScriptDirectory.from_config(cfg)
        head = script.get_current_head()
        with engine.connect() as conn:
            current = MigrationContext.configure(conn).get_current_revision()
        if current != head:
            logger.warning(
                "Database schema is NOT up to date — current=%s, head=%s. "
                "Run `alembic upgrade head` (entrypoint.sh does this on container start).",
                current, head,
            )
        else:
            logger.info("Database schema up to date at revision %s", current)
    except Exception as e:
        logger.warning("Migration revision check failed: %s", e)


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
    # Migrations are applied by entrypoint.sh BEFORE uvicorn starts —
    # safe with multiple workers (no race, no double-apply). We only
    # read the revision here to surface a clear warning if someone
    # bypassed the entrypoint (e.g. running the app outside Docker).
    _check_migration_revision()
    _check_admin_exists()
    await _check_telegram_webhook()
    start_scheduler()
    yield
    stop_scheduler()


app = FastAPI(title="CRM API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
logger.info("CORS allowed origins: %s", settings.cors_origins_list)

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
app.include_router(cpf_router)


# Map DB constraint names to user-facing 400 messages. Defence-in-depth:
# the application layer should reject these states first; the handler here
# catches anything that slips through (raw API misuse, race conditions,
# future code that forgets a validator).
_CONSTRAINT_MESSAGES: dict[str, str] = {
    "ck_purchase_invite_link_type": "invite_link is not allowed for type=target",
    "ck_purchase_target_platform": "target_platform is required for type=target",
    "ck_purchase_ad_channel": "external_channel_id is required for type=ad",
    "uq_channel_stat_channel_date": "Snapshot for this channel and date already exists",
}


@app.exception_handler(IntegrityError)
async def integrity_error_handler(_request: Request, exc: IntegrityError) -> JSONResponse:
    # Session rollback is handled inside get_db's except block; by the time
    # this handler runs the failed session is already cleaned up.
    error_str = str(getattr(exc, "orig", exc))
    detail = next(
        (msg for name, msg in _CONSTRAINT_MESSAGES.items() if name in error_str),
        "Database constraint violation",
    )
    logger.warning("IntegrityError: %s", error_str)
    return JSONResponse(status_code=400, content={"detail": detail})


@app.get("/health")
def health():
    return {"status": "ok"}
