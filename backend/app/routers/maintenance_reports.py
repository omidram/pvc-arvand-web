"""Maintenance report history and PDF/image uploads for anodes, cathodes, and membranes."""
from __future__ import annotations

import uuid
from datetime import datetime
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from .. import models
from ..auth import WRITE_METHODS, LEVEL_RANK, effective_form_level, get_current_user
from ..database import get_db
from ..paths import data_root

router = APIRouter(prefix="/maintenance-reports", tags=["maintenance-reports"])

KIND_FORM = {"anode": "anodes", "cathode": "cathodes", "membrane": "membranes"}
MAX_BYTES = 25 * 1024 * 1024
MAX_FILES = 12

_SIGNATURES: dict[str, tuple[bytes, ...]] = {
    ".pdf": (b"%PDF",),
    ".png": (b"\x89PNG\r\n\x1a\n",),
    ".jpg": (b"\xff\xd8\xff",),
    ".jpeg": (b"\xff\xd8\xff",),
    ".gif": (b"GIF87a", b"GIF89a"),
    ".webp": (b"RIFF",),
    ".bmp": (b"BM",),
    ".tif": (b"II*\x00", b"MM\x00*"),
    ".tiff": (b"II*\x00", b"MM\x00*"),
}
_CONTENT_TYPES = {
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".bmp": "image/bmp",
    ".tif": "image/tiff",
    ".tiff": "image/tiff",
}


class ReportFileOut(BaseModel):
    id: int
    original_name: str
    content_type: str
    size_bytes: int


class ReportOut(BaseModel):
    id: int
    kind: str
    component_nr: str
    report_date: datetime | None
    title: str | None
    notes: str | None
    files: list[ReportFileOut]


class MaintenanceRowOut(BaseModel):
    id: int
    date: datetime | None = None
    finding: str | None = None
    action: str | None = None
    dispatch_date: datetime | None = None
    return_date: datetime | None = None
    repair_work: str | None = None


class HistoryOut(BaseModel):
    kind: str
    component_nr: str
    maintenance: list[MaintenanceRowOut]
    reports: list[ReportOut]


def _kind(value: str) -> str:
    kind = (value or "").strip().lower()
    if kind not in KIND_FORM:
        raise HTTPException(status_code=400, detail="kind must be anode, cathode, or membrane")
    return kind


def _nr(value: str) -> str:
    nr = (value or "").strip()
    if not nr or len(nr) > 50:
        raise HTTPException(status_code=400, detail="component number is required")
    return nr


def _guard(kind: str, request: Request, user: models.User, db: Session) -> None:
    if user.role == "admin":
        return
    required = "edit" if request.method in WRITE_METHODS else "view"
    level = effective_form_level(db, user, KIND_FORM[kind])
    if LEVEL_RANK.get(level, 0) < LEVEL_RANK[required]:
        raise HTTPException(
            status_code=403,
            detail=f"You do not have {required} access to this maintenance report",
        )


def _parse_date(value: str | None) -> datetime | None:
    text = (value or "").strip()
    if not text:
        return None
    try:
        day = datetime.fromisoformat(text[:10])
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="report date must be YYYY-MM-DD") from exc
    return datetime(day.year, day.month, day.day)


def _safe_original(name: str | None) -> str:
    base = Path(name or "report").name.replace("\x00", "").strip()
    base = re_sub(base) or "report"
    return base[:180]


def re_sub(name: str) -> str:
    cleaned = []
    for ch in name:
        if ch.isalnum() or ch in "._- ()":
            cleaned.append(ch)
        else:
            cleaned.append("_")
    return "".join(cleaned).strip("._ ") or "report"


def _classify(content: bytes, original: str) -> tuple[str, str]:
    ext = Path(original).suffix.lower()
    if ext not in _SIGNATURES:
        raise HTTPException(status_code=400, detail="Only PDF and image files can be uploaded")
    if len(content) > MAX_BYTES:
        raise HTTPException(status_code=400, detail="Each file must be 25 MB or smaller")
    if not content:
        raise HTTPException(status_code=400, detail="The file is empty")
    if not any(content.startswith(sig) for sig in _SIGNATURES[ext]):
        raise HTTPException(status_code=400, detail="The file contents do not match a PDF or image")
    if ext == ".webp" and content[8:12] != b"WEBP":
        raise HTTPException(status_code=400, detail="The file contents do not match a PDF or image")
    return ext, _CONTENT_TYPES[ext]


def _discard_folder(report_id: int) -> None:
    folder = data_root() / "maintenance_reports" / str(report_id)
    if not folder.exists():
        return
    for child in folder.iterdir():
        try:
            child.unlink()
        except OSError:
            pass
    try:
        folder.rmdir()
    except OSError:
        pass


