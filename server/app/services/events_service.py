from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional, Dict, Any

from fastapi import HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func

from app import models, schemas


def list_events(db: Session):
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
    return [
        {
            "id": ev.id,
            "venue_id": ev.venue_id,
            "name": ev.name,
            "event_date": ev.event_date,
            "status": ev.status,
            "venue_name": venue_name,
            "attendees_count": int(total_prefs or 0),
            "assigned_count": int(assigned_count or 0),
            "total_prefs": int(total_prefs or 0),
        }
        for ev, venue_name, total_prefs, assigned_count in rows
    ]


def create_event(db: Session, payload: schemas.EventCreate):
    venue = db.query(models.Venue).filter(models.Venue.id == payload.venue_id).first()
    if not venue:
        raise HTTPException(status_code=404, detail="Venue not found")

    name = (payload.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Event name is required")

    event_dt = None
    if payload.event_date:
        event_dt = datetime.combine(payload.event_date, datetime.min.time()).replace(tzinfo=timezone.utc)

    ev = models.Event(
        venue_id=payload.venue_id,
        name=name,
        event_date=event_dt,
        status="draft",
    )

    db.add(ev)
    db.commit()
    db.refresh(ev)

    return {
        "id": ev.id,
        "venue_id": ev.venue_id,
        "name": ev.name,
        "event_date": ev.event_date,
        "status": ev.status,
        "venue_name": venue.name,
        "attendees_count": 0,
        "assigned_count": 0,
        "total_prefs": 0,
    }


def get_event(db: Session, event_id: int):
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
        "venue_name": venue_name,
        "attendees_count": int(total_prefs),
        "assigned_count": int(assigned_count),
        "total_prefs": int(total_prefs),
    }


def run_assignments(db: Session, event_id: int, payload: Optional[Dict[str, Any]]):
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

    w_pref = _weight("preference_weight", "preferenceWeight", default=60)
    w_group = _weight("group_weight", "groupWeight", default=70)
    w_stable = _weight("stability_weight", "stabilityWeight", default=80)

    seats = (
        db.query(models.Seat)
        .filter(
            models.Seat.venue_id == ev.venue_id,
            models.Seat.is_blocked != 1,
        )
        .all()
    )
    seat_by_id = {s.id: s for s in seats}

    prefs = (
        db.query(models.MemberPreference)
        .filter(models.MemberPreference.event_id == event_id)
        .order_by(models.MemberPreference.id.asc())
        .all()
    )

    def needs_accessible(p) -> int:
        return int(bool(getattr(p, "needs_accessible", 0)))

    def hard_ok(p, s) -> bool:
        if int(getattr(s, "is_blocked", 0) or 0) == 1:
            return False
        if needs_accessible(p) == 1 and int(getattr(s, "is_accessible", 0) or 0) != 1:
            return False
        return True

    prev_seat_by_pref: Dict[int, Optional[int]] = {
        int(p.id): (int(p.assigned_seat_id) if p.assigned_seat_id else None) for p in prefs
    }

    for p in prefs:
        p.assigned_seat_id = None

    free_ids = {s.id for s in seats}
    group_points: Dict[str, list[tuple[float, float]]] = {}

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
        score = 0.0
        if getattr(p, "preferred_seat_code", None) and s.code == p.preferred_seat_code:
            score += 1.0
        if getattr(p, "preferred_zone", None) and getattr(s, "zone", None) == p.preferred_zone:
            score += 0.5
        if int(getattr(p, "wants_aisle", 0) or 0) == 1 and int(getattr(s, "is_aisle", 0) or 0) == 1:
            score += 0.2
        return 1.0 if score >= 1.0 else score

    def group_score(p, s) -> float:
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


def event_participants(db: Session, event_id: int):
    rows = (
        db.query(models.MemberPreference, models.Member)
        .join(models.Member, models.Member.id == models.MemberPreference.member_id, isouter=True)
        .filter(models.MemberPreference.event_id == event_id)
        .all()
    )

    seat_ids = [pref.assigned_seat_id for pref, _ in rows if getattr(pref, "assigned_seat_id", None)]
    seats = {}
    if seat_ids:
        for s in db.query(models.Seat).filter(models.Seat.id.in_(seat_ids)).all():
            seats[s.id] = s.code

    out = []
    for pref, member in rows:
        out.append(
            {
                "preference_id": pref.id,
                "member_id": pref.member_id,
                "first_name": getattr(member, "first_name", "") or "",
                "last_name": getattr(member, "last_name", None),
                "phone": getattr(member, "phone", None),
                "invite_token": (getattr(pref, "invite_token", None) or str(pref.id)),
                "assigned_seat_code": seats.get(pref.assigned_seat_id),
            }
        )
    return out


def event_seatmap(db: Session, event_id: int):
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


def event_issues(db: Session, event_id: int):
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


def move_assignment(db: Session, event_id: int, preference_id: int, seat_id: int):
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


def clear_assignment(db: Session, event_id: int, preference_id: int):
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


def update_event_status(db: Session, event_id: int, payload: schemas.EventStatusUpdate):
    ev = db.query(models.Event).filter(models.Event.id == event_id).first()
    if not ev:
        raise HTTPException(status_code=404, detail="Event not found")

    ev.status = payload.status
    db.commit()
    db.refresh(ev)

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
        "venue_name": venue_name,
        "attendees_count": int(total_prefs),
        "assigned_count": int(assigned_count),
        "total_prefs": int(total_prefs),
    }
