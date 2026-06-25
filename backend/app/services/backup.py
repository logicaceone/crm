"""Nightly Postgres dump → Telegram.

The backend container talks to postgres over the docker network
(`pg_dump -h postgres -U crm_user -d crm` with PGPASSWORD), gzips
the dump, ships it to a chat via the same bot the daily report uses,
then purges local copies older than backup_keep_days.

`/backups` is a host-mounted volume so dumps survive container
rebuilds. Without the mount the directory still works but contents
disappear on `docker compose up --build`.
"""
from __future__ import annotations

import gzip
import logging
import os
import shutil
import subprocess
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional
from urllib.parse import urlparse

import httpx
from sqlalchemy.orm import Session

from ..config import settings
from ..db_settings import get_setting, set_setting
from ..services.daily_report import _resolve_bot_token  # share fallback chain

logger = logging.getLogger(__name__)

BACKUP_DIR = Path(os.environ.get("BACKUP_DIR", "/backups"))
# Telegram Bot API cap on sendDocument body. Leave headroom for the
# multipart envelope so we don't get rejected on the wire.
TG_MAX_BYTES = 49 * 1024 * 1024

CHAT_ID_KEY = "backup_telegram_chat_id"


# ── helpers ────────────────────────────────────────────────────────────

def _db_dsn() -> tuple[str, str, str, str, int]:
    """Return (host, user, password, db, port) from DATABASE_URL.

    Falls back to docker-compose defaults so this still works in dev
    if DATABASE_URL is missing.
    """
    raw = settings.database_url or "postgresql://crm_user:crm_pass@postgres:5432/crm"
    p = urlparse(raw)
    return (
        p.hostname or "postgres",
        p.username or "crm_user",
        p.password or "",
        (p.path or "/crm").lstrip("/") or "crm",
        p.port or 5432,
    )


def get_backup_chat_id(db: Session) -> Optional[str]:
    """DB override wins over .env so root can change the target chat
    through the UI without redeploying."""
    return get_setting(db, CHAT_ID_KEY, settings.backup_telegram_chat_id)


def set_backup_chat_id(db: Session, value: Optional[str]) -> None:
    set_setting(db, CHAT_ID_KEY, value or None)
    db.commit()


# ── core steps ─────────────────────────────────────────────────────────

def create_backup() -> Path:
    """Run pg_dump → gzip → return the .sql.gz path. Raises on failure."""
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    host, user, password, dbname, port = _db_dsn()

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    gz_path = BACKUP_DIR / f"backup_{timestamp}.sql.gz"

    env = {**os.environ, "PGPASSWORD": password} if password else {**os.environ}
    # Stream pg_dump → gzip → file. Streaming keeps memory flat on
    # large databases and avoids a temp uncompressed dump on disk.
    with gzip.open(gz_path, "wb") as gz:
        proc = subprocess.Popen(
            [
                "pg_dump",
                "-h", host,
                "-p", str(port),
                "-U", user,
                "-d", dbname,
                "--no-owner",
                "--no-acl",
                "--format=plain",
            ],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            env=env,
        )
        assert proc.stdout is not None
        shutil.copyfileobj(proc.stdout, gz)
        _, stderr = proc.communicate(timeout=600)

    if proc.returncode != 0:
        # On failure leave no half-baked .gz behind — the cleanup job
        # wouldn't tell it apart from a real backup.
        try:
            gz_path.unlink()
        except FileNotFoundError:
            pass
        raise RuntimeError(
            f"pg_dump exited {proc.returncode}: {stderr.decode('utf-8', 'replace')[:400]}"
        )

    logger.info("Backup created: %s (%d bytes)", gz_path, gz_path.stat().st_size)
    return gz_path


async def send_backup_to_telegram(gz_path: Path, db: Session) -> bool:
    chat_id = get_backup_chat_id(db)
    bot_token = _resolve_bot_token(db)
    if not chat_id:
        logger.warning("BACKUP_TELEGRAM_CHAT_ID not set — skipping send")
        return False
    if not bot_token:
        logger.warning("No bot token (REPORT_BOT_TOKEN / TELEGRAM_BOT_TOKEN) — skipping send")
        return False

    size = gz_path.stat().st_size
    size_mb = size / 1024 / 1024
    if size > TG_MAX_BYTES:
        logger.error(
            "Backup size %.1fMB exceeds Telegram 50MB limit — not sending",
            size_mb,
        )
        return False

    caption = (
        f"🗄 Резервная копия БД\n"
        f"📅 {datetime.now().strftime('%d.%m.%Y %H:%M')}\n"
        f"📦 {size_mb:.2f} MB\n"
        f"✅ {gz_path.name}"
    )

    url = f"https://api.telegram.org/bot{bot_token}/sendDocument"
    try:
        async with httpx.AsyncClient(timeout=180) as client:
            with open(gz_path, "rb") as f:
                resp = await client.post(
                    url,
                    data={"chat_id": chat_id, "caption": caption},
                    files={"document": (gz_path.name, f, "application/gzip")},
                )
    except Exception as exc:
        logger.error("Telegram sendDocument failed: %s", exc)
        return False

    if resp.status_code != 200 or not resp.json().get("ok"):
        logger.error(
            "Telegram sendDocument failed: status=%s body=%s",
            resp.status_code, resp.text[:500],
        )
        return False

    logger.info("Backup sent to Telegram: %s", gz_path.name)
    return True


def cleanup_old_backups() -> int:
    """Delete *.sql.gz older than backup_keep_days. Returns count removed."""
    if not BACKUP_DIR.exists():
        return 0
    cutoff = datetime.now() - timedelta(days=settings.backup_keep_days)
    deleted = 0
    for f in BACKUP_DIR.glob("backup_*.sql.gz"):
        try:
            if datetime.fromtimestamp(f.stat().st_mtime) < cutoff:
                f.unlink()
                deleted += 1
                logger.info("Deleted old backup: %s", f.name)
        except FileNotFoundError:
            continue
    return deleted


async def _notify_failure(db: Session, error: str) -> None:
    chat_id = get_backup_chat_id(db)
    bot_token = _resolve_bot_token(db)
    if not (chat_id and bot_token):
        return
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            await client.post(
                f"https://api.telegram.org/bot{bot_token}/sendMessage",
                json={
                    "chat_id": chat_id,
                    "text": f"❌ Ошибка создания бэкапа БД\n{error[:1000]}",
                },
            )
    except Exception as exc:
        logger.error("Failed to send backup failure notification: %s", exc)


async def run_backup(db: Session) -> dict:
    """Full pipeline: create → send → cleanup. Returns status dict."""
    if not settings.backup_enabled:
        return {"status": "disabled"}

    result: dict = {
        "status": "ok",
        "file": None,
        "size_mb": None,
        "sent_to_telegram": False,
        "deleted_old": 0,
    }
    try:
        # pg_dump is blocking; run in a thread so we don't stall the
        # event loop while it ships ~1MB+ to disk.
        import asyncio
        gz_path = await asyncio.to_thread(create_backup)
        result["file"] = gz_path.name
        result["size_mb"] = round(gz_path.stat().st_size / 1024 / 1024, 2)
        result["sent_to_telegram"] = await send_backup_to_telegram(gz_path, db)
        result["deleted_old"] = await asyncio.to_thread(cleanup_old_backups)
    except Exception as exc:
        logger.exception("Backup failed: %s", exc)
        result["status"] = "error"
        result["error"] = str(exc)
        await _notify_failure(db, str(exc))
    return result
