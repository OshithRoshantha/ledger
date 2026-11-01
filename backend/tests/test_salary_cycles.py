"""Acceptance tests for salary cycles: attribution by date, stored boundaries,
salary amount/day changes, early/late salary overrides and month-end edge cases."""

from datetime import date

from app.models import CycleDoc, ExpenseEntry

from .conftest import onboard

API = "/api/v1"


async def _ids(c):
    cats = {x["name"]: x["id"] for x in (await c.get(f"{API}/categories")).json()}
    reasons = {x["name"]: x["id"] for x in (await c.get(f"{API}/reasons")).json()}
    sources = {x["name"]: x["id"] for x in (await c.get(f"{API}/income-sources")).json()}
    bills = {x["name"]: x["id"] for x in (await c.get(f"{API}/settings/fixed-expenses")).json()}
    return cats, reasons, sources, bills


def _status(bills_json, name):
    return next(i for i in bills_json["items"] if i["name"] == name)["status"]


async def test_bill_paid_before_salary_day_belongs_to_previous_cycle(authed, freeze_today):
    freeze_today(date(2026, 11, 12))
    await onboard(authed, 15_000_000, "2026-11-05")
    cats, reasons, _, bills = await _ids(authed)
    elec = await authed.post(f"{API}/fixed-expenses/{bills['Electricity Bill']}/pay", json={"date": "2026-11-02"})
    claude = await authed.post(f"{API}/fixed-expenses/{bills['Claude Pro']}/pay", json={"date": "2026-11-03"})
    atm = await authed.post(f"{API}/expenses", json={"category_id": cats["Bank & Cash Spending"], "amount": 500_000, "date": "2026-11-04",
                                                     "method": "atm", "reason_id": reasons["Shopping"]})
    water = await authed.post(f"{API}/fixed-expenses/{bills['Water Bill']}/pay", json={"date": "2026-11-06"})
    assert [elec.json()["cycle"], claude.json()["cycle"], atm.json()["cycle"], water.json()["cycle"]] == ["2026-10", "2026-10", "2026-10", "2026-11"]

    nov = (await authed.get(f"{API}/fixed-expenses?cycle=2026-11")).json()
    assert _status(nov, "Electricity Bill") == "pending" and _status(nov, "Claude Pro") == "pending"
    assert _status(nov, "Water Bill") == "paid"
    oct_ = (await authed.get(f"{API}/fixed-expenses?cycle=2026-10")).json()
    assert _status(oct_, "Electricity Bill") == "paid" and _status(oct_, "Claude Pro") == "paid"

    hero = (await authed.get(f"{API}/analytics/overview")).json()["hero"]
    assert hero["income"] == 15_000_000
    assert hero["spent"] == 200_000  # only the water bill comes out of the November salary
    assert hero["balance"] == 15_000_000 - 200_000
    assert hero["committed"] == 4_390_000 - 200_000  # electricity & Claude Pro are pending again


async def test_entry_on_salary_day_is_new_cycle(authed, freeze_today):
    freeze_today(date(2026, 11, 12))
    await onboard(authed)
    cats, _, _, _ = await _ids(authed)
    r = await authed.post(f"{API}/expenses", json={"category_id": cats["Mobile Top-ups"], "amount": 10_000, "date": "2026-11-05"})
    assert r.json()["cycle"] == "2026-11"
    edited = await authed.patch(f"{API}/expenses/{r.json()['id']}", json={"date": "2026-11-04"})
    assert edited.json()["cycle"] == "2026-10"  # editing the date re-assigns the cycle


async def test_resolve_endpoint_drives_attribution_chip(authed, freeze_today):
    freeze_today(date(2026, 11, 12))
    await onboard(authed)
    r = (await authed.get(f"{API}/cycles/resolve?date=2026-11-03")).json()
    assert (r["label"], r["short"], r["start_date"], r["end_date"]) == ("2026-10", "Oct", "2026-10-05", "2026-11-04")
    assert r["salary_cycle"]["label"] == "2026-11" and r["salary_cycle"]["can_override"] is True
    r = (await authed.get(f"{API}/cycles/resolve?date=2026-11-05")).json()
    assert r["label"] == "2026-11" and r["salary_cycle"]["can_override"] is False


