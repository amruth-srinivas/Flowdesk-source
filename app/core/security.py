from datetime import datetime, timedelta, timezone
import hashlib
from typing import Any

import bcrypt
from jose import JWTError, jwt

from app.core.config import settings


def _normalize_password(password: str) -> bytes:
    # Pre-hash avoids bcrypt's 72-byte input limit while still using bcrypt as the KDF.
    return hashlib.sha256(password.encode("utf-8")).hexdigest().encode("utf-8")


def hash_password(password: str) -> str:
    return bcrypt.hashpw(_normalize_password(password), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(_normalize_password(password), password_hash.encode("utf-8"))
    except ValueError:
        return False


def create_token(subject: str, token_type: str, expires_delta: timedelta, extra: dict[str, Any] | None = None) -> str:
    now = datetime.now(timezone.utc)
    payload: dict[str, Any] = {
        "sub": subject,
        "type": token_type,
        "iat": now,
        "exp": now + expires_delta,
    }
    if extra:
        payload.update(extra)
    return jwt.encode(payload, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)


def create_access_token(subject: str, role: str) -> str:
    return create_token(
        subject=subject,
        token_type="access",
        expires_delta=timedelta(minutes=settings.access_token_expire_minutes),
        extra={"role": role},
    )


def create_refresh_token(subject: str, role: str) -> str:
    return create_token(
        subject=subject,
        token_type="refresh",
        expires_delta=timedelta(days=settings.refresh_token_expire_days),
        extra={"role": role},
    )


def decode_token(token: str) -> dict[str, Any]:
    try:
        return jwt.decode(token, settings.jwt_secret_key, algorithms=[settings.jwt_algorithm])
    except JWTError as exc:
        raise ValueError("Invalid token") from exc
