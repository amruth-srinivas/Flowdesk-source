import shutil
import uuid
from datetime import datetime
from pathlib import Path
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.constants.enums import TicketStatus, TicketType, UserRole
from app.core.config import settings
from app.core.database import get_db
from app.core.security import verify_password
from app.dependencies.auth import get_current_member
from app.models import (
    Approval,
    Notification,
    Project,
    Resolution,
    Sprint,
    Task,
    Ticket,
    TicketCycle,
    TicketCycleResolution,
    TicketApprovalRequest,
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
    TicketCycleResponse,
    TicketApprovalRequestResponse,
    TicketApprovalNotificationResponse,
    TicketAssign,
    TicketAttachmentResponse,
    TicketCommentCreate,
    TicketCommentResponse,
    TicketCreate,
    TicketDeleteConfirm,
    TicketHistoryResponse,
    TicketResponse,
    TicketReopenRequest,
    TicketStatusUpdate,
    TicketUpdate,
)
from app.services.ticket_service import assign_ticket, dedupe_assignee_ids, update_ticket_status
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


def _resolve_sprint_id_for_project(db: Session, project_id: UUID, sprint_id: UUID | None) -> UUID | None:
    if sprint_id is None:
        return None
    sp = db.get(Sprint, sprint_id)
    if not sp:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Sprint not found")
    if sp.project_ids and project_id not in sp.project_ids:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Ticket's project must be included in the sprint",
        )
    return sprint_id


def _validate_and_set_ticket_sprint(db: Session, ticket: Ticket, sprint_id: UUID | None) -> None:
    ticket.sprint_id = _resolve_sprint_id_for_project(db, ticket.project_id, sprint_id)
    if ticket.sprint_id is not None:
        ticket.is_overdue = False
    if ticket.current_cycle_id:
        cycle = db.get(TicketCycle, ticket.current_cycle_id)
        if cycle:
            cycle.sprint_id = ticket.sprint_id


def _get_or_create_active_cycle(db: Session, ticket: Ticket) -> TicketCycle:
    if ticket.current_cycle_id:
        cycle = db.get(TicketCycle, ticket.current_cycle_id)
        if cycle:
            return cycle

    latest = db.execute(
        select(TicketCycle).where(TicketCycle.ticket_id == ticket.id).order_by(TicketCycle.version_no.desc())
    ).scalars().first()
    if latest:
        ticket.current_cycle_id = latest.id
        db.add(ticket)
        db.flush()
        return latest

    cycle = TicketCycle(
        ticket_id=ticket.id,
        version_no=1,
        sprint_id=ticket.sprint_id,
        status=ticket.status,
        created_at=ticket.created_at,
        updated_at=ticket.updated_at,
        closed_at=ticket.closed_at,
        closed_by=ticket.closed_by,
    )
    db.add(cycle)
    db.flush()
    ticket.current_cycle_id = cycle.id
    db.add(ticket)
    db.flush()
    return cycle


def _resolve_cycle(
    db: Session,
    ticket: Ticket,
    cycle_id: UUID | None,
    *,
    require_active: bool = False,
) -> TicketCycle:
    active = _get_or_create_active_cycle(db, ticket)
    target = active
    if cycle_id is not None:
        selected = db.get(TicketCycle, cycle_id)
        if not selected or selected.ticket_id != ticket.id:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Ticket cycle not found")
        target = selected
    if require_active and target.id != active.id:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Only the active cycle can be modified")
    return target


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


def _user_avatar_url(db: Session, user_id: UUID) -> str | None:
    u = db.get(User, user_id)
    return u.avatar_url if u else None


def _resolution_to_response(db: Session, r: Resolution) -> ResolutionResponse:
    return ResolutionResponse(
        id=r.id,
        ticket_id=r.ticket_id,
        resolved_by=r.resolved_by,
        resolver_name=_user_name(db, r.resolved_by),
        resolver_avatar_url=_user_avatar_url(db, r.resolved_by),
        summary=r.summary,
        root_cause=r.root_cause,
        steps_taken=r.steps_taken,
        kb_article_id=r.kb_article_id,
        created_at=r.created_at,
        updated_at=r.updated_at,
    )


