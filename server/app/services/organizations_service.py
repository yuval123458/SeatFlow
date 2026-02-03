from sqlalchemy.orm import Session
from app import models

def list_organizations(db: Session):
    return db.query(models.Organization).order_by(models.Organization.name.asc()).all()