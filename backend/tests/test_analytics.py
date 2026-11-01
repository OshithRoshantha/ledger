"""Analytics centre on fixture data covering two cycles (salary day 5, Asia/Colombo).

Oct 2026 cycle = 5 Oct - 4 Nov (31 days).   Nov 2026 cycle = 5 Nov - 4 Dec (30 days).
'Today' is 12 Nov 2026 = day 8 of the Nov cycle, so Nov is compared with 5-12 Oct.
"""

import time
from datetime import date

import pytest

from .conftest import onboard

API = "/api/v1"


async def _ids(c):
    cats = {x["name"]: x["id"] for x in (await c.get(f"{API}/categories")).json()}
    reasons = {x["name"]: x["id"] for x in (await c.get(f"{API}/reasons")).json()}
    sources = {x["name"]: x["id"] for x in (await c.get(f"{API}/income-sources")).json()}
    bills = {x["name"]: x["id"] for x in (await c.get(f"{API}/settings/fixed-expenses")).json()}
    return cats, reasons, sources, bills


async def _post(c, path, body, code=201):
    r = await c.post(f"{API}{path}", json=body)
    assert r.status_code == code, r.text
    return r.json()


async def _get(c, path):
    r = await c.get(f"{API}{path}")
    assert r.status_code == 200, r.text
    return r.json()


@pytest.fixture
async def data(authed, freeze_today):
    freeze_today(date(2026, 11, 12))
    c = authed
    await onboard(c, 15_000_000, "2026-11-05")  # Nov salary received
    cats, reasons, sources, bills = await _ids(c)
    # ---- Oct cycle (closed)
    await _post(c, "/income", {"source_id": sources["Salary"], "amount": 15_000_000, "date": "2026-10-05"})
    for name, bid in bills.items():
        await _post(c, f"/fixed-expenses/{bid}/pay", {"date": "2026-10-15" if name == "Electricity Bill" else "2026-10-06"})
    uber, bank, mob, lmt = cats["Uber / PickMe"], cats["Bank & Cash Spending"], cats["Mobile Top-ups"], cats["LMT Top-ups"]
    for amount, d in ((100_000, "2026-10-06"), (150_000, "2026-10-08"), (200_000, "2026-10-20")):
        await _post(c, "/expenses", {"category_id": uber, "amount": amount, "date": d})
    await _post(c, "/expenses", {"category_id": bank, "amount": 200_000, "date": "2026-10-07", "method": "card", "reason_id": reasons["Restaurant"]})
    await _post(c, "/expenses", {"category_id": bank, "amount": 500_000, "date": "2026-10-25", "method": "atm", "reason_id": reasons["Shopping"]})
    await _post(c, "/expenses", {"category_id": mob, "amount": 150_000, "date": "2026-10-10"})
    # ---- Nov cycle (current, day 8)
    await _post(c, f"/fixed-expenses/{bills['Foods & Households']}/pay", {"date": "2026-11-06"})
    await _post(c, f"/fixed-expenses/{bills['Electricity Bill']}/pay", {"date": "2026-11-10", "amount": 235_000})
    await _post(c, f"/fixed-expenses/{bills['Claude Pro']}/pay", {"date": "2026-11-07"})
    for amount, d in ((120_000, "2026-11-06"), (180_000, "2026-11-09")):
        await _post(c, "/expenses", {"category_id": uber, "amount": amount, "date": d})
    await _post(c, "/expenses", {"category_id": bank, "amount": 510_000, "date": "2026-11-08", "method": "card", "reason_id": reasons["Restaurant"]})
    await _post(c, "/expenses", {"category_id": mob, "amount": 50_000, "date": "2026-11-07"})
    await _post(c, "/expenses", {"category_id": lmt, "amount": 30_000, "date": "2026-11-11"})
    c.ids = (cats, reasons, sources, bills)
    return c


# ---------------------------------------------------------------- overview


async def test_overview_hero(data):
    o = await _get(data, "/analytics/overview")
    m, h = o["meta"], o["hero"]
    assert (m["cycle"], m["start"], m["end"], m["days_total"], m["day_index"], m["days_left"]) == ("2026-11", "2026-11-05", "2026-12-04", 30, 8, 22)
    assert h["income"] == 15_000_000 and h["spent"] == 4_825_000
    assert h["balance"] == 10_175_000 and h["committed"] == 490_000 and h["reserved"] == 0
    assert h["safe_to_spend"] == 9_685_000
    assert h["days_remaining"] == 23 and h["daily_allowance"] == round(9_685_000 / 23 / 100) * 100
    assert o["takeaway"].startswith("You can spend Rs 4,211/day for 23 more days")