def _dir(report_id: int) -> Path:
    path = data_root() / "maintenance_reports" / str(report_id)
    path.mkdir(parents=True, exist_ok=True)
    return path


def _stored_path(report_id: int, stored_name: str) -> Path:
    root = (data_root() / "maintenance_reports" / str(report_id)).resolve()
    path = (root / stored_name).resolve()
    if path.parent != root:
        raise HTTPException(status_code=400, detail="Invalid file")
    return path


def _save_uploads(db: Session, report: models.MaintenanceReport, uploads: list[UploadFile]) -> None:
    existing = (
        db.query(models.MaintenanceReportFile)
        .filter(models.MaintenanceReportFile.report_id == report.id)
        .count()
    )
    incoming = [item for item in uploads if item is not None and (item.filename or "").strip()]
    if existing + len(incoming) > MAX_FILES:
        raise HTTPException(status_code=400, detail=f"A report can hold at most {MAX_FILES} files")
    folder = _dir(report.id)
    now = datetime.utcnow()
    for item in incoming:
        original = _safe_original(item.filename)
        content = item.file.read()
        ext, content_type = _classify(content, original)
        stored = f"{uuid.uuid4().hex}{ext}"
        (folder / stored).write_bytes(content)
        db.add(
            models.MaintenanceReportFile(
                report_id=report.id,
                original_name=original,
                stored_name=stored,
                content_type=content_type,
                size_bytes=len(content),
                uploaded_at=now,
            )
        )


def _files_for(db: Session, report_ids: list[int]) -> dict[int, list[models.MaintenanceReportFile]]:
    if not report_ids:
        return {}
    rows = (
        db.query(models.MaintenanceReportFile)
        .filter(models.MaintenanceReportFile.report_id.in_(report_ids))
        .order_by(models.MaintenanceReportFile.id.asc())
        .all()
    )
    grouped: dict[int, list[models.MaintenanceReportFile]] = {}
    for row in rows:
        grouped.setdefault(row.report_id, []).append(row)
    return grouped


def _report_out(row: models.MaintenanceReport, files: list[models.MaintenanceReportFile]) -> ReportOut:
    return ReportOut(
        id=row.id,
        kind=row.kind,
        component_nr=row.component_nr,
        report_date=row.report_date,
        title=row.title,
        notes=row.notes,
        files=[
            ReportFileOut(
                id=item.id,
                original_name=item.original_name,
                content_type=item.content_type,
                size_bytes=item.size_bytes,
            )
            for item in files
        ],
    )


def _maintenance_rows(db: Session, kind: str, nr: str) -> list[MaintenanceRowOut]:
    needle = nr.lower()
    if kind == "anode":
        rows = (
            db.query(models.AnodeMaintenance)
            .filter(func.lower(models.AnodeMaintenance.anode_nr) == needle)
            .order_by(models.AnodeMaintenance.date.desc(), models.AnodeMaintenance.id.desc())
            .all()
        )
        return [
            MaintenanceRowOut(
                id=row.id,
                date=row.date,
                finding=row.finding,
                action=row.action,
                dispatch_date=row.dispatch_date,
                return_date=row.return_date,
            )
            for row in rows
        ]
    if kind == "cathode":
        rows = (
            db.query(models.CathodeMaintenance)
            .filter(func.lower(models.CathodeMaintenance.cathode_nr) == needle)
            .order_by(models.CathodeMaintenance.date.desc(), models.CathodeMaintenance.id.desc())
            .all()
        )
        return [
            MaintenanceRowOut(
                id=row.id,
                date=row.date,
                finding=row.finding,
                action=row.action,
                dispatch_date=row.dispatch_date,
                return_date=row.return_date,
            )
            for row in rows
        ]
    rows = (
        db.query(models.MembraneMaintenance)
        .filter(func.lower(models.MembraneMaintenance.membrane_nr) == needle)
        .order_by(models.MembraneMaintenance.date.desc(), models.MembraneMaintenance.id.desc())
        .all()
    )
    return [MaintenanceRowOut(id=row.id, date=row.date, repair_work=row.repair_work) for row in rows]


def _reports(db: Session, kind: str, nr: str) -> list[ReportOut]:
    rows = (
        db.query(models.MaintenanceReport)
        .filter(
            models.MaintenanceReport.kind == kind,
            func.lower(models.MaintenanceReport.component_nr) == nr.lower(),
        )
        .order_by(models.MaintenanceReport.report_date.desc(), models.MaintenanceReport.id.desc())
        .all()
    )
    grouped = _files_for(db, [row.id for row in rows])
    return [_report_out(row, grouped.get(row.id, [])) for row in rows]


