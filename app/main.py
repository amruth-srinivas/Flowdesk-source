import logging
import threading

from fastapi import FastAPI

from app.core.config import settings
from app.core.db_migrations import (
    apply_ticket_cycles_migration,
    apply_ticket_carryover_migration,
    apply_ticket_attachment_comment_migration,
    apply_ticket_comment_reactions_migration,
    apply_ticket_root_reactions_migration,
    apply_ticket_closed_by_migration,
    apply_user_avatar_url_migration,
    apply_user_theme_preference_migration,
    apply_user_profile_fields_migration,
    apply_customer_migrations,
    apply_event_migrations,
    apply_sprint_migrations,
    apply_ticket_assignees_migration,
    apply_ticket_configuration_migrations,
    apply_ticket_history_note_migration,
    apply_ticket_overdue_migration,
    apply_ticket_public_reference_migration,
)
from app.core.database import Base, SessionLocal, engine
from app.routes import chat, customers, auth, events_tasks, kb, personal_tasks, project_documents, projects, sprints, ticket_configuration, tickets, users
from app.services.auth_service import ensure_default_admin
from app.services.sprint_rollover_service import rollover_expired_sprints

logging.basicConfig(level=settings.log_level)
logger = logging.getLogger(__name__)

app = FastAPI(title=settings.app_name, debug=settings.debug)
_rollover_stop_event = threading.Event()
_rollover_thread: threading.Thread | None = None

app.include_router(auth.router)
app.include_router(users.router)
app.include_router(projects.router)
app.include_router(project_documents.router)
app.include_router(customers.router)
app.include_router(ticket_configuration.router)
app.include_router(tickets.router)
app.include_router(kb.router)
app.include_router(events_tasks.router)
app.include_router(personal_tasks.router)
app.include_router(sprints.router)
app.include_router(chat.router)


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
    apply_ticket_comment_reactions_migration(engine)
    apply_ticket_root_reactions_migration(engine)
    apply_sprint_migrations(engine)
    apply_ticket_overdue_migration(engine)
    apply_ticket_carryover_migration(engine)
    apply_ticket_cycles_migration(engine)
    apply_ticket_closed_by_migration(engine)
    apply_user_avatar_url_migration(engine)
    apply_user_theme_preference_migration(engine)
    apply_user_profile_fields_migration(engine)
    with SessionLocal() as db:
        ensure_default_admin(db)
        moved = rollover_expired_sprints(db)
        if moved:
            logger.info("Sprint rollover moved %s overdue tickets to backlog", moved)

    def rollover_worker() -> None:
        while not _rollover_stop_event.wait(timeout=300):
            try:
                with SessionLocal() as db:
                    moved_count = rollover_expired_sprints(db)
                    if moved_count:
                        logger.info("Sprint rollover moved %s overdue tickets to backlog", moved_count)
            except Exception:
                logger.exception("Sprint rollover worker failed")

    global _rollover_thread
    _rollover_thread = threading.Thread(target=rollover_worker, name="sprint-rollover-worker", daemon=True)
    _rollover_thread.start()
    logger.info("Startup checks complete")


@app.on_event("shutdown")
def shutdown() -> None:
    _rollover_stop_event.set()
    global _rollover_thread
    if _rollover_thread and _rollover_thread.is_alive():
        _rollover_thread.join(timeout=2)
    _rollover_thread = None
