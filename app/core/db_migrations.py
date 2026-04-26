"""Lightweight additive migrations for environments without Alembic."""

import logging
import uuid

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


def _widen_customers_timezone_column(engine: Engine) -> None:
    """Widen customers.timezone for values longer than legacy VARCHAR(60) (e.g. address pasted into timezone)."""
    if engine.dialect.name != "postgresql":
        return
    try:
        with engine.begin() as conn:
            row = conn.execute(
                text(
                    """
                    SELECT c.character_maximum_length
                    FROM information_schema.columns c
                    WHERE c.table_schema = current_schema()
                      AND c.table_name = 'customers'
                      AND c.column_name = 'timezone'
                    """
                )
            ).one_or_none()
    except Exception as exc:
        logger.warning("Could not read customers.timezone column info: %s", exc)
        return
    if row is None:
        return
    maxlen = row[0]
    if maxlen is not None and maxlen < 255:
        logger.info("Widening customers.timezone from VARCHAR(%s) to VARCHAR(255)", maxlen)
        try:
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE customers ALTER COLUMN timezone TYPE VARCHAR(255)"))
        except Exception as exc:
            logger.warning("Could not widen customers.timezone: %s", exc)


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

    _widen_customers_timezone_column(engine)


def apply_ticket_assignees_migration(engine: Engine) -> None:
    """Replace legacy tickets.assignee_id with UUID[] assignee_ids (multiple assignees)."""
    if engine.dialect.name != "postgresql":
        return
    try:
        inspector = inspect(engine)
        tables = inspector.get_table_names()
    except Exception as exc:
        logger.warning("Could not inspect database for ticket assignee migration: %s", exc)
        return

    if "tickets" not in tables:
        return

    columns = {c["name"] for c in inspector.get_columns("tickets")}

    try:
        with engine.begin() as conn:
            if "assignee_ids" not in columns:
                logger.info("Adding tickets.assignee_ids column")
                conn.execute(
                    text(
                        "ALTER TABLE tickets ADD COLUMN IF NOT EXISTS assignee_ids UUID[] NOT NULL DEFAULT '{}'::uuid[]"
                    )
                )
            if "assignee_id" in columns:
                logger.info("Migrating tickets.assignee_id into assignee_ids; dropping assignee_id")
                conn.execute(
                    text(
                        "UPDATE tickets SET assignee_ids = ARRAY[assignee_id]::uuid[] WHERE assignee_id IS NOT NULL"
                    )
                )
                conn.execute(text("ALTER TABLE tickets DROP COLUMN assignee_id"))
    except Exception as exc:
        logger.warning("Ticket assignee migration failed: %s", exc)


def apply_ticket_history_note_migration(engine: Engine) -> None:
    """Add ticket_history.change_note to capture status-change comments."""
    try:
        inspector = inspect(engine)
        tables = inspector.get_table_names()
    except Exception as exc:
        logger.warning("Could not inspect database for ticket history migration: %s", exc)
        return

    if "ticket_history" not in tables:
        return

    dialect = engine.dialect.name
    columns = {col["name"] for col in inspector.get_columns("ticket_history")}
    if "change_note" in columns:
        return

    logger.info("Adding ticket_history.change_note column")
    try:
        with engine.begin() as conn:
            if dialect == "postgresql":
                conn.execute(text("ALTER TABLE ticket_history ADD COLUMN IF NOT EXISTS change_note TEXT"))
            else:
                conn.execute(text("ALTER TABLE ticket_history ADD COLUMN change_note TEXT"))
    except Exception as exc:
        logger.warning("Ticket history migration failed: %s", exc)


def apply_ticket_attachment_comment_migration(engine: Engine) -> None:
    """Add ticket_attachments.comment_id so media can be linked to specific chat comments."""
    try:
        inspector = inspect(engine)
        tables = inspector.get_table_names()
    except Exception as exc:
        logger.warning("Could not inspect database for ticket attachment migration: %s", exc)
        return

    if "ticket_attachments" not in tables or "ticket_comments" not in tables:
        return

    columns = {col["name"] for col in inspector.get_columns("ticket_attachments")}
    if "comment_id" in columns:
        return

    dialect = engine.dialect.name
    logger.info("Adding ticket_attachments.comment_id column")
    try:
        with engine.begin() as conn:
            if dialect == "postgresql":
                conn.execute(
                    text(
                        "ALTER TABLE ticket_attachments ADD COLUMN IF NOT EXISTS comment_id UUID REFERENCES ticket_comments(id) ON DELETE SET NULL"
                    )
                )
                conn.execute(
                    text("CREATE INDEX IF NOT EXISTS ix_ticket_attachments_comment_id ON ticket_attachments (comment_id)")
                )
            else:
                conn.execute(text("ALTER TABLE ticket_attachments ADD COLUMN comment_id UUID"))
    except Exception as exc:
        logger.warning("Ticket attachment migration failed: %s", exc)


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


