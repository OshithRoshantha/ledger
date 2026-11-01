from beanie import init_beanie
from motor.motor_asyncio import AsyncIOMotorClient

from app.config import get_settings
from app.models import ALL_DOCUMENTS

_client: AsyncIOMotorClient | None = None


async def init_db(database=None) -> None:
    """Initialise Beanie. Tests pass an in-memory database; production connects to MONGO_URL."""
    global _client
    if database is None:
        settings = get_settings()
        _client = AsyncIOMotorClient(settings.mongo_url, tz_aware=True, uuidRepresentation="standard")
        database = _client[settings.mongo_db]
    await init_beanie(database=database, document_models=ALL_DOCUMENTS)


def close_db() -> None:
    global _client
    if _client is not None:
        _client.close()
        _client = None
