from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db import get_db
from app import schemas
from app.services import portal_service

router = APIRouter(tags=["portal"])

@router.get("/portal/{token}", response_model=schemas.PortalData)
def portal_get(token: str, db: Session = Depends(get_db)):
    return portal_service.portal_get(db, token)

@router.post("/portal/{token}")
def portal_submit(token: str, payload: schemas.PortalSubmit, db: Session = Depends(get_db)):
    return portal_service.portal_submit(db, token, payload)