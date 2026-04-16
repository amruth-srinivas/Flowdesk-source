from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import and_, func, select
from sqlalchemy.orm import Session, joinedload, selectinload

from app.core.database import get_db
from app.dependencies.auth import get_current_admin, get_current_lead, get_current_member
from app.models import Event, EventMilestone, Project, Task
from app.schemas.events_tasks import (
    EventCreate,
    EventResponse,
    EventUpdate,
    MilestoneCreate,
    MilestonePatch,
    MilestoneResponse,
    TaskCreate,
    TaskResponse,
)

router = APIRouter(prefix="/work", tags=["events-tasks"])


def _event_to_response(event: Event) -> EventResponse:
    return EventResponse(
        id=event.id,
        project_id=event.project_id,
        project_name=event.project.name if event.project else None,
        created_by=event.created_by,
        title=event.title,
        description=event.description,
        event_type=event.event_type,
        start_at=event.start_at,
        end_at=event.end_at,
        status=event.status,
        progress_percent=event.progress_percent,
        created_at=event.created_at,
        updated_at=event.updated_at,
        milestones=[
            MilestoneResponse.model_validate(m)
            for m in sorted(event.milestones, key=lambda x: (x.sort_order, x.created_at))
        ],
    )


def _milestones_from_payload(items: list[MilestoneCreate]) -> list[EventMilestone]:
    out: list[EventMilestone] = []
    for i, m in enumerate(items):
        out.append(
            EventMilestone(
                title=m.title.strip(),
                target_date=m.target_date,
                sort_order=m.sort_order if m.sort_order else i,
            )
        )
    return out


@router.get("/events", response_model=list[EventResponse])
def list_events(
    db: Session = Depends(get_db),
    _=Depends(get_current_member),
    from_: datetime | None = Query(None, alias="from"),
    to: datetime | None = Query(None, description="ISO range end; events overlapping range are returned"),
):
    """List events, optionally filtered to those overlapping [from, to]."""
    stmt = select(Event).options(joinedload(Event.project), selectinload(Event.milestones)).order_by(Event.start_at.asc())
    if from_ is not None and to is not None:
        if from_ > to:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="from must be <= to")
        stmt = stmt.where(
            and_(
                Event.start_at <= to,
                func.coalesce(Event.end_at, Event.start_at) >= from_,
            )
        )
    rows = db.execute(stmt).unique().scalars().all()
    return [_event_to_response(e) for e in rows]


@router.post("/events", response_model=EventResponse, status_code=status.HTTP_201_CREATED)
def create_event(payload: EventCreate, db: Session = Depends(get_db), user=Depends(get_current_admin)):
    project = db.get(Project, payload.project_id)
    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")

    event = Event(
        project_id=payload.project_id,
        created_by=user.id,
        title=payload.title.strip(),
        description=payload.description.strip() if payload.description else None,
        event_type=payload.event_type.strip(),
        start_at=payload.start_at,
        end_at=payload.end_at,
        status=payload.status.strip(),
        progress_percent=payload.progress_percent,
    )
    event.milestones = _milestones_from_payload(payload.milestones)
    db.add(event)
    db.commit()
    row = db.execute(
        select(Event).options(joinedload(Event.project), selectinload(Event.milestones)).where(Event.id == event.id)
    ).unique().scalar_one()
    return _event_to_response(row)


@router.put("/events/{event_id}", response_model=EventResponse)
def update_event(
    event_id: UUID,
    payload: EventUpdate,
    db: Session = Depends(get_db),
    _=Depends(get_current_admin),
):
    event = db.execute(
        select(Event).options(joinedload(Event.project), selectinload(Event.milestones)).where(Event.id == event_id)
    ).unique().scalar_one_or_none()
    if not event:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event not found")

    if payload.project_id is not None:
        project = db.get(Project, payload.project_id)
        if not project:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
        event.project_id = payload.project_id

    if payload.title is not None:
        event.title = payload.title.strip()
    if payload.description is not None:
        event.description = payload.description.strip() if payload.description else None
    if payload.event_type is not None:
        event.event_type = payload.event_type.strip()
    if payload.start_at is not None:
        event.start_at = payload.start_at
    if payload.end_at is not None:
        event.end_at = payload.end_at
    if payload.status is not None:
        event.status = payload.status.strip()
    if payload.progress_percent is not None:
        event.progress_percent = payload.progress_percent

    if payload.milestones is not None:
        event.milestones.clear()
        for m in _milestones_from_payload(payload.milestones):
            event.milestones.append(m)

    db.commit()
    row = db.execute(
        select(Event).options(joinedload(Event.project), selectinload(Event.milestones)).where(Event.id == event_id)
    ).unique().scalar_one()
    return _event_to_response(row)


@router.delete("/events/{event_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_event(event_id: UUID, db: Session = Depends(get_db), _=Depends(get_current_admin)):
    event = db.get(Event, event_id)
    if not event:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event not found")
    db.delete(event)
    db.commit()
    return None


@router.patch("/events/{event_id}/milestones/{milestone_id}", response_model=EventResponse)
def patch_milestone(
    event_id: UUID,
    milestone_id: UUID,
    payload: MilestonePatch,
    db: Session = Depends(get_db),
    _=Depends(get_current_admin),
):
    event = db.execute(
        select(Event).options(joinedload(Event.project), selectinload(Event.milestones)).where(Event.id == event_id)
    ).unique().scalar_one_or_none()
    if not event:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Event not found")
    ms = next((m for m in event.milestones if m.id == milestone_id), None)
    if not ms:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Milestone not found")
    if payload.completed:
        ms.completed_at = datetime.now(timezone.utc)
    else:
        ms.completed_at = None
    db.commit()
    row = db.execute(
        select(Event).options(joinedload(Event.project), selectinload(Event.milestones)).where(Event.id == event_id)
    ).unique().scalar_one()
    return _event_to_response(row)


@router.post("/tasks", response_model=TaskResponse, status_code=status.HTTP_201_CREATED)
def create_task(payload: TaskCreate, db: Session = Depends(get_db), _=Depends(get_current_lead)):
    task = Task(**payload.model_dump())
    db.add(task)
    db.commit()
    db.refresh(task)
    return task


@router.get("/tasks", response_model=list[TaskResponse])
def list_tasks(db: Session = Depends(get_db), _=Depends(get_current_member)):
    return db.execute(select(Task)).scalars().all()
