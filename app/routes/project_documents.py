import uuid
from pathlib import Path
from uuid import UUID

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.constants.enums import UserRole
from app.core.config import settings
from app.core.database import get_db
from app.dependencies.auth import get_current_lead, get_current_member
from app.models import Project, ProjectDocumentFile, ProjectDocumentFolder, User
from app.schemas.project_documents import (
    ProjectDocumentFileResponse,
    ProjectDocumentFolderCreate,
    ProjectDocumentFolderResponse,
)
from app.utils.access import accessible_project_ids

router = APIRouter(prefix="/work/projects", tags=["project-documents"])


def _user_name(db: Session, user_id: UUID) -> str:
    u = db.get(User, user_id)
    return u.name if u else "Unknown"


def _ensure_project_access(db: Session, user: User, project_id: UUID) -> Project:
    project = db.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    if user.role == UserRole.ADMIN:
        return project
    allowed = accessible_project_ids(db, user)
    if project_id not in allowed:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No access to this project")
    return project


def _folder_in_project(db: Session, project_id: UUID, folder_id: UUID) -> ProjectDocumentFolder | None:
    f = db.get(ProjectDocumentFolder, folder_id)
    if not f or f.project_id != project_id:
        return None
    return f


@router.get("/{project_id}/document-folders", response_model=list[ProjectDocumentFolderResponse])
def list_folders(
    project_id: UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_member),
    parent_id: UUID | None = Query(None, description="List direct children; omit for root level"),
):
    _ensure_project_access(db, user, project_id)
    stmt = select(ProjectDocumentFolder).where(ProjectDocumentFolder.project_id == project_id)
    if parent_id is None:
        stmt = stmt.where(ProjectDocumentFolder.parent_id.is_(None))
    else:
        stmt = stmt.where(ProjectDocumentFolder.parent_id == parent_id)
    rows = db.execute(stmt.order_by(ProjectDocumentFolder.name.asc())).scalars().all()
    return [
        ProjectDocumentFolderResponse(
            id=r.id,
            project_id=r.project_id,
            parent_id=r.parent_id,
            name=r.name,
            created_by=r.created_by,
            created_at=r.created_at,
        )
        for r in rows
    ]


@router.post("/{project_id}/document-folders", response_model=ProjectDocumentFolderResponse, status_code=status.HTTP_201_CREATED)
def create_folder(
    project_id: UUID,
    payload: ProjectDocumentFolderCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_lead),
):
    _ensure_project_access(db, user, project_id)
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Folder name is required")

    parent_id = payload.parent_id
    if parent_id is not None:
        parent = _folder_in_project(db, project_id, parent_id)
        if not parent:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Parent folder not found")

    row = ProjectDocumentFolder(
        project_id=project_id,
        parent_id=parent_id,
        name=name[:200],
        created_by=user.id,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return ProjectDocumentFolderResponse(
        id=row.id,
        project_id=row.project_id,
        parent_id=row.parent_id,
        name=row.name,
        created_by=row.created_by,
        created_at=row.created_at,
    )


@router.delete("/{project_id}/document-folders/{folder_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_folder(
    project_id: UUID,
    folder_id: UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_lead),
):
    _ensure_project_access(db, user, project_id)
    folder = _folder_in_project(db, project_id, folder_id)
    if not folder:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Folder not found")

    has_sub = db.execute(
        select(ProjectDocumentFolder.id).where(
            ProjectDocumentFolder.project_id == project_id,
            ProjectDocumentFolder.parent_id == folder_id,
        ).limit(1)
    ).scalar_one_or_none()
    if has_sub:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Folder is not empty (contains subfolders)")

    has_files = db.execute(
        select(ProjectDocumentFile.id).where(
            ProjectDocumentFile.project_id == project_id,
            ProjectDocumentFile.folder_id == folder_id,
        ).limit(1)
    ).scalar_one_or_none()
    if has_files:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Folder is not empty (contains files)")

    db.delete(folder)
    db.commit()
    return None


