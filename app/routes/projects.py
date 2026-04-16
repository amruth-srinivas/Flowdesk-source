from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.dependencies.auth import get_current_admin
from app.models import Project, ProjectMember
from app.schemas.projects import ProjectCreate, ProjectResponse, ProjectUpdate

router = APIRouter(prefix="/projects", tags=["projects"])


def _serialize_project(project: Project, db: Session) -> ProjectResponse:
    member_ids = db.execute(
        select(ProjectMember.user_id).where(
            ProjectMember.project_id == project.id,
            ProjectMember.role_in_project == "member",
        )
    ).scalars().all()
    return ProjectResponse(
        id=project.id,
        name=project.name,
        description=project.description,
        status=project.status,
        lead_id=project.lead_id,
        member_ids=member_ids,
        tech_tags=project.tech_tags,
        created_at=project.created_at,
    )


@router.post("", response_model=ProjectResponse, status_code=status.HTTP_201_CREATED)
def create_project(payload: ProjectCreate, db: Session = Depends(get_db), admin=Depends(get_current_admin)):
    project = Project(
        name=payload.name,
        description=payload.description,
        status=payload.status,
        lead_id=payload.lead_id,
        created_by=admin.id,
        tech_tags=payload.tech_tags,
    )
    db.add(project)
    db.flush()

    if payload.lead_id:
        db.add(ProjectMember(project_id=project.id, user_id=payload.lead_id, role_in_project="lead"))
    for member_id in payload.member_ids:
        db.add(ProjectMember(project_id=project.id, user_id=member_id, role_in_project="member"))

    db.commit()
    db.refresh(project)
    return _serialize_project(project, db)


@router.get("", response_model=list[ProjectResponse])
def list_projects(db: Session = Depends(get_db), _=Depends(get_current_admin)):
    projects = db.execute(select(Project)).scalars().all()
    return [_serialize_project(project, db) for project in projects]


@router.put("/{project_id}", response_model=ProjectResponse)
def update_project(project_id: str, payload: ProjectUpdate, db: Session = Depends(get_db), _=Depends(get_current_admin)):
    project = db.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")

    project.name = payload.name
    project.description = payload.description
    project.status = payload.status
    project.lead_id = payload.lead_id
    project.tech_tags = payload.tech_tags

    db.query(ProjectMember).filter(ProjectMember.project_id == project.id).delete()

    if payload.lead_id:
      db.add(ProjectMember(project_id=project.id, user_id=payload.lead_id, role_in_project="lead"))

    for member_id in payload.member_ids:
      db.add(ProjectMember(project_id=project.id, user_id=member_id, role_in_project="member"))

    db.commit()
    db.refresh(project)
    return _serialize_project(project, db)
