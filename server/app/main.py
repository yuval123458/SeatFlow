from fastapi import FastAPI, Depends, HTTPException, UploadFile, File, Body, Query
from fastapi.middleware.cors import CORSMiddleware  # add
from sqlalchemy.orm import Session  # joinedload not needed here
from sqlalchemy import func, distinct, case  # <- add case (your venue_sections uses it)
from io import StringIO
from uuid import uuid4
from typing import Optional, List, Dict, Any
from datetime import datetime, timezone
from .db import Base, engine, get_db
from . import models, schemas
import csv

Base.metadata.create_all(bind=engine)

app = FastAPI(title="SeatFlow API")

app.add_middleware(
  CORSMiddleware,
  allow_origins=["http://localhost:5173", "http://localhost:3000"],
  allow_credentials=True,
  allow_methods=["*"],
  allow_headers=["*"],
)

# Venues
@app.get("/venues", response_model=list[schemas.VenueOut])
def list_venues(db: Session = Depends(get_db)):
    rows = (
        db.query(
            models.Venue,
            func.count(models.Seat.id).label("seat_count"),
            func.count(distinct(models.Seat.zone)).label("zones_count"),
            func.count(distinct(models.Event.id)).label("events_count"),
        )
        .outerjoin(models.Seat, models.Seat.venue_id == models.Venue.id)
        .outerjoin(models.Event, models.Event.venue_id == models.Venue.id)
        .group_by(models.Venue.id)
        .all()
    )
    return [{
        "id": v.id,
        "name": v.name,
        "location": v.location,
        "status": v.status,
        "category": v.category,
        "seat_count": int(seat_count or 0),
        "zones_count": int(zones_count or 0),
        "events_count": int(events_count or 0),
    } for v, seat_count, zones_count, events_count in rows]

# Events
@app.get("/events", response_model=list[schemas.EventOut])
def list_events(db: Session = Depends(get_db)):
    rows = (
        db.query(
            models.Event,
            models.Venue.name.label("venue_name"),
            func.count(models.MemberPreference.id).label("total_prefs"),
            func.count(models.MemberPreference.assigned_seat_id).label("assigned_count"),
        )
        .join(models.Venue, models.Event.venue_id == models.Venue.id, isouter=True)
        .outerjoin(models.MemberPreference, models.MemberPreference.event_id == models.Event.id)
        .group_by(models.Event.id, models.Venue.name)
        .all()
    )
    return [{
        "id": ev.id,
        "venue_id": ev.venue_id,
        "name": ev.name,
        "event_date": ev.event_date,
        "status": ev.status,
        "submissions_locked": ev.submissions_locked,
        "venue_name": venue_name,
        "attendees_count": int(total_prefs or 0),
        "assigned_count": int(assigned_count or 0),
        "total_prefs": int(total_prefs or 0),
    } for ev, venue_name, total_prefs, assigned_count in rows]

@app.get("/events/{event_id}", response_model=schemas.EventOut)
def get_event(event_id: int, db: Session = Depends(get_db)):
    ev = db.query(models.Event).filter(models.Event.id == event_id).first()
    if not ev:
        raise HTTPException(status_code=404, detail="Event not found")
    venue_name = db.query(models.Venue.name).filter(models.Venue.id == ev.venue_id).scalar()
    total_prefs = (
        db.query(func.count(models.MemberPreference.id))
        .filter(models.MemberPreference.event_id == event_id)
        .scalar()
    ) or 0
    assigned_count = (
        db.query(func.count(models.MemberPreference.assigned_seat_id))
        .filter(models.MemberPreference.event_id == event_id)
        .scalar()
    ) or 0
    return {
        "id": ev.id,
        "venue_id": ev.venue_id,
        "name": ev.name,
        "event_date": ev.event_date,
        "status": ev.status,
        "submissions_locked": ev.submissions_locked,
        "venue_name": venue_name,
        "attendees_count": int(total_prefs),
        "assigned_count": int(assigned_count),
        "total_prefs": int(total_prefs),
    }

