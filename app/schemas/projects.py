from datetime import datetime
from uuid import UUID

from pydantic import BaseModel

from app.constants.enums import ProjectStatus


class ProjectCreate(BaseModel):
    name: str
    description: str | None = None
    status: ProjectStatus = ProjectStatus.ACTIVE
    lead_id: UUID | None = None
    member_ids: list[UUID] = []
    tech_tags: list[str] = []


class ProjectUpdate(BaseModel):
    name: str
    description: str | None = None
    status: ProjectStatus = ProjectStatus.ACTIVE
    lead_id: UUID | None = None
    member_ids: list[UUID] = []
    tech_tags: list[str] = []


class ProjectResponse(BaseModel):
    id: UUID
    name: str
    description: str | None
    status: ProjectStatus
    lead_id: UUID | None
    member_ids: list[UUID]
    tech_tags: list[str]
    created_at: datetime

    class Config:
        from_attributes = True
