from sqlalchemy import Column, Integer, String, Text, DateTime
from sqlalchemy.sql import func
from ..database import Base


class MaxdashCache(Base):
    """Cached MaxDash API responses, keyed by a hash of filter params.

    Hit-rate matters here: MaxDash bills per request, so a 24h TTL with
    a deterministic key derived from (region, category, q, …) keeps the
    bill low even if 30 users browse the same default view.
    """
    __tablename__ = "maxdash_cache"

    id = Column(Integer, primary_key=True, index=True)
    cache_key = Column(String, nullable=False, unique=True, index=True)
    # JSON-encoded API payload. Text (not JSON column) so we can swap
    # implementations later without an alembic migration.
    data = Column(Text, nullable=False)
    cached_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    expires_at = Column(DateTime(timezone=True), nullable=False)
