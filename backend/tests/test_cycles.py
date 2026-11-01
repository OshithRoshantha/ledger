"""Pure cycle-engine tests (no database)."""

from datetime import date, datetime, timezone

import pytest

from app.services.cycles import (
    Chain,
    Span,
    display_label,
    label_for_start,
    local_day_to_utc,
    next_start,
    nominal,
    replan_for_salary_day,
    shift_label,
    utc_to_local_day,
)


def test_salary_day_5_cycle_is_5th_to_4th():
    chain = Chain([], 5)
    nov = chain.find(date(2026, 11, 12))
    assert (nov.label, nov.start, nov.end) == ("2026-11", date(2026, 11, 5), date(2026, 12, 4))
    assert display_label(nov.label) == "Nov 2026"


@pytest.mark.parametrize(
    "d, label",
    [
        (date(2026, 11, 2), "2026-10"),  # bill paid 2 Nov -> October salary
        (date(2026, 11, 4), "2026-10"),  # last day of the Oct cycle
        (date(2026, 11, 5), "2026-11"),  # exactly on the salary day -> new cycle
        (date(2026, 12, 4), "2026-11"),
        (date(2026, 12, 5), "2026-12"),
        (date(2027, 1, 4), "2026-12"),  # year rollover
    ],
)
def test_attribution_boundaries(d, label):
    assert Chain([], 5).find(d).label == label


def test_chain_is_contiguous_both_ways():
    chain = Chain([], 5)
    chain.find(date(2026, 11, 12))
    chain.find(date(2026, 1, 1))
    chain.find(date(2027, 6, 30))
    for a, b in zip(chain.spans, chain.spans[1:]):
        assert (b.start - a.end).days == 1
        assert b.label == shift_label(a.label, 1)


@pytest.mark.parametrize("year, feb_end", [(2027, 28), (2028, 29)])
def test_salary_day_31_uses_last_day_of_short_months(year, feb_end):
    assert nominal(year, 2, 31) == date(year, 2, feb_end)
    chain = Chain([], 31)
    jan = chain.find(date(year, 2, 10))
    assert jan.start == date(year, 1, 31)
    assert jan.end == date(year, 2, feb_end - 1)
    feb = chain.find(date(year, 2, feb_end))
    assert feb.start == date(year, 2, feb_end) and feb.end == date(year, 3, 30)
    assert chain.find(date(year, 3, 31)).start == date(year, 3, 31)
    assert len({s.label for s in chain.spans}) == len(chain.spans)  # labels stay unique


def test_salary_day_30_and_29_in_february():
    assert next_start(date(2027, 1, 30), 30) == date(2027, 2, 28)
    assert next_start(date(2027, 2, 28), 30) == date(2027, 3, 30)
    assert next_start(date(2028, 1, 29), 29) == date(2028, 2, 29)


def test_late_salary_days_label_by_majority_month():
    assert label_for_start(date(2026, 10, 25), 25) == "2026-11"
    assert label_for_start(date(2026, 11, 5), 5) == "2026-11"


def test_find_label_and_previous():
    chain = Chain([], 5)
    chain.find(date(2026, 11, 12))
    assert chain.find_label("2026-06").start == date(2026, 6, 5)
    nov = chain.find_label("2026-11")
    assert [s.label for s in chain.previous(nov, 3)] == ["2026-08", "2026-09", "2026-10"]


def test_override_start_keeps_label():
    oct_ = Span("2026-10", date(2026, 10, 5), date(2026, 11, 3))
    nov = Span("2026-11", date(2026, 11, 4), date(2026, 12, 4), is_override=True)
    chain = Chain([oct_, nov], 5)
    assert chain.find(date(2026, 11, 4)).label == "2026-11"
    assert chain.find(date(2026, 11, 3)).label == "2026-10"
    assert chain.find(date(2026, 12, 5)).start == date(2026, 12, 5)


def test_replan_keeps_closed_cycles_and_current_start():
    chain = Chain([], 5)
    chain.find(date(2026, 11, 12))
    chain.find(date(2026, 8, 1))
    cur = chain.find(date(2026, 11, 12))
    closed_before = [(s.label, s.start, s.end) for s in chain.spans if s.end < cur.start]
    new = replan_for_salary_day(chain, cur, 25)
    assert [(s.label, s.start, s.end) for s in new.spans if s.end < cur.start] == closed_before
    new_cur = new.find(date(2026, 11, 12))
    assert new_cur.start == date(2026, 11, 5) and new_cur.end == date(2026, 11, 24)
    nxt = new.find(date(2026, 11, 25))
    assert nxt.start == date(2026, 11, 25) and nxt.label == "2026-12"
    assert new.find(date(2026, 12, 26)).label == "2027-01"


def test_replan_to_earlier_day_extends_current():
    chain = Chain([], 5)
    cur = chain.find(date(2026, 11, 12))
    new = replan_for_salary_day(chain, cur, 1)
    assert new.find(date(2026, 11, 12)).end == date(2026, 11, 30)
    assert new.find(date(2026, 12, 1)).label == "2026-12"


def test_timezone_roundtrip():
    utc = local_day_to_utc(date(2026, 11, 1), "Asia/Colombo")
    assert utc == datetime(2026, 11, 1, 6, 30, tzinfo=timezone.utc)
    assert utc_to_local_day(utc, "Asia/Colombo") == date(2026, 11, 1)
    assert utc_to_local_day(datetime(2026, 10, 31, 20, 0, tzinfo=timezone.utc), "Asia/Colombo") == date(2026, 11, 1)
