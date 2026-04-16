from datetime import datetime
from uuid import UUID

from pydantic import BaseModel


class CustomerContact(BaseModel):
    name: str
    role: str | None = None
    email: str | None = None
    phone: str | None = None


class CustomerCreate(BaseModel):
    name: str
    email: str
    company: str | None = None
    phone: str | None = None
    timezone: str | None = None
    tags: list[str] = []
    notes: str | None = None
    contacts: list[CustomerContact] = []
    project_ids: list[UUID] = []


class CustomerUpdate(BaseModel):
    name: str
    email: str
    company: str | None = None
    phone: str | None = None
    timezone: str | None = None
    tags: list[str] = []
    notes: str | None = None
    contacts: list[CustomerContact] = []
    project_ids: list[UUID] = []


class CustomerResponse(BaseModel):
    id: UUID
    name: str
    email: str
    company: str | None
    phone: str | None
    timezone: str | None
    tags: list[str]
    notes: str | None
    contacts: list[CustomerContact]
    project_ids: list[UUID]
    created_at: datetime

    class Config:
        from_attributes = True
