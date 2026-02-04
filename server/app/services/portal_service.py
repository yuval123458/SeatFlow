from __future__ import annotations

from typing import List, Dict, Any
from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import distinct

from app import models, schemas


def portal_get(db: Session, token: str):
    pref = db.query(models.MemberPreference).filter(models.MemberPreference.invite_token == token).first()
    if not pref:
        raise HTTPException(status_code=404, detail="Invalid token")

    member = db.get(models.Member, pref.member_id)
    event = db.get(models.Event, pref.event_id)

    assigned_seat_code = None
    assigned_seat = None
    if pref.assigned_seat_id:
        s = db.get(models.Seat, pref.assigned_seat_id)
        if s:
            assigned_seat = {
                "seat_id": s.id,
                "zone": s.zone,
                "row": s.row_label,
                "number": s.seat_number,
            }
            if s.row_label and s.seat_number is not None:
                assigned_seat_code = f"{s.row_label}{s.seat_number}"

    zones: List[str] = []
    if event and event.venue_id:
        zone_rows = (
            db.query(distinct(models.Seat.zone))
            .filter(models.Seat.venue_id == event.venue_id)
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
                "wants_aisle": int(getattr(p, "wants_aisle", 0) or 0),
                "needs_accessible": int(getattr(p, "needs_accessible", 0) or 0),
            }
            for p, m in guest_rows
        ]

    return {
        "id": pref.id,
        "member_id": pref.member_id,
        "event_id": pref.event_id,
        "event_name": getattr(event, "name", None),
        "member_first_name": getattr(member, "first_name", None),
        "member_last_name": getattr(member, "last_name", None),
        "preferred_zone": getattr(pref, "preferred_zone", None),
        "needs_accessible": bool(getattr(pref, "needs_accessible", 0)),
        "wants_aisle": bool(getattr(pref, "wants_aisle", 0)),
        "assigned_seat_code": assigned_seat_code,
        "assigned_seat": assigned_seat,
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
    # pref.preferred_seat_code = None
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
            wants_aisle=int(getattr(g, "wants_aisle", 0) or 0),
            needs_accessible=int(getattr(g, "needs_accessible", 0) or 0),
            group_code=base_group_code,
            invite_token=str(uuid4()),
        )
        db.add(gp)

    db.commit()
    return {"ok": True}