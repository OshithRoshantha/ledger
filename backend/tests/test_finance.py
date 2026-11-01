from datetime import date

import pytest

from app.models import ExpenseEntry, FixedExpense, FixedPayment, IncomeEntry

from .conftest import onboard

API = "/api/v1"


async def _ids(c):
    cats = {x["name"]: x["id"] for x in (await c.get(f"{API}/categories")).json()}
    reasons = {x["name"]: x["id"] for x in (await c.get(f"{API}/reasons")).json()}
    sources = {x["name"]: x["id"] for x in (await c.get(f"{API}/income-sources")).json()}
    bills = {x["name"]: x["id"] for x in (await c.get(f"{API}/settings/fixed-expenses")).json()}
    return cats, reasons, sources, bills


async def _hero(c, cycle=None):
    r = await c.get(f"{API}/analytics/overview" + (f"?cycle={cycle}" if cycle else ""))
    assert r.status_code == 200, r.text
    return r.json()["hero"]


async def test_seed_totals(authed):
    bills = (await authed.get(f"{API}/fixed-expenses")).json()
    assert bills["total_count"] == 7
    assert bills["total_amount"] == 4_390_000
    assert bills["groups"] == ["Foods & Households", "Utility Bills", "Subscriptions"]
    cats = (await authed.get(f"{API}/categories")).json()
    assert [c["name"] for c in cats] == ["Mobile Top-ups", "LMT Top-ups", "Uber / PickMe", "Bank & Cash Spending"]
    assert [c["requires_reason"] for c in cats] == [False, False, False, True]
    reasons = (await authed.get(f"{API}/reasons")).json()
    assert len(reasons) == 10 and {r["need_want"] for r in reasons} == {"need", "want"}


async def test_default_salary_day_is_5(authed, freeze_today):
    freeze_today(date(2026, 11, 12))
    s = (await authed.get(f"{API}/settings")).json()
    assert s["salary_day"] == 5 and s["current_cycle"] == "2026-11"
    assert (s["current_cycle_start"], s["current_cycle_end"]) == ("2026-11-05", "2026-12-04")


async def test_pending_salary_auto_created_next_cycle(authed, freeze_today):
    freeze_today(date(2026, 11, 12))
    await onboard(authed, 15_000_000)
    freeze_today(date(2026, 12, 6))
    inc = (await authed.get(f"{API}/income")).json()
    assert inc["cycle"] == "2026-12"
    assert len(inc["items"]) == 1 and inc["items"][0]["status"] == "pending" and inc["items"][0]["day"] == "2026-12-05"
    assert (await _hero(authed))["income"] == 0  # pending salary is not income yet
    entry_id = inc["items"][0]["id"]
    r = await authed.patch(f"{API}/income/{entry_id}", json={"status": "received", "amount": 15_250_000, "date": "2026-12-05"})
    assert r.status_code == 200 and r.json()["cycle"] == "2026-12"
    assert (await _hero(authed))["income"] == 15_250_000
    await authed.delete(f"{API}/income/{entry_id}")
    assert (await authed.get(f"{API}/income")).json()["items"] == []  # deleting sticks


async def test_mark_paid_reduces_balance_and_committed_then_unpay_restores(authed, freeze_today):
    freeze_today()
    await onboard(authed, 10_000_000)
    _, _, _, bills = await _ids(authed)
    before = await _hero(authed)
    assert before["committed"] == 4_390_000 and before["balance"] == 10_000_000
    assert before["safe_to_spend"] == 10_000_000 - 4_390_000

    r = await authed.post(f"{API}/fixed-expenses/{bills['Electricity Bill']}/pay", json={"amount": 235_000, "date": "2026-11-10"})
    assert r.status_code == 201
    payment_id = r.json()["id"]
    after = await _hero(authed)
    assert after["balance"] == before["balance"] - 235_000
    assert after["committed"] == before["committed"] - 200_000
    assert after["safe_to_spend"] == before["safe_to_spend"] - 35_000
    assert (await authed.post(f"{API}/fixed-expenses/{bills['Electricity Bill']}/pay", json={"date": "2026-11-11"})).status_code == 409

    assert (await authed.delete(f"{API}/fixed-payments/{payment_id}")).status_code == 200
    assert await _hero(authed) == before
    assert (await authed.post(f"{API}/fixed-payments/{payment_id}/restore")).status_code == 200
    assert await _hero(authed) == after
    assert await FixedPayment.find_all().count() == 1


