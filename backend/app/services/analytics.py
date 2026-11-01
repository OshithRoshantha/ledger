"""Decision-making analytics: Overview, Spending, Bills, Trends, Plan + affordability simulator.

Data flow: three MongoDB aggregation pipelines group every entry of the cycles in view into
compact buckets (cycle x day x category x reason x method for spending, cycle x day x bill
for payments, cycle x day x source for income). Every tab is derived from those buckets
in-process, so a tab costs 3-5 small queries regardless of how many metrics it shows.

Comparison periods (`compare`):
  last  - previous cycle;          avg3 - average of the previous 3 cycles;
  yoy   - same-label cycle a year ago.
For the current cycle every comparison is cut at the same elapsed day ("same day 8").
"""

import math
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, timedelta
from typing import Any, Optional

from beanie import PydanticObjectId

from app.models import AppSettings, Budget, ExpenseEntry, FixedExpense, FixedPayment, Goal, IncomeEntry, IncomeSource, Reason, VariableCategory
from app.services import cache, clock, cycle_store
from app.services import insights as engine
from app.services.cycles import Span, display_label, month_name, shift_label, short_month
from app.services.ledger import ensure_pending_salary, fixed_amount_for_cycle, fixed_applies

METHOD_LABELS = {"atm": "ATM", "bank_transfer": "Transfer", "card": "Card", "cash": "Cash", "other": "Other"}
WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
SIZE_BUCKETS = [("Small", 0, 100_000), ("Medium", 100_000, 500_000), ("Large", 500_000, 2_000_000), ("Very large", 2_000_000, None)]
FIXED_TARGET = 50.0
HISTORY = 13  # cycles loaded behind the selected one (12 for trends + 1, also covers year-ago)


# ---------------------------------------------------------------- helpers


def pct(part: float, whole: float) -> Optional[float]:
    return round(part / whole * 100, 1) if whole else None


def whole(cents: float) -> int:
    """Estimates are rounded to whole rupees; actual totals never are."""
    return int(round(cents / 100)) * 100


def change(current: float, previous: float, higher_is_good: bool = False) -> dict[str, Any]:
    current, previous = int(round(current)), int(round(previous))
    diff = current - previous
    p = (0.0 if not current else None) if previous == 0 else round(diff / previous * 100, 1)
    good = None if diff == 0 else ((diff > 0) == higher_is_good)
    return {"current": current, "previous": previous, "diff": diff, "pct": p, "is_new": previous == 0 and current > 0, "good": good}


async def _agg(document, pipeline: list[dict]) -> list[dict]:
    return await document.get_motor_collection().aggregate(pipeline).to_list(None)


# ---------------------------------------------------------------- buckets & per-cycle stats


@dataclass
class Buckets:
    exp: list[dict]
    pay: list[dict]
    inc: list[dict]


async def load_buckets(uid: PydanticObjectId, labels: list[str]) -> Buckets:
    match = {"user_id": uid, "deleted_at": None, "cycle": {"$in": labels}}
    exp = await _agg(ExpenseEntry, [
        {"$match": match},
        {"$group": {"_id": {"c": "$cycle", "d": "$day", "k": "$category_id", "r": "$reason_id", "m": "$method"},
                    "t": {"$sum": "$amount"}, "n": {"$sum": 1}}},
    ])
    pay = await _agg(FixedPayment, [
        {"$match": match},
        {"$group": {"_id": {"c": "$cycle", "d": "$day", "f": "$fixed_expense_id"}, "t": {"$sum": "$amount_paid"}, "n": {"$sum": 1}}},
    ])
    inc = await _agg(IncomeEntry, [
        {"$match": {**match, "status": "received"}},
        {"$group": {"_id": {"c": "$cycle", "d": "$day", "s": "$source_id"}, "t": {"$sum": "$amount"}}},
    ])
    return Buckets(exp, pay, inc)


@dataclass
class Stats:
    income: int = 0
    income_by_source: dict = field(default_factory=dict)
    fixed_by_id: dict = field(default_factory=dict)  # bill id -> paid
    pay_day: dict = field(default_factory=dict)  # bill id -> day paid
    var_by_cat: dict = field(default_factory=dict)  # category id -> [total, count]
    bank_reason: dict = field(default_factory=dict)  # reason id -> [total, count]
    bank_method: dict = field(default_factory=dict)  # method -> [total, count]
    reason_method: dict = field(default_factory=dict)  # (reason, method) -> total
    daily: dict = field(default_factory=dict)  # day -> all spending
    var_daily: dict = field(default_factory=dict)  # day -> variable spending

    @property
    def fixed(self) -> int:
        return sum(self.fixed_by_id.values())

    @property
    def variable(self) -> int:
        return sum(t for t, _ in self.var_by_cat.values())

    @property
    def spent(self) -> int:
        return self.fixed + self.variable

    @property
    def bank_total(self) -> int:
        return sum(t for t, _ in self.bank_method.values())

    def cat(self, key) -> int:
        return self.var_by_cat.get(key, [0, 0])[0]


def stats_for(b: Buckets, label: str, cutoff: Optional[date], bank_ids: set) -> Stats:
    s = Stats()
    lim = cutoff.isoformat() if cutoff else None
    for r in b.inc:
        i = r["_id"]
        if i["c"] != label or (lim and i["d"] >= lim):
            continue
        s.income += r["t"]
        s.income_by_source[i["s"]] = s.income_by_source.get(i["s"], 0) + r["t"]
    for r in b.pay:
        i = r["_id"]
        if i["c"] != label or (lim and i["d"] >= lim):
            continue
        s.fixed_by_id[i["f"]] = s.fixed_by_id.get(i["f"], 0) + r["t"]
        s.pay_day.setdefault(i["f"], i["d"])
        s.daily[i["d"]] = s.daily.get(i["d"], 0) + r["t"]
    for r in b.exp:
        i = r["_id"]
        if i["c"] != label or (lim and i["d"] >= lim):
            continue
        t, n = r["t"], r["n"]
        cur = s.var_by_cat.setdefault(i["k"], [0, 0])
        cur[0] += t
        cur[1] += n
        s.daily[i["d"]] = s.daily.get(i["d"], 0) + t
        s.var_daily[i["d"]] = s.var_daily.get(i["d"], 0) + t
        if i["k"] in bank_ids:
            m = i.get("m") or "other"
            rr = s.bank_reason.setdefault(i.get("r"), [0, 0])
            rr[0] += t
            rr[1] += n
            mm = s.bank_method.setdefault(m, [0, 0])
            mm[0] += t
            mm[1] += n
            s.reason_method[(i.get("r"), m)] = s.reason_method.get((i.get("r"), m), 0) + t
    return s


def average(stats: list[Stats]) -> Stats:
    """Element-wise mean of several cycles (the 3-cycle-average comparison)."""
    if not stats:
        return Stats()
    n = len(stats)
    out = Stats(income=round(sum(s.income for s in stats) / n))
    for attr in ("income_by_source", "fixed_by_id", "reason_method", "daily", "var_daily"):
        acc: dict = defaultdict(int)
        for s in stats:
            for k, v in getattr(s, attr).items():
                acc[k] += v
        setattr(out, attr, {k: round(v / n) for k, v in acc.items()})
    for attr in ("var_by_cat", "bank_reason", "bank_method"):
        acc2: dict = defaultdict(lambda: [0, 0])
        for s in stats:
            for k, (t, c) in getattr(s, attr).items():
                acc2[k][0] += t
                acc2[k][1] += c
        setattr(out, attr, {k: [round(t / n), round(c / n)] for k, (t, c) in acc2.items()})
    return out


