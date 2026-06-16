from datetime import date
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ..database import get_db
from ..models.user import User, UserRole
from ..models.channel import Channel
from ..models.sale import AdSale, SaleStatus
from ..schemas.sales import (
    AdSaleResponse,
    CreateSaleRequest,
    UpdateSaleRequest,
    SaleSummary,
)
from .auth import get_current_user, require_roles

router = APIRouter(prefix="/sales", tags=["sales"])

read_access = require_roles([UserRole.root, UserRole.admin, UserRole.manager, UserRole.viewer])
write_access = require_roles([UserRole.root, UserRole.admin, UserRole.manager])


def _apply_filters(q, channel_id, status, client_name, from_, to):
    if channel_id:
        q = q.filter(AdSale.channel_id == channel_id)
    if status:
        q = q.filter(AdSale.status == status)
    if client_name:
        q = q.filter(AdSale.client_name.ilike(f"%{client_name}%"))
    if from_:
        q = q.filter(AdSale.date >= from_)
    if to:
        q = q.filter(AdSale.date <= to)
    return q


@router.get("/summary", response_model=SaleSummary)
def sales_summary(
    channel_id: Optional[int] = None,
    status: Optional[SaleStatus] = None,
    client_name: Optional[str] = None,
    from_: Optional[date] = Query(default=None, alias="from"),
    to: Optional[date] = None,
    db: Session = Depends(get_db),
    _: User = Depends(read_access),
):
    q = _apply_filters(db.query(AdSale), channel_id, status, client_name, from_, to)
    sales = q.all()
    total = sum(s.price for s in sales)
    currencies = {s.currency for s in sales}
    currency = currencies.pop() if len(currencies) == 1 else "mixed"
    return SaleSummary(total=total, currency=currency, count=len(sales))


@router.get("", response_model=list[AdSaleResponse])
def list_sales(
    channel_id: Optional[int] = None,
    status: Optional[SaleStatus] = None,
    client_name: Optional[str] = None,
    from_: Optional[date] = Query(default=None, alias="from"),
    to: Optional[date] = None,
    db: Session = Depends(get_db),
    _: User = Depends(read_access),
):
    q = _apply_filters(db.query(AdSale), channel_id, status, client_name, from_, to)
    return q.order_by(AdSale.date.desc()).all()


@router.post("", response_model=AdSaleResponse, status_code=201)
def create_sale(
    data: CreateSaleRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(write_access),
):
    if not db.query(Channel).filter(Channel.id == data.channel_id).first():
        raise HTTPException(status_code=404, detail="Channel not found")
    sale = AdSale(**data.model_dump(), created_by=current_user.id)
    db.add(sale)
    db.commit()
    db.refresh(sale)
    return sale


@router.get("/{sale_id}", response_model=AdSaleResponse)
def get_sale(
    sale_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(read_access),
):
    s = db.query(AdSale).filter(AdSale.id == sale_id).first()
    if not s:
        raise HTTPException(status_code=404, detail="Sale not found")
    return s


@router.patch("/{sale_id}", response_model=AdSaleResponse)
def update_sale(
    sale_id: int,
    data: UpdateSaleRequest,
    db: Session = Depends(get_db),
    _: User = Depends(write_access),
):
    s = db.query(AdSale).filter(AdSale.id == sale_id).first()
    if not s:
        raise HTTPException(status_code=404, detail="Sale not found")
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(s, field, value)
    db.commit()
    db.refresh(s)
    return s


@router.delete("/{sale_id}", status_code=204)
def delete_sale(
    sale_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(write_access),
):
    s = db.query(AdSale).filter(AdSale.id == sale_id).first()
    if not s:
        raise HTTPException(status_code=404, detail="Sale not found")
    db.delete(s)
    db.commit()
