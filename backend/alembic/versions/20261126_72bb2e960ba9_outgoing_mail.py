"""Añade una bandeja transaccional para el correo saliente."""

import sqlalchemy as sa
from alembic import op

revision = "72bb2e960ba9"
down_revision = "1967dca59034"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "outgoing_mail",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("payload", sa.LargeBinary()),
        sa.Column("attempts", sa.Integer(), nullable=False),
        sa.Column("next_attempt_at", sa.DateTime(), nullable=False),
        sa.Column("expires_at", sa.DateTime()),
        sa.Column("failed_at", sa.DateTime()),
    )
    op.create_index("ix_outgoing_mail_expires_at", "outgoing_mail", ["expires_at"])
    op.create_index("ix_outgoing_mail_next_attempt_at", "outgoing_mail", ["next_attempt_at"])


def downgrade():
    op.drop_table("outgoing_mail")
