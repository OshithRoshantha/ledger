"""MongoDB documents (Beanie ODM).

Every amount is an integer number of cents (LKR x 100). Nothing is ever stored as a float.
Every transactional document carries `cycle` ("YYYY-MM" budget-cycle label) and `day`
("YYYY-MM-DD" local calendar date) next to the UTC timestamp, so aggregations can group
by cycle/day without timezone maths inside the database.
"""

from datetime import datetime, timezone
from typing import Any, Literal, Optional

from beanie import Document, PydanticObjectId
from pydantic import BaseModel, Field
from pymongo import ASCENDING, DESCENDING, IndexModel


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def aware(dt: Optional[datetime]) -> Optional[datetime]:
    """Mongo returns naive UTC datetimes; normalise them to aware UTC."""
    if dt is None:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


Method = Literal["atm", "bank_transfer", "card", "cash", "other"]
IncomeType = Literal["fixed", "variable"]
Theme = Literal["dark", "light", "system"]
NeedWant = Literal["need", "want"]


def _txn_indexes() -> list[IndexModel]:
    return [
        IndexModel([("user_id", ASCENDING), ("cycle", ASCENDING)]),
        IndexModel([("user_id", ASCENDING), ("day", ASCENDING)]),
    ]


# ---------------------------------------------------------------- auth


class User(Document):
    username: str
    password_hash: str
    totp_secret_enc: str
    pending_totp_secret_enc: Optional[str] = None
    recovery_code_hashes: list[str] = Field(default_factory=list)
    last_totp_step: int = 0
    failed_logins: int = 0
    failed_window_start: Optional[datetime] = None
    locked_until: Optional[datetime] = None
    created_at: datetime = Field(default_factory=utcnow)

    class Settings:
        name = "users"
        indexes = [IndexModel([("username", ASCENDING)], unique=True)]


class RefreshToken(Document):
    user_id: PydanticObjectId
    family_id: str
    token_hash: str
    expires_at: datetime
    revoked: bool = False
    revoked_at: Optional[datetime] = None
    locked: bool = False
    unlock_failures: int = 0
    last_seen_at: datetime = Field(default_factory=utcnow)
    user_agent: str = ""
    ip: str = ""
    created_at: datetime = Field(default_factory=utcnow)

    class Settings:
        name = "refresh_tokens"
        indexes = [
            IndexModel([("token_hash", ASCENDING)], unique=True),
            IndexModel([("family_id", ASCENDING), ("revoked", ASCENDING)]),
            IndexModel([("user_id", ASCENDING)]),
        ]


class TrustedDevice(Document):
    """A browser the user chose to remember: it skips the 2FA code (never the password)."""

    user_id: PydanticObjectId
    token_hash: str
    expires_at: datetime
    revoked: bool = False
    user_agent: str = ""
    ip: str = ""
    created_at: datetime = Field(default_factory=utcnow)
    last_used_at: datetime = Field(default_factory=utcnow)

    class Settings:
        name = "trusted_devices"
        indexes = [
            IndexModel([("token_hash", ASCENDING)], unique=True),
            IndexModel([("user_id", ASCENDING), ("revoked", ASCENDING)]),
        ]


class PreAuth(Document):
    """State for a short-lived pre-auth token (password OK, waiting for 2FA)."""

    jti: str
    user_id: PydanticObjectId
    failures: int = 0
    used: bool = False
    expires_at: datetime

    class Settings:
        name = "preauth"
        indexes = [
            IndexModel([("jti", ASCENDING)], unique=True),
            IndexModel([("expires_at", ASCENDING)], expireAfterSeconds=3600),
        ]


class AuditLog(Document):
    user_id: Optional[PydanticObjectId] = None
    event: str
    ip: str = ""
    user_agent: str = ""
    details: dict[str, Any] = Field(default_factory=dict)
    at: datetime = Field(default_factory=utcnow)

    class Settings:
        name = "audit_log"
        indexes = [IndexModel([("at", DESCENDING)]), IndexModel([("event", ASCENDING), ("at", DESCENDING)])]


class Meta(Document):
    """Small key/value store; `data_version` invalidates the analytics cache across workers."""

    key: str
    version: int = 0

    class Settings:
        name = "meta"
        indexes = [IndexModel([("key", ASCENDING)], unique=True)]


# ---------------------------------------------------------------- preferences


class AmountHistory(BaseModel):
    amount: int
    effective_from_cycle: str


class AppSettings(Document):
    user_id: PydanticObjectId
    salary_day: int = 5
    salary_history: list[AmountHistory] = Field(default_factory=list)
    timezone: str = "Asia/Colombo"
    currency: Literal["LKR"] = "LKR"
    theme: Theme = "dark"
    auto_lock_minutes: int = 10
    reminder_days_before_cycle_end: int = 5
    onboarded: bool = False
    last_category_id: Optional[PydanticObjectId] = None
    last_reason_id: Optional[PydanticObjectId] = None
    last_method: Optional[Method] = None

    class Settings:
        name = "settings"
        indexes = [IndexModel([("user_id", ASCENDING)], unique=True)]


# ---------------------------------------------------------------- income


class IncomeSource(Document):
    user_id: PydanticObjectId
    name: str
    type: IncomeType = "variable"
    default_amount: int = 0
    is_active: bool = True
    sort_order: int = 0
    created_at: datetime = Field(default_factory=utcnow)

    class Settings:
        name = "income_sources"
        indexes = [IndexModel([("user_id", ASCENDING), ("sort_order", ASCENDING)])]


