from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.core.deps import user_settings
from app.models import AppSettings
from app.schemas import OverrideIn
from app.services import cycle_store
from app.services.cycle_store import OverrideError
from app.services.ledger import today

router = APIRouter(prefix="/cycles", tags=["cycles"])


@router.get("")
async def list_cycles(back: int = Query(12, ge=1, le=120), cfg: AppSettings = Depends(user_settings)) -> list[dict]:
    chain, cur, previous = await cycle_store.context(cfg, None, back)
    nxt = chain.next(cur)
    await cycle_store.persist(cfg, chain)
    now = today(cfg)
    return [cycle_store.describe(s, now) for s in reversed([*previous, cur, nxt])]


@router.get("/resolve")
async def resolve(date_: date = Query(..., alias="date"), cfg: AppSettings = Depends(user_settings)) -> dict:
    """Which salary an entry dated `date` comes from (drives the attribution chip).

    `salary_cycle` is the cycle whose start is nearest to `date`: when a salary arrives a
    few days early or late, that's the cycle whose start should be overridden.
    """
    chain = await cycle_store.load_chain(cfg)
    span = await cycle_store.resolve(cfg, date_, chain)
    nxt = chain.next(span)
    await cycle_store.persist(cfg, chain)
    nearest = nxt if (nxt.start - date_).days < (date_ - span.start).days else span
    now = today(cfg)
    out = cycle_store.describe(span, now)
    salary_cycle = cycle_store.describe(nearest, now)
    salary_cycle["offset_days"] = (date_ - nearest.start).days
    salary_cycle["can_override"] = (
        date_ != nearest.start and abs((date_ - nearest.start).days) <= 10 and not nearest.closed(now)
    )
    out["salary_cycle"] = salary_cycle
    return out


@router.post("/{label}/override-start")
async def override_start(label: str, body: OverrideIn, cfg: AppSettings = Depends(user_settings)) -> dict:
    try:
        span, moves = await cycle_store.override_start(cfg, label, body.date)
    except OverrideError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))
    except ValueError:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Unknown cycle.")
    return {"cycle": cycle_store.describe(span, today(cfg)), "moved": moves, "prev_end_date": (body.date - timedelta(days=1)).isoformat()}
