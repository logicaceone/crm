from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey, Text
from sqlalchemy.sql import func
from ..database import Base


class SalesSheetSource(Base):
    __tablename__ = "sales_sheet_sources"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    gid = Column(String, nullable=False, unique=True)
    is_active = Column(Boolean, nullable=False, default=True, server_default="true")
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    last_synced_at = Column(DateTime(timezone=True), nullable=True)
    last_sync_result = Column(String, nullable=True)


class SalesImportLog(Base):
    """Dedup record + raw row backup for sales-sheet imports."""
    __tablename__ = "sales_import_log"

    id = Column(Integer, primary_key=True, index=True)
    row_hash = Column(String, nullable=False, unique=True, index=True)
    sales_sheet_source_id = Column(
        Integer,
        ForeignKey("sales_sheet_sources.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    imported_at = Column(DateTime(timezone=True), server_default=func.now())
    # SET NULL so deleting the source doesn't cascade-drop the sales.
    sale_id = Column(
        Integer,
        ForeignKey("ad_sales.id", ondelete="SET NULL"),
        nullable=True,
    )
    raw_data = Column(Text, nullable=True)
