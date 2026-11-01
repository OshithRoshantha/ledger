"""Salary-cycle maths (pure functions, no I/O).

A cycle runs from a salary date (00:00 local) to the day before the next salary date
(23:59 local). With salary day 5, "Nov 2026" = 5 Nov - 4 Dec. Salary days 29-31 fall
back to the last day of shorter months.

Cycles are stored (see cycle_store.py) so their boundaries never shift once created.
`Chain` is the in-memory model of that stored, contiguous list of cycles. It extends
itself forward/backward on demand, which is how new cycles are created.

Labels: a cycle is named after the month it mostly covers. For salary day <= 15 that is
the month the cycle starts in; for later days it is the following month (salary day 25
-> "Nov 2026" = 25 Oct - 24 Nov). A stored label never changes, even if its start is
moved by an early/late-salary override.
"""

import calendar
import re
from bisect import bisect_right
from dataclasses import dataclass, field, replace
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

LABEL_RE = re.compile(r"^(\d{4})-(0[1-9]|1[0-2])$")
MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
MONTHS_FULL = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
]
MIN_GAP_DAYS = 15  # the next salary date is at least this far after a cycle's start
MAX_EXTEND = 1200


# ---------------------------------------------------------------- labels


def add_months(year: int, month: int, n: int) -> tuple[int, int]:
    idx = year * 12 + (month - 1) + n
    return idx // 12, idx % 12 + 1


def parse_label(label: str) -> tuple[int, int]:
    m = LABEL_RE.match(label or "")
    if not m:
        raise ValueError(f"Invalid cycle label {label!r}; expected YYYY-MM")
    return int(m.group(1)), int(m.group(2))


def make_label(year: int, month: int) -> str:
    return f"{year:04d}-{month:02d}"


def shift_label(label: str, n: int) -> str:
    return make_label(*add_months(*parse_label(label), n))


def display_label(label: str) -> str:
    y, m = parse_label(label)
    return f"{MONTHS[m - 1]} {y}"


def short_month(label: str) -> str:
    return MONTHS[parse_label(label)[1] - 1]


def month_name(label: str) -> str:
    return MONTHS_FULL[parse_label(label)[1] - 1]


# ---------------------------------------------------------------- salary dates


def nominal(year: int, month: int, salary_day: int) -> date:
    """The salary date in a month, clamped to the month's last day (31 -> 28/29 Feb)."""
    return date(year, month, min(salary_day, calendar.monthrange(year, month)[1]))


def next_start(start: date, salary_day: int) -> date:
    """First salary date at least MIN_GAP_DAYS after `start`."""
    floor = start + timedelta(days=MIN_GAP_DAYS)
    y, m = start.year, start.month
    for _ in range(4):
        cand = nominal(y, m, salary_day)
        if cand >= floor:
            return cand
        y, m = add_months(y, m, 1)
    raise AssertionError("unreachable")


def prev_start(start: date, salary_day: int) -> date:
    """Latest salary date at least MIN_GAP_DAYS before `start`."""
    ceiling = start - timedelta(days=MIN_GAP_DAYS)
    y, m = start.year, start.month
    for _ in range(4):
        cand = nominal(y, m, salary_day)
        if cand <= ceiling:
            return cand
        y, m = add_months(y, m, -1)
    raise AssertionError("unreachable")


def nominal_start_for(day: date, salary_day: int) -> date:
    """The scheduled salary date on or before `day`."""
    this = nominal(day.year, day.month, salary_day)
    if this <= day:
        return this
    return nominal(*add_months(day.year, day.month, -1), salary_day)


def label_for_start(start: date, salary_day: int) -> str:
    if salary_day <= 15:
        return make_label(start.year, start.month)
    return make_label(*add_months(start.year, start.month, 1))


# ---------------------------------------------------------------- spans


