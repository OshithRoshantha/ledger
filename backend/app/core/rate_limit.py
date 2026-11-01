from slowapi import Limiter
from starlette.requests import Request

from app.config import get_settings


def client_ip(request: Request) -> str:
    # Gunicorn runs with --forwarded-allow-ips behind Nginx, so request.client is the real client.
    return request.client.host if request.client else "unknown"


def _limiter() -> Limiter:
    s = get_settings()
    # Production keeps counters in Mongo so limits hold across Gunicorn workers and restarts.
    if s.is_production:
        return Limiter(
            key_func=client_ip,
            enabled=s.rate_limit_enabled,
            storage_uri=s.mongo_url,
            storage_options={"database_name": s.mongo_db},
            headers_enabled=False,
        )
    return Limiter(key_func=client_ip, enabled=s.rate_limit_enabled, headers_enabled=False)


limiter = _limiter()

LOGIN_LIMIT = "5/15minutes"
VERIFY_LIMIT = "10/15minutes"
SENSITIVE_LIMIT = "10/hour"