def _cycle_resolution_to_response(db: Session, r: TicketCycleResolution) -> ResolutionResponse:
    return ResolutionResponse(
        id=r.id,
        ticket_id=r.ticket_id,
        ticket_cycle_id=r.ticket_cycle_id,
        resolved_by=r.resolved_by,
        resolver_name=_user_name(db, r.resolved_by),
        resolver_avatar_url=_user_avatar_url(db, r.resolved_by),
        summary=r.summary,
        root_cause=r.root_cause,
        steps_taken=r.steps_taken,
        kb_article_id=r.kb_article_id,
        created_at=r.created_at,
        updated_at=r.updated_at,
    )


def _cycle_to_response(db: Session, cycle: TicketCycle) -> TicketCycleResponse:
    return TicketCycleResponse(
        id=cycle.id,
        ticket_id=cycle.ticket_id,
        version_no=cycle.version_no,
        sprint_id=cycle.sprint_id,
        status=cycle.status,
        reopen_reason=cycle.reopen_reason,
        reopened_by=cycle.reopened_by,
        reopened_by_name=_user_name(db, cycle.reopened_by) if cycle.reopened_by else None,
        reopened_at=cycle.reopened_at,
        previous_cycle_id=cycle.previous_cycle_id,
        closed_at=cycle.closed_at,
        closed_by=cycle.closed_by,
        closed_by_name=_user_name(db, cycle.closed_by) if cycle.closed_by else None,
        created_at=cycle.created_at,
        updated_at=cycle.updated_at,
    )


def _ticket_to_response(db: Session, ticket: Ticket) -> TicketResponse:
    ids = list(ticket.assignee_ids or [])
    names = [_user_name(db, uid) for uid in ids]
    active_cycle = _get_or_create_active_cycle(db, ticket)
    resolution = db.execute(
        select(TicketCycleResolution).where(TicketCycleResolution.ticket_cycle_id == active_cycle.id)
    ).scalar_one_or_none()
    base = TicketResponse.model_validate(ticket)
    return base.model_copy(
        update={
            "assignee_names": names,
            "created_by_name": _user_name(db, ticket.created_by),
            "created_by_avatar_url": _user_avatar_url(db, ticket.created_by),
            "resolved_by": resolution.resolved_by if resolution else None,
            "resolved_by_name": _user_name(db, resolution.resolved_by) if resolution else None,
            "closed_by_name": _user_name(db, ticket.closed_by) if ticket.closed_by else None,
            "current_cycle_id": active_cycle.id,
            "current_cycle_version": active_cycle.version_no,
        }
    )


def _approval_to_response(db: Session, req: TicketApprovalRequest, ticket: Ticket) -> TicketApprovalRequestResponse:
    return TicketApprovalRequestResponse(
        id=req.id,
        ticket_id=ticket.id,
        ticket_reference=ticket.public_reference,
        ticket_title=ticket.title,
        ticket_status=ticket.status,
        requested_by=req.requested_by,
        requested_by_name=_user_name(db, req.requested_by),
        requested_at=req.requested_at,
        status=req.status,
    )


def _approval_notification_response(
    notification: Notification,
    ticket: Ticket,
    request: TicketApprovalRequest | None,
    db: Session,
) -> TicketApprovalNotificationResponse:
    ticket_status = ticket.status.value if hasattr(ticket.status, "value") else str(ticket.status)
    return TicketApprovalNotificationResponse(
        notification_id=notification.id,
        request_id=request.id if request else None,
        ticket_id=ticket.id,
        ticket_reference=ticket.public_reference,
        ticket_title=ticket.title,
        ticket_status=ticket_status,
        approval_request_status=request.status if request else None,
        requested_by_name=_user_name(db, request.requested_by) if request else None,
        requested_at=request.requested_at if request else notification.created_at,
        is_read=notification.is_read,
    )