def _load_report(db: Session, report_id: int) -> models.MaintenanceReport:
    row = db.query(models.MaintenanceReport).filter(models.MaintenanceReport.id == report_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Report not found")
    return row


@router.get("", response_model=HistoryOut)
def history(
    request: Request,
    kind: str = Query(...),
    nr: str = Query(...),
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
):
    kind = _kind(kind)
    nr = _nr(nr)
    _guard(kind, request, user, db)
    return HistoryOut(kind=kind, component_nr=nr, maintenance=_maintenance_rows(db, kind, nr), reports=_reports(db, kind, nr))


@router.post("", response_model=ReportOut, status_code=201)
async def create_report(
    request: Request,
    kind: str = Form(...),
    component_nr: str = Form(...),
    report_date: str | None = Form(default=None),
    title: str | None = Form(default=None),
    notes: str | None = Form(default=None),
    files: list[UploadFile] | None = File(default=None),
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
):
    kind = _kind(kind)
    nr = _nr(component_nr)
    _guard(kind, request, user, db)
    title_text = (title or "").strip() or None
    notes_text = (notes or "").strip() or None
    uploads = files or []
    has_file = any((item.filename or "").strip() for item in uploads)
    if not title_text and not notes_text and not has_file:
        raise HTTPException(status_code=400, detail="Add a title, notes, or a file")
    report = models.MaintenanceReport(
        kind=kind,
        component_nr=nr,
        report_date=_parse_date(report_date),
        title=title_text[:200] if title_text else None,
        notes=notes_text,
        created_at=datetime.utcnow(),
    )
    db.add(report)
    db.flush()
    try:
        _save_uploads(db, report, uploads)
        db.commit()
    except Exception:
        report_id = report.id
        db.rollback()
        _discard_folder(report_id)
        raise
    db.refresh(report)
    grouped = _files_for(db, [report.id])
    return _report_out(report, grouped.get(report.id, []))


@router.post("/{report_id}/files", response_model=ReportOut)
async def add_files(
    report_id: int,
    request: Request,
    files: list[UploadFile] = File(...),
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
):
    report = _load_report(db, report_id)
    _guard(report.kind, request, user, db)
    if not any((item.filename or "").strip() for item in files):
        raise HTTPException(status_code=400, detail="Choose a PDF or image")
    try:
        _save_uploads(db, report, files)
        db.commit()
    except Exception:
        db.rollback()
        raise
    grouped = _files_for(db, [report.id])
    return _report_out(report, grouped.get(report.id, []))


@router.get("/{report_id}/files/{file_id}")
def download_file(
    report_id: int,
    file_id: int,
    request: Request,
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
):
    report = _load_report(db, report_id)
    _guard(report.kind, request, user, db)
    item = (
        db.query(models.MaintenanceReportFile)
        .filter(
            models.MaintenanceReportFile.id == file_id,
            models.MaintenanceReportFile.report_id == report_id,
        )
        .first()
    )
    if not item:
        raise HTTPException(status_code=404, detail="File not found")
    path = _stored_path(report_id, item.stored_name)
    if not path.is_file():
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(path, media_type=item.content_type, filename=item.original_name, content_disposition_type="inline")


@router.delete("/{report_id}/files/{file_id}", status_code=204)
def delete_file(
    report_id: int,
    file_id: int,
    request: Request,
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
):
    report = _load_report(db, report_id)
    _guard(report.kind, request, user, db)
    item = (
        db.query(models.MaintenanceReportFile)
        .filter(
            models.MaintenanceReportFile.id == file_id,
            models.MaintenanceReportFile.report_id == report_id,
        )
        .first()
    )
    if not item:
        raise HTTPException(status_code=404, detail="File not found")
    path = _stored_path(report_id, item.stored_name)
    if path.is_file():
        path.unlink()
    db.delete(item)
    db.commit()
    return None


@router.delete("/{report_id}", status_code=204)
def delete_report(
    report_id: int,
    request: Request,
    db: Session = Depends(get_db),
    user: models.User = Depends(get_current_user),
):
    report = _load_report(db, report_id)
    _guard(report.kind, request, user, db)
    files = (
        db.query(models.MaintenanceReportFile)
        .filter(models.MaintenanceReportFile.report_id == report_id)
        .all()
    )
    for item in files:
        path = _stored_path(report_id, item.stored_name)
        if path.is_file():
            path.unlink()
        db.delete(item)
    folder = data_root() / "maintenance_reports" / str(report_id)
    db.delete(report)
    db.commit()
    if folder.exists():
        for child in folder.iterdir():
            child.unlink(missing_ok=True)
        folder.rmdir()
    return None
