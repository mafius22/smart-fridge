"""opoznienie alarmow, historia alarmow, wylaczanie plytek

Revision ID: c3f8a91d2b47
Revises: 90a1ec099cb0
Create Date: 2026-11-09 12:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'c3f8a91d2b47'
down_revision = '90a1ec099cb0'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table('alerts', schema=None) as batch_op:
        batch_op.add_column(sa.Column('threshold', sa.Float(), nullable=True))
        batch_op.add_column(sa.Column('notified_at', sa.BigInteger(), nullable=True))
        batch_op.add_column(sa.Column('end_reason', sa.String(length=20), nullable=True))
        batch_op.add_column(sa.Column('summary_at', sa.BigInteger(), nullable=True))
        batch_op.create_index(batch_op.f('ix_alerts_user_id'), ['user_id'], unique=False)
        batch_op.create_index('ix_alerts_fridge_started', ['fridge_id', 'started_at'], unique=False)

    # Dotychczasowe alarmy byly powiadamiane od razu; stare przerwy offline nie wymagaja podsumowania
    op.execute("UPDATE alerts SET notified_at = started_at")
    op.execute("UPDATE alerts SET end_reason = 'normal' WHERE ended_at IS NOT NULL")
    op.execute("UPDATE alerts SET summary_at = ended_at WHERE kind = 'offline' AND ended_at IS NOT NULL")

    op.create_index(
        'uq_alerts_one_active', 'alerts',
        ['fridge_id', 'kind', sa.text('coalesce(user_id, 0)')],
        unique=True,
        sqlite_where=sa.text('ended_at IS NULL'),
        postgresql_where=sa.text('ended_at IS NULL'),
    )

    with op.batch_alter_table('user_fridges', schema=None) as batch_op:
        batch_op.add_column(sa.Column('alert_delay_min', sa.Integer(), nullable=False, server_default='0'))

    with op.batch_alter_table('boards', schema=None) as batch_op:
        batch_op.add_column(sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.true()))

    with op.batch_alter_table('sensors', schema=None) as batch_op:
        batch_op.add_column(sa.Column('last_error_at', sa.BigInteger(), nullable=True))


def downgrade():
    with op.batch_alter_table('sensors', schema=None) as batch_op:
        batch_op.drop_column('last_error_at')

    with op.batch_alter_table('boards', schema=None) as batch_op:
        batch_op.drop_column('is_active')

    with op.batch_alter_table('user_fridges', schema=None) as batch_op:
        batch_op.drop_column('alert_delay_min')

    op.drop_index('uq_alerts_one_active', table_name='alerts')

    with op.batch_alter_table('alerts', schema=None) as batch_op:
        batch_op.drop_index('ix_alerts_fridge_started')
        batch_op.drop_index(batch_op.f('ix_alerts_user_id'))
        batch_op.drop_column('summary_at')
        batch_op.drop_column('end_reason')
        batch_op.drop_column('notified_at')
        batch_op.drop_column('threshold')
