"""Single source of "today" so tests can pin the date in one place."""

from datetime import date

from app.services.cycles import today_local


def today(tz: str) -> date:
    return today_local(tz)
