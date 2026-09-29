"""Progress for every Excel import."""
from fastapi import APIRouter, Depends, HTTPException

from ..auth import get_current_user
from ..import_jobs import get_job

router = APIRouter(prefix="/imports", tags=["imports"])


@router.get("/{job_id}")
def import_progress(job_id: str, _user=Depends(get_current_user)):
    job = get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Import job not found")
    return job
