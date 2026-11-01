from datetime import timedelta

import pyotp
import pytest

from app.core import totp
from app.core.security import ACCESS_COOKIE, CSRF_COOKIE, REFRESH_COOKIE, password_problems
from app.models import AuditLog, RefreshToken, User, utcnow

from .conftest import PASSWORD, USERNAME, fresh_code, login


async def test_data_requires_session(client, user):
    for path in ("/api/v1/analytics/overview", "/api/v1/expenses", "/api/v1/settings", "/api/v1/export/json"):
        r = await client.get(path)
        assert r.status_code == 401, path


async def test_password_alone_gives_no_session(client, user):
    r = await client.post("/api/v1/auth/login", json={"username": USERNAME, "password": PASSWORD})
    assert r.status_code == 200
    body = r.json()
    assert set(body) == {"pre_auth_token", "expires_in"}
    assert ACCESS_COOKIE not in client.cookies and REFRESH_COOKIE not in client.cookies
    # the pre-auth token is not an access token
    client.cookies.set(ACCESS_COOKIE, body["pre_auth_token"], domain="test.local", path="/api")
    assert (await client.get("/api/v1/settings")).status_code == 401


async def test_generic_error_for_bad_username_and_password(client, user):
    a = await client.post("/api/v1/auth/login", json={"username": "nobody", "password": PASSWORD})
    b = await client.post("/api/v1/auth/login", json={"username": USERNAME, "password": "wrong password!!"})
    assert a.status_code == b.status_code == 401
    assert a.json() == b.json()


async def test_full_login_and_logout(client, user):
    await login(client, user["secret"])
    assert (await client.get("/api/v1/settings")).status_code == 200
    events = {e.event for e in await AuditLog.find_all().to_list()}
    assert {"login_password_ok", "login_success"} <= events
    r = await client.post("/api/v1/auth/logout")
    assert r.status_code == 200
    assert (await client.get("/api/v1/settings")).status_code == 401


async def test_totp_code_cannot_be_reused(client, user):
    r = await client.post("/api/v1/auth/login", json={"username": USERNAME, "password": PASSWORD})
    code = await fresh_code(user["secret"])
    ok = await client.post("/api/v1/auth/verify-2fa", json={"pre_auth_token": r.json()["pre_auth_token"], "code": code})
    assert ok.status_code == 200
    r = await client.post("/api/v1/auth/login", json={"username": USERNAME, "password": PASSWORD})
    replay = await client.post("/api/v1/auth/verify-2fa", json={"pre_auth_token": r.json()["pre_auth_token"], "code": code})
    assert replay.status_code == 400


