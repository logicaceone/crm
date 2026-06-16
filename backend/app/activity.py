from typing import Optional
from sqlalchemy.orm import Session
from .models.user import User
from .models.activity import UserAction


def log_action(
    db: Session,
    user: User,
    action: str,
    entity_type: str,
    entity_id: Optional[int] = None,
    description: Optional[str] = None,
) -> None:
    try:
        db.add(UserAction(
            username=user.username,
            role=user.role.value,
            action=action,
            entity_type=entity_type,
            entity_id=entity_id,
            description=description,
        ))
        db.commit()
    except Exception as e:
        print(f"[Activity] Failed to log action: {e}", flush=True)
        db.rollback()
