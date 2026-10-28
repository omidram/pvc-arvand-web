"""Admin catalog of every program table and the Excel file loaded into it."""
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from .. import models
from ..auth import require_admin
from ..database import get_db
from ..excel_import import stash_upload
from ..import_jobs import spawn_import
from ..table_files import delete_table_file, list_tables, replace_table_file, workbook_path

router = APIRouter(prefix="/table-files", tags=["table-files"], dependencies=[Depends(require_admin)])


@router.get("")
def catalog(db: Session = Depends(get_db)):
    return {"tables": list_tables(db)}


@router.delete("/{key}")
def remove_file(key: str, db: Session = Depends(get_db)):
    return delete_table_file(db, key)


@router.post("/{key}")
async def upload_file(
    key: str,
    file: UploadFile = File(...),
    admin: models.User = Depends(require_admin),
):
    stored, filename = await stash_upload(file)
    who = admin.username

    def work(db: Session, progress):
        try:
            content = stored.read_bytes()
            return replace_table_file(db, key, filename, content, who, progress)
        finally:
            stored.unlink(missing_ok=True)

    return spawn_import(work)


@router.get("/{key}/download")
def download_file(key: str, db: Session = Depends(get_db)):
    path, name = workbook_path(db, key)
    return FileResponse(
        path,
        filename=name,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )
