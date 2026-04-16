from datetime import date, datetime
from uuid import UUID

from pydantic import BaseModel

from app.constants.enums import ApprovalStatus, TicketPriority, TicketStatus, TicketType


class TicketCreate(BaseModel):
    title: str
    description: str | None = None
    type: TicketType
    priority: TicketPriority = TicketPriority.MEDIUM
    project_id: UUID
    assigned_to: UUID | None = None
    customer_id: UUID | None = None
    due_date: date | None = None


class TicketAssign(BaseModel):
    assignee_id: UUID


class TicketStatusUpdate(BaseModel):
    status: TicketStatus


class TicketResponse(BaseModel):
    id: UUID
    ticket_number: int
    title: str
    description: str | None
    type: TicketType
    priority: TicketPriority
    status: TicketStatus
    project_id: UUID
    created_by: UUID
    assignee_id: UUID | None
    customer_id: UUID | None
    created_at: datetime

    class Config:
        from_attributes = True


class ResolutionCreate(BaseModel):
    summary: str
    root_cause: str | None = None
    steps_taken: str | None = None
    kb_article_id: UUID | None = None


class ApprovalDecision(BaseModel):
    status: ApprovalStatus
    notes: str | None = None
