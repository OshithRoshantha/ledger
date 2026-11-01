"""Cumulative (variable) spending: entries, categories and reasons."""

from typing import Optional

from beanie import PydanticObjectId
from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.core.deps import oid, user_settings
from app.models import AppSettings, ExpenseEntry, Reason, VariableCategory, utcnow
from app.schemas import CategoryIn, CategoryPatch, CycleLabel, ExpenseIn, ExpensePatch, ReasonIn, ReasonPatch
from app.services.cycles import local_day_to_utc
from app.services.ledger import cycle_label_for_day, cycle_of

from ._util import dump, dump_all

router = APIRouter(tags=["spending"])

REASON_METHODS = {"atm", "bank_transfer", "card"}


async def _category(cfg: AppSettings, category_id: str) -> VariableCategory:
    cat = await VariableCategory.find_one({"_id": oid(category_id), "user_id": cfg.user_id})
    if cat is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Unknown category.")
    return cat


async def _reason(cfg: AppSettings, reason_id: str) -> Reason:
    reason = await Reason.find_one({"_id": oid(reason_id), "user_id": cfg.user_id})
    if reason is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Unknown reason.")
    return reason


async def _entry(cfg: AppSettings, entry_id: str) -> ExpenseEntry:
    entry = await ExpenseEntry.find_one({"_id": oid(entry_id), "user_id": cfg.user_id})
    if entry is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not found")
    return entry


def _validate_reason_rules(cat: VariableCategory, method: Optional[str], reason_id: Optional[PydanticObjectId]) -> None:
    if not cat.requires_reason:
        return
    if method not in REASON_METHODS:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY, f"{cat.name} needs a method: ATM withdrawal, bank transfer or card payment."
        )
    if reason_id is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"{cat.name} needs a reason.")


async def _remember(cfg: AppSettings, entry: ExpenseEntry) -> None:
    cfg.last_category_id = entry.category_id
    if entry.reason_id:
        cfg.last_reason_id = entry.reason_id
    if entry.method:
        cfg.last_method = entry.method
    await cfg.save()


