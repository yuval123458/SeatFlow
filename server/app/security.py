from datetime import datetime, timedelta, timezone
import hashlib
import os
import secrets
from typing import Any, Dict

from jose import jwt
from passlib.context import CryptContext

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

JWT_SECRET = os.getenv("JWT_SECRET", "dev-insecure-change-me")
JWT_ALG = os.getenv("JWT_ALG", "HS256")
ACCESS_TOKEN_MINUTES = int(os.getenv("ACCESS_TOKEN_MINUTES", "1000"))

REFRESH_DAYS = int(os.getenv("REFRESH_DAYS", "14"))
REFRESH_PEPPER = os.getenv("REFRESH_PEPPER", "dev-insecure-change-me-too")

def hash_password(password: str) -> str:
    return pwd_context.hash(password)

def verify_password(password: str, password_hash: str) -> bool:
    return pwd_context.verify(password, password_hash)

def create_access_token(*, user_id: int, org_id: int) -> str:
    now = datetime.now(timezone.utc)
    payload: Dict[str, Any] = {
        "sub": str(user_id),
        "org_id": int(org_id),
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(minutes=ACCESS_TOKEN_MINUTES)).timestamp()),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALG)

def new_refresh_token() -> str:
    return secrets.token_urlsafe(48)

def hash_refresh_token(refresh_token: str) -> str:
    data = (REFRESH_PEPPER + refresh_token).encode("utf-8")
    return hashlib.sha256(data).hexdigest()

def refresh_expiry() -> datetime:
    return datetime.now(timezone.utc) + timedelta(days=REFRESH_DAYS)