async def test_salary_amount_change_keeps_closed_cycles(authed, freeze_today):
    freeze_today(date(2026, 11, 12))
    await onboard(authed, 15_000_000)
    await authed.get(f"{API}/cycles?back=3")
    r = await authed.patch(f"{API}/settings/salary", json={"amount": 16_000_000})
    assert r.status_code == 200 and r.json()["amount"] == 16_000_000
    assert r.json()["history"][-1] == {"amount": 16_000_000, "effective_from_cycle": "2026-11"}
    cycles = {c["label"]: c for c in (await authed.get(f"{API}/cycles?back=3")).json()}
    assert cycles["2026-10"]["salary_amount"] == 15_000_000 and cycles["2026-10"]["closed"] is True
    assert cycles["2026-11"]["salary_amount"] == 16_000_000
    assert cycles["2026-12"]["salary_amount"] == 16_000_000
    # the next cycle's pending salary uses the new amount
    freeze_today(date(2026, 12, 6))
    inc = (await authed.get(f"{API}/income")).json()
    assert inc["cycle"] == "2026-12" and inc["items"][0]["status"] == "pending" and inc["items"][0]["amount"] == 16_000_000


async def test_salary_day_change_preview_and_closed_cycles_untouched(authed, freeze_today):
    freeze_today(date(2026, 11, 12))
    await onboard(authed)
    cats, _, _, _ = await _ids(authed)
    await authed.get(f"{API}/cycles?back=3")
    before = {c.label: (c.start_date, c.end_date) for c in await CycleDoc.find_all().to_list() if c.label <= "2026-10"}
    future = await authed.post(f"{API}/expenses", json={"category_id": cats["Mobile Top-ups"], "amount": 10_000, "date": "2026-12-07"})
    assert future.json()["cycle"] == "2026-12"

    preview = (await authed.post(f"{API}/settings/salary/preview", json={"salary_day": 10})).json()
    assert preview["count"] == 1
    assert preview["summary"] == ["1 entry will move from Dec 2026 cycle to Nov 2026 cycle"]
    assert preview["current_cycle"]["new_end_date"] == "2026-12-09"
    assert (await ExpenseEntry.get(future.json()["id"])).cycle == "2026-12"  # preview saves nothing

    r = await authed.patch(f"{API}/settings/salary", json={"salary_day": 10})
    assert r.json()["salary_day"] == 10 and r.json()["moved"] == 1
    assert (await ExpenseEntry.get(future.json()["id"])).cycle == "2026-11"
    after = {c.label: (c.start_date, c.end_date) for c in await CycleDoc.find_all().to_list() if c.label <= "2026-10"}
    assert after == before  # closed cycles keep their boundaries
    nov = await CycleDoc.find_one(CycleDoc.label == "2026-11")
    assert (nov.start_date, nov.end_date) == ("2026-11-05", "2026-12-09")
    dec = (await authed.get(f"{API}/cycles/resolve?date=2026-12-10")).json()
    assert dec["label"] == "2026-12" and dec["start_date"] == "2026-12-10" and dec["end_date"] == "2027-01-09"


async def test_early_salary_override_reassigns_gap(authed, freeze_today):
    freeze_today(date(2026, 12, 4))  # salary arrives on Fri 4 Dec instead of Sat 5 Dec
    await onboard(authed, last_salary_date="2026-11-05")
    cats, _, sources, _ = await _ids(authed)
    gap = await authed.post(f"{API}/expenses", json={"category_id": cats["Uber / PickMe"], "amount": 80_000, "date": "2026-12-04"})
    assert gap.json()["cycle"] == "2026-11"
    chip = (await authed.get(f"{API}/cycles/resolve?date=2026-12-04")).json()
    assert chip["salary_cycle"]["label"] == "2026-12" and chip["salary_cycle"]["can_override"]

    r = await authed.post(f"{API}/cycles/2026-12/override-start", json={"date": "2026-12-04"})
    assert r.status_code == 200, r.text
    assert r.json()["cycle"]["is_override"] is True and r.json()["prev_end_date"] == "2026-12-03"
    assert [m["id"] for m in r.json()["moved"]] == [gap.json()["id"]]
    assert (await ExpenseEntry.get(gap.json()["id"])).cycle == "2026-12"
    salary = await authed.post(f"{API}/income", json={"source_id": sources["Salary"], "amount": 15_000_000, "date": "2026-12-04"})
    assert salary.json()["cycle"] == "2026-12"
    nov = await CycleDoc.find_one(CycleDoc.label == "2026-11")
    assert nov.end_date == "2026-12-03"