# ---------------------------------------------------------------- request context


@dataclass
class Ctx:
    cfg: AppSettings
    today: date
    span: Span
    prev: list[Span]  # oldest first
    fixed_expenses: list[FixedExpense]
    categories: list[VariableCategory]
    reasons: list[Reason]
    sources: dict
    budgets: list[Budget]
    goals: list[Goal]
    b: Buckets
    _memo: dict = field(default_factory=dict)

    # -- time
    @property
    def is_current(self) -> bool:
        return self.span.contains(self.today)

    @property
    def is_future(self) -> bool:
        return self.span.start > self.today

    @property
    def day_index(self) -> int:  # 1-based day of cycle (0 for a future cycle)
        if self.is_current:
            return (self.today - self.span.start).days + 1
        return 0 if self.is_future else self.span.days

    @property
    def days_total(self) -> int:
        return self.span.days

    @property
    def days_left(self) -> int:  # days after today
        return self.days_total - self.day_index

    @property
    def elapsed(self) -> float:
        return self.day_index / self.days_total if self.days_total else 0

    @property
    def bank_ids(self) -> set:
        return {c.id for c in self.categories if c.requires_reason}

    # -- stats
    def stats(self, span: Span, cutoff: Optional[date] = None) -> Stats:
        key = (span.label, cutoff)
        if key not in self._memo:
            self._memo[key] = stats_for(self.b, span.label, cutoff, self.bank_ids)
        return self._memo[key]

    @property
    def cur(self) -> Stats:
        return self.stats(self.span)

    def cutoff(self, span: Span) -> Optional[date]:
        return span.start + timedelta(days=self.day_index) if self.is_current else None

    def full_stats(self, spans: list[Span]) -> list[Stats]:
        return [self.stats(s) for s in spans]

    def spark_spans(self, n: int = 6) -> list[Span]:
        return self.prev[-(n - 1):] + [self.span]

    def compare(self, mode: str) -> tuple[Stats, dict]:
        same_day = f", same day {self.day_index}" if self.is_current else ""
        if mode == "avg3":
            spans = self.prev[-3:]
            st = average([self.stats(s, self.cutoff(s)) for s in spans])
            if spans:
                rng = f"{short_month(spans[0].label)}–{display_label(spans[-1].label)}"
                text = f"vs 3-cycle avg ({rng}){', day ' + str(self.day_index) if self.is_current else ''}"
            else:
                text = "vs 3-cycle avg (no history yet)"
            return st, {"mode": mode, "text": text, "name": "your 3-cycle average", "labels": [s.label for s in spans]}
        if mode == "yoy":
            target = shift_label(self.span.label, -12)
            span = next((s for s in self.prev if s.label == target), None)
            st = self.stats(span, self.cutoff(span)) if span else Stats()
            empty = span is None or not (self.stats(span).income or self.stats(span).spent)
            return st, {"mode": mode, "text": f"vs {display_label(target)}{same_day}" + (" (no data)" if empty else ""),
                        "name": display_label(target), "labels": [target]}
        span = self.prev[-1] if self.prev else None
        if span is None:
            return Stats(), {"mode": "last", "text": "vs last cycle (no data)", "name": "last cycle", "labels": []}
        return self.stats(span, self.cutoff(span)), {"mode": "last", "text": f"vs {display_label(span.label)}{same_day}",
                                                     "name": f"{month_name(span.label)}", "labels": [span.label]}

    # -- domain
    def applicable_bills(self, label: str) -> list[FixedExpense]:
        return [fe for fe in self.fixed_expenses if fixed_applies(fe, label)]

    def pending_bills(self, span: Span, st: Stats) -> list[FixedExpense]:
        return [fe for fe in self.applicable_bills(span.label) if fe.id not in st.fixed_by_id]

    def committed(self, span: Span, st: Stats) -> int:
        return sum(fixed_amount_for_cycle(fe, span.label) or 0 for fe in self.pending_bills(span, st))

    @property
    def reserved(self) -> int:
        if not self.is_current:
            return 0
        return sum(g.monthly_reserve for g in self.goals if g.saved_amount < g.target_amount)

    def var_rate(self) -> float:
        return self.cur.variable / max(self.day_index, 1)

    def projected_spend(self) -> int:
        cur = self.cur
        if self.is_current:
            return cur.spent + whole(self.var_rate() * self.days_left) + self.committed(self.span, cur)
        if self.is_future:
            return self.committed(self.span, cur)
        return cur.spent

    def projected_amount(self, amount: int) -> int:
        if not self.is_current:
            return amount
        return amount + whole(amount / max(self.day_index, 1) * self.days_left)

    def group_of(self) -> dict:
        return {fe.id: fe.group for fe in self.fixed_expenses}

    def link(self, key: str) -> str:
        return f"/spending/{key[4:]}" if key.startswith("var:") else ("/bills" if key.startswith("fixed:") else "/spending")


async def build_ctx(cfg: AppSettings, label: Optional[str], back: int = HISTORY) -> Ctx:
    chain, span, prev = await cycle_store.context(cfg, label, back)
    await ensure_pending_salary(cfg.user_id, cfg, span.label)
    uid = cfg.user_id
    ctx = Ctx(
        cfg=cfg,
        today=clock.today(cfg.timezone),
        span=span,
        prev=prev,
        fixed_expenses=await FixedExpense.find(FixedExpense.user_id == uid).sort("sort_order").to_list(),
        categories=await VariableCategory.find(VariableCategory.user_id == uid).sort("sort_order").to_list(),
        reasons=await Reason.find(Reason.user_id == uid).sort("sort_order").to_list(),
        sources={s.id: s for s in await IncomeSource.find(IncomeSource.user_id == uid).to_list()},
        budgets=await Budget.find({"user_id": uid, "deleted_at": None}).to_list(),
        goals=await Goal.find({"user_id": uid, "deleted_at": None}).to_list(),
        b=await load_buckets(uid, [s.label for s in prev] + [span.label]),
    )
    return ctx


async def cached(name: str, cfg: AppSettings, label: Optional[str], extra: str, builder) -> dict:
    today = clock.today(cfg.timezone)
    key = (name, str(cfg.user_id), label or "", extra, today.isoformat(), await cache.data_version())
    hit = cache.get(key)
    if hit is not None:
        return hit
    result = await builder()
    cache.put(key, result)
    return result


# ---------------------------------------------------------------- shared row builders


def meta(ctx: Ctx, cmp_meta: Optional[dict] = None) -> dict[str, Any]:
    s = ctx.span
    return {
        "cycle": s.label,
        "label": display_label(s.label),
        "start": s.start.isoformat(),
        "end": s.end.isoformat(),
        "is_current": ctx.is_current,
        "is_future": ctx.is_future,
        "is_override": s.is_override,
        "day_index": ctx.day_index,
        "days_total": ctx.days_total,
        "days_left": ctx.days_left,
        "elapsed_pct": round(ctx.elapsed * 100),
        "prev_cycle": ctx.prev[-1].label if ctx.prev else None,
        "compare": cmp_meta,
        "history_cycles": sum(1 for st in ctx.full_stats(ctx.prev) if st.income or st.spent),
    }


