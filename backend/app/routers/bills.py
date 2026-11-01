"""Fixed bills: per-cycle status, mark paid / unpaid, and template management."""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.core.deps import oid, user_settings
from app.models import AmountHistory, AppSettings, FixedExpense, FixedPayment, utcnow
from app.schemas import CycleLabel, FixedExpenseIn, FixedExpensePatch, PayIn, ReorderIn
from app.services.cycles import display_label, local_day_to_utc
from app.services.ledger import (
    current_cycle,
    cycle_label_for_day,
    cycle_of,
    fixed_amount_for_cycle,
    fixed_applies,
    set_fixed_amount,
    today,
)

from ._util import dump, dump_all

router = APIRouter(tags=["bills"])


async def _expense(cfg: AppSettings, expense_id: str) -> FixedExpense:
    fe = await FixedExpense.find_one({"_id": oid(expense_id), "user_id": cfg.user_id})
    if fe is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not found")
    return fe


async def _ensure_unpaid(cfg: AppSettings, fe_id, label: str, except_id=None) -> None:
    clash = await FixedPayment.find_one({"user_id": cfg.user_id, "fixed_expense_id": fe_id, "cycle": label, "deleted_at": None})
    if clash and clash.id != except_id:
        raise HTTPException(status.HTTP_409_CONFLICT, f"Already marked paid in the {display_label(label)} cycle.")


@router.get("/fixed-expenses")
async def bills_for_cycle(cycle: Optional[CycleLabel] = Query(None), cfg: AppSettings = Depends(user_settings)) -> dict:
    cyc = await cycle_of(cfg, cycle)
    expenses = await FixedExpense.find(FixedExpense.user_id == cfg.user_id).sort("sort_order").to_list()
    payments = await FixedPayment.find({"user_id": cfg.user_id, "cycle": cyc.label, "deleted_at": None}).to_list()
    by_expense = {p.fixed_expense_id: p for p in payments}
    now = today(cfg)
    days_left = (cyc.end - now).days if cyc.contains(now) else 0

    items, groups = [], []
    paid_amount = pending_amount = paid_count = 0
    for fe in expenses:
        payment = by_expense.get(fe.id)  # type: ignore[arg-type]
        if not fixed_applies(fe, cyc.label) and payment is None:
            continue
        template = fixed_amount_for_cycle(fe, cyc.label) or fe.amount
        items.append(
            {
                "id": str(fe.id),
                "name": fe.name,
                "group": fe.group,
                "icon": fe.icon,
                "colour": fe.colour,
                "template_amount": template,
                "status": "paid" if payment else "pending",
                "payment": dump(payment) if payment else None,
            }
        )
        if fe.group not in groups:
            groups.append(fe.group)
        if payment:
            paid_count += 1
            paid_amount += payment.amount_paid
        else:
            pending_amount += template
    return {
        "cycle": cyc.label,
        "start_date": cyc.start.isoformat(),
        "end_date": cyc.end.isoformat(),
        "is_current": cyc.contains(now),
        "reminder_window": cyc.contains(now) and days_left < cfg.reminder_days_before_cycle_end,
        "groups": groups,
        "items": items,
        "paid_count": paid_count,
        "total_count": len(items),
        "paid_amount": paid_amount,
        "pending_amount": pending_amount,
        "total_amount": paid_amount + pending_amount,
    }


@router.post("/fixed-expenses/{expense_id}/pay", status_code=201)
async def pay_bill(expense_id: str, body: PayIn, cfg: AppSettings = Depends(user_settings)) -> dict:
    fe = await _expense(cfg, expense_id)
    paid_day = body.date or today(cfg)
    label = await cycle_label_for_day(cfg, paid_day)  # attribution by the payment's own date
    await _ensure_unpaid(cfg, fe.id, label)
    payment = FixedPayment(
        user_id=cfg.user_id,
        fixed_expense_id=fe.id,  # type: ignore[arg-type]
        cycle=label,
        amount_paid=body.amount or fixed_amount_for_cycle(fe, label) or fe.amount,
        paid_at=local_day_to_utc(paid_day, cfg.timezone),
        day=paid_day.isoformat(),
        note=body.note,
    )
    await payment.insert()
    return dump(payment)


@router.delete("/fixed-payments/{payment_id}")
async def unpay_bill(payment_id: str, cfg: AppSettings = Depends(user_settings)) -> dict:
    payment = await FixedPayment.find_one({"_id": oid(payment_id), "user_id": cfg.user_id, "deleted_at": None})
    if payment is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not found")
    payment.deleted_at = utcnow()
    await payment.save()
    return {"ok": True, "id": payment_id}


@router.post("/fixed-payments/{payment_id}/restore")
async def restore_payment(payment_id: str, cfg: AppSettings = Depends(user_settings)) -> dict:
    payment = await FixedPayment.find_one({"_id": oid(payment_id), "user_id": cfg.user_id})
    if payment is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not found")
    await _ensure_unpaid(cfg, payment.fixed_expense_id, payment.cycle, except_id=payment.id)
    payment.deleted_at = None
    await payment.save()
    return dump(payment)


# ---------------------------------------------------------------- templates (Settings)


@router.get("/settings/fixed-expenses")
async def list_templates(cfg: AppSettings = Depends(user_settings)) -> list[dict]:
    return dump_all(await FixedExpense.find(FixedExpense.user_id == cfg.user_id).sort("sort_order").to_list())


@router.post("/settings/fixed-expenses", status_code=201)
async def add_template(body: FixedExpenseIn, cfg: AppSettings = Depends(user_settings)) -> dict:
    count = await FixedExpense.find(FixedExpense.user_id == cfg.user_id).count()
    cur = await current_cycle(cfg)
    fe = FixedExpense(
        user_id=cfg.user_id,
        sort_order=count,
        amount_history=[AmountHistory(amount=body.amount, effective_from_cycle=cur.label)],
        **body.model_dump(),
    )
    await fe.insert()
    return dump(fe)


@router.patch("/settings/fixed-expenses/{expense_id}")
async def edit_template(expense_id: str, body: FixedExpensePatch, cfg: AppSettings = Depends(user_settings)) -> dict:
    fe = await _expense(cfg, expense_id)
    cur = (await current_cycle(cfg)).label
    changes = body.model_dump(exclude_none=True)
    if "amount" in changes:
        set_fixed_amount(fe, changes.pop("amount"), cur)
    if "is_active" in changes:
        active = changes.pop("is_active")
        fe.is_active = active
        fe.archived_from_cycle = None if active else cur
    for key, value in changes.items():
        setattr(fe, key, value)
    await fe.save()
    return dump(fe)


@router.post("/settings/fixed-expenses/reorder")
async def reorder_templates(body: ReorderIn, cfg: AppSettings = Depends(user_settings)) -> dict:
    for index, expense_id in enumerate(body.ids):
        await FixedExpense.get_motor_collection().update_one(
            {"_id": oid(expense_id), "user_id": cfg.user_id}, {"$set": {"sort_order": index}}
        )
    return {"ok": True}
