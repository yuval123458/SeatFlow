import os
from fastapi import Depends, HTTPException, Request
from jose import JWTError, jwt
from sqlalchemy.orm import Session

from app.db import get_db
from app import models

JWT_SECRET = os.getenv("JWT_SECRET", "dev-insecure-change-me")
JWT_ALG = os.getenv("JWT_ALG", "HS256")


def get_current_user(request: Request, db: Session = Depends(get_db)) -> models.User:
    auth = request.headers.get("authorization") or request.headers.get("Authorization")
    if not auth or not auth.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token")

    token = auth.split(" ", 1)[1].strip()
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid token")

    user_id = payload.get("sub")
    org_id = payload.get("org_id")
    if user_id is None or org_id is None:
        raise HTTPException(status_code=401, detail="Invalid token payload")

    user = (
        db.query(models.User)
        .filter(models.User.id == int(user_id), models.User.org_id == int(org_id))
        .first()
    )
    if not user:
        raise HTTPException(status_code=401, detail="User not found")

    return user