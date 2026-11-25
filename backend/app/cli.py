"""Comandos de administración.

    python -m app.cli create-admin --email admin@empresa.com --name "Ana Admin" [--org "Mi empresa"]
    python -m app.cli seed-demo
"""

import argparse
import getpass
import sys

from sqlalchemy import select

from app.core.config import settings
from app.core.db import SessionLocal, utcnow
from app.core.security import hash_password, password_is_strong
from app.models import Membership, Organization, User
from app.services.orgs import create_organization, pick_avatar_color


def create_admin(email: str, name: str, password: str | None, org: str | None) -> None:
    email = email.lower().strip()
    if not password:
        password = getpass.getpass("Contraseña: ")
        if password != getpass.getpass("Repite la contraseña: "):
            sys.exit("Las contraseñas no coinciden")
    if not password_is_strong(password):
        sys.exit("La contraseña debe tener al menos 8 caracteres, letras y números")
    with SessionLocal() as db:
        user = db.scalar(select(User).where(User.email == email))
        if user:
            user.is_platform_admin = True
            user.is_active = True
            print(f"Usuario existente {email} promovido a administrador de plataforma")
        else:
            user = User(email=email, full_name=name, password_hash=hash_password(password), is_platform_admin=True,
                        email_verified_at=utcnow(), avatar_color=pick_avatar_color(email))
            db.add(user)
            db.flush()
            print(f"Administrador de plataforma creado: {email}")
        if org:
            existing = db.scalar(select(Organization).join(Membership, Membership.organization_id == Organization.id)
                                 .where(Organization.name == org, Membership.user_id == user.id))
            if not existing:
                o = create_organization(db, user, org)
                print(f"Organización creada: {o.name} (propietario {email})")
        db.commit()


def main() -> None:
    parser = argparse.ArgumentParser(prog="python -m app.cli")
    sub = parser.add_subparsers(dest="cmd", required=True)
    a = sub.add_parser("create-admin", help="Crea o promueve un administrador de plataforma")
    a.add_argument("--email", required=True)
    a.add_argument("--name", default="Administrador")
    a.add_argument("--password", help="Si se omite se pide de forma interactiva")
    a.add_argument("--org", help="Crea también una organización de la que será propietario")
    sub.add_parser("seed-demo", help="Carga datos de demostración idempotentes (sólo desarrollo)")
    args = parser.parse_args()

    if args.cmd == "create-admin":
        create_admin(args.email, args.name, args.password, args.org)
    elif args.cmd == "seed-demo":
        if settings.is_production:
            sys.exit("seed-demo está deshabilitado en producción")
        from app.seed import seed_demo

        seed_demo()


if __name__ == "__main__":
    main()
