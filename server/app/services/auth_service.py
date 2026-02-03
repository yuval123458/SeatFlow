from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional, Tuple
import os

from fastapi import HTTPException
from jose import jwt, JWTError
from sqlalchemy.orm import Session

from app import models, schemas
from app.security import (
    verify_password,
    create_access_token,
    new_refresh_token,
    hash_refresh_token,
    refresh_expiry,
)

JWT_SECRET = os.getenv("JWT_SECRET", "dev-insecure-change-me")
JWT_ALG = os.getenv("JWT_ALG", "HS256")


def login(db: Session, payload: schemas.AuthLoginIn) -> Tuple[str, str]:
    email = payload.email.strip().lower()

    user = (
        db.query(models.User)
        .filter(models.User.org_id == payload.org_id, models.User.email == email)
        .first()
    )
    if not user or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    rt = new_refresh_token()
    user.refresh_token_hash = hash_refresh_token(rt)
    user.refresh_token_expires_at = refresh_expiry()
    db.commit()

    access_token = create_access_token(user_id=user.id, org_id=user.org_id)
    return access_token, rt


def refresh(db: Session, refresh_token: Optional[str]) -> Tuple[str, str]:
    if not refresh_token:
        raise HTTPException(status_code=401, detail="Missing refresh token")

    rt_hash = hash_refresh_token(refresh_token)

    user = db.query(models.User).filter(models.User.refresh_token_hash == rt_hash).first()
    if not user:
        raise HTTPException(status_code=401, detail="Invalid refresh token")

    exp = user.refresh_token_expires_at
    if exp is None:
        raise HTTPException(status_code=401, detail="Refresh token expired")

    exp_utc = exp.replace(tzinfo=timezone.utc) if exp.tzinfo is None else exp
    if exp_utc < datetime.now(timezone.utc):
        raise HTTPException(status_code=401, detail="Refresh token expired")

    new_rt = new_refresh_token()
    user.refresh_token_hash = hash_refresh_token(new_rt)
    user.refresh_token_expires_at = refresh_expiry()
    db.commit()

    access_token = create_access_token(user_id=user.id, org_id=user.org_id)
    return access_token, new_rt


def logout(db: Session, refresh_token: Optional[str]) -> None:
    if not refresh_token:
        return

    rt_hash = hash_refresh_token(refresh_token)
    user = db.query(models.User).filter(models.User.refresh_token_hash == rt_hash).first()
    if not user:
        return

    user.refresh_token_hash = None
    user.refresh_token_expires_at = None
    db.commit()


def me(db: Session, bearer_token: Optional[str]) -> schemas.AuthMeOut:
    if not bearer_token:
        raise HTTPException(status_code=401, detail="Missing bearer token")

    token = bearer_token.strip()
    if token.lower().startswith("bearer "):
        token = token.split(" ", 1)[1].strip()

    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid token")

    sub = payload.get("sub")
    org_id = payload.get("org_id")
    if sub is None or org_id is None:
        raise HTTPException(status_code=401, detail="Invalid token")

    user_id = int(sub)
    org_id = int(org_id)

    user = (
        db.query(models.User)
        .filter(models.User.id == user_id, models.User.org_id == org_id)
        .first()
    )
    if not user:
        raise HTTPException(status_code=401, detail="User not found")

    org = db.query(models.Organization).filter(models.Organization.id == org_id).first()
    if not org:
        raise HTTPException(status_code=401, detail="Organization not found")

    return schemas.AuthMeOut(
        user_id=int(user.id),
        email=user.email,
        org_id=int(org.id),
        org_name=org.name,
    )