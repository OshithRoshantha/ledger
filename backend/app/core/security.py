"""Password hashing, password policy, JWTs, opaque tokens and CSRF helpers."""

import hashlib
import hmac
import re
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from functools import lru_cache
from pathlib import Path
from typing import Any

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError

from app.config import get_settings

ACCESS_COOKIE = "ledger_at"
REFRESH_COOKIE = "ledger_rt"
CSRF_COOKIE = "ledger_csrf"
CSRF_HEADER = "x-csrf-token"

ACCESS_COOKIE_PATH = "/api"
REFRESH_COOKIE_PATH = "/api/v1/auth"

MIN_PASSWORD_LENGTH = 12
MAX_PASSWORD_LENGTH = 256

# ---------------------------------------------------------------- argon2


@lru_cache
def hasher() -> PasswordHasher:
    s = get_settings()
    return PasswordHasher(
        time_cost=s.argon2_time_cost,
        memory_cost=s.argon2_memory_kib,
        parallelism=s.argon2_parallelism,
    )


def hash_secret(value: str) -> str:
    return hasher().hash(value)


def verify_secret(hashed: str, value: str) -> bool:
    try:
        return hasher().verify(hashed, value)
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False


@lru_cache
def _dummy_hash() -> str:
    return hasher().hash(secrets.token_urlsafe(16))


def burn_password_check(value: str) -> None:
    """Spend the same time as a real verification so unknown usernames are not detectable."""
    verify_secret(_dummy_hash(), value)


# ---------------------------------------------------------------- password policy


@lru_cache
def _common_passwords() -> frozenset[str]:
    path = Path(__file__).with_name("common_passwords.txt")
    lines = path.read_text(encoding="utf-8").splitlines()
    return frozenset(line.strip().lower() for line in lines if line.strip() and not line.startswith("#"))


_LEET = str.maketrans({"@": "a", "4": "a", "3": "e", "1": "i", "!": "i", "0": "o", "$": "s", "5": "s", "7": "t"})


def password_problems(password: str, username: str = "") -> list[str]:
    """Return human-readable reasons a password is unacceptable (empty list = OK)."""
    problems: list[str] = []
    if len(password) < MIN_PASSWORD_LENGTH:
        problems.append(f"Password must be at least {MIN_PASSWORD_LENGTH} characters.")
    if len(password) > MAX_PASSWORD_LENGTH:
        problems.append(f"Password must be at most {MAX_PASSWORD_LENGTH} characters.")
    lowered = password.lower()
    common = _common_passwords()
    base = re.sub(r"[\d\W_]+$", "", lowered)
    base = re.sub(r"^[\d\W_]+", "", base)
    if lowered in common or base in common or base.translate(_LEET) in common:
        problems.append("Password is too common.")
    elif len(set(password)) <= 3:
        problems.append("Password is too repetitive.")
    if username and username.lower() in lowered:
        problems.append("Password must not contain the username.")
    return problems


# ---------------------------------------------------------------- tokens


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def sha256(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def new_opaque_token() -> str:
    return secrets.token_urlsafe(32)


def new_id() -> str:
    return uuid.uuid4().hex


def encode_jwt(claims: dict[str, Any], ttl: timedelta) -> str:
    now = now_utc()
    payload = {**claims, "iat": int(now.timestamp()), "exp": int((now + ttl).timestamp()), "iss": "ledger"}
    return jwt.encode(payload, get_settings().jwt_secret, algorithm="HS256")


class TokenError(Exception):
    pass


def decode_jwt(token: str, expected_type: str) -> dict[str, Any]:
    try:
        payload = jwt.decode(
            token,
            get_settings().jwt_secret,
            algorithms=["HS256"],
            issuer="ledger",
            options={"require": ["exp", "iat", "sub", "typ"]},
        )
    except jwt.PyJWTError as exc:
        raise TokenError(str(exc)) from exc
    if payload.get("typ") != expected_type:
        raise TokenError("wrong token type")
    return payload


def access_token(user_id: str, family_id: str) -> str:
    return encode_jwt({"sub": user_id, "sid": family_id, "typ": "access"}, timedelta(minutes=get_settings().access_ttl_minutes))


def preauth_token(user_id: str, jti: str) -> str:
    return encode_jwt({"sub": user_id, "jti": jti, "typ": "preauth"}, timedelta(minutes=get_settings().preauth_ttl_minutes))


# ---------------------------------------------------------------- recovery codes

_RC_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"


def new_recovery_codes(n: int = 10) -> list[str]:
    def one() -> str:
        raw = "".join(secrets.choice(_RC_ALPHABET) for _ in range(10))
        return f"{raw[:5]}-{raw[5:]}"

    return [one() for _ in range(n)]


def normalise_recovery_code(code: str) -> str:
    raw = re.sub(r"[^a-z0-9]", "", code.lower())
    return f"{raw[:5]}-{raw[5:]}" if len(raw) == 10 else raw


def constant_time_equals(a: str, b: str) -> bool:
    return hmac.compare_digest(a.encode(), b.encode())
