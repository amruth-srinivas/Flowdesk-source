from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.constants.enums import UserRole
from app.core.database import get_db
from app.dependencies.auth import get_current_member
from app.models import Approval, Resolution, Ticket
from app.schemas.tickets import ApprovalDecision, ResolutionCreate, TicketAssign, TicketCreate, TicketResponse, TicketStatusUpdate
from app.services.ticket_service import assign_ticket, update_ticket_status

router = APIRouter(prefix="/tickets", tags=["tickets"])


@router.post("", response_model=TicketResponse, status_code=status.HTTP_201_CREATED)
def create_ticket(payload: TicketCreate, db: Session = Depends(get_db), user=Depends(get_current_member)):
    if user.role not in {UserRole.ADMIN, UserRole.LEAD}:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only Admin/Lead can create tickets")
    next_ticket_num = (db.execute(select(func.max(Ticket.ticket_number))).scalar() or 0) + 1
    ticket = Ticket(
        title=payload.title,
        description=payload.description,
        type=payload.type,
        priority=payload.priority,
        project_id=payload.project_id,
        assignee_id=payload.assigned_to,
        customer_id=payload.customer_id,
        due_date=payload.due_date,
        created_by=user.id,
        ticket_number=next_ticket_num,
    )
    db.add(ticket)
    db.commit()
    db.refresh(ticket)
    return ticket


@router.post("/{ticket_id}/assign", response_model=TicketResponse)
def assign(ticket_id: str, payload: TicketAssign, db: Session = Depends(get_db), user=Depends(get_current_member)):
    if user.role not in {UserRole.ADMIN, UserRole.LEAD}:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only Admin/Lead can assign tickets")
    ticket = db.get(Ticket, ticket_id)
    if not ticket:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Ticket not found")
    return assign_ticket(db, ticket, payload.assignee_id, user.id)


@router.patch("/{ticket_id}/status", response_model=TicketResponse)
def update_status(ticket_id: str, payload: TicketStatusUpdate, db: Session = Depends(get_db), user=Depends(get_current_member)):
    ticket = db.get(Ticket, ticket_id)
    if not ticket:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Ticket not found")
    return update_ticket_status(db, ticket, payload.status, user)


@router.get("", response_model=list[TicketResponse])
def list_tickets(db: Session = Depends(get_db), _=Depends(get_current_member)):
    return db.execute(select(Ticket)).scalars().all()


@router.post("/{ticket_id}/resolution", status_code=status.HTTP_201_CREATED)
def create_resolution(ticket_id: str, payload: ResolutionCreate, db: Session = Depends(get_db), user=Depends(get_current_member)):
    ticket = db.get(Ticket, ticket_id)
    if not ticket:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Ticket not found")
    resolution = Resolution(
        ticket_id=ticket.id,
        resolved_by=user.id,
        summary=payload.summary,
        root_cause=payload.root_cause,
        steps_taken=payload.steps_taken,
        kb_article_id=payload.kb_article_id,
    )
    db.add(resolution)
    db.commit()
    db.refresh(resolution)
    return {"resolution_id": str(resolution.id), "ticket_id": str(ticket.id)}


@router.post("/{ticket_id}/approve")
def approve_resolution(ticket_id: str, payload: ApprovalDecision, db: Session = Depends(get_db), user=Depends(get_current_member)):
    if user.role not in {UserRole.ADMIN, UserRole.LEAD}:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only Admin/Lead can approve")
    resolution = db.execute(select(Resolution).where(Resolution.ticket_id == ticket_id)).scalar_one_or_none()
    if not resolution:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Resolution not found")
    approval = db.execute(select(Approval).where(Approval.resolution_id == resolution.id)).scalar_one_or_none()
    if not approval:
        approval = Approval(
            resolution_id=resolution.id,
            reviewed_by=user.id,
            status=payload.status,
            notes=payload.notes,
        )
        db.add(approval)
    else:
        approval.reviewed_by = user.id
        approval.status = payload.status
        approval.notes = payload.notes
    db.commit()
    db.refresh(approval)
    return {"approval_id": str(approval.id), "status": approval.status}