def apply_ticket_closed_by_migration(engine: Engine) -> None:
    """Add tickets.closed_by for tracking who closed the ticket."""
    try:
        inspector = inspect(engine)
        tables = inspector.get_table_names()
    except Exception as exc:
        logger.warning("Could not inspect database for closed_by migration: %s", exc)
        return

    if "tickets" not in tables:
        return

    columns = {col["name"] for col in inspector.get_columns("tickets")}
    if "closed_by" in columns:
        return

    logger.info("Adding tickets.closed_by column")
    try:
        with engine.begin() as conn:
            if engine.dialect.name == "postgresql":
                conn.execute(
                    text(
                        "ALTER TABLE tickets ADD COLUMN IF NOT EXISTS closed_by UUID REFERENCES users(id)"
                    )
                )
            else:
                conn.execute(text("ALTER TABLE tickets ADD COLUMN closed_by UUID"))
    except Exception as exc:
        logger.warning("Ticket closed_by migration failed: %s", exc)


def apply_user_avatar_url_migration(engine: Engine) -> None:
    """Widen users.avatar_url to TEXT for larger data/blob URLs."""
    try:
        inspector = inspect(engine)
        tables = inspector.get_table_names()
    except Exception as exc:
        logger.warning("Could not inspect database for avatar_url migration: %s", exc)
        return

    if "users" not in tables:
        return

    if engine.dialect.name != "postgresql":
        return

    try:
        with engine.begin() as conn:
            row = conn.execute(
                text(
                    """
                    SELECT c.data_type, c.character_maximum_length
                    FROM information_schema.columns c
                    WHERE c.table_schema = current_schema()
                      AND c.table_name = 'users'
                      AND c.column_name = 'avatar_url'
                    """
                )
            ).one_or_none()
    except Exception as exc:
        logger.warning("Could not read users.avatar_url metadata: %s", exc)
        return

    if row is None:
        return

    data_type, char_max = row[0], row[1]
    if data_type == "text":
        return
    if data_type == "character varying" and (char_max is None or char_max >= 4000):
        return

    logger.info("Widening users.avatar_url to TEXT")
    try:
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE users ALTER COLUMN avatar_url TYPE TEXT"))
    except Exception as exc:
        logger.warning("Avatar URL migration failed: %s", exc)


def apply_user_theme_preference_migration(engine: Engine) -> None:
    """Add users.theme_preference for persisted UI theme selection."""
    try:
        inspector = inspect(engine)
        tables = inspector.get_table_names()
    except Exception as exc:
        logger.warning("Could not inspect database for theme preference migration: %s", exc)
        return

    if "users" not in tables:
        return

    columns = {col["name"] for col in inspector.get_columns("users")}
    if "theme_preference" in columns:
        return

    try:
        with engine.begin() as conn:
            if engine.dialect.name == "postgresql":
                conn.execute(
                    text(
                        "ALTER TABLE users ADD COLUMN IF NOT EXISTS theme_preference VARCHAR(20) NOT NULL DEFAULT 'light'"
                    )
                )
            else:
                conn.execute(text("ALTER TABLE users ADD COLUMN theme_preference VARCHAR(20) DEFAULT 'light'"))
                conn.execute(text("UPDATE users SET theme_preference = 'light' WHERE theme_preference IS NULL"))
    except Exception as exc:
        logger.warning("Theme preference migration failed: %s", exc)


def apply_ticket_overdue_migration(engine: Engine) -> None:
    """Add tickets.is_overdue flag for automatic sprint rollover handling."""
    try:
        inspector = inspect(engine)
        tables = inspector.get_table_names()
    except Exception as exc:
        logger.warning("Could not inspect database for ticket overdue migration: %s", exc)
        return

    if "tickets" not in tables:
        return

    columns = {col["name"] for col in inspector.get_columns("tickets")}
    if "is_overdue" in columns:
        return

    logger.info("Adding tickets.is_overdue column")
    try:
        with engine.begin() as conn:
            if engine.dialect.name == "postgresql":
                conn.execute(
                    text("ALTER TABLE tickets ADD COLUMN IF NOT EXISTS is_overdue BOOLEAN NOT NULL DEFAULT FALSE")
                )
            else:
                conn.execute(text("ALTER TABLE tickets ADD COLUMN is_overdue BOOLEAN DEFAULT 0"))
                conn.execute(text("UPDATE tickets SET is_overdue = 0 WHERE is_overdue IS NULL"))
    except Exception as exc:
        logger.warning("Ticket overdue migration failed: %s", exc)


