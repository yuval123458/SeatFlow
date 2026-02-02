from sqlalchemy import BigInteger, String, Integer, Date, DateTime, ForeignKey, Text, Enum, Column, Boolean, text, TIMESTAMP
from sqlalchemy.orm import Mapped, mapped_column
from typing import Optional
from .db import Base


class Venue(Base):
    __tablename__ = "venues"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)

    location: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="active")
    category: Mapped[str] = mapped_column(String(30), nullable=False, default="Other")


class Seat(Base):
    __tablename__ = "seats"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    venue_id: Mapped[int] = mapped_column(ForeignKey("venues.id"), nullable=False)

    code: Mapped[str] = mapped_column(String(50), nullable=False)
    zone: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    row_label: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    seat_number: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)

    is_accessible: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    is_blocked: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    is_aisle: Mapped[int] = mapped_column(Integer, nullable=False, default=0)  # NEW
    x: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    y: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    created_at: Mapped[Optional[DateTime]] = mapped_column(DateTime, nullable=True)


class Event(Base):
    __tablename__ = "events"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    venue_id: Mapped[int] = mapped_column(ForeignKey("venues.id"), nullable=False)

    name: Mapped[str] = mapped_column(String(255), nullable=False)
    event_date: Mapped[Optional[str]] = mapped_column(DateTime, nullable=True)

    status: Mapped[str] = mapped_column(
        Enum("draft", "preferences_open", "locked", "published", name="event_status"),
        nullable=False,
        default="draft",
    )
    submissions_locked: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class Member(Base):
    __tablename__ = "members"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    first_name: Mapped[str] = mapped_column(String(100), nullable=False)
    last_name: Mapped[str] = mapped_column(String(100), nullable=False)
    phone: Mapped[Optional[str]] = mapped_column(String(30), nullable=True)

    gender: Mapped[str] = mapped_column(Enum("male", "female", name="gender_enum"), nullable=False)
    birth_date: Mapped[Optional[str]] = mapped_column(Date, nullable=True)


class MemberPreference(Base):
    __tablename__ = "member_preferences"

    id = Column(BigInteger, primary_key=True, index=True)
    event_id = Column(BigInteger, ForeignKey("events.id", ondelete="CASCADE"), nullable=False)
    member_id = Column(BigInteger, ForeignKey("members.id", ondelete="CASCADE"), nullable=False)

    group_code = Column(String(100), nullable=True)
    wants_aisle = Column(Boolean, nullable=False, server_default=text("0"))
    preferred_zone = Column(String(100), nullable=True)
    preferred_seat_code = Column(String(50), nullable=True)
    needs_accessible = Column(Boolean, nullable=False, server_default=text("0"))
    invite_token = Column(String(36), nullable=False, unique=True)

    submitted_at = Column(DateTime, nullable=True)

    # KEY FIX: match MySQL defaults so SQLAlchemy won't send NULL
    created_at = Column(DateTime, nullable=False, server_default=text("CURRENT_TIMESTAMP"))
    updated_at = Column(
        DateTime,
        nullable=False,
        server_default=text("CURRENT_TIMESTAMP"),
        server_onupdate=text("CURRENT_TIMESTAMP"),
    )

    assigned_seat_id = Column(BigInteger, ForeignKey("seats.id", ondelete="SET NULL"), nullable=True)


class Organization(Base):
    __tablename__ = "organizations"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    name = Column(String(255), nullable=False, unique=True)
    created_at = Column(TIMESTAMP, nullable=False, server_default=text("CURRENT_TIMESTAMP"))


class User(Base):
    __tablename__ = "users"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    org_id = Column(BigInteger, nullable=False, index=True)

    email = Column(String(255), nullable=False)
    password_hash = Column(String(255), nullable=False)

    created_at = Column(TIMESTAMP, nullable=False, server_default=text("CURRENT_TIMESTAMP"))

    # refresh support (nullable)
    refresh_token_hash = Column(String(255), nullable=True)
    refresh_token_expires_at = Column(DateTime, nullable=True)