# Auto-assignment (weighted scoring + hard constraints)
@app.post("/events/{event_id}/assignments/run")
def run_assignments(
    event_id: int,
    payload: Optional[Dict[str, Any]] = Body(None),
    db: Session = Depends(get_db),
):
    ev = db.query(models.Event).filter(models.Event.id == event_id).first()
    if not ev:
        raise HTTPException(status_code=404, detail="Event not found")

    payload = payload or {}

    def _weight(*keys: str, default: float) -> float:
        for k in keys:
            v = payload.get(k)
            if v is None:
                continue
            try:
                vv = float(v)
                if vv < 0:
                    vv = 0.0
                if vv > 100:
                    vv = 100.0
                return vv / 100.0
            except Exception:
                pass
        return default / 100.0

    # NEW sliders (accept snake_case from client; camelCase also supported)
    w_pref = _weight("preference_weight", "preferenceWeight", default=60)
    w_group = _weight("group_weight", "groupWeight", default=70)
    w_stable = _weight("stability_weight", "stabilityWeight", default=80)

    seats = db.query(models.Seat).filter(
        models.Seat.venue_id == ev.venue_id,
        models.Seat.is_blocked != 1,
    ).all()
    seat_by_id = {s.id: s for s in seats}
    seat_by_code = {s.code: s for s in seats if getattr(s, "code", None)}

    prefs = db.query(models.MemberPreference).filter(
        models.MemberPreference.event_id == event_id
    ).order_by(models.MemberPreference.id.asc()).all()

    def needs_accessible(p) -> int:
        return int(bool(getattr(p, "needs_accessible", 0)))

    def hard_ok(p, s) -> bool:
        if int(getattr(s, "is_blocked", 0) or 0) == 1:
            return False
        if needs_accessible(p) == 1 and int(getattr(s, "is_accessible", 0) or 0) != 1:
            return False
        return True

    # Snapshot previous seats for stability scoring
    prev_seat_by_pref: Dict[int, Optional[int]] = {
        int(p.id): (int(p.assigned_seat_id) if p.assigned_seat_id else None) for p in prefs
    }

    # Rebuild from scratch so weights matter
    for p in prefs:
        p.assigned_seat_id = None

    free_ids = {s.id for s in seats}

    # Group centroid tracking (built as we assign)
    group_points: Dict[str, list[tuple[float, float]]] = {}

    # Coordinate scale for proximity normalization
    xs = [float(s.x) for s in seats if getattr(s, "x", None) is not None]
    ys = [float(s.y) for s in seats if getattr(s, "y", None) is not None]
    if xs and ys:
        min_x, max_x = min(xs), max(xs)
        min_y, max_y = min(ys), max(ys)
        max_dist = ((max_x - min_x) ** 2 + (max_y - min_y) ** 2) ** 0.5
        if max_dist <= 0:
            max_dist = 1.0
    else:
        max_dist = 1.0

    def _add_group_point(p, seat_id: int) -> None:
        gc = getattr(p, "group_code", None)
        if not gc:
            return
        s = seat_by_id.get(seat_id)
        if not s:
            return
        if getattr(s, "x", None) is None or getattr(s, "y", None) is None:
            return
        group_points.setdefault(str(gc), []).append((float(s.x), float(s.y)))

    def preference_score(p, s) -> float:
        # 0..1
        score = 0.0
        if getattr(p, "preferred_seat_code", None) and s.code == p.preferred_seat_code:
            score += 1.0
        if getattr(p, "preferred_zone", None) and getattr(s, "zone", None) == p.preferred_zone:
            score += 0.5
        if int(getattr(p, "wants_aisle", 0) or 0) == 1 and int(getattr(s, "is_aisle", 0) or 0) == 1:
            score += 0.2
        return 1.0 if score >= 1.0 else score

    def group_score(p, s) -> float:
        # 0..1 (1 = very close)
        gc = getattr(p, "group_code", None)
        if not gc:
            return 0.0
        pts = group_points.get(str(gc))
        if not pts:
            return 0.0
        if getattr(s, "x", None) is None or getattr(s, "y", None) is None:
            return 0.0
        cx = sum(px for px, _ in pts) / len(pts)
        cy = sum(py for _, py in pts) / len(pts)
        dx = float(s.x) - cx
        dy = float(s.y) - cy
        dist = (dx * dx + dy * dy) ** 0.5
        norm = dist / max_dist
        if norm < 0:
            norm = 0.0
        if norm > 1:
            norm = 1.0
        return 1.0 - norm

    def stability_score(p, s) -> float:
        # 0..1 (bonus for keeping previous seat)
        return 1.0 if prev_seat_by_pref.get(int(p.id)) == int(s.id) else 0.0

    def total_score(p, s) -> float:
        return (
            w_pref * preference_score(p, s)
            + w_group * group_score(p, s)
            + w_stable * stability_score(p, s)
        )

    def assign_best(p) -> None:
        if p.assigned_seat_id:
            return

        best_sid: Optional[int] = None
        best_sc: Optional[float] = None

        # Iterate deterministically
        for sid in sorted(free_ids):
            s = seat_by_id[sid]
            if not hard_ok(p, s):
                continue
            sc = total_score(p, s)
            if best_sc is None or sc > best_sc or (sc == best_sc and sid < (best_sid or sid)):
                best_sc = sc
                best_sid = sid

        if best_sid is not None:
            p.assigned_seat_id = best_sid
            free_ids.remove(best_sid)
            _add_group_point(p, best_sid)

    # Assign accessible-needs first, then others
    for p in prefs:
        if needs_accessible(p) == 1:
            assign_best(p)
    for p in prefs:
        if not p.assigned_seat_id:
            assign_best(p)

    db.commit()
    total = len(prefs)
    assigned = sum(1 for p in prefs if p.assigned_seat_id)
    return {
        "event_id": event_id,
        "assigned": assigned,
        "total": total,
        "unassigned": total - assigned,
        "weights": {
            "preference_weight": int(round(w_pref * 100)),
            "group_weight": int(round(w_group * 100)),
            "stability_weight": int(round(w_stable * 100)),
        },
    }

