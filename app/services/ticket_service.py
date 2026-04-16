from datetime import datetime

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.constants.enums import TicketStatus, UserRole
from app.models import Approval, Resolution, Ticket, TicketHistory

STATUS_FLOW = {
    TicketStatus.OPEN: {TicketStatus.IN_PROGRESS},
    TicketStatus.IN_PROGRESS: {TicketStatus.IN_REVIEW},
    TicketStatus.IN_REVIEW: {TicketStatus.RESOLVED},
    TicketStatus.RESOLVED: {TicketStatus.CLOSED},
    TicketStatus.CLOSED: set(),
}


def assign_ticket(db: Session, ticket: Ticket, assignee_id, changed_by) -> Ticket:
    old_value = str(ticket.assignee_id) if ticket.assignee_id else None
    ticket.assignee_id = assignee_id
    db.add(TicketHistory(ticket_id=ticket.id, changed_by=changed_by, field_name="assignee_id", old_value=old_value, new_value=str(assignee_id)))
    db.commit()
    db.refresh(ticket)
    return ticket


def update_ticket_status(db: Session, ticket: Ticket, new_status: TicketStatus, user) -> Ticket:
    if new_status == ticket.status:
        return ticket
    allowed = STATUS_FLOW.get(ticket.status, set())
    if new_status not in allowed:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid status transition")

    if new_status == TicketStatus.CLOSED and user.role not in {UserRole.ADMIN, UserRole.LEAD}:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only Admin/Lead can close tickets")

    if ticket.status == TicketStatus.RESOLVED and new_status == TicketStatus.CLOSED and user.role in {UserRole.ADMIN, UserRole.LEAD}:
        resolution = db.execute(select(Resolution).where(Resolution.ticket_id == ticket.id)).scalar_one_or_none()
        if not resolution:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Ticket must have a resolution before closing")
        approval = db.execute(select(Approval).where(Approval.resolution_id == resolution.id)).scalar_one_or_none()
        if not approval or approval.status.value != "approved":
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Resolution must be approved before closing")

    old_status = ticket.status.value
    ticket.status = new_status
    if new_status == TicketStatus.CLOSED:
        ticket.closed_at = datetime.utcnow()
    db.add(
        TicketHistory(
            ticket_id=ticket.id,
            changed_by=user.id,
            field_name="status",
            old_value=old_status,
            new_value=new_status.value,
        )
    )
    db.commit()
    db.refresh(ticket)
    return ticket
