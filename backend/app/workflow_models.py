"""Warehouse workflows: anode/cathode recoating (CO codes per pallet) and new purchases (PO codes).

Each record moves through stages; every stage belongs to one group (C-90, procurement, warehouse),
which sees it in its cartable and is notified when it arrives.
"""
from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import Date, DateTime, ForeignKey, Integer, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from .database import Base


class WfCoatingBatch(Base):
    __tablename__ = "wf_coating_batches"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    status: Mapped[str] = mapped_column(String(20), index=True)
    anode_count: Mapped[int] = mapped_column(Integer, default=0)
    cathode_count: Mapped[int] = mapped_column(Integer, default=0)
    pallet_size: Mapped[int] = mapped_column(Integer, default=20)
    company_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("wh_companies.id"), index=True)
    indent_no: Mapped[str | None] = mapped_column(String(60), index=True)
    dispatch_date: Mapped[date | None] = mapped_column(Date, index=True)
    expected_return_date: Mapped[date | None] = mapped_column(Date)
    return_date: Mapped[date | None] = mapped_column(Date, index=True)
    delay_days: Mapped[int | None] = mapped_column(Integer)
    delay_party: Mapped[str | None] = mapped_column(String(20))  # employer | coater | transport | other
    delay_reason: Mapped[str | None] = mapped_column(Text)
    rework_count: Mapped[int] = mapped_column(Integer, default=0)
    rejected: Mapped[bool] = mapped_column(default=False)
    remarks: Mapped[str | None] = mapped_column(Text)
    last_note: Mapped[str | None] = mapped_column(Text)
    # Procurement fills these after return from the coater (applies to every piece on approve).
    warranty_months: Mapped[int | None] = mapped_column(Integer)
    warranty_start: Mapped[date | None] = mapped_column(Date)
    excel_emailed_at: Mapped[datetime | None] = mapped_column(DateTime)
    created_by_id: Mapped[int | None] = mapped_column(Integer)
    created_by_name: Mapped[str | None] = mapped_column(String(150))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now, index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now, index=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime)


class WfCoatingPackage(Base):
    """One pallet (max pallet_size pieces) with its own code, Excel sheet and returned report."""

    __tablename__ = "wf_coating_packages"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    batch_id: Mapped[int] = mapped_column(Integer, ForeignKey("wf_coating_batches.id", ondelete="CASCADE"), index=True)
    code: Mapped[str] = mapped_column(String(40), unique=True, index=True)
    seq: Mapped[int] = mapped_column(Integer, unique=True, index=True)
    pallet_no: Mapped[int] = mapped_column(Integer, default=1)
    dispatch_date: Mapped[date | None] = mapped_column(Date)
    expected_return_date: Mapped[date | None] = mapped_column(Date)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)


class WfCoatingItem(Base):
    __tablename__ = "wf_coating_items"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    batch_id: Mapped[int] = mapped_column(Integer, ForeignKey("wf_coating_batches.id", ondelete="CASCADE"), index=True)
    package_id: Mapped[int] = mapped_column(Integer, ForeignKey("wf_coating_packages.id", ondelete="CASCADE"), index=True)
    line_no: Mapped[int] = mapped_column(Integer, default=1)
    element_kind: Mapped[str] = mapped_column(String(10), index=True)  # anode | cathode
    serial: Mapped[str] = mapped_column(String(50), index=True)
    problem: Mapped[str | None] = mapped_column(Text)
    pre_inspection: Mapped[str | None] = mapped_column(Text)
    final_report: Mapped[str | None] = mapped_column(Text)
    remark: Mapped[str | None] = mapped_column(Text)


class WfPurchase(Base):
    __tablename__ = "wf_purchases"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    code: Mapped[str] = mapped_column(String(40), unique=True, index=True)
    seq: Mapped[int] = mapped_column(Integer, unique=True, index=True)
    status: Mapped[str] = mapped_column(String(20), index=True)
    supplier_id: Mapped[int] = mapped_column(Integer, ForeignKey("wh_companies.id"), index=True)
    anode_count: Mapped[int] = mapped_column(Integer, default=0)
    cathode_count: Mapped[int] = mapped_column(Integer, default=0)
    approval_ref: Mapped[str | None] = mapped_column(String(120))  # management approval letter / number
    indent_no: Mapped[str | None] = mapped_column(String(60), index=True)
    request_date: Mapped[date | None] = mapped_column(Date, index=True)
    expected_delivery_date: Mapped[date | None] = mapped_column(Date)
    delivery_date: Mapped[date | None] = mapped_column(Date, index=True)
    delay_days: Mapped[int | None] = mapped_column(Integer)
    delay_party: Mapped[str | None] = mapped_column(String(20))
    delay_reason: Mapped[str | None] = mapped_column(Text)
    remarks: Mapped[str | None] = mapped_column(Text)
    last_note: Mapped[str | None] = mapped_column(Text)
    created_by_id: Mapped[int | None] = mapped_column(Integer)
    created_by_name: Mapped[str | None] = mapped_column(String(150))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now, index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now, index=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime)


class WfPurchaseItem(Base):
    __tablename__ = "wf_purchase_items"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    purchase_id: Mapped[int] = mapped_column(Integer, ForeignKey("wf_purchases.id", ondelete="CASCADE"), index=True)
    element_kind: Mapped[str] = mapped_column(String(10), index=True)
    serial: Mapped[str] = mapped_column(String(50), index=True)
    coating: Mapped[str | None] = mapped_column(String(50))
    manufacturer: Mapped[str | None] = mapped_column(String(100))
    registered_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)