@router.post("", response_model=TicketResponse, status_code=status.HTTP_201_CREATED)
def create_ticket(payload: TicketCreate, db: Session = Depends(get_db), user=Depends(get_current_member)):
    if user.role not in {UserRole.ADMIN, UserRole.LEAD}:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only Admin/Lead can create tickets")
    _ensure_project_access(db, user, payload.project_id)
    resolved_sprint_id = _resolve_sprint_id_for_project(db, payload.project_id, payload.sprint_id)
    next_ticket_num = (db.execute(select(func.max(Ticket.ticket_number))).scalar() or 0) + 1
    public_ref = _next_public_reference(db, payload.project_id, payload.type)
    ticket = Ticket(
        title=payload.title,
        description=payload.description,
        type=payload.type,
        priority=payload.priority,
        project_id=payload.project_id,
        assignee_ids=dedupe_assignee_ids(payload.assigned_to or []),
        customer_id=payload.customer_id,
        due_date=payload.due_date,
        is_overdue=False,
        created_by=user.id,
        ticket_number=next_ticket_num,
        public_reference=public_ref,
        sprint_id=resolved_sprint_id,
    )
    db.add(ticket)
    db.flush()
    cycle = TicketCycle(
        ticket_id=ticket.id,
        version_no=1,
        sprint_id=ticket.sprint_id,
        status=ticket.status,
        created_at=ticket.created_at,
        updated_at=ticket.updated_at,
    )
    db.add(cycle)
    db.flush()
    ticket.current_cycle_id = cycle.id
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

    if ticket.status != TicketStatus.OPEN:
        if not data:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No fields to update")
        if set(data.keys()) != {"sprint_id"}:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Ticket fields are locked after it moves from Open. Only sprint assignment or status can be changed.",
            )
        _validate_and_set_ticket_sprint(db, ticket, payload.sprint_id)
        db.commit()
        db.refresh(ticket)
        return _ticket_to_response(db, ticket)

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
        ticket.assignee_ids = dedupe_assignee_ids(payload.assigned_to or [])
    if "customer_id" in data:
        ticket.customer_id = payload.customer_id
    if "due_date" in data:
        ticket.due_date = payload.due_date
    if "sprint_id" in data:
        _validate_and_set_ticket_sprint(db, ticket, payload.sprint_id)

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
    updated = assign_ticket(db, ticket, payload.assignee_ids, user.id)
    return _ticket_to_response(db, updated)


@router.patch("/{ticket_id}/status", response_model=TicketResponse)
def update_status(ticket_id: str, payload: TicketStatusUpdate, db: Session = Depends(get_db), user=Depends(get_current_member)):
    ticket = db.get(Ticket, ticket_id)
    if not ticket:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Ticket not found")
    _ensure_ticket_access(db, user, ticket)
    updated = update_ticket_status(db, ticket, payload.status, user, payload.comment)
    return _ticket_to_response(db, updated)


@router.get("/{ticket_id}/cycles", response_model=list[TicketCycleResponse])
def list_ticket_cycles(ticket_id: str, db: Session = Depends(get_db), user=Depends(get_current_member)):
    ticket = db.get(Ticket, ticket_id)
    if not ticket:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Ticket not found")
    _ensure_ticket_access(db, user, ticket)
    _get_or_create_active_cycle(db, ticket)
    rows = db.execute(
        select(TicketCycle).where(TicketCycle.ticket_id == ticket.id).order_by(TicketCycle.version_no.desc())
    ).scalars().all()
    return [_cycle_to_response(db, row) for row in rows]


@router.post("/{ticket_id}/reopen", response_model=TicketResponse)
def reopen_ticket(
    ticket_id: str,
    payload: TicketReopenRequest,
    db: Session = Depends(get_db),
    user=Depends(get_current_member),
):
    if user.role not in {UserRole.ADMIN, UserRole.LEAD}:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only Admin/Lead can reopen tickets")
    ticket = db.get(Ticket, ticket_id)
    if not ticket:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Ticket not found")
    _ensure_ticket_access(db, user, ticket)
    active = _get_or_create_active_cycle(db, ticket)
    if active.status != TicketStatus.CLOSED:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Only closed tickets can be reopened")

    sprint_id = _resolve_sprint_id_for_project(db, ticket.project_id, payload.sprint_id)
    max_version = db.scalar(
        select(func.max(TicketCycle.version_no)).where(TicketCycle.ticket_id == ticket.id)
    ) or 1
    next_cycle = TicketCycle(
        ticket_id=ticket.id,
        version_no=int(max_version) + 1,
        sprint_id=sprint_id,
        status=TicketStatus.OPEN,
        reopen_reason=payload.reason.strip(),
        reopened_by=user.id,
        reopened_at=datetime.utcnow(),
        previous_cycle_id=active.id,
    )
    db.add(next_cycle)
    db.flush()

    ticket.status = TicketStatus.OPEN
    ticket.sprint_id = sprint_id
    ticket.current_cycle_id = next_cycle.id
    ticket.closed_at = None
    ticket.closed_by = None
    db.add(
        TicketHistory(
            ticket_id=ticket.id,
            changed_by=user.id,
            field_name="reopened",
            old_value=f"cycle_v{active.version_no}",
            new_value=f"cycle_v{next_cycle.version_no}",
            change_note=payload.reason.strip(),
        )
    )
    db.add(ticket)
    db.commit()
    db.refresh(ticket)
    return _ticket_to_response(db, ticket)


