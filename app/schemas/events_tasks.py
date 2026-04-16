from datetime import date, datetime
from uuid import UUID

from pydantic import BaseModel


class EventCreate(BaseModel):
    project_id: UUID | None = None
    title: str
    description: str | None = None
    event_type: str
    start_at: datetime
    end_at: datetime | None = None


class EventResponse(BaseModel):
    id: UUID
    title: str
    event_type: str
    project_id: UUID | None
    start_at: datetime

    class Config:
        from_attributes = True


class TaskCreate(BaseModel):
    ticket_id: UUID | None = None
    project_id: UUID
    assignee_id: UUID | None = None
    title: str
    due_date: date | None = None


class TaskResponse(BaseModel):
    id: UUID
    title: str
    project_id: UUID
    assignee_id: UUID | None
    is_completed: bool

    class Config:
        from_attributes = True
