from fastapi import APIRouter, Depends, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.dependencies.auth import get_current_lead, get_current_member
from app.models import Event, Task
from app.schemas.events_tasks import EventCreate, EventResponse, TaskCreate, TaskResponse

router = APIRouter(prefix="/work", tags=["events-tasks"])


@router.post("/events", response_model=EventResponse, status_code=status.HTTP_201_CREATED)
def create_event(payload: EventCreate, db: Session = Depends(get_db), user=Depends(get_current_lead)):
    event = Event(**payload.model_dump(), created_by=user.id)
    db.add(event)
    db.commit()
    db.refresh(event)
    return event


@router.get("/events", response_model=list[EventResponse])
def list_events(db: Session = Depends(get_db), _=Depends(get_current_member)):
    return db.execute(select(Event)).scalars().all()


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
