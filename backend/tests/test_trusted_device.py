"""'Remember this device': skips the 2FA code on a trusted browser, never the password."""

from datetime import timedelta

from app.models import TrustedDevice, utcnow

from .conftest import PASSWORD, USERNAME, fresh_code

API = "/api/v1"


async def _trust(c, secret) -> str:
    r = await c.post(f"{API}/auth/login", json={"username": USERNAME, "password": PASSWORD})
    r = await c.post(f"{API}/auth/verify-2fa", json={"pre_auth_token": r.json()["pre_auth_token"], "code": await fresh_code(secret),
                                                    "remember_device": True})
    assert r.status_code == 200, r.text
    assert r.json()["device_expires_in"] == 30 * 86400
    await c.post(f"{API}/auth/logout")
    return r.json()["device_token"]


async def _login(c, password=PASSWORD, device=None):
    body = {"username": USERNAME, "password": password}
    if device:
        body["device_token"] = device
    return await c.post(f"{API}/auth/login", json=body)


async def test_trusted_device_skips_2fa(client, user):
    device = await _trust(client, user["secret"])
    r = await _login(client, device=device)
    assert r.status_code == 200 and r.json()["trusted"] is True and "pre_auth_token" not in r.json()
    assert (await client.get(f"{API}/settings")).status_code == 200


async def test_device_token_never_replaces_password(client, user):
    device = await _trust(client, user["secret"])
    assert (await _login(client, password="wrong password!!", device=device)).status_code == 401


async def test_unknown_or_expired_device_falls_back_to_2fa(client, user):
    r = await _login(client, device="x" * 43)
    assert r.status_code == 200 and "pre_auth_token" in r.json()
    device = await _trust(client, user["secret"])
    d = await TrustedDevice.find_one()
    d.expires_at = utcnow() - timedelta(minutes=1)
    await d.save()
    assert "pre_auth_token" in (await _login(client, device=device)).json()


async def test_not_remembered_by_default(client, user):
    r = await client.post(f"{API}/auth/login", json={"username": USERNAME, "password": PASSWORD})
    r = await client.post(f"{API}/auth/verify-2fa", json={"pre_auth_token": r.json()["pre_auth_token"], "code": await fresh_code(user["secret"])})
    assert "device_token" not in r.json()
    assert await TrustedDevice.find_all().count() == 0


async def test_list_forget_and_revoke_on_password_change(client, user, monkeypatch):
    from app.core.rate_limit import limiter

    monkeypatch.setattr(limiter, "enabled", False)  # this test logs in more than 5 times
    device = await _trust(client, user["secret"])
    r = await client.post(f"{API}/auth/login", json={"username": USERNAME, "password": PASSWORD, "device_token": device})
    devices = (await client.get(f"{API}/security/activity")).json()["trusted_devices"]
    assert len(devices) == 1
    assert (await client.delete(f"{API}/security/devices/{devices[0]['id']}")).status_code == 200
    assert "pre_auth_token" in (await _login(client, device=device)).json()

    # trust again, then a password change forgets every device
    await client.post(f"{API}/auth/logout")
    device = await _trust(client, user["secret"])
    await _login(client, device=device)
    r = await client.post(f"{API}/security/change-password",
                          json={"current_password": PASSWORD, "new_password": "a brand new passphrase 9", "code": await fresh_code(user["secret"])})
    assert r.status_code == 200
    assert "pre_auth_token" in (await _login(client, password="a brand new passphrase 9", device=device)).json()
