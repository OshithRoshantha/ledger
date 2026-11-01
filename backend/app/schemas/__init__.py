"""Request/response schemas. All amounts are integer cents (LKR x 100)."""

import re
from datetime import date as Date
from typing import Annotated, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, StrictInt, field_validator

from app.models import IncomeType, Method, NeedWant, Theme

MAX_CENTS = 1_000_000_000  # Rs 10,000,000.00

# StrictInt rejects floats such as 12.5 and numeric strings: money must be integral cents.
Cents = Annotated[StrictInt, Field(gt=0, le=MAX_CENTS)]
Note = Annotated[str, Field(max_length=280)]
Name = Annotated[str, Field(min_length=1, max_length=60)]
Icon = Annotated[str, Field(min_length=1, max_length=40, pattern=r"^[a-z0-9-]+$")]
Colour = Annotated[str, Field(pattern=r"^#[0-9A-Fa-f]{6}$")]
CycleLabel = Annotated[str, Field(pattern=r"^\d{4}-(0[1-9]|1[0-2])$")]
ObjectIdStr = Annotated[str, Field(pattern=r"^[0-9a-f]{24}$")]


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


def _clean_name(v: str) -> str:
    v = re.sub(r"\s+", " ", v).strip()
    if not v:
        raise ValueError("must not be blank")
    return v


# ---------------------------------------------------------------- auth


class LoginIn(Strict):
    username: Annotated[str, Field(min_length=1, max_length=64)]
    password: Annotated[str, Field(min_length=1, max_length=256)]


class Verify2FAIn(Strict):
    pre_auth_token: Annotated[str, Field(min_length=10, max_length=2048)]
    code: Annotated[str, Field(min_length=6, max_length=32)]


class CodeIn(Strict):
    code: Annotated[str, Field(min_length=6, max_length=32)]


class ChangePasswordIn(Strict):
    current_password: Annotated[str, Field(min_length=1, max_length=256)]
    new_password: Annotated[str, Field(min_length=1, max_length=256)]
    code: Annotated[str, Field(min_length=6, max_length=6)]


class PasswordAndCodeIn(Strict):
    password: Annotated[str, Field(min_length=1, max_length=256)]
    code: Annotated[str, Field(min_length=6, max_length=6)]


# ---------------------------------------------------------------- income


class IncomeSourceIn(Strict):
    name: Name
    type: IncomeType = "variable"
    default_amount: Annotated[StrictInt, Field(ge=0, le=MAX_CENTS)] = 0

    _n = field_validator("name")(_clean_name)


class IncomeSourcePatch(Strict):
    name: Optional[Name] = None
    default_amount: Optional[Annotated[StrictInt, Field(ge=0, le=MAX_CENTS)]] = None
    is_active: Optional[bool] = None
    sort_order: Optional[int] = None


class IncomeIn(Strict):
    source_id: ObjectIdStr
    amount: Cents
    date: Date
    note: Note = ""


class IncomePatch(Strict):
    source_id: Optional[ObjectIdStr] = None
    amount: Optional[Cents] = None
    date: Optional[Date] = None
    note: Optional[Note] = None
    status: Optional[Literal["pending", "received"]] = None


# ---------------------------------------------------------------- fixed bills


class PayIn(Strict):
    """The payment's cycle is derived from its date on the server; there is no cycle field."""

    amount: Optional[Cents] = None
    date: Optional[Date] = None
    note: Note = ""


class FixedExpenseIn(Strict):
    name: Name
    group: Annotated[str, Field(min_length=1, max_length=40)]
    amount: Cents
    icon: Icon = "receipt"
    colour: Colour = "#56B4E9"

    _n = field_validator("name", "group")(_clean_name)


class FixedExpensePatch(Strict):
    name: Optional[Name] = None
    group: Optional[Annotated[str, Field(min_length=1, max_length=40)]] = None
    amount: Optional[Cents] = None
    icon: Optional[Icon] = None
    colour: Optional[Colour] = None
    sort_order: Optional[int] = None
    is_active: Optional[bool] = None


