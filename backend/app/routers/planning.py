"""Budgets and savings goals (soft delete + restore, like every other write)."""

from fastapi import APIRouter, Depends, HTTPException, status

from app.core.deps import oid, user_settings
from app.models import AppSettings, Budget, Goal, Reason, VariableCategory, utcnow
from app.schemas import BudgetIn, BudgetPatch, GoalIn, GoalPatch

from ._util import dump, dump_all

router = APIRouter(tags=["planning"])


async def _budget(cfg: AppSettings, budget_id: str) -> Budget:
    b = await Budget.find_one({"_id": oid(budget_id), "user_id": cfg.user_id})
    if b is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not found")
    return b


async def _goal(cfg: AppSettings, goal_id: str) -> Goal:
    g = await Goal.find_one({"_id": oid(goal_id), "user_id": cfg.user_id})
    if g is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not found")
    return g


@router.get("/budgets")
async def list_budgets(cfg: AppSettings = Depends(user_settings)) -> list[dict]:
    return dump_all(await Budget.find({"user_id": cfg.user_id, "deleted_at": None}).to_list())


@router.post("/budgets", status_code=201)
async def add_budget(body: BudgetIn, cfg: AppSettings = Depends(user_settings)) -> dict:
    document = VariableCategory if body.target_type == "category" else Reason
    target = await document.find_one({"_id": oid(body.target_id), "user_id": cfg.user_id})
    if target is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Unknown budget target.")
    if body.target_type == "category" and getattr(target, "requires_reason", False):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Budget Bank & Cash by reason instead.")
    existing = await Budget.find_one({"user_id": cfg.user_id, "target_type": body.target_type, "target_id": target.id, "deleted_at": None})
    if existing:
        existing.amount = body.amount
        await existing.save()
        return dump(existing)
    b = Budget(user_id=cfg.user_id, target_type=body.target_type, target_id=target.id, amount=body.amount)  # type: ignore[arg-type]
    await b.insert()
    return dump(b)


@router.patch("/budgets/{budget_id}")
async def edit_budget(budget_id: str, body: BudgetPatch, cfg: AppSettings = Depends(user_settings)) -> dict:
    b = await _budget(cfg, budget_id)
    b.amount = body.amount
    await b.save()
    return dump(b)


@router.delete("/budgets/{budget_id}")
async def delete_budget(budget_id: str, cfg: AppSettings = Depends(user_settings)) -> dict:
    b = await _budget(cfg, budget_id)
    b.deleted_at = utcnow()
    await b.save()
    return {"ok": True, "id": budget_id}


@router.post("/budgets/{budget_id}/restore")
async def restore_budget(budget_id: str, cfg: AppSettings = Depends(user_settings)) -> dict:
    b = await _budget(cfg, budget_id)
    b.deleted_at = None
    await b.save()
    return dump(b)


@router.get("/goals")
async def list_goals(cfg: AppSettings = Depends(user_settings)) -> list[dict]:
    return dump_all(await Goal.find({"user_id": cfg.user_id, "deleted_at": None}).to_list())


@router.post("/goals", status_code=201)
async def add_goal(body: GoalIn, cfg: AppSettings = Depends(user_settings)) -> dict:
    data = body.model_dump()
    data["target_date"] = body.target_date.isoformat()
    g = Goal(user_id=cfg.user_id, **data)
    await g.insert()
    return dump(g)


@router.patch("/goals/{goal_id}")
async def edit_goal(goal_id: str, body: GoalPatch, cfg: AppSettings = Depends(user_settings)) -> dict:
    g = await _goal(cfg, goal_id)
    for key, value in body.model_dump(exclude_none=True).items():
        setattr(g, key, value.isoformat() if key == "target_date" else value)
    await g.save()
    return dump(g)


@router.delete("/goals/{goal_id}")
async def delete_goal(goal_id: str, cfg: AppSettings = Depends(user_settings)) -> dict:
    g = await _goal(cfg, goal_id)
    g.deleted_at = utcnow()
    await g.save()
    return {"ok": True, "id": goal_id}


@router.post("/goals/{goal_id}/restore")
async def restore_goal(goal_id: str, cfg: AppSettings = Depends(user_settings)) -> dict:
    g = await _goal(cfg, goal_id)
    g.deleted_at = None
    await g.save()
    return dump(g)
