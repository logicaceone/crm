import json
import logging
from datetime import datetime
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db
from ..models.user import User, UserRole
from ..models.sheet_source import SheetSource
from ..services.sheets_sync import sync_source, sync_all_sources, preview_sheet
from .auth import require_roles
from ..activity import log_action

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/sheets", tags=["sheets"])

root_only = require_roles([UserRole.root])


class SheetSourceResponse(BaseModel):
    id: int
    name: str
    gid: str
    is_active: bool
    created_at: datetime
    last_synced_at: Optional[datetime] = None
    last_sync_result: Optional[dict] = None

    model_config = {"from_attributes": True}

    @classmethod
    def from_orm_row(cls, s: SheetSource) -> "SheetSourceResponse":
        parsed: Optional[dict] = None
        if s.last_sync_result:
            try:
                parsed = json.loads(s.last_sync_result)
            except json.JSONDecodeError:
                parsed = {"raw": s.last_sync_result}
        return cls(
            id=s.id, name=s.name, gid=s.gid, is_active=s.is_active,
            created_at=s.created_at,
            last_synced_at=s.last_synced_at,
            last_sync_result=parsed,
        )


class CreateSheetSourceRequest(BaseModel):
    name: str
    gid: str


class UpdateSheetSourceRequest(BaseModel):
    name: Optional[str] = None
    gid: Optional[str] = None
    is_active: Optional[bool] = None


class SyncResultPayload(BaseModel):
    created: int
    skipped: int
    errors: int
    error_message: Optional[str] = None


@router.get("/sources", response_model=list[SheetSourceResponse])
def list_sources(
    db: Session = Depends(get_db),
    _: User = Depends(root_only),
):
    rows = db.query(SheetSource).order_by(SheetSource.created_at).all()
    return [SheetSourceResponse.from_orm_row(s) for s in rows]


@router.post("/sources", response_model=SheetSourceResponse, status_code=201)
def create_source(
    data: CreateSheetSourceRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(root_only),
):
    gid = data.gid.strip()
    name = data.name.strip()
    if not gid or not name:
        raise HTTPException(status_code=400, detail="Имя и GID обязательны")

    if db.query(SheetSource).filter(SheetSource.gid == gid).first():
        raise HTTPException(status_code=400, detail="Лист с таким GID уже добавлен")

    s = SheetSource(name=name, gid=gid, is_active=True)
    db.add(s)
    db.commit()
    db.refresh(s)
    log_action(db, current_user, "create", "sheet_source", s.id, f"Лист: {s.name} (gid={s.gid})")
    return SheetSourceResponse.from_orm_row(s)


@router.patch("/sources/{source_id}", response_model=SheetSourceResponse)
def update_source(
    source_id: int,
    data: UpdateSheetSourceRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(root_only),
):
    s = db.query(SheetSource).filter(SheetSource.id == source_id).first()
    if not s:
        raise HTTPException(status_code=404, detail="Лист не найден")

    updates = data.model_dump(exclude_unset=True)
    if "gid" in updates and updates["gid"]:
        gid_new = updates["gid"].strip()
        if gid_new != s.gid and db.query(SheetSource).filter(
            SheetSource.gid == gid_new, SheetSource.id != source_id
        ).first():
            raise HTTPException(status_code=400, detail="Лист с таким GID уже добавлен")
        s.gid = gid_new
    if "name" in updates and updates["name"]:
        s.name = updates["name"].strip()
    if "is_active" in updates and updates["is_active"] is not None:
        s.is_active = bool(updates["is_active"])

    db.commit()
    db.refresh(s)
    log_action(db, current_user, "update", "sheet_source", s.id, f"Лист {s.name} обновлён")
    return SheetSourceResponse.from_orm_row(s)


@router.delete("/sources/{source_id}", status_code=204)
def delete_source(
    source_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(root_only),
):
    s = db.query(SheetSource).filter(SheetSource.id == source_id).first()
    if not s:
        raise HTTPException(status_code=404, detail="Лист не найден")
    name = s.name
    # FK ondelete='SET NULL' on sheets_import_log preserves expenses + the
    # dedup record so re-adding the same gid later doesn't re-import the
    # same rows.
    db.delete(s)
    db.commit()
    log_action(db, current_user, "delete", "sheet_source", source_id, f"Лист: {name}")


@router.post("/sources/{source_id}/sync", response_model=SyncResultPayload)
async def sync_one(
    source_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(root_only),
):
    s = db.query(SheetSource).filter(SheetSource.id == source_id).first()
    if not s:
        raise HTTPException(status_code=404, detail="Лист не найден")
    result = await sync_source(s, db)
    log_action(
        db, current_user, "update", "sheet_source", s.id,
        f"Синхронизация: {result.get('created')} создано, "
        f"{result.get('skipped')} пропущено, {result.get('errors')} ошибок",
    )
    return SyncResultPayload(
        created=result.get("created", 0),
        skipped=result.get("skipped", 0),
        errors=result.get("errors", 0),
        error_message=result.get("error_message"),
    )


@router.post("/sync-all")
async def sync_all(
    db: Session = Depends(get_db),
    current_user: User = Depends(root_only),
):
    results = await sync_all_sources(db)
    total = {
        "created": sum(r["created"] for r in results),
        "skipped": sum(r["skipped"] for r in results),
        "errors": sum(r["errors"] for r in results),
    }
    log_action(
        db, current_user, "update", "sheet_source", None,
        f"Массовая синхронизация Sheets: {total['created']} создано, "
        f"{total['skipped']} пропущено, {total['errors']} ошибок",
    )
    return {"results": results, "total": total}


class TestSourceRequest(BaseModel):
    gid: str


@router.post("/sources/test")
async def test_source(data: TestSourceRequest, _: User = Depends(root_only)):
    """Probe a gid without saving — used by the 'Проверить' button on the
    add-source modal so the user can confirm the sheet is reachable
    before persisting."""
    gid = data.gid.strip()
    if not gid:
        raise HTTPException(status_code=400, detail="GID обязателен")
    try:
        preview = await preview_sheet(gid)
    except httpx.HTTPStatusError as e:
        raise HTTPException(
            status_code=400,
            detail=f"Лист недоступен (HTTP {e.response.status_code}). "
                   "Проверьте GID и доступ к таблице.",
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Ошибка: {e}")
    return preview
