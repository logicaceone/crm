from datetime import date, datetime
from typing import Optional
from pydantic import BaseModel
from ..models.expense import AdFormat
from ..models.sale import SaleStatus


class ChannelRef(BaseModel):
    id: int
    name: str
    tg_link: Optional[str]

    model_config = {"from_attributes": True}


class CreatorRef(BaseModel):
    id: int
    username: str

    model_config = {"from_attributes": True}


class AdSaleResponse(BaseModel):
    id: int
    client_name: str
    channel_id: int
    channel: ChannelRef
    date: date
    price: float
    currency: str
    format: AdFormat
    status: SaleStatus
    comment: Optional[str]
    created_by: int
    creator: CreatorRef
    created_at: datetime

    model_config = {"from_attributes": True}


class CreateSaleRequest(BaseModel):
    client_name: str
    channel_id: int
    date: date
    price: float
    currency: str = "RUB"
    format: AdFormat
    status: SaleStatus = SaleStatus.agreed
    comment: Optional[str] = None


class UpdateSaleRequest(BaseModel):
    client_name: Optional[str] = None
    channel_id: Optional[int] = None
    date: Optional[date] = None
    price: Optional[float] = None
    currency: Optional[str] = None
    format: Optional[AdFormat] = None
    status: Optional[SaleStatus] = None
    comment: Optional[str] = None


class SaleSummary(BaseModel):
    total: float
    currency: str
    count: int