async def test_amount_change_applies_from_current_cycle_only(authed, freeze_today):
    freeze_today()
    _, _, _, bills = await _ids(authed)
    eid = bills["Broadband"]
    r = await authed.patch(f"{API}/settings/fixed-expenses/{eid}", json={"amount": 180_000})
    assert r.json()["amount_history"][-1] == {"amount": 180_000, "effective_from_cycle": "2026-11"}

    def broadband(cycle_json):
        return next(i for i in cycle_json["items"] if i["name"] == "Broadband")["template_amount"]

    assert broadband((await authed.get(f"{API}/fixed-expenses?cycle=2026-10")).json()) == 140_000
    assert broadband((await authed.get(f"{API}/fixed-expenses?cycle=2026-11")).json()) == 180_000
    assert broadband((await authed.get(f"{API}/fixed-expenses?cycle=2027-02")).json()) == 180_000
    await authed.patch(f"{API}/settings/fixed-expenses/{eid}", json={"amount": 190_000})
    fe = await FixedExpense.get(eid)
    assert [h.effective_from_cycle for h in fe.amount_history] == ["2000-01", "2026-11"]


async def test_archive_fixed_expense_keeps_history(authed, freeze_today):
    freeze_today()
    _, _, _, bills = await _ids(authed)
    await authed.patch(f"{API}/settings/fixed-expenses/{bills['Television']}", json={"is_active": False})
    names_now = [i["name"] for i in (await authed.get(f"{API}/fixed-expenses")).json()["items"]]
    names_past = [i["name"] for i in (await authed.get(f"{API}/fixed-expenses?cycle=2026-10")).json()["items"]]
    assert "Television" not in names_now and "Television" in names_past


async def test_bank_spending_requires_method_and_reason(authed, freeze_today):
    freeze_today()
    await onboard(authed)
    cats, reasons, _, _ = await _ids(authed)
    bank = cats["Bank & Cash Spending"]
    base = {"category_id": bank, "amount": 500_000, "date": "2026-11-08"}
    assert (await authed.post(f"{API}/expenses", json=base)).status_code == 422
    assert (await authed.post(f"{API}/expenses", json={**base, "method": "atm"})).status_code == 422
    assert (await authed.post(f"{API}/expenses", json={**base, "method": "cash", "reason_id": reasons["Shopping"]})).status_code == 422
    ok = await authed.post(f"{API}/expenses", json={**base, "method": "atm", "reason_id": reasons["Shopping"]})
    assert ok.status_code == 201
    sp = (await authed.get(f"{API}/analytics/spending")).json()
    assert sp["bank"]["reasons"][0]["name"] == "Shopping" and sp["bank"]["reasons"][0]["amount"] == 500_000
    atm = next(m for m in sp["bank"]["methods"] if m["method"] == "atm")
    assert atm["amount"] == 500_000 and atm["pct"] == 100.0 and atm["count"] == 1
    cfg = (await authed.get(f"{API}/settings")).json()
    assert cfg["last_category_id"] == bank and cfg["last_reason_id"] == reasons["Shopping"] and cfg["last_method"] == "atm"


async def test_cumulative_cards_keep_every_entry(authed, freeze_today):
    freeze_today()
    cats, _, _, _ = await _ids(authed)
    uber = cats["Uber / PickMe"]
    for amount, d in ((45_000, "2026-11-05"), (60_000, "2026-11-07"), (38_000, "2026-11-12")):
        assert (await authed.post(f"{API}/expenses", json={"category_id": uber, "amount": amount, "date": d})).status_code == 201
    summary = (await authed.get(f"{API}/spending/summary")).json()
    card = next(c for c in summary["categories"] if c["name"] == "Uber / PickMe")
    assert card["total"] == 143_000 and card["count"] == 3 and card["unit"] == "rides"
    listing = (await authed.get(f"{API}/expenses?category_id={uber}")).json()
    assert [i["amount"] for i in listing["items"]] == [38_000, 60_000, 45_000]
    eid = listing["items"][0]["id"]
    await authed.delete(f"{API}/expenses/{eid}")
    assert (await authed.get(f"{API}/spending/summary")).json()["total"] == 105_000
    await authed.post(f"{API}/expenses/{eid}/restore")
    assert (await authed.get(f"{API}/spending/summary")).json()["total"] == 143_000
    assert await ExpenseEntry.find_all().count() == 3


