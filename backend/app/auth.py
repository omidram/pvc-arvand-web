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
    "activity",
    # Warehouse workflow groups ("edit" = member of the group, gets its cartable + notifications)
    "wf_c90",
    "wf_procurement",
    "wf_warehouse",
    "wf_inspection",
    # Cell removal: operation switches the cell off, the cell shop receives it and decides
    "wf_operation",
    "wf_cellshop",
    "wf_process",
]

# Per-form table fields that can be granted view/edit independently of the
# form-level access. Stored as RolePermission/FormPermission keys "form.field".
FORM_FIELDS: dict[str, list[str]] = {
    "shutdowns": [
        "plant_part",
        "shutdown_time",
        "startup_time",
        "code",
        "cause",
        "category",
        "ka_before_trip",
        "lost_load",
        "lost_production",
        "mtbf_days",
        "remarks",
    ],
    "elements": [
        "element_nr",
        "electrolyzer",
        "position",
        "anode_nr",
        "cathode_nr",
        "membrane_nr",
        "membrane_type",
        "group_nr",
        "assembly_date",
        "commissioning_date",
        "decommissioning_date",
        "disassembly_date",
        "anode_remark",
        "cathode_remark",
        "membrane_remark",
        "remarks",
    ],
    "anodes": ["anode_nr", "coating", "manufacturer", "delivery_date", "remarks"],
    "cathodes": ["cathode_nr", "coating", "manufacturer", "delivery_date", "remarks"],
    "membranes": ["membrane_nr", "membrane_type", "manufacturer", "delivery_date", "remarks"],
    "inspections": [
        "element_nr",
        "electrolyzer",
        "date",
        "findings",
        "remarks",
        "signature_insp",
        "signature_maint",
        "signature_proc",
    ],
    "voltage": [
        "electrolyzer",
        "date",
        "total_current",
        "total_voltage",
        "reference_current_density",
        "standardized_voltage",
        "remarks",
    ],
    "analyses": ["analysis_type", "electrolyzer", "date", "parameters", "remarks"],
    "remarks": ["date", "electrolyzer", "text"],
    "storage": ["item_nr", "kind", "location", "quantity", "remarks"],
}

LEVEL_RANK = {"none": 0, "view": 1, "edit": 2}
WRITE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}


def is_valid_permission_key(key: str) -> bool:
    if key in FORM_KEYS:
        return True
    if "." not in key:
        return False
    form_key, field = key.split(".", 1)
    return form_key in FORM_FIELDS and field in FORM_FIELDS[form_key]


def field_permission_key(form_key: str, field: str) -> str:
    return f"{form_key}.{field}"


def resolve_field_level(permissions: dict[str, str], form_key: str, field: str) -> str:
    """Effective field access capped by the parent form level."""
    form_level = permissions.get(form_key, "none")
    if form_level == "none":
        return "none"
    specific = permissions.get(field_permission_key(form_key, field))
    if specific not in LEVEL_RANK:
        return form_level
    if LEVEL_RANK[specific] <= LEVEL_RANK[form_level]:
        return specific
    return form_level

# Inspection sheet is signed by Insp. / Maint. / Proc., so any of these
# plant forms is enough to open and edit the shared CZ-03 report.
INSPECTION_COLLAB_KEYS = ("inspections", "anodes", "cathodes", "membranes", "elements")

bearer_scheme = HTTPBearer(auto_error=False)


# --------------------------------------------------------------------------
# Passwords
# --------------------------------------------------------------------------

_PASSWORD_MIN_LEN = 8
_COMMON_PASSWORDS = {
    "password",
    "password1",
    "password123",
    "admin",
    "admin123",
    "admin1234",
    "12345678",
    "123456789",
    "qwerty123",
    "letmein",
    "welcome1",
    "changeme",
}


