import uuid
from pathlib import Path
from uuid import UUID

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.constants.enums import TicketType, UserRole
from app.core.config import settings
from app.core.database import get_db
from app.dependencies.auth import get_current_member
from app.models import (
    Approval,
    Resolution,
    Ticket,
    TicketAttachment,
    TicketComment,
    TicketConfiguration,
    TicketHistory,
    User,
)
from app.schemas.tickets import (
    ApprovalDecision,
    ResolutionCreate,
    ResolutionResponse,
    TicketAssign,
    TicketAttachmentResponse,
    TicketCommentCreate,
    TicketCommentResponse,
    TicketCreate,
    TicketHistoryResponse,
    TicketResponse,
    TicketStatusUpdate,
    TicketUpdate,
)
from app.services.ticket_service import assign_ticket, update_ticket_status
from app.utils.access import accessible_project_ids

router = APIRouter(prefix="/tickets", tags=["tickets"])


def _ensure_ticket_access(db: Session, user: User, ticket: Ticket) -> None:
    if user.role == UserRole.ADMIN:
        return
    allowed = accessible_project_ids(db, user)
    if ticket.project_id not in allowed:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No access to this ticket")


def _ensure_project_access(db: Session, user: User, project_id: UUID) -> None:
    if user.role == UserRole.ADMIN:
        return
    allowed = accessible_project_ids(db, user)
    if project_id not in allowed:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No access to this project")


def _next_public_reference(db: Session, project_id: UUID, ticket_type: TicketType) -> str:
    cfg = db.execute(
        select(TicketConfiguration).where(TicketConfiguration.ticket_type == ticket_type.value)
    ).scalar_one_or_none()
    code = cfg.code if cfg else "TK"
    count = db.scalar(
        select(func.count()).select_from(Ticket).where(
            Ticket.project_id == project_id,
            Ticket.type == ticket_type,
        )
    ) or 0
    return f"{code}{count + 1:04d}"


def _user_name(db: Session, user_id: UUID) -> str:
    u = db.get(User, user_id)
    return u.name if u else "Unknown"


def _resolution_to_response(db: Session, r: Resolution) -> ResolutionResponse:
    return ResolutionResponse(
        id=r.id,
        ticket_id=r.ticket_id,
        resolved_by=r.resolved_by,
        resolver_name=_user_name(db, r.resolved_by),
        summary=r.summary,
        root_cause=r.root_cause,
        steps_taken=r.steps_taken,
        kb_article_id=r.kb_article_id,
        created_at=r.created_at,
        updated_at=r.updated_at,
    )


def _ticket_to_response(db: Session, ticket: Ticket) -> TicketResponse:
    base = TicketResponse.model_validate(ticket)
    return base.model_copy(
        update={
            "assignee_name": _user_name(db, ticket.assignee_id) if ticket.assignee_id else None,
            "created_by_name": _user_name(db, ticket.created_by),
        }
    )


@router.post("", response_model=TicketResponse, status_code=status.HTTP_201_CREATED)
def create_ticket(payload: TicketCreate, db: Session = Depends(get_db), user=Depends(get_current_member)):
    if user.role not in {UserRole.ADMIN, UserRole.LEAD}:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only Admin/Lead can create tickets")
    _ensure_project_access(db, user, payload.project_id)
    next_ticket_num = (db.execute(select(func.max(Ticket.ticket_number))).scalar() or 0) + 1
    public_ref = _next_public_reference(db, payload.project_id, payload.type)
    ticket = Ticket(
        title=payload.title,
        description=payload.description,
        type=payload.type,
        priority=payload.priority,
        project_id=payload.project_id,
        assignee_id=payload.assigned_to,
        customer_id=payload.customer_id,
        due_date=payload.due_date,
        created_by=user.id,
        ticket_number=next_ticket_num,
        public_reference=public_ref,
    )
    db.add(ticket)
    db.commit()
    db.refresh(ticket)
    return _ticket_to_response(db, ticket)


