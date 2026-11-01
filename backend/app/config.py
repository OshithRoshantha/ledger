from functools import lru_cache

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """All configuration comes from environment variables (or a local .env file)."""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    env: str = Field(default="development", description="development | production | test")
    mongo_url: str = "mongodb://localhost:27017"
    mongo_db: str = "ledger"

    jwt_secret: str
    totp_enc_key: str

    cookie_secure: bool = True
    # Comma-separated origins allowed to call the API cross-origin, e.g. https://app.example.com
    # (needed when the frontend is hosted separately, like GitHub Pages + Render).
    frontend_origin: str = ""
    # Token mode for cross-site hosting (github.io + onrender.com), where browsers block the
    # API's cookies: tokens are returned in JSON and sent back as Authorization / X-Refresh-Token.
    token_auth: bool = False
    totp_issuer: str = "Ledger"
    default_timezone: str = "Asia/Colombo"
    default_salary_day: int = 5

    access_ttl_minutes: int = 15
    refresh_ttl_days: int = 7
    preauth_ttl_minutes: int = 5

    # Argon2id parameters. memory is in KiB (65536 = 64 MB).
    argon2_time_cost: int = 3
    argon2_memory_kib: int = 65536
    argon2_parallelism: int = 2

    rate_limit_enabled: bool = True

    @model_validator(mode="before")
    @classmethod
    def _strip_values(cls, data):
        # Values pasted or piped into hosting dashboards/CLIs sometimes carry a BOM or a newline.
        if isinstance(data, dict):
            return {k: v.strip().lstrip("﻿").strip() if isinstance(v, str) else v for k, v in data.items()}
        return data

    @field_validator("jwt_secret")
    @classmethod
    def _jwt_secret_strength(cls, v: str) -> str:
        if len(v) < 32:
            raise ValueError("JWT_SECRET must be at least 32 characters")
        return v

    @field_validator("default_salary_day")
    @classmethod
    def _salary_day(cls, v: int) -> int:
        if not 1 <= v <= 31:
            raise ValueError("DEFAULT_SALARY_DAY must be between 1 and 31")
        return v

    @property
    def is_production(self) -> bool:
        return self.env == "production"


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
