from datetime import date
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ..database import get_db
from ..models.user import User, UserRole
from ..models.purchase import ExternalChannel, AdPurchase, PurchaseStatus
from ..schemas.purchases import (
    ExternalChannelResponse,
    CreateExternalChannelRequest,
    AdPurchaseResponse,
    CreatePurchaseRequest,
    UpdatePurchaseRequest,
    PurchaseSummary,
)
from .auth import get_current_user, require_roles

router_ext = APIRouter(prefix="/external-channels", tags=["external-channels"])
router = APIRouter(prefix="/purchases", tags=["purchases"])

read_access = require_roles([UserRole.admin, UserRole.manager, UserRole.viewer])
write_access = require_roles([UserRole.admin, UserRole.manager])


# ── External channels ────────────────────────────────────────────────────────

@router_ext.get("", response_model=list[ExternalChannelResponse])
def list_external_channels(
    db: Session = Depends(get_db),
    _: User = Depends(read_access),
):
    return db.query(ExternalChannel).order_by(ExternalChannel.name).all()


@router_ext.post("", response_model=ExternalChannelResponse, status_code=201)
def create_external_channel(
    data: CreateExternalChannelRequest,
    db: Session = Depends(get_db),
    _: User = Depends(write_access),
):
    ch = ExternalChannel(**data.model_dump())
    db.add(ch)
    db.commit()
    db.refresh(ch)
    return ch


@router_ext.delete("/{channel_id}", status_code=204)
def delete_external_channel(
    channel_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(write_access),
):
    ch = db.query(ExternalChannel).filter(ExternalChannel.id == channel_id).first()
    if not ch:
        raise HTTPException(status_code=404, detail="External channel not found")
    db.delete(ch)
    db.commit()


# ── Purchases ────────────────────────────────────────────────────────────────

def _apply_filters(q, external_channel_id, status, from_, to):
    if external_channel_id:
        q = q.filter(AdPurchase.external_channel_id == external_channel_id)
    if status:
        q = q.filter(AdPurchase.status == status)
    if from_:
        q = q.filter(AdPurchase.date >= from_)
    if to:
        q = q.filter(AdPurchase.date <= to)
    return q


@router.get("/summary", response_model=PurchaseSummary)
def purchases_summary(
    external_channel_id: Optional[int] = None,
    status: Optional[PurchaseStatus] = None,
    from_: Optional[date] = Query(default=None, alias="from"),
    to: Optional[date] = None,
    db: Session = Depends(get_db),
    _: User = Depends(read_access),
):
    q = _apply_filters(db.query(AdPurchase), external_channel_id, status, from_, to)
    purchases = q.all()
    total = sum(p.price for p in purchases)
    currencies = {p.currency for p in purchases}
    currency = currencies.pop() if len(currencies) == 1 else "mixed"
    return PurchaseSummary(total=total, currency=currency, count=len(purchases))


@router.get("", response_model=list[AdPurchaseResponse])
def list_purchases(
    external_channel_id: Optional[int] = None,
    status: Optional[PurchaseStatus] = None,
    from_: Optional[date] = Query(default=None, alias="from"),
    to: Optional[date] = None,
    db: Session = Depends(get_db),
    _: User = Depends(read_access),
):
    q = _apply_filters(db.query(AdPurchase), external_channel_id, status, from_, to)
    return q.order_by(AdPurchase.date.desc()).all()


@router.post("", response_model=AdPurchaseResponse, status_code=201)
def create_purchase(
    data: CreatePurchaseRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(write_access),
):
    if not db.query(ExternalChannel).filter(ExternalChannel.id == data.external_channel_id).first():
        raise HTTPException(status_code=404, detail="External channel not found")
    purchase = AdPurchase(**data.model_dump(), created_by=current_user.id)
    db.add(purchase)
    db.commit()
    db.refresh(purchase)
    return purchase


@router.get("/{purchase_id}", response_model=AdPurchaseResponse)
def get_purchase(
    purchase_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(read_access),
):
    p = db.query(AdPurchase).filter(AdPurchase.id == purchase_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="Purchase not found")
    return p


@router.patch("/{purchase_id}", response_model=AdPurchaseResponse)
def update_purchase(
    purchase_id: int,
    data: UpdatePurchaseRequest,
    db: Session = Depends(get_db),
    _: User = Depends(write_access),
):
    p = db.query(AdPurchase).filter(AdPurchase.id == purchase_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="Purchase not found")
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(p, field, value)
    db.commit()
    db.refresh(p)
    return p


@router.delete("/{purchase_id}", status_code=204)
def delete_purchase(
    purchase_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(write_access),
):
    p = db.query(AdPurchase).filter(AdPurchase.id == purchase_id).first()
    if not p:
        raise HTTPException(status_code=404, detail="Purchase not found")
    db.delete(p)
    db.commit()
