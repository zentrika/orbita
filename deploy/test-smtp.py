#!/usr/bin/env python3
"""Prueba interactiva del remitente corporativo con STARTTLS verificado."""

import secrets
import smtplib
import ssl
import sys
from email.message import EmailMessage
from getpass import getpass


def main() -> int:
    if not sys.stdin.isatty():
        print("Ejecuta esta prueba desde una terminal interactiva.", file=sys.stderr)
        return 2
    destination = input("Correo de un buzón de pruebas: ").strip()
    if not destination or "@" not in destination or any(c in destination for c in "\r\n,;"):
        print("Introduce una dirección de prueba válida.", file=sys.stderr)
        return 2
    password = getpass("Contraseña de contacto@zentrika.tech: ")
    if not password:
        return 2
    msg = EmailMessage()
    msg["From"] = "Órbita | ZENTRIKA <notificaciones@zentrika.tech>"
    msg["To"] = destination
    marker = secrets.token_hex(5)
    msg["Subject"] = f"Prueba SMTP de Órbita {marker}"
    msg.set_content("Prueba de entrega del remitente corporativo de ZENTRIKA.")
    stage = "conexión"
    try:
        with smtplib.SMTP("smtp.hostinger.com", 587, timeout=15) as smtp:
            stage = "STARTTLS"
            smtp.starttls(context=ssl.create_default_context())
            stage = "autenticación"
            smtp.login("contacto@zentrika.tech", password)
            stage = "remitente y entrega"
            smtp.send_message(msg, from_addr="notificaciones@zentrika.tech", to_addrs=[destination])
            stage = "cierre"
    except (OSError, smtplib.SMTPException, ValueError) as exc:
        code = getattr(exc, "smtp_code", None)
        if isinstance(exc, smtplib.SMTPRecipientsRefused):
            code = next(iter(exc.recipients.values()))[0]
        print(f"SMTP {stage}: {type(exc).__name__}" + (f" ({code})" if code else ""), file=sys.stderr)
        return 1
    print(f"Hostinger aceptó el alias. Comprueba la recepción del mensaje {marker}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
