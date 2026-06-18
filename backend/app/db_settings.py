from typing import Optional
from sqlalchemy.orm import Session
from .models.settings import SystemSetting


def get_setting(db: Session, key: str, default: Optional[str] = None) -> Optional[str]:
    row = db.query(SystemSetting).filter(SystemSetting.key == key).first()
    return row.value if row is not None else default


def set_setting(db: Session, key: str, value: Optional[str]) -> None:
    row = db.query(SystemSetting).filter(SystemSetting.key == key).first()
    if row:
        row.value = value
    else:
        db.add(SystemSetting(key=key, value=value))
