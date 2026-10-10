"""Generic CRUD router factory used for straightforward lookup/entity tables."""
from collections.abc import Callable
from typing import Any, Type

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from pydantic import BaseModel
from sqlalchemy.orm import Session

from .auth import require_admin
from .database import get_db
from .excel_import import import_excel_bytes, read_xlsx
from .import_jobs import spawn_import
from .export_utils import ExportFilters, build_export_meta, export_pdf, export_xlsx, rows_to_dicts


def build_crud_router(
    *,
    model: Type,
    read_schema: Type[BaseModel],
    write_schema: Type[BaseModel],
    prefix: str,
    tags: list[str],
    pk_field: str = "id",
    search_fields: list[str] | None = None,
    default_order: str | None = None,
    prepare: Callable[[Any], None] | None = None,
    transform: Callable[[Any], None] | None = None,
    required_fields: list[str] | None = None,
    sort_key: Callable[[Any], Any] | None = None,
) -> APIRouter:
    router = APIRouter(prefix=prefix, tags=tags)
    search_fields = search_fields or []
    pk_column = getattr(model, pk_field)
    export_fields = list(read_schema.model_fields.keys())

    def _read(obj: Any):
        item = read_schema.model_validate(obj)
        if transform:
            transform(item)
        return item

    def _query_list(q: str | None, skip: int, limit: int, db: Session):
        query = db.query(model)
        if q and search_fields:
            from sqlalchemy import or_

            like = f"%{q}%"
            conditions = [getattr(model, f).ilike(like) for f in search_fields]
            query = query.filter(or_(*conditions))
        if default_order and hasattr(model, default_order):
            query = query.order_by(getattr(model, default_order).desc())
        if sort_key is not None:
            return sorted(query.all(), key=sort_key)[skip : skip + limit]
        return query.offset(skip).limit(limit).all()

    def _blank(value: Any) -> bool:
        return value is None or (isinstance(value, str) and not value.strip())

    def _check_required(data: dict[str, Any], existing: Any = None) -> None:
        """New records need every required field; saved records may not lose a value they already have."""
        if not required_fields:
            return
        missing = []
        for name in required_fields:
            if existing is None:
                if _blank(data.get(name)):
                    missing.append(name)
            elif name in data and _blank(data[name]) and not _blank(getattr(existing, name, None)):
                missing.append(name)
        if missing:
            raise HTTPException(status_code=422, detail="Required field(s) missing: " + ", ".join(missing))

    @router.get("", response_model=list[read_schema])
    def list_items(
        q: str | None = Query(default=None, description="Free-text search"),
        skip: int = 0,
        limit: int = Query(default=500, le=20000),
        db: Session = Depends(get_db),
    ):
        rows = _query_list(q, skip, limit, db)
        return [_read(obj) for obj in rows]

    @router.get("/export.meta", include_in_schema=False)
    def export_items_meta():
        return build_export_meta(export_fields)

    @router.get("/export.xlsx", include_in_schema=False)
    def export_items_xlsx(
        q: str | None = Query(default=None),
        skip: int = 0,
        limit: int = Query(default=20000, le=100000),
        filters: ExportFilters = Depends(),
        db: Session = Depends(get_db),
    ):
        items = _query_list(q, skip, limit, db)
        rows = rows_to_dicts([_read(obj) for obj in items], export_fields)
        rows, fields = filters.apply(rows, export_fields)
        return export_xlsx(rows, fields, prefix.strip("/"))

    @router.get("/export.pdf", include_in_schema=False)
    def export_items_pdf(
        q: str | None = Query(default=None),
        skip: int = 0,
        limit: int = Query(default=2000, le=20000),
        filters: ExportFilters = Depends(),
        db: Session = Depends(get_db),
    ):
        items = _query_list(q, skip, limit, db)
        rows = rows_to_dicts([_read(obj) for obj in items], export_fields)
        rows, fields = filters.apply(rows, export_fields)
        return export_pdf(rows, fields, prefix.strip("/"))

    @router.post("/import.xlsx", include_in_schema=False)
    async def import_items(_admin=Depends(require_admin), file: UploadFile = File(...)):
        content = await read_xlsx(file)

        def work(db: Session, progress):
            return import_excel_bytes(
                db, model, write_schema, content, pk_field=pk_field, progress=progress
            )

        return spawn_import(work)

    @router.get("/{item_id}", response_model=read_schema)
    def get_item(item_id: Any, db: Session = Depends(get_db)):
        obj = db.query(model).filter(pk_column == item_id).first()
        if not obj:
            raise HTTPException(status_code=404, detail="Not found")
        return _read(obj)

    @router.post("", response_model=read_schema, status_code=201)
    def create_item(payload: write_schema, db: Session = Depends(get_db)):
        data = payload.model_dump()
        _check_required(data)
        obj = model(**data)
        if prepare:
            prepare(obj)
        db.add(obj)
        db.commit()
        db.refresh(obj)
        return _read(obj)

    @router.put("/{item_id}", response_model=read_schema)
    def update_item(item_id: Any, payload: write_schema, db: Session = Depends(get_db)):
        obj = db.query(model).filter(pk_column == item_id).first()
        if not obj:
            raise HTTPException(status_code=404, detail="Not found")
        _check_required(payload.model_dump(exclude_unset=True), obj)
        for key, value in payload.model_dump(exclude_unset=True).items():
            if key == pk_field:
                continue
            setattr(obj, key, value)
        if prepare:
            prepare(obj)
        db.commit()
        db.refresh(obj)
        return _read(obj)

    @router.delete("/{item_id}", status_code=204)
    def delete_item(item_id: Any, db: Session = Depends(get_db)):
        obj = db.query(model).filter(pk_column == item_id).first()
        if not obj:
            raise HTTPException(status_code=404, detail="Not found")
        db.delete(obj)
        db.commit()
        return None

    return router
