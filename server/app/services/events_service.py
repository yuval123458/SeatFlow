from __future__ import annotations

from datetime import datetime, timezone, date
from typing import Any, Dict, Tuple, List, Set, Optional
from sqlalchemy.orm import Session
from sqlalchemy import func, text, bindparam
from sqlalchemy.exc import OperationalError
from fastapi import HTTPException, UploadFile
import csv, re
import json, logging
import urllib.request, urllib.error
from io import StringIO
from uuid import uuid4
from collections import Counter, defaultdict

from app import models, schemas
from app.settings import settings

log = logging.getLogger(__name__)


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



def _parse_flat_weights(payload: Dict[str, Any]) -> Tuple[Dict[str, float], Dict[str, float]]:
    # Safe parsing with defaults; group is ignored downstream
    pref_raw = float(payload.get("preference_weight", 50))
    stab_raw = float(payload.get("stability_weight", 50))
    grp_raw = float(payload.get("group_weight", 0))  # optional in payload
    for k, v in (("preference_weight", pref_raw), ("stability_weight", stab_raw), ("group_weight", grp_raw)):
        if v < 0 or v > 100:
            raise HTTPException(status_code=400, detail=f"{k} must be between 0 and 100")
    return (
        {"preference_weight": pref_raw, "stability_weight": stab_raw, "group_weight": grp_raw},
        {"member_preference": pref_raw / 100.0, "stability": stab_raw / 100.0, "group": 0.0},
    )

