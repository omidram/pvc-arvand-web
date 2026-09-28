"""
Authentication (JWT) and per-user, per-form access control.

Every "form" in the frontend (one per sidebar nav item, plus a couple of
admin-only management screens) maps to a `form_key` here. A user's access
to a form is either "none" (hidden), "view" (read-only) or "edit" (full
CRUD). Admin users always have full "edit" access everywhere and are the
only ones who can manage users/permissions, regardless of any explicit
FormPermission rows.
"""
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from . import models
from .config import settings
from .database import get_db

# Canonical list of assignable forms, in the same order as the sidebar nav.
# (Kept in sync with frontend/src/lib/i18n/translations.ts `nav` keys.)
FORM_KEYS: list[str] = [
    "dashboard",
    "statistics",
    "reports",
    "monitoring",
    "elements",
    "inspections",
    "anodes",
    "cathodes",
    "membranes",
    "storage",
    "shutdowns",
    "voltage",
    "analyses",
    "search",
    "remarks",
    "settings",
    "import_export",
]

LEVEL_RANK = {"none": 0, "view": 1, "edit": 2}
WRITE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}

bearer_scheme = HTTPBearer(auto_error=False)


# --------------------------------------------------------------------------
# Passwords
# --------------------------------------------------------------------------

def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))
    except ValueError:
        return False


# --------------------------------------------------------------------------
# JWT
# --------------------------------------------------------------------------

def create_access_token(user: models.User) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.JWT_EXPIRE_MINUTES)
    payload = {"sub": str(user.id), "username": user.username, "role": user.role, "exp": expire}
    return jwt.encode(payload, settings.JWT_SECRET_KEY, algorithm=settings.JWT_ALGORITHM)


def decode_access_token(token: str) -> dict:
    try:
        return jwt.decode(token, settings.JWT_SECRET_KEY, algorithms=[settings.JWT_ALGORITHM])
    except jwt.PyJWTError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token")


# --------------------------------------------------------------------------
# Current user dependency
# --------------------------------------------------------------------------

def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> models.User:
    if credentials is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    payload = decode_access_token(credentials.credentials)
    user = db.query(models.User).filter(models.User.id == int(payload["sub"])).first()
    if not user or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found or inactive")
    return user


def require_admin(user: models.User = Depends(get_current_user)) -> models.User:
    if user.role != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Administrator access required")
    return user


def user_permission_map(db: Session, user: models.User) -> dict[str, str]:
    """Resolve effective menu access. 'none' means the section is completely hidden."""
    if user.role == "admin":
        return {key: "edit" for key in FORM_KEYS}

    levels = {key: "none" for key in FORM_KEYS}

    if user.role_id:
        rows = (
            db.query(models.RolePermission)
            .filter(models.RolePermission.role_id == user.role_id)
            .all()
        )
        for row in rows:
            if row.form_key in levels and row.level in LEVEL_RANK:
                levels[row.form_key] = row.level
        return levels

    rows = db.query(models.FormPermission).filter(models.FormPermission.user_id == user.id).all()
    for row in rows:
        if row.form_key in levels and row.level in LEVEL_RANK:
            levels[row.form_key] = row.level
    return levels


def effective_form_level(db: Session, user: models.User, form_key: str) -> str:
    return user_permission_map(db, user).get(form_key, "none")


def require_form_access(form_key: str):
    """Dependency factory: GET/HEAD need 'view', mutating methods need 'edit'."""

    def _dependency(
        request: Request,
        user: models.User = Depends(get_current_user),
        db: Session = Depends(get_db),
    ) -> models.User:
        if user.role == "admin":
            return user
        required = "edit" if request.method in WRITE_METHODS else "view"
        level = effective_form_level(db, user, form_key)
        if LEVEL_RANK.get(level, 0) < LEVEL_RANK[required]:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"You do not have {required} access to '{form_key}'",
            )
        return user

    return _dependency