def validate_password_strength(password: str, *, username: str | None = None) -> str | None:
    """Return an error message if the password fails policy, else None."""
    value = password or ""
    if len(value) < _PASSWORD_MIN_LEN:
        return f"Password must be at least {_PASSWORD_MIN_LEN} characters."
    if not any(ch.isupper() for ch in value):
        return "Password must include at least one uppercase letter."
    if not any(ch.islower() for ch in value):
        return "Password must include at least one lowercase letter."
    if not any(ch.isdigit() for ch in value):
        return "Password must include at least one digit."
    if not any(not ch.isalnum() for ch in value):
        return "Password must include at least one special character."
    if username and value.lower() == username.strip().lower():
        return "Password must not be the same as the username."
    if value.lower() in _COMMON_PASSWORDS:
        return "Password is too common. Choose a stronger password."
    return None


def require_password_strength(password: str, *, username: str | None = None) -> None:
    message = validate_password_strength(password, username=username)
    if message:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=message)


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
    """Resolve effective menu + field access. Form 'none' hides the section."""
    if user.role == "admin":
        levels = {key: "edit" for key in FORM_KEYS}
        for form_key, fields in FORM_FIELDS.items():
            for field in fields:
                levels[field_permission_key(form_key, field)] = "edit"
        return levels

    levels = {key: "none" for key in FORM_KEYS}

    if user.role_id:
        rows = (
            db.query(models.RolePermission)
            .filter(models.RolePermission.role_id == user.role_id)
            .all()
        )
    else:
        rows = db.query(models.FormPermission).filter(models.FormPermission.user_id == user.id).all()

    for row in rows:
        if row.level not in LEVEL_RANK:
            continue
        if row.form_key in FORM_KEYS or is_valid_permission_key(row.form_key):
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


