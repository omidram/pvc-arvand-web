"""Chunked Excel uploads so a reverse proxy cannot cut the workbook off at 1 MB."""
from __future__ import annotations

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel, Field

from ..auth import get_current_user
from ..excel_import import begin_chunked_upload, write_chunk

router = APIRouter(prefix="/uploads", tags=["uploads"])


class BeginUpload(BaseModel):
    filename: str
    size: int = Field(ge=1, le=500 * 1024 * 1024)
    chunk_size: int | None = None


@router.post("/sessions")
def start_session(payload: BeginUpload, _user=Depends(get_current_user)):
    return begin_chunked_upload(payload.filename, payload.size, payload.chunk_size)


@router.put("/sessions/{upload_id}")
async def append_chunk(
    upload_id: str,
    request: Request,
    x_upload_offset: int = Header(default=0),
    _user=Depends(get_current_user),
):
    data = await request.body()
    if not data:
        raise HTTPException(status_code=400, detail="Empty upload chunk.")
    return write_chunk(upload_id, x_upload_offset, data)