def _delete_ticket_and_dependencies(db: Session, ticket: Ticket) -> None:
    tid = ticket.id
    db.execute(delete(TicketAttachment).where(TicketAttachment.ticket_id == tid))
    db.execute(delete(TicketComment).where(TicketComment.ticket_id == tid))
    db.execute(delete(TicketHistory).where(TicketHistory.ticket_id == tid))
    db.execute(delete(TicketApprovalRequest).where(TicketApprovalRequest.ticket_id == tid))
    db.execute(delete(TicketCycleResolution).where(TicketCycleResolution.ticket_id == tid))
    db.execute(delete(TicketCycle).where(TicketCycle.ticket_id == tid))
    resolution = db.execute(select(Resolution).where(Resolution.ticket_id == tid)).scalar_one_or_none()
    if resolution:
        db.execute(delete(Approval).where(Approval.resolution_id == resolution.id))
        db.delete(resolution)
    for task in db.execute(select(Task).where(Task.ticket_id == tid)).scalars().all():
        task.ticket_id = None
    root = Path(settings.ticket_upload_dir).resolve()
    ticket_dir = root / str(tid)
    if ticket_dir.is_dir():
        try:
            resolved_dir = ticket_dir.resolve()
            if str(resolved_dir).startswith(str(root)):
                shutil.rmtree(resolved_dir, ignore_errors=True)
        except OSError:
            pass
    db.delete(ticket)


@router.post("/{ticket_id}/delete", status_code=status.HTTP_204_NO_CONTENT)
def delete_ticket(
    ticket_id: str,
    payload: TicketDeleteConfirm,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_member),
):
    if user.role not in {UserRole.ADMIN, UserRole.LEAD}:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only Admin/Lead can delete tickets")
    if not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Incorrect password")
    ticket = db.get(Ticket, ticket_id)
    if not ticket:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Ticket not found")
    _ensure_ticket_access(db, user, ticket)
    if ticket.status not in {TicketStatus.OPEN, TicketStatus.IN_PROGRESS}:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Only tickets in Open or In progress can be deleted",
        )
    _delete_ticket_and_dependencies(db, ticket)
    db.commit()
    return None


@router.post("/{ticket_id}/approval-request", response_model=TicketApprovalRequestResponse, status_code=status.HTTP_201_CREATED)
def request_approval(ticket_id: str, db: Session = Depends(get_db), user=Depends(get_current_member)):
    if user.role != UserRole.MEMBER:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only team members can request approval")
    ticket = db.get(Ticket, ticket_id)
    if not ticket:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Ticket not found")
    _ensure_ticket_access(db, user, ticket)
    active_cycle = _get_or_create_active_cycle(db, ticket)
    if ticket.status != TicketStatus.RESOLVED:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Approval can be requested only for resolved tickets")
    existing = db.execute(
        select(TicketApprovalRequest).where(
            TicketApprovalRequest.ticket_id == ticket.id,
            TicketApprovalRequest.status == "pending",
        )
    ).scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Approval already requested")
    req = TicketApprovalRequest(ticket_id=ticket.id, ticket_cycle_id=active_cycle.id, requested_by=user.id, status="pending")
    db.add(req)

    project = db.get(Project, ticket.project_id)
    project_lead_id = project.lead_id if project else None
    notify_ids: set[UUID] = set()
    if project_lead_id and project_lead_id != user.id:
        notify_ids.add(project_lead_id)
    if project:
        leads_admins = db.execute(select(User).where(User.role.in_([UserRole.LEAD, UserRole.ADMIN]))).scalars().all()
        for candidate in leads_admins:
            if candidate.id == user.id:
                continue
            if candidate.role == UserRole.ADMIN or project.id in accessible_project_ids(db, candidate):
                notify_ids.add(candidate.id)

    for recipient in notify_ids:
        db.add(
            Notification(
                user_id=recipient,
                type="ticket_approval_request",
                title=f"Approval requested for {ticket.public_reference or f'#{ticket.ticket_number}'}",
                link_url=str(ticket.id),
                is_read=False,
            )
        )
    db.commit()
    db.refresh(req)
    return _approval_to_response(db, req, ticket)


