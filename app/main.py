import logging

from fastapi import FastAPI

from app.core.config import settings
from app.core.db_migrations import (
    apply_ticket_attachment_comment_migration,
    apply_customer_migrations,
    apply_event_migrations,
    apply_sprint_migrations,
    apply_ticket_assignees_migration,
    apply_ticket_configuration_migrations,
    apply_ticket_history_note_migration,
    apply_ticket_public_reference_migration,
)
from app.core.database import Base, SessionLocal, engine
from app.routes import auth, customers, events_tasks, kb, personal_tasks, projects, sprints, ticket_configuration, tickets, users
from app.services.auth_service import ensure_default_admin

logging.basicConfig(level=settings.log_level)
logger = logging.getLogger(__name__)

app = FastAPI(title=settings.app_name, debug=settings.debug)

app.include_router(auth.router)
app.include_router(users.router)
app.include_router(projects.router)
app.include_router(customers.router)
app.include_router(ticket_configuration.router)
app.include_router(tickets.router)
app.include_router(kb.router)
app.include_router(events_tasks.router)
app.include_router(personal_tasks.router)
app.include_router(sprints.router)


@app.get("/health")
def health():
    return {"status": "ok"}


@app.on_event("startup")
def startup() -> None:
    logger.info("Ensuring database connectivity and creating tables")
    Base.metadata.create_all(bind=engine)
    apply_ticket_configuration_migrations(engine)
    apply_event_migrations(engine)
    apply_customer_migrations(engine)
    apply_ticket_public_reference_migration(engine)
    apply_ticket_assignees_migration(engine)
    apply_ticket_history_note_migration(engine)
    apply_ticket_attachment_comment_migration(engine)
    apply_sprint_migrations(engine)
    with SessionLocal() as db:
        ensure_default_admin(db)
    logger.info("Startup checks complete")
