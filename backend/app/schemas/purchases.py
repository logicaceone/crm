from datetime import date, datetime
from typing import Optional
from pydantic import BaseModel
from ..models.purchase import AdFormat, PurchaseStatus


class ExternalChannelResponse(BaseModel):
    id: int
    name: str
    tg_link: Optional[str]
    created_at: datetime

    model_config = {"from_attributes": True}


class CreateExternalChannelRequest(BaseModel):
    name: str
    tg_link: Optional[str] = None


class AdPurchaseResponse(BaseModel):
    id: int
    external_channel_id: int
    external_channel: ExternalChannelResponse
    date: date
    price: float
    currency: str
    format: AdFormat
    status: PurchaseStatus
    comment: Optional[str]
    created_by: int
    created_at: datetime

    model_config = {"from_attributes": True}


class CreatePurchaseRequest(BaseModel):
    external_channel_id: int
    date: date
    price: float
    currency: str = "RUB"
    format: AdFormat
    status: PurchaseStatus = PurchaseStatus.planned
    comment: Optional[str] = None


class UpdatePurchaseRequest(BaseModel):
    external_channel_id: Optional[int] = None
    date: Optional[date] = None
    price: Optional[float] = None
    currency: Optional[str] = None
    format: Optional[AdFormat] = None
    status: Optional[PurchaseStatus] = None
    comment: Optional[str] = None


class PurchaseSummary(BaseModel):
    total: float
    currency: str
    count: int