class WfCellRequest(Base):
    """An in-service element taken out of its cell: operation switches it off, the cell shop receives and decides.

    The dates written here are mirrored to Assembly Data (decommissioning date / reason) when they happen.
    """

    __tablename__ = "wf_cell_requests"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    code: Mapped[str] = mapped_column(String(40), unique=True, index=True)
    seq: Mapped[int] = mapped_column(Integer, unique=True, index=True)
    status: Mapped[str] = mapped_column(String(20), index=True)
    element_nr: Mapped[str] = mapped_column(String(50), index=True)
    element_id: Mapped[int | None] = mapped_column(Integer, index=True)  # Assembly Data row of the life being ended
    electrolyzer: Mapped[str | None] = mapped_column(String(50))
    position: Mapped[str | None] = mapped_column(String(20))
    reason: Mapped[str] = mapped_column(String(200))
    urgent: Mapped[bool] = mapped_column(default=False)
    problem: Mapped[str | None] = mapped_column(Text)
    planned_date: Mapped[date | None] = mapped_column(Date)
    decommission_date: Mapped[date | None] = mapped_column(Date, index=True)
    received_date: Mapped[date | None] = mapped_column(Date)
    decision: Mapped[str | None] = mapped_column(String(20))  # keep | disassemble | relocated
    last_note: Mapped[str | None] = mapped_column(Text)
    created_by_id: Mapped[int | None] = mapped_column(Integer)
    created_by_name: Mapped[str | None] = mapped_column(String(150))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now, index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now, index=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime)


class WfInspectionRequest(Base):
    """Element Inspection after dismantling: C-90 sends the request, inspection fills the form (one per element,
    it covers the element's anode and cathode). Saving a matching Element Inspection closes it."""

    __tablename__ = "wf_inspection_requests"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    code: Mapped[str] = mapped_column(String(40), unique=True, index=True)
    seq: Mapped[int] = mapped_column(Integer, unique=True, index=True)
    status: Mapped[str] = mapped_column(String(20), index=True)  # await_request | await_inspection | completed | cancelled
    element_nr: Mapped[str | None] = mapped_column(String(50), index=True)
    element_id: Mapped[int | None] = mapped_column(Integer, index=True)
    electrolyzer: Mapped[str | None] = mapped_column(String(50))
    position: Mapped[str | None] = mapped_column(String(20))
    anode_nr: Mapped[str | None] = mapped_column(String(50), index=True)
    cathode_nr: Mapped[str | None] = mapped_column(String(50), index=True)
    membrane_nr: Mapped[str | None] = mapped_column(String(50))
    disassembly_date: Mapped[date | None] = mapped_column(Date)
    reason: Mapped[str | None] = mapped_column(String(200))
    report_id: Mapped[int | None] = mapped_column(Integer, index=True)  # inspection_reports.id once filled
    last_note: Mapped[str | None] = mapped_column(Text)
    created_by_id: Mapped[int | None] = mapped_column(Integer)
    created_by_name: Mapped[str | None] = mapped_column(String(150))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now, index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now, index=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime)


class WfSettings(Base):
    """Single row: allowed time per workflow stage ({flow: {status: hours}}) and when a deadline turns yellow."""

    __tablename__ = "wf_settings"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    sla_hours: Mapped[dict] = mapped_column(JSON, default=dict)
    warn_percent: Mapped[int] = mapped_column(Integer, default=25)
    updated_by: Mapped[str | None] = mapped_column(String(150))
    updated_at: Mapped[datetime | None] = mapped_column(DateTime)


class WfFile(Base):
    __tablename__ = "wf_files"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    flow: Mapped[str] = mapped_column(String(10), index=True)  # coating | purchase
    record_id: Mapped[int] = mapped_column(Integer, index=True)
    package_id: Mapped[int | None] = mapped_column(Integer, index=True)
    kind: Mapped[str] = mapped_column(String(15), default="attachment")  # report | attachment
    original_name: Mapped[str] = mapped_column(String(255))
    stored_name: Mapped[str] = mapped_column(String(80))
    content_type: Mapped[str] = mapped_column(String(100))
    size_bytes: Mapped[int] = mapped_column(Integer, default=0)
    uploaded_by_name: Mapped[str | None] = mapped_column(String(150))
    uploaded_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now)


class WfEvent(Base):
    """Append-only step log of a workflow record (who moved it where, with which note)."""

    __tablename__ = "wf_events"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    flow: Mapped[str] = mapped_column(String(10), index=True)
    record_id: Mapped[int] = mapped_column(Integer, index=True)
    action: Mapped[str] = mapped_column(String(30))
    from_status: Mapped[str | None] = mapped_column(String(20))
    to_status: Mapped[str | None] = mapped_column(String(20))
    actor_id: Mapped[int | None] = mapped_column(Integer)
    actor_name: Mapped[str | None] = mapped_column(String(150))
    note: Mapped[str | None] = mapped_column(Text)
    data: Mapped[dict | None] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now, index=True)


class WfNotification(Base):
    __tablename__ = "wf_notifications"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), index=True)
    flow: Mapped[str] = mapped_column(String(10))
    record_id: Mapped[int] = mapped_column(Integer, index=True)
    status: Mapped[str | None] = mapped_column(String(20))
    title: Mapped[str | None] = mapped_column(String(200))
    from_name: Mapped[str | None] = mapped_column(String(150))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.now, index=True)
    read_at: Mapped[datetime | None] = mapped_column(DateTime, index=True)