@router.get("/expenses")
async def list_expenses(
    cycle: Optional[CycleLabel] = Query(None),
    category_id: Optional[str] = Query(None),
    day: Optional[str] = Query(None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
    reason_id: Optional[str] = Query(None),
    method: Optional[str] = Query(None, pattern=r"^(atm|bank_transfer|card|cash|other)$"),
    cfg: AppSettings = Depends(user_settings),
) -> dict:
    cyc = await cycle_of(cfg, cycle)
    query: dict = {"user_id": cfg.user_id, "cycle": cyc.label, "deleted_at": None}
    if category_id:
        query["category_id"] = oid(category_id)
    if day:
        query["day"] = day
    if reason_id:
        query["reason_id"] = oid(reason_id)
    if method:
        query["method"] = method
    entries = await ExpenseEntry.find(query).sort([("day", -1), ("created_at", -1)]).to_list()
    return {"cycle": cyc.label, "total": sum(e.amount for e in entries), "items": dump_all(entries)}


@router.post("/expenses", status_code=201)
async def add_expense(body: ExpenseIn, cfg: AppSettings = Depends(user_settings)) -> dict:
    cat = await _category(cfg, body.category_id)
    reason_id = (await _reason(cfg, body.reason_id)).id if body.reason_id else None
    _validate_reason_rules(cat, body.method, reason_id)
    entry = ExpenseEntry(
        user_id=cfg.user_id,
        category_id=cat.id,  # type: ignore[arg-type]
        cycle=await cycle_label_for_day(cfg, body.date),
        amount=body.amount,
        date=local_day_to_utc(body.date, cfg.timezone),
        day=body.date.isoformat(),
        method=body.method,
        reason_id=reason_id if cat.requires_reason else None,
        note=body.note,
    )
    await entry.insert()
    await _remember(cfg, entry)
    return dump(entry)


@router.patch("/expenses/{entry_id}")
async def edit_expense(entry_id: str, body: ExpensePatch, cfg: AppSettings = Depends(user_settings)) -> dict:
    entry = await _entry(cfg, entry_id)
    changes = body.model_dump(exclude_unset=True)
    if "category_id" in changes and changes["category_id"]:
        entry.category_id = (await _category(cfg, changes["category_id"])).id  # type: ignore[assignment]
    if "reason_id" in changes:
        entry.reason_id = (await _reason(cfg, changes["reason_id"])).id if changes["reason_id"] else None
    if "method" in changes:
        entry.method = changes["method"]
    if changes.get("amount") is not None:
        entry.amount = changes["amount"]
    if changes.get("date") is not None:
        entry.date = local_day_to_utc(changes["date"], cfg.timezone)
        entry.day = changes["date"].isoformat()
        entry.cycle = await cycle_label_for_day(cfg, changes["date"])
    if changes.get("note") is not None:
        entry.note = changes["note"]
    cat = await _category(cfg, str(entry.category_id))
    _validate_reason_rules(cat, entry.method, entry.reason_id)
    if not cat.requires_reason:
        entry.reason_id = None
    entry.updated_at = utcnow()
    await entry.save()
    return dump(entry)


@router.delete("/expenses/{entry_id}")
async def delete_expense(entry_id: str, cfg: AppSettings = Depends(user_settings)) -> dict:
    entry = await _entry(cfg, entry_id)
    entry.deleted_at = utcnow()
    await entry.save()
    return {"ok": True, "id": entry_id}


@router.post("/expenses/{entry_id}/restore")
async def restore_expense(entry_id: str, cfg: AppSettings = Depends(user_settings)) -> dict:
    entry = await _entry(cfg, entry_id)
    entry.deleted_at = None
    await entry.save()
    return dump(entry)


@router.get("/spending/summary")
async def spending_summary(cycle: Optional[CycleLabel] = Query(None), cfg: AppSettings = Depends(user_settings)) -> dict:
    """Running totals per category for the Spending screen (one aggregation)."""
    cyc = await cycle_of(cfg, cycle)
    coll = ExpenseEntry.get_motor_collection()
    match = {"$match": {"user_id": cfg.user_id, "cycle": cyc.label, "deleted_at": None}}
    per_cat = await coll.aggregate(
        [match, {"$group": {"_id": "$category_id", "total": {"$sum": "$amount"}, "count": {"$sum": 1}}}]
    ).to_list(None)
    per_method = await coll.aggregate(
        [match, {"$group": {"_id": {"c": "$category_id", "m": "$method"}, "total": {"$sum": "$amount"}}}]
    ).to_list(None)
    per_reason = await coll.aggregate(
        [match, {"$group": {"_id": {"c": "$category_id", "r": "$reason_id"}, "total": {"$sum": "$amount"}}}]
    ).to_list(None)

    cats = await VariableCategory.find(VariableCategory.user_id == cfg.user_id).sort("sort_order").to_list()
    totals = {row["_id"]: row for row in per_cat}
    out = []
    for cat in cats:
        row = totals.get(cat.id)
        if not cat.is_active and row is None:
            continue
        item = dump(cat)
        item["total"] = row["total"] if row else 0
        item["count"] = row["count"] if row else 0
        if cat.requires_reason:
            item["by_method"] = {r["_id"]["m"] or "other": r["total"] for r in per_method if r["_id"]["c"] == cat.id}
            item["by_reason"] = {str(r["_id"]["r"]): r["total"] for r in per_reason if r["_id"]["c"] == cat.id and r["_id"]["r"]}
        out.append(item)
    return {"cycle": cyc.label, "total": sum(i["total"] for i in out), "categories": out}


# ---------------------------------------------------------------- categories & reasons


@router.get("/categories")
async def list_categories(cfg: AppSettings = Depends(user_settings)) -> list[dict]:
    return dump_all(await VariableCategory.find(VariableCategory.user_id == cfg.user_id).sort("sort_order").to_list())


@router.post("/categories", status_code=201)
async def add_category(body: CategoryIn, cfg: AppSettings = Depends(user_settings)) -> dict:
    count = await VariableCategory.find(VariableCategory.user_id == cfg.user_id).count()
    cat = VariableCategory(user_id=cfg.user_id, sort_order=count, **body.model_dump())
    await cat.insert()
    return dump(cat)


@router.patch("/categories/{category_id}")
async def edit_category(category_id: str, body: CategoryPatch, cfg: AppSettings = Depends(user_settings)) -> dict:
    cat = await _category(cfg, category_id)
    for key, value in body.model_dump(exclude_none=True).items():
        setattr(cat, key, value)
    await cat.save()
    return dump(cat)


@router.get("/reasons")
async def list_reasons(cfg: AppSettings = Depends(user_settings)) -> list[dict]:
    return dump_all(await Reason.find(Reason.user_id == cfg.user_id).sort("sort_order").to_list())


@router.post("/reasons", status_code=201)
async def add_reason(body: ReasonIn, cfg: AppSettings = Depends(user_settings)) -> dict:
    count = await Reason.find(Reason.user_id == cfg.user_id).count()
    reason = Reason(user_id=cfg.user_id, sort_order=count, **body.model_dump())
    await reason.insert()
    return dump(reason)


@router.patch("/reasons/{reason_id}")
async def edit_reason(reason_id: str, body: ReasonPatch, cfg: AppSettings = Depends(user_settings)) -> dict:
    reason = await _reason(cfg, reason_id)
    for key, value in body.model_dump(exclude_none=True).items():
        setattr(reason, key, value)
    await reason.save()
    return dump(reason)