def _solve_with_java(seats, prefs, payload: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """POST the problem to the Java solver. Returns its response, or None if it is unavailable."""
    if not settings.SOLVER_URL:
        return None

    def _int_or_none(v):
        try:
            return int(str(v).strip())
        except Exception:
            return None

    body = {
        "seats": [
            {
                "id": int(s.id),
                "zone": s.zone,
                "rowLabel": s.row_label,
                "seatNumber": _int_or_none(s.seat_number),
                "x": float(s.x or 0),
                "y": float(s.y or 0),
                "aisle": bool(s.is_aisle),
                "accessible": bool(s.is_accessible),
                "blocked": bool(s.is_blocked),
            }
            for s in seats
        ],
        "people": [
            {
                "id": int(p.id),
                "groupCode": p.group_code,
                "preferredZone": p.preferred_zone,
                "wantsAisle": bool(p.wants_aisle),
                "needsAccessible": bool(p.needs_accessible),
                "previousSeatId": int(p.assigned_seat_id) if p.assigned_seat_id else None,
            }
            for p in prefs
        ],
        "preferenceWeight": int(float(payload.get("preference_weight", 50))),
        "stabilityWeight": int(float(payload.get("stability_weight", 50))),
        "groupAdjacency": bool(payload.get("group_adjacency", True)),
        "runs": int(payload.get("runs", settings.SOLVER_RUNS)),
    }
    req = urllib.request.Request(
        settings.SOLVER_URL.rstrip("/") + "/solve",
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return json.loads(resp.read())
    except (urllib.error.URLError, TimeoutError, ValueError) as e:
        log.warning("Java solver unavailable (%s); falling back to Python heuristic", e)
        return None


def _persist_plan(db: Session, event_id: int, planned: Dict[int, Optional[int]]) -> None:
    """Overwrite the event's assignments with the given plan (pref_id -> seat_id)."""
    db.execute(
        text("UPDATE member_preferences SET assigned_seat_id = NULL WHERE event_id = :eid"),
        {"eid": event_id},
    )
    seen_sids: Set[int] = set()
    to_write: List[Dict[str, int]] = []
    for pid, sid in planned.items():
        if sid is None or sid in seen_sids:
            continue
        seen_sids.add(sid)
        to_write.append({"eid": event_id, "pid": int(pid), "sid": int(sid)})
    if to_write:
        db.execute(
            text("UPDATE member_preferences SET assigned_seat_id = :sid WHERE event_id = :eid AND id = :pid"),
            to_write,
        )
    db.commit()


def run_assignments(db: Session, event_id: int, payload: Optional[Dict[str, Any]]):
    payload = payload or {}
    _, weights = _parse_flat_weights(payload)
    w_pref = weights["member_preference"]
    w_stab = weights["stability"]
    STRICT_THRESH = 0.90
    strict_member = (w_pref >= STRICT_THRESH)
    strict_stab = (w_stab >= STRICT_THRESH)
    group_adjacency: bool = bool(payload.get("group_adjacency", True))

    ev = db.query(models.Event).filter(models.Event.id == event_id).first()
    if not ev:
        raise HTTPException(status_code=404, detail="Event not found")

    # Load seats once (not blocked)
    seats = (
        db.query(models.Seat)
        .filter(models.Seat.venue_id == ev.venue_id, models.Seat.is_blocked != 1)
        .all()
    )
    if not seats:
        return {"status": "ok", "weights_used": {"member_preference": w_pref, "stability": w_stab}}

    seat_by_id = {int(s.id): s for s in seats}
    zone_of_sid: Dict[int, Optional[str]] = {int(s.id): getattr(s, "zone", None) for s in seats}

    row_of_sid: Dict[int, Any] = {}
    if any(hasattr(s, "row_label") for s in seats):
        for s in seats:
            row_of_sid[int(s.id)] = getattr(s, "row_label")
    else:
        for s in seats:
            row_of_sid[int(s.id)] = "row-0"

    accessible_seat_ids: Set[int] = {
        int(s.id) for s in seats if int(getattr(s, "is_accessible", 0) or 0) == 1
    }

    # Load preferences (with current assignments)
    prefs = (
        db.query(models.MemberPreference)
        .filter(models.MemberPreference.event_id == event_id)
        .order_by(models.MemberPreference.id.asc())
        .all()
    )

    # Prefer the Java solver (N parallel randomized runs, best plan wins).
    solved = _solve_with_java(seats, prefs, payload)
    if solved is not None:
        planned_java = {int(pid): int(sid) for pid, sid in solved["assignments"].items()}
        log.info(
            "event %s: Java solver seated %d/%d, score %.1f (best of %d runs, %d ms) %s",
            event_id, len(planned_java), len(prefs), solved["score"], solved["runs"],
            solved["elapsedMs"], solved["breakdown"],
        )
        _persist_plan(db, event_id, planned_java)
        return {
            "status": "ok",
            "solver": "java",
            "score": solved["score"],
            "breakdown": solved["breakdown"],
            "unseated": solved["unseatedPersonIds"],
            "runs": solved["runs"],
            "elapsed_ms": solved["elapsedMs"],
            "weights_used": {"member_preference": w_pref, "stability": w_stab},
            "group_adjacency": group_adjacency,
        }

    # Snapshot previous seats for stability (and current map for diff apply)
    prev_seat_by_pref: Dict[int, Optional[int]] = {
        int(p.id): (int(p.assigned_seat_id) if p.assigned_seat_id else None) for p in prefs
    }
    has_prev = any(prev_seat_by_pref.values())
    if not has_prev:
        w_stab = 0.0
        strict_stab = False

    curr_assigned_seats: Set[int] = {sid for sid in prev_seat_by_pref.values() if sid is not None}
    used: Set[int] = set(curr_assigned_seats)
    free: Set[int] = {int(s.id) for s in seats if int(getattr(s, "is_blocked", 0) or 0) == 0} - used
    acc_demand_remaining = sum(1 for p in prefs if int(getattr(p, "needs_accessible", 0) or 0) == 1)

    # If stability is not strict, make all previous seats available for reallocation
    if not strict_stab:
        free |= used
        used.clear()

    planned: Dict[int, Optional[int]] = {}  # pref_id -> seat_id
    prefs_by_id: Dict[int, models.MemberPreference] = {int(p.id): p for p in prefs}

    def is_planned(pid: int) -> bool:
        return pid in planned and planned[pid] is not None

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
        s_zone = getattr(s, "zone", None)
        s_is_aisle = bool(getattr(s, "is_aisle", 0))
        zone_ok = bool(pref_zone and s_zone == pref_zone)
        aisle_ok = (not wants_aisle) or s_is_aisle
        strict_ok = ((zone_ok or not pref_zone) and aisle_ok)
        if pref_zone and not zone_ok:
            reasons.append("zone")
        if wants_aisle and not s_is_aisle:
            reasons.append("aisle")
        return strict_ok, reasons

    # Strict stability: reuse previous seats first
    if strict_stab:
        for p in prefs:
            pid = int(p.id)
            prev_sid = prev_seat_by_pref.get(pid)
            if not prev_sid:
                continue
            if prev_sid in free or prev_sid in used:
                if hard_ok(p, seat_by_id[int(prev_sid)]):
                    planned[pid] = int(prev_sid)
                    used.add(int(prev_sid))
                    free.discard(int(prev_sid))
                    if needs_accessible(p) == 1:
                        acc_demand_remaining -= 1

    # Groups-first adjacency
    if group_adjacency:
        group_members: Dict[str, List[models.MemberPreference]] = defaultdict(list)
        for p in prefs:
            g = getattr(p, "group_code", None)
            if g:
                group_members[g].append(p)

        def row_sort_key(sid: int):
            s = seat_by_id[sid]
            sn = getattr(s, "seat_number", None)
            if sn is not None:
                try:
                    return (0, int(sn))
                except Exception:
                    return (0, str(sn))

        def free_rows_by_zone(zone: Optional[str]) -> Dict[Any, List[int]]:
            rows: Dict[Any, List[int]] = defaultdict(list)
            for sid in list(free):
                if sid in used:
                    continue
                if zone is not None and zone_of_sid.get(sid) != zone:
                    continue
                rows[row_of_sid.get(sid, 0)].append(int(sid))
            return {rk: sorted(arr, key=row_sort_key) for rk, arr in rows.items() if arr}


        def windows_of_size(arr: List[int], k: int) -> List[List[int]]:
            if k <= 0 or len(arr) < k:
                return []

            def sn(sid: int) -> Optional[int]:
                s = seat_by_id[sid]
                val = getattr(s, "seat_number", None)
                try:
                    return int(val)
                except Exception:
                    return None

            wins: List[List[int]] = []
            ordered = arr  
            for i in range(0, len(ordered) - k + 1):
                block = ordered[i:i + k]
                nums = [sn(sid) for sid in block]
                if any(n is None for n in nums):
                    continue
                if all(nums[j] == nums[j - 1] + 1 for j in range(1, k)):
                    wins.append(block)
            return wins

        def choose_group_zone(members: List[models.MemberPreference]) -> Optional[str]:
            pref_counts = Counter((getattr(m, "preferred_zone", None) or None) for m in members)
            free_zone_counts = Counter(zone_of_sid[sid] for sid in free if sid not in used)
            for z, _ in pref_counts.most_common():
                if z is not None and free_zone_counts.get(z, 0) > 0:
                    return z
            if free_zone_counts:
                return max(free_zone_counts.items(), key=lambda kv: (kv[1], str(kv[0] or "")))[0]
            return None

        for gcode, members in sorted(
            group_members.items(),
            key=lambda kv: -len([p for p in kv[1] if not is_planned(int(p.id))]),
        ):
            unassigned = [p for p in members if not is_planned(int(p.id))]
            if len(unassigned) < 2:
                continue

            z0 = choose_group_zone(unassigned)
            zones_to_try = [z0] if z0 is not None else []
            zones_to_try += [z for z in sorted(set(zone_of_sid.values())) if z != z0]
            if not zones_to_try:
                zones_to_try = [None]

            def mkey(p):
                return (0 if needs_accessible(p) == 1 else 1,
                        0 if bool(getattr(p, "wants_aisle", 0)) else 1,
                        int(p.id))
            members_sorted = sorted(unassigned, key=mkey)
            need_acc = sum(1 for p in members_sorted if needs_accessible(p) == 1)
            want_aisle = sum(1 for p in members_sorted if bool(getattr(p, "wants_aisle", 0)))
            group_size = len(members_sorted)
            pref_counts = Counter((getattr(m, "preferred_zone", None) or None) for m in members_sorted)
            majority_zone = pref_counts.most_common(1)[0][0] if pref_counts else None

            best: Optional[Tuple[Optional[str], Any, List[int], Tuple[int, int, int, int]]] = None
            for z in zones_to_try:
                rows_map = free_rows_by_zone(z)
                if not rows_map:
                    continue
                for rk, sids in rows_map.items():
                    if len(sids) < group_size:
                        continue
                    for win in windows_of_size(sids, group_size):
                        acc_in = sum(1 for sid in win if sid in accessible_seat_ids)
                        if acc_in < need_acc:
                            continue
                        aisle_in = sum(1 for sid in win if bool(getattr(seat_by_id[sid], "is_aisle", 0)))
                        score = (min(aisle_in, want_aisle), -(acc_in - need_acc), 1 if (z and z == majority_zone) else 0, len(win))
                        if best is None or score > best[3]:
                            best = (z, rk, win, score)

            if not best:
                continue

            _, _, window, _ = best
            seats_left = list(window)
            assigned_local: Dict[int, int] = {}

            # 1) Accessible first
            for p in [m for m in members_sorted if needs_accessible(m) == 1]:
                if is_planned(int(p.id)):
                    continue
                cands = [sid for sid in seats_left if sid in accessible_seat_ids and hard_ok(p, seat_by_id[sid])]
                if not cands:
                    assigned_local = {}
                    break
                sid = cands[0]
                assigned_local[int(p.id)] = int(sid)
                seats_left.remove(int(sid))
            if not assigned_local and need_acc > 0:
                continue

            # 2) Aisle wanters
            for p in [m for m in members_sorted if needs_accessible(m) == 0 and bool(getattr(m, "wants_aisle", 0)) and int(m.id) not in assigned_local]:
                if is_planned(int(p.id)):
                    continue
                cands = [sid for sid in seats_left if bool(getattr(seat_by_id[sid], "is_aisle", 0)) and hard_ok(p, seat_by_id[sid])]
                if cands:
                    sid = cands[0]
                    assigned_local[int(p.id)] = int(sid)
                    seats_left.remove(int(sid))

            # 3) Rest
            for p in [m for m in members_sorted if int(m.id) not in assigned_local]:
                if is_planned(int(p.id)):
                    continue
                cands = [sid for sid in seats_left if hard_ok(p, seat_by_id[sid])]
                if not cands:
                    assigned_local = {}
                    break
                pref_zone = getattr(p, "preferred_zone", None)
                if pref_zone is not None:
                    zc = [sid for sid in cands if getattr(seat_by_id[sid], "zone", None) == pref_zone]
                    if zc:
                        cands = zc
                sid = cands[0]
                assigned_local[int(p.id)] = int(sid)
                seats_left.remove(int(sid))

            if not assigned_local:
                continue

            # Plan window
            for p in members_sorted:
                pid = int(p.id)
                sid = assigned_local.get(pid)
                if sid is None:
                    continue
                planned[pid] = int(sid)
                # release this member's old seat (if moving)
                old = prev_seat_by_pref.get(pid)
                if old and int(old) != int(sid):
                    used.discard(int(old))
                    free.add(int(old))
                used.add(int(sid))
                free.discard(int(sid))
                if needs_accessible(p) == 1:
                    acc_demand_remaining -= 1

    # Fill remaining (plan only)
    remaining = [p for p in prefs if not is_planned(int(p.id))]

    def candidate_list_for(p, allow_use_accessible: bool = False) -> List[int]:
        c = [sid for sid in list(free) if sid not in used and hard_ok(p, seat_by_id[sid])]
        pref_zone = getattr(p, "preferred_zone", None)
        if pref_zone:
            cz = [sid for sid in c if getattr(seat_by_id[sid], "zone", None) == pref_zone]
            # Use zone-filtered list if any exist; otherwise keep original list (may be empty)
            if cz:
                c = cz
        # keep some accessible capacity unless explicitly allowed
        if not allow_use_accessible:
            free_acc_left = len(accessible_seat_ids & free)
            if needs_accessible(p) == 0 and free_acc_left <= acc_demand_remaining:
                c = [sid for sid in c if sid not in accessible_seat_ids]
        return c

    # Use cache for scarcity ordering
    cand_cache: Dict[int, int] = {int(p.id): len(candidate_list_for(p)) for p in remaining}
    remaining_ordered = sorted(remaining, key=lambda p: cand_cache.get(int(p.id), 0))
    
    def is_member_strict(p) -> bool:
        return bool(strict_member or (p.preferred_zone and p.preferred_zone.strip()))
    
    # Dynamic weighting based on current demand/supply in zones and aisle scarcity
    def compute_dynamic_weights(remaining_members: List[models.MemberPreference], free_seats: Set[int]):
        # Demand side
        demand_by_zone: Counter = Counter()
        want_aisle_count = 0
        for p in remaining_members:
            z = getattr(p, "preferred_zone", None)
            if z is not None and str(z).strip() != "":
                demand_by_zone[str(z)] += 1
            if bool(getattr(p, "wants_aisle", 0)):
                want_aisle_count += 1

        # Supply side
        free_by_zone: Counter = Counter()
        free_aisle_count = 0
        for sid in list(free_seats):
            z = zone_of_sid.get(int(sid))
            if z is not None and str(z).strip() != "":
                free_by_zone[str(z)] += 1
            if bool(getattr(seat_by_id[int(sid)], "is_aisle", 0)):
                free_aisle_count += 1

        # Pressure = demand/supply per zone
        zone_pressure: Dict[str, float] = {}
        for z, d in demand_by_zone.items():
            s = max(1, int(free_by_zone.get(z, 0)))
            zone_pressure[z] = float(d) / float(s)
        max_zone_pressure = max(zone_pressure.values(), default=1.0)

        # Normalize aisle pressure 0..1 (>=1 - very scarce)
        aisle_pressure = 0.0
        if want_aisle_count > 0:
            aisle_pressure = min(1.0, float(want_aisle_count) / float(max(1, free_aisle_count)))

        # Functions/weights used by the picker
        def zone_weight_for(z: Optional[str]) -> float:
            if not z or str(z).strip() == "":
                return 0.0
            p = zone_pressure.get(str(z), 0.0)
            # Scale zone weight by relative scarcity, but guarantee a strong base for any explicit match
            # so requested zones (e.g., VIP) are preferred even if supply is abundant.
            rel = 0.0 if max_zone_pressure <= 0 else (p / max_zone_pressure)
            return float(w_pref) * (0.7 + 0.3 * max(0.0, min(1.0, rel)))

        aisle_weight = float(w_pref) * aisle_pressure  # emphasize when scarce
        stability_weight = float(w_stab)

        # Seat popularity penalty (0..1): discourage highly coveted seats so others can still match
        popularity: Dict[int, float] = {}
        for sid in list(free_seats):
            z = zone_of_sid.get(int(sid))
            zp = zone_pressure.get(str(z), 0.0) if z is not None else 0.0
            # Convert pressure to 0..1 via p/(1+p)
            z_term = zp / (1.0 + zp)
            a_flag = 1.0 if bool(getattr(seat_by_id[int(sid)], "is_aisle", 0)) else 0.0
            a_term = a_flag * aisle_pressure
            popularity[int(sid)] = max(0.0, min(1.0, 0.7 * z_term + 0.3 * a_term))

        return {
            "zone_weight_for": zone_weight_for,
            "aisle_weight": aisle_weight,
            "stability_weight": stability_weight,
            "popularity": popularity,
        }

    dynw = compute_dynamic_weights(remaining, free)

    def soft_pick_v2(p, candidate_ids: List[int], dynw) -> Optional[int]:
        if not candidate_ids:
            return None
        pref_zone = getattr(p, "preferred_zone", None)
        wants_aisle = bool(getattr(p, "wants_aisle", 0))
        prev_sid = prev_seat_by_pref.get(int(p.id))

        def score(sid: int) -> float:
            s = seat_by_id[sid]
            z_match = 1.0 if (pref_zone and getattr(s, "zone", None) == pref_zone) else 0.0
            a_match = 1.0 if (wants_aisle and bool(getattr(s, "is_aisle", 0))) else 0.0
            keep = 1.0 if (prev_sid and prev_sid == sid) else 0.0
            w_zone = dynw["zone_weight_for"](pref_zone) if pref_zone else 0.0
            w_aisle = dynw["aisle_weight"]
            w_stb = dynw["stability_weight"]
            pop_pen = 0.15 * dynw["popularity"].get(sid, 0.0)
            return z_match * w_zone + a_match * w_aisle + keep * w_stb - pop_pen

        return max(candidate_ids, key=score)

    def pick_nonconflicting(p, candidates: List[int], dynw) -> Optional[int]:
        # Try best-scored seats, skipping ones already taken
        pool = list(dict.fromkeys(candidates)) 
        while pool:
            sid = soft_pick_v2(p, pool, dynw)
            if sid is None:
                return None
            if sid not in used:
                return sid
            try:
                pool.remove(sid)
            except ValueError:
                break
        return None

    # Make multiple passes while assignments are still happening
    while True:
        progress = False
        # Recompute dynamic weights each pass to reflect updated free seats and remaining members
        unplanned_now = [pp for pp in prefs if not is_planned(int(pp.id))]
        dynw = compute_dynamic_weights(unplanned_now, free)
        for p in remaining_ordered:
            pid = int(p.id)
            if is_planned(pid):
                continue
            candidates = candidate_list_for(p)
            if not candidates:
                continue
            cand2 = candidates
            if is_member_strict(p):
                cand2 = [sid for sid in cand2 if seat_matches_pref(p, seat_by_id[sid])[0]]
                if not cand2:
                    continue
            chosen_sid = pick_nonconflicting(p, cand2, dynw)
            if chosen_sid is None:
                continue
            planned[pid] = int(chosen_sid)
            # release this member's old seat (if moving)
            old = prev_seat_by_pref.get(pid)
            if old and int(old) != int(chosen_sid):
                used.discard(int(old))
                free.add(int(old))
            used.add(int(chosen_sid))
            free.discard(int(chosen_sid))
            if needs_accessible(p) == 1:
                acc_demand_remaining -= 1
            progress = True
        if not progress:
            break

    # Final greedy fallback: allow using accessible seats and relax soft prefs
    leftovers = [p for p in prefs if planned.get(int(p.id)) is None]
    if leftovers:
        for p in leftovers:
            pid = int(p.id)
            cands = candidate_list_for(p, allow_use_accessible=True) 
            if not cands:
                continue
            if is_member_strict(p):
                soft_ok = [sid for sid in cands if seat_matches_pref(p, seat_by_id[sid])[0]]
                if soft_ok:
                    cands = soft_ok
            sid = pick_nonconflicting(p, cands, dynw)
            if sid is None:
                continue
            planned[pid] = int(sid)
            old = prev_seat_by_pref.get(pid)
            if old and int(old) != int(sid):
                used.discard(int(old))
                free.add(int(old))
            used.add(int(sid))
            free.discard(int(sid))
            if needs_accessible(p) == 1:
                acc_demand_remaining -= 1

    # Final safety: resolve any duplicate seats inside plan
    assigned_by_seat: Dict[int, int] = {}
    dup_holders: List[int] = []
    for pid, sid in planned.items():
        if sid is None:
            continue
        if sid in assigned_by_seat:
            dup_holders.append(pid)
        else:
            assigned_by_seat[sid] = pid

    if dup_holders:
        still_assigned = {sid for sid in assigned_by_seat.keys()}
        free_pool = ({int(sid) for sid in seat_by_id.keys()} - still_assigned)
        for pid in dup_holders:
            p = prefs_by_id[pid]
            planned[pid] = None
            cands = [sid for sid in free_pool if hard_ok(p, seat_by_id[sid])]
            if strict_member:
                cands = [sid for sid in cands if seat_matches_pref(p, seat_by_id[sid])[0]]
            sid = pick_nonconflicting(p, cands, dynw) if cands else None
            if sid is not None:
                planned[pid] = int(sid)
                old = prev_seat_by_pref.get(pid)
                if old and int(old) != int(sid):
                    used.discard(int(old))
                    free_pool.add(int(old))
                free_pool.discard(int(sid))

    _persist_plan(db, event_id, planned)

    return {
        "status": "ok",
        "solver": "python",
        "weights_used": {"member_preference": w_pref, "stability": w_stab},
        "group_adjacency": group_adjacency,
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

    # Seat conflicts (same seat to >1)
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

    # Blocked seats assigned
    blocked_rows = (
        db.query(
            models.MemberPreference.id,
            models.MemberPreference.assigned_seat_id,
            models.Seat.code,
        )
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

    # Accessibility violations
    acc_rows = (
        db.query(
            models.MemberPreference.id,
            models.MemberPreference.assigned_seat_id,
            models.Seat.code,
        )
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

    # Unassigned (names optional; participants panel already lists them)
    unassigned_rows = (
        db.query(models.MemberPreference.id, models.MemberPreference.member_id)
        .filter(
            models.MemberPreference.event_id == event_id,
            models.MemberPreference.assigned_seat_id.is_(None),
        )
        .all()
    )
    unassigned = [{"preference_id": int(pid), "member_id": int(mid)} for pid, mid in unassigned_rows]

    # Assigned with seat + member (no row_index/seat_index usage)
    assigned = (
        db.query(
            models.MemberPreference.id.label("preference_id"),
            models.MemberPreference.member_id,
            models.MemberPreference.group_code,
            models.MemberPreference.wants_aisle,
            models.MemberPreference.preferred_zone,
            models.Seat.id.label("seat_id"),
            models.Seat.code.label("seat_code"),
            models.Seat.zone.label("seat_zone"),
            models.Seat.is_aisle.label("seat_is_aisle"),
            models.Seat.x.label("x"),
            models.Seat.y.label("y"),
            models.Member.first_name,
            models.Member.last_name,
        )
        .join(models.Seat, models.Seat.id == models.MemberPreference.assigned_seat_id)
        .join(models.Member, models.Member.id == models.MemberPreference.member_id, isouter=True)
        .filter(
            models.MemberPreference.event_id == event_id,
            models.MemberPreference.assigned_seat_id.isnot(None),
        )
        .all()
    )

    # Aisle mismatches
    aisle_mismatches = []
    for r in assigned:
        wants = 1 if (getattr(r, "wants_aisle", 0) or 0) == 1 else 0
        is_aisle = 1 if (getattr(r, "seat_is_aisle", 0) or 0) == 1 else 0
        if wants == 1 and is_aisle == 0:
            aisle_mismatches.append({
                "preference_id": int(r.preference_id),
                "member_id": int(r.member_id),
                "first_name": getattr(r, "first_name", "") or "",
                "last_name": getattr(r, "last_name", "") or "",
                "seat_id": int(r.seat_id),
                "seat_code": getattr(r, "seat_code", None),
                "zone": getattr(r, "seat_zone", None),
            })

    # Zone preference not met
    zone_mismatches = []
    for r in assigned:
        pref_zone = getattr(r, "preferred_zone", None)
        seat_zone = getattr(r, "seat_zone", None)
        if pref_zone and seat_zone and str(pref_zone) != str(seat_zone):
            zone_mismatches.append({
                "preference_id": int(r.preference_id),
                "member_id": int(r.member_id),
                "first_name": getattr(r, "first_name", "") or "",
                "last_name": getattr(r, "last_name", "") or "",
                "seat_id": int(r.seat_id),
                "seat_code": getattr(r, "seat_code", None),
                "preferred_zone": pref_zone,
                "actual_zone": seat_zone,
            })

    # Build row indexing using Seat.y (bucketed) and Seat.x ordering
    # Prefer all seats for the event; if Seat.event_id is absent, fall back to seats used by this event.
    try:
        seats_all = (
            db.query(models.Seat.id, models.Seat.x, models.Seat.y)
            .filter(models.Seat.event_id == event_id)
            .all()
        )
    except Exception:
        seats_all = (
            db.query(models.Seat.id, models.Seat.x, models.Seat.y)
            .join(models.MemberPreference, models.MemberPreference.assigned_seat_id == models.Seat.id)
            .filter(models.MemberPreference.event_id == event_id)
            .all()
        )

    ROW_EPS = 1.0  # tweak if your row Y spacing is < 1 unit

    def row_key_from_y(y):
        if y is None:
            return None
        return round(float(y) / ROW_EPS) * ROW_EPS

    rows_all: dict[float, list[tuple[float, int]]] = defaultdict(list)
    for sid, sx, sy in seats_all:
        rk = row_key_from_y(sy)
        if rk is not None and sx is not None:
            rows_all[rk].append((float(sx), int(sid)))

    row_index_of: dict[int, int] = {}
    for rk, items in rows_all.items():
        items.sort(key=lambda t: t[0])  # left-to-right
        for idx, (_x, sid) in enumerate(items):
            row_index_of[sid] = idx

    # Groups not seated contiguously:
    # Rule: all members must be on the same row (by Y bucket) AND their seat indices form a single consecutive block.
    by_group: dict[str, list] = defaultdict(list)
    for r in assigned:
        g = getattr(r, "group_code", None)
        if g:
            by_group[str(g)].append(r)

    group_not_adjacent_members: list[dict] = []

    for gcode, members in by_group.items():
        if len(members) < 2:
            continue

        rk_vals = {row_key_from_y(getattr(m, "y", None)) for m in members}
        rk_vals = {rk for rk in rk_vals if rk is not None}
        if len(rk_vals) != 1:
            # Not on one row -> not contiguous
            group_not_adjacent_members += [
                {
                    "group_code": gcode,
                    "preference_id": int(m.preference_id),
                    "member_id": int(m.member_id),
                    "first_name": getattr(m, "first_name", "") or "",
                    "last_name": getattr(m, "last_name", "") or "",
                    "seat_id": int(m.seat_id),
                    "seat_code": getattr(m, "seat_code", None),
                }
                for m in members
            ]
            continue

        indices: list[int] = []
        missing = False
        for m in members:
            idx = row_index_of.get(int(m.seat_id))
            if idx is None:
                missing = True
                break
            indices.append(idx)
        if missing:
            group_not_adjacent_members += [
                {
                    "group_code": gcode,
                    "preference_id": int(m.preference_id),
                    "member_id": int(m.member_id),
                    "first_name": getattr(m, "first_name", "") or "",
                    "last_name": getattr(m, "last_name", "") or "",
                    "seat_id": int(m.seat_id),
                    "seat_code": getattr(m, "seat_code", None),
                }
                for m in members
            ]
            continue

        indices.sort()
        contiguous = indices[-1] - indices[0] + 1 == len(indices)
        if not contiguous:
            group_not_adjacent_members += [
                {
                    "group_code": gcode,
                    "preference_id": int(m.preference_id),
                    "member_id": int(m.member_id),
                    "first_name": getattr(m, "first_name", "") or "",
                    "last_name": getattr(m, "last_name", "") or "",
                    "seat_id": int(m.seat_id),
                    "seat_code": getattr(m, "seat_code", None),
                }
                for m in members
            ]

    return {
        "summary": {
            "seat_conflicts": len(seat_conflicts),
            "blocked_assignments": len(blocked_assignments),
            "accessibility_violations": len(accessibility_violations),
            "unassigned": len(unassigned),
            "aisle_mismatches": len(aisle_mismatches),
            "zone_mismatches": len(zone_mismatches),
            "groups_not_adjacent": len({m["group_code"] for m in group_not_adjacent_members}) if group_not_adjacent_members else 0,
        },
        "seat_conflicts": seat_conflicts,
        "blocked_assignments": blocked_assignments,
        "accessibility_violations": accessibility_violations,
        "unassigned": unassigned,
        "aisle_mismatches": aisle_mismatches,
        "zone_mismatches": zone_mismatches,
        "group_not_adjacent_members": group_not_adjacent_members,
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
