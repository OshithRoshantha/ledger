"""Domain rules shared by routers and analytics."""

from datetime import date
from typing import Optional

from beanie import PydanticObjectId

from app.config import get_settings
from pymongo.errors import DuplicateKeyError

from app.models import AmountHistory, AppSettings, FixedExpense, IncomeEntry, IncomeSource, Meta
from app.services import cache, clock, cycle_store
from app.services.cycles import Span, local_day_to_utc


async def get_app_settings(user_id: PydanticObjectId) -> AppSettings:
    cfg = await AppSettings.find_one(AppSettings.user_id == user_id)
    if cfg is None:
        s = get_settings()
        cfg = AppSettings(user_id=user_id, salary_day=s.default_salary_day, timezone=s.default_timezone)
        await cfg.insert()
    return cfg


def today(cfg: AppSettings) -> date:
    return clock.today(cfg.timezone)


async def current_cycle(cfg: AppSettings) -> Span:
    return await cycle_store.current(cfg)


async def cycle_of(cfg: AppSettings, label: Optional[str]) -> Span:
    """Resolve an optional ?cycle=YYYY-MM query value (defaults to the current cycle)."""
    return await cycle_store.by_label(cfg, label)


async def cycle_label_for_day(cfg: AppSettings, d: date) -> str:
    """THE attribution rule: an entry belongs to the stored cycle containing its own date."""
    return (await cycle_store.resolve(cfg, d)).label


# ---------------------------------------------------------------- amount histories


def _amount_for(history: list[AmountHistory], label: str) -> Optional[int]:
    applicable = [h for h in history if h.effective_from_cycle <= label]
    if not applicable:
        return None
    return max(applicable, key=lambda h: h.effective_from_cycle).amount


def _set_from(history: list[AmountHistory], amount: int, from_cycle: str) -> list[AmountHistory]:
    kept = [h for h in history if h.effective_from_cycle < from_cycle]
    kept.append(AmountHistory(amount=amount, effective_from_cycle=from_cycle))
    return sorted(kept, key=lambda h: h.effective_from_cycle)


def fixed_amount_for_cycle(fe: FixedExpense, label: str) -> Optional[int]:
    """Amount that applied to `label`. None when the expense did not exist yet."""
    return _amount_for(fe.amount_history, label)


def fixed_applies(fe: FixedExpense, label: str) -> bool:
    if fixed_amount_for_cycle(fe, label) is None:
        return False
    return fe.archived_from_cycle is None or label < fe.archived_from_cycle


def set_fixed_amount(fe: FixedExpense, amount: int, from_cycle: str) -> None:
    """Change the template amount from `from_cycle` onward; earlier cycles keep their amount."""
    fe.amount_history = _set_from(fe.amount_history, amount, from_cycle)
    fe.amount = amount


async def set_salary_amount(cfg: AppSettings, amount: int) -> None:
    """Salary changes apply from the current cycle onward; closed cycles keep theirs."""
    cur = await current_cycle(cfg)
    cfg.salary_history = _set_from(cfg.salary_history, amount, cur.label)
    await cfg.save()
    await cycle_store.update_open_cycle_salaries(cfg)
    salary = await salary_source(cfg)
    salary.default_amount = amount
    await salary.save()
    pending = await IncomeEntry.find_one(
        {"user_id": cfg.user_id, "source_id": salary.id, "cycle": cur.label, "status": "pending", "deleted_at": None}
    )
    if pending:
        pending.amount = amount
        await pending.save()


async def salary_source(cfg: AppSettings) -> IncomeSource:
    src = await IncomeSource.find_one({"user_id": cfg.user_id, "type": "fixed", "name": "Salary"})
    if src is None:
        src = await IncomeSource.find_one({"user_id": cfg.user_id, "type": "fixed"})
    if src is None:
        src = IncomeSource(user_id=cfg.user_id, name="Salary", type="fixed", sort_order=0)
        await src.insert()
    return src


async def ensure_pending_salary(user_id: PydanticObjectId, cfg: AppSettings, label: str) -> None:
    """Auto-create a pending salary entry for the *current* cycle, once per cycle.

    If any salary entry exists in the cycle (even a deleted one), nothing is created, so
    deleting the pending salary sticks.
    """
    if not cfg.onboarded:
        return
    cur = await current_cycle(cfg)
    if label != cur.label:
        return
    created = False
    sources = await IncomeSource.find({"user_id": user_id, "type": "fixed", "is_active": True}).to_list()
    for src in sources:
        amount = cur.salary_amount if src.name == "Salary" else src.default_amount
        if amount <= 0:
            continue
        if await IncomeEntry.find_one({"user_id": user_id, "source_id": src.id, "cycle": label}):
            continue
        # Several requests run this at once when the app opens. Claim the (source, cycle) slot
        # through the unique `meta.key` index first, so only one of them creates the entry.
        try:
            await Meta(key=f"pending-salary:{user_id}:{src.id}:{label}").insert()
        except DuplicateKeyError:
            continue
        await IncomeEntry(
            user_id=user_id,
            source_id=src.id,  # type: ignore[arg-type]
            cycle=label,
            amount=amount,
            date=local_day_to_utc(cur.start, cfg.timezone),
            day=cur.start.isoformat(),
            status="pending",
        ).insert()
        created = True
    if created:
        await cache.bump_version()
