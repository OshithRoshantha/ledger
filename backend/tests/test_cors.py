"""Split hosting (GitHub Pages frontend + Render API): CORS with credentials for one origin only."""

from httpx import ASGITransport, AsyncClient

from app.config import get_settings
from app.main import create_app

APP = "https://money.example.com"


async def test_cors_allows_only_configured_origin(db, monkeypatch):
    monkeypatch.setattr(get_settings(), "frontend_origin", APP + "/")
    app = create_app(init_database=False)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="https://test") as c:
        pre = await c.options(
            "/api/v1/auth/login",
            headers={"Origin": APP, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type,x-csrf-token"},
        )
        assert pre.status_code == 200
        assert pre.headers["access-control-allow-origin"] == APP
        assert pre.headers["access-control-allow-credentials"] == "true"
        assert "x-csrf-token" in pre.headers["access-control-allow-headers"].lower()

        evil = await c.options(
            "/api/v1/auth/login", headers={"Origin": "https://evil.example.net", "Access-Control-Request-Method": "POST"}
        )
        assert "access-control-allow-origin" not in evil.headers

        r = await c.get("/api/v1/auth/csrf", headers={"Origin": APP})
        assert r.headers["access-control-allow-origin"] == APP
        assert r.json()["csrf"]


async def test_no_cors_by_default(db):
    app = create_app(init_database=False)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="https://test") as c:
        r = await c.get("/api/v1/health", headers={"Origin": APP})
        assert "access-control-allow-origin" not in r.headers
