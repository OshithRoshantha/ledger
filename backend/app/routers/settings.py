from datetime import timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, Depends, HTTPException, Request, status

from app.core.deps import user_settings
from app.models import AmountHistory, AppSettings, CycleDoc, ExpenseEntry, IncomeEntry
from app.schemas import OnboardingIn, SalaryPatch, SalaryPreviewIn, SettingsPatch
from app.services import cycle_store
from app.services.audit import audit
from app.services.cycles import (
    Chain,
    Span,
    display_label,
    label_for_start,
    local_day_to_utc,
    next_start,
    nominal_start_for,
    utc_to_local_day,
)
from app.services.ledger import current_cycle, salary_source, set_salary_amount, today

from ._util import dump

router = APIRouter(tags=["settings"])


async def _settings_out(cfg: AppSettings) -> dict:
    out = dump(cfg)
    cyc = await current_cycle(cfg)
    out["current_cycle"] = cyc.label
    out["current_cycle_start"] = cyc.start.isoformat()
    out["current_cycle_end"] = cyc.end.isoformat()
    out["salary_amount"] = cyc.salary_amount
    return out


@router.get("/settings")
async def get_settings_(cfg: AppSettings = Depends(user_settings)) -> dict:
    return await _settings_out(cfg)


@router.patch("/settings")
async def patch_settings(request: Request, body: SettingsPatch, cfg: AppSettings = Depends(user_settings)) -> dict:
    changes = body.model_dump(exclude_none=True)
    if "timezone" in changes:
        try:
            ZoneInfo(changes["timezone"])
        except (ZoneInfoNotFoundError, ValueError):
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Unknown timezone.")
    before = {k: getattr(cfg, k) for k in changes}
    for key, value in changes.items():
        setattr(cfg, key, value)
    await cfg.save()
    if "timezone" in changes and before["timezone"] != changes["timezone"]:
        # Local calendar days shift with the timezone; re-derive them, then re-attribute.
        for document in (IncomeEntry, ExpenseEntry):
            async for doc in document.find({"user_id": cfg.user_id}):
                day = utc_to_local_day(doc.date, cfg.timezone).isoformat()
                if day != doc.day:
                    await document.get_motor_collection().update_one({"_id": doc.id}, {"$set": {"day": day}})
        chain = await cycle_store.load_chain(cfg)
        first = chain.spans[0].start if chain.spans else today(cfg)
        await cycle_store.reassign(cfg, chain, first - timedelta(days=4000))
        await cycle_store.persist(cfg, chain)
    await audit(request, "settings_changed", cfg.user_id, before=before, after=changes)
    return await _settings_out(cfg)


# ---------------------------------------------------------------- salary


async def _salary_out(cfg: AppSettings) -> dict:
    cyc = await current_cycle(cfg)
    return {
        "amount": cyc.salary_amount,
        "salary_day": cfg.salary_day,
        "history": [h.model_dump() for h in cfg.salary_history],
        "current_cycle": cycle_store.describe(cyc, today(cfg)),
    }


@router.get("/settings/salary")
async def get_salary(cfg: AppSettings = Depends(user_settings)) -> dict:
    return await _salary_out(cfg)


@router.post("/settings/salary/preview")
async def preview_salary_day(body: SalaryPreviewIn, cfg: AppSettings = Depends(user_settings)) -> dict:
    """Which entries would move if the salary day changed (nothing is saved)."""
    _, cur, new_cur, moves = await cycle_store.plan_salary_day(cfg, body.salary_day)
    groups: dict[tuple[str, str], int] = {}
    for m in moves:
        groups[(m["from_display"], m["to_display"])] = groups.get((m["from_display"], m["to_display"]), 0) + 1
    return {
        "salary_day": body.salary_day,
        "count": len(moves),
        "summary": [f"{n} entr{'y' if n == 1 else 'ies'} will move from {a} cycle to {b} cycle" for (a, b), n in groups.items()],
        "moves": moves,
        "current_cycle": {"label": cur.label, "start_date": cur.start.isoformat(), "old_end_date": cur.end.isoformat(),
                          "new_end_date": new_cur.end.isoformat()},
    }


@router.patch("/settings/salary")
async def patch_salary(request: Request, body: SalaryPatch, cfg: AppSettings = Depends(user_settings)) -> dict:
    moved: list[dict] = []
    before = {"salary_day": cfg.salary_day, "amount": (await current_cycle(cfg)).salary_amount}
    if body.amount is not None:
        await set_salary_amount(cfg, body.amount)
    if body.salary_day is not None and body.salary_day != cfg.salary_day:
        moved = await cycle_store.apply_salary_day(cfg, body.salary_day)
    await audit(request, "settings_changed", cfg.user_id, before=before, after=body.model_dump(exclude_none=True), moved=len(moved))
    out = await _salary_out(cfg)
    out["moved"] = len(moved)
    return out


# ---------------------------------------------------------------- onboarding


@router.post("/settings/onboarding")
async def onboarding(request: Request, body: OnboardingIn, cfg: AppSettings = Depends(user_settings)) -> dict:
    """First run: salary amount + date of the most recent salary define the current cycle."""
    salary_day = body.salary_day or body.last_salary_date.day
    received = body.last_salary_date
    nominal_start = nominal_start_for(received, salary_day)
    # If the salary came a few days before its scheduled date, it belongs to the next one.
    upcoming = next_start(nominal_start, salary_day)
    if (upcoming - received).days <= 10 and upcoming > received:
        nominal_start = upcoming
    label = label_for_start(nominal_start, salary_day)

    cfg.salary_day = salary_day
    # the first known salary also applies to any earlier cycles that get created later
    cfg.salary_history = [AmountHistory(amount=body.salary, effective_from_cycle="2000-01")]
    await cfg.save()

    # Rebuild the chain around the onboarding cycle (no entries exist yet on first run).
    await CycleDoc.get_motor_collection().delete_many({"user_id": cfg.user_id})
    end = next_start(nominal_start, salary_day) - timedelta(days=1)
    chain = Chain([], salary_day)
    chain.spans = [Span(label, received, end, is_override=received != nominal_start)]
    chain.added = list(chain.spans)
    await cycle_store.persist(cfg, chain)
    await cycle_store.current(cfg)
    chain = await cycle_store.load_chain(cfg)
    await cycle_store.reassign(cfg, chain, received - timedelta(days=4000))
    await cycle_store.persist(cfg, chain)

    salary = await salary_source(cfg)
    salary.default_amount = body.salary
    await salary.save()
    if not await IncomeEntry.find_one({"user_id": cfg.user_id, "source_id": salary.id, "cycle": label}):
        await IncomeEntry(
            user_id=cfg.user_id,
            source_id=salary.id,  # type: ignore[arg-type]
            cycle=label,
            amount=body.salary,
            date=local_day_to_utc(received, cfg.timezone),
            day=received.isoformat(),
            status="received",
        ).insert()
    cfg.onboarded = True
    await cfg.save()
    await audit(request, "settings_changed", cfg.user_id, after={"onboarded": True, "salary_day": salary_day, "cycle": label})
    out = await _settings_out(cfg)
    out["onboarding_cycle"] = display_label(label)
    return out
