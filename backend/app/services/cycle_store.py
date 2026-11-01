"""Persistence for budget cycles (`cycles` collection) and cycle resolution.

All attribution goes through here: the server resolves an entry's date to the stored
cycle containing it. New cycles are created by extending the stored chain, so once a
cycle exists its boundaries only change through an explicit override or a salary-day
change (which never touches closed cycles).
"""

from dataclasses import replace
from datetime import date, timedelta
from typing import Optional

from pymongo.errors import DuplicateKeyError

from app.models import AppSettings, CycleDoc, ExpenseEntry, FixedExpense, FixedPayment, IncomeEntry, IncomeSource, VariableCategory
from app.services import clock
from app.services.cycles import Chain, Span, display_label, local_day_to_utc, replan_for_salary_day, short_month


def salary_for(cfg: AppSettings, label: str) -> int:
    applicable = [h for h in cfg.salary_history if h.effective_from_cycle <= label]
    if not applicable:
        return cfg.salary_history[0].amount if cfg.salary_history else 0
    return max(applicable, key=lambda h: h.effective_from_cycle).amount


def _span(doc: CycleDoc) -> Span:
    return Span(
        label=doc.label,
        start=date.fromisoformat(doc.start_date),
        end=date.fromisoformat(doc.end_date),
        is_override=doc.is_override,
        salary_amount=doc.salary_amount,
    )


async def load_chain(cfg: AppSettings) -> Chain:
    today = clock.today(cfg.timezone)
    coll = CycleDoc.get_motor_collection()
    await coll.update_many(
        {"user_id": cfg.user_id, "closed": False, "end_date": {"$lt": today.isoformat()}}, {"$set": {"closed": True}}
    )
    docs = await CycleDoc.find(CycleDoc.user_id == cfg.user_id).sort("start_date").to_list()
    return Chain([_span(d) for d in docs], cfg.salary_day)


async def persist(cfg: AppSettings, chain: Chain) -> None:
    today = clock.today(cfg.timezone)
    for span in chain.added:
        span.salary_amount = salary_for(cfg, span.label)
        try:
            await CycleDoc(
                user_id=cfg.user_id,
                label=span.label,
                start_date=span.start.isoformat(),
                end_date=span.end.isoformat(),
                salary_amount=span.salary_amount,
                is_override=span.is_override,
                closed=span.end < today,
            ).insert()
        except DuplicateKeyError:
            pass  # created concurrently by another request
    chain.added.clear()


async def resolve(cfg: AppSettings, day: date, chain: Optional[Chain] = None) -> Span:
    chain = chain or await load_chain(cfg)
    span = chain.find(day)
    await persist(cfg, chain)
    return span


async def current(cfg: AppSettings, chain: Optional[Chain] = None) -> Span:
    return await resolve(cfg, clock.today(cfg.timezone), chain)


async def by_label(cfg: AppSettings, label: Optional[str], chain: Optional[Chain] = None) -> Span:
    chain = chain or await load_chain(cfg)
    if not label:
        return await current(cfg, chain)
    await current(cfg, chain)  # make sure the chain is seeded
    span = chain.find_label(label)
    await persist(cfg, chain)
    return span


async def context(cfg: AppSettings, label: Optional[str], back: int) -> tuple[Chain, Span, list[Span]]:
    """The selected cycle plus up to `back` previous cycles (oldest first)."""
    chain = await load_chain(cfg)
    span = await by_label(cfg, label, chain)
    previous = chain.previous(span, back)
    await persist(cfg, chain)
    return chain, span, previous


def describe(span: Span, today: date) -> dict:
    return {
        "label": span.label,
        "display": display_label(span.label),
        "short": short_month(span.label),
        "start_date": span.start.isoformat(),
        "end_date": span.end.isoformat(),
        "days": span.days,
        "salary_amount": span.salary_amount,
        "is_override": span.is_override,
        "closed": span.closed(today),
        "is_current": span.contains(today),
    }


# ---------------------------------------------------------------- re-attribution

_ENTRY_KINDS = (("income", IncomeEntry), ("expense", ExpenseEntry), ("bill", FixedPayment))


async def _titles(cfg: AppSettings) -> dict:
    out: dict = {}
    for document in (IncomeSource, VariableCategory, FixedExpense):
        for d in await document.find({"user_id": cfg.user_id}).to_list():
            out[d.id] = d.name
    return out


