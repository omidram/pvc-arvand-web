"""Browse every archived Access table (the original 126 plant tables)."""
from typing import Any

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from pydantic import BaseModel
from sqlalchemy.orm import Session

from .. import models
from ..access_archive import (
    delete_archive_row,
    get_archive_table,
    insert_archive_row,
    list_archive_tables,
    query_archive_rows,
    update_archive_row,
)
from ..auth import LEVEL_RANK, get_current_user, user_permission_map
from ..database import get_db
from ..excel_import import parse_sheet, read_xlsx
from ..import_jobs import spawn_import
from ..export_utils import export_pdf, export_xlsx

router = APIRouter(prefix="/db-tables", tags=["database-tables"])


class NewArchiveRow(BaseModel):
    values: dict[str, Any] = {}


def _visible(user: models.User, form_key: str, perms: dict[str, str]) -> bool:
    if user.role == "admin":
        return True
    return LEVEL_RANK.get(perms.get(form_key, "none"), 0) >= LEVEL_RANK["view"]


def _require_table(slug: str, user: models.User, db: Session, *, write: bool = False) -> dict:
    meta = get_archive_table(slug)
    if meta is None:
        raise HTTPException(status_code=404, detail="Table not found")
    perms = user_permission_map(db, user)
    needed = "edit" if write else "view"
    if user.role != "admin" and LEVEL_RANK.get(perms.get(meta["form_key"], "none"), 0) < LEVEL_RANK[needed]:
        raise HTTPException(status_code=403, detail=f"You do not have {needed} access to this table")
    return meta


@router.get("")
def list_tables(user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    perms = user_permission_map(db, user)
    tables = [row for row in list_archive_tables() if _visible(user, row["form_key"], perms)]
    categories = sorted({row["category"] for row in tables})
    return {
        "total": len(tables),
        "categories": categories,
        "tables": tables,
        "available": len(tables) > 0,
    }


@router.get("/{slug}")
def get_table(slug: str, user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    return _require_table(slug, user, db)


@router.get("/{slug}/rows")
def list_rows(
    slug: str,
    q: str | None = Query(default=None),
    column: str | None = Query(default=None),
    value: str | None = Query(default=None),
    skip: int = 0,
    limit: int = Query(default=200, le=2000),
    user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_table(slug, user, db)
    try:
        meta, rows, total = query_archive_rows(slug, q=q, column=column, value=value, skip=skip, limit=limit)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Table not found") from exc
    return {"table": meta, "total": total, "skip": skip, "limit": limit, "rows": rows}


@router.post("/{slug}/rows")
def create_row(
    slug: str,
    payload: NewArchiveRow,
    user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_table(slug, user, db, write=True)
    try:
        row = insert_archive_row(slug, payload.values)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Table not found") from exc
    return {"ok": True, "row": row}


@router.put("/{slug}/rows/{row_id}")
def update_row(
    slug: str,
    row_id: int,
    payload: NewArchiveRow,
    user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_table(slug, user, db, write=True)
    try:
        row = update_archive_row(slug, row_id, payload.values)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Record not found") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"ok": True, "row": row}


@router.delete("/{slug}/rows/{row_id}")
def delete_row(
    slug: str,
    row_id: int,
    user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_table(slug, user, db, write=True)
    try:
        delete_archive_row(slug, row_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Record not found") from exc
    return {"ok": True}


@router.get("/{slug}/export.xlsx", include_in_schema=False)
def export_table_xlsx(
    slug: str,
    q: str | None = Query(default=None),
    column: str | None = Query(default=None),
    value: str | None = Query(default=None),
    user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    meta = _require_table(slug, user, db)
    _, rows, _ = query_archive_rows(slug, q=q, column=column, value=value, skip=0, limit=20000)
    fields = meta["columns"]
    return export_xlsx(rows, fields, meta["name"][:31] or slug)


@router.get("/{slug}/export.pdf", include_in_schema=False)
def export_table_pdf(
    slug: str,
    q: str | None = Query(default=None),
    column: str | None = Query(default=None),
    value: str | None = Query(default=None),
    user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    meta = _require_table(slug, user, db)
    _, rows, _ = query_archive_rows(slug, q=q, column=column, value=value, skip=0, limit=2000)
    fields = meta["columns"]
    return export_pdf(rows, fields, meta["name"][:80] or slug)


@router.post("/{slug}/import.xlsx", include_in_schema=False)
async def import_table_xlsx(
    slug: str,
    file: UploadFile = File(...),
    user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    meta = _require_table(slug, user, db, write=True)
    content = await read_xlsx(file)
    columns = [col for col in meta["columns"] if col not in {"_id", "_rowid"}]

    def work(_db: Session, progress):
        mapping, data_rows, arranged, ignored = parse_sheet(content, columns)
        created = 0
        total = len(data_rows)
        if progress:
            progress(0, total)
        for done, row in enumerate(data_rows, start=1):
            values = {}
            for index, field in mapping.items():
                if index >= len(row) or row[index] is None or row[index] == "":
                    continue
                values[field] = row[index]
            if values:
                insert_archive_row(slug, values)
                created += 1
            if progress and (done == total or done % 25 == 0):
                progress(done, total)
        if created == 0:
            raise HTTPException(status_code=400, detail="No rows were imported.")
        return {"ok": True, "created": created, "updated": 0, "skipped": 0, "arranged": arranged, "ignored": ignored}

    return spawn_import(work)
