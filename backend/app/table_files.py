"""Keep the Excel workbook last loaded into each program table.

Settings can list every table with its live record count and the exact byte
size of that workbook, delete the rows and the file, or replace both.
"""
from __future__ import annotations

import re
from datetime import datetime
from pathlib import Path
from typing import Any, Callable

from fastapi import HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session

from . import models
from .access_archive import META_TABLE, get_archive_table, insert_archive_row, list_archive_tables, quote_ident
from .database import engine
from .paths import data_root

ReplaceFn = Callable[[Session, bytes, Any], dict]

_TABLES: dict[str, dict[str, Any]] = {}


def register_table(
    *,
    key: str,
    label: str,
    model: type,
    section: str = "application",
    write_schema: type | None = None,
    pk_field: str = "id",
    prepare: Callable | None = None,
    replace: ReplaceFn | None = None,
) -> None:
    _TABLES[key] = {
        "key": key,
        "label": label,
        "section": section,
        "model": model,
        "write_schema": write_schema,
        "pk_field": pk_field,
        "prepare": prepare,
        "replace": replace,
    }


def _files_dir() -> Path:
    path = data_root() / "table_files"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _safe_key(key: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "_", key).strip("._")
    return cleaned[:120] or "table"


def _safe_filename(name: str | None) -> str:
    base = Path(name or "upload.xlsx").name
    base = re.sub(r"[^A-Za-z0-9._-]+", "_", base).strip("._") or "upload.xlsx"
    if not base.lower().endswith((".xlsx", ".xlsm")):
        base += ".xlsx"
    return base[:180]


def remember_workbook(
    db: Session,
    key: str,
    filename: str | None,
    content: bytes,
    record_count: int,
    uploaded_by: str | None,
) -> models.TableWorkbook:
    """Write the exact uploaded bytes and point this table at that file."""
    folder = _files_dir()
    stored = folder / f"{_safe_key(key)}__{_safe_filename(filename)}"
    existing = db.get(models.TableWorkbook, key)
    if existing and existing.stored_path:
        old = Path(existing.stored_path)
        if old.is_file() and old.resolve() != stored.resolve():
            old.unlink(missing_ok=True)
    stored.write_bytes(content)
    size = stored.stat().st_size
    now = datetime.utcnow()
    if existing is None:
        existing = models.TableWorkbook(key=key)
        db.add(existing)
    existing.original_name = Path(filename or stored.name).name
    existing.size_bytes = size
    existing.record_count = int(record_count)
    existing.stored_path = str(stored)
    existing.uploaded_at = now
    existing.uploaded_by = uploaded_by
    db.commit()
    return existing


def _count_model(db: Session, model: type) -> int:
    return int(db.query(model).count())


def _wipe_model(db: Session, model: type) -> None:
    try:
        db.query(model).delete(synchronize_session=False)
        db.commit()
    except Exception as exc:  # noqa: BLE001
        db.rollback()
        raise HTTPException(status_code=409, detail=f"Could not remove every row: {exc}") from exc


def _default_replace(spec: dict[str, Any], db: Session, content: bytes, progress: Any) -> dict:
    from .excel_import import import_excel_bytes

    if spec["write_schema"] is None:
        raise HTTPException(status_code=400, detail="This table has no Excel import.")
    return import_excel_bytes(
        db,
        spec["model"],
        spec["write_schema"],
        content,
        pk_field=spec["pk_field"],
        mode="replace",
        prepare=spec["prepare"],
        progress=progress,
    )


def _archive_count(meta: dict) -> int:
    table = quote_ident(meta["sqlite_table"])
    with engine.connect() as conn:
        return int(conn.execute(text(f"SELECT COUNT(*) FROM {table}")).scalar() or 0)


def _wipe_archive(slug: str, meta: dict) -> None:
    table = quote_ident(meta["sqlite_table"])
    with engine.begin() as conn:
        conn.execute(text(f"DELETE FROM {table}"))
        conn.execute(
            text(f"UPDATE {META_TABLE} SET row_count = 0 WHERE slug = :slug"),
            {"slug": slug},
        )


def _replace_archive(slug: str, meta: dict, content: bytes, progress: Any) -> dict:
    from .excel_import import parse_sheet

    columns = [col for col in meta["columns"] if col not in {"_id", "_rowid"}]
    mapping, data_rows, arranged, ignored = parse_sheet(content, columns)
    _wipe_archive(slug, meta)
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
    with engine.begin() as conn:
        conn.execute(
            text(f"UPDATE {META_TABLE} SET row_count = :n WHERE slug = :slug"),
            {"n": _archive_count(meta), "slug": slug},
        )
    return {"ok": True, "created": created, "updated": 0, "arranged": arranged, "ignored": ignored}


def _archive_spec(meta: dict) -> dict[str, Any]:
    slug = meta["slug"]
    return {
        "key": f"archive:{slug}",
        "label": meta["name"],
        "section": "archive",
        "model": None,
        "slug": slug,
        "meta": meta,
    }


