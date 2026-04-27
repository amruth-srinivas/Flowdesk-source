from datetime import date, datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class SprintCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    sprint_type: str = Field(default="general", max_length=80)
    duration_days: int = Field(..., ge=1, le=366)
    start_date: date
    project_ids: list[UUID] = Field(default_factory=list)
    status: str = Field(default="planning", max_length=32)


class SprintUpdate(BaseModel):
    title: str | None = Field(None, min_length=1, max_length=200)
    sprint_type: str | None = Field(None, max_length=80)
    duration_days: int | None = Field(None, ge=1, le=366)
    start_date: date | None = None
    end_date: date | None = None
    project_ids: list[UUID] | None = None
    status: str | None = Field(None, max_length=32)


class SprintResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    title: str
    sprint_type: str
    duration_days: int
    start_date: date
    end_date: date
    project_ids: list[UUID]
    created_by: UUID
    created_by_name: str | None = None
    status: str
    created_at: datetime
    updated_at: datetime


class SprintTicketBrief(BaseModel):
    id: UUID
    public_reference: str | None = None
    title: str
    status: str
    priority: str
    assignee_names: list[str] = Field(default_factory=list)
    carried_from_sprint_id: UUID | None = None
    carried_from_sprint_title: str | None = None
    carried_to_sprint_id: UUID | None = None
    carried_to_sprint_title: str | None = None
    carryover_count: int = 0


class SprintActiveMember(BaseModel):
    id: UUID
    name: str


class SprintAnalyticsResponse(BaseModel):
    sprint_id: UUID
    title: str
    total_tickets: int
    by_status: dict[str, int]
    tickets_done: int
    tickets_remaining: int
    progress_percent: float
    tickets: list[SprintTicketBrief] = Field(default_factory=list)
    active_members: list[SprintActiveMember] = Field(default_factory=list)