@router.get("/approval-requests/pending", response_model=list[TicketApprovalRequestResponse])
def list_pending_approvals(db: Session = Depends(get_db), user=Depends(get_current_member)):
    stmt = select(TicketApprovalRequest).where(TicketApprovalRequest.status == "pending").order_by(TicketApprovalRequest.requested_at.desc())
    if user.role == UserRole.MEMBER:
        stmt = stmt.where(TicketApprovalRequest.requested_by == user.id)
    rows = db.execute(stmt).scalars().all()
    out: list[TicketApprovalRequestResponse] = []
    for req in rows:
        ticket = db.get(Ticket, req.ticket_id)
        if not ticket:
            continue
        try:
            _ensure_ticket_access(db, user, ticket)
        except HTTPException:
            continue
        out.append(_approval_to_response(db, req, ticket))
    return out


@router.post("/approval-requests/{request_id}/acknowledge", response_model=TicketResponse)
def acknowledge_approval(request_id: str, db: Session = Depends(get_db), user=Depends(get_current_member)):
    if user.role not in {UserRole.ADMIN, UserRole.LEAD}:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only Admin/Lead can acknowledge approval")
    req = db.get(TicketApprovalRequest, request_id)
    if not req or req.status != "pending":
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Pending approval request not found")
    ticket = db.get(Ticket, req.ticket_id)
    if not ticket:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Ticket not found")
    _ensure_ticket_access(db, user, ticket)
    if ticket.status != TicketStatus.CLOSED:
        update_ticket_status(db, ticket, TicketStatus.CLOSED, user, "Lead acknowledged review request and closed ticket")
    req.status = "acknowledged"
    req.acknowledged_by = user.id
    req.acknowledged_at = datetime.utcnow()
    notifications = db.execute(
        select(Notification).where(
            Notification.type == "ticket_approval_request",
            Notification.link_url == str(ticket.id),
            Notification.is_read.is_(False),
        )
    ).scalars().all()
    for item in notifications:
        item.is_read = True
    db.commit()
    db.refresh(ticket)
    return _ticket_to_response(db, ticket)


@router.get("/notifications/approval", response_model=list[TicketApprovalNotificationResponse])
def list_approval_notifications(db: Session = Depends(get_db), user=Depends(get_current_member)):
    rows = db.execute(
        select(Notification)
        .where(
            Notification.user_id == user.id,
            Notification.type == "ticket_approval_request",
        )
        .order_by(Notification.created_at.desc())
    ).scalars().all()
    out: list[TicketApprovalNotificationResponse] = []
    for n in rows:
        if not n.link_url:
            continue
        try:
            ticket_id = UUID(n.link_url)
        except Exception:
            continue
        ticket = db.get(Ticket, ticket_id)
        if not ticket:
            continue
        try:
            _ensure_ticket_access(db, user, ticket)
        except HTTPException:
            continue
        req = db.execute(
            select(TicketApprovalRequest)
            .where(TicketApprovalRequest.ticket_id == ticket.id)
            .order_by(TicketApprovalRequest.requested_at.desc())
        ).scalars().first()
        out.append(_approval_notification_response(n, ticket, req, db))
    return out


