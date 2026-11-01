import hmac
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi.errors import RateLimitExceeded
from starlette.middleware.base import BaseHTTPMiddleware

from app.config import get_settings
from app.core.rate_limit import limiter
from app.core.security import CSRF_COOKIE, CSRF_HEADER
from app.db import close_db, init_db
from app.models import User
from app.routers import analytics, auth, bills, cycles, data, income, planning, security, settings, spending
from app.seed import seed_user
from app.services import cache

log = logging.getLogger("ledger")
API_PREFIX = "/api/v1"
SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}
# POSTs that compute but never write: they must not invalidate the analytics cache
READ_ONLY_POSTS = {f"{API_PREFIX}/analytics/simulate", f"{API_PREFIX}/settings/salary/preview"}


class CSRFAndVersionMiddleware(BaseHTTPMiddleware):
    """Double-submit CSRF check on every state-changing API call, and analytics cache
    invalidation after every successful write."""

    async def dispatch(self, request: Request, call_next):
        is_write = request.method not in SAFE_METHODS and request.url.path.startswith("/api/")
        if is_write:
            cookie = request.cookies.get(CSRF_COOKIE, "")
            header = request.headers.get(CSRF_HEADER, "")
            if not cookie or not header or not hmac.compare_digest(cookie.encode(), header.encode()):
                return JSONResponse({"detail": "CSRF token missing or invalid"}, status_code=403)
        response = await call_next(request)
        read_only_post = request.url.path in READ_ONLY_POSTS
        if is_write and not read_only_post and response.status_code < 400 and not request.url.path.startswith(f"{API_PREFIX}/auth/"):
            await cache.bump_version()
        response.headers.setdefault("Cache-Control", "no-store")
        return response


def create_app(init_database: bool = True) -> FastAPI:
    cfg = get_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        if init_database:
            await init_db()
            async for user in User.find_all():
                await seed_user(user.id)  # type: ignore[arg-type]
        yield
        if init_database:
            close_db()

    docs = not cfg.is_production
    app = FastAPI(
        title="Ledger API",
        version="1.0.0",
        lifespan=lifespan,
        docs_url=f"{API_PREFIX}/docs" if docs else None,
        redoc_url=None,
        openapi_url=f"{API_PREFIX}/openapi.json" if docs else None,
    )
    app.state.limiter = limiter

    @app.exception_handler(RateLimitExceeded)
    async def _rate_limited(request: Request, exc: RateLimitExceeded):
        return JSONResponse({"detail": "Too many attempts. Please wait and try again."}, status_code=429)

    app.add_middleware(CSRFAndVersionMiddleware)
    origins = [o.strip().rstrip("/") for o in cfg.frontend_origin.split(",") if o.strip()]
    if origins:
        # Added last so it runs first: preflight requests are answered before the CSRF check.
        app.add_middleware(
            CORSMiddleware,
            allow_origins=origins,
            allow_credentials=True,
            allow_methods=["GET", "POST", "PATCH", "DELETE"],
            allow_headers=["Content-Type", "X-CSRF-Token", "Accept"],
            expose_headers=["Content-Disposition"],
            max_age=600,
        )

    for module in (auth, security, income, bills, spending, analytics, data, settings, cycles, planning):
        app.include_router(module.router, prefix=API_PREFIX)

    @app.get(f"{API_PREFIX}/health", include_in_schema=False)
    async def health():
        return {"ok": True}

    return app


app = create_app()
