import re
from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field, field_validator


def _slug_ticket_type(value: str) -> str:
    stripped = value.strip().lower()
    if not re.fullmatch(r"[a-z][a-z0-9_]{0,79}", stripped):
        raise ValueError(
            "ticket_type must be a slug: start with a letter, then lowercase letters, digits, or underscores (max 80 chars)"
        )
    return stripped


class TicketConfigurationCreate(BaseModel):
    ticket_type: str = Field(..., min_length=1, max_length=80)
    code: str = Field(..., min_length=1, max_length=20)
    display_name: str | None = Field(default=None, max_length=150)

    @field_validator("ticket_type")
    @classmethod
    def validate_ticket_type(cls, value: str) -> str:
        return _slug_ticket_type(value)

    @field_validator("code")
    @classmethod
    def strip_code(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("code cannot be empty")
        return stripped

    @field_validator("display_name")
    @classmethod
    def strip_display_name(cls, value: str | None) -> str | None:
        if value is None:
            return None
        stripped = value.strip()
        return stripped or None


class TicketConfigurationUpdate(BaseModel):
    code: str = Field(..., min_length=1, max_length=20)
    display_name: str | None = Field(default=None, max_length=150)  # omit in JSON to leave unchanged

    @field_validator("code")
    @classmethod
    def strip_code(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("code cannot be empty")
        return stripped

    @field_validator("display_name")
    @classmethod
    def strip_display_name(cls, value: str | None) -> str | None:
        if value is None:
            return None
        stripped = value.strip()
        return stripped or None


class TicketConfigurationResponse(BaseModel):
    id: UUID
    ticket_type: str
    display_name: str | None
    code: str
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True
