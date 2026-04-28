"""chat_conversation_member_prefs for per-user pin/mute

Revision ID: 0003_chat_member_prefs
Revises: 0002_customer_contacts
Create Date: 2026-04-28
"""

from alembic import op

revision = "0003_chat_member_prefs"
down_revision = "0002_customer_contacts"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS chat_conversation_member_prefs (
            conversation_id UUID NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
            user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            is_pinned BOOLEAN NOT NULL DEFAULT false,
            is_muted BOOLEAN NOT NULL DEFAULT false,
            PRIMARY KEY (conversation_id, user_id)
        );
        CREATE INDEX IF NOT EXISTS ix_chat_convo_member_prefs_user
            ON chat_conversation_member_prefs (user_id);
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS chat_conversation_member_prefs;")
