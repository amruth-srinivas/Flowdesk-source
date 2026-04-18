"""Lightweight additive migrations for environments without Alembic."""

import logging

from sqlalchemy import inspect, text
from sqlalchemy.engine import Engine

logger = logging.getLogger(__name__)


def _ticket_configuration_ticket_type_is_postgres_enum(engine: Engine) -> bool:
    """True if ticket_configuration.ticket_type is still a PostgreSQL enum (blocks custom slugs)."""
    if engine.dialect.name != "postgresql":
        return False
    try:
        with engine.connect() as conn:
            row = conn.execute(
                text(
                    """
                    SELECT c.data_type
                    FROM information_schema.columns c
                    WHERE c.table_schema = current_schema()
                      AND c.table_name = 'ticket_configuration'
                      AND c.column_name = 'ticket_type'
                    """
                )
            ).one_or_none()
    except Exception as exc:
        logger.warning("Could not read ticket_configuration.ticket_type data_type: %s", exc)
        return False
    return row is not None and row[0] == "USER-DEFINED"


def _convert_ticket_configuration_ticket_type_to_varchar(engine: Engine) -> None:
    """Align DB with String(80) model: old DBs used PostgreSQL enum ticket_type (shared name with tickets.type)."""
    if not _ticket_configuration_ticket_type_is_postgres_enum(engine):
        return
    logger.info(
        "Converting ticket_configuration.ticket_type from PostgreSQL enum to VARCHAR(80) for custom ticket slugs"
    )
    stmt = text(
        """
        ALTER TABLE ticket_configuration
          ALTER COLUMN ticket_type TYPE VARCHAR(80)
          USING ticket_type::text
        """
    )
    with engine.begin() as conn:
        conn.execute(stmt)


def apply_ticket_configuration_migrations(engine: Engine) -> None:
    """Ensure ticket_configuration matches current models (existing DBs may lag create_all)."""
    try:
        inspector = inspect(engine)
        tables = inspector.get_table_names()
    except Exception as exc:
        logger.warning("Could not inspect database for migrations: %s", exc)
        return

    if "ticket_configuration" not in tables:
        return

    _convert_ticket_configuration_ticket_type_to_varchar(engine)

    columns = {col["name"] for col in inspector.get_columns("ticket_configuration")}

    if "display_name" not in columns:
        logger.info("Adding ticket_configuration.display_name column")
        dialect = engine.dialect.name
        if dialect == "postgresql":
            stmt = text(
                "ALTER TABLE ticket_configuration ADD COLUMN IF NOT EXISTS display_name VARCHAR(150)"
            )
        else:
            stmt = text("ALTER TABLE ticket_configuration ADD COLUMN display_name VARCHAR(150)")
        try:
            with engine.begin() as conn:
                conn.execute(stmt)
        except Exception as exc:
            logger.warning("Could not add display_name column (may already exist): %s", exc)


def apply_event_migrations(engine: Engine) -> None:
    """Add tracking columns to events; event_milestones is created via create_all when missing."""
    try:
        inspector = inspect(engine)
        tables = inspector.get_table_names()
    except Exception as exc:
        logger.warning("Could not inspect database for event migrations: %s", exc)
        return

    if "events" not in tables:
        return

    dialect = engine.dialect.name
    columns = {col["name"] for col in inspector.get_columns("events")}

    try:
        with engine.begin() as conn:
            if "status" not in columns:
                logger.info("Adding events.status column")
                if dialect == "postgresql":
                    conn.execute(text("ALTER TABLE events ADD COLUMN IF NOT EXISTS status VARCHAR(32) DEFAULT 'planning'"))
                else:
                    conn.execute(text("ALTER TABLE events ADD COLUMN status VARCHAR(32) DEFAULT 'planning'"))

            if "progress_percent" not in columns:
                logger.info("Adding events.progress_percent column")
                if dialect == "postgresql":
                    conn.execute(text("ALTER TABLE events ADD COLUMN IF NOT EXISTS progress_percent INTEGER"))
                else:
                    conn.execute(text("ALTER TABLE events ADD COLUMN progress_percent INTEGER"))

            if "updated_at" not in columns:
                logger.info("Adding events.updated_at column")
                if dialect == "postgresql":
                    conn.execute(text("ALTER TABLE events ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()"))
                    conn.execute(text("UPDATE events SET updated_at = created_at WHERE updated_at IS NULL"))
                else:
                    conn.execute(text("ALTER TABLE events ADD COLUMN updated_at DATETIME"))
                    conn.execute(text("UPDATE events SET updated_at = created_at WHERE updated_at IS NULL"))
    except Exception as exc:
        logger.warning("Event column migration failed: %s", exc)


