"""Tickets: plant-wide messaging between users and roles (messages, files, forms, notifications).

All timestamps are stored in server local time (naive) so the browser shows them as written.
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, JSON, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from .database import Base


class Ticket(Base):
    __tablename__ = "tickets"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    subject: Mapped[str] = mapped_column(String(200))
    category: Mapped[str] = mapped_column(String(30), default="general")  # general | request | issue | form | info
    priority: Mapped[str] = mapped_column(String(10), default="normal")  # low | normal | high | urgent
    status: Mapped[str] = mapped_column(String(15), default="open", index=True)  # open | in_progress | answered | closed
    created_by_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), index=True)
    created_by_name: Mapped[str | None] = mapped_column(String(150))
    created_by_role: Mapped[str | None] = mapped_column(String(80))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now, index=True)
    last_message_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now, index=True)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime)
    to_all: Mapped[bool] = mapped_column(Boolean, default=False)  # sent to everybody


class TicketParticipant(Base):
    __tablename__ = "ticket_participants"
    __table_args__ = (UniqueConstraint("ticket_id", "user_id", name="uq_ticket_participant"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    ticket_id: Mapped[int] = mapped_column(Integer, ForeignKey("tickets.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), index=True)
    added_via: Mapped[str | None] = mapped_column(String(80))  # creator | user | role name | everyone
    added_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)


class TicketMessage(Base):
    __tablename__ = "ticket_messages"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    ticket_id: Mapped[int] = mapped_column(Integer, ForeignKey("tickets.id", ondelete="CASCADE"), index=True)
    sender_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), index=True)
    sender_name: Mapped[str | None] = mapped_column(String(150))
    sender_role: Mapped[str | None] = mapped_column(String(80))
    kind: Mapped[str] = mapped_column(String(10), default="message")  # message | system
    body: Mapped[str | None] = mapped_column(Text)
    form_type: Mapped[str | None] = mapped_column(String(40))
    form_data: Mapped[dict | None] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now, index=True)


class TicketAttachment(Base):
    __tablename__ = "ticket_attachments"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    ticket_id: Mapped[int] = mapped_column(Integer, ForeignKey("tickets.id", ondelete="CASCADE"), index=True)
    message_id: Mapped[int] = mapped_column(Integer, ForeignKey("ticket_messages.id", ondelete="CASCADE"), index=True)
    original_name: Mapped[str] = mapped_column(String(255))
    stored_name: Mapped[str] = mapped_column(String(80))
    content_type: Mapped[str] = mapped_column(String(100))
    size_bytes: Mapped[int] = mapped_column(Integer, default=0)
    uploaded_by_id: Mapped[int | None] = mapped_column(Integer)
    uploaded_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)


class TicketNotification(Base):
    """One 'you have a new message' entry per recipient; read_at stays empty until the ticket is opened."""

    __tablename__ = "ticket_notifications"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), index=True)
    ticket_id: Mapped[int] = mapped_column(Integer, ForeignKey("tickets.id", ondelete="CASCADE"), index=True)
    message_id: Mapped[int | None] = mapped_column(Integer)
    kind: Mapped[str] = mapped_column(String(15), default="message")  # new_ticket | message | status | added
    from_id: Mapped[int | None] = mapped_column(Integer)
    from_name: Mapped[str | None] = mapped_column(String(150))
    from_role: Mapped[str | None] = mapped_column(String(80))
    subject: Mapped[str | None] = mapped_column(String(200))
    preview: Mapped[str | None] = mapped_column(String(300))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now, index=True)
    read_at: Mapped[datetime | None] = mapped_column(DateTime, index=True)