async def test_late_salary_override(authed, freeze_today):
    freeze_today(date(2026, 12, 7))
    await onboard(authed, last_salary_date="2026-11-05")
    cats, _, _, _ = await _ids(authed)
    e = await authed.post(f"{API}/expenses", json={"category_id": cats["Mobile Top-ups"], "amount": 20_000, "date": "2026-12-05"})
    assert e.json()["cycle"] == "2026-12"
    r = await authed.post(f"{API}/cycles/2026-12/override-start", json={"date": "2026-12-07"})
    assert r.status_code == 200, r.text
    assert (await ExpenseEntry.get(e.json()["id"])).cycle == "2026-11"  # spent before the salary arrived


async def test_override_validation(authed, freeze_today):
    freeze_today(date(2026, 11, 12))
    await onboard(authed)
    await authed.get(f"{API}/cycles?back=3")
    assert (await authed.post(f"{API}/cycles/2026-09/override-start", json={"date": "2026-09-06"})).status_code == 422  # closed
    assert (await authed.post(f"{API}/cycles/2026-12/override-start", json={"date": "2026-11-20"})).status_code == 422  # too far


async def test_month_end_salary_day_31(authed, freeze_today):
    freeze_today(date(2027, 2, 15))
    await onboard(authed, last_salary_date="2027-01-31", salary_day=31)
    cats, _, _, _ = await _ids(authed)
    jan = (await authed.get(f"{API}/cycles/resolve?date=2027-02-27")).json()
    assert (jan["start_date"], jan["end_date"], jan["label"]) == ("2027-01-31", "2027-02-27", "2027-02")
    r = await authed.post(f"{API}/expenses", json={"category_id": cats["Mobile Top-ups"], "amount": 10_000, "date": "2027-02-28"})
    assert r.json()["cycle"] == "2027-03"  # 28 Feb is February's (clamped) salary day
    mar = (await authed.get(f"{API}/cycles/resolve?date=2027-03-30")).json()
    assert (mar["start_date"], mar["end_date"]) == ("2027-02-28", "2027-03-30")


async def test_onboarding_creates_received_salary_and_cycle(authed, freeze_today):
    freeze_today(date(2026, 11, 12))
    out = await onboard(authed, 15_000_000, "2026-11-04", salary_day=5)  # paid a day early
    assert out["salary_day"] == 5 and out["current_cycle"] == "2026-11" and out["current_cycle_start"] == "2026-11-04"
    inc = (await authed.get(f"{API}/income")).json()
    assert inc["received_total"] == 15_000_000 and inc["pending_total"] == 0
    cycles = {c["label"]: c for c in (await authed.get(f"{API}/cycles?back=2")).json()}
    assert cycles["2026-11"]["is_override"] is True and cycles["2026-10"]["end_date"] == "2026-11-03"


async def test_compare_uses_stored_boundaries(authed, freeze_today):
    # October starts on an override date (3 Oct). Same-day-8 comparison must use 3-10 Oct, not 5-12 Oct.
    freeze_today(date(2026, 10, 10))
    await onboard(authed, last_salary_date="2026-10-03", salary_day=5)
    cats, _, _, _ = await _ids(authed)
    for d, amount in (("2026-10-03", 100_000), ("2026-10-10", 200_000), ("2026-10-11", 400_000), ("2026-10-12", 800_000)):
        await authed.post(f"{API}/expenses", json={"category_id": cats["Mobile Top-ups"], "amount": amount, "date": d})
    freeze_today(date(2026, 11, 12))  # day 8 of Nov
    ov = (await authed.get(f"{API}/analytics/overview?compare=last")).json()
    spent = next(k for k in ov["kpis"] if k["key"] == "spent")
    assert spent["change"]["previous"] == 300_000  # 3 Oct + 10 Oct only
    assert ov["meta"]["compare"]["text"] == "vs Oct 2026, same day 8"