async def test_waterfall_totals_match_income_minus_spent(data):
    w = (await _get(data, "/analytics/overview"))["waterfall"]
    steps = w["steps"]
    assert steps[0] == {"label": "Salary", "amount": 15_000_000, "kind": "add"}
    assert steps[-1]["label"] == "Remaining" and steps[-1]["amount"] == w["income"] - w["spent"] == 10_175_000
    assert sum(s["amount"] for s in steps[:-1]) == steps[-1]["amount"]
    labels = [s["label"] for s in steps]
    assert "Fixed bills" in labels and "Uber / PickMe" in labels and "Bank: Restaurant" in labels


async def test_compare_modes(data):
    last = await _get(data, "/analytics/overview?compare=last")
    spent = next(k for k in last["kpis"] if k["key"] == "spent")
    # Oct up to the same day 8 (5-12 Oct): bills except electricity + rides + restaurant + mobile
    assert spent["change"]["previous"] == 4_190_000 + 600_000
    assert spent["change"]["diff"] == 35_000 and spent["change"]["pct"] == 0.7
    assert last["meta"]["compare"]["text"] == "vs Oct 2026, same day 8"

    avg3 = await _get(data, "/analytics/overview?compare=avg3")
    s3 = next(k for k in avg3["kpis"] if k["key"] == "spent")
    assert s3["change"]["previous"] == round(4_790_000 / 3)  # Aug & Sep empty
    assert avg3["meta"]["compare"]["text"].startswith("vs 3-cycle avg (Aug–Oct 2026), day 8")

    yoy = await _get(data, "/analytics/overview?compare=yoy")
    sy = next(k for k in yoy["kpis"] if k["key"] == "spent")
    assert sy["change"]["is_new"] is True and sy["change"]["pct"] is None  # never ∞%
    assert yoy["meta"]["compare"]["text"] == "vs Nov 2025, same day 8 (no data)"


async def test_kpis_sparklines_and_health(data):
    o = await _get(data, "/analytics/overview")
    keys = [k["key"] for k in o["kpis"]]
    assert keys == ["income", "spent", "balance", "savings_rate", "avg_daily", "projected_balance", "pending_bills", "biggest"]
    for k in o["kpis"]:
        assert len(k["spark"]) == 6
    pending = next(k for k in o["kpis"] if k["key"] == "pending_bills")
    assert pending["count"] == 4 and pending["value"] == 490_000
    biggest = next(k for k in o["kpis"] if k["key"] == "biggest")
    assert biggest["name"] == "Foods & Households" and biggest["value"] == 3_000_000
    h = o["health"]
    assert 0 <= h["score"] <= 100 and h["prev_score"] is not None and h["delta"] == h["score"] - h["prev_score"]
    assert sum(c["weight"] for c in h["components"]) in (99, 100, 101)
    assert {c["key"] for c in h["components"]} >= {"savings", "bills", "pace", "variable"}
    assert "top_factor" in h


async def test_alerts_strip(data):
    o = await _get(data, "/analytics/overview")
    assert 1 <= len(o["alerts"]) <= 5
    assert all(a["severity"] != "positive" for a in o["alerts"])
    titles = [a["title"] for a in o["insights"]]
    assert "Electricity Bill paid Rs 350 above usual" in titles
    assert any(t.startswith("4 bills pending — Rs 4,900 committed") for t in titles)
    for i in o["insights"]:
        assert set(i) == {"id", "type", "severity", "title", "detail", "metric", "delta_pct", "delta_abs", "action_link"}


# ---------------------------------------------------------------- spending


