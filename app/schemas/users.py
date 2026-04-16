from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, EmailStr

from app.constants.enums import UserRole


class UserCreate(BaseModel):
    employee_id: str
    name: str
    email: EmailStr
    password: str
    role: UserRole | None = None


class UserUpdate(BaseModel):
    employee_id: str
    name: str
    email: EmailStr
    role: UserRole | None = None
    is_active: bool = True


class UserUpdateRole(BaseModel):
    role: UserRole


class UserPasswordUpdate(BaseModel):
    password: str


class UserResponse(BaseModel):
    id: UUID
    employee_id: str
    name: str
    email: EmailStr
    role: UserRole
    is_active: bool
    created_at: datetime

    class Config:
        from_attributes = True
