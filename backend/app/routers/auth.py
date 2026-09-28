from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from .. import models, schemas
from .. import ad_directory as ad
from .. import audit
from ..auth import (
    create_access_token,
    get_current_user,
    hash_password,
    user_permission_map,
    verify_password,
)
from ..database import get_db

router = APIRouter(prefix="/auth", tags=["auth"])


def _local_login(db: Session, username: str, password: str) -> models.User | None:
    user = db.query(models.User).filter(models.User.username == username).first()
    if not user:
        user = db.query(models.User).filter(models.User.username == ad.normalize_username(username)).first()
    if not user or not user.is_active or not verify_password(password, user.password_hash):
        return None
    return user


def _ua(request: Request) -> str | None:
    return (request.headers.get("user-agent") or "")[:255] or None


@router.get("/directory")
def directory_login_hint():
    return ad.login_hint()


@router.post("/login", response_model=schemas.TokenResponse)
def login(payload: schemas.LoginRequest, request: Request, db: Session = Depends(get_db)):
    username = (payload.username or "").strip()
    ip = audit.parse_client_ip(request)
    ua = _ua(request)
    hint = ad.login_hint()
    if hint["enabled"]:
        try:
            info = ad.authenticate_ad(username, payload.password)
            user = ad.provision_ad_user(db, username, info.get("display_name"))
            audit.log_auth_event(
                action="login",
                username=user.username,
                success=True,
                summary="Login via Active Directory",
                user_id=user.id,
                user_role=user.role,
                ip_address=ip,
                user_agent=ua,
                details={"auth_source": "ad"},
            )
            return schemas.TokenResponse(access_token=create_access_token(user))
        except PermissionError as exc:
            if hint["allow_local_fallback"]:
                user = _local_login(db, username, payload.password)
                if user:
                    audit.log_auth_event(
                        action="login",
                        username=user.username,
                        success=True,
                        summary="Login via local fallback (AD denied)",
                        user_id=user.id,
                        user_role=user.role,
                        ip_address=ip,
                        user_agent=ua,
                        details={"auth_source": "local", "ad_error": str(exc)},
                    )
                    return schemas.TokenResponse(access_token=create_access_token(user))
            audit.log_auth_event(
                action="login_failed",
                username=username,
                success=False,
                summary="Login failed (Active Directory)",
                ip_address=ip,
                user_agent=ua,
                details={"detail": str(exc)},
            )
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc)) from exc
        except Exception as exc:  # noqa: BLE001
            if hint["allow_local_fallback"]:
                user = _local_login(db, username, payload.password)
                if user:
                    audit.log_auth_event(
                        action="login",
                        username=user.username,
                        success=True,
                        summary="Login via local fallback (AD unreachable)",
                        user_id=user.id,
                        user_role=user.role,
                        ip_address=ip,
                        user_agent=ua,
                        details={"auth_source": "local"},
                    )
                    return schemas.TokenResponse(access_token=create_access_token(user))
            audit.log_auth_event(
                action="login_failed",
                username=username,
                success=False,
                summary="Login failed (AD unreachable)",
                ip_address=ip,
                user_agent=ua,
                details={"detail": str(exc)},
            )
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=f"Active Directory is unreachable: {exc}",
            ) from exc

    user = _local_login(db, username, payload.password)
    if not user:
        audit.log_auth_event(
            action="login_failed",
            username=username,
            success=False,
            summary="Login failed (invalid credentials)",
            ip_address=ip,
            user_agent=ua,
        )
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid username or password")
    audit.log_auth_event(
        action="login",
        username=user.username,
        success=True,
        summary="Login via local account",
        user_id=user.id,
        user_role=user.role,
        ip_address=ip,
        user_agent=ua,
        details={"auth_source": getattr(user, "auth_source", "local") or "local"},
    )
    return schemas.TokenResponse(access_token=create_access_token(user))


@router.get("/me", response_model=schemas.MeResponse)
def me(user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    role_name = None
    if user.role_id:
        role = db.query(models.AppRole).filter(models.AppRole.id == user.role_id).first()
        role_name = role.name if role else None
    return schemas.MeResponse(
        id=user.id,
        username=user.username,
        full_name=user.full_name,
        role=user.role,
        role_id=user.role_id,
        role_name=role_name,
        is_active=user.is_active,
        created_at=user.created_at,
        auth_source=getattr(user, "auth_source", "local") or "local",
        permissions=user_permission_map(db, user),
    )


@router.post("/change-password")
def change_password(
    payload: schemas.ChangePasswordRequest,
    request: Request,
    user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if getattr(user, "auth_source", "local") == "ad":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This account uses Active Directory. Change the password in Windows / AD, not here.",
        )
    if not verify_password(payload.current_password, user.password_hash):
        audit.log_auth_event(
            action="password_change_failed",
            username=user.username,
            success=False,
            summary="Password change failed (wrong current password)",
            user_id=user.id,
            user_role=user.role,
            ip_address=audit.parse_client_ip(request),
            user_agent=_ua(request),
        )
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Current password is incorrect")
    user.password_hash = hash_password(payload.new_password)
    db.commit()
    audit.log_auth_event(
        action="password_change",
        username=user.username,
        success=True,
        summary="Password changed",
        user_id=user.id,
        user_role=user.role,
        ip_address=audit.parse_client_ip(request),
        user_agent=_ua(request),
    )
    return {"ok": True}
