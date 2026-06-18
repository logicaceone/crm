from datetime import date, datetime
from typing import Optional
from pydantic import BaseModel
from ..models.purchase import AdFormat, PurchaseStatus, PurchaseType


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


class AdPurchaseResponse(BaseModel):
    id: int
    type: PurchaseType
    external_channel_id: Optional[int] = None
    external_channel: Optional[ExternalChannelResponse] = None
    target_platform: Optional[str] = None
    channel_id: Optional[int] = None
    channel: Optional[ChannelRef] = None
    date: date
    price: float
    currency: str
    format: Optional[AdFormat] = None
    status: PurchaseStatus
    comment: Optional[str]
    invite_link: Optional[str] = None
    joined_count: int = 0
    left_count: int = 0
    cpa_synced_at: Optional[datetime] = None
    created_by: int
    creator: CreatorRef
    created_at: datetime

    model_config = {"from_attributes": True}


class CreatePurchaseRequest(BaseModel):
    type: PurchaseType = PurchaseType.ad
    # Ad fields
    external_channel_id: Optional[int] = None
    format: Optional[AdFormat] = None
    # Target fields
    target_platform: Optional[str] = None
    # Common
    channel_id: Optional[int] = None
    date: date
    price: float
    currency: str = "RUB"
    status: PurchaseStatus = PurchaseStatus.planned
    comment: Optional[str] = None
    invite_link: Optional[str] = None


class UpdatePurchaseRequest(BaseModel):
    type: Optional[PurchaseType] = None
    external_channel_id: Optional[int] = None
    target_platform: Optional[str] = None
    channel_id: Optional[int] = None
    date: Optional[date] = None
    price: Optional[float] = None
    currency: Optional[str] = None
    format: Optional[AdFormat] = None
    status: Optional[PurchaseStatus] = None
    comment: Optional[str] = None
    invite_link: Optional[str] = None
    joined_count: Optional[int] = None
    left_count: Optional[int] = None


class InviteLinkResponse(BaseModel):
    invite_link: str


class CpaSyncResponse(BaseModel):
    joined_count: int
    left_count: int
    cpa_synced_at: datetime


class PurchaseSummary(BaseModel):
    total: float
    currency: str
    count: int
    by_type: dict[str, float] = {}
