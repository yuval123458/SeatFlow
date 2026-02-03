from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy.orm import Session

from app.db import get_db
from app import schemas
from app.services import auth_service

router = APIRouter(prefix="/auth", tags=["auth"])

COOKIE_NAME = "refresh_token"


def _set_refresh_cookie(response: Response, token: str) -> None:
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


@router.post("/login", response_model=schemas.TokenOut)
def login(payload: schemas.AuthLoginIn, response: Response, db: Session = Depends(get_db)):
    access_token, refresh_token = auth_service.login(db, payload)
    _set_refresh_cookie(response, refresh_token)
    return schemas.TokenOut(access_token=access_token)


@router.post("/refresh", response_model=schemas.TokenOut)
def refresh(request: Request, response: Response, db: Session = Depends(get_db)):
    rt: Optional[str] = request.cookies.get(COOKIE_NAME)
    access_token, new_refresh_token = auth_service.refresh(db, rt)
    _set_refresh_cookie(response, new_refresh_token)
    return schemas.TokenOut(access_token=access_token)


@router.post("/logout")
def logout(request: Request, response: Response, db: Session = Depends(get_db)):
    rt: Optional[str] = request.cookies.get(COOKIE_NAME)
    auth_service.logout(db, rt)
    _clear_refresh_cookie(response)
    return {"ok": True}


@router.get("/me", response_model=schemas.AuthMeOut)
def me(request: Request, db: Session = Depends(get_db)):
    auth = request.headers.get("authorization") or request.headers.get("Authorization")
    if not auth:
        raise HTTPException(status_code=401, detail="Missing bearer token")
    return auth_service.me(db, auth)