@dataclass
class Span:
    label: str
    start: date
    end: date  # inclusive
    is_override: bool = False
    salary_amount: int = 0

    @property
    def days(self) -> int:
        return (self.end - self.start).days + 1

    @property
    def end_excl(self) -> date:
        return self.end + timedelta(days=1)

    def contains(self, d: date) -> bool:
        return self.start <= d <= self.end

    def day_index(self, d: date) -> int:
        """0-based position of `d`, clamped into the cycle."""
        return min(max((d - self.start).days, 0), self.days - 1)

    def closed(self, today: date) -> bool:
        return self.end < today


@dataclass
class Chain:
    """Contiguous cycles, oldest first. `added` collects spans created by extension."""

    spans: list[Span]
    salary_day: int
    added: list[Span] = field(default_factory=list)

    def __post_init__(self) -> None:
        self.spans = sorted(self.spans, key=lambda s: s.start)

    # -- extension
    def seed(self, day: date) -> Span:
        start = nominal_start_for(day, self.salary_day)
        span = Span(label_for_start(start, self.salary_day), start, next_start(start, self.salary_day) - timedelta(days=1))
        self.spans = [span]
        self.added.append(span)
        return span

    def _append(self) -> Span:
        last = self.spans[-1]
        start = last.end + timedelta(days=1)
        label = max(label_for_start(start, self.salary_day), shift_label(last.label, 1))
        span = Span(label, start, next_start(start, self.salary_day) - timedelta(days=1))
        self.spans.append(span)
        self.added.append(span)
        return span

    def _prepend(self) -> Span:
        first = self.spans[0]
        start = prev_start(first.start, self.salary_day)
        label = min(label_for_start(start, self.salary_day), shift_label(first.label, -1))
        span = Span(label, start, first.start - timedelta(days=1))
        self.spans.insert(0, span)
        self.added.append(span)
        return span

    # -- lookup
    def find(self, day: date) -> Span:
        if not self.spans:
            return self.seed(day)
        for _ in range(MAX_EXTEND):
            if day > self.spans[-1].end:
                self._append()
            elif day < self.spans[0].start:
                self._prepend()
            else:
                break
        starts = [s.start for s in self.spans]
        return self.spans[bisect_right(starts, day) - 1]

    def find_label(self, label: str) -> Span:
        """Exact label, or the nearest later one when a salary-day change skipped a label."""
        if not self.spans:
            raise LookupError("empty chain")
        parse_label(label)
        for _ in range(MAX_EXTEND):
            if label > self.spans[-1].label:
                self._append()
            elif label < self.spans[0].label:
                self._prepend()
            else:
                break
        for s in self.spans:
            if s.label >= label:
                return s
        return self.spans[-1]

    def index(self, span: Span) -> int:
        return next(i for i, s in enumerate(self.spans) if s.label == span.label)

    def previous(self, span: Span, n: int) -> list[Span]:
        """Up to `n` cycles before `span`, oldest first (extending into the past)."""
        while self.index(span) < n:
            self._prepend()
        i = self.index(span)
        return self.spans[i - n : i]

    def next(self, span: Span) -> Span:
        i = self.index(span)
        if i == len(self.spans) - 1:
            self._append()
        return self.spans[i + 1]


def replan_for_salary_day(chain: Chain, current: Span, new_day: int) -> Chain:
    """New chain after a salary-day change: closed cycles untouched, the current cycle keeps
    its start but gets a new end, and every later cycle is regenerated with the new day."""
    kept = [replace(s) for s in chain.spans if s.start < current.start]
    new_current = replace(current, end=next_start(current.start, new_day) - timedelta(days=1))
    return Chain(kept + [new_current], new_day)


# ---------------------------------------------------------------- time helpers


def today_local(tz: str, now: datetime | None = None) -> date:
    now = now or datetime.now(timezone.utc)
    return now.astimezone(ZoneInfo(tz)).date()


def local_day_to_utc(d: date, tz: str) -> datetime:
    """Represent a calendar date as local noon, stored in UTC (robust to DST edges)."""
    return datetime.combine(d, time(12, 0), tzinfo=ZoneInfo(tz)).astimezone(timezone.utc)


def utc_to_local_day(dt: datetime, tz: str) -> date:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(ZoneInfo(tz)).date()