@pytest.mark.parametrize("amount", [0, -100, 12.5, "1000", 1_000_000_001])
async def test_amount_validation(authed, amount):
    cats, _, _, _ = await _ids(authed)
    r = await authed.post(f"{API}/expenses", json={"category_id": cats["Mobile Top-ups"], "amount": amount, "date": "2026-11-06"})
    assert r.status_code == 422


async def test_pay_has_no_client_cycle(authed):
    _, _, _, bills = await _ids(authed)
    r = await authed.post(f"{API}/fixed-expenses/{bills['Water Bill']}/pay", json={"cycle": "2026-01", "date": "2026-11-06"})
    assert r.status_code == 422  # the client never decides the cycle


async def test_amounts_are_stored_as_integers(authed, freeze_today):
    freeze_today()
    await onboard(authed)
    cats, _, sources, bills = await _ids(authed)
    await authed.post(f"{API}/expenses", json={"category_id": cats["Mobile Top-ups"], "amount": 12_345, "date": "2026-11-06"})
    await authed.post(f"{API}/income", json={"source_id": sources["Other Income"], "amount": 99_999, "date": "2026-11-06"})
    await authed.post(f"{API}/fixed-expenses/{bills['Water Bill']}/pay", json={})
    for document, fld in ((ExpenseEntry, "amount"), (IncomeEntry, "amount"), (FixedPayment, "amount_paid")):
        raw = await document.get_motor_collection().find_one({})
        assert type(raw[fld]) is int
    for raw in await FixedExpense.get_motor_collection().find({}).to_list(None):
        assert type(raw["amount"]) is int and all(type(h["amount"]) is int for h in raw["amount_history"])


async def test_unknown_fields_rejected(authed):
    cats, _, _, _ = await _ids(authed)
    r = await authed.post(f"{API}/expenses", json={"category_id": cats["Mobile Top-ups"], "amount": 100, "date": "2026-11-06", "user_id": "x"})
    assert r.status_code == 422


async def test_categories_and_reasons_crud(authed):
    r = await authed.post(f"{API}/categories", json={"name": "Coffee", "icon": "coffee", "colour": "#AA5500", "need_want": "want"})
    assert r.status_code == 201
    cid = r.json()["id"]
    r = await authed.patch(f"{API}/categories/{cid}", json={"name": "Coffee & Tea", "is_active": False, "need_want": "need"})
    assert r.json()["name"] == "Coffee & Tea" and r.json()["is_active"] is False and r.json()["need_want"] == "need"
    assert (await authed.post(f"{API}/reasons", json={"name": "Pets", "icon": "dog", "colour": "#123456"})).status_code == 201
    assert (await authed.post(f"{API}/reasons", json={"name": "  ", "colour": "#123456"})).status_code == 422
    assert (await authed.post(f"{API}/categories", json={"name": "Bad", "colour": "red"})).status_code == 422


async def test_reorder_fixed_expenses(authed):
    templates = (await authed.get(f"{API}/settings/fixed-expenses")).json()
    ids = [t["id"] for t in reversed(templates)]
    assert (await authed.post(f"{API}/settings/fixed-expenses/reorder", json={"ids": ids})).status_code == 200
    assert [t["id"] for t in (await authed.get(f"{API}/settings/fixed-expenses")).json()] == ids


async def test_add_fixed_expense_starts_current_cycle(authed, freeze_today):
    freeze_today()
    r = await authed.post(f"{API}/settings/fixed-expenses", json={"name": "Gym", "group": "Subscriptions", "amount": 500_000, "icon": "dumbbell"})
    assert r.status_code == 201
    now = [i["name"] for i in (await authed.get(f"{API}/fixed-expenses")).json()["items"]]
    past = [i["name"] for i in (await authed.get(f"{API}/fixed-expenses?cycle=2026-10")).json()["items"]]
    assert "Gym" in now and "Gym" not in past


async def test_pay_defaults_to_today(authed, freeze_today):
    d = freeze_today(date(2026, 11, 13))
    _, _, _, bills = await _ids(authed)
    r = await authed.post(f"{API}/fixed-expenses/{bills['Claude Pro']}/pay", json={})
    assert r.json()["day"] == d.isoformat() and r.json()["amount_paid"] == 700_000 and r.json()["cycle"] == "2026-11"
