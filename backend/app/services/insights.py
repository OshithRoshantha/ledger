"""Insights engine and rule-based recommendations.

Both are pure functions over an `InsightContext` (built by analytics.py from MongoDB
aggregations), so every insight type is unit-testable with plain fixture objects.

Insight object: {id, type, severity, title, detail, metric, delta_pct, delta_abs, action_link}
Types: overspend, budget_warning, anomaly, trend, bill_increase, pace_warning,
goal_progress, positive_win, bills_pending.
"""

import math
from dataclasses import dataclass, field
from statistics import mean, pstdev
from typing import Any, Optional

SEVERITY_RANK = {"high": 3, "medium": 2, "low": 1, "positive": 0}
MIN_NOTABLE = 50_000  # Rs 500
METHOD_LABELS = {"atm": "ATM withdrawal", "bank_transfer": "bank transfer", "card": "card payment", "cash": "cash", "other": "payment"}


def rs(cents: float, signed: bool = False) -> str:
    """Whole-rupee display for sentences: Rs 4,200 / Rs +3,100 / Rs −1,200."""
    value = int(round(cents / 100))
    sign = "−" if value < 0 else ("+" if signed and value > 0 else "")
    return f"Rs {sign}{abs(value):,}"


@dataclass
class CatStat:
    key: str
    name: str
    amount: int  # this cycle so far
    compare: int  # compare period (same-day for the current cycle)
    history: list[int] = field(default_factory=list)  # full closed cycles, oldest -> newest
    projected: Optional[int] = None  # end-of-cycle projection (current cycle)
    budget: Optional[int] = None
    kind: str = "category"  # category | reason | fixed
    link: str = "/spending"


@dataclass
class EntryStat:
    id: str
    key: str
    title: str
    amount: int
    method: Optional[str] = None
    day: str = ""


@dataclass
class BillStat:
    id: str
    name: str
    paid: Optional[int]
    template: int
    avg6: Optional[float] = None


@dataclass
class GoalStat:
    name: str
    target: int
    saved: int
    required_per_cycle: int
    avg_savings: int
    on_track: bool
    eta_cycles: Optional[int] = None
    eta_cycles_plus: Optional[int] = None  # with +Rs 5,000 per cycle


@dataclass
class InsightContext:
    compare_text: str  # "vs Oct 2026, same day 8"
    compare_name: str  # "last cycle" / "your 3-cycle average" / "Nov 2025"
    is_current: bool
    days_left: int
    elapsed_frac: float
    income: int
    spent: int
    projected_spend: int
    committed: int = 0
    pending_count: int = 0
    categories: list[CatStat] = field(default_factory=list)
    entries: list[EntryStat] = field(default_factory=list)
    entry_history: dict[str, list[int]] = field(default_factory=dict)
    bills: list[BillStat] = field(default_factory=list)
    pace_ratio: Optional[float] = None
    goals: list[GoalStat] = field(default_factory=list)
    fixed_ratio: Optional[float] = None  # fixed bills / income, %
    fixed_target: float = 50.0
    savings_target: int = 0


def _insight(type_: str, severity: str, title: str, detail: str = "", metric: Optional[str] = None,
             delta_pct: Optional[float] = None, delta_abs: Optional[int] = None, link: Optional[str] = None,
             id_: Optional[str] = None) -> dict[str, Any]:
    return {
        "id": id_ or f"{type_}:{title}",
        "type": type_,
        "severity": severity,
        "title": title,
        "detail": detail,
        "metric": metric,
        "delta_pct": None if delta_pct is None else round(delta_pct, 1),
        "delta_abs": delta_abs,
        "action_link": link,
    }


def _days(n: int) -> str:
    return f"{n} day{'s' if n != 1 else ''}"


# ---------------------------------------------------------------- generators


