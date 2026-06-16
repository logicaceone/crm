from datetime import date, datetime
from typing import Optional
from pydantic import BaseModel


class ChannelStatResponse(BaseModel):
    id: int
    channel_id: int
    date: date
    subscribers_count: Optional[int] = None
    avg_views_per_post: Optional[int] = None

    model_config = {"from_attributes": True}


class ChannelResponse(BaseModel):
    id: int
    name: str
    tg_link: Optional[str]
    description: Optional[str]
    created_at: datetime

    model_config = {"from_attributes": True}


class ChannelWithStats(ChannelResponse):
    last_subscriber_stat: Optional[ChannelStatResponse] = None
    last_views_stat: Optional[ChannelStatResponse] = None
    stat_30d_ago: Optional[ChannelStatResponse] = None


class CreateChannelRequest(BaseModel):
    name: str
    tg_link: Optional[str] = None
    description: Optional[str] = None


class UpdateChannelRequest(BaseModel):
    name: Optional[str] = None
    tg_link: Optional[str] = None
    description: Optional[str] = None


class CreateStatRequest(BaseModel):
    date: date
    avg_views_per_post: int