# Venue sections

def _row_label(n: int) -> str:
    s = ""
    while n > 0:
        n, r = divmod(n - 1, 26)
        s = chr(65 + r) + s
    return s


@app.post("/venues", response_model=schemas.VenueOut, status_code=201)
def create_venue(payload: schemas.VenueCreate, db: Session = Depends(get_db)):
    # Basic duplicate protection (adjust criteria if you want)
    q = db.query(models.Venue).filter(models.Venue.name == payload.name)
    if payload.location:
        q = q.filter(models.Venue.location == payload.location)
    if q.first():
        raise HTTPException(status_code=409, detail="Venue already exists")

    v = models.Venue(
        name=payload.name,
        location=payload.location,
        status=payload.status,
        category=payload.category,
    )
    db.add(v)
    db.commit()
    db.refresh(v)
    return v


@app.post("/venues/{venue_id}/seats/generate")
def generate_venue_seats(
    venue_id: int,
    payload: schemas.GenerateSeatsPayload = Body(...),
    db: Session = Depends(get_db),
):
    venue = db.query(models.Venue).filter(models.Venue.id == venue_id).first()
    if not venue:
        raise HTTPException(status_code=404, detail="Venue not found")

    existing = db.query(models.Seat).filter(models.Seat.venue_id == venue_id).count()
    if existing > 0:
        raise HTTPException(
            status_code=409,
            detail="Venue already has seats; clear them before generating again",
        )

    # Match your existing pattern:
    # code: ZONE-ROW-SEAT (seat is zero-padded), x increments by 10, y increments by 10
    STEP_X = 10
    STEP_Y = 10
    ZONE_GAP = 60

    seats_to_create = []
    zone_offset_x = 0

    for z in payload.zones:
        pad = max(2, len(str(z.seats_per_row)))  # 2 digits unless >= 100, etc.
        zone_width = (z.seats_per_row + 1) * STEP_X

        for row_idx in range(1, z.rows + 1):
            row = _row_label(row_idx)     # A, B, C...
            y = row_idx * STEP_Y          # A->10, B->20...

            for seat_idx in range(1, z.seats_per_row + 1):
                seat_number = str(seat_idx).zfill(pad)  # 02, 03...
                code = f"{z.zone}-{row}-{seat_number}"  # VIP-A-02
                x = zone_offset_x + seat_idx * STEP_X   # 02->20 (+ offset)

                seats_to_create.append(
                    models.Seat(
                        venue_id=venue_id,
                        code=code,
                        zone=z.zone,
                        row_label=row,
                        seat_number=seat_number,
                        is_accessible=0,
                        is_blocked=0,
                        is_aisle=0,
                        x=x,
                        y=y,
                    )
                )

        zone_offset_x += zone_width + ZONE_GAP

    db.add_all(seats_to_create)
    db.commit()
    return {"ok": True, "venue_id": venue_id, "created": len(seats_to_create)}