def _overspend(ctx: InsightContext) -> list[dict]:
    out = []
    for c in ctx.categories:
        if not c.budget:
            continue
        used = c.amount if not ctx.is_current else max(c.amount, c.projected or c.amount)
        if c.amount > c.budget:
            over = c.amount - c.budget
            out.append(_insight("overspend", "high", f"{c.name} is over budget by {rs(over)}",
                                f"{rs(c.amount)} spent of a {rs(c.budget)} budget.", c.key, (c.amount / c.budget - 1) * 100, over, c.link))
        elif ctx.is_current and used > c.budget * 1.05 and c.amount >= c.budget * 0.5:
            out.append(_insight("overspend", "medium", f"{c.name} is on track to exceed its budget",
                                f"Projected {rs(used)} against {rs(c.budget)}.", c.key, (used / c.budget - 1) * 100, used - c.budget, c.link))
    if ctx.is_current and ctx.income and ctx.projected_spend > ctx.income:
        gap = ctx.projected_spend - ctx.income
        out.append(_insight("overspend", "high", f"At this pace you'll overspend by {rs(gap)}",
                            f"Projected spend {rs(ctx.projected_spend)} vs income {rs(ctx.income)}.", "total", None, gap, "/?tab=plan"))
    return out


def _budget_warning(ctx: InsightContext) -> list[dict]:
    out = []
    for c in ctx.categories:
        if not c.budget or c.amount > c.budget:
            continue
        p = c.amount / c.budget * 100
        if p >= 80:
            left = f" with {_days(ctx.days_left)} left" if ctx.is_current else ""
            out.append(_insight("budget_warning", "medium", f"{c.name} is {p:.0f}% of its budget{left}",
                                f"{rs(c.budget - c.amount)} left of {rs(c.budget)}.", c.key, p, c.amount, c.link))
    return out


def _anomaly(ctx: InsightContext) -> list[dict]:
    out = []
    for e in ctx.entries:
        hist = ctx.entry_history.get(e.key, [])
        if len(hist) < 3:
            continue
        avg = mean(hist)
        sd = pstdev(hist)
        if avg <= 0:
            continue
        ratio = e.amount / avg
        if e.amount >= MIN_NOTABLE and (ratio > 2 or (sd > 0 and e.amount > avg + 2 * sd and ratio > 1.3)):
            what = METHOD_LABELS.get(e.method or "", "") if e.method else e.title
            what = what or e.title
            out.append(_insight("anomaly", "medium", f"Unusual: {rs(e.amount)} {what} ({ratio:.1f}× your average)",
                                f"{e.title} entries usually average {rs(avg)}.", e.key, (ratio - 1) * 100, int(e.amount - avg),
                                f"/spending/{e.key.split(':', 1)[-1]}" if e.key.startswith("var:") else "/spending", f"anomaly:{e.id}"))
    return out


def _trend(ctx: InsightContext) -> list[dict]:
    out = []
    for c in ctx.categories:
        h = c.history[-3:]
        if len(h) < 3 or h[0] <= 0:
            continue
        rise = (h[-1] - h[0]) / h[0] * 100
        if h[0] < h[1] < h[2] and rise >= 15 and h[-1] - h[0] >= MIN_NOTABLE:
            out.append(_insight("trend", "medium", f"{c.name} is up 3 cycles in a row (+{rise:.0f}%)",
                                f"{rs(h[0])} → {rs(h[1])} → {rs(h[2])}.", c.key, rise, h[-1] - h[0], c.link))
        elif h[0] > h[1] > h[2] and rise <= -15 and h[0] - h[-1] >= MIN_NOTABLE:
            out.append(_insight("trend", "positive", f"{c.name} has fallen 3 cycles in a row ({rise:.0f}%)",
                                f"{rs(h[0])} → {rs(h[1])} → {rs(h[2])}.", c.key, rise, h[-1] - h[0], c.link))
    return out