def apply_ticket_carryover_migration(engine: Engine) -> None:
    """Add carryover metadata columns for sprint rollover traceability."""
    try:
        inspector = inspect(engine)
        tables = inspector.get_table_names()
    except Exception as exc:
        logger.warning("Could not inspect database for ticket carryover migration: %s", exc)
        return

    if "tickets" not in tables:
        return

    columns = {col["name"] for col in inspector.get_columns("tickets")}
    needs_from_sprint = "carried_from_sprint_id" not in columns
    needs_over_at = "carried_over_at" not in columns
    needs_count = "carryover_count" not in columns
    if not (needs_from_sprint or needs_over_at or needs_count):
        return

    logger.info("Adding ticket carryover columns")
    try:
        with engine.begin() as conn:
            if engine.dialect.name == "postgresql":
                if needs_from_sprint:
                    conn.execute(
                        text(
                            "ALTER TABLE tickets ADD COLUMN IF NOT EXISTS carried_from_sprint_id UUID REFERENCES sprints(id) ON DELETE SET NULL"
                        )
                    )
                    conn.execute(
                        text(
                            "CREATE INDEX IF NOT EXISTS ix_tickets_carried_from_sprint_id ON tickets (carried_from_sprint_id)"
                        )
                    )
                if needs_over_at:
                    conn.execute(
                        text("ALTER TABLE tickets ADD COLUMN IF NOT EXISTS carried_over_at TIMESTAMP WITH TIME ZONE")
                    )
                if needs_count:
                    conn.execute(
                        text("ALTER TABLE tickets ADD COLUMN IF NOT EXISTS carryover_count INTEGER NOT NULL DEFAULT 0")
                    )
                    conn.execute(
                        text("UPDATE tickets SET carryover_count = 0 WHERE carryover_count IS NULL")
                    )
            else:
                if needs_from_sprint:
                    conn.execute(text("ALTER TABLE tickets ADD COLUMN carried_from_sprint_id UUID"))
                if needs_over_at:
                    conn.execute(text("ALTER TABLE tickets ADD COLUMN carried_over_at DATETIME"))
                if needs_count:
                    conn.execute(text("ALTER TABLE tickets ADD COLUMN carryover_count INTEGER DEFAULT 0"))
                    conn.execute(text("UPDATE tickets SET carryover_count = 0 WHERE carryover_count IS NULL"))
    except Exception as exc:
        logger.warning("Ticket carryover migration failed: %s", exc)


