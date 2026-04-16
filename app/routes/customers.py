from fastapi import APIRouter, Depends, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.dependencies.auth import get_current_lead
from app.models import Customer
from app.schemas.customers import CustomerCreate, CustomerResponse

router = APIRouter(prefix="/customers", tags=["customers"])


@router.post("", response_model=CustomerResponse, status_code=status.HTTP_201_CREATED)
def create_customer(payload: CustomerCreate, db: Session = Depends(get_db), user=Depends(get_current_lead)):
    customer = Customer(**payload.model_dump(), created_by=user.id)
    db.add(customer)
    db.commit()
    db.refresh(customer)
    return customer


@router.get("", response_model=list[CustomerResponse])
def list_customers(db: Session = Depends(get_db), _=Depends(get_current_lead)):
    return db.execute(select(Customer)).scalars().all()
