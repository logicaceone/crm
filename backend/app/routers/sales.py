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
from ..activity import log_action

router = APIRouter(prefix="/sales", tags=["sales"])

read_access = require_roles([UserRole.root, UserRole.admin, UserRole.manager, UserRole.viewer])
write_access = require_roles([UserRole.root, UserRole.admin, UserRole.manager])


def _apply_filters(q, channel_id, status, client_name, from_, to, topic):
    if channel_id:
        q = q.filter(AdSale.channel_id == channel_id)
    if status:
        q = q.filter(AdSale.status == status)
    if client_name:
        q = q.filter(AdSale.client_name.ilike(f"%{client_name}%"))
    if topic:
        q = q.filter(AdSale.topic.ilike(f"%{topic}%"))
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
    topic: Optional[str] = None,
    from_: Optional[date] = Query(default=None, alias="from"),
    to: Optional[date] = None,
    db: Session = Depends(get_db),
    _: User = Depends(read_access),
):
    q = _apply_filters(db.query(AdSale), channel_id, status, client_name, from_, to, topic)
    sales = q.all()
    total = sum(s.price for s in sales)
    currencies = {s.currency for s in sales}
    currency = currencies.pop() if len(currencies) == 1 else "mixed"
    return SaleSummary(total=total, currency=currency, count=len(sales))


@router.get("")
def list_sales(
    channel_id: Optional[int] = None,
    status: Optional[SaleStatus] = None,
    client_name: Optional[str] = None,
    topic: Optional[str] = None,
    from_: Optional[date] = Query(default=None, alias="from"),
    to: Optional[date] = None,
    page: Optional[int] = None,
    per_page: int = Query(default=15, ge=1, le=100),
    db: Session = Depends(get_db),
    _: User = Depends(read_access),
):
    q = _apply_filters(db.query(AdSale), channel_id, status, client_name, from_, to, topic)
    q = q.order_by(AdSale.date.desc())
    if page is None:
        return q.all()
    total = q.count()
    total_pages = max(1, (total + per_page - 1) // per_page)
    page = max(1, min(page, total_pages))
    items = q.offset((page - 1) * per_page).limit(per_page).all()
    return {
        "items": [AdSaleResponse.model_validate(s) for s in items],
        "pagination": {"page": page, "per_page": per_page, "total": total, "total_pages": total_pages},
    }


@router.post("", response_model=AdSaleResponse, status_code=201)
def create_sale(
    data: CreateSaleRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(write_access),
):
    ch = db.query(Channel).filter(Channel.id == data.channel_id).first()
    if not ch:
        raise HTTPException(status_code=404, detail="Channel not found")
    payload = data.model_dump()
    payload["currency"] = "RUB"
    sale = AdSale(**payload, created_by=current_user.id)
    db.add(sale)
    db.commit()
    db.refresh(sale)
    log_action(db, current_user, "create", "sale", sale.id,
               f"Продажа #{sale.id}: {sale.client_name} / {ch.name}, {sale.price} {sale.currency}")
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
    current_user: User = Depends(write_access),
):
    s = db.query(AdSale).filter(AdSale.id == sale_id).first()
    if not s:
        raise HTTPException(status_code=404, detail="Sale not found")
    for field, value in data.model_dump(exclude_unset=True).items():
        if field == "currency":
            continue
        setattr(s, field, value)
    db.commit()
    db.refresh(s)
    log_action(db, current_user, "update", "sale", s.id, f"Продажа #{s.id} обновлена")
    return s


@router.delete("/{sale_id}", status_code=204)
def delete_sale(
    sale_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(write_access),
):
    s = db.query(AdSale).filter(AdSale.id == sale_id).first()
    if not s:
        raise HTTPException(status_code=404, detail="Sale not found")
    desc = f"Продажа #{s.id}: {s.client_name}, {s.price} {s.currency}"
    db.delete(s)
    db.commit()
    log_action(db, current_user, "delete", "sale", sale_id, desc)
