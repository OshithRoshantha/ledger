"""Token mode: cross-site hosting (github.io app + onrender.com API) where browsers drop the API's cookies."""

import pytest
from httpx import ASGITransport, AsyncClient

from app.config import get_settings
from app.main import create_app
from app.models import RefreshToken

from .conftest import PASSWORD, USERNAME, fresh_code

API = "/api/v1"


@pytest.fixture
async def tclient(db, monkeypatch):
    monkeypatch.setattr(get_settings(), "token_auth", True)
    monkeypatch.setattr(get_settings(), "frontend_origin", "https://oshithroshantha.github.io")
    app = create_app(init_database=False)
    # A client that never keeps cookies, like Safari blocking third-party cookies.
    async with AsyncClient(transport=ASGITransport(app=app), base_url="https://test") as c:

        async def drop_cookies(response):
            await response.aread()
            c.cookies.clear()

        c.event_hooks["response"] = [drop_cookies]
        yield c


async def _login(c, secret):
    r = await c.post(f"{API}/auth/login", json={"username": USERNAME, "password": PASSWORD})
    assert r.status_code == 200, r.text
    r = await c.post(f"{API}/auth/verify-2fa", json={"pre_auth_token": r.json()["pre_auth_token"], "code": await fresh_code(secret)})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["access_token"] and body["refresh_token"]
    return body


async def test_full_flow_without_cookies(tclient, user):
    c = tclient
    tokens = await _login(c, user["secret"])
    auth = {"Authorization": f"Bearer {tokens['access_token']}"}
    assert (await c.get(f"{API}/settings")).status_code == 401  # no cookie, no header
    assert (await c.get(f"{API}/settings", headers=auth)).status_code == 200
    # writes work without CSRF cookie when authenticated by bearer token
    r = await c.patch(f"{API}/settings", json={"theme": "light"}, headers=auth)
    assert r.status_code == 200

    # refresh rotates via X-Refresh-Token
    r = await c.post(f"{API}/auth/refresh", headers={"X-Refresh-Token": tokens["refresh_token"]})
    assert r.status_code == 200
    new = r.json()
    assert new["refresh_token"] != tokens["refresh_token"]
    # replaying the old refresh token revokes the family
    assert (await c.post(f"{API}/auth/refresh", headers={"X-Refresh-Token": tokens["refresh_token"]})).status_code == 401
    assert (await c.get(f"{API}/settings", headers={"Authorization": f"Bearer {new['access_token']}"})).status_code == 401


async def test_lock_unlock_and_logout_with_tokens(tclient, user):
    c = tclient
    t = await _login(c, user["secret"])
    rt = {"X-Refresh-Token": t["refresh_token"]}
    assert (await c.post(f"{API}/auth/lock", headers=rt)).status_code == 200
    assert (await c.get(f"{API}/settings", headers={"Authorization": f"Bearer {t['access_token']}"})).status_code == 423
    r = await c.post(f"{API}/auth/unlock", json={"code": await fresh_code(user["secret"])}, headers=rt)
    assert r.status_code == 200 and r.json()["access_token"]
    t2 = r.json()
    assert (await c.post(f"{API}/auth/logout", headers={"X-Refresh-Token": t2["refresh_token"]})).status_code == 200
    assert await RefreshToken.find({"revoked": False}).count() == 0


async def test_bearer_ignored_when_token_mode_off(client, user):
    from app.core.security import access_token

    r = await client.get(f"{API}/settings", headers={"Authorization": f"Bearer {access_token(str(user['user'].id), 'x')}"})
    assert r.status_code == 401


async def test_cookie_requests_still_need_csrf_in_token_mode(tclient, user):
    # a forged cross-site request that does carry a session cookie is still CSRF-checked
    r = await tclient.post(f"{API}/auth/logout", headers={"Cookie": "ledger_rt=abc"})
    assert r.status_code == 403
