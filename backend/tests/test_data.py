import csv
import io
import json

from app.models import AuditLog, ExpenseEntry

from .conftest import onboard

API = "/api/v1"


async def _setup(c, freeze_today):
    freeze_today()
    await onboard(c)
    cats = {x["name"]: x["id"] for x in (await c.get(f"{API}/categories")).json()}
    reasons = {x["name"]: x["id"] for x in (await c.get(f"{API}/reasons")).json()}
    await c.post(f"{API}/expenses", json={"category_id": cats["Uber / PickMe"], "amount": 45_050, "date": "2026-10-26", "note": "=HYPERLINK()"})
    await c.post(
        f"{API}/expenses",
        json={"category_id": cats["Bank & Cash Spending"], "amount": 100_000, "date": "2026-10-27", "method": "atm", "reason_id": reasons["Fuel"]},
    )
    bills = {x["name"]: x["id"] for x in (await c.get(f"{API}/settings/fixed-expenses")).json()}
    await c.post(f"{API}/fixed-expenses/{bills['Water Bill']}/pay", json={})
    await c.get(f"{API}/income")  # opening the cycle creates the pending salary


async def test_export_csv(authed, freeze_today):
    await _setup(authed, freeze_today)
    r = await authed.get(f"{API}/export/csv")
    assert r.status_code == 200 and "attachment" in r.headers["content-disposition"]
    rows = list(csv.DictReader(io.StringIO(r.text.lstrip("﻿"))))
    by_name = {row["name"]: row for row in rows}
    assert by_name["Uber / PickMe"]["amount_lkr"] == "-450.50"
    assert by_name["Uber / PickMe"]["note"] == "'=HYPERLINK()"  # formula injection neutralised
    assert by_name["Bank & Cash Spending"]["method"] == "atm" and by_name["Bank & Cash Spending"]["reason"] == "Fuel"
    assert by_name["Water Bill"]["type"] == "fixed_bill"
    assert any(row["type"] == "income" and row["status"] == "received" for row in rows)


async def test_json_backup_roundtrip(authed, freeze_today):
    await _setup(authed, freeze_today)
    r = await authed.get(f"{API}/export/json")
    backup = r.json()
    assert backup["format"] == "ledger-backup" and backup["amounts_in"] == "cents"
    assert len(backup["expense_entries"]) == 2
    assert "users" not in backup and "refresh_tokens" not in backup
    assert all("user_id" not in e for e in backup["expense_entries"])

    before = (await authed.get(f"{API}/analytics/overview")).json()["hero"]
    # wipe one entry, then restore the backup
    eid = backup["expense_entries"][0]["id"]
    await authed.delete(f"{API}/expenses/{eid}")
    await authed.post(f"{API}/expenses", json={"category_id": backup["variable_categories"][0]["id"], "amount": 999, "date": "2026-10-28"})
    r = await authed.post(f"{API}/import/json", content=json.dumps(backup), headers={"content-type": "application/json"})
    assert r.status_code == 200, r.text
    assert r.json()["imported"]["expense_entries"] == 2
    assert await ExpenseEntry.find_all().count() == 2
    after = (await authed.get(f"{API}/analytics/overview")).json()["hero"]
    assert after == before
    assert await AuditLog.find({"event": "data_imported"}).count() == 1


async def test_import_rejects_garbage(authed):
    r = await authed.post(f"{API}/import/json", json={"format": "something-else"})
    assert r.status_code == 422
    bad = {"format": "ledger-backup", "version": 1, "expense_entries": [{"amount": "lots"}]}
    r = await authed.post(f"{API}/import/json", json=bad)
    assert r.status_code == 422


async def test_openapi_disabled_in_production(monkeypatch):
    from httpx import ASGITransport, AsyncClient

    from app.config import get_settings
    from app.main import create_app

    monkeypatch.setattr(get_settings(), "env", "production")
    app = create_app(init_database=False)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="https://test") as c:
        assert (await c.get("/api/v1/docs")).status_code == 404
        assert (await c.get("/api/v1/openapi.json")).status_code == 404