def require_any_form_access(*form_keys: str):
    """Allow if the user has the required level on ANY of the listed form keys."""

    def _dependency(
        request: Request,
        user: models.User = Depends(get_current_user),
        db: Session = Depends(get_db),
    ) -> models.User:
        if user.role == "admin":
            return user
        required = "edit" if request.method in WRITE_METHODS else "view"
        for form_key in form_keys:
            level = effective_form_level(db, user, form_key)
            if LEVEL_RANK.get(level, 0) >= LEVEL_RANK[required]:
                return user
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"You do not have {required} access to any of {list(form_keys)}",
        )

    return _dependency


DEFAULT_ROLES: list[dict] = [
    {
        "name": "Operator",
        "description": "Standard plant operator — most forms viewable, voltage editable",
        "is_system": True,
        "permissions": {
            "dashboard": "view",
            "statistics": "view",
            "reports": "view",
            "monitoring": "view",
            "elements": "view",
            "inspections": "view",
            "anodes": "view",
            "cathodes": "view",
            "membranes": "view",
            "storage": "view",
            "shutdowns": "view",
            "voltage": "edit",
            "analyses": "view",
            "search": "view",
            "remarks": "edit",
            "settings": "none",
            "import_export": "none",
        },
    },
    {
        "name": "Inspector",
        "description": "بازرس — فقط بخش ولتاژ فعال است؛ بقیه منوها مخفی",
        "is_system": True,
        "permissions": {
            "dashboard": "none",
            "statistics": "none",
            "reports": "none",
            "monitoring": "view",
            "elements": "none",
            "inspections": "none",
            "anodes": "none",
            "cathodes": "none",
            "membranes": "none",
            "storage": "none",
            "shutdowns": "none",
            "voltage": "edit",
            "analyses": "none",
            "search": "none",
            "remarks": "none",
            "settings": "none",
            "import_export": "none",
        },
    },
    {
        "name": "Viewer",
        "description": "Read-only access to overview and reports",
        "is_system": True,
        "permissions": {
            "dashboard": "view",
            "statistics": "view",
            "reports": "view",
            "monitoring": "view",
            "elements": "view",
            "inspections": "view",
            "anodes": "view",
            "cathodes": "view",
            "membranes": "view",
            "storage": "view",
            "shutdowns": "view",
            "voltage": "view",
            "analyses": "view",
            "search": "view",
            "remarks": "view",
            "settings": "none",
            "import_export": "none",
        },
    },
]


def _set_role_permissions(db: Session, role: models.AppRole, permissions: dict[str, str]) -> None:
    db.query(models.RolePermission).filter(models.RolePermission.role_id == role.id).delete()
    for form_key, level in permissions.items():
        if form_key not in FORM_KEYS or level not in ("none", "view", "edit"):
            continue
        if level == "none":
            continue
        db.add(models.RolePermission(role_id=role.id, form_key=form_key, level=level))


def seed_default_roles(db: Session) -> None:
    for spec in DEFAULT_ROLES:
        existing = db.query(models.AppRole).filter(models.AppRole.name == spec["name"]).first()
        if existing:
            continue
        role = models.AppRole(
            name=spec["name"],
            description=spec.get("description"),
            is_system=bool(spec.get("is_system")),
        )
        db.add(role)
        db.flush()
        _set_role_permissions(db, role, spec.get("permissions") or {})
    db.commit()


def seed_default_admin(db: Session) -> None:
    seed_default_roles(db)
    if db.query(models.User).count() > 0:
        return
    admin = models.User(
        username=settings.DEFAULT_ADMIN_USERNAME,
        full_name="Administrator",
        password_hash=hash_password(settings.DEFAULT_ADMIN_PASSWORD),
        role="admin",
        is_active=True,
    )
    db.add(admin)
    db.commit()
    print(
        f"[auth] Created default admin user '{settings.DEFAULT_ADMIN_USERNAME}' "
        f"with password '{settings.DEFAULT_ADMIN_PASSWORD}' - please change it after first login."
    )
