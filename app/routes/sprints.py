from datetime import date, timedelta
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.constants.enums import UserRole
from app.core.database import get_db
from app.dependencies.auth import get_current_lead, get_current_member
from app.models import Sprint, Ticket, User
from app.schemas.sprints import (
    SprintActiveMember,
    SprintAnalyticsResponse,
    SprintCreate,
    SprintResponse,
    SprintTicketBrief,
    SprintUpdate,
)
from app.utils.access import accessible_project_ids

router = APIRouter(prefix="/sprints", tags=["sprints"])


def _end_date_inclusive(start: date, duration_days: int) -> date:
    return start + timedelta(days=max(0, duration_days - 1))


def _user_name(db: Session, user_id: UUID) -> str:
    u = db.get(User, user_id)
    return u.name if u else "Unknown"


def _to_response(db: Session, row: Sprint) -> SprintResponse:
    return SprintResponse(
        id=row.id,
        title=row.title,
        sprint_type=row.sprint_type,
        duration_days=row.duration_days,
        start_date=row.start_date,
        end_date=row.end_date,
        project_ids=list(row.project_ids),
        created_by=row.created_by,
        created_by_name=_user_name(db, row.created_by),
        status=row.status,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def _is_active_sprint(row: Sprint) -> bool:
    return (row.status or "").strip().lower() == "active"


def _is_planning_sprint(row: Sprint) -> bool:
    return (row.status or "").strip().lower() == "planning"


def _member_can_view_sprint(user: User, row: Sprint) -> bool:
    if user.role != UserRole.MEMBER:
        return True
    return _is_active_sprint(row) or _is_planning_sprint(row)


def _validate_projects(db: Session, user: User, project_ids: list[UUID]) -> None:
    if user.role == UserRole.ADMIN:
        return
    allowed = accessible_project_ids(db, user)
    for pid in project_ids:
        if pid not in allowed:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=f"No access to project {pid}")


@router.get("", response_model=list[SprintResponse])
def list_sprints(db: Session = Depends(get_db), user: User = Depends(get_current_member)):
    rows = db.execute(select(Sprint).order_by(Sprint.start_date.desc())).scalars().all()
    if user.role == UserRole.ADMIN:
        return [_to_response(db, r) for r in rows]
    allowed = accessible_project_ids(db, user)
    out: list[Sprint] = []
    for r in rows:
        if not r.project_ids:
            continue
        if any(p in allowed for p in r.project_ids):
            out.append(r)
    if user.role == UserRole.MEMBER:
        out = [r for r in out if _is_active_sprint(r) or _is_planning_sprint(r)]
        active_rows = [r for r in out if _is_active_sprint(r)]
        planning_rows = [r for r in out if _is_planning_sprint(r)]
        active_rows.sort(key=lambda r: r.start_date, reverse=True)
        planning_rows.sort(key=lambda r: r.start_date, reverse=True)
        out = active_rows + planning_rows
    return [_to_response(db, r) for r in out]


@router.get("/{sprint_id}", response_model=SprintResponse)
def get_sprint(sprint_id: UUID, db: Session = Depends(get_db), user: User = Depends(get_current_member)):
    row = db.get(Sprint, sprint_id)
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Sprint not found")
    if user.role != UserRole.ADMIN:
        allowed = accessible_project_ids(db, user)
        if row.project_ids and not any(p in allowed for p in row.project_ids):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No access to this sprint")
    if not _member_can_view_sprint(user, row):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Team members can only view active or planning sprints",
        )
    return _to_response(db, row)


