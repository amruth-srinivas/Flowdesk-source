"""initial schema

Revision ID: 0001_initial
Revises:
Create Date: 2026-04-16
"""

from alembic import op

# revision identifiers, used by Alembic.
revision = "0001_initial"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Startup bootstrap runs Base.metadata.create_all.
    # Keep this revision as baseline; use autogenerate for next revisions.
    pass


def downgrade() -> None:
    pass
