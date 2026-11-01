"""Vercel entry point: every request is rewritten here (see vercel.json) and served by FastAPI."""

from app.main import app  # noqa: F401