async def test_spending_tab(data):
    s = await _get(data, "/analytics/spending")
    rows = {r["name"]: r for r in s["categories"]}
    assert s["total"] == 4_825_000
    foods = rows["Foods & Households"]
    assert foods["amount"] == 3_000_000 and foods["pct_of_income"] == 20.0 and len(foods["spark"]) == 6
    bank = rows["Bank & Cash Spending"]
    assert bank["change"]["diff"] == 310_000 and bank["change"]["pct"] == 155.0
    assert rows["LMT Top-ups"]["change"]["is_new"] is True
    assert s["movers"]["up"][0]["name"] in ("Bank & Cash Spending", "Bank: Restaurant")
    assert [m["name"] for m in s["movers"]["down"]][:2] == ["Utility Bills", "Mobile Top-ups"]
    assert "drove" in s["takeaway"]
    b = s["bank"]
    assert b["total"] == 510_000 and b["count"] == 1
    card = next(m for m in b["methods"] if m["method"] == "card")
    assert card["count"] == 1 and card["avg"] == 510_000 and card["pct"] == 100.0
    assert b["matrix"]["reasons"] == ["Restaurant"] and b["matrix"]["cells"] == [[0, 0, 510_000]]
    p = s["patterns"]
    assert len(p["weekday"]) == 7 and sum(w["total"] for w in p["weekday"]) == 890_000
    assert p["weekday_vs_weekend"]["weekday"] + p["weekday_vs_weekend"]["weekend"] == 890_000
    assert p["halves"]["first"] + p["halves"]["second"] == 890_000
    assert len(s["heat"]) == 30
    assert sum(x["count"] for x in s["sizes"]) == 5 and sum(x["total"] for x in s["sizes"]) == 890_000
    assert [t["amount"] for t in s["top10"]] == [510_000, 180_000, 120_000, 50_000, 30_000]
    uber = next(f for f in s["frequency"] if f["name"] == "Uber / PickMe")
    assert uber["count"] == 2 and uber["avg"] == 150_000


# ---------------------------------------------------------------- bills


async def test_bills_tab(data):
    b = await _get(data, "/analytics/bills?months=12")
    st = b["status"]
    assert (st["paid_count"], st["total_count"], st["paid_amount"], st["pending_amount"]) == (3, 7, 3_935_000, 490_000)
    elec = next(t for t in b["trends"] if t["name"] == "Electricity Bill")
    assert len(elec["points"]) == 12 and elec["points"][-1]["amount"] == 235_000 and elec["points"][-2]["amount"] == 200_000
    annual = {a["name"]: a for a in b["annual"]["items"]}
    assert annual["Claude Pro"]["annual"] == 8_400_000
    assert b["annual"]["takeaway"] == "Foods & Households costs Rs 360,000/year."
    assert b["fixed_ratio"]["series"][-1]["ratio"] == round((3_935_000 + 490_000) / 15_000_000 * 100, 1)
    timing = next(t for t in b["timing"] if t["name"] == "Electricity Bill")
    assert timing["avg_day"] == round((11 + 6) / 2, 1)  # 15 Oct = day 11, 10 Nov = day 6
    tva = next(t for t in b["template_vs_actual"] if t["name"] == "Electricity Bill")
    assert tva["template"] == 200_000 and tva["actual"] == 235_000


# ---------------------------------------------------------------- trends


async def test_trends_tab(data):
    t = await _get(data, "/analytics/trends?months=12")
    assert t["locked"] is False and len(t["rows"]) == 12
    assert t["rows"][-1]["cycle"] == "2026-11" and t["rows"][-1]["spent"] == 4_825_000
    assert t["rows"][-2]["saved"] == 15_000_000 - 5_690_000
    assert t["rows"][-1]["top_category"] == "Foods & Households"
    assert len(t["mix"]["series"]) == 12 and len(t["mix"]["categories"]) >= 5
    assert [n["cycle"] for n in t["networth"]] == ["2026-10", "2026-11"]
    assert t["networth"][-1]["cumulative"] == (15_000_000 - 5_690_000) + (15_000_000 - 4_825_000)
    assert t["best"]["cycle"] == "2026-10" and t["ytd"]["year"] == "2026" and t["ytd"]["cycles"] >= 2
    assert len(t["pace"]["current"]) == 8 and t["pace"]["current"][-1] == 4_825_000


async def test_trends_locked_with_one_cycle(authed, freeze_today):
    freeze_today(date(2026, 11, 12))
    await onboard(authed)
    t = await _get(authed, "/analytics/trends")
    assert t["locked"] is True and t["unlock_message"] == "Trends unlock after 2 cycles of data."


# ---------------------------------------------------------------- plan, budgets, goals, simulator


