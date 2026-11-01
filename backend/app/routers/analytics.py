from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.core.deps import oid, user_settings
from app.models import AppSettings, Reason, VariableCategory
from app.schemas import CompareMode, CycleLabel, SimulateIn
from app.services import analytics
from app.services.ledger import today

router = APIRouter(prefix="/analytics", tags=["analytics"])


@router.get("/overview")
async def overview(cycle: Optional[CycleLabel] = Query(None), compare: CompareMode = Query("last"),
                   cfg: AppSettings = Depends(user_settings)) -> dict:
    return await analytics.overview(cfg, cycle, compare)


@router.get("/spending")
async def spending(cycle: Optional[CycleLabel] = Query(None), compare: CompareMode = Query("last"),
                   cfg: AppSettings = Depends(user_settings)) -> dict:
    return await analytics.spending(cfg, cycle, compare)


@router.get("/bills")
async def bills(cycle: Optional[CycleLabel] = Query(None), months: int = Query(12, ge=2, le=13),
                cfg: AppSettings = Depends(user_settings)) -> dict:
    return await analytics.bills(cfg, cycle, months)


@router.get("/trends")
async def trends(cycle: Optional[CycleLabel] = Query(None), months: int = Query(12, ge=2, le=13),
                 cfg: AppSettings = Depends(user_settings)) -> dict:
    return await analytics.trends(cfg, cycle, months)


@router.get("/plan")
async def plan(cycle: Optional[CycleLabel] = Query(None), cfg: AppSettings = Depends(user_settings)) -> dict:
    return await analytics.plan(cfg, cycle)


@router.get("/insights")
async def insights(cycle: Optional[CycleLabel] = Query(None), compare: CompareMode = Query("last"),
                   cfg: AppSettings = Depends(user_settings)) -> list[dict]:
    return (await analytics.overview(cfg, cycle, compare))["insights"]


@router.post("/simulate")
async def simulate(body: SimulateIn, cfg: AppSettings = Depends(user_settings)) -> dict:
    """Read-only 'Can I afford it?' — nothing is saved."""
    cat = await VariableCategory.find_one({"_id": oid(body.category_id), "user_id": cfg.user_id})
    if cat is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Unknown category.")
    reason_id = None
    if body.reason_id:
        reason = await Reason.find_one({"_id": oid(body.reason_id), "user_id": cfg.user_id})
        if reason is None:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Unknown reason.")
        reason_id = reason.id
    return await analytics.simulate(cfg, body.amount, cat.id, reason_id, body.date or today(cfg))  # type: ignore[arg-type]