def _bill_increase(ctx: InsightContext) -> list[dict]:
    out = []
    for b in ctx.bills:
        if b.paid is None:
            continue
        diff = b.paid - b.template
        if diff >= max(10_000, b.template * 0.05):
            out.append(_insight("bill_increase", "medium", f"{b.name} paid {rs(diff)} above usual",
                                f"Paid {rs(b.paid)}; the usual amount is {rs(b.template)}.", b.id, diff / b.template * 100 if b.template else None,
                                diff, "/bills"))
        elif b.avg6 and b.paid > b.avg6 * 1.10:
            out.append(_insight("bill_increase", "low", f"{b.name} is {(b.paid / b.avg6 - 1) * 100:.0f}% above its 6-cycle average",
                                f"{rs(b.paid)} vs an average of {rs(b.avg6)}.", b.id, (b.paid / b.avg6 - 1) * 100, int(b.paid - b.avg6), "/bills"))
    return out


def _pace(ctx: InsightContext) -> list[dict]:
    if not ctx.is_current or ctx.pace_ratio is None or ctx.pace_ratio <= 0:
        return []
    faster = (ctx.pace_ratio - 1) * 100
    if faster >= 15:
        return [_insight("pace_warning", "high" if faster >= 40 else "medium",
                         f"Spending pace is {faster:.0f}% faster than {ctx.compare_name}", ctx.compare_text, "pace", faster, None, "/?tab=trends")]
    if faster <= -15:
        return [_insight("positive_win", "positive", f"Spending pace is {-faster:.0f}% slower than {ctx.compare_name}",
                         ctx.compare_text, "pace", faster, None, "/?tab=trends", "win:pace")]
    return []


def _goals(ctx: InsightContext) -> list[dict]:
    out = []
    for g in ctx.goals:
        if g.saved >= g.target:
            out.append(_insight("goal_progress", "positive", f"'{g.name}' goal reached 🎉", f"{rs(g.saved)} saved.", g.name, 100, g.saved, "/?tab=plan"))
        elif g.on_track:
            out.append(_insight("goal_progress", "positive", f"'{g.name}' is on track",
                                f"Needs {rs(g.required_per_cycle)}/cycle; you save about {rs(g.avg_savings)}.", g.name,
                                g.saved / g.target * 100, g.saved, "/?tab=plan"))
        else:
            out.append(_insight("goal_progress", "medium", f"'{g.name}' is behind schedule",
                                f"Needs {rs(g.required_per_cycle)}/cycle; you save about {rs(g.avg_savings)}.", g.name,
                                g.saved / g.target * 100, g.required_per_cycle - g.avg_savings, "/?tab=plan"))
    return out


def _wins(ctx: InsightContext) -> list[dict]:
    out = []
    for c in ctx.categories:
        if c.kind == "fixed" or c.compare <= 0:
            continue
        diff = c.amount - c.compare
        p = diff / c.compare * 100
        if p <= -15 and -diff >= MIN_NOTABLE:
            out.append(_insight("positive_win", "positive", f"You spent {-p:.0f}% less on {c.name} than {ctx.compare_name}",
                                f"{rs(c.amount)} vs {rs(c.compare)} ({rs(diff, signed=True)}).", c.key, p, diff, c.link))
    return out


def _pending(ctx: InsightContext) -> list[dict]:
    if not ctx.is_current or not ctx.pending_count:
        return []
    n = ctx.pending_count
    sev = "high" if ctx.days_left < 5 else "low"
    return [_insight("bills_pending", sev, f"{n} bill{'s' if n != 1 else ''} pending — {rs(ctx.committed)} committed",
                     f"{_days(ctx.days_left)} left in the cycle.", "bills", None, ctx.committed, "/bills")]


def _savings_target(ctx: InsightContext) -> list[dict]:
    if not ctx.is_current or not ctx.income or not ctx.savings_target:
        return []
    projected = ctx.income - ctx.projected_spend
    gap = ctx.savings_target - projected
    if gap > 0:
        return [_insight("goal_progress", "high", f"At this pace you'll save {rs(projected)}, {rs(gap)} short of your {rs(ctx.savings_target)} target",
                         "Cut back on variable spending to stay on target.", "savings_target", None, gap, "/?tab=plan")]
    return [_insight("goal_progress", "positive", f"On track to save {rs(projected)} this cycle",
                     f"Your target is {rs(ctx.savings_target)}.", "savings_target", None, projected - ctx.savings_target, "/?tab=plan")]


