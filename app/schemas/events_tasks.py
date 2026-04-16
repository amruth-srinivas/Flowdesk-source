from datetime import date, datetime
from uuid import UUID

from pydantic import BaseModel, Field


class MilestoneCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    target_date: date | None = None
    sort_order: int = 0


class MilestoneResponse(BaseModel):
    id: UUID
    title: str
    target_date: date | None
    completed_at: datetime | None
    sort_order: int

    class Config:
        from_attributes = True


class EventCreate(BaseModel):
    project_id: UUID
    title: str = Field(..., min_length=1, max_length=200)
    description: str | None = Field(None, max_length=8000)
    event_type: str = Field(default="meeting", max_length=60)
    start_at: datetime
    end_at: datetime | None = None
    status: str = Field(default="planning", max_length=32)
    progress_percent: int | None = Field(None, ge=0, le=100)
    milestones: list[MilestoneCreate] = []


class EventUpdate(BaseModel):
    project_id: UUID | None = None
    title: str | None = Field(None, min_length=1, max_length=200)
    description: str | None = Field(None, max_length=8000)
    event_type: str | None = Field(None, max_length=60)
    start_at: datetime | None = None
    end_at: datetime | None = None
    status: str | None = Field(None, max_length=32)
    progress_percent: int | None = Field(None, ge=0, le=100)
    milestones: list[MilestoneCreate] | None = None


class EventResponse(BaseModel):
    id: UUID
    project_id: UUID | None
    project_name: str | None
    created_by: UUID
    title: str
    description: str | None
    event_type: str
    start_at: datetime
    end_at: datetime | None
    status: str
    progress_percent: int | None
    created_at: datetime
    updated_at: datetime
    milestones: list[MilestoneResponse]

    class Config:
        from_attributes = True


class MilestonePatch(BaseModel):
    completed: bool


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