# Supervisor and expert of the same unit share one permission set until the plant splits them.
_PROCESS_ACCESS = {
    "dashboard": "view",
    "statistics": "view",
    "reports": "view",
    "monitoring": "view",
    "elements": "view",
    "inspections": "view",
    "analyses": "edit",
    "voltage": "view",
    "search": "view",
    "wf_process": "edit",
}
_C90_ACCESS = {
    "dashboard": "view",
    "elements": "view",
    "anodes": "view",
    "cathodes": "view",
    "membranes": "view",
    "inspections": "view",
    "storage": "view",
    "wf_c90": "edit",
    "wf_cellshop": "edit",
}
_PROCUREMENT_ACCESS = {
    "dashboard": "view",
    "anodes": "view",
    "cathodes": "view",
    "storage": "view",
    "wf_procurement": "edit",
}
_WAREHOUSE_ACCESS = {
    "dashboard": "view",
    "anodes": "view",
    "cathodes": "view",
    "storage": "edit",
    "wf_warehouse": "edit",
}
_PLANT_VIEW = {
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
    "wf_c90": "view",
    "wf_procurement": "view",
    "wf_warehouse": "view",
    "wf_inspection": "view",
    "wf_operation": "view",
    "wf_cellshop": "view",
    "wf_process": "view",
}

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
            "inspections": "edit",
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
        "description": "بازرس — ولتاژ و فرم بازرسی برای امضا و ویرایش مشترک",
        "is_system": True,
        "permissions": {
            "dashboard": "none",
            "statistics": "none",
            "reports": "none",
            "monitoring": "view",
            "elements": "view",
            "inspections": "edit",
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
    {
        "name": "C-90",
        "description": "C-90 — المنت خراب را در کارگاه باز می‌کند (دمونتاژ / Rate off) و کارتابل پوشش‌دهی مجدد دارد",
        "is_system": True,
        "permissions": {
            "elements": "view",
            "anodes": "view",
            "cathodes": "view",
            "membranes": "view",
            "inspections": "view",
            "storage": "view",
            "wf_c90": "edit",
        },
    },
    {
        "name": "Procurement",
        "description": "تدارکات — کارتابل انتخاب شرکت، ارسال و دریافت از شرکت پوشش‌دهنده و خرید",
        "is_system": True,
        "permissions": {"anodes": "view", "cathodes": "view", "storage": "view", "wf_procurement": "edit"},
    },
    {
        "name": "Warehouse",
        "description": "انبار — کارتابل شماره ایندنت و تاریخ ورود به انبار",
        "is_system": True,
        "permissions": {"anodes": "view", "cathodes": "view", "storage": "view", "wf_warehouse": "edit"},
    },
    {
        "name": "Inspection",
        "description": "بازرسی — کارتابل بررسی آند و کاتد جداشده (پوشش خوب، پوشش متوسط، Rate off یا پوشش‌دهی مجدد)",
        "is_system": True,
        "permissions": {
            "elements": "view",
            "anodes": "view",
            "cathodes": "view",
            "membranes": "view",
            "inspections": "edit",
            "storage": "view",
            "wf_inspection": "edit",
        },
    },
    {
        "name": "Operation",
        "description": "بهره‌بردار — کارتابل دلیل خروج از مدار: سالم یا بالانس فقط پوزیشن جدید، خراب ارسال به C90",
        "is_system": True,
        "permissions": {
            "dashboard": "view",
            "elements": "view",
            "monitoring": "view",
            "shutdowns": "view",
            "voltage": "view",
            "wf_operation": "edit",
        },
    },
    {
        "name": "Cell shop",
        "description": "کارگاه سل — کارتابل المنت‌های جدیدی که در کارگاه اسمبل می‌شوند",
        "is_system": True,
        "permissions": {
            "elements": "view",
            "anodes": "view",
            "cathodes": "view",
            "membranes": "view",
            "inspections": "view",
            "wf_cellshop": "edit",
        },
    },
    {
        "name": "سرپرست الکترولایزرها",
        "description": "Assembly Data of the cells: element numbers, positions and the in-service picture",
        "is_system": True,
        "permissions": {
            "dashboard": "view",
            "elements": "edit",
            "monitoring": "view",
            "voltage": "view",
            "shutdowns": "view",
            "reports": "view",
            "search": "view",
        },
    },
    {
        "name": "بهره‌بردار",
        "description": "Switches a cell off, records the shutdown, and asks for removal or a new position",
        "is_system": True,
        "permissions": {
            "dashboard": "view",
            "elements": "view",
            "monitoring": "view",
            "shutdowns": "edit",
            "voltage": "view",
            "remarks": "edit",
            "search": "view",
            "wf_operation": "edit",
        },
    },
    {
        "name": "سرپرست فرآیند",
        "description": "Process readings, analyses and the current-efficiency sheet",
        "is_system": True,
        "permissions": _PROCESS_ACCESS,
    },
    {
        "name": "کارشناس فرآیند",
        "description": "Same access as the process supervisor",
        "is_system": True,
        "permissions": _PROCESS_ACCESS,
    },
    {
        "name": "سرپرست C90",
        "description": "Confirms dismantling and follows the cell-shop assembly of a new element",
        "is_system": True,
        "permissions": _C90_ACCESS,
    },
    {
        "name": "کارشناس کارگاه C90",
        "description": "Same access as the C-90 supervisor",
        "is_system": True,
        "permissions": _C90_ACCESS,
    },
    {
        "name": "سرپرست تدارکات",
        "description": "Coating company, dispatch and purchase cartable",
        "is_system": True,
        "permissions": _PROCUREMENT_ACCESS,
    },
    {
        "name": "کارشناس تدارکات",
        "description": "Same access as the procurement supervisor",
        "is_system": True,
        "permissions": _PROCUREMENT_ACCESS,
    },
    {
        "name": "سرپرست انبار",
        "description": "Warehouse cartable and stock",
        "is_system": True,
        "permissions": _WAREHOUSE_ACCESS,
    },
    {
        "name": "کارشناس انبار",
        "description": "Same access as the warehouse supervisor",
        "is_system": True,
        "permissions": _WAREHOUSE_ACCESS,
    },
    {
        "name": "مدیر کارخانه",
        "description": "Sees the plant and can act on every workflow step",
        "is_system": True,
        "permissions": {
            **_PLANT_VIEW,
            "elements": "edit",
            "shutdowns": "edit",
            "reports": "edit",
            "wf_c90": "edit",
            "wf_procurement": "edit",
            "wf_warehouse": "edit",
            "wf_inspection": "edit",
            "wf_operation": "edit",
            "wf_cellshop": "edit",
            "wf_process": "edit",
        },
    },
    {
        "name": "مدیریت سازمان",
        "description": "Reads the whole plant and sees every open workflow, without acting on it",
        "is_system": True,
        "permissions": _PLANT_VIEW,
    },
    {
        "name": "کارشناس تعمیرات",
        "description": "Inspection of dismantled anodes and cathodes",
        "is_system": True,
        "permissions": {
            "dashboard": "view",
            "elements": "view",
            "anodes": "view",
            "cathodes": "view",
            "membranes": "view",
            "inspections": "edit",
            "storage": "view",
            "search": "view",
            "wf_inspection": "edit",
        },
    },
]


