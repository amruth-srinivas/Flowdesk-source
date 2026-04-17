"""add customers.contacts and customers.project_ids

Revision ID: 0002_customer_contacts
Revises: 0001_initial
Create Date: 2026-04-17
"""

from alembic import op

revision = "0002_customer_contacts"
down_revision = "0001_initial"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # IF NOT EXISTS keeps this safe if columns were added by apply_customer_migrations at startup.
    op.execute(
        """
        ALTER TABLE customers ADD COLUMN IF NOT EXISTS contacts JSON NOT NULL DEFAULT '[]'::json;
        ALTER TABLE customers ADD COLUMN IF NOT EXISTS project_ids UUID[] NOT NULL DEFAULT '{}'::uuid[];
        """
    )


def downgrade() -> None:
    op.execute("ALTER TABLE customers DROP COLUMN IF EXISTS project_ids;")
    op.execute("ALTER TABLE customers DROP COLUMN IF EXISTS contacts;")
