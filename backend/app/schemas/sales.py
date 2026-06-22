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
    channel_id: Optional[int] = None
    channel: Optional[ChannelRef] = None
    date: date
    paid_at: Optional[date] = None
    price: float
    currency: str
    format: Optional[AdFormat] = None
    status: SaleStatus
    comment: Optional[str]
    topic: Optional[str] = None
    created_by: Optional[int] = None
    creator: Optional[CreatorRef] = None
    created_at: datetime
    # Whether this sale came from a Google Sheets import. Populated by
    # the router (joined against sales_import_log) so the UI can tag it.
    imported_from_sheet: bool = False

    model_config = {"from_attributes": True}


class CreateSaleRequest(BaseModel):
    client_name: str
    channel_id: Optional[int] = None
    date: date
    paid_at: Optional[date] = None
    price: float
    currency: str = "RUB"
    format: Optional[AdFormat] = None
    status: SaleStatus = SaleStatus.agreed
    comment: Optional[str] = None
    topic: Optional[str] = None


class UpdateSaleRequest(BaseModel):
    client_name: Optional[str] = None
    channel_id: Optional[int] = None
    date: Optional[date] = None
    paid_at: Optional[date] = None
    price: Optional[float] = None
    currency: Optional[str] = None
    format: Optional[AdFormat] = None
    status: Optional[SaleStatus] = None
    comment: Optional[str] = None
    topic: Optional[str] = None


class SaleSummary(BaseModel):
    total: float
    currency: str
    count: int
