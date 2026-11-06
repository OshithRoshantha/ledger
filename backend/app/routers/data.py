"""CSV export, JSON backup and JSON restore."""

import csv
import io
from datetime import datetime, timezone
from typing import Any

from beanie import Document
from fastapi import APIRouter, Body, Depends, HTTPException, Request, status
from fastapi.responses import Response
from pydantic import ValidationError

from app.core.deps import user_settings
from app.models import (
    AmountHistory,
    AppSettings,
    Budget,
    CycleDoc,
    Goal,
    ExpenseEntry,
    FixedExpense,
    FixedPayment,
    IncomeEntry,
    IncomeSource,
    Reason,
    VariableCategory,
)
from app.schemas import SettingsPatch
from app.services.audit import audit

router = APIRouter(tags=["data"])

BACKUP_FORMAT = "ledger-backup"
BACKUP_VERSION = 2
COLLECTIONS: dict[str, type[Document]] = {
    "income_sources": IncomeSource,
    "income_entries": IncomeEntry,
    "fixed_expenses": FixedExpense,
    "fixed_payments": FixedPayment,
    "variable_categories": VariableCategory,
    "reasons": Reason,
    "expense_entries": ExpenseEntry,
    "cycles": CycleDoc,
    "budgets": Budget,
    "goals": Goal,
}
SETTINGS_FIELDS = ("salary_day", "salary_history", "timezone", "theme", "auto_lock_minutes", "reminder_days_before_cycle_end", "onboarded")
PATCHABLE = ("timezone", "theme", "auto_lock_minutes", "reminder_days_before_cycle_end")


def _stamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%d-%H%M")


def _decimal(cents: int) -> str:
    sign = "-" if cents < 0 else ""
    whole, frac = divmod(abs(cents), 100)
    return f"{sign}{whole}.{frac:02d}"


@router.get("/export/json")
async def export_json(cfg: AppSettings = Depends(user_settings)) -> Response:
    import json

    payload: dict[str, Any] = {
        "format": BACKUP_FORMAT,
        "version": BACKUP_VERSION,
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "currency": "LKR",
        "amounts_in": "cents",
        "settings": cfg.model_dump(mode="json", include=set(SETTINGS_FIELDS)),
    }
    for name, document in COLLECTIONS.items():
        docs = await document.find({"user_id": cfg.user_id}).to_list()
        payload[name] = [d.model_dump(mode="json", exclude={"revision_id", "user_id"}) for d in docs]
    return Response(
        json.dumps(payload, indent=1),
        media_type="application/json",
        headers={"Content-Disposition": f'attachment; filename="ledger-backup-{_stamp()}.json"'},
    )


@router.get("/export/csv")
async def export_csv(cfg: AppSettings = Depends(user_settings)) -> Response:
    uid = cfg.user_id
    sources = {s.id: s.name for s in await IncomeSource.find({"user_id": uid}).to_list()}
    fixed = {f.id: f for f in await FixedExpense.find({"user_id": uid}).to_list()}
    cats = {c.id: c.name for c in await VariableCategory.find({"user_id": uid}).to_list()}
    reasons = {r.id: r.name for r in await Reason.find({"user_id": uid}).to_list()}

    rows: list[list[str]] = []
    for e in await IncomeEntry.find({"user_id": uid, "deleted_at": None}).to_list():
        rows.append([e.day, e.cycle, "income", sources.get(e.source_id, ""), "", "", "", _decimal(e.amount), e.status, e.note])
    for p in await FixedPayment.find({"user_id": uid, "deleted_at": None}).to_list():
        fe = fixed.get(p.fixed_expense_id)
        rows.append([p.day, p.cycle, "fixed_bill", fe.name if fe else "", fe.group if fe else "", "", "",
                     _decimal(-p.amount_paid), "paid" if p.deducted else "paid (not deducted)", p.note])
    for x in await ExpenseEntry.find({"user_id": uid, "deleted_at": None}).to_list():
        rows.append([x.day, x.cycle, "expense", cats.get(x.category_id, ""), "", x.method or "",
                     reasons.get(x.reason_id, "") if x.reason_id else "", _decimal(-x.amount), "", x.note])
    rows.sort(key=lambda r: (r[0], r[2]))

    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(["date", "cycle", "type", "name", "group", "method", "reason", "amount_lkr", "status", "note"])
    for row in rows:
        # Neutralise spreadsheet formula injection in free-text fields.
        writer.writerow([("'" + v) if isinstance(v, str) and v[:1] in "=+@\t\r" else v for v in row])
    return Response(
        "﻿" + buf.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="ledger-{_stamp()}.csv"'},
    )


@router.post("/import/json")
async def import_json(request: Request, backup: dict[str, Any] = Body(...), cfg: AppSettings = Depends(user_settings)) -> dict:
    if backup.get("format") != BACKUP_FORMAT or backup.get("version") != BACKUP_VERSION:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Not a Ledger backup file.")

    parsed: dict[str, list[Document]] = {}
    try:
        for name, document in COLLECTIONS.items():
            items = backup.get(name, [])
            if not isinstance(items, list):
                raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"'{name}' must be a list.")
            parsed[name] = [document.model_validate({**item, "user_id": cfg.user_id}) for item in items]
        settings_in = {k: v for k, v in (backup.get("settings") or {}).items() if k in SETTINGS_FIELDS}
        SettingsPatch.model_validate({k: v for k, v in settings_in.items() if k in PATCHABLE})
        if "salary_day" in settings_in and not (isinstance(settings_in["salary_day"], int) and 1 <= settings_in["salary_day"] <= 31):
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Backup has an invalid salary day.")
        if "salary_history" in settings_in:
            settings_in["salary_history"] = [AmountHistory.model_validate(h) for h in settings_in["salary_history"]]
    except ValidationError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"Backup failed validation: {exc.errors()[0]['msg']}")

    for doc_list in parsed.values():
        for doc in doc_list:
            for amount_field in ("amount", "amount_paid", "default_amount", "salary_amount", "target_amount", "saved_amount"):
                value = getattr(doc, amount_field, None)
                if value is not None and (not isinstance(value, int) or value < 0 or value > 1_000_000_000):
                    raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "Backup contains an invalid amount.")

    # Validation passed: replace the user's data with the backup.
    counts = {}
    for name, document in COLLECTIONS.items():
        await document.find({"user_id": cfg.user_id}).delete()
        if parsed[name]:
            await document.insert_many(parsed[name])
        counts[name] = len(parsed[name])
    for key, value in settings_in.items():
        setattr(cfg, key, bool(value) if key == "onboarded" else value)
    await cfg.save()
    await audit(request, "data_imported", cfg.user_id, counts=counts)
    return {"ok": True, "imported": counts}
