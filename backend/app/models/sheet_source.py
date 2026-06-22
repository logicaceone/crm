from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey, Text
from sqlalchemy.sql import func
from ..database import Base


class SheetSource(Base):
    __tablename__ = "sheet_sources"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    gid = Column(String, nullable=False, unique=True)
    is_active = Column(Boolean, nullable=False, default=True, server_default="true")
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    last_synced_at = Column(DateTime(timezone=True), nullable=True)
    # JSON-encoded {"created": N, "skipped": N, "errors": N}
    last_sync_result = Column(String, nullable=True)


class SheetsImportLog(Base):
    """Dedup record + raw row backup for every row pulled from Sheets.

    row_hash includes the source gid so the same row appearing in two
    sheets is intentionally NOT deduped — each sheet is its own truth.
    """
    __tablename__ = "sheets_import_log"

    id = Column(Integer, primary_key=True, index=True)
    row_hash = Column(String, nullable=False, unique=True, index=True)
    sheet_source_id = Column(
        Integer,
        ForeignKey("sheet_sources.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    imported_at = Column(DateTime(timezone=True), server_default=func.now())
    # SET NULL so deleting a sheet source doesn't cascade-delete the
    # expenses it produced — the user expects them to stick around.
    expense_id = Column(
        Integer,
        ForeignKey("expenses.id", ondelete="SET NULL"),
        nullable=True,
    )
    raw_data = Column(Text, nullable=True)
