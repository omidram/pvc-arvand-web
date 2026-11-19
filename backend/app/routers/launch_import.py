"""Settings import for the twelve official position workbooks."""
from fastapi import APIRouter, Depends, File, Query, UploadFile
from sqlalchemy.orm import Session

from ..auth import get_current_user
from ..database import get_db
from ..launch_import import import_launch_workbook, slot_catalog
from ..models import User

router = APIRouter(prefix="/launch-import", tags=["launch-import"])


@router.get("/slots")
def launch_slots(_user: User = Depends(get_current_user)):
    return {"slots": slot_catalog()}


@router.post("/{slot}")
async def launch_import(
    slot: str,
    file: UploadFile = File(...),
    dry_run: bool = Query(False),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    content = await file.read()
    return import_launch_workbook(
        db,
        slot,
        file.filename or "",
        content,
        user_name=user.username,
        dry_run=dry_run,
    )
