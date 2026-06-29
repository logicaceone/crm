from datetime import date
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db
from ..dependencies import verify_bot_token
from ..models.user import User
from ..models.channel import Channel
from ..models.expense import Expense, ExpenseCategory, ExpenseStatus

router = APIRouter(
    prefix="/bot",
    tags=["bot"],
    dependencies=[Depends(verify_bot_token)],
)


@router.get("/user/{telegram_username}")
def get_user_by_telegram(
    telegram_username: str,
    db: Session = Depends(get_db),
):
    username = telegram_username.lstrip("@")
    user = (
        db.query(User)
        .filter(User.telegram_username == username)
        .first()
    )
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return {
        "id": user.id,
        "username": user.username,
        "role": user.role.value,
    }


@router.get("/channels")
def get_channels_for_bot(db: Session = Depends(get_db)):
    channels = db.query(Channel).order_by(Channel.name).all()
    return [
        {
            "id": ch.id,
            "name": ch.name,
            "platform": ch.platform.value,
        }
        for ch in channels
    ]


class BotExpenseCreate(BaseModel):
    category: str
    date: date
    price: float
    currency: str = "RUB"
    status: str = "placed"
    responsible: Optional[str] = None
    comment: Optional[str] = None
    channel_id: Optional[int] = None
    created_by: Optional[int] = None


_VALID_CATEGORIES = {c.value for c in ExpenseCategory}
_VALID_STATUSES = {s.value for s in ExpenseStatus}


@router.post("/expenses")
def create_expense_from_bot(
    payload: BotExpenseCreate,
    db: Session = Depends(get_db),
):
    if payload.category not in _VALID_CATEGORIES:
        raise HTTPException(status_code=400, detail=f"Invalid category: {payload.category}")
    if payload.status not in _VALID_STATUSES:
        raise HTTPException(status_code=400, detail=f"Invalid status: {payload.status}")

    if payload.category in (ExpenseCategory.other.value, ExpenseCategory.salary.value) and not (payload.comment and payload.comment.strip()):
        raise HTTPException(status_code=400, detail=f"Comment required for category '{payload.category}'")

    expense = Expense(
        category=ExpenseCategory(payload.category),
        date=payload.date,
        price=payload.price,
        currency=payload.currency,
        status=ExpenseStatus(payload.status),
        responsible=payload.responsible,
        comment=payload.comment,
        channel_id=payload.channel_id,
        created_by=payload.created_by,
    )
    db.add(expense)
    db.commit()
    db.refresh(expense)
    return {"id": expense.id, "status": "created"}
