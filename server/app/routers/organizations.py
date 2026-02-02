from typing import List

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db import get_db
from app import models, schemas

router = APIRouter(tags=["organizations"])

@router.get("/organizations", response_model=List[schemas.OrganizationOut])
def list_organizations(db: Session = Depends(get_db)):
    return db.query(models.Organization).order_by(models.Organization.name.asc()).all()