@router.get("/{project_id}/document-files", response_model=list[ProjectDocumentFileResponse])
def list_files(
    project_id: UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_member),
    folder_id: UUID | None = Query(None, description="Omit for files in project root"),
):
    _ensure_project_access(db, user, project_id)
    if folder_id is not None and not _folder_in_project(db, project_id, folder_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Folder not found")

    stmt = select(ProjectDocumentFile).where(ProjectDocumentFile.project_id == project_id)
    if folder_id is None:
        stmt = stmt.where(ProjectDocumentFile.folder_id.is_(None))
    else:
        stmt = stmt.where(ProjectDocumentFile.folder_id == folder_id)
    rows = db.execute(stmt.order_by(ProjectDocumentFile.created_at.desc())).scalars().all()
    return [
        ProjectDocumentFileResponse(
            id=r.id,
            project_id=r.project_id,
            folder_id=r.folder_id,
            filename=r.filename,
            file_size_bytes=r.file_size_bytes,
            mime_type=r.mime_type,
            uploaded_by=r.uploaded_by,
            uploader_name=_user_name(db, r.uploaded_by),
            created_at=r.created_at,
        )
        for r in rows
    ]


@router.post("/{project_id}/document-files", response_model=ProjectDocumentFileResponse, status_code=status.HTTP_201_CREATED)
async def upload_file(
    project_id: UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_lead),
    folder_id: UUID | None = Query(None),
    file: UploadFile = File(...),
):
    _ensure_project_access(db, user, project_id)
    if folder_id is not None and not _folder_in_project(db, project_id, folder_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Folder not found")

    if not file.filename:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Missing filename")
    orig = Path(file.filename).name
    suffix = Path(orig).suffix[:20]
    safe = f"{uuid.uuid4().hex}{suffix}"
    folder_part = str(folder_id) if folder_id else "root"
    rel = f"{project_id}/{folder_part}/{safe}"
    root = Path(settings.project_docs_upload_dir)
    dest_dir = root / str(project_id) / folder_part
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest_path = dest_dir / safe
    content = await file.read()
    if len(content) > 25 * 1024 * 1024:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="File too large (max 25MB)")

    dest_path.write_bytes(content)
    row = ProjectDocumentFile(
        project_id=project_id,
        folder_id=folder_id,
        uploaded_by=user.id,
        filename=orig[:300],
        file_path=rel,
        file_size_bytes=len(content),
        mime_type=(file.content_type or "application/octet-stream")[:100],
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return ProjectDocumentFileResponse(
        id=row.id,
        project_id=row.project_id,
        folder_id=row.folder_id,
        filename=row.filename,
        file_size_bytes=row.file_size_bytes,
        mime_type=row.mime_type,
        uploaded_by=row.uploaded_by,
        uploader_name=_user_name(db, row.uploaded_by),
        created_at=row.created_at,
    )


@router.get("/{project_id}/document-files/{file_id}/file")
def download_file(
    project_id: UUID,
    file_id: UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_member),
):
    _ensure_project_access(db, user, project_id)
    row = db.get(ProjectDocumentFile, file_id)
    if not row or row.project_id != project_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="File not found")

    base = Path(settings.project_docs_upload_dir).resolve()
    full = (base / row.file_path).resolve()
    if not str(full).startswith(str(base)):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid path")
    if not full.is_file():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="File missing on disk")
    return FileResponse(path=str(full), filename=row.filename, media_type=row.mime_type)


@router.delete("/{project_id}/document-files/{file_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_file(
    project_id: UUID,
    file_id: UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_lead),
):
    _ensure_project_access(db, user, project_id)
    row = db.get(ProjectDocumentFile, file_id)
    if not row or row.project_id != project_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="File not found")

    base = Path(settings.project_docs_upload_dir).resolve()
    full = (base / row.file_path).resolve()
    if str(full).startswith(str(base)) and full.is_file():
        full.unlink()

    db.delete(row)
    db.commit()
    return None