def apply_customer_migrations(engine: Engine) -> None:
    """Add contacts and project_ids to customers when DB predates those columns (create_all does not alter tables)."""
    try:
        inspector = inspect(engine)
        tables = inspector.get_table_names()
    except Exception as exc:
        logger.warning("Could not inspect database for customer migrations: %s", exc)
        return

    if "customers" not in tables:
        return

    dialect = engine.dialect.name
    columns = {col["name"] for col in inspector.get_columns("customers")}

    try:
        with engine.begin() as conn:
            if "contacts" not in columns:
                logger.info("Adding customers.contacts column")
                if dialect == "postgresql":
                    conn.execute(
                        text(
                            "ALTER TABLE customers ADD COLUMN IF NOT EXISTS contacts JSON NOT NULL DEFAULT '[]'::json"
                        )
                    )
                else:
                    conn.execute(
                        text(
                            "ALTER TABLE customers ADD COLUMN contacts JSON NOT NULL DEFAULT '[]'"
                        )
                    )

            if "project_ids" not in columns:
                logger.info("Adding customers.project_ids column")
                if dialect == "postgresql":
                    conn.execute(
                        text(
                            "ALTER TABLE customers ADD COLUMN IF NOT EXISTS project_ids UUID[] NOT NULL DEFAULT '{}'::uuid[]"
                        )
                    )
                else:
                    logger.warning(
                        "Skipping customers.project_ids on non-PostgreSQL dialect; use a compatible database."
                    )
    except Exception as exc:
        logger.warning("Customer column migration failed: %s", exc)


def apply_ticket_public_reference_migration(engine: Engine) -> None:
    """Add tickets.public_reference for SR0001-style ids per project + type."""
    try:
        inspector = inspect(engine)
        tables = inspector.get_table_names()
    except Exception as exc:
        logger.warning("Could not inspect database for ticket migrations: %s", exc)
        return

    if "tickets" not in tables:
        return

    dialect = engine.dialect.name
    columns = {col["name"] for col in inspector.get_columns("tickets")}

    try:
        with engine.begin() as conn:
            if "public_reference" not in columns:
                logger.info("Adding tickets.public_reference column")
                if dialect == "postgresql":
                    conn.execute(text("ALTER TABLE tickets ADD COLUMN IF NOT EXISTS public_reference VARCHAR(48)"))
                    conn.execute(
                        text("CREATE INDEX IF NOT EXISTS ix_tickets_public_reference ON tickets (public_reference)")
                    )
                else:
                    conn.execute(text("ALTER TABLE tickets ADD COLUMN public_reference VARCHAR(48)"))
    except Exception as exc:
        logger.warning("Ticket public_reference migration failed: %s", exc)


def apply_sprint_migrations(engine: Engine) -> None:
    """Add tickets.sprint_id for existing databases (sprints table comes from create_all)."""
    try:
        inspector = inspect(engine)
        tables = inspector.get_table_names()
    except Exception as exc:
        logger.warning("Could not inspect database for sprint migrations: %s", exc)
        return

    if "tickets" not in tables or "sprints" not in tables:
        return

    dialect = engine.dialect.name
    columns = {col["name"] for col in inspector.get_columns("tickets")}
    if "sprint_id" in columns:
        return

    logger.info("Adding tickets.sprint_id column for sprints")
    try:
        with engine.begin() as conn:
            if dialect == "postgresql":
                conn.execute(
                    text(
                        "ALTER TABLE tickets ADD COLUMN IF NOT EXISTS sprint_id UUID REFERENCES sprints(id) ON DELETE SET NULL"
                    )
                )
                conn.execute(text("CREATE INDEX IF NOT EXISTS ix_tickets_sprint_id ON tickets (sprint_id)"))
            else:
                conn.execute(text("ALTER TABLE tickets ADD COLUMN sprint_id UUID"))
    except Exception as exc:
        logger.warning("Sprint column migration failed: %s", exc)
