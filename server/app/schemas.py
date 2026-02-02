from datetime import datetime, date
from pydantic import BaseModel, Field, EmailStr
from typing import List, Optional, Literal

class VenueOut(BaseModel):
    id: int
    name: str
    location: Optional[str] = None
    status: str
    category: Optional[str] = None

    # allow GET /venues to return aggregates, and POST /venues to omit them
    seat_count: int = 0
    zones_count: int = 0
    events_count: int = 0

    class Config:
        from_attributes = True 

class VenueCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    location: Optional[str] = Field(None, max_length=200)
    status: str = Field("active", min_length=1, max_length=50)
    category: Optional[str] = Field(None, max_length=50)

class SeatCreate(BaseModel):
    code: str
    zone: Optional[str] = None
    row_label: Optional[str] = None
    seat_number: Optional[str] = None
    is_accessible: int = 0
    is_blocked: int = 0
    x: Optional[int] = None
    y: Optional[int] = None

class SeatOut(BaseModel):
    id: int
    venue_id: int
    code: str
    zone: Optional[str] = None
    row_label: Optional[str] = None
    seat_number: Optional[str] = None
    is_accessible: int
    is_blocked: int
    x: Optional[int] = None
    y: Optional[int] = None

class EventCreate(BaseModel):
    venue_id: int
    name: str
    event_date: Optional[datetime] = None

class EventOut(BaseModel):
    id: int
    venue_id: int
    name: str
    event_date: Optional[datetime] = None
    status: str
    submissions_locked: int
    venue_name: Optional[str] = None
    attendees_count: Optional[int] = None
    assigned_count: Optional[int] = None
    total_prefs: Optional[int] = None

    class Config:
        from_attributes = True

class MemberCreate(BaseModel):
    first_name: str
    last_name: str
    phone: Optional[str] = None
    gender: str  
    birth_date: Optional[date] = None

class MemberOut(BaseModel):
    id: int
    first_name: str
    last_name: str
    phone: Optional[str] = None
    gender: str
    birth_date: Optional[date] = None

class PortalPrefsUpdate(BaseModel):
    preferred_seat_code: Optional[str] = None
    wants_aisle: int = 0
    group_code: Optional[str] = None
    needs_accessible: int = 0

class PortalView(BaseModel):
    event_id: int
    event_name: str
    member_id: int
    member_name: str
    submitted_at: Optional[datetime] = None
    preferred_seat_code: Optional[str] = None
    wants_aisle: int
    group_code: Optional[str] = None
    needs_accessible: int

class PreferenceSummary(BaseModel):
  event_id: int
  total: int
  submitted: int

class SectionSummary(BaseModel):
    zone: str
    seat_count: int
    accessible_count: int
    blocked_count: int
    rows_count: int

class ImportRowError(BaseModel):
    row_index: int
    message: str
    field: Optional[str] = None
    value: Optional[str] = None

class ImportSummary(BaseModel):
    event_id: int
    total_rows: int
    members_created: int
    members_updated: int
    preferences_created: int
    preferences_updated: int
    errors: List[ImportRowError]

class PortalGuest(BaseModel):
    first_name: str
    last_name: Optional[str] = None
    phone: Optional[str] = None

    # NEW: required, only allowed values in your DB
    gender: Literal["male", "female"]

    preferred_zone: Optional[str] = None
    preferred_seat_code: Optional[str] = None
    wants_aisle: Optional[int] = 0
    needs_accessible: Optional[int] = 0


class PortalSubmit(BaseModel):
    preferred_zone: Optional[str] = None
    preferred_seat_code: Optional[str] = None
    wants_aisle: Optional[int] = 0
    needs_accessible: Optional[int] = 0
    guests: List[PortalGuest] = []

class ParticipantLink(BaseModel):
    preference_id: int
    member_id: int
    first_name: str
    last_name: Optional[str] = None
    phone: Optional[str] = None
    invite_token: str
    assigned_seat_code: Optional[str] = None

class ZoneSpec(BaseModel):
    zone: str = Field(..., min_length=1, max_length=50)   # e.g. VIP / Premium / General
    rows: int = Field(..., ge=1, le=200)
    seats_per_row: int = Field(..., ge=1, le=500)

class GenerateSeatsPayload(BaseModel):
    zones: List[ZoneSpec]

class PortalData(BaseModel):
    event_name: str
    venue_name: Optional[str] = None

    member_first_name: str
    member_last_name: str

    preferred_zone: Optional[str] = None
    preferred_seat_code: Optional[str] = None

    wants_aisle: int = 0
    needs_accessible: int = 0

    assigned_seat_code: Optional[str] = None

    zones: List[str] = []

    guests: List[PortalGuest] = []

class AuthSignupIn(BaseModel):
    org_id: int = Field(..., ge=1)
    email: EmailStr
    password: str = Field(..., min_length=8, max_length=200)

class AuthLoginIn(BaseModel):
    org_id: int = Field(..., ge=1)
    email: EmailStr
    password: str = Field(..., min_length=1, max_length=200)

class TokenOut(BaseModel):
    access_token: str
    token_type: Literal["bearer"] = "bearer"

class OrganizationOut(BaseModel):
    id: int
    name: str

    class Config:
        from_attributes = True

class AuthMeOut(BaseModel):
    user_id: int
    email: EmailStr
    org_id: int
    org_name: str
