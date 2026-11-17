import click

from app.models.user import ROLE_ADMIN
from app.services.user_service import create_user


@click.command("create-admin")
@click.option("--email", prompt="E-mail admina")
@click.option("--name", "display_name", default=None, help="Nazwa wyswietlana")
def create_admin_command(email, display_name):
    """Tworzy konto administratora."""
    password = click.prompt("Hasło", hide_input=True, confirmation_prompt="Powtórz hasło")
    try:
        user = create_user(
            email,
            password,
            role=ROLE_ADMIN,
            display_name=display_name,
            must_change_password=False,
        )
    except ValueError as e:
        raise click.ClickException(str(e))
    click.echo(f"Utworzono admina: {user.email} (id={user.id})")


def register_cli(app):
    app.cli.add_command(create_admin_command)