@app.get("/venues/{venue_id}/sections", response_model=list[schemas.SectionSummary])
def venue_sections(venue_id: int, db: Session = Depends(get_db)):
    rows = (
        db.query(
            models.Seat.zone.label("zone"),
            func.count(models.Seat.id).label("seat_count"),
            func.sum(case((models.Seat.is_accessible == 1, 1), else_=0)).label("accessible_count"),
            func.sum(case((models.Seat.is_blocked == 1, 1), else_=0)).label("blocked_count"),
            func.count(distinct(models.Seat.row_label)).label("rows_count"),
        )
        .filter(models.Seat.venue_id == venue_id)
        .group_by(models.Seat.zone)
        .all()
    )
    return [
        {
            "zone": zone or "Uncategorized",
            "seat_count": int(seat_count or 0),
            "accessible_count": int(accessible_count or 0),
            "blocked_count": int(blocked_count or 0),
            "rows_count": int(rows_count or 0),
        }
        for zone, seat_count, accessible_count, blocked_count, rows_count in rows
    ]

# keep the single global _truthy
def _truthy(val: Optional[str]) -> int:
    if val is None:
        return 0
    s = str(val).strip().lower()
    return 1 if s in {"1", "true", "yes", "y", "t"} else 0

@app.get("/events/{event_id}/participants", response_model=list[schemas.ParticipantLink])
def event_participants(event_id: int, db: Session = Depends(get_db)):
    rows = (
        db.query(models.MemberPreference, models.Member)
        .join(models.Member, models.Member.id == models.MemberPreference.member_id, isouter=True)
        .filter(models.MemberPreference.event_id == event_id)
        .all()
    )

    # map assigned seat codes
    seat_ids = [pref.assigned_seat_id for pref, _ in rows if getattr(pref, "assigned_seat_id", None)]
    seats = {}
    if seat_ids:
        for s in db.query(models.Seat).filter(models.Seat.id.in_(seat_ids)).all():
            seats[s.id] = s.code

    out = []
    for pref, member in rows:
        out.append({
            "preference_id": pref.id,
            "member_id": pref.member_id,
            "first_name": getattr(member, "first_name", "") or "",
            "last_name": getattr(member, "last_name", None),
            "phone": getattr(member, "phone", None),
            # simple token: invite_token if exists, else use preference_id string
            "invite_token": (getattr(pref, "invite_token", None) or str(pref.id)),
            "assigned_seat_code": seats.get(pref.assigned_seat_id),
        })
    return out

