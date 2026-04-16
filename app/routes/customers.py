from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.dependencies.auth import get_current_lead
from app.models import Customer
from app.schemas.customers import CustomerCreate, CustomerResponse, CustomerUpdate

router = APIRouter(prefix="/customers", tags=["customers"])


@router.post("", response_model=CustomerResponse, status_code=status.HTTP_201_CREATED)
def create_customer(payload: CustomerCreate, db: Session = Depends(get_db), user=Depends(get_current_lead)):
    customer = Customer(**payload.model_dump(mode="json"), created_by=user.id)
    db.add(customer)
    db.commit()
    db.refresh(customer)
    return customer


@router.get("", response_model=list[CustomerResponse])
def list_customers(db: Session = Depends(get_db), _=Depends(get_current_lead)):
    return db.execute(select(Customer)).scalars().all()


@router.put("/{customer_id}", response_model=CustomerResponse)
def update_customer(customer_id: str, payload: CustomerUpdate, db: Session = Depends(get_db), _=Depends(get_current_lead)):
    customer = db.get(Customer, customer_id)
    if not customer:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Customer not found")

    customer.name = payload.name
    customer.email = payload.email
    customer.company = payload.company
    customer.phone = payload.phone
    customer.timezone = payload.timezone
    customer.tags = payload.tags
    customer.notes = payload.notes
    customer.contacts = [contact.model_dump(mode="json") for contact in payload.contacts]
    customer.project_ids = payload.project_ids

    db.commit()
    db.refresh(customer)
    return customer
