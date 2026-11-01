"""First-run seed data. Idempotent: runs once per user (tracked in the `meta` collection)."""

from beanie import PydanticObjectId

from app.models import AmountHistory, FixedExpense, IncomeSource, Meta, Reason, VariableCategory
from app.services.ledger import get_app_settings

SEED_FROM_CYCLE = "2000-01"  # seed templates apply to every cycle

FIXED = [
    # name, group, rupees, icon, colour (Okabe-Ito colour-blind-safe palette per group)
    ("Foods & Households", "Foods & Households", 30_000, "shopping-basket", "#E69F00"),
    ("Water Bill", "Utility Bills", 2_000, "droplets", "#56B4E9"),
    ("Electricity Bill", "Utility Bills", 2_000, "zap", "#56B4E9"),
    ("Television", "Utility Bills", 1_000, "tv", "#56B4E9"),
    ("Mobile Internet", "Utility Bills", 500, "smartphone", "#56B4E9"),
    ("Broadband", "Utility Bills", 1_400, "wifi", "#56B4E9"),
    ("Claude Pro", "Subscriptions", 7_000, "sparkles", "#CC79A7"),
]

CATEGORIES = [
    # name, icon, colour, requires_reason, unit, need/want (for the 50/30/20 check)
    ("Mobile Top-ups", "smartphone", "#009E73", False, "top-ups", "need"),
    ("LMT Top-ups", "ticket", "#F0E442", False, "top-ups", "need"),
    ("Uber / PickMe", "car", "#0072B2", False, "rides", "want"),
    ("Bank & Cash Spending", "landmark", "#D55E00", True, "transactions", "want"),
]

REASONS = [
    ("Shopping", "shopping-bag", "#8B5CF6", "want"),
    ("Day Out", "sun", "#F59E0B", "want"),
    ("Restaurant", "utensils", "#F43F5E", "want"),
    ("Medical", "heart-pulse", "#14B8A6", "need"),
    ("Groceries (extra)", "shopping-cart", "#84CC16", "need"),
    ("Fuel", "fuel", "#64748B", "need"),
    ("Gifts", "gift", "#EC4899", "want"),
    ("Family", "users", "#3B82F6", "need"),
    ("Education", "graduation-cap", "#06B6D4", "need"),
    ("Other", "tag", "#9AA3B2", "want"),
]


async def seed_user(user_id: PydanticObjectId) -> bool:
    key = f"seeded:{user_id}"
    if await Meta.find_one(Meta.key == key):
        return False
    await get_app_settings(user_id)
    for i, (name, group, rupees, icon, colour) in enumerate(FIXED):
        cents = rupees * 100
        await FixedExpense(
            user_id=user_id, name=name, group=group, amount=cents, icon=icon, colour=colour, sort_order=i,
            amount_history=[AmountHistory(amount=cents, effective_from_cycle=SEED_FROM_CYCLE)],
        ).insert()
    for i, (name, icon, colour, requires_reason, unit, nw) in enumerate(CATEGORIES):
        await VariableCategory(
            user_id=user_id, name=name, icon=icon, colour=colour, requires_reason=requires_reason, unit=unit, need_want=nw, sort_order=i
        ).insert()
    for i, (name, icon, colour, nw) in enumerate(REASONS):
        await Reason(user_id=user_id, name=name, icon=icon, colour=colour, need_want=nw, sort_order=i).insert()
    await IncomeSource(user_id=user_id, name="Salary", type="fixed", default_amount=0, sort_order=0).insert()
    await IncomeSource(user_id=user_id, name="Other Income", type="variable", default_amount=0, sort_order=1).insert()
    await Meta(key=key, version=1).insert()
    return True
