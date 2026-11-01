"""Per-cycle analytics cache.

The cache lives in process memory, but its validity is tied to a `data_version` counter in
Mongo that every successful write bumps. That keeps several Gunicorn workers consistent:
a worker never serves an entry computed against an older version.
"""

from typing import Any, Hashable

from app.models import Meta

_MAX_ENTRIES = 64
_cache: dict[Hashable, Any] = {}

VERSION_KEY = "data_version"


async def data_version() -> int:
    doc = await Meta.find_one(Meta.key == VERSION_KEY)
    return doc.version if doc else 0


async def bump_version() -> None:
    await Meta.get_motor_collection().update_one({"key": VERSION_KEY}, {"$inc": {"version": 1}}, upsert=True)
    _cache.clear()


def get(key: Hashable) -> Any | None:
    return _cache.get(key)


def put(key: Hashable, value: Any) -> None:
    if len(_cache) >= _MAX_ENTRIES:
        _cache.clear()
    _cache[key] = value


def clear() -> None:
    _cache.clear()
