from fastapi import APIRouter, Depends, HTTPException, Body
from sqlalchemy.orm import Session
from sqlalchemy import func, distinct, case
from datetime import datetime

from app.db import get_db
from app import models, schemas
from app.deps import get_current_user
from app.services import venues_service

router = APIRouter(tags=["venues"])


def _row_label(n: int) -> str:
    s = ""
    while n > 0:
        n, r = divmod(n - 1, 26)
        s = chr(65 + r) + s
    return s


@router.get("/venues", response_model=list[schemas.VenueOut])  # CHANGED
# def list_venues(db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
#     rows = (
#         db.query(
#             models.Venue,
#             func.count(models.Seat.id).label("seat_count"),
#             func.count(distinct(models.Seat.zone)).label("zones_count"),
#             func.count(distinct(models.Event.id)).label("events_count"),
#         )
#         .outerjoin(models.Seat, models.Seat.venue_id == models.Venue.id)
#         .outerjoin(models.Event, models.Event.venue_id == models.Venue.id)
#         .group_by(models.Venue.id)
#         .all()
#     )
#     return [
#         {
#             "id": v.id,
#             "name": v.name,
#             "location": v.location,
#             "status": v.status,
#             "category": v.category,
#             "seat_count": int(seat_count or 0),
#             "zones_count": int(zones_count or 0),
#             "events_count": int(events_count or 0),
#         }
#         for v, seat_count, zones_count, events_count in rows
#     ]
def list_venues(db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    return venues_service.list_venues(db)


@router.get("/venues/{venue_id}/seatmap")  # CHANGED
# def venue_seatmap(venue_id: int, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
#     venue = db.query(models.Venue).filter(models.Venue.id == venue_id).first()
#     if not venue:
#         raise HTTPException(status_code=404, detail="Venue not found")

#     seats = db.query(models.Seat).filter(models.Seat.venue_id == venue_id).all()

#     return [
#         {
#             "id": int(s.id),
#             "code": s.code,
#             "zone": getattr(s, "zone", None),
#             "row_label": getattr(s, "row_label", None),
#             "seat_number": getattr(s, "seat_number", None),
#             "is_accessible": int(getattr(s, "is_accessible", 0) or 0),
#             "is_aisle": int(getattr(s, "is_aisle", 0) or 0),
#             "is_blocked": int(getattr(s, "is_blocked", 0) or 0),
#             "x": getattr(s, "x", None),
#             "y": getattr(s, "y", None),
#             "assignment": None,
#         }
#         for s in seats
#     ]
def venue_seatmap(venue_id: int, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    return venues_service.venue_seatmap(db, venue_id)


@router.post("/venues", response_model=schemas.VenueOut, status_code=201)  # CHANGED
# def create_venue(payload: schemas.VenueCreate, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
#     q = db.query(models.Venue).filter(models.Venue.name == payload.name)
#     if payload.location:
#         q = q.filter(models.Venue.location == payload.location)
#     if q.first():
#         raise HTTPException(status_code=409, detail="Venue already exists")

#     v = models.Venue(
#         name=payload.name,
#         location=payload.location,
#         status=payload.status,
#         category=payload.category,
#     )
#     db.add(v)
#     db.commit()
#     db.refresh(v)
#     return v
def create_venue(payload: schemas.VenueCreate, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    return venues_service.create_venue(db, payload)


@router.post("/venues/{venue_id}/seats/generate") 
# def generate_venue_seats(
#     venue_id: int,
#     payload: schemas.GenerateSeatsPayload = Body(...),
#     db: Session = Depends(get_db), user: models.User = Depends(get_current_user)
# ):
#     venue = db.query(models.Venue).filter(models.Venue.id == venue_id).first()
#     if not venue:
#         raise HTTPException(status_code=404, detail="Venue not found")

#     STEP_X = 10
#     STEP_Y = 10
#     ZONE_GAP = 20

#     now = datetime.utcnow()
#     seats_to_create = []

#     zone_offset_x = 0
#     zone_offset_y = 0  # NEW

#     for z in payload.zones:
#         pad = max(2, len(str(z.seats_per_row)))
#         zone_width = (z.seats_per_row + 1) * STEP_X
#         zone_height = (z.rows + 1) * STEP_Y  # NEW

#         aisles = {n for n in z.aisle_seat_numbers if 1 <= n <= z.seats_per_row}

#         acc_rows = {r for r in z.accessible_rows if 1 <= r <= z.rows}
#         acc_n = max(1, min(int(z.accessible_per_row or 1), z.seats_per_row))

#         for row_idx in range(1, z.rows + 1):
#             row = _row_label(row_idx)

#             for seat_idx in range(1, z.seats_per_row + 1):
#                 seat_number = str(seat_idx).zfill(pad)
#                 code = f"{z.zone}-{row}-{seat_number}"

#                 # NEW: vertical layout stacks zones by Y
#                 if payload.layout == "vertical":
#                     x = seat_idx * STEP_X
#                     y = zone_offset_y + row_idx * STEP_Y
#                 else:
#                     x = zone_offset_x + seat_idx * STEP_X
#                     y = row_idx * STEP_Y

#                 row_is_accessible = row_idx in acc_rows
#                 at_start = seat_idx <= acc_n
#                 at_end = seat_idx > (z.seats_per_row - acc_n)
#                 seat_accessible = 1 if (row_is_accessible and (
#                     (z.accessible_side == "start" and at_start) or
#                     (z.accessible_side == "end" and at_end) or
#                     (z.accessible_side == "both" and (at_start or at_end))
#                 )) else 0

#                 seats_to_create.append(
#                     models.Seat(
#                         venue_id=venue_id,
#                         code=code,
#                         zone=z.zone,
#                         row_label=row,
#                         seat_number=seat_number,
#                         is_accessible=seat_accessible,
#                         is_blocked=0,
#                         is_aisle=1 if seat_idx in aisles else 0,
#                         x=x,
#                         y=y,
#                         created_at=now,
#                     )
#                 )


#         if payload.layout == "vertical":
#             zone_offset_y += zone_height + ZONE_GAP
#         else:
#             zone_offset_x += zone_width + ZONE_GAP

#     db.add_all(seats_to_create)
#     db.commit()
#     return {"ok": True, "venue_id": venue_id, "created": len(seats_to_create)}
def generate_venue_seats(
    venue_id: int,
    payload: schemas.GenerateSeatsPayload = Body(...),
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
):
    return venues_service.generate_venue_seats(db, venue_id, payload)


@router.get("/venues/{venue_id}/sections", response_model=list[schemas.SectionSummary])
# def venue_sections(venue_id: int, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
#     rows = (
#         db.query(
#             models.Seat.zone.label("zone"),
#             func.count(models.Seat.id).label("seat_count"),
#             func.sum(case((models.Seat.is_accessible == 1, 1), else_=0)).label("accessible_count"),
#             func.sum(case((models.Seat.is_blocked == 1, 1), else_=0)).label("blocked_count"),
#             func.count(distinct(models.Seat.row_label)).label("rows_count"),
#         )
#         .filter(models.Seat.venue_id == venue_id)
#         .group_by(models.Seat.zone)
#         .all()
#     )
#     return [
#         {
#             "zone": zone or "Uncategorized",
#             "seat_count": int(seat_count or 0),
#             "accessible_count": int(accessible_count or 0),
#             "blocked_count": int(blocked_count or 0),
#             "rows_count": int(rows_count or 0),
#         }
#         for zone, seat_count, accessible_count, blocked_count, rows_count in rows
#     ]
def venue_sections(venue_id: int, db: Session = Depends(get_db), user: models.User = Depends(get_current_user)):
    return venues_service.venue_sections(db, venue_id)