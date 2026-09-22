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
    "elements",
    "inspections",
    "anodes",
    "cathodes",
    "membranes",
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
    if user.role == "admin":
        return {key: "edit" for key in FORM_KEYS}
    rows = db.query(models.FormPermission).filter(models.FormPermission.user_id == user.id).all()
    levels = {row.form_key: row.level for row in rows}
    return {key: levels.get(key, "none") for key in FORM_KEYS}


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
        row = (
            db.query(models.FormPermission)
            .filter(models.FormPermission.user_id == user.id, models.FormPermission.form_key == form_key)
            .first()
        )
        level = row.level if row else "none"
        if LEVEL_RANK.get(level, 0) < LEVEL_RANK[required]:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"You do not have {required} access to '{form_key}'",
            )
        return user

    return _dependency


def seed_default_admin(db: Session) -> None:
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
