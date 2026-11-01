import asyncio

from beanie import init_beanie
from motor.motor_asyncio import AsyncIOMotorClient

from app.config import get_settings
from app.models import ALL_DOCUMENTS

_client: AsyncIOMotorClient | None = None
_loop: asyncio.AbstractEventLoop | None = None
_lock: asyncio.Lock | None = None
_lock_loop: asyncio.AbstractEventLoop | None = None


async def init_db(database=None) -> None:
    """Initialise Beanie. Tests pass an in-memory database; production connects to MONGO_URL."""
    global _client, _loop
    if database is None:
        settings = get_settings()
        _client = AsyncIOMotorClient(settings.mongo_url, tz_aware=True, uuidRepresentation="standard")
        database = _client[settings.mongo_db]
    await init_beanie(database=database, document_models=ALL_DOCUMENTS)
    _loop = asyncio.get_running_loop()


async def ensure_db() -> None:
    """Lazy, idempotent init for serverless hosts (Vercel), where startup hooks may not run
    and a warm instance can serve requests on a new event loop (a Motor client is loop-bound)."""
    global _lock, _lock_loop
    loop = asyncio.get_running_loop()
    if _client is not None and _loop is loop:
        return
    if _lock is None or _lock_loop is not loop:
        _lock, _lock_loop = asyncio.Lock(), loop
    async with _lock:
        if _client is not None and _loop is loop:
            return
        close_db()
        await init_db()
        from app.models import User
        from app.seed import seed_user

        async for user in User.find_all():
            await seed_user(user.id)  # type: ignore[arg-type]


def close_db() -> None:
    global _client
    if _client is not None:
        _client.close()
        _client = None
