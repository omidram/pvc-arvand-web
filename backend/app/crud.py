"""Generic CRUD router factory used for straightforward lookup/entity tables."""
from typing import Any, Type

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from .database import get_db
from .export_utils import export_pdf, export_xlsx, rows_to_dicts


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
) -> APIRouter:
    router = APIRouter(prefix=prefix, tags=tags)
    search_fields = search_fields or []
    pk_column = getattr(model, pk_field)
    export_fields = list(read_schema.model_fields.keys())

    def _query_list(q: str | None, skip: int, limit: int, db: Session):
        query = db.query(model)
        if q and search_fields:
            from sqlalchemy import or_

            like = f"%{q}%"
            conditions = [getattr(model, f).ilike(like) for f in search_fields]
            query = query.filter(or_(*conditions))
        if default_order and hasattr(model, default_order):
            query = query.order_by(getattr(model, default_order).desc())
        return query.offset(skip).limit(limit).all()

    @router.get("", response_model=list[read_schema])
    def list_items(
        q: str | None = Query(default=None, description="Free-text search"),
        skip: int = 0,
        limit: int = Query(default=500, le=5000),
        db: Session = Depends(get_db),
    ):
        return _query_list(q, skip, limit, db)

    @router.get("/export.xlsx", include_in_schema=False)
    def export_items_xlsx(
        q: str | None = Query(default=None),
        skip: int = 0,
        limit: int = Query(default=20000, le=100000),
        db: Session = Depends(get_db),
    ):
        items = _query_list(q, skip, limit, db)
        rows = rows_to_dicts(items, export_fields)
        return export_xlsx(rows, export_fields, prefix.strip("/"))

    @router.get("/export.pdf", include_in_schema=False)
    def export_items_pdf(
        q: str | None = Query(default=None),
        skip: int = 0,
        limit: int = Query(default=2000, le=20000),
        db: Session = Depends(get_db),
    ):
        items = _query_list(q, skip, limit, db)
        rows = rows_to_dicts(items, export_fields)
        return export_pdf(rows, export_fields, prefix.strip("/"))

    @router.get("/{item_id}", response_model=read_schema)
    def get_item(item_id: Any, db: Session = Depends(get_db)):
        obj = db.query(model).filter(pk_column == item_id).first()
        if not obj:
            raise HTTPException(status_code=404, detail="Not found")
        return obj

    @router.post("", response_model=read_schema, status_code=201)
    def create_item(payload: write_schema, db: Session = Depends(get_db)):
        data = payload.model_dump()
        obj = model(**data)
        db.add(obj)
        db.commit()
        db.refresh(obj)
        return obj

    @router.put("/{item_id}", response_model=read_schema)
    def update_item(item_id: Any, payload: write_schema, db: Session = Depends(get_db)):
        obj = db.query(model).filter(pk_column == item_id).first()
        if not obj:
            raise HTTPException(status_code=404, detail="Not found")
        for key, value in payload.model_dump(exclude_unset=True).items():
            if key == pk_field:
                continue
            setattr(obj, key, value)
        db.commit()
        db.refresh(obj)
        return obj

    @router.delete("/{item_id}", status_code=204)
    def delete_item(item_id: Any, db: Session = Depends(get_db)):
        obj = db.query(model).filter(pk_column == item_id).first()
        if not obj:
            raise HTTPException(status_code=404, detail="Not found")
        db.delete(obj)
        db.commit()
        return None

    return router
