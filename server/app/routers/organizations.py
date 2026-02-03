from typing import List

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db import get_db
from app import models, schemas
from app.services import organizations_service

router = APIRouter(tags=["organizations"])

@router.get("/organizations", response_model=List[schemas.OrganizationOut])
def list_organizations(db: Session = Depends(get_db)):
    return organizations_service.list_organizations(db)