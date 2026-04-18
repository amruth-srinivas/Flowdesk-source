from datetime import date, datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class PersonalTaskCreate(BaseModel):
    task_date: date
    title: str = Field(..., min_length=1, max_length=300)
    body: str | None = None
    sort_order: int = 0


class PersonalTaskUpdate(BaseModel):
    title: str | None = Field(None, min_length=1, max_length=300)
    body: str | None = None
    is_completed: bool | None = None
    task_date: date | None = None
    sort_order: int | None = None


class PersonalTaskResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    user_id: UUID
    task_date: date
    title: str
    body: str | None
    is_completed: bool
    sort_order: int
    created_at: datetime
    updated_at: datetime


class PersonalTasksForDayResponse(BaseModel):
    pending_earlier: list[PersonalTaskResponse]
    for_day: list[PersonalTaskResponse]


class PersonalTaskDaySummary(BaseModel):
    """Aggregates per calendar day for month view (not full task rows)."""

    task_date: date
    total: int
    open: int
