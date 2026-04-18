from datetime import date
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import and_, case, delete, func, select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.dependencies.auth import get_current_lead_or_member
from app.models import PersonalTask, User
from app.schemas.personal_tasks import (
    PersonalTaskCreate,
    PersonalTaskDaySummary,
    PersonalTaskResponse,
    PersonalTasksForDayResponse,
    PersonalTaskUpdate,
)

router = APIRouter(prefix="/work/personal-tasks", tags=["personal-tasks"])


def _to_response(row: PersonalTask) -> PersonalTaskResponse:
    return PersonalTaskResponse.model_validate(row)


def _get_owned_task(db: Session, user_id: UUID, task_id: UUID) -> PersonalTask:
    row = db.execute(select(PersonalTask).where(PersonalTask.id == task_id)).scalar_one_or_none()
    if not row or row.user_id != user_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")
    return row


@router.get("/for-day", response_model=PersonalTasksForDayResponse)
def list_for_day(
    date: date = Query(..., description="Calendar day (YYYY-MM-DD)"),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_lead_or_member),
):
    """Incomplete tasks from earlier days before `date`, plus all tasks scheduled on `date`."""
    uid = user.id

    pending_stmt = (
        select(PersonalTask)
        .where(
            and_(
                PersonalTask.user_id == uid,
                PersonalTask.is_completed == False,  # noqa: E712
                PersonalTask.task_date < date,
            )
        )
        .order_by(PersonalTask.task_date.asc(), PersonalTask.sort_order.asc(), PersonalTask.created_at.asc())
    )
    day_stmt = (
        select(PersonalTask)
        .where(
            and_(
                PersonalTask.user_id == uid,
                PersonalTask.task_date == date,
            )
        )
        .order_by(PersonalTask.sort_order.asc(), PersonalTask.created_at.asc())
    )

    pending = db.execute(pending_stmt).scalars().all()
    for_day = db.execute(day_stmt).scalars().all()
    return PersonalTasksForDayResponse(
        pending_earlier=[_to_response(r) for r in pending],
        for_day=[_to_response(r) for r in for_day],
    )


@router.get("/month-summary", response_model=list[PersonalTaskDaySummary])
def month_summary(
    from_: date = Query(..., alias="from", description="Range start (inclusive)"),
    to: date = Query(..., description="Range end (inclusive)"),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_lead_or_member),
):
    """Per-day counts for the personal-task calendar (no mixing with events)."""
    if from_ > to:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="from must be <= to")

    uid = user.id
    open_sum = func.coalesce(
        func.sum(case((PersonalTask.is_completed == False, 1), else_=0)),  # noqa: E712
        0,
    )
    stmt = (
        select(
            PersonalTask.task_date,
            func.count(PersonalTask.id).label("total"),
            open_sum.label("open"),
        )
        .where(
            and_(
                PersonalTask.user_id == uid,
                PersonalTask.task_date >= from_,
                PersonalTask.task_date <= to,
            )
        )
        .group_by(PersonalTask.task_date)
        .order_by(PersonalTask.task_date.asc())
    )
    rows = db.execute(stmt).all()
    return [
        PersonalTaskDaySummary(task_date=r.task_date, total=int(r.total), open=int(r.open))
        for r in rows
    ]


@router.delete("/for-day", status_code=status.HTTP_204_NO_CONTENT)
def delete_all_for_day(
    date: date = Query(..., description="Calendar day (YYYY-MM-DD); deletes all personal tasks on that day"),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_lead_or_member),
):
    """Remove every personal task scheduled on `date` for the current user (not carried-over rows from other days)."""
    uid = user.id
    stmt = delete(PersonalTask).where(
        and_(
            PersonalTask.user_id == uid,
            PersonalTask.task_date == date,
        )
    )
    db.execute(stmt)
    db.commit()
    return None


@router.post("", response_model=PersonalTaskResponse, status_code=status.HTTP_201_CREATED)
def create_task(
    payload: PersonalTaskCreate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_lead_or_member),
):
    row = PersonalTask(
        user_id=user.id,
        task_date=payload.task_date,
        title=payload.title.strip(),
        body=payload.body.strip() if payload.body else None,
        is_completed=False,
        sort_order=payload.sort_order,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return _to_response(row)


@router.put("/{task_id}", response_model=PersonalTaskResponse)
def update_task(
    task_id: UUID,
    payload: PersonalTaskUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_lead_or_member),
):
    row = _get_owned_task(db, user.id, task_id)
    if payload.title is not None:
        row.title = payload.title.strip()
    if payload.body is not None:
        row.body = payload.body.strip() if payload.body else None
    if payload.is_completed is not None:
        row.is_completed = payload.is_completed
    if payload.task_date is not None:
        row.task_date = payload.task_date
    if payload.sort_order is not None:
        row.sort_order = payload.sort_order
    db.commit()
    db.refresh(row)
    return _to_response(row)


@router.delete("/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_task(
    task_id: UUID,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_lead_or_member),
):
    row = _get_owned_task(db, user.id, task_id)
    db.delete(row)
    db.commit()
    return None
