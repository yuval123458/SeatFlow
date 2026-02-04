from __future__ import annotations

from datetime import datetime, timezone, date
from typing import Any, Dict, Tuple, List, Set, Optional
from sqlalchemy.orm import Session
from sqlalchemy import func, text
# ADD:
from fastapi import HTTPException, UploadFile
import csv, re
from io import StringIO
from uuid import uuid4

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


STRICT_THRESH = 0.90 

def _parse_flat_weights(payload: Dict[str, Any]) -> Tuple[Dict[str, float], Dict[str, float]]:
    pref_raw = float(payload.get("preference_weight", 50))
    group_raw = float(payload.get("group_weight", 50))
    stab_raw  = float(payload.get("stability_weight", 50))
    for k, v in (("preference_weight", pref_raw), ("group_weight", group_raw), ("stability_weight", stab_raw)):
        if v < 0 or v > 100:
            raise HTTPException(status_code=400, detail=f"{k} must be between 0 and 100")
    return (
        {"preference_weight": pref_raw, "group_weight": group_raw, "stability_weight": stab_raw},
        {"member_preference": pref_raw / 100.0, "group": group_raw / 100.0, "stability": stab_raw / 100.0},
    )

def run_assignments(db: Session, event_id: int, payload: Optional[Dict[str, Any]]):
    payload = payload or {}
    weights_raw, weights = _parse_flat_weights(payload)
    w_pref = weights["member_preference"]
    w_group = weights["group"]
    w_stab  = weights["stability"]

    strict_member = (w_pref >= STRICT_THRESH)
    strict_stab   = (w_stab  >= STRICT_THRESH)

    ev = db.query(models.Event).filter(models.Event.id == event_id).first()
    if not ev:
        raise HTTPException(status_code=404, detail="Event not found")

    seats = (
        db.query(models.Seat)
        .filter(models.Seat.venue_id == ev.venue_id, models.Seat.is_blocked != 1)
        .all()
    )
    seat_by_id = {int(s.id): s for s in seats}

    prefs = (
        db.query(models.MemberPreference)
        .filter(models.MemberPreference.event_id == event_id)
        .order_by(models.MemberPreference.id.asc())
        .all()
    )

    prev_seat_by_pref: Dict[int, Optional[int]] = {
        int(p.id): (int(p.assigned_seat_id) if p.assigned_seat_id else None) for p in prefs
    }
    for p in prefs:
        p.assigned_seat_id = None
    db.flush()

    warnings: List[Dict[str, Any]] = []
    used: Set[int] = set()
    free: Set[int] = {int(s.id) for s in seats if int(getattr(s, "is_blocked", 0) or 0) == 0}

    def needs_accessible(p) -> int:
        return int(getattr(p, "needs_accessible", 0) or 0)

    def hard_ok(p, s) -> bool:
        if int(getattr(s, "is_blocked", 0) or 0) == 1:
            return False
        if needs_accessible(p) == 1 and int(getattr(s, "is_accessible", 0) or 0) != 1:
            return False
        return True

    def seat_matches_pref(p, s) -> Tuple[bool, List[str]]:
        reasons: List[str] = []
        pref_zone = getattr(p, "preferred_zone", None)
        wants_aisle = bool(getattr(p, "wants_aisle", 0))
        pref_seat_code = getattr(p, "preferred_seat_code", None) or getattr(p, "preferred_seat", None)

        s_zone = getattr(s, "zone", None)
        s_is_aisle = bool(getattr(s, "is_aisle", 0))
        s_code = getattr(s, "code", None)

        exact_ok = bool(pref_seat_code and s_code == pref_seat_code)
        zone_ok  = bool(pref_zone and s_zone == pref_zone)
        aisle_ok = (not wants_aisle) or s_is_aisle

        strict_ok = (exact_ok or zone_ok) and aisle_ok  

        if pref_zone and not zone_ok:
            reasons.append("zone")
        if pref_seat_code and not exact_ok:
            reasons.append("seat_code")
        if wants_aisle and not s_is_aisle:
            reasons.append("aisle")

        return strict_ok, reasons

    def soft_pick(p, candidate_ids: List[int]) -> int:
        pref_zone = getattr(p, "preferred_zone", None)
        wants_aisle = bool(getattr(p, "wants_aisle", 0))
        prev_sid = prev_seat_by_pref.get(int(p.id))
        def score(sid: int):
            s = seat_by_id[sid]
            z = 1 if pref_zone and getattr(s, "zone", None) == pref_zone else 0
            a = 1 if (wants_aisle and bool(getattr(s, "is_aisle", 0))) else 0
            k = 1 if (prev_sid and prev_sid == sid) else 0
            return (z * w_pref, a * w_pref * 0.5, k * w_stab, -sid)
        return max(candidate_ids, key=score)

    accessible_seat_ids: Set[int] = {int(s.id) for s in seats if int(getattr(s, "is_accessible", 0) or 0) == 1}
    acc_demand_remaining = sum(1 for p in prefs if needs_accessible(p) == 1)

    prefs.sort(key=lambda p: (0 if needs_accessible(p) == 1 else 1, int(p.id)))

    if strict_stab:
        for p in prefs:
            if int(p.assigned_seat_id or 0) != 0:
                continue
            prev_sid = prev_seat_by_pref.get(int(p.id))
            if not prev_sid:
                continue
            if prev_sid in free:
                s = seat_by_id[int(prev_sid)]
                if hard_ok(p, s):
                    p.assigned_seat_id = int(prev_sid)
                    used.add(int(prev_sid))
                    free.discard(int(prev_sid))
                    if needs_accessible(p) == 1:
                        acc_demand_remaining -= 1

    for p in prefs:
        if int(p.assigned_seat_id or 0) != 0:
            continue

        candidates = [sid for sid in list(free) if sid not in used and hard_ok(p, seat_by_id[sid])]

        free_acc_left = len(accessible_seat_ids & free)
        if needs_accessible(p) == 0 and free_acc_left < acc_demand_remaining:
            candidates = [sid for sid in candidates if sid not in accessible_seat_ids]

        if not candidates:
            continue

        chosen_sid: Optional[int] = None
        if strict_member:
            strict_candidates = [sid for sid in candidates if seat_matches_pref(p, seat_by_id[sid])[0]]
            if not strict_candidates:
                continue  # strict -> leave unassigned
            chosen_sid = soft_pick(p, strict_candidates)
        else:
            chosen_sid = soft_pick(p, candidates)

        if chosen_sid is not None:
            p.assigned_seat_id = int(chosen_sid)
            used.add(int(chosen_sid))
            free.discard(int(chosen_sid))
            if needs_accessible(p) == 1:
                acc_demand_remaining -= 1

    db.commit()
    return {
        "status": "ok",
        "weights_used": weights,  
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


# ---- CSV import helpers ----
_REQUIRED = {"first_name", "last_name", "gender", "phone", "birth_date"}

def _sniff_delimiter(text: str) -> str:
    sample = text[:4096]
    counts = {d: sample.count(d) for d in [",", "\t", ";"]}
    best = max(counts, key=counts.get)
    return best if counts[best] > 0 else ","

def _normalize_headers(fieldnames: list[str] | None) -> dict[str, str]:
    out: dict[str, str] = {}
    for h in (fieldnames or []):
        norm = re.sub(r"[\s\-]+", "_", (h or "").strip().lower())
        out[norm] = h
    return out

def _parse_birth_date(val: str | None) -> date | None:
    if not val or not str(val).strip():
        return None
    s = str(val).strip()
    try:
        return date.fromisoformat(s) 
    except Exception:
        pass
    for fmt in ("%d/%m/%Y", "%d-%m-%Y", "%Y/%m/%d"):
        try:
            return datetime.strptime(s, fmt).date()
        except Exception:
            continue
    raise ValueError("birth_date must be YYYY-MM-DD (or DD/MM/YYYY)")

def _norm_gender(val: str | None) -> str:
    s = (val or "").strip().lower()
    if s in {"male", "m"}:
        return "male"
    if s in {"female", "f"}:
        return "female"
    raise ValueError("gender must be 'male' or 'female'")

async def import_event_members_csv(db: Session, event_id: int, upload: UploadFile, dry_run: bool):
    ev = db.query(models.Event).filter(models.Event.id == event_id).first()
    if not ev:
        raise HTTPException(status_code=404, detail="Event not found")

    raw = await upload.read()
    text = raw.decode("utf-8-sig", errors="replace")

    delim = _sniff_delimiter(text)
    reader = csv.DictReader(StringIO(text), delimiter=delim)

    header_map = _normalize_headers(reader.fieldnames)
    missing = sorted(list(_REQUIRED - set(header_map.keys())))
    if missing:
        resp = {
            "ok": False,
            "dry_run": True,
            "created_members": 0,
            "preferences_created": 0,
            "preferences_updated": 0,
            "errors": [{"row": 1, "error": f"Missing required columns: {missing}"}],
        }
        if dry_run:
            return resp
        raise HTTPException(status_code=400, detail=resp)

    errors: list[dict] = []
    valid: list[dict] = []

    for idx, row in enumerate(reader, start=2):
        try:
            first = (row.get(header_map["first_name"]) or "").strip()
            last = (row.get(header_map["last_name"]) or "").strip()
            if not first or not last:
                raise ValueError("first_name and last_name are required")
            gender = _norm_gender(row.get(header_map["gender"]))
            phone = (row.get(header_map["phone"]) or "").strip() or None
            bd = _parse_birth_date(row.get(header_map["birth_date"]))
            valid.append({
                "first_name": first,
                "last_name": last,
                "gender": gender,
                "phone": phone,
                "birth_date": bd,
            })
        except Exception as e:
            errors.append({"row": idx, "error": str(e)})

    if dry_run:
        return {
            "ok": (len(errors) == 0),
            "dry_run": True,
            "created_members": len(valid),
            "preferences_created": 0,
            "preferences_updated": 0,
            "errors": errors[:200],
        }

    if errors:
        raise HTTPException(status_code=400, detail={"message": "CSV validation failed", "errors": errors[:200]})

    created_members = 0
    preferences_created = 0
    for r in valid:
        mem = models.Member(
            first_name=r["first_name"],
            last_name=r["last_name"],
            phone=r["phone"],
            gender=r["gender"],
            birth_date=r["birth_date"],
        )
        db.add(mem)
        db.flush()
        created_members += 1

        pref = models.MemberPreference(
            event_id=event_id,
            member_id=mem.id,
            invite_token=str(uuid4()),
        )
        db.add(pref)
        preferences_created += 1

    db.commit()
    return {
        "ok": True,
        "dry_run": False,
        "created_members": created_members,
        "preferences_created": preferences_created,
        "preferences_updated": 0,
        "errors": [],
    }
