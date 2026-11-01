"""TOTP (RFC 6238) with encrypted-at-rest secrets and replay protection."""

import hmac
import io
import time
from functools import lru_cache

import pyotp
import qrcode
import qrcode.image.svg
from cryptography.fernet import Fernet, InvalidToken

from app.config import get_settings

STEP_SECONDS = 30


@lru_cache
def _fernet() -> Fernet:
    return Fernet(get_settings().totp_enc_key.encode())


def new_secret() -> str:
    return pyotp.random_base32()


def encrypt_secret(secret: str) -> str:
    return _fernet().encrypt(secret.encode()).decode()


def decrypt_secret(token: str) -> str:
    try:
        return _fernet().decrypt(token.encode()).decode()
    except InvalidToken as exc:  # wrong TOTP_ENC_KEY
        raise RuntimeError("Unable to decrypt TOTP secret; check TOTP_ENC_KEY") from exc


def provisioning_uri(secret: str, username: str) -> str:
    return pyotp.TOTP(secret).provisioning_uri(name=username, issuer_name=get_settings().totp_issuer)


def verify_code(secret: str, code: str, last_step: int, now: float | None = None) -> int | None:
    """Return the matched time step, or None.

    Accepts the current step and one step either side (clock drift). A step that is not
    newer than `last_step` is refused, so a code can never be replayed within its window.
    """
    code = (code or "").strip()
    if len(code) != 6 or not code.isdigit():
        return None
    now = time.time() if now is None else now
    current = int(now // STEP_SECONDS)
    totp = pyotp.TOTP(secret)
    for step in (current, current - 1, current + 1):
        if step <= last_step:
            continue
        if hmac.compare_digest(totp.at(step * STEP_SECONDS), code):
            return step
    return None


def qr_svg(uri: str) -> str:
    img = qrcode.make(uri, image_factory=qrcode.image.svg.SvgPathImage, box_size=10, border=2)
    buf = io.BytesIO()
    img.save(buf)
    return buf.getvalue().decode()


def qr_terminal(uri: str) -> str:
    qr = qrcode.QRCode(border=1)
    qr.add_data(uri)
    qr.make(fit=True)
    buf = io.StringIO()
    qr.print_ascii(out=buf, invert=True)
    return buf.getvalue()