async def test_budgets_goals_plan_and_simulator(data):
    cats, reasons, _, _ = data.ids
    ub = await _post(data, "/budgets", {"target_type": "category", "target_id": cats["Uber / PickMe"], "amount": 400_000})
    await _post(data, "/budgets", {"target_type": "reason", "target_id": reasons["Restaurant"], "amount": 500_000})
    assert (await data.post(f"{API}/budgets", json={"target_type": "category", "target_id": cats["Bank & Cash Spending"], "amount": 1})).status_code == 422
    goal = await _post(data, "/goals", {"name": "Emergency fund", "target_amount": 30_000_000, "target_date": "2027-11-01",
                                         "saved_amount": 5_000_000, "monthly_reserve": 1_000_000})

    plan = await _get(data, "/analytics/plan")
    budgets = {b["name"]: b for b in plan["budgets"]}
    assert budgets["Uber / PickMe"]["pct"] == 75.0 and budgets["Uber / PickMe"]["state"] == "ok"
    assert budgets["Restaurant"]["state"] == "over" and budgets["Restaurant"]["spent"] == 510_000
    assert budgets["Uber / PickMe"]["pace_pct"] == round(8 / 30 * 100)
    g = plan["goals"][0]
    assert g["name"] == "Emergency fund" and g["progress_pct"] == round(5_000_000 / 30_000_000 * 100, 1) and g["required_per_cycle"] > 0
    f = plan["forecast"]
    assert f["end_spend"]["low"] <= f["end_spend"]["likely"] <= f["end_spend"]["high"]
    assert len(f["actual"]) == 8 and len(f["likely"]) == 30
    fifty = {b["key"]: b for b in plan["fifty"]["buckets"]}
    assert fifty["needs"]["amount"] + fifty["wants"]["amount"] + fifty["savings"]["amount"] == 15_000_000
    assert 1 <= len(plan["recommendations"]) <= 5
    assert any("Restaurant" in r["title"] for r in plan["recommendations"])

    # reserve reduces Safe to spend
    hero = (await _get(data, "/analytics/overview"))["hero"]
    assert hero["reserved"] == 1_000_000 and hero["safe_to_spend"] == 9_685_000 - 1_000_000

    sim = await _post(data, "/analytics/simulate", {"amount": 1_000_000, "category_id": cats["Bank & Cash Spending"],
                                                    "reason_id": reasons["Restaurant"], "date": "2026-11-12"}, code=200)
    assert sim["safe_after"] == sim["safe_before"] - 1_000_000 and sim["cycle"] == "2026-11"
    assert sim["budgets"][0]["name"] == "Restaurant" and sim["budgets"][0]["after_pct"] > sim["budgets"][0]["before_pct"]
    assert sim["projected_balance_after"] == sim["projected_balance_before"] - 1_000_000
    assert sim["verdict"] == "yes"
    big = await _post(data, "/analytics/simulate", {"amount": 900_000_000, "category_id": cats["Uber / PickMe"]}, code=200)
    assert big["verdict"] == "no" and big["message"].startswith("Not without missing bills")
    # simulator is read-only
    assert (await _get(data, "/analytics/overview"))["hero"]["spent"] == 4_825_000

    # soft delete + undo
    assert (await data.delete(f"{API}/budgets/{ub['id']}")).status_code == 200
    assert len(await _get(data, "/budgets")) == 1
    await _post(data, f"/budgets/{ub['id']}/restore", {}, code=200)
    assert len(await _get(data, "/budgets")) == 2
    r = await data.patch(f"{API}/goals/{goal['id']}", json={"saved_amount": 30_000_000})
    assert r.json()["saved_amount"] == 30_000_000


async def test_cache_invalidated_and_instant_updates(data):
    cats, _, _, _ = data.ids
    first = await _get(data, "/analytics/overview")
    assert await _get(data, "/analytics/overview") == first
    await _post(data, "/expenses", {"category_id": cats["Mobile Top-ups"], "amount": 10_000, "date": "2026-11-12"})
    after = (await _get(data, "/analytics/overview"))["hero"]
    assert after["spent"] == first["hero"]["spent"] + 10_000
    assert after["safe_to_spend"] == first["hero"]["safe_to_spend"] - 10_000


async def test_tabs_are_fast(data):
    from app.services import cache

    for path in ("overview", "spending", "bills", "trends", "plan"):
        cache.clear()
        start = time.perf_counter()
        await _get(data, f"/analytics/{path}")
        # the in-memory mock is only a proxy; real Mongo with indexes targets < 300 ms per tab
        assert time.perf_counter() - start < 1.5, path


async def test_empty_state(authed, freeze_today):
    freeze_today(date(2026, 11, 12))
    o = await _get(authed, "/analytics/overview")
    assert o["hero"]["income"] == 0 and o["waterfall"]["remaining"] == 0
    s = await _get(authed, "/analytics/spending")
    assert s["total"] == 0