@app.get("/portal/{token}", response_model=schemas.PortalData)
def portal_get(token: str, db: Session = Depends(get_db)):
    pref = db.query(models.MemberPreference).filter(models.MemberPreference.invite_token == token).first()
    if not pref and token.isdigit():
        pref = db.query(models.MemberPreference).get(int(token))
    if not pref:
        raise HTTPException(status_code=404, detail="Invite not found")

    ev = db.query(models.Event).filter(models.Event.id == pref.event_id).first()
    venue = db.query(models.Venue).filter(models.Venue.id == ev.venue_id).first() if ev else None
    member = db.query(models.Member).filter(models.Member.id == pref.member_id).first()

    assigned_code = None
    if pref.assigned_seat_id:
        seat = db.query(models.Seat).filter(models.Seat.id == pref.assigned_seat_id).first()
        assigned_code = seat.code if seat else None

    # NEW: zones list for the venue
    zones: List[str] = []
    if ev and ev.venue_id:
        zone_rows = (
            db.query(distinct(models.Seat.zone))
            .filter(models.Seat.venue_id == ev.venue_id)
            .order_by(models.Seat.zone.asc())
            .all()
        )
        zones = [z for (z,) in zone_rows if z]

    guests: List[Dict[str, Any]] = []  # <-- ADD THIS DEFAULT

    if getattr(pref, "group_code", None):
        guest_rows = (
            db.query(models.MemberPreference, models.Member)
            .join(models.Member, models.Member.id == models.MemberPreference.member_id)
            .filter(
                models.MemberPreference.event_id == pref.event_id,
                models.MemberPreference.group_code == pref.group_code,
                models.MemberPreference.id != pref.id,
            )
            .all()
        )
        guests = [
            {
                "first_name": m.first_name,
                "last_name": getattr(m, "last_name", None),
                "phone": getattr(m, "phone", None),
                "gender": getattr(m, "gender", None),
                "preferred_zone": getattr(p, "preferred_zone", None),
                "preferred_seat_code": None,
                "wants_aisle": int(getattr(p, "wants_aisle", 0) or 0),
                "needs_accessible": int(getattr(p, "needs_accessible", 0) or 0),
            }
            for p, m in guest_rows
        ]

    return {
        "event_name": ev.name if ev else "",
        "venue_name": venue.name if venue else None,
        "member_first_name": member.first_name if member else "",
        "member_last_name": member.last_name if member else "",
        "wants_aisle": pref.wants_aisle,
        "preferred_zone": pref.preferred_zone,
        "preferred_seat_code": pref.preferred_seat_code,
        "needs_accessible": pref.needs_accessible,
        "assigned_seat_code": assigned_code,
        "zones": zones,
        "guests": guests,
    }

@app.post("/portal/{token}")
def portal_submit(token: str, payload: schemas.PortalSubmit, db: Session = Depends(get_db)):
    # Find the main preference for this token
    pref = db.query(models.MemberPreference).filter(models.MemberPreference.invite_token == token).first()
    if not pref and token.isdigit():
        pref = db.query(models.MemberPreference).get(int(token))
    if not pref:
        raise HTTPException(status_code=404, detail="Invite not found")

    # Ensure a stable group_code for the main member + all guests from this portal link
    base_group_code = getattr(pref, "group_code", None)
    if not base_group_code:
        base_group_code = f"G-{pref.id}"
        pref.group_code = base_group_code

    # Update main preference (portal does NOT assign seats)
    pref.preferred_zone = payload.preferred_zone
    pref.preferred_seat_code = None  # always portal-controlled as "no seat code"
    pref.wants_aisle = int(getattr(payload, "wants_aisle", 0) or 0)
    pref.needs_accessible = int(getattr(payload, "needs_accessible", 0) or 0)

    # Remove old guest preferences for this same group+event (prevents duplicates on resubmits)
    # Keep the main preference row intact.
    db.query(models.MemberPreference).filter(
        models.MemberPreference.event_id == pref.event_id,
        models.MemberPreference.group_code == base_group_code,
        models.MemberPreference.id != pref.id,
    ).delete(synchronize_session=False)

    # Recreate guests from payload
    for g in (payload.guests or []):
        # IMPORTANT: members.gender is NOT NULL in your DB
        # Replace "U" with whatever value is valid in your schema (e.g. "M"/"F"/"Unknown")
        gender = (getattr(g, "gender", None) or "").strip().lower()
        if gender not in ("male", "female"):
            raise HTTPException(status_code=400, detail="Guest gender must be 'male' or 'female'")

        mem = models.Member(
            first_name=g.first_name,
            last_name=getattr(g, "last_name", None),
            phone=getattr(g, "phone", None),
            gender=gender,  # <-- must be 'male'/'female'
            birth_date=getattr(g, "birth_date", None),
        )
        db.add(mem)
        db.flush()

        gp = models.MemberPreference(
            event_id=pref.event_id,
            member_id=mem.id,
            preferred_zone=getattr(g, "preferred_zone", None),
            preferred_seat_code=None,
            wants_aisle=int(getattr(g, "wants_aisle", 0) or 0),
            needs_accessible=int(getattr(g, "needs_accessible", 0) or 0),
            group_code=base_group_code,
            invite_token=str(uuid4()),  # <-- FIX
        )
        db.add(gp)

    db.commit()
    return {"ok": True}


