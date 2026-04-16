from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, EmailStr


class CustomerCreate(BaseModel):
    name: str
    email: EmailStr
    company: str | None = None
    phone: str | None = None
    timezone: str | None = None
    tags: list[str] = []
    notes: str | None = None


class CustomerResponse(BaseModel):
    id: UUID
    name: str
    email: EmailStr
    company: str | None
    timezone: str | None
    tags: list[str]
    created_at: datetime

    class Config:
        from_attributes = True