GENERATORS = (_overspend, _budget_warning, _anomaly, _trend, _bill_increase, _pace, _goals, _savings_target, _wins, _pending)


def generate(ctx: InsightContext, limit: int = 8) -> list[dict[str, Any]]:
    """Ranked insights. If any positive insight exists, at least one is always included."""
    items: list[dict] = []
    seen: set[str] = set()
    for gen in GENERATORS:
        for item in gen(ctx):
            if item["id"] not in seen:
                seen.add(item["id"])
                items.append(item)
    items.sort(key=lambda i: (SEVERITY_RANK[i["severity"]], abs(i["delta_abs"] or 0)), reverse=True)
    top = items[:limit]
    positives = [i for i in items if i["severity"] == "positive"]
    if positives and not any(i["severity"] == "positive" for i in top):
        top = top[: limit - 1] + [max(positives, key=lambda i: abs(i["delta_abs"] or 0))]
    return top


def alerts(insights: list[dict], limit: int = 5) -> list[dict]:
    """The Overview alerts strip: warnings first, priority-ordered."""
    warn = [i for i in insights if i["severity"] != "positive"]
    return warn[:limit]


# ---------------------------------------------------------------- recommendations (Plan tab)


def recommendations(ctx: InsightContext, limit: int = 5) -> list[dict[str, Any]]:
    recs: list[tuple[float, dict]] = []
    for c in ctx.categories:
        if c.kind == "fixed":
            continue
        h = c.history[-3:]
        if not h:
            continue
        avg3 = sum(h) / len(h)
        current = c.projected if (ctx.is_current and c.projected is not None) else c.amount
        saving = current - avg3
        if saving >= 100_000:
            recs.append((saving, {"id": f"cut:{c.key}", "kind": "cut", "title": f"Cutting {c.name} back to your 3-cycle average saves {rs(saving)}/cycle",
                                  "amount": int(saving), "action_link": c.link}))
    for t in _trend(ctx):
        if t["severity"] != "positive":
            recs.append((t["delta_abs"] or 0, {"id": f"rec:{t['id']}", "kind": "trend", "title": t["title"], "amount": t["delta_abs"],
                                                "action_link": t["action_link"]}))
    for g in ctx.goals:
        if g.saved < g.target and g.eta_cycles and g.eta_cycles_plus and g.eta_cycles > g.eta_cycles_plus:
            sooner = g.eta_cycles - g.eta_cycles_plus
            recs.append((sooner * 500_000, {"id": f"goal:{g.name}", "kind": "goal",
                                            "title": f"You'd reach your '{g.name}' goal {sooner} month{'s' if sooner != 1 else ''} sooner by saving Rs 5,000 more per cycle",
                                            "amount": 500_000, "action_link": "/?tab=plan"}))
    if ctx.fixed_ratio is not None and ctx.fixed_ratio > ctx.fixed_target:
        recs.append((ctx.fixed_ratio * 10_000, {"id": "fixed_ratio", "kind": "fixed",
                                                "title": f"Your fixed costs are {ctx.fixed_ratio:.0f}% of income — above your {ctx.fixed_target:.0f}% target",
                                                "amount": None, "action_link": "/?tab=bills"}))
    for c in ctx.categories:
        if c.budget and c.amount > c.budget:
            recs.append((c.amount - c.budget, {"id": f"budget:{c.key}", "kind": "budget",
                                               "title": f"{c.name} is {rs(c.amount - c.budget)} over budget — pause it for the rest of the cycle",
                                               "amount": c.amount - c.budget, "action_link": c.link}))
    recs.sort(key=lambda r: r[0], reverse=True)
    seen, out = set(), []
    for _, r in recs:
        if r["id"] not in seen:
            seen.add(r["id"])
            out.append(r)
    return out[:limit]


def cycles_needed(remaining: int, per_cycle: int) -> Optional[int]:
    if remaining <= 0:
        return 0
    if per_cycle <= 0:
        return None
    return math.ceil(remaining / per_cycle)
