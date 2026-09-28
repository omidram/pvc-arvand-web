"""Named app roles with menu/section visibility matrix. Admin-only."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import models, schemas
from ..auth import FORM_KEYS, _set_role_permissions, require_admin, seed_default_roles
from ..database import get_db

router = APIRouter(prefix="/roles", tags=["roles"], dependencies=[Depends(require_admin)])


def _role_permissions_map(db: Session, role_id: int) -> dict[str, str]:
    levels = {key: "none" for key in FORM_KEYS}
    rows = db.query(models.RolePermission).filter(models.RolePermission.role_id == role_id).all()
    for row in rows:
        if row.form_key in levels:
            levels[row.form_key] = row.level
    return levels


def _to_read(db: Session, role: models.AppRole) -> schemas.AppRoleRead:
    user_count = db.query(models.User).filter(models.User.role_id == role.id).count()
    return schemas.AppRoleRead(
        id=role.id,
        name=role.name,
        description=role.description,
        is_system=role.is_system,
        created_at=role.created_at,
        permissions=_role_permissions_map(db, role.id),
        user_count=user_count,
    )


@router.get("", response_model=list[schemas.AppRoleRead])
@router.get("/", response_model=list[schemas.AppRoleRead], include_in_schema=False)
def list_roles(db: Session = Depends(get_db)):
    seed_default_roles(db)
    roles = db.query(models.AppRole).order_by(models.AppRole.name.asc()).all()
    return [_to_read(db, r) for r in roles]


@router.post("", response_model=schemas.AppRoleRead, status_code=201)
@router.post("/", response_model=schemas.AppRoleRead, status_code=201, include_in_schema=False)
def create_role(payload: schemas.AppRoleBase, db: Session = Depends(get_db)):
    name = (payload.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Role name is required")
    # Unicode / Persian names are fully supported (compare case-folded for Latin only).
    existing = db.query(models.AppRole).filter(models.AppRole.name == name).first()
    if existing:
        raise HTTPException(status_code=400, detail="Role name already exists")
    description = (payload.description or "").strip() or None
    role = models.AppRole(name=name, description=description, is_system=False)
    db.add(role)
    db.flush()
    _set_role_permissions(db, role, payload.permissions or {})
    db.commit()
    db.refresh(role)
    return _to_read(db, role)


@router.put("/{role_id}", response_model=schemas.AppRoleRead)
def update_role(role_id: int, payload: schemas.AppRoleUpdate, db: Session = Depends(get_db)):
    role = db.query(models.AppRole).filter(models.AppRole.id == role_id).first()
    if not role:
        raise HTTPException(status_code=404, detail="Role not found")
    if payload.name is not None:
        name = payload.name.strip()
        if not name:
            raise HTTPException(status_code=400, detail="Role name is required")
        clash = (
            db.query(models.AppRole)
            .filter(models.AppRole.name == name, models.AppRole.id != role_id)
            .first()
        )
        if clash:
            raise HTTPException(status_code=400, detail="Role name already exists")
        if role.is_system and name != role.name:
            raise HTTPException(status_code=400, detail="Cannot rename a system role")
        role.name = name
    if payload.description is not None:
        role.description = payload.description.strip() or None
    if payload.permissions is not None:
        _set_role_permissions(db, role, payload.permissions)
    db.commit()
    db.refresh(role)
    return _to_read(db, role)


@router.delete("/{role_id}")
def delete_role(role_id: int, db: Session = Depends(get_db)):
    role = db.query(models.AppRole).filter(models.AppRole.id == role_id).first()
    if not role:
        raise HTTPException(status_code=404, detail="Role not found")
    if role.is_system:
        raise HTTPException(status_code=400, detail="Cannot delete a system role")
    in_use = db.query(models.User).filter(models.User.role_id == role_id).count()
    if in_use:
        raise HTTPException(
            status_code=400,
            detail=f"Role is assigned to {in_use} user(s); reassign them first",
        )
    db.query(models.RolePermission).filter(models.RolePermission.role_id == role_id).delete()
    db.delete(role)
    db.commit()
    return {"ok": True}
