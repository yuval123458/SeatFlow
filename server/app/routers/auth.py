from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from jose import jwt, JWTError
import os
from sqlalchemy.orm import Session

from app.db import get_db
from app import models, schemas
from app.security import (
    hash_password,
    verify_password,
    create_access_token,
    new_refresh_token,
    hash_refresh_token,
    refresh_expiry,
)

router = APIRouter(prefix="/auth", tags=["auth"])

COOKIE_NAME = "refresh_token"
JWT_SECRET = os.getenv("JWT_SECRET", "dev-insecure-change-me")
JWT_ALG = os.getenv("JWT_ALG", "HS256")

def _set_refresh_cookie(response: Response, token: str) -> None:
    # secure=False for localhost; set secure=True behind HTTPS in prod
    response.set_cookie(
        key=COOKIE_NAME,
        value=token,
        httponly=True,
        secure=False,
        samesite="lax",
        path="/auth/refresh",
        max_age=60 * 60 * 24 * 14,
    )


def _clear_refresh_cookie(response: Response) -> None:
    response.delete_cookie(key=COOKIE_NAME, path="/auth/refresh")


@router.post("/signup", response_model=schemas.TokenOut)
def signup(payload: schemas.AuthSignupIn, response: Response, db: Session = Depends(get_db)):
    email = payload.email.strip().lower()

    existing = (
        db.query(models.User)
        .filter(models.User.org_id == payload.org_id, models.User.email == email)
        .first()
    )
    if existing:
        raise HTTPException(status_code=409, detail="User already exists")

    user = models.User(
        org_id=payload.org_id,
        email=email,
        password_hash=hash_password(payload.password),
    )

    rt = new_refresh_token()
    user.refresh_token_hash = hash_refresh_token(rt)
    user.refresh_token_expires_at = refresh_expiry()

    db.add(user)
    db.commit()
    db.refresh(user)

    _set_refresh_cookie(response, rt)
    return schemas.TokenOut(access_token=create_access_token(user_id=user.id, org_id=user.org_id))


@router.post("/login", response_model=schemas.TokenOut)
def login(payload: schemas.AuthLoginIn, response: Response, db: Session = Depends(get_db)):
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

    _set_refresh_cookie(response, rt)
    return schemas.TokenOut(access_token=create_access_token(user_id=user.id, org_id=user.org_id))


@router.post("/refresh", response_model=schemas.TokenOut)
def refresh(request: Request, response: Response, db: Session = Depends(get_db)):
    rt: Optional[str] = request.cookies.get(COOKIE_NAME)
    if not rt:
        raise HTTPException(status_code=401, detail="Missing refresh token")

    rt_hash = hash_refresh_token(rt)

    user = db.query(models.User).filter(models.User.refresh_token_hash == rt_hash).first()
    if not user:
        raise HTTPException(status_code=401, detail="Invalid refresh token")

    if user.refresh_token_expires_at is None:
        raise HTTPException(status_code=401, detail="Refresh token expired")

    exp = user.refresh_token_expires_at
    exp_utc = exp.replace(tzinfo=timezone.utc) if exp.tzinfo is None else exp
    if exp_utc < datetime.now(timezone.utc):
        raise HTTPException(status_code=401, detail="Refresh token expired")

    # rotate refresh token
    new_rt = new_refresh_token()
    user.refresh_token_hash = hash_refresh_token(new_rt)
    user.refresh_token_expires_at = refresh_expiry()
    db.commit()

    _set_refresh_cookie(response, new_rt)
    return schemas.TokenOut(access_token=create_access_token(user_id=user.id, org_id=user.org_id))


@router.post("/logout")
def logout(request: Request, response: Response, db: Session = Depends(get_db)):
    rt: Optional[str] = request.cookies.get(COOKIE_NAME)
    if rt:
        rt_hash = hash_refresh_token(rt)
        user = db.query(models.User).filter(models.User.refresh_token_hash == rt_hash).first()
        if user:
            user.refresh_token_hash = None
            user.refresh_token_expires_at = None
            db.commit()

    _clear_refresh_cookie(response)
    return {"ok": True}

@router.get("/me", response_model=schemas.AuthMeOut)
def me(request: Request, db: Session = Depends(get_db)):
    auth = request.headers.get("authorization") or request.headers.get("Authorization")
    if not auth or not auth.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token")

    token = auth.split(" ", 1)[1].strip()
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid token")

    user_id = int(payload.get("sub"))
    org_id = int(payload.get("org_id"))

    user = db.query(models.User).filter(models.User.id == user_id, models.User.org_id == org_id).first()
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