@router.put("/{ticket_id}", response_model=TicketResponse)
def update_ticket(
    ticket_id: str,
    payload: TicketUpdate,
    db: Session = Depends(get_db),
    user=Depends(get_current_member),
):
    if user.role not in {UserRole.ADMIN, UserRole.LEAD}:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only Admin/Lead can edit tickets")
    ticket = db.get(Ticket, ticket_id)
    if not ticket:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Ticket not found")
    _ensure_ticket_access(db, user, ticket)

    data = payload.model_dump(exclude_unset=True)
    if "project_id" in data and payload.project_id is not None:
        _ensure_project_access(db, user, payload.project_id)
        ticket.project_id = payload.project_id
    if "title" in data and payload.title is not None:
        ticket.title = payload.title.strip()
    if "description" in data:
        ticket.description = payload.description.strip() if payload.description else None
    if "type" in data and payload.type is not None:
        ticket.type = payload.type
    if "priority" in data and payload.priority is not None:
        ticket.priority = payload.priority
    if "assigned_to" in data:
        ticket.assignee_id = payload.assigned_to
    if "customer_id" in data:
        ticket.customer_id = payload.customer_id
    if "due_date" in data:
        ticket.due_date = payload.due_date

    db.commit()
    db.refresh(ticket)
    return _ticket_to_response(db, ticket)


@router.post("/{ticket_id}/assign", response_model=TicketResponse)
def assign(ticket_id: str, payload: TicketAssign, db: Session = Depends(get_db), user=Depends(get_current_member)):
    if user.role not in {UserRole.ADMIN, UserRole.LEAD}:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only Admin/Lead can assign tickets")
    ticket = db.get(Ticket, ticket_id)
    if not ticket:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Ticket not found")
    _ensure_ticket_access(db, user, ticket)
    updated = assign_ticket(db, ticket, payload.assignee_id, user.id)
    return _ticket_to_response(db, updated)


@router.patch("/{ticket_id}/status", response_model=TicketResponse)
def update_status(ticket_id: str, payload: TicketStatusUpdate, db: Session = Depends(get_db), user=Depends(get_current_member)):
    ticket = db.get(Ticket, ticket_id)
    if not ticket:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Ticket not found")
    _ensure_ticket_access(db, user, ticket)
    updated = update_ticket_status(db, ticket, payload.status, user)
    return _ticket_to_response(db, updated)


@router.get("", response_model=list[TicketResponse])
def list_tickets(
    db: Session = Depends(get_db),
    user=Depends(get_current_member),
    assignee_me: bool = Query(False, description="Only tickets assigned to the current user"),
):
    all_tickets = db.execute(select(Ticket)).scalars().all()
    if user.role == UserRole.ADMIN:
        rows = all_tickets
    else:
        allowed = accessible_project_ids(db, user)
        rows = [t for t in all_tickets if t.project_id in allowed]
    if assignee_me:
        rows = [t for t in rows if t.assignee_id == user.id]
    return [_ticket_to_response(db, t) for t in rows]


@router.get("/{ticket_id}", response_model=TicketResponse)
def get_ticket(ticket_id: str, db: Session = Depends(get_db), user=Depends(get_current_member)):
    ticket = db.get(Ticket, ticket_id)
    if not ticket:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Ticket not found")
    _ensure_ticket_access(db, user, ticket)
    return _ticket_to_response(db, ticket)


@router.get("/{ticket_id}/comments", response_model=list[TicketCommentResponse])
def list_comments(ticket_id: str, db: Session = Depends(get_db), user=Depends(get_current_member)):
    ticket = db.get(Ticket, ticket_id)
    if not ticket:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Ticket not found")
    _ensure_ticket_access(db, user, ticket)
    stmt = select(TicketComment).where(TicketComment.ticket_id == ticket_id).order_by(TicketComment.created_at.asc())
    if user.role == UserRole.MEMBER:
        stmt = stmt.where(TicketComment.is_internal.is_(False))
    rows = db.execute(stmt).scalars().all()
    return [
        TicketCommentResponse(
            id=c.id,
            ticket_id=c.ticket_id,
            author_id=c.author_id,
            author_name=_user_name(db, c.author_id),
            body=c.body,
            is_internal=c.is_internal,
            created_at=c.created_at,
            updated_at=c.updated_at,
        )
        for c in rows
    ]


@router.post("/{ticket_id}/comments", response_model=TicketCommentResponse, status_code=status.HTTP_201_CREATED)
def add_comment(
    ticket_id: str,
    payload: TicketCommentCreate,
    db: Session = Depends(get_db),
    user=Depends(get_current_member),
):
    ticket = db.get(Ticket, ticket_id)
    if not ticket:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Ticket not found")
    _ensure_ticket_access(db, user, ticket)
    if payload.is_internal and user.role == UserRole.MEMBER:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only leads and admins can add internal notes")
    row = TicketComment(
        ticket_id=ticket.id,
        author_id=user.id,
        body=payload.body.strip(),
        is_internal=payload.is_internal,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return TicketCommentResponse(
        id=row.id,
        ticket_id=row.ticket_id,
        author_id=row.author_id,
        author_name=_user_name(db, row.author_id),
        body=row.body,
        is_internal=row.is_internal,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


@router.get("/{ticket_id}/history", response_model=list[TicketHistoryResponse])
def list_history(ticket_id: str, db: Session = Depends(get_db), user=Depends(get_current_member)):
    ticket = db.get(Ticket, ticket_id)
    if not ticket:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Ticket not found")
    _ensure_ticket_access(db, user, ticket)
    rows = db.execute(
        select(TicketHistory).where(TicketHistory.ticket_id == ticket_id).order_by(TicketHistory.created_at.desc())
    ).scalars().all()
    return [
        TicketHistoryResponse(
            id=h.id,
            changed_by=h.changed_by,
            changer_name=_user_name(db, h.changed_by),
            field_name=h.field_name,
            old_value=h.old_value,
            new_value=h.new_value,
            created_at=h.created_at,
        )
        for h in rows
    ]


@router.get("/{ticket_id}/resolution", response_model=ResolutionResponse)
def get_resolution(ticket_id: str, db: Session = Depends(get_db), user=Depends(get_current_member)):
    ticket = db.get(Ticket, ticket_id)
    if not ticket:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Ticket not found")
    _ensure_ticket_access(db, user, ticket)
    r = db.execute(select(Resolution).where(Resolution.ticket_id == ticket_id)).scalar_one_or_none()
    if not r:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No resolution recorded")
    return _resolution_to_response(db, r)


@router.put("/{ticket_id}/resolution", response_model=ResolutionResponse)
def upsert_resolution(ticket_id: str, payload: ResolutionCreate, db: Session = Depends(get_db), user=Depends(get_current_member)):
    ticket = db.get(Ticket, ticket_id)
    if not ticket:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Ticket not found")
    _ensure_ticket_access(db, user, ticket)
    r = db.execute(select(Resolution).where(Resolution.ticket_id == ticket_id)).scalar_one_or_none()
    if r:
        r.summary = payload.summary.strip()
        r.root_cause = payload.root_cause.strip() if payload.root_cause else None
        r.steps_taken = payload.steps_taken.strip() if payload.steps_taken else None
        r.kb_article_id = payload.kb_article_id
        r.resolved_by = user.id
    else:
        r = Resolution(
            ticket_id=ticket.id,
            resolved_by=user.id,
            summary=payload.summary.strip(),
            root_cause=payload.root_cause.strip() if payload.root_cause else None,
            steps_taken=payload.steps_taken.strip() if payload.steps_taken else None,
            kb_article_id=payload.kb_article_id,
        )
        db.add(r)
    db.commit()
    db.refresh(r)
    return _resolution_to_response(db, r)


@router.get("/{ticket_id}/attachments", response_model=list[TicketAttachmentResponse])
def list_attachments(ticket_id: str, db: Session = Depends(get_db), user=Depends(get_current_member)):
    ticket = db.get(Ticket, ticket_id)
    if not ticket:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Ticket not found")
    _ensure_ticket_access(db, user, ticket)
    rows = db.execute(
        select(TicketAttachment).where(TicketAttachment.ticket_id == ticket_id).order_by(TicketAttachment.created_at.desc())
    ).scalars().all()
    return [
        TicketAttachmentResponse(
            id=a.id,
            filename=a.filename,
            file_size_bytes=a.file_size_bytes,
            mime_type=a.mime_type,
            uploaded_by=a.uploaded_by,
            uploader_name=_user_name(db, a.uploaded_by),
            created_at=a.created_at,
        )
        for a in rows
    ]


@router.post("/{ticket_id}/attachments", response_model=TicketAttachmentResponse, status_code=status.HTTP_201_CREATED)
async def upload_attachment(
    ticket_id: str,
    db: Session = Depends(get_db),
    user=Depends(get_current_member),
    file: UploadFile = File(...),
):
    ticket = db.get(Ticket, ticket_id)
    if not ticket:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Ticket not found")
    _ensure_ticket_access(db, user, ticket)
    if not file.filename:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Missing filename")
    orig = Path(file.filename).name
    suffix = Path(orig).suffix[:20]
    safe = f"{uuid.uuid4().hex}{suffix}"
    rel = f"{ticket_id}/{safe}"
    root = Path(settings.ticket_upload_dir)
    dest_dir = root / str(ticket_id)
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest_path = dest_dir / safe
    content = await file.read()
    if len(content) > 15 * 1024 * 1024:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="File too large (max 15MB)")
    dest_path.write_bytes(content)
    row = TicketAttachment(
        ticket_id=ticket.id,
        uploaded_by=user.id,
        filename=orig[:300],
        file_path=rel,
        file_size_bytes=len(content),
        mime_type=(file.content_type or "application/octet-stream")[:100],
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return TicketAttachmentResponse(
        id=row.id,
        filename=row.filename,
        file_size_bytes=row.file_size_bytes,
        mime_type=row.mime_type,
        uploaded_by=row.uploaded_by,
        uploader_name=_user_name(db, row.uploaded_by),
        created_at=row.created_at,
    )


@router.get("/{ticket_id}/attachments/{attachment_id}/file")
def download_attachment(
    ticket_id: str,
    attachment_id: str,
    db: Session = Depends(get_db),
    user=Depends(get_current_member),
):
    ticket = db.get(Ticket, ticket_id)
    if not ticket:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Ticket not found")
    _ensure_ticket_access(db, user, ticket)
    row = db.get(TicketAttachment, attachment_id)
    if not row or row.ticket_id != ticket.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Attachment not found")
    base = Path(settings.ticket_upload_dir).resolve()
    full = (base / row.file_path).resolve()
    if not str(full).startswith(str(base)):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid path")
    if not full.is_file():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="File missing on disk")
    return FileResponse(path=str(full), filename=row.filename, media_type=row.mime_type)


@router.post("/{ticket_id}/resolution", status_code=status.HTTP_201_CREATED)
def create_resolution(ticket_id: str, payload: ResolutionCreate, db: Session = Depends(get_db), user=Depends(get_current_member)):
    ticket = db.get(Ticket, ticket_id)
    if not ticket:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Ticket not found")
    _ensure_ticket_access(db, user, ticket)
    existing = db.execute(select(Resolution).where(Resolution.ticket_id == ticket_id)).scalar_one_or_none()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Resolution already exists; use PUT to update",
        )
    resolution = Resolution(
        ticket_id=ticket.id,
        resolved_by=user.id,
        summary=payload.summary,
        root_cause=payload.root_cause,
        steps_taken=payload.steps_taken,
        kb_article_id=payload.kb_article_id,
    )
    db.add(resolution)
    db.commit()
    db.refresh(resolution)
    return {"resolution_id": str(resolution.id), "ticket_id": str(ticket.id)}


@router.post("/{ticket_id}/approve")
def approve_resolution(ticket_id: str, payload: ApprovalDecision, db: Session = Depends(get_db), user=Depends(get_current_member)):
    if user.role not in {UserRole.ADMIN, UserRole.LEAD}:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only Admin/Lead can approve")
    resolution = db.execute(select(Resolution).where(Resolution.ticket_id == ticket_id)).scalar_one_or_none()
    if not resolution:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Resolution not found")
    ticket = db.get(Ticket, ticket_id)
    if ticket:
        _ensure_ticket_access(db, user, ticket)
    approval = db.execute(select(Approval).where(Approval.resolution_id == resolution.id)).scalar_one_or_none()
    if not approval:
        approval = Approval(
            resolution_id=resolution.id,
            reviewed_by=user.id,
            status=payload.status,
            notes=payload.notes,
        )
        db.add(approval)
    else:
        approval.reviewed_by = user.id
        approval.status = payload.status
        approval.notes = payload.notes
    db.commit()
    db.refresh(approval)
    return {"approval_id": str(approval.id), "status": approval.status}
