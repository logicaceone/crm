from fastapi import Depends, HTTPException, Request
from sqlalchemy.orm import Session

from .database import get_db
from .db_settings import get_setting


def verify_bot_token(
    request: Request,
    db: Session = Depends(get_db),
) -> bool:
    token = request.headers.get("X-Bot-Token")
    if not token:
        raise HTTPException(status_code=401, detail="Missing X-Bot-Token header")

    stored = get_setting(db, "bot_api_key")
    if not stored:
        raise HTTPException(status_code=503, detail="Bot API key not configured")

    if stored != token:
        raise HTTPException(status_code=401, detail="Invalid X-Bot-Token")

    return True
