"""Admin CLI.

    python -m app.cli create-user --username <name>

There is no public registration: this is the only way to create the single account.
"""

import argparse
import asyncio
import getpass
import sys

from app.core import totp
from app.core.security import hash_secret, new_recovery_codes, password_problems
from app.db import close_db, init_db
from app.models import User
from app.seed import seed_user
from app.services.audit import audit


def _prompt_password(username: str) -> str:
    while True:
        pw = getpass.getpass("Password (min 12 characters): ")
        problems = password_problems(pw, username)
        if problems:
            print("  ✗ " + " ".join(problems))
            continue
        if getpass.getpass("Repeat password: ") != pw:
            print("  ✗ Passwords do not match.")
            continue
        return pw


async def create_user(username: str, password: str | None = None) -> int:
    await init_db()
    try:
        if await User.find_one():
            print("A user already exists. Ledger is single-user; refusing to create another.", file=sys.stderr)
            return 1
        username = username.strip().lower()
        if not username or len(username) > 64:
            print("Username must be 1-64 characters.", file=sys.stderr)
            return 1
        password = password or _prompt_password(username)
        problems = password_problems(password, username)
        if problems:
            print(" ".join(problems), file=sys.stderr)
            return 1

        secret = totp.new_secret()
        codes = new_recovery_codes()
        user = User(
            username=username,
            password_hash=hash_secret(password),
            totp_secret_enc=totp.encrypt_secret(secret),
            recovery_code_hashes=[hash_secret(c) for c in codes],
        )
        await user.insert()
        await seed_user(user.id)  # type: ignore[arg-type]
        await audit(None, "user_created", user.id, username=username)

        uri = totp.provisioning_uri(secret, username)
        print("\nScan this QR code with Google Authenticator:\n")
        print(totp.qr_terminal(uri))
        print(f"Or enter this URI manually:\n  {uri}\n")
        print("Recovery codes (each works once; store them offline, they will not be shown again):")
        for c in codes:
            print(f"  {c}")
        print(f"\n✓ User '{username}' created.")
        return 0
    finally:
        close_db()


async def check_db() -> int:
    """Verify the MONGO_URL connection and permissions without printing any secret."""
    from motor.motor_asyncio import AsyncIOMotorClient

    from app.config import get_settings

    s = get_settings()
    client = AsyncIOMotorClient(s.mongo_url, serverSelectionTimeoutMS=8000)
    try:
        info = await client.admin.command("ping")
        build = await client[s.mongo_db].command("buildInfo")
        db = client[s.mongo_db]
        await db["_ledger_check"].insert_one({"ok": 1})
        await db["_ledger_check"].drop()
        host = s.mongo_url.split("@")[-1].split("/")[0]
        print(f"✓ Connected to {host} (MongoDB {build.get('version')}), ping={info.get('ok')}")
        print(f"✓ Read/write OK on database '{s.mongo_db}'")
        return 0
    except Exception as exc:  # noqa: BLE001 - surface any connection/auth problem
        print(f"✗ Database check failed: {type(exc).__name__}: {exc}", file=sys.stderr)
        print("  Check the password (URL-encoded), Atlas Network Access (IP allowlist) and the user's role.", file=sys.stderr)
        return 1
    finally:
        client.close()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m app.cli")
    sub = parser.add_subparsers(dest="command", required=True)
    cu = sub.add_parser("create-user", help="Create the single Ledger user")
    cu.add_argument("--username", required=True)
    sub.add_parser("check-db", help="Test the MONGO_URL connection and read/write access")
    args = parser.parse_args(argv)
    if args.command == "create-user":
        return asyncio.run(create_user(args.username))
    if args.command == "check-db":
        return asyncio.run(check_db())
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
