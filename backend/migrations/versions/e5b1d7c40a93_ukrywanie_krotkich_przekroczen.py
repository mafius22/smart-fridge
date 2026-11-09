"""ukrywanie krotkich przekroczen w historii alarmow

Revision ID: e5b1d7c40a93
Revises: c3f8a91d2b47
Create Date: 2026-11-09 20:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'e5b1d7c40a93'
down_revision = 'c3f8a91d2b47'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table('users', schema=None) as batch_op:
        batch_op.add_column(sa.Column('show_short_alerts', sa.Boolean(), server_default=sa.false(), nullable=False))


def downgrade():
    with op.batch_alter_table('users', schema=None) as batch_op:
        batch_op.drop_column('show_short_alerts')