class IncomeEntry(Document):
    user_id: PydanticObjectId
    source_id: PydanticObjectId
    cycle: str
    amount: int
    date: datetime
    day: str
    note: str = ""
    status: Literal["pending", "received"] = "received"
    deleted_at: Optional[datetime] = None
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)

    class Settings:
        name = "income_entries"
        indexes = _txn_indexes()


# ---------------------------------------------------------------- fixed bills


class CycleDoc(Document):
    """A stored budget cycle. Boundaries are fixed once stored so history never shifts."""

    user_id: PydanticObjectId
    label: str
    start_date: str  # YYYY-MM-DD local, inclusive
    end_date: str  # YYYY-MM-DD local, inclusive
    salary_amount: int = 0
    is_override: bool = False
    closed: bool = False
    created_at: datetime = Field(default_factory=utcnow)

    class Settings:
        name = "cycles"
        indexes = [
            IndexModel([("user_id", ASCENDING), ("label", ASCENDING)], unique=True),
            IndexModel([("user_id", ASCENDING), ("start_date", ASCENDING)]),
        ]


class FixedExpense(Document):
    user_id: PydanticObjectId
    name: str
    group: str
    amount: int  # latest template amount (mirror of the newest amount_history entry)
    icon: str = "receipt"
    colour: str = "#56B4E9"
    sort_order: int = 0
    is_active: bool = True
    archived_from_cycle: Optional[str] = None
    amount_history: list[AmountHistory] = Field(default_factory=list)
    created_at: datetime = Field(default_factory=utcnow)

    class Settings:
        name = "fixed_expenses"
        indexes = [IndexModel([("user_id", ASCENDING), ("sort_order", ASCENDING)])]


class FixedPayment(Document):
    user_id: PydanticObjectId
    fixed_expense_id: PydanticObjectId
    cycle: str
    amount_paid: int
    paid_at: datetime
    day: str
    note: str = ""
    # False = settled for this cycle but paid from an earlier salary: not deducted from this cycle
    deducted: bool = True
    deleted_at: Optional[datetime] = None
    created_at: datetime = Field(default_factory=utcnow)

    class Settings:
        name = "fixed_payments"
        indexes = _txn_indexes() + [IndexModel([("fixed_expense_id", ASCENDING), ("cycle", ASCENDING)])]


# ---------------------------------------------------------------- variable spending


class VariableCategory(Document):
    user_id: PydanticObjectId
    name: str
    icon: str = "wallet"
    colour: str = "#0072B2"
    requires_reason: bool = False
    unit: str = "entries"
    need_want: NeedWant = "want"
    is_active: bool = True
    sort_order: int = 0
    created_at: datetime = Field(default_factory=utcnow)

    class Settings:
        name = "variable_categories"
        indexes = [IndexModel([("user_id", ASCENDING), ("sort_order", ASCENDING)])]


class Reason(Document):
    user_id: PydanticObjectId
    name: str
    icon: str = "tag"
    colour: str = "#9AA3B2"
    need_want: NeedWant = "want"
    is_active: bool = True
    sort_order: int = 0
    created_at: datetime = Field(default_factory=utcnow)

    class Settings:
        name = "reasons"
        indexes = [IndexModel([("user_id", ASCENDING), ("sort_order", ASCENDING)])]


class ExpenseEntry(Document):
    user_id: PydanticObjectId
    category_id: PydanticObjectId
    cycle: str
    amount: int
    date: datetime
    day: str
    method: Optional[Method] = None
    reason_id: Optional[PydanticObjectId] = None
    note: str = ""
    deleted_at: Optional[datetime] = None
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)

    class Settings:
        name = "expense_entries"
        indexes = _txn_indexes() + [IndexModel([("user_id", ASCENDING), ("category_id", ASCENDING), ("cycle", ASCENDING)])]


# ---------------------------------------------------------------- planning


class Budget(Document):
    """Monthly limit for a variable category or a Bank & Cash reason."""

    user_id: PydanticObjectId
    target_type: Literal["category", "reason"]
    target_id: PydanticObjectId
    amount: int
    deleted_at: Optional[datetime] = None
    created_at: datetime = Field(default_factory=utcnow)

    class Settings:
        name = "budgets"
        indexes = [IndexModel([("user_id", ASCENDING), ("target_type", ASCENDING), ("target_id", ASCENDING)])]


class Goal(Document):
    user_id: PydanticObjectId
    name: str
    target_amount: int
    target_date: str  # YYYY-MM-DD
    saved_amount: int = 0
    monthly_reserve: int = 0  # set aside each cycle; reduces Safe to spend
    deleted_at: Optional[datetime] = None
    created_at: datetime = Field(default_factory=utcnow)

    class Settings:
        name = "goals"
        indexes = [IndexModel([("user_id", ASCENDING)])]


ALL_DOCUMENTS = [
    TrustedDevice,
    CycleDoc,
    Budget,
    Goal,
    User,
    RefreshToken,
    PreAuth,
    AuditLog,
    Meta,
    AppSettings,
    IncomeSource,
    IncomeEntry,
    FixedExpense,
    FixedPayment,
    VariableCategory,
    Reason,
    ExpenseEntry,
]
