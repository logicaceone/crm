from datetime import date, datetime
from typing import Optional
from pydantic import BaseModel
from ..models.expense import ExpenseCategory, ExpenseStatus


class ExternalChannelResponse(BaseModel):
    id: int
    name: str
    tg_link: Optional[str]
    created_at: datetime

    model_config = {"from_attributes": True}


class CreateExternalChannelRequest(BaseModel):
    name: str
    tg_link: Optional[str] = None


class CreatorRef(BaseModel):
    id: int
    username: str

    model_config = {"from_attributes": True}


class ChannelRef(BaseModel):
    id: int
    name: str
    platform: str

    model_config = {"from_attributes": True}


class ExpenseResponse(BaseModel):
    id: int
    category: ExpenseCategory
    external_channel_id: Optional[int] = None
    external_channel: Optional[ExternalChannelResponse] = None
    channel_id: Optional[int] = None
    channel: Optional[ChannelRef] = None
    date: date
    price: float
    currency: str
    status: ExpenseStatus
    comment: Optional[str]
    responsible: Optional[str] = None
    invite_link: Optional[str] = None
    joined_count: int = 0
    left_count: int = 0
    cpa_synced_at: Optional[datetime] = None
    created_by: Optional[int] = None
    creator: Optional[CreatorRef] = None
    created_at: datetime

    model_config = {"from_attributes": True}


class CreateExpenseRequest(BaseModel):
    category: ExpenseCategory
    external_channel_id: Optional[int] = None
    channel_id: Optional[int] = None
    date: date
    price: float
    currency: str = "RUB"
    status: ExpenseStatus = ExpenseStatus.planned
    comment: Optional[str] = None
    responsible: Optional[str] = None
    invite_link: Optional[str] = None


class UpdateExpenseRequest(BaseModel):
    category: Optional[ExpenseCategory] = None
    external_channel_id: Optional[int] = None
    channel_id: Optional[int] = None
    date: Optional[date] = None
    price: Optional[float] = None
    currency: Optional[str] = None
    status: Optional[ExpenseStatus] = None
    comment: Optional[str] = None
    responsible: Optional[str] = None
    invite_link: Optional[str] = None
    joined_count: Optional[int] = None
    left_count: Optional[int] = None


class InviteLinkResponse(BaseModel):
    invite_link: str


class CpaSyncResponse(BaseModel):
    joined_count: int
    left_count: int
    cpa_synced_at: datetime


class ExpenseSummary(BaseModel):
    total: float
    currency: str
    count: int
    by_category: dict[str, float] = {}
