"""Login -> 2FA -> session (rotating refresh token + short-lived access JWT)."""

from datetime import timedelta

from beanie import PydanticObjectId
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status

from app.config import get_settings
from app.core import totp
from app.core.deps import current_session
from app.core.rate_limit import LOGIN_LIMIT, VERIFY_LIMIT, client_ip, limiter
from app.core.security import (
    ACCESS_COOKIE,
    ACCESS_COOKIE_PATH,
    CSRF_COOKIE,
    REFRESH_COOKIE,
    REFRESH_COOKIE_PATH,
    TokenError,
    access_token,
    burn_password_check,
    decode_jwt,
    new_id,
    new_opaque_token,
    normalise_recovery_code,
    now_utc,
    preauth_token,
    sha256,
    verify_secret,
)
from app.models import PreAuth, RefreshToken, User, aware
from app.schemas import CodeIn, LoginIn, Verify2FAIn
from app.services.audit import audit
from app.services.ledger import get_app_settings

router = APIRouter(prefix="/auth", tags=["auth"])

GENERIC_LOGIN_ERROR = "Invalid username or password."
MAX_FAILED_LOGINS = 10
FAILED_WINDOW = timedelta(hours=1)
LOCKOUT = timedelta(minutes=30)
MAX_2FA_FAILURES = 5


def _cookie_kwargs(path: str, max_age: int, httponly: bool = True) -> dict:
    return {
        "path": path,
        "max_age": max_age,
        "httponly": httponly,
        "secure": get_settings().cookie_secure,
        "samesite": "strict",
    }


def set_csrf_cookie(response: Response, token: str) -> None:
    response.set_cookie(CSRF_COOKIE, token, **_cookie_kwargs("/", 7 * 24 * 3600, httponly=False))


def _set_session_cookies(response: Response, user_id: str, family_id: str, refresh: str) -> None:
    s = get_settings()
    response.set_cookie(
        ACCESS_COOKIE, access_token(user_id, family_id), **_cookie_kwargs(ACCESS_COOKIE_PATH, s.access_ttl_minutes * 60)
    )
    response.set_cookie(REFRESH_COOKIE, refresh, **_cookie_kwargs(REFRESH_COOKIE_PATH, s.refresh_ttl_days * 86400))


def clear_session_cookies(response: Response) -> None:
    for name, path in ((ACCESS_COOKIE, ACCESS_COOKIE_PATH), (REFRESH_COOKIE, REFRESH_COOKIE_PATH)):
        response.delete_cookie(name, path=path, secure=get_settings().cookie_secure, httponly=True, samesite="strict")


async def _issue_session(request: Request, response: Response, user: User, family_id: str | None = None) -> None:
    refresh = new_opaque_token()
    family = family_id or new_id()
    await RefreshToken(
        user_id=user.id,  # type: ignore[arg-type]
        family_id=family,
        token_hash=sha256(refresh),
        expires_at=now_utc() + timedelta(days=get_settings().refresh_ttl_days),
        user_agent=request.headers.get("user-agent", "")[:300],
        ip=client_ip(request),
    ).insert()
    _set_session_cookies(response, str(user.id), family, refresh)


async def revoke_family(family_id: str) -> None:
    await RefreshToken.get_motor_collection().update_many(
        {"family_id": family_id, "revoked": False}, {"$set": {"revoked": True, "revoked_at": now_utc()}}
    )


async def revoke_all(user_id: PydanticObjectId, except_family: str | None = None) -> None:
    query: dict = {"user_id": user_id, "revoked": False}
    if except_family:
        query["family_id"] = {"$ne": except_family}
    await RefreshToken.get_motor_collection().update_many(query, {"$set": {"revoked": True, "revoked_at": now_utc()}})


def check_totp_or_recovery(user: User, code: str, allow_recovery: bool = True) -> str | None:
    """Return "totp" / "recovery" on success (mutating `user`), None on failure. Caller saves."""
    secret = totp.decrypt_secret(user.totp_secret_enc)
    step = totp.verify_code(secret, code, user.last_totp_step)
    if step is not None:
        user.last_totp_step = step
        return "totp"
    if allow_recovery and not code.strip().isdigit():
        normalised = normalise_recovery_code(code)
        for hashed in user.recovery_code_hashes:
            if verify_secret(hashed, normalised):
                user.recovery_code_hashes = [h for h in user.recovery_code_hashes if h != hashed]
                return "recovery"
    return None


# ---------------------------------------------------------------- endpoints


@router.get("/csrf")
async def csrf(request: Request, response: Response) -> dict:
    token = request.cookies.get(CSRF_COOKIE) or new_opaque_token()
    set_csrf_cookie(response, token)
    return {"csrf": token}


@router.post("/login")
@limiter.limit(LOGIN_LIMIT)
async def login(request: Request, body: LoginIn) -> dict:
    user = await User.find_one(User.username == body.username.strip().lower())
    if user is None:
        burn_password_check(body.password)
        await audit(request, "login_failed", username=body.username[:64], reason="unknown_user")
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, GENERIC_LOGIN_ERROR)

    now = now_utc()
    locked_until = aware(user.locked_until)
    if locked_until and locked_until > now:
        burn_password_check(body.password)
        await audit(request, "login_failed", user.id, reason="locked")
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, GENERIC_LOGIN_ERROR)

    if not verify_secret(user.password_hash, body.password):
        window = aware(user.failed_window_start)
        if window is None or now - window > FAILED_WINDOW:
            user.failed_window_start, user.failed_logins = now, 0
        user.failed_logins += 1
        if user.failed_logins >= MAX_FAILED_LOGINS:
            user.locked_until = now + LOCKOUT
            user.failed_logins, user.failed_window_start = 0, None
            await audit(request, "account_locked", user.id, minutes=int(LOCKOUT.total_seconds() // 60))
        await user.save()
        await audit(request, "login_failed", user.id, reason="bad_password")
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, GENERIC_LOGIN_ERROR)

    user.failed_logins, user.failed_window_start, user.locked_until = 0, None, None
    await user.save()
    jti = new_id()
    await PreAuth(
        jti=jti, user_id=user.id, expires_at=now + timedelta(minutes=get_settings().preauth_ttl_minutes)  # type: ignore[arg-type]
    ).insert()
    await audit(request, "login_password_ok", user.id)
    return {"pre_auth_token": preauth_token(str(user.id), jti), "expires_in": get_settings().preauth_ttl_minutes * 60}


@router.post("/verify-2fa")
@limiter.limit(VERIFY_LIMIT)
async def verify_2fa(request: Request, response: Response, body: Verify2FAIn) -> dict:
    invalid = HTTPException(status.HTTP_401_UNAUTHORIZED, "Sign-in expired. Please start again.")
    try:
        payload = decode_jwt(body.pre_auth_token, "preauth")
    except TokenError:
        raise invalid
    pre = await PreAuth.find_one(PreAuth.jti == payload.get("jti"))
    if pre is None or pre.used or pre.failures >= MAX_2FA_FAILURES or str(pre.user_id) != payload["sub"]:
        raise invalid
    user = await User.get(pre.user_id)
    if user is None:
        raise invalid

    method = check_totp_or_recovery(user, body.code)
    if method is None:
        pre.failures += 1
        await pre.save()
        await audit(request, "2fa_failed", user.id, attempt=pre.failures)
        remaining = MAX_2FA_FAILURES - pre.failures
        if remaining <= 0:
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Too many wrong codes. Please sign in again.")
        raise HTTPException(status.HTTP_400_BAD_REQUEST, {"message": "Wrong code.", "remaining": remaining})

    pre.used = True
    await pre.save()
    await user.save()
    await _issue_session(request, response, user)
    await audit(request, "login_success", user.id, method=method)
    return {"ok": True, "username": user.username, "recovery_codes_left": len(user.recovery_code_hashes)}


async def _session_from_refresh_cookie(request: Request) -> RefreshToken:
    raw = request.cookies.get(REFRESH_COOKIE)
    if not raw:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not authenticated")
    token = await RefreshToken.find_one(RefreshToken.token_hash == sha256(raw))
    if token is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not authenticated")
    if token.revoked:
        # A rotated-out token was presented again: assume theft and kill the whole family.
        await revoke_family(token.family_id)
        await audit(request, "refresh_reuse_detected", token.user_id)
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not authenticated")
    if aware(token.expires_at) <= now_utc():
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Session expired")
    return token


async def _rotate(request: Request, response: Response, token: RefreshToken) -> None:
    user = await User.get(token.user_id)
    if user is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not authenticated")
    token.revoked, token.revoked_at = True, now_utc()
    await token.save()
    await _issue_session(request, response, user, family_id=token.family_id)


@router.post("/refresh")
async def refresh(request: Request, response: Response) -> dict:
    token = await _session_from_refresh_cookie(request)
    cfg = await get_app_settings(token.user_id)
    if not token.locked and now_utc() - aware(token.last_seen_at) > timedelta(minutes=cfg.auto_lock_minutes):
        token.locked = True
        await token.save()
    if token.locked:
        raise HTTPException(status.HTTP_423_LOCKED, "Session locked")
    await _rotate(request, response, token)
    return {"ok": True}


@router.post("/lock")
async def lock(request: Request, response: Response) -> dict:
    token = await _session_from_refresh_cookie(request)
    token.locked = True
    await token.save()
    response.delete_cookie(ACCESS_COOKIE, path=ACCESS_COOKIE_PATH, secure=get_settings().cookie_secure, httponly=True, samesite="strict")
    return {"ok": True}


@router.post("/unlock")
@limiter.limit(VERIFY_LIMIT)
async def unlock(request: Request, response: Response, body: CodeIn) -> dict:
    token = await _session_from_refresh_cookie(request)
    user = await User.get(token.user_id)
    if user is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not authenticated")
    if check_totp_or_recovery(user, body.code, allow_recovery=False) is None:
        token.unlock_failures += 1
        await token.save()
        await audit(request, "unlock_failed", user.id, attempt=token.unlock_failures)
        if token.unlock_failures >= MAX_2FA_FAILURES:
            await revoke_family(token.family_id)
            clear_session_cookies(response)
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Too many wrong codes. Please sign in again.")
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, {"message": "Wrong code.", "remaining": MAX_2FA_FAILURES - token.unlock_failures}
        )
    await user.save()
    await _rotate(request, response, token)
    await audit(request, "unlock_success", user.id)
    return {"ok": True}


@router.post("/logout")
async def logout(request: Request, response: Response) -> dict:
    raw = request.cookies.get(REFRESH_COOKIE)
    if raw:
        token = await RefreshToken.find_one(RefreshToken.token_hash == sha256(raw))
        if token:
            await revoke_family(token.family_id)
            await audit(request, "logout", token.user_id)
    clear_session_cookies(response)
    return {"ok": True}


@router.post("/logout-all")
async def logout_all(request: Request, response: Response, session: RefreshToken = Depends(current_session)) -> dict:
    await revoke_all(session.user_id)
    await audit(request, "logout_all", session.user_id)
    clear_session_cookies(response)
    return {"ok": True}


@router.get("/me")
async def me(session: RefreshToken = Depends(current_session)) -> dict:
    user = await User.get(session.user_id)
    cfg = await get_app_settings(session.user_id)
    return {
        "username": user.username if user else "",
        "recovery_codes_left": len(user.recovery_code_hashes) if user else 0,
        "onboarded": cfg.onboarded,
    }
