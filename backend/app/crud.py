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
    after_save: Callable[[Session, Any], None] | None = None,
    on_rename: Callable[[Session, Any, Any], None] | None = None,
    unique_compact: bool = False,
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

    def _resolve(item_id: Any, db: Session):
        obj = db.query(model).filter(pk_column == item_id).first()
        if obj is not None or not unique_compact:
            return obj
        from sqlalchemy import func

        key = "".join(str(item_id or "").split()).upper()
        if not key:
            return None
        return db.query(model).filter(func.replace(func.upper(pk_column), " ", "") == key).first()

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

    @router.get("/by-key", response_model=read_schema)
    def get_by_key(item_id: str = Query(...), db: Session = Depends(get_db)):
        """Same as GET /{id}. Used when the key contains / or other path characters."""
        return get_item(item_id, db)

    @router.put("/by-key", response_model=read_schema)
    def update_by_key(payload: write_schema, item_id: str = Query(...), db: Session = Depends(get_db)):
        return update_item(item_id, payload, db)

    @router.delete("/by-key", status_code=204)
    def delete_by_key(item_id: str = Query(...), db: Session = Depends(get_db)):
        return delete_item(item_id, db)

    @router.get("/{item_id}", response_model=read_schema)
    def get_item(item_id: Any, db: Session = Depends(get_db)):
        obj = _resolve(item_id, db)
        if not obj:
            raise HTTPException(status_code=404, detail="Not found")
        return _read(obj)

    @router.post("", response_model=read_schema, status_code=201)
    def create_item(payload: write_schema, db: Session = Depends(get_db)):
        data = payload.model_dump()
        _check_required(data)
        if unique_compact:
            # "UA 123" and "ua123" are the same part: never create it twice.
            from sqlalchemy import func

            key = "".join(str(data.get(pk_field) or "").split()).upper()
            clash = (
                db.query(model).filter(func.replace(func.upper(pk_column), " ", "") == key).first() if key else None
            )
            if clash is not None:
                raise HTTPException(
                    status_code=409, detail=f"'{getattr(clash, pk_field)}' already exists ({pk_field})."
                )
        obj = model(**data)
        if prepare:
            prepare(obj)
        db.add(obj)
        if after_save:
            after_save(db, obj)  # keeps related tables in step before the commit
        db.commit()
        db.refresh(obj)
        return _read(obj)

    @router.put("/{item_id}", response_model=read_schema)
    def update_item(item_id: Any, payload: write_schema, db: Session = Depends(get_db)):
        obj = _resolve(item_id, db)
        if not obj:
            raise HTTPException(status_code=404, detail="Not found")
        data = payload.model_dump(exclude_unset=True)
        _check_required(data, obj)
        old_pk = getattr(obj, pk_field)
        new_pk = None
        if pk_field in data:
            candidate = data.get(pk_field)
            if candidate not in (None, "") and str(candidate) != str(old_pk):
                if unique_compact:
                    from sqlalchemy import func

                    key = "".join(str(candidate).split()).upper()
                    clash = (
                        db.query(model)
                        .filter(func.replace(func.upper(pk_column), " ", "") == key)
                        .first()
                        if key
                        else None
                    )
                else:
                    clash = db.query(model).filter(pk_column == candidate).first()
                if clash is not None and getattr(clash, pk_field) != old_pk:
                    raise HTTPException(
                        status_code=409,
                        detail=f"'{getattr(clash, pk_field)}' already exists ({pk_field}).",
                    )
                new_pk = candidate
        for key, value in data.items():
            if key == pk_field:
                continue
            setattr(obj, key, value)
        if prepare:
            prepare(obj)
        if after_save:
            after_save(db, obj)
        if new_pk is not None and on_rename:
            on_rename(db, old_pk, new_pk)
        db.flush()
        if new_pk is not None:
            # Assigning a primary key on the instance often does not emit UPDATE.
            db.query(model).filter(pk_column == old_pk).update({pk_column: new_pk}, synchronize_session=False)
        db.commit()
        db.expire_all()
        saved = db.query(model).filter(pk_column == (new_pk if new_pk is not None else old_pk)).first()
        if saved is None:
            raise HTTPException(status_code=500, detail="Save failed")
        return _read(saved)

    @router.delete("/{item_id}", status_code=204)
    def delete_item(item_id: Any, db: Session = Depends(get_db)):
        obj = _resolve(item_id, db)
        if not obj:
            raise HTTPException(status_code=404, detail="Not found")
        db.delete(obj)
        db.commit()
        return None

    return router