def category_amounts(ctx: Ctx, st: Stats) -> dict[str, int]:
    """Spending per dashboard category: fixed-bill groups + variable categories."""
    groups = ctx.group_of()
    out: dict[str, int] = defaultdict(int)
    for fid, t in st.fixed_by_id.items():
        out[f"fixed:{groups.get(fid, 'Bills')}"] += t
    for cid, (t, _) in st.var_by_cat.items():
        out[f"var:{cid}"] += t
    return dict(out)


def category_meta(ctx: Ctx) -> dict[str, dict]:
    metas: dict[str, dict] = {}
    for fe in ctx.fixed_expenses:
        metas.setdefault(f"fixed:{fe.group}", {"name": fe.group, "colour": fe.colour, "icon": fe.icon, "kind": "fixed", "need_want": "need"})
    for c in ctx.categories:
        metas[f"var:{c.id}"] = {"name": c.name, "colour": c.colour, "icon": c.icon, "kind": "variable", "id": str(c.id),
                                "archived": not c.is_active, "need_want": c.need_want, "unit": c.unit}
    return metas


def budget_map(ctx: Ctx) -> dict[str, int]:
    return {(f"var:{b.target_id}" if b.target_type == "category" else f"reason:{b.target_id}"): b.amount for b in ctx.budgets}


def spark(ctx: Ctx, fn) -> list[int]:
    return [int(fn(ctx.stats(s))) for s in ctx.spark_spans()]


def reason_name(ctx: Ctx, rid) -> str:
    r = next((x for x in ctx.reasons if x.id == rid), None)
    return r.name if r else "No reason"


# ---------------------------------------------------------------- insights context


async def insight_context(ctx: Ctx, cmp: Stats, cmp_meta: dict) -> engine.InsightContext:
    cur = ctx.cur
    metas = category_meta(ctx)
    budgets = budget_map(ctx)
    closed = [s for s in ctx.prev if s.closed(ctx.today)]
    cats = []
    cur_amounts, cmp_amounts = category_amounts(ctx, cur), category_amounts(ctx, cmp)
    for key, m in metas.items():
        amount, compare_amount = cur_amounts.get(key, 0), cmp_amounts.get(key, 0)
        history = [category_amounts(ctx, ctx.stats(s)).get(key, 0) for s in closed[-6:]]
        if not (amount or compare_amount or any(history)):
            continue
        cats.append(engine.CatStat(key=key, name=m["name"], amount=amount, compare=compare_amount, history=history,
                                   projected=ctx.projected_amount(amount) if m["kind"] == "variable" else amount,
                                   budget=budgets.get(key), kind="fixed" if m["kind"] == "fixed" else "category", link=ctx.link(key)))
    for r in ctx.reasons:
        amount = cur.bank_reason.get(r.id, [0, 0])[0]
        compare_amount = cmp.bank_reason.get(r.id, [0, 0])[0]
        history = [ctx.stats(s).bank_reason.get(r.id, [0, 0])[0] for s in closed[-6:]]
        if not (amount or compare_amount or any(history)):
            continue
        key = f"reason:{r.id}"
        cats.append(engine.CatStat(key=key, name=r.name, amount=amount, compare=compare_amount, history=history,
                                   projected=ctx.projected_amount(amount), budget=budgets.get(key), kind="reason", link="/?tab=spending"))

    # individual entries: this cycle vs the previous 3 cycles' entries of the same category/method
    labels = [s.label for s in ctx.prev[-3:]]
    entries, history_map = [], defaultdict(list)
    names = {c.id: c.name for c in ctx.categories}
    async for e in ExpenseEntry.find({"user_id": ctx.cfg.user_id, "deleted_at": None, "cycle": {"$in": labels + [ctx.span.label]}}):
        key = f"var:{e.category_id}" + (f":{e.method}" if e.category_id in ctx.bank_ids and e.method else "")
        if e.cycle == ctx.span.label:
            entries.append(engine.EntryStat(id=str(e.id), key=key, title=names.get(e.category_id, "Expense"), amount=e.amount,
                                            method=e.method, day=e.day))
        else:
            history_map[key].append(e.amount)

    bills = []
    for fe in ctx.applicable_bills(ctx.span.label):
        paid = cur.fixed_by_id.get(fe.id)
        hist = [ctx.stats(s).fixed_by_id[fe.id] for s in closed[-6:] if fe.id in ctx.stats(s).fixed_by_id]
        bills.append(engine.BillStat(id=str(fe.id), name=fe.name, paid=paid, template=fixed_amount_for_cycle(fe, ctx.span.label) or fe.amount,
                                     avg6=(sum(hist) / len(hist)) if len(hist) >= 3 else None))

    cum_cur = sum(cur.daily.values())
    cum_cmp = sum(cmp.daily.values())
    goal_stats = [goal_stat(ctx, g) for g in ctx.goals]
    income = cur.income
    return engine.InsightContext(
        compare_text=cmp_meta["text"], compare_name=cmp_meta["name"], is_current=ctx.is_current, days_left=ctx.days_left,
        elapsed_frac=ctx.elapsed, income=income, spent=cur.spent, projected_spend=ctx.projected_spend(),
        committed=ctx.committed(ctx.span, cur), pending_count=len(ctx.pending_bills(ctx.span, cur)), categories=cats,
        entries=entries, entry_history=dict(history_map), bills=bills,
        pace_ratio=(cum_cur / cum_cmp) if cum_cmp else None, goals=goal_stats,
        fixed_ratio=pct(cur.fixed + ctx.committed(ctx.span, cur), income) if income else None, fixed_target=FIXED_TARGET,
    )


def avg_savings(ctx: Ctx) -> int:
    closed = [s for s in ctx.prev if s.closed(ctx.today)][-3:]
    vals = [ctx.stats(s).income - ctx.stats(s).spent for s in closed if ctx.stats(s).income]
    return round(sum(vals) / len(vals)) if vals else 0


def goal_stat(ctx: Ctx, g: Goal) -> engine.GoalStat:
    target_day = date.fromisoformat(g.target_date)
    cycles_left = max(1, math.ceil((target_day - ctx.today).days / 30.44))
    remaining = max(0, g.target_amount - g.saved_amount)
    required = math.ceil(remaining / cycles_left) if remaining else 0
    avg = avg_savings(ctx)
    return engine.GoalStat(
        name=g.name, target=g.target_amount, saved=g.saved_amount, required_per_cycle=required, avg_savings=avg,
        on_track=remaining == 0 or avg >= required,
        eta_cycles=engine.cycles_needed(remaining, avg), eta_cycles_plus=engine.cycles_needed(remaining, avg + 500_000),
    )


# ---------------------------------------------------------------- health score


