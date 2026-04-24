from __future__ import annotations

from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.constants.enums import TicketStatus
from app.models import Sprint, Ticket


def rollover_expired_sprints(db: Session, today: date | None = None) -> int:
    """
    Move unfinished tickets out of expired active sprints.

    Returns number of tickets moved back to backlog.
    """
    current_day = today or date.today()
    expired_active_sprints = db.execute(
        select(Sprint).where(Sprint.status == "active", Sprint.end_date < current_day)
    ).scalars().all()

    moved = 0
    for sprint in expired_active_sprints:
        open_tickets = db.execute(
            select(Ticket).where(
                Ticket.sprint_id == sprint.id,
                Ticket.status.notin_([TicketStatus.RESOLVED, TicketStatus.CLOSED]),
            )
        ).scalars().all()
        for ticket in open_tickets:
            ticket.sprint_id = None
            ticket.is_overdue = True
            moved += 1
        sprint.status = "completed"

    if expired_active_sprints:
        db.commit()
    return moved
