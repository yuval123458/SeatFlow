from fastapi import APIRouter, Depends, Body, Query
from sqlalchemy.orm import Session
from typing import Optional, Dict, Any

from app.db import get_db
from app import models, schemas
from app.deps import get_current_user
from app.services import events_service

router = APIRouter(tags=["events"])


@router.get("/events", response_model=list[schemas.EventOut])
def list_events(db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    return events_service.list_events(db)


@router.post("/events", response_model=schemas.EventOut, status_code=201)
def create_event(payload: schemas.EventCreate, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    return events_service.create_event(db, payload)


@router.get("/events/{event_id}", response_model=schemas.EventOut)
def get_event(event_id: int, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    return events_service.get_event(db, event_id)


@router.post("/events/{event_id}/assignments/run")
def run_assignments(
    event_id: int,
    payload: Optional[Dict[str, Any]] = Body(None),
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
):
    return events_service.run_assignments(db, event_id, payload)


@router.get("/events/{event_id}/participants", response_model=list[schemas.ParticipantLink])
def event_participants(event_id: int, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    return events_service.event_participants(db, event_id)


@router.get("/events/{event_id}/seatmap")
def event_seatmap(event_id: int, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    return events_service.event_seatmap(db, event_id)


@router.get("/events/{event_id}/issues")
def event_issues(event_id: int, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    return events_service.event_issues(db, event_id)


@router.post("/events/{event_id}/assignments/move")
def move_assignment(
    event_id: int,
    preference_id: int = Query(...),
    seat_id: int = Query(...),
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
):
    return events_service.move_assignment(db, event_id, preference_id, seat_id)


@router.post("/events/{event_id}/assignments/clear")
def clear_assignment(
    event_id: int,
    preference_id: int = Query(...),
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
):
    return events_service.clear_assignment(db, event_id, preference_id)


@router.patch("/events/{event_id}/status", response_model=schemas.EventOut)
def update_event_status(
    event_id: int,
    payload: schemas.EventStatusUpdate,
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
):
    return events_service.update_event_status(db, event_id, payload)