from fastapi import APIRouter, Depends, HTTPException, Request, status

from app.core import totp
from app.core.deps import current_session, current_user
from app.core.rate_limit import SENSITIVE_LIMIT, limiter
from app.core.security import hash_secret, new_recovery_codes, password_problems, verify_secret
from app.models import AuditLog, RefreshToken, User
from app.schemas import ChangePasswordIn, CodeIn, PasswordAndCodeIn
from app.services.audit import audit

from .auth import check_totp_or_recovery, revoke_all

router = APIRouter(prefix="/security", tags=["security"])

AUTH_EVENTS = [
    "login_success", "login_failed", "2fa_failed", "account_locked", "logout", "logout_all",
    "unlock_failed", "unlock_success", "password_changed", "2fa_reset", "recovery_codes_regenerated",
    "refresh_reuse_detected", "settings_changed", "data_imported",
]


async def _require_password_and_code(request: Request, user: User, password: str, code: str, event: str) -> None:
    ok_pw = verify_secret(user.password_hash, password)
    ok_code = ok_pw and check_totp_or_recovery(user, code, allow_recovery=False) is not None
    if not (ok_pw and ok_code):
        await audit(request, f"{event}_denied", user.id)
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Password or code is incorrect.")


@router.post("/change-password")
@limiter.limit(SENSITIVE_LIMIT)
async def change_password(
    request: Request, body: ChangePasswordIn, user: User = Depends(current_user), session: RefreshToken = Depends(current_session)
) -> dict:
    await _require_password_and_code(request, user, body.current_password, body.code, "password_change")
    problems = password_problems(body.new_password, user.username)
    if problems:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, {"message": " ".join(problems)})
    user.password_hash = hash_secret(body.new_password)
    await user.save()
    await revoke_all(user.id, except_family=session.family_id)  # type: ignore[arg-type]
    await audit(request, "password_changed", user.id)
    return {"ok": True}


@router.post("/reset-2fa")
@limiter.limit(SENSITIVE_LIMIT)
async def reset_2fa(request: Request, body: PasswordAndCodeIn, user: User = Depends(current_user)) -> dict:
    """Step 1: verify password + current code, return a *pending* new secret as a QR."""
    await _require_password_and_code(request, user, body.password, body.code, "2fa_reset")
    secret = totp.new_secret()
    user.pending_totp_secret_enc = totp.encrypt_secret(secret)
    await user.save()
    uri = totp.provisioning_uri(secret, user.username)
    return {"otpauth_uri": uri, "qr_svg": totp.qr_svg(uri)}


@router.post("/reset-2fa/confirm")
@limiter.limit(SENSITIVE_LIMIT)
async def confirm_reset_2fa(request: Request, body: CodeIn, user: User = Depends(current_user)) -> dict:
    """Step 2: a code from the new authenticator entry activates it."""
    if not user.pending_totp_secret_enc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "No 2FA reset in progress.")
    secret = totp.decrypt_secret(user.pending_totp_secret_enc)
    step = totp.verify_code(secret, body.code, 0)
    if step is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Wrong code.")
    user.totp_secret_enc, user.pending_totp_secret_enc, user.last_totp_step = user.pending_totp_secret_enc, None, step
    await user.save()
    await audit(request, "2fa_reset", user.id)
    return {"ok": True}


@router.post("/recovery-codes")
@limiter.limit(SENSITIVE_LIMIT)
async def regenerate_recovery_codes(request: Request, body: PasswordAndCodeIn, user: User = Depends(current_user)) -> dict:
    await _require_password_and_code(request, user, body.password, body.code, "recovery_codes")
    codes = new_recovery_codes()
    user.recovery_code_hashes = [hash_secret(c) for c in codes]
    await user.save()
    await audit(request, "recovery_codes_regenerated", user.id)
    return {"recovery_codes": codes}


@router.get("/activity")
async def activity(user: User = Depends(current_user), session: RefreshToken = Depends(current_session)) -> dict:
    events = (
        await AuditLog.find({"event": {"$in": AUTH_EVENTS + [f"{e}_denied" for e in ("password_change", "2fa_reset", "recovery_codes")]}})
        .sort("-at")
        .limit(50)
        .to_list()
    )
    sessions = await RefreshToken.find({"user_id": user.id, "revoked": False}).sort("-created_at").to_list()
    return {
        "events": [
            {"event": e.event, "ip": e.ip, "user_agent": e.user_agent, "at": e.at.isoformat(), "details": e.details}
            for e in events
        ],
        "sessions": [
            {
                "ip": s.ip,
                "user_agent": s.user_agent,
                "last_seen_at": s.last_seen_at.isoformat(),
                "current": s.family_id == session.family_id,
            }
            for s in sessions
        ],
    }