@router.get("/{sprint_id}/analytics", response_model=SprintAnalyticsResponse)
def sprint_analytics(sprint_id: UUID, db: Session = Depends(get_db), user: User = Depends(get_current_member)):
    row = db.get(Sprint, sprint_id)
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Sprint not found")
    if user.role != UserRole.ADMIN:
        allowed = accessible_project_ids(db, user)
        if row.project_ids and not any(p in allowed for p in row.project_ids):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No access to this sprint")
    if not _member_can_view_sprint(user, row):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Team members can only view active or planning sprints",
        )

    tickets = db.execute(select(Ticket).where(Ticket.sprint_id == sprint_id)).scalars().all()
    by_status: dict[str, int] = {}
    for t in tickets:
        k = t.status.value if hasattr(t.status, "value") else str(t.status)
        by_status[k] = by_status.get(k, 0) + 1

    done = by_status.get("closed", 0) + by_status.get("resolved", 0)
    total = len(tickets)
    remaining = total - done
    pct = (done / total * 100.0) if total else 0.0

    all_assignee_ids: set[UUID] = set()
    for t in tickets:
        for aid in t.assignee_ids or []:
            all_assignee_ids.add(aid)

    user_map: dict[UUID, str] = {}
    if all_assignee_ids:
        users = db.execute(select(User).where(User.id.in_(all_assignee_ids))).scalars().all()
        for u in users:
            user_map[u.id] = u.name or "Unknown"

    brief_list: list[SprintTicketBrief] = []
    member_by_id: dict[UUID, str] = {}
    carried_from_ids = {t.carried_from_sprint_id for t in tickets if t.carried_from_sprint_id}
    carried_from_title_by_id: dict[UUID, str] = {}
    if carried_from_ids:
        carried_from_sprints = db.execute(select(Sprint).where(Sprint.id.in_(carried_from_ids))).scalars().all()
        carried_from_title_by_id = {s.id: s.title for s in carried_from_sprints}
    for t in tickets:
        st = t.status.value if hasattr(t.status, "value") else str(t.status)
        pr = t.priority.value if hasattr(t.priority, "value") else str(t.priority)
        names = [user_map[aid] for aid in (t.assignee_ids or []) if aid in user_map]
        brief_list.append(
            SprintTicketBrief(
                id=t.id,
                public_reference=t.public_reference,
                title=t.title,
                status=st,
                priority=pr,
                assignee_names=names,
                carried_from_sprint_id=t.carried_from_sprint_id,
                carried_from_sprint_title=carried_from_title_by_id.get(t.carried_from_sprint_id) if t.carried_from_sprint_id else None,
                carryover_count=int(t.carryover_count or 0),
            )
        )
        for aid in t.assignee_ids or []:
            if aid in user_map:
                member_by_id[aid] = user_map[aid]

    brief_list.sort(
        key=lambda b: (
            (b.public_reference or "").lower(),
            b.title.lower(),
        )
    )
    active_members = [
        SprintActiveMember(id=uid, name=name)
        for uid, name in sorted(member_by_id.items(), key=lambda x: x[1].lower())
    ]

    return SprintAnalyticsResponse(
        sprint_id=row.id,
        title=row.title,
        total_tickets=total,
        by_status=by_status,
        tickets_done=done,
        tickets_remaining=remaining,
        progress_percent=round(pct, 1),
        tickets=brief_list,
        active_members=active_members,
    )


@router.post("", response_model=SprintResponse, status_code=status.HTTP_201_CREATED)
def create_sprint(
    payload: SprintCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_lead),
):
    _validate_projects(db, user, payload.project_ids)
    end = _end_date_inclusive(payload.start_date, payload.duration_days)
    row = Sprint(
        title=payload.title.strip(),
        sprint_type=(payload.sprint_type or "general").strip()[:80],
        duration_days=payload.duration_days,
        start_date=payload.start_date,
        end_date=end,
        project_ids=payload.project_ids,
        created_by=user.id,
        status=payload.status.strip()[:32] if payload.status else "planning",
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return _to_response(db, row)


@router.put("/{sprint_id}", response_model=SprintResponse)
def update_sprint(
    sprint_id: UUID,
    payload: SprintUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_lead),
):
    row = db.get(Sprint, sprint_id)
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Sprint not found")

    data = payload.model_dump(exclude_unset=True)
    if "project_ids" in data and payload.project_ids is not None:
        _validate_projects(db, user, payload.project_ids)
        row.project_ids = payload.project_ids
    if "title" in data and payload.title is not None:
        row.title = payload.title.strip()
    if "sprint_type" in data and payload.sprint_type is not None:
        row.sprint_type = payload.sprint_type.strip()[:80]
    if "status" in data and payload.status is not None:
        row.status = payload.status.strip()[:32]
    if "duration_days" in data and payload.duration_days is not None:
        row.duration_days = payload.duration_days
    if "start_date" in data and payload.start_date is not None:
        row.start_date = payload.start_date
    if "end_date" in data and payload.end_date is not None:
        row.end_date = payload.end_date
    elif "duration_days" in data or "start_date" in data:
        row.end_date = _end_date_inclusive(row.start_date, row.duration_days)

    db.commit()
    db.refresh(row)
    return _to_response(db, row)


@router.delete("/{sprint_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_sprint(sprint_id: UUID, db: Session = Depends(get_db), user: User = Depends(get_current_lead)):
    row = db.get(Sprint, sprint_id)
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Sprint not found")
    for t in db.execute(select(Ticket).where(Ticket.sprint_id == sprint_id)).scalars().all():
        t.sprint_id = None
    db.delete(row)
    db.commit()
    return None