def apply_ticket_cycles_migration(engine: Engine) -> None:
    """Add ticket cycle versioning tables/columns and backfill cycle v1 for existing tickets."""
    try:
        inspector = inspect(engine)
        tables = set(inspector.get_table_names())
    except Exception as exc:
        logger.warning("Could not inspect database for ticket cycle migration: %s", exc)
        return

    if "tickets" not in tables:
        return

    dialect = engine.dialect.name

    try:
        with engine.begin() as conn:
            if "ticket_cycles" not in tables:
                if dialect == "postgresql":
                    conn.execute(
                        text(
                            """
                            CREATE TABLE IF NOT EXISTS ticket_cycles (
                              id UUID PRIMARY KEY,
                              ticket_id UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
                              version_no INTEGER NOT NULL,
                              sprint_id UUID NULL REFERENCES sprints(id) ON DELETE SET NULL,
                              status ticket_status NOT NULL DEFAULT 'open',
                              reopen_reason TEXT NULL,
                              reopened_by UUID NULL REFERENCES users(id),
                              reopened_at TIMESTAMPTZ NULL,
                              previous_cycle_id UUID NULL REFERENCES ticket_cycles(id) ON DELETE SET NULL,
                              closed_at TIMESTAMPTZ NULL,
                              closed_by UUID NULL REFERENCES users(id),
                              created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                              updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                            )
                            """
                        )
                    )
                    conn.execute(
                        text(
                            "CREATE UNIQUE INDEX IF NOT EXISTS ux_ticket_cycles_ticket_version ON ticket_cycles (ticket_id, version_no)"
                        )
                    )
                    conn.execute(text("CREATE INDEX IF NOT EXISTS ix_ticket_cycles_ticket_id ON ticket_cycles (ticket_id)"))
                else:
                    conn.execute(
                        text(
                            """
                            CREATE TABLE ticket_cycles (
                              id VARCHAR(36) PRIMARY KEY,
                              ticket_id VARCHAR(36) NOT NULL,
                              version_no INTEGER NOT NULL,
                              sprint_id VARCHAR(36) NULL,
                              status VARCHAR(32) NOT NULL DEFAULT 'open',
                              reopen_reason TEXT NULL,
                              reopened_by VARCHAR(36) NULL,
                              reopened_at DATETIME NULL,
                              previous_cycle_id VARCHAR(36) NULL,
                              closed_at DATETIME NULL,
                              closed_by VARCHAR(36) NULL,
                              created_at DATETIME NOT NULL,
                              updated_at DATETIME NOT NULL
                            )
                            """
                        )
                    )
                    conn.execute(text("CREATE UNIQUE INDEX ux_ticket_cycles_ticket_version ON ticket_cycles (ticket_id, version_no)"))
                    conn.execute(text("CREATE INDEX ix_ticket_cycles_ticket_id ON ticket_cycles (ticket_id)"))

            if "ticket_cycle_resolutions" not in tables:
                if dialect == "postgresql":
                    conn.execute(
                        text(
                            """
                            CREATE TABLE IF NOT EXISTS ticket_cycle_resolutions (
                              id UUID PRIMARY KEY,
                              ticket_id UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
                              ticket_cycle_id UUID NOT NULL REFERENCES ticket_cycles(id) ON DELETE CASCADE,
                              resolved_by UUID NOT NULL REFERENCES users(id),
                              summary TEXT NOT NULL,
                              root_cause TEXT NULL,
                              steps_taken TEXT NULL,
                              kb_article_id UUID NULL REFERENCES kb_articles(id),
                              created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                              updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                            )
                            """
                        )
                    )
                    conn.execute(
                        text(
                            "CREATE UNIQUE INDEX IF NOT EXISTS ux_ticket_cycle_resolutions_cycle ON ticket_cycle_resolutions (ticket_cycle_id)"
                        )
                    )
                else:
                    conn.execute(
                        text(
                            """
                            CREATE TABLE ticket_cycle_resolutions (
                              id VARCHAR(36) PRIMARY KEY,
                              ticket_id VARCHAR(36) NOT NULL,
                              ticket_cycle_id VARCHAR(36) NOT NULL,
                              resolved_by VARCHAR(36) NOT NULL,
                              summary TEXT NOT NULL,
                              root_cause TEXT NULL,
                              steps_taken TEXT NULL,
                              kb_article_id VARCHAR(36) NULL,
                              created_at DATETIME NOT NULL,
                              updated_at DATETIME NOT NULL
                            )
                            """
                        )
                    )
                    conn.execute(text("CREATE UNIQUE INDEX ux_ticket_cycle_resolutions_cycle ON ticket_cycle_resolutions (ticket_cycle_id)"))

            ticket_columns = {col["name"] for col in inspector.get_columns("tickets")}
            if "current_cycle_id" not in ticket_columns:
                if dialect == "postgresql":
                    conn.execute(
                        text(
                            "ALTER TABLE tickets ADD COLUMN IF NOT EXISTS current_cycle_id UUID REFERENCES ticket_cycles(id) ON DELETE SET NULL"
                        )
                    )
                    conn.execute(text("CREATE INDEX IF NOT EXISTS ix_tickets_current_cycle_id ON tickets (current_cycle_id)"))
                else:
                    conn.execute(text("ALTER TABLE tickets ADD COLUMN current_cycle_id VARCHAR(36)"))

            comment_columns = {col["name"] for col in inspector.get_columns("ticket_comments")} if "ticket_comments" in tables else set()
            if "ticket_comments" in tables and "ticket_cycle_id" not in comment_columns:
                if dialect == "postgresql":
                    conn.execute(
                        text(
                            "ALTER TABLE ticket_comments ADD COLUMN IF NOT EXISTS ticket_cycle_id UUID REFERENCES ticket_cycles(id) ON DELETE SET NULL"
                        )
                    )
                    conn.execute(text("CREATE INDEX IF NOT EXISTS ix_ticket_comments_ticket_cycle_id ON ticket_comments (ticket_cycle_id)"))
                else:
                    conn.execute(text("ALTER TABLE ticket_comments ADD COLUMN ticket_cycle_id VARCHAR(36)"))

            attachment_columns = {col["name"] for col in inspector.get_columns("ticket_attachments")} if "ticket_attachments" in tables else set()
            if "ticket_attachments" in tables and "ticket_cycle_id" not in attachment_columns:
                if dialect == "postgresql":
                    conn.execute(
                        text(
                            "ALTER TABLE ticket_attachments ADD COLUMN IF NOT EXISTS ticket_cycle_id UUID REFERENCES ticket_cycles(id) ON DELETE SET NULL"
                        )
                    )
                    conn.execute(text("CREATE INDEX IF NOT EXISTS ix_ticket_attachments_ticket_cycle_id ON ticket_attachments (ticket_cycle_id)"))
                else:
                    conn.execute(text("ALTER TABLE ticket_attachments ADD COLUMN ticket_cycle_id VARCHAR(36)"))

            apr_columns = {col["name"] for col in inspector.get_columns("ticket_approval_requests")} if "ticket_approval_requests" in tables else set()
            if "ticket_approval_requests" in tables and "ticket_cycle_id" not in apr_columns:
                if dialect == "postgresql":
                    conn.execute(
                        text(
                            "ALTER TABLE ticket_approval_requests ADD COLUMN IF NOT EXISTS ticket_cycle_id UUID REFERENCES ticket_cycles(id) ON DELETE SET NULL"
                        )
                    )
                    conn.execute(text("CREATE INDEX IF NOT EXISTS ix_ticket_approval_requests_ticket_cycle_id ON ticket_approval_requests (ticket_cycle_id)"))
                else:
                    conn.execute(text("ALTER TABLE ticket_approval_requests ADD COLUMN ticket_cycle_id VARCHAR(36)"))

            ticket_rows = conn.execute(
                text("SELECT id, sprint_id, status, created_at, updated_at, closed_at, closed_by FROM tickets")
            ).mappings().all()

            for row in ticket_rows:
                cycle = conn.execute(
                    text("SELECT id FROM ticket_cycles WHERE ticket_id = :ticket_id AND version_no = 1"),
                    {"ticket_id": row["id"]},
                ).mappings().one_or_none()
                cycle_id = cycle["id"] if cycle else None
                if not cycle_id:
                    cycle_id = str(uuid.uuid4())
                    conn.execute(
                        text(
                            """
                            INSERT INTO ticket_cycles (
                              id, ticket_id, version_no, sprint_id, status,
                              created_at, updated_at, closed_at, closed_by
                            ) VALUES (
                              :id, :ticket_id, 1, :sprint_id, :status,
                              :created_at, :updated_at, :closed_at, :closed_by
                            )
                            """
                        ),
                        {
                            "id": cycle_id,
                            "ticket_id": row["id"],
                            "sprint_id": row["sprint_id"],
                            "status": row["status"],
                            "created_at": row["created_at"],
                            "updated_at": row["updated_at"],
                            "closed_at": row["closed_at"],
                            "closed_by": row["closed_by"],
                        },
                    )

                conn.execute(
                    text("UPDATE tickets SET current_cycle_id = :cid WHERE id = :ticket_id AND current_cycle_id IS NULL"),
                    {"cid": cycle_id, "ticket_id": row["id"]},
                )
                if "ticket_comments" in tables:
                    conn.execute(
                        text(
                            "UPDATE ticket_comments SET ticket_cycle_id = :cid WHERE ticket_id = :ticket_id AND ticket_cycle_id IS NULL"
                        ),
                        {"cid": cycle_id, "ticket_id": row["id"]},
                    )
                if "ticket_attachments" in tables:
                    conn.execute(
                        text(
                            "UPDATE ticket_attachments SET ticket_cycle_id = :cid WHERE ticket_id = :ticket_id AND ticket_cycle_id IS NULL"
                        ),
                        {"cid": cycle_id, "ticket_id": row["id"]},
                    )
                if "ticket_approval_requests" in tables:
                    conn.execute(
                        text(
                            "UPDATE ticket_approval_requests SET ticket_cycle_id = :cid WHERE ticket_id = :ticket_id AND ticket_cycle_id IS NULL"
                        ),
                        {"cid": cycle_id, "ticket_id": row["id"]},
                    )
    except Exception as exc:
        logger.warning("Ticket cycle migration failed: %s", exc)
