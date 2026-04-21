from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field


class ProjectDocumentFolderCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    parent_id: UUID | None = None


class ProjectDocumentFolderResponse(BaseModel):
    id: UUID
    project_id: UUID
    parent_id: UUID | None
    name: str
    created_by: UUID
    created_at: datetime

    class Config:
        from_attributes = True


class ProjectDocumentFileResponse(BaseModel):
    id: UUID
    project_id: UUID
    folder_id: UUID | None
    filename: str
    file_size_bytes: int
    mime_type: str
    uploaded_by: UUID
    uploader_name: str
    created_at: datetime

    class Config:
        from_attributes = True
