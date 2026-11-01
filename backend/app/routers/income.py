from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.core.deps import oid, user_settings
from app.models import AppSettings, IncomeEntry, IncomeSource, utcnow
from app.schemas import CycleLabel, IncomeIn, IncomePatch, IncomeSourceIn, IncomeSourcePatch
from app.services.cycles import local_day_to_utc
from app.services.ledger import cycle_label_for_day, cycle_of, ensure_pending_salary

from ._util import dump, dump_all

router = APIRouter(tags=["income"])


async def _source(cfg: AppSettings, source_id: str) -> IncomeSource:
    src = await IncomeSource.find_one({"_id": oid(source_id), "user_id": cfg.user_id})
    if src is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Unknown income source.")
    return src


async def _entry(cfg: AppSettings, entry_id: str) -> IncomeEntry:
    entry = await IncomeEntry.find_one({"_id": oid(entry_id), "user_id": cfg.user_id})
    if entry is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not found")
    return entry


@router.get("/income")
async def list_income(cycle: Optional[CycleLabel] = Query(None), cfg: AppSettings = Depends(user_settings)) -> dict:
    cyc = await cycle_of(cfg, cycle)
    await ensure_pending_salary(cfg.user_id, cfg, cyc.label)
    entries = await IncomeEntry.find({"user_id": cfg.user_id, "cycle": cyc.label, "deleted_at": None}).sort("-day").to_list()
    sources = {s.id: s for s in await IncomeSource.find(IncomeSource.user_id == cfg.user_id).to_list()}
    items = []
    for e in entries:
        d = dump(e)
        src = sources.get(e.source_id)
        d["source_name"] = src.name if src else "Income"
        d["source_type"] = src.type if src else "variable"
        items.append(d)
    return {
        "cycle": cyc.label,
        "received_total": sum(e.amount for e in entries if e.status == "received"),
        "pending_total": sum(e.amount for e in entries if e.status == "pending"),
        "items": items,
    }


@router.post("/income", status_code=201)
async def add_income(body: IncomeIn, cfg: AppSettings = Depends(user_settings)) -> dict:
    src = await _source(cfg, body.source_id)
    entry = IncomeEntry(
        user_id=cfg.user_id,
        source_id=src.id,  # type: ignore[arg-type]
        cycle=await cycle_label_for_day(cfg, body.date),
        amount=body.amount,
        date=local_day_to_utc(body.date, cfg.timezone),
        day=body.date.isoformat(),
        note=body.note,
        status="received",
    )
    await entry.insert()
    return dump(entry)


@router.patch("/income/{entry_id}")
async def edit_income(entry_id: str, body: IncomePatch, cfg: AppSettings = Depends(user_settings)) -> dict:
    entry = await _entry(cfg, entry_id)
    if body.source_id is not None:
        entry.source_id = (await _source(cfg, body.source_id)).id  # type: ignore[assignment]
    if body.amount is not None:
        entry.amount = body.amount
    if body.date is not None:
        entry.date = local_day_to_utc(body.date, cfg.timezone)
        entry.day = body.date.isoformat()
        entry.cycle = await cycle_label_for_day(cfg, body.date)
    if body.note is not None:
        entry.note = body.note
    if body.status is not None:
        entry.status = body.status
    entry.updated_at = utcnow()
    await entry.save()
    return dump(entry)


@router.delete("/income/{entry_id}")
async def delete_income(entry_id: str, cfg: AppSettings = Depends(user_settings)) -> dict:
    entry = await _entry(cfg, entry_id)
    entry.deleted_at = utcnow()
    await entry.save()
    return {"ok": True, "id": entry_id}


@router.post("/income/{entry_id}/restore")
async def restore_income(entry_id: str, cfg: AppSettings = Depends(user_settings)) -> dict:
    entry = await _entry(cfg, entry_id)
    entry.deleted_at = None
    await entry.save()
    return dump(entry)


# ---------------------------------------------------------------- sources


@router.get("/income-sources")
async def list_sources(cfg: AppSettings = Depends(user_settings)) -> list[dict]:
    return dump_all(await IncomeSource.find(IncomeSource.user_id == cfg.user_id).sort("sort_order").to_list())


@router.post("/income-sources", status_code=201)
async def add_source(body: IncomeSourceIn, cfg: AppSettings = Depends(user_settings)) -> dict:
    count = await IncomeSource.find(IncomeSource.user_id == cfg.user_id).count()
    src = IncomeSource(user_id=cfg.user_id, sort_order=count, **body.model_dump())
    await src.insert()
    return dump(src)


@router.patch("/income-sources/{source_id}")
async def edit_source(source_id: str, body: IncomeSourcePatch, cfg: AppSettings = Depends(user_settings)) -> dict:
    src = await _source(cfg, source_id)
    for key, value in body.model_dump(exclude_none=True).items():
        setattr(src, key, value)
    await src.save()
    return dump(src)
