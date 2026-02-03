from __future__ import annotations

from typing import List, Dict, Any
from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import distinct

from app import models, schemas


def portal_get(db: Session, token: str):
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

    zones: List[str] = []
    if ev and ev.venue_id:
        zone_rows = (
            db.query(distinct(models.Seat.zone))
            .filter(models.Seat.venue_id == ev.venue_id)
            .order_by(models.Seat.zone.asc())
            .all()
        )
        zones = [z for (z,) in zone_rows if z]

    guests: List[Dict[str, Any]] = []

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


def portal_submit(db: Session, token: str, payload: schemas.PortalSubmit):
    pref = db.query(models.MemberPreference).filter(models.MemberPreference.invite_token == token).first()
    if not pref and token.isdigit():
        pref = db.query(models.MemberPreference).get(int(token))
    if not pref:
        raise HTTPException(status_code=404, detail="Invite not found")

    base_group_code = getattr(pref, "group_code", None)
    if not base_group_code:
        base_group_code = f"G-{pref.id}"
        pref.group_code = base_group_code

    pref.preferred_zone = payload.preferred_zone
    pref.preferred_seat_code = None
    pref.wants_aisle = int(getattr(payload, "wants_aisle", 0) or 0)
    pref.needs_accessible = int(getattr(payload, "needs_accessible", 0) or 0)

    db.query(models.MemberPreference).filter(
        models.MemberPreference.event_id == pref.event_id,
        models.MemberPreference.group_code == base_group_code,
        models.MemberPreference.id != pref.id,
    ).delete(synchronize_session=False)

    for g in (payload.guests or []):
        gender = (getattr(g, "gender", None) or "").strip().lower()
        if gender not in ("male", "female"):
            raise HTTPException(status_code=400, detail="Guest gender must be 'male' or 'female'")

        mem = models.Member(
            first_name=g.first_name,
            last_name=getattr(g, "last_name", None),
            phone=getattr(g, "phone", None),
            gender=gender,
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
            invite_token=str(uuid4()),
        )
        db.add(gp)

    db.commit()
    return {"ok": True}