def health(ctx: Ctx, span: Span, st: Stats, hist: list[Stats], elapsed: float, projected: int, projected_var: int) -> dict:
    comps = []
    income = st.income
    if income:
        rate = (income - projected) / income * 100
        comps.append(("savings", "Savings rate", 30, max(0.0, min(100.0, rate / 30 * 100)), f"{rate:.0f}% projected" if elapsed < 1 else f"{rate:.0f}%"))
    else:
        comps.append(("savings", "Savings rate", 30, 0.0, "No income recorded"))
    bills = ctx.applicable_bills(span.label)
    if bills:
        paid = sum(1 for fe in bills if fe.id in st.fixed_by_id)
        score = 100 * (1 - (len(bills) - paid) / len(bills) * min(1.0, elapsed))
        comps.append(("bills", "Bills paid on time", 20, score, f"{paid} of {len(bills)} paid"))
    hist_var = [h.variable for h in hist if h.income or h.spent]
    avg3_var = sum(hist_var) / len(hist_var) if hist_var else 0
    if avg3_var:
        expected = avg3_var * max(elapsed, 0.05)
        ratio = st.variable / expected if expected else 1
        comps.append(("pace", "Spending pace", 20, max(0.0, min(100.0, (2 - ratio) * 100)), f"{ratio * 100:.0f}% of usual pace"))
        r2 = projected_var / avg3_var
        comps.append(("variable", "Variable vs 3-cycle avg", 15, max(0.0, min(100.0, (1.5 - r2) / 0.6 * 100)), f"{r2 * 100:.0f}% of average"))
    elif income:
        spent_frac = st.spent / income
        comps.append(("pace", "Spending pace", 20, max(0.0, min(100.0, (1 - max(0.0, spent_frac - elapsed)) * 100)),
                      f"{spent_frac * 100:.0f}% of income spent"))
    if ctx.budgets:
        ok = 0
        for b in ctx.budgets:
            spent = st.cat(b.target_id) if b.target_type == "category" else st.bank_reason.get(b.target_id, [0, 0])[0]
            proj = spent if elapsed >= 1 else spent / max(elapsed, 0.05)
            ok += proj <= b.amount
        comps.append(("budgets", "Budget adherence", 15, ok / len(ctx.budgets) * 100, f"{ok} of {len(ctx.budgets)} on track"))
    total_w = sum(c[2] for c in comps)
    score = round(sum(c[2] * c[3] for c in comps) / total_w) if total_w else 0
    return {
        "score": score,
        "components": [{"key": k, "label": lbl, "weight": round(w / total_w * 100), "score": round(s), "detail": d} for k, lbl, w, s, d in comps],
    }


# ---------------------------------------------------------------- OVERVIEW


async def overview(cfg: AppSettings, label: Optional[str], mode: str) -> dict:
    async def build():
        ctx = await build_ctx(cfg, label)
        cur = ctx.cur
        cmp, cmp_meta = ctx.compare(mode)
        committed = ctx.committed(ctx.span, cur)
        pending = ctx.pending_bills(ctx.span, cur)
        balance = cur.income - cur.spent
        reserved = ctx.reserved
        safe = balance - committed - reserved
        remaining_days = ctx.days_left + 1 if ctx.is_current else 0
        allowance = whole(safe / remaining_days) if remaining_days and safe > 0 else (0 if remaining_days else None)
        projected = ctx.projected_spend()
        spent_pct = pct(cur.spent, cur.income)
        status = "danger" if safe < 0 else ("warn" if cur.income and safe < cur.income * 0.1 else "ok")

        hero = {
            "safe_to_spend": safe, "balance": balance, "committed": committed, "reserved": reserved, "income": cur.income,
            "spent": cur.spent, "daily_allowance": allowance, "days_remaining": remaining_days, "status": status,
            "elapsed_pct": round(ctx.elapsed * 100), "income_spent_pct": spent_pct,
            "pace_warning": bool(ctx.is_current and spent_pct is not None and spent_pct > ctx.elapsed * 100 + 10),
        }

        # health: this cycle vs previous cycle
        hist = ctx.full_stats(ctx.prev[-3:])
        h_now = health(ctx, ctx.span, cur, hist, ctx.elapsed if ctx.is_current else 1.0, projected,
                       ctx.projected_amount(cur.variable))
        h_prev = None
        if ctx.prev:
            p = ctx.prev[-1]
            pst = ctx.stats(p)
            h_prev = health(ctx, p, pst, ctx.full_stats(ctx.prev[-4:-1]), 1.0, pst.spent, pst.variable)
            prev_by = {c["key"]: c for c in h_prev["components"]}
            deltas = [(c["score"] - prev_by[c["key"]]["score"]) * c["weight"] / 100 for c in h_now["components"] if c["key"] in prev_by]
            keyed = [c for c in h_now["components"] if c["key"] in prev_by]
            if keyed:
                i = max(range(len(keyed)), key=lambda j: abs(deltas[j]))
                d = keyed[i]["score"] - prev_by[keyed[i]["key"]]["score"]
                h_now["top_factor"] = f"{keyed[i]['label']} ({'+' if d >= 0 else '−'}{abs(d)})"
        h_now["prev_score"] = h_prev["score"] if h_prev else None
        h_now["delta"] = h_now["score"] - h_prev["score"] if h_prev else None

        # KPI cards with 6-cycle sparklines
        amounts = category_amounts(ctx, cur)
        metas = category_meta(ctx)
        biggest = max(amounts.items(), key=lambda kv: kv[1], default=(None, 0))
        cmp_amounts = category_amounts(ctx, cmp)
        sr = pct(cur.income - cur.spent, cur.income)
        sr_cmp = pct(cmp.income - cmp.spent, cmp.income)
        prev_days = ctx.day_index if ctx.is_current else (ctx.prev[-1].days if ctx.prev else 1)
        avg_daily = whole(cur.spent / max(ctx.day_index, 1)) if ctx.day_index else 0
        cmp_avg_daily = whole(cmp.spent / max(prev_days, 1))
        cmp_projected_balance = cmp.income - cmp.spent if not ctx.is_current else None
        kpis = [
            {"key": "income", "label": "Income", "value": cur.income, "format": "money", "change": change(cur.income, cmp.income, True),
             "spark": spark(ctx, lambda s: s.income), "good": "up"},
            {"key": "spent", "label": "Total spent", "value": cur.spent, "format": "money", "change": change(cur.spent, cmp.spent),
             "spark": spark(ctx, lambda s: s.spent), "good": "down"},
            {"key": "balance", "label": "Balance", "value": balance, "format": "money",
             "change": change(balance, cmp.income - cmp.spent, True), "spark": spark(ctx, lambda s: s.income - s.spent), "good": "up"},
            {"key": "savings_rate", "label": "Savings rate", "value": sr, "format": "pct",
             "change": {"diff_pts": round(sr - sr_cmp, 1) if sr is not None and sr_cmp is not None else None,
                        "good": None if sr is None or sr_cmp is None or sr == sr_cmp else sr > sr_cmp},
             "spark": spark(ctx, lambda s: round((s.income - s.spent) / s.income * 100) if s.income else 0), "good": "up"},
            {"key": "avg_daily", "label": "Avg daily spend", "value": avg_daily, "format": "money", "change": change(avg_daily, cmp_avg_daily),
             "spark": [whole(ctx.stats(s).spent / (ctx.day_index if s is ctx.span and ctx.is_current else s.days)) for s in ctx.spark_spans()],
             "good": "down"},
            {"key": "projected_balance", "label": "Projected end balance", "value": cur.income - projected, "format": "money",
             "change": change(cur.income - projected, cmp_projected_balance if cmp_projected_balance is not None else
                              (cmp.income - cmp.spent), True),
             "spark": spark(ctx, lambda s: s.income - s.spent), "good": "up"},
            {"key": "pending_bills", "label": "Pending bills", "value": committed, "format": "money", "count": len(pending),
             "change": None, "spark": [len(ctx.pending_bills(s, ctx.stats(s))) for s in ctx.spark_spans()], "good": "down"},
            {"key": "biggest", "label": "Biggest category", "value": biggest[1], "format": "money",
             "name": metas.get(biggest[0], {}).get("name") if biggest[0] else None,
             "change": change(biggest[1], cmp_amounts.get(biggest[0], 0)) if biggest[0] else None,
             "spark": spark(ctx, lambda s: category_amounts(ctx, s).get(biggest[0], 0)) if biggest[0] else [], "good": "down"},
        ]

        # waterfall: salary -> ... -> remaining (sums exactly to income - spent)
        salary = sum(t for sid, t in cur.income_by_source.items() if (ctx.sources.get(sid) and ctx.sources[sid].type == "fixed"))
        steps = [{"label": "Salary", "amount": salary, "kind": "add"}]
        other = cur.income - salary
        if other:
            steps.append({"label": "Other income", "amount": other, "kind": "add"})
        if cur.fixed:
            steps.append({"label": "Fixed bills", "amount": -cur.fixed, "kind": "sub", "key": "fixed"})
        for c in ctx.categories:
            if c.requires_reason:
                continue
            t = cur.cat(c.id)
            if t:
                steps.append({"label": c.name, "amount": -t, "kind": "sub", "colour": c.colour, "key": f"var:{c.id}"})
        for rid, (t, _) in sorted(cur.bank_reason.items(), key=lambda kv: -kv[1][0]):
            steps.append({"label": f"Bank: {reason_name(ctx, rid)}", "amount": -t, "kind": "sub", "key": f"reason:{rid}" if rid else "reason:",
                          "colour": next((r.colour for r in ctx.reasons if r.id == rid), "#9AA3B2")})
        remaining = cur.income - cur.spent
        steps.append({"label": "Remaining", "amount": remaining, "kind": "total"})
        assert sum(s["amount"] for s in steps[:-1]) == remaining

        ictx = await insight_context(ctx, cmp, cmp_meta)
        all_insights = engine.generate(ictx)

        pace_text = None
        if ctx.is_current and spent_pct is not None:
            gap = spent_pct - ctx.elapsed * 100
            pace_text = (f"Spending is running {gap:.0f} points ahead of the calendar." if gap > 10 else
                         f"You can spend {engine.rs(allowance or 0)}/day for {remaining_days} more day{'s' if remaining_days != 1 else ''}.")
        top_out = min((s for s in steps if s["kind"] == "sub"), key=lambda s: s["amount"], default=None)
        return {
            "meta": meta(ctx, cmp_meta),
            "hero": hero,
            "health": h_now,
            "kpis": kpis,
            "waterfall": {"steps": steps, "income": cur.income, "spent": cur.spent, "remaining": remaining,
                          "takeaway": (f"{top_out['label']} took the biggest share of your income ({pct(-top_out['amount'], cur.income) or 0:.0f}%)."
                                       if top_out and cur.income else "Add income and expenses to see where your salary goes.")},
            "alerts": engine.alerts(all_insights),
            "insights": all_insights,
            "pending_bills": [{"id": str(fe.id), "name": fe.name, "amount": fixed_amount_for_cycle(fe, ctx.span.label) or 0,
                               "icon": fe.icon, "colour": fe.colour} for fe in pending],
            "takeaway": pace_text,
        }

    return await cached("overview", cfg, label, mode, build)


