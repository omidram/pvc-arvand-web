"""User & per-form permission management. Admin-only."""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from .. import models, schemas
from ..auth import FORM_KEYS, hash_password, require_admin, user_permission_map
from ..database import get_db

router = APIRouter(prefix="/users", tags=["users"], dependencies=[Depends(require_admin)])


def _with_permissions(db: Session, user: models.User) -> schemas.UserWithPermissions:
    return schemas.UserWithPermissions(
        id=user.id,
        username=user.username,
        full_name=user.full_name,
        role=user.role,
        is_active=user.is_active,
        created_at=user.created_at,
        permissions=user_permission_map(db, user),
    )


def _set_permissions(db: Session, user: models.User, permissions: dict[str, str]) -> None:
    db.query(models.FormPermission).filter(models.FormPermission.user_id == user.id).delete()
    for form_key, level in permissions.items():
        if form_key not in FORM_KEYS or level not in ("none", "view", "edit"):
            continue
        if level == "none":
            continue
        db.add(models.FormPermission(user_id=user.id, form_key=form_key, level=level))


@router.get("/form-keys")
def list_form_keys():
    return FORM_KEYS


@router.get("", response_model=list[schemas.UserWithPermissions])
def list_users(db: Session = Depends(get_db)):
    return [_with_permissions(db, u) for u in db.query(models.User).order_by(models.User.id).all()]


@router.post("", response_model=schemas.UserWithPermissions, status_code=201)
def create_user(payload: schemas.UserCreate, db: Session = Depends(get_db)):
    if db.query(models.User).filter(models.User.username == payload.username).first():
        raise HTTPException(status_code=400, detail="Username already exists")
    user = models.User(
        username=payload.username,
        full_name=payload.full_name,
        password_hash=hash_password(payload.password),
        role=payload.role,
        is_active=payload.is_active,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    if payload.permissions:
        _set_permissions(db, user, payload.permissions)
        db.commit()
    return _with_permissions(db, user)


@router.put("/{user_id}", response_model=schemas.UserWithPermissions)
def update_user(user_id: int, payload: schemas.UserUpdate, db: Session = Depends(get_db)):
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Not found")
    if payload.full_name is not None:
        user.full_name = payload.full_name
    if payload.role is not None:
        user.role = payload.role
    if payload.is_active is not None:
        user.is_active = payload.is_active
    if payload.password:
        user.password_hash = hash_password(payload.password)
    db.commit()
    if payload.permissions is not None:
        _set_permissions(db, user, payload.permissions)
        db.commit()
    db.refresh(user)
    return _with_permissions(db, user)


@router.delete("/{user_id}", status_code=204)
def delete_user(user_id: int, admin: models.User = Depends(require_admin), db: Session = Depends(get_db)):
    if user_id == admin.id:
        raise HTTPException(status_code=400, detail="You cannot delete your own account")
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Not found")
    db.query(models.FormPermission).filter(models.FormPermission.user_id == user_id).delete()
    db.delete(user)
    db.commit()
    return None