# ...existing code...
@app.get("/events/{event_id}/seatmap")
def event_seatmap(event_id: int, db: Session = Depends(get_db)):
    ev = db.query(models.Event).filter(models.Event.id == event_id).first()
    if not ev:
        raise HTTPException(status_code=404, detail="Event not found")

    seats = db.query(models.Seat).filter(models.Seat.venue_id == ev.venue_id).all()

    rows = (
        db.query(models.MemberPreference, models.Member)
        .join(models.Member, models.Member.id == models.MemberPreference.member_id, isouter=True)
        .filter(models.MemberPreference.event_id == event_id)
        .all()
    )

    assigned_by_seat_id: Dict[int, Dict[str, Any]] = {}
    for pref, member in rows:
        sid = getattr(pref, "assigned_seat_id", None)
        if not sid:
            continue
        assigned_by_seat_id[int(sid)] = {
            "preference_id": int(pref.id),
            "member_id": int(pref.member_id),
            "first_name": getattr(member, "first_name", "") or "",
            "last_name": getattr(member, "last_name", "") or "",
            "needs_accessible": int(getattr(pref, "needs_accessible", 0) or 0),
            "group_code": getattr(pref, "group_code", None),
        }

    return [
        {
            "id": int(s.id),
            "code": s.code,
            "zone": getattr(s, "zone", None),
            "row_label": getattr(s, "row_label", None),
            "seat_number": getattr(s, "seat_number", None),
            "is_accessible": int(getattr(s, "is_accessible", 0) or 0),
            "is_aisle": int(getattr(s, "is_aisle", 0) or 0),
            "is_blocked": int(getattr(s, "is_blocked", 0) or 0),
            "x": getattr(s, "x", None),
            "y": getattr(s, "y", None),
            "assignment": assigned_by_seat_id.get(int(s.id)),
        }
        for s in seats
    ]