# ---------------------------------------------------------------- SPENDING


async def spending(cfg: AppSettings, label: Optional[str], mode: str) -> dict:
    async def build():
        ctx = await build_ctx(cfg, label)
        cur = ctx.cur
        cmp, cmp_meta = ctx.compare(mode)
        metas = category_meta(ctx)
        budgets = budget_map(ctx)
        amounts, cmp_amounts = category_amounts(ctx, cur), category_amounts(ctx, cmp)
        rows = []
        for key, m in metas.items():
            a, c = amounts.get(key, 0), cmp_amounts.get(key, 0)
            sp = [category_amounts(ctx, ctx.stats(s)).get(key, 0) for s in ctx.spark_spans()]
            if not a and not c and not any(sp):
                continue
            budget = budgets.get(key)
            n = cur.var_by_cat.get(PydanticObjectId(m["id"]), [0, 0])[1] if m["kind"] == "variable" else None
            rows.append({"key": key, **m, "amount": a, "count": n, "compare_amount": c, "pct_of_spend": pct(a, cur.spent),
                         "pct_of_income": pct(a, cur.income), "change": change(a, c), "spark": sp, "budget": budget,
                         "budget_used_pct": pct(a, budget) if budget else None})
        rows.sort(key=lambda r: r["amount"], reverse=True)

        # Bank & Cash
        reasons = []
        for r in ctx.reasons:
            t, n = cur.bank_reason.get(r.id, [0, 0])
            ct = cmp.bank_reason.get(r.id, [0, 0])[0]
            if t or ct:
                reasons.append({"id": str(r.id), "name": r.name, "colour": r.colour, "icon": r.icon, "amount": t, "count": n,
                                "pct": pct(t, cur.bank_total), "change": change(t, ct), "budget": budgets.get(f"reason:{r.id}")})
        if None in cur.bank_reason:
            t, n = cur.bank_reason[None]
            reasons.append({"id": None, "name": "No reason", "colour": "#9AA3B2", "icon": "tag", "amount": t, "count": n,
                            "pct": pct(t, cur.bank_total), "change": change(t, cmp.bank_reason.get(None, [0, 0])[0])})
        reasons.sort(key=lambda r: r["amount"], reverse=True)
        methods = []
        for m in ("atm", "bank_transfer", "card"):
            t, n = cur.bank_method.get(m, [0, 0])
            methods.append({"method": m, "label": METHOD_LABELS[m], "amount": t, "count": n, "avg": whole(t / n) if n else 0,
                            "pct": pct(t, cur.bank_total), "change": change(t, cmp.bank_method.get(m, [0, 0])[0])})
        matrix_reasons = [r for r in reasons if r["amount"]]
        matrix = {
            "reasons": [r["name"] for r in matrix_reasons],
            "methods": [METHOD_LABELS[m] for m in ("atm", "bank_transfer", "card")],
            "cells": [[cur.reason_method.get((PydanticObjectId(r["id"]) if r["id"] else None, m), 0) for m in ("atm", "bank_transfer", "card")]
                      for r in matrix_reasons],
        }

        # movers (categories + reasons)
        movable = [{"name": r["name"], "diff": r["change"]["diff"], "pct": r["change"]["pct"], "is_new": r["change"]["is_new"],
                    "link": ctx.link(r["key"])} for r in rows]
        movable += [{"name": f"Bank: {r['name']}", "diff": r["change"]["diff"], "pct": r["change"]["pct"], "is_new": r["change"]["is_new"],
                     "link": "/spending"} for r in reasons]
        ups = sorted([m for m in movable if m["diff"] > 0], key=lambda m: -m["diff"])[:3]
        downs = sorted([m for m in movable if m["diff"] < 0], key=lambda m: m["diff"])[:3]
        total_up = sum(m["diff"] for m in movable if m["diff"] > 0)

        # patterns (variable spending only, over elapsed days)
        span = ctx.span
        last_day = span.start + timedelta(days=max(ctx.day_index, 1) - 1) if ctx.is_current else span.end
        days = [span.start + timedelta(days=i) for i in range((last_day - span.start).days + 1)]
        by_dow_total, by_dow_n = [0] * 7, [0] * 7
        for d in days:
            by_dow_n[d.weekday()] += 1
            by_dow_total[d.weekday()] += cur.var_daily.get(d.isoformat(), 0)
        weekday = [{"dow": WEEKDAYS[i], "avg": whole(by_dow_total[i] / by_dow_n[i]) if by_dow_n[i] else 0, "total": by_dow_total[i]}
                   for i in range(7)]
        top_dow = max(range(7), key=lambda i: weekday[i]["avg"])
        others = [w["avg"] for i, w in enumerate(weekday) if i != top_dow and by_dow_n[i]]
        other_avg = sum(others) / len(others) if others else 0
        dow_text = (f"You spend {weekday[top_dow]['avg'] / other_avg:.1f}× more on {WEEKDAYS[top_dow]}s than other days."
                    if other_avg and weekday[top_dow]["avg"] > other_avg * 1.3 else "Your spending is fairly even across the week.")
        wk_days = [d for d in days if d.weekday() < 5]
        we_days = [d for d in days if d.weekday() >= 5]
        wk = sum(cur.var_daily.get(d.isoformat(), 0) for d in wk_days)
        we = sum(cur.var_daily.get(d.isoformat(), 0) for d in we_days)
        half = span.start + timedelta(days=span.days // 2)
        first = sum(t for d, t in cur.var_daily.items() if d < half.isoformat())
        second = sum(t for d, t in cur.var_daily.items() if d >= half.isoformat())
        heat = [{"day": (span.start + timedelta(days=i)).isoformat(), "amount": cur.daily.get((span.start + timedelta(days=i)).isoformat(), 0)}
                for i in range(span.days)]

        # individual entries: sizes, top 10, frequency
        entries = await ExpenseEntry.find({"user_id": cfg.user_id, "cycle": span.label, "deleted_at": None}).to_list()
        names = {c.id: c for c in ctx.categories}
        sizes = []
        for name, lo, hi in SIZE_BUCKETS:
            sel = [e.amount for e in entries if e.amount >= lo and (hi is None or e.amount < hi)]
            sizes.append({"label": name, "min": lo, "max": hi, "count": len(sel), "total": sum(sel)})
        top10 = [{"id": str(e.id), "amount": e.amount, "day": e.day, "category": names[e.category_id].name if e.category_id in names else "",
                  "colour": names[e.category_id].colour if e.category_id in names else "#9AA3B2",
                  "reason": reason_name(ctx, e.reason_id) if e.reason_id else None, "method": e.method, "note": e.note,
                  "category_id": str(e.category_id)}
                 for e in sorted(entries, key=lambda e: -e.amount)[:10]]
        frequency = []
        for c in ctx.categories:
            t, n = cur.var_by_cat.get(c.id, [0, 0])
            if n and not c.requires_reason:
                frequency.append({"name": c.name, "unit": c.unit, "count": n, "avg": whole(t / n), "total": t})
        atm = cur.bank_method.get("atm", [0, 0])
        if atm[1]:
            frequency.append({"name": "ATM withdrawals", "unit": "withdrawals", "count": atm[1], "avg": whole(atm[0] / atm[1]), "total": atm[0]})

        driver = ups[0] if ups and total_up else None
        return {
            "meta": meta(ctx, cmp_meta),
            "total": cur.spent,
            "income": cur.income,
            "change": change(cur.spent, cmp.spent),
            "takeaway": (f"{driver['name']} drove {driver['diff'] / total_up * 100:.0f}% of your increase {cmp_meta['text']}." if driver
                         else f"No category is up {cmp_meta['text']}."),
            "categories": rows,
            "bank": {"total": cur.bank_total, "change": change(cur.bank_total, cmp.bank_total), "reasons": reasons, "methods": methods,
                     "matrix": matrix, "count": sum(n for _, n in cur.bank_method.values())},
            "movers": {"up": ups, "down": downs},
            "patterns": {"weekday": weekday, "takeaway": dow_text,
                         "weekday_vs_weekend": {"weekday": wk, "weekend": we, "weekday_daily": whole(wk / len(wk_days)) if wk_days else 0,
                                                "weekend_daily": whole(we / len(we_days)) if we_days else 0},
                         "halves": {"first": first, "second": second, "split_day": half.isoformat()}},
            "heat": heat,
            "sizes": sizes,
            "top10": top10,
            "frequency": frequency,
        }

    return await cached("spending", cfg, label, mode, build)


# ---------------------------------------------------------------- BILLS


async def bills(cfg: AppSettings, label: Optional[str], months: int) -> dict:
    async def build():
        ctx = await build_ctx(cfg, label)
        cur = ctx.cur
        spans = (ctx.prev + [ctx.span])[-months:]
        closed = [s for s in ctx.prev if s.closed(ctx.today)]
        items, series, timing, annual, tva = [], [], [], [], []
        applicable = ctx.applicable_bills(ctx.span.label)
        for fe in ctx.fixed_expenses:
            if fe not in applicable and fe.id not in cur.fixed_by_id and not fe.is_active:
                continue
            template = fixed_amount_for_cycle(fe, ctx.span.label) or fe.amount
            paid = cur.fixed_by_id.get(fe.id)
            pay_day = cur.pay_day.get(fe.id)
            items.append({"id": str(fe.id), "name": fe.name, "group": fe.group, "icon": fe.icon, "colour": fe.colour, "template": template,
                          "status": "paid" if paid is not None else "pending", "paid_amount": paid, "paid_day": pay_day,
                          "day_of_cycle": (date.fromisoformat(pay_day) - ctx.span.start).days + 1 if pay_day else None})
            pts = []
            for s in spans:
                st = ctx.stats(s)
                pts.append({"cycle": s.label, "label": short_month(s.label), "amount": st.fixed_by_id.get(fe.id)})
            hist6 = [ctx.stats(s).fixed_by_id[fe.id] for s in closed[-6:] if fe.id in ctx.stats(s).fixed_by_id]
            avg6 = round(sum(hist6) / len(hist6)) if hist6 else None
            latest = paid if paid is not None else (hist6[-1] if hist6 else None)
            series.append({"id": str(fe.id), "name": fe.name, "colour": fe.colour, "points": pts, "avg6": avg6, "latest": latest,
                           "above_avg_pct": round((latest / avg6 - 1) * 100, 1) if latest and avg6 else None,
                           "flag": bool(latest and avg6 and latest > avg6 * 1.10)})
            days_paid = []
            for s in spans:
                d = ctx.stats(s).pay_day.get(fe.id)
                if d:
                    days_paid.append((date.fromisoformat(d) - s.start).days + 1)
            timing.append({"id": str(fe.id), "name": fe.name, "avg_day": round(sum(days_paid) / len(days_paid), 1) if days_paid else None,
                           "samples": len(days_paid)})
            if fe.is_active:
                annual.append({"id": str(fe.id), "name": fe.name, "colour": fe.colour, "monthly": fe.amount, "annual": fe.amount * 12})
            tmpl6 = [fixed_amount_for_cycle(fe, s.label) or 0 for s in closed[-6:] if fe.id in ctx.stats(s).fixed_by_id]
            tva.append({"id": str(fe.id), "name": fe.name, "template": template, "actual": paid,
                        "avg_template": round(sum(tmpl6) / len(tmpl6)) if tmpl6 else None, "avg_actual": avg6})
        annual.sort(key=lambda a: -a["annual"])
        ratio = []
        for s in spans:
            st = ctx.stats(s)
            fixed = st.fixed + (ctx.committed(s, st) if s is ctx.span else 0)
            ratio.append({"cycle": s.label, "label": short_month(s.label), "fixed": fixed, "income": st.income, "ratio": pct(fixed, st.income)})
        paid_n = sum(1 for i in items if i["status"] == "paid")
        flagged = [s for s in series if s["flag"]]
        top_annual = annual[0] if annual else None
        cur_ratio = ratio[-1]["ratio"] if ratio else None
        return {
            "meta": meta(ctx),
            "status": {"paid_count": paid_n, "total_count": len(items), "paid_amount": cur.fixed,
                       "pending_amount": ctx.committed(ctx.span, cur), "items": items},
            "trends": series,
            "trend_takeaway": (f"{flagged[0]['name']} is {flagged[0]['above_avg_pct']:.0f}% above its 6-cycle average." if flagged
                               else "No bill is running more than 10% above its usual level."),
            "fixed_ratio": {"series": ratio, "target": FIXED_TARGET, "current": cur_ratio,
                            "takeaway": (f"Fixed costs take {cur_ratio:.0f}% of income ({'above' if cur_ratio > FIXED_TARGET else 'within'} the {FIXED_TARGET:.0f}% target)."
                                         if cur_ratio is not None else "Add income to see your fixed-cost ratio.")},
            "timing": timing,
            "annual": {"items": annual, "total": sum(a["annual"] for a in annual),
                       "takeaway": f"{top_annual['name']} costs {engine.rs(top_annual['annual'])}/year." if top_annual else ""},
            "template_vs_actual": tva,
        }

    return await cached("bills", cfg, label, str(months), build)


# ---------------------------------------------------------------- TRENDS


async def trends(cfg: AppSettings, label: Optional[str], months: int) -> dict:
    async def build():
        ctx = await build_ctx(cfg, label)
        spans = (ctx.prev + [ctx.span])[-months:]
        metas = category_meta(ctx)
        rows, mix = [], []
        prev_spent = None
        for s in spans:
            st = ctx.stats(s)
            amounts = category_amounts(ctx, st)
            top = max(amounts.items(), key=lambda kv: kv[1], default=(None, 0))
            saved = st.income - st.spent
            rows.append({"cycle": s.label, "label": display_label(s.label), "short": short_month(s.label), "income": st.income,
                         "spent": st.spent, "saved": saved, "savings_rate": pct(saved, st.income),
                         "top_category": metas.get(top[0], {}).get("name") if top[0] else None,
                         "change_pct": round((st.spent - prev_spent) / prev_spent * 100, 1) if prev_spent else None,
                         "closed": s.closed(ctx.today), "has_data": bool(st.income or st.spent)})
            mix.append(amounts)
            prev_spent = st.spent
        with_data = [r for r in rows if r["has_data"]]
        locked = len(with_data) < 2
        keys = [k for k in metas if any(m.get(k) for m in mix)]

        # pace
        def cum(span: Span) -> list[int]:
            st = ctx.stats(span)
            arr = [0] * span.days
            for d, t in st.daily.items():
                arr[span.day_index(date.fromisoformat(d))] += t
            out, run = [], 0
            for v in arr:
                run += v
                out.append(run)
            return out

        cur_cum = cum(ctx.span)[: ctx.day_index] if ctx.is_current else cum(ctx.span)
        last_cum = cum(ctx.prev[-1]) if ctx.prev else []
        past = [cum(s) for s in ctx.prev[-3:] if ctx.stats(s).spent]
        avg3 = [round(sum(a[min(i, len(a) - 1)] for a in past) / len(past)) for i in range(ctx.days_total)] if past else None

        # net-worth flow: every stored cycle with data, oldest first
        uid = cfg.user_id
        totals: dict[str, dict] = defaultdict(lambda: {"income": 0, "spent": 0})
        for document, fld, key, extra in ((IncomeEntry, "$amount", "income", {"status": "received"}),
                                          (FixedPayment, "$amount_paid", "spent", {}), (ExpenseEntry, "$amount", "spent", {})):
            for r in await _agg(document, [{"$match": {"user_id": uid, "deleted_at": None, **extra}},
                                           {"$group": {"_id": "$cycle", "t": {"$sum": fld}}}]):
                totals[r["_id"]][key] += r["t"]
        running, networth = 0, []
        for lbl in sorted(k for k in totals if k <= ctx.span.label):
            running += totals[lbl]["income"] - totals[lbl]["spent"]
            networth.append({"cycle": lbl, "label": short_month(lbl) + " " + lbl[2:4], "saved": totals[lbl]["income"] - totals[lbl]["spent"],
                             "cumulative": running})

        closed_rows = [r for r in rows if r["closed"] and r["income"]]
        def what_differs(r: dict) -> str:
            idx = next(i for i, x in enumerate(rows) if x["cycle"] == r["cycle"])
            avg = defaultdict(float)
            for m in mix:
                for k, v in m.items():
                    avg[k] += v / len(mix)
            k, dev = max(((k, mix[idx].get(k, 0) - avg[k]) for k in keys), key=lambda kv: abs(kv[1]), default=(None, 0))
            if not k:
                return ""
            return f"{metas[k]['name']} was {engine.rs(abs(dev))} {'above' if dev > 0 else 'below'} average"
        best = max(closed_rows, key=lambda r: r["saved"], default=None)
        worst = min(closed_rows, key=lambda r: r["saved"], default=None)

        year = ctx.span.label[:4]
        ytd_rows = [r for r in rows if r["cycle"].startswith(year)]
        ytd_cat: dict[str, int] = defaultdict(int)
        for r, m in zip(rows, mix):
            if r["cycle"].startswith(year):
                for k, v in m.items():
                    ytd_cat[k] += v
        top_ytd = max(ytd_cat.items(), key=lambda kv: kv[1], default=(None, 0))
        ytd_saved = sum(r["saved"] for r in ytd_rows)
        last2 = with_data[-2:]
        return {
            "meta": meta(ctx),
            "locked": locked,
            "unlock_message": "Trends unlock after 2 cycles of data." if locked else None,
            "rows": rows,
            "takeaway": (f"You saved {engine.rs(last2[-1]['saved'])} in {last2[-1]['label']}, "
                         f"{'up' if last2[-1]['saved'] >= last2[0]['saved'] else 'down'} from {engine.rs(last2[0]['saved'])} in {last2[0]['label']}."
                         if len(last2) == 2 else "Keep logging — trends appear after two cycles."),
            "mix": {"categories": [{"key": k, "name": metas[k]["name"], "colour": metas[k]["colour"]} for k in keys],
                    "series": [{"cycle": r["cycle"], "short": r["short"], "values": [m.get(k, 0) for k in keys]} for r, m in zip(rows, mix)]},
            "pace": {"days": ctx.days_total, "current": cur_cum, "previous": last_cum, "avg3": avg3,
                     "prev_label": display_label(ctx.prev[-1].label) if ctx.prev else None},
            "networth": networth,
            "best": {**best, "why": what_differs(best)} if best else None,
            "worst": {**worst, "why": what_differs(worst)} if worst else None,
            "ytd": {"year": year, "income": sum(r["income"] for r in ytd_rows), "spent": sum(r["spent"] for r in ytd_rows),
                    "saved": ytd_saved, "avg_monthly_savings": round(ytd_saved / len(ytd_rows)) if ytd_rows else 0,
                    "biggest_category": metas[top_ytd[0]]["name"] if top_ytd[0] else None, "biggest_amount": top_ytd[1],
                    "cycles": len(ytd_rows)},
        }

    return await cached("trends", cfg, label, str(months), build)


# ---------------------------------------------------------------- PLAN


def _budget_rows(ctx: Ctx, extra: Optional[dict] = None) -> list[dict]:
    """Budgets with state. `extra` simulates an additional spend {key: amount}."""
    cur = ctx.cur
    out = []
    for b in ctx.budgets:
        if b.target_type == "category":
            target = next((c for c in ctx.categories if c.id == b.target_id), None)
            spent = cur.cat(b.target_id)
            key = f"var:{b.target_id}"
        else:
            target = next((r for r in ctx.reasons if r.id == b.target_id), None)
            spent = cur.bank_reason.get(b.target_id, [0, 0])[0]
            key = f"reason:{b.target_id}"
        if target is None:
            continue
        spent += (extra or {}).get(key, 0)
        p = spent / b.amount * 100
        state = "over" if p > 100 else ("near" if p >= 80 else "ok")
        out.append({"id": str(b.id), "target_type": b.target_type, "target_id": str(b.target_id), "key": key, "name": target.name,
                    "colour": target.colour, "icon": target.icon, "amount": b.amount, "spent": spent, "remaining": b.amount - spent,
                    "pct": round(p, 1), "pace_pct": round(ctx.elapsed * 100), "state": state,
                    "projected": ctx.projected_amount(spent)})
    return sorted(out, key=lambda r: -r["pct"])


def _forecast(ctx: Ctx) -> dict:
    cur = ctx.cur
    committed = ctx.committed(ctx.span, cur)
    hist = [ctx.stats(s) for s in ctx.prev[-3:] if ctx.stats(s).spent]
    hist_rate = (sum(h.variable for h in hist) / sum(s.days for s in ctx.prev[-3:] if ctx.stats(s).spent)) if hist else None
    pace_rate = ctx.var_rate()
    if hist_rate is None:
        lo, likely, hi = pace_rate * 0.85, pace_rate, pace_rate * 1.15
    else:
        lo, hi = min(pace_rate, hist_rate), max(pace_rate, hist_rate) * 1.15
        likely = (pace_rate + hist_rate) / 2
    daily = [0] * ctx.days_total
    for d, t in cur.daily.items():
        daily[ctx.span.day_index(date.fromisoformat(d))] += t
    actual, run = [], 0
    for i in range(ctx.day_index if ctx.is_current else ctx.days_total):
        run += daily[i]
        actual.append(run)
    start = actual[-1] if actual else 0

    def line(rate: float) -> list[Optional[int]]:
        out: list[Optional[int]] = [None] * max(len(actual) - 1, 0)
        out.append(start)
        for i in range(1, ctx.days_left + 1):
            out.append(whole(start + committed + rate * i))
        return out

    ends = {k: whole(cur.spent + committed + r * ctx.days_left) for k, r in (("low", lo), ("likely", likely), ("high", hi))}
    return {
        "days": ctx.days_total, "actual": actual, "low": line(lo), "likely": line(likely), "high": line(hi),
        "end_spend": ends, "end_balance": {k: cur.income - v for k, v in ends.items()},
        "so_far": cur.spent, "pending_bills": committed, "income": cur.income,
        "takeaway": (f"Likely end-of-cycle balance: {engine.rs(cur.income - ends['likely'])} "
                     f"(range {engine.rs(cur.income - ends['high'])} to {engine.rs(cur.income - ends['low'])})."),
    }


def _fifty(ctx: Ctx) -> dict:
    cur = ctx.cur
    needs = cur.fixed + ctx.committed(ctx.span, cur)
    wants = 0
    for c in ctx.categories:
        if c.requires_reason:
            continue
        t = ctx.projected_amount(cur.cat(c.id))
        if c.need_want == "need":
            needs += t
        else:
            wants += t
    for r in ctx.reasons:
        t = ctx.projected_amount(cur.bank_reason.get(r.id, [0, 0])[0])
        if r.need_want == "need":
            needs += t
        else:
            wants += t
    wants += ctx.projected_amount(cur.bank_reason.get(None, [0, 0])[0])
    income = cur.income
    savings = income - needs - wants
    def item(key, amount, target, ok):
        p = pct(amount, income)
        return {"key": key, "amount": amount, "pct": p, "target": target,
                "status": None if p is None else ("ok" if ok(p) else "off")}
    return {"income": income, "projected": ctx.is_current,
            "buckets": [item("needs", needs, 50, lambda p: p <= 50), item("wants", wants, 30, lambda p: p <= 30),
                        item("savings", savings, 20, lambda p: p >= 20)]}


async def plan(cfg: AppSettings, label: Optional[str]) -> dict:
    async def build():
        ctx = await build_ctx(cfg, label)
        cmp, cmp_meta = ctx.compare("avg3")
        ictx = await insight_context(ctx, cmp, cmp_meta)
        goals = []
        for g in ctx.goals:
            gs = goal_stat(ctx, g)
            goals.append({"id": str(g.id), "name": g.name, "target_amount": g.target_amount, "target_date": g.target_date,
                          "saved_amount": g.saved_amount, "monthly_reserve": g.monthly_reserve,
                          "progress_pct": round(min(100, g.saved_amount / g.target_amount * 100), 1),
                          "required_per_cycle": gs.required_per_cycle, "avg_savings": gs.avg_savings, "on_track": gs.on_track,
                          "eta_cycles": gs.eta_cycles})
        budgets = _budget_rows(ctx)
        over = [b for b in budgets if b["state"] == "over"]
        return {
            "meta": meta(ctx, cmp_meta),
            "budgets": budgets,
            "budget_takeaway": (f"{over[0]['name']} is over budget." if over else
                                (f"{len(budgets)} budget{'s' if len(budgets) != 1 else ''} on track." if budgets else
                                 "Set a monthly limit for a category to track it here.")),
            "forecast": _forecast(ctx),
            "goals": goals,
            "recommendations": engine.recommendations(ictx),
            "fifty": _fifty(ctx),
        }

    return await cached("plan", cfg, label, "", build)


async def simulate(cfg: AppSettings, amount: int, category_id: PydanticObjectId, reason_id: Optional[PydanticObjectId], day: date) -> dict:
    """'Can I afford it?' — read-only what-if against the cycle the date belongs to."""
    target = await cycle_store.resolve(cfg, day)
    ctx = await build_ctx(cfg, target.label)
    cur = ctx.cur
    committed = ctx.committed(ctx.span, cur)
    safe_before = cur.income - cur.spent - committed - ctx.reserved
    safe_after = safe_before - amount
    remaining_days = ctx.days_left + 1 if ctx.is_current else max(ctx.days_total, 1)
    extra = {f"var:{category_id}": amount}
    if reason_id:
        extra[f"reason:{reason_id}"] = amount
    before = {b["key"]: b for b in _budget_rows(ctx)}
    impact = []
    for b in _budget_rows(ctx, extra):
        if b["key"] in extra:
            impact.append({"name": b["name"], "amount": b["amount"], "before_pct": before[b["key"]]["pct"], "after_pct": b["pct"],
                           "state": b["state"], "remaining_after": b["remaining"]})
    proj_before = cur.income - ctx.projected_spend()
    verdict = "no" if safe_after < 0 else ("tight" if cur.income and safe_after < cur.income * 0.1 else "yes")
    return {
        "cycle": ctx.span.label,
        "cycle_display": display_label(ctx.span.label),
        "is_current": ctx.is_current,
        "amount": amount,
        "safe_before": safe_before,
        "safe_after": safe_after,
        "daily_before": whole(safe_before / remaining_days) if safe_before > 0 else 0,
        "daily_after": whole(safe_after / remaining_days) if safe_after > 0 else 0,
        "projected_balance_before": proj_before,
        "projected_balance_after": proj_before - amount,
        "budgets": impact,
        "verdict": verdict,
        "message": {"yes": "Yes — you can afford this and still cover your bills.",
                    "tight": "You can, but it leaves very little until payday.",
                    "no": f"Not without missing bills: you'd be {engine.rs(-safe_after)} short."}[verdict],
    }
