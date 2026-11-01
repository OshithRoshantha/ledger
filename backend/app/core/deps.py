from datetime import timedelta

from beanie import PydanticObjectId
from fastapi import Depends, HTTPException, Request, status

from app.config import get_settings
from app.core.security import ACCESS_COOKIE, TokenError, decode_jwt, now_utc
from app.models import AppSettings, RefreshToken, User, aware
from app.services.ledger import get_app_settings

UNAUTHORISED = HTTPException(status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
LOCKED = HTTPException(status.HTTP_423_LOCKED, detail="Session locked")

_SEEN_WRITE_INTERVAL = timedelta(seconds=60)


async def current_session(request: Request) -> RefreshToken:
    """Validate the access cookie *and* that its session family is still live.

    Checking the session on every request makes logout / logout-all / lock take effect
    immediately instead of when the 15-minute access token expires. It also enforces the
    idle auto-lock server-side.
    """
    token = request.cookies.get(ACCESS_COOKIE)
    auth = request.headers.get("authorization", "")
    if auth.lower().startswith("bearer ") and get_settings().token_auth:
        token = auth[7:].strip()
    if not token:
        raise UNAUTHORISED
    try:
        payload = decode_jwt(token, "access")
    except TokenError:
        raise UNAUTHORISED
    session = await RefreshToken.find_one({"family_id": payload.get("sid"), "revoked": False})
    if session is None or str(session.user_id) != payload["sub"] or aware(session.expires_at) <= now_utc():
        raise UNAUTHORISED
    if session.locked:
        raise LOCKED
    cfg = await get_app_settings(session.user_id)
    now = now_utc()
    last_seen = aware(session.last_seen_at)
    if now - last_seen > timedelta(minutes=cfg.auto_lock_minutes):
        session.locked = True
        await session.save()
        raise LOCKED
    if now - last_seen > _SEEN_WRITE_INTERVAL:
        session.last_seen_at = now
        await session.save()
    request.state.session = session
    return session


async def current_user(session: RefreshToken = Depends(current_session)) -> User:
    user = await User.get(session.user_id)
    if user is None:
        raise UNAUTHORISED
    return user


async def user_settings(user: User = Depends(current_user)) -> AppSettings:
    return await get_app_settings(user.id)  # type: ignore[arg-type]


def oid(value: str) -> PydanticObjectId:
    try:
        return PydanticObjectId(value)
    except Exception:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Not found")