@router.delete("/notifications/approval/all", status_code=status.HTTP_204_NO_CONTENT)
def delete_all_approval_notifications(db: Session = Depends(get_db), user=Depends(get_current_member)):
    """Remove every ticket-approval notification for the current user."""
    db.execute(
        delete(Notification).where(
            Notification.user_id == user.id,
            Notification.type == "ticket_approval_request",
        )
    )
    db.commit()
    return None


@router.patch("/notifications/{notification_id}/read")
def mark_notification_read(notification_id: str, db: Session = Depends(get_db), user=Depends(get_current_member)):
    row = db.get(Notification, notification_id)
    if not row or row.user_id != user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Notification not found")
    row.is_read = True
    db.commit()
    return {"status": "ok"}


@router.delete("/notifications/{notification_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_notification(notification_id: str, db: Session = Depends(get_db), user=Depends(get_current_member)):
    row = db.get(Notification, notification_id)
    if not row or row.user_id != user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Notification not found")
    db.delete(row)
    db.commit()


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
        rows = [t for t in rows if user.id in (t.assignee_ids or [])]
    return [_ticket_to_response(db, t) for t in rows]


@router.get("/{ticket_id}", response_model=TicketResponse)
def get_ticket(ticket_id: str, db: Session = Depends(get_db), user=Depends(get_current_member)):
    ticket = db.get(Ticket, ticket_id)
    if not ticket:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Ticket not found")
    _ensure_ticket_access(db, user, ticket)
    return _ticket_to_response(db, ticket)


@router.get("/{ticket_id}/comments", response_model=list[TicketCommentResponse])
def list_comments(
    ticket_id: str,
    cycle_id: UUID | None = Query(default=None),
    db: Session = Depends(get_db),
    user=Depends(get_current_member),
):
    ticket = db.get(Ticket, ticket_id)
    if not ticket:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Ticket not found")
    _ensure_ticket_access(db, user, ticket)
    cycle = _resolve_cycle(db, ticket, cycle_id)
    stmt = select(TicketComment).where(
        TicketComment.ticket_id == ticket_id,
        TicketComment.ticket_cycle_id == cycle.id,
    ).order_by(TicketComment.created_at.asc())
    if user.role == UserRole.MEMBER:
        stmt = stmt.where(TicketComment.is_internal.is_(False))
    rows = db.execute(stmt).scalars().all()
    return [
        TicketCommentResponse(
            id=c.id,
            ticket_id=c.ticket_id,
            author_id=c.author_id,
            author_name=_user_name(db, c.author_id),
            author_avatar_url=_user_avatar_url(db, c.author_id),
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
    cycle_id: UUID | None = Query(default=None),
    db: Session = Depends(get_db),
    user=Depends(get_current_member),
):
    ticket = db.get(Ticket, ticket_id)
    if not ticket:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Ticket not found")
    _ensure_ticket_access(db, user, ticket)
    cycle = _resolve_cycle(db, ticket, cycle_id, require_active=True)
    if payload.is_internal and user.role == UserRole.MEMBER:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only leads and admins can add internal notes")
    row = TicketComment(
        ticket_id=ticket.id,
        ticket_cycle_id=cycle.id,
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
        author_avatar_url=_user_avatar_url(db, row.author_id),
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
            changer_avatar_url=_user_avatar_url(db, h.changed_by),
            field_name=h.field_name,
            old_value=h.old_value,
            new_value=h.new_value,
            change_note=h.change_note,
            created_at=h.created_at,
        )
        for h in rows
    ]


@router.get("/{ticket_id}/resolution", response_model=ResolutionResponse)
def get_resolution(
    ticket_id: str,
    cycle_id: UUID | None = Query(default=None),
    db: Session = Depends(get_db),
    user=Depends(get_current_member),
):
    ticket = db.get(Ticket, ticket_id)
    if not ticket:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Ticket not found")
    _ensure_ticket_access(db, user, ticket)
    cycle = _resolve_cycle(db, ticket, cycle_id)
    r = db.execute(
        select(TicketCycleResolution).where(
            TicketCycleResolution.ticket_id == ticket.id,
            TicketCycleResolution.ticket_cycle_id == cycle.id,
        )
    ).scalar_one_or_none()
    if not r:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No resolution recorded")
    return _cycle_resolution_to_response(db, r)


@router.put("/{ticket_id}/resolution", response_model=ResolutionResponse)
def upsert_resolution(
    ticket_id: str,
    payload: ResolutionCreate,
    cycle_id: UUID | None = Query(default=None),
    db: Session = Depends(get_db),
    user=Depends(get_current_member),
):
    ticket = db.get(Ticket, ticket_id)
    if not ticket:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Ticket not found")
    _ensure_ticket_access(db, user, ticket)
    cycle = _resolve_cycle(db, ticket, cycle_id, require_active=True)
    r = db.execute(
        select(TicketCycleResolution).where(
            TicketCycleResolution.ticket_id == ticket.id,
            TicketCycleResolution.ticket_cycle_id == cycle.id,
        )
    ).scalar_one_or_none()
    if r:
        r.summary = payload.summary.strip()
        r.root_cause = payload.root_cause.strip() if payload.root_cause else None
        r.steps_taken = payload.steps_taken.strip() if payload.steps_taken else None
        r.kb_article_id = payload.kb_article_id
        r.resolved_by = user.id
    else:
        r = TicketCycleResolution(
            ticket_id=ticket.id,
            ticket_cycle_id=cycle.id,
            resolved_by=user.id,
            summary=payload.summary.strip(),
            root_cause=payload.root_cause.strip() if payload.root_cause else None,
            steps_taken=payload.steps_taken.strip() if payload.steps_taken else None,
            kb_article_id=payload.kb_article_id,
        )
        db.add(r)
    db.commit()
    db.refresh(r)
    return _cycle_resolution_to_response(db, r)


@router.get("/{ticket_id}/attachments", response_model=list[TicketAttachmentResponse])
def list_attachments(
    ticket_id: str,
    cycle_id: UUID | None = Query(default=None),
    db: Session = Depends(get_db),
    user=Depends(get_current_member),
):
    ticket = db.get(Ticket, ticket_id)
    if not ticket:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Ticket not found")
    _ensure_ticket_access(db, user, ticket)
    cycle = _resolve_cycle(db, ticket, cycle_id)
    rows = db.execute(
        select(TicketAttachment).where(
            TicketAttachment.ticket_id == ticket_id,
            TicketAttachment.ticket_cycle_id == cycle.id,
        ).order_by(TicketAttachment.created_at.desc())
    ).scalars().all()
    return [
        TicketAttachmentResponse(
            id=a.id,
            comment_id=a.comment_id,
            ticket_cycle_id=a.ticket_cycle_id,
            filename=a.filename,
            file_size_bytes=a.file_size_bytes,
            mime_type=a.mime_type,
            uploaded_by=a.uploaded_by,
            uploader_name=_user_name(db, a.uploaded_by),
            uploader_avatar_url=_user_avatar_url(db, a.uploaded_by),
            created_at=a.created_at,
        )
        for a in rows
    ]


@router.post("/{ticket_id}/attachments", response_model=TicketAttachmentResponse, status_code=status.HTTP_201_CREATED)
async def upload_attachment(
    ticket_id: str,
    cycle_id: UUID | None = Query(default=None),
    db: Session = Depends(get_db),
    user=Depends(get_current_member),
    comment_id: UUID | None = Form(None),
    file: UploadFile = File(...),
):
    ticket = db.get(Ticket, ticket_id)
    if not ticket:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Ticket not found")
    _ensure_ticket_access(db, user, ticket)
    cycle = _resolve_cycle(db, ticket, cycle_id, require_active=True)
    if comment_id is not None:
        comment = db.get(TicketComment, comment_id)
        if not comment or comment.ticket_id != ticket.id or comment.ticket_cycle_id != cycle.id:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Comment not found for this ticket")
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
        ticket_cycle_id=cycle.id,
        comment_id=comment_id,
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
        comment_id=row.comment_id,
        ticket_cycle_id=row.ticket_cycle_id,
        filename=row.filename,
        file_size_bytes=row.file_size_bytes,
        mime_type=row.mime_type,
        uploaded_by=row.uploaded_by,
        uploader_name=_user_name(db, row.uploaded_by),
        uploader_avatar_url=_user_avatar_url(db, row.uploaded_by),
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
