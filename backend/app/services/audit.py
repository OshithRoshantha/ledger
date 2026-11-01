from typing import Any, Optional

from beanie import PydanticObjectId
from starlette.requests import Request

from app.core.rate_limit import client_ip
from app.models import AuditLog


async def audit(
    request: Optional[Request],
    event: str,
    user_id: Optional[PydanticObjectId] = None,
    **details: Any,
) -> None:
    ip = client_ip(request) if request is not None else "cli"
    ua = (request.headers.get("user-agent", "") if request is not None else "cli")[:300]
    await AuditLog(user_id=user_id, event=event, ip=ip, user_agent=ua, details=details).insert()