class ReorderIn(Strict):
    ids: Annotated[list[ObjectIdStr], Field(min_length=1, max_length=200)]


# ---------------------------------------------------------------- spending


class ExpenseIn(Strict):
    category_id: ObjectIdStr
    amount: Cents
    date: Date
    method: Optional[Method] = None
    reason_id: Optional[ObjectIdStr] = None
    note: Note = ""


class ExpensePatch(Strict):
    category_id: Optional[ObjectIdStr] = None
    amount: Optional[Cents] = None
    date: Optional[Date] = None
    method: Optional[Method] = None
    reason_id: Optional[ObjectIdStr] = None
    note: Optional[Note] = None


class CategoryIn(Strict):
    name: Name
    icon: Icon = "wallet"
    colour: Colour = "#0072B2"
    requires_reason: bool = False
    unit: Annotated[str, Field(min_length=1, max_length=20)] = "entries"
    need_want: NeedWant = "want"

    _n = field_validator("name")(_clean_name)


class CategoryPatch(Strict):
    name: Optional[Name] = None
    icon: Optional[Icon] = None
    colour: Optional[Colour] = None
    requires_reason: Optional[bool] = None
    unit: Optional[Annotated[str, Field(min_length=1, max_length=20)]] = None
    need_want: Optional[NeedWant] = None
    is_active: Optional[bool] = None
    sort_order: Optional[int] = None


class ReasonIn(Strict):
    name: Name
    icon: Icon = "tag"
    colour: Colour = "#9AA3B2"
    need_want: NeedWant = "want"

    _n = field_validator("name")(_clean_name)


class ReasonPatch(Strict):
    name: Optional[Name] = None
    icon: Optional[Icon] = None
    colour: Optional[Colour] = None
    need_want: Optional[NeedWant] = None
    is_active: Optional[bool] = None
    sort_order: Optional[int] = None


# ---------------------------------------------------------------- settings


class SettingsPatch(Strict):
    timezone: Optional[Annotated[str, Field(min_length=1, max_length=64)]] = None
    theme: Optional[Theme] = None
    auto_lock_minutes: Optional[Annotated[int, Field(ge=1, le=60)]] = None
    reminder_days_before_cycle_end: Optional[Annotated[int, Field(ge=0, le=15)]] = None


SalaryDay = Annotated[int, Field(ge=1, le=31)]


class OnboardingIn(Strict):
    salary: Cents
    last_salary_date: Date
    salary_day: Optional[SalaryDay] = None


class SalaryPatch(Strict):
    amount: Optional[Cents] = None
    salary_day: Optional[SalaryDay] = None


class SalaryPreviewIn(Strict):
    salary_day: SalaryDay


class OverrideIn(Strict):
    date: Date


# ---------------------------------------------------------------- planning


class BudgetIn(Strict):
    target_type: Literal["category", "reason"]
    target_id: ObjectIdStr
    amount: Cents


class BudgetPatch(Strict):
    amount: Cents


class GoalIn(Strict):
    name: Name
    target_amount: Cents
    target_date: Date
    saved_amount: Annotated[StrictInt, Field(ge=0, le=MAX_CENTS)] = 0
    monthly_reserve: Annotated[StrictInt, Field(ge=0, le=MAX_CENTS)] = 0

    _n = field_validator("name")(_clean_name)


class GoalPatch(Strict):
    name: Optional[Name] = None
    target_amount: Optional[Cents] = None
    target_date: Optional[Date] = None
    saved_amount: Optional[Annotated[StrictInt, Field(ge=0, le=MAX_CENTS)]] = None
    monthly_reserve: Optional[Annotated[StrictInt, Field(ge=0, le=MAX_CENTS)]] = None


class SimulateIn(Strict):
    amount: Cents
    category_id: ObjectIdStr
    reason_id: Optional[ObjectIdStr] = None
    date: Optional[Date] = None


CompareMode = Literal["last", "avg3", "yoy"]