def _set_role_permissions(db: Session, role: models.AppRole, permissions: dict[str, str]) -> None:
    db.query(models.RolePermission).filter(models.RolePermission.role_id == role.id).delete()
    for form_key, level in permissions.items():
        if not is_valid_permission_key(form_key) or level not in ("none", "view", "edit"):
            continue
        if level == "none":
            continue
        db.add(models.RolePermission(role_id=role.id, form_key=form_key, level=level))


def seed_default_roles(db: Session) -> None:
    """Create the built-in roles and fill any cartable access they are still missing.

    An existing system role keeps extra permissions an admin added. A missing
    default (for example the workflow cartable) is added so nobody has to
    recreate the role by hand.
    """
    changed = False
    for spec in DEFAULT_ROLES:
        role = db.query(models.AppRole).filter(models.AppRole.name == spec["name"]).first()
        if role is None:
            role = models.AppRole(
                name=spec["name"],
                description=spec.get("description"),
                is_system=bool(spec.get("is_system")),
            )
            db.add(role)
            db.flush()
            _set_role_permissions(db, role, spec.get("permissions") or {})
            changed = True
            continue
        if spec.get("is_system") and not role.is_system:
            role.is_system = True
            changed = True
        if spec.get("description") and role.description != spec["description"]:
            role.description = spec["description"]
            changed = True
        have = {
            row.form_key: row
            for row in db.query(models.RolePermission).filter(models.RolePermission.role_id == role.id).all()
        }
        for form_key, level in (spec.get("permissions") or {}).items():
            if not is_valid_permission_key(form_key) or level not in ("view", "edit"):
                continue
            row = have.get(form_key)
            if row is None:
                db.add(models.RolePermission(role_id=role.id, form_key=form_key, level=level))
                changed = True
            elif LEVEL_RANK.get(row.level, 0) < LEVEL_RANK[level]:
                row.level = level
                changed = True
    if changed:
        db.commit()


def ensure_inspection_collaboration(db: Session) -> None:
    """Raise inspections access on built-in roles so Insp/Maint/Proc can share the form."""
    wanted = {"Operator": "edit", "Inspector": "edit", "Viewer": "view"}
    changed = False
    for name, level in wanted.items():
        role = db.query(models.AppRole).filter(models.AppRole.name == name).first()
        if role is None:
            continue
        row = (
            db.query(models.RolePermission)
            .filter(models.RolePermission.role_id == role.id, models.RolePermission.form_key == "inspections")
            .first()
        )
        if row is None:
            db.add(models.RolePermission(role_id=role.id, form_key="inspections", level=level))
            changed = True
        elif LEVEL_RANK.get(row.level, 0) < LEVEL_RANK[level]:
            row.level = level
            changed = True
        if name == "Inspector" and role.description and "فقط بخش ولتاژ" in role.description:
            role.description = "بازرس — ولتاژ و فرم بازرسی برای امضا و ویرایش مشترک"
            changed = True
            elem = (
                db.query(models.RolePermission)
                .filter(models.RolePermission.role_id == role.id, models.RolePermission.form_key == "elements")
                .first()
            )
            if elem is None:
                db.add(models.RolePermission(role_id=role.id, form_key="elements", level="view"))
    if changed:
        db.commit()


def seed_default_admin(db: Session) -> None:
    seed_default_roles(db)
    ensure_inspection_collaboration(db)
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