@app.get("/events/{event_id}/issues")
def event_issues(event_id: int, db: Session = Depends(get_db)):
    ev = db.query(models.Event).filter(models.Event.id == event_id).first()
    if not ev:
        raise HTTPException(status_code=404, detail="Event not found")

    conflict_rows = (
        db.query(
            models.MemberPreference.assigned_seat_id.label("seat_id"),
            func.count(models.MemberPreference.id).label("cnt"),
        )
        .filter(
            models.MemberPreference.event_id == event_id,
            models.MemberPreference.assigned_seat_id.isnot(None),
        )
        .group_by(models.MemberPreference.assigned_seat_id)
        .having(func.count(models.MemberPreference.id) > 1)
        .all()
    )
    seat_conflicts = [
        {"seat_id": int(r.seat_id), "count": int(r.cnt)}
        for r in conflict_rows
        if r.seat_id is not None
    ]

    blocked_rows = (
        db.query(models.MemberPreference.id, models.MemberPreference.assigned_seat_id, models.Seat.code)
        .join(models.Seat, models.Seat.id == models.MemberPreference.assigned_seat_id)
        .filter(
            models.MemberPreference.event_id == event_id,
            models.MemberPreference.assigned_seat_id.isnot(None),
            models.Seat.is_blocked == 1,
        )
        .all()
    )
    blocked_assignments = [
        {"preference_id": int(pid), "seat_id": int(sid), "seat_code": code}
        for pid, sid, code in blocked_rows
        if sid is not None
    ]

    acc_rows = (
        db.query(models.MemberPreference.id, models.MemberPreference.assigned_seat_id, models.Seat.code)
        .join(models.Seat, models.Seat.id == models.MemberPreference.assigned_seat_id)
        .filter(
            models.MemberPreference.event_id == event_id,
            models.MemberPreference.assigned_seat_id.isnot(None),
            models.MemberPreference.needs_accessible == 1,
            models.Seat.is_accessible != 1,
        )
        .all()
    )
    accessibility_violations = [
        {"preference_id": int(pid), "seat_id": int(sid), "seat_code": code}
        for pid, sid, code in acc_rows
        if sid is not None
    ]

    unassigned_rows = (
        db.query(models.MemberPreference.id, models.MemberPreference.member_id)
        .filter(
            models.MemberPreference.event_id == event_id,
            models.MemberPreference.assigned_seat_id.is_(None),
        )
        .all()
    )
    unassigned = [{"preference_id": int(pid), "member_id": int(mid)} for pid, mid in unassigned_rows]

    return {
        "summary": {
            "seat_conflicts": len(seat_conflicts),
            "blocked_assignments": len(blocked_assignments),
            "accessibility_violations": len(accessibility_violations),
            "unassigned": len(unassigned),
        },
        "seat_conflicts": seat_conflicts,
        "blocked_assignments": blocked_assignments,
        "accessibility_violations": accessibility_violations,
        "unassigned": unassigned,
    }
    

@app.post("/events/{event_id}/assignments/move")
def move_assignment(
    event_id: int,
    preference_id: int = Query(...),
    seat_id: int = Query(...),
    db: Session = Depends(get_db),
):
    ev = db.query(models.Event).filter(models.Event.id == event_id).first()
    if not ev:
        raise HTTPException(status_code=404, detail="Event not found")

    pref = (
        db.query(models.MemberPreference)
        .filter(
            models.MemberPreference.id == preference_id,
            models.MemberPreference.event_id == event_id,
        )
        .first()
    )
    if not pref:
        raise HTTPException(status_code=404, detail="Preference not found for event")

    seat = (
        db.query(models.Seat)
        .filter(
            models.Seat.id == seat_id,
            models.Seat.venue_id == ev.venue_id,
        )
        .first()
    )
    if not seat:
        raise HTTPException(status_code=404, detail="Seat not found for event venue")

    if int(getattr(seat, "is_blocked", 0) or 0) == 1:
        raise HTTPException(status_code=400, detail="Seat is blocked")

    if int(getattr(pref, "needs_accessible", 0) or 0) == 1 and int(getattr(seat, "is_accessible", 0) or 0) != 1:
        raise HTTPException(status_code=400, detail="Member requires an accessible seat")

    taken = (
        db.query(models.MemberPreference)
        .filter(
            models.MemberPreference.event_id == event_id,
            models.MemberPreference.assigned_seat_id == seat_id,
            models.MemberPreference.id != preference_id,
        )
        .first()
    )
    if taken:
        raise HTTPException(status_code=409, detail="Seat already assigned")

    pref.assigned_seat_id = seat_id
    db.commit()
    return {"ok": True, "event_id": event_id, "preference_id": preference_id, "seat_id": seat_id}

@app.post("/events/{event_id}/assignments/clear")
def clear_assignment(
    event_id: int,
    preference_id: int = Query(...),
    db: Session = Depends(get_db),
):
    pref = (
        db.query(models.MemberPreference)
        .filter(
            models.MemberPreference.id == preference_id,
            models.MemberPreference.event_id == event_id,
        )
        .first()
    )
    if not pref:
        raise HTTPException(status_code=404, detail="Preference not found for event")

    pref.assigned_seat_id = None
    db.commit()
    return {"ok": True, "event_id": event_id, "preference_id": preference_id}