def test_totp_window_and_replay_unit():
    secret = pyotp.random_base32()
    now = 1_800_000_000.0
    step = int(now // 30)
    t = pyotp.TOTP(secret)
    assert totp.verify_code(secret, t.at(now), 0, now) == step
    assert totp.verify_code(secret, t.at(now - 30), 0, now) == step - 1  # previous step OK
    assert totp.verify_code(secret, t.at(now + 30), 0, now) == step + 1  # next step OK
    assert totp.verify_code(secret, t.at(now - 60), 0, now) is None  # outside Â±1
    assert totp.verify_code(secret, t.at(now), step, now) is None  # replay of the same step


async def test_five_wrong_codes_lock_preauth_token(client, user):
    r = await client.post("/api/v1/auth/login", json={"username": USERNAME, "password": PASSWORD})
    token = r.json()["pre_auth_token"]
    for i in range(4):
        bad = await client.post("/api/v1/auth/verify-2fa", json={"pre_auth_token": token, "code": "000000"})
        assert bad.status_code == 400
        assert bad.json()["detail"]["remaining"] == 4 - i
    fifth = await client.post("/api/v1/auth/verify-2fa", json={"pre_auth_token": token, "code": "000000"})
    assert fifth.status_code == 401
    good = await client.post("/api/v1/auth/verify-2fa", json={"pre_auth_token": token, "code": await fresh_code(user["secret"])})
    assert good.status_code == 401  # locked even with a correct code


async def test_login_rate_limit_per_ip(client, user):
    for _ in range(5):
        await client.post("/api/v1/auth/login", json={"username": USERNAME, "password": "wrong password!!"})
    r = await client.post("/api/v1/auth/login", json={"username": USERNAME, "password": PASSWORD})
    assert r.status_code == 429


async def test_account_lockout_after_ten_failures(client, user, monkeypatch):
    from app.core.rate_limit import limiter

    monkeypatch.setattr(limiter, "enabled", False)
    for _ in range(10):
        r = await client.post("/api/v1/auth/login", json={"username": USERNAME, "password": "wrong password!!"})
        assert r.status_code == 401
    u = await User.find_one(User.username == USERNAME)
    assert u.locked_until is not None
    r = await client.post("/api/v1/auth/login", json={"username": USERNAME, "password": PASSWORD})
    assert r.status_code == 401  # correct password refused while locked
    u.locked_until = utcnow() - timedelta(seconds=1)
    await u.save()
    r = await client.post("/api/v1/auth/login", json={"username": USERNAME, "password": PASSWORD})
    assert r.status_code == 200


async def test_recovery_code_works_once(client, user):
    code = user["codes"][0]
    for expected in (200, 400):
        r = await client.post("/api/v1/auth/login", json={"username": USERNAME, "password": PASSWORD})
        v = await client.post("/api/v1/auth/verify-2fa", json={"pre_auth_token": r.json()["pre_auth_token"], "code": code.upper()})
        assert v.status_code == expected
    assert len((await User.find_one()).recovery_code_hashes) == 9


async def test_csrf_required_on_writes(client, user):
    del client.headers["x-csrf-token"]
    r = await client.post("/api/v1/auth/login", json={"username": USERNAME, "password": PASSWORD})
    assert r.status_code == 403
    client.headers["x-csrf-token"] = "forged"
    r = await client.post("/api/v1/auth/login", json={"username": USERNAME, "password": PASSWORD})
    assert r.status_code == 403


async def test_session_cookies_flags(client, user):
    r = await login(client, user["secret"])
    cookies = r.headers.get_list("set-cookie")
    for name in (ACCESS_COOKIE, REFRESH_COOKIE):
        header = next(c for c in cookies if c.startswith(name + "="))
        lower = header.lower()
        assert "httponly" in lower and "secure" in lower and "samesite=strict" in lower


async def test_refresh_rotates_and_detects_reuse(client, user):
    await login(client, user["secret"])
    old = client.cookies.get(REFRESH_COOKIE)
    r = await client.post("/api/v1/auth/refresh")
    assert r.status_code == 200
    new = client.cookies.get(REFRESH_COOKIE)
    assert new and new != old
    # replay the rotated-out token -> whole family revoked
    csrf = client.cookies.get(CSRF_COOKIE)
    client.cookies.clear()
    client.cookies.set(CSRF_COOKIE, csrf, domain="test.local", path="/")
    client.cookies.set(REFRESH_COOKIE, old, domain="test.local", path="/api/v1/auth")
    assert (await client.post("/api/v1/auth/refresh")).status_code == 401
    assert await RefreshToken.find({"revoked": False}).count() == 0
    assert (await client.get("/api/v1/settings")).status_code == 401


async def test_logout_all_revokes_every_session(user):
    from httpx import ASGITransport, AsyncClient

    from app.main import create_app

    app = create_app(init_database=False)
    clients = []
    for _ in range(2):
        c = AsyncClient(transport=ASGITransport(app=app), base_url="https://test")
        c.headers["x-csrf-token"] = (await c.get("/api/v1/auth/csrf")).json()["csrf"]
        await login(c, user["secret"])
        clients.append(c)
    assert (await clients[1].post("/api/v1/auth/logout-all")).status_code == 200
    assert (await clients[0].get("/api/v1/settings")).status_code == 401
    for c in clients:
        await c.aclose()


async def test_lock_and_unlock(authed, user):
    assert (await authed.post("/api/v1/auth/lock")).status_code == 200
    assert (await authed.get("/api/v1/settings")).status_code in (401, 423)
    assert (await authed.post("/api/v1/auth/refresh")).status_code == 423
    bad = await authed.post("/api/v1/auth/unlock", json={"code": "000000"})
    assert bad.status_code == 400
    ok = await authed.post("/api/v1/auth/unlock", json={"code": await fresh_code(user["secret"])})
    assert ok.status_code == 200
    assert (await authed.get("/api/v1/settings")).status_code == 200


async def test_idle_session_auto_locks(authed):
    token = await RefreshToken.find_one({"revoked": False})
    token.last_seen_at = utcnow() - timedelta(minutes=11)
    await token.save()
    assert (await authed.get("/api/v1/settings")).status_code == 423


async def test_change_password_requires_password_and_code(authed, user):
    new_pw = "a much better passphrase 42"
    r = await authed.post(
        "/api/v1/security/change-password", json={"current_password": "nope nope nope", "new_password": new_pw, "code": "000000"}
    )
    assert r.status_code == 400
    r = await authed.post(
        "/api/v1/security/change-password",
        json={"current_password": PASSWORD, "new_password": "password1234", "code": await fresh_code(user["secret"])},
    )
    assert r.status_code == 422
    r = await authed.post(
        "/api/v1/security/change-password",
        json={"current_password": PASSWORD, "new_password": new_pw, "code": await fresh_code(user["secret"])},
    )
    assert r.status_code == 200
    await authed.post("/api/v1/auth/logout")
    bad = await authed.post("/api/v1/auth/login", json={"username": USERNAME, "password": PASSWORD})
    assert bad.status_code == 401
    await login(authed, user["secret"], password=new_pw)


async def test_reset_2fa_flow(authed, user):
    r = await authed.post("/api/v1/security/reset-2fa", json={"password": PASSWORD, "code": await fresh_code(user["secret"])})
    assert r.status_code == 200
    assert r.json()["qr_svg"].lstrip().startswith("<?xml") or "<svg" in r.json()["qr_svg"]
    new_secret = pyotp.parse_uri(r.json()["otpauth_uri"]).secret
    assert (await authed.post("/api/v1/security/reset-2fa/confirm", json={"code": "000000"})).status_code == 400
    ok = await authed.post("/api/v1/security/reset-2fa/confirm", json={"code": pyotp.TOTP(new_secret).now()})
    assert ok.status_code == 200
    u = await User.find_one()
    assert totp.decrypt_secret(u.totp_secret_enc) == new_secret


async def test_totp_secret_never_exposed(authed):
    for path in ("/api/v1/auth/me", "/api/v1/settings", "/api/v1/security/activity", "/api/v1/export/json"):
        body = (await authed.get(path)).text
        assert "totp_secret" not in body, path
        assert "password_hash" not in body and "recovery_code" not in body.replace("recovery_codes_left", ""), path


async def test_regenerate_recovery_codes(authed, user):
    r = await authed.post("/api/v1/security/recovery-codes", json={"password": PASSWORD, "code": await fresh_code(user["secret"])})
    assert r.status_code == 200
    assert len(r.json()["recovery_codes"]) == 10
    activity = (await authed.get("/api/v1/security/activity")).json()
    assert any(e["event"] == "recovery_codes_regenerated" for e in activity["events"])
    assert any(s["current"] for s in activity["sessions"])


@pytest.mark.parametrize(
    "pw, ok",
    [
        ("short", False),
        ("password1234", False),
        ("P@ssw0rd2024!", False),
        ("aaaaaaaaaaaaaaa", False),
        ("oshith-is-great-123", False),  # contains username
        ("correct horse battery staple", True),
        ("tea-kettle-orbit-mango-77", True),
    ],
)
def test_password_policy(pw, ok):
    assert (password_problems(pw, USERNAME) == []) is ok


async def test_cli_refuses_second_user(user, capsys, monkeypatch):
    import app.cli as cli

    async def _noop(*a, **k):
        return None

    monkeypatch.setattr(cli, "init_db", _noop)
    monkeypatch.setattr(cli, "close_db", lambda: None)
    assert await cli.create_user("someone", "another fine passphrase") == 1
    assert "refusing" in capsys.readouterr().err


async def test_cli_creates_user_with_seed(db, capsys, monkeypatch):
    import app.cli as cli
    from app.models import FixedExpense

    async def _noop(*a, **k):
        return None

    monkeypatch.setattr(cli, "init_db", _noop)
    monkeypatch.setattr(cli, "close_db", lambda: None)
    assert await cli.create_user("Oshith", "another fine passphrase") == 0
    out = capsys.readouterr().out
    assert "otpauth://totp/" in out
    assert out.count("-") >= 10
    u = await User.find_one()
    assert u.username == "oshith" and len(u.recovery_code_hashes) == 10
    assert sum(f.amount for f in await FixedExpense.find_all().to_list()) == 43_900_00
