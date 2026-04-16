from datetime import datetime
from uuid import UUID

from pydantic import BaseModel


class KbArticleCreate(BaseModel):
    category_id: UUID
    title: str
    body: str
    tags: list[str] = []
    is_published: bool = False


class KbArticleUpdate(BaseModel):
    title: str | None = None
    body: str | None = None
    tags: list[str] | None = None
    is_published: bool | None = None


class KbArticleResponse(BaseModel):
    id: UUID
    category_id: UUID
    author_id: UUID
    title: str
    body: str
    tags: list[str]
    is_published: bool
    created_at: datetime

    class Config:
        from_attributes = True
