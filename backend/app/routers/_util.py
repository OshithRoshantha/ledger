from datetime import datetime
from typing import Any, Iterable

from beanie import Document, PydanticObjectId
from bson import ObjectId


def _plain(value: Any) -> Any:
    if isinstance(value, (ObjectId, PydanticObjectId)):
        return str(value)
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, dict):
        return {k: _plain(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_plain(v) for v in value]
    return value


def dump(doc: Document, exclude: Iterable[str] = ()) -> dict[str, Any]:
    data = doc.model_dump(exclude={"revision_id", "user_id", *exclude})
    return _plain(data)


def dump_all(docs: Iterable[Document], exclude: Iterable[str] = ()) -> list[dict[str, Any]]:
    return [dump(d, exclude) for d in docs]
