from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.dependencies.auth import get_current_admin, get_current_lead
from app.models import TicketConfiguration
from app.schemas.ticket_configuration import (
    TicketConfigurationCreate,
    TicketConfigurationResponse,
    TicketConfigurationUpdate,
)

router = APIRouter(prefix="/ticket-configuration", tags=["ticket-configuration"])


@router.get("", response_model=list[TicketConfigurationResponse])
def list_ticket_configuration(db: Session = Depends(get_db), _=Depends(get_current_lead)):
    """Admins manage codes; team leads read labels/prefixes for ticket creation."""
    rows = db.execute(select(TicketConfiguration).order_by(TicketConfiguration.ticket_type.asc())).scalars().all()
    return rows


@router.post("", response_model=TicketConfigurationResponse, status_code=status.HTTP_201_CREATED)
def create_ticket_configuration(
    payload: TicketConfigurationCreate,
    db: Session = Depends(get_db),
    _=Depends(get_current_admin),
):
    existing_type = db.execute(
        select(TicketConfiguration).where(TicketConfiguration.ticket_type == payload.ticket_type)
    ).scalar_one_or_none()
    if existing_type:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="This ticket type already has a configuration")

    existing_code = db.execute(select(TicketConfiguration).where(TicketConfiguration.code == payload.code)).scalar_one_or_none()
    if existing_code:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="This code is already in use")

    row = TicketConfiguration(ticket_type=payload.ticket_type, code=payload.code)
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@router.put("/{config_id}", response_model=TicketConfigurationResponse)
def update_ticket_configuration(
    config_id: UUID,
    payload: TicketConfigurationUpdate,
    db: Session = Depends(get_db),
    _=Depends(get_current_admin),
):
    row = db.get(TicketConfiguration, config_id)
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Configuration not found")

    existing_code = db.execute(
        select(TicketConfiguration).where(TicketConfiguration.code == payload.code, TicketConfiguration.id != config_id)
    ).scalar_one_or_none()
    if existing_code:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="This code is already in use")

    data = payload.model_dump(exclude_unset=True)
    row.code = payload.code
    if "display_name" in data:
        row.display_name = payload.display_name
    db.commit()
    db.refresh(row)
    return row


@router.delete("/{config_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_ticket_configuration(config_id: UUID, db: Session = Depends(get_db), _=Depends(get_current_admin)):
    row = db.get(TicketConfiguration, config_id)
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Configuration not found")
    db.delete(row)
    db.commit()
    return None
