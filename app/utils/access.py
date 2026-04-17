"""Project visibility for non-admin users (tickets, project lists)."""

from uuid import UUID

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.constants.enums import UserRole
from app.models import Project, ProjectMember, User


def accessible_project_ids(db: Session, user: User) -> set[UUID]:
    """Projects the user may see tickets for and create tickets in."""
    if user.role == UserRole.ADMIN:
        rows = db.execute(select(Project.id)).scalars().all()
        return set(rows)

    if user.role == UserRole.LEAD:
        member_projects = select(ProjectMember.project_id).where(ProjectMember.user_id == user.id)
        rows = db.execute(
            select(Project.id).where(or_(Project.lead_id == user.id, Project.id.in_(member_projects)))
        ).scalars().all()
        return set(rows)

    member_projects = select(ProjectMember.project_id).where(ProjectMember.user_id == user.id)
    rows = db.execute(select(Project.id).where(Project.id.in_(member_projects))).scalars().all()
    return set(rows)
