from datetime import datetime
from typing import Literal
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
    avatar_url: str | None = None
    theme_preference: Literal["light", "dark", "midnight"] | None = None


class UserSelfUpdate(BaseModel):
    name: str
    email: EmailStr
    avatar_url: str | None = None
    theme_preference: Literal["light", "dark", "midnight"] | None = None


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
    avatar_url: str | None = None
    theme_preference: Literal["light", "dark", "midnight"] = "light"
    created_at: datetime

    class Config:
        from_attributes = True
