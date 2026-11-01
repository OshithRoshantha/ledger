import os

from cryptography.fernet import Fernet

os.environ.update(
    ENV="test",
    JWT_SECRET="test-secret-" + "x" * 40,
    TOTP_ENC_KEY=Fernet.generate_key().decode(),
    ARGON2_TIME_COST="1",
    ARGON2_MEMORY_KIB="8192",
    ARGON2_PARALLELISM="1",
    COOKIE_SECURE="true",
)

import time  # noqa: E402
from datetime import date  # noqa: E402

import pyotp  # noqa: E402
import pytest  # noqa: E402
from httpx import ASGITransport, AsyncClient  # noqa: E402
from mongomock_motor import AsyncMongoMockClient  # noqa: E402

from app.core import totp  # noqa: E402
from app.core.rate_limit import limiter  # noqa: E402
from app.core.security import hash_secret, new_recovery_codes  # noqa: E402
from app.db import init_db  # noqa: E402
from app.main import create_app  # noqa: E402
from app.models import AppSettings, User  # noqa: E402
from app.seed import seed_user  # noqa: E402
from app.services import cache  # noqa: E402

USERNAME = "oshith"
PASSWORD = "correct horse battery staple"


@pytest.fixture
async def db():
    client = AsyncMongoMockClient(tz_aware=True)
    await init_db(client[f"ledger_test_{time.time_ns()}"])
    cache.clear()
    limiter.reset()
    yield


@pytest.fixture
async def user(db):
    secret = totp.new_secret()
    codes = new_recovery_codes()
    u = User(
        username=USERNAME,
        password_hash=hash_secret(PASSWORD),
        totp_secret_enc=totp.encrypt_secret(secret),
        recovery_code_hashes=[hash_secret(c) for c in codes],
    )
    await u.insert()
    await seed_user(u.id)
    return {"user": u, "secret": secret, "codes": codes}


async def fresh_code(secret: str) -> str:
    """A valid TOTP code whose step has not been used yet (avoids replay rejection in tests)."""
    u = await User.find_one(User.username == USERNAME)
    current = int(time.time() // 30)
    for step in (current - 1, current, current + 1):
        if step > u.last_totp_step:
            return pyotp.TOTP(secret).at(step * 30)
    raise RuntimeError("no fresh step available")


@pytest.fixture
async def client(db):
    app = create_app(init_database=False)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="https://test") as c:
        r = await c.get("/api/v1/auth/csrf")
        c.headers["x-csrf-token"] = r.json()["csrf"]
        yield c


async def login(c: AsyncClient, secret: str, password: str = PASSWORD):
    r = await c.post("/api/v1/auth/login", json={"username": USERNAME, "password": password})
    assert r.status_code == 200, r.text
    r = await c.post(
        "/api/v1/auth/verify-2fa", json={"pre_auth_token": r.json()["pre_auth_token"], "code": await fresh_code(secret)}
    )
    assert r.status_code == 200, r.text
    return r


@pytest.fixture
async def authed(client, user):
    await login(client, user["secret"])
    return client


@pytest.fixture
def freeze_today(monkeypatch):
    """Pin 'today'. Default: 12 Nov 2026 = day 8 of the Nov 2026 cycle (salary day 5: 5 Nov - 4 Dec)."""

    def _freeze(d: date = date(2026, 11, 12)):
        import app.services.clock as clock

        monkeypatch.setattr(clock, "today", lambda tz: d)
        cache.clear()
        return d

    return _freeze


async def onboard(c: AsyncClient, salary_cents: int = 15_000_000, last_salary_date: str = "2026-11-05", salary_day: int | None = None) -> dict:
    body = {"salary": salary_cents, "last_salary_date": last_salary_date}
    if salary_day:
        body["salary_day"] = salary_day
    r = await c.post("/api/v1/settings/onboarding", json=body)
    assert r.status_code == 200, r.text
    return r.json()


async def settings_doc() -> AppSettings:
    return await AppSettings.find_one()