async def reassign(cfg: AppSettings, chain: Chain, from_day: date, to_day: Optional[date] = None, dry_run: bool = False) -> list[dict]:
    """Re-resolve every entry dated in [from_day, to_day] against `chain`. Returns the moves."""
    query: dict = {"$gte": from_day.isoformat()}
    if to_day is not None:
        query["$lte"] = to_day.isoformat()
    titles = await _titles(cfg)
    moves: list[dict] = []
    for kind, document in _ENTRY_KINDS:
        async for doc in document.find({"user_id": cfg.user_id, "deleted_at": None, "day": query}):
            new_label = chain.find(date.fromisoformat(doc.day)).label
            if new_label == doc.cycle:
                continue
            ref = getattr(doc, "category_id", None) or getattr(doc, "source_id", None) or getattr(doc, "fixed_expense_id", None)
            moves.append(
                {
                    "kind": kind,
                    "id": str(doc.id),
                    "day": doc.day,
                    "amount": getattr(doc, "amount", None) or getattr(doc, "amount_paid", 0),
                    "title": titles.get(ref, kind.title()),
                    "from": doc.cycle,
                    "to": new_label,
                    "from_display": display_label(doc.cycle),
                    "to_display": display_label(new_label),
                }
            )
            if not dry_run:
                await document.get_motor_collection().update_one({"_id": doc.id}, {"$set": {"cycle": new_label}})
    moves.sort(key=lambda m: m["day"])
    return moves


# ---------------------------------------------------------------- salary-day change & overrides


async def plan_salary_day(cfg: AppSettings, new_day: int) -> tuple[Chain, Span, Span, list[dict]]:
    """Dry run: the re-planned chain and the entries that would move."""
    chain = await load_chain(cfg)
    cur = await current(cfg, chain)
    new_chain = replan_for_salary_day(chain, cur, new_day)
    new_cur = new_chain.find(cur.start)
    moves = await reassign(cfg, new_chain, cur.start, dry_run=True)
    return new_chain, cur, new_cur, moves


async def apply_salary_day(cfg: AppSettings, new_day: int) -> list[dict]:
    new_chain, cur, new_cur, _ = await plan_salary_day(cfg, new_day)
    coll = CycleDoc.get_motor_collection()
    await coll.delete_many({"user_id": cfg.user_id, "start_date": {"$gt": cur.start.isoformat()}})
    await coll.update_one({"user_id": cfg.user_id, "label": cur.label}, {"$set": {"end_date": new_cur.end.isoformat()}})
    cfg.salary_day = new_day
    await cfg.save()
    # every regenerated cycle after the current one must be (re)inserted
    new_chain.added = [s for s in new_chain.spans if s.start > cur.start]
    moves = await reassign(cfg, new_chain, cur.start)  # may extend the chain further for future-dated entries
    await persist(cfg, new_chain)
    await current(cfg)
    return moves


class OverrideError(ValueError):
    pass


async def override_start(cfg: AppSettings, label: str, new_start: date) -> tuple[Span, list[dict]]:
    """Early/late salary: move the start of `label` (and the end of the cycle before it)."""
    chain = await load_chain(cfg)
    await current(cfg, chain)
    span = chain.find_label(label)
    if span.label != label:
        raise OverrideError("Unknown cycle.")
    today = clock.today(cfg.timezone)
    if span.closed(today):
        raise OverrideError("Closed cycles keep their boundaries.")
    prev = chain.previous(span, 1)[0]
    if not (prev.start + timedelta(days=7) < new_start < span.end - timedelta(days=7)):
        raise OverrideError("The new start must be within a few days of the usual salary date.")
    if abs((new_start - span.start).days) > 10 and not span.is_override:
        raise OverrideError("The new start must be within 10 days of the usual salary date.")
    old_start = span.start
    coll = CycleDoc.get_motor_collection()
    await coll.update_one(
        {"user_id": cfg.user_id, "label": span.label}, {"$set": {"start_date": new_start.isoformat(), "is_override": True}}
    )
    await coll.update_one(
        {"user_id": cfg.user_id, "label": prev.label}, {"$set": {"end_date": (new_start - timedelta(days=1)).isoformat()}}
    )
    await persist(cfg, chain)
    # the auto-created pending salary sits on the cycle start: move it with the start
    await IncomeEntry.get_motor_collection().update_many(
        {"user_id": cfg.user_id, "cycle": span.label, "status": "pending", "day": old_start.isoformat()},
        {"$set": {"day": new_start.isoformat(), "date": local_day_to_utc(new_start, cfg.timezone)}},
    )
    fresh = await load_chain(cfg)
    lo, hi = min(old_start, new_start), max(old_start, new_start)
    moves = await reassign(cfg, fresh, lo, hi)
    return replace(span, start=new_start, is_override=True), moves


async def update_open_cycle_salaries(cfg: AppSettings) -> None:
    today = clock.today(cfg.timezone)
    for doc in await CycleDoc.find({"user_id": cfg.user_id, "end_date": {"$gte": today.isoformat()}}).to_list():
        doc.salary_amount = salary_for(cfg, doc.label)
        await doc.save()