def _resolve(key: str) -> dict[str, Any]:
    spec = _TABLES.get(key)
    if spec is not None:
        return spec
    if key.startswith("archive:"):
        meta = get_archive_table(key.split(":", 1)[1])
        if meta is not None:
            return _archive_spec(meta)
    raise HTTPException(status_code=404, detail="Table not found")


def _file_info(book: models.TableWorkbook | None) -> dict[str, Any]:
    if book is None:
        return {"file_name": None, "size_bytes": None, "uploaded_at": None, "uploaded_by": None, "has_file": False}
    path = Path(book.stored_path) if book.stored_path else None
    has = bool(path and path.is_file())
    size = path.stat().st_size if has else None
    return {
        "file_name": book.original_name if has else None,
        "size_bytes": size,
        "uploaded_at": book.uploaded_at.isoformat() + "Z" if book.uploaded_at and has else None,
        "uploaded_by": book.uploaded_by if has else None,
        "has_file": has,
    }


def list_tables(db: Session) -> list[dict[str, Any]]:
    books = {row.key: row for row in db.query(models.TableWorkbook).all()}
    rows: list[dict[str, Any]] = []
    for spec in _TABLES.values():
        info = _file_info(books.get(spec["key"]))
        rows.append(
            {
                "key": spec["key"],
                "label": spec["label"],
                "section": spec["section"],
                "records": _count_model(db, spec["model"]),
                **info,
            }
        )
    for meta in list_archive_tables():
        spec = _archive_spec(meta)
        info = _file_info(books.get(spec["key"]))
        try:
            records = _archive_count(meta)
        except Exception:
            records = int(meta.get("row_count") or 0)
        rows.append(
            {
                "key": spec["key"],
                "label": spec["label"],
                "section": "archive",
                "records": records,
                **info,
            }
        )
    rows.sort(key=lambda row: (row["section"], str(row["label"]).lower()))
    return rows


def delete_table_file(db: Session, key: str) -> dict[str, Any]:
    spec = _resolve(key)
    if spec.get("model") is not None:
        _wipe_model(db, spec["model"])
        records = 0
    else:
        _wipe_archive(spec["slug"], spec["meta"])
        records = 0
    book = db.get(models.TableWorkbook, key)
    if book is not None:
        path = Path(book.stored_path) if book.stored_path else None
        if path and path.is_file():
            root = _files_dir().resolve()
            try:
                resolved = path.resolve()
            except OSError:
                resolved = None
            if resolved and (resolved == root or root in resolved.parents):
                resolved.unlink(missing_ok=True)
        db.delete(book)
        db.commit()
    return {"ok": True, "records": records}


def replace_table_file(
    db: Session,
    key: str,
    filename: str | None,
    content: bytes,
    uploaded_by: str | None,
    progress: Any = None,
) -> dict[str, Any]:
    spec = _resolve(key)
    if spec.get("model") is not None:
        replace = spec["replace"] or (lambda db, content, progress: _default_replace(spec, db, content, progress))
        result = replace(db, content, progress)
        records = _count_model(db, spec["model"])
    else:
        result = _replace_archive(spec["slug"], spec["meta"], content, progress)
        records = _archive_count(spec["meta"])
    remember_workbook(db, key, filename, content, records, uploaded_by)
    result["records"] = records
    result["size_bytes"] = len(content)
    return result


def workbook_path(db: Session, key: str) -> tuple[Path, str]:
    _resolve(key)
    book = db.get(models.TableWorkbook, key)
    if book is None or not book.stored_path:
        raise HTTPException(status_code=404, detail="No Excel file is stored for this table.")
    path = Path(book.stored_path)
    root = _files_dir().resolve()
    try:
        resolved = path.resolve()
    except OSError as exc:
        raise HTTPException(status_code=404, detail="Stored file is missing.") from exc
    if root != resolved and root not in resolved.parents or not resolved.is_file():
        raise HTTPException(status_code=404, detail="Stored file is missing.")
    return resolved, book.original_name or resolved.name


def register_builtin() -> None:
    """Tables whose Excel import is not the generic CRUD router."""
    from . import schemas
    from .routers.elements import _prepare_cell, replace_elements_workbook

    register_table(
        key="elements",
        label="Assembly Data",
        model=models.Element,
        replace=replace_elements_workbook,
    )
    register_table(
        key="cell-components",
        label="Cell components",
        model=models.CellComponent,
        write_schema=schemas.CellComponentBase,
        prepare=_prepare_cell,
    )
    register_table(
        key="shutdowns",
        label="ShutDown List",
        model=models.Shutdown,
        write_schema=schemas.ShutdownBase,
        pk_field="nr",
    )
    register_table(
        key="analyses",
        label="Analyses",
        model=models.AnalysisSample,
        write_schema=schemas.AnalysisSampleBase,
    )
    register_table(
        key="electrode-segregations",
        label="Segregation",
        model=models.ElectrodeSegregation,
        write_schema=schemas.ElectrodeSegregationBase,
    )
