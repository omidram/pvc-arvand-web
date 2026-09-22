from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from .. import models, schemas
from .. import ad_directory as ad
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


@router.get("/directory")
def directory_login_hint():
    return ad.login_hint()


@router.post("/login", response_model=schemas.TokenResponse)
def login(payload: schemas.LoginRequest, db: Session = Depends(get_db)):
    username = (payload.username or "").strip()
    hint = ad.login_hint()
    if hint["enabled"]:
        try:
            info = ad.authenticate_ad(username, payload.password)
            user = ad.provision_ad_user(db, username, info.get("display_name"))
            return schemas.TokenResponse(access_token=create_access_token(user))
        except PermissionError as exc:
            if hint["allow_local_fallback"]:
                user = _local_login(db, username, payload.password)
                if user:
                    return schemas.TokenResponse(access_token=create_access_token(user))
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc)) from exc
        except Exception as exc:  # noqa: BLE001
            if hint["allow_local_fallback"]:
                user = _local_login(db, username, payload.password)
                if user:
                    return schemas.TokenResponse(access_token=create_access_token(user))
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=f"Active Directory is unreachable: {exc}",
            ) from exc

    user = _local_login(db, username, payload.password)
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid username or password")
    return schemas.TokenResponse(access_token=create_access_token(user))


@router.get("/me", response_model=schemas.MeResponse)
def me(user: models.User = Depends(get_current_user), db: Session = Depends(get_db)):
    return schemas.MeResponse(
        id=user.id,
        username=user.username,
        full_name=user.full_name,
        role=user.role,
        is_active=user.is_active,
        created_at=user.created_at,
        permissions=user_permission_map(db, user),
    )


@router.post("/change-password")
def change_password(
    payload: schemas.ChangePasswordRequest,
    user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if getattr(user, "auth_source", "local") == "ad":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This account uses Active Directory. Change the password in Windows / AD, not here.",
        )
    if not verify_password(payload.current_password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Current password is incorrect")
    user.password_hash = hash_password(payload.new_password)
    db.commit()
    return {"ok": True}
