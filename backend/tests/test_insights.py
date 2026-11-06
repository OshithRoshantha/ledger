"""Unit tests for every insight type (pure engine, fixture objects only)."""

from app.services.insights import BillStat, CatStat, EntryStat, GoalStat, InsightContext, alerts, generate, recommendations


def ctx(**kw) -> InsightContext:
    base = dict(compare_text="vs Oct 2026, same day 8", compare_name="last cycle", is_current=True, days_left=12,
                elapsed_frac=0.6, income=15_000_000, spent=6_000_000, projected_spend=9_000_000)
    base.update(kw)
    return InsightContext(**base)


def types(items):
    return [i["type"] for i in items]


def test_overspend_budget():
    out = generate(ctx(categories=[CatStat("var:r", "Restaurant", amount=600_000, compare=300_000, budget=500_000)]))
    o = next(i for i in out if i["type"] == "overspend")
    assert o["severity"] == "high" and o["title"] == "Restaurant is over budget by Rs 1,000" and o["delta_abs"] == 100_000


def test_overspend_total_projection():
    out = generate(ctx(projected_spend=16_000_000))
    assert any(i["title"] == "At this pace you'll overspend by Rs 10,000" for i in out)


def test_budget_warning():
    out = generate(ctx(categories=[CatStat("reason:r", "Restaurant", amount=425_000, compare=300_000, budget=500_000)]))
    w = next(i for i in out if i["type"] == "budget_warning")
    assert w["title"] == "Restaurant is 85% of its budget with 12 days left"


def test_anomaly():
    c = ctx(entries=[EntryStat("e1", "var:bank:atm", "Bank & Cash Spending", 1_500_000, method="atm")],
            entry_history={"var:bank:atm": [500_000, 400_000, 600_000]})
    a = next(i for i in generate(c) if i["type"] == "anomaly")
    assert a["title"] == "Unusual: Rs 15,000 ATM withdrawal (3.0× your average)"


def test_no_anomaly_without_history():
    c = ctx(entries=[EntryStat("e1", "var:x", "Uber", 5_000_000)], entry_history={"var:x": [100_000]})
    assert "anomaly" not in types(generate(c))


def test_trend_rising_and_falling():
    up = generate(ctx(categories=[CatStat("var:u", "Uber / PickMe", 300_000, 300_000, history=[400_000, 480_000, 552_000])]))
    assert any(i["type"] == "trend" and i["title"] == "Uber / PickMe is up 3 cycles in a row (+38%)" for i in up)
    down = generate(ctx(categories=[CatStat("var:s", "Shopping", 100_000, 100_000, history=[900_000, 700_000, 500_000])]))
    assert any(i["type"] == "trend" and i["severity"] == "positive" for i in down)


def test_bill_increase():
    out = generate(ctx(bills=[BillStat("b1", "Electricity", paid=245_000, template=200_000)]))
    assert any(i["type"] == "bill_increase" and i["title"] == "Electricity paid Rs 450 above usual" for i in out)
    out = generate(ctx(bills=[BillStat("b2", "Water", paid=200_000, template=200_000, avg6=170_000)]))
    assert any(i["type"] == "bill_increase" and "above its 6-cycle average" in i["title"] for i in out)


def test_pace_warning():
    out = generate(ctx(pace_ratio=1.18))
    p = next(i for i in out if i["type"] == "pace_warning")
    assert p["title"] == "Spending pace is 18% faster than last cycle" and p["detail"] == "vs Oct 2026, same day 8"


def test_goal_progress():
    on = GoalStat("Emergency fund", 30_000_000, 5_000_000, 2_000_000, 3_000_000, True)
    off = GoalStat("Laptop", 40_000_000, 0, 10_000_000, 3_000_000, False)
    out = generate(ctx(goals=[on, off]))
    gp = [i for i in out if i["type"] == "goal_progress"]
    assert {i["severity"] for i in gp} == {"positive", "medium"}


def test_positive_win_always_included():
    noisy = [CatStat(f"var:{n}", f"Cat {n}", 900_000, 100_000, budget=100_000) for n in range(10)]  # many high alerts
    win = CatStat("var:shop", "Shopping", 390_000, 500_000)
    out = generate(ctx(categories=noisy + [win]), limit=5)
    assert len(out) == 5
    assert any(i["type"] == "positive_win" and i["title"] == "You spent 22% less on Shopping than last cycle" for i in out)


def test_bills_pending_and_alerts_order():
    out = generate(ctx(pending_count=3, committed=1_040_000, days_left=3,
                       categories=[CatStat("var:shop", "Shopping", 390_000, 500_000)]))
    strip = alerts(out)
    assert strip[0]["title"] == "3 bills pending — Rs 10,400 committed"
    assert all(a["severity"] != "positive" for a in strip) and len(strip) <= 5


def test_savings_target_shortfall_and_on_track():
    short = generate(ctx(income=10_000_000, projected_spend=8_500_000, savings_target=3_000_000))
    assert any(i["title"] == "At this pace you'll save Rs 15,000, Rs 15,000 short of your Rs 30,000 target" and i["severity"] == "high" for i in short)
    ok = generate(ctx(income=10_000_000, projected_spend=6_000_000, savings_target=3_000_000))
    assert any(i["title"] == "On track to save Rs 40,000 this cycle" and i["severity"] == "positive" for i in ok)
    assert not any(i.get("metric") == "savings_target" for i in generate(ctx(savings_target=0)))


def test_recommendations():
    c = ctx(categories=[CatStat("reason:r", "Restaurant", 600_000, 300_000, history=[400_000, 380_000, 480_000], projected=840_000),
                        CatStat("var:u", "Uber / PickMe", 300_000, 300_000, history=[400_000, 480_000, 552_000], projected=500_000)],
            goals=[GoalStat("Emergency fund", 30_000_000, 5_000_000, 2_000_000, 1_500_000, False, eta_cycles=17, eta_cycles_plus=13)],
            fixed_ratio=52.4)
    recs = recommendations(c)
    titles = [r["title"] for r in recs]
    assert "Cutting Restaurant back to your 3-cycle average saves Rs 4,200/cycle" in titles
    assert "Uber / PickMe is up 3 cycles in a row (+38%)" in titles
    assert "You'd reach your 'Emergency fund' goal 4 months sooner by saving Rs 5,000 more per cycle" in titles
    assert "Your fixed costs are 52% of income — above your 50% target" in titles
    assert len(recs) <= 5
