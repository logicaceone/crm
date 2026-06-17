from datetime import date, datetime
from typing import Optional
from pydantic import BaseModel


class ChannelStatResponse(BaseModel):
    id: int
    channel_id: int
    date: date
    subscribers_count: Optional[int] = None
    avg_views_per_post: Optional[int] = None
    posts_sampled: Optional[int] = None

    model_config = {"from_attributes": True}


class ChannelResponse(BaseModel):
    id: int
    name: str
    platform: str
    tg_link: Optional[str]
    description: Optional[str]
    max_chat_id: Optional[int] = None
    max_chat_link: Optional[str] = None
    max_bot_token_set: bool = False
    created_at: datetime

    model_config = {"from_attributes": True}

    @classmethod
    def from_orm_with_token_flag(cls, ch) -> "ChannelResponse":
        obj = cls.model_validate(ch)
        object.__setattr__(obj, "max_bot_token_set", bool(ch.max_bot_token))
        return obj


class ChannelWithStats(ChannelResponse):
    last_subscriber_stat: Optional[ChannelStatResponse] = None
    last_views_stat: Optional[ChannelStatResponse] = None
    stat_30d_ago: Optional[ChannelStatResponse] = None


class CreateChannelRequest(BaseModel):
    name: str
    platform: str = "telegram"
    tg_link: Optional[str] = None
    description: Optional[str] = None
    max_chat_link: Optional[str] = None
    max_bot_token: Optional[str] = None


class UpdateChannelRequest(BaseModel):
    name: Optional[str] = None
    platform: Optional[str] = None
    tg_link: Optional[str] = None
    description: Optional[str] = None
    max_chat_link: Optional[str] = None
    max_bot_token: Optional[str] = None  # plaintext; backend encrypts before storing


class CreateStatRequest(BaseModel):
    date: date
    avg_views_per_post: int


class SyncResult(BaseModel):
    subscribers: Optional[int]
    avg_views: Optional[int]
    posts_sampled: Optional[int]
    posts_total: Optional[int]
    synced_at: datetime
