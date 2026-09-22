"""Admin Active Directory settings and connection tests."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from .. import models
from .. import ad_directory as ad
from ..auth import require_admin

router = APIRouter(prefix="/directory", tags=["directory"], dependencies=[Depends(require_admin)])


class DirectorySettingsPayload(BaseModel):
    enabled: bool = False
    host: str = ""
    port: int = 389
    use_ssl: bool = False
    use_starttls: bool = False
    base_dn: str = ""
    domain: str = ""
    bind_username: str = ""
    bind_password: str | None = None
    allowed_users: list[str] | str = Field(default_factory=list)
    allowed_groups: list[str] | str = Field(default_factory=list)
    allow_local_fallback: bool = True
    enforce_at_startup: bool = True


class DirectoryTestPayload(DirectorySettingsPayload):
    pass


class CheckUserPayload(BaseModel):
    username: str = Field(min_length=1)


@router.get("/status")
def directory_status(_admin: models.User = Depends(require_admin)):
    settings = ad.public_settings()
    windows = ad.current_windows_user()
    current = None
    if settings.get("enabled") and settings.get("host") and windows.get("sam"):
        try:
            current = ad.check_username(windows["sam"])
        except Exception as exc:  # noqa: BLE001
            current = {"ok": False, "unreachable": True, "reason": str(exc), "sam": windows["sam"]}
    return {"settings": settings, "windows": windows, "current_user": current}


@router.put("/settings")
def update_directory_settings(payload: DirectorySettingsPayload, _admin: models.User = Depends(require_admin)):
    try:
        return {"ok": True, "settings": ad.save_settings(payload.model_dump())}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/test")
def test_directory(payload: DirectoryTestPayload, _admin: models.User = Depends(require_admin)):
    try:
        return ad.test_connection(payload.model_dump())
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/check-user")
def check_directory_user(payload: CheckUserPayload, _admin: models.User = Depends(require_admin)):
    try:
        return ad.check_username(payload.username)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=str(exc)